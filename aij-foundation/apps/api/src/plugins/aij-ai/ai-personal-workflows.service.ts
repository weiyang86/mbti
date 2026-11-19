import { ConflictException, ForbiddenException, HttpException, Injectable, NotFoundException, Optional, ServiceUnavailableException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { PrismaService } from "../../prisma/prisma.service";
import { WorkspaceContextService } from "../../client-workspaces/workspace-context.service";
import { CLIENT_WORKSPACE_PERMISSION as P } from "../../client-workspaces/client-workspace-permissions";
import { PluginRuntimeAccessService } from "../../plugin-runtime/plugin-runtime-access.service";
import { createPersonalWorkflowDto, updatePersonalWorkflowDto, deletePersonalWorkflowDto,
  personalWorkflowId, personalWorkflowPage, personalWorkflowRevisionParam } from "./ai-personal-workflows.dto";
import type { WorkflowGraph } from "./ai-personal-workflows-graph";
import { validateWorkflowGraph } from "./ai-personal-workflows-graph";
import { AiCenterConfigurationService } from "./ai-center-configuration.service";
import { AI_CENTER_CONFIG_KEY } from "./ai-center-policy";
import type { Scope, SessionGate, WorkflowPublicationCurrent } from "./ai-personal-workflow-publication.service";

type SummaryRow = { id: string; code: string; name: string; revision: number; graph_digest: string; created_at: Date; updated_at: Date };
type Row = SummaryRow & { workspace_id: string; member_id: string; graph: WorkflowGraph; content_digest: string; initial_digest: string; deleted_at: Date | null };
type Version = Omit<Row, "updated_at" | "deleted_at" | "initial_digest"> & { workflow_id: string; agent_binding_count: number };
type Pin = { nodeId: string; agentId: string; revision: number; agentVersionId: string };
type Ref = Omit<Pin, "agentVersionId">;
const draft = { status: "DRAFT" as const, structuralValidity: "VALID" as const };
const summary = (r: SummaryRow) => ({ id: r.id, code: r.code, name: r.name, revision: r.revision, graphDigest: r.graph_digest,
  ...draft, createdAt: r.created_at.toISOString(), updatedAt: r.updated_at.toISOString() });
const digest = (name: string, canonical: string) => createHash("sha256").update(JSON.stringify([name, canonical])).digest("hex");

/** Private persisted draft configuration. No execution/runtime/provider/Memory dependency. */
@Injectable()
export class AiPersonalWorkflowsService {
  constructor(private readonly prisma: PrismaService, private readonly workspaces: WorkspaceContextService,
    private readonly plugins: PluginRuntimeAccessService, @Optional() private readonly configuration?: AiCenterConfigurationService) {}
  /** Common lifecycle/member owner. Draft CRUD deliberately has no catalog dependency. */
  private async accessInTransaction(tx: Prisma.TransactionClient, member: string, workspace: string, permissions: readonly string[]) {
    const project = await this.plugins.projectId(tx);
    await this.plugins.assertEnabledInTransaction(tx, project, "aij-ai");
    const projects = await tx.$queryRaw<{ id: string }[]>`SELECT p.id FROM public.project_profile p
      JOIN public.organization_profile o ON o.id=p.organization_id WHERE p.id=${project}
      AND p.status='active' AND p.deleted_at IS NULL AND o.status='active' AND o.deleted_at IS NULL FOR SHARE OF p,o`;
    const installations = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM public.plugin_installation
      WHERE project_id=${project} AND plugin_code='aij-ai' AND status='enabled' FOR SHARE`;
    if (!projects.length || !installations.length) throw new NotFoundException("Plugin capability unavailable");
    for (const permission of permissions) await this.workspaces.assertWritePermissionInTransaction(tx, member, workspace, permission);
    return project;
  }
  private async scope<T>(member: string, workspace: string, permission: string, operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    try {
      return await this.prisma.$transaction(async tx => {
        await this.accessInTransaction(tx, member, workspace, [permission]);
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"ai-personal-workflows:" + workspace + ":" + member},0))`;
        return operation(tx);
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 5000, timeout: 10000 });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException("Personal workflow service unavailable");
    }
  }
  /** INTERNAL finite contract aliases map to the existing permission catalog, never new grants. */
  private publicationPermissions(raw: readonly string[]): string[] {
    const permissions: Readonly<Record<string, string>> = Object.freeze({
      "ai.assets.read": P.aiAssetsRead, "ai.assets.manage": P.aiAssetsManage,
      "ai.read": P.aiRead, "ai.execute": P.aiExecute,
      "workspace.ai.workflows.publish": "workspace.ai.workflows.publish",
      "workspace.ai.workflows.execute": "workspace.ai.workflows.execute"
    });
    if (!Array.isArray(raw) || !raw.length || raw.length > 3 || raw.some(p => !Object.hasOwn(permissions, p))) throw new ForbiddenException("Workspace access denied");
    return [...new Set(raw.map(p => permissions[p]))].sort();
  }
  async publicationWithCurrent<T>(scope: Scope, workflowId: string, permissions: readonly string[], authorize: SessionGate | undefined,
    operation: (tx: Prisma.TransactionClient, current: WorkflowPublicationCurrent) => Promise<T>): Promise<T> {
    try {
      return await this.prisma.$transaction(async tx => operation(tx,
        await this.publicationCurrentInTransaction(tx, scope, workflowId, permissions, authorize)),
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 5000, timeout: 10000 });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException("Workflow publication access unavailable");
    }
  }
  async publicationCurrentInTransaction(tx: Prisma.TransactionClient, scope: Scope, workflowId: string,
    permissions: readonly string[], authorize?: SessionGate): Promise<WorkflowPublicationCurrent> {
    personalWorkflowId(workflowId);
    const catalog = await this.workflowCatalogInTransaction(tx, scope, permissions), project = catalog.projectId;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"ai-personal-workflows:" + scope.workspaceId + ":" + scope.memberId},0))`;
    const h = await this.owned(tx, scope.memberId, scope.workspaceId, workflowId);
    if (authorize) await authorize(tx);
    const versions = await tx.$queryRaw<Version[]>`SELECT * FROM public.ai_personal_workflow_version
      WHERE workflow_id=${h.id} AND workspace_id=${scope.workspaceId} AND member_id=${scope.memberId} AND revision=${h.revision}`;
    const v = versions[0];
    if (versions.length !== 1 || !v || v.workflow_id !== h.id || v.code !== h.code || v.name !== h.name ||
      v.revision !== h.revision || v.content_digest !== h.content_digest || v.graph_digest !== h.graph_digest ||
      v.workspace_id !== scope.workspaceId || v.member_id !== scope.memberId) throw new ConflictException("Workflow publication conflict");
    const current = validateWorkflowGraph(h.graph), retained = validateWorkflowGraph(v.graph);
    if (current.canonical !== retained.canonical || current.digest !== h.graph_digest || retained.digest !== v.graph_digest ||
      digest(h.name, current.canonical) !== h.content_digest) throw new ConflictException("Workflow publication conflict");
    // Only immutable AgentVersion is joined. Never resolve or lock mutable Agent/Memory here.
    const pins = await tx.$queryRaw<{ node_id: string; agent_id: string; revision: number; agent_version_id: string }[]>`
      SELECT b.node_id,a.agent_id,a.revision,b.agent_version_id FROM public.ai_personal_workflow_agent_binding b
      JOIN public.ai_personal_agent_version a ON a.id=b.agent_version_id AND a.workspace_id=b.workspace_id AND a.member_id=b.member_id
      WHERE b.workflow_version_id=${v.id} AND b.workspace_id=${scope.workspaceId} AND b.member_id=${scope.memberId} ORDER BY b.node_id COLLATE "C"`;
    if (pins.length !== v.agent_binding_count || pins.length !== retained.agentRefs.length ||
      pins.some((p, i) => p.node_id !== retained.agentRefs[i].nodeId || p.agent_id !== retained.agentRefs[i].agentId || p.revision !== retained.agentRefs[i].revision))
      throw new ConflictException("Workflow publication conflict");
    return { projectId: project, workflowId: h.id, revision: h.revision, workflowVersionId: v.id, graphDigest: retained.digest,
      graph: retained.graph, agentBindings: pins.map(p => ({ nodeId: p.node_id, agentId: p.agent_id, revision: p.revision, agentVersionId: p.agent_version_id })), catalog };
  }
  /** Same original lifecycle/grant/catalog prelude for workflow result composition. */
  async workflowExecutionWithCurrent<T>(scope: Scope, permissions: readonly string[],
    operation: (tx: Prisma.TransactionClient, current: Scope & { projectId: string }) => Promise<T>): Promise<T> {
    try {
      return await this.prisma.$transaction(async tx => {
        const c = await this.workflowCatalogInTransaction(tx, scope, permissions);
        return operation(tx, { ...scope, projectId: c.projectId });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 5000, timeout: 10000 });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException("Workflow execution access unavailable");
    }
  }
  private async workflowCatalogInTransaction(tx: Prisma.TransactionClient, scope: Scope, permissions: readonly string[]) {
    const project = await this.accessInTransaction(tx, scope.memberId, scope.workspaceId, this.publicationPermissions(permissions));
    if (!this.configuration) throw new ServiceUnavailableException("Workflow publication access unavailable");
    await tx.$queryRaw`SELECT id FROM public.scoped_config WHERE scope='project' AND scope_id=${project}
      AND plugin_code='aij-ai' AND config_key=${AI_CENTER_CONFIG_KEY} FOR SHARE`;
    const catalog = await this.configuration.current(tx);
    if (catalog.projectId !== project) throw new ConflictException("Workflow publication conflict");
    return catalog;
  }
  private async owned(tx: Prisma.TransactionClient, member: string, workspace: string, id: string, deleted = false) {
    const rows = await tx.$queryRaw<Row[]>`SELECT * FROM public.ai_personal_workflow
      WHERE id=${id} AND workspace_id=${workspace} AND member_id=${member} FOR UPDATE`;
    if (!rows[0] || (!deleted && rows[0].deleted_at)) throw new NotFoundException("Personal workflow unavailable");
    return rows[0];
  }
  private async resolvePins(tx: Prisma.TransactionClient, member: string, workspace: string, refs: Ref[]): Promise<Pin[]> {
    const resolved = new Map<string, { id: string; agent_id: string; revision: number }>();
    // All mutable Agent rows are locked in a single global order, including repeated refs.
    const agentIds = [...new Set(refs.map(r => r.agentId))].sort();
    for (const id of agentIds) {
      const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM public.ai_personal_agent
        WHERE id=${id} AND workspace_id=${workspace} AND member_id=${member} AND deleted_at IS NULL FOR SHARE`;
      if (!rows.length) throw new NotFoundException("Personal workflow Agent reference unavailable");
    }
    for (const r of refs) {
      const rows = await tx.$queryRaw<{ id: string; agent_id: string; revision: number }[]>`SELECT id,agent_id,revision
        FROM public.ai_personal_agent_version WHERE agent_id=${r.agentId} AND workspace_id=${workspace} AND member_id=${member}
          AND revision=${r.revision} FOR SHARE`;
      if (!rows[0]) throw new NotFoundException("Personal workflow Agent reference unavailable");
      resolved.set(r.nodeId, rows[0]);
    }
    return refs.map(r => ({ ...r, agentVersionId: resolved.get(r.nodeId)!.id }));
  }
  private async version(tx: Prisma.TransactionClient, r: Row, revision = r.revision) {
    const rows = await tx.$queryRaw<Version[]>`SELECT * FROM public.ai_personal_workflow_version
      WHERE workflow_id=${r.id} AND workspace_id=${r.workspace_id} AND member_id=${r.member_id} AND revision=${revision}`;
    if (!rows[0]) throw new NotFoundException("Personal workflow version unavailable");
    const v = rows[0];
    const pins = await tx.$queryRaw<{ node_id: string; agent_id: string; revision: number; agent_version_id: string }[]>`
      SELECT b.node_id,v.agent_id,v.revision,b.agent_version_id FROM public.ai_personal_workflow_agent_binding b
      JOIN public.ai_personal_agent_version v ON v.id=b.agent_version_id AND v.workspace_id=b.workspace_id AND v.member_id=b.member_id
      WHERE b.workflow_version_id=${v.id} AND b.workspace_id=${r.workspace_id} AND b.member_id=${r.member_id} ORDER BY b.node_id ASC`;
    return { id: v.id, workflowId: r.id, code: v.code, name: v.name, graph: v.graph, graphDigest: v.graph_digest,
      revision: v.revision, createdAt: v.created_at.toISOString(), ...draft,
      agentBindings: pins.map(p => ({ nodeId: p.node_id, agentId: p.agent_id, revision: p.revision, agentVersionId: p.agent_version_id })) };
  }
  private async present(tx: Prisma.TransactionClient, r: Row) {
    const v = await this.version(tx, r);
    return { ...summary(r), graph: v.graph, agentBindings: v.agentBindings };
  }
  private async snapshot(tx: Prisma.TransactionClient, r: Row, pins: Pin[]) {
    const id = randomUUID();
    await tx.$executeRaw`INSERT INTO public.ai_personal_workflow_version
      (id,workflow_id,workspace_id,member_id,code,name,graph,graph_digest,content_digest,revision,created_at,agent_binding_count)
      VALUES (${id},${r.id},${r.workspace_id},${r.member_id},${r.code},${r.name},${JSON.stringify(r.graph)}::jsonb,${r.graph_digest},${r.content_digest},${r.revision},${r.updated_at},${pins.length})`;
    for (const p of pins) await tx.$executeRaw`INSERT INTO public.ai_personal_workflow_agent_binding
      (id,workflow_version_id,workspace_id,member_id,node_id,agent_version_id)
      VALUES (${randomUUID()},${id},${r.workspace_id},${r.member_id},${p.nodeId},${p.agentVersionId})`;
  }
  private async audit(tx: Prisma.TransactionClient, r: Row, action: string, correlationId?: string) {
    await tx.auditLog.create({ data: { module: "aij-ai", action, userId: r.member_id, workspaceId: r.workspace_id, status: "success",
      resourceType: "ai_personal_workflow", resourceId: r.id, afterData: { workflowId: r.id, revision: r.revision, action },
      ...(correlationId && /^[A-Za-z0-9._:-]{1,128}$/.test(correlationId) ? { requestSummary: { correlationId } } : {}) } });
  }
  create(member: string, workspace: string, raw: unknown, correlationId?: string) {
    const dto = createPersonalWorkflowDto(raw), hash = digest(dto.name, dto.canonical);
    return this.scope(member, workspace, P.aiAssetsManage, async tx => {
      const prior = await tx.$queryRaw<Row[]>`SELECT * FROM public.ai_personal_workflow
        WHERE workspace_id=${workspace} AND member_id=${member} AND code=${dto.code} FOR UPDATE`;
      if (prior[0]) {
        if (prior[0].deleted_at || prior[0].initial_digest !== hash) throw new ConflictException("Personal workflow code conflict");
        return this.present(tx, prior[0]); // Exact initial request replay returns CURRENT state, never revives a tombstone.
      }
      const counts = await tx.$queryRaw<{ count: bigint }[]>`SELECT count(*) AS count FROM public.ai_personal_workflow
        WHERE workspace_id=${workspace} AND member_id=${member} AND deleted_at IS NULL`;
      if (counts[0].count >= 100n) throw new ConflictException("Personal workflow limit reached");
      const pins = await this.resolvePins(tx, member, workspace, dto.agentRefs);
      const rows = await tx.$queryRaw<Row[]>`INSERT INTO public.ai_personal_workflow
        (id,workspace_id,member_id,code,name,graph,graph_digest,content_digest,initial_digest,revision,created_at,updated_at)
        VALUES (${randomUUID()},${workspace},${member},${dto.code},${dto.name},${dto.canonical}::jsonb,${dto.digest},${hash},${hash},1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) RETURNING *`;
      await this.snapshot(tx, rows[0], pins); await this.audit(tx, rows[0], "personal_workflow_created", correlationId);
      return this.present(tx, rows[0]);
    });
  }
  list(member: string, workspace: string, raw: unknown) {
    const page = personalWorkflowPage(raw);
    return this.scope(member, workspace, P.aiAssetsRead, async tx => {
      const rows = await tx.$queryRaw<SummaryRow[]>`SELECT id,code,name,revision,graph_digest,created_at,updated_at FROM public.ai_personal_workflow
        WHERE workspace_id=${workspace} AND member_id=${member} AND deleted_at IS NULL AND id > ${page.afterId} ORDER BY id ASC LIMIT ${page.limit + 1}`;
      const items = rows.slice(0, page.limit).map(summary);
      return { items, nextCursor: rows.length > page.limit ? items.at(-1)!.id : null };
    });
  }
  get(member: string, workspace: string, id: string) {
    personalWorkflowId(id);
    return this.scope(member, workspace, P.aiAssetsRead, async tx => this.present(tx, await this.owned(tx, member, workspace, id)));
  }
  getVersion(member: string, workspace: string, id: string, revision: string) {
    personalWorkflowId(id); const n = personalWorkflowRevisionParam(revision);
    return this.scope(member, workspace, P.aiAssetsRead, async tx => this.version(tx, await this.owned(tx, member, workspace, id), n));
  }
  versions(member: string, workspace: string, id: string, raw: unknown) {
    personalWorkflowId(id); const page = personalWorkflowPage(raw, true);
    return this.scope(member, workspace, P.aiAssetsRead, async tx => {
      await this.owned(tx, member, workspace, id);
      const rows = await tx.$queryRaw<(Omit<SummaryRow, "updated_at"> & { workflow_id: string })[]>`
        SELECT id,workflow_id,code,name,revision,graph_digest,created_at FROM public.ai_personal_workflow_version
        WHERE workflow_id=${id} AND workspace_id=${workspace} AND member_id=${member} AND revision < ${page.beforeRevision}
        ORDER BY revision DESC LIMIT ${page.limit + 1}`;
      const items = rows.slice(0, page.limit).map(r => ({ id: r.id, workflowId: id, code: r.code, name: r.name, revision: r.revision,
        graphDigest: r.graph_digest, createdAt: r.created_at.toISOString(), ...draft }));
      return { items, nextCursor: rows.length > page.limit ? items.at(-1)!.revision : null };
    });
  }
  update(member: string, workspace: string, id: string, raw: unknown, correlationId?: string) {
    personalWorkflowId(id); const dto = updatePersonalWorkflowDto(raw), hash = digest(dto.name, dto.canonical);
    return this.scope(member, workspace, P.aiAssetsManage, async tx => {
      const previous = await this.owned(tx, member, workspace, id);
      if (previous.revision !== dto.expectedRevision) throw new ConflictException("Personal workflow revision conflict");
      const pins = await this.resolvePins(tx, member, workspace, dto.agentRefs);
      if (previous.content_digest === hash) return this.present(tx, previous);
      if (previous.revision === 2147483647) throw new ConflictException("Personal workflow revision limit reached");
      const rows = await tx.$queryRaw<Row[]>`UPDATE public.ai_personal_workflow SET name=${dto.name},graph=${dto.canonical}::jsonb,
        graph_digest=${dto.digest},content_digest=${hash},revision=revision+1,updated_at=CURRENT_TIMESTAMP
        WHERE id=${id} AND workspace_id=${workspace} AND member_id=${member} AND revision=${dto.expectedRevision} AND deleted_at IS NULL RETURNING *`;
      if (!rows[0]) throw new ConflictException("Personal workflow revision conflict");
      await this.snapshot(tx, rows[0], pins); await this.audit(tx, rows[0], "personal_workflow_updated", correlationId);
      return this.present(tx, rows[0]);
    });
  }
  delete(member: string, workspace: string, id: string, raw: unknown, correlationId?: string) {
    personalWorkflowId(id); const dto = deletePersonalWorkflowDto(raw);
    return this.scope(member, workspace, P.aiAssetsManage, async tx => {
      const row = await this.owned(tx, member, workspace, id, true);
      if (row.revision !== dto.expectedRevision) throw new ConflictException("Personal workflow revision conflict");
      if (row.deleted_at) return { id, revision: row.revision, deleted: true as const };
      const rows = await tx.$queryRaw<Row[]>`UPDATE public.ai_personal_workflow SET deleted_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
        WHERE id=${id} AND workspace_id=${workspace} AND member_id=${member} AND revision=${dto.expectedRevision} AND deleted_at IS NULL RETURNING *`;
      if (!rows[0]) throw new ConflictException("Personal workflow revision conflict");
      await this.audit(tx, rows[0], "personal_workflow_deleted", correlationId);
      return { id, revision: rows[0].revision, deleted: true as const };
    });
  }
}
