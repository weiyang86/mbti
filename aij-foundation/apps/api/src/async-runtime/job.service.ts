import { randomUUID } from "node:crypto";
import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import type { QueueAdapter, RuntimeJobInput } from "@aij/runtime-contracts";
import { Prisma, RuntimeJobStatus } from "@prisma/client";
import { isDeepStrictEqual } from "node:util";
import { PrismaService } from "../prisma/prisma.service";
import { backoffAt, runtimeErrorIsRetryable, safeRuntimeError, safeRuntimePayload, validateRuntimeJobInput } from "./runtime-contracts";
import { RuntimeRegistry } from "./registry";
import { PluginRuntimeAccessService } from "../plugin-runtime/plugin-runtime-access.service";

type ClaimedJob = {
  id: string;
  job_type: string;
  job_version: number;
  payload: Prisma.JsonValue;
  scope: string;
  scope_id: string;
  plugin_code: string;
  idempotency_key: string;
  correlation_id: string | null;
  attempts: number;
  max_attempts: number;
  timeout_ms: number;
  lease_owner: string;
  lease_nonce: string;
};

type ScopedRuntimeJobIdentity = Readonly<{
  id: string;
  jobType: string;
  scope: string;
  scopeId: string;
  pluginCode: string;
}>;

@Injectable()
export class JobService implements QueueAdapter {
  private readonly logger = new Logger(JobService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: RuntimeRegistry,
    private readonly pluginAccess: PluginRuntimeAccessService
  ) {}

  async enqueue(input: RuntimeJobInput) {
    const validated = validateRuntimeJobInput(input);
    this.registry.assertJobDeclared(validated.type, validated.version);
    return this.prisma.$transaction(tx => this.enqueueInTransaction(tx, validated));
  }

  async enqueueInTransaction(tx: Prisma.TransactionClient, input: RuntimeJobInput) {
    const validated = validateRuntimeJobInput(input);
    if (validated.scope.type === "plugin") {
      const projectId = await this.pluginAccess.projectId(tx);
      await this.pluginAccess.assertEnabledInTransaction(tx, projectId, validated.scope.pluginCode!);
      if (validated.scope.id !== projectId) throw new ForbiddenException("Plugin job scope unavailable");
    }
    this.registry.assertJobDeclared(validated.type, validated.version);
    const id = validated.id || randomUUID();
    const row = await tx.runtimeJob.create({
      data: {
        id,
        jobType: validated.type,
        jobVersion: validated.version,
        payload: safeRuntimePayload(validated.payload) as Prisma.InputJsonValue,
        scope: validated.scope.type,
        scopeId: validated.scope.id,
        pluginCode: validated.scope.pluginCode || "",
        workspaceId: validated.workspaceId,
        idempotencyKey: validated.idempotencyKey,
        dedupeKey: validated.dedupeKey,
        priority: validated.priority ?? 0,
        runAt: validated.runAt ?? new Date(),
        maxAttempts: validated.maxAttempts ?? 5,
        timeoutMs: validated.timeoutMs ?? 30_000,
        correlationId: validated.correlationId || id
      }
    });
    return { id: row.id };
  }

  /** Idempotent submission owned by the durable RuntimeJob store. */
  async enqueueIdempotent(input: RuntimeJobInput) {
    const validated = validateRuntimeJobInput(input);
    this.registry.assertJobDeclared(validated.type, validated.version);
    return this.prisma.$transaction(tx => this.enqueueIdempotentInTransaction(tx, validated));
  }

