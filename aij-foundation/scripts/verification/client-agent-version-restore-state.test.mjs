import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import ts from "typescript";
import { createPersonalAgentsClient, createPersonalAgentPublicationsClient } from "../../packages/sdk/dist/index.mjs";
import { agentRestoreDifferences, agentRestoreIssue, createAgentVersionRestore, historicalAgentConfiguration } from "../../apps/web/app/components/client-agent-version-restore-state.mjs";

// OFFLINE SYNTHETIC request envelopes, using the actual compiled public SDK.
// These tests do not attest HTTP/PG authorization, native keyboard or 390px UI.
const READ = "workspace.ai.assets.read", MANAGE = "workspace.ai.assets.manage";
const agentId = "3a07234c-b0fe-4e48-b187-ea14d9ac04a1";
const at = "2026-11-08T00:00:00.000Z";
const content = (extra = {}) => ({ name: "Private synthetic name", instructions: "Private synthetic instructions", enabled: true,
  modelCode: "text-model", modelRevision: 2, catalogVersion: 7, inputFields: ["question"], outputFormat: "json", outputFields: ["answer"],
  skillBindings: [{ skillId: "skill-a", revision: 2, skillVersionId: "skill-version-a2" }], ...extra });
const head = (extra = {}) => ({ ...content(), id: agentId, code: "private-agent", revision: 3, createdAt: at, updatedAt: at, ...extra });
const version = (revision = 2, extra = {}) => ({ ...content({ instructions: "Older synthetic instructions" }), id: `version-${revision}`, agentId,
  code: "private-agent", revision, createdAt: at, ...extra });
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(t, options = {}) {
  const calls = [], controls = { memberId: "member-a", workspaceId: "space-a", roleId: "role-a", roleCode: "owner", permissions: [READ, MANAGE],
    sessionGeneration: "a".repeat(64), active: true, head: head(), versions: [version(3), version()], cursor: null,
    models: { catalogVersion: 7, items: [{ code: "text-model", name: "Synthetic model", revision: 2, capability: "text" }] },
    publicationVersion: 5, published: true, override: null, afterPatch: null, ...options };
  let changed = 0;
  const request = async (path, init = {}) => {
    const u = new URL(path, "http://synthetic.invalid"), method = init.method ?? "GET", body = init.body ? JSON.parse(init.body) : undefined;
    const call = { path: u.pathname, query: u.searchParams, method, body, init }; calls.push(call);
    if (controls.override) { const result = await controls.override(call); if (result !== undefined) return structuredClone(result); }
    if (u.pathname === "/client/auth/me") return { id: controls.memberId };
    if (u.pathname === "/client/workspaces/context") return { workspaceId: controls.workspaceId, roleId: controls.roleId, roleCode: controls.roleCode,
      permissions: [...controls.permissions], sessionGeneration: controls.sessionGeneration };
    if (u.pathname.endsWith("/model-options")) return structuredClone(controls.models);
    if (u.pathname.endsWith("/versions")) return { items: structuredClone(controls.versions), nextCursor: controls.cursor };
    if (u.pathname.endsWith("/publication")) return { agentId, revision: controls.head.revision, publicationVersion: controls.publicationVersion,
      publishedRevision: controls.published ? controls.head.revision : null, published: controls.published, dependencyReadiness: { ready: false, reason: "disabled" } };
    assert.equal(u.pathname, `/client/ai/personal-agents/${agentId}`);
    if (method === "PATCH") {
      assert.equal(body.expectedRevision, controls.head.revision);
      controls.head = head({ name: body.name, instructions: body.instructions, enabled: body.enabled, modelCode: body.modelCode,
        modelRevision: body.modelRevision, catalogVersion: body.catalogVersion, inputFields: [...body.inputFields], outputFormat: body.outputFormat,
        outputFields: [...body.outputFields], skillBindings: body.skillBindings.map(p => ({ ...p, skillVersionId: `skill-version-a${p.revision}` })), revision: controls.head.revision + 1 });
      controls.published = false; controls.publicationVersion++;
      if (controls.afterPatch) await controls.afterPatch(call);
    } else assert.equal(method, "GET");
    return structuredClone(controls.head);
  };
  const store = createAgentVersionRestore({ request, agentsClientFactory: createPersonalAgentsClient, publicationsClientFactory: createPersonalAgentPublicationsClient,
    onAgentChanged: () => changed++, onScopeRejected: options.onScopeRejected, isActive: () => controls.active, timeoutMs: options.timeoutMs ?? 8000 });
  const scope = { memberId: "member-a", workspaceId: "space-a", agentId, revision: controls.head.revision };
  store.setScope(scope); t.after(() => store.dispose());
  const select = async () => { await store.loadHistory(); await store.selectVersion("version-2"); assert.ok(store.getSnapshot().selected); };
  const confirm = async () => { await select(); await store.requestConfirmation(); assert.equal(store.getSnapshot().confirmation, true); };
  return { store, controls, calls, scope, select, confirm, changed: () => changed, patches: () => calls.filter(c => c.method === "PATCH") };
}
function privateCleared(store) {
  const s = store.getSnapshot(); assert.equal(s.head, null); assert.equal(s.selected, null); assert.equal(s.models, null);
  assert.deepEqual(s.versions, []); assert.equal(s.confirmation, false); assert.equal(s.recovery, null);
  assert.doesNotMatch(JSON.stringify(s), /Private synthetic|Older synthetic|skill-version-a/);
}

