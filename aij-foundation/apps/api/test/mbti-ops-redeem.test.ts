import "reflect-metadata";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { grants } from "../../../scripts/mbti/ops-policy.cjs";
import { MbtiOpsRedeemService } from "../src/mbti/mbti-ops-redeem.service";
import { ManagementAccessService } from "../src/rbac/management-access.service";
import { PrismaService } from "../src/prisma/prisma.service";

function code(value: string) {
  return (error: unknown) => (error as { getResponse(): { code: string } }).getResponse().code === value;
}

test("redeem list rejects unsafe filters and never returns plaintext codes", async () => {
  const rows = [{
    id: "RDM-1", productCode: "studio_tier_1", maxRedemptions: 1, redeemedCount: 0, status: "active",
    createdByUserId: "admin-1", createdAt: new Date("2026-11-10T00:00:00.000Z"), disabledAt: null, codeHash: "a".repeat(64),
  }];
  const prisma = {
    mbtiRedeemCode: { async findMany() { return rows; } },
  } as unknown as PrismaService;
  const service = new MbtiOpsRedeemService(prisma, {} as ManagementAccessService);
  await assert.rejects(service.list({ product_code: "unknown" }), code("INVALID_REDEEM_QUERY"));
  await assert.rejects(service.list({ limit: "99" }), code("INVALID_REDEEM_QUERY"));
  const page = await service.list({ product_code: "studio_tier_1", limit: "10" });
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0].product_code, "studio_tier_1");
  assert.equal(Object.hasOwn(page.items[0], "code"), false);
  assert.doesNotMatch(JSON.stringify(page), /codeHash|MBTI[A-Z0-9]{8}/);
});

test("redeem create mints hash-only rows and returns plaintext once", async () => {
  const created: unknown[] = [];
  const audits: unknown[] = [];
  const prisma = {} as PrismaService;
  const access = {
    async write(_id: string, required: string[], work: (tx: object, actor: { id: string }) => Promise<unknown>) {
      assert.deepEqual(required, [grants.redemption]);
      const hashes = new Set<string>();
      const tx = {
        mbtiRedeemCode: {
          async findUnique({ where }: { where: { codeHash: string } }) {
            return hashes.has(where.codeHash) ? { id: "clash" } : null;
          },
          async create({ data }: { data: Record<string, unknown> }) {
            hashes.add(data.codeHash as string);
            const row = { ...data, createdAt: new Date(), disabledAt: null };
            created.push(row); return row;
          },
        },
        auditLog: { async create({ data }: { data: unknown }) { audits.push(data); return data; } },
      };
      return work(tx, { id: "admin-1" });
    },
    async audit(tx: { auditLog: { create(q: { data: unknown }): Promise<unknown> } }, operatorId: string, id: string, action: string, module: string, resourceType: string, correlationId?: string, fields: string[] = []) {
      return tx.auditLog.create({ data: { module, action, userId: operatorId, resourceType, resourceId: id, requestSummary: { correlationId, fields } } });
    },
  } as unknown as ManagementAccessService;
  const service = new MbtiOpsRedeemService(prisma, access);
  await assert.rejects(service.create({ product_code: "studio_tier_2", count: 1 }, "admin-1"), code("INVALID_REDEEM_BATCH"));
  const batch = await service.create({ product_code: "studio_tier_1", count: 2 }, "admin-1", "corr") as {
    codes: { id: string; code: string; product_code: string }[]; note: string;
  };
  assert.equal(batch.codes.length, 2);
  assert.match(batch.codes[0].code, /^MBTI[A-Z2-9]{8}$/);
  assert.equal(created.length, 2);
  assert.equal((created[0] as { codeHash: string }).codeHash, createHash("sha256").update(batch.codes[0].code).digest("hex"));
  assert.doesNotMatch(JSON.stringify(created), new RegExp(batch.codes[0].code));
  assert.equal(audits.length, 1);
  assert.equal((audits[0] as { action: string }).action, "mbti_redeem_codes_created");
});

test("redeem disable is idempotent for already disabled codes", async () => {
  const row = {
    id: "RDM-1", productCode: "studio_tier_1", maxRedemptions: 1, redeemedCount: 0, status: "disabled",
    createdByUserId: "admin-1", createdAt: new Date("2026-11-10T00:00:00.000Z"), disabledAt: new Date("2026-11-10T01:00:00.000Z"), codeHash: "b".repeat(64),
  };
  const access = {
    async write(_id: string, required: string[], work: (tx: object, actor: { id: string }) => Promise<unknown>) {
      assert.deepEqual(required, [grants.redemption]);
      const tx = {
        mbtiRedeemCode: {
          async findUnique() { return row; },
          async update() { throw new Error("must not update disabled"); },
        },
      };
      return work(tx, { id: "admin-1" });
    },
    audit() {},
  } as unknown as ManagementAccessService;
  const service = new MbtiOpsRedeemService({} as PrismaService, access);
  const result = await service.disable("RDM-1", "admin-1");
  assert.equal(result.code_status, "disabled");
  assert.ok(result.disabled_at);
});
