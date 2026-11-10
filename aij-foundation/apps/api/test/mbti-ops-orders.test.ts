import "reflect-metadata";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { projectAudit } from "../src/audit-log/audit-redaction";
import { MbtiOpsOrdersService } from "../src/mbti/mbti-ops-orders.service";
import { csvCell, orderCursor, orderWhere, parseOrderQuery, OPS_EXPORT_MAX } from "../src/mbti/mbti-ops-orders.query";
import { MbtiOrdersService } from "../src/mbti/mbti-orders.service";
import { PrismaService } from "../src/prisma/prisma.service";
import type { AuditLog } from "@prisma/client";

function code(value: string) {
  return (error: unknown) => (error as { getResponse(): { code: string } }).getResponse().code === value;
}
function fingerprint(filters: Record<string, string | null>, limit = 20) {
  return createHash("sha256").update(JSON.stringify([filters.q ?? null, filters.status ?? null, filters.product_code ?? null, filters.from ?? null, filters.to ?? null, limit])).digest("hex");
}
const row = (id: string, status: string, amount: number, createdAt: string, currency = "CNY") => ({
  id, resultId: `result-${id}`, productCode: "basic", amount, currency, status, createdAt: new Date(createdAt), paidAt: status === "paid" ? new Date(createdAt) : null,
  paymentOrderId: null, pricingMode: "controlled_test_fixture", entitlement: status === "paid" ? { id: `ent-${id}` } : null, ownerId: "guest-secret-should-not-leak",
});

test("order query rejects unsafe filters, empty keys, and unbound cursor reuse", () => {
  assert.equal(parseOrderQuery({}).limit, 20);
  assert.equal(parseOrderQuery({ limit: "100" }).limit, 100);
  for (const query of [{ q: "bad id" }, { status: "refunded" }, { product_code: "x/y" }, { from: "2026-01-01" }, { to: "2026-01-01" },
    { from: "2026-01-01", to: "2024-01-01" }, { from: "2026-01-01", to: "2027-01-02" }, { limit: "0" }, { limit: "101" }, { cursor: "%%%" },
    { channel: "tiktok" }, { ownerId: "x" }, { q: "" }, null, []]) {
    assert.throws(() => parseOrderQuery(query as never), code("INVALID_ORDER_QUERY"));
  }
  const ok = parseOrderQuery({ from: "2026-01-01", to: "2026-01-02", status: "paid", limit: "10" });
  const cursor = orderCursor(ok, { createdAt: new Date("2026-01-02T00:00:00.000Z"), id: "MBTI-1" });
  assert.equal(parseOrderQuery({ from: "2026-01-01", to: "2026-01-02", status: "paid", limit: "10", cursor }).cursor?.id, "MBTI-1");
  assert.throws(() => parseOrderQuery({ from: "2026-01-01", to: "2026-01-02", status: "pending", limit: "10", cursor }), code("INVALID_ORDER_QUERY"));
  const summary = parseOrderQuery({ from: "2026-01-01", to: "2026-01-01", channel: "all" }, true);
  assert.equal(summary.channel, "all");
  assert.throws(() => parseOrderQuery({ channel: "all" }, true), code("INVALID_ORDER_QUERY"));
});

test("csv cells quote values and neutralize spreadsheet formulas", () => {
  assert.equal(csvCell('a"b'), '"a""b"');
  assert.equal(csvCell("=1+1"), '"\'=1+1"');
  assert.equal(csvCell("\t-cmd"), '"\'\t-cmd"');
  assert.equal(csvCell(990), '"990"');
});

test("list/export share filters, omit owner IDs, and audit only count/categories", async () => {
  const items = [
    row("MBTI-2", "paid", 990, "2026-11-09T12:00:00.000Z"),
    row("MBTI-1", "pending", 990, "2026-11-08T12:00:00.000Z"),
  ];
  const audits: unknown[] = [];
  let findManyTake = 0;
  const tx = {
    mbtiOrder: {
      async findFirst() { return { id: "MBTI-2" }; },
      async findMany({ take }: { take: number }) { findManyTake = take; return items.slice(0, take); },
      async groupBy() { return []; },
    },
    auditLog: { async create({ data }: { data: unknown }) { audits.push(data); return data; } },
  };
  const prisma = { async $transaction(work: (value: typeof tx) => Promise<unknown>) { return work(tx); } } as unknown as PrismaService;
  const orders = { payload(value: ReturnType<typeof row>) {
    return { id: value.id, result_id: value.resultId, product_code: value.productCode, amount: value.amount, currency: value.currency.trim(),
      status: value.status, unlocked: value.status === "paid" && !!value.entitlement, created_at: value.createdAt.toISOString(),
      payment_availability: "unconfigured", pricing_mode: value.pricingMode };
  } } as unknown as MbtiOrdersService;
  const service = new MbtiOpsOrdersService(prisma, orders);
  const page = await service.list({ status: "paid", limit: "1" }) as { items: { id: string; ownerId?: string }[]; next_cursor: string | null };
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0].id, "MBTI-2");
  assert.equal(page.items[0].ownerId, undefined);
  assert.ok(page.next_cursor);
  assert.doesNotMatch(JSON.stringify(page), /guest-secret|ownerId/);
  const csv = await service.exportCsv("admin-1", { status: "paid" }) as string;
  assert.equal(findManyTake, OPS_EXPORT_MAX + 1);
  assert.match(csv, /^\uFEFF"id"/);
  assert.match(csv, /"MBTI-2"/);
  assert.doesNotMatch(csv, /guest-secret|ownerId/);
  assert.equal(audits.length, 1);
  assert.deepEqual(audits[0], { module: "mbti-orders", action: "orders_exported", userId: "admin-1", resourceType: "mbti_order_collection", status: "success",
    requestSummary: { count: 2, filterCategories: ["status"] } });
  const projected = projectAudit({ id: "c000000000000000000000001", module: "mbti-orders", action: "orders_exported", userId: "admin-1", userName: "secret-name",
    status: "success", resourceType: "mbti_order_collection", resourceId: null, method: "GET", path: "/api/admin/mbti/orders/export.csv?status=paid&q=secret",
    requestSummary: { count: 2, filterCategories: ["status", "q", "evil"], secret: "leak" }, beforeData: { leak: true }, afterData: null, errorMessage: null,
    ip: "127.0.0.1", userAgent: "agent", workspaceId: null, createdAt: new Date("2026-11-10T00:00:00.000Z") } as unknown as AuditLog);
  assert.deepEqual(projected.requestSummary, { redacted: true, count: 2, filterCategories: ["status", "q"] });
  assert.equal(projected.path, "[REDACTED]");
  assert.doesNotMatch(JSON.stringify(projected), /secret-name|leak|evil/);
});

