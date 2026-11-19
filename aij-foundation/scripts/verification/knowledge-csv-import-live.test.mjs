import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";

// ROOT ONLY: opt in on the main dev worktree after AF-146 target registration and API build.
// Worker runs node --check / lint only; this file contains no claimed live results.
test("AF-146 real multipart CSV import and rejection on a fresh isolated lease", { timeout: 240000 }, async t => {
  assert.equal(process.env.AIJ_AF146_ROOT_LIVE, "1", "Root must opt in explicitly");
  const git = args => execFileSync("git", args, { encoding: "utf8" }).trim();
  assert.equal(git(["branch", "--show-current"]), "dev", "Root dev branch required");
  assert.equal(realpathSync(resolve(git(["rev-parse", "--git-dir"]))), realpathSync(resolve(git(["rev-parse", "--git-common-dir"]))), "Linked worker worktree forbidden");
  const { acceptanceRecord, assertLocalPath, readDatabaseEnvironment, repositoryRoot, withDatabase } = await import("../database/connection.mjs");
  assert.equal(realpathSync(process.cwd()), realpathSync(repositoryRoot));
  const { createRemainingClientFixture } = await import("./remaining-client-fixture.mjs");
  const { seedDatabase } = await import("../database/seed.mjs");
  const parent = join(repositoryRoot, ".artifacts/auto-ai-program-20261105/AF-146");
  assertLocalPath(parent); execFileSync("git", ["check-ignore", "--quiet", parent]);
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  const directory = mkdtempSync(join(parent, "live-"));
  const report = { task: "AF-146", status: "STARTING", sourceHead: git(["rev-parse", "HEAD"]), checks: [], http: [], providerCalls: 0, cleanup: [] };
  const save = () => writeFileSync(join(directory, "result.json"), JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
  const previousEnvironment = { ...process.env };
  let f, restoreProvider, verifyClosed;
  async function check(name, body) {
    await t.test(name, async () => {
      try { await body(); report.checks.push({ name, status: "PASS" }); }
      catch { report.checks.push({ name, status: "FAIL" }); throw new Error("AF146_CHECK_FAILED: " + name); }
      finally { save(); }
    });
  }
  try {
    f = await createRemainingClientFixture("AF-146", { aiCenter: true });
    const record = acceptanceRecord("test", f.lease.id);
    assert.equal(record.task, "AF-146"); assert.equal(record.repository, repositoryRoot);
    assert.equal(record.database, f.lease.database); assert.equal(record.instanceId, f.lease.instanceId);
    assert.match(record.database, /^aij_foundation_af146_test_[a-f0-9]{16}$/);
    report.acceptanceId = record.id; report.database = record.database;
    const { prisma, project } = f;
    assert.equal(project.code, "aij-foundation-test"); assert.equal(process.env.ASYNC_RUNTIME_ENABLED, "false");
    assert.equal(process.env.AIJ_TEST_AI_PROVIDER_MODE, "offline-knowledge");
    const environment = readDatabaseEnvironment("test", process.env, record.id);
    verifyClosed = async () => {
      const { rows: [row] } = await withDatabase("test", environment, c => c.query("SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND application_name LIKE 'aij-api:%'"), { acceptanceId: record.id });
      assert.equal(row.count, 0);
    };
    const knowledge = f.app.get(f.requireApi("plugins/aij-ai/ai-knowledge.service.js").AiKnowledgeService);
    assert.match(knowledge.importDocument.toString(), /parseKnowledgeCsv/, "Build the current API before acceptance");
    assert.match(knowledge.assertWriteAccessInTransaction.toString(), /assertWritePermissionInTransaction/);
    const provider = f.app.get(f.requireApi("plugins/aij-ai/ai-provider.js").AiProviderRegistry).get("offline-knowledge");
    const invoke = provider.invoke;
    provider.invoke = async () => { report.providerCalls++; throw new Error("AF146_UNEXPECTED_PROVIDER_INVOCATION"); };
    restoreProvider = () => { provider.invoke = invoke; };

    // The shared fixture upserts an enabled row for older cards. Remove only its
    // operation-free row on this newly created AF146 lease, then use real lifecycle.
    await check("real install and enable lifecycle precedes every knowledge request", async () => {
      await seedDatabase({ mode: "test", acceptanceId: record.id, generateCredentials: true, pluginManagement: true });
      const key = { projectId_pluginCode: { projectId: project.id, pluginCode: "aij-ai" } };
      const synthetic = await prisma.pluginInstallation.findUniqueOrThrow({ where: key });
      assert.equal(await prisma.pluginOperation.count({ where: { installationId: synthetic.id } }), 0);
      await prisma.pluginInstallation.delete({ where: { id: synthetic.id } });
      const lifecycle = f.app.get(f.requireApi("plugin-runtime/plugin-lifecycle.service.js").PluginLifecycleService);
      const catalog = f.app.get(f.requireApi("plugin-runtime/plugin-catalog.js").PluginCatalog);
      const admin = await prisma.sysUser.findUniqueOrThrow({ where: { username: "aij-admin" } });
      const installed = await lifecycle.install("aij-ai", catalog.manifest("aij-ai").version, admin.id, "af146-install");
      assert.equal(installed.status, "installed");
      assert.equal((await lifecycle.enable("aij-ai", admin.id, "af146-enable")).status, "enabled");
      const operations = await prisma.pluginOperation.findMany({ where: { installationId: installed.id }, orderBy: { createdAt: "asc" } });
      assert.deepEqual(operations.map(row => row.action).sort(), ["enable", "install"]);
      assert.ok(operations.every(row => row.status === "succeeded"));
      assert.equal(await prisma.auditLog.count({ where: { module: "plugin-runtime", resourceId: installed.id, action: { in: ["install", "enable"] } } }), 2);
    });
    assert.equal(report.checks.at(-1)?.status, "PASS", "Lifecycle setup is mandatory");
    const workspace = f.workspaces[0].id, otherWorkspace = f.workspaces[1].id;
    const snapshot = async () => ({
      documents: await prisma.aiKnowledgeDocument.findMany({ orderBy: { id: "asc" } }),
      audits: await prisma.auditLog.findMany({ orderBy: { id: "asc" } }),
      fileAssets: await prisma.fileAsset.count(), jobs: await prisma.runtimeJob.count(), traces: await prisma.aiExecutionTrace.count(),
      providerCalls: report.providerCalls
    });
    let sequence = 0;
    const form = ({ content = "name,note\nAurora,synthetic", name = "guide.csv", mime = "text/csv", extra = false } = {}) => {
      const value = new FormData();
      value.append("documentCode", "af146-" + (++sequence)); value.append("title", "AF146 synthetic import");
      value.append("file", new Blob([content], { type: mime }), name);
      if (extra) value.append("workspaceId", otherWorkspace);
      return value;
    };
    async function http(method, path, { body, status = 201, cookie = f.cookies[0], workspaceId = workspace, origin = process.env.WEB_URL } = {}) {
      const response = await fetch(f.baseUrl + "/client/ai/knowledge/" + path, {
        method, headers: { connection: "close", ...(cookie ? { cookie } : {}), ...(origin ? { origin } : {}), "x-aij-workspace-id": workspaceId, "x-correlation-id": "af146-live-" + sequence },
        ...(body ? { body } : {}), signal: AbortSignal.timeout(15000)
      });
      report.http.push({ method, route: path, status: response.status });
      assert.equal(response.status, status, "Unexpected HTTP status; response bodies are excluded from evidence");
      const json = await response.json(); return json.data;
    }
    let imported;
    const quoted = '\uFEFF name ,note,formula\r\nAurora,"comma, quote ""ok""\r\nnext",=SUM(A1:A2)\r\n';
    const expected = 'Row 1\nname: Aurora\nnote: comma, quote "ok"\n  next\nformula: =SUM(A1:A2)';
    await check("quoted BOM CSV multipart yields one document, original checksum and a redacted import audit", async () => {
      const before = await snapshot(); imported = await http("POST", "documents/import", { body: form({ content: quoted }) });
      const row = await prisma.aiKnowledgeDocument.findUniqueOrThrow({ where: { id: imported.id } });
      assert.equal(row.workspaceId, workspace); assert.equal(row.content, expected); assert.equal(row.sourceFilename, "guide.csv");
      assert.equal(row.sourceChecksum, createHash("sha256").update(Buffer.from(quoted)).digest("hex"));
      const audit = await prisma.auditLog.findMany({ where: { resourceId: row.id, action: "ai_knowledge_document_imported" } });
      assert.equal(audit.length, 1); assert.equal(JSON.stringify(audit).includes("Aurora"), false);
      const after = await snapshot(); assert.equal(after.documents.length, before.documents.length + 1);
      assert.equal(after.audits.length, before.audits.length + 1); assert.equal(after.fileAssets, before.fileAssets);
      assert.equal(after.jobs, before.jobs); assert.equal(after.traces, before.traces); assert.equal(report.providerCalls, 0);
    });
    assert.ok(imported, "CSV success setup is mandatory");
    for (const [name, mime] of [["guide.txt", "text/plain"], ["guide.md", "text/markdown"]]) {
      await check("existing " + name + " multipart import retains text", async () => {
        const content = "Synthetic UTF-8 文本\r\n=1+1";
        const document = await http("POST", "documents/import", { body: form({ name, mime, content }) });
        const row = await prisma.aiKnowledgeDocument.findUniqueOrThrow({ where: { id: document.id } });
        assert.equal(row.content, content); assert.equal(row.sourceChecksum, createHash("sha256").update(content).digest("hex"));
      });
    }
    for (const mime of ["application/octet-stream", ""]) await check("CSV safe MIME " + (mime || "empty"), async () => {
      await http("POST", "documents/import", { body: form({ mime }) });
    });
    const denials = [
      ["unclosed quote", { content: 'a\n"x' }], ["quote suffix", { content: 'a\n"x"junk' }],
      ["invalid UTF-8", { content: Buffer.from([0xc3, 0x28]) }], ["NUL/binary", { content: "a\nx\0" }],
      ["oversize", { content: "a\n" + "x".repeat(51200) }, 413],
      ["shape mismatch", { content: "a,b\nx" }], ["duplicate headers", { content: " a ,a\nx,y" }],
      ["no data", { content: "a,b\n" }], ["empty bytes", { content: "" }],
      ["201 rows", { content: "a\n" + Array(201).fill("x").join("\n") }],
      ["33 columns", { content: Array.from({ length: 33 }, (_, i) => "h" + i).join(",") + "\n" + Array(33).fill("x").join(",") }],
      ["2001 cell characters", { content: "a\n" + "x".repeat(2001) }], ["101 header characters", { content: "h".repeat(101) + "\nx" }],
      ["generated UTF-8 document byte fence", { content: "中".repeat(100) + "\n" + Array(199).fill("文".repeat(40)).join("\n") }],
      ["generated content bound", { content: "h".repeat(100) + "\n" + Array(25).fill("x".repeat(1900)).join("\n") }],
      ["CSV MIME mismatch", { mime: "text/plain" }], ["unsupported XLSX", { name: "guide.xlsx", mime: "application/octet-stream" }],
      ["extra workspace field", { extra: true }]
    ];
    for (const [name, input, status = 400] of denials) await check(name + " rejects without document/audit/asset/job/trace writes", async () => {
      const before = await snapshot(); await http("POST", "documents/import", { body: form(input), status });
      assert.deepEqual(await snapshot(), before);
    });
    for (const [name, options] of [
      ["anonymous 401", { cookie: null, status: 401 }], ["nonmember 403", { cookie: f.cookies[1], status: 403 }],
      ["foreign origin CSRF 403", { origin: "https://foreign.invalid", status: 403 }], ["missing origin CSRF 403", { origin: null, status: 403 }],
      ["forged workspace 403", { workspaceId: otherWorkspace, status: 403 }]
    ]) await check(name + " leaves documents and audits unchanged", async () => {
      const before = await snapshot(); await http("POST", "documents/import", { ...options, body: form() });
      assert.deepEqual(await snapshot(), before);
    });
    await check("workspace isolation hides imported CSV from the other member", async () => {
      const before = await snapshot();
      const result = await http("GET", "documents", { cookie: f.cookies[1], workspaceId: otherWorkspace, status: 200 });
      assert.equal(result.total, 0); assert.deepEqual(result.items, []);
      await http("GET", "documents", { cookie: f.cookies[1], workspaceId: workspace, status: 403 });
      assert.deepEqual(await snapshot(), before); assert.equal(report.providerCalls, 0);
    });
    assert.ok(report.checks.every(row => row.status === "PASS")); report.status = "PASSED";
  } catch {
    report.status = "FAILED"; throw new Error("AF146_LIVE_FAILED; inspect sanitized result.json and test group names");
  } finally {
    try {
      restoreProvider?.();
      if (f) { await f.close(); report.cleanup.push("app-closed-and-provider-restored"); }
      else report.cleanup.push("fixture-handle-unavailable");
      if (verifyClosed) { await verifyClosed(); report.cleanup.push("zero-api-database-sessions"); }
    } catch { report.status = "FAILED"; report.cleanup.push("cleanup-failed"); }
    for (const key of Object.keys(process.env)) delete process.env[key]; Object.assign(process.env, previousEnvironment);
    save(); assert.equal(report.status, "PASSED", "Live checks or cleanup failed");
  }
});
