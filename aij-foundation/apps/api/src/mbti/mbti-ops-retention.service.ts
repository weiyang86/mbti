import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { reject } from "./mbti.http";

const DAY = 86_400_000;

/** Mature cohort candidate from MbtiResult only. Rates stay null when sample immature or empty. */
@Injectable()
export class MbtiOpsRetentionService {
  constructor(private readonly prisma: PrismaService) {}

  async cohorts(query: unknown) {
    const body = query && typeof query === "object" && !Array.isArray(query) ? query as Record<string, unknown> : {};
    if (Object.keys(body).some(k => k !== "as_of") || (body.as_of !== undefined && (typeof body.as_of !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.as_of)))) {
      reject(422, "INVALID_RETENTION_QUERY", "as_of 须为 YYYY-MM-DD 或不传");
    }
    const asOf = typeof body.as_of === "string" ? body.as_of : new Date().toISOString().slice(0, 10);
    const asOfMs = Date.parse(`${asOf}T00:00:00.000Z`);
    if (!Number.isFinite(asOfMs)) reject(422, "INVALID_RETENTION_QUERY", "as_of 无效");
    const results = await this.prisma.mbtiResult.findMany({
      select: { ownerId: true, submittedAt: true, bankVersion: true },
      orderBy: [{ ownerId: "asc" }, { submittedAt: "asc" }],
      take: 5000,
    });
    const firstByOwner = new Map<string, { submittedAt: Date; bankVersion: string }>();
    for (const row of results) {
      if (!firstByOwner.has(row.ownerId)) firstByOwner.set(row.ownerId, { submittedAt: row.submittedAt, bankVersion: row.bankVersion });
    }
    let eligible = 0, retakeSameBank = 0;
    for (const [ownerId, first] of firstByOwner) {
      const ageDays = Math.floor((asOfMs - first.submittedAt.getTime()) / DAY);
      if (ageDays < 45) continue;
      eligible += 1;
      const later = results.filter(row => row.ownerId === ownerId && row.submittedAt.getTime() > first.submittedAt.getTime());
      const sameDay = later.some(row => row.submittedAt.toISOString().slice(0, 10) === first.submittedAt.toISOString().slice(0, 10));
      if (sameDay) continue;
      const retake = later.find(row => row.bankVersion === first.bankVersion &&
        Math.floor((row.submittedAt.getTime() - first.submittedAt.getTime()) / DAY) >= 28 &&
        Math.floor((row.submittedAt.getTime() - first.submittedAt.getTime()) / DAY) <= 45);
      if (retake) retakeSameBank += 1;
    }
    return {
      schema: "mbti-ops-retention-cohort-candidate/v1",
      status: "needs_human_review",
      as_of: asOf,
      mature_window_days: 45,
      retake_window_days: { min: 28, max: 45 },
      eligible_first_tests: eligible,
      same_bank_retakes: retakeSameBank,
      retake_rate: eligible === 0 ? null : Number((retakeSameBank / eligible).toFixed(4)),
      channel_attribution_unavailable: true,
      note: "按 owner 首测 submittedAt；渠道时间归属不可得；样本上限 5000 条扫描",
    };
  }
}
