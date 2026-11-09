import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { createPersonalScriptExecutionClient, createPersonalSkillsClient, ClientRequestFailure } from "../../packages/sdk/dist/index.mjs";
import { createPersonalScriptState, parsePersonalScriptInput, validPersonalScriptSource } from "../../apps/web/app/components/client-personal-script-state.mjs";

// Actual compiled SDK + actual state controller. The in-memory HTTP collaborator
// is unit evidence only, never database, sandbox, browser or target acceptance.
const sha = v => createHash("sha256").update(v).digest("hex");
const versionId = "11111111-1111-4111-8111-111111111111";
const runId = "22222222-2222-4222-8222-222222222222";
const jobId = "33333333-3333-4333-8333-333333333333";
const assetId = "44444444-4444-4444-8444-444444444444";
const key = "55555555-5555-4555-8555-555555555555";
const source = "import json\nprint(json.dumps({'answer': 42}))\n";
const scope = { memberId: "member1", workspaceId: "workspace1", skillId: "skill1", revision: 1, name: "私有名称", instructions: "私有指令" };
const permissions = ["workspace.ai.assets.read", "workspace.ai.assets.manage", "workspace.ai.scripts.manage", "workspace.ai.scripts.execute", "workspace.ai.read", "workspace.ai.execute"];
const context = () => ({ workspaceId: scope.workspaceId, workspaceCode: "space1", workspaceName: "空间", roleId: "role1", roleCode: "owner", sessionGeneration: "a".repeat(64), permissions: [...permissions] });
const ref = (revision = 1) => ({ scriptVersionId: versionId, skillId: scope.skillId, skillVersionId: `skillversion${revision}`, revision,
  scriptDigest: sha(source), policyDigest: "f069cddadeaa30648a61bc2bcc93a817c9f4147c3d3f808936b30db7e12c4aef" });
const output = new TextEncoder().encode('{"answer":42}');
const run = (outcome = null, revision = 1) => ({ id: runId, script: ref(revision), jobId, jobStatus: outcome ? "completed" : "pending", outcome,
  attempted: outcome !== null, result: outcome === "SUCCESS" ? { assetId, mimeType: "application/json", originalName: `script-${runId}.json`, size: output.length,
    checksum: sha(output), createdAt: "2026-11-07T10:01:00.000Z" } : null, createdAt: "2026-11-07T10:00:00.000Z", expiresAt: "2026-11-14T10:00:00.000Z" });
