import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";
import { repositoryRoot } from "../database/connection.mjs";
import { createRuntimeFixture, writeRuntimeEvidence } from "./runtime-fixture.mjs";

const pluginCode = "aij-notification";
const require = createRequire(join(repositoryRoot, "apps/api/package.json"));

test("AF-081 uses real PostgreSQL Outbox and RuntimeJob for idempotent notification retries", { timeout: 240_000 }, async t => {
  const f = await createRuntimeFixture("AF-081", { enabledPlugins: [pluginCode] });
  try {
    const { NotificationDeliveryService, NOTIFICATION_DELIVERY_EVENT, NOTIFICATION_DELIVERY_JOB } = require("../../apps/api/dist/plugins/aij-notification/notification-delivery.service.js");
    const { NotificationProviderRegistry } = require("../../apps/api/dist/plugins/aij-notification/notification-provider.js");

    const project = await f.prisma.projectProfile.findUniqueOrThrow({ where: { code: "aij-foundation-test" }, select: { id: true } });
    await f.prisma.pluginInstallation.create({ data: {
      projectId: project.id, pluginCode, version: "0.1.0", owner: "@aij/api", status: "enabled", installedAt: new Date(), enabledAt: new Date()
    } });
    const delivery = f.app.get(NotificationDeliveryService);
    const providers = f.app.get(NotificationProviderRegistry);
    const calls = [];
    providers.register({
      channelType: "in_app", requiresSecretRef: false,
      async deliver(context) {
        calls.push(context);
        if (calls.length === 1) throw Object.assign(new Error("provider token=af081-private-marker"), { runtimeRetryable: true });
        return { providerMessageId: "af081-synthetic-receipt" };
      }
    });
    assert.ok(f.registry.registeredEventDefinitions().some(item => item.type === NOTIFICATION_DELIVERY_EVENT && item.version === 1));
    assert.ok(f.registry.registeredJobDefinitions().some(item => item.type === NOTIFICATION_DELIVERY_JOB && item.version === 1));

    const payload = { messageId: "af081-message-1", recipientId: "af081-recipient-1", channelType: "in_app", title: "Synthetic title", body: "Synthetic body", contentType: "text" };
    await t.test("request writes one event and exact replay returns the existing event; key reuse with changed content is rejected", async () => {
      const first = await f.prisma.$transaction(tx => delivery.requestDelivery(tx, payload, "af081-delivery-1"));
      const replay = await f.prisma.$transaction(tx => delivery.requestDelivery(tx, payload, "af081-delivery-1"));
      assert.equal(replay.eventId, first.eventId);
      assert.equal(await f.prisma.runtimeOutbox.count({ where: { eventType: NOTIFICATION_DELIVERY_EVENT, idempotencyKey: "af081-delivery-1" } }), 1);
      await assert.rejects(f.prisma.$transaction(tx => delivery.requestDelivery(tx, { ...payload, body: "different" }, "af081-delivery-1")), error => error.status === 409);
      assert.equal(await f.prisma.runtimeOutbox.count({ where: { eventType: NOTIFICATION_DELIVERY_EVENT, idempotencyKey: "af081-delivery-1" } }), 1);
      await assert.rejects(f.prisma.$transaction(tx => delivery.requestDelivery(tx, { ...payload, projectId: "attacker-project" }, "af081-forged-project")), error => error.status === 400);
    });

    const event = await f.prisma.runtimeOutbox.findUniqueOrThrow({ where: { eventType_idempotencyKey: { eventType: NOTIFICATION_DELIVERY_EVENT, idempotencyKey: "af081-delivery-1" } } });
    const unknown = await f.prisma.$transaction(tx => f.outbox.enqueue(tx, {
      type: "af081.unregistered.event", version: 1, producer: "aij-test", scope: { type: "plugin", id: project.id, pluginCode },
      idempotencyKey: "af081-unregistered", payload: { marker: "unregistered" }
    }));

    await t.test("Outbox claim only consumes registered event versions and enabled plugin scope", async () => {
      const claimed = await f.outbox.claim("af081-worker", 10, 5000);
      assert.deepEqual(claimed.map(row => row.id), [event.id]);
      assert.ok(!claimed.some(row => row.id === unknown.id));
      await f.outbox.deliver(claimed[0]);
      const storedEvent = await f.prisma.runtimeOutbox.findUniqueOrThrow({ where: { id: event.id } });
      assert.equal(storedEvent.status, "processed");
      assert.equal(await f.prisma.runtimeJob.count({ where: { jobType: NOTIFICATION_DELIVERY_JOB, pluginCode } }), 1);
      assert.equal((await f.prisma.runtimeOutbox.findUniqueOrThrow({ where: { id: unknown.id } })).status, "pending");
    });

    const firstJob = await f.prisma.runtimeJob.findFirstOrThrow({ where: { jobType: NOTIFICATION_DELIVERY_JOB, pluginCode, idempotencyKey: `notification:${event.id}` } });
    await t.test("provider transient failure persists a retry/backoff without leaking exception text", async () => {
      const [claimed] = await f.jobs.claim("af081-worker", 10, 5000);
      assert.equal(claimed.id, firstJob.id);
      await f.jobs.execute(claimed);
      const retry = await f.prisma.runtimeJob.findUniqueOrThrow({ where: { id: firstJob.id } });
      assert.equal(retry.status, "retry"); assert.equal(retry.attempts, 1); assert.ok(retry.runAt.getTime() > Date.now());
      assert.equal(retry.lastError, "RUNTIME_OPERATION_FAILED");
      assert.ok(!JSON.stringify(retry).includes("af081-private-marker"));
      assert.equal((await delivery.status(event.id)).status, "retry");
      assert.deepEqual(await f.jobs.claim("af081-worker-too-early", 10, 5000), []);
    });

    await t.test("retry uses stable provider idempotency, success completes the sole RuntimeJob status, replay does not redeliver", async () => {
      await f.prisma.runtimeJob.update({ where: { id: firstJob.id }, data: { runAt: new Date(Date.now() - 1000) } });
      const [retry] = await f.jobs.claim("af081-worker-retry", 10, 5000);
      assert.equal(retry.id, firstJob.id); assert.equal(retry.attempts, 2);
      await f.jobs.execute(retry);
      const completed = await f.prisma.runtimeJob.findUniqueOrThrow({ where: { id: firstJob.id } });
      assert.equal(completed.status, "completed"); assert.equal(completed.attempts, 2);
      assert.deepEqual(calls.map(call => call.idempotencyKey), [`notification:${event.id}`, `notification:${event.id}`]);
      assert.deepEqual(calls.map(call => call.attemptNo), [1, 2]);
      assert.equal((await delivery.status(event.id)).status, "completed");
      await f.jobs.execute(retry);
      assert.equal(calls.length, 2);
    });

    await t.test("external channels fail closed without a provider and disabled plugin events remain pending", async () => {
      const external = await f.prisma.$transaction(tx => delivery.requestDelivery(tx, {
        ...payload, channelType: "email", recipientAddress: "synthetic@example.invalid"
      }, "af081-no-provider"));
      const [externalEvent] = await f.outbox.claim("af081-external-worker", 10, 5000);
      assert.equal(externalEvent.id, external.eventId); await f.outbox.deliver(externalEvent);
      const externalJob = await f.prisma.runtimeJob.findFirstOrThrow({ where: { idempotencyKey: `notification:${external.eventId}` } });
      const [externalClaim] = await f.jobs.claim("af081-external-job-worker", 10, 5000);
      assert.equal(externalClaim.id, externalJob.id); await f.jobs.execute(externalClaim);
      const deferred = await f.prisma.runtimeJob.findUniqueOrThrow({ where: { id: externalJob.id } });
      assert.equal(deferred.status, "retry"); assert.equal(deferred.lastError, "RUNTIME_OPERATION_FAILED");
      assert.equal(calls.length, 2, "unregistered email provider is never invoked");

      const pending = await f.prisma.$transaction(tx => delivery.requestDelivery(tx, payload, "af081-disabled-event"));
      await f.prisma.pluginInstallation.update({ where: { projectId_pluginCode: { projectId: project.id, pluginCode } }, data: { status: "installed", disabledAt: new Date() } });
      assert.deepEqual(await f.outbox.claim("af081-disabled-worker", 10, 5000), []);
      assert.equal((await f.prisma.runtimeOutbox.findUniqueOrThrow({ where: { id: pending.eventId } })).status, "pending");
    });

    await writeRuntimeEvidence("AF-081", f.lease.id, "notification-outbox.json", {
      database: f.lease.database, eventId: event.id, eventStatus: (await f.prisma.runtimeOutbox.findUniqueOrThrow({ where: { id: event.id }, select: { status: true } })).status,
      jobId: firstJob.id, attempts: calls.map(call => call.attemptNo), providerCalls: calls.length, statusOwner: "runtime_job", unknownEventLeftPending: true,
      disabledPluginEventLeftPending: true, missingExternalProviderFailedClosed: true, exceptionTextPersisted: false
    });
  } finally {
    await f.close();
  }
});
