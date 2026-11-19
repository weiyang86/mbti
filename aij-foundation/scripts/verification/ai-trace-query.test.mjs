import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createRuntimeFixture, writeRuntimeEvidence } from "./runtime-fixture.mjs";

const stringifySafe = value => JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item);

test("AF-096 AI Trace/Cost listing is project-scoped, permission-checked, paginated, redacted and audited", { timeout: 240_000 }, async t => {
  const f = await createRuntimeFixture("AF-096", { enabledPlugins: ["aij-ai"], rbacFixture: true });
  try {
    const accountsFile = f.rbacFixture.accounts[0].initialPasswordFile;
    const accounts = JSON.parse(await readFile(accountsFile, "utf8")).accounts;
    const traceReader = accounts.find(account => account.username === "af096-trace-reader");
    const noAccess = accounts.find(account => account.username === "af096-no-read");
    assert.ok(traceReader && noAccess, "the isolated DB has a read-only AI permission fixture and a default-deny fixture");
    const readerToken = await f.login(traceReader.username, traceReader.password);
    const noAccessToken = await f.login(noAccess.username, noAccess.password);
    const readerUser = await f.prisma.sysUser.findUniqueOrThrow({ where: { username: traceReader.username }, select: { id: true } });
    const project = await f.prisma.projectProfile.findUniqueOrThrow({ where: { code: "aij-foundation-test" }, select: { id: true, organizationId: true } });
    const otherProject = await f.prisma.projectProfile.create({ data: {
      organizationId: project.organizationId,
      code: "af096-foreign-" + randomUUID().replaceAll("-", "").slice(0, 12),
      name: "AF-096 synthetic foreign project", environment: "test"
    } });
    const install = projectId => f.prisma.pluginInstallation.upsert({
      where: { projectId_pluginCode: { projectId, pluginCode: "aij-ai" } },
      create: { projectId, pluginCode: "aij-ai", version: "0.1.0", owner: "@aij/api", status: "enabled", installedAt: new Date(), enabledAt: new Date() },
      update: { status: "enabled", installedAt: new Date(), enabledAt: new Date(), disabledAt: null, uninstalledAt: null }
    });
    await install(project.id);
    await install(otherProject.id);

    const insertTrace = async ({ projectId, correlationId, minute, providerCode = "synthetic-provider", status = "succeeded" }) => {
      const startedAt = new Date(Date.now() - minute * 60_000);
      const job = await f.prisma.runtimeJob.create({ data: {
        jobType: "aij-ai.execute", jobVersion: 1,
        payload: { prompt: "SYNTHETIC_PROMPT_MUST_NEVER_RETURN", apiKey: "SYNTHETIC_SECRET_MUST_NEVER_RETURN" },
        scope: "plugin", scopeId: projectId, pluginCode: "aij-ai", idempotencyKey: "af096-" + randomUUID(),
        status: "completed", completedAt: startedAt
      } });
      return f.prisma.aiExecutionTrace.create({ data: {
        jobId: job.id, attempt: 1, projectId, correlationId, capabilityCode: "text.generate",
        providerCode, modelCode: "synthetic-model", status,
        inputShape: { redacted: true, kind: "object", fieldCount: "1-4", injected: "SYNTHETIC_PROMPT_MUST_NEVER_RETURN" },
        outputShape: { redacted: true, kind: "string", length: "5-16", injected: "SYNTHETIC_OUTPUT_MUST_NEVER_RETURN" },
        promptTokens: 8, completionTokens: 3, cachedTokens: 1,
        costAmountNanos: BigInt(minute * 100), costCurrency: "USD", costSource: "provider_reported",
        startedAt, completedAt: startedAt
      } });
    };
    const oldest = await insertTrace({ projectId: project.id, correlationId: "af096-current-oldest", minute: 5 });
    const newest = await insertTrace({ projectId: project.id, correlationId: "af096-current-newest", minute: 1, providerCode: "synthetic-provider-b" });
    const foreign = await insertTrace({ projectId: otherProject.id, correlationId: "af096-foreign-correl", minute: 0 });

    await t.test("anonymous and ordinary administrators are denied; DTO rejects forged scope and invalid filters", async () => {
      await f.request("/admin/ai/traces", { expected: 401, authorization: null });
      await f.request("/admin/ai/traces", { expected: 403, authorization: noAccessToken });
      await f.request("/admin/ai/traces?projectId=" + encodeURIComponent(otherProject.id), { expected: 400, authorization: readerToken });
      await f.request("/admin/ai/traces?status=all", { expected: 400, authorization: readerToken });
      await f.request("/admin/ai/traces?page=0&pageSize=101", { expected: 400, authorization: readerToken });
      await f.request("/admin/ai/traces?startAt=2026-11-02T00%3A00%3A00Z&endAt=2026-11-01T00%3A00%3A00Z", { expected: 400, authorization: readerToken });
    });

    let firstPage;
    await t.test("authorized reader receives a bounded page and only the server-selected project", async () => {
      const result = await f.request("/admin/ai/traces?page=1&pageSize=1", { authorization: readerToken });
      firstPage = result.body.data;
      assert.equal(firstPage.total, 2);
      assert.equal(firstPage.page, 1);
      assert.equal(firstPage.pageSize, 1);
      assert.equal(firstPage.items.length, 1);
      assert.equal(firstPage.items[0].id, newest.id, "order is stable by start time descending");
      assert.equal(firstPage.items[0].costAmountNanos, "100");
      assert.equal("projectId" in firstPage.items[0], false);
      assert.equal("jobId" in firstPage.items[0], false);
      assert.equal("correlationId" in firstPage.items[0], false);
      assert.equal(firstPage.items.some(item => item.id === foreign.id), false);
    });

    await t.test("filter and pagination return the matching synthetic cost record", async () => {
      const filtered = await f.request("/admin/ai/traces?page=1&pageSize=5&providerCode=synthetic-provider&status=succeeded&correlationId=af096-current-oldest&costSource=provider_reported", { authorization: readerToken });
      assert.equal(filtered.body.data.total, 1);
      assert.equal(filtered.body.data.items.length, 1);
      assert.equal(filtered.body.data.items[0].id, oldest.id);
      assert.equal(filtered.body.data.items[0].costCurrency, "USD");
      assert.deepEqual(filtered.body.data.items[0].inputShape, { redacted: true, kind: "object", fieldCount: "1-4" });
      assert.deepEqual(filtered.body.data.items[0].outputShape, { redacted: true, kind: "string", length: "5-16" });
    });

    await t.test("response and query audit never persist/return payload values or raw filters", async () => {
      const response = await f.request("/admin/ai/traces?correlationId=af096-current-newest", { authorization: readerToken });
      assert.equal(response.body.data.total, 1);
      const responseJson = stringifySafe(response.body);
      assert.equal(responseJson.includes("SYNTHETIC_PROMPT_MUST_NEVER_RETURN"), false);
      assert.equal(responseJson.includes("SYNTHETIC_OUTPUT_MUST_NEVER_RETURN"), false);
      assert.equal(responseJson.includes("SYNTHETIC_SECRET_MUST_NEVER_RETURN"), false);
      assert.equal(responseJson.includes("af096-current-newest"), false);
      const audits = await f.prisma.auditLog.findMany({ where: { module: "aij-ai", action: "trace_listed", userId: readerUser.id }, orderBy: { createdAt: "desc" } });
      assert.ok(audits.length >= 3, "each successful filtered list query creates a database audit row");
      assert.ok(audits.some(audit => Array.isArray(audit.requestSummary?.fields) && audit.requestSummary.fields.includes("correlationId")));
      for (const audit of audits) {
        const auditJson = stringifySafe(audit);
        assert.equal(audit.resourceType, "ai_execution_trace");
        assert.equal(audit.path, "/api/admin/ai/traces");
        assert.equal(auditJson.includes("af096-current-newest"), false);
        assert.equal(auditJson.includes("SYNTHETIC_PROMPT_MUST_NEVER_RETURN"), false);
        assert.ok(Array.isArray(audit.requestSummary.fields));
        assert.ok(audit.requestSummary.fields.every(field => ["correlationId", "costSource", "endAt", "modelCode", "providerCode", "startAt", "status"].includes(field)));
      }
      const auditView = await f.request("/admin/logs?module=aij-ai&action=trace_listed", { authorization: f.token });
      assert.ok(auditView.body.data.items.some(item => item.module === "aij-ai" && item.action === "trace_listed" && item.redacted));
      assert.equal(stringifySafe(auditView.body).includes("af096-current-newest"), false);
    });

    await t.test("disabled aij-ai installation fails closed", async () => {
      await f.prisma.pluginInstallation.update({ where: { projectId_pluginCode: { projectId: project.id, pluginCode: "aij-ai" } }, data: { status: "installed", disabledAt: new Date() } });
      await f.request("/admin/ai/traces", { expected: 404, authorization: readerToken });
      await install(project.id);
    });

    await writeRuntimeEvidence("AF-096", f.lease.id, "ai-trace-query.json", {
      database: f.lease.database, projectScope: project.id, foreignProjectExcluded: true,
      syntheticTraceIds: [oldest.id, newest.id, foreign.id],
      queryAudit: { action: "trace_listed", records: await f.prisma.auditLog.count({ where: { module: "aij-ai", action: "trace_listed" } }), filtersStoredAsValues: false },
      providerCalls: 0, payloadPersistedInTraceProjection: false, pluginDisabledFailsClosed: true
    });
  } finally {
    await f.close();
  }
});
