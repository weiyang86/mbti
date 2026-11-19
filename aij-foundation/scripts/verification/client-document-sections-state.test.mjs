import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import ts from "typescript";
import { createPersonalDocumentsClient } from "../../packages/sdk/dist/index.mjs";
import { createDocumentSectionsEditor } from "../../apps/web/app/components/client-document-sections-state.mjs";

// OFFLINE SYNTHETIC ONLY. Existing public SDK really compiles and decodes GET.
// sectionsApi/composeDraft below are explicit synthetic AF224-shaped ports,
// not the concurrent SDK candidate or evidence of real API/PG/native behavior.
const READ = "workspace.documents.read", MANAGE = "workspace.documents.manage";
const documentId = "3a07234c-b0fe-4e48-b187-ea14d9ac04a1", otherId = "3a07234c-b0fe-4e48-b187-ea14d9ac04a2";
const at = "2026-11-08T00:00:00.000Z";
const body = "# First\r\nPrivate first 😀\r\n## Second\r\nPrivate second\r\n";
const head = (patch = {}) => ({ id: documentId, code: "synthetic-document", revision: 3, name: "Private document", body, createdAt: at, updatedAt: at, ...patch });
const sha = async value => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))].map(v => v.toString(16).padStart(2, "0")).join("");
async function syntheticIndex(document) {
  // Fixed two-section fixture, deliberately not a parser implementation.
  const split = document.body.indexOf("## Second");
  return { format: "aij-plain-sections-v1", documentId: document.id, revision: document.revision, bodySha256: await sha(document.body), bodyLength: document.body.length,
    bodyByteLength: new TextEncoder().encode(document.body).length, sections: split < 0 ? [{ id: "section-0", index: 0, title: "正文", level: 0, start: 0, end: document.body.length }] : [
      { id: "section-0", index: 0, title: "First", level: 1, start: 0, end: split }, { id: "section-1", index: 1, title: "Second", level: 2, start: split, end: document.body.length }] };
}
async function syntheticCompose({ document, index, sectionId, replacement }) {
  const s = index.sections.find(s => s.id === sectionId);
  if (!s || index.bodySha256 !== await sha(document.body) || s.end < document.body.length && replacement && !/[\r\n]$/.test(replacement) ||
    new TextEncoder().encode(replacement).length > 65536 || [...replacement].some(c => { const n = c.codePointAt(0); return n < 32 && ![9, 10, 13].includes(n) || n >= 127 && n <= 159 || n >= 0xd800 && n <= 0xdfff; })) throw { status: 400 };
  const body = document.body.slice(0, s.start) + replacement + document.body.slice(s.end);
  if (new TextEncoder().encode(body).length > 65536) throw { status: 400 };
  return { documentId: document.id, expectedRevision: document.revision, sourceSha256: index.bodySha256, sectionId, body, changed: document.body !== body };
}
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
async function until(predicate) { for (let i = 0; i < 300; i++) { if (predicate()) return; await tick(); } assert.fail("Synthetic boundary not reached"); }
function fixture(t, options = {}) {
  const calls = [], sectionCalls = [], composeCalls = [], proposals = [];
  const controls = { head: head(), memberId: "member-a", workspaceId: "space-a", roleId: "role-a", roleCode: "owner", permissions: [READ, MANAGE], sessionGeneration: "a".repeat(64),
    active: true, override: null, sectionOverride: null, composeOverride: null, accept: true, ...options };
  let rejected = 0;
  const request = async (path, init = {}) => {
    const u = new URL(path, "http://offline.invalid"), call = { path: u.pathname, method: init.method ?? "GET", init }; calls.push(call);
    assert.equal(init.cache, "no-store"); assert.equal(call.method, "GET", "every action must be zero mutation");
    if (controls.override) { const result = await controls.override(call); if (result !== undefined) return result; }
    if (call.path === "/client/auth/me") return { id: controls.memberId, email: null, nickname: "Synthetic member" };
    assert.equal(init.workspaceId, "space-a");
    if (call.path === "/client/workspaces/context") return { workspaceId: controls.workspaceId, workspaceCode: "synthetic-space", workspaceName: "Synthetic space", roleId: controls.roleId,
      roleCode: controls.roleCode, permissions: [...controls.permissions], sessionGeneration: controls.sessionGeneration };
    assert.equal(call.path, `/client/documents/${documentId}`); return structuredClone(controls.head);
  };
  const sectionsApi = { async get(workspaceId, id, revision, signal) {
    sectionCalls.push({ workspaceId, id, revision, signal });
    assert.equal(workspaceId, "space-a"); assert.equal(id, documentId); assert.equal(revision, 3); assert.ok(signal instanceof AbortSignal);
    return controls.sectionOverride ? controls.sectionOverride() : syntheticIndex(controls.head);
  } };
  const composeDraft = async input => { composeCalls.push(input); return controls.composeOverride ? controls.composeOverride(input) : syntheticCompose(input); };
  const onDraftReady = proposal => { proposals.push(proposal); options.onDraftReady?.(proposal); return controls.accept; };
  const onScopeRejected = () => { rejected++; options.onScopeRejected?.(); };
  const store = createDocumentSectionsEditor({ request, sectionsApi, composeDraft, onDraftReady, onScopeRejected, isActive: () => controls.active });
  const scope = { memberId: "member-a", workspaceId: "space-a", documentId, revision: 3 };
  store.setScope(scope); t.after(() => store.dispose());
  const select = async (sectionId = "section-0") => { await store.load(); await store.select(sectionId); assert.ok(store.getSnapshot().selected); };
  const preview = async (replacement = "# First\r\nChanged 😀\r\n") => { await select(); store.draft(replacement); await store.preview(); assert.ok(store.getSnapshot().comparison); };
  const confirm = async replacement => { await preview(replacement); await store.requestConfirmation(); assert.equal(store.getSnapshot().confirmation, true); };
  return { store, controls, calls, sectionCalls, composeCalls, proposals, scope, request, sectionsApi, composeDraft, onDraftReady, onScopeRejected, select, preview, confirm, rejected: () => rejected };
}
function cleared(store) {
  const s = store.getSnapshot(); for (const key of ["head", "index", "selected", "comparison"]) assert.equal(s[key], null);
  assert.equal(s.replacement, ""); assert.equal(s.confirmation, false); assert.equal(s.canManage, false); assert.equal(s.busy, false);
  assert.doesNotMatch(JSON.stringify(s), /Private first|Private second|Changed 😀|synthetic-document/);
}

