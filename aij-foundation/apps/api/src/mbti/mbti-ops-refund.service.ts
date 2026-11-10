import { Injectable } from "@nestjs/common";
import { PaymentOrderStatus, PaymentTransactionKind } from "@prisma/client";
import { createHash } from "node:crypto";
import { PAYMENT_REFUND_REQUEST } from "../../../../scripts/payment-admin-policy.cjs";
import { ManagementAccessService } from "../rbac/management-access.service";
import { PluginRuntimeAccessService } from "../plugin-runtime/plugin-runtime-access.service";
import { PrismaService } from "../prisma/prisma.service";
import { reject } from "./mbti.http";
import { MbtiOrdersService } from "./mbti-orders.service";
import { object } from "./mbti.service";

/** Candidate MBTI facade over AF-106: manual refund request only; never a provider command or entitlement revoke. */
@Injectable()
export class MbtiOpsRefundService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: MbtiOrdersService,
    private readonly access: ManagementAccessService,
    private readonly plugins: PluginRuntimeAccessService,
  ) {}

  private public(row: {
    id: string; paymentOrderId: string; amountMinor: bigint; currency: string; reason: string; status: string; createdAt: Date;
  }, mbtiOrderId: string) {
    return {
      schema: "mbti-ops-refund-request-candidate/v1",
      status: "needs_human_review",
      request_id: row.id,
      order_id: mbtiOrderId,
      payment_order_id: row.paymentOrderId,
      amount_fen: Number(row.amountMinor),
      currency: row.currency.trim(),
      refund_status: row.status,
      reason: row.reason,
      created_at: row.createdAt.toISOString(),
      entitlement_revoked: false,
    };
  }

  async create(orderId: string, input: unknown, operatorId: string, correlationId?: string) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(orderId)) reject(404, "NOT_FOUND", "资源不存在");
    const body = object(input);
    const keys = Object.keys(body);
    if (keys.some(k => !["reason", "idempotency_key", "amount_fen"].includes(k)) || !keys.includes("reason") || !keys.includes("idempotency_key")) {
      reject(422, "INVALID_REFUND_REQUEST", "退款申请仅接受 reason、idempotency_key 与可选 amount_fen");
    }
    if (typeof body.reason !== "string" || !body.reason.trim() || body.reason.trim().length > 500) {
      reject(422, "INVALID_REFUND_REQUEST", "退款原因须为 1–500 字");
    }
    if (typeof body.idempotency_key !== "string" || !/^[A-Za-z0-9_-]{16,128}$/.test(body.idempotency_key)) {
      reject(422, "INVALID_REFUND_REQUEST", "请提供 16–128 位幂等键");
    }
    if (body.amount_fen !== undefined && (typeof body.amount_fen !== "number" || !Number.isSafeInteger(body.amount_fen) || body.amount_fen < 1)) {
      reject(422, "INVALID_REFUND_REQUEST", "amount_fen 须为正整数分");
    }
    const reason = body.reason.trim();
    const keyHash = createHash("sha256").update(body.idempotency_key).digest("hex");

    await this.orders.sync(orderId);
    const order = await this.prisma.mbtiOrder.findUnique({ where: { id: orderId } });
    if (!order) reject(404, "NOT_FOUND", "资源不存在");
    if (order.status !== "paid" || !order.paymentOrderId) {
      reject(409, "REFUND_UNAVAILABLE", "仅已支付且已关联支付单的订单可提交人工退款申请");
    }
    const amountMinor = body.amount_fen !== undefined ? BigInt(body.amount_fen) : BigInt(order.amount);
    if (amountMinor > BigInt(order.amount)) reject(422, "INVALID_REFUND_REQUEST", "退款金额不能超过订单金额");
    const amountText = amountMinor.toString();
    const paymentOrderId = order.paymentOrderId;

    const row = await this.access.write(operatorId, [PAYMENT_REFUND_REQUEST], async (tx, actor) => {
      const projectId = await this.plugins.projectId(tx);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"aij-payment-refund-request:" + paymentOrderId}, 0))`;
      const fingerprint = createHash("sha256").update(JSON.stringify([projectId, paymentOrderId, amountText, reason])).digest("hex");
      const whereUnique = { projectId_requestedByUserId_idempotencyKeyHash: { projectId, requestedByUserId: actor.id, idempotencyKeyHash: keyHash } };
      const existing = await tx.paymentRefundRequest.findUnique({ where: whereUnique });
      if (existing) {
        if (existing.requestFingerprint !== fingerprint || existing.paymentOrderId !== paymentOrderId) {
          reject(409, "IDEMPOTENCY_CONFLICT", "此幂等键已用于另一退款申请");
        }
        return existing;
      }
      const payment = await tx.paymentOrder.findFirst({
        where: { id: paymentOrderId, projectId, deletedAt: null },
        include: {
          transactions: { orderBy: { recordedAt: "asc" as const } },
          refundRequests: { where: { status: "pending_manual_review" }, select: { amountMinor: true } },
        },
      });
      if (!payment) reject(409, "REFUND_UNAVAILABLE", "关联支付单不可用");
      if (payment.payableOwner !== "mbti-controlled-test" || payment.payableReference !== orderId) {
        reject(409, "REFUND_UNAVAILABLE", "支付单与 MBTI 订单不匹配");
      }
      if (payment.status !== PaymentOrderStatus.succeeded) reject(409, "REFUND_UNAVAILABLE", "仅已结清支付可申请退款");
      const charges = payment.transactions.filter(t => t.kind === PaymentTransactionKind.charge);
      if (charges.length !== 1) reject(409, "REFUND_UNAVAILABLE", "支付入账事实不可用或存在歧义");
      const paid = charges[0].amountMinor;
      const alreadyReturned = payment.transactions.filter(t => t.kind !== PaymentTransactionKind.charge).reduce((sum, t) => sum + t.amountMinor, 0n);
      const reserved = payment.refundRequests.reduce((sum, r) => sum + r.amountMinor, 0n);
      if (amountMinor > paid - alreadyReturned - reserved) reject(409, "REFUND_EXCEEDS_REMAINING", "退款申请超过剩余可退金额");
      const created = await tx.paymentRefundRequest.create({
        data: {
          projectId, paymentOrderId: payment.id, chargeTransactionId: charges[0].id, requestedByUserId: actor.id,
          amountMinor, currency: charges[0].currency, currencyExponent: payment.currencyExponent, reason,
          idempotencyKeyHash: keyHash, requestFingerprint: fingerprint, status: "pending_manual_review",
        },
      });
      await this.access.audit(tx, actor.id, created.id, "mbti_refund_requested", "mbti", "payment_refund_request", correlationId,
        ["orderId", "paymentOrderId", "amountMinor", "currency", "reason"]);
      return created;
    });
    return this.public(row, orderId);
  }
}
