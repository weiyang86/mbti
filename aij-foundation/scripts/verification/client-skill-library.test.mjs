// Unit-only synthetic HTTP responses exercise the actual compiled SDK and page
// state. They do not establish real server ownership, auth, DB or browser proof.
import assert from "node:assert/strict";
import test from "node:test";
import { createClientApi, createPersonalSkillsClient, ClientRequestFailure } from "../../packages/sdk/dist/index.mjs";
import { createSkillLibrary, skillIssue, validSkillDraft } from "../../apps/web/app/components/client-skill-library-state.mjs";

const READ = "workspace.ai.assets.read", MANAGE = "workspace.ai.assets.manage";
const stamp = "2026-11-05T00:00:00.000Z";
const skill = (id = "skill-01", revision = 1) => ({ id, code: "private-prompt", name: "Private name", instructions: "Private instructions; $(never-run)", revision, createdAt: stamp, updatedAt: stamp });
const summary = value => ({ id: value.id, code: value.code, name: value.name, revision: value.revision, createdAt: value.createdAt, updatedAt: value.updatedAt });
const ok = data => new Response(JSON.stringify({ success: true, data, message: "ok" }), { headers: { "content-type": "application/json" } });
const status = code => new Response("{}", { status: code });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const turn = () => new Promise(resolve => setImmediate(resolve));

function fixture(t, handler = () => undefined) {
  const original = globalThis.fetch;
  const calls = [], settings = { member: "member-a", permissions: [READ, MANAGE], items: [], spaces: ["space-a", "space-b"] };
  globalThis.fetch = async (url, options) => {
    const parsed = new URL(url), path = parsed.pathname.replace(/^\/api/, ""), workspace = options.headers.get("x-aij-workspace-id");
    const call = { url, path, query: parsed.searchParams, workspace, ...options, body: options.body ? JSON.parse(options.body) : undefined };
    calls.push(call);
    const custom = await handler(call);
    if (custom !== undefined) return custom;
    if (path === "/client/auth/me") return ok({ id: settings.member, nickname: "Synthetic member" });
    if (path === "/client/auth/logout") return ok({ success: true });
    if (path === "/client/workspaces") return ok({ items: settings.spaces.map(id => ({ workspace: { id, name: id }, role: { name: "Synthetic role" } })) });
    if (path === "/client/workspaces/context") return ok({ workspaceId: workspace, workspaceName: workspace, permissions: settings.permissions });
    if (path === "/client/ai/skills" && options.method === "GET") return ok({ items: settings.items, nextCursor: null });
    throw new Error("Unexpected synthetic request " + path);
  };
  let unauthorized = 0;
  const request = createClientApi(() => "http://127.0.0.1:43210/api");
  const store = createSkillLibrary({ request, skillsClientFactory: createPersonalSkillsClient, onUnauthorized: () => { unauthorized++; } });
  t.after(() => { store.dispose(); globalThis.fetch = original; });
  return { store, calls, settings, request, unauthorized: () => unauthorized };
}
const draft = store => { store.openCreate(); for (const key of ["code", "name", "instructions"]) store.setDraft(key, skill()[key]); };
const noPrivate = state => {
  assert.deepEqual(state.items, []); assert.equal(state.detail, null); assert.deepEqual(state.versions, []); assert.equal(state.historical, null);
  assert.equal(state.editor, null); assert.deepEqual(state.draft, { code: "", name: "", instructions: "" }); assert.equal(state.confirmation, null);
};

test("actual compiled SDK uses cookie/no-store/workspace transport and six bounded API methods", async t => {
  const f = fixture(t, c => c.path.startsWith("/client/ai/skills") ? ok(c.method === "DELETE" ? { id: "skill-01", revision: 4, deleted: true } : {}) : undefined);
  const client = createPersonalSkillsClient(f.request);
  await client.list("space-a", { limit: 20, afterId: "skill-00" }); await client.create("space-a", { code: skill().code, name: skill().name, instructions: skill().instructions });
  await client.get("space-a", "skill-01"); await client.update("space-a", "skill-01", { name: "Edited", instructions: "Text", expectedRevision: 4 });
  await client.delete("space-a", "skill-01", 4); await client.versions("space-a", "skill-01", { limit: 10, beforeRevision: 4 });
  assert.deepEqual(f.calls.map(c => c.method), ["GET", "POST", "GET", "PATCH", "DELETE", "GET"]);
  assert.ok(f.calls.every(c => c.credentials === "include" && c.cache === "no-store" && c.workspace === "space-a"));
  assert.equal(f.calls[0].query.get("afterId"), "skill-00"); assert.equal(f.calls[5].query.get("beforeRevision"), "4");
  assert.deepEqual(f.calls[3].body, { name: "Edited", instructions: "Text", expectedRevision: 4 });
  assert.deepEqual(f.calls[4].body, { expectedRevision: 4 });
  assert.ok(f.calls.filter(c => c.body).every(c => !JSON.stringify(c.body).includes("memberId") && !JSON.stringify(c.body).includes("workspaceId")));
  const before = f.calls.length;
  assert.throws(() => client.list("space-a", { limit: 51 }), TypeError);
  assert.throws(() => client.get("space-a", "../foreign"), TypeError);
  assert.throws(() => client.create("space-a", { ...skill(), workspaceId: "forged" }), TypeError);
  assert.equal(f.calls.length, before);
});

