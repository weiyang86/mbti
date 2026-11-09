import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createRuntimeFixture, sleep, writeRuntimeEvidence } from "./runtime-fixture.mjs";

test("G9-03 bounded retry/backoff/dead-letter and idempotent transactional side effects", { timeout: 180000 }, async t => {
  const f = await createRuntimeFixture("AF-051");
  try {
    const scope = { type: "project", id: "aij-foundation-test" }, secret = "provider-token-" + randomUUID();
    const jobType = "aij.runtime.g9.retry-probe";
    let jobCalls = 0;
    f.registry.registerJob(jobType, 1, async () => { jobCalls++; throw new Error("provider error token=" + secret); });
    const eventType = "aij.runtime.g9.retry-event";
    let eventCalls = 0;
    f.registry.registerEvent(eventType, 1, async () => { eventCalls++; throw new Error("delivery failed apiKey=" + secret); });

    await t.test("job retry waits for persisted exponential backoff and stops at configured attempt limit", async () => {
      const created = await f.jobs.enqueue({ type: jobType, version: 1, payload: { apiKey: secret, marker: "retry" }, scope, idempotencyKey: "g9-03-job-" + randomUUID(), maxAttempts: 2, timeoutMs: 1000 });
      const [first] = await f.jobs.claim("retry-worker", 1, 1000); assert.equal(first.id, created.id);
      await f.jobs.execute(first);
      let row = await f.prisma.runtimeJob.findUniqueOrThrow({ where: { id: created.id } });
      assert.equal(row.status, "retry"); assert.equal(row.attempts, 1); assert.ok(row.runAt.getTime() >= Date.now() + 700); assert.equal(row.lastError, "RUNTIME_OPERATION_FAILED");
      await sleep(Math.max(0, row.runAt.getTime() - Date.now() + 50));
      const [second] = await f.jobs.claim("retry-worker", 1, 1000); assert.equal(second.id, created.id); assert.equal(second.attempts, 2);
      await f.jobs.execute(second);
      row = await f.prisma.runtimeJob.findUniqueOrThrow({ where: { id: created.id } });
      assert.equal(row.status, "dead"); assert.equal(row.attempts, 2); assert.equal(row.lastError, "RUNTIME_OPERATION_FAILED"); assert.equal(jobCalls, 2);
      assert.ok(!JSON.stringify(row).includes(secret), "provider exception and sensitive payload values are not stored as lastError");
    });

    await t.test("outbox retry is bounded and provider exception text is replaced with a safe failure code", async () => {
      const eventKey = "g9-03-outbox-" + randomUUID();
      await f.prisma.$transaction(async tx => f.outbox.enqueue(tx, { type: eventType, version: 1, producer: "aij-test", scope, idempotencyKey: eventKey, payload: { accessToken: secret, marker: "outbox-retry" } }));
      const row = await f.prisma.runtimeOutbox.findUniqueOrThrow({ where: { eventType_idempotencyKey: { eventType, idempotencyKey: eventKey } } });
      await f.prisma.runtimeOutbox.update({ where: { id: row.id }, data: { maxAttempts: 2 } });
      const [first] = await f.outbox.claim("outbox-worker", 1, 1000); assert.equal(first.id, row.id);
      await f.outbox.deliver(first);
      let persisted = await f.prisma.runtimeOutbox.findUniqueOrThrow({ where: { id: row.id } });
      assert.equal(persisted.status, "retry"); assert.equal(persisted.attempts, 1); assert.equal(persisted.lastError, "RUNTIME_OPERATION_FAILED");
      await sleep(Math.max(0, persisted.nextAttemptAt.getTime() - Date.now() + 50));
      const [second] = await f.outbox.claim("outbox-worker", 1, 1000); assert.equal(second.id, row.id); assert.equal(second.attempts, 2);
      await f.outbox.deliver(second);
      persisted = await f.prisma.runtimeOutbox.findUniqueOrThrow({ where: { id: row.id } });
      assert.equal(persisted.status, "dead"); assert.equal(persisted.attempts, 2); assert.equal(eventCalls, 2); assert.ok(!JSON.stringify(persisted).includes(secret));
    });

    await t.test("same committed transactional job is replayed from idempotency ledger without a second side effect", async () => {
      const onceType = "aij.runtime.g9.once-probe", key = "g9-03-once-" + randomUUID(); let calls = 0;
      f.registry.registerJob(onceType, 1, async (job, tx) => {
        calls++;
        await tx.auditLog.create({ data: { module: "runtime-test", action: "transactional_side_effect", status: "success", resourceType: "runtime_job", resourceId: job.id, requestSummary: { marker: "synthetic-once" } } });
        return { resultReference: { receipt: "synthetic-side-effect" } };
      });
      const created = await f.jobs.enqueue({ type: onceType, version: 1, payload: { marker: "effect" }, scope, idempotencyKey: key });
      const [claimed] = await f.jobs.claim("once-worker", 1, 1000); assert.equal(claimed.id, created.id);
      await f.jobs.execute(claimed); await f.jobs.execute(claimed);
      assert.equal(calls, 1);
      assert.equal(await f.prisma.auditLog.count({ where: { module: "runtime-test", action: "transactional_side_effect", resourceId: created.id } }), 1);
      const ledger = await f.prisma.runtimeIdempotency.findUniqueOrThrow({ where: { requestScope_scope_scopeId_pluginCode_owner_idempotencyKey: { requestScope: "job", scope: "project", scopeId: scope.id, pluginCode: "", owner: onceType + "@1", idempotencyKey: key } } });
      assert.equal(ledger.status, "completed");
    });

    await t.test("orchestrated handlers receive the persisted idempotency key and cooperative timeout signal", async () => {
      const orchestratedType = "aij.runtime.g9.orchestrated-probe", key = "g9-03-orchestrated-" + randomUUID(); let received;
      f.registry.registerOrchestratedJob(orchestratedType, 1, async (job) => { received = job; return { resultReference: { providerReceipt: "synthetic" } }; });
      const created = await f.jobs.enqueue({ type: orchestratedType, version: 1, payload: { marker: "external-fixture" }, scope, idempotencyKey: key, timeoutMs: 1000 });
      const [claimed] = await f.jobs.claim("orchestrated-worker", 1, 1000); assert.equal(claimed.id, created.id);
      await f.jobs.execute(claimed);
      assert.equal(received.idempotencyKey, key); assert.equal(received.signal.aborted, false); assert.equal((await f.prisma.runtimeJob.findUniqueOrThrow({ where: { id: created.id } })).status, "completed");
    });

    await t.test("orchestrated timeout aborts the cooperative handler and returns the row to bounded retry", async () => {
      const timeoutType = "aij.runtime.g9.timeout-probe", key = "g9-03-timeout-" + randomUUID(); let signal;
      f.registry.registerOrchestratedJob(timeoutType, 1, async job => { signal = job.signal; await new Promise(resolve => setTimeout(resolve, 300)); });
      const created = await f.jobs.enqueue({ type: timeoutType, version: 1, payload: { marker: "timeout" }, scope, idempotencyKey: key, timeoutMs: 100, maxAttempts: 2 });
      const [claimed] = await f.jobs.claim("timeout-worker", 1, 1000); assert.equal(claimed.id, created.id);
      await f.jobs.execute(claimed);
      const row = await f.prisma.runtimeJob.findUniqueOrThrow({ where: { id: created.id } });
      assert.equal(signal.aborted, true); assert.equal(row.status, "retry"); assert.equal(row.attempts, 1); assert.equal(row.lastError, "RUNTIME_OPERATION_FAILED");
    });

    const output = { task: "AF-051", failuresRetried: jobCalls, outboxFailuresRetried: eventCalls, jobSecretNotStored: true, outboxSecretNotStored: true, transactionalSideEffectCount: 1, orchestratedKeyExposedToHandler: true, timeoutAbortObserved: true, externalExactlyOnceClaimed: false };
    await writeRuntimeEvidence("AF-051", f.lease.id, "retry-idempotency.json", { database: f.lease.database, ...output });
  } finally { await f.close(); }
});
