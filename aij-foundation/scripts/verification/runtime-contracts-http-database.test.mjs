import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createRuntimeFixture, writeRuntimeEvidence } from "./runtime-fixture.mjs";

test("G12-05 runtime contracts are consumed by the Nest host over real PostgreSQL and HTTP", { timeout: 300000 }, async t => {
  const f = await createRuntimeFixture("AF-063");
  try {
    const jobType = "aij.foundation.g12.runtime-contracts-probe";
    const eventType = "aij.foundation.g12.runtime-contracts-event";
    const scope = { type: "project", id: "aij-foundation-test" };
    const privatePayload = "synthetic-af063-" + randomUUID();
    const idempotencyKey = "af063-job-" + randomUUID();
    f.registry.registerJob(jobType, 1, async () => {});
    let job;

    await t.test("registered package QueueAdapter host persists a job and actual API HTTP omits its payload", async () => {
      job = await f.jobs.enqueue({ type: jobType, version: 1, payload: { apiKey: "must-redact", note: privatePayload }, scope, idempotencyKey });
      const row = await f.prisma.runtimeJob.findUniqueOrThrow({ where: { id: job.id } });
      assert.equal(row.status, "pending");
      assert.equal(row.payload.apiKey, "[REDACTED]");
      assert.equal(row.payload.note, privatePayload, "non-secret synthetic data is durable in PostgreSQL");

      const response = await f.request("/admin/runtime/jobs?status=pending");
      assert.equal(response.response.status, 200);
      const projected = JSON.stringify(response.body.data.items);
      assert.ok(response.body.data.items.some(item => item.id === job.id));
      assert.doesNotMatch(projected, /payload|apiKey|idempotencyKey|correlationId|lastError/);
      assert.doesNotMatch(projected, new RegExp(privatePayload));
      assert.equal(f.migrationStatus.status, "UP_TO_DATE", "this task-owned logical test DB has a current migration state");
    });

    await t.test("PostgreSQL unique idempotency boundary rejects a duplicate job", async () => {
      await assert.rejects(f.jobs.enqueue({ type: jobType, version: 1, payload: { note: "duplicate" }, scope, idempotencyKey }), error => error?.code === "P2002");
      assert.equal(await f.prisma.runtimeJob.count({ where: { idempotencyKey, scopeId: scope.id } }), 1);
    });

    await t.test("runtime job writes join the caller transaction and roll back atomically", async () => {
      const rollbackKey = "af063-rollback-" + randomUUID();
      await assert.rejects(f.prisma.$transaction(async tx => {
        await f.jobs.enqueueInTransaction(tx, { type: jobType, version: 1, payload: { note: "rollback" }, scope, idempotencyKey: rollbackKey });
        throw new Error("synthetic AF-063 transaction rollback");
      }), /synthetic AF-063 transaction rollback/);
      assert.equal(await f.prisma.runtimeJob.count({ where: { idempotencyKey: rollbackKey } }), 0);
    });

    await t.test("outbox contract persists through its transaction and enforces its own duplicate key", async () => {
      const outboxKey = "af063-outbox-" + randomUUID();
      await f.prisma.$transaction(tx => f.outbox.enqueue(tx, {
        id: randomUUID(), type: eventType, version: 1, occurredAt: new Date().toISOString(), producer: "aij-af063-test",
        scope, idempotencyKey: outboxKey, payload: { note: privatePayload }
      }));
      const outbox = await f.prisma.runtimeOutbox.findUnique({ where: { eventType_idempotencyKey: { eventType, idempotencyKey: outboxKey } } });
      assert.ok(outbox);
      assert.equal(outbox.status, "pending");
      assert.equal(outbox.payload.note, privatePayload);
      await assert.rejects(f.prisma.$transaction(tx => f.outbox.enqueue(tx, {
        type: eventType, version: 1, producer: "aij-af063-test", scope, idempotencyKey: outboxKey, payload: {}
      })), error => error?.code === "P2002");
      assert.equal(await f.prisma.runtimeOutbox.count({ where: { eventType, idempotencyKey: outboxKey } }), 1);
    });

    const foreignKeys = await f.prisma.$queryRaw`SELECT constraint_name FROM information_schema.table_constraints WHERE table_schema='public' AND table_name IN ('runtime_outbox','runtime_job','runtime_scheduler_lock','runtime_idempotency') AND constraint_type='FOREIGN KEY'`;
    assert.deepEqual(foreignKeys, [], "generic runtime contracts keep no business-model foreign keys");
    await writeRuntimeEvidence("AF-063", f.lease.id, "runtime-host-http-database.json", {
      database: f.lease.database, migrationStatus: f.migrationStatus.status, apiPort: new URL(f.baseUrl).port,
      jobId: job.id, jobRows: await f.prisma.runtimeJob.count(), outboxRows: await f.prisma.runtimeOutbox.count(),
      duplicateJobRejected: true, duplicateOutboxRejected: true, transactionRollbackRows: 0,
      payloadOmittedFromHttp: true, businessForeignKeys: 0
    });
  } finally {
    await f.close();
  }
});
