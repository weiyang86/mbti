import { ConflictException, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { createPersonalMemoryDto, type PersonalMemoryKind } from './ai-personal-memories.dto';

/** The only memory metadata permitted in a durable Agent snapshot. */
export type PersonalAgentMemoryRef = Readonly<{ memoryId: string; revision: number }>;
/** RAM only: never pass this value to Run/Job/Trace/audit persistence. */
export type PersonalAgentMemoryContext = readonly Readonly<{ title: string; content: string; kind: PersonalMemoryKind }>[];
type Row = { id: string; revision: number; title: string; content: string; kind: PersonalMemoryKind };
const unavailable = (): never => { throw new ConflictException('Personal Agent memory unavailable'); };

@Injectable()
export class AiPersonalAgentMemoryContextService {
  private refs(raw: unknown): readonly PersonalAgentMemoryRef[] {
    // Absent means NONE for every old queued snapshot; it must never trigger reselection.
    if (raw === undefined) return [];
    if (!Array.isArray(raw) || raw.length < 1 || raw.length > 8) return unavailable();
    let previous = '';
    for (const ref of raw) {
      if (!ref || typeof ref !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(ref)) ||
        Reflect.ownKeys(ref).length !== 2 || !Object.hasOwn(ref, 'memoryId') || !Object.hasOwn(ref, 'revision') ||
        typeof ref.memoryId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(ref.memoryId) || ref.memoryId <= previous ||
        !Number.isInteger(ref.revision) || ref.revision < 1 || ref.revision > 2147483647) return unavailable();
      previous = ref.memoryId;
    }
    return raw;
  }
  private context(rows: Row[]): PersonalAgentMemoryContext {
    if (rows.length > 8) return unavailable();
    return rows.map(row => {
      // Reuse AF163's exact title/content/UTF-8/kind limits, without persisting another copy.
      try {
        const value = createPersonalMemoryDto({ code: 'runtime-memory', title: row.title, content: row.content,
          kind: row.kind, enabled: true });
        if (!Number.isInteger(row.revision) || row.revision < 1 || row.revision > 2147483647) return unavailable();
        return { title: value.title, content: value.content, kind: value.kind };
      } catch { return unavailable(); }
    });
  }
  private async fence(tx: Prisma.TransactionClient, member: string, workspace: string) {
    // Same owner lock as AF163 CRUD: fences phantom enables/new grants as well as body edits.
    // Caller already holds lifecycle/member and (at dispatch) Job -> Run locks.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'ai-personal-memories:' + workspace + ':' + member},0))`;
  }
  private async grant(tx: Prisma.TransactionClient, member: string, workspace: string, agent: string, memory: string) {
    // Separate query AFTER Memory locks avoids planner-dependent Grant -> Memory lock inversion.
    const grants = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM public.ai_personal_memory_agent_grant
      WHERE memory_id=${memory} AND workspace_id=${workspace} AND member_id=${member} AND agent_id=${agent} FOR SHARE`;
    if (grants.length !== 1) return unavailable();
  }
  /** New admission only, BEFORE the base Agent resolver takes any Agent row lock. */
  async select(tx: Prisma.TransactionClient, member: string, workspace: string, agent: string) {
    await this.fence(tx, member, workspace);
    const rows = await tx.$queryRaw<Row[]>`SELECT m.id,m.revision,m.title,m.content,m.kind FROM public.ai_personal_memory m
      WHERE m.workspace_id=${workspace} AND m.member_id=${member} AND m.enabled=true AND m.deleted_at IS NULL
      AND EXISTS (SELECT 1 FROM public.ai_personal_memory_agent_grant g WHERE g.memory_id=m.id
        AND g.workspace_id=m.workspace_id AND g.member_id=m.member_id AND g.agent_id=${agent})
      ORDER BY m.id COLLATE "C" ASC LIMIT 9 FOR SHARE OF m`;
    if (rows.length > 8) return unavailable();
    const refs = rows.map(row => ({ memoryId: row.id, revision: row.revision }));
    if (refs.length) this.refs(refs);
    const context = this.context(rows);
    for (const ref of refs) await this.grant(tx, member, workspace, agent, ref.memoryId);
    return { refs, context };
  }
  /** Exact admitted references only; never swap versions or add later enabled memories. */
  async revalidate(tx: Prisma.TransactionClient, member: string, workspace: string, agent: string, raw: unknown): Promise<PersonalAgentMemoryContext> {
    const refs = this.refs(raw);
    if (!refs.length) return [];
    await this.fence(tx, member, workspace);
    const rows: Row[] = [];
    for (const ref of refs) {
      const found = await tx.$queryRaw<Row[]>`SELECT m.id,m.revision,m.title,m.content,m.kind FROM public.ai_personal_memory m
        WHERE m.id=${ref.memoryId} AND m.workspace_id=${workspace} AND m.member_id=${member} AND m.revision=${ref.revision}
        AND m.enabled=true AND m.deleted_at IS NULL FOR SHARE OF m`;
      if (found.length !== 1) return unavailable();
      rows.push(found[0]);
    }
    for (const ref of refs) await this.grant(tx, member, workspace, agent, ref.memoryId);
    return this.context(rows);
  }
}
