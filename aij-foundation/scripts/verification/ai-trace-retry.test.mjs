import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";
import { repositoryRoot } from "../database/connection.mjs";
import { createRuntimeFixture, writeRuntimeEvidence } from "./runtime-fixture.mjs";

const require = createRequire(join(repositoryRoot, "apps/api/package.json"));
const stringifySafe = value => JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item);

test("AF-094 recovers an AI provider failure through a durable retry without duplicating Trace or Cost", { timeout: 240_000 }, async t => {
  const f = await createRuntimeFixture("AF-094", { enabledPlugins: [] });
  let fixtureClosed = false;
  const closeFixture = async () => {
    if (fixtureClosed) return;
    fixtureClosed = true;
    await f.close();
  };
  try {
    const { AiModelExecutionService, AI_EXECUTION_JOB } = require("../../apps/api/dist/plugins/aij-ai/ai-execution.service.js");
    const { AiExecutionTraceService } = require("../../apps/api/dist/plugins/aij-ai/ai-execution-trace.service.js");
    const { AiProviderRegistry, AiBudgetExceededException } = require("../../apps/api/dist/plugins/aij-ai/ai-provider.js");
    const { PluginRuntimeAccessService } = require("../../apps/api/dist/plugin-runtime/plugin-runtime-access.service.js");
    const project = await f.prisma.projectProfile.findUniqueOrThrow({ where: { code: "aij-foundation-test" }, select: { id: true } });
    await f.prisma.pluginInstallation.upsert({
      where: { projectId_pluginCode: { projectId: project.id, pluginCode: "aij-ai" } },
      create: { projectId: project.id, pluginCode: "aij-ai", version: "0.1.0", owner: "@aij/api", status: "enabled", installedAt: new Date(), enabledAt: new Date() },
      update: { status: "enabled", installedAt: new Date(), enabledAt: new Date(), disabledAt: null, uninstalledAt: null }
    });
    let failFirstAttempt = true;
    let withinBudget = true;
    const providerCalls = [];
    const receipt = {
      output: { answer: "synthetic recovered output", secretValue: "synthetic-private-output" },
      usage: { promptTokens: 9, completionTokens: 5, cachedTokens: 2, costAmountNanos: "7654321", costCurrency: "USD" }
    };
    const provider = {
      providerCode: "offline-fixture",
      models: [{ modelCode: "offline-model", capabilities: ["text.generate"] }],
      async invoke(request, credential) {
        providerCalls.push({ traceId: request.traceId, correlationId: request.correlationId });
        assert.equal(credential, "synthetic-secret-only-in-memory");
        if (failFirstAttempt) {
          failFirstAttempt = false;
          throw new Error("synthetic provider failure prompt=private email=private@example.test credential=synthetic-secret-only-in-memory");
        }
        return receipt;
      }
    };
    const traces = new AiExecutionTraceService(f.prisma);
    const service = new AiModelExecutionService(
      f.prisma,
      f.app.get(PluginRuntimeAccessService),
      f.jobs,
      f.registry,
      { async assertEnabled() {} },
      { async resolveActive() { return { providerCode: "offline-fixture", modelCode: "offline-model", credentialRef: "local://aij-foundation/test/AI_PROVIDER_KEY" }; } },
      { async assertWithinBudget() { if (!withinBudget) throw new AiBudgetExceededException(); } },
      { async resolveTrustedForPlugin() { return "synthetic-secret-only-in-memory"; } },
      new AiProviderRegistry([provider]),
      traces
    );
    service.onModuleInit();

    const health = await f.request("/health");
    assert.equal(health.body.data.status, "ok", "real Nest HTTP host is alive against the test database");
    const submitted = await service.submit({
      capabilityCode: "text.generate",
      payload: { prompt: "synthetic private prompt", accessToken: "synthetic-secret-only-in-memory" }
    }, { idempotencyKey: "af094-provider-retry" });

    let retryJob;
    let firstTrace;
    let recoveredJob;
    let secondTrace;
    await t.test("provider error is persisted as retry plus a failed attempt Trace", async () => {
      const [firstClaim] = await f.jobs.claim("af094-provider-worker-1", 1, 5000);
      assert.equal(firstClaim.id, submitted.id);
      assert.equal(firstClaim.attempts, 1);
      await f.jobs.execute(firstClaim);
      retryJob = await f.prisma.runtimeJob.findUniqueOrThrow({ where: { id: submitted.id } });
      firstTrace = await f.prisma.aiExecutionTrace.findUniqueOrThrow({ where: { jobId_attempt: { jobId: submitted.id, attempt: 1 } } });
      assert.equal(retryJob.status, "retry");
      assert.equal(retryJob.attempts, 1);
      assert.equal(retryJob.lastError, "RUNTIME_OPERATION_FAILED");
      assert.equal(firstTrace.status, "failed");
      assert.equal(firstTrace.failureCategory, "provider_error");
      assert.equal(firstTrace.costAmountNanos, null);
      const persisted = stringifySafe(firstTrace);
      for (const secret of ["synthetic private prompt", "private@example.test", "synthetic-secret-only-in-memory", "synthetic-private-output"]) assert.equal(persisted.includes(secret), false);
      const idempotency = await f.prisma.runtimeIdempotency.findFirstOrThrow({ where: { requestScope: "job", idempotencyKey: "af094-provider-retry" } });
      assert.equal(idempotency.status, "processing", "the existing durable idempotency owner remains retryable");
    });

    await t.test("same RuntimeJob resumes at attempt 2, succeeds once, and keeps per-attempt cost truth", async () => {
      await f.prisma.runtimeJob.update({ where: { id: submitted.id }, data: { runAt: new Date(Date.now() - 1000) } });
      const [secondClaim] = await f.jobs.claim("af094-provider-worker-2", 1, 5000);
      assert.equal(secondClaim.id, submitted.id);
      assert.equal(secondClaim.attempts, 2);
      await f.jobs.execute(secondClaim);
      recoveredJob = await f.prisma.runtimeJob.findUniqueOrThrow({ where: { id: submitted.id } });
      secondTrace = await f.prisma.aiExecutionTrace.findUniqueOrThrow({ where: { jobId_attempt: { jobId: submitted.id, attempt: 2 } } });
      const tracesForJob = await f.prisma.aiExecutionTrace.findMany({ where: { jobId: submitted.id }, orderBy: { attempt: "asc" } });
      assert.equal(recoveredJob.status, "completed");
      assert.equal(recoveredJob.attempts, 2);
      assert.deepEqual(tracesForJob.map(row => [row.attempt, row.status]), [[1, "failed"], [2, "succeeded"]]);
      assert.equal(await f.prisma.aiExecutionTrace.count({ where: { jobId: submitted.id } }), 2);
      assert.equal(secondTrace.costSource, "provider_reported");
      assert.equal(secondTrace.costAmountNanos, 7654321n);
      assert.equal(secondTrace.costCurrency, "USD");
      assert.equal(secondTrace.promptTokens, 9);
      assert.equal(secondTrace.completionTokens, 5);
      assert.equal(providerCalls.length, 2);
      assert.notEqual(providerCalls[0].traceId, providerCalls[1].traceId);
      assert.equal(providerCalls[0].correlationId, providerCalls[1].correlationId);
      assert.deepEqual(recoveredJob.resultReference, { executionId: submitted.id, traceId: secondTrace.id, outputStored: false });
      const idempotency = await f.prisma.runtimeIdempotency.findFirstOrThrow({ where: { requestScope: "job", idempotencyKey: "af094-provider-retry" } });
      assert.equal(idempotency.status, "completed");
      assert.deepEqual(idempotency.resultReference, recoveredJob.resultReference);
    });

    await t.test("replayed receipt is idempotent; conflicting cost cannot replace the persisted receipt", async () => {
      await f.prisma.$disconnect();
      await f.prisma.$connect();
      const persisted = await f.prisma.aiExecutionTrace.findUniqueOrThrow({ where: { jobId_attempt: { jobId: submitted.id, attempt: 2 } } });
      assert.equal(persisted.costAmountNanos, 7654321n, "provider cost survived a real PostgreSQL client reconnect");
      await Promise.all([traces.succeed(persisted.id, receipt), traces.succeed(persisted.id, receipt)]);
      await assert.rejects(traces.succeed(persisted.id, { ...receipt, usage: { ...receipt.usage, costAmountNanos: "99" } }), /conflicts with its recorded attempt/);
      const unchanged = await f.prisma.aiExecutionTrace.findUniqueOrThrow({ where: { id: persisted.id } });
      assert.equal(unchanged.costAmountNanos, 7654321n);
      const replay = await service.submit({ capabilityCode: "text.generate", payload: { prompt: "synthetic private prompt", accessToken: "synthetic-secret-only-in-memory" } }, { idempotencyKey: "af094-provider-retry" });
      assert.equal(replay.id, submitted.id);
      assert.equal(replay.idempotentReplay, true);
      assert.equal(await f.prisma.runtimeJob.count({ where: { jobType: AI_EXECUTION_JOB, idempotencyKey: "af094-provider-retry" } }), 1);
    });

    let budgetJob;
    await t.test("budget denial after enqueue records no Provider call and no estimated Cost", async () => {
      const callsBefore = providerCalls.length;
      const budgetSubmission = await service.submit({ capabilityCode: "text.generate", payload: { prompt: "synthetic budget case" } }, { idempotencyKey: "af094-budget-denied" });
      withinBudget = false;
      const [claim] = await f.jobs.claim("af094-budget-worker", 1, 5000);
      assert.equal(claim.id, budgetSubmission.id);
      await f.jobs.execute(claim);
      budgetJob = await f.prisma.runtimeJob.findUniqueOrThrow({ where: { id: budgetSubmission.id } });
      const trace = await f.prisma.aiExecutionTrace.findUniqueOrThrow({ where: { jobId_attempt: { jobId: budgetSubmission.id, attempt: 1 } } });
      assert.equal(budgetJob.status, "retry");
      assert.equal(trace.status, "failed");
      assert.equal(trace.failureCategory, "budget_denied");
      assert.equal(trace.costSource, "unreported");
      assert.equal(trace.costAmountNanos, null);
      assert.equal(providerCalls.length, callsBefore, "budget rejection happened before Provider invocation");
    });

    await writeRuntimeEvidence("AF-094", f.lease.id, "ai-trace-retry.json", {
      database: f.lease.database,
      projectId: project.id,
      retriedJobId: submitted.id,
      attempts: [
        { attempt: 1, status: firstTrace.status, failureCategory: firstTrace.failureCategory, costAmountNanos: firstTrace.costAmountNanos },
        { attempt: 2, status: secondTrace.status, costSource: secondTrace.costSource, costAmountNanos: String(secondTrace.costAmountNanos), currency: secondTrace.costCurrency }
      ],
      traceCountForRetriedJob: await f.prisma.aiExecutionTrace.count({ where: { jobId: submitted.id } }),
      providerCalls: providerCalls.length,
      recoveredAfterPrismaReconnect: true,
      budgetDeniedWithoutProviderCall: budgetJob.status === "retry",
      providerFixture: "offline synthetic protocol only; no external API, key or paid model invocation"
    });
  } finally {
    await closeFixture();
  }
});
