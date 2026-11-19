import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { acceptanceRecord, assertLocalPath, readDatabaseEnvironment, repositoryRoot, withDatabase } from "../database/connection.mjs";
import { createRemainingClientFixture } from "./remaining-client-fixture.mjs";

// ROOT ONLY: creates a fresh, registered AF-138 acceptance DB and loopback app.
// The worker only syntax-checks/lints this file; no DB results are implied.
test("AF-138 real knowledge writes share workspace authorization and transaction fences", { timeout: 240_000 }, async t => {
  const parent = join(repositoryRoot, ".artifacts/auto-ai-program-20261105/AF-138");
  assertLocalPath(parent);
  execFileSync("git", ["check-ignore", "--quiet", parent], { cwd: repositoryRoot });
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  const directory = mkdtempSync(join(parent, "live-"));
  const report = { task: "AF-138", status: "STARTING", phase: "fixture", checks: [], lockWaits: [], http: [], providerCalls: 0, cleanup: [] };
  report.sourceHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot, encoding: "utf8" }).trim();
  const save = () => writeFileSync(join(directory, "result.json"), JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
  const previousEnvironment = { ...process.env };
  const active = new Set(), releases = new Set(), cleanups = [];
  let f, restoreAuth, verifyClosed;
  let restoreHook = () => {};
  function gate() {
    let release;
    const promise = new Promise(resolve => { release = resolve; });
    const resolve = value => { releases.delete(resolve); release(value); };
    releases.add(resolve); return { promise, resolve };
  }
  // Attach rejection handlers immediately, including operations held at barriers.
  function observe(promise) {
    const settled = Promise.resolve(promise).then(value => ({ ok: true, value }), error => ({ ok: false, error }));
    active.add(settled); void settled.then(() => active.delete(settled)); return settled;
  }
  async function value(settled) { const result = await settled; if (!result.ok) throw result.error; return result.value; }
  async function deadline(promise, label, ms = 1500) {
    let timer;
    try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label)), ms); })]); }
    finally { clearTimeout(timer); }
  }
  async function check(name, body) {
    await t.test(name, async () => {
      try { await body(); report.checks.push({ name, status: "PASS" }); }
      catch (error) {
        const code = typeof error?.code === "string" && /^[A-Z0-9_]{2,40}$/.test(error.code) ? error.code : "ASSERTION_OR_RUNTIME";
        report.checks.push({ name, status: "FAIL", code }); throw new Error("AF-138 assertion failed: " + name);
      }
      finally { save(); }
    });
  }
  try {
    f = await createRemainingClientFixture("AF-138", { aiCenter: true });
    const record = acceptanceRecord("test", f.lease.id);
    assert.equal(record.task, "AF-138"); assert.equal(record.repository, repositoryRoot);
    assert.equal(record.database, f.lease.database); assert.equal(record.instanceId, f.lease.instanceId);
    assert.match(record.database, /^aij_foundation_af138_test_[a-f0-9]{16}$/);
    assert.equal(process.env.ASYNC_RUNTIME_ENABLED, "false");
    assert.equal(process.env.AIJ_TEST_AI_PROVIDER_MODE, "offline-knowledge");
    report.acceptanceId = record.id; report.database = record.database;
    report.phase = "shared-owner-and-probe";
    const { prisma, project } = f;
    assert.equal(project.code, "aij-foundation-test");
    const memberId = f.accounts[0].id, workspaceId = f.workspaces[0].id;
    const knowledge = f.app.get(f.requireApi("plugins/aij-ai/ai-knowledge.service.js").AiKnowledgeService);
    const workspaceOwner = f.app.get(f.requireApi("client-workspaces/workspace-context.service.js").WorkspaceContextService);
    assert.equal(typeof workspaceOwner.assertWritePermissionInTransaction, "function", "Build current API before running");
    assert.match(knowledge.assertWriteAccessInTransaction.toString(), /assertWritePermissionInTransaction/);
    const provider = f.app.get(f.requireApi("plugins/aij-ai/ai-provider.js").AiProviderRegistry).get("offline-knowledge");
    const originalInvoke = provider.invoke;
    provider.invoke = async () => { report.providerCalls++; throw new Error("AF138_UNEXPECTED_OFFLINE_INVOCATION"); };
    cleanups.push(async () => { provider.invoke = originalInvoke; });

    const dbEnvironment = readDatabaseEnvironment("test", process.env, record.id);
    // PrismaService deliberately has connection_limit=1. Competitors/observer use
    // separate identity-checked pg connections, never an unchecked URL or old DB.
    const query = operation => withDatabase("test", dbEnvironment, operation, { acceptanceId: record.id });
    verifyClosed = async () => {
      const { rows: [row] } = await query(c => c.query("SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND application_name LIKE 'aij-api:%'"));
      assert.equal(row.count, 0, "Application pool sessions remain after close");
    };
    const originalTransaction = prisma.$transaction;
    const transact = originalTransaction.bind(prisma);
    let armed;
    function arm({ afterFence = false } = {}) {
      assert.equal(armed, undefined);
      const probe = { entered: gate(), proceed: gate(), fenced: gate(), finish: gate(), afterFence, pid: undefined };
      armed = probe; return probe;
    }
    prisma.$transaction = (operation, options) => {
      if (!armed || typeof operation !== "function" || options?.isolationLevel !== "ReadCommitted") return transact(operation, options);
      const probe = armed; armed = undefined;
      return transact(async tx => {
        [{ pid: probe.pid }] = await tx.$queryRaw`SELECT pg_backend_pid()::int AS pid`;
        probe.entered.resolve(); await probe.proceed.promise;
        return operation(new Proxy(tx, { get(target, key) {
          if (key === "$queryRaw") return async (...args) => {
            const result = await target.$queryRaw(...args);
            if (Array.isArray(args[0]) && args[0].join("?").includes("FOR SHARE OF u, w, m, r, g, p")) {
              probe.fenced.resolve(); if (probe.afterFence) await probe.finish.promise;
            }
            return result;
          };
          return Reflect.get(target, key);
        } }));
      }, options);
    };
    restoreHook = () => { armed = undefined; prisma.$transaction = originalTransaction; };

    const initialInstallation = await prisma.pluginInstallation.findUniqueOrThrow({ where: { projectId_pluginCode: { projectId: project.id, pluginCode: "aij-ai" } } });
    const initialMember = await prisma.memberUser.findUniqueOrThrow({ where: { id: memberId } });
    const initialMembership = await prisma.clientWorkspaceMembership.findUniqueOrThrow({ where: { workspaceId_memberId: { workspaceId, memberId } } });
    const grants = await prisma.clientWorkspaceRolePermission.findMany({
      where: { roleId: initialMembership.roleId, permission: { code: { in: ["workspace.knowledge.manage", "workspace.knowledge.query"] } } },
      include: { permission: true }
    });
    assert.equal(grants.length, 2); assert.ok(grants.every(g => !g.deletedAt && g.permission.status === "active"));
    restoreAuth = () => query(async c => {
      await c.query("BEGIN");
      try {
        await c.query("UPDATE public.plugin_installation SET status=$1,disabled_at=$2,updated_at=$3 WHERE id=$4", [initialInstallation.status, initialInstallation.disabledAt, initialInstallation.updatedAt, initialInstallation.id]);
        await c.query("UPDATE public.member_user SET status=$1,updated_at=$2 WHERE id=$3", [initialMember.status, initialMember.updatedAt, memberId]);
        await c.query("UPDATE public.client_workspace_membership SET status=$1,disabled_at=$2,role_id=$3,updated_at=$4 WHERE id=$5", [initialMembership.status, initialMembership.disabledAt, initialMembership.roleId, initialMembership.updatedAt, initialMembership.id]);
        for (const g of grants) await c.query("UPDATE public.client_workspace_role_permission SET deleted_at=$1,updated_at=$2 WHERE id=$3", [g.deletedAt, g.updatedAt, g.id]);
        await c.query("COMMIT");
      } catch (error) { await c.query("ROLLBACK"); throw error; }
    });

    // Only test-owned offline configuration. aiCenter seed does not configure the
    // older Knowledge provider port; fail on unexpected existing bindings.
    const secretName = "AIJ_SECRET_AIJ_FOUNDATION_TEST_AF138_OFFLINE_KEY";
    const secretRef = "env://" + secretName;
    process.env[secretName] = "af138-synthetic-" + randomBytes(32).toString("hex");
    const secret = await prisma.secretReference.create({ data: { ref: secretRef, provider: "env", description: "AF-138 offline only" } });
    const configIds = [];
    cleanups.push(async () => {
      await prisma.scopedConfig.deleteMany({ where: { id: { in: configIds } } });
      await prisma.secretReference.delete({ where: { id: secret.id } }); delete process.env[secretName];
    });
    for (const [configKey, configValue, valueType] of [
      ["ai.providerCode", "offline-knowledge", "string"], ["ai.modelCode", "synthetic-qa-v1", "string"],
      ["ai.credentialRef", secretRef, "secretRef"], ["capabilities.ai.text.generate", "true", "boolean"]
    ]) {
      const row = await prisma.scopedConfig.create({ data: { scope: "project", scopeId: project.id, pluginCode: "aij-ai", configKey, configValue, valueType,
        name: "AF-138 offline configuration", sensitive: valueType === "secretRef", isPublic: false } });
      configIds.push(row.id);
    }
    report.phase = "checks";

    async function http(method, path, body, { status = 200, cookie = f.cookies[0], workspace = workspaceId, correlation = "af138-http" } = {}) {
      const response = await fetch(f.baseUrl + "/client/ai/knowledge/" + path, {
        method, headers: { connection: "close", origin: process.env.WEB_URL, "x-correlation-id": correlation,
          ...(cookie ? { cookie } : {}), "x-aij-workspace-id": workspace,
          ...(body === undefined ? {} : { "content-type": "application/json" }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10000)
      });
      report.http.push({ method, route: path.startsWith("documents/") ? "documents/:id" : path, status: response.status });
      assert.equal(response.status, status, "Unexpected knowledge HTTP status");
      const json = await response.json(); return json.data;
    }
    const snapshot = async () => ({
      documents: await prisma.aiKnowledgeDocument.findMany({ where: { workspaceId }, orderBy: { id: "asc" } }),
      questions: await prisma.aiKnowledgeQuestion.findMany({ where: { workspaceId }, orderBy: { id: "asc" } }),
      jobs: await prisma.runtimeJob.findMany({ where: { workspaceId }, orderBy: { id: "asc" } }),
      traces: await prisma.aiExecutionTrace.findMany({ where: { projectId: project.id }, orderBy: { id: "asc" } }),
      audits: await prisma.auditLog.findMany({ where: { workspaceId, module: "aij-ai" }, orderBy: { id: "asc" } }),
      providerCalls: report.providerCalls
    });
    let document;
    const update = async (correlation = "af138-service") => {
      const row = await prisma.aiKnowledgeDocument.findUniqueOrThrow({ where: { id: document.id } });
      return knowledge.updateDocument(memberId, workspaceId, document.id, { title: "AF138 changed", expectedUpdatedAt: row.updatedAt.toISOString() }, correlation);
    };
    let counter = 0;
    const submit = (queryText = "unfindable zxqv", key = "af138-" + (++counter)) => knowledge.submitQuestion(memberId, workspaceId, { query: queryText, idempotencyKey: key }, "af138-service");
    await check("real HTTP create/edit/refused success with original audit contract", async () => {
      document = await http("POST", "documents", { documentCode: "af138-live", title: "AF138 Synthetic", content: "Synthetic aurora guide describes safe synthetic knowledge." }, { status: 201 });
      const edited = await http("PATCH", "documents/" + document.id, { title: "AF138 HTTP edit", expectedUpdatedAt: document.updatedAt });
      assert.equal(edited.title, "AF138 HTTP edit");
      const audits = await prisma.auditLog.findMany({ where: { resourceId: document.id, module: "aij-ai" } });
      assert.equal(audits.length, 2); assert.ok(audits.every(a => !JSON.stringify(a).includes("Synthetic aurora guide")));
      const before = await snapshot();
      const refused = await http("POST", "questions", { query: "unfindable zxqv", idempotencyKey: "af138-http-refused" });
      assert.equal(refused.status, "refused"); assert.equal(refused.refusalCode, "INSUFFICIENT_EVIDENCE");
      const after = await snapshot(); assert.equal(after.questions.length, before.questions.length + 1);
      assert.deepEqual(after.jobs, before.jobs); assert.deepEqual(after.traces, before.traces); assert.deepEqual(after.audits, before.audits);
    });
    assert.ok(document, "Required HTTP setup did not complete");
    await check("real HTTP anonymous/cross-workspace/revoked permission reject with zero writes", async () => {
      const row = await prisma.aiKnowledgeDocument.findUniqueOrThrow({ where: { id: document.id } }); const before = await snapshot();
      const dto = { title: "Forbidden", expectedUpdatedAt: row.updatedAt.toISOString() };
      await http("PATCH", "documents/" + document.id, dto, { cookie: null, status: 401 });
      await http("PATCH", "documents/" + document.id, dto, { cookie: f.cookies[1], status: 403 });
      try {
        await prisma.clientWorkspaceRolePermission.updateMany({ where: { id: { in: grants.map(g => g.id) } }, data: { deletedAt: new Date() } });
        await http("PATCH", "documents/" + document.id, dto, { status: 403 });
        await http("POST", "questions", { query: "unfindable zxqv", idempotencyKey: "af138-http-denied" }, { status: 403 });
        assert.deepEqual(await snapshot(), before);
      } finally { await restoreAuth(); }
    });

    async function observedBlock(observer, waiter, blocker, label) {
      assert.ok(Number.isInteger(waiter) && Number.isInteger(blocker) && waiter !== blocker);
      const until = Date.now() + 1200;
      while (Date.now() < until) {
        const { rows: [row] } = await observer.query("SELECT $2::int = ANY(pg_blocking_pids($1::int)) AS blocked", [waiter, blocker]);
        if (row.blocked) { report.lockWaits.push({ label, waiter, blocker, pgBlockingPids: true }); return; }
        await new Promise(resolve => setTimeout(resolve, 15));
      }
      throw new Error("AF138_ACTUAL_LOCK_WAIT_NOT_OBSERVED");
    }
    const pluginKey = "plugin-lifecycle:" + project.id + ":aij-ai";
    const workspaceKey = "aij-client-workspace-membership:" + workspaceId;
    const mutations = [
      { name: "plugin disabled", lock: "plugin", status: 404, change: c => c.query("UPDATE public.plugin_installation SET status='installed',disabled_at=NOW() WHERE id=$1", [initialInstallation.id]) },
      { name: "membership suspended", lock: "workspace", status: 403, change: c => c.query("UPDATE public.client_workspace_membership SET status='suspended',disabled_at=NOW() WHERE id=$1", [initialMembership.id]) },
      { name: "member identity disabled", lock: "workspace", status: 403, change: c => c.query("UPDATE public.member_user SET status='disabled' WHERE id=$1", [memberId]) },
      { name: "knowledge grants revoked", lock: "workspace", status: 403, change: c => c.query("UPDATE public.client_workspace_role_permission SET deleted_at=NOW() WHERE id=ANY($1::text[])", [grants.map(g => g.id)]) }
    ];
    async function takeLock(c, kind) {
      if (kind === "plugin") await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [pluginKey]);
      else if (kind === "workspace") await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [workspaceKey]);
    }
    async function compete(mutation, { lock = mutation.lock, hold = false } = {}) {
      const ready = gate(), release = gate();
      const settled = observe(query(async c => {
        await c.query("BEGIN");
        try {
          const { rows: [pid] } = await c.query("SELECT pg_backend_pid()::int AS pid");
          // With hold=false, signal PID before the update may block on row locks.
          if (!hold) ready.resolve(pid.pid);
          await takeLock(c, lock); await mutation.change(c);
          if (hold) { ready.resolve(pid.pid); await release.promise; }
          await c.query("COMMIT"); return pid.pid;
        } catch (error) { await c.query("ROLLBACK"); throw error; }
      }));
      return { ready, release, settled };
    }
    // Each observer connection is held outside the one-connection Prisma pool.
    for (const [operationName, write] of [["update", update], ["refused", () => submit()], ["queued", () => submit("aurora guide")]]) {
      for (const mutation of mutations) await check(`${operationName}: entry passes, ${mutation.name} commits first, actual wait then zero writes`, async () => {
        const before = await snapshot(), probe = arm(); const pending = observe(write()); let competitor;
        try {
          await deadline(probe.entered.promise, "Write entry not reached");
          competitor = await compete(mutation, { hold: true });
          const pid = await deadline(competitor.ready.promise, "Competitor not ready"); probe.proceed.resolve();
          await query(c => observedBlock(c, probe.pid, pid, `${operationName}:${mutation.name}:competitor-first`));
          competitor.release.resolve(); await value(competitor.settled);
          const result = await pending; assert.equal(result.ok, false); assert.equal(result.error?.getStatus?.(), mutation.status);
          assert.deepEqual(await snapshot(), before);
        } finally {
          probe.proceed.resolve(); probe.finish.resolve(); competitor?.release.resolve(); armed = undefined;
          await Promise.all([pending, ...(competitor ? [competitor.settled] : [])]); await restoreAuth();
        }
      });
    }

    for (const [mutation, lock] of [[mutations[0], "plugin"], [mutations[1], "workspace"], [mutations[2], null], [mutations[3], null]]) {
      await check(`write first: ${mutation.name} waits on held ${lock || "SHARE row"} lock through commit`, async () => {
        const probe = arm({ afterFence: true }), pending = observe(update()); let competitor;
        try {
          await deadline(probe.entered.promise, "Write entry not reached"); probe.proceed.resolve();
          await deadline(probe.fenced.promise, "Shared owner fence not reached");
          competitor = await compete(mutation, { lock }); const pid = await deadline(competitor.ready.promise, "Competitor PID not ready");
          await query(c => observedBlock(c, pid, probe.pid, mutation.name + ":writer-first"));
          probe.finish.resolve(); await value(pending); await value(competitor.settled);
          await assert.rejects(submit(), error => error.getStatus?.() === mutation.status);
        } finally {
          probe.proceed.resolve(); probe.finish.resolve(); competitor?.release.resolve(); armed = undefined;
          await Promise.all([pending, ...(competitor ? [competitor.settled] : [])]); await restoreAuth();
        }
      });
    }

    for (const [label, queryText, expected] of [["refused", "unfindable zxqv", "refused"], ["queued", "aurora guide", "queued"]]) {
      await check(`${label}: concurrent identical submissions, replay and changed request conflict`, async () => {
        const key = "af138-concurrent-" + label, before = await snapshot();
        const submissions = await Promise.all([observe(submit(queryText, key)), observe(submit(queryText, key))]);
        assert.ok(submissions.every(r => r.ok)); const [first, second] = submissions.map(r => r.value);
        assert.equal(first.id, second.id); assert.equal(first.status, expected);
        assert.equal([first, second].filter(r => r.idempotentReplay).length, 1);
        assert.equal((await submit(queryText, key)).idempotentReplay, true);
        await assert.rejects(submit("changed synthetic query", key), error => error.getStatus?.() === 409);
        const after = await snapshot(); assert.equal(after.questions.length, before.questions.length + 1);
        assert.equal(after.jobs.length, before.jobs.length + (label === "queued" ? 1 : 0));
        assert.deepEqual(after.traces, before.traces); assert.deepEqual(after.audits, before.audits);
        if (label === "queued") {
          const row = after.questions.find(q => q.id === first.id), job = after.jobs.find(j => j.id === row.runtimeJobId);
          assert.equal(job.scopeId, project.id); assert.equal(job.workspaceId, workspaceId); assert.equal(job.pluginCode, "aij-ai");
        }
      });
    }
    await check("two concurrent real HTTP edits share a version: exactly one succeeds and one conflicts", async () => {
      const row = await prisma.aiKnowledgeDocument.findUniqueOrThrow({ where: { id: document.id } }), before = await snapshot();
      const edit = title => fetch(f.baseUrl + "/client/ai/knowledge/documents/" + document.id, { method: "PATCH",
        headers: { cookie: f.cookies[0], origin: process.env.WEB_URL, "x-aij-workspace-id": workspaceId, "content-type": "application/json" },
        body: JSON.stringify({ title, expectedUpdatedAt: row.updatedAt.toISOString() }), signal: AbortSignal.timeout(10000) });
      const requests = await Promise.all([observe(edit("Version A")), observe(edit("Version B"))]);
      assert.ok(requests.every(r => r.ok));
      const responses = requests.map(r => r.value); assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
      await Promise.all(responses.map(r => r.arrayBuffer()));
      const after = await snapshot(); assert.equal(after.audits.length, before.audits.length + 1);
      assert.deepEqual(after.questions, before.questions); assert.deepEqual(after.jobs, before.jobs); assert.deepEqual(after.traces, before.traces);
      await http("PATCH", "documents/" + document.id, { title: "Stale", expectedUpdatedAt: "2020-01-01T00:00:00.000Z" }, { status: 409 });
      assert.deepEqual(await snapshot(), after);
    });

    await check("actual PostgreSQL audit INSERT exception rolls create/edit back; removing trigger restores success", async () => {
      let trigger = false, fn = false;
      const remove = async () => query(async c => {
        if (trigger) { await c.query("DROP TRIGGER af138_reject_knowledge_audit ON public.audit_log"); trigger = false; }
        if (fn) { await c.query("DROP FUNCTION public.af138_reject_knowledge_audit()"); fn = false; }
      });
      cleanups.push(remove);
      try {
        await query(async c => {
          await c.query("CREATE FUNCTION public.af138_reject_knowledge_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.module='aij-ai' AND NEW.request_summary->>'correlationId'='af138-audit-failure' THEN RAISE EXCEPTION 'AF138_SYNTHETIC_AUDIT_FAILURE'; END IF; RETURN NEW; END $$"); fn = true;
          await c.query("CREATE TRIGGER af138_reject_knowledge_audit BEFORE INSERT ON public.audit_log FOR EACH ROW EXECUTE FUNCTION public.af138_reject_knowledge_audit()"); trigger = true;
        });
        const before = await snapshot();
        await assert.rejects(update("af138-audit-failure"), error => error.getStatus?.() === 503);
        await assert.rejects(knowledge.createDocument(memberId, workspaceId,
          { documentCode: "af138-audit-rollback", title: "Rollback", content: "Synthetic rollback content" }, "af138-audit-failure"), error => error.getStatus?.() === 503);
        assert.deepEqual(await snapshot(), before);
      } finally { await remove(); }
      await update("af138-audit-recovered");
      const audit = await prisma.auditLog.findFirst({ where: { resourceId: document.id, requestSummary: { path: ["correlationId"], equals: "af138-audit-recovered" } } });
      assert.ok(audit);
    });
    assert.equal(report.providerCalls, 0);
    report.status = report.checks.some(c => c.status === "FAIL") ? "FAILED" : "PASSED";
  } catch (error) {
    report.status = "FAILED";
    report.failureCode = typeof error?.code === "string" && /^[A-Z0-9_]{2,40}$/.test(error.code) ? error.code : "ASSERTION_OR_RUNTIME";
    throw new Error("AF-138 live setup/check failed; see ignored AF-138 result.json (no credentials recorded)");
  } finally {
    for (const release of [...releases]) release();
    await Promise.all([...active]); restoreHook();
    if (restoreAuth) {
      try { await restoreAuth(); report.cleanup.push("authorization state restored"); }
      catch { report.cleanup.push("FAIL: authorization restore"); }
    }
    for (const cleanup of cleanups.reverse()) {
      try { await cleanup(); } catch { report.cleanup.push("FAIL: owned hook/config/trigger cleanup"); }
    }
    if (f) {
      try {
        await f.close();
        if (verifyClosed) {
          await verifyClosed(); report.cleanup.push("application closed; zero aij-api sessions observed; guarded pg clients ended");
        } else report.cleanup.push("application closed; session probe not initialized");
      }
      catch { report.cleanup.push("FAIL: application close"); }
    }
    for (const key of Object.keys(process.env)) delete process.env[key]; Object.assign(process.env, previousEnvironment);
    if (report.cleanup.some(s => s.startsWith("FAIL:"))) report.status = "FAILED";
    save();
    assert.ok(!report.cleanup.some(s => s.startsWith("FAIL:")), "AF-138 cleanup failed; inspect safe evidence");
  }
});
