import "reflect-metadata";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { PAYMENT_REFUND_REQUEST } from "../../../scripts/payment-admin-policy.cjs";
import { MbtiOpsRefundService } from "../src/mbti/mbti-ops-refund.service";
import { MbtiOrdersService } from "../src/mbti/mbti-orders.service";
import { ManagementAccessService } from "../src/rbac/management-access.service";
import { PluginRuntimeAccessService } from "../src/plugin-runtime/plugin-runtime-access.service";
import { PrismaService } from "../src/prisma/prisma.service";

const ORDER_ID = "MBTI-00000000-0000-4000-8000-000000000099";
const PAYMENT_ID = "pay-order-1";
const CHARGE_ID = "charge-1";
function code(value: string) {
  return (error: unknown) => (error as { getResponse(): { code: string } }).getResponse().code === value;
}
function status(n: number) {
  return (error: unknown) => (error as { getStatus(): number }).getStatus() === n;
}

test("refund request rejects unpaid or unbound orders and invalid bodies", async () => {
  const prisma = {
    mbtiOrder: {
      async findUnique() { return { id: ORDER_ID, status: "pending", amount: 990, paymentOrderId: null }; },
    },
  } as unknown as PrismaService;
  const orders = { async sync() {} } as unknown as MbtiOrdersService;
  const access = { write() { throw new Error("must not write"); }, audit() {} } as unknown as ManagementAccessService;
  const plugins = {} as PluginRuntimeAccessService;
  const service = new MbtiOpsRefundService(prisma, orders, access, plugins);
  await assert.rejects(service.create(ORDER_ID, { reason: "x", idempotency_key: "k".repeat(16) }, "admin-1"), code("REFUND_UNAVAILABLE"));
  await assert.rejects(service.create(ORDER_ID, { reason: "", idempotency_key: "k".repeat(16) }, "admin-1"), code("INVALID_REFUND_REQUEST"));
  await assert.rejects(service.create(ORDER_ID, { reason: "客服补偿", idempotency_key: "short" }, "admin-1"), code("INVALID_REFUND_REQUEST"));
  await assert.rejects(service.create(ORDER_ID, { reason: "客服补偿", idempotency_key: "k".repeat(16), amount_fen: 0 }, "admin-1"), code("INVALID_REFUND_REQUEST"));
  await assert.rejects(service.create("bad/id", { reason: "客服补偿", idempotency_key: "k".repeat(16) }, "admin-1"), code("NOT_FOUND"));
});

test("refund request creates pending_manual_review via AF-106 table without revoking entitlement", async () => {
  const audits: unknown[] = [];
  const refunds: unknown[] = [];
  const order = { id: ORDER_ID, status: "paid", amount: 990, paymentOrderId: PAYMENT_ID, currency: "CNY" };
  const payment = {
    id: PAYMENT_ID, projectId: "project-test", status: "succeeded", deletedAt: null, currencyExponent: 2,
    payableOwner: "mbti-controlled-test", payableReference: ORDER_ID,
    transactions: [{ id: CHARGE_ID, kind: "charge", amountMinor: 990n, currency: "CNY ", recordedAt: new Date() }],
    refundRequests: [] as { amountMinor: bigint }[],
  };
  const prisma = {
    mbtiOrder: { async findUnique() { return order; } },
  } as unknown as PrismaService;
  const orders = { async sync() {} } as unknown as MbtiOrdersService;
  const access = {
    async write(_id: string, required: string[], work: (tx: object, actor: { id: string }) => Promise<unknown>) {
      assert.deepEqual(required, [PAYMENT_REFUND_REQUEST]);
      const tx = {
        async $executeRaw() { return 1; },
        paymentRefundRequest: {
          async findUnique() { return null; },
          async create({ data }: { data: Record<string, unknown> }) {
            const row = { id: "refund-1", createdAt: new Date("2026-11-10T00:00:00.000Z"), ...data };
            refunds.push(row); return row;
          },
        },
        paymentOrder: { async findFirst() { return payment; } },
        auditLog: { async create({ data }: { data: unknown }) { audits.push(data); return data; } },
      };
      return work(tx, { id: "admin-1" });
    },
    async audit(tx: { auditLog: { create(q: { data: unknown }): Promise<unknown> } }, operatorId: string, id: string, action: string, module: string, resourceType: string, correlationId?: string, fields: string[] = []) {
      return tx.auditLog.create({ data: { module, action, userId: operatorId, resourceType, resourceId: id, requestSummary: { correlationId, fields } } });
    },
  } as unknown as ManagementAccessService;
  const plugins = { async projectId() { return "project-test"; } } as unknown as PluginRuntimeAccessService;
  const service = new MbtiOpsRefundService(prisma, orders, access, plugins);
  const result = await service.create(ORDER_ID, { reason: "客服补偿", idempotency_key: "idempotency-key-01" }, "admin-1", "corr-1");
  assert.equal(result.schema, "mbti-ops-refund-request-candidate/v1");
  assert.equal(result.status, "needs_human_review");
  assert.equal(result.order_id, ORDER_ID);
  assert.equal(result.payment_order_id, PAYMENT_ID);
  assert.equal(result.amount_fen, 990);
  assert.equal(result.refund_status, "pending_manual_review");
  assert.equal(result.entitlement_revoked, false);
  assert.equal(refunds.length, 1);
  assert.equal((refunds[0] as { status: string }).status, "pending_manual_review");
  assert.equal(audits.length, 1);
  assert.equal((audits[0] as { action: string }).action, "mbti_refund_requested");
  assert.doesNotMatch(JSON.stringify(result), /idempotency|SecretRef|provider/);
});

