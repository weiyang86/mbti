import { Injectable } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import { MbtiAnswer, MbtiQuizSession, MbtiResult, Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { reject } from "./mbti.http";
import { TYPE_METAS } from "./mbti.types";

export const CURRENT_BANK = "qb-v0.4-prototype-1";
type Answer = { question_id: string; option_id: string };
type Bank = { question_bank_version: string; questions: { id: string; index: number; dimension: string; options: { id: string }[] }[] };
type Scoring = Record<string, Record<string, string>>;
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) reject(422, "INVALID_INPUT", "请求必须是 JSON 对象");
  return value as Record<string, unknown>;
}
function label(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length > 120) reject(422, "INVALID_INPUT", "背景标签长度不能超过120字符");
  return value;
}

@Injectable()
export class MbtiService {
  constructor(private readonly prisma: PrismaService) {}

  async guest() {
    const token = randomBytes(48).toString("base64url");
    const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
    await this.prisma.mbtiGuest.create({ data: { tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt } });
    return { guest_token: token, expires_at: expiresAt.toISOString() };
  }
  async currentBank() {
    const bank = await this.prisma.mbtiQuestionBank.findUnique({ where: { version: CURRENT_BANK } });
    if (!bank) reject(503, "QUESTION_BANK_UNAVAILABLE", "题库尚未就绪");
    return bank.payload;
  }
  async createSession(ownerId: string, input: unknown) {
    const body = object(input ?? {});
    const version = body.question_bank_version ?? CURRENT_BANK;
    if (typeof version !== "string" || !await this.prisma.mbtiQuestionBank.findUnique({ where: { version } })) reject(422, "UNKNOWN_QUESTION_BANK", "题库版本不可用，请重新获取题库");
    return this.sessionPayload(await this.prisma.mbtiQuizSession.create({ data: { ownerId, bankVersion: version }, include: { answers: true } }));
  }
  private sessionPayload(session: MbtiQuizSession & { answers: MbtiAnswer[] }) {
    return { id: session.id, question_bank_version: session.bankVersion, status: session.status,
      answers: [...session.answers].sort((a, b) => Number(a.questionId.slice(1)) - Number(b.questionId.slice(1))).map(a => ({ question_id: a.questionId, option_id: a.optionId })),
      created_at: session.createdAt.toISOString(), updated_at: session.updatedAt.toISOString() };
  }
  private async lock(tx: Prisma.TransactionClient, ownerId: string, id: string) {
    const rows = await tx.$queryRaw<MbtiQuizSession[]>`SELECT * FROM "MbtiQuizSession" WHERE "id" = ${id} AND "ownerId" = ${ownerId} FOR UPDATE`;
    const session = rows[0];
    if (!session) reject(404, "NOT_FOUND", "资源不存在");
    if (session.status !== "in_progress") reject(409, "SESSION_SUBMITTED", "会话已提交");
    return session;
  }
  async saveAnswers(ownerId: string, id: string, input: unknown) {
    // Ownership and terminal state are checked before examining answer content.
    return this.prisma.$transaction(async tx => {
      const session = await this.lock(tx, ownerId, id);
      const body = object(input);
      if (!Array.isArray(body.answers) || body.answers.length > 12) reject(422, "INVALID_ANSWERS", "答案必须是最多12项的数组");
      const bank = await tx.mbtiQuestionBank.findUniqueOrThrow({ where: { version: session.bankVersion } });
      const scoring = bank.scoring as Scoring;
      const seen = new Set<string>();
      const answers = body.answers.map(value => {
        const row = object(value);
        if (typeof row.question_id !== "string" || typeof row.option_id !== "string" ||
          !Object.hasOwn(scoring, row.question_id) || !Object.hasOwn(scoring[row.question_id], row.option_id) || seen.has(row.question_id)) reject(422, "INVALID_ANSWERS", "题目、选项或重复题目无效");
        seen.add(row.question_id);
        return row as Answer;
      });
      for (const answer of answers) await tx.mbtiAnswer.upsert({
        where: { sessionId_questionId: { sessionId: id, questionId: answer.question_id } },
        create: { sessionId: id, questionId: answer.question_id, optionId: answer.option_id }, update: { optionId: answer.option_id }
      });
      return this.sessionPayload(await tx.mbtiQuizSession.update({ where: { id }, data: { updatedAt: new Date() }, include: { answers: true } }));
    });
  }
  async submit(ownerId: string, id: string, input: unknown) {
    return this.prisma.$transaction(async tx => {
      const session = await this.lock(tx, ownerId, id);
      const body = object(input ?? {});
      const bankRow = await tx.mbtiQuestionBank.findUniqueOrThrow({ where: { version: session.bankVersion } });
      const bank = bankRow.payload as Bank;
      const scoring = bankRow.scoring as Scoring;
      const answers = await tx.mbtiAnswer.findMany({ where: { sessionId: id } });
      if (answers.length !== bank.questions.length || bank.questions.some(q => !answers.some(a => a.questionId === q.id))) reject(422, "INCOMPLETE_ANSWERS", "请答完所有题目后提交");
      const counts: Record<string, number> = { E: 0, I: 0, S: 0, N: 0, T: 0, F: 0, J: 0, P: 0 };
      for (const answer of answers) {
        const letter = scoring[answer.questionId]?.[answer.optionId];
        if (!letter || !Object.hasOwn(counts, letter)) reject(422, "INVALID_ANSWERS", "已保存答案不属于此题库");
        counts[letter]++;
      }
      const typeCode = ["EI", "SN", "TF", "JP"].map(pair => counts[pair[0]] > counts[pair[1]] ? pair[0] : pair[1]).join("");
      const result = await tx.mbtiResult.create({ data: { ownerId, sessionId: id, source: "quiz", bankVersion: session.bankVersion,
        typeCode, dimensionCounts: counts, lifeStage: label(body.life_stage), recentStatus: label(body.recent_status) } });
      await tx.mbtiQuizSession.update({ where: { id }, data: { status: "submitted" } });
      return this.resultPayload(result);
    });
  }
  resultPayload(result: MbtiResult) {
    return { id: result.id, source: result.source, type_code: result.typeCode, question_bank_version: result.bankVersion,
      submitted_at: result.submittedAt.toISOString(), ...(result.sessionId ? { session_id: result.sessionId } : {}),
      ...(result.dimensionCounts ? { dimension_counts: result.dimensionCounts } : {}),
      ...(result.lifeStage !== null ? { life_stage: result.lifeStage } : {}), ...(result.recentStatus !== null ? { recent_status: result.recentStatus } : {}) };
  }
  async result(ownerId: string, id: string) {
    const row = await this.prisma.mbtiResult.findFirst({ where: { id, ownerId } });
    if (!row) reject(404, "NOT_FOUND", "资源不存在");
    return this.resultPayload(row);
  }
  types() { return { items: TYPE_METAS }; }
  async selfSelect(ownerId: string, input: unknown) {
    const body = object(input);
    if (body.source !== "self_select" || !TYPE_METAS.some(meta => meta.type_code === body.type_code)) reject(422, "INVALID_SELF_SELECT", "请选择有效的自选类型与来源");
    // Project only explicit input fields. A caller cannot inject session IDs, versions or counts.
    return this.resultPayload(await this.prisma.mbtiResult.create({ data: {
      ownerId, source: "self_select", typeCode: body.type_code as string, bankVersion: "self-select-v1",
      lifeStage: label(body.life_stage), recentStatus: label(body.recent_status)
    } }));
  }
  async deleteResult(ownerId: string, id: string) {
    const removed = await this.prisma.mbtiResult.deleteMany({ where: { id, ownerId } });
    if (!removed.count) reject(404, "NOT_FOUND", "资源不存在");
  }
  async compare(ownerId: string, baselineId: unknown, targetId: unknown) {
    if (typeof baselineId !== "string" || !baselineId || typeof targetId !== "string" || !targetId) reject(422, "INVALID_COMPARISON", "请选择两条结果");
    const rows = await this.prisma.mbtiResult.findMany({ where: { ownerId, id: { in: [baselineId, targetId] } } });
    const baseline = rows.find(row => row.id === baselineId), target = rows.find(row => row.id === targetId);
    // Never reveal comparability until BOTH snapshots have passed ownership checks.
    if (!baseline || !target) reject(404, "NOT_FOUND", "资源不存在");
    if (baseline.source !== "quiz" || target.source !== "quiz" || baseline.bankVersion !== target.bankVersion || !baseline.dimensionCounts || !target.dimensionCounts) reject(422, "INCOMPARABLE_RESULTS", "仅可对比同一题库版本的测评结果");
    const before = baseline.dimensionCounts as Record<string, number>, after = target.dimensionCounts as Record<string, number>;
    return { baseline_id: baselineId, target_id: targetId, question_bank_version: baseline.bankVersion,
      type_changed: baseline.typeCode !== target.typeCode, baseline_type_code: baseline.typeCode, target_type_code: target.typeCode,
      dimension_deltas: Object.fromEntries("EISNTFJP".split("").map(letter => [letter, after[letter] - before[letter]])) };
  }
  async results(ownerId: string, limitInput?: string, cursor?: string) {
    if (limitInput !== undefined && typeof limitInput !== "string" || cursor !== undefined && (typeof cursor !== "string" || cursor.length > 200)) reject(422, "INVALID_PAGINATION", "分页参数无效");
    const limit = limitInput === undefined ? 20 : Number(limitInput);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || limitInput !== undefined && !/^\d+$/.test(limitInput)) reject(422, "INVALID_LIMIT", "limit 必须为1到100的整数");
    let boundary: MbtiResult | null = null;
    if (cursor !== undefined) {
      boundary = await this.prisma.mbtiResult.findFirst({ where: { id: cursor, ownerId } });
      if (!boundary) reject(422, "INVALID_CURSOR", "分页游标无效");
    }
    const rows = await this.prisma.mbtiResult.findMany({ where: { ownerId, ...(boundary ? { OR: [
      { submittedAt: { lt: boundary.submittedAt } }, { submittedAt: boundary.submittedAt, id: { lt: boundary.id } }
    ] } : {}) }, orderBy: [{ submittedAt: "desc" }, { id: "desc" }], take: limit + 1 });
    return { items: rows.slice(0, limit).map(row => {
      const data = this.resultPayload(row);
      return { id: data.id, source: data.source, type_code: data.type_code, question_bank_version: data.question_bank_version,
        submitted_at: data.submitted_at, ...(data.life_stage !== undefined ? { life_stage: data.life_stage } : {}) };
    }), next_cursor: rows.length > limit ? rows[limit - 1].id : null };
  }
}
