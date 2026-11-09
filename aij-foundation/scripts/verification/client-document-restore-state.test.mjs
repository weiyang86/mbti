import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import ts from "typescript";
import { createPersonalDocumentsClient } from "../../packages/sdk/dist/index.mjs";
import { createDocumentVersionRestore, documentRestoreDifferences, documentRestoreIssue } from "../../apps/web/app/components/client-document-restore-state.mjs";

// OFFLINE SYNTHETIC ONLY, actual compiled public SDK. No PG/API/HTTP/native
// keyboard, real hidden transition, installed browser or 390px claim.
const READ = "workspace.documents.read", MANAGE = "workspace.documents.manage";
const documentId = "3a07234c-b0fe-4e48-b187-ea14d9ac04a1", otherId = "3a07234c-b0fe-4e48-b187-ea14d9ac04a2";
const at = "2026-11-08T00:00:00.000Z", later = "2026-11-08T01:00:00.000Z";
const head = (patch = {}) => ({ id: documentId, code: "synthetic-document", revision: 3, name: "Private current name", body: "Private current body", createdAt: at, updatedAt: at, ...patch });
const version = (revision = 2, patch = {}) => ({ documentId, revision, name: `Private historical name ${revision}`, body: `Private historical body ${revision}`, createdAt: at, ...patch });
const summary = v => ({ documentId: v.documentId, revision: v.revision, name: v.name, createdAt: v.createdAt });
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
async function until(predicate) { for (let i = 0; i < 200; i++) { if (predicate()) return; await tick(); } assert.fail("Synthetic request did not reach expected boundary"); }
function fixture(t, options = {}) {
  const calls = [], controls = { memberId: "member-a", workspaceId: "space-a", roleId: "role-a", roleCode: "owner", permissions: [READ, MANAGE],
    sessionGeneration: "a".repeat(64), active: true, head: head(), versions: [version(3), version(2), version(1)], cursor: null,
    override: null, beforePatch: null, afterPatch: null, ...options };
  let changed = 0, rejected = 0;
  const request = async (path, init = {}) => {
    const u = new URL(path, "http://offline.invalid"), method = init.method ?? "GET", body = init.body ? JSON.parse(init.body) : undefined;
    const call = { path: u.pathname, query: u.searchParams, method, body, init }; calls.push(call);
    assert.equal(init.cache, "no-store");
    if (controls.override) { const result = await controls.override(call); if (result !== undefined) return structuredClone(result); }
    if (u.pathname === "/client/auth/me") return { id: controls.memberId, email: null, nickname: "Synthetic member" };
    assert.equal(init.workspaceId, "space-a");
    if (u.pathname === "/client/workspaces/context") return { workspaceId: controls.workspaceId, workspaceCode: "synthetic-space", workspaceName: "Synthetic space",
      roleId: controls.roleId, roleCode: controls.roleCode, permissions: [...controls.permissions], sessionGeneration: controls.sessionGeneration };
    if (u.pathname.endsWith("/versions")) return { items: controls.versions.map(summary), nextCursor: controls.cursor };
    if (u.pathname.includes("/versions/")) return structuredClone(controls.versions.find(v => v.revision === Number(u.pathname.split("/").at(-1))));
    assert.equal(u.pathname, `/client/documents/${documentId}`);
    if (method === "PATCH") {
      if (controls.beforePatch) await controls.beforePatch(call);
      assert.equal(body.expectedRevision, controls.head.revision);
      controls.head = head({ name: body.name, body: body.body, revision: controls.head.revision + 1, updatedAt: later });
      if (controls.afterPatch) await controls.afterPatch(call);
    } else assert.equal(method, "GET");
    return structuredClone(controls.head);
  };
  const store = createDocumentVersionRestore({ request, onDocumentChanged: () => changed++, onScopeRejected: () => {
    rejected++; options.onScopeRejected?.();
  }, isActive: () => controls.active, timeoutMs: options.timeoutMs ?? 8000 });
  const scope = { memberId: "member-a", workspaceId: "space-a", documentId, revision: controls.head.revision };
  store.setScope(scope); t.after(() => store.dispose());
  const select = async () => { await store.loadHistory(); await store.selectVersion(2); assert.ok(store.getSnapshot().selected); };
  const confirm = async () => { await select(); await store.requestConfirmation(); assert.equal(store.getSnapshot().confirmation, true); };
  return { store, controls, calls, scope, request, select, confirm, changed: () => changed, rejected: () => rejected,
    patches: () => calls.filter(c => c.method === "PATCH") };
}
function privateCleared(store) {
  const s = store.getSnapshot(); assert.equal(s.head, null); assert.equal(s.selected, null); assert.deepEqual(s.versions, []);
  assert.equal(s.nextCursor, null); assert.equal(s.confirmation, false); assert.equal(s.recovery, null); assert.equal(s.canManage, false);
  assert.doesNotMatch(JSON.stringify(s), /Private current|Private historical|synthetic-document/);
}

