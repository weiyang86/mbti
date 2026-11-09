import { ConflictException, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import type { AiCenterCatalog, AiCenterModel } from '@aij/contracts';
import { AiBudgetExceededException, type AiProviderUsage } from './ai-provider';
/** Internal estimate/reservation owner is shared with AI evaluation, never a provider invoice. */
@Injectable()
export class AiCenterBudgetService {
    estimate(model: AiCenterModel, usage?: AiProviderUsage) {
        if (model.capability === 'image')
            return BigInt(model.imageNanos);
        const input = usage?.promptTokens ?? model.contextTokens, output = usage?.completionTokens ?? model.maxOutputTokens;
        if (input > model.contextTokens || output > model.maxOutputTokens)
            throw new ConflictException('AI usage exceeds reserved bounds');
        return (BigInt(input) * BigInt(model.inputNanosPerMillion) + BigInt(output) * BigInt(model.outputNanosPerMillion) + 999999n) / 1000000n;
    }
    async reserve(tx: Prisma.TransactionClient, projectId: string, workspaceId: string, callId: string, catalog: AiCenterCatalog, model: AiCenterModel, now = new Date()) {
        const month = now.toISOString().slice(0, 7), runKey = 'application:' + month, start = new Date(month + '-01T00:00:00.000Z');
        // Shared project lock serializes different members/workspaces and configuration cap changes.
        await tx.$executeRaw `SELECT pg_advisory_xact_lock(hashtext(${'ai-application-budget:' + projectId}))`;
        const amount = this.estimate(model), limit = BigInt(catalog.monthlyBudgetNanos);
        const row = await tx.aiEvaluationBudgetRun.upsert({ where: { projectId_runKey: { projectId, runKey } }, create: { projectId, runKey, kind: 'application', limitNanos: limit, policyHash: createHash('sha256').update(projectId + runKey).digest('hex') }, update: {} });
        await tx.$queryRaw `SELECT id FROM ai_evaluation_budget_run WHERE id=${row.id} FOR UPDATE`;
        const current = await tx.aiEvaluationBudgetRun.findUniqueOrThrow({ where: { id: row.id } });
        const workspace = await tx.aiAgentRun.aggregate({ where: { projectId, workspaceId, createdAt: { gte: start } }, _sum: { estimatedCostNanos: true } });
        if (current.kind !== 'application' || current.usedNanos + amount > limit || (workspace._sum.estimatedCostNanos ?? 0n) + amount > BigInt(catalog.workspaceMonthlyBudgetNanos))
            throw new AiBudgetExceededException();
        await tx.aiEvaluationBudgetReservation.create({ data: { id: callId, runId: row.id, reservedNanos: amount, chargedNanos: amount } });
        await tx.aiEvaluationBudgetRun.update({ where: { id: row.id }, data: { limitNanos: limit, usedNanos: { increment: amount } } });
        return amount;
    }
    async settle(tx: Prisma.TransactionClient, callId: string, amount: bigint) {
        const row = await tx.aiEvaluationBudgetReservation.findUniqueOrThrow({ where: { id: callId } });
        await tx.$queryRaw `SELECT id FROM ai_evaluation_budget_run WHERE id=${row.runId} FOR UPDATE`;
        const current = await tx.aiEvaluationBudgetReservation.findUniqueOrThrow({ where: { id: callId } });
        if (amount < 0n || amount > current.reservedNanos)
            throw new ConflictException('Invalid AI budget settlement');
        if (current.status === 'settled') {
            if (current.chargedNanos !== amount)
                throw new ConflictException('AI settlement conflict');
            return;
        }
        await tx.aiEvaluationBudgetReservation.update({ where: { id: callId }, data: { status: 'settled', chargedNanos: amount, settledAt: new Date() } });
        await tx.aiEvaluationBudgetRun.update({ where: { id: row.runId }, data: { usedNanos: { decrement: current.reservedNanos - amount } } });
    }
}