test("actual compiled public SDK decodes current document and state reads/selects only explicitly", async t => {
  const f = fixture(t); assert.equal(f.calls.length, 0); assert.equal(f.sectionCalls.length, 0);
  await f.select(); const s = f.store.getSnapshot(); assert.equal(s.selected.id, "section-0"); assert.equal(s.replacement, body.slice(0, body.indexOf("## Second")));
  assert.equal(f.sectionCalls.length, 1); assert.equal(s.head.id, documentId); assert.ok(f.calls.some(c => c.path === `/client/documents/${documentId}`));
  await f.store.select("section-1"); assert.equal(f.store.getSnapshot().replacement, "## Second\r\nPrivate second\r\n");
  const n = f.calls.length; await f.store.select("missing"); assert.equal(f.calls.length, n); assert.equal(f.proposals.length, 0);
});
test("preview preserves exact prefix/suffix, confirmation applies to parent once and clears child RAM", async t => {
  const f = fixture(t); await f.confirm(); const result = f.store.getSnapshot().comparison;
  assert.equal(result.body, "# First\r\nChanged 😀\r\n## Second\r\nPrivate second\r\n"); assert.equal(f.proposals.length, 0);
  await Promise.all([f.store.confirmDraft(), f.store.confirmDraft()]); assert.equal(f.proposals.length, 1);
  const p = f.proposals[0]; assert.equal(p.memberId, f.scope.memberId); assert.equal(p.workspaceId, f.scope.workspaceId); assert.equal(p.expectedRevision, 3);
  assert.equal(p.sourceSha256, await sha(body)); assert.equal(p.sessionGeneration, "a".repeat(64)); assert.equal(p.roleId, "role-a"); assert.deepEqual(p.permissions, [MANAGE, READ]);
  assert.equal(p.body, result.body); assert.ok(Object.isFrozen(p)); cleared(f.store); assert.match(f.store.getSnapshot().notice, /尚未保存/);
  assert.equal(f.controls.head.body, body); assert.equal(f.controls.head.revision, 3); await f.store.confirmDraft(); assert.equal(f.proposals.length, 1);
});
test("last-section replacement and whole-section deletion preserve untouched bytes", async t => {
  for (const [sectionId, replacement] of [["section-1", "## Second\r\nNew last 😀"], ["section-0", ""]]) {
    const f = fixture(t); await f.select(sectionId); const selected = f.store.getSnapshot().selected;
    f.store.draft(replacement); await f.store.preview(); const proposal = f.store.getSnapshot().comparison;
    assert.equal(proposal.body, body.slice(0, selected.start) + replacement + body.slice(selected.end));
    assert.deepEqual(new TextEncoder().encode(proposal.body.slice(0, selected.start)), new TextEncoder().encode(body.slice(0, selected.start)));
    await f.store.requestConfirmation(); await f.store.confirmDraft(); assert.equal(f.proposals.length, 1); assert.equal(f.controls.head.body, body);
  }
});
test("read+manage confirmation is repeated after fresh GET and auth before parent callback", async t => {
  const f = fixture(t); await f.confirm(); const n = f.calls.length; await f.store.confirmDraft();
  const tail = f.calls.slice(n); assert.equal(tail.filter(c => c.path === `/client/documents/${documentId}`).length, 2);
  assert.equal(tail.at(-1).path, "/client/workspaces/context"); assert.equal(f.proposals.length, 1);
});
test("cancel and noop (including empty document) never call parent or write", async t => {
  const f = fixture(t); await f.confirm(); f.store.cancelConfirmation(); await f.store.confirmDraft(); assert.equal(f.proposals.length, 0); assert.ok(f.store.getSnapshot().comparison);
  for (const content of [body, ""]) {
    const g = fixture(t, { head: head({ body: content }) }); await g.select(); await g.store.preview();
    assert.equal(g.store.getSnapshot().comparison.changed, false); await g.store.requestConfirmation(); await g.store.confirmDraft();
    assert.equal(g.proposals.length, 0); assert.equal(g.store.getSnapshot().confirmation, false); assert.match(g.store.getSnapshot().notice, /无需应用/);
  }
});
test("editing invalidates comparison and confirmation; selecting a different section clears replacement", async t => {
  const f = fixture(t); await f.confirm(); f.store.draft("# Revised\n"); assert.equal(f.store.getSnapshot().comparison, null); assert.equal(f.store.getSnapshot().confirmation, false);
  await f.store.confirmDraft(); assert.equal(f.proposals.length, 0); await f.store.select("section-1"); assert.equal(f.store.getSnapshot().replacement, "## Second\r\nPrivate second\r\n");
});
test("parent rejection preserves parent-owned existing draft and clears child without claiming save", async t => {
  let parentDraft = "Existing human draft"; const f = fixture(t, { accept: false, onDraftReady: () => assert.equal(parentDraft, "Existing human draft") });
  await f.confirm(); await f.store.confirmDraft(); assert.equal(parentDraft, "Existing human draft"); assert.equal(f.proposals.length, 1); cleared(f.store);
  assert.match(f.store.getSnapshot().notice, /未接收/); assert.doesNotMatch(f.store.getSnapshot().notice, /^(已应用|已保存)/); parentDraft = "";
});
test("parent can synchronously null scope during acceptance without late notice/private content", async t => {
  const f = fixture(t, { onDraftReady: () => f.store.setScope(null) }); await f.confirm(); await f.store.confirmDraft(); cleared(f.store); assert.equal(f.proposals.length, 1); assert.equal(f.store.getSnapshot().notice, "");
});
test("read-only can compare but cannot apply; manage removed after confirmation rejects and clears parent", async t => {
  const f = fixture(t, { permissions: [READ] }); await f.preview(); assert.equal(f.store.getSnapshot().canManage, false);
  await f.store.requestConfirmation(); await f.store.confirmDraft(); assert.equal(f.proposals.length, 0);
  const g = fixture(t); await g.confirm(); g.controls.permissions = [READ]; await g.store.confirmDraft(); cleared(g.store); assert.equal(g.rejected(), 1); assert.equal(g.proposals.length, 0);
});
test("scope exact shape validates without executing getters", async t => {
  const f = fixture(t);
  for (const invalid of [undefined, { ...f.scope, memberId: "../x" }, { ...f.scope, revision: 201 }, { ...f.scope, revision: 0 }, { ...f.scope, documentId: "bad" }, { ...f.scope, extra: true }]) assert.throws(() => f.store.setScope(invalid));
  let read = false; const accessor = { ...f.scope }; Object.defineProperty(accessor, "memberId", { enumerable: true, get() { read = true; return "member-a"; } });
  assert.throws(() => f.store.setScope(accessor)); assert.equal(read, false);
});
test("member/workspace/role/session/permission change rejects at every explicit preview/confirm boundary", async t => {
  for (const step of ["preview", "requestConfirmation", "confirmDraft"]) for (const mutate of [c => { c.memberId = "member-b"; }, c => { c.workspaceId = "space-b"; },
    c => { c.roleId = "role-b"; }, c => { c.roleCode = "other-role"; }, c => { c.sessionGeneration = "b".repeat(64); }, c => { c.permissions = [READ, MANAGE, "workspace.extra.read"]; }]) {
    const f = fixture(t); await f.confirm(); mutate(f.controls); await f.store[step](); cleared(f.store); assert.equal(f.rejected(), 1); assert.equal(f.proposals.length, 0);
  }
});
test("current 401/403/404 synchronously clear child before callback while local 400 is not revocation", async t => {
  for (const status of [401, 403, 404]) {
    const f = fixture(t, { onScopeRejected: () => cleared(f.store) }); await f.confirm(); f.controls.override = () => { throw { status, message: "Private server text" }; };
    await f.store.confirmDraft(); cleared(f.store); assert.equal(f.rejected(), 1); assert.doesNotMatch(f.store.getSnapshot().issue.message, /Private/);
  }
  const f = fixture(t); await f.select(); f.store.draft("Missing required newline"); await f.store.preview(); cleared(f.store);
  assert.equal(f.store.getSnapshot().issue.status, 400); assert.equal(f.rejected(), 0); assert.equal(f.proposals.length, 0);
});
test("revision/hash/current body changes never rebase or call parent", async t => {
  for (const mutate of [c => { c.head.revision++; }, c => { c.head.body = "Same revision changed body"; }, c => { c.head.id = otherId; }]) {
    const f = fixture(t); await f.confirm(); mutate(f.controls); await f.store.confirmDraft(); cleared(f.store); assert.equal(f.proposals.length, 0); assert.equal(f.rejected(), 0);
  }
});
test("after-GET auth check catches session or manage loss before any proposal", async t => {
  const f = fixture(t); await f.confirm(); f.controls.override = call => { if (call.path === `/client/documents/${documentId}`) { f.controls.sessionGeneration = "b".repeat(64); return head(); } };
  await f.store.confirmDraft(); cleared(f.store); assert.equal(f.rejected(), 1); assert.equal(f.proposals.length, 0);
});
test("malformed context and actual SDK malformed document are safe local refusals", async t => {
  for (const change of [v => ({ ...v, sessionGeneration: "bad" }), v => ({ ...v, permissions: [READ, READ] }), v => ({ ...v, extra: true })]) {
    const f = fixture(t); f.controls.override = c => c.path === "/client/workspaces/context" ? change({ workspaceId: "space-a", workspaceCode: "space", workspaceName: "Space", roleId: "role-a", roleCode: "owner", permissions: [READ, MANAGE], sessionGeneration: "a".repeat(64) }) : undefined;
    await f.store.load(); cleared(f.store); assert.equal(f.rejected(), 0);
  }
  for (const patch of [{ body: "bad\u0000body" }, { body: "x".repeat(65537) }, { id: otherId }, { extra: true }]) {
    const f = fixture(t); f.controls.head = head(patch); await f.store.load(); cleared(f.store); assert.equal(f.proposals.length, 0);
  }
  // This call uses the actual compiled public client, never a substitute implementation.
  await assert.rejects(createPersonalDocumentsClient(async () => head({ id: otherId })).get("space-a", documentId), TypeError);
});
test("incompatible injected index/ranges/hash and composer cannot enter private preview", async t => {
  for (const mutate of [v => { v.format = "other"; }, v => { v.sections[0].end--; }, v => { v.sections[0].title = ""; }, v => { v.bodySha256 = "b".repeat(64); },
    v => { v.documentId = otherId; }, v => { v.sections[0].start = 1; }, v => { v.extra = true; }, v => { v.sections[0].extra = true; },
    v => { v.sections[0].end = body.indexOf("😀") + 1; v.sections[1].start = v.sections[0].end; }]) {
    const f = fixture(t); f.controls.sectionOverride = async () => { const v = await syntheticIndex(head()); mutate(v); return v; };
    await f.store.load(); cleared(f.store); assert.equal(f.rejected(), 0);
  }
  const f = fixture(t); await f.select(); f.controls.composeOverride = async input => ({ ...await syntheticCompose(input), body: "forged" });
  await f.store.preview(); cleared(f.store); assert.equal(f.proposals.length, 0);
});