test("actual me/workspaces/context control selection; no client-supplied owner and no foreign preferred space", async t => {
  const f = fixture(t); await f.store.start("foreign-space");
  assert.equal(f.store.getSnapshot().principal.id, "member-a"); assert.equal(f.store.getSnapshot().workspaceId, "space-a");
  assert.deepEqual(f.calls.map(c => c.path), ["/client/auth/me", "/client/workspaces", "/client/workspaces/context", "/client/ai/skills"]);
  assert.equal(f.calls[2].workspace, "space-a");
  assert.deepEqual(f.store.getSnapshot().items, []); assert.equal(f.store.getSnapshot().phase, "ready");
});

test("read-only asset role reads detail/history and cannot create/update/delete even by direct state calls", async t => {
  const f = fixture(t, c => c.path === "/client/ai/skills/skill-01" ? ok(skill()) : c.path.endsWith("/versions") ? ok({ items: [], nextCursor: null }) : undefined);
  f.settings.permissions = [READ]; await f.store.start(); await f.store.openDetail("skill-01"); await f.store.loadVersions();
  f.store.openCreate(); f.store.openEdit(); f.store.setDraft("name", "forged"); f.store.requestSave(); f.store.requestDelete(); await f.store.confirmMutation();
  assert.equal(f.store.getSnapshot().editor, null); assert.equal(f.store.getSnapshot().confirmation, null);
  assert.ok(f.calls.every(c => !["POST", "PATCH", "DELETE"].includes(c.method)));
});

test("manage without read does not read assets or mutate; no workspace and forbidden are distinct", async t => {
  const f = fixture(t); f.settings.permissions = [MANAGE]; await f.store.start();
  assert.equal(f.calls.filter(c => c.path.startsWith("/client/ai/skills")).length, 0);
  draft(f.store); f.store.requestSave(); await f.store.confirmMutation(); noPrivate(f.store.getSnapshot());
  f.settings.spaces = []; await f.store.refresh(); assert.equal(f.store.getSnapshot().context, null); assert.equal(f.store.getSnapshot().issue, null);
});

test("workspace switch clears every private field immediately; ignored abort cannot resurrect old list", async t => {
  const old = deferred(), entered = deferred(); let block = false;
  const f = fixture(t, c => c.path === "/client/ai/skills" && c.workspace === "space-a" && block ? (entered.resolve(c), old.promise) : undefined);
  await f.store.start(); draft(f.store); f.store.requestSave(); block = true;
  const pending = f.store.refresh(); const captured = await entered.promise;
  const next = f.store.selectWorkspace("space-b"); noPrivate(f.store.getSnapshot()); assert.equal(captured.signal.aborted, true);
  await next; old.resolve(ok({ items: [summary(skill())], nextCursor: null })); await pending;
  assert.equal(f.store.getSnapshot().workspaceId, "space-b"); noPrivate(f.store.getSnapshot());
});

for (const result of ["success", "denial"]) test(`late old detail ${result} cannot replace current-scope detail or error`, async t => {
  const old = deferred(), entered = deferred();
  const f = fixture(t, c => c.path === "/client/ai/skills/skill-01" && c.workspace === "space-a" ? (entered.resolve(c), old.promise) : c.path === "/client/ai/skills/skill-02" ? ok(skill("skill-02")) : undefined);
  await f.store.start(); const pending = f.store.openDetail("skill-01"); const captured = await entered.promise;
  await f.store.selectWorkspace("space-b"); await f.store.openDetail("skill-02");
  old.resolve(result === "success" ? ok(skill()) : status(401)); await pending;
  assert.equal(captured.signal.aborted, true); assert.equal(f.store.getSnapshot().detail.id, "skill-02"); assert.equal(f.store.getSnapshot().issue, null); assert.equal(f.unauthorized(), 0);
});

