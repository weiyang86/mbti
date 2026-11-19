import { BadRequestException, ConflictException, HttpException, Injectable, Inject, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PaymentAttemptStatus, PaymentOrderStatus, Prisma } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { PluginRuntimeAccessService } from "../../plugin-runtime/plugin-runtime-access.service";
import { PrismaService } from "../../prisma/prisma.service";
import { CreatePaymentOrderDto } from "./payment.dto";
import { PaymentProviderRegistry, validatePaymentProviderRequest, validatePaymentProviderResult } from "./payment-provider";
import { PaymentPayableSource, PaymentCredentialResolver, PAYMENT_CREDENTIAL_RESOLVER, PAYMENT_PAYABLE_SOURCE, validatePaymentPayableSnapshot } from "./payment-payable-source";
import { assertPaymentAttemptTransition, assertPaymentOrderTransition } from "./payment-state";

type Actor = Readonly<{ memberId: string; workspaceId: string; correlationId?: string }>;
type PaymentRow = Prisma.PaymentOrderGetPayload<{ include: { attempts: { orderBy: { attemptNumber: "desc" } } } }>;

@Injectable()
export class PaymentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pluginAccess: PluginRuntimeAccessService,
    private readonly providers: PaymentProviderRegistry,
    @Inject(PAYMENT_PAYABLE_SOURCE) private readonly payables: PaymentPayableSource,
    @Inject(PAYMENT_CREDENTIAL_RESOLVER) private readonly credentials: PaymentCredentialResolver,
    private readonly config: ConfigService
  ) {}

  private async ensureReady() {
    if (!(await this.prisma.readiness()).ready) throw new ServiceUnavailableException("Payment service unavailable");
  }

  private publicOrder(row: PaymentRow) {
    const attempt = row.attempts[0];
    return {
      id: row.id,
      orderNo: row.orderNo,
      payableReference: row.payableReference,
      amountMinor: row.amountMinor.toString(),
      currency: row.currency.trim(),
      currencyExponent: row.currencyExponent,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      ...(attempt ? { latestAttempt: { status: attempt.status, providerCode: attempt.providerCode, submittedAt: attempt.submittedAt?.toISOString() ?? null } } : {})
    };
  }

  async createOrder(dto: CreatePaymentOrderDto, actor: Actor) {
    await this.ensureReady();
    if (!actor.memberId || !actor.workspaceId || !/^[A-Za-z0-9_-]{16,128}$/.test(dto.idempotencyKey)) throw new BadRequestException("Invalid payment request");

    let projectId: string;
    try {
      projectId = await this.prisma.$transaction(tx => this.pluginAccess.projectId(tx), { maxWait: 2000, timeout: 2000 });
    } catch {
      throw new ServiceUnavailableException("Payment service unavailable");
    }

    const snapshot = validatePaymentPayableSnapshot(await this.payables.resolve({
      projectId, workspaceId: actor.workspaceId, memberId: actor.memberId, payableReference: dto.payableReference
    }), dto.payableReference);
    const provider = this.providers.get(snapshot.providerCode);
    const credential = await this.credentials.resolve(snapshot.credentialRef);
    if (!credential || credential.length > 4096) throw new ServiceUnavailableException("Payment credential is unavailable");

    const idempotencyKeyHash = createHash("sha256").update(dto.idempotencyKey).digest("hex");
    const requestFingerprint = createHash("sha256").update(JSON.stringify([
      snapshot.owner, snapshot.reference, snapshot.amountMinor, snapshot.currency, snapshot.currencyExponent, snapshot.providerCode
    ])).digest("hex");
    const scope = [projectId, actor.workspaceId, actor.memberId, idempotencyKeyHash].join(":");

    let reserved: { row: PaymentRow; attemptId: string; replay: boolean };
    try {
      reserved = await this.prisma.$transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"aij-payment-idempotency:" + scope}, 0))`;
        const where = { projectId_workspaceId_memberId_idempotencyKeyHash: {
          projectId, workspaceId: actor.workspaceId, memberId: actor.memberId, idempotencyKeyHash
        } };
        const existing = await tx.paymentOrder.findUnique({ where, include: { attempts: { orderBy: { attemptNumber: "desc" } } } });
        if (existing) {
          if (existing.requestFingerprint !== requestFingerprint) throw new ConflictException("Idempotency key is already used for a different payable");
          return { row: existing, attemptId: existing.attempts[0]?.id ?? "", replay: true };
        }

        const orderNo = "AIJPAY-" + randomUUID();
        assertPaymentOrderTransition("created", "pending");
        const order = await tx.paymentOrder.create({
          data: {
            projectId, workspaceId: actor.workspaceId, memberId: actor.memberId, orderNo,
            payableOwner: snapshot.owner, payableReference: snapshot.reference, amountMinor: BigInt(snapshot.amountMinor),
            currency: snapshot.currency, currencyExponent: snapshot.currencyExponent,
            idempotencyKeyHash, requestFingerprint, status: PaymentOrderStatus.pending
          }
        });
        assertPaymentAttemptTransition("created", "submitting");
        const attempt = await tx.paymentAttempt.create({ data: {
          orderId: order.id, attemptNumber: 1, providerCode: snapshot.providerCode, credentialRef: snapshot.credentialRef,
          status: PaymentAttemptStatus.submitting
        } });
        await tx.auditLog.create({ data: {
          module: "aij-payment", action: "payment_order_requested", userId: actor.memberId, method: "POST",
          path: "/api/client/payments/orders", requestSummary: { correlationId: actor.correlationId || "unavailable" },
          status: "success", resourceType: "payment_order", resourceId: order.id, workspaceId: actor.workspaceId,
          afterData: { orderNo, status: "pending", amountMinor: snapshot.amountMinor, currency: snapshot.currency }
        } });
        return { row: { ...order, attempts: [attempt] }, attemptId: attempt.id, replay: false };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 4000, timeout: 8000 });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException("Payment order unavailable");
    }
    if (reserved.replay) return this.publicOrder(reserved.row);

    const request = validatePaymentProviderRequest({
      projectId, paymentOrderId: reserved.row.id, paymentAttemptId: reserved.attemptId, orderNo: reserved.row.orderNo,
      amountMinor: snapshot.amountMinor, currency: snapshot.currency, currencyExponent: snapshot.currencyExponent,
      // Stable server-generated provider key; the caller's idempotency key is never forwarded or persisted.
      idempotencyKey: reserved.row.orderNo
    });
    try {
      const result = validatePaymentProviderResult(await provider.createPayment(request, credential));
      const attemptStatus = result.status === "pending" ? PaymentAttemptStatus.pending
        : result.status === "failed" ? PaymentAttemptStatus.failed : PaymentAttemptStatus.unknown;
      assertPaymentAttemptTransition(PaymentAttemptStatus.submitting, attemptStatus);
      await this.prisma.$transaction(async tx => {
        await tx.paymentAttempt.update({ where: { id: reserved.attemptId }, data: {
          status: attemptStatus, providerReference: result.providerReference, submittedAt: new Date(), observedAt: new Date(result.observedAt)
        } });
        if (result.status === "failed") {
          assertPaymentOrderTransition(PaymentOrderStatus.pending, PaymentOrderStatus.failed);
          await tx.paymentOrder.update({ where: { id: reserved.row.id }, data: { status: PaymentOrderStatus.failed } });
        }
      }, { maxWait: 4000, timeout: 8000 });
    } catch (error) {
      // Provider timeouts and malformed replies are ambiguous. Preserve an unknown attempt and pending order;
      // G18-03 reconciliation owns terminal success, callbacks, and transaction facts.
      try {
        await this.prisma.paymentAttempt.update({ where: { id: reserved.attemptId }, data: { status: PaymentAttemptStatus.unknown, submittedAt: new Date(), observedAt: new Date() } });
      } catch { /* retain only the sanitized public failure below */ }
      if (error instanceof HttpException && error.getStatus() === 503) throw error;
      throw new ServiceUnavailableException("Payment provider result is unavailable");
    }
    const final = await this.prisma.paymentOrder.findUnique({
      where: { id: reserved.row.id }, include: { attempts: { orderBy: { attemptNumber: "desc" } } }
    });
    if (!final) throw new ServiceUnavailableException("Payment order unavailable");
    return this.publicOrder(final);
  }

  async getOrder(orderId: string, actor: Actor) {
    await this.ensureReady();
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(orderId)) throw new NotFoundException("Payment order unavailable");
    let projectId: string;
    try {
      projectId = await this.prisma.$transaction(tx => this.pluginAccess.projectId(tx), { maxWait: 2000, timeout: 2000 });
    } catch {
      throw new ServiceUnavailableException("Payment service unavailable");
    }
    const row = await this.prisma.paymentOrder.findFirst({
      where: { id: orderId, projectId, workspaceId: actor.workspaceId, memberId: actor.memberId, deletedAt: null },
      include: { attempts: { orderBy: { attemptNumber: "desc" }, take: 1 } }
    });
    if (!row) throw new NotFoundException("Payment order unavailable");
    return this.publicOrder(row);
  }
}