function fixture(options = {}) {
  const calls = [], urls = [], revoked = [], downloads = [];
  let head = { id: scope.skillId, code: "test-skill", ...scope, createdAt: "2026-11-07T10:00:00.000Z", updatedAt: "2026-11-07T10:00:00.000Z" };
  let ctx = context(), me = { id: scope.memberId, nickname: "私有昵称", email: "private@example.test" }, capability = { configured: true, canExecute: true, reason: "ready" }, result = run();
  let hook = options.hook, changed = 0;
  const request = async (path, init = {}) => {
    calls.push({ path, init });
    const alternate = await hook?.(path, init);
    if (alternate !== undefined) return alternate;
    if (path === "/client/auth/me") return structuredClone(me);
    if (path === "/client/workspaces/context") return structuredClone(ctx);
    if (path === "/client/ai/skills/skill1") return structuredClone(head);
    if (path.endsWith("/capability")) return structuredClone(capability);
    if (path.endsWith("/versions") && init.method === "POST") { head = { ...head, revision: head.revision + 1 }; return ref(head.revision); }
    if (path.endsWith(`/versions/${versionId}`)) return { ref: ref(head.revision), scriptSource: source };
    if (path.endsWith("/runs") && init.method === "POST") return structuredClone(result);
    if (path.endsWith(`/requests/${key}`) || path.endsWith(`/runs/${runId}`)) return structuredClone(result);
    if (path.endsWith(`/runs/${runId}/content`)) {
      const bytes = output.slice(); downloads.push(bytes);
      return { bytes, headers: new Headers({ "content-type": "application/json", "content-length": String(bytes.length),
        "content-disposition": `attachment; filename="script-${runId}.json"`, "x-aij-script-run-id": runId, "x-aij-script-version-id": versionId,
        "x-aij-asset-id": assetId, "x-aij-checksum-sha256": sha(bytes), "cache-control": "private, no-store", "x-content-type-options": "nosniff" }) };
    }
    throw new Error("Unexpected unit request");
  };
  const store = createPersonalScriptState({ request, scriptsClientFactory: createPersonalScriptExecutionClient, skillsClientFactory: createPersonalSkillsClient,
    makeKey: () => key, now: () => Date.parse("2026-11-07T10:05:00.000Z"), makeObjectURL: blob => { assert(blob instanceof Blob); const url = `blob:unit-${urls.length}`; urls.push(url); return url; },
    revokeObjectURL: url => revoked.push(url), onSkillChanged: () => { changed++; }, timeoutMs: options.timeoutMs ?? 8000 });
  return { store, calls, urls, revoked, downloads, request, get changed() { return changed; }, get head() { return head; },
    setHead: v => { head = { ...head, ...v }; }, setContext: v => { ctx = { ...ctx, ...v }; }, setMe: v => { me = v; },
    setCapability: v => { capability = v; }, setRun: v => { result = v; }, setHook: v => { hook = v; } };
}
async function ready(f, s = scope) {
  f.store.setScope(s);
  for (let i = 0; i < 100 && f.store.getSnapshot().busy; i++) await delay(0);
  assert.equal(f.store.getSnapshot().busy, false);
}
async function loadVersion(f) { f.store.setField("versionId", versionId); await f.store.readVersion(); assert.equal(f.store.getSnapshot().ref?.scriptVersionId, versionId); }
async function submit(f) { await loadVersion(f); f.store.setField("input", '{"value":[1,true,null]}'); f.store.requestConfirmation("run"); await f.store.confirmSubmit(); }
const posts = f => f.calls.filter(c => c.init.method === "POST");
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function until(predicate) { for (let i = 0; i < 100 && !predicate(); i++) await delay(0); assert(predicate()); }

test("strict JSON and source bounds reject duplicate decoded keys, unsafe values and oversized inputs", () => {
  assert.deepEqual(parsePersonalScriptInput('{"a":[1,true,null,"中文"],"b":{}}'), { a: [1, true, null, "中文"], b: {} });
  for (const raw of ['{"x":1,"x":2}', '{"a":1,"\\u0061":2}', '{"a":{"x":1,"x":2}}', '{"__proto__":{}}', '{"constructor":1}', '{"a":{"prototype":1}}',
    '1e999', 'NaN', '{"x":"\\ud800"}', 'true false', '{"a":}', '', '['.repeat(18) + '0' + ']'.repeat(18), JSON.stringify(Array(2049).fill(0)), JSON.stringify("中".repeat(6000))]) {
    assert.throws(() => parsePersonalScriptInput(raw), undefined, raw.slice(0, 40));
  }
  assert.equal(validPersonalScriptSource(source), true);
  for (const raw of ["", "a\0b", "\ud800", "中".repeat(21846)]) assert.equal(validPersonalScriptSource(raw), false);
});

test("real context session generation binds the same member/role before a write", async t => {
  const f = fixture(); t.after(() => f.store.suspend()); await ready(f);
  f.store.setField("source", source); f.setContext({ sessionGeneration: "b".repeat(64) });
  f.store.requestConfirmation("version"); await f.store.confirmVersion();
  assert.equal(posts(f).length, 0); assert.equal(f.store.getSnapshot().source, ""); assert.equal(f.store.getSnapshot().auth, null);
  for (const sessionGeneration of [undefined, "", "x".repeat(64)]) {
    const denied = fixture(); t.after(() => denied.store.suspend()); denied.setContext({ sessionGeneration }); await ready(denied);
    assert.equal(denied.store.getSnapshot().auth, null); assert.equal(denied.store.canCreate(), false); assert.equal(posts(denied).length, 0);
  }
});

