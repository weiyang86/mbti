import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createRuntimeFixture, writeRuntimeEvidence } from "./runtime-fixture.mjs";

test("G9-01 persistent runtime outbox/job tables, unique idempotency and transactional submission", { timeout: 180000 }, async t => {
  const f = await createRuntimeFixture("AF-049");
  try {
    const jobType = "aij.runtime.g9.persistence-probe", scope = { type: "project", id: "aij-foundation-test" };
    f.registry.registerJob(jobType, 1, async () => {});
    const sensitive = "runtime-private-payload-" + randomUUID();
    const key = "g9-01-" + randomUUID();
    let job;
    await t.test("registered job submission persists sanitized JSON and creates no source product relation", async () => {
      job = await f.jobs.enqueue({ type: jobType, version: 1, payload: { apiKey: "should-not-persist", note: sensitive }, scope, idempotencyKey: key, dedupeKey: "probe-" + randomUUID() });
      const row = await f.prisma.runtimeJob.findUniqueOrThrow({ where: { id: job.id } });
      assert.equal(row.status, "pending");
      assert.equal(row.payload.apiKey, "[REDACTED]");
      assert.equal(row.payload.note, sensitive, "non-secret application payload remains durable but must not be exposed or logged");
      const projected = await f.request("/admin/runtime/jobs?status=pending");
      const publicList = JSON.stringify(projected.body.data.items);
      assert.ok(projected.body.data.items.some(item => item.id === job.id));
      assert.ok(!publicList.includes(sensitive)); assert.doesNotMatch(publicList, /"payload"|idempotencyKey|correlationId|lastError/);
      const foreignKeys = await f.prisma.$queryRaw`SELECT constraint_name FROM information_schema.table_constraints WHERE table_schema='public' AND table_name IN ('runtime_outbox','runtime_job','runtime_scheduler_lock','runtime_idempotency') AND constraint_type='FOREIGN KEY'`;
      assert.deepEqual(foreignKeys, [], "generic runtime records have no business-product foreign keys");
      const outbox = await f.prisma.runtimeOutbox.count(), scheduler = await f.prisma.runtimeSchedulerLock.count(), idempotency = await f.prisma.runtimeIdempotency.count();
      assert.equal(outbox, 0); assert.equal(scheduler, 0); assert.equal(idempotency, 0);
    });

    await t.test("idempotency unique key rejects duplicate submissions at the real PostgreSQL boundary", async () => {
      await assert.rejects(f.jobs.enqueue({ type: jobType, version: 1, payload: { note: "duplicate" }, scope, idempotencyKey: key }), error => error?.code === "P2002");
      assert.equal(await f.prisma.runtimeJob.count({ where: { idempotencyKey: key, scopeId: scope.id } }), 1);
    });

    await t.test("transactional submission rolls back with its caller", async () => {
      const rollbackKey = "g9-01-rollback-" + randomUUID();
      await assert.rejects(f.prisma.$transaction(async tx => {
        await f.jobs.enqueueInTransaction(tx, { type: jobType, version: 1, payload: { note: "rollback" }, scope, idempotencyKey: rollbackKey });
        throw new Error("synthetic rollback probe");
      }), /synthetic rollback probe/);
      assert.equal(await f.prisma.runtimeJob.count({ where: { idempotencyKey: rollbackKey } }), 0);
    });

    await t.test("outbox insert participates in its caller transaction and has an independent idempotency namespace", async () => {
      assert.equal(f.migrationStatus.status, "UP_TO_DATE", "migration status was checked against this new database before the isolated API environment started");
      const eventType = "aij.runtime.g9.persistence-event", eventKey = "g9-01-event-" + randomUUID();
      await f.prisma.$transaction(async tx => f.outbox.enqueue(tx, { type: eventType, version: 1, producer: "aij-test", scope, idempotencyKey: eventKey, payload: { note: sensitive } }));
      const event = await f.prisma.runtimeOutbox.findUnique({ where: { eventType_idempotencyKey: { eventType, idempotencyKey: eventKey } } });
      assert.ok(event); assert.equal(event?.payload.note, sensitive); assert.equal(event?.status, "pending");
      await assert.rejects(f.prisma.$transaction(async tx => f.outbox.enqueue(tx, { type: eventType, version: 1, producer: "aij-test", scope, idempotencyKey: eventKey, payload: {} })), error => error?.code === "P2002");
      assert.equal(await f.prisma.runtimeOutbox.count({ where: { eventType, idempotencyKey: eventKey } }), 1);
      await writeRuntimeEvidence("AF-049", f.lease.id, "persistent-outbox-job.json", { database: f.lease.database, migrationStatus: f.migrationStatus.status, jobId: job.id, jobRows: await f.prisma.runtimeJob.count(), outboxRows: await f.prisma.runtimeOutbox.count(), transactionalRollbackRows: 0, businessForeignKeys: 0, payloadNotReturnedByManagementList: true });
    });
  } finally { await f.close(); }
});