test("refund request replays identical idempotency and rejects fingerprint conflicts", async () => {
  const key = "idempotency-key-replay";
  const keyHash = createHash("sha256").update(key).digest("hex");
  const fingerprint = createHash("sha256").update(JSON.stringify(["project-test", PAYMENT_ID, "990", "客服补偿"])).digest("hex");
  const existing = {
    id: "refund-existing", paymentOrderId: PAYMENT_ID, amountMinor: 990n, currency: "CNY", reason: "客服补偿",
    status: "pending_manual_review", createdAt: new Date("2026-11-10T00:00:00.000Z"),
    requestFingerprint: fingerprint, idempotencyKeyHash: keyHash,
  };
  const order = { id: ORDER_ID, status: "paid", amount: 990, paymentOrderId: PAYMENT_ID };
  const prisma = { mbtiOrder: { async findUnique() { return order; } } } as unknown as PrismaService;
  const orders = { async sync() {} } as unknown as MbtiOrdersService;
  let findCalls = 0;
  const access = {
    async write(_id: string, _required: string[], work: (tx: object, actor: { id: string }) => Promise<unknown>) {
      const tx = {
        async $executeRaw() { return 1; },
        paymentRefundRequest: {
          async findUnique() {
            findCalls += 1;
            return findCalls === 1 ? existing : { ...existing, requestFingerprint: "other" };
          },
          async create() { throw new Error("must not create on replay"); },
        },
        paymentOrder: { async findFirst() { throw new Error("must not load payment on replay"); } },
      };
      return work(tx, { id: "admin-1" });
    },
    audit() {},
  } as unknown as ManagementAccessService;
  const plugins = { async projectId() { return "project-test"; } } as unknown as PluginRuntimeAccessService;
  const service = new MbtiOpsRefundService(prisma, orders, access, plugins);
  const replay = await service.create(ORDER_ID, { reason: "客服补偿", idempotency_key: key }, "admin-1");
  assert.equal(replay.request_id, "refund-existing");
  await assert.rejects(service.create(ORDER_ID, { reason: "另一原因", idempotency_key: key }, "admin-1"), code("IDEMPOTENCY_CONFLICT"));
});

test("refund request rejects payment owner mismatch", async () => {
  const order = { id: ORDER_ID, status: "paid", amount: 990, paymentOrderId: PAYMENT_ID };
  const prisma = { mbtiOrder: { async findUnique() { return order; } } } as unknown as PrismaService;
  const orders = { async sync() {} } as unknown as MbtiOrdersService;
  const access = {
    async write(_id: string, _required: string[], work: (tx: object, actor: { id: string }) => Promise<unknown>) {
      const tx = {
        async $executeRaw() { return 1; },
        paymentRefundRequest: { async findUnique() { return null; }, async create() { throw new Error("no"); } },
        paymentOrder: {
          async findFirst() {
            return {
              id: PAYMENT_ID, status: "succeeded", deletedAt: null, currencyExponent: 2,
              payableOwner: "other", payableReference: ORDER_ID,
              transactions: [{ id: CHARGE_ID, kind: "charge", amountMinor: 990n, currency: "CNY", recordedAt: new Date() }],
              refundRequests: [],
            };
          },
        },
      };
      return work(tx, { id: "admin-1" });
    },
    audit() {},
  } as unknown as ManagementAccessService;
  const plugins = { async projectId() { return "project-test"; } } as unknown as PluginRuntimeAccessService;
  const service = new MbtiOpsRefundService(prisma, orders, access, plugins);
  await assert.rejects(service.create(ORDER_ID, { reason: "客服补偿", idempotency_key: "k".repeat(16) }, "admin-1"), status(409));
});
