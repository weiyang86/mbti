import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { PaymentTransactionKind, Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { MbtiOrdersService } from "./mbti-orders.service";
import { reject } from "./mbti.http";
import { csvCell, OPS_EXPORT_MAX, orderCursor, orderWhere, parseOrderQuery, OrderQuery } from "./mbti-ops-orders.query";

@Injectable()
export class MbtiOpsOrdersService {
  constructor(private readonly prisma: PrismaService, private readonly orders: MbtiOrdersService) {}
  // Collection queries read the durable settlement projection. Only the existing detail path
  // performs payment read repair; no provider calls, ledger copies or new settlement owner.
  private async page(tx: Prisma.TransactionClient, query: OrderQuery, take: number) {
    const where = orderWhere(query);
    if (query.cursor) {
      // Cursor membership uses the same filters, without the strict "after" predicate.
      const anchor = await tx.mbtiOrder.findFirst({ where: { AND: [orderWhere({ ...query, cursor: undefined }), { id: query.cursor.id, createdAt: query.cursor.createdAt }] }, select: { id: true } });
      if (!anchor) reject(422, "INVALID_ORDER_QUERY", "分页游标无效或已过期，请重新查询");
    }
    return tx.mbtiOrder.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take, include: { entitlement: true } });
  }
  list(input: unknown) {
    const query = parseOrderQuery(input);
    return this.prisma.$transaction(async tx => {
      const rows = await this.page(tx, query, query.limit + 1), page = rows.slice(0, query.limit), last = page.at(-1);
      return { items: page.map(row => this.orders.payload(row)), next_cursor: rows.length > query.limit && last ? orderCursor(query, last) : null };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 2000, timeout: 10000 });
  }
  exportCsv(actorId: string, input: unknown) {
    const query = parseOrderQuery(input);
    return this.prisma.$transaction(async tx => {
      const rows = await this.page(tx, query, OPS_EXPORT_MAX + 1);
      if (rows.length > OPS_EXPORT_MAX) reject(422, "EXPORT_TOO_LARGE", "导出最多5000笔，请缩小筛选范围");
      const fields = ["id", "result_id", "product_code", "amount", "currency", "status", "unlocked", "created_at", "paid_at", "payment_availability", "pricing_mode"] as const;
      const csv = '\uFEFF' + [fields.map(csvCell).join(","), ...rows.map(row => { const item = this.orders.payload(row); return fields.map(key => csvCell(item[key] ?? "")).join(","); })].join("\r\n") + "\r\n";
      try {
        // Foundation's existing AuditLog owner. Never store query values, URLs, row IDs or CSV.
        await tx.auditLog.create({ data: { module: "mbti-orders", action: "orders_exported", userId: actorId, resourceType: "mbti_order_collection", status: "success",
          requestSummary: { count: rows.length, filterCategories: [...Object.keys(query.filters), ...(query.cursor ? ["cursor"] : [])] } } });
      } catch { throw new ServiceUnavailableException("Export audit unavailable"); }
      return csv;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 2000, timeout: 10000 });
  }
  summary(input: unknown) {
    const query = parseOrderQuery(input, true);
    const interval = { from: query.filters.from!, to: query.filters.to!, startInclusive: query.filters.from! + "T00:00:00.000Z", endExclusive: new Date(Date.parse(query.filters.to! + "T00:00:00.000Z") + 86_400_000).toISOString(), dateBasis: "order_created_at", boundaryTimezone: "UTC", displayTimezone: "Asia/Shanghai" };
    const base = { interval, channelAttributionUnavailable: true as const };
    if (query.channel && query.channel !== "all") {
      return Promise.resolve({ ...base, netCollectedFen: null, refundsUnavailable: true, metrics: null, unavailableReason: "channel_attribution_unavailable" });
    }
    return this.prisma.$transaction(async tx => {
      const groups = await tx.mbtiOrder.groupBy({ by: ["status", "currency"], where: orderWhere(query), _count: { _all: true }, _sum: { amount: true } });
      const count = (status: string) => groups.filter(g => g.status === status).reduce((sum, g) => sum + g._count._all, 0);
      // 退款单在业务上仍是“成功支付过的订单”，保留在已支付数量与毛额内；退款事实另计。
      const paidLike = groups.filter(g => g.status === "paid" || g.status === "refunded");
      const paidOrderCount = count("paid") + count("refunded");
      const byCurrency = new Map<string, { currency: string; amountFen: number; paidOrderCount: number }>();
      for (const group of paidLike) {
        const currency = group.currency.trim();
        const current = byCurrency.get(currency) ?? { currency, amountFen: 0, paidOrderCount: 0 };
        current.amountFen += group._sum.amount ?? 0;
        current.paidOrderCount += group._count._all;
        byCurrency.set(currency, current);
      }
      const grossPaidByCurrency = [...byCurrency.values()].sort((a, b) => a.currency.localeCompare(b.currency));
      const metrics = { pending: count("pending"), paid: paidOrderCount, failed: count("failed"), paidOrderCount,
        grossPaidAmountFen: grossPaidByCurrency.length > 1 ? null : grossPaidByCurrency[0]?.amountFen ?? 0,
        currency: grossPaidByCurrency.length === 1 ? grossPaidByCurrency[0].currency : null, grossPaidByCurrency };
      // Net only when refund PaymentTransaction facts exist for paid orders in-window; empty refund ledger ≠ zero refunds.
      const paidLinks = await tx.mbtiOrder.findMany({
        where: { AND: [orderWhere(query), { status: { in: ["paid", "refunded"] }, paymentOrderId: { not: null } }] },
        select: { amount: true, currency: true, paymentOrderId: true },
      });
      const paymentIds = [...new Set(paidLinks.map(row => row.paymentOrderId!).filter(Boolean))];
      const refundRows = paymentIds.length === 0 ? [] : await tx.paymentTransaction.findMany({
        where: { orderId: { in: paymentIds }, kind: PaymentTransactionKind.refund },
        select: { amountMinor: true, currency: true },
      });
      if (refundRows.length === 0) {
        return { ...base, netCollectedFen: null, refundsUnavailable: true, metrics, unavailableReason: null };
      }
      const currencies = new Set([...paidLinks.map(row => row.currency.trim()), ...refundRows.map(row => row.currency.trim())]);
      if (currencies.size !== 1) {
        return { ...base, netCollectedFen: null, refundsUnavailable: false, metrics, unavailableReason: null };
      }
      const gross = paidLinks.reduce((sum, row) => sum + row.amount, 0);
      const refunded = refundRows.reduce((sum, row) => sum + Number(row.amountMinor), 0);
      return { ...base, netCollectedFen: gross - refunded, refundsUnavailable: false, metrics, unavailableReason: null };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 2000, timeout: 10000 });
  }
}
