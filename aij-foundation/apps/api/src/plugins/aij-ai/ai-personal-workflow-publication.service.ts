import { ConflictException, HttpException, Inject, Injectable, NotFoundException, Optional, ServiceUnavailableException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { AiCenterCatalog } from '@aij/contracts';
import { randomUUID } from 'node:crypto';
import { AiPersonalAgentSnapshotsService } from './ai-personal-agent-snapshots.service';
import { compilePersonalWorkflowLinearGraph } from './ai-personal-workflow-linear-contract';
import { WORKFLOW_PUBLICATION_MAX, publishPersonalWorkflowDto, unpublishPersonalWorkflowDto,
  workflowPublicationAssetId, workflowPublicationId } from './ai-personal-workflow-publication.dto';

export type Scope = Readonly<{ memberId: string; workspaceId: string }>;
export type SessionGate = (tx: Prisma.TransactionClient) => Promise<void>;
export type WorkflowPublicationCurrent = {
  projectId: string; workflowId: string; revision: number; workflowVersionId: string; graphDigest: string; graph: unknown;
  agentBindings: { nodeId: string; agentId: string; revision: number; agentVersionId: string }[];
  catalog: { version: number; catalog: AiCenterCatalog };
};
/** Original draft owner provides scope, lifecycle, grants, catalog-before-workflow locks and genuine immutable pins.
 * currentInTransaction MUST NOT resolve/lock Agent or Memory; no nested transaction. */
export abstract class PersonalWorkflowPublicationAccess {
  abstract withCurrent<T>(scope: Scope, workflowId: string, permissions: readonly string[], authorize: SessionGate | undefined,
    operation: (tx: Prisma.TransactionClient, current: WorkflowPublicationCurrent) => Promise<T>): Promise<T>;
  abstract currentInTransaction(tx: Prisma.TransactionClient, scope: Scope, workflowId: string,
    permissions: readonly string[], authorize?: SessionGate): Promise<WorkflowPublicationCurrent>;
}
export type WorkflowRef = Readonly<{
  id: string; workflowId: string; workflowVersionId: string; revision: number; graphDigest: string; publicationEpoch: number;
  nodeId: string; agentId: string; agentVersionId: string; agentRevision: number; agentPublicationEpoch: number;
}>;
export type PublicationMetadata = {
  workflowId: string; revision: number; publishedRevision: number | null; publicationEpoch: number; publication: WorkflowRef | null;
  dependencyReadiness: { ready: boolean; reason: 'ready' | 'not_published' | 'revision_changed' | 'dependencies_unavailable' | 'validator_unavailable' };
};
type Head = { revision: number; published_revision: number | null; publication_epoch: number };
type PublicationRow = {
  id: string; project_id: string; workspace_id: string; member_id: string; workflow_id: string; workflow_version_id: string;
  revision: number; graph_digest: string; publication_epoch: number; node_id: string; agent_id: string;
  agent_version_id: string; agent_revision: number; agent_publication_epoch: number;
};
const READ = ['ai.assets.read'] as const;
const MANAGE = ['ai.assets.manage', 'workspace.ai.workflows.publish'] as const;
const EXECUTE = ['ai.assets.read', 'ai.execute', 'workspace.ai.workflows.execute'] as const;
const RUN_READ = ['ai.assets.read', 'ai.read', 'workspace.ai.workflows.execute'] as const;
const unavailable = () => new ServiceUnavailableException('Workflow publication service unavailable');
const conflict = () => new ConflictException('Workflow publication conflict');
const positive = (n: number) => Number.isInteger(n) && n >= 1 && n <= WORKFLOW_PUBLICATION_MAX;
const equal = (a: WorkflowRef, b: WorkflowRef) => Object.keys(a).every(k => a[k as keyof WorkflowRef] === b[k as keyof WorkflowRef]);

@Injectable()
export class AiPersonalWorkflowPublicationService {
  constructor(@Optional() @Inject(PersonalWorkflowPublicationAccess) private readonly access?: PersonalWorkflowPublicationAccess,
    @Optional() @Inject(AiPersonalAgentSnapshotsService) private readonly snapshots?: AiPersonalAgentSnapshotsService) {}

  private port() { if (!this.access) throw unavailable(); return this.access; }
  private async safe<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation(); } catch (e) { if (e instanceof HttpException) throw e; throw unavailable(); }
  }
  private async head(tx: Prisma.TransactionClient, scope: Scope, c: WorkflowPublicationCurrent): Promise<Head> {
    const rows = await tx.$queryRaw<Head[]>`SELECT revision,published_revision,publication_epoch FROM public.ai_personal_workflow
      WHERE id=${c.workflowId} AND workspace_id=${scope.workspaceId} AND member_id=${scope.memberId} AND deleted_at IS NULL FOR UPDATE`;
    const h = rows[0];
    if (!h || h.revision !== c.revision || !positive(h.revision) || !Number.isInteger(h.publication_epoch) || h.publication_epoch < 0 ||
      h.publication_epoch > WORKFLOW_PUBLICATION_MAX || (h.published_revision !== null && (!positive(h.published_revision) || h.published_revision > h.revision || h.publication_epoch < 1))) throw conflict();
    return h;
  }
  private ref(row: PublicationRow): WorkflowRef {
    // Explicit projection: server-only scope/createdAt never escapes.
    const ref = { id: row.id, workflowId: row.workflow_id, workflowVersionId: row.workflow_version_id, revision: row.revision,
      graphDigest: row.graph_digest, publicationEpoch: row.publication_epoch, nodeId: row.node_id, agentId: row.agent_id,
      agentVersionId: row.agent_version_id, agentRevision: row.agent_revision, agentPublicationEpoch: row.agent_publication_epoch };
    try {
      workflowPublicationId(ref.id);
      for (const id of [ref.workflowId, ref.workflowVersionId, ref.agentId, ref.agentVersionId]) workflowPublicationAssetId(id);
      if (!/^[A-Za-z][A-Za-z0-9_-]{0,47}$/.test(ref.nodeId) || ['constructor', 'prototype', '__proto__'].includes(ref.nodeId) ||
        !/^[0-9a-f]{64}$/.test(ref.graphDigest) || ![ref.revision, ref.publicationEpoch, ref.agentRevision, ref.agentPublicationEpoch].every(positive)) throw conflict();
    } catch { throw conflict(); }
    return Object.freeze(ref);
  }
  private async active(tx: Prisma.TransactionClient, scope: Scope, c: WorkflowPublicationCurrent, h: Head): Promise<WorkflowRef | null> {
    if (h.published_revision === null) return null;
    const rows = await tx.$queryRaw<PublicationRow[]>`SELECT * FROM public.ai_personal_workflow_publication
      WHERE workflow_id=${c.workflowId} AND project_id=${c.projectId} AND workspace_id=${scope.workspaceId} AND member_id=${scope.memberId}
        AND publication_epoch=${h.publication_epoch} AND revision=${h.published_revision}`;
    if (rows.length !== 1) throw conflict();
    return this.ref(rows[0]);
  }
  private matches(c: WorkflowPublicationCurrent, ref: WorkflowRef): boolean {
    const plan = compilePersonalWorkflowLinearGraph(c.graph, this.graphInputs(c));
    const pin = c.agentBindings[0];
    return c.workflowId === ref.workflowId && c.revision === ref.revision && c.workflowVersionId === ref.workflowVersionId &&
      c.graphDigest === ref.graphDigest && plan.graphDigest === ref.graphDigest && c.agentBindings.length === 1 && !!pin &&
      pin.nodeId === plan.nodeId && pin.agentId === plan.agentId && pin.revision === plan.agentRevision &&
      pin.nodeId === ref.nodeId && pin.agentId === ref.agentId && pin.agentVersionId === ref.agentVersionId && pin.revision === ref.agentRevision;
  }
  private graphInputs(c: WorkflowPublicationCurrent): string[] {
    // Full descriptor/prototype validation occurs in compiler before using the graph.
    const d = c.graph && typeof c.graph === 'object' ? Object.getOwnPropertyDescriptor(c.graph, 'inputKeys') : undefined;
    if (!d || !('value' in d) || !Array.isArray(d.value)) throw conflict();
    return d.value;
  }
  private async dependency(tx: Prisma.TransactionClient, scope: Scope, c: WorkflowPublicationCurrent) {
    if (!this.snapshots) throw unavailable();
    const plan = compilePersonalWorkflowLinearGraph(c.graph, this.graphInputs(c)), pin = c.agentBindings[0];
    if (c.agentBindings.length !== 1 || !pin || pin.nodeId !== plan.nodeId || pin.agentId !== plan.agentId || pin.revision !== plan.agentRevision || plan.graphDigest !== c.graphDigest) throw conflict();
    const snapshot = await this.snapshots.resolve(tx, c.catalog, scope.memberId, scope.workspaceId, pin.agentId, pin.revision);
    const src = snapshot.source;
    if (!src || src.type !== 'personal' || src.agentId !== pin.agentId || src.versionId !== pin.agentVersionId || src.revision !== pin.revision ||
      !positive(src.publicationVersion) || !snapshot.agent.published) throw conflict();
    compilePersonalWorkflowLinearGraph(c.graph, snapshot.agent.inputFields);
    return { plan, pin, epoch: src.publicationVersion };
  }
  private metadata(c: WorkflowPublicationCurrent, h: Head, ref: WorkflowRef | null, reason: PublicationMetadata['dependencyReadiness']['reason']): PublicationMetadata {
    return { workflowId: c.workflowId, revision: c.revision, publishedRevision: h.published_revision, publicationEpoch: h.publication_epoch,
      publication: ref, dependencyReadiness: { ready: reason === 'ready', reason } };
  }
  private async present(tx: Prisma.TransactionClient, scope: Scope, c: WorkflowPublicationCurrent, h: Head): Promise<PublicationMetadata> {
    const ref = await this.active(tx, scope, c, h);
    if (!ref) return this.metadata(c, h, null, 'not_published');
    if (h.published_revision !== c.revision) return this.metadata(c, h, ref, 'revision_changed');
    try {
      if (!this.matches(c, ref)) return this.metadata(c, h, ref, 'dependencies_unavailable');
      const dep = await this.dependency(tx, scope, c);
      return this.metadata(c, h, ref, dep.epoch === ref.agentPublicationEpoch ? 'ready' : 'dependencies_unavailable');
    } catch (e) {
      if (e instanceof HttpException && [400, 404, 409, 503].includes(e.getStatus()))
        return this.metadata(c, h, ref, e.getStatus() === 503 ? 'validator_unavailable' : 'dependencies_unavailable');
      throw e;
    }
  }
  read(member: string, workspace: string, workflowId: string, authorize?: SessionGate): Promise<PublicationMetadata> {
    workflowPublicationAssetId(workflowId);
    const scope = { memberId: member, workspaceId: workspace };
    return this.safe(() => this.port().withCurrent(scope, workflowId, READ, authorize, async (tx, c) => this.present(tx, scope, c, await this.head(tx, scope, c))));
  }
  publish(member: string, workspace: string, raw: unknown, authorize?: SessionGate): Promise<PublicationMetadata> {
    const dto = publishPersonalWorkflowDto(raw), scope = { memberId: member, workspaceId: workspace };
    return this.safe(() => this.port().withCurrent(scope, dto.workflowId, MANAGE, authorize, async (tx, c) => {
      const h = await this.head(tx, scope, c);
      if (h.revision !== dto.expectedRevision || h.publication_epoch !== dto.expectedPublicationEpoch) throw conflict();
      const dep = await this.dependency(tx, scope, c), prior = await this.active(tx, scope, c, h);
      const next: WorkflowRef = Object.freeze({ id: prior?.id ?? randomUUID(), workflowId: c.workflowId, workflowVersionId: c.workflowVersionId,
        revision: c.revision, graphDigest: c.graphDigest, publicationEpoch: h.publication_epoch, nodeId: dep.plan.nodeId, agentId: dep.pin.agentId,
        agentVersionId: dep.pin.agentVersionId, agentRevision: dep.pin.revision, agentPublicationEpoch: dep.epoch });
      if (prior && equal(prior, next)) return this.metadata(c, h, prior, 'ready');
      if (h.publication_epoch === WORKFLOW_PUBLICATION_MAX) throw conflict();
      const ref = Object.freeze({ ...next, id: randomUUID(), publicationEpoch: h.publication_epoch + 1 });
      const inserted = await tx.$executeRaw`INSERT INTO public.ai_personal_workflow_publication
        (id,project_id,workspace_id,member_id,workflow_id,workflow_version_id,revision,graph_digest,publication_epoch,node_id,agent_id,agent_version_id,agent_revision,agent_publication_epoch)
        VALUES (${ref.id}::uuid,${c.projectId},${workspace},${member},${ref.workflowId},${ref.workflowVersionId},${ref.revision},${ref.graphDigest},
          ${ref.publicationEpoch},${ref.nodeId},${ref.agentId},${ref.agentVersionId},${ref.agentRevision},${ref.agentPublicationEpoch})`;
      if (inserted !== 1) throw conflict();
      await this.advance(tx, scope, c, h, ref.revision);
      await this.audit(tx, scope, ref.workflowId, ref.revision, ref.publicationEpoch, 'personal_workflow_published', ref.id);
      return this.metadata(c, { ...h, published_revision: ref.revision, publication_epoch: ref.publicationEpoch }, ref, 'ready');
    }));
  }
  unpublish(member: string, workspace: string, workflowId: string, raw: unknown, authorize?: SessionGate): Promise<PublicationMetadata> {
    workflowPublicationAssetId(workflowId);
    const dto = unpublishPersonalWorkflowDto(raw), scope = { memberId: member, workspaceId: workspace };
    return this.safe(() => this.port().withCurrent(scope, workflowId, MANAGE, authorize, async (tx, c) => {
      const h = await this.head(tx, scope, c);
      if (h.revision !== dto.expectedRevision || h.publication_epoch !== dto.expectedPublicationEpoch) throw conflict();
      if (h.published_revision === null) return this.metadata(c, h, null, 'not_published');
      if (h.publication_epoch === WORKFLOW_PUBLICATION_MAX) throw conflict();
      await this.advance(tx, scope, c, h, null);
      await this.audit(tx, scope, c.workflowId, h.revision, h.publication_epoch + 1, 'personal_workflow_unpublished');
      return this.metadata(c, { ...h, published_revision: null, publication_epoch: h.publication_epoch + 1 }, null, 'not_published');
    }));
  }
  private async advance(tx: Prisma.TransactionClient, scope: Scope, c: WorkflowPublicationCurrent, h: Head, published: number | null) {
    const count = await tx.$executeRaw`UPDATE public.ai_personal_workflow SET published_revision=${published},publication_epoch=publication_epoch+1
      WHERE id=${c.workflowId} AND workspace_id=${scope.workspaceId} AND member_id=${scope.memberId} AND revision=${h.revision}
        AND publication_epoch=${h.publication_epoch} AND deleted_at IS NULL`;
    if (count !== 1) throw conflict();
  }
  private async audit(tx: Prisma.TransactionClient, scope: Scope, workflowId: string, revision: number, epoch: number, action: string, publicationId?: string) {
    await tx.auditLog.create({ data: { module: 'aij-ai', action, userId: scope.memberId, workspaceId: scope.workspaceId, status: 'success',
      resourceType: 'ai_personal_workflow', resourceId: workflowId,
      afterData: { workflowId, revision, publicationEpoch: epoch, ...(publicationId ? { publicationId } : {}) } } });
  }
  /** Runtime path locks ONLY workflow head/version/binding. Run owner later resolves Memory -> Agent. */
  resolveInTransaction(tx: Prisma.TransactionClient, scope: Scope, publicationId: string, authorize?: SessionGate): Promise<{ projectId: string; ref: WorkflowRef; inputFields: string[] }> {
    return this.resolveCurrentPublication(tx, scope, publicationId, EXECUTE, authorize);
  }
  /** Result queries use current read authority; this method never authorizes execution. */
  resolveForReadInTransaction(tx: Prisma.TransactionClient, scope: Scope, publicationId: string, authorize?: SessionGate): Promise<{ projectId: string; ref: WorkflowRef; inputFields: string[] }> {
    return this.resolveCurrentPublication(tx, scope, publicationId, RUN_READ, authorize);
  }
  private resolveCurrentPublication(tx: Prisma.TransactionClient, scope: Scope, publicationId: string, permissions: readonly string[], authorize?: SessionGate): Promise<{ projectId: string; ref: WorkflowRef; inputFields: string[] }> {
    workflowPublicationId(publicationId);
    return this.safe(async () => {
      const port = this.port();
      const rows = await tx.$queryRaw<PublicationRow[]>`SELECT * FROM public.ai_personal_workflow_publication
        WHERE id=${publicationId}::uuid AND workspace_id=${scope.workspaceId} AND member_id=${scope.memberId}`;
      if (rows.length !== 1) throw new NotFoundException('Workflow publication unavailable');
      const row = rows[0], ref = this.ref(row);
      const c = await port.currentInTransaction(tx, scope, ref.workflowId, permissions, authorize);
      const h = await this.head(tx, scope, c);
      if (row.project_id !== c.projectId || h.published_revision !== ref.revision || h.publication_epoch !== ref.publicationEpoch || !this.matches(c, ref)) throw conflict();
      return { projectId: c.projectId, ref, inputFields: [...compilePersonalWorkflowLinearGraph(c.graph, this.graphInputs(c)).inputFields] };
    });
  }
}
