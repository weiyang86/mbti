import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PermissionsService } from '../../rbac/permissions.service';
import { ManagementAccessService } from '../../rbac/management-access.service';
import { RUNTIME_READ_PERMISSION } from '../../../../../scripts/runtime-policy.cjs';
import { AiCenterConfigurationService } from './ai-center-configuration.service';
import { AI_AGENT_JOB } from './ai-center-run.service';
@Injectable()
export class AiCenterUsageService {
    constructor(private readonly prisma: PrismaService, private readonly permissions: PermissionsService, private readonly access: ManagementAccessService, private readonly configuration: AiCenterConfigurationService) { }
    read(operator: string) {
        return this.access.database(() => this.prisma.$transaction(async (tx) => {
            await this.permissions.authorizeInTransaction(tx, operator, [RUNTIME_READ_PERMISSION]);
            const c = await this.configuration.current(tx), month = new Date().toISOString().slice(0, 7), start = new Date(month + '-01T00:00:00.000Z');
            const [budget, groups, usage, recent] = await Promise.all([
                tx.aiEvaluationBudgetRun.findUnique({ where: { projectId_runKey: { projectId: c.projectId, runKey: 'application:' + month } } }),
                tx.aiAgentRun.groupBy({ by: ['agentCode', 'status'], where: { projectId: c.projectId, createdAt: { gte: start } }, _count: true, _sum: { estimatedCostNanos: true } }),
                tx.aiExecutionTrace.groupBy({ by: ['providerCode', 'modelCode', 'status'], where: { projectId: c.projectId, startedAt: { gte: start }, job: { jobType: AI_AGENT_JOB } }, _count: true, _sum: { promptTokens: true, completionTokens: true, cachedTokens: true, imageCount: true } }),
                tx.aiAgentRun.findMany({ where: { projectId: c.projectId }, orderBy: { createdAt: 'desc' }, take: 50, select: { id: true, agentCode: true, agentRevision: true, catalogVersion: true, status: true, budgetStatus: true, estimatedCostNanos: true, failureCode: true, createdAt: true, completedAt: true } })
            ]);
            return { month, currency: 'CNY', costKind: 'internal_estimate', monthlyLimitNanos: c.catalog.monthlyBudgetNanos, workspaceMonthlyLimitNanos: c.catalog.workspaceMonthlyBudgetNanos, usedAndReservedNanos: (budget?.usedNanos ?? 0n).toString(), agents: groups.map(g => ({ agentCode: g.agentCode, status: g.status, count: g._count, estimatedCostNanos: (g._sum.estimatedCostNanos ?? 0n).toString() })), models: usage.map(u => ({ providerCode: u.providerCode, modelCode: u.modelCode, status: u.status, count: u._count, promptTokens: u._sum.promptTokens ?? 0, completionTokens: u._sum.completionTokens ?? 0, cachedTokens: u._sum.cachedTokens ?? 0, imageCount: u._sum.imageCount ?? 0 })), recent: recent.map(r => ({ ...r, estimatedCostNanos: r.estimatedCostNanos.toString() })) };
        }));
    }
}