test("session rotation after one original POST clears content and retains the unresolved version/run lock", async t => {
  for (const kind of ["version", "run"]) {
    const f = fixture(); t.after(() => f.store.suspend()); await ready(f);
    if (kind === "run") { await loadVersion(f); f.store.setField("input", '{"value":1}'); }
    else f.store.setField("source", source);
    f.setHook((path, init) => { if (init.method === "POST") f.setContext({ sessionGeneration: "b".repeat(64) }); });
    f.store.requestConfirmation(kind);
    if (kind === "run") await f.store.confirmSubmit(); else await f.store.confirmVersion();
    assert.equal(posts(f).length, 1); const s = f.store.getSnapshot(); assert.equal(s.locked, true);
    for (const k of ["source", "input", "output"]) assert.equal(s[k], ""); assert.equal(s.auth, null); assert.equal(s.scope, null);
    f.store.setScope(null); assert.equal(f.store.getSnapshot().locked, true); assert.equal(posts(f).length, 1);
  }
});

test("source creates exactly one immutable version through the original SDK; no automatic run", async t => {
  const f = fixture(); t.after(() => f.store.suspend()); await ready(f);
  assert.equal(posts(f).length, 0);
  f.store.setField("source", source); await f.store.confirmVersion(); assert.equal(posts(f).length, 0);
  f.store.requestConfirmation("version"); const saving = f.store.confirmVersion(); await f.store.confirmVersion(); await saving;
  assert.equal(posts(f).length, 1); assert(posts(f)[0].path.endsWith("/versions"));
  assert.deepEqual(JSON.parse(posts(f)[0].init.body), { skillId: scope.skillId, expectedRevision: 1, name: scope.name, instructions: scope.instructions, scriptSource: source });
  const s = f.store.getSnapshot(); assert.equal(s.ref.revision, 2); assert.equal(s.ref.scriptDigest, sha(source)); assert.equal(s.locked, false); assert.equal(s.source, ""); assert.equal(f.changed, 1);
  assert.equal(f.store.canSubmit(), false);
  await ready(f, { ...scope, revision: 2 }); assert.equal(f.store.getSnapshot().versionId, versionId); await loadVersion(f);
  assert.equal(f.store.canSubmit(), true); assert.equal(posts(f).length, 1);
  assert(f.calls.every(c => c.init.cache === "no-store" && c.init.signal instanceof AbortSignal));
});

test("run is one explicit POST; manual original-key GET and terminal acknowledgement never replay", async t => {
  const f = fixture(); t.after(() => f.store.suspend()); await ready(f); await submit(f);
  assert.equal(posts(f).length, 1); assert.deepEqual(JSON.parse(posts(f)[0].init.body), { scriptVersionId: versionId, input: { value: [1, true, null] }, idempotencyKey: key });
  assert.equal(f.store.getSnapshot().input, ""); assert.equal(f.store.getSnapshot().locked, true); assert.equal(f.store.canSubmit(), false);
  await f.store.confirmSubmit(); await delay(5); assert.equal(posts(f).length, 1);
  assert.equal(f.calls.filter(c => c.path.includes("/requests/")).length, 0);
  await f.store.recover(); assert.equal(f.calls.filter(c => c.path.endsWith(`/requests/${key}`)).length, 1);
  assert.equal(f.store.canResolveRun(), false);
  f.setRun(run("SUCCESS")); await f.store.recover(); assert.equal(f.store.canResolveRun(), true);
  await f.store.resolveRun(); assert.equal(f.store.getSnapshot().locked, false); assert.equal(posts(f).length, 1);
});

