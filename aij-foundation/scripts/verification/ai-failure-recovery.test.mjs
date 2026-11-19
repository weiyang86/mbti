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

test("AF-098 closes AI failure paths, recovers durable work and applies current RBAC grants", { timeout: 300_000 }, async t => {
  const f = await createRuntimeFixture("AF-098", { enabledPlugins: ["aij-ai"], rbacFixture: true });
  try {
    const accountDoc = JSON.parse(await readFile(f.rbacFixture.accounts[0].initialPasswordFile, "utf8"));
    const reader = accountDoc.accounts.find(account => account.username === "af098-ai-reader");
    const denied = accountDoc.accounts.find(account => account.username === "af098-no-read");
    assert.ok(reader && denied, "isolated test DB contains a reader and a default-deny role");
    const readerToken = await f.login(reader.username, reader.password);
    const deniedToken = await f.login(denied.username, denied.password);
    const project = await f.prisma.projectProfile.findUniqueOrThrow({ where: { code: "aij-foundation-test" }, select: { id: true } });
    await f.prisma.pluginInstallation.upsert({
      where: { projectId_pluginCode: { projectId: project.id, pluginCode: "aij-ai" } },
      create: { projectId: project.id, pluginCode: "aij-ai", version: "0.1.0", owner: "@aij/api", status: "enabled", installedAt: new Date(), enabledAt: new Date() },
      update: { status: "enabled", installedAt: new Date(), enabledAt: new Date(), disabledAt: null, uninstalledAt: null }
    });

    const { AiModelExecutionService } = require("../../apps/api/dist/plugins/aij-ai/ai-execution.service.js");
    const { AiExecutionTraceService } = require("../../apps/api/dist/plugins/aij-ai/ai-execution-trace.service.js");
    const { AiProviderRegistry, AiBudgetExceededException } = require("../../apps/api/dist/plugins/aij-ai/ai-provider.js");
    const { PluginRuntimeAccessService } = require("../../apps/api/dist/plugin-runtime/plugin-runtime-access.service.js");
    const { JobService } = require("../../apps/api/dist/async-runtime/job.service.js");
    const { RuntimeRegistry } = require("../../apps/api/dist/async-runtime/registry.js");
    const pluginAccess = f.app.get(PluginRuntimeAccessService);
    const providerCalls = [];

    const serviceFor = ({ providerCode, providers = [], denyBudget = false }) => {
      const registry = new RuntimeRegistry();
      const jobs = new JobService(f.prisma, registry, pluginAccess);
      const service = new AiModelExecutionService(
        f.prisma,
        pluginAccess,
        jobs,
        registry,
        { async assertEnabled() {} },
        { async resolveActive() { return { providerCode, modelCode: "synthetic-model", credentialRef: "local://aij-foundation/test/AI_PROVIDER_KEY" }; } },
        { async assertWithinBudget() { if (denyBudget) throw new AiBudgetExceededException(); } },
        { async resolveTrustedForPlugin() { return "synthetic-secret-in-memory"; } },
        new AiProviderRegistry(providers),
        new AiExecutionTraceService(f.prisma)
      );
      service.onModuleInit();
      return { service, jobs };
    };

    await t.test("missing Provider fails closed before queue persistence", async () => {
      const missing = serviceFor({ providerCode: "offline-missing" });
      const idempotencyKey = "af098-provider-missing-" + randomUUID();
      await assert.rejects(
        missing.service.submit({ capabilityCode: "text.generate", payload: { prompt: "synthetic missing provider" } }, { idempotencyKey }),
        error => error.getStatus?.() === 503
      );
      assert.equal(await f.prisma.runtimeJob.count({ where: { idempotencyKey } }), 0);
      assert.equal(providerCalls.length, 0);
    });

    await t.test("pre-enqueue budget denial creates neither a RuntimeJob nor a Trace", async () => {
      const budgetProvider = {
        providerCode: "offline-fixture",
        models: [{ modelCode: "synthetic-model", capabilities: ["text.generate"] }],
        async invoke() { providerCalls.push({ unexpected: true }); throw new Error("budget-denied Provider must not run"); }
      };
      const deniedBudget = serviceFor({ providerCode: "offline-fixture", providers: [budgetProvider], denyBudget: true });
      const idempotencyKey = "af098-budget-denied-" + randomUUID();
      await assert.rejects(
        deniedBudget.service.submit({ capabilityCode: "text.generate", payload: { prompt: "synthetic over-budget" } }, { idempotencyKey }),
        error => error.getStatus?.() === 429
      );
      assert.equal(await f.prisma.runtimeJob.count({ where: { idempotencyKey } }), 0);
      assert.equal(await f.prisma.aiExecutionTrace.count(), 0);
      assert.equal(providerCalls.length, 0);
    });

    let failOnce = true;
    const provider = {
      providerCode: "offline-fixture",
      models: [{ modelCode: "synthetic-model", capabilities: ["text.generate"] }],
      async invoke(request, credential) {
        providerCalls.push({ traceId: request.traceId, correlationId: request.correlationId });
        assert.equal(credential, "synthetic-secret-in-memory");
        if (failOnce) {
          failOnce = false;
          throw new Error("synthetic provider failure prompt=private-customer-input credential=synthetic-secret-in-memory");
        }
        return { output: { text: "synthetic private output" }, usage: { promptTokens: 8, completionTokens: 3, costAmountNanos: "32100", costCurrency: "USD" } };
      }
    };
    const { service, jobs } = serviceFor({ providerCode: "offline-fixture", providers: [provider] });
    const idempotencyKey = "af098-recover-" + randomUUID();
    const submitted = await service.submit({ capabilityCode: "text.generate", payload: { prompt: "synthetic private prompt", credential: "synthetic-private-field" } }, { idempotencyKey });
    const [firstClaim] = await jobs.claim("af098-worker-1", 1, 5000);
    assert.equal(firstClaim.id, submitted.id);
    await jobs.execute(firstClaim);
    const failedJob = await f.prisma.runtimeJob.findUniqueOrThrow({ where: { id: submitted.id } });
    const failedTrace = await f.prisma.aiExecutionTrace.findUniqueOrThrow({ where: { jobId_attempt: { jobId: submitted.id, attempt: 1 } } });

    await t.test("worker Provider failure is retryable and persists only a safe error code", async () => {
      assert.equal(failedJob.status, "retry");
      assert.equal(failedJob.lastError, "RUNTIME_OPERATION_FAILED");
      assert.equal(failedTrace.status, "failed");
      assert.equal(failedTrace.failureCategory, "provider_error");
      assert.equal(failedTrace.costSource, "unreported");
      assert.equal(failedTrace.costAmountNanos, null);
      assert.equal(safeJson({ failedJob, failedTrace }).includes("synthetic provider failure"), false);
      assert.equal(safeJson({ failedJob, failedTrace }).includes("synthetic-secret-in-memory"), false);
      const idempotency = await f.prisma.runtimeIdempotency.findFirstOrThrow({ where: { requestScope: "job", idempotencyKey } });
      assert.equal(idempotency.status, "processing", "failed execution remains resumable through its durable idempotency record");
    });

    await f.prisma.runtimeJob.update({ where: { id: submitted.id }, data: { runAt: new Date(Date.now() - 1000) } });
    const [secondClaim] = await jobs.claim("af098-worker-2", 1, 5000);
    assert.equal(secondClaim.id, submitted.id);
    await jobs.execute(secondClaim);
    const recoveredJob = await f.prisma.runtimeJob.findUniqueOrThrow({ where: { id: submitted.id } });
    const recoveredTrace = await f.prisma.aiExecutionTrace.findUniqueOrThrow({ where: { jobId_attempt: { jobId: submitted.id, attempt: 2 } } });

    await t.test("the same durable job recovers on retry and records only provider-reported Cost", async () => {
      assert.equal(recoveredJob.status, "completed");
      assert.equal(recoveredJob.attempts, 2);
      assert.equal(await f.prisma.runtimeJob.count({ where: { idempotencyKey } }), 1);
      assert.deepEqual((await f.prisma.aiExecutionTrace.findMany({ where: { jobId: submitted.id }, orderBy: { attempt: "asc" } })).map(row => [row.attempt, row.status]), [[1, "failed"], [2, "succeeded"]]);
      assert.equal(recoveredTrace.failureCategory, null);
      assert.equal(recoveredTrace.costSource, "provider_reported");
      assert.equal(recoveredTrace.costAmountNanos, 32100n);
      assert.equal(providerCalls.length, 2);
      const idempotency = await f.prisma.runtimeIdempotency.findFirstOrThrow({ where: { requestScope: "job", idempotencyKey } });
      assert.equal(idempotency.status, "completed");
    });

    await t.test("conflicting idempotent replay is rejected without replacing the completed job", async () => {
      await assert.rejects(
        service.submit({ capabilityCode: "text.generate", payload: { prompt: "different synthetic payload" } }, { idempotencyKey }),
        error => error.getStatus?.() === 409
      );
      const unchanged = await f.prisma.runtimeJob.findUniqueOrThrow({ where: { id: submitted.id } });
      assert.equal(unchanged.status, "completed");
      assert.deepEqual(unchanged.payload, { capabilityCode: "text.generate", payload: { prompt: "synthetic private prompt", credential: "[REDACTED]" } });
      assert.equal(await f.prisma.runtimeJob.count({ where: { idempotencyKey } }), 1);
    });

    await t.test("trace query follows the current database grant, not the still-valid JWT snapshot", async () => {
      const health = await f.request("/health");
      assert.equal(health.body.data.status, "ok");
      await f.request("/admin/ai/traces", { expected: 401, authorization: null });
      await f.request("/admin/ai/traces", { expected: 403, authorization: deniedToken });
      const beforeRevoke = await f.request("/admin/ai/traces", { authorization: readerToken });
      assert.ok(beforeRevoke.body.data.items.some(item => item.status === "failed" && item.failureCategory === "provider_error"));
      assert.ok(beforeRevoke.body.data.items.some(item => item.status === "succeeded" && item.costAmountNanos === "32100"));
      for (const privateValue of ["synthetic private prompt", "synthetic private output", "synthetic-secret-in-memory", "private-customer-input"]) {
        assert.equal(beforeRevoke.text.includes(privateValue), false, "Trace HTTP projection excludes raw job and Provider values");
      }

      const user = await f.prisma.sysUser.findUniqueOrThrow({ where: { username: reader.username }, select: { id: true, userRoles: { select: { roleId: true } } } });
      const permission = await f.prisma.sysPermission.findUniqueOrThrow({ where: { permissionCode: "admin.runtime.read" }, select: { id: true } });
      const roleId = user.userRoles[0].roleId;
      const removed = await f.prisma.sysRolePermission.deleteMany({ where: { roleId, permissionId: permission.id } });
      assert.equal(removed.count, 1, "revocation removes only this synthetic reader's grant");
      try {
        await f.request("/admin/ai/traces", { expected: 403, authorization: readerToken });
        assert.ok(await f.prisma.auditLog.findFirst({ where: { module: "rbac", action: "permission_denied", userId: user.id } }), "revocation denial is audited");
      } finally {
        await f.prisma.sysRolePermission.create({ data: { id: randomUUID(), roleId, permissionId: permission.id } });
      }
      const restored = await f.request("/admin/ai/traces", { authorization: readerToken });
      assert.equal(restored.body.data.total, 2, "restoring the grant re-enables the same valid session");
      assert.equal(providerCalls.length, 2, "queries and rejected replays do not invoke a Provider");
    });

    const audits = await f.prisma.auditLog.findMany({ where: { module: "rbac", action: "permission_denied" } });
    assert.equal(audits.length >= 2, true, "default-deny and revoked-grant decisions are persisted");
    assert.equal(safeJson(audits).includes("synthetic-secret-in-memory"), false);
    await writeRuntimeEvidence("AF-098", f.lease.id, "ai-failure-recovery.json", {
      database: f.lease.database,
      projectId: project.id,
      jobId: submitted.id,
      attempts: [{ attempt: 1, status: failedTrace.status, failureCategory: failedTrace.failureCategory, safeLastError: failedJob.lastError }, { attempt: 2, status: recoveredTrace.status, costSource: recoveredTrace.costSource, costAmountNanos: String(recoveredTrace.costAmountNanos) }],
      providerCalls: providerCalls.length,
      noEnqueueForMissingProvider: true,
      noEnqueueForBudgetDenial: true,
      conflictingIdempotencyPreservedOriginal: true,
      currentPermissionRevocationAndRestore: true,
      providerFixture: "offline synthetic adapter only; no external service or paid model"
    });
  } finally {
    await f.close();
  }
});
