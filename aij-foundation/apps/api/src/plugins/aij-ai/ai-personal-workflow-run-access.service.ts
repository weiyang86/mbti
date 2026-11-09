import { ConflictException, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { AiPersonalWorkflowsService } from './ai-personal-workflows.service';
import { AiCenterConfigurationService } from './ai-center-configuration.service';
import { AiPersonalAgentSnapshotsService } from './ai-personal-agent-snapshots.service';
import { WorkflowRunReadAccess } from './ai-personal-workflow-runs.service';
import type { WorkflowRef, WorkflowScope } from './ai-personal-workflow-run-origin.service';

/** Composes original access and Agent validation; no IO inside these short transactions. */
@Injectable()
export class RootWorkflowRunReadAccess extends WorkflowRunReadAccess {
  constructor(private readonly workflows: AiPersonalWorkflowsService, private readonly configuration: AiCenterConfigurationService,
    private readonly snapshots: AiPersonalAgentSnapshotsService) { super(); }
  withCurrent<T>(member: string, workspace: string, permissions: readonly string[], operation: (tx: Prisma.TransactionClient, scope: WorkflowScope) => Promise<T>) {
    return this.workflows.workflowExecutionWithCurrent({ memberId: member, workspaceId: workspace }, permissions, operation);
  }
  async assertAgentCurrent(tx: Prisma.TransactionClient, scope: WorkflowScope, ref: WorkflowRef) {
    const c = await this.configuration.current(tx);
    if (c.projectId !== scope.projectId) throw new ConflictException('Workflow origin changed');
    const s = await this.snapshots.resolve(tx, c, scope.memberId, scope.workspaceId, ref.agentId, ref.agentRevision);
    if (!s.source || s.source.agentId !== ref.agentId || s.source.versionId !== ref.agentVersionId || s.source.revision !== ref.agentRevision ||
      s.source.publicationVersion !== ref.agentPublicationEpoch || s.agent.code !== 'personal:' + ref.agentId || s.agent.revision !== ref.agentRevision)
      throw new ConflictException('Workflow origin changed');
  }
}