test("blur/null/same-owner reappearance fences late POST, retains only opaque lock, and never writes", async t => {
  const f = fixture(); t.after(() => f.store.suspend()); await ready(f); await loadVersion(f);
  const d = deferred(); f.setHook((path, init) => path.endsWith("/runs") && init.method === "POST" ? d.promise : undefined);
  f.store.setField("input", '{"private":"secret"}'); f.store.requestConfirmation("run"); const writing = f.store.confirmSubmit();
  await until(() => posts(f).length === 1); f.store.suspend(); f.store.setScope(null);
  const blank = f.store.getSnapshot(); assert.equal(blank.scope, null); assert.equal(blank.source, ""); assert.equal(blank.input, ""); assert.equal(blank.output, ""); assert.equal(blank.auth, null); assert.equal(blank.pending, null); assert.equal(blank.locked, true);
  d.resolve(run("SUCCESS")); await writing; assert.equal(f.store.getSnapshot().run, null);
  f.setHook(undefined); await ready(f); assert.equal(f.store.getSnapshot().pending.key, key); assert.equal(f.store.getSnapshot().run, null); assert.equal(posts(f).length, 1);
  assert.deepEqual(Object.keys(f.store.getSnapshot().pending).sort(), ["kind", "memberId", "workspaceId", "skillId", "revision", "scriptVersionId", "key"].sort());
  assert.equal(f.store.canCreate(), false); assert.equal(f.store.canSubmit(), false); await f.store.recover(); assert.equal(posts(f).length, 1);
});

test("unknown version rereads original Skill head, requires explicit acknowledgement, has no invented recovery API", async t => {
  const f = fixture(); t.after(() => f.store.suspend()); await ready(f);
  f.setHook((path, init) => { if (path.endsWith("/versions") && init.method === "POST") { f.setHead({ revision: 2 }); throw new Error("lost response"); } });
  f.store.setField("source", source); f.store.requestConfirmation("version"); await f.store.confirmVersion();
  assert.equal(f.store.getSnapshot().locked, true); assert.equal(f.store.getSnapshot().scope, null);
  await ready(f); await f.store.acknowledgeVersionWrite(); assert.equal(f.store.getSnapshot().locked, true);
  await f.store.reviewVersionWrite(); assert.equal(f.store.getSnapshot().versionReview.revision, 2); assert.equal(f.store.getSnapshot().locked, true);
  await f.store.acknowledgeVersionWrite(); assert.equal(f.store.getSnapshot().locked, false); assert.equal(f.changed, 1); assert.equal(posts(f).length, 1);
  assert.equal(f.calls.some(c => /version.*requests|requests.*version/.test(c.path)), false);
});

test("an HTTP POST denial and post-success authorization failure both retain the original attempted key", async t => {
  for (const afterWrite of [false, true]) {
    const f = fixture(); t.after(() => f.store.suspend()); await ready(f); await loadVersion(f);
    let posted = false;
    f.setHook((path, init) => {
      if (path.endsWith("/runs") && init.method === "POST") { posted = true; if (!afterWrite) throw new ClientRequestFailure(403); }
      if (afterWrite && posted && path === "/client/auth/me") throw new ClientRequestFailure(401);
    });
    f.store.setField("input", '{}'); f.store.requestConfirmation("run"); await f.store.confirmSubmit();
    assert.equal(f.store.getSnapshot().locked, true); assert.equal(f.store.getSnapshot().scope, null); assert.equal(f.store.getSnapshot().run, null); assert.equal(posts(f).length, 1);
  }
});

test("a committed version followed by a transport replay409 still requires current head and explicit acknowledgement", async t => {
  const f = fixture(); t.after(() => f.store.suspend()); await ready(f);
  f.setHook((path, init) => { if (path.endsWith('/versions') && init.method === 'POST') { f.setHead({ revision: 2 }); throw new ClientRequestFailure(409); } });
  f.store.setField('source', source); f.store.requestConfirmation('version'); await f.store.confirmVersion();
  assert.equal(f.store.getSnapshot().locked, true); assert.equal(f.store.getSnapshot().source, ''); assert.equal(f.store.getSnapshot().auth, null);
  f.setHook(undefined); await ready(f); await f.store.acknowledgeVersionWrite(); assert.equal(f.store.getSnapshot().locked, true);
  await f.store.reviewVersionWrite(); assert.equal(f.store.getSnapshot().versionReview.revision, 2);
  await f.store.acknowledgeVersionWrite(); assert.equal(f.store.getSnapshot().locked, false); assert.equal(posts(f).length, 1);
});