const fences = [f => f.store.setScope(null), f => f.store.setScope({ ...f.scope, memberId: "member-b" }), f => f.store.setScope({ ...f.scope, workspaceId: "space-b" }),
  f => f.store.setScope({ ...f.scope, documentId: otherId }), f => f.store.setScope({ ...f.scope, revision: 4 }), f => f.store.suspend(), f => { f.controls.active = false; f.store.suspend(); }, f => f.store.dispose()];
test("late index response/rejection after null/scope/blur/hidden-style/dispose never repopulates or rejects parent", async t => {
  for (const fence of fences) {
    const f = fixture(t), wait = deferred(); f.controls.sectionOverride = () => wait.promise;
    const pending = f.store.load(); await until(() => f.sectionCalls.length); fence(f); await pending; cleared(f.store);
    wait.resolve(await syntheticIndex(head())); await tick(); cleared(f.store); assert.equal(f.rejected(), 0); assert.equal(f.proposals.length, 0);
  }
  const f = fixture(t), wait = deferred(); f.controls.sectionOverride = () => wait.promise; const pending = f.store.load(); await until(() => f.sectionCalls.length);
  f.store.setScope(null); await pending; wait.reject({ status: 403 }); await tick(); cleared(f.store); assert.equal(f.rejected(), 0);
});
test("every async compose late result after scope/null/suspend/dispose is fenced", async t => {
  for (const fence of fences) {
    const f = fixture(t), wait = deferred(); await f.select(); f.controls.composeOverride = () => wait.promise;
    const pending = f.store.preview(); await until(() => f.composeCalls.length); fence(f); await pending;
    wait.resolve(await syntheticCompose(f.composeCalls[0])); await tick(); cleared(f.store); assert.equal(f.proposals.length, 0);
  }
});
test("late confirmation composition cannot apply after cancellation, blur, scope switch or teardown", async t => {
  for (const fence of [f => f.store.cancelConfirmation(), ...fences]) {
    const f = fixture(t), wait = deferred(); await f.confirm(); const n = f.composeCalls.length; f.controls.composeOverride = () => wait.promise;
    const pending = f.store.confirmDraft(); await until(() => f.composeCalls.length > n); fence(f); await pending;
    wait.resolve(await syntheticCompose(f.composeCalls.at(-1))); await tick(); assert.equal(f.proposals.length, 0); assert.equal(f.store.getSnapshot().confirmation, false);
  }
});
test("cancel fences a pending confirmation read and cannot reopen its modal", async t => {
  const f = fixture(t), wait = deferred(); await f.preview(); const n = f.calls.length;
  f.controls.override = call => call.path === "/client/auth/me" ? wait.promise : undefined;
  const pending = f.store.requestConfirmation(); await until(() => f.calls.length > n); f.store.cancelConfirmation(); await pending;
  wait.resolve({ id: "member-a", email: null, nickname: "Synthetic member" }); await tick();
  assert.equal(f.store.getSnapshot().confirmation, false); assert.equal(f.store.getSnapshot().busy, false); assert.equal(f.proposals.length, 0);
});
test("ignored late auth/GET results, inactivity and changed callback ports cannot leak or apply", async t => {
  for (const path of ["/client/auth/me", "/client/workspaces/context", `/client/documents/${documentId}`]) {
    const f = fixture(t), wait = deferred(); await f.confirm(); const n = f.calls.length;
    f.controls.override = c => c.path === path ? wait.promise : undefined; const pending = f.store.confirmDraft(); await until(() => f.calls.slice(n).some(c => c.path === path));
    f.store.dispose(); await pending; wait.resolve(head()); await tick(); cleared(f.store); assert.equal(f.proposals.length, 0);
  }
  const f = fixture(t); await f.confirm(); f.controls.active = false; await f.store.confirmDraft(); assert.equal(f.proposals.length, 0); cleared(f.store);
  const g = fixture(t), wait = deferred(); g.controls.sectionOverride = () => wait.promise; const pending = g.store.load(); await until(() => g.sectionCalls.length);
  g.store.setCallbacks({ request: async (...args) => g.request(...args), sectionsApi: g.sectionsApi, composeDraft: g.composeDraft, onDraftReady: g.onDraftReady });
  await pending; wait.resolve(await syntheticIndex(head())); await tick(); cleared(g.store);
});

