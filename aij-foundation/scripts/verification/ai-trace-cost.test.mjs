import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";
import { repositoryRoot } from "../database/connection.mjs";
import { createRuntimeFixture, writeRuntimeEvidence } from "./runtime-fixture.mjs";

const require = createRequire(join(repositoryRoot, "apps/api/package.json"));
const stringifySafe = value => JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item);
const traceRow = trace => Object.fromEntries(Object.entries(trace).filter(([key]) => key !== "job"));

test("AF-093 stores redacted AI trace and provider Cost truth once per real runtime attempt", { timeout: 240_000 }, async t => {
  const f = await createRuntimeFixture("AF-093", { enabledPlugins: [] });
  try {
    const { AiModelExecutionService } = require("../../apps/api/dist/plugins/aij-ai/ai-execution.service.js");
    const { AiExecutionTraceService } = require("../../apps/api/dist/plugins/aij-ai/ai-execution-trace.service.js");
    const { AiBudgetExceededException, AiProviderRegistry } = require("../../apps/api/dist/plugins/aij-ai/ai-provider.js");
    const { PluginRuntimeAccessService } = require("../../apps/api/dist/plugin-runtime/plugin-runtime-access.service.js");
    const project = await f.prisma.projectProfile.findUniqueOrThrow({ where: { code: "aij-foundation-test" }, select: { id: true } });
    await f.prisma.pluginInstallation.upsert({
      where: { projectId_pluginCode: { projectId: project.id, pluginCode: "aij-ai" } },
      create: { projectId: project.id, pluginCode: "aij-ai", version: "0.1.0", owner: "@aij/api", status: "enabled", installedAt: new Date(), enabledAt: new Date() },
      update: { status: "enabled", installedAt: new Date(), enabledAt: new Date(), disabledAt: null, uninstalledAt: null }
    });
    let providerMode = "reported";
    let withinBudget = true;
    const providerCalls = [];
    const provider = {
      providerCode: "offline-fixture",
      models: [{ modelCode: "offline-model", capabilities: ["text.generate"] }],
      async invoke(request, credential) {
        providerCalls.push({ traceId: request.traceId, correlationId: request.correlationId });
        assert.equal(credential, "synthetic-secret-held-in-memory");
        if (providerMode === "throw") throw new Error("request prompt=synthetic-sensitive email=user@example.test secret=synthetic-secret-held-in-memory");
        if (providerMode === "invalid") return { output: { answer: "synthetic" }, usage: { costAmountNanos: 100, costCurrency: "USD" } };
        if (providerMode === "unreported") return { output: { answer: "synthetic unpriced output" }, usage: { promptTokens: 7, completionTokens: 4 } };
        return {
          output: { answer: "synthetic private output user@example.test", accessToken: "synthetic-secret-held-in-memory" },
          usage: { promptTokens: 7, completionTokens: 4, cachedTokens: 1, costAmountNanos: "123456789", costCurrency: "USD" }
        };
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
      { async resolveTrustedForPlugin() { return "synthetic-secret-held-in-memory"; } },
      new AiProviderRegistry([provider]),
      traces
    );
    service.onModuleInit();

    const health = await f.request("/health");
    assert.equal(health.body.data.status, "ok", "the real isolated Nest HTTP host is live");

    async function run(mode, key) {
      const submitted = await service.submit({
        capabilityCode: "text.generate",
        payload: { mode, prompt: "synthetic private prompt user@example.test", apiToken: "synthetic-secret-held-in-memory" }
      }, { idempotencyKey: key });
      const [claimed] = await f.jobs.claim(`af093-${key}`, 10, 5000);
      assert.equal(claimed.id, submitted.id);
      await f.jobs.execute(claimed);
      const job = await f.prisma.runtimeJob.findUniqueOrThrow({ where: { id: submitted.id } });
      const trace = await f.prisma.aiExecutionTrace.findUniqueOrThrow({ where: { jobId_attempt: { jobId: submitted.id, attempt: 1 } }, include: { job: true } });
      return { submitted, job, trace };
    }

    let reportedResult;
    let reportedReceipt;
    await t.test("job correlation, value-free trace projection and one authoritative cost owner", async () => {
      providerMode = "reported";
      const result = await run("reported", "trace-reported-cost");
      assert.equal(result.job.status, "completed");
      assert.equal(result.trace.status, "succeeded");
      assert.equal(result.trace.job.id, result.job.id);
      assert.equal(result.trace.projectId, project.id);
      assert.equal(result.trace.correlationId, result.job.correlationId || result.job.id);
      assert.deepEqual(result.job.resultReference, { executionId: result.job.id, traceId: result.trace.id, outputStored: false });
      assert.deepEqual(result.trace.inputShape, { redacted: true, kind: "object", fieldCount: "1-4" });
      assert.deepEqual(result.trace.outputShape, { redacted: true, kind: "object", fieldCount: "1-4" });
      const persisted = stringifySafe(traceRow(result.trace));
      for (const value of ["synthetic private prompt", "synthetic private output", "user@example.test", "apiToken", "accessToken", "synthetic-secret-held-in-memory"]) {
        assert.equal(persisted.includes(value), false, `trace storage excludes ${value}`);
      }
      assert.equal(result.trace.promptTokens, 7);
      assert.equal(result.trace.completionTokens, 4);
      assert.equal(result.trace.cachedTokens, 1);
      assert.equal(result.trace.costSource, "provider_reported");
      assert.equal(result.trace.costAmountNanos, 123456789n);
      assert.equal(result.trace.costCurrency, "USD");
      assert.equal(providerCalls.at(-1).traceId, result.trace.id);
      assert.equal(providerCalls.at(-1).correlationId, result.trace.correlationId);
      assert.equal(await f.prisma.aiExecutionTrace.count({ where: { jobId: result.job.id } }), 1);
      reportedResult = result;
      reportedReceipt = { output: { answer: "synthetic private output user@example.test", accessToken: "synthetic-secret-held-in-memory" }, usage: { promptTokens: 7, completionTokens: 4, cachedTokens: 1, costAmountNanos: "123456789", costCurrency: "USD" } };
    });

    const success = reportedResult;
    await t.test("same attempt receipt is idempotent; conflicting second cost cannot overwrite truth", async () => {
      const receipt = reportedReceipt;
      await traces.succeed(success.trace.id, receipt);
      assert.equal(await f.prisma.aiExecutionTrace.count({ where: { jobId: success.job.id } }), 1);
      await assert.rejects(traces.start({
        jobId: success.job.id,
        attempt: 1,
        projectId: success.trace.projectId,
        correlationId: "forged-correlation",
        capabilityCode: "text.generate",
        input: { prompt: "different private prompt" }
      }), /attempt identity conflicts with its recorded context/);
      await assert.rejects(traces.succeed(success.trace.id, { ...receipt, usage: { ...receipt.usage, costAmountNanos: "999" } }), /conflicts with its recorded attempt/);
      const unchanged = await f.prisma.aiExecutionTrace.findUniqueOrThrow({ where: { id: success.trace.id } });
      assert.equal(unchanged.costAmountNanos, 123456789n);
    });

    await t.test("token usage without a provider receipt remains unpriced instead of estimated", async () => {
      providerMode = "unreported";
      const result = await run("unreported", "trace-unreported-cost");
      assert.equal(result.job.status, "completed");
      assert.equal(result.trace.status, "succeeded");
      assert.equal(result.trace.promptTokens, 7);
      assert.equal(result.trace.completionTokens, 4);
      assert.equal(result.trace.costSource, "unreported");
      assert.equal(result.trace.costAmountNanos, null);
      assert.equal(result.trace.costCurrency, null);
    });

    await t.test("provider failure persists only a fixed failure category and no raw error", async () => {
      providerMode = "throw";
      const result = await run("throw", "trace-provider-failure");
      assert.equal(result.job.status, "retry");
      assert.equal(result.job.lastError, "RUNTIME_OPERATION_FAILED");
      assert.equal(result.trace.status, "failed");
      assert.equal(result.trace.failureCategory, "provider_error");
      const persisted = stringifySafe({ lastError: result.job.lastError, trace: traceRow(result.trace) });
      for (const value of ["synthetic private prompt", "user@example.test", "synthetic-secret-held-in-memory", "request prompt="]) assert.equal(persisted.includes(value), false);
      assert.equal(result.trace.costAmountNanos, null);
    });

    await t.test("invalid provider cost receipt is classified and fails closed", async () => {
      providerMode = "invalid";
      const result = await run("invalid", "trace-invalid-receipt");
      assert.equal(result.trace.status, "failed");
      assert.equal(result.trace.failureCategory, "invalid_provider_response");
      assert.equal(result.trace.costSource, "unreported");
      assert.equal(result.trace.costAmountNanos, null);
      assert.equal(result.trace.costCurrency, null);
    });

    await t.test("budget revoked after enqueue is classified before any provider call", async () => {
      providerMode = "reported";
      withinBudget = true;
      const submitted = await service.submit({ capabilityCode: "text.generate", payload: { prompt: "synthetic budget admission" } }, { idempotencyKey: "trace-budget-revoked" });
      withinBudget = false;
      const [claimed] = await f.jobs.claim("af093-budget-revoked", 10, 5000);
      await f.jobs.execute(claimed);
      const trace = await f.prisma.aiExecutionTrace.findUniqueOrThrow({ where: { jobId_attempt: { jobId: submitted.id, attempt: 1 } } });
      assert.equal(trace.status, "failed");
      assert.equal(trace.failureCategory, "budget_denied");
      assert.equal(trace.costAmountNanos, null);
      assert.equal(providerCalls.some(call => call.traceId === trace.id), false);
    });

    await writeRuntimeEvidence("AF-093", f.lease.id, "ai-trace-cost.json", {
      database: f.lease.database,
      projectId: project.id,
      traceCount: await f.prisma.aiExecutionTrace.count(),
      providerCalls: providerCalls.length,
      traceCostOwner: "one AiExecutionTrace row per (RuntimeJob, attempt); no second cost ledger or log-derived estimate",
      rawInputOutputPersisted: false,
      externalProvider: "offline synthetic protocol only; no paid model invocation"
    });
  } finally {
    await f.close();
  }
});