test("configured=false blocks new submission while original SUCCESS result reads and bounded downloads work", async t => {
  const f = fixture(); t.after(() => f.store.suspend()); f.setCapability({ configured: false, canExecute: false, reason: "not_configured" }); f.setRun(run("SUCCESS"));
  await ready(f); await loadVersion(f); assert.equal(f.store.canSubmit(), false);
  f.store.setField("runId", runId); await f.store.readRun(); await f.store.download();
  assert.equal(f.store.getSnapshot().output, '{"answer":42}'); assert.equal(f.store.getSnapshot().download.filename, `script-${runId}.json`);
  assert(f.downloads[0].every(v => v === 0)); assert.equal(f.urls.length, 1); assert.equal(posts(f).length, 0);
  f.store.suspend(); assert.deepEqual(f.revoked, f.urls); assert.equal(f.store.getSnapshot().output, ""); assert.equal(f.store.getSnapshot().download, null);
});

test("permissions for source management, AI execution and AI reads stay independent", async t => {
  const variants = [
    { removed: "workspace.ai.assets.manage", create: false, execute: true, read: true, source: true },
    { removed: "workspace.ai.scripts.manage", create: false, execute: true, read: true, source: false },
    { removed: "workspace.ai.execute", create: true, execute: false, read: true, source: true },
    { removed: "workspace.ai.read", create: true, execute: true, read: false, source: true },
    { removed: "workspace.ai.scripts.execute", create: true, execute: false, read: false, source: true }
  ];
  for (const v of variants) {
    const f = fixture(); t.after(() => f.store.suspend()); f.setContext({ permissions: permissions.filter(p => p !== v.removed) });
    f.setCapability({ configured: true, canExecute: !["workspace.ai.execute", "workspace.ai.scripts.execute"].includes(v.removed), reason: ["workspace.ai.execute", "workspace.ai.scripts.execute"].includes(v.removed) ? "not_permitted" : "ready" });
    await ready(f); f.store.setField("versionId", versionId); await f.store.readVersion();
    assert.equal(Boolean(f.store.getSnapshot().ref), v.source); assert.equal(f.store.canCreate(), v.create); assert.equal(f.store.canSubmit(), v.execute);
    f.store.setField("runId", runId); await f.store.readRun(); assert.equal(Boolean(f.store.getSnapshot().run), v.read);
    assert.equal(posts(f).length, 0);
  }
});

test("execution permission alone can submit a known version ID without script management or AI read", async t => {
  const f = fixture(); t.after(() => f.store.suspend());
  f.setContext({ permissions: permissions.filter(p => !["workspace.ai.assets.manage", "workspace.ai.scripts.manage", "workspace.ai.read"].includes(p)) });
  await ready(f); f.store.setField("versionId", versionId); assert.equal(f.store.canSubmit(), true);
  f.store.setField("input", '{}'); f.store.requestConfirmation("run"); await f.store.confirmSubmit();
  assert.equal(posts(f).length, 1); assert.equal(f.calls.some(c => c.path.includes("/versions/")), false);
  assert.equal(f.store.getSnapshot().run.id, runId); assert.equal(f.store.getSnapshot().ref.scriptDigest, sha(source));
  await f.store.readRun(); await f.store.recover(); await f.store.download();
  assert.equal(f.calls.some(c => /\/requests\/|\/content$/.test(c.path)), false);
});

test("role, permissions, principal and head changes reject before POST, clearing all private content", async t => {
  for (const change of [f => f.setContext({ roleId: "role2" }), f => f.setContext({ roleCode: "reader" }),
    f => f.setContext({ permissions: permissions.filter(p => p !== "workspace.ai.read") }), f => f.setMe({ id: "othermember" }),
    f => f.setHead({ revision: 2 }), f => f.setHead({ name: "changed" }), f => f.setHead({ instructions: "changed" })]) {
    const f = fixture(); t.after(() => f.store.suspend()); await ready(f); await loadVersion(f);
    f.store.setField("input", '{}'); f.store.requestConfirmation("run"); change(f); await f.store.confirmSubmit();
    assert.equal(posts(f).length, 0); assert.equal(f.store.getSnapshot().scope, null); assert.equal(f.store.getSnapshot().source, ""); assert.equal(f.store.getSnapshot().input, ""); assert.equal(f.store.getSnapshot().ref, null);
  }
});

