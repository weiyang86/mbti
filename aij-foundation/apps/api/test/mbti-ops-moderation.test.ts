import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { grants } from "../../../scripts/mbti/ops-policy.cjs";
import { MbtiOpsModerationService } from "../src/mbti/mbti-ops-moderation.service";
import { ManagementAccessService } from "../src/rbac/management-access.service";
import { PrismaService } from "../src/prisma/prisma.service";

function code(value: string) {
  return (error: unknown) => (error as { getResponse(): { code: string } }).getResponse().code === value;
}

test("moderation list rejects unsafe filters and never exposes contact fields", async () => {
  const rows = [{
    id: "MOD-1", kind: "report", subjectType: "card", subjectRef: "CARD-1", reasonCode: "inappropriate",
    status: "open", decision: null, note: null, createdAt: new Date("2026-11-10T00:00:00.000Z"),
    closedAt: null, closedByUserId: null,
  }];
  const prisma = { mbtiModerationCase: { async findMany() { return rows; } } } as unknown as PrismaService;
  const service = new MbtiOpsModerationService(prisma, {} as ManagementAccessService);
  await assert.rejects(service.list({ case_status: "pending" }), code("INVALID_MODERATION_QUERY"));
  const page = await service.list({ case_status: "open", limit: "10" });
  assert.equal(page.items.length, 1);
  assert.doesNotMatch(JSON.stringify(page), /phone|wechat|location|answer|contact/i);
});

test("moderation dispose closes open cases idempotently for same decision", async () => {
  let closed = false;
  const access = {
    async write(_id: string, required: string[], work: (tx: object, actor: { id: string }) => Promise<unknown>) {
      assert.deepEqual(required, [grants.moderation]);
      const open = {
        id: "MOD-1", kind: "report", subjectType: "card", subjectRef: "CARD-1", reasonCode: "other",
        status: "open", decision: null, note: null, createdAt: new Date(), closedAt: null, closedByUserId: null,
      };
      const tx = {
        mbtiModerationCase: {
          async findUnique() {
            return closed
              ? { ...open, status: "closed", decision: "dismiss", note: null, closedAt: new Date(), closedByUserId: "admin-1" }
              : open;
          },
          async update({ data }: { data: Record<string, unknown> }) {
            closed = true;
            return { ...open, ...data };
          },
        },
        async $executeRaw() { return undefined; },
      };
      return work(tx, { id: "admin-1" });
    },
    async audit() { return undefined; },
  } as unknown as ManagementAccessService;
  const service = new MbtiOpsModerationService({} as PrismaService, access);
  const first = await service.dispose("MOD-1", { decision: "dismiss" }, "admin-1");
  assert.equal(first.case_status, "closed");
  const second = await service.dispose("MOD-1", { decision: "dismiss" }, "admin-1");
  assert.equal(second.case_status, "closed");
  await assert.rejects(service.dispose("MOD-1", { decision: "restrict" }, "admin-1"), code("MODERATION_ALREADY_CLOSED"));
});
