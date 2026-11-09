import { BadRequestException, ConflictException, HttpException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PaymentAttemptStatus, PaymentCallbackEventStatus, PaymentOrderStatus, PaymentTransactionKind, Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";
import { PrismaService } from "../../prisma/prisma.service";
import { PaymentCredentialResolver, PAYMENT_CREDENTIAL_RESOLVER } from "./payment-payable-source";
import { PaymentProviderRegistry } from "./payment-provider";
import { validatePaymentCallbackPayload } from "./payment-callback.dto";
import { paymentCallbackSignatureHeaders, verifyPaymentCallbackSignature } from "./payment-callback-signature";
import { assertPaymentAttemptTransition, assertPaymentOrderTransition } from "./payment-state";

type RawRequest = Readonly<{ rawBody?: Buffer; headers: IncomingHttpHeaders }>;

@Injectable()
export class PaymentCallbackService {
  private readonly environment: string;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(PAYMENT_CREDENTIAL_RESOLVER) private readonly credentials: PaymentCredentialResolver,
    private readonly providers: PaymentProviderRegistry,
    config: ConfigService
  ) {
    this.environment = config.getOrThrow<string>("environment");
  }

  async receive(projectCode: string, providerCode: string, request: RawRequest, correlationId?: string) {
    if (!/^[a-z][a-z0-9-]{1,62}$/.test(projectCode) || !/^[a-z][a-z0-9-]{0,49}$/.test(providerCode)) {
      throw new NotFoundException("Payment callback unavailable");
    }
    if (!Buffer.isBuffer(request.rawBody) || request.rawBody.length < 1 || request.rawBody.length > 65_536) {
      throw new BadRequestException("Invalid payment callback body size");
    }
    let parsed: unknown;
    try { parsed = JSON.parse(request.rawBody.toString("utf8")); }
    catch { throw new BadRequestException("Payment callback payload is invalid"); }
    const payload = validatePaymentCallbackPayload(parsed);
    const signatureHeaders = paymentCallbackSignatureHeaders(request.headers);
    if (signatureHeaders.eventId !== payload.eventId) throw new BadRequestException("Payment callback event identity is invalid");

    try { this.providers.get(providerCode); }
    catch { throw new ServiceUnavailableException("Payment callback provider is unavailable"); }

    const project = await this.prisma.projectProfile.findFirst({
      where: { code: projectCode, environment: this.environment, status: "active", deletedAt: null,
        organization: { status: "active", deletedAt: null } },
      select: { id: true }
    });
    if (!project) throw new NotFoundException("Payment callback unavailable");

    const attempt = await this.prisma.paymentAttempt.findUnique({
      where: { providerCode_providerReference: { providerCode, providerReference: payload.providerReference } },
      include: { order: true }
    });
    if (!attempt || attempt.order.projectId !== project.id || attempt.order.orderNo !== payload.orderNo || attempt.order.deletedAt) {
      throw new NotFoundException("Payment callback unavailable");
    }
    if (!attempt.credentialRef) throw new ServiceUnavailableException("Payment callback credential is unavailable");

    let secret: string;
    try { secret = await this.credentials.resolve(attempt.credentialRef); }
    catch { throw new ServiceUnavailableException("Payment callback credential is unavailable"); }
    try {
      verifyPaymentCallbackSignature(request.rawBody, signatureHeaders, secret, { projectCode, providerCode });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException("Payment callback authentication is unavailable");
    }

    const payloadSha256 = createHash("sha256").update(request.rawBody).digest("hex");
    let result: { kind: "accepted" } | { kind: "replay" } | { kind: "rejected"; code: string };
    try {
      result = await this.prisma.$transaction(async tx => {
        const lockKey = [project.id, providerCode, payload.eventId].join(":");
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"aij-payment-callback:" + lockKey}, 0))`;
        const key = { projectId_providerCode_eventId: { projectId: project.id, providerCode, eventId: payload.eventId } };
        const existing = await tx.paymentCallbackEvent.findUnique({ where: key });
        if (existing) {
          await tx.auditLog.create({ data: {
            module: "aij-payment", action: "payment_callback_replay_rejected", method: "POST",
            path: "/api/payments/callbacks/" + projectCode + "/" + providerCode,
            requestSummary: { correlationId: correlationId || "unavailable" }, status: "failed",
            resourceType: "payment_order", resourceId: existing.orderId,
            afterData: { eventId: payload.eventId, reason: "replay" }
          } });
          return { kind: "replay" as const };
        }

        const receipt = await tx.paymentCallbackEvent.create({ data: {
          projectId: project.id, orderId: attempt.orderId, attemptId: attempt.id, providerCode,
          eventId: payload.eventId, payloadSha256, status: PaymentCallbackEventStatus.received
        } });
        const reject = async (
          code: string,
          beforeOrderStatus = attempt.order.status,
          beforeAttemptStatus = attempt.status
        ) => {
          await tx.paymentCallbackEvent.update({ where: { id: receipt.id }, data: {
            status: PaymentCallbackEventStatus.rejected, failureCode: code, processedAt: new Date()
          } });
          await tx.auditLog.create({ data: {
            module: "aij-payment", action: "payment_callback_rejected", method: "POST",
            path: "/api/payments/callbacks/" + projectCode + "/" + providerCode,
            requestSummary: { correlationId: correlationId || "unavailable" }, status: "failed",
            resourceType: "payment_order", resourceId: attempt.orderId,
            beforeData: { orderStatus: beforeOrderStatus, attemptStatus: beforeAttemptStatus },
            afterData: { eventId: payload.eventId, reason: code }
          } });
          return { kind: "rejected" as const, code };
        };

        const current = await tx.paymentAttempt.findUnique({
          where: { providerCode_providerReference: { providerCode, providerReference: payload.providerReference } },
          include: { order: true }
        });
        if (!current || current.id !== attempt.id || current.credentialRef !== attempt.credentialRef ||
            current.order.projectId !== project.id || current.order.orderNo !== payload.orderNo || current.order.deletedAt) {
          return reject("state_conflict", current?.order.status ?? attempt.order.status, current?.status ?? attempt.status);
        }

        if (payload.amountMinor !== current.order.amountMinor.toString()) return reject("amount_mismatch");
        if (payload.currency !== current.order.currency.trim()) return reject("currency_mismatch");

        const nextAttempt = payload.status === "pending" ? PaymentAttemptStatus.pending
          : payload.status === "succeeded" ? PaymentAttemptStatus.succeeded : PaymentAttemptStatus.failed;
        const nextOrder = payload.status === "succeeded" ? PaymentOrderStatus.succeeded
          : payload.status === "failed" ? PaymentOrderStatus.failed : PaymentOrderStatus.pending;
        if (current.order.status !== PaymentOrderStatus.pending) return reject("state_conflict");
        if (current.status !== nextAttempt) {
          try { assertPaymentAttemptTransition(current.status, nextAttempt); }
          catch { return reject("state_conflict"); }
          await tx.paymentAttempt.update({ where: { id: current.id }, data: {
            status: nextAttempt, observedAt: new Date(payload.occurredAt)
          } });
        }
        if (nextOrder !== PaymentOrderStatus.pending) {
          try { assertPaymentOrderTransition(current.order.status, nextOrder); }
          catch { return reject("state_conflict"); }
          await tx.paymentOrder.update({ where: { id: current.orderId }, data: { status: nextOrder } });
        }
        if (payload.status === "succeeded") {
          await tx.paymentTransaction.create({ data: {
            orderId: current.orderId, attemptId: current.id, callbackEventId: receipt.id,
            providerCode, providerReference: payload.providerReference, kind: PaymentTransactionKind.charge,
            amountMinor: current.order.amountMinor, currency: current.order.currency,
            occurredAt: new Date(payload.occurredAt)
          } });
        }
        await tx.paymentCallbackEvent.update({ where: { id: receipt.id }, data: {
          status: PaymentCallbackEventStatus.accepted, processedAt: new Date()
        } });
        await tx.auditLog.create({ data: {
          module: "aij-payment", action: "payment_callback_accepted", method: "POST",
          path: "/api/payments/callbacks/" + projectCode + "/" + providerCode,
          requestSummary: { correlationId: correlationId || "unavailable" }, status: "success",
          resourceType: "payment_order", resourceId: current.orderId,
          beforeData: { orderStatus: current.order.status, attemptStatus: current.status },
          afterData: { eventId: payload.eventId, callbackStatus: payload.status, orderStatus: nextOrder }
        } });
        return { kind: "accepted" as const };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 4000, timeout: 8000 });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException("Payment callback unavailable");
    }

    if (result.kind === "replay") throw new ConflictException("Payment callback replay rejected");
    if (result.kind === "rejected") throw new ConflictException("Payment callback rejected");
    return { accepted: true };
  }
}
