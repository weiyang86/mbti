import { Inject, Injectable, OnModuleInit, Optional } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RuntimeRegistry, JobHandler } from '../../async-runtime/registry';
import { PythonSandboxRunner, PythonSandboxOptions, PythonSandboxResult } from './python-sandbox-runner';
import { AiPersonalScriptRunsService, ScriptRow, ScriptScope, ScriptRuntimeConfiguration, SCRIPT_EXECUTE, fileScope, scriptAudit } from './ai-personal-script-runs.service';
import { canonical, digest, exact, outputBytes, SCRIPT_JOB, ScriptOutcome, uuid } from './ai-personal-script-run-profile';
import type { GeneratedFileTicket } from '../../files/generated-file-assets.service';
export const SCRIPT_SANDBOX_OPTIONS = Symbol('SCRIPT_SANDBOX_OPTIONS');
/** Single process instance, trusted root provider only. Never constructed from a DTO. */
@Injectable()
export class ScriptSandboxConfiguration extends ScriptRuntimeConfiguration {
  readonly configured: boolean;
  readonly runner: PythonSandboxRunner;
  constructor(@Optional() @Inject(SCRIPT_SANDBOX_OPTIONS) options: PythonSandboxOptions = {}) {
    super();
    this.configured = options.enabled === true && typeof options.dockerCliPath === 'string' && /^\/(?:[^/]+\/)*[^/]+$/.test(options.dockerCliPath) && !options.dockerCliPath.split('/').some(v => v === '..' || v === '.') && /^docker\.io\/library\/python@sha256:[a-f0-9]{64}$/.test(options.approvedImage ?? '');
    this.runner = new PythonSandboxRunner({...options, enabled: this.configured, maxConcurrency: 1});
  }
}
type Job = Parameters<JobHandler>[0];
class LeaseLost extends Error { constructor() { super('SCRIPT_LEASE_LOST'); } }
@Injectable()
export class AiPersonalScriptExecutionService implements OnModuleInit {
  constructor(private readonly prisma: PrismaService, private readonly registry: RuntimeRegistry,
    private readonly runs: AiPersonalScriptRunsService, private readonly config: ScriptSandboxConfiguration) {}
  onModuleInit() { this.registry.registerOrchestratedJob(SCRIPT_JOB, 1, job => this.execute(job)); }
  private async lease(tx: Prisma.TransactionClient, scope: ScriptScope, job: Job, runId: string) {
    if (!job.leaseOwner || !job.leaseNonce || job.attempt !== 1 || job.maxAttempts !== 1 || job.signal.aborted) throw new LeaseLost();
    uuid(job.leaseNonce);
    const found = await tx.$queryRaw<{id: string}[]>`SELECT id FROM public.runtime_job WHERE id=${job.id} AND job_type=${SCRIPT_JOB} AND job_version=1 AND scope='plugin' AND scope_id=${scope.projectId} AND workspace_id=${scope.workspaceId} AND plugin_code='aij-ai' AND status='running' AND deleted_at IS NULL AND attempts=${job.attempt} AND max_attempts=1 AND lease_owner=${job.leaseOwner} AND lease_nonce=${job.leaseNonce}::uuid AND lease_expires_at>clock_timestamp() AND payload=${JSON.stringify({runId})}::jsonb FOR UPDATE`;
    if (!found.length) throw new LeaseLost();
  }
  private async locked<T>(scope: ScriptScope, job: Job, runId: string, authorize: boolean, work: (tx: Prisma.TransactionClient, r: ScriptRow, source?: string) => Promise<T>) {
    return this.runs.access!.withCurrent(scope.memberId, scope.workspaceId, SCRIPT_EXECUTE, async (tx, currentScope) => {
      if (currentScope.projectId !== scope.projectId) throw new LeaseLost();
      await this.lease(tx, scope, job, runId);
      const r = await this.runs.relation(tx, scope, {id: runId}, true);
      if (r.job_id !== job.id) throw new LeaseLost();
      const resolved = authorize ? await this.runs.current(tx, scope, r, {sub: scope.memberId, sessionId: r.session_id, tokenVersion: r.token_version}, true) : undefined;
      // Recheck after potentially waiting on original Skill/session locks.
      await this.lease(tx, scope, job, runId);
      const result = await work(tx, r, resolved?.scriptSource);
      if (authorize) await this.runs.auth!.assertSessionInTransaction(tx, {sub: scope.memberId, sessionId: r.session_id, tokenVersion: r.token_version});
      // No expired nonce can commit a result even if audit/asset locks waited.
      await this.lease(tx, scope, job, runId);
      if (authorize && (await this.runs.relation(tx, scope, {id: runId})).expired) throw new Error('SCRIPT_EXPIRED');
      return result;
    });
  }
  private async finish(scope: ScriptScope, job: Job, id: string, outcome: ScriptOutcome) {
    await this.locked(scope, job, id, false, async (tx, r) => {
      if (r.outcome || r.output_asset_id) return;
      if (r.attempted_at && outcome === 'DENIED') outcome = 'UNKNOWN';
      await tx.$executeRaw`UPDATE public.ai_personal_script_run SET outcome=${outcome} WHERE id=${id}::uuid AND outcome IS NULL AND output_asset_id IS NULL`;
      await scriptAudit(tx, {...r, outcome}, 'personal_script.finish');
    });
  }
  async execute(job: Job): Promise<{resultReference: {code: string}}> {
    let scope: ScriptScope | undefined, id: string | undefined;
    let ticket: GeneratedFileTicket | undefined;
    let attempted = false;
    try {
      this.runs.ready();
      id = uuid(exact(job.payload, ['runId']).runId);
      // Unlocked identity lookup is not authorization. All authoritative checks occur below.
      const rows = await this.prisma.$queryRaw<{project_id: string; workspace_id: string; member_id: string}[]>`SELECT project_id,workspace_id,member_id FROM public.ai_personal_script_run WHERE id=${id}::uuid AND job_id=${job.id}`;
      if (!rows[0]) throw new LeaseLost();
      scope = {projectId: rows[0].project_id, workspaceId: rows[0].workspace_id, memberId: rows[0].member_id};
      const start = await this.locked(scope, job, id, true, async (tx, r, source) => {
        if (r.attempted_at || r.outcome) return null;
        if (!this.config.configured) throw new Error('SCRIPT_DISABLED');
        const inputJson = canonical(r.input);
        await tx.$executeRaw`UPDATE public.ai_personal_script_run SET attempted_at=clock_timestamp() WHERE id=${r.id}::uuid AND attempted_at IS NULL`;
        await scriptAudit(tx, {...r, attempted_at: new Date()}, 'personal_script.attempt');
        return {script: source!, inputJson};
      });
      if (!start) { await this.finish(scope, job, id, 'UNKNOWN'); return {resultReference: {code: 'SCRIPT_ALREADY_ATTEMPTED'}}; }
      attempted = true;
      let result: PythonSandboxResult;
      try { result = await this.config.runner.run({...start, timeoutMs: 30000, signal: job.signal}); }
      catch { await this.finish(scope, job, id, 'UNKNOWN'); return {resultReference: {code: 'UNKNOWN'}}; }
      if (!result.cleanupConfirmed || result.outcome !== 'SUCCESS') {
        const outcome = !result.cleanupConfirmed ? 'UNKNOWN' : result.outcome;
        await this.finish(scope, job, id, outcome); return {resultReference: {code: outcome}};
      }
      let bytes: Buffer;
      try { bytes = outputBytes(result.stdout); }
      catch { await this.finish(scope, job, id, 'INVALID_OUTPUT'); return {resultReference: {code: 'INVALID_OUTPUT'}}; }
      try {
        const r = await this.locked(scope, job, id, true, async (_tx, row) => {
          if (!row.attempted_at || row.outcome || row.output_asset_id) throw new LeaseLost(); return row;
        });
        ticket = await this.runs.files!.stage(fileScope(r), {format: 'json', mimeType: 'application/json', bytes, checksum: digest(bytes), originalName: 'script-' + id + '.json', downloadUrl: '/api/client/script-executions/runs/' + id + '/content'});
        const heldTicket = ticket;
        await this.locked(scope, job, id, true, async (tx, row) => {
          if (!row.attempted_at || row.outcome || row.output_asset_id) throw new LeaseLost();
          const meta = await this.runs.files!.commitInTransaction(tx, heldTicket);
          this.runs.artifact({...row, output_asset_id: heldTicket.assetId}, meta);
          if (meta.checksum !== digest(bytes) || meta.size !== bytes.length) throw new Error('SCRIPT_ASSET_INVALID');
          await tx.$executeRaw`UPDATE public.ai_personal_script_run SET outcome='SUCCESS',output_asset_id=${heldTicket.assetId} WHERE id=${row.id}::uuid AND outcome IS NULL AND attempted_at IS NOT NULL`;
          await scriptAudit(tx, {...row, outcome: 'SUCCESS'}, 'personal_script.finish');
        });
        await this.runs.files!.confirm(heldTicket); ticket = undefined;
        return {resultReference: {code: 'SUCCESS'}};
      } finally { bytes.fill(0); }
    } catch (error) {
      if (ticket) {
        // Original file owner performs locked readback even after session/source revocation.
        // Retain a committed file; never compensate an uncertain DB commit blindly.
        try {
          const cleanup = await this.runs.files!.discard(ticket);
          if (cleanup.retainedBecauseCommitted && id && scope) {
            const rows = await this.prisma.$queryRaw<{id: string}[]>`SELECT id FROM public.ai_personal_script_run WHERE id=${id}::uuid AND job_id=${job.id} AND project_id=${scope.projectId} AND workspace_id=${scope.workspaceId} AND member_id=${scope.memberId} AND output_asset_id=${ticket.assetId} AND outcome='SUCCESS' AND attempted_at IS NOT NULL`;
            if (rows.length === 1) return {resultReference: {code: 'SUCCESS'}};
          }
        } catch { /* Preserve unknown state; no deletion or execution retry. */ }
      }
      if (scope && id && !(error instanceof LeaseLost)) {
        try { await this.finish(scope, job, id, attempted ? 'UNKNOWN' : 'DENIED'); } catch { /* Revoked/expired lease cannot mutate or audit. */ }
      }
      // Never expose runner, SQL, source or input diagnostics to the scheduler.
      return {resultReference: {code: 'SCRIPT_EXECUTION_UNAVAILABLE'}};
    }
  }
  /** Root may invoke from its existing retention maintenance; no new scheduler. */
  async purgeExpiredInputs(): Promise<number> {
    return this.prisma.$executeRaw`UPDATE public.ai_personal_script_run SET input=NULL,content_purged_at=clock_timestamp() WHERE expires_at<=clock_timestamp() AND content_purged_at IS NULL`;
  }
}
