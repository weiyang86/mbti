import { BadRequestException, ConflictException, ForbiddenException, GoneException, HttpException, Injectable, NotFoundException, Optional, ServiceUnavailableException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { ClientClaims } from '../../client-auth/client-auth.security';
import { JobService } from '../../async-runtime/job.service';
import { canonical, digest, exact, identifier, requestHash, requestKey, SCRIPT_JOB, ScriptArtifact, ScriptOutcome, ScriptRef, ScriptRun, scriptRef, uuid, outputBytes } from './ai-personal-script-run-profile';
import type { GeneratedFileTicket, GeneratedFileScope, GeneratedFileMetadata } from '../../files/generated-file-assets.service';
export type ScriptScope = { projectId: string; workspaceId: string; memberId: string };
export type SessionGate = (tx: Prisma.TransactionClient) => Promise<void>;
export abstract class ScriptSkillRuntimePort {
  abstract resolveInTransaction(tx: Prisma.TransactionClient, scope: {memberId: string; workspaceId: string}, id: string, authorize?: SessionGate): Promise<{projectId: string; ref: ScriptRef; scriptSource: string}>;
  abstract resolveForReadInTransaction(tx: Prisma.TransactionClient, scope: {memberId: string; workspaceId: string}, id: string, authorize?: SessionGate): Promise<{projectId: string; ref: ScriptRef; scriptSource: string}>;
}
export abstract class ScriptExecutionAuthPort { abstract assertSessionInTransaction(tx: Prisma.TransactionClient, claims: ClientClaims): Promise<void>; }
/** Root implements ONLY original lifecycle/member/grant locks, then invokes operation. */
export abstract class ScriptRunAccessPort {
  abstract withCurrent<T>(member: string, workspace: string, permissions: readonly string[], operation: (tx: Prisma.TransactionClient, scope: ScriptScope) => Promise<T>): Promise<T>;
}
export abstract class ScriptRuntimeConfiguration { abstract readonly configured: boolean; }
export abstract class ScriptGeneratedFilesPort {
  abstract stage(scope: GeneratedFileScope, spec: {format: 'json'; mimeType: 'application/json'; bytes: Buffer; checksum: string; originalName: string; downloadUrl: string}): Promise<GeneratedFileTicket>;
  abstract commitInTransaction(tx: Prisma.TransactionClient, ticket: GeneratedFileTicket): Promise<GeneratedFileMetadata>;
  abstract confirm(ticket: GeneratedFileTicket): Promise<void>;
  abstract discard(ticket: GeneratedFileTicket): Promise<{removed: boolean; retainedBecauseCommitted: boolean}>;
  abstract metadataInTransaction(tx: Prisma.TransactionClient, assetId: string, scope: GeneratedFileScope): Promise<GeneratedFileMetadata>;
  /** Original file owner issues opaque instance-local read capability; no storage IO in this method. */
  abstract prepareReadInTransaction(tx: Prisma.TransactionClient, assetId: string, scope: GeneratedFileScope): Promise<object>;
  abstract readPrepared(ticket: object): Promise<Buffer>;
}
export const SCRIPT_READ = ['workspace.ai.assets.read', 'workspace.ai.read', 'workspace.ai.scripts.execute'];
export const SCRIPT_EXECUTE = ['workspace.ai.assets.read', 'workspace.ai.execute', 'workspace.ai.scripts.execute'];
export type ScriptRow = { id: string; project_id: string; workspace_id: string; member_id: string; script_version_id: string; skill_ref: ScriptRef; request_key: string; request_hash: string; input: unknown; session_id: string; token_version: number; job_id: string; attempted_at: Date | null; outcome: ScriptOutcome | null; output_asset_id: string | null; created_at: Date; expires_at: Date; content_purged_at: Date | null; expired: boolean };
export const fileScope = (r: ScriptRow): GeneratedFileScope => ({projectId: r.project_id, workspaceId: r.workspace_id, memberId: r.member_id, pluginCode: 'aij-ai'});
export function claimsFor(member: string, claims: ClientClaims): ClientClaims {
  identifier(member); const c = exact(claims, ['sub','sessionId','tokenVersion']);
  if (c.sub !== member || !Number.isSafeInteger(c.tokenVersion) || Number(c.tokenVersion) < 0) throw new BadRequestException('Invalid script request');
  return {sub: member, sessionId: identifier(c.sessionId), tokenVersion: c.tokenVersion as number};
}
export async function scriptAudit(tx: Prisma.TransactionClient, r: ScriptRow, action: string) {
  await tx.auditLog.create({data: {module: 'aij-ai', action, userId: r.member_id, workspaceId: r.workspace_id, status: 'success', resourceType: 'ai_personal_script_run', resourceId: r.id, afterData: {jobId: r.job_id, outcome: r.outcome}}});
}
@Injectable()
export class AiPersonalScriptRunsService {
  constructor(@Optional() readonly access?: ScriptRunAccessPort, @Optional() readonly skills?: ScriptSkillRuntimePort,
    @Optional() readonly auth?: ScriptExecutionAuthPort, @Optional() readonly files?: ScriptGeneratedFilesPort,
    @Optional() readonly config?: ScriptRuntimeConfiguration, @Optional() private readonly jobs?: JobService) {}
  ready() { if (!this.access || !this.skills || !this.auth || !this.files || !this.config || !this.jobs) throw new ServiceUnavailableException('Script execution unavailable'); }
  async safe<T>(operation: () => Promise<T>): Promise<T> {
    try { this.ready(); return await operation(); } catch (e) { if (e instanceof HttpException) throw e; if (e instanceof Error && e.message === 'SCRIPT_INVALID_INPUT') throw new BadRequestException('Invalid script request'); throw new ServiceUnavailableException('Script execution unavailable'); }
  }
  async relation(tx: Prisma.TransactionClient, scope: ScriptScope, selector: {id: string} | {key: string}, lock = false): Promise<ScriptRow> {
    // A fixed tagged query per selector; no interpolated SQL identifiers or user SQL.
    const rows = 'id' in selector
      ? await tx.$queryRaw<ScriptRow[]>`SELECT *,expires_at<=clock_timestamp() AS expired FROM public.ai_personal_script_run WHERE id=${selector.id}::uuid AND project_id=${scope.projectId} AND workspace_id=${scope.workspaceId} AND member_id=${scope.memberId}`
      : await tx.$queryRaw<ScriptRow[]>`SELECT *,expires_at<=clock_timestamp() AS expired FROM public.ai_personal_script_run WHERE request_key=${selector.key} AND project_id=${scope.projectId} AND workspace_id=${scope.workspaceId} AND member_id=${scope.memberId}`;
    const row = rows[0]; if (!row) throw new NotFoundException('Script run unavailable');
    if (lock) {
      await tx.$queryRaw`SELECT id FROM public.ai_personal_script_run WHERE id=${row.id}::uuid FOR UPDATE`;
      return this.relation(tx, scope, {id: row.id});
    }
    return row;
  }
  async current(tx: Prisma.TransactionClient, scope: ScriptScope, r: ScriptRow, claims: ClientClaims, execute: boolean) {
    if (r.expired || r.content_purged_at) throw new GoneException('Script content expired');
    const resolved = await (execute ? this.skills!.resolveInTransaction(tx, scope, r.script_version_id, t => this.auth!.assertSessionInTransaction(t, claims)) : this.skills!.resolveForReadInTransaction(tx, scope, r.script_version_id, t => this.auth!.assertSessionInTransaction(t, claims)));
    const ref = scriptRef(resolved.ref);
    if (resolved.projectId !== scope.projectId || ref.scriptVersionId !== r.script_version_id || !isDeepStrictEqual(ref, scriptRef(r.skill_ref)) || typeof resolved.scriptSource !== 'string' || !resolved.scriptSource.length || resolved.scriptSource.includes('\0') || Buffer.byteLength(resolved.scriptSource) > 65536 || Buffer.from(resolved.scriptSource).toString() !== resolved.scriptSource || digest(resolved.scriptSource) !== ref.scriptDigest) throw new ConflictException('Script origin changed');
    return resolved;
  }
  async project(tx: Prisma.TransactionClient, r: ScriptRow): Promise<ScriptRun> {
    const job = await tx.runtimeJob.findFirst({where: {id: r.job_id, jobType: SCRIPT_JOB, jobVersion: 1, scope: 'plugin', scopeId: r.project_id, workspaceId: r.workspace_id, pluginCode: 'aij-ai', deletedAt: null}, select: {status: true}});
    if (!job) throw new NotFoundException('Script job unavailable');
    let result: ScriptArtifact | null = null;
    if (r.output_asset_id) {
      if (r.outcome !== 'SUCCESS' || !r.attempted_at) throw new ConflictException('Script result unavailable');
      result = this.artifact(r, await this.files!.metadataInTransaction(tx, r.output_asset_id, fileScope(r)));
    } else if (r.outcome === 'SUCCESS') throw new ConflictException('Script result unavailable');
    return {id: r.id, script: scriptRef(r.skill_ref), jobId: r.job_id, jobStatus: job.status, outcome: r.outcome, attempted: !!r.attempted_at, result, createdAt: r.created_at.toISOString(), expiresAt: r.expires_at.toISOString()};
  }
  artifact(r: ScriptRow, m: GeneratedFileMetadata): ScriptArtifact {
    uuid(m.assetId);
    if (m.assetId !== r.output_asset_id || m.mimeType !== 'application/json' || m.originalName !== 'script-' + r.id + '.json' || !Number.isInteger(m.size) || m.size < 1 || m.size > 65536 || !/^[a-f0-9]{64}$/.test(m.checksum)) throw new ConflictException('Script result unavailable');
    return {...m, mimeType: 'application/json', createdAt: m.createdAt.toISOString()};
  }
  async submit(member: string, workspace: string, raw: unknown, claims: ClientClaims, correlationId?: string): Promise<ScriptRun> {
    let body: {scriptVersionId: string; input: string; key: string}; let identity: ClientClaims;
    try { const b = exact(raw, ['scriptVersionId','input','idempotencyKey']); body = {scriptVersionId: uuid(b.scriptVersionId), input: canonical(b.input), key: requestKey(b.idempotencyKey)}; identity = claimsFor(member, claims); identifier(workspace); } catch { throw new BadRequestException('Invalid script request'); }
    return this.safe(async () => {
      if (!this.config!.configured) throw new ServiceUnavailableException('Script execution not configured');
      return this.access!.withCurrent(member, workspace, SCRIPT_EXECUTE, async (tx, scope) => {
        if (scope.memberId !== member || scope.workspaceId !== workspace) throw new NotFoundException('Script scope unavailable');
        if (!this.config!.configured) throw new ServiceUnavailableException('Script execution not configured');
        await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${JSON.stringify(['personal-script', scope.projectId, workspace, member, body.key])},0))`;
        const source = await this.skills!.resolveInTransaction(tx, scope, body.scriptVersionId, t => this.auth!.assertSessionInTransaction(t, identity));
        const ref = scriptRef(source.ref); if (source.projectId !== scope.projectId || ref.scriptVersionId !== body.scriptVersionId || digest(source.scriptSource) !== ref.scriptDigest) throw new ConflictException('Script origin changed');
        const hash = requestHash(ref, body.input);
        const found = await tx.$queryRaw<{id: string}[]>`SELECT id FROM public.ai_personal_script_run WHERE project_id=${scope.projectId} AND workspace_id=${workspace} AND member_id=${member} AND request_key=${body.key}`;
        if (found[0]) { const row = await this.relation(tx, scope, {id: found[0].id}); if (row.request_hash !== hash) throw new ConflictException('Script request conflicts'); await this.current(tx, scope, row, identity, true); return this.project(tx, row); }
        const id = randomUUID(), jobId = randomUUID();
        await this.jobs!.enqueueInTransaction(tx, {id: jobId, type: SCRIPT_JOB, version: 1, payload: {runId: id}, scope: {type: 'plugin', id: scope.projectId, pluginCode: 'aij-ai'}, workspaceId: workspace, idempotencyKey: 'script:' + id, maxAttempts: 1, timeoutMs: 120000, correlationId});
        await tx.$executeRaw`INSERT INTO public.ai_personal_script_run (id,project_id,workspace_id,member_id,script_version_id,skill_ref,request_key,request_hash,input,session_id,token_version,job_id,created_at,expires_at) SELECT ${id}::uuid,${scope.projectId},${workspace},${member},${body.scriptVersionId}::uuid,${JSON.stringify(ref)}::jsonb,${body.key},${hash},${body.input}::json,${identity.sessionId},${identity.tokenVersion},${jobId},stamp,stamp+interval '7 days' FROM (SELECT clock_timestamp()::timestamp(3) AS stamp) AS timing`;
        const row = await this.relation(tx, scope, {id}); await scriptAudit(tx, row, 'personal_script.submit'); return this.project(tx, row);
      });
    });
  }
  private locate(member: string, workspace: string, selector: {id: string} | {key: string}, claims: ClientClaims, content = false) {
    const identity = claimsFor(member, claims); identifier(workspace);
    return this.access!.withCurrent(member, workspace, SCRIPT_READ, async (tx, scope) => {
      if (scope.memberId !== member || scope.workspaceId !== workspace) throw new NotFoundException('Script scope unavailable');
      const r = await this.relation(tx, scope, selector); await this.current(tx, scope, r, identity, false);
      const run = await this.project(tx, r);
      if (content && (!run.result || !r.output_asset_id)) throw new NotFoundException('Script content unavailable');
      const ticket = content ? await this.files!.prepareReadInTransaction(tx, r.output_asset_id!, fileScope(r)) : undefined;
      // Original Skill/session/metadata locks may have waited across an expiry boundary.
      await this.auth!.assertSessionInTransaction(tx, identity);
      const current = await this.relation(tx, scope, {id: r.id});
      if (current.expired || current.content_purged_at) throw new GoneException('Script content expired');
      return {run, ticket};
    });
  }
  read(member: string, workspace: string, id: string, claims: ClientClaims) { return this.safe(async () => (await this.locate(member, workspace, {id: uuid(id)}, claims)).run); }
  recover(member: string, workspace: string, key: string, claims: ClientClaims) { return this.safe(async () => (await this.locate(member, workspace, {key: requestKey(key)}, claims)).run); }
  content(member: string, workspace: string, id: string, claims: ClientClaims) {
    return this.safe(async () => {
      const before = await this.locate(member, workspace, {id: uuid(id)}, claims, true);
      const bytes = await this.files!.readPrepared(before.ticket!);
      try {
        const after = await this.locate(member, workspace, {id}, claims);
        if (!isDeepStrictEqual(before.run.result, after.run.result) || !after.run.result || bytes.length !== after.run.result.size || digest(bytes) !== after.run.result.checksum || !outputBytes(new TextDecoder('utf-8', {fatal: true}).decode(bytes)).equals(bytes)) throw new ConflictException('Script result unavailable');
        return {meta: after.run.result, bytes};
      } catch (e) { bytes.fill(0); throw e; }
    });
  }
  capability(member: string, workspace: string, claims: ClientClaims) {
    return this.safe(async () => {
      const c = claimsFor(member, claims); identifier(workspace);
      await this.access!.withCurrent(member, workspace, ['workspace.ai.assets.read'], tx => this.auth!.assertSessionInTransaction(tx, c));
      const configured = this.config!.configured;
      try { await this.access!.withCurrent(member, workspace, SCRIPT_EXECUTE, tx => this.auth!.assertSessionInTransaction(tx, c)); }
      catch (e) { if (e instanceof ForbiddenException) return {configured, canExecute: false, reason: 'not_permitted' as const}; throw e; }
      return {configured, canExecute: configured, reason: configured ? 'ready' as const : 'not_configured' as const};
    });
  }
}