test("member refresh, page disposal and logout clear private memory and ignore late detail", async t => {
  const old = deferred(), entered = deferred(); let block = false;
  const f = fixture(t, c => c.path === "/client/ai/skills/skill-01" ? block ? (entered.resolve(c), old.promise) : ok(skill()) : undefined);
  await f.store.start(); await f.store.openDetail("skill-01"); f.store.openEdit(); f.store.setDraft("name", "private draft");
  f.settings.member = "member-b"; const next = f.store.refresh(); noPrivate(f.store.getSnapshot()); await next; assert.equal(f.store.getSnapshot().principal.id, "member-b");
  block = true; const pending = f.store.openDetail("skill-01"); const captured = await entered.promise;
  f.store.dispose(); noPrivate(f.store.getSnapshot()); assert.equal(f.store.getSnapshot().principal, null); assert.equal(captured.signal.aborted, true);
  old.resolve(ok(skill())); await pending; noPrivate(f.store.getSnapshot());
  await f.store.start(); draft(f.store); const logout = f.store.signOut(); noPrivate(f.store.getSnapshot()); await logout; assert.equal(f.unauthorized(), 1);
});

test("create requires explicit confirmation; identical server replay and refresh never silently issue another POST", async t => {
  const f = fixture(t, c => c.path === "/client/ai/skills" && c.method === "POST" ? ok(skill("existing-replay", 3)) : undefined);
  await f.store.start(); draft(f.store); await f.store.confirmMutation(); assert.equal(f.calls.filter(c => c.method === "POST").length, 0);
  f.store.requestSave(); await f.store.confirmMutation();
  assert.equal(f.calls.filter(c => c.method === "POST").length, 1); assert.match(f.store.getSnapshot().notice, /可能返回已有记录/); noPrivate(f.store.getSnapshot());
  await f.store.refresh(); await f.store.refresh(); assert.equal(f.calls.filter(c => c.method === "POST").length, 1);
});

test("create 409 preserves editable memory, explains duplicate/tombstone/quota and never retries automatically", async t => {
  const f = fixture(t, c => c.method === "POST" ? status(409) : undefined);
  await f.store.start(); draft(f.store); f.store.requestSave(); await f.store.confirmMutation();
  assert.equal(f.store.getSnapshot().issue.kind, "code-conflict"); assert.match(f.store.getSnapshot().issue.message, /编号不能复用/);
  assert.equal(f.store.getSnapshot().draft.instructions, skill().instructions); assert.equal(f.store.getSnapshot().confirmation, null);
  assert.equal(f.calls.filter(c => c.method === "POST").length, 1); await f.store.refresh(); noPrivate(f.store.getSnapshot());
});

test("edit carries actual expectedRevision; CAS409 offers read-current flow without overwriting or retrying PATCH", async t => {
  let current = skill("skill-01", 4);
  const f = fixture(t, c => c.path === "/client/ai/skills/skill-01" ? c.method === "PATCH" ? status(409) : ok(current) : undefined);
  await f.store.start(); await f.store.openDetail("skill-01"); f.store.openEdit(); f.store.setDraft("instructions", "unsaved edit"); f.store.requestSave(); await f.store.confirmMutation();
  assert.equal(f.calls.find(c => c.method === "PATCH").body.expectedRevision, 4);
  assert.equal(f.store.getSnapshot().detail.revision, 4); assert.equal(f.store.getSnapshot().draft.instructions, "unsaved edit"); assert.equal(f.store.getSnapshot().issue.kind, "revision-conflict");
  current = skill("skill-01", 5); await f.store.openDetail("skill-01"); assert.equal(f.store.getSnapshot().detail.revision, 5); assert.equal(f.store.getSnapshot().draft.instructions, "");
  assert.equal(f.calls.filter(c => c.method === "PATCH").length, 1);
});

test("successful edit and delete validate server result and clear details/draft/history; delete is confirmed CAS", async t => {
  const f = fixture(t, c => c.path === "/client/ai/skills/skill-01" ? ok(c.method === "DELETE" ? { id: "skill-01", revision: 2, deleted: true } : skill("skill-01", c.method === "PATCH" ? 2 : 1)) : undefined);
  await f.store.start(); await f.store.openDetail("skill-01"); f.store.openEdit(); f.store.setDraft("name", "Changed"); f.store.requestSave(); await f.store.confirmMutation(); noPrivate(f.store.getSnapshot());
  await f.store.openDetail("skill-01"); f.store.requestDelete(); assert.equal(f.calls.filter(c => c.method === "DELETE").length, 0); await f.store.confirmMutation();
  assert.deepEqual(f.calls.find(c => c.method === "DELETE").body, { expectedRevision: 1 }); noPrivate(f.store.getSnapshot()); assert.match(f.store.getSnapshot().notice, /确认删除/);
});