  async enqueueIdempotentInTransaction(tx: Prisma.TransactionClient, input: RuntimeJobInput) {
    const validated = validateRuntimeJobInput(input);
    if (validated.scope.type === "plugin") {
      const projectId = await this.pluginAccess.projectId(tx);
      await this.pluginAccess.assertEnabledInTransaction(tx, projectId, validated.scope.pluginCode!);
      if (validated.scope.id !== projectId) throw new ForbiddenException("Plugin job scope unavailable");
    }
    this.registry.assertJobDeclared(validated.type, validated.version);
    const id = validated.id || randomUUID();
    const payload = safeRuntimePayload(validated.payload) as Prisma.InputJsonValue;
    const pluginCode = validated.scope.pluginCode || "";
    const scope = validated.scope.type;
    const scopeId = validated.scope.id;
    const maxAttempts = validated.maxAttempts ?? 5;
    const timeoutMs = validated.timeoutMs ?? 30_000;
    const dedupeKey = validated.dedupeKey ?? null;
    const priority = validated.priority ?? 0;
    const created = await tx.runtimeJob.createMany({
      data: [{
        id,
        jobType: validated.type,
        jobVersion: validated.version,
        payload,
        scope,
        scopeId,
        pluginCode,
        workspaceId: validated.workspaceId,
        idempotencyKey: validated.idempotencyKey,
        dedupeKey,
        priority,
        runAt: validated.runAt ?? new Date(),
        maxAttempts,
        timeoutMs,
        correlationId: validated.correlationId || id
      }],
      skipDuplicates: true
    });
    const row = await tx.runtimeJob.findUnique({
      where: { scope_scopeId_jobType_idempotencyKey: { scope, scopeId, jobType: validated.type, idempotencyKey: validated.idempotencyKey } }
    });
    if (!row) throw new ConflictException("Runtime job idempotency key conflicts with an existing job");
    const sameRequest = !row.deletedAt && row.jobVersion === validated.version && row.pluginCode === pluginCode &&
      row.workspaceId === (validated.workspaceId ?? null) && row.dedupeKey === dedupeKey &&
      row.priority === priority && row.maxAttempts === maxAttempts && row.timeoutMs === timeoutMs &&
      isDeepStrictEqual(row.payload, payload) &&
      (validated.runAt === undefined || row.runAt.getTime() === validated.runAt.getTime());
    if (!sameRequest) throw new ConflictException("Runtime job idempotency key conflicts with a different request");
    return { id: row.id, status: row.status, idempotentReplay: created.count === 0 };
  }

  async scopedStatusInTransaction(tx: Prisma.TransactionClient, identity: ScopedRuntimeJobIdentity) {
    const row = await tx.runtimeJob.findFirst({
      where: { ...identity, deletedAt: null },
      select: { id: true, status: true, attempts: true, maxAttempts: true, runAt: true, completedAt: true, cancelledAt: true, lastError: true }
    });
    if (!row) throw new NotFoundException("Runtime job not found");
    return {
      id: row.id,
      status: row.status,
      attempts: row.attempts,
      maxAttempts: row.maxAttempts,
      nextAttemptAt: row.runAt,
      completedAt: row.completedAt,
      cancelledAt: row.cancelledAt,
      hasError: !!row.lastError
    };
  }

  /** Only the current lease/owner may scope a cancellation; running jobs are not falsely reported as stopped. */
  async cancelScopedInTransaction(tx: Prisma.TransactionClient, identity: ScopedRuntimeJobIdentity) {
    const current = await tx.runtimeJob.findFirst({ where: { ...identity, deletedAt: null }, select: { id: true, status: true } });
    if (!current) throw new NotFoundException("Runtime job not found");
    if (current.status !== "pending" && current.status !== "retry") {
      throw new ConflictException("Runtime job cannot be cancelled in its current state");
    }
    const cancelledAt = new Date();
    const updated = await tx.runtimeJob.updateMany({
      where: { ...identity, deletedAt: null, status: current.status },
      data: { status: "cancelled", cancelledAt, leaseOwner: null, leaseNonce: null, leaseExpiresAt: null }
    });
    if (updated.count !== 1) throw new ConflictException("Runtime state conflict");
    return { id: identity.id, status: "cancelled" as const, cancelledAt };
  }

