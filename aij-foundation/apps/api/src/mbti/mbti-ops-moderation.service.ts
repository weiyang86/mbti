import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { grants } from "../../../../scripts/mbti/ops-policy.cjs";
import { ManagementAccessService } from "../rbac/management-access.service";
import { PrismaService } from "../prisma/prisma.service";
import { reject } from "./mbti.http";
import { object } from "./mbti.service";

const KINDS = new Set(["report", "block_appeal"]);
const SUBJECTS = new Set(["card", "user"]);
const REASONS = new Set(["false_profile", "unwanted_contact", "inappropriate", "other"]);
const DECISIONS = new Set(["restrict", "dismiss"]);

@Injectable()
export class MbtiOpsModerationService {
  constructor(private readonly prisma: PrismaService, private readonly access: ManagementAccessService) {}

  private public(row: {
    id: string; kind: string; subjectType: string; subjectRef: string; reasonCode: string; status: string;
    decision: string | null; note: string | null; createdAt: Date; closedAt: Date | null; closedByUserId: string | null;
  }) {
    return {
      schema: "mbti-ops-moderation-case-candidate/v1",
      status: "needs_human_review" as const,
      id: row.id,
      kind: row.kind,
      subject_type: row.subjectType,
      subject_ref: row.subjectRef,
      reason_code: row.reasonCode,
      case_status: row.status,
      decision: row.decision,
      note: row.note,
      created_at: row.createdAt.toISOString(),
      ...(row.closedAt ? { closed_at: row.closedAt.toISOString() } : {}),
      ...(row.closedByUserId ? { closed_by: row.closedByUserId } : {}),
    };
  }

  async list(query: unknown) {
    const body = query && typeof query === "object" && !Array.isArray(query) ? query as Record<string, unknown> : {};
    if (Object.keys(body).some(k => !["case_status", "kind", "limit"].includes(k))) {
      reject(422, "INVALID_MODERATION_QUERY", "工单列表仅接受 case_status、kind、limit");
    }
    const caseStatus = body.case_status === undefined ? undefined : body.case_status;
    if (caseStatus !== undefined && caseStatus !== "open" && caseStatus !== "closed") {
      reject(422, "INVALID_MODERATION_QUERY", "case_status 仅支持 open/closed");
    }
    const kind = body.kind === undefined ? undefined : body.kind;
    if (kind !== undefined && (typeof kind !== "string" || !KINDS.has(kind))) {
      reject(422, "INVALID_MODERATION_QUERY", "kind 无效");
    }
    const limit = body.limit === undefined ? 20 : typeof body.limit === "string" && /^[1-9][0-9]{0,1}$/.test(body.limit) ? Number(body.limit) : 0;
    if (limit < 1 || limit > 50) reject(422, "INVALID_MODERATION_QUERY", "每页数量应为 1–50");
    const rows = await this.prisma.mbtiModerationCase.findMany({
      where: { ...(caseStatus ? { status: caseStatus } : {}), ...(kind ? { kind } : {}) },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit,
    });
    return { schema: "mbti-ops-moderation-case-candidate/v1", status: "needs_human_review", items: rows.map(row => this.public(row)) };
  }

  async intake(input: unknown, operatorId: string, correlationId?: string) {
    const body = object(input);
    const allowed = ["kind", "subject_type", "subject_ref", "reason_code"];
    if (Object.keys(body).some(k => !allowed.includes(k)) || typeof body.kind !== "string" || !KINDS.has(body.kind) ||
      typeof body.subject_type !== "string" || !SUBJECTS.has(body.subject_type) ||
      typeof body.subject_ref !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(body.subject_ref) ||
      typeof body.reason_code !== "string" || !REASONS.has(body.reason_code)) {
      reject(422, "INVALID_MODERATION_INTAKE", "工单字段不完整或枚举无效");
    }
    return this.access.write(operatorId, [grants.moderation], async (tx, actor) => {
      const row = await tx.mbtiModerationCase.create({
        data: {
          id: "MOD-" + randomUUID(), kind: body.kind as string, subjectType: body.subject_type as string,
          subjectRef: body.subject_ref as string, reasonCode: body.reason_code as string, status: "open",
        },
      });
      await this.access.audit(tx, actor.id, row.id, "mbti_moderation_case_opened", "mbti", "mbti_moderation_case", correlationId,
        ["kind", "subjectType", "reasonCode"]);
      return this.public(row);
    });
  }

  async dispose(id: string, input: unknown, operatorId: string, correlationId?: string) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id)) reject(404, "NOT_FOUND", "资源不存在");
    const body = object(input);
    if (Object.keys(body).some(k => !["decision", "note"].includes(k)) || typeof body.decision !== "string" || !DECISIONS.has(body.decision)) {
      reject(422, "INVALID_MODERATION_DISPOSE", "须提供 decision=restrict|dismiss");
    }
    const note = body.note === undefined ? null : body.note;
    if (note !== null && (typeof note !== "string" || note.trim().length > 100)) {
      reject(422, "INVALID_MODERATION_DISPOSE", "note 最长 100 字");
    }
    return this.access.write(operatorId, [grants.moderation], async (tx, actor) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"mbti-moderation-dispose:" + id}, 0))`;
      const row = await tx.mbtiModerationCase.findUnique({ where: { id } });
      if (!row) reject(404, "NOT_FOUND", "资源不存在");
      if (row.status === "closed") {
        if (row.decision === body.decision && (row.note ?? null) === (typeof note === "string" ? note.trim() || null : null)) return this.public(row);
        reject(409, "MODERATION_ALREADY_CLOSED", "工单已关闭且结论不同");
      }
      const next = await tx.mbtiModerationCase.update({
        where: { id },
        data: {
          status: "closed", decision: body.decision as string,
          note: typeof note === "string" ? note.trim() || null : null,
          closedAt: new Date(), closedByUserId: actor.id,
        },
      });
      await this.access.audit(tx, actor.id, id, "mbti_moderation_case_closed", "mbti", "mbti_moderation_case", correlationId, ["decision"]);
      return this.public(next);
    });
  }
}