test("current permission rejection notifies the original parent after private clearance, without new PATCH", async t => {
  let rejected = 0;
  const f = fixture(t, { onScopeRejected: () => { rejected++; privateCleared(f.store); } });
  await f.confirm(); f.controls.permissions = [];
  await f.store.confirmRestore(); assert.equal(rejected, 1); assert.equal(f.patches().length, 0);
});
test("whitelist projects exact historical configuration, forces disabled and never copies identity or credential refs", () => {
  const v = version(2, { owner: "foreign", session: "credential", publication: { published: true }, credentialRef: "secret" });
  const payload = historicalAgentConfiguration(v);
  assert.deepEqual(Object.keys(payload), ["name", "instructions", "enabled", "modelCode", "modelRevision", "catalogVersion", "inputFields", "outputFormat", "outputFields", "skillBindings"]);
  assert.equal(payload.enabled, false); assert.deepEqual(payload.skillBindings, [{ skillId: "skill-a", revision: 2 }]);
  assert.doesNotMatch(JSON.stringify(payload), /foreign|credential|publication|secret|version-a2|agentId/);
  assert.equal(v.enabled, true); assert.equal(v.skillBindings[0].skillVersionId, "skill-version-a2");
});
test("invalid fields and dependencies are rejected together, never silently omitted", () => {
  for (const patch of [{ name: " x " }, { instructions: "\0" }, { modelRevision: 0 }, { catalogVersion: "7" }, { inputFields: ["q", "q"] },
    { inputFields: ["constructor"] }, { outputFields: [] }, { skillBindings: [{ skillId: "skill-a", revision: 0, skillVersionId: "v" }] },
    { skillBindings: [{ skillId: "skill-a", revision: 1, skillVersionId: "v" }, { skillId: "skill-a", revision: 2, skillVersionId: "v2" }] }])
    assert.throws(() => historicalAgentConfiguration(version(2, patch)));
  let accessed = false; const getter = Object.defineProperty(version(), "credential", { get() { accessed = true; throw Error(); } });
  assert.throws(() => historicalAgentConfiguration(getter)); assert.equal(accessed, false);
});
test("explicit history, older exact selection and comparison require no mutation", async t => {
  const f = fixture(t); assert.equal(f.calls.length, 0); await f.select();
  assert.equal(f.patches().length, 0); assert.equal(f.store.getSnapshot().selected.revision, 2);
  const diffs = agentRestoreDifferences(f.store.getSnapshot().head, f.store.getSnapshot().selected);
  assert.equal(diffs.find(x => x.field === "instructions").changed, true);
  assert.deepEqual(diffs.find(x => x.field === "enabled"), { field: "enabled", current: true, selected: true, target: false, changed: true });
  await f.store.selectVersion("version-3"); await f.store.selectVersion("missing"); assert.equal(f.store.getSnapshot().selected.revision, 2);
  assert.equal(f.calls.filter(c => c.path === "/client/auth/me").length, 4);
});
test("paged immutable versions retain exact order, IDs and original beforeRevision cursor", async t => {
  const f = fixture(t, { head: head({ revision: 20 }), versions: Array.from({ length: 10 }, (_, i) => version(20 - i)), cursor: 11 });
  await f.store.loadHistory(); f.controls.versions = [version(10)]; f.controls.cursor = null; await f.store.loadHistory(true);
  assert.equal(f.store.getSnapshot().versions.length, 11);
  assert.equal(f.calls.filter(c => c.path.endsWith("/versions")).at(-1).query.get("beforeRevision"), "11");
});
test("duplicate IDs/revisions, wrong owner, bad cursors and invalid pins clear private history", async t => {
  for (const options of [{ versions: [version(), version()] }, { versions: [version(2), version(1, { id: "version-2" })] },
    { versions: [version(2, { agentId: "foreign" })] }, { cursor: 2 }, { versions: [version(2, { skillBindings: [{ skillId: "s", revision: 1 }] })] }]) {
    const f = fixture(t, options); await f.store.loadHistory(); privateCleared(f.store); assert.ok(f.store.getSnapshot().issue); assert.equal(f.patches().length, 0);
  }
});
test("cancel separate confirmation makes zero writes", async t => {
  const f = fixture(t); await f.confirm(); f.store.cancelConfirmation(); await f.store.confirmRestore();
  assert.equal(f.patches().length, 0); assert.equal(f.store.getSnapshot().confirmation, false);
});
test("restore creates exactly one disabled unpublished new head, preserves original history and Run references", async t => {
  const f = fixture(t), immutable = structuredClone(f.controls.versions), oldRun = { agentVersionId: "version-2", revision: 2 };
  await f.confirm(); await f.store.confirmRestore(); await f.store.confirmRestore();
  assert.equal(f.patches().length, 1); const payload = f.patches()[0].body;
  assert.equal(payload.expectedRevision, 3); assert.equal(payload.enabled, false); assert.equal(payload.modelRevision, 2); assert.equal(payload.catalogVersion, 7);
  assert.deepEqual(payload.skillBindings, [{ skillId: "skill-a", revision: 2 }]); assert.equal(f.controls.head.revision, 4);
  assert.equal(f.controls.published, false); assert.equal(f.controls.publicationVersion, 6); assert.deepEqual(f.controls.versions, immutable);
  assert.deepEqual(oldRun, { agentVersionId: "version-2", revision: 2 }); assert.equal(f.changed(), 1);
  assert.equal(f.store.getSnapshot().locked, false); assert.match(f.store.getSnapshot().notice, /新版本 v4/);
  assert.ok(f.calls.every(c => c.method === "GET" || c.method === "PATCH"));
  assert.ok(f.calls.filter(c => c.path.endsWith("/publication")).length >= 2);
});
test("projected disabled no-op makes zero PATCH and no new-version claim, even if old catalog is no longer available", async t => {
  const f = fixture(t, { head: head({ ...content({ instructions: "Older synthetic instructions", enabled: false }) }), models: { catalogVersion: 8, items: [] } });
  await f.select(); assert.equal(f.store.noChange(), true); await f.store.requestConfirmation();
  assert.equal(f.store.getSnapshot().confirmation, false); assert.equal(f.patches().length, 0); assert.equal(f.changed(), 0);
  assert.match(f.store.getSnapshot().notice, /未创建新版本/);
});
test("read-only permission can browse and compare; manage alone or execute permission cannot grant restore", async t => {
  const read = fixture(t, { permissions: [READ] }); await read.select(); await read.store.requestConfirmation();
  assert.equal(read.store.getSnapshot().canManage, false); assert.equal(read.patches().length, 0);
  for (const permissions of [[MANAGE], ["workspace.ai.execute"]]) { const f = fixture(t, { permissions }); await f.store.loadHistory(); privateCleared(f.store); assert.equal(f.store.getSnapshot().issue.status, 403); }
});
test("stale model or catalog never silently upgrades historical references or forces mutation", async t => {
  for (const models of [{ catalogVersion: 8, items: [] }, { catalogVersion: 7, items: [{ code: "text-model", name: "New", revision: 3, capability: "text" }] }]) {
    const f = fixture(t, { models }); await f.select(); assert.equal(f.store.getSnapshot().selected.modelRevision, 2);
    await f.store.requestConfirmation(); privateCleared(f.store); assert.equal(f.patches().length, 0); assert.equal(f.store.getSnapshot().issue.status, 409);
  }
});
test("CAS conflict during final check clears private state, never overwrites concurrent human edit", async t => {
  const f = fixture(t); await f.confirm(); f.controls.head = head({ revision: 4, instructions: "Concurrent human" });
  await f.store.confirmRestore(); privateCleared(f.store); assert.equal(f.patches().length, 0); assert.equal(f.controls.head.instructions, "Concurrent human");
  assert.equal(f.store.getSnapshot().issue.status, 409); assert.equal(f.store.getSnapshot().locked, false);
});
test("all attempted PATCH failures retain lock, including committed lost 4xx replies", async t => {
  for (const status of [0, 400, 401, 403, 404, 409, 410, 503]) {
    const f = fixture(t); await f.confirm(); f.controls.afterPatch = () => { throw { status, message: "PRIVATE_SERVER_BODY" }; };
    await f.store.confirmRestore(); privateCleared(f.store); assert.equal(f.store.getSnapshot().locked, true); assert.equal(f.controls.head.revision, 4);
    const count = f.calls.length; await f.store.confirmRestore(); await f.store.requestConfirmation(); await f.store.loadHistory();
    assert.equal(f.calls.length, count); assert.equal(f.patches().length, 1); assert.equal(f.changed(), 0);
    assert.doesNotMatch(f.store.getSnapshot().issue.message, /PRIVATE_SERVER_BODY/);
  }
});
test("uncommitted server dependency rejection also requires read and distinct authorized acknowledgement", async t => {
  const f = fixture(t); await f.confirm(); f.controls.override = c => { if (c.method === "PATCH") throw { status: 404 }; };
  await f.store.confirmRestore(); assert.equal(f.controls.head.revision, 3); assert.equal(f.store.getSnapshot().locked, true);
  await f.store.acknowledgeRecovery(); assert.equal(f.store.getSnapshot().locked, true);
  await f.store.readRecovery(); assert.equal(f.store.getSnapshot().recovery.revision, 3); assert.equal(f.store.getSnapshot().locked, true);
  await f.store.acknowledgeRecovery(); assert.equal(f.store.getSnapshot().locked, false); assert.equal(f.patches().length, 1); assert.equal(f.changed(), 1);
});
test("unknown committed result reconciles original current head + publication with separate acknowledgement and no retry", async t => {
  const f = fixture(t); await f.confirm(); f.controls.afterPatch = () => { throw { status: 503 }; }; await f.store.confirmRestore();
  await f.store.readRecovery(); assert.deepEqual(f.store.getSnapshot().recovery, { revision: 4, enabled: false, published: false, publicationVersion: 6 });
  assert.equal(f.store.getSnapshot().locked, true); assert.equal(f.changed(), 0); await f.store.acknowledgeRecovery();
  assert.equal(f.store.getSnapshot().locked, false); assert.equal(f.patches().length, 1); assert.equal(f.changed(), 1);
});
test("recovery cannot cross account/workspace/Agent and lock survives null, disposal and scope revision changes", async t => {
  const f = fixture(t); await f.confirm(); f.controls.afterPatch = () => { throw { status: 409 }; }; await f.store.confirmRestore();
  for (const scope of [null, { ...f.scope, memberId: "member-b" }, { ...f.scope, workspaceId: "space-b" }, { ...f.scope, agentId: "foreign" }]) {
    f.store.setScope(scope); const count = f.calls.length; await f.store.readRecovery(); await f.store.acknowledgeRecovery();
    assert.equal(f.calls.length, count); assert.equal(f.store.getSnapshot().locked, true); privateCleared(f.store);
  }
  f.store.dispose(); f.store.setScope({ ...f.scope, revision: 4 }); await f.store.readRecovery(); assert.equal(f.store.getSnapshot().recovery.revision, 4);
});
test("recovery read supports assets.read; acknowledgement revalidates current manage and detects publication changes", async t => {
  const f = fixture(t); await f.confirm(); f.controls.afterPatch = () => { throw Error(); }; await f.store.confirmRestore();
  f.controls.permissions = [READ]; await f.store.readRecovery(); assert.ok(f.store.getSnapshot().recovery); await f.store.acknowledgeRecovery(); assert.equal(f.store.getSnapshot().locked, true);
  f.controls.permissions = [READ, MANAGE]; await f.store.readRecovery(); f.controls.publicationVersion++; await f.store.acknowledgeRecovery();
  assert.equal(f.store.getSnapshot().locked, true); privateCleared(f.store);
});
test("account, role, permission, session and head changes after read fence private results", async t => {
  for (const mutate of [c => { c.memberId = "other"; }, c => { c.roleId = "other"; }, c => { c.roleCode = "viewer"; },
    c => { c.permissions = [READ]; }, c => { c.sessionGeneration = "b".repeat(64); }, c => { c.head.revision++; }]) {
    const f = fixture(t); f.controls.override = call => { if (call.path.endsWith("/versions")) { mutate(f.controls); return { items: [version()], nextCursor: null }; } };
    await f.store.loadHistory(); privateCleared(f.store); assert.equal(f.patches().length, 0);
  }
});
test("actual 64hex session generation is mandatory and later session revocation cannot send PATCH", async t => {
  for (const generation of [undefined, "", "session-a", "A".repeat(64), "a".repeat(63)]) {
    const f = fixture(t, { sessionGeneration: generation }); await f.store.loadHistory(); privateCleared(f.store); assert.ok(f.store.getSnapshot().issue);
  }
  const f = fixture(t); await f.confirm(); f.controls.sessionGeneration = "b".repeat(64); await f.store.confirmRestore();
  privateCleared(f.store); assert.equal(f.patches().length, 0);
});
test("late permission or session revocation after committed PATCH retains opaque lock and suppresses parent callback", async t => {
  for (const mutate of [c => { c.permissions = [READ]; }, c => { c.sessionGeneration = "b".repeat(64); }]) {
    const f = fixture(t); await f.confirm(); f.controls.afterPatch = () => mutate(f.controls); await f.store.confirmRestore();
    privateCleared(f.store); assert.equal(f.store.getSnapshot().locked, true); assert.equal(f.changed(), 0); assert.equal(f.patches().length, 1);
  }
});
test("malformed post-PATCH head or still-published metadata never claims restore success", async t => {
  for (const afterPatch of [c => { c.head.enabled = true; }, c => { c.published = true; }, c => { c.publicationVersion--; },
    c => { c.head.skillBindings[0].skillVersionId = "unexpected-fixed-version"; }, c => { c.head.code = "unexpected-code"; }]) {
    const f = fixture(t); await f.confirm(); f.controls.afterPatch = () => afterPatch(f.controls); await f.store.confirmRestore();
    privateCleared(f.store); assert.equal(f.store.getSnapshot().locked, true); assert.equal(f.changed(), 0);
  }
});
test("null/suspend/dispose/head change abort delayed history even when transport ignores signal", async t => {
  for (const fence of [f => f.store.setScope(null), f => f.store.suspend(), f => f.store.dispose(), f => f.store.setScope({ ...f.scope, revision: 4 })]) {
    const f = fixture(t), wait = deferred(); f.controls.override = call => call.path.endsWith("/versions") ? wait.promise : undefined;
    const pending = f.store.loadHistory(); while (!f.calls.some(c => c.path.endsWith("/versions"))) await tick(); fence(f);
    wait.resolve({ items: [version()], nextCursor: null }); await pending; await tick(); privateCleared(f.store); assert.equal(f.changed(), 0);
  }
});
test("blur/hidden-style suspend during attempted PATCH retains lock; late success cannot restore private body or reload parent", async t => {
  const f = fixture(t), wait = deferred(); await f.confirm(); f.controls.afterPatch = () => wait.promise;
  const pending = f.store.confirmRestore(); while (!f.patches().length) await tick(); f.controls.active = false; f.store.suspend();
  await pending; assert.equal(f.store.getSnapshot().locked, true); privateCleared(f.store);
  wait.resolve(); await tick(); assert.equal(f.changed(), 0); assert.equal(f.patches().length, 1); privateCleared(f.store);
  f.controls.active = true; await f.store.readRecovery(); assert.equal(f.store.getSnapshot().recovery.revision, 4);
});
test("bounded timeout on an ignored PATCH leaves uncertain lock and no duplicate mutation", async t => {
  const f = fixture(t, { timeoutMs: 15 }); await f.confirm(); const wait = deferred(); f.controls.afterPatch = () => wait.promise;
  const keepAlive = setTimeout(() => {}, 1000); t.after(() => clearTimeout(keepAlive));
  await f.store.confirmRestore(); assert.equal(f.store.getSnapshot().locked, true); assert.equal(f.patches().length, 1);
  wait.resolve(); await tick(); assert.equal(f.changed(), 0); privateCleared(f.store);
});
test("safe actionable status messages never expose server bodies", () => {
  const messages = new Set([401, 403, 404, 409, 410, 503].map(status => agentRestoreIssue({ status, message: "PRIVATE_BODY" }).message));
  assert.equal(messages.size, 6); for (const message of messages) assert.doesNotMatch(message, /PRIVATE_BODY/);
});
test("original Agent service validates CURRENT catalog and exact owned live prompt-Skill pins, including executable rejection", async () => {
  const require = createRequire(resolve("apps/api/package.json"));
  require("ts-node").register({ project: resolve("apps/api/tsconfig.json"), transpileOnly: true }); require("reflect-metadata");
  const { AiPersonalAgentsService } = require(resolve("apps/api/src/plugins/aij-ai/ai-personal-agents.service.ts"));
  const catalog = { version: 7, catalog: { models: [{ code: "text-model", revision: 2, enabled: true, capability: "text", providerCode: "provider" }],
    providers: [{ code: "provider", enabled: true, vendor: "compatible" }] } };
  let pin = { skill_id: "skill-a", id: "skill-version-a2", revision: 2, executable: false };
  const queries = [], tx = { $queryRaw: async (parts, ...values) => {
    const sql = parts.join("?"); queries.push({ sql, values });
    if (sql.includes("scoped_config")) return [{ id: "catalog" }];
    assert.match(sql, /s\.workspace_id=\?/); assert.match(sql, /s\.member_id=\?/); assert.match(sql, /s\.deleted_at IS NULL/);
    assert.match(sql, /ai_personal_script_version/); assert.match(sql, /FOR SHARE OF s,v/);
    assert.ok(values.includes("member-a") && values.includes("space-a") && values.includes("skill-a") && values.includes(2));
    return pin ? [pin] : [];
  } };
  const service = new AiPersonalAgentsService({}, {}, {}, { current: async actual => { assert.equal(actual, tx); return catalog; } });
  const input = historicalAgentConfiguration(version());
  assert.deepEqual(await service.validateSave(tx, "project", "member-a", "space-a", input), [{ skillId: "skill-a", skillVersionId: "skill-version-a2", revision: 2 }]);
  for (const invalid of [{ ...input, catalogVersion: 6 }, { ...input, modelRevision: 1 }])
    await assert.rejects(service.validateSave(tx, "project", "member-a", "space-a", invalid), e => e.getStatus() === 409);
  catalog.catalog.models[0].enabled = false;
  await assert.rejects(service.validateSave(tx, "project", "member-a", "space-a", input), e => e.getStatus() === 409);
  catalog.catalog.models[0].enabled = true; catalog.catalog.providers[0].enabled = false;
  await assert.rejects(service.validateSave(tx, "project", "member-a", "space-a", input), e => e.getStatus() === 409);
  catalog.catalog.providers[0].enabled = true; pin = null;
  await assert.rejects(service.validateSave(tx, "project", "member-a", "space-a", input), e => e.getStatus() === 404);
  pin = { skill_id: "skill-a", id: "skill-version-a2", revision: 2, executable: true };
  await assert.rejects(service.validateSave(tx, "project", "member-a", "space-a", input), e => e.getStatus() === 409);
  assert.ok(queries.length > 0);
});
test("offline rendered comparison uses AntD semantics, escaping, reflow and keyboard-reachable controls; native checks remain NOT_RUN", async t => {
  const f = fixture(t); f.controls.versions = [version(2, { instructions: "<script>synthetic()</script>" })]; await f.select();
  const require = createRequire(resolve("apps/web/package.json")), React = require("react"), { renderToStaticMarkup } = require("react-dom/server");
  const path = "apps/web/app/components/client-agent-version-restore-panel.tsx";
  const compiled = ts.transpileModule(readFileSync(path, "utf8"), { fileName: path, compilerOptions: { module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const exports = {}, actualRequire = createRequire(resolve(path));
  const hookHarness = { ...React, useState: () => [f.store], useRef: value => ({ current: value }), useId: () => "restore-title",
    useEffect: () => {}, useLayoutEffect: () => {}, useSyncExternalStore: (_subscribe, snapshot) => snapshot() };
  new Function("require", "exports", compiled)(name => name === "react" ? hookHarness : name === "./admin-api" ? { adminTheme: {} } :
    name === "./client-agent-version-restore-state.mjs" ? { agentRestoreDifferences, createAgentVersionRestore } : actualRequire(name), exports);
  const html = renderToStaticMarkup(React.createElement(exports.ClientAgentVersionRestorePanel, { request: async () => {}, scope: f.scope, onAgentChanged: () => {} }));
  assert.match(html, /aria-labelledby="restore-title"/); assert.match(html, /<button/); assert.match(html, /tabindex="0"/);
  assert.match(html, /minmax\(min\(100%, 18rem\), 1fr\)/); assert.match(html, /max-width:100%/); assert.match(html, /&lt;script&gt;/); assert.doesNotMatch(html, /<script>synthetic/);
  const source = readFileSync(path, "utf8"); assert.match(source, /addEventListener\("blur", clear\)/); assert.match(source, /document.hidden/);
  assert.match(source, /trigger.current\?\.focus\(\)/); assert.match(source, /确认创建禁用且未发布的新版本/);
  assert.doesNotMatch(source, /localStorage|sessionStorage|dangerouslySetInnerHTML|setInterval|window.location/);
});