  async claim(instanceId: string, limit = 10, leaseMs = 60_000): Promise<ClaimedJob[]> {
    if (!/^[A-Za-z0-9._:-]{1,128}$/.test(instanceId) || !Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(leaseMs) || leaseMs < 1000 || leaseMs > 300_000) {
      throw new BadRequestException("invalid runtime claim options");
    }
    const registered = this.registry.registeredJobDefinitions();
    if (!registered.length) return [];
    const enabledPlugins = await this.pluginAccess.enabledCodes();
    const allowlist = Prisma.join(registered.map((entry) => Prisma.sql`(${entry.type}, ${entry.version})`));
    const pluginFilter = enabledPlugins.length
      ? Prisma.sql`AND (plugin_code = '' OR plugin_code IN (${Prisma.join(enabledPlugins)}))`
      : Prisma.sql`AND plugin_code = ''`;
    await this.prisma.$executeRaw`UPDATE runtime_job SET status = 'dead', last_error = 'lease_expired_at_attempt_limit', lease_owner = NULL, lease_nonce = NULL, lease_expires_at = NULL, updated_at = NOW() WHERE status = 'running' AND deleted_at IS NULL AND lease_expires_at < NOW() AND attempts >= max_attempts`;
    // A fresh server-generated nonce per invocation, paired with the unique job id.
    const leaseNonce = randomUUID();
    return this.prisma.$queryRaw<ClaimedJob[]>(Prisma.sql`
      WITH candidates AS (
        SELECT id FROM runtime_job
        WHERE deleted_at IS NULL AND run_at <= NOW()
          AND (job_type, job_version) IN (${allowlist})
          ${pluginFilter}
          AND attempts < max_attempts AND (status IN ('pending', 'retry') OR (status = 'running' AND lease_expires_at < NOW()))
        ORDER BY priority DESC, run_at, created_at
        FOR UPDATE SKIP LOCKED LIMIT ${limit}
      )
      UPDATE runtime_job j SET status = 'running', lease_owner = ${instanceId}, lease_nonce = ${leaseNonce}::uuid,
        lease_expires_at = NOW() + ((GREATEST(${leaseMs}, j.timeout_ms) + 5000) * INTERVAL '1 millisecond'), attempts = attempts + 1,
        started_at = COALESCE(started_at, NOW()), updated_at = NOW()
      FROM candidates c WHERE j.id = c.id
      RETURNING j.id, j.job_type, j.job_version, j.payload, j.scope, j.scope_id, j.plugin_code,
        j.idempotency_key, j.correlation_id, j.attempts, j.max_attempts, j.timeout_ms, j.lease_owner, j.lease_nonce
    `);
  }

