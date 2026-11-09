import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { PaymentOrderStatus, PaymentTransactionKind, Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { ManagementAccessService } from "../../rbac/management-access.service";
import { PluginRuntimeAccessService } from "../../plugin-runtime/plugin-runtime-access.service";
import { PrismaService } from "../../prisma/prisma.service";
import { PAYMENT_REFUND_REQUEST } from "../../../../../scripts/payment-admin-policy.cjs";
import { CreateManualRefundRequestDto, PaymentAdminOrderListDto, PaymentAdminRefundListDto } from "./payment-admin.dto";

const PAGE_LIMIT = 100;
const orderIncludes = {
  attempts: { orderBy: { attemptNumber: "desc" as const } },
  transactions: { orderBy: { recordedAt: "desc" as const } },
  callbackEvents: { orderBy: { receivedAt: "desc" as const } }
};
type AdminPaymentOrder = Prisma.PaymentOrderGetPayload<{ include: typeof orderIncludes }>;
type AdminRefundRequest = Prisma.PaymentRefundRequestGetPayload<{ include: { paymentOrder: true; requestedBy: { select: { id: true; username: true; realName: true } } } }>;

@Injectable()
export class PaymentAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pluginAccess: PluginRuntimeAccessService,
    private readonly management: ManagementAccessService
  ) {}

  private publicOrder(row: AdminPaymentOrder) {
    return {
      id: row.id,
      orderNo: row.orderNo,
      payableReference: row.payableReference,
      payableOwner: row.payableOwner,
      amountMinor: row.amountMinor.toString(),
      currency: row.currency.trim(),
      currencyExponent: row.currencyExponent,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      attempts: row.attempts.map(attempt => ({
        id: attempt.id, attemptNumber: attempt.attemptNumber, providerCode: attempt.providerCode,
        status: attempt.status, submittedAt: attempt.submittedAt?.toISOString() ?? null,
        observedAt: attempt.observedAt?.toISOString() ?? null
      })),
      transactions: row.transactions.map(transaction => ({
        id: transaction.id, kind: transaction.kind, amountMinor: transaction.amountMinor.toString(),
        currency: transaction.currency.trim(), occurredAt: transaction.occurredAt.toISOString(), recordedAt: transaction.recordedAt.toISOString()
      })),
      callbackEvents: row.callbackEvents.map(event => ({ status: event.status, failureCode: event.failureCode, receivedAt: event.receivedAt.toISOString(), processedAt: event.processedAt?.toISOString() ?? null }))
    };
  }

  private publicRefund(row: AdminRefundRequest) {
    return {
      id: row.id, orderId: row.paymentOrderId, orderNo: row.paymentOrder.orderNo,
      amountMinor: row.amountMinor.toString(), currency: row.currency.trim(), currencyExponent: row.currencyExponent, reason: row.reason,
      status: row.status, requestedAt: row.createdAt.toISOString(),
      requester: { id: row.requestedBy.id, username: row.requestedBy.username, realName: row.requestedBy.realName }
    };
  }

  async listOrders(query: PaymentAdminOrderListDto) {
    return this.management.database(() => this.prisma.$transaction(async tx => {
      const projectId = await this.pluginAccess.projectId(tx);
      const where: Prisma.PaymentOrderWhereInput = {
        projectId, deletedAt: null,
        ...(query.status ? { status: query.status } : {}),
        ...(query.q?.trim() ? { orderNo: { contains: query.q.trim(), mode: "insensitive" } } : {})
      };
      const [total, rows] = await Promise.all([
        tx.paymentOrder.count({ where }),
        tx.paymentOrder.findMany({ where, include: orderIncludes, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (query.page - 1) * query.pageSize, take: Math.min(query.pageSize, PAGE_LIMIT) })
      ]);
      return { items: rows.map(row => this.publicOrder(row)), total, page: query.page, pageSize: query.pageSize };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 2000, timeout: 4000 }));
  }

  async getOrder(id: string) {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new NotFoundException("Payment order unavailable");
    return this.management.database(() => this.prisma.$transaction(async tx => {
      const projectId = await this.pluginAccess.projectId(tx);
      const row = await tx.paymentOrder.findFirst({ where: { id, projectId, deletedAt: null }, include: orderIncludes });
      if (!row) throw new NotFoundException("Payment order unavailable");
      return this.publicOrder(row);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 2000, timeout: 4000 }));
  }

  async listRefundRequests(query: PaymentAdminRefundListDto) {
    return this.management.database(() => this.prisma.$transaction(async tx => {
      const projectId = await this.pluginAccess.projectId(tx);
      const where: Prisma.PaymentRefundRequestWhereInput = { projectId, ...(query.status ? { status: query.status } : {}) };
      const include = { paymentOrder: true, requestedBy: { select: { id: true, username: true, realName: true } } } as const;
      const [total, rows] = await Promise.all([
        tx.paymentRefundRequest.count({ where }),
        tx.paymentRefundRequest.findMany({ where, include, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (query.page - 1) * query.pageSize, take: Math.min(query.pageSize, PAGE_LIMIT) })
      ]);
      return { items: rows.map(row => this.publicRefund(row)), total, page: query.page, pageSize: query.pageSize };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 2000, timeout: 4000 }));
  }

  async createRefundRequest(orderId: string, dto: CreateManualRefundRequestDto, operatorId: string, correlationId?: string) {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(orderId)) throw new NotFoundException("Payment order unavailable");
    if (!/^[1-9][0-9]{0,17}$/.test(dto.amountMinor) || !/^[A-Za-z0-9_-]{16,128}$/.test(dto.idempotencyKey)) throw new BadRequestException("Refund request is invalid");
    const reason = dto.reason.trim();
    if (!reason || reason.length > 500) throw new BadRequestException("Refund request is invalid");
    const amount = BigInt(dto.amountMinor);
    const keyHash = createHash("sha256").update(dto.idempotencyKey).digest("hex");
    return this.management.write(operatorId, [PAYMENT_REFUND_REQUEST], async (tx, actor) => {
      const projectId = await this.pluginAccess.projectId(tx);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"aij-payment-refund-request:" + orderId}, 0))`;
      const fingerprint = createHash("sha256").update(JSON.stringify([projectId, orderId, dto.amountMinor, reason])).digest("hex");
      const whereUnique = { projectId_requestedByUserId_idempotencyKeyHash: { projectId, requestedByUserId: actor.id, idempotencyKeyHash: keyHash } };
      const existing = await tx.paymentRefundRequest.findUnique({ where: whereUnique, include: { paymentOrder: true, requestedBy: { select: { id: true, username: true, realName: true } } } });
      if (existing) {
        if (existing.requestFingerprint !== fingerprint || existing.paymentOrderId !== orderId) throw new ConflictException("Refund request key is already used");
        return this.publicRefund(existing);
      }
      const order = await tx.paymentOrder.findFirst({
        where: { id: orderId, projectId, deletedAt: null },
        include: { transactions: { orderBy: { recordedAt: "asc" } }, refundRequests: { where: { status: "pending_manual_review" }, select: { amountMinor: true } } }
      });
      if (!order) throw new NotFoundException("Payment order unavailable");
      if (order.status !== PaymentOrderStatus.succeeded) throw new ConflictException("Only a settled payment can receive a refund request");
      const charges = order.transactions.filter(transaction => transaction.kind === PaymentTransactionKind.charge);
      if (charges.length !== 1) throw new ConflictException("Payment charge fact is unavailable or ambiguous");
      const paid = charges[0].amountMinor;
      const alreadyReturned = order.transactions.filter(transaction => transaction.kind !== PaymentTransactionKind.charge).reduce((sum, transaction) => sum + transaction.amountMinor, 0n);
      const reserved = order.refundRequests.reduce((sum, request) => sum + request.amountMinor, 0n);
      if (amount > paid - alreadyReturned - reserved) throw new ConflictException("Refund request exceeds remaining refundable amount");
      const row = await tx.paymentRefundRequest.create({ data: {
        projectId, paymentOrderId: order.id, chargeTransactionId: charges[0].id, requestedByUserId: actor.id,
        amountMinor: amount, currency: charges[0].currency, currencyExponent: order.currencyExponent, reason, idempotencyKeyHash: keyHash,
        requestFingerprint: fingerprint, status: "pending_manual_review"
      }, include: { paymentOrder: true, requestedBy: { select: { id: true, username: true, realName: true } } } });
      await this.management.audit(tx, actor.id, row.id, "payment_refund_requested", "aij-payment", "payment_refund_request", correlationId, ["paymentOrderId", "amountMinor", "currency", "reason"]);
      return this.publicRefund(row);
    });
  }
}
