import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { grants } from "../../../scripts/mbti/ops-policy.cjs";
import { MbtiOpsGenerationService } from "../src/mbti/mbti-ops-generation.service";
import { ManagementAccessService } from "../src/rbac/management-access.service";
import { PrismaService } from "../src/prisma/prisma.service";

function code(value: string) {
  return (error: unknown) => (error as { getResponse(): { code: string } }).getResponse().code === value;
}

test("generation list rejects unsafe filters and never treats unlocked as delivery", async () => {
  const rows = [{
    id: "JOB-1", orderId: "MBTI-1", recipe: "balanced", status: "failed", attempt: 1,
    lastErrorClass: "provider_timeout", createdAt: new Date("2026-11-10T00:00:00.000Z"), updatedAt: new Date("2026-11-10T01:00:00.000Z"),
  }];
  const prisma = { mbtiGenerationJob: { async findMany() { return rows; } } } as unknown as PrismaService;
  const service = new MbtiOpsGenerationService(prisma, {} as ManagementAccessService);
  await assert.rejects(service.list({ status: "unknown" }), code("INVALID_GENERATION_QUERY"));
  const page = await service.list({ status: "failed", limit: "10" });
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0].unlocked_is_not_delivery, true);
  assert.equal(page.items[0].job_status, "failed");
});

test("generation enqueue requires paid entitlement; retry only failed with idempotency", async () => {
  const access = {
    async write(_id: string, required: string[], work: (tx: object, actor: { id: string }) => Promise<unknown>) {
      assert.ok(required.includes(grants.fulfillment) || required.includes(grants.generationRetry));
      const tx = {
        mbtiOrder: {
          async findUnique() {
            return required.includes(grants.fulfillment)
              ? { id: "MBTI-1", status: "paid", entitlement: { id: "ent-1" } }
              : null;
          },
        },
        mbtiGenerationJob: {
          async create({ data }: { data: Record<string, unknown> }) {
            return { ...data, createdAt: new Date(), updatedAt: new Date(), lastErrorClass: null };
          },
          async findUnique() {
            return {
              id: "JOB-1", orderId: "MBTI-1", recipe: "balanced", status: "failed", attempt: 1,
              lastErrorClass: "x", createdAt: new Date(), updatedAt: new Date(),
            };
          },
          async update({ data }: { data: Record<string, unknown> }) {
            return {
              id: "JOB-1", orderId: "MBTI-1", recipe: "balanced", status: data.status, attempt: data.attempt,
              lastErrorClass: null, createdAt: new Date(), updatedAt: new Date(),
            };
          },
        },
        auditLog: {
          async findMany() { return []; },
          async create() { return {}; },
        },
        async $executeRaw() { return undefined; },
      };
      return work(tx, { id: "admin-1" });
    },
    async audit() { return undefined; },
  } as unknown as ManagementAccessService;
  const service = new MbtiOpsGenerationService({} as PrismaService, access);
  const job = await service.enqueue({ order_id: "MBTI-1", recipe: "portrait" }, "admin-1", "corr");
  assert.equal(job.recipe, "portrait");
  assert.equal(job.job_status, "queued");
  const retried = await service.retry("JOB-1", { idempotency_key: "k".repeat(16) }, "admin-1", "corr");
  assert.equal(retried.job_status, "queued");
  assert.equal(retried.attempt, 2);
});
