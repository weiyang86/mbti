import { ConflictException, HttpException, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { PrismaService } from "../../prisma/prisma.service";
import { WorkspaceContextService } from "../../client-workspaces/workspace-context.service";
import { CLIENT_WORKSPACE_PERMISSION as P } from "../../client-workspaces/client-workspace-permissions";
import { PluginRuntimeAccessService } from "../../plugin-runtime/plugin-runtime-access.service";
import { AiCenterConfigurationService } from "./ai-center-configuration.service";
import { AI_CENTER_CONFIG_KEY } from "./ai-center-policy";
import { createPersonalAgentDto, updatePersonalAgentDto, deletePersonalAgentDto, personalAgentId,
  personalAgentPage, personalAgentVersionPage, personalAgentObject, type PersonalAgentContent } from "./ai-personal-agents.dto";

type ContentRow = { id: string; workspace_id: string; member_id: string; code: string; name: string;
  instructions: string; enabled: boolean; model_code: string; model_revision: number; catalog_version: number;
  input_fields: string[]; output_format: "text" | "json"; output_fields: string[]; revision: number; created_at: Date };
type AgentRow = ContentRow & { updated_at: Date; deleted_at: Date | null; publication_version: number };
type VersionRow = ContentRow & { agent_id: string };
type Binding = { skillId: string; skillVersionId: string; revision: number };
const summary = (r: AgentRow) => ({ id: r.id, code: r.code, name: r.name, enabled: r.enabled, revision: r.revision,
  createdAt: r.created_at.toISOString(), updatedAt: r.updated_at.toISOString() });
const content = (r: ContentRow, skillBindings: Binding[]): PersonalAgentContent => ({ name: r.name, instructions: r.instructions,
  enabled: r.enabled, modelCode: r.model_code, modelRevision: r.model_revision, catalogVersion: r.catalog_version,
  inputFields: r.input_fields, outputFormat: r.output_format, outputFields: r.output_fields, skillBindings });
const publicAgent = (r: AgentRow, bindings: Binding[]) => ({ ...summary(r), ...content(r, bindings), skillBindings: bindings });

/** Configuration assets only. There is deliberately no execution/provider/Job dependency. */
@Injectable()
export class AiPersonalAgentsService {
  constructor(private readonly prisma: PrismaService, private readonly workspaces: WorkspaceContextService,
    private readonly plugins: PluginRuntimeAccessService, private readonly configuration: AiCenterConfigurationService) {}

  private async scope<T>(member: string, workspace: string, permission: string,
    operation: (tx: Prisma.TransactionClient, project: string) => Promise<T>): Promise<T> {
    try {
      return await this.prisma.$transaction(async tx => {
        const project = await this.plugins.projectId(tx);
        await this.plugins.assertEnabledInTransaction(tx, project, "aij-ai");
        const projects = await tx.$queryRaw<{ id: string }[]>`
          SELECT p.id FROM public.project_profile p JOIN public.organization_profile o ON o.id=p.organization_id
          WHERE p.id=${project} AND p.status='active' AND p.deleted_at IS NULL
            AND o.status='active' AND o.deleted_at IS NULL FOR SHARE OF p,o`;
        const installations = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM public.plugin_installation WHERE project_id=${project} AND plugin_code='aij-ai' AND status='enabled' FOR SHARE`;
        if (!projects.length || !installations.length) throw new NotFoundException("Plugin capability unavailable");
        await this.workspaces.assertWritePermissionInTransaction(tx, member, workspace, permission);
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"ai-personal-agents:" + workspace + ":" + member},0))`;
        // Consistent with publication and runtime: catalog before owned Agent.
        await tx.$queryRaw`SELECT id FROM public.scoped_config WHERE scope='project' AND scope_id=${project}
          AND plugin_code='aij-ai' AND config_key=${AI_CENTER_CONFIG_KEY} FOR SHARE`;
        return operation(tx, project);
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 5000, timeout: 10000 });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException("Personal Agent service unavailable");
    }
  }
  private async catalog(tx: Prisma.TransactionClient, project: string) {
    // Lock the exact catalog row against concurrent edits/disable through commit.
    await tx.$queryRaw`SELECT id FROM public.scoped_config WHERE scope='project' AND scope_id=${project}
      AND plugin_code='aij-ai' AND config_key=${AI_CENTER_CONFIG_KEY} FOR SHARE`;
    return this.configuration.current(tx);
  }
  modelOptions(member: string, workspace: string, query: unknown) {
    personalAgentObject(query, []);
    return this.scope(member, workspace, P.aiAssetsRead, async (tx, project) => {
      const c = await this.catalog(tx, project);
      return { catalogVersion: c.version, items: c.catalog.models.filter(m => m.enabled && m.capability === "text" &&
        c.catalog.providers.some(p => p.code === m.providerCode && p.enabled)).map(m => ({ code: m.code, name: m.name, revision: m.revision, capability: m.capability })) };
    });
  }
  private async validateSave(tx: Prisma.TransactionClient, project: string, member: string, workspace: string, dto: PersonalAgentContent) {
    const c = await this.catalog(tx, project);
    const model = c.catalog.models.find(m => m.code === dto.modelCode && m.revision === dto.modelRevision && m.enabled && m.capability === "text");
    if (dto.catalogVersion !== c.version || !model || !c.catalog.providers.some(p => p.code === model.providerCode && p.enabled &&
      ["openai", "deepseek", "aliyun", "compatible"].includes(p.vendor))) throw new ConflictException("Personal Agent model configuration unavailable");
    const bindings: Binding[] = [];
    // Deterministic lock order; preserve the caller's order in the immutable binding list.
    for (const ref of [...dto.skillBindings].sort((a, b) => a.skillId.localeCompare(b.skillId))) {
      const rows = await tx.$queryRaw<{ skill_id: string; id: string; revision: number; executable: boolean }[]>`
        SELECT s.id AS skill_id,v.id,v.revision, EXISTS(SELECT 1 FROM public.ai_personal_script_version x WHERE x.skill_version_id=v.id) AS executable
        FROM public.ai_personal_skill s JOIN public.ai_personal_skill_version v
          ON v.skill_id=s.id AND v.workspace_id=s.workspace_id AND v.member_id=s.member_id
        WHERE s.id=${ref.skillId} AND s.workspace_id=${workspace} AND s.member_id=${member}
          AND s.deleted_at IS NULL AND v.revision=${ref.revision} FOR SHARE OF s,v`;
      if (!rows[0]) throw new NotFoundException("Personal Agent Skill binding unavailable");
      if (rows[0].executable) throw new ConflictException("Executable Skill binding unavailable");
      bindings.push({ skillId: rows[0].skill_id, skillVersionId: rows[0].id, revision: rows[0].revision });
    }
    return dto.skillBindings.map(ref => bindings.find(b => b.skillId === ref.skillId)!);
  }
  private async owned(tx: Prisma.TransactionClient, member: string, workspace: string, id: string, deleted = false) {
    const rows = await tx.$queryRaw<AgentRow[]>`SELECT * FROM public.ai_personal_agent
      WHERE id=${id} AND workspace_id=${workspace} AND member_id=${member} FOR UPDATE`;
    if (!rows[0] || (!deleted && rows[0].deleted_at)) throw new NotFoundException("Personal Agent unavailable");
    return rows[0];
  }
  private async bindings(tx: Prisma.TransactionClient, versionId: string, workspace: string, member: string): Promise<Binding[]> {
    // History never joins the mutable Skill row and never returns Skill prompt content.
    const rows = await tx.$queryRaw<{ skill_id: string; skill_version_id: string; revision: number }[]>`
      SELECT v.skill_id,b.skill_version_id,v.revision FROM public.ai_personal_agent_skill_binding b
      JOIN public.ai_personal_skill_version v ON v.id=b.skill_version_id AND v.workspace_id=b.workspace_id AND v.member_id=b.member_id
      WHERE b.agent_version_id=${versionId} AND b.workspace_id=${workspace} AND b.member_id=${member} ORDER BY b.position ASC`;
    return rows.map(r => ({ skillId: r.skill_id, skillVersionId: r.skill_version_id, revision: r.revision }));
  }
  private async version(tx: Prisma.TransactionClient, r: AgentRow, revision = r.revision) {
    const rows = await tx.$queryRaw<VersionRow[]>`SELECT * FROM public.ai_personal_agent_version
      WHERE agent_id=${r.id} AND workspace_id=${r.workspace_id} AND member_id=${r.member_id} AND revision=${revision}`;
    if (!rows[0]) throw new ServiceUnavailableException("Personal Agent snapshot unavailable");
    return { row: rows[0], bindings: await this.bindings(tx, rows[0].id, r.workspace_id, r.member_id) };
  }
  private async snapshot(tx: Prisma.TransactionClient, r: AgentRow, bindings: Binding[]) {
    const versionId = randomUUID();
    await tx.$executeRaw`INSERT INTO public.ai_personal_agent_version
      (id,agent_id,workspace_id,member_id,code,name,instructions,enabled,model_code,model_revision,catalog_version,input_fields,output_format,output_fields,revision,created_at,skill_binding_count)
      VALUES (${versionId},${r.id},${r.workspace_id},${r.member_id},${r.code},${r.name},${r.instructions},${r.enabled},${r.model_code},${r.model_revision},${r.catalog_version},
        ${JSON.stringify(r.input_fields)}::jsonb,${r.output_format},${JSON.stringify(r.output_fields)}::jsonb,${r.revision},${r.updated_at},${bindings.length})`;
    for (const [position, b] of bindings.entries()) {
      await tx.$executeRaw`INSERT INTO public.ai_personal_agent_skill_binding (id,agent_version_id,workspace_id,member_id,skill_version_id,position)
        VALUES (${randomUUID()},${versionId},${r.workspace_id},${r.member_id},${b.skillVersionId},${position})`;
    }
  }
  private async audit(tx: Prisma.TransactionClient, r: AgentRow, action: string, correlationId?: string) {
    await tx.auditLog.create({ data: { module: "aij-ai", action, userId: r.member_id, workspaceId: r.workspace_id,
      status: "success", resourceType: "ai_personal_agent", resourceId: r.id,
      afterData: { agentId: r.id, revision: r.revision, action },
      ...(correlationId && /^[A-Za-z0-9._:-]{1,128}$/.test(correlationId) ? { requestSummary: { correlationId } } : {}) } });
  }
  create(member: string, workspace: string, raw: unknown, correlationId?: string) {
    const dto = createPersonalAgentDto(raw);
    return this.scope(member, workspace, P.aiAssetsManage, async (tx, project) => {
      const bindings = await this.validateSave(tx, project, member, workspace, dto);
      const prior = await tx.$queryRaw<AgentRow[]>`SELECT * FROM public.ai_personal_agent
        WHERE workspace_id=${workspace} AND member_id=${member} AND code=${dto.code} FOR UPDATE`;
      if (prior[0]) {
        if (prior[0].deleted_at) throw new ConflictException("Personal Agent code conflicts with initial content");
        const initial = await this.version(tx, prior[0], 1);
        const requested = { ...dto };
        Reflect.deleteProperty(requested, "code");
        if (!isDeepStrictEqual(content(initial.row, initial.bindings), { ...requested, skillBindings: bindings })) {
          throw new ConflictException("Personal Agent code conflicts with initial content");
        }
        return publicAgent(prior[0], (await this.version(tx, prior[0])).bindings);
      }
      const counts = await tx.$queryRaw<{ count: bigint }[]>`SELECT count(*) AS count FROM public.ai_personal_agent
        WHERE workspace_id=${workspace} AND member_id=${member} AND deleted_at IS NULL`;
      if (counts[0].count >= 100n) throw new ConflictException("Personal Agent limit reached");
      const rows = await tx.$queryRaw<AgentRow[]>`INSERT INTO public.ai_personal_agent
        (id,workspace_id,member_id,code,name,instructions,enabled,model_code,model_revision,catalog_version,input_fields,output_format,output_fields,revision,created_at,updated_at)
        VALUES (${randomUUID()},${workspace},${member},${dto.code},${dto.name},${dto.instructions},${dto.enabled},${dto.modelCode},${dto.modelRevision},${dto.catalogVersion},
          ${JSON.stringify(dto.inputFields)}::jsonb,${dto.outputFormat},${JSON.stringify(dto.outputFields)}::jsonb,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) RETURNING *`;
      await this.snapshot(tx, rows[0], bindings); await this.audit(tx, rows[0], "personal_agent_created", correlationId);
      return publicAgent(rows[0], bindings);
    });
  }
  list(member: string, workspace: string, raw: unknown) {
    const page = personalAgentPage(raw);
    return this.scope(member, workspace, P.aiAssetsRead, async tx => {
      const rows = await tx.$queryRaw<AgentRow[]>`SELECT * FROM public.ai_personal_agent WHERE workspace_id=${workspace} AND member_id=${member}
        AND deleted_at IS NULL AND id > ${page.afterId} ORDER BY id ASC LIMIT ${page.limit + 1}`;
      const items = rows.slice(0, page.limit).map(summary);
      return { items, nextCursor: rows.length > page.limit ? items[items.length - 1].id : null };
    });
  }
  get(member: string, workspace: string, id: string) {
    personalAgentId(id);
    return this.scope(member, workspace, P.aiAssetsRead, async tx => {
      const row = await this.owned(tx, member, workspace, id);
      return publicAgent(row, (await this.version(tx, row)).bindings);
    });
  }
  versions(member: string, workspace: string, id: string, raw: unknown) {
    personalAgentId(id); const page = personalAgentVersionPage(raw);
    return this.scope(member, workspace, P.aiAssetsRead, async tx => {
      await this.owned(tx, member, workspace, id);
      const rows = await tx.$queryRaw<VersionRow[]>`SELECT * FROM public.ai_personal_agent_version
        WHERE agent_id=${id} AND workspace_id=${workspace} AND member_id=${member} AND revision < ${page.beforeRevision}
        ORDER BY revision DESC LIMIT ${page.limit + 1}`;
      const items = await Promise.all(rows.slice(0, page.limit).map(async r => {
        const b = await this.bindings(tx, r.id, workspace, member);
        return { id: r.id, agentId: r.agent_id, code: r.code, ...content(r, b), skillBindings: b, revision: r.revision, createdAt: r.created_at.toISOString() };
      }));
      return { items, nextCursor: rows.length > page.limit ? items[items.length - 1].revision : null };
    });
  }
  update(member: string, workspace: string, id: string, raw: unknown, correlationId?: string) {
    personalAgentId(id); const dto = updatePersonalAgentDto(raw);
    return this.scope(member, workspace, P.aiAssetsManage, async (tx, project) => {
      const previous = await this.owned(tx, member, workspace, id);
      if (previous.revision !== dto.expectedRevision) throw new ConflictException("Personal Agent revision conflict");
      const bindings = await this.validateSave(tx, project, member, workspace, dto);
      const requested = { ...dto };
      Reflect.deleteProperty(requested, "expectedRevision");
      if (isDeepStrictEqual(content(previous, (await this.version(tx, previous)).bindings), { ...requested, skillBindings: bindings })) return publicAgent(previous, bindings);
      if (previous.revision === 2147483647 || previous.publication_version === 2147483647) throw new ConflictException("Personal Agent revision limit reached");
      const rows = await tx.$queryRaw<AgentRow[]>`UPDATE public.ai_personal_agent SET name=${dto.name},instructions=${dto.instructions},enabled=${dto.enabled},
        model_code=${dto.modelCode},model_revision=${dto.modelRevision},catalog_version=${dto.catalogVersion},input_fields=${JSON.stringify(dto.inputFields)}::jsonb,
        output_format=${dto.outputFormat},output_fields=${JSON.stringify(dto.outputFields)}::jsonb,revision=revision+1,
        published_revision=NULL,publication_version=publication_version+1,updated_at=CURRENT_TIMESTAMP
        WHERE id=${id} AND workspace_id=${workspace} AND member_id=${member} AND revision=${dto.expectedRevision} AND deleted_at IS NULL RETURNING *`;
      if (!rows[0]) throw new ConflictException("Personal Agent revision conflict");
      await this.snapshot(tx, rows[0], bindings); await this.audit(tx, rows[0], "personal_agent_updated", correlationId);
      return publicAgent(rows[0], bindings);
    });
  }
  delete(member: string, workspace: string, id: string, raw: unknown, correlationId?: string) {
    personalAgentId(id); const dto = deletePersonalAgentDto(raw);
    return this.scope(member, workspace, P.aiAssetsManage, async tx => {
      const row = await this.owned(tx, member, workspace, id, true);
      if (row.deleted_at) return { id, revision: row.revision, deleted: true as const };
      if (row.revision !== dto.expectedRevision) throw new ConflictException("Personal Agent revision conflict");
      if (row.publication_version === 2147483647) throw new ConflictException("Personal Agent publication limit reached");
      const rows = await tx.$queryRaw<AgentRow[]>`UPDATE public.ai_personal_agent SET deleted_at=CURRENT_TIMESTAMP,
        published_revision=NULL,publication_version=publication_version+1,updated_at=CURRENT_TIMESTAMP
        WHERE id=${id} AND workspace_id=${workspace} AND member_id=${member} AND revision=${dto.expectedRevision} AND deleted_at IS NULL RETURNING *`;
      if (!rows[0]) throw new ConflictException("Personal Agent revision conflict");
      await this.audit(tx, rows[0], "personal_agent_deleted", correlationId);
      return { id, revision: rows[0].revision, deleted: true as const };
    });
  }
}
