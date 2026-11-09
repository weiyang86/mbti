import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";
import { repositoryRoot } from "../database/connection.mjs";
import { createRuntimeFixture, writeRuntimeEvidence } from "./runtime-fixture.mjs";

const require = createRequire(join(repositoryRoot, "apps/api/package.json"));
const safeJson = value => JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item);

test("AF-097 composes AI role denial, runtime budget policy, plugin lifecycle, trace/cost and audited HTTP read", { timeout: 300_000 }, async t => {
  const f = await createRuntimeFixture("AF-097", { enabledPlugins: ["aij-ai"], rbacFixture: true });
  try {
    const accountsFile = f.rbacFixture.accounts[0].initialPasswordFile;
    const accounts = JSON.parse(await readFile(accountsFile, "utf8")).accounts;
    const reader = accounts.find(account => account.username === "af097-ai-reader");
    const denied = accounts.find(account => account.username === "af097-no-read");
    assert.ok(reader && denied, "fixture has a server-authorized role and a default-deny role");
    const readerToken = await f.login(reader.username, reader.password);
    const deniedToken = await f.login(denied.username, denied.password);
    const project = await f.prisma.projectProfile.findUniqueOrThrow({ where: { code: "aij-foundation-test" }, select: { id: true } });
    const installPlugin = () => f.prisma.pluginInstallation.upsert({
      where: { projectId_pluginCode: { projectId: project.id, pluginCode: "aij-ai" } },
      create: { projectId: project.id, pluginCode: "aij-ai", version: "0.1.0", owner: "@aij/api", status: "enabled", installedAt: new Date(), enabledAt: new Date() },
      update: { status: "enabled", installedAt: new Date(), enabledAt: new Date(), disabledAt: null, uninstalledAt: null }
    });
    await installPlugin();

    const { AiModelExecutionService, AI_EXECUTION_JOB } = require("../../apps/api/dist/plugins/aij-ai/ai-execution.service.js");
    const { AiExecutionTraceService } = require("../../apps/api/dist/plugins/aij-ai/ai-execution-trace.service.js");
    const { AiProviderRegistry, AiBudgetExceededException } = require("../../apps/api/dist/plugins/aij-ai/ai-provider.js");
    const { PluginRuntimeAccessService } = require("../../apps/api/dist/plugin-runtime/plugin-runtime-access.service.js");
    const { JobService } = require("../../apps/api/dist/async-runtime/job.service.js");
    const { RuntimeRegistry } = require("../../apps/api/dist/async-runtime/registry.js");
    const pluginAccess = f.app.get(PluginRuntimeAccessService);
    const registry = new RuntimeRegistry();
    const jobs = new JobService(f.prisma, registry, pluginAccess);
    let withinBudget = true;
    const providerCalls = [];
    const provider = {
      providerCode: "offline-fixture",
      models: [{ modelCode: "synthetic-model", capabilities: ["text.generate"] }],
      async invoke(request, credential) {
        assert.equal(credential, "synthetic-secret-only-in-memory");
        providerCalls.push({ traceId: request.traceId, correlationId: request.correlationId });
        return {
          output: { text: "synthetic private output must never be returned by the trace query" },
          usage: { promptTokens: 7, completionTokens: 4, costAmountNanos: "98765", costCurrency: "USD" }
        };
      }
    };
    const service = new AiModelExecutionService(
      f.prisma,
      pluginAccess,
      jobs,
      registry,
      { async assertEnabled() {} },
      { async resolveActive() { return { providerCode: "offline-fixture", modelCode: "synthetic-model", credentialRef: "local://aij-foundation/test/AI_PROVIDER_KEY" }; } },
      { async assertWithinBudget() { if (!withinBudget) throw new AiBudgetExceededException(); } },
      { async resolveTrustedForPlugin(code, reference) {
        assert.equal(code, "aij-ai");
        assert.equal(reference, "local://aij-foundation/test/AI_PROVIDER_KEY");
        return "synthetic-secret-only-in-memory";
      } },
      new AiProviderRegistry([provider]),
      new AiExecutionTraceService(f.prisma)
    );
    service.onModuleInit();
    const httpHealth = await f.request("/health");
    assert.equal(httpHealth.body.data.status, "ok", "real Nest HTTP process is backed by the isolated PostgreSQL acceptance database");

    await t.test("anonymous and ordinary roles cannot read traces; authorized runtime reader can", async () => {
      await f.request("/admin/ai/traces", { expected: 401, authorization: null });
      await f.request("/admin/ai/traces", { expected: 403, authorization: deniedToken });
      const empty = await f.request("/admin/ai/traces", { authorization: readerToken });
      assert.equal(empty.body.data.total, 0);
      assert.deepEqual(empty.body.data.items, []);
    });

    const successKey = "af097-success-" + randomUUID();
    const queued = await service.submit({ capabilityCode: "text.generate", payload: { prompt: "synthetic private prompt", key: "synthetic private field" } }, { idempotencyKey: successKey });
    const [successClaim] = await jobs.claim("af097-success-worker", 1, 5000);
    assert.equal(successClaim.id, queued.id);
    await jobs.execute(successClaim);
    const completedJob = await f.prisma.runtimeJob.findUniqueOrThrow({ where: { id: queued.id } });
    const completedTrace = await f.prisma.aiExecutionTrace.findUniqueOrThrow({ where: { jobId_attempt: { jobId: queued.id, attempt: 1 } } });

    await t.test("enabled synthetic Provider execution is persisted by existing RuntimeJob and Trace/Cost owners", async () => {
      assert.equal(queued.status, "pending");
      assert.equal(completedJob.status, "completed");
      assert.equal(completedTrace.status, "succeeded");
      assert.equal(completedTrace.costSource, "provider_reported");
      assert.equal(completedTrace.costAmountNanos, 98765n);
      assert.equal(completedTrace.costCurrency, "USD");
      assert.equal(providerCalls.length, 1);
      assert.deepEqual(completedJob.resultReference, { executionId: queued.id, traceId: completedTrace.id, outputStored: false });
      const listed = await f.request("/admin/ai/traces", { authorization: readerToken });
      assert.equal(listed.body.data.total, 1);
      assert.equal(listed.body.data.items[0].id, completedTrace.id);
      assert.equal(listed.body.data.items[0].costAmountNanos, "98765");
      assert.equal(Object.hasOwn(listed.body.data.items[0], "correlationId"), false);
      for (const privateValue of ["synthetic private prompt", "synthetic private field", "synthetic private output", "synthetic-secret-only-in-memory"]) {
        assert.equal(listed.text.includes(privateValue), false, "trace HTTP projection excludes private synthetic values");
      }
      assert.ok(await f.prisma.auditLog.count({ where: { module: "aij-ai", action: "trace_listed" } }) >= 1, "authorized trace read was audited in PostgreSQL");
    });

    const callsBeforeBudget = providerCalls.length;
    const budgetKey = "af097-budget-" + randomUUID();
    const budgetQueued = await service.submit({ capabilityCode: "text.generate", payload: { prompt: "synthetic budget case" } }, { idempotencyKey: budgetKey });
    withinBudget = false;
    const [budgetClaim] = await jobs.claim("af097-budget-worker", 1, 5000);
    assert.equal(budgetClaim.id, budgetQueued.id);
    await jobs.execute(budgetClaim);
    const budgetJob = await f.prisma.runtimeJob.findUniqueOrThrow({ where: { id: budgetQueued.id } });
    const budgetTrace = await f.prisma.aiExecutionTrace.findUniqueOrThrow({ where: { jobId_attempt: { jobId: budgetQueued.id, attempt: 1 } } });
    withinBudget = true;

    await t.test("budget denial after enqueue records a failed attempt without Provider invocation or fabricated Cost", async () => {
      assert.equal(budgetJob.status, "retry");
      assert.equal(budgetJob.lastError, "RUNTIME_OPERATION_FAILED");
      assert.equal(budgetTrace.status, "failed");
      assert.equal(budgetTrace.failureCategory, "budget_denied");
      assert.equal(budgetTrace.costSource, "unreported");
      assert.equal(budgetTrace.costAmountNanos, null);
      assert.equal(providerCalls.length, callsBeforeBudget, "Provider is not called after budget admission denies the attempt");
      const deniedListing = await f.request("/admin/ai/traces?status=failed", { authorization: readerToken });
      assert.ok(deniedListing.body.data.items.some(item => item.id === budgetTrace.id && item.failureCategory === "budget_denied"));
    });

    const jobsBeforeDisable = await f.prisma.runtimeJob.count({ where: { jobType: AI_EXECUTION_JOB } });
    await f.prisma.pluginInstallation.update({
      where: { projectId_pluginCode: { projectId: project.id, pluginCode: "aij-ai" } },
      data: { status: "installed", disabledAt: new Date() }
    });
    await t.test("disabled plugin denies new queued executions and hides the trace query route", async () => {
      await assert.rejects(
        service.submit({ capabilityCode: "text.generate", payload: { prompt: "must not enqueue" } }, { idempotencyKey: "af097-disabled-" + randomUUID() }),
        error => error.getStatus?.() === 404
      );
      await f.request("/admin/ai/traces", { expected: 404, authorization: readerToken });
      assert.equal(await f.prisma.runtimeJob.count({ where: { jobType: AI_EXECUTION_JOB } }), jobsBeforeDisable);
      assert.equal(providerCalls.length, callsBeforeBudget, "disabled plugin causes no Provider invocation");
    });

    const audits = await f.prisma.auditLog.findMany({ where: { module: "aij-ai", action: "trace_listed" } });
    const persisted = safeJson({ traces: await f.prisma.aiExecutionTrace.findMany({ where: { jobId: { in: [queued.id, budgetQueued.id] } } }), audits });
    for (const privateValue of ["synthetic private prompt", "synthetic private field", "synthetic private output", "synthetic-secret-only-in-memory"]) {
      assert.equal(persisted.includes(privateValue), false, "persisted trace and audit projections exclude private synthetic values");
    }
    assert.equal(audits.some(row => row.requestSummary?.fields?.includes("status")), true, "query audit records filter names only");

    await writeRuntimeEvidence("AF-097", f.lease.id, "ai-composition.json", {
      database: f.lease.database,
      projectId: project.id,
      jobIds: [queued.id, budgetQueued.id],
      traceIds: [completedTrace.id, budgetTrace.id],
      statuses: { successfulJob: completedJob.status, successfulTrace: completedTrace.status, deniedJob: budgetJob.status, deniedTrace: budgetTrace.status },
      costs: { providerReportedNanos: String(completedTrace.costAmountNanos), deniedSource: budgetTrace.costSource },
      providerCalls: providerCalls.length,
      pluginDisabledBlocksNewWork: true,
      roleOutcomes: { anonymous: 401, deniedRole: 403, runtimeReader: 200 },
      persistedPayloadAndCredentialValues: false,
      providerFixture: "offline synthetic adapter only; no external endpoint or paid model"
    });
  } finally {
    await f.close();
  }
});
