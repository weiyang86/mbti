import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";
import { repositoryRoot } from "../database/connection.mjs";
import { createRuntimeFixture, writeRuntimeEvidence } from "./runtime-fixture.mjs";

const require = createRequire(join(repositoryRoot, "apps/api/package.json"));
const stringifySafe = value => JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item);

test("AF-092 persists AI async state in the real RuntimeJob owner", { timeout: 240_000 }, async t => {
  const f = await createRuntimeFixture("AF-092", { enabledPlugins: [] });
  try {
    const { AiModelExecutionService, AI_EXECUTION_JOB } = require("../../apps/api/dist/plugins/aij-ai/ai-execution.service.js");
    const { AiExecutionTraceService } = require("../../apps/api/dist/plugins/aij-ai/ai-execution-trace.service.js");
    const { AiProviderRegistry } = require("../../apps/api/dist/plugins/aij-ai/ai-provider.js");
    const { PluginRuntimeAccessService } = require("../../apps/api/dist/plugin-runtime/plugin-runtime-access.service.js");
    const project = await f.prisma.projectProfile.findUniqueOrThrow({ where: { code: "aij-foundation-test" }, select: { id: true } });
    const calls = [];
    let timeoutAttempts = 0;
    let capabilityEnabled = true;
    let withinBudget = true;
    const provider = {
      providerCode: "offline-fixture",
      models: [{ modelCode: "offline-model", capabilities: ["text.generate"] }],
      async invoke(request, credential) {
        calls.push({ modelCode: request.modelCode, capabilityCode: request.capabilityCode, payload: request.payload });
        assert.equal(credential, "synthetic-secret-only-in-memory");
        if (request.payload.mode === "timeout-once" && timeoutAttempts++ === 0) {
          return new Promise((resolve, reject) => {
            const rejectAfterAbort = () => reject(new Error("offline timeout credential=synthetic-secret-only-in-memory"));
            if (request.signal?.aborted) rejectAfterAbort();
            else request.signal?.addEventListener("abort", rejectAfterAbort, { once: true });
          });
        }
        return { output: { text: "synthetic provider output; never persisted" }, usage: { promptTokens: 4, completionTokens: 2, costAmountNanos: "50", costCurrency: "USD" } };
      }
    };
    const service = new AiModelExecutionService(
      f.prisma,
      f.app.get(PluginRuntimeAccessService),
      f.jobs,
      f.registry,
      { async assertEnabled() { if (!capabilityEnabled) throw new Error("capability disabled marker"); } },
      { async resolveActive() { return { providerCode: "offline-fixture", modelCode: "offline-model", credentialRef: "local://aij-foundation/test/AI_PROVIDER_KEY" }; } },
      { async assertWithinBudget() { if (!withinBudget) throw new Error("budget denied marker"); } },
      { async resolveTrustedForPlugin(pluginCode, reference) {
        assert.equal(pluginCode, "aij-ai"); assert.equal(reference, "local://aij-foundation/test/AI_PROVIDER_KEY");
        return "synthetic-secret-only-in-memory";
      } },
      new AiProviderRegistry([provider]),
      new AiExecutionTraceService(f.prisma)
    );
    service.onModuleInit();

    await t.test("real API host and database are ready; disabled plugin and client-owned scope fail before persistence", async () => {
      const health = await f.request("/health");
      assert.equal(health.body.data.status, "ok");
      assert.equal(await f.prisma.runtimeJob.count({ where: { jobType: AI_EXECUTION_JOB } }), 0);
      await assert.rejects(service.submit({ capabilityCode: "text.generate", payload: { prompt: "synthetic" } }, { idempotencyKey: "disabled-plugin" }), error => error.getStatus?.() === 404);
      await f.prisma.pluginInstallation.upsert({
        where: { projectId_pluginCode: { projectId: project.id, pluginCode: "aij-ai" } },
        create: { projectId: project.id, pluginCode: "aij-ai", version: "0.1.0", owner: "@aij/api", status: "enabled", installedAt: new Date(), enabledAt: new Date() },
        update: { status: "enabled", installedAt: new Date(), enabledAt: new Date(), disabledAt: null, uninstalledAt: null }
      });
      await assert.rejects(service.submit({ capabilityCode: "text.generate", projectId: "forged-project", payload: {} }, { idempotencyKey: "forged-project" }), error => error.getStatus?.() === 400);
      await assert.rejects(service.submit({ capabilityCode: "text.generate", scope: { id: "forged-project" }, payload: {} }, { idempotencyKey: "forged-scope" }), error => error.getStatus?.() === 400);
      await assert.rejects(f.jobs.enqueueIdempotent({
        type: AI_EXECUTION_JOB, version: 1, payload: { capabilityCode: "text.generate", payload: {} },
        scope: { type: "plugin", id: "forged-project", pluginCode: "aij-ai" }, idempotencyKey: "direct-forged-scope"
      }), error => error.getStatus?.() === 403);
      await assert.rejects(service.submit({ capabilityCode: "text.generate", payload: {} }, { idempotencyKey: "bad options", timeoutMs: 10 }), error => error.getStatus?.() === 400);
      assert.equal(await f.prisma.runtimeJob.count({ where: { jobType: AI_EXECUTION_JOB } }), 0);
    });

    let cancelledId;
    await t.test("concurrent identical submissions create one job; changed content with the same key conflicts", async () => {
      const request = { capabilityCode: "text.generate", payload: { prompt: "synthetic concurrent request" } };
      const [first, replay] = await Promise.all([
        service.submit(request, { idempotencyKey: "same-request-key" }),
        service.submit(request, { idempotencyKey: "same-request-key" })
      ]);
      assert.equal(first.id, replay.id);
      assert.deepEqual([first.idempotentReplay, replay.idempotentReplay].sort(), [false, true]);
      cancelledId = first.id;
      assert.equal(await f.prisma.runtimeJob.count({ where: { jobType: AI_EXECUTION_JOB, idempotencyKey: "same-request-key" } }), 1);
      await assert.rejects(service.submit({ ...request, payload: { prompt: "changed request" } }, { idempotencyKey: "same-request-key" }), error => error.getStatus?.() === 409);
      const status = await service.status(first.id);
      assert.equal(status.status, "pending");
      assert.equal(status.hasError, false);
      assert.equal("payload" in status, false);
      assert.equal("resultReference" in status, false);
      assert.equal("lastError" in status, false);
      assert.equal(calls.length, 0, "submission is asynchronous and never invokes the provider inline");
    });

    await t.test("cancel only changes pending/retry jobs and rejects terminal or foreign-scope status", async () => {
      const cancelled = await service.cancel(cancelledId);
      assert.equal(cancelled.status, "cancelled");
      assert.equal((await service.status(cancelledId)).status, "cancelled");
      await assert.rejects(service.cancel(cancelledId), error => error.getStatus?.() === 409);

      const foreignId = "foreign-ai-job-0001";
      await f.prisma.runtimeJob.create({ data: {
        id: foreignId, jobType: AI_EXECUTION_JOB, jobVersion: 1, status: "completed", completedAt: new Date(), payload: { capabilityCode: "text.generate", payload: {} },
        scope: "plugin", scopeId: "another-project-id", pluginCode: "aij-ai", idempotencyKey: "foreign-scope-key"
      } });
      await assert.rejects(service.status(foreignId), error => error.getStatus?.() === 404);
      await assert.rejects(service.cancel(foreignId), error => error.getStatus?.() === 404);
    });

    await t.test("capability/budget denial is fail-closed and leaves no durable job", async () => {
      const before = await f.prisma.runtimeJob.count({ where: { jobType: AI_EXECUTION_JOB } });
      capabilityEnabled = false;
      await assert.rejects(service.submit({ capabilityCode: "text.generate", payload: {} }, { idempotencyKey: "capability-denied" }), error => error.getStatus?.() === 503);
      capabilityEnabled = true;
      withinBudget = false;
      await assert.rejects(service.submit({ capabilityCode: "text.generate", payload: {} }, { idempotencyKey: "budget-denied" }), error => error.getStatus?.() === 503);
      withinBudget = true;
      assert.equal(await f.prisma.runtimeJob.count({ where: { jobType: AI_EXECUTION_JOB } }), before);
    });

    let timeoutJobId;
    await t.test("timeout aborts the offline provider, persists a redacted retry, then retry completes in RuntimeJob", async () => {
      const created = await service.submit({ capabilityCode: "text.generate", payload: { mode: "timeout-once" } }, { idempotencyKey: "timeout-retry-key", timeoutMs: 100 });
      timeoutJobId = created.id;
      const [firstAttempt] = await f.jobs.claim("af092-timeout-worker-1", 10, 5000);
      assert.equal(firstAttempt.id, timeoutJobId);
      await f.jobs.execute(firstAttempt);
      const retry = await f.prisma.runtimeJob.findUniqueOrThrow({ where: { id: timeoutJobId } });
      assert.equal(retry.status, "retry");
      assert.equal(retry.attempts, 1);
      assert.equal(retry.lastError, "RUNTIME_OPERATION_FAILED");
      assert.equal(JSON.stringify(retry).includes("synthetic-secret-only-in-memory"), false);
      assert.equal(JSON.stringify(retry).includes("synthetic provider output"), false);
      const failedTrace = await f.prisma.aiExecutionTrace.findUniqueOrThrow({ where: { jobId_attempt: { jobId: timeoutJobId, attempt: 1 } } });
      assert.equal(failedTrace.status, "failed");
      assert.equal(failedTrace.failureCategory, "timeout");
      assert.equal(failedTrace.costAmountNanos, null);
      await f.prisma.runtimeJob.update({ where: { id: timeoutJobId }, data: { runAt: new Date(Date.now() - 1000) } });
      const [secondAttempt] = await f.jobs.claim("af092-timeout-worker-2", 10, 5000);
      assert.equal(secondAttempt.id, timeoutJobId);
      await f.jobs.execute(secondAttempt);
      const completed = await f.prisma.runtimeJob.findUniqueOrThrow({ where: { id: timeoutJobId } });
      assert.equal(completed.status, "completed");
      assert.equal(completed.attempts, 2);
      assert.deepEqual(completed.resultReference, { executionId: timeoutJobId, traceId: (await f.prisma.aiExecutionTrace.findUniqueOrThrow({ where: { jobId_attempt: { jobId: timeoutJobId, attempt: 2 } } })).id, outputStored: false });
      const successTrace = await f.prisma.aiExecutionTrace.findUniqueOrThrow({ where: { jobId_attempt: { jobId: timeoutJobId, attempt: 2 } } });
      assert.equal(successTrace.status, "succeeded");
      assert.equal(successTrace.failureCategory, null);
      assert.equal(successTrace.costSource, "provider_reported");
      assert.equal(successTrace.costAmountNanos, 50n);
      assert.equal(successTrace.costCurrency, "USD");
      assert.deepEqual(successTrace.inputShape, { redacted: true, kind: "object", fieldCount: "1-4" });
      assert.deepEqual(successTrace.outputShape, { redacted: true, kind: "object", fieldCount: "1-4" });
      assert.equal(stringifySafe(successTrace).includes("synthetic provider output"), false);
      assert.equal(stringifySafe(successTrace).includes("synthetic-secret-only-in-memory"), false);
      assert.equal(JSON.stringify(completed).includes("synthetic provider output"), false);
      assert.equal((await service.status(timeoutJobId)).status, "completed");
      assert.equal((await f.prisma.runtimeIdempotency.findFirstOrThrow({ where: { requestScope: "job", idempotencyKey: "timeout-retry-key" } })).status, "completed");
    });

    await writeRuntimeEvidence("AF-092", f.lease.id, "ai-async-execution.json", {
      database: f.lease.database,
      pluginCode: "aij-ai",
      queueOwner: "RuntimeJob/RuntimeIdempotency via JobService/RuntimeRegistry",
      concurrentIdempotentSubmission: true,
      changedPayloadConflict: true,
      cancelledJobId: cancelledId,
      timeoutRetryJobId: timeoutJobId,
      timeoutAttempts: timeoutAttempts + 1,
      providerCalls: calls.length,
      providerFixture: "offline synthetic adapter; no external API, key, or paid model call",
      resultOwner: "G15-02 persists status/reference only; AI output/trace/cost deferred to NEXT-15B",
      credentialPersistedOrLogged: false
    });
  } finally {
    await f.close();
  }
});
