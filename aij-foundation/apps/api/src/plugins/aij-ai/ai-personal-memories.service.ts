import { ConflictException, HttpException, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { PrismaService } from "../../prisma/prisma.service";
import { WorkspaceContextService } from "../../client-workspaces/workspace-context.service";
import { CLIENT_WORKSPACE_PERMISSION as P } from "../../client-workspaces/client-workspace-permissions";
import { PluginRuntimeAccessService } from "../../plugin-runtime/plugin-runtime-access.service";
import { createPersonalMemoryDto, updatePersonalMemoryDto, deletePersonalMemoryDto, personalMemoryId,
  personalMemoryPage, type PersonalMemoryContent, type PersonalMemoryKind } from "./ai-personal-memories.dto";

type MemoryRow = { id: string; workspace_id: string; member_id: string; code: string; title: string | null;
  content: string | null; kind: PersonalMemoryKind | null; enabled: boolean | null; initial_digest: string | null;
  revision: number; created_at: Date; updated_at: Date; deleted_at: Date | null };
type SummaryRow = Pick<MemoryRow, "id" | "code" | "title" | "kind" | "enabled" | "revision" | "created_at" | "updated_at">;
const summary = (r: SummaryRow) => ({ id: r.id, code: r.code, title: r.title!, kind: r.kind!, enabled: r.enabled!,
  revision: r.revision, createdAt: r.created_at.toISOString(), updatedAt: r.updated_at.toISOString() });
const content = (r: MemoryRow, agentIds: string[]): PersonalMemoryContent => ({ title: r.title!, content: r.content!, kind: r.kind!, enabled: r.enabled!, agentIds });
// Fixed tuple avoids object-order replay differences. Only the digest of initial content is retained while active.
const digest = (c: PersonalMemoryContent) => createHash("sha256").update(JSON.stringify([c.title, c.content, c.kind, c.enabled, c.agentIds])).digest("hex");

/** Explicitly managed private assets. No history, automatic capture, execution or runtime memory injection. */
@Injectable()
export class AiPersonalMemoriesService {
  constructor(private readonly prisma: PrismaService, private readonly workspaces: WorkspaceContextService,
    private readonly plugins: PluginRuntimeAccessService) {}

  private async scope<T>(member: string, workspace: string, permission: string, operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    try {
      return await this.prisma.$transaction(async tx => {
        const project = await this.plugins.projectId(tx);
        await this.plugins.assertEnabledInTransaction(tx, project, "aij-ai");
        const projects = await tx.$queryRaw<{ id: string }[]>`
          SELECT p.id FROM public.project_profile p JOIN public.organization_profile o ON o.id=p.organization_id
          WHERE p.id=${project} AND p.status='active' AND p.deleted_at IS NULL AND o.status='active' AND o.deleted_at IS NULL FOR SHARE OF p,o`;
        const installations = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM public.plugin_installation WHERE project_id=${project} AND plugin_code='aij-ai' AND status='enabled' FOR SHARE`;
        if (!projects.length || !installations.length) throw new NotFoundException("Plugin capability unavailable");
        await this.workspaces.assertWritePermissionInTransaction(tx, member, workspace, permission);
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"ai-personal-memories:" + workspace + ":" + member},0))`;
        return operation(tx);
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 5000, timeout: 10000 });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException("Personal memory service unavailable");
    }
  }
  private async owned(tx: Prisma.TransactionClient, member: string, workspace: string, id: string, deleted = false) {
    const rows = await tx.$queryRaw<MemoryRow[]>`SELECT * FROM public.ai_personal_memory
      WHERE id=${id} AND workspace_id=${workspace} AND member_id=${member} FOR UPDATE`;
    if (!rows[0] || (!deleted && rows[0].deleted_at)) throw new NotFoundException("Personal memory unavailable");
    return rows[0];
  }
  private async grants(tx: Prisma.TransactionClient, r: MemoryRow): Promise<string[]> {
    const rows = await tx.$queryRaw<{ agent_id: string }[]>`SELECT agent_id FROM public.ai_personal_memory_agent_grant
      WHERE memory_id=${r.id} AND workspace_id=${r.workspace_id} AND member_id=${r.member_id} ORDER BY agent_id ASC`;
    return rows.map(r => r.agent_id).sort();
  }
  private async validateAgents(tx: Prisma.TransactionClient, member: string, workspace: string, ids: string[]) {
    // Canonical order plus shared row locks fence Agent tombstones until this save commits.
    for (const id of ids) {
      const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM public.ai_personal_agent
        WHERE id=${id} AND workspace_id=${workspace} AND member_id=${member} AND deleted_at IS NULL FOR SHARE`;
      if (!rows[0]) throw new NotFoundException("Personal memory Agent unavailable");
    }
  }
  private async replaceGrants(tx: Prisma.TransactionClient, r: MemoryRow, ids: string[]) {
    await tx.$executeRaw`DELETE FROM public.ai_personal_memory_agent_grant WHERE memory_id=${r.id} AND workspace_id=${r.workspace_id} AND member_id=${r.member_id}`;
    for (const id of ids) await tx.$executeRaw`INSERT INTO public.ai_personal_memory_agent_grant (id,memory_id,workspace_id,member_id,agent_id)
      VALUES (${randomUUID()},${r.id},${r.workspace_id},${r.member_id},${id})`;
  }
  private async audit(tx: Prisma.TransactionClient, r: MemoryRow, action: string) {
    // Deliberately exclude all submitted text, names, code, grant refs and caller correlation metadata.
    await tx.auditLog.create({ data: { module: "aij-ai", action, userId: r.member_id, workspaceId: r.workspace_id,
      status: "success", resourceType: "ai_personal_memory", resourceId: r.id, afterData: { revision: r.revision, action } } });
  }
  create(member: string, workspace: string, raw: unknown) {
    const dto = createPersonalMemoryDto(raw);
    return this.scope(member, workspace, P.aiAssetsManage, async tx => {
      const prior = await tx.$queryRaw<MemoryRow[]>`SELECT * FROM public.ai_personal_memory
        WHERE workspace_id=${workspace} AND member_id=${member} AND code=${dto.code} FOR UPDATE`;
      if (prior[0]) {
        if (prior[0].deleted_at || prior[0].initial_digest !== digest(dto)) throw new ConflictException("Personal memory code conflict");
        // Replays never restore initial grants or bypass current Agent validation.
        const ids = await this.grants(tx, prior[0]);
        await this.validateAgents(tx, member, workspace, dto.agentIds);
        return { ...summary(prior[0]), ...content(prior[0], ids) };
      }
      await this.validateAgents(tx, member, workspace, dto.agentIds);
      const counts = await tx.$queryRaw<{ count: bigint }[]>`SELECT count(*) AS count FROM public.ai_personal_memory
        WHERE workspace_id=${workspace} AND member_id=${member} AND deleted_at IS NULL`;
      if (counts[0].count >= 200n) throw new ConflictException("Personal memory limit reached");
      const rows = await tx.$queryRaw<MemoryRow[]>`INSERT INTO public.ai_personal_memory
        (id,workspace_id,member_id,code,title,content,kind,enabled,initial_digest,revision,created_at,updated_at)
        VALUES (${randomUUID()},${workspace},${member},${dto.code},${dto.title},${dto.content},${dto.kind},${dto.enabled},${digest(dto)},1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) RETURNING *`;
      await this.replaceGrants(tx, rows[0], dto.agentIds); await this.audit(tx, rows[0], "personal_memory_created");
      return { ...summary(rows[0]), ...content(rows[0], dto.agentIds) };
    });
  }
  list(member: string, workspace: string, raw: unknown) {
    const page = personalMemoryPage(raw);
    return this.scope(member, workspace, P.aiAssetsRead, async tx => {
      // Never select memory content on the list path.
      const rows = await tx.$queryRaw<SummaryRow[]>`SELECT id,code,title,kind,enabled,revision,created_at,updated_at FROM public.ai_personal_memory
        WHERE workspace_id=${workspace} AND member_id=${member} AND deleted_at IS NULL AND id > ${page.afterId} ORDER BY id ASC LIMIT ${page.limit + 1}`;
      const items = rows.slice(0, page.limit).map(summary);
      return { items, nextCursor: rows.length > page.limit ? items[items.length - 1].id : null };
    });
  }
  get(member: string, workspace: string, id: string) {
    personalMemoryId(id);
    return this.scope(member, workspace, P.aiAssetsRead, async tx => {
      const row = await this.owned(tx, member, workspace, id);
      return { ...summary(row), ...content(row, await this.grants(tx, row)) };
    });
  }
  update(member: string, workspace: string, id: string, raw: unknown) {
    personalMemoryId(id); const dto = updatePersonalMemoryDto(raw);
    return this.scope(member, workspace, P.aiAssetsManage, async tx => {
      const previous = await this.owned(tx, member, workspace, id);
      if (previous.revision !== dto.expectedRevision) throw new ConflictException("Personal memory revision conflict");
      await this.validateAgents(tx, member, workspace, dto.agentIds);
      const requested: PersonalMemoryContent = { title: dto.title, content: dto.content, kind: dto.kind, enabled: dto.enabled, agentIds: dto.agentIds };
      if (isDeepStrictEqual(content(previous, await this.grants(tx, previous)), requested)) return { ...summary(previous), ...requested };
      if (previous.revision === 2147483647) throw new ConflictException("Personal memory revision limit reached");
      const rows = await tx.$queryRaw<MemoryRow[]>`UPDATE public.ai_personal_memory SET title=${dto.title},content=${dto.content},kind=${dto.kind},enabled=${dto.enabled},
        revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=${id} AND workspace_id=${workspace} AND member_id=${member}
        AND revision=${dto.expectedRevision} AND deleted_at IS NULL RETURNING *`;
      if (!rows[0]) throw new ConflictException("Personal memory revision conflict");
      await this.replaceGrants(tx, rows[0], dto.agentIds); await this.audit(tx, rows[0], "personal_memory_updated");
      return { ...summary(rows[0]), ...requested };
    });
  }
  delete(member: string, workspace: string, id: string, raw: unknown) {
    personalMemoryId(id); const dto = deletePersonalMemoryDto(raw);
    return this.scope(member, workspace, P.aiAssetsManage, async tx => {
      const row = await this.owned(tx, member, workspace, id, true);
      if (row.deleted_at) return { id, revision: row.revision, deleted: true as const };
      if (row.revision !== dto.expectedRevision) throw new ConflictException("Personal memory revision conflict");
      if (row.revision === 2147483647) throw new ConflictException("Personal memory revision limit reached");
      await this.replaceGrants(tx, row, []);
      const rows = await tx.$queryRaw<MemoryRow[]>`UPDATE public.ai_personal_memory SET title=NULL,content=NULL,kind=NULL,enabled=NULL,initial_digest=NULL,
        revision=revision+1,deleted_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
        WHERE id=${id} AND workspace_id=${workspace} AND member_id=${member} AND revision=${dto.expectedRevision} AND deleted_at IS NULL RETURNING *`;
      if (!rows[0]) throw new ConflictException("Personal memory revision conflict");
      await this.audit(tx, rows[0], "personal_memory_deleted");
      return { id, revision: rows[0].revision, deleted: true as const };
    });
  }
}