test("summary keeps net null without refund facts, computes net when refund txs exist, rejects channel attribution", async () => {
  const groups = [
    { status: "paid", currency: "CNY", _count: { _all: 2 }, _sum: { amount: 1980 } },
    { status: "pending", currency: "CNY", _count: { _all: 1 }, _sum: { amount: 990 } },
    { status: "failed", currency: "CNY", _count: { _all: 1 }, _sum: { amount: 500 } },
  ];
  const paidLinks = [
    { amount: 990, currency: "CNY", paymentOrderId: "pay-1" },
    { amount: 990, currency: "CNY", paymentOrderId: "pay-2" },
  ];
  let refundRows: { amountMinor: bigint; currency: string }[] = [];
  const prisma = { async $transaction(work: (tx: {
    mbtiOrder: { groupBy: () => Promise<typeof groups>; findMany: () => Promise<typeof paidLinks> };
    paymentTransaction: { findMany: () => Promise<typeof refundRows> };
  }) => Promise<unknown>) {
    return work({
      mbtiOrder: { async groupBy() { return groups; }, async findMany() { return paidLinks; } },
      paymentTransaction: { async findMany() { return refundRows; } },
    });
  } } as unknown as PrismaService;
  const service = new MbtiOpsOrdersService(prisma, {} as MbtiOrdersService);
  const blocked = await service.summary({ from: "2026-11-01", to: "2026-11-10", channel: "wechat" }) as { metrics: null; unavailableReason: string; netCollectedFen: null };
  assert.equal(blocked.metrics, null);
  assert.equal(blocked.unavailableReason, "channel_attribution_unavailable");
  assert.equal(blocked.netCollectedFen, null);
  const all = await service.summary({ from: "2026-11-01", to: "2026-11-10", channel: "all" }) as {
    metrics: { pending: number; paid: number; failed: number; paidOrderCount: number; grossPaidAmountFen: number; currency: string };
    refundsUnavailable: true; netCollectedFen: null; interval: { boundaryTimezone: string; displayTimezone: string; dateBasis: string };
  };
  assert.equal(all.refundsUnavailable, true);
  assert.equal(all.netCollectedFen, null);
  assert.equal(all.interval.boundaryTimezone, "UTC");
  assert.equal(all.interval.displayTimezone, "Asia/Shanghai");
  assert.equal(all.interval.dateBasis, "order_created_at");
  assert.deepEqual(all.metrics, { pending: 1, paid: 2, failed: 1, paidOrderCount: 2, grossPaidAmountFen: 1980, currency: "CNY",
    grossPaidByCurrency: [{ currency: "CNY", amountFen: 1980, paidOrderCount: 2 }] });
  refundRows = [{ amountMinor: 180n, currency: "CNY" }];
  const withNet = await service.summary({ from: "2026-11-01", to: "2026-11-10", channel: "all" }) as {
    netCollectedFen: number; refundsUnavailable: false;
  };
  assert.equal(withNet.refundsUnavailable, false);
  assert.equal(withNet.netCollectedFen, 1800);
  assert.deepEqual(orderWhere(parseOrderQuery({ from: "2026-11-01", to: "2026-11-01" })), {
    AND: [{ createdAt: { gte: new Date("2026-11-01T00:00:00.000Z"), lt: new Date("2026-11-02T00:00:00.000Z") } }],
  });
  assert.equal(fingerprint({ status: "paid" }), parseOrderQuery({ status: "paid" }).fingerprint);
});

test("export refuses unbounded result sets before returning a partial CSV", async () => {
  const tooMany = Array.from({ length: OPS_EXPORT_MAX + 1 }, (_, i) => row(`MBTI-${i}`, "paid", 1, "2026-11-01T00:00:00.000Z"));
  const prisma = { async $transaction(work: (tx: { mbtiOrder: { findMany: () => Promise<typeof tooMany> }; auditLog: { create: () => Promise<unknown> } }) => Promise<unknown>) {
    return work({ mbtiOrder: { async findMany() { return tooMany; } }, auditLog: { async create() { throw new Error("must not audit partial export"); } } });
  } } as unknown as PrismaService;
  const orders = { payload(value: ReturnType<typeof row>) { return { id: value.id }; } } as unknown as MbtiOrdersService;
  await assert.rejects(new MbtiOpsOrdersService(prisma, orders).exportCsv("admin-1", {}), code("EXPORT_TOO_LARGE"));
});