  async execute(row: ClaimedJob) {
    // Legacy/corrupt captured claims cannot turn undefined into an omitted ORM predicate.
    if (!this.validLeaseNonce(row.lease_nonce)) return;
    try {
      if (row.plugin_code && !(await this.pluginAccess.isEnabled(row.plugin_code))) {
        await this.prisma.runtimeJob.updateMany({
          where: this.leaseWhere(row),
          data: { status: "retry", runAt: backoffAt(row.attempts), lastError: "PLUGIN_DISABLED", leaseOwner: null, leaseNonce: null, leaseExpiresAt: null }
        });
        return;
      }
      const registration = this.registry.jobRegistration(row.job_type, row.job_version);
      if (registration.executionMode === "orchestrated") {
        await this.executeOrchestrated(row, registration.handler);
      } else {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), row.timeout_ms);
        timeout.unref();
        await this.prisma.$transaction(
          async (tx) => {
            if (!(await this.admitLease(tx, row))) return;
            if (row.plugin_code) {
              const projectId = await this.pluginAccess.projectId(tx);
              await this.pluginAccess.assertEnabledInTransaction(tx, projectId, row.plugin_code);
            }
            const identity = {
              requestScope: "job",
              scope: row.scope,
              scopeId: row.scope_id,
              pluginCode: row.plugin_code,
              owner: `${row.job_type}@${row.job_version}`,
              idempotencyKey: row.idempotency_key
            };
            const existing = await tx.runtimeIdempotency.findUnique({
              where: { requestScope_scope_scopeId_pluginCode_owner_idempotencyKey: identity }
            });
            if (existing && existing.status !== "completed") throw new Error("job idempotency record is still processing");
            let result: { resultReference?: unknown } | void = undefined;
            if (!existing) {
              await tx.runtimeIdempotency.create({ data: { ...identity, expiresAt: new Date(Date.now() + 30 * 86400_000) } });
              result = await registration.handler({ id: row.id, payload: row.payload, correlationId: row.correlation_id || undefined, idempotencyKey: row.idempotency_key, attempt: row.attempts, maxAttempts: row.max_attempts, leaseOwner: row.lease_owner, leaseNonce: row.lease_nonce, signal: controller.signal }, tx);
              const resultReference = result && "resultReference" in result ? result.resultReference : undefined;
              await tx.runtimeIdempotency.update({
                where: { requestScope_scope_scopeId_pluginCode_owner_idempotencyKey: identity },
                data: { status: "completed", resultReference: safeRuntimePayload(resultReference || { jobId: row.id }) as Prisma.InputJsonValue }
              });
            }
            const resultReference = result && "resultReference" in result ? result.resultReference : undefined;
            const completed = await tx.runtimeJob.updateMany({
              where: this.leaseWhere(row),
              data: {
                status: "completed",
                completedAt: new Date(),
                resultReference: safeRuntimePayload(resultReference || { idempotentReplay: !!existing }) as Prisma.InputJsonValue,
                leaseOwner: null,
                leaseNonce: null,
                leaseExpiresAt: null,
                lastError: null
              }
            });
            if (completed.count !== 1) throw new Error("job lease ownership changed before completion");
          },
          { timeout: row.timeout_ms }
        ).finally(() => clearTimeout(timeout));
      }
      this.logger.log(
        JSON.stringify({ message: "job completed", jobId: row.id, jobType: row.job_type, correlationId: row.correlation_id })
      );
    } catch (error) {
      const dead = !runtimeErrorIsRetryable(error) || row.attempts >= row.max_attempts;
      const changed = await this.prisma.runtimeJob.updateMany({
        where: this.leaseWhere(row),
        data: {
          status: dead ? "dead" : "retry",
          runAt: backoffAt(row.attempts),
          lastError: safeRuntimeError(error),
          leaseOwner: null,
          leaseNonce: null,
          leaseExpiresAt: null
        }
      });
      // A reclaimed or administratively changed job is no longer this worker's state to update.
      if (changed.count !== 1) return;
      this.logger.warn(
        JSON.stringify({
          message: "job failed",
          jobId: row.id,
          jobType: row.job_type,
          correlationId: row.correlation_id,
          status: dead ? "dead" : "retry",
          error: safeRuntimeError(error)
        })
      );
    }
  }

  private async executeOrchestrated(row: ClaimedJob, handler: ReturnType<RuntimeRegistry["job"]>) {
    const identity = {
      requestScope: "job",
      scope: row.scope,
      scopeId: row.scope_id,
      pluginCode: row.plugin_code,
      owner: `${row.job_type}@${row.job_version}`,
      idempotencyKey: row.idempotency_key
    };
    const admitted = await this.prisma.$transaction(async (tx) => {
      if (row.plugin_code) {
        const projectId = await this.pluginAccess.projectId(tx);
        await this.pluginAccess.assertEnabledInTransaction(tx, projectId, row.plugin_code);
      }
      // Orchestrated handlers take lifecycle before Job; admission must use that
      // same order, then validate nonce/clock after any lifecycle wait.
      if (!(await this.admitLease(tx, row))) return false;
      const existing = await tx.runtimeIdempotency.findUnique({
        where: { requestScope_scope_scopeId_pluginCode_owner_idempotencyKey: identity }
      });
      if (existing?.status === "completed") {
        await tx.runtimeJob.updateMany({
          where: this.leaseWhere(row),
          data: { status: "completed", completedAt: new Date(),
            resultReference: existing.resultReference ?? { idempotentReplay: true },
            leaseOwner: null, leaseNonce: null, leaseExpiresAt: null, lastError: null }
        });
        return false;
      }
      const admission = { jobId: row.id, leaseOwner: row.lease_owner, attempt: row.attempts, leaseNonce: row.lease_nonce };
      // Row lock serializes duplicate calls even across processes. A newer valid lease may recover
      // a crashed attempt; external providers still need their own idempotency/ambiguity policy.
      if (existing && isDeepStrictEqual(existing.resultReference, admission)) return false;
      await tx.runtimeIdempotency.upsert({
        where: { requestScope_scope_scopeId_pluginCode_owner_idempotencyKey: identity },
        create: { ...identity, resultReference: admission, expiresAt: new Date(Date.now() + 30 * 86400_000) },
        update: { resultReference: admission }
      });
      return true;
    });
    if (!admitted) return;

    const controller = new AbortController();
    let timeout: NodeJS.Timeout | undefined;
    const timedOut = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        controller.abort();
        reject(Object.assign(new Error("RUNTIME_JOB_TIMEOUT"), { runtimeRetryable: true }));
      }, row.timeout_ms);
      timeout.unref();
    });
    const work = handler({ id: row.id, payload: row.payload, correlationId: row.correlation_id || undefined, idempotencyKey: row.idempotency_key, attempt: row.attempts, maxAttempts: row.max_attempts, leaseOwner: row.lease_owner, leaseNonce: row.lease_nonce, signal: controller.signal }, undefined);
    let result: Awaited<typeof work>;
    try { result = await Promise.race([work, timedOut]); }
    finally { if (timeout) clearTimeout(timeout); }
    const resultReference = result && "resultReference" in result ? result.resultReference : undefined;
    await this.prisma.$transaction(async (tx) => {
      if (!(await this.admitLease(tx, row))) throw new Error("job lease ownership changed before completion");
      await tx.runtimeIdempotency.update({
        where: { requestScope_scope_scopeId_pluginCode_owner_idempotencyKey: identity },
        data: { status: "completed", resultReference: safeRuntimePayload(resultReference || { jobId: row.id }) as Prisma.InputJsonValue }
      });
      const completed = await tx.runtimeJob.updateMany({
        where: this.leaseWhere(row),
        data: {
          status: "completed",
          completedAt: new Date(),
          resultReference: safeRuntimePayload(resultReference || { jobId: row.id }) as Prisma.InputJsonValue,
          leaseOwner: null,
          leaseNonce: null,
          leaseExpiresAt: null,
          lastError: null
        }
      });
      if (completed.count !== 1) throw new Error("job lease ownership changed before completion");
    });
  }

  private validLeaseNonce(nonce: unknown): nonce is string {
    return typeof nonce === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(nonce);
  }

  private leaseWhere(row: ClaimedJob): Prisma.RuntimeJobWhereInput {
    if (!this.validLeaseNonce(row.lease_nonce)) throw new Error("invalid job lease nonce");
    return { id: row.id, status: "running", leaseOwner: row.lease_owner, attempts: row.attempts,
      leaseNonce: row.lease_nonce, deletedAt: null, leaseExpiresAt: { gt: new Date() } };
  }

  private async admitLease(tx: Prisma.TransactionClient, row: ClaimedJob) {
    if (!this.validLeaseNonce(row.lease_nonce)) return false;
    const current = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM runtime_job WHERE id = ${row.id} AND status = 'running'
      AND lease_owner = ${row.lease_owner} AND attempts = ${row.attempts} AND lease_nonce = ${row.lease_nonce}::uuid
      AND lease_expires_at > NOW() AND deleted_at IS NULL FOR UPDATE`;
    if (!current.length) return false;
    const heartbeat = await tx.runtimeJob.updateMany({ where: this.leaseWhere(row), data: {
      leaseExpiresAt: new Date(Date.now() + row.timeout_ms + 5000)
    } });
    return heartbeat.count === 1;
  }

  list(status?: RuntimeJobStatus, take = 100) {
    return this.prisma.runtimeJob.findMany({
      where: { deletedAt: null, ...(status ? { status } : {}) },
      orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
      take,
      select: {
        id: true,
        jobType: true,
        jobVersion: true,
        scope: true,
        scopeId: true,
        pluginCode: true,
        status: true,
        priority: true,
        runAt: true,
        attempts: true,
        maxAttempts: true,
        timeoutMs: true,
        dedupeKey: true,
        resultReference: true,
        lastError: true,
        startedAt: true,
        completedAt: true,
        cancelledAt: true,
        createdAt: true
      }
    });
  }

  async retry(id: string) {
    const row = await this.find(id);
    if (!["dead", "failed", "cancelled"].includes(row.status))
      throw new BadRequestException("only failed, dead or cancelled jobs can be retried manually");
    return this.prisma.runtimeJob.update({
      where: { id },
      data: { status: "retry", attempts: 0, runAt: new Date(), lastError: null, cancelledAt: null, leaseOwner: null, leaseNonce: null, leaseExpiresAt: null }
    });
  }

  async cancel(id: string) {
    const row = await this.find(id);
    if (!["pending", "retry"].includes(row.status)) throw new BadRequestException("only pending or retry jobs can be cancelled");
    return this.prisma.runtimeJob.update({
      where: { id },
      data: { status: "cancelled", cancelledAt: new Date(), leaseOwner: null, leaseNonce: null, leaseExpiresAt: null }
    });
  }

  private async find(id: string) {
    const row = await this.prisma.runtimeJob.findFirst({ where: { id, deletedAt: null } });
    if (!row) throw new NotFoundException("job not found");
    return row;
  }
}
