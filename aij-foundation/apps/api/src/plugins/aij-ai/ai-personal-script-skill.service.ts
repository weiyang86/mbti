import { BadRequestException, ConflictException, HttpException, Injectable, NotFoundException, Optional, ServiceUnavailableException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { randomUUID } from 'node:crypto';
import { CLIENT_WORKSPACE_PERMISSION as P } from '../../client-workspaces/client-workspace-permissions';
import { createPersonalScriptVersionDto } from './ai-personal-script-skill.dto';
import { PersonalScriptSkillAccess, SCRIPT_POLICY_DIGEST, ScriptRef, ScriptScope, ScriptSkillCurrent,
  SessionGate, scriptOpaqueId, scriptRef, scriptSha256, scriptSource, scriptVersionId } from './ai-personal-script-skill-contract';

type VersionRow = { id: string; project_id: string; workspace_id: string; member_id: string; skill_id: string;
  skill_version_id: string; revision: number; script_source: string; script_digest: string; policy_digest: string };
// New permission codes must be registered as these exact codes in the original P owner by root.
const MANAGE = 'workspace.ai.scripts.manage', EXECUTE = 'workspace.ai.scripts.execute';
const CREATE = [P.aiAssetsManage, MANAGE] as const, SOURCE = [P.aiAssetsRead, MANAGE] as const;
const RUN = [P.aiAssetsRead, P.aiExecute, EXECUTE] as const, READ = [P.aiAssetsRead, P.aiRead, EXECUTE] as const;

@Injectable()
export class AiPersonalScriptSkillService {
  constructor(@Optional() private readonly access?: PersonalScriptSkillAccess,
    @Optional() private readonly prisma?: PrismaService) {}
  private owner(): PersonalScriptSkillAccess {
    if (!this.access) throw new ServiceUnavailableException('Personal script capability unavailable');
    return this.access;
  }
  private scope(memberId: string, workspaceId: string): ScriptScope {
    try { return { memberId: scriptOpaqueId(memberId), workspaceId: scriptOpaqueId(workspaceId) }; }
    catch { throw new BadRequestException('Invalid personal script scope'); }
  }
  private id(raw: string): string {
    try { return scriptVersionId(raw); } catch { throw new BadRequestException('Invalid personal script version ID'); }
  }
  private async safe<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation(); } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException('Personal script capability unavailable');
    }
  }
  createVersion(memberId: string, workspaceId: string, raw: unknown, authorize?: SessionGate): Promise<ScriptRef> {
    const owner = this.owner(), dto = createPersonalScriptVersionDto(raw), scope = this.scope(memberId, workspaceId);
    return this.safe(() => owner.withCurrent(scope, dto.skillId, CREATE, authorize, async (tx, current) => {
      if (current.revision !== dto.expectedRevision || current.revision === 2147483647) throw new ConflictException('Personal Skill revision conflict');
      const next = await owner.appendVersionInTransaction(tx, current,
        { name: dto.name, instructions: dto.instructions, expectedRevision: dto.expectedRevision });
      if (next.skillId !== current.skillId || next.projectId !== current.projectId || next.skillVersionId === current.skillVersionId ||
          next.revision !== current.revision + 1 || next.name !== dto.name || next.instructions !== dto.instructions) {
        throw new ServiceUnavailableException('Personal script version append unavailable');
      }
      const ref = scriptRef({ scriptVersionId: randomUUID(), skillId: next.skillId, skillVersionId: next.skillVersionId,
        revision: next.revision, scriptDigest: scriptSha256(dto.scriptSource), policyDigest: SCRIPT_POLICY_DIGEST });
      await tx.$executeRaw`INSERT INTO public.ai_personal_script_version
        (id,project_id,workspace_id,member_id,skill_id,skill_version_id,revision,script_source,script_digest,policy_digest,created_at)
        VALUES (${ref.scriptVersionId}::uuid,${next.projectId},${scope.workspaceId},${scope.memberId},${ref.skillId},
          ${ref.skillVersionId},${ref.revision},${dto.scriptSource},${ref.scriptDigest},${ref.policyDigest},CURRENT_TIMESTAMP)`;
      if (authorize) await authorize(tx);
      await tx.auditLog.create({ data: { module: 'aij-ai', action: 'personal_script_version_created', userId: scope.memberId,
        workspaceId: scope.workspaceId, status: 'success', resourceType: 'ai_personal_script_version', resourceId: ref.scriptVersionId,
        afterData: { skillId: ref.skillId, skillVersionId: ref.skillVersionId, revision: ref.revision,
          scriptDigest: ref.scriptDigest, policyDigest: ref.policyDigest } } });
      return ref;
    }));
  }
  private async row(tx: Prisma.TransactionClient, scope: ScriptScope, id: string): Promise<VersionRow> {
    const rows = await tx.$queryRaw<VersionRow[]>`SELECT id,project_id,workspace_id,member_id,skill_id,skill_version_id,
      revision,script_source,script_digest,policy_digest FROM public.ai_personal_script_version
      WHERE id=${id}::uuid AND workspace_id=${scope.workspaceId} AND member_id=${scope.memberId}`;
    if (!rows[0]) throw new NotFoundException('Personal script version unavailable');
    return rows[0];
  }
  private verified(row: VersionRow, current: ScriptSkillCurrent) {
    if (row.project_id !== current.projectId || row.skill_id !== current.skillId || row.skill_version_id !== current.skillVersionId ||
        row.revision !== current.revision) throw new ConflictException('Personal script version is no longer current');
    try {
      const source = scriptSource(row.script_source);
      const ref = scriptRef({ scriptVersionId: row.id, skillId: row.skill_id, skillVersionId: row.skill_version_id,
        revision: row.revision, scriptDigest: row.script_digest, policyDigest: row.policy_digest });
      if (scriptSha256(source) !== ref.scriptDigest) throw new Error();
      return { projectId: current.projectId, ref, scriptSource: source };
    } catch { throw new ConflictException('Personal script version integrity conflict'); }
  }
  readVersion(memberId: string, workspaceId: string, scriptVersion: string, authorize?: SessionGate) {
    const scope = this.scope(memberId, workspaceId), id = this.id(scriptVersion), owner = this.owner();
    // Only the access owner opens transactions; immutable lookup does not acquire a competing lock order.
    return this.safe(async () => {
      if (!this.prisma) throw new ServiceUnavailableException('Personal script capability unavailable');
      // Immutable scoped lookup only; all authorization and a second exact lookup happen in the owner TX.
      const lookup = await this.row(this.prisma, scope, id);
      return owner.withCurrent(scope, lookup.skill_id, SOURCE, authorize, async (tx, current) => {
        const row = await this.row(tx, scope, id);
        const resolved = this.verified(row, current);
        return { ref: resolved.ref, scriptSource: resolved.scriptSource };
      });
    });
  }
  resolveInTransaction(tx: Prisma.TransactionClient, scope: ScriptScope, id: string, authorize?: SessionGate) {
    return this.resolve(tx, scope, id, RUN, authorize);
  }
  resolveForReadInTransaction(tx: Prisma.TransactionClient, scope: ScriptScope, id: string, authorize?: SessionGate) {
    return this.resolve(tx, scope, id, READ, authorize);
  }
  private resolve(tx: Prisma.TransactionClient, rawScope: ScriptScope, rawId: string, permissions: readonly string[], authorize?: SessionGate) {
    const scope = this.scope(rawScope.memberId, rawScope.workspaceId), id = this.id(rawId), owner = this.owner();
    return this.safe(async () => {
      const row = await this.row(tx, scope, id);
      const current = await owner.currentInTransaction(tx, scope, row.skill_id, permissions, authorize);
      return this.verified(row, current);
    });
  }
}
