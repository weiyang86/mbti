import { BadRequestException, ConflictException, GoneException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { WorkspaceContextService } from "../../client-workspaces/workspace-context.service";
import { CLIENT_WORKSPACE_PERMISSION } from "../../client-workspaces/client-workspace-permissions";
import { PluginRuntimeAccessService } from "../../plugin-runtime/plugin-runtime-access.service";
import { RuntimeRegistry } from "../../async-runtime/registry";
import { redactAiExternalText } from "./deepseek-provider";

export const AI_EVALUATION_RETENTION_MS = 7 * 86400_000;
export const AI_EVALUATION_CLEANUP_JOB = "aij-ai.evaluation-expiry-cleanup";
@Injectable()
export class AiEvaluationService {
  constructor(private readonly prisma: PrismaService, private readonly workspace: WorkspaceContextService,
    private readonly plugins: PluginRuntimeAccessService, private readonly registry: RuntimeRegistry) {}

  onModuleInit() {
    this.registry.registerOrchestratedJob(AI_EVALUATION_CLEANUP_JOB, 1, async job => {
      const p = job.payload as Record<string, unknown> | null;
      if (!p || typeof p !== "object" || Array.isArray(p) || Object.keys(p).join() !== "scheduledAt" || typeof p.scheduledAt !== "string" || !Number.isFinite(Date.parse(p.scheduledAt))) throw new Error("AI_EVALUATION_CLEANUP_INVALID");
      const now = new Date();
      const result = await this.prisma.aiEvaluationRecord.updateMany({ where: { contentPurgedAt: null, createdAt: { lte: new Date(now.getTime() - AI_EVALUATION_RETENTION_MS) } },
        data: { inputText: null, outputText: null, contentPurgedAt: now } });
      return { resultReference: { cleanedCount: result.count } };
    });
    this.registry.registerSchedule({ code: AI_EVALUATION_CLEANUP_JOB, intervalMs: 3600_000,
      job: now => ({ type: AI_EVALUATION_CLEANUP_JOB, version: 1, payload: { scheduledAt: now.toISOString() }, scope: { type: "global", id: "aij-ai" },
        idempotencyKey: `evaluation-expiry:${now.toISOString()}`, maxAttempts: 5, timeoutMs: 30_000 }) });
  }

  async capture(memberId: string, workspaceId: string, input: { questionId: string; runKey: string; caseKey: string }) {
    await this.workspace.resolve(memberId, workspaceId, [CLIENT_WORKSPACE_PERMISSION.knowledgeManage]);
    if (!input || !/^[a-z0-9]{20,32}$/.test(input.questionId) || !/^[A-Za-z0-9_-]{1,80}$/.test(input.runKey) || !/^[A-Za-z0-9_-]{1,80}$/.test(input.caseKey)) throw new BadRequestException("Evaluation identity is invalid");
    const record = await this.prisma.$transaction(async tx => {
      const projectId = await this.plugins.projectId(tx);
      await this.plugins.assertEnabledInTransaction(tx, projectId, "aij-ai");
      const question = await tx.aiKnowledgeQuestion.findFirst({ where: { id: input.questionId, workspaceId, deletedAt: null } });
      if (!question) throw new NotFoundException("Evaluation source unavailable");
      this.assertUnexpired(question);
      if (!["answered", "refused", "failed"].includes(question.status)) throw new ConflictException("Evaluation source is not terminal");
      const row = await tx.aiEvaluationRecord.upsert({
        where: { workspaceId_runKey_caseKey: { workspaceId, runKey: input.runKey, caseKey: input.caseKey } },
        create: { projectId, workspaceId, questionId: question.id, runKey: input.runKey, caseKey: input.caseKey, status: question.status,
          inputText: redactAiExternalText(question.query), outputText: question.answer === null ? null : redactAiExternalText(question.answer), createdAt: question.createdAt }, update: {}
      });
      if (row.questionId !== question.id || row.projectId !== projectId) throw new ConflictException("Evaluation case identity conflicts");
      return row;
    });
    this.assertUnexpired(record);
    return this.publicRecord(record);
  }

  async read(memberId: string, workspaceId: string, id: string) {
    await this.workspace.resolve(memberId, workspaceId, [CLIENT_WORKSPACE_PERMISSION.knowledgeManage]);
    if (!/^[a-z0-9]{20,32}$/.test(id)) throw new BadRequestException("Evaluation identity is invalid");
    const projectId = await this.prisma.$transaction(async tx => {
      const id = await this.plugins.projectId(tx);
      await this.plugins.assertEnabledInTransaction(tx, id, "aij-ai");
      return id;
    });
    const row = await this.prisma.aiEvaluationRecord.findFirst({ where: { id, workspaceId, projectId } });
    if (!row) throw new NotFoundException("Evaluation unavailable");
    this.assertUnexpired(row);
    return this.publicRecord(row);
  }

  private assertUnexpired(row: { createdAt: Date; contentPurgedAt?: Date | null }) {
    if (row.contentPurgedAt || Date.now() >= row.createdAt.getTime() + AI_EVALUATION_RETENTION_MS) throw new GoneException("Evaluation expired");
  }
  private publicRecord(row: { id: string; runKey: string; caseKey: string; status: string; inputText: string | null; outputText: string | null; createdAt: Date }) {
    return { id: row.id, runKey: row.runKey, caseKey: row.caseKey, status: row.status, inputText: row.inputText, outputText: row.outputText,
      createdAt: row.createdAt, expiresAt: new Date(row.createdAt.getTime() + AI_EVALUATION_RETENTION_MS) };
  }
}
