import { Injectable, Optional } from "@nestjs/common";
import { MbtiOrder, Prisma } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { MbtiConfigService } from "../plugins/mbti-config/mbti-config.service";
import { reject } from "./mbti.http";
import { object } from "./mbti.service";
import { MBTI_PRODUCTS } from "./mbti-products";

type Row = MbtiOrder & { entitlement: { id: string } | null };
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
// Admin read model only ever exposes a masked identifier, never the full openId.
const maskIdentity = (value: string) => value.length <= 10 ? `${value.slice(0, 2)}***` : `${value.slice(0, 6)}***${value.slice(-4)}`;

@Injectable()
export class MbtiOrdersService {
  constructor(private readonly prisma: PrismaService, @Optional() private readonly configs?: MbtiConfigService) {}
  async products() {
    const catalog = await this.configuredCatalog();
    if (!catalog?.shop.length) return { items: MBTI_PRODUCTS };
    return { items: catalog.shop.map((item, index) => ({ code: item.id, name: item.title, description: item.desc,
      amount: item.cents, currency: "CNY", saleable: item.on, pricing_mode: "controlled_test_fixture", highlights: [],
      tier: (index + 1) as 1 | 2, ...(item.on ? {} : { unavailable_reason: "FULFILLMENT_UNCONFIGURED" }) })) };
  }
  private async configuredCatalog() {
    try { return await this.configs?.publishedCatalog(); } catch { return null; }
  }
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
    // Published catalog wins; the built-in fixtures stay the fallback when configuration is absent.
    const catalog = await this.configuredCatalog();
    const configured = catalog?.shop.find(item => item.id === productCode);
    const product = configured
      ? { amount: configured.cents, currency: "CNY", saleable: configured.on }
      : MBTI_PRODUCTS.find(item => item.code === productCode);
    if (!product?.saleable) reject(409, "PRODUCT_NOT_SALEABLE", "此商品暂不可下单");
    const id = await this.prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"mbti-order:" + ownerId + ":" + keyHash},0))`;
      const existing = await tx.mbtiOrder.findUnique({ where: { ownerId_idempotencyKeyHash: { ownerId, idempotencyKeyHash: keyHash } } });
      if (existing) {
        if (existing.requestFingerprint !== fingerprint) reject(409, "IDEMPOTENCY_CONFLICT", "此重试标识已用于另一购买意图");
        return existing.id; // Durable replay works even after F2 deletes the source result.
      }
      const owned = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "MbtiResult" WHERE id=${resultId} AND "ownerId"=${ownerId} FOR SHARE`;
      if (!owned.length) reject(404, "NOT_FOUND", "资源不存在");
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
      if (!order?.paymentOrderId || order.status === "refunded") return;
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
  // Local development only: settle a pending order with a synthetic Foundation charge.
  async devMarkPaid(ownerId: string, id: string) {
    const row = await this.prisma.$transaction(async tx => {
      const rows = await tx.$queryRaw<MbtiOrder[]>`SELECT * FROM "MbtiOrder" WHERE id=${id} FOR UPDATE`;
      const order = rows[0];
      if (!order || order.ownerId !== ownerId) reject(404, "NOT_FOUND", "资源不存在");
      if (order.status === "failed" || order.status === "refunded") reject(409, "ORDER_TERMINAL", "订单已结束，无法模拟支付");
      if (order.status !== "paid") {
        await this.settle(tx, order);
        await tx.mbtiOrder.update({ where: { id }, data: { status: "paid", paidAt: new Date() } });
      }
      if (!await tx.mbtiEntitlement.findUnique({ where: { orderId: id } })) {
        await tx.mbtiEntitlement.create({ data: { orderId: id, kind: order.productCode } });
      }
      return tx.mbtiOrder.findUniqueOrThrow({ where: { id }, include: { entitlement: true } });
    }, { maxWait: 5000, timeout: 10000 });
    return this.payload(row);
  }
  // Local development only: close a pending order as failed without a provider fact.
  async devMarkFailed(ownerId: string, id: string) {
    const row = await this.prisma.$transaction(async tx => {
      const rows = await tx.$queryRaw<MbtiOrder[]>`SELECT * FROM "MbtiOrder" WHERE id=${id} FOR UPDATE`;
      const order = rows[0];
      if (!order || order.ownerId !== ownerId) reject(404, "NOT_FOUND", "资源不存在");
      if (order.status === "paid" || order.status === "refunded") reject(409, "ORDER_STATE", "仅待支付订单可模拟失败");
      if (order.status !== "failed") await tx.mbtiOrder.update({ where: { id }, data: { status: "failed" } });
      return tx.mbtiOrder.findUniqueOrThrow({ where: { id }, include: { entitlement: true } });
    }, { maxWait: 5000, timeout: 10000 });
    return this.payload(row);
  }
  // Local development only: refund a paid order and revoke its business entitlement.
  // No provider refund fact is fabricated; the status change is a controlled-test projection.
  async devRefund(ownerId: string, id: string) {
    const row = await this.prisma.$transaction(async tx => {
      const rows = await tx.$queryRaw<MbtiOrder[]>`SELECT * FROM "MbtiOrder" WHERE id=${id} FOR UPDATE`;
      const order = rows[0];
      if (!order || order.ownerId !== ownerId) reject(404, "NOT_FOUND", "资源不存在");
      if (order.status === "refunded") return tx.mbtiOrder.findUniqueOrThrow({ where: { id }, include: { entitlement: true } });
      if (order.status !== "paid") reject(409, "ORDER_STATE", "仅已支付订单可模拟退款");
      await tx.mbtiOrder.update({ where: { id }, data: { status: "refunded" } });
      await tx.mbtiEntitlement.deleteMany({ where: { orderId: id } });
      return tx.mbtiOrder.findUniqueOrThrow({ where: { id }, include: { entitlement: true } });
    }, { maxWait: 5000, timeout: 10000 });
    return this.payload(row);
  }
  // Builds a synthetic succeeded charge so the database payment guards stay authoritative.
  private async settle(tx: Prisma.TransactionClient, order: MbtiOrder) {
    const project = await tx.projectProfile.findFirst({ where: { environment: "development" } }) ?? await tx.projectProfile.findFirstOrThrow();
    const workspace = await tx.clientWorkspace.findUnique({ where: { code: "mbti-dev-payment" } })
      ?? await tx.clientWorkspace.create({ data: { id: "mbti-dev-payment-workspace", code: "mbti-dev-payment", name: "MBTI 开发模拟支付",
        createdByMemberId: (await tx.memberUser.upsert({ where: { id: "mbti-dev-payment-owner" },
          create: { id: "mbti-dev-payment-owner", nickname: "MBTI 开发模拟支付" }, update: {} })).id,
        creationIdempotencyKey: "mbti-dev-payment-workspace" } });
    const role = await tx.clientWorkspaceRole.upsert({ where: { workspaceId_code: { workspaceId: workspace.id, code: "member" } },
      create: { id: "mbti-dev-payment-role", workspaceId: workspace.id, code: "member", name: "成员" }, update: {} });
    const memberId = "mbti-dev-pay-" + order.ownerId;
    await tx.memberUser.upsert({ where: { id: memberId }, create: { id: memberId, nickname: "MBTI 开发模拟支付用户" }, update: {} });
    await tx.clientWorkspaceMembership.upsert({ where: { workspaceId_memberId: { workspaceId: workspace.id, memberId } },
      create: { workspaceId: workspace.id, memberId, roleId: role.id }, update: {} });
    const ledger = await tx.paymentOrder.create({ data: { projectId: project.id, workspaceId: workspace.id, memberId,
      orderNo: "DEVPAY-" + randomUUID(), payableOwner: "mbti-controlled-test", payableReference: order.id,
      amountMinor: BigInt(order.amount), currency: order.currency.trim(), currencyExponent: 2,
      idempotencyKeyHash: digest("devpay:" + order.id), requestFingerprint: digest(JSON.stringify([order.id, order.amount])),
      status: "succeeded" } });
    const providerReference = "devpay-" + randomUUID();
    const attempt = await tx.paymentAttempt.create({ data: { orderId: ledger.id, attemptNumber: 1, providerCode: "synthetic-test",
      providerReference, status: "succeeded", submittedAt: new Date(), observedAt: new Date() } });
    const event = await tx.paymentCallbackEvent.create({ data: { projectId: project.id, orderId: ledger.id, attemptId: attempt.id,
      providerCode: "synthetic-test", eventId: "devpay-" + randomUUID(), payloadSha256: digest("devpay:" + order.id),
      status: "accepted", processedAt: new Date() } });
    await tx.paymentTransaction.create({ data: { orderId: ledger.id, attemptId: attempt.id, callbackEventId: event.id,
      providerCode: "synthetic-test", providerReference, kind: "charge",
      amountMinor: BigInt(order.amount), currency: order.currency.trim(), occurredAt: new Date() } });
    await tx.mbtiOrder.update({ where: { id: order.id }, data: { paymentOrderId: ledger.id } });
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
  // Support view of who owns an order: masked login identity plus card profile.
  async adminUser(id: string) {
    const order = await this.prisma.mbtiOrder.findUnique({ where: { id }, select: { id: true, ownerId: true } });
    if (!order) reject(404, "NOT_FOUND", "资源不存在");
    const identity = await this.prisma.mbtiWechatIdentity.findUnique({ where: { guestId: order.ownerId } });
    if (!identity) return { order_id: order.id, logged_in: false, provider: null, open_id_masked: null,
      union_id_masked: null, nickname: null, type_code: null };
    const card = await this.prisma.mbtiCard.findUnique({ where: { ownerId: order.ownerId }, select: { nickname: true, typeCode: true } });
    const typeCode = card?.typeCode && /^[A-Za-z]{4}$/.test(card.typeCode) ? card.typeCode : null;
    return { order_id: order.id, logged_in: true,
      provider: identity.openId.startsWith("mock_") ? "mock" : "wechat",
      open_id_masked: maskIdentity(identity.openId),
      union_id_masked: identity.unionId ? maskIdentity(identity.unionId) : null,
      nickname: card?.nickname || null, type_code: typeCode,
      identity_created_at: identity.createdAt.toISOString(), last_login_at: identity.lastLoginAt.toISOString() };
  }
}