for (const operation of ["create", "update", "delete"]) for (const result of ["success", "denial"]) test(`late ${operation} ${result} after space change cannot wipe current list/detail/draft`, async t => {
  const old = deferred(), entered = deferred();
  const method = { create: "POST", update: "PATCH", delete: "DELETE" }[operation];
  const f = fixture(t, c => c.method === method && c.path.startsWith("/client/ai/skills") ? (entered.resolve(c), old.promise) : c.path === "/client/ai/skills/skill-01" ? ok(skill()) : undefined);
  await f.store.start();
  if (operation === "create") draft(f.store); else { await f.store.openDetail("skill-01"); if (operation === "update") { f.store.openEdit(); f.store.setDraft("name", "Edited"); } }
  if (operation === "delete") f.store.requestDelete(); else f.store.requestSave();
  const pending = f.store.confirmMutation(); const captured = await entered.promise;
  await f.store.selectWorkspace("space-b"); draft(f.store); f.store.setDraft("name", "Current scope draft");
  old.resolve(result === "denial" ? status(403) : ok(operation === "delete" ? { id: "skill-01", revision: 1, deleted: true } : skill("skill-01", operation === "update" ? 2 : 1))); await pending;
  assert.equal(captured.signal.aborted, true); assert.equal(f.store.getSnapshot().workspaceId, "space-b"); assert.equal(f.store.getSnapshot().draft.name, "Current scope draft"); assert.equal(f.store.getSnapshot().notice, "");
});

test("known missing public API configuration is distinct from service/network/no-permission states", async () => {
  let requests = 0;
  const store = createSkillLibrary({ request: async () => { requests++; throw new Error("unexpected"); }, skillsClientFactory: createPersonalSkillsClient, configured: () => false });
  await store.start(); assert.equal(store.getSnapshot().phase, "ready"); assert.equal(store.getSnapshot().issue.kind, "unconfigured"); assert.equal(requests, 0); noPrivate(store.getSnapshot()); store.dispose();
});

test("list and history use real bounded cursors; history preview is read-only and never becomes edit source", async t => {
  const first = Array.from({ length: 20 }, (_, i) => summary(skill("skill-" + String(i + 1).padStart(2, "0"))));
  const history = Array.from({ length: 10 }, (_, i) => ({ ...skill("version-" + (20 - i), 20 - i), skillId: "skill-01", instructions: "Historical " + (20 - i) }));
  const f = fixture(t, c => c.path === "/client/ai/skills" ? ok(c.query.has("afterId") ? { items: [summary(skill("skill-21"))], nextCursor: null } : { items: first, nextCursor: "skill-20" }) :
    c.path === "/client/ai/skills/skill-01" ? ok(skill("skill-01", 20)) : c.path.endsWith("/versions") ? ok(c.query.has("beforeRevision") ? { items: [], nextCursor: null } : { items: history, nextCursor: 11 }) : undefined);
  await f.store.start(); await f.store.nextPage(); assert.equal(f.store.getSnapshot().items.length, 1); assert.equal(f.calls.at(-1).query.get("afterId"), "skill-20"); assert.equal(f.calls.at(-1).query.get("limit"), "20");
  await f.store.openDetail("skill-01"); await f.store.loadVersions(); f.store.previewVersion("version-11"); assert.equal(f.store.getSnapshot().historical.instructions, "Historical 11");
  f.store.openEdit(); assert.equal(f.store.getSnapshot().draft.instructions, skill().instructions); assert.equal(f.store.getSnapshot().historical, null);
  await f.store.loadVersions(); await f.store.loadVersions(true); assert.equal(f.calls.at(-1).query.get("beforeRevision"), "11"); assert.equal(f.calls.at(-1).query.get("limit"), "10");
  assert.ok(f.calls.every(c => c.method === undefined || c.method === "GET"));
});

test("old history is aborted and discarded on workspace change; page memory contains no historical prompt", async t => {
  const old = deferred(), entered = deferred();
  const f = fixture(t, c => c.path === "/client/ai/skills/skill-01" ? ok(skill()) : c.path.endsWith("/versions") ? (entered.resolve(c), old.promise) : undefined);
  await f.store.start(); await f.store.openDetail("skill-01"); const pending = f.store.loadVersions(); const captured = await entered.promise;
  await f.store.selectWorkspace("space-b"); old.resolve(ok({ items: [{ ...skill("version-1"), skillId: "skill-01" }], nextCursor: null })); await pending;
  assert.equal(captured.signal.aborted, true); noPrivate(f.store.getSnapshot());
});