test("download never surfaces late or revoked output and always wipes SDK bytes", async t => {
  for (const boundary of ["scope", "role", "head", "blur"]) {
    const f = fixture(); t.after(() => f.store.suspend()); f.setRun(run("SUCCESS")); await ready(f); f.store.setField("runId", runId); await f.store.readRun();
    const d = deferred(); let entered = false;
    f.setHook(async path => { if (path.endsWith("/content")) { entered = true; await d.promise; } });
    const reading = f.store.download(); await until(() => entered);
    if (boundary === "scope") f.store.setScope(null);
    if (boundary === "role") f.setContext({ roleId: "changedrole" });
    if (boundary === "head") f.setHead({ revision: 2 });
    if (boundary === "blur") f.store.suspend();
    d.resolve(); await reading;
    assert.equal(f.store.getSnapshot().output, ""); assert.equal(f.urls.length, 0); assert(f.downloads[0].every(v => v === 0));
  }
});

test("401/403/404/409/410 preserve original unknown run lock; all recoveries remain GET", async t => {
  for (const status of [401, 403, 404, 409, 410]) {
    const f = fixture(); t.after(() => f.store.suspend()); await ready(f); await submit(f);
    f.setHook(path => { if (path.includes("/requests/")) throw new ClientRequestFailure(status); });
    await f.store.recover(); const s = f.store.getSnapshot(); assert.equal(s.issue.status, status); assert.equal(s.locked, true); assert.equal(s.run, null); assert.equal(s.scope, null);
    await ready(f); assert.equal(f.store.getSnapshot().pending.key, key); assert.equal(posts(f).length, 1);
  }
});

test("UNKNOWN and CLEANUP_UNCONFIRMED cannot unlock or download; malformed responses stay unknown", async t => {
  for (const outcome of ["UNKNOWN", "CLEANUP_UNCONFIRMED", "SCRIPT_NONZERO"]) {
    const f = fixture(); t.after(() => f.store.suspend()); f.setRun(run(outcome)); await ready(f); await submit(f);
    assert.equal(f.store.canResolveRun(), outcome === "SCRIPT_NONZERO"); await f.store.download(); assert.equal(f.downloads.length, 0); assert.equal(f.store.getSnapshot().locked, true);
  }
  const f = fixture(); t.after(() => f.store.suspend()); await ready(f); await loadVersion(f);
  f.setHook((path, init) => path.endsWith("/runs") && init.method === "POST" ? { ...run(), script: { ...ref(), skillId: "another" } } : undefined);
  f.store.setField("input", '{}'); f.store.requestConfirmation("run"); await f.store.confirmSubmit();
  assert.equal(f.store.getSnapshot().locked, true); assert.equal(f.store.getSnapshot().run, null); assert.equal(posts(f).length, 1);
});

test("unknown ownership lock is hidden from a different member or scope and survives request changes", async t => {
  const f = fixture(); t.after(() => f.store.suspend()); await ready(f); await submit(f);
  f.store.setScope(null); await ready(f, { ...scope, memberId: "othermember" });
  assert.equal(f.store.getSnapshot().pending, null); assert.equal(f.store.getSnapshot().locked, true);
  f.store.setRequest((...args) => f.request(...args)); await ready(f);
  assert.equal(f.store.getSnapshot().pending.key, key); assert.equal(f.store.canCreate(), false); assert.equal(posts(f).length, 1);
});

test("timeout clears content and fences a transport that ignores abort, retaining unknown key", async t => {
  const f = fixture({ timeoutMs: 100 }); t.after(() => f.store.suspend()); await ready(f); await loadVersion(f);
  const d = deferred(); f.setHook((path, init) => path.endsWith("/runs") && init.method === "POST" ? d.promise : undefined);
  f.store.setField("input", '{}'); f.store.requestConfirmation("run"); const writing = f.store.confirmSubmit();
  await until(() => posts(f).length === 1); await delay(130);
  assert.equal(f.store.getSnapshot().scope, null); assert.equal(f.store.getSnapshot().locked, true); assert.equal(f.store.getSnapshot().busy, false);
  d.resolve(run("SUCCESS")); await writing; assert.equal(f.store.getSnapshot().run, null); assert.equal(posts(f).length, 1);
});
