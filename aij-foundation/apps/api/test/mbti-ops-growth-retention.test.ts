import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { MbtiOpsGrowthService } from "../src/mbti/mbti-ops-growth.service";
import { MbtiOpsRetentionService } from "../src/mbti/mbti-ops-retention.service";
import { PrismaService } from "../src/prisma/prisma.service";

function code(value: string) {
  return (error: unknown) => (error as { getResponse(): { code: string } }).getResponse().code === value;
}

test("growth summary stays unavailable when event ledger is empty", async () => {
  const prisma = {
    mbtiGrowthEvent: {
      async count() { return 0; },
      async groupBy() { throw new Error("must not aggregate empty ledger"); },
    },
  } as unknown as PrismaService;
  const service = new MbtiOpsGrowthService(prisma);
  await assert.rejects(service.summary({ from: "2026-11-01" }), code("INVALID_GROWTH_QUERY"));
  const empty = await service.summary({ from: "2026-11-01", to: "2026-11-10", channel: "all" });
  assert.equal(empty.metrics, null);
  assert.equal(empty.unavailableReason, "growth_events_unavailable");
});

test("retention cohorts keep null rate when no mature first tests", async () => {
  const prisma = {
    mbtiResult: {
      async findMany() {
        return [{
          ownerId: "g1", submittedAt: new Date("2026-11-01T00:00:00.000Z"), bankVersion: "v1",
        }];
      },
    },
  } as unknown as PrismaService;
  const service = new MbtiOpsRetentionService(prisma);
  const young = await service.cohorts({ as_of: "2026-11-10" });
  assert.equal(young.eligible_first_tests, 0);
  assert.equal(young.retake_rate, null);
  assert.equal(young.channel_attribution_unavailable, true);
});
