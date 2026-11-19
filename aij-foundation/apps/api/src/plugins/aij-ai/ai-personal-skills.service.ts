import { ConflictException, ForbiddenException, HttpException, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../../prisma/prisma.service";
import { WorkspaceContextService } from "../../client-workspaces/workspace-context.service";
import { CLIENT_WORKSPACE_PERMISSION as P } from "../../client-workspaces/client-workspace-permissions";
import { PluginRuntimeAccessService } from "../../plugin-runtime/plugin-runtime-access.service";
import { createPersonalSkillDto, updatePersonalSkillDto, deletePersonalSkillDto, personalSkillId,
  personalSkillPage, personalSkillVersionPage } from "./ai-personal-skills.dto";

import type { ScriptScope, ScriptSkillCurrent, SessionGate } from "./ai-personal-script-skill-contract";

type SkillRow = { id: string; workspace_id: string; member_id: string; code: string; name: string;
  instructions: string; revision: number; created_at: Date; updated_at: Date; deleted_at: Date | null };
type VersionRow = { id: string; skill_id: string; workspace_id: string; member_id: string; code: string;
  name: string; instructions: string; revision: number; created_at: Date };
const summary = (r: SkillRow) => ({ id: r.id, code: r.code, name: r.name, revision: r.revision,
  createdAt: r.created_at.toISOString(), updatedAt: r.updated_at.toISOString() });
const publicSkill = (r: SkillRow) => ({ ...summary(r), instructions: r.instructions });

@Injectable()
export class AiPersonalSkillsService {
  private readonly scriptContexts = new WeakMap<object, { current: ScriptSkillCurrent; row: SkillRow }>();
  constructor(private readonly prisma: PrismaService, private readonly workspaces: WorkspaceContextService,
    private readonly plugins: PluginRuntimeAccessService) {}

  private async scope<T>(memberId: string, workspaceId: string, permission: string,
    operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.transaction(async tx => {
      await this.accessInTransaction(tx, memberId, workspaceId, [permission]);
      return operation(tx);
    });
  }
  private async transaction<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    try {
      return await this.prisma.$transaction(operation,
        { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 5000, timeout: 10000 });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException("Personal Skill service unavailable");
    }
  }

  private async accessInTransaction(tx: Prisma.TransactionClient, memberId: string, workspaceId: string, permissions: readonly string[], lockSkill = true) {
    const allowed: readonly string[] = [P.aiAssetsRead, P.aiAssetsManage, P.aiRead, P.aiExecute, P.aiScriptsManage, P.aiScriptsExecute];
    if (!permissions.length || permissions.length > 3 || new Set(permissions).size !== permissions.length || permissions.some(p => !allowed.includes(p)))
      throw new ForbiddenException("Personal Skill access denied");
        const projectId = await this.plugins.projectId(tx);
        await this.plugins.assertEnabledInTransaction(tx, projectId, "aij-ai");
        // Recompute lifecycle under row locks as well as the lifecycle advisory fence.
        const projects = await tx.$queryRaw<{ id: string }[]>`
          SELECT p.id FROM public.project_profile p JOIN public.organization_profile o ON o.id=p.organization_id
          WHERE p.id=${projectId} AND p.status='active' AND p.deleted_at IS NULL
            AND o.status='active' AND o.deleted_at IS NULL FOR SHARE OF p,o`;
        const plugins = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM public.plugin_installation WHERE project_id=${projectId} AND plugin_code='aij-ai'
            AND status='enabled' FOR SHARE`;
        if (!projects.length || !plugins.length) throw new NotFoundException("Plugin capability unavailable");
        for (const permission of permissions) await this.workspaces.assertWritePermissionInTransaction(tx, memberId, workspaceId, permission);
        // Serializes quota, code replay and asset CAS; always after the shared membership fence.
        if (lockSkill) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"ai-personal-skills:" + workspaceId + ":" + memberId}, 0))`;
    return projectId;
  }
  /** Same original authorization owner; execution acquires Job/run locks before Skill locks. */
  async scriptRunWithCurrent<T>(memberId: string, workspaceId: string, permissions: readonly string[],
    operation: (tx: Prisma.TransactionClient, scope: ScriptScope & { projectId: string }) => Promise<T>): Promise<T> {
    return this.transaction(async tx => {
      const projectId = await this.accessInTransaction(tx, memberId, workspaceId, permissions, false);
      return operation(tx, { projectId, memberId, workspaceId });
    });
  }
  /** Trusted executable-extension adapter; original lifecycle, locks, head/version and audit stay here. */
  async currentInTransaction(tx: Prisma.TransactionClient, scope: ScriptScope, skillId: string, permissions: readonly string[], authorize?: SessionGate): Promise<ScriptSkillCurrent> {
    personalSkillId(skillId);
    const projectId = await this.accessInTransaction(tx, scope.memberId, scope.workspaceId, permissions);
    const row = await this.owned(tx, scope.memberId, scope.workspaceId, skillId);
    const versions = await tx.$queryRaw<VersionRow[]>`SELECT * FROM public.ai_personal_skill_version
      WHERE skill_id=${row.id} AND workspace_id=${row.workspace_id} AND member_id=${row.member_id} AND revision=${row.revision} FOR SHARE`;
    const v = versions[0];
    if (!v || v.name !== row.name || v.instructions !== row.instructions || v.code !== row.code)
      throw new ConflictException("Personal Skill version unavailable");
    if (authorize) await authorize(tx);
    // Database insertion guard binds the trusted adapter's actual runtime project.
    await tx.$queryRaw`SELECT set_config('aij.script_project_id', ${projectId}, true)`;
    const current = Object.freeze({ projectId, skillId: row.id, skillVersionId: v.id, revision: row.revision, name: row.name, instructions: row.instructions });
    this.scriptContexts.set(tx, { current, row });
    return current;
  }
  async withCurrent<T>(scope: ScriptScope, skillId: string, permissions: readonly string[], authorize: SessionGate | undefined,
    operation: (tx: Prisma.TransactionClient, current: ScriptSkillCurrent) => Promise<T>): Promise<T> {
    return this.transaction(async tx => operation(tx, await this.currentInTransaction(tx, scope, skillId, permissions, authorize)));
  }

  async appendVersionInTransaction(tx: Prisma.TransactionClient, current: ScriptSkillCurrent,
    content: { name: string; instructions: string; expectedRevision: number }): Promise<ScriptSkillCurrent> {
    const context = this.scriptContexts.get(tx);
    if (!context || context.current !== current || current.revision !== content.expectedRevision || current.revision === 2147483647)
      throw new ConflictException("Personal Skill revision conflict");
    const dto = updatePersonalSkillDto(content), previous = context.row;
    const rows = await tx.$queryRaw<SkillRow[]>`UPDATE public.ai_personal_skill
      SET name=${dto.name},instructions=${dto.instructions},revision=revision+1,updated_at=CURRENT_TIMESTAMP
      WHERE id=${previous.id} AND workspace_id=${previous.workspace_id} AND member_id=${previous.member_id}
        AND revision=${dto.expectedRevision} AND deleted_at IS NULL RETURNING *`;
    if (!rows[0]) throw new ConflictException("Personal Skill revision conflict");
    const next = rows[0], skillVersionId = await this.snapshot(tx, next);
    await this.audit(tx, next, "personal_skill_updated", ["name", "instructions", "revision"]);
    this.scriptContexts.delete(tx);
    return Object.freeze({ projectId: current.projectId, skillId: next.id, skillVersionId, revision: next.revision, name: next.name, instructions: next.instructions });
  }
  private async owned(tx: Prisma.TransactionClient, memberId: string, workspaceId: string, id: string, deleted = false) {
    const rows = await tx.$queryRaw<SkillRow[]>`
      SELECT * FROM public.ai_personal_skill WHERE id=${id} AND workspace_id=${workspaceId} AND member_id=${memberId} FOR UPDATE`;
    const row = rows[0];
    if (!row || (!deleted && row.deleted_at)) throw new NotFoundException("Personal Skill unavailable");
    return row;
  }
  private async snapshot(tx: Prisma.TransactionClient, r: SkillRow) {
    const versionId = randomUUID();
    await tx.$executeRaw`
      INSERT INTO public.ai_personal_skill_version (id,skill_id,workspace_id,member_id,code,name,instructions,revision,created_at)
      VALUES (${versionId},${r.id},${r.workspace_id},${r.member_id},${r.code},${r.name},${r.instructions},${r.revision},${r.updated_at})`;
    return versionId;
  }
  private async audit(tx: Prisma.TransactionClient, row: SkillRow, action: string, fields: string[]) {
    // Member actor convention matches client-workspaces; no names, prompt, headers, or raw request data.
    await tx.auditLog.create({ data: { module: "aij-ai", action, userId: row.member_id,
      workspaceId: row.workspace_id, status: "success", resourceType: "ai_personal_skill", resourceId: row.id,
      afterData: { skillId: row.id, revision: row.revision, fields } } });
  }

  create(memberId: string, workspaceId: string, raw: unknown) {
    const dto = createPersonalSkillDto(raw);
    return this.scope(memberId, workspaceId, P.aiAssetsManage, async tx => {
      const previous = await tx.$queryRaw<SkillRow[]>`
        SELECT * FROM public.ai_personal_skill WHERE workspace_id=${workspaceId} AND member_id=${memberId} AND code=${dto.code} FOR UPDATE`;
      if (previous[0]) {
        const row = previous[0];
        const first = await tx.$queryRaw<VersionRow[]>`
          SELECT * FROM public.ai_personal_skill_version WHERE skill_id=${row.id} AND workspace_id=${workspaceId}
            AND member_id=${memberId} AND revision=1`;
        if (row.deleted_at || !first[0] || first[0].name !== dto.name || first[0].instructions !== dto.instructions) {
          throw new ConflictException("Personal Skill code conflicts with initial content");
        }
        return publicSkill(row);
      }
      const counts = await tx.$queryRaw<{ count: bigint }[]>`
        SELECT count(*) AS count FROM public.ai_personal_skill WHERE workspace_id=${workspaceId} AND member_id=${memberId} AND deleted_at IS NULL`;
      if (counts[0].count >= 100n) throw new ConflictException("Personal Skill limit reached");
      const rows = await tx.$queryRaw<SkillRow[]>`
        INSERT INTO public.ai_personal_skill (id,workspace_id,member_id,code,name,instructions,revision,created_at,updated_at)
        VALUES (${randomUUID()},${workspaceId},${memberId},${dto.code},${dto.name},${dto.instructions},1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) RETURNING *`;
      const row = rows[0];
      await this.snapshot(tx, row);
      await this.audit(tx, row, "personal_skill_created", ["code", "name", "instructions", "revision"]);
      return publicSkill(row);
    });
  }
  list(memberId: string, workspaceId: string, raw: unknown) {
    const page = personalSkillPage(raw);
    return this.scope(memberId, workspaceId, P.aiAssetsRead, async tx => {
      const rows = await tx.$queryRaw<SkillRow[]>`
        SELECT * FROM public.ai_personal_skill WHERE workspace_id=${workspaceId} AND member_id=${memberId}
          AND deleted_at IS NULL AND id > ${page.afterId ?? ""} ORDER BY id ASC LIMIT ${page.limit + 1}`;
      const items = rows.slice(0, page.limit).map(summary);
      return { items, nextCursor: rows.length > page.limit ? items[items.length - 1].id : null };
    });
  }
  get(memberId: string, workspaceId: string, id: string) {
    personalSkillId(id);
    return this.scope(memberId, workspaceId, P.aiAssetsRead, async tx => publicSkill(await this.owned(tx, memberId, workspaceId, id)));
  }
  versions(memberId: string, workspaceId: string, id: string, raw: unknown) {
    personalSkillId(id);
    const page = personalSkillVersionPage(raw);
    return this.scope(memberId, workspaceId, P.aiAssetsRead, async tx => {
      await this.owned(tx, memberId, workspaceId, id);
      const rows = await tx.$queryRaw<VersionRow[]>`
        SELECT * FROM public.ai_personal_skill_version WHERE skill_id=${id} AND workspace_id=${workspaceId} AND member_id=${memberId}
          AND revision <= ${page.beforeRevision === undefined ? 2147483647 : page.beforeRevision - 1} ORDER BY revision DESC LIMIT ${page.limit + 1}`;
      const items = rows.slice(0, page.limit).map(r => ({ id: r.id, skillId: r.skill_id, code: r.code, name: r.name,
        instructions: r.instructions, revision: r.revision, createdAt: r.created_at.toISOString() }));
      return { items, nextCursor: rows.length > page.limit ? items[items.length - 1].revision : null };
    });
  }
  update(memberId: string, workspaceId: string, id: string, raw: unknown) {
    personalSkillId(id);
    const dto = updatePersonalSkillDto(raw);
    return this.scope(memberId, workspaceId, P.aiAssetsManage, async tx => {
      const previous = await this.owned(tx, memberId, workspaceId, id);
      if (previous.revision !== dto.expectedRevision) throw new ConflictException("Personal Skill revision conflict");
      const fields = (["name", "instructions"] as const).filter(key => previous[key] !== dto[key]);
      if (!fields.length) return publicSkill(previous);
      if (previous.revision === 2147483647) throw new ConflictException("Personal Skill revision limit reached");
      const rows = await tx.$queryRaw<SkillRow[]>`
        UPDATE public.ai_personal_skill SET name=${dto.name},instructions=${dto.instructions},revision=revision+1,updated_at=CURRENT_TIMESTAMP
        WHERE id=${id} AND workspace_id=${workspaceId} AND member_id=${memberId} AND revision=${dto.expectedRevision} AND deleted_at IS NULL RETURNING *`;
      if (!rows[0]) throw new ConflictException("Personal Skill revision conflict");
      await this.snapshot(tx, rows[0]);
      await this.audit(tx, rows[0], "personal_skill_updated", [...fields, "revision"]);
      return publicSkill(rows[0]);
    });
  }
  delete(memberId: string, workspaceId: string, id: string, raw: unknown) {
    personalSkillId(id);
    const dto = deletePersonalSkillDto(raw);
    return this.scope(memberId, workspaceId, P.aiAssetsManage, async tx => {
      const previous = await this.owned(tx, memberId, workspaceId, id, true);
      if (previous.deleted_at) return { id, revision: previous.revision, deleted: true as const };
      if (previous.revision !== dto.expectedRevision) throw new ConflictException("Personal Skill revision conflict");
      const rows = await tx.$queryRaw<SkillRow[]>`
        UPDATE public.ai_personal_skill SET deleted_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
        WHERE id=${id} AND workspace_id=${workspaceId} AND member_id=${memberId} AND revision=${dto.expectedRevision} AND deleted_at IS NULL RETURNING *`;
      if (!rows[0]) throw new ConflictException("Personal Skill revision conflict");
      await this.audit(tx, rows[0], "personal_skill_deleted", ["deletedAt"]);
      return { id, revision: rows[0].revision, deleted: true as const };
    });
  }
}
