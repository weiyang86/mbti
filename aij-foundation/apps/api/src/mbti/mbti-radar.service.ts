import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { reject } from "./mbti.http";
import { MbtiSocialService } from "./mbti-social.service";
import { TYPE_METAS } from "./mbti.types";

function invalid(): never { return reject(422, "INVALID_RADAR_INPUT", "雷达请求参数无效"); }
function requireType(code: string | undefined) {
  if (!code || !TYPE_METAS.some(item => item.type_code === code)) {
    reject(422, "RADAR_TYPE_REQUIRED", "请先设置本人的 MBTI 类型");
  }
  return code;
}

/** Internal candidate: participation is a choice, never location consent.
 * No location source or approved aggregation policy exists; do not count owners here.
 */
@Injectable()
export class MbtiRadarService {
  constructor(private readonly prisma: PrismaService, private readonly social: MbtiSocialService) {}

  private query(url: string, allowed: readonly string[]) {
    // Inspect the wire query: Express parsers can discard special keys or coerce duplicates.
    const query = new URLSearchParams(url.includes("?") ? url.slice(url.indexOf("?") + 1) : "");
    const result: Record<string, string> = {};
    for (const [key, value] of query) {
      if (!allowed.includes(key) || Object.hasOwn(result, key)) invalid();
      result[key] = value;
    }
    return result;
  }

  async participation(ownerId: string, url: string) {
    this.query(url, []);
    const row = await this.prisma.mbtiRadarParticipation.findUnique({ where: { ownerId }, select: { enrolled: true } });
    return { enrolled: row?.enrolled ?? false };
  }

  async update(ownerId: string, url: string, input: unknown) {
    this.query(url, []);
    if (!input || typeof input !== "object" || Array.isArray(input)) invalid();
    const body = input as Record<string, unknown>;
    if (Object.keys(body).length !== 1 || !Object.hasOwn(body, "enrolled") || typeof body.enrolled !== "boolean") invalid();
    const enrolled = body.enrolled;
    return this.prisma.$transaction(async tx => {
      // Same lock as F4 card updates/F5; type cannot change during an enrollment decision.
      await this.social.lockOwners(tx, ownerId);
      if (enrolled) requireType((await tx.mbtiCard.findUnique({ where: { ownerId }, select: { typeCode: true } }))?.typeCode);
      const existing = await tx.mbtiRadarParticipation.findUnique({ where: { ownerId } });
      const row = existing?.enrolled === enrolled ? existing : await tx.mbtiRadarParticipation.upsert({
        where: { ownerId }, create: { ownerId, enrolled }, update: { enrolled }
      });
      return { enrolled: row.enrolled };
    });
  }

  async sameType(ownerId: string, url: string) {
    const query = this.query(url, ["type_code", "radius_m"]);
    if (query.type_code !== undefined && !TYPE_METAS.some(item => item.type_code === query.type_code)) invalid();
    const radius = query.radius_m ?? "500";
    if (!["500", "1000", "3000"].includes(radius)) invalid();
    return this.prisma.$transaction(async tx => {
      const type = requireType((await tx.mbtiCard.findUnique({ where: { ownerId }, select: { typeCode: true } }))?.typeCode);
      if (query.type_code !== undefined && query.type_code !== type) reject(422, "RADAR_TYPE_MISMATCH", "查询类型与本人名片不一致");
      const participation = await tx.mbtiRadarParticipation.findUnique({ where: { ownerId }, select: { enrolled: true } });
      return { count: null, status: "unavailable" as const,
        reason: participation?.enrolled ? "location_source_not_configured" as const : "not_enrolled" as const };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }
}