for (const code of [401, 403, 404, 503, 0]) test(`HTTP ${code || "network"} produces actionable distinct state and no fabricated empty success`, async t => {
  const f = fixture(t, c => c.path === "/client/ai/skills" ? code ? status(code) : Promise.reject(new TypeError("Network error")) : undefined);
  await f.store.start(); assert.equal(f.store.getSnapshot().phase, "ready"); assert.equal(f.store.getSnapshot().issue.kind, ({ 401: "unauthorized", 403: "forbidden", 404: "unavailable", 503: "service-unavailable", 0: "network" })[code]);
  noPrivate(f.store.getSnapshot()); assert.equal(f.unauthorized(), code === 401 ? 1 : 0);
});

test("scope/member revocation during detail load clears loaded list, draft and errors immediately on denial", async t => {
  const f = fixture(t, c => c.path === "/client/ai/skills/skill-01" ? status(403) : undefined);
  f.settings.items = [summary(skill())]; await f.store.start(); draft(f.store); await f.store.openDetail("skill-01");
  noPrivate(f.store.getSnapshot()); assert.equal(f.store.getSnapshot().context, null); assert.equal(f.store.getSnapshot().issue.status, 403);
});

test("malformed response/cursor and mismatched detail fail closed", async t => {
  let mode = "list";
  const f = fixture(t, c => c.path === "/client/ai/skills" && mode === "list" ? ok({ items: [], nextCursor: "forged" }) : c.path === "/client/ai/skills/skill-01" ? ok(skill("foreign-id")) : undefined);
  await f.store.start(); assert.equal(f.store.getSnapshot().issue.kind, "invalid-response");
  mode = "detail"; await f.store.refresh(); await f.store.openDetail("skill-01"); assert.equal(f.store.getSnapshot().detail, null); assert.equal(f.store.getSnapshot().issue.kind, "invalid-response");
});

test("unknown write outcome is reported without retry; aborted request rejection cannot overwrite current scope", async t => {
  const entered = deferred();
  const f = fixture(t, c => c.method === "POST" ? Promise.reject(new TypeError("transport interrupted")) : c.path === "/client/ai/skills/skill-01" ? new Promise((_resolve, reject) => { entered.resolve(c); c.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }); }) : undefined);
  await f.store.start(); draft(f.store); f.store.requestSave(); await f.store.confirmMutation(); assert.match(f.store.getSnapshot().issue.message, /写入结果未确认/);
  assert.equal(f.calls.filter(c => c.method === "POST").length, 1);
  const pending = f.store.openDetail("skill-01"); await entered.promise; await f.store.selectWorkspace("space-b"); await pending; assert.equal(f.store.getSnapshot().issue, null);
});

test("request timeout remains active alongside scope abort and produces a visible network failure", async t => {
  const deadline = new AbortController();
  t.mock.method(AbortSignal, "timeout", () => deadline.signal);
  const entered = deferred();
  const f = fixture(t, c => c.path === "/client/ai/skills/skill-01" ? new Promise((_resolve, reject) => {
    entered.resolve(); c.signal.addEventListener("abort", () => reject(new DOMException("Timed out", "TimeoutError")), { once: true });
  }) : undefined);
  await f.store.start(); const pending = f.store.openDetail("skill-01"); await entered.promise; deadline.abort(); await pending;
  assert.equal(f.store.getSnapshot().busy, false); assert.equal(f.store.getSnapshot().issue.kind, "network");
});

test("input validation and compiled SDK preserve actual HTTP409 type without private error reflection", async t => {
  assert.equal(validSkillDraft({ code: "ok-code", name: "Name", instructions: "Text" }), true);
  for (const patch of [{ code: "Bad" }, { name: " Name " }, { instructions: " " }, { instructions: "\0" }, { instructions: "x".repeat(8001) }]) assert.equal(validSkillDraft({ code: "ok-code", name: "Name", instructions: "Text", ...patch }), false);
  const f = fixture(t, () => status(409));
  await assert.rejects(createPersonalSkillsClient(f.request).delete("space-a", "skill-01", 1), e => e instanceof ClientRequestFailure && e.status === 409);
  assert.equal(skillIssue({ status: 409, message: "private reflected prompt" }, "update").message.includes("private reflected"), false);
  await turn();
});
