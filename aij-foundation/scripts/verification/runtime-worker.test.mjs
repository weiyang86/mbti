import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";
import { readDatabaseEnvironment, repositoryRoot } from "../database/connection.mjs";
import { createRuntimeFixture, sleep, writeRuntimeEvidence } from "./runtime-fixture.mjs";

const require = createRequire(join(repositoryRoot, "apps/api/package.json"));
const { PrismaClient } = require("@prisma/client");

test("G9-02 PostgreSQL SKIP LOCKED leases, scheduler exclusion, expiry recovery and graceful drain", { timeout: 180000 }, async t => {
  const f = await createRuntimeFixture("AF-050");
  let secondClient;
  try {
    const env = readDatabaseEnvironment("test", process.env, f.lease.id);
    const url = new URL(env.TEST_DATABASE_URL); url.searchParams.set("connection_limit", "1"); url.searchParams.set("connect_timeout", "2");
    secondClient = new PrismaClient({ datasources: { db: { url: url.href } } });
    const registry = f.registry, type = "aij.runtime.g9.lease-probe", scope = { type: "project", id: "aij-foundation-test" };
    registry.registerJob(type, 1, async () => {});
    const { JobService } = require(join(repositoryRoot, "apps/api/dist/async-runtime/job.service.js"));
    const { SchedulerService } = require(join(repositoryRoot, "apps/api/dist/async-runtime/scheduler.service.js"));
    const { RuntimeHealthService } = require(join(repositoryRoot, "apps/api/dist/async-runtime/runtime-health.service.js"));
    const { PluginRuntimeAccessService } = require(join(repositoryRoot, "apps/api/dist/plugin-runtime/plugin-runtime-access.service.js"));
    const pluginAccess = f.app.get(PluginRuntimeAccessService);
    const jobsA = f.jobs, jobsB = new JobService(secondClient, registry, pluginAccess);
    const health = f.app.get(RuntimeHealthService);
    let held;

    await t.test("two independent Prisma pools concurrently claim one committed row once", async () => {
      const created = await jobsA.enqueue({ type, version: 1, payload: { marker: "claim-race" }, scope, idempotencyKey: "g9-02-race-" + randomUUID(), timeoutMs: 1000, maxAttempts: 2 });
      const [a, b] = await Promise.all([jobsA.claim("runner-a", 1, 1000), jobsB.claim("runner-b", 1, 1000)]);
      assert.equal(a.length + b.length, 1, "SKIP LOCKED prevents duplicate ownership");
      held = a[0] || b[0]; assert.equal(held.id, created.id); assert.ok(["runner-a", "runner-b"].includes(held.lease_owner));
      assert.equal((await f.prisma.runtimeJob.findUniqueOrThrow({ where: { id: created.id } })).attempts, 1);
    });

    await t.test("expired lease is reclaimed by another worker and attempt count advances", async () => {
      await sleep(6200);
      const reclaimed = await jobsB.claim("runner-reclaimer", 1, 1000);
      assert.equal(reclaimed.length, 1); assert.equal(reclaimed[0].id, held.id); assert.equal(reclaimed[0].attempts, 2); assert.equal(reclaimed[0].lease_owner, "runner-reclaimer");
      const row = await f.prisma.runtimeJob.findUniqueOrThrow({ where: { id: held.id } }); assert.equal(row.attempts, 2); assert.equal(row.status, "running");
      await f.prisma.runtimeJob.update({ where: { id: held.id }, data: { status: "cancelled", cancelledAt: new Date(), leaseOwner: null, leaseExpiresAt: null } });
    });

    await t.test("expired last-attempt lease becomes dead instead of remaining stuck running", async () => {
      const created = await jobsA.enqueue({ type, version: 1, payload: { marker: "last-attempt" }, scope, idempotencyKey: "g9-02-last-" + randomUUID(), timeoutMs: 1000, maxAttempts: 1 });
      const [claim] = await jobsA.claim("runner-final", 1, 1000); assert.equal(claim.id, created.id); assert.equal(claim.max_attempts, 1);
      await sleep(6200);
      assert.deepEqual(await jobsB.claim("runner-after-final", 1, 1000), []);
      const row = await f.prisma.runtimeJob.findUniqueOrThrow({ where: { id: created.id } }); assert.equal(row.status, "dead"); assert.equal(row.attempts, 1); assert.equal(row.lastError, "lease_expired_at_attempt_limit");
    });

    await t.test("scheduler lock and due time permit one enqueue across concurrent schedulers", async () => {
      const scheduleType = "aij.runtime.g9.scheduler-probe", code = "g9-02-scheduler-" + randomUUID().replaceAll("-", "").slice(0, 12);
      registry.registerJob(scheduleType, 1, async () => {});
      registry.registerSchedule({ code, intervalMs: 60_000, job: now => ({ type: scheduleType, version: 1, payload: { at: now.toISOString() }, scope, idempotencyKey: "schedule-" + code, runAt: now }) });
      const schedulerA = f.app.get(SchedulerService), schedulerB = new SchedulerService(secondClient, jobsB, registry, health);
      await Promise.all([schedulerA.tick("scheduler-a"), schedulerB.tick("scheduler-b")]);
      assert.equal(await f.prisma.runtimeJob.count({ where: { jobType: scheduleType } }), 1);
      assert.equal(await f.prisma.runtimeSchedulerLock.count({ where: { scheduleCode: code } }), 1);
    });

    await t.test("worker's graceful shutdown waits for an active poll and then drains cleanly", async () => {
      const { RuntimeWorkerService } = require(join(repositoryRoot, "apps/api/dist/async-runtime/runtime-worker.service.js"));
      let release, entered;
      const enteredPromise = new Promise(resolve => { entered = resolve; });
      const gate = new Promise(resolve => { release = resolve; });
      const originalClaim = f.outbox.claim;
      f.outbox.claim = async () => { entered(); await gate; return []; };
      const { RuntimeRegistry } = require(join(repositoryRoot, "apps/api/dist/async-runtime/registry.js"));
      const emptyRegistry = new RuntimeRegistry();
      const worker = new RuntimeWorkerService(f.outbox, new JobService(f.prisma, emptyRegistry, pluginAccess), f.app.get(SchedulerService), health, { get: key => key === "asyncRuntimeEnabled" ? true : undefined } );
      worker.onModuleInit(); const active = worker.poll(); await enteredPromise;
      let stopped = false; const closing = worker.onModuleDestroy().then(() => { stopped = true; });
      await sleep(30); assert.equal(stopped, false, "shutdown waits for in-flight work");
      release(); await Promise.all([active, closing]); assert.equal(stopped, true);
      f.outbox.claim = originalClaim;
      assert.equal(health.worker.status, "stopped");
    });

    await writeRuntimeEvidence("AF-050", f.lease.id, "worker-leases.json", { database: f.lease.database, independentPrismaPools: 2, singleClaimUnderRace: true, reclaimedAttempts: 2, finalAttemptDeadLettered: true, schedulerLockCount: await f.prisma.runtimeSchedulerLock.count(), gracefulDrainWaited: true });
  } finally {
    await secondClient?.$disconnect();
    await f.close();
  }
});
