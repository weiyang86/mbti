import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import ts from "typescript";
import * as sdk from "../../packages/sdk/dist/index.mjs";
import * as restoreModule from "../../apps/web/app/components/client-document-restore-state.mjs";

// Offline actual guarded callbacks + original manager/SDK/state composition.
// No HTTP, PG, browser/native, real visibility, or export-reference acceptance.
const require = createRequire(resolve("apps/web/package.json")), React = require("react");
const panel = () => null;
function load(path, overrides = {}) {
  const exports = {}, local = createRequire(resolve(path));
  const compiled = ts.transpileModule(readFileSync(path, "utf8"), { fileName: path, compilerOptions: { module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  new Function("require", "exports", compiled)(name => name in overrides ? overrides[name] : name === "@aij/sdk" ? sdk :
    name === "@aij/ui" ? { PageHeading: () => null } : name === "./admin-api" ? { adminTheme: {} } :
    name === "./client-document-restore-state.mjs" ? restoreModule : name === "./client-document-restore-panel" ? { ClientDocumentVersionRestorePanel: panel } :
    name === "./client-document-export-panel" ? { ClientDocumentExportPanel: () => null } :
    name === "./client-document-sections-panel" ? { ClientDocumentSectionsPanel: () => null } : local(name), exports);
  return exports;
}
const { createDocumentAccess } = load("apps/web/app/components/client-document-access.ts");
const managerModule = load("apps/web/app/components/client-document-manager.tsx");
const READ = "workspace.documents.read", MANAGE = "workspace.documents.manage", at = "2026-11-08T00:00:00.000Z";
const documentId = "3a07234c-b0fe-4e48-b187-ea14d9ac04a1";
const scope = (patch = {}) => ({ memberId: "member-a", workspaceId: "space-a", roleId: "role-a", sessionKey: "a".repeat(64), validationKey: "original-role-permissions", permissions: [READ, MANAGE], ...patch });
const head = (patch = {}) => ({ id: documentId, code: "synthetic-document", revision: 3, name: "PRIVATE saved name", body: "PRIVATE saved body", createdAt: at, updatedAt: at, ...patch });
const old = { documentId, revision: 2, name: "PRIVATE historical name", body: "PRIVATE historical body", createdAt: at };
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function until(fn) { for (let i = 0; i < 300; i++) { if (fn()) return; await tick(); } assert.fail("offline boundary not reached"); }
function cleared(f) {
  const m = f.manager.getSnapshot(), r = f.restore.getSnapshot();
  assert.equal(m.detail, null); assert.equal(m.body, ""); assert.equal(m.name, ""); assert.deepEqual(m.history, []); assert.equal(m.historical, null);
  assert.equal(r.head, null); assert.equal(r.selected, null); assert.equal(r.confirmation, false); assert.equal(r.recovery, null);
  assert.doesNotMatch(JSON.stringify([m, r]), /PRIVATE/);
}
function fixture(t, options = {}) {
  const controls = { verified: scope(), document: head(), override: null, beforePatch: null, afterPatch: null, ...options };
  const calls = [], phases = []; let failures = 0;
  const raw = async (path, init = {}) => {
    phases.push("raw"); const call = { path, init, method: init.method ?? "GET", body: init.body ? JSON.parse(init.body) : null }; calls.push(call);
    if (controls.override) { const result = await controls.override(call); if (result !== undefined) return result; }
    if (path === "/client/auth/me") return { id: controls.verified.memberId, email: null, nickname: "Synthetic" };
    if (path === "/client/workspaces/context") return { workspaceId: controls.verified.workspaceId, workspaceCode: "synthetic-space", workspaceName: "Synthetic space",
      roleId: controls.verified.roleId, roleCode: "owner", permissions: [...controls.verified.permissions], sessionGeneration: controls.verified.sessionKey };
    if (path.includes("/versions?")) return { items: [{ documentId, revision: 2, name: old.name, createdAt: at }], nextCursor: null };
    if (path.endsWith("/versions/2")) return { ...old };
    if (path === "/client/documents?limit=20") return { items: [], nextCursor: null };
    assert.equal(path, `/client/documents/${documentId}`);
    if (call.method === "PATCH") {
      if (controls.beforePatch) await controls.beforePatch(call);
      assert.equal(call.body.expectedRevision, controls.document.revision);
      controls.document = head({ name: call.body.name, body: call.body.body, revision: controls.document.revision + 1 });
      if (controls.afterPatch) await controls.afterPatch(call);
    }
    return { ...controls.document };
  };
  const access = createDocumentAccess(raw);
  let composition;
  const failure = () => { failures++; access.clear(); cleared(composition); };
  access.setHandlers(async () => { phases.push("verify"); return controls.verified; }, failure);
  access.setScope(controls.verified);
  composition = managerModule.createDocumentComposition({ api: access.api, request: access.request, onAccessFailure: failure, isActive: () => true });
  const { manager, restore } = composition;
  const unsubscribe = access.subscribeInvalidation(composition.conceal);
  manager.setScope(controls.verified);
  t.after(() => { unsubscribe(); restore.dispose(); manager.conceal(); });
  const view = async () => { await manager.open(documentId); manager.viewSaved(); assert.equal(manager.getSnapshot().editing, false); };
  const select = async () => { await view(); await restore.loadHistory(); await restore.selectVersion(2); assert.ok(restore.getSnapshot().selected); };
  const confirm = async () => { await select(); await restore.requestConfirmation(); assert.equal(restore.getSnapshot().confirmation, true); };
  return { ...composition, access, controls, calls, phases, raw, view, select, confirm, failure, failures: () => failures };
}

test("guarded outlet allows ONLY exact GET me without workspace and verifies before AND after", async t => {
  const f = fixture(t); await f.access.request("/client/auth/me"); assert.deepEqual(f.phases, ["verify", "raw", "verify"]);
  for (const [path, init] of [["/client/auth/me", { method: "POST" }], ["/client/auth/me", { method: "HEAD" }], ["/client/auth/me?x=1", {}],
    ["/client/workspaces/context", {}], [`/client/documents/${documentId}`, {}], ["/client/auth/me", { workspaceId: "other" }]]) {
    const n = f.calls.length; await assert.rejects(f.access.request(path, init), e => e.status === 403); assert.equal(f.calls.length, n);
  }
  await f.access.request("/client/workspaces/context", { workspaceId: "space-a" }); assert.equal(f.calls.length, 2);
});
test("before-request current role/session/validation/permission loss blocks raw and clears both stores synchronously", async t => {
  for (const patch of [{ roleId: "role-b" }, { sessionKey: "b".repeat(64) }, { validationKey: "changed" }, { permissions: [READ] }]) {
    const f = fixture(t); await f.select(); f.controls.verified = scope(patch); const n = f.calls.length;
    await f.restore.requestConfirmation(); cleared(f); assert.equal(f.calls.length, n); assert.equal(f.failures(), 1);
  }
});
test("after-read revocation rejects already received body, clears child AND original saved parent, never calls raw PATCH", async t => {
  const f = fixture(t); await f.select(); f.controls.override = call => { if (call.path === `/client/documents/${documentId}`) { f.controls.verified = scope({ permissions: [READ] }); return head(); } };
  await f.restore.requestConfirmation(); cleared(f); assert.equal(f.failures(), 1); assert.equal(f.calls.filter(c => c.method === "PATCH").length, 0);
});
test("current 401/403/404 refusal reaches existing failure owner and synchronously conceals both", async t => {
  for (const status of [401, 403, 404]) {
    const f = fixture(t); await f.select(); f.controls.override = () => { throw new sdk.ClientRequestFailure(status); };
    await f.restore.requestConfirmation(); cleared(f); assert.equal(f.failures(), 1);
  }
});
test("a child's successful-but-foreign current principal clears both stores BEFORE invoking original parent failure owner", async t => {
  const f = fixture(t); await f.select(); let rejected = 0;
  f.setBindings({ api: f.access.api, request: f.access.request, onAccessFailure: error => { cleared(f); rejected++; assert.equal(error.status, 403); f.access.clear(); } });
  f.controls.override = c => c.path === "/client/auth/me" ? { id: "member-b", email: null, nickname: "Other" } : undefined;
  await f.restore.requestConfirmation(); cleared(f); assert.equal(rejected, 1);
});
test("late old-generation binary is zeroed and refusal never clears a new owner", async () => {
  const wait = deferred(), bytes = new Uint8Array([1, 2, 3]); let failures = 0;
  const access = createDocumentAccess(async () => wait.promise); let verified = scope();
  access.setHandlers(async () => verified, () => failures++); access.setScope(verified);
  const pending = access.request("/client/export", { workspaceId: "space-a", responseKind: "binary" }); await tick();
  access.clear(); verified = scope({ memberId: "member-b", workspaceId: "space-b" }); access.setScope(verified);
  wait.resolve({ bytes }); await assert.rejects(pending, e => e.status === 403);
  assert.deepEqual([...bytes], [0, 0, 0]); assert.equal(failures, 0); assert.equal(access.getScope().memberId, "member-b");
});
test("saved-only view is reachable after open/save; dirty edits never silently disappear and view allows explicit edit-again", async t => {
  const f = fixture(t); await f.manager.open(documentId); assert.equal(f.manager.canViewSaved(), true);
  f.manager.draft("body", "PRIVATE unsaved"); f.manager.viewSaved(); assert.equal(f.manager.getSnapshot().editing, true); assert.equal(f.manager.getSnapshot().body, "PRIVATE unsaved");
  assert.equal(managerModule.savedDocumentRestoreScope(f.manager.getSnapshot()), null); await f.manager.save();
  assert.equal(f.manager.canViewSaved(), true); f.manager.viewSaved(); assert.equal(f.manager.getSnapshot().editing, false);
  assert.equal(managerModule.savedDocumentRestoreScope(f.manager.getSnapshot()).revision, 4);
  f.manager.editAgain(); assert.equal(f.manager.getSnapshot().editing, true); assert.equal(f.restore.getSnapshot().head, null);
  f.manager.draft("name", "PRIVATE unsaved name"); assert.equal(f.manager.canViewSaved(), false);
  await f.manager.open(documentId); assert.equal(f.manager.getSnapshot().name, "PRIVATE saved name");
});
test("history selection, delete dialog, busy, CAS conflict and parent unknown write block exit-to-restore", async t => {
  const f = fixture(t); await f.manager.open(documentId); await f.manager.history(); await f.manager.version(2); f.manager.viewSaved(); assert.equal(f.manager.getSnapshot().editing, true);
  f.manager.clearHistory(); assert.equal(f.manager.canViewSaved(), true); f.manager.askDelete(); assert.equal(f.manager.canViewSaved(), false); f.manager.dismissDelete();
  const wait = deferred(); f.controls.override = c => c.path === `/client/documents/${documentId}` ? wait.promise : undefined;
  const pending = f.manager.open(documentId); assert.equal(f.manager.canViewSaved(), false); wait.resolve(head()); await pending; f.controls.override = null;
  f.manager.draft("body", "changed"); f.controls.beforePatch = () => { throw new sdk.ClientRequestFailure(409); }; await f.manager.save();
  assert.equal(f.manager.canViewSaved(), false); assert.equal(managerModule.savedDocumentRestoreScope(f.manager.getSnapshot()), null);
  await f.manager.open(documentId); f.manager.draft("body", "again"); f.controls.beforePatch = () => { throw new sdk.ClientRequestFailure(503); }; await f.manager.save();
  assert.ok(f.manager.getSnapshot().recovery); assert.equal(f.manager.canViewSaved(), false); const n = f.calls.length; await f.restore.loadHistory(); assert.equal(f.calls.length, n);
});
test("read-only role can enter saved comparison but cannot edit or confirm restore", async t => {
  const f = fixture(t, { verified: scope({ permissions: [READ] }) }); await f.select(); f.manager.editAgain();
  assert.equal(f.manager.getSnapshot().editing, false); assert.equal(f.restore.getSnapshot().canManage, false);
  await f.restore.requestConfirmation(); assert.equal(f.calls.filter(c => c.method === "PATCH").length, 0);
});
test("successful child restore reloads current document through original guarded SDK and preserves saved view", async t => {
  const f = fixture(t); await f.confirm(); await f.restore.confirmRestore(); await until(() => !f.manager.getSnapshot().busy && f.manager.getSnapshot().detail?.revision === 4);
  assert.equal(f.manager.getSnapshot().editing, false); assert.equal(f.manager.getSnapshot().body, old.body);
  assert.deepEqual(f.calls.filter(c => c.method === "PATCH").map(c => c.body), [{ expectedRevision: 3, name: old.name, body: old.body }]);
  assert.equal(f.phases.length, f.calls.length * 3); assert.ok(f.phases.every((p, i) => p === ["verify", "raw", "verify"][i % 3]));
});
test("same restore confirmation/unknown lock blocks parent mutations; null/view navigation never creates another ledger", async t => {
  const f = fixture(t); await f.confirm(); const n = f.calls.length;
  f.manager.create(); f.manager.editAgain(); f.manager.askDelete(); await f.manager.save(); await f.manager.remove(); await f.manager.open(documentId);
  assert.equal(f.calls.length, n); assert.equal(f.manager.getSnapshot().editing, false); assert.equal(f.manager.getSnapshot().recovery, null);
  f.controls.afterPatch = () => { throw new sdk.ClientRequestFailure(503); }; await f.restore.confirmRestore(); assert.equal(f.restore.getSnapshot().locked, true);
  f.manager.close(); assert.equal(f.restore.getSnapshot().locked, true); assert.equal(f.restore.getSnapshot().selected, null);
  await f.manager.open(documentId); assert.equal(f.manager.getSnapshot().editing, false); f.manager.editAgain(); f.manager.create();
  assert.equal(f.manager.getSnapshot().editing, false); assert.equal(f.manager.getSnapshot().recovery, null);
  await f.restore.readRecovery(); assert.equal(f.restore.getSnapshot().recovery.revision, 4); await f.restore.acknowledgeRecovery();
  await until(() => !f.manager.getSnapshot().busy); assert.equal(f.restore.getSnapshot().locked, false); f.manager.editAgain(); assert.equal(f.manager.getSnapshot().editing, true);
});
test("post-commit access loss keeps same opaque restore lock across synchronous invalidation and null", async t => {
  const f = fixture(t); await f.confirm(); f.controls.afterPatch = () => { f.controls.verified = scope({ permissions: [READ] }); };
  await f.restore.confirmRestore(); cleared(f); assert.equal(f.failures(), 1); assert.equal(f.restore.getSnapshot().locked, true);
  f.manager.setScope(null); assert.equal(f.restore.getSnapshot().locked, true); f.manager.create(); assert.equal(f.manager.getSnapshot().editing, false);
});
test("access clear and same-document role generation change synchronously erase both private stores", async t => {
  const f = fixture(t); await f.select(); f.access.clear(); cleared(f);
  f.access.setScope(scope()); f.manager.setScope(scope()); await f.select();
  f.access.setScope(scope({ roleId: "role-b", validationKey: "changed" })); cleared(f);
});
test("actual manager render masks old identity before effects and always composes exactly one stable shared panel", async t => {
  const f = fixture(t); await f.view();
  function render(propsScope) {
    let index = 0;
    const hooks = { ...React, useState: () => [index++ === 0 ? f : null, () => {}], useRef: value => ({ current: value }), useEffect: () => {}, useLayoutEffect: () => {},
      useSyncExternalStore: (_subscribe, snapshot) => snapshot() };
    const component = load("apps/web/app/components/client-document-manager.tsx", { react: hooks }).ClientDocumentManager;
    return component({ api: f.access.api, request: f.access.request, subscribeInvalidation: f.access.subscribeInvalidation, exportsApi: f.access.exportsApi, scope: propsScope, revalidate: async () => propsScope });
  }
  function flatten(value) { if (!value || typeof value !== "object") return []; if (Array.isArray(value)) return value.flatMap(flatten); return [value, ...flatten(value.props?.children)]; }
  for (const value of [scope(), null, scope({ sessionKey: "b".repeat(64) })]) {
    const tree = render(value), all = flatten(tree), panels = all.filter(n => n.type === panel);
    assert.equal(panels.length, 1); assert.equal(panels[0].key, null); assert.equal(panels[0].props.controller, f.restore);
    if (value?.sessionKey === scope().sessionKey) assert.equal(panels[0].props.scope.documentId, documentId);
    else { assert.equal(panels[0].props.scope, null); assert.doesNotMatch(JSON.stringify(tree), /PRIVATE/); }
  }
});
test("actual panel consumes the manager's shared controller without constructing another restore store", async t => {
  const f = fixture(t); await f.select();
  const hooks = { ...React, useState: init => [typeof init === "function" ? init() : init], useRef: value => ({ current: value }), useId: () => "shared-panel",
    useEffect: () => {}, useLayoutEffect: () => {}, useSyncExternalStore: (subscribe, snapshot) => { assert.equal(subscribe, f.restore.subscribe); return snapshot(); } };
  const component = load("apps/web/app/components/client-document-restore-panel.tsx", { react: hooks,
    "./client-document-restore-state.mjs": { ...restoreModule, createDocumentVersionRestore: () => assert.fail("second restore ledger") } }).ClientDocumentVersionRestorePanel;
  assert.ok(component({ controller: f.restore, request: f.access.request, scope: managerModule.savedDocumentRestoreScope(f.manager.getSnapshot()),
    onDocumentChanged: f.onDocumentChanged, onScopeRejected: f.onScopeRejected }));
});
test("actual parent blur/hidden/unmount handlers synchronously conceal both stores and retain the shared unknown lock (synthetic only)", async t => {
  const f = fixture(t); await f.confirm(); f.controls.afterPatch = () => { throw new sdk.ClientRequestFailure(503); }; await f.restore.confirmRestore();
  const effects = []; let index = 0;
  const hooks = { ...React, useState: () => [index++ === 0 ? f : null, () => {}], useRef: value => ({ current: value }), useEffect: fn => { effects.push(fn); }, useLayoutEffect: () => {},
    useSyncExternalStore: (_subscribe, snapshot) => snapshot() };
  const component = load("apps/web/app/components/client-document-manager.tsx", { react: hooks }).ClientDocumentManager;
  component({ api: f.access.api, request: f.access.request, subscribeInvalidation: f.access.subscribeInvalidation, exportsApi: f.access.exportsApi, scope: scope(), revalidate: async () => scope() });
  const oldWindow = globalThis.window, oldDocument = globalThis.document, handlers = new Map();
  globalThis.window = { addEventListener: (name, fn) => handlers.set(name, fn), removeEventListener: name => handlers.delete(name) };
  globalThis.document = { visibilityState: "hidden", addEventListener: (name, fn) => handlers.set(name, fn), removeEventListener: name => handlers.delete(name) };
  try {
    const cleanup = effects[1](); handlers.get("blur")(); cleared(f); assert.equal(f.restore.getSnapshot().locked, true);
    f.manager.setScope(scope()); await f.manager.open(documentId); await f.restore.readRecovery(); assert.ok(f.restore.getSnapshot().recovery);
    handlers.get("visibilitychange")(); cleared(f); assert.equal(f.restore.getSnapshot().locked, true);
    f.manager.setScope(scope()); await f.manager.open(documentId); await f.restore.readRecovery(); cleanup(); cleared(f);
    assert.equal(f.restore.getSnapshot().locked, true); assert.equal(handlers.size, 0);
  } finally { globalThis.window = oldWindow; globalThis.document = oldDocument; }
});
test("actual library passes guarded request and invalidation subscription, never raw transport", async () => {
  let rawCalls = 0; const raw = async () => { rawCalls++; throw Error("No offline network"); };
  const hooks = { ...React, useState: value => [typeof value === "function" ? value() : value, () => {}], useMemo: fn => fn(), useCallback: fn => fn, useEffect: () => {} };
  const manager = () => null;
  const library = load("apps/web/app/components/client-document-library.tsx", { react: hooks, "next/navigation": { useRouter: () => ({ replace: () => {} }) },
    "./client-api.mjs": { clientApi: raw }, "./client-document-access": { createDocumentAccess }, "./client-document-manager": { ClientDocumentManager: manager } });
  const tree = library.ClientDocumentLibrary(); const children = tree.props.children.props.children;
  const child = children.find(value => value?.type === manager); assert.ok(child); assert.notEqual(child.props.request, raw); assert.equal(typeof child.props.subscribeInvalidation, "function");
  await assert.rejects(child.props.request("/client/auth/me"), e => e.status === 403); assert.equal(rawCalls, 0);
});
