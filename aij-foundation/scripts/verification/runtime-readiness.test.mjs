import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";
import { applicationSessions, setTaskDatabaseConnections } from "./readiness-support.mjs";
import { createRuntimeFixture, writeRuntimeEvidence } from "./runtime-fixture.mjs";
import { diagnoseRuntimeReadiness, readRuntimeReadiness, RuntimeReadinessError, waitForRuntimeReadiness } from "./runtime-readiness-diagnostics.mjs";

const require = createRequire(join(process.cwd(), "apps/api/package.json"));
const bcrypt = require("bcryptjs");

test("G9-04 real readiness/monitor API enforces RBAC, hides queue payloads, and recovers after an isolated DB outage", { timeout: 180000 }, async t => {
  const f = await createRuntimeFixture("AF-052", { workerEnabled: true });
  let databaseBlocked = false;
  let applicationClosed = false;
  try {
    const probe = signal => readRuntimeReadiness({ baseUrl: f.baseUrl, token: f.token, signal });
    const waitReady = async (phase, heartbeatAfter = null) => {
      try {
        const result = await waitForRuntimeReadiness({ probe, heartbeatAfter });
        await writeRuntimeEvidence("AF-052", f.lease.id, phase + ".json", result.diagnostics);
        return result.observation;
      } catch (error) {
        if (error instanceof RuntimeReadinessError) await writeRuntimeEvidence("AF-052", f.lease.id, phase + ".json", error.diagnostics);
        throw error;
      }
    };
    // Observe natural startup first: login/listen does not imply either first
    // scheduled heartbeat has happened. No worker/health product code changes.
    await waitReady("startup-readiness");
    const marker = "runtime-payload-must-not-leak-" + randomUUID();
    let jobId, outboxId, readerToken;

    await t.test("controlled startup state is 503, then real scheduled worker/scheduler heartbeats converge to READY", async () => {
      const { RuntimeHealthService } = require(join(process.cwd(), "apps/api/dist/async-runtime/runtime-health.service.js"));
      const health = f.app.get(RuntimeHealthService);
      const previous = { ...health.worker };
      try {
        // A controlled starting worker makes the 503 deterministic even if
        // login already took longer than the real first scheduler interval.
        // poll() never promotes status, so its real timer cannot erase this gate.
        health.worker = { ...previous, status: "starting", lastPollAt: null };
        const starting = await probe(AbortSignal.timeout(8_000));
        assert.equal(starting.status, 503);
        assert.equal(starting.body.data.ready, false);
        const diagnostic = diagnoseRuntimeReadiness(starting);
        assert.equal(diagnostic.failure, undefined);
        assert.equal(diagnostic.reason, "ASYNC_RUNTIME_UNHEALTHY");
        assert.equal(diagnostic.worker.status, "starting");
        await writeRuntimeEvidence("AF-052", f.lease.id, "controlled-startup-503.json", diagnostic);
        assert.equal((await f.request("/health")).body.data.scope, "process");
      } finally {
        health.worker = { ...previous, lastPollAt: null };
        health.scheduler.lastPollAt = null;
      }
      // Only actual scheduled work can fill these null heartbeats. Do not call
      // poll/tick or write a synthetic READY state to make the HTTP test green.
      const releasedAt = Date.now();
      const ready = await waitReady("controlled-startup-recovery", releasedAt);
      assert.equal(ready.status, 200); assert.equal(ready.body.data.reason, "READY");
    });

    await t.test("unauthenticated and authenticated no-grant actors are rejected; authorized monitor is live and payload-free", async () => {
      const anon = await f.request("/admin/runtime/readiness", { expected: 401, authorization: null });
      assert.doesNotMatch(anon.text, /postgresql:|password|PrismaClient|stack/);
      const password = "R9-" + randomUUID() + "-synthetic";
      const reader = await f.prisma.sysUser.create({ data: { username: "runtime-no-grant", passwordHash: await bcrypt.hash(password, 12), realName: "Runtime test reader", isSuperAdmin: false } });
      readerToken = await f.login(reader.username, password);
      await f.request("/admin/runtime/readiness", { expected: 403, authorization: readerToken });
      await f.request("/admin/runtime/jobs", { expected: 403, authorization: readerToken });
      const saved = await f.prisma.runtimeJob.create({ data: { jobType: "aij.runtime.g9.monitor-probe", jobVersion: 1, payload: { accessToken: "stored-secret", message: marker }, scope: "project", scopeId: "aij-foundation-test", status: "dead", idempotencyKey: "g9-04-job-" + randomUUID(), correlationId: "g9-04-correl-" + randomUUID(), attempts: 3, maxAttempts: 3, lastError: "RUNTIME_OPERATION_FAILED" } });
      jobId = saved.id;
      const event = await f.prisma.runtimeOutbox.create({ data: { eventType: "aij.runtime.g9.monitor-event", eventVersion: 1, occurredAt: new Date(), producer: "aij-test", scope: { type: "project", id: "aij-foundation-test" }, idempotencyKey: "g9-04-event-" + randomUUID(), payload: { clientSecret: "stored-secret", message: marker }, status: "dead", attempts: 3, maxAttempts: 3, lastError: "RUNTIME_OPERATION_FAILED" } });
      outboxId = event.id;
      const ready = await waitReady("monitor-readiness");
      assert.equal(ready.body.data.ready, true); assert.equal(ready.body.data.reason, "READY"); assert.equal(ready.body.data.database.ready, true);
      assert.ok((await f.request("/auth/me")).body.data.id, "the synthetic administrator bearer session remains valid after a no-grant denial");
      assert.equal(ready.body.data.worker.status, "running"); assert.ok(ready.body.data.queues.jobs.dead >= 1); assert.ok(ready.body.data.queues.outbox.dead >= 1);
      const jobs = await f.request("/admin/runtime/jobs?status=dead");
      const outbox = await f.request("/admin/runtime/outbox?status=dead");
      assert.ok(jobs.body.data.items.some(item => item.id === jobId)); assert.ok(outbox.body.data.items.some(item => item.id === outboxId));
      const serialized = JSON.stringify({ jobs, outbox, ready });
      assert.ok(!serialized.includes(marker)); assert.ok(!serialized.includes("stored-secret"));
      assert.doesNotMatch(serialized, /"payload"|idempotencyKey|correlationId|lastError/);
      const pending = await f.prisma.runtimeJob.create({ data: { jobType: "aij.runtime.g9.cancel-probe", jobVersion: 1, payload: { message: marker }, scope: "project", scopeId: "aij-foundation-test", status: "pending", runAt: new Date(Date.now() + 3_600_000), idempotencyKey: "g9-04-cancel-" + randomUUID() } });
      const { readFile } = await import("node:fs/promises");
      const initialAdmin = JSON.parse(await readFile(f.credentialFile, "utf8"));
      const managerToken = await f.login(initialAdmin.username, initialAdmin.password);
      assert.ok((await f.request("/auth/me", { authorization: managerToken })).body.data.id, "a fresh bearer administrator session is valid for the management actor");
      const cancelled = await f.request("/admin/runtime/jobs/" + pending.id + "/cancel", { expected: 201, method: "POST", authorization: managerToken });
      assert.equal(cancelled.body.data.status, "cancelled");
      assert.equal((await f.prisma.runtimeJob.findUniqueOrThrow({ where: { id: pending.id } })).status, "cancelled");
      const deniedPending = await f.prisma.runtimeJob.create({ data: { jobType: "aij.runtime.g9.cancel-probe", jobVersion: 1, payload: { message: marker }, scope: "project", scopeId: "aij-foundation-test", status: "pending", runAt: new Date(Date.now() + 3_600_000), idempotencyKey: "g9-04-denied-cancel-" + randomUUID() } });
      await f.request("/admin/runtime/jobs/" + deniedPending.id + "/cancel", { expected: 403, method: "POST", authorization: readerToken });
      const audit = await f.prisma.auditLog.findFirstOrThrow({ where: { module: "runtime", action: "job_cancelled", resourceId: pending.id } });
      const { projectAudit } = require(join(process.cwd(), "apps/api/dist/audit-log/audit-redaction.js"));
      const projectedAudit = projectAudit(audit);
      assert.equal(projectedAudit.action, "job_cancelled"); assert.equal(projectedAudit.resourceType, "runtime_job"); assert.equal(projectedAudit.redacted, true);
      assert.ok(!JSON.stringify(projectedAudit).includes(marker));
      await writeRuntimeEvidence("AF-052", f.lease.id, "monitor-api.json", { database: f.lease.database, anonymousStatus: 401, noGrantStatus: 403, privilegedReadStatus: 200, unauthorizedMutationStatus: 403, authorizedMutationStatus: 201, mutationAudit: true, ready: true, queuePayloadReturned: false, jobId, outboxId });
    });

    await t.test("real DB connection refusal yields HTTP 503 and sanitized body while process liveness stays 200", async () => {
      await f.prisma.$disconnect();
      assert.deepEqual(await applicationSessions(f.lease.id, "AF-052"), []);
      const closed = await setTaskDatabaseConnections(f.lease.id, false, "AF-052"); assert.equal(closed.datallowconn, false); databaseBlocked = true;
      const unavailable = await f.request("/admin/runtime/readiness", { expected: 503 });
      assert.doesNotMatch(unavailable.text, /postgresql:|password|PrismaClient|stack|55433|aij_foundation_af052/);
      const outageDiagnostic = diagnoseRuntimeReadiness({ status: unavailable.response.status, body: unavailable.body });
      assert.equal(outageDiagnostic.failure, undefined);
      assert.equal(outageDiagnostic.ready, false);
      await writeRuntimeEvidence("AF-052", f.lease.id, "database-outage-503.json", outageDiagnostic);
      const live = await f.request("/health"); assert.equal(live.body.data.scope, "process");
      await setTaskDatabaseConnections(f.lease.id, true, "AF-052"); databaseBlocked = false;
      const restoredAt = Date.now();
      const recovered = await waitReady("database-recovery", restoredAt);
      assert.equal(recovered.status, 200); assert.equal(recovered.body.data.ready, true);
      for (const state of [recovered.body.data.worker, recovered.body.data.scheduler]) {
        assert.equal(state.status, "running"); assert.equal(state.hasError, false);
        assert.ok(Date.parse(state.lastPollAt) > restoredAt, "DB recovery must be followed by both fresh runtime heartbeats");
      }
      assert.equal((await f.prisma.runtimeJob.findUniqueOrThrow({ where: { id: jobId } })).status, "dead");
      assert.equal((await f.prisma.runtimeOutbox.findUniqueOrThrow({ where: { id: outboxId } })).status, "dead");
    });

    await t.test("closing the real API releases its Prisma pool", async () => {
      await f.close(); applicationClosed = true;
      assert.deepEqual(await applicationSessions(f.lease.id, "AF-052"), []);
    });
  } finally {
    if (databaseBlocked) await setTaskDatabaseConnections(f.lease.id, true, "AF-052");
    if (!applicationClosed && f.app.getHttpServer().listening) await f.close();
  }
});
