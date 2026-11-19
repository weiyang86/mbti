import { Injectable } from "@nestjs/common";
import { MbtiOrder, Prisma } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { reject } from "./mbti.http";
import { object } from "./mbti.service";
import { MBTI_PRODUCTS } from "./mbti-products";

type Row = MbtiOrder & { entitlement: { id: string } | null };
const digest = (value: string) => createHash("sha256").update(value).digest("hex");

@Injectable()
export class MbtiOrdersService {
  constructor(private readonly prisma: PrismaService) {}
  products() { return { items: MBTI_PRODUCTS }; }
  payload(row: Row) {
    return { id: row.id, result_id: row.resultId, product_code: row.productCode, amount: row.amount, currency: row.currency.trim(),
      status: row.status, unlocked: row.status === "paid" && !!row.entitlement, created_at: row.createdAt.toISOString(),
      ...(row.paidAt ? { paid_at: row.paidAt.toISOString() } : {}),
      payment_availability: row.paymentOrderId ? "controlled_test" : "unconfigured", pricing_mode: row.pricingMode };
  }
  async create(ownerId: string, input: unknown, key: unknown) {
    const body = object(input);
    if (Object.keys(body).length !== 2 || Object.keys(body).some(k => !["result_id", "product_code"].includes(k)) ||
      typeof body.result_id !== "string" || !body.result_id || body.result_id.length > 128 ||
      typeof body.product_code !== "string" || !body.product_code || body.product_code.length > 64) reject(422, "INVALID_INPUT", "下单仅接受结果与商品编码");
    if (typeof key !== "string" || !/^[A-Za-z0-9_-]{16,128}$/.test(key)) reject(422, "INVALID_IDEMPOTENCY_KEY", "请提供16至128位购买意图重试标识");
    const resultId = body.result_id, productCode = body.product_code;
    const keyHash = digest(key), fingerprint = digest(JSON.stringify([resultId, productCode]));
    const id = await this.prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"mbti-order:" + ownerId + ":" + keyHash},0))`;
      const existing = await tx.mbtiOrder.findUnique({ where: { ownerId_idempotencyKeyHash: { ownerId, idempotencyKeyHash: keyHash } } });
      if (existing) {
        if (existing.requestFingerprint !== fingerprint) reject(409, "IDEMPOTENCY_CONFLICT", "此重试标识已用于另一购买意图");
        return existing.id; // Durable replay works even after F2 deletes the source result.
      }
      const owned = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "MbtiResult" WHERE id=${resultId} AND "ownerId"=${ownerId} FOR SHARE`;
      if (!owned.length) reject(404, "NOT_FOUND", "资源不存在");
      const product = MBTI_PRODUCTS.find(p => p.code === productCode);
      if (!product?.saleable) reject(409, "PRODUCT_NOT_SALEABLE", "此商品暂不可下单");
      const row = await tx.mbtiOrder.create({ data: { id: "MBTI-" + randomUUID(), ownerId, resultId, productCode,
        amount: product.amount, currency: product.currency, idempotencyKeyHash: keyHash, requestFingerprint: fingerprint } });
      return row.id;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 5000, timeout: 10000 });
    return this.payload(await this.owned(ownerId, id));
  }
  // A verified Foundation charge is the only payment fact source. Read repair also closes the
  // crash window between callback ledger commit and this idempotent business projection.
  async sync(id: string) {
    await this.prisma.$transaction(async tx => {
      const rows = await tx.$queryRaw<MbtiOrder[]>`SELECT * FROM "MbtiOrder" WHERE id=${id} FOR UPDATE`;
      const order = rows[0];
      if (!order?.paymentOrderId) return;
      const ledger = await tx.paymentOrder.findUnique({ where: { id: order.paymentOrderId }, include: { transactions: { where: { kind: "charge" } } } });
      if (!ledger || ledger.payableOwner !== "mbti-controlled-test" || ledger.payableReference !== order.id ||
        ledger.amountMinor !== BigInt(order.amount) || ledger.currency.trim() !== order.currency.trim()) return;
      if (ledger.status === "failed" && order.status === "pending") await tx.mbtiOrder.update({ where: { id }, data: { status: "failed" } });
      const charge = ledger.transactions.find(t => t.amountMinor === BigInt(order.amount) && t.currency.trim() === order.currency.trim());
      if (ledger.status !== "succeeded" || !charge) return;
      if (order.status === "pending") await tx.mbtiOrder.update({ where: { id }, data: { status: "paid", paidAt: charge.occurredAt } });
      const existing = await tx.mbtiEntitlement.findUnique({ where: { orderId: id } });
      if (!existing) await tx.mbtiEntitlement.create({ data: { orderId: id, kind: order.productCode } });
    }, { maxWait: 5000, timeout: 10000 });
  }
  private async owned(ownerId: string, id: string): Promise<Row> {
    const found = await this.prisma.mbtiOrder.findFirst({ where: { id, ownerId }, select: { id: true } });
    if (!found) reject(404, "NOT_FOUND", "资源不存在");
    await this.sync(id);
    return this.prisma.mbtiOrder.findUniqueOrThrow({ where: { id }, include: { entitlement: true } });
  }
  async status(ownerId: string, id: string) {
    const row = this.payload(await this.owned(ownerId, id));
    return { order_id: row.id, status: row.status, unlocked: row.unlocked, payment_availability: row.payment_availability,
      ...(row.paid_at ? { paid_at: row.paid_at } : {}) };
  }
  async list(ownerId: string, limitValue: unknown, cursorValue: unknown) {
    const limit = limitValue === undefined ? 20 : typeof limitValue === "string" && /^[1-9][0-9]{0,2}$/.test(limitValue) ? Number(limitValue) : 0;
    if (limit < 1 || limit > 100) reject(422, "INVALID_PAGINATION", "每页数量应为1至100");
    let cursor: { createdAt: Date; id: string } | undefined;
    if (cursorValue !== undefined) {
      if (typeof cursorValue !== "string" || cursorValue.length > 256) reject(422, "INVALID_PAGINATION", "分页游标无效");
      try {
        const parsed = JSON.parse(Buffer.from(cursorValue, "base64url").toString());
        if (!Array.isArray(parsed) || parsed.length !== 2 || typeof parsed[0] !== "string" || typeof parsed[1] !== "string") throw new Error();
        const found = await this.prisma.mbtiOrder.findFirst({ where: { id: parsed[1], ownerId } });
        if (!found || found.createdAt.toISOString() !== parsed[0]) throw new Error();
        cursor = { createdAt: found.createdAt, id: found.id };
      } catch { reject(422, "INVALID_PAGINATION", "分页游标无效"); }
    }
    const rows = await this.prisma.mbtiOrder.findMany({ where: { ownerId, ...(cursor ? { OR: [
      { createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }
    ] } : {}) }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit + 1 });
    const page = rows.slice(0, limit);
    const items = [];
    for (const row of page) items.push(this.payload(await this.owned(ownerId, row.id)));
    const last = page.at(-1);
    return { items, next_cursor: rows.length > limit && last ? Buffer.from(JSON.stringify([last.createdAt.toISOString(), last.id])).toString("base64url") : null };
  }
  async entitlements(ownerId: string) {
    const unsettled = await this.prisma.mbtiOrder.findMany({ where: { ownerId, paymentOrderId: { not: null }, status: "pending" }, select: { id: true } });
    for (const row of unsettled) await this.sync(row.id);
    const rows = await this.prisma.mbtiEntitlement.findMany({ where: { order: { ownerId } }, include: { order: true }, orderBy: [{ grantedAt: "desc" }, { id: "desc" }] });
    return { items: rows.map(row => ({ id: row.id, order_id: row.orderId, result_id: row.order.resultId, product_code: row.order.productCode,
      kind: row.kind, status: "active", granted_at: row.grantedAt.toISOString(), scope: row.scope })) };
  }
  async operations(id: string) {
    if (!await this.prisma.mbtiOrder.findUnique({ where: { id }, select: { id: true } })) reject(404, "NOT_FOUND", "资源不存在");
    await this.sync(id);
    return this.payload(await this.prisma.mbtiOrder.findUniqueOrThrow({ where: { id }, include: { entitlement: true } }));
  }
}
