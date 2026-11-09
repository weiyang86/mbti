import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { AiBudgetAdmissionPort, AiBudgetExceededException } from "./ai-provider";

export const AI_EVALUATION_LIMIT_NANOS = 10_000_000_000n;
// Reserve the entire model context at peak/cache-miss prices before each request.
export const DEEPSEEK_INPUT_RESERVATION_TOKENS = 1_048_576;
export type EvaluationBudgetPolicy = Readonly<{
  projectId: string; runKey: string; modelCode: "deepseek-flash"; modelVersion: string;
  priceVersion: "deepseek-flash-2026-11-04"; usdCnyMicros: string;
  maxOutputTokens: number; expiresAt: string;
}>;

@Injectable()
export class AiEvaluationBudgetService extends AiBudgetAdmissionPort {
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) { super(); }

  policy(): EvaluationBudgetPolicy {
    try {
      const p = JSON.parse(this.config.get<string>("AI_EVALUATION_BUDGET_JSON") || "null");
      if (!p || Object.keys(p).sort().join() !== ["projectId", "runKey", "modelCode", "modelVersion", "priceVersion", "usdCnyMicros", "maxOutputTokens", "expiresAt"].sort().join() ||
          typeof p.projectId !== "string" || !/^[a-z0-9_-]{8,128}$/i.test(p.projectId) ||
          typeof p.runKey !== "string" || !/^[a-z0-9_-]{8,128}$/i.test(p.runKey) ||
          p.modelCode !== "deepseek-flash" || p.modelVersion !== "DeepSeek-V4.1-Flash-1017" ||
          p.priceVersion !== "deepseek-flash-2026-11-04" || typeof p.usdCnyMicros !== "string" || !/^[1-9][0-9]{6,8}$/.test(p.usdCnyMicros) || BigInt(p.usdCnyMicros) > 100_000_000n ||
          !Number.isSafeInteger(p.maxOutputTokens) || p.maxOutputTokens < 1 || p.maxOutputTokens > 8192 ||
          typeof p.expiresAt !== "string" || !Number.isFinite(Date.parse(p.expiresAt)) || Date.parse(p.expiresAt) <= Date.now() || Date.parse(p.expiresAt) > Date.now() + 7 * 86400_000) throw new Error();
      return Object.freeze(p);
    } catch { throw new ServiceUnavailableException("AI evaluation budget configuration is unavailable"); }
  }

  estimate(p: EvaluationBudgetPolicy, inputTokens: number, outputTokens: number): bigint {
    if (![inputTokens, outputTokens].every(n => Number.isSafeInteger(n) && n >= 0) || inputTokens > DEEPSEEK_INPUT_RESERVATION_TOKENS || outputTokens > p.maxOutputTokens) {
      throw new ServiceUnavailableException("AI usage exceeds reserved bounds");
    }
    // USD microdollars / million tokens; peak cache-miss input=.30, output=1.20.
    const numerator = (BigInt(inputTokens) * 300_000n + BigInt(outputTokens) * 1_200_000n) * BigInt(p.usdCnyMicros);
    return (numerator + 999_999_999n) / 1_000_000_000n;
  }

  async assertWithinBudget(tx: Prisma.TransactionClient, request: { projectId: string; providerCode: string; modelCode: string }): Promise<void> {
    const p = this.policy(); this.assertScope(p, request);
    const run = await tx.aiEvaluationBudgetRun.findUnique({ where: { projectId_runKey: { projectId: p.projectId, runKey: p.runKey } } });
    if (run && run.policyHash !== this.hash(p)) throw new ServiceUnavailableException("AI evaluation policy changed within a run");
    if ((run?.usedNanos ?? 0n) + this.estimate(p, DEEPSEEK_INPUT_RESERVATION_TOKENS, p.maxOutputTokens) > AI_EVALUATION_LIMIT_NANOS) throw new AiBudgetExceededException();
  }

  async reserve(request: { projectId: string; providerCode: string; modelCode: string }, callId: string) {
    const p = this.policy(); this.assertScope(p, request);
    if (!/^[a-z0-9_-]{8,128}$/i.test(callId)) throw new ServiceUnavailableException("AI budget call identity is invalid");
    return this.prisma.$transaction(async tx => {
      const run = await tx.aiEvaluationBudgetRun.upsert({
        where: { projectId_runKey: { projectId: p.projectId, runKey: p.runKey } },
        create: { projectId: p.projectId, runKey: p.runKey, policyHash: this.hash(p) }, update: {}
      });
      await tx.$queryRaw`SELECT id FROM ai_evaluation_budget_run WHERE id = ${run.id} FOR UPDATE`;
      const current = await tx.aiEvaluationBudgetRun.findUniqueOrThrow({ where: { id: run.id } });
      if (current.policyHash !== this.hash(p)) throw new ServiceUnavailableException("AI evaluation policy changed within a run");
      if (await tx.aiEvaluationBudgetReservation.findUnique({ where: { id: callId } })) throw new ServiceUnavailableException("AI budget call was already reserved");
      const amount = this.estimate(p, DEEPSEEK_INPUT_RESERVATION_TOKENS, p.maxOutputTokens);
      if (current.usedNanos + amount > AI_EVALUATION_LIMIT_NANOS) throw new AiBudgetExceededException();
      await tx.aiEvaluationBudgetReservation.create({ data: { id: callId, runId: run.id, reservedNanos: amount, chargedNanos: amount } });
      await tx.aiEvaluationBudgetRun.update({ where: { id: run.id }, data: { usedNanos: { increment: amount } } });
      return { id: callId, policy: p };
    }, { isolationLevel: "ReadCommitted" });
  }

  async settle(callId: string, p: EvaluationBudgetPolicy, inputTokens: number, outputTokens: number) {
    const amount = this.estimate(p, inputTokens, outputTokens);
    await this.prisma.$transaction(async tx => {
      const row = await tx.aiEvaluationBudgetReservation.findUniqueOrThrow({ where: { id: callId }, include: { run: true } });
      await tx.$queryRaw`SELECT id FROM ai_evaluation_budget_run WHERE id = ${row.runId} FOR UPDATE`;
      const current = await tx.aiEvaluationBudgetReservation.findUniqueOrThrow({ where: { id: callId } });
      if (row.run.projectId !== p.projectId || row.run.runKey !== p.runKey || row.run.policyHash !== this.hash(p) || amount > current.reservedNanos) throw new ServiceUnavailableException("AI budget settlement is invalid");
      if (current.status === "settled") {
        if (current.chargedNanos !== amount) throw new ServiceUnavailableException("AI budget settlement conflicts");
        return;
      }
      await tx.aiEvaluationBudgetReservation.update({ where: { id: callId }, data: { status: "settled", chargedNanos: amount, settledAt: new Date() } });
      await tx.aiEvaluationBudgetRun.update({ where: { id: row.runId }, data: { usedNanos: { decrement: current.reservedNanos - amount } } });
    });
  }

  private assertScope(p: EvaluationBudgetPolicy, request: { projectId: string; providerCode: string; modelCode: string }) {
    if (request.projectId !== p.projectId || request.providerCode !== "deepseek" || request.modelCode !== p.modelCode) throw new ServiceUnavailableException("AI evaluation budget scope mismatch");
  }
  private hash(p: EvaluationBudgetPolicy) {
    return createHash("sha256").update(JSON.stringify([p.projectId, p.runKey, p.modelCode, p.modelVersion, p.priceVersion, p.usdCnyMicros, p.maxOutputTokens, p.expiresAt])).digest("hex");
  }
}