test("actual SDK history uses documentId/revision and exact getVersion; selection/comparison never writes", async t => {
  const f = fixture(t); assert.equal(f.calls.length, 0); await f.select();
  assert.deepEqual(documentRestoreDifferences(f.store.getSnapshot().head, f.store.getSnapshot().selected), [
    { field: "name", current: head().name, historical: version().name, changed: true },
    { field: "body", current: head().body, historical: version().body, changed: true }
  ]);
  assert.equal(f.calls.filter(c => c.path.endsWith("/versions/2")).length, 1);
  await f.store.selectVersion(3); await f.store.selectVersion(0); assert.equal(f.store.getSnapshot().selected.revision, 2);
  assert.equal(f.patches().length, 0);
});
test("paging forwards original beforeRevision cursor and retains descending immutable summaries", async t => {
  const f = fixture(t, { head: head({ revision: 20 }), versions: Array.from({ length: 10 }, (_, i) => version(20 - i)), cursor: 11 });
  await f.store.loadHistory(); f.controls.versions = [version(10)]; f.controls.cursor = null; await f.store.loadHistory(true);
  assert.equal(f.store.getSnapshot().versions.length, 11);
  assert.equal(f.calls.filter(c => c.path.endsWith("/versions")).at(-1).query.get("beforeRevision"), "11");
  const n = f.calls.length; await f.store.loadHistory(true); assert.equal(f.calls.length, n); assert.equal(f.patches().length, 0);
});
test("one explicit restore emits one original PATCH with only expectedRevision/name/body and proves GET head", async t => {
  const f = fixture(t), originalHistory = structuredClone(f.controls.versions);
  // An export's immutable reference is untouched in this synthetic fixture;
  // real PG/export reference integrity remains the root's acceptance task.
  const exportReference = Object.freeze({ documentId, revision: 1, exportId: "synthetic-export" });
  await f.confirm(); assert.equal(f.patches().length, 0);
  await Promise.all([f.store.confirmRestore(), f.store.confirmRestore()]);
  assert.deepEqual(f.patches().map(c => c.body), [{ expectedRevision: 3, name: version().name, body: version().body }]);
  assert.equal(f.controls.head.revision, 4); assert.equal(f.changed(), 1); assert.equal(f.store.getSnapshot().locked, false);
  assert.deepEqual(f.controls.versions, originalHistory); assert.equal(exportReference.revision, 1);
  const patchIndex = f.calls.findIndex(c => c.method === "PATCH");
  assert.ok(f.calls.slice(patchIndex + 1).some(c => c.path === `/client/documents/${documentId}` && c.method === "GET"));
  privateCleared(f.store);
});
test("identical historical name/body is zero-write no-op, including empty bodies", async t => {
  for (const body of ["", "same\nbody\tvalue"]) {
    const f = fixture(t, { head: head({ name: version().name, body }), versions: [version(2, { body })] });
    await f.select(); assert.equal(f.store.noChange(), true); await f.store.requestConfirmation(); await f.store.confirmRestore();
    assert.equal(f.store.getSnapshot().confirmation, false); assert.equal(f.patches().length, 0); assert.equal(f.controls.head.revision, 3); assert.equal(f.changed(), 0);
  }
});
test("cancel is zero-write and cannot submit a stale confirmation", async t => {
  const f = fixture(t); await f.confirm(); f.store.cancelConfirmation(); await f.store.confirmRestore(); assert.equal(f.patches().length, 0);
});
test("read only can compare but read+manage is required by freshly verified confirmation", async t => {
  const f = fixture(t, { permissions: [READ] }); await f.select(); assert.equal(f.store.getSnapshot().canManage, false);
  await f.store.requestConfirmation(); await f.store.confirmRestore(); assert.equal(f.patches().length, 0);
  const g = fixture(t); await g.confirm(); g.controls.permissions = [READ]; await g.store.confirmRestore();
  privateCleared(g.store); assert.equal(g.rejected(), 1); assert.equal(g.patches().length, 0);
});
test("scope exact shape, actual revision range and UUID identity reject unsafe inputs", async t => {
  const f = fixture(t);
  for (const invalid of [{ ...f.scope, revision: 201 }, { ...f.scope, revision: 0 }, { ...f.scope, documentId: "agent-version-id" },
    { ...f.scope, memberId: "../other" }, { ...f.scope, owner: "other" }, undefined]) assert.throws(() => f.store.setScope(invalid));
  let accessed = false; const invalid = { ...f.scope }; Object.defineProperty(invalid, "memberId", { enumerable: true, get() { accessed = true; return "member-a"; } });
  assert.throws(() => f.store.setScope(invalid)); assert.equal(accessed, false);
});
test("actual compiled SDK rejects malformed, foreign, oversized or reordered history and content", async t => {
  const pagePatches = [p => { p.items[0].documentId = otherId; }, p => { p.items[0].owner = "foreign"; }, p => { p.items[0].revision = 201; },
    p => { p.items.reverse(); }, p => { p.nextCursor = 1; }, p => { p.items[0].createdAt = "2026-11-08"; }, p => { p.items[0].name = " bad "; },
    p => { p.items[0].body = "unexpected body"; }, p => { p.extra = true; }];
  for (const mutate of pagePatches) {
    const f = fixture(t); f.controls.override = c => { if (!c.path.endsWith("/versions")) return; const p = { items: f.controls.versions.map(summary), nextCursor: null }; mutate(p); return p; };
    await f.store.loadHistory(); privateCleared(f.store); assert.ok(f.store.getSnapshot().issue); assert.equal(f.patches().length, 0);
  }
  for (const patch of [{ documentId: otherId }, { revision: 1 }, { id: "agent-version-id" }, { body: "\0" }, { body: "x".repeat(65537) }, { name: "\ud800" }]) {
    const f = fixture(t); await f.store.loadHistory(); f.controls.override = c => c.path.endsWith("/versions/2") ? version(2, patch) : undefined;
    await f.store.selectVersion(2); privateCleared(f.store); assert.equal(f.patches().length, 0);
  }
});
test("malformed head/getVersion summary mismatch never offers restore", async t => {
  for (const patch of [{ id: otherId }, { revision: 201 }, { code: "Invalid Code" }, { owner: "foreign" }, { updatedAt: "2020-01-01T00:00:00.000Z" }]) {
    const f = fixture(t); f.controls.head = head(patch);
    await f.store.loadHistory(); privateCleared(f.store);
  }
  const f = fixture(t); await f.store.loadHistory(); f.controls.versions[1].name = "Different immutable summary";
  await f.store.selectVersion(2); privateCleared(f.store);
});
test("strict me/context shape and exact lowercase 64hex sessionGeneration are mandatory", async t => {
  for (const value of [undefined, "", "session-a", "A".repeat(64), "a".repeat(63), "a".repeat(65)]) {
    const f = fixture(t, { sessionGeneration: value }); await f.store.loadHistory(); privateCleared(f.store); assert.ok(f.store.getSnapshot().issue);
  }
  for (const [path, result] of [["/client/auth/me", { id: "member-a" }], ["/client/auth/me", { id: "member-a", email: null, nickname: "n", token: "secret" }],
    ["/client/workspaces/context", { workspaceId: "space-a" }]]) {
    const f = fixture(t); f.controls.override = c => c.path === path ? result : undefined; await f.store.loadHistory(); privateCleared(f.store); assert.ok(f.store.getSnapshot().issue);
  }
});
test("current identity/space/role/permissions/session/revision changes during history clear private values", async t => {
  for (const mutate of [c => { c.memberId = "member-b"; }, c => { c.workspaceId = "space-b"; }, c => { c.roleId = "role-b"; }, c => { c.roleCode = "reader"; },
    c => { c.permissions = [READ]; }, c => { c.sessionGeneration = "b".repeat(64); }, c => { c.head.revision++; }]) {
    const f = fixture(t); f.controls.override = call => { if (call.path.endsWith("/versions")) { mutate(f.controls); return { items: [summary(version())], nextCursor: null }; } };
    await f.store.loadHistory(); privateCleared(f.store); assert.equal(f.patches().length, 0);
  }
});
test("401/403/404 actions synchronously clear child before notifying original parent", async t => {
  for (const status of [401, 403, 404]) {
    const f = fixture(t, { onScopeRejected: () => privateCleared(f.store) }); await f.confirm();
    f.controls.override = () => { throw { status, message: "Private server body" }; };
    await f.store.confirmRestore(); assert.equal(f.rejected(), 1); assert.equal(f.changed(), 0); assert.equal(f.patches().length, 0);
  }
});
test("pre-PATCH CAS/revision conflict preserves original editor by sending no callback or write", async t => {
  const f = fixture(t); await f.confirm(); f.controls.head = head({ revision: 4, name: "Human edit", body: "Human draft saved" });
  await f.store.confirmRestore(); assert.equal(f.patches().length, 0); assert.equal(f.controls.head.body, "Human draft saved");
  assert.equal(f.changed(), 0); assert.equal(f.rejected(), 0); assert.equal(f.store.getSnapshot().locked, false); privateCleared(f.store);
});
test("history cap refuses locally before PATCH rather than fabricating a 201st version", async t => {
  const f = fixture(t, { head: head({ revision: 200 }) }); await f.confirm(); await f.store.confirmRestore();
  assert.equal(f.patches().length, 0); assert.equal(f.changed(), 0); assert.equal(f.store.getSnapshot().issue.status, 409);
});
test("every attempted PATCH error (including committed 4xx) preserves opaque lock until original read and fresh ACK", async t => {
  for (const status of [400, 401, 403, 404, 409, 503]) {
    const f = fixture(t); await f.confirm(); f.controls.afterPatch = () => { throw { status, message: "Private error" }; };
    await f.store.confirmRestore(); assert.equal(f.controls.head.revision, 4); privateCleared(f.store); assert.equal(f.store.getSnapshot().locked, true);
    assert.equal(f.changed(), 0); await f.store.loadHistory(); await f.store.confirmRestore(); assert.equal(f.patches().length, 1);
    await f.store.readRecovery(); assert.equal(f.store.getSnapshot().recovery.revision, 4); assert.equal(f.changed(), 0);
    const auths = f.calls.filter(c => c.path === "/client/auth/me").length; await f.store.acknowledgeRecovery();
    assert.ok(f.calls.filter(c => c.path === "/client/auth/me").length > auths); assert.equal(f.store.getSnapshot().locked, false);
    assert.equal(f.patches().length, 1); assert.equal(f.changed(), 1);
  }
});
test("actual PATCH CAS refusal retains old head and lock, requires explicit read/ACK and never overwrites human content", async t => {
  const f = fixture(t); await f.confirm(); f.controls.beforePatch = () => { f.controls.head = head({ revision: 4, name: "Human", body: "Concurrent human content" }); throw { status: 409 }; };
  await f.store.confirmRestore(); assert.equal(f.store.getSnapshot().locked, true); assert.equal(f.changed(), 0);
  await f.store.readRecovery(); assert.equal(f.store.getSnapshot().recovery.body, "Concurrent human content"); await f.store.acknowledgeRecovery();
  assert.equal(f.patches().length, 1); assert.equal(f.controls.head.body, "Concurrent human content");
});
test("unknown lock survives null/account/workspace/document/revision change, suspension and teardown", async t => {
  const f = fixture(t); await f.confirm(); f.controls.afterPatch = () => { throw Error(); }; await f.store.confirmRestore();
  for (const scope of [null, { ...f.scope, memberId: "member-b" }, { ...f.scope, workspaceId: "space-b" }, { ...f.scope, documentId: otherId }]) {
    f.store.setScope(scope); const n = f.calls.length; await f.store.readRecovery(); await f.store.acknowledgeRecovery(); await f.store.loadHistory();
    assert.equal(f.calls.length, n); assert.equal(f.store.getSnapshot().locked, true); privateCleared(f.store);
  }
  f.store.setScope({ ...f.scope, revision: 4 }); await f.store.readRecovery(); assert.equal(f.store.getSnapshot().recovery.revision, 4);
  f.store.suspend(); privateCleared(f.store); assert.equal(f.store.getSnapshot().locked, true);
  f.store.dispose(); privateCleared(f.store); assert.equal(f.store.getSnapshot().locked, true);
  f.store.setScope(f.scope); await f.store.readRecovery(); assert.equal(f.store.getSnapshot().recovery.revision, 4);
});
test("a new role/session/permissions or owner can never read old recovery body or release its lock", async t => {
  for (const mutate of [c => { c.memberId = "member-b"; }, c => { c.workspaceId = "space-b"; }, c => { c.roleId = "role-b"; },
    c => { c.roleCode = "new-role"; }, c => { c.sessionGeneration = "b".repeat(64); }, c => { c.permissions = [READ]; }]) {
    const f = fixture(t); await f.confirm(); f.controls.afterPatch = () => { throw Error(); }; await f.store.confirmRestore(); f.store.setScope(null); f.store.setScope(f.scope);
    mutate(f.controls); const n = f.calls.length; await f.store.readRecovery(); await f.store.acknowledgeRecovery();
    assert.ok(f.calls.slice(n).every(c => c.path === "/client/auth/me" || c.path === "/client/workspaces/context"));
    privateCleared(f.store); assert.equal(f.store.getSnapshot().locked, true); assert.equal(f.changed(), 0); assert.equal(f.patches().length, 1);
  }
});
test("ACK without prior recovery read, after scope=null, head change or auth change cannot unlock", async t => {
  for (const mutate of [f => { f.controls.head.revision++; }, f => { f.controls.sessionGeneration = "b".repeat(64); }, f => { f.controls.permissions = [READ]; },
    f => { f.store.setScope(null); f.store.setScope(f.scope); }, f => { f.controls.head.body = "Changed without revision"; }]) {
    const f = fixture(t); await f.confirm(); f.controls.afterPatch = () => { throw Error(); }; await f.store.confirmRestore();
    await f.store.acknowledgeRecovery(); assert.equal(f.store.getSnapshot().locked, true);
    await f.store.readRecovery(); mutate(f); await f.store.acknowledgeRecovery(); assert.equal(f.store.getSnapshot().locked, true); assert.equal(f.changed(), 0);
  }
});
test("recovery cannot accept a head older than the attempted expectedRevision", async t => {
  const f = fixture(t); await f.confirm(); f.controls.afterPatch = () => { throw Error(); }; await f.store.confirmRestore();
  f.controls.head = head({ revision: 2 }); await f.store.readRecovery(); privateCleared(f.store);
  assert.equal(f.store.getSnapshot().locked, true); assert.equal(f.changed(), 0);
});
test("late post-PATCH permission/session loss and malformed result never claim success or inject data", async t => {
  for (const mutate of [c => { c.permissions = [READ]; }, c => { c.sessionGeneration = "b".repeat(64); }, c => { c.head.code = "changed-code"; },
    c => { c.head.revision = 3; }, c => { c.head.id = otherId; }, c => { c.head.body = "wrong body"; }]) {
    const f = fixture(t); await f.confirm(); f.controls.afterPatch = () => mutate(f.controls); await f.store.confirmRestore();
    privateCleared(f.store); assert.equal(f.store.getSnapshot().locked, true); assert.equal(f.changed(), 0); assert.equal(f.patches().length, 1);
  }
});
test("auth is checked after head GET as well as before it", async t => {
  const f = fixture(t); await f.confirm(); let seen = 0;
  f.controls.override = c => { if (c.method === "GET" && c.path === `/client/documents/${documentId}` && ++seen === 1) { f.controls.sessionGeneration = "b".repeat(64); return head(); } };
  await f.store.confirmRestore(); privateCleared(f.store); assert.equal(f.patches().length, 0); assert.equal(f.rejected(), 1);
});
test("null/suspend/hidden-style/unmount/head-change fences late history even if transport ignores abort", async t => {
  for (const fence of [f => f.store.setScope(null), f => f.store.suspend(), f => { f.controls.active = false; f.store.suspend(); },
    f => f.store.dispose(), f => f.store.setScope({ ...f.scope, revision: 4 })]) {
    const f = fixture(t), wait = deferred(); f.controls.override = c => c.path.endsWith("/versions") ? wait.promise : undefined;
    const pending = f.store.loadHistory(); await until(() => f.calls.some(c => c.path.endsWith("/versions"))); fence(f);
    await pending; wait.resolve({ items: [summary(version())], nextCursor: null }); await tick(); privateCleared(f.store); assert.equal(f.changed(), 0);
  }
});
test("attempted PATCH abort/blur/hidden/unmount never drops lock and late success never invokes callback", async t => {
  for (const fence of [f => f.store.setScope(null), f => f.store.suspend(), f => { f.controls.active = false; f.store.suspend(); }, f => f.store.dispose()]) {
    const f = fixture(t), wait = deferred(); await f.confirm(); f.controls.afterPatch = () => wait.promise;
    const pending = f.store.confirmRestore(); await until(() => f.patches().length); fence(f); await pending;
    assert.equal(f.store.getSnapshot().locked, true); privateCleared(f.store); wait.resolve(); await tick();
    assert.equal(f.changed(), 0); assert.equal(f.patches().length, 1); privateCleared(f.store);
  }
});
test("bounded ignored PATCH timeout retains uncertainty, forbids duplicate submissions and ignores later completion", async t => {
  const f = fixture(t, { timeoutMs: 30 }), wait = deferred(); await f.confirm(); f.controls.afterPatch = () => wait.promise;
  const keepAlive = setTimeout(() => {}, 1000); t.after(() => clearTimeout(keepAlive)); await f.store.confirmRestore();
  assert.equal(f.store.getSnapshot().locked, true); await f.store.confirmRestore(); assert.equal(f.patches().length, 1);
  wait.resolve(); await tick(); privateCleared(f.store); assert.equal(f.changed(), 0);
});
test("changing request fences pending work while preserving uncertain lock", async t => {
  const f = fixture(t); await f.confirm(); f.controls.afterPatch = () => { throw Error(); }; await f.store.confirmRestore();
  await f.store.readRecovery(); f.store.setCallbacks({ request: async (...args) => f.request(...args), onDocumentChanged: () => assert.fail("old result") });
  privateCleared(f.store); assert.equal(f.store.getSnapshot().locked, true); await f.store.acknowledgeRecovery(); assert.equal(f.store.getSnapshot().locked, true);
});
test("safe actionable messages never expose arbitrary server text and actual SDK rejects broad DTO payload", async () => {
  for (const status of [400, 401, 403, 404, 409, 503]) assert.doesNotMatch(documentRestoreIssue({ status, message: "PRIVATE" }, true).message, /PRIVATE/);
  let writes = 0; const sdk = createPersonalDocumentsClient(async () => { writes++; return head(); });
  await assert.rejects(sdk.update("space-a", documentId, { expectedRevision: 3, name: "n", body: "b", revision: 2 }), e => e.status === 400);
  assert.equal(writes, 0);
});
test("offline AntD render escapes text and masks changed/null scope before effects; native remains NOT_RUN", async t => {
  const f = fixture(t, { versions: [version(2, { body: "<script>synthetic()</script>" })] }); await f.select();
  const require = createRequire(resolve("apps/web/package.json")), React = require("react"), { renderToStaticMarkup } = require("react-dom/server");
  const path = "apps/web/app/components/client-document-restore-panel.tsx";
  const compiled = ts.transpileModule(readFileSync(path, "utf8"), { fileName: path, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const exports = {}, actualRequire = createRequire(resolve(path)), effects = [];
  const harness = { ...React, useState: () => [f.store], useId: () => "restore-title", useRef: value => ({ current: value }), useEffect: fn => { effects.push(fn); },
    useLayoutEffect: () => {}, useSyncExternalStore: (_subscribe, snapshot) => snapshot() };
  new Function("require", "exports", compiled)(name => name === "react" ? harness : name === "./admin-api" ? { adminTheme: {} } :
    name === "./client-document-restore-state.mjs" ? { createDocumentVersionRestore, documentRestoreDifferences } : actualRequire(name), exports);
  const render = scope => renderToStaticMarkup(React.createElement(exports.ClientDocumentVersionRestorePanel, { request: f.request, scope, onDocumentChanged: () => {} }));
  const html = render(f.scope); assert.match(html, /aria-labelledby="restore-title"/); assert.match(html, /tabindex="0"/);
  assert.match(html, /minmax\(min\(100%, 18rem\), 1fr\)/); assert.match(html, /&lt;script&gt;/); assert.doesNotMatch(html, /<script>synthetic/);
  assert.equal(render(null), ""); assert.doesNotMatch(render({ ...f.scope, memberId: "member-b" }), /Private current|Private historical|synthetic\(\)/);
  await f.store.requestConfirmation(); f.controls.afterPatch = () => { throw { status: 404 }; }; await f.store.confirmRestore();
  await f.store.readRecovery(); assert.match(render(f.scope), /Private historical/);
  const hiddenRecovery = render(null); assert.match(hiddenRecovery, /前次恢复结果尚未确认/); assert.doesNotMatch(hiddenRecovery, /Private current|Private historical|synthetic\(\)/);
  assert.doesNotMatch(render({ ...f.scope, memberId: "member-b" }), /Private current|Private historical|synthetic\(\)/);
  // Return to an ordinary comparison for the synthetic visibility listener check.
  await f.store.acknowledgeRecovery(); f.controls.head = head(); f.controls.afterPatch = null; await f.select();
  const source = readFileSync(path, "utf8"); assert.match(source, /document.hidden/); assert.match(source, /trigger.current\?\.focus\(\)/);
  assert.doesNotMatch(source, /localStorage|sessionStorage|dangerouslySetInnerHTML|setInterval|window.location/);
  // Synthetic listener wiring only: this is not a native visibility test.
  const oldWindow = globalThis.window, oldDocument = globalThis.document, handlers = new Map();
  globalThis.window = { addEventListener: (name, fn) => handlers.set(name, fn), removeEventListener: name => handlers.delete(name) };
  globalThis.document = { hidden: false, addEventListener: (name, fn) => handlers.set(name, fn), removeEventListener: name => handlers.delete(name) };
  try {
    const cleanup = effects[0](); handlers.get("visibilitychange")(); assert.ok(f.store.getSnapshot().selected);
    globalThis.document.hidden = true; handlers.get("visibilitychange")(); privateCleared(f.store);
    cleanup(); assert.equal(handlers.size, 0);
  } finally { globalThis.window = oldWindow; globalThis.document = oldDocument; }
});