test("offline AntD render escapes text/masks scope and synthetic lifecycle listeners clear on true hidden/blur/pagehide/unmount", async t => {
  const f = fixture(t); await f.preview("# First\n<script>synthetic()</script>\n");
  const require = createRequire(resolve("apps/web/package.json")), React = require("react"), { renderToStaticMarkup } = require("react-dom/server");
  const path = "apps/web/app/components/client-document-sections-panel.tsx", source = readFileSync(path, "utf8");
  const compiled = ts.transpileModule(source, { fileName: path, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const exports = {}, actualRequire = createRequire(resolve(path)), effects = [];
  const harness = { ...React, useState: () => [f.store], useId: () => "sections-title", useRef: value => ({ current: value }), useEffect: fn => { effects.push(fn); },
    useLayoutEffect: () => {}, useSyncExternalStore: (_subscribe, snapshot) => snapshot() };
  new Function("require", "exports", compiled)(name => name === "react" ? harness : name === "./admin-api" ? { adminTheme: {} } :
    name === "./client-document-sections-state.mjs" ? { createDocumentSectionsEditor } : actualRequire(name), exports);
  const render = scope => renderToStaticMarkup(React.createElement(exports.ClientDocumentSectionsPanel, { controller: f.store, request: f.request, sectionsApi: f.sectionsApi, composeDraft: f.composeDraft, scope, onDraftReady: f.onDraftReady }));
  const html = render(f.scope); assert.match(html, /aria-label="文档章节目录"/); assert.match(html, /aria-current="true"/); assert.match(html, /tabindex="0"/);
  assert.match(html, /minmax\(min\(100%, 18rem\), 1fr\)/); assert.match(html, /&lt;script&gt;synthetic/); assert.doesNotMatch(html, /<script>synthetic/);
  assert.equal(render(null), ""); assert.doesNotMatch(render({ ...f.scope, memberId: "member-b" }), /Private first|Private second|synthetic\(\)/);
  assert.doesNotMatch(source, /localStorage|sessionStorage|dangerouslySetInnerHTML|setInterval|window.location/); assert.match(source, /trigger.current\?\.focus\(\)/);
  const oldWindow = globalThis.window, oldDocument = globalThis.document, handlers = new Map();
  globalThis.window = { addEventListener: (name, fn) => handlers.set(name, fn), removeEventListener: name => handlers.delete(name) };
  globalThis.document = { hidden: false, addEventListener: (name, fn) => handlers.set(name, fn), removeEventListener: name => handlers.delete(name) };
  try {
    const cleanup = effects[0](); handlers.get("visibilitychange")(); assert.ok(f.store.getSnapshot().comparison);
    globalThis.document.hidden = true; handlers.get("visibilitychange")(); cleared(f.store); globalThis.document.hidden = false;
    await f.preview(); handlers.get("blur")(); cleared(f.store); await f.preview(); handlers.get("pagehide")(); cleared(f.store);
    await f.preview(); cleanup(); cleared(f.store); assert.equal(handlers.size, 0);
  } finally { globalThis.window = oldWindow; globalThis.document = oldDocument; }
  // No real browser/native focus, screen layout, PG or HTTP assertion is made here.
});
