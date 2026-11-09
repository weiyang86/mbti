import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createClientApi, createPersonalAgentsClient, createPersonalSkillsClient } from "../../packages/sdk/dist/index.mjs";
import { createAgentLibrary, validAgentDraft, agentIssue } from "../../apps/web/app/components/client-agent-library-state.mjs";

// All HTTP envelopes below are explicitly SYNTHETIC. They prove the actual state
// machine + compiled public SDK contract, never real server authorization or DB.
const READ = "workspace.ai.assets.read", MANAGE = "workspace.ai.assets.manage";
const at = "2026-11-05T00:00:00.000Z";
const draft = (extra = {}) => ({ code: "my-agent", name: "Synthetic agent", instructions: "Synthetic private instruction", enabled: false, modelCode: "safe-model", modelRevision: 2, catalogVersion: 3, inputFields: ["input"], outputFormat: "text", outputFields: [], skillBindings: [], ...extra });
const agent = (extra = {}) => ({ ...draft(), id: "agent-a", revision: 1, createdAt: at, updatedAt: at, ...extra });
const skill = (extra = {}) => ({ id: "skill-a", code: "my-skill", name: "Synthetic skill", instructions: "Synthetic skill instruction", revision: 2, createdAt: at, updatedAt: at, ...extra });
const skillVersion = (rev = 2, skillId = "skill-a") => ({ id: `${skillId}-v${rev}`, skillId, code: skillId === "skill-a" ? "my-skill" : "other-skill", name: `Synthetic ${skillId} v${rev}`, instructions: "Synthetic immutable instruction", revision: rev, createdAt: at });
const options = () => ({ catalogVersion: 3, items: [{ code: "safe-model", name: "Safe synthetic model", revision: 2, capability: "text" }] });
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; };
const flush = () => new Promise(resolve => setImmediate(resolve));
function fixture(t, { permissions = [READ, MANAGE], configured = true, timeoutMs = 8000 } = {}) {
  const originalFetch = globalThis.fetch, calls = [], controls = { permissions, principal: "principal-a", override: null, options: options() };
  let current = agent(), deleted = false;
  globalThis.fetch = async (url, init) => {
    const u = new URL(url), path = u.pathname.replace(/^\/api/, ""), method = init.method ?? "GET", body = init.body ? JSON.parse(init.body) : undefined;
    const workspaceId = new Headers(init.headers).get("x-aij-workspace-id");
    calls.push({ url, path, method, body, workspaceId, init });
    if (controls.override) { const v = await controls.override({ path, method, body, workspaceId, init, url }); if (v !== undefined) return v; }
    let value;
    if (path === "/client/auth/me") value = { id: controls.principal, nickname: "Synthetic" };
    else if (path === "/client/workspaces") value = { items: ["space-a", "space-b"].map(id => ({ workspace: { id, name: id }, role: { name: "Synthetic role" } })) };
    else if (path === "/client/workspaces/context") value = { workspaceId, workspaceName: workspaceId, permissions: controls.permissions };
    else if (path === "/client/auth/logout") value = {};
    else if (path.endsWith("/model-options")) value = controls.options;
    else if (path === "/client/ai/personal-agents" && method === "GET") value = { items: deleted ? [] : [current], nextCursor: null };
    else if (path === "/client/ai/personal-agents" && method === "POST") { current = agent({ ...body, skillBindings: body.skillBindings.map(p => ({ ...p, skillVersionId: `${p.skillId}-v${p.revision}` })) }); deleted = false; value = current; }
    else if (path === "/client/ai/personal-agents/agent-a" && method === "GET") value = current;
    else if (path === "/client/ai/personal-agents/agent-a" && method === "PATCH") { const { expectedRevision: _, ...content } = body; void _; current = agent({ ...content, skillBindings: content.skillBindings.map(p => ({ ...p, skillVersionId: `${p.skillId}-v${p.revision}` })), revision: current.revision + 1 }); value = current; }
    else if (path === "/client/ai/personal-agents/agent-a" && method === "DELETE") { deleted = true; value = { id: current.id, revision: current.revision + 1, deleted: true }; }
    else if (path === "/client/ai/personal-agents/agent-a/versions") { const { updatedAt: _, ...version } = current; void _; value = { items: [{ ...version, id: `agent-v${current.revision}`, agentId: "agent-a" }], nextCursor: null }; }
    else if (path === "/client/ai/skills") value = { items: [skill(), skill({ id: "skill-b", code: "other-skill" })], nextCursor: null };
    else if (/\/skills\/skill-[ab]$/.test(path)) value = skill({ ...(path.endsWith("skill-b") ? { id: "skill-b", code: "other-skill" } : {}) });
    else if (/\/skills\/skill-[ab]\/versions$/.test(path)) {
      const sid = path.split("/").at(-2), before = Number(u.searchParams.get("beforeRevision") ?? 3), limit = Number(u.searchParams.get("limit") ?? 10);
      value = { items: [2, 1].filter(v => v < before).slice(0, limit).map(v => skillVersion(v, sid)), nextCursor: null };
    } else throw new Error(`Unexpected synthetic HTTP request: ${method} ${path}`);
    return response(value);
  };
  let unauthorized = 0;
  const store = createAgentLibrary({ request: createClientApi(() => "http://synthetic.invalid/api"), agentsClientFactory: createPersonalAgentsClient, skillsClientFactory: createPersonalSkillsClient, configured: () => configured, onUnauthorized: () => unauthorized++, timeoutMs });
  t.after(() => { store.dispose(); globalThis.fetch = originalFetch; });
  return { store, controls, calls, unauthorized: () => unauthorized, setCurrent: a => { current=a; }, current: () => current };
}
const response = (data, status = 200) => new Response(JSON.stringify({ success: status < 400, data, message: "Synthetic HTTP envelope" }), { status, headers: { "content-type": "application/json" } });
async function fill(f) {
  await f.store.openCreate();
  for (const key of ["code", "name", "instructions"]) f.store.setDraft(key, draft()[key]);
  f.store.selectModel("safe-model");
}

test("all Agent fields validate exactly before confirmation and compiled SDK request", { timeout: 5000 }, async t => {
  assert.equal(validAgentDraft(draft()), true);
  const invalid = [
    { code: "a" }, { code: "UPPER" }, { code: "my--agent" }, { code: "a".repeat(64) }, { name: " " }, { name: " trailing " }, { name: "a".repeat(101) }, { name: "null\0" },
    { instructions: " " }, { instructions: "a\0b" }, { instructions: "a".repeat(8001) }, { enabled: "true" }, { modelCode: "A" }, { modelRevision: 0 }, { modelRevision: 1.1 }, { catalogVersion: 2147483648 },
    { inputFields: [] }, { inputFields: ["same", "same"] }, { inputFields: ["__proto__"] }, { inputFields: ["constructor"] }, { inputFields: ["prototype"] }, { inputFields: ["1name"] }, { inputFields: ["a".repeat(49)] }, { inputFields: Array.from({ length: 21 }, (_,i) => `f${i}`) },
    { outputFormat: "script" }, { outputFormat: "json", outputFields: [] }, { outputFields: ["a-b"] }, { outputFields: ["a", "a"] },
    { skillBindings: [{ skillId: "bad id", revision: 1 }] }, { skillBindings: [{ skillId: "skill-a", revision: 0 }] }, { skillBindings: [{ skillId: "skill-a", revision: 1 }, { skillId: "skill-a", revision: 2 }] },
    { skillBindings: Array.from({ length: 9 }, (_,i) => ({ skillId: `skill-${i}`, revision: 1 })) }
  ];
  const f = fixture(t); await f.store.start("space-a"); await fill(f);
  assert.equal(f.store.getSnapshot().draft.enabled, false);
  for (const patch of invalid) {
    assert.equal(validAgentDraft(draft(patch)), false, JSON.stringify(patch));
    const client = createPersonalAgentsClient(() => { throw new Error("must reject before transport"); });
    assert.throws(() => client.create("space-a", draft(patch)), TypeError);
  }
  const transport = () => { throw new Error("Forged ownership must not reach transport"); };
  for (const key of ["workspaceId", "memberId", "ownerId", "script", "tools", "published", "credentialRef"]) assert.throws(() => createPersonalAgentsClient(transport).create("space-a", { ...draft(), [key]: "forged" }), TypeError);
  assert.throws(() => createPersonalAgentsClient(transport).update("space-a", "agent-a", { ...draft(), expectedRevision: 0 }), TypeError);
  assert.throws(() => createPersonalAgentsClient(transport).delete("space-a", "agent-a", 0), TypeError);
  assert.equal(validAgentDraft(draft({ outputFormat: "json", outputFields: ["answer"] })), true);
  f.store.setDraft("inputFields", []); f.store.requestSave(); assert.equal(f.store.getSnapshot().confirmation, null);
  assert.equal(f.calls.filter(c => c.method === "POST").length, 0);
});

test("actual Cookie/no-store/Workspace contract, confirmations, config-only CRUD, CAS and immutable history", async t => {
  const f = fixture(t); await f.store.start("space-a"); await fill(f);
  await f.store.confirmMutation(); assert.equal(f.calls.some(c => c.method === "POST"), false);
  f.store.requestSave(); assert.equal(f.store.getSnapshot().confirmation, "create");
  f.store.cancelConfirmation(); await f.store.confirmMutation(); assert.equal(f.calls.some(c => c.method === "POST"), false);
  f.store.requestSave(); await f.store.confirmMutation();
  const create = f.calls.find(c => c.method === "POST"); assert.deepEqual(create.body, draft());
  await f.store.openDetail("agent-a"); assert.equal(f.store.getSnapshot().detail.revision, 1);
  await f.store.openEdit(); f.store.setDraft("code", "cannot-change"); assert.equal(f.store.getSnapshot().draft.code, "my-agent");
  f.store.setDraft("name", "Synthetic edited"); f.store.requestSave(); await f.store.confirmMutation();
  const update = f.calls.find(c => c.method === "PATCH"); assert.equal(update.body.expectedRevision, 1); assert.equal(Object.hasOwn(update.body, "code"), false);
  await f.store.openDetail("agent-a"); await f.store.loadVersions(); f.store.previewVersion("agent-v2");
  assert.equal(f.store.getSnapshot().historical.revision, 2); assert.equal(f.store.getSnapshot().editor, null);
  f.store.requestDelete(); assert.equal(f.store.getSnapshot().confirmation, "delete"); await f.store.confirmMutation();
  assert.deepEqual(f.calls.find(c => c.method === "DELETE").body, { expectedRevision: 2 }); assert.deepEqual(f.store.getSnapshot().items, []);
  for (const c of f.calls) { assert.equal(c.init.credentials, "include"); assert.equal(c.init.cache, "no-store"); assert.ok(c.init.signal instanceof AbortSignal); if (c.path.startsWith("/client/ai/")) assert.equal(c.workspaceId, "space-a"); }
  assert.equal(f.calls.some(c => /run|debug|publish|market/.test(c.path)), false);
});

test("select real Skill history versions, preserve ordered pins, cap 8 and recheck unavailable pins", async t => {
  const f = fixture(t); await f.store.start(); await fill(f);
  await f.store.selectSkill("guessed-id"); assert.equal(f.store.getSnapshot().selectedSkill, null);
  await f.store.selectSkill("skill-a"); f.store.addPin("guessed-version"); assert.deepEqual(f.store.getSnapshot().draft.skillBindings, []);
  f.store.addPin("skill-a-v1"); f.store.addPin("skill-a-v2"); assert.deepEqual(f.store.getSnapshot().draft.skillBindings, [{ skillId: "skill-a", revision: 1 }]);
  await f.store.selectSkill("skill-b"); f.store.addPin("skill-b-v2"); f.store.movePin(1, -1);
  assert.deepEqual(f.store.getSnapshot().draft.skillBindings, [{ skillId: "skill-b", revision: 2 }, { skillId: "skill-a", revision: 1 }]);
  f.store.movePin(0, -1); f.store.movePin(0, 3); assert.equal(f.store.getSnapshot().draft.skillBindings[0].skillId, "skill-b");
  await f.store.recheckPins(); assert.equal(f.store.readyToSave(), true);
  f.controls.override = ({ path }) => path === "/client/ai/skills/skill-a" ? response(null, 404) : undefined;
  await f.store.recheckPins(); assert.equal(f.store.getSnapshot().verifiedPins["skill-a:1"].available, false); assert.equal(f.store.readyToSave(), false);
  f.store.removePin(1); assert.equal(f.store.readyToSave(), true);
  // Supply real synthetic history pages for 9 distinct owned resources.
  f.controls.override = ({ path }) => path === "/client/ai/skills" ? response({ items: Array.from({ length: 9 }, (_,i) => skill({ id: `skill-${i}`, code: `skill-${i}` })), nextCursor: null }) : /\/skills\/skill-\d\/versions$/.test(path) ? response({ items: [{ ...skillVersion(1, path.split("/").at(-2)), code: path.split("/").at(-2) }], nextCursor: null }) : undefined;
  f.store.removePin(0); await f.store.loadSkills();
  for (let i=0; i<9; i++) { await f.store.selectSkill(`skill-${i}`); f.store.addPin(`skill-${i}-v1`); }
  assert.equal(f.store.getSnapshot().draft.skillBindings.length, 8);
});

test("compiled SDK sends ordered revision-only pins and current preview resolves immutable version names", async t => {
  const f=fixture(t); await f.store.start(); await fill(f);
  await f.store.selectSkill("skill-a"); f.store.addPin("skill-a-v1");
  await f.store.selectSkill("skill-b"); f.store.addPin("skill-b-v2"); f.store.movePin(1,-1);
  f.store.setDraft("enabled",true); f.store.setDraft("outputFormat","json"); f.store.setDraft("outputFields",["answer"]);
  f.store.requestSave(); await f.store.confirmMutation(); assert.equal(f.store.getSnapshot().issue,null);
  const sent=f.calls.find(c=>c.method==="POST"); assert.deepEqual(sent.body.skillBindings,[{skillId:"skill-b",revision:2},{skillId:"skill-a",revision:1}]);
  assert.equal(sent.body.enabled,true); assert.equal(sent.body.outputFormat,"json"); assert.equal(sent.body.outputFields[0],"answer");
  await f.store.openDetail("agent-a"); assert.equal(f.store.getSnapshot().detail.skillBindings[1].skillVersionId,"skill-a-v1"); assert.equal(f.store.getSnapshot().verifiedPins["skill-a:1"].name,"Synthetic skill-a v1");
  await f.store.loadVersions(); f.store.previewVersion("agent-v1"); assert.equal(f.store.getSnapshot().historical.skillBindings[0].skillVersionId,"skill-b-v2");
});

test("catalog changes never replace model or revision, explicit re-selection is required", async t => {
  const f = fixture(t); await f.store.start(); await fill(f); assert.equal(f.store.readyToSave(), true);
  f.controls.options = { catalogVersion: 4, items: [{ code: "other-model", name: "Other synthetic model", revision: 1, capability: "text" }] };
  await f.store.refreshModels(); assert.equal(f.store.getSnapshot().draft.modelCode, "safe-model"); assert.equal(f.store.getSnapshot().draft.catalogVersion, 3); assert.equal(f.store.readyToSave(), false);
  f.store.selectModel("guessed-model"); assert.equal(f.store.getSnapshot().draft.modelCode, "safe-model");
  f.store.selectModel("other-model"); assert.equal(f.store.readyToSave(), true); assert.equal(f.store.getSnapshot().draft.modelRevision, 1);
  f.controls.options = { catalogVersion: 5, items: [{ code: "other-model", name: "Other synthetic model", revision: 2, capability: "text" }] }; await f.store.refreshModels();
  assert.equal(f.store.getSnapshot().draft.modelRevision, 1); assert.equal(f.store.readyToSave(), false); f.store.selectModel("other-model"); assert.equal(f.store.readyToSave(), true);
  f.controls.options = { catalogVersion: 6, items: [] }; await f.store.refreshModels(); assert.equal(f.store.readyToSave(), false);
});

test("409 preserves draft but blocks overwrites; timeout never automatically retries a POST", async t => {
  const f = fixture(t); await f.store.start(); await f.store.openDetail("agent-a"); await f.store.openEdit(); f.store.setDraft("name", "Unsaved synthetic");
  f.controls.override = ({ method }) => method === "PATCH" ? response(null, 409) : undefined;
  f.store.requestSave(); await f.store.confirmMutation(); assert.equal(f.store.getSnapshot().issue.kind, "revision-conflict"); assert.equal(f.store.getSnapshot().draft.name, "Unsaved synthetic");
  f.store.requestSave(); await f.store.confirmMutation(); assert.equal(f.calls.filter(c => c.method === "PATCH").length, 1);
  f.controls.override = null; await f.store.openDetail("agent-a"); assert.equal(f.store.getSnapshot().draft.name, "");
  await fill(f); f.controls.override = ({ method }) => { if (method === "POST") throw new TypeError("Synthetic network result unknown: private text must not render"); };
  f.store.requestSave(); await f.store.confirmMutation(); assert.equal(f.calls.filter(c => c.method === "POST").length, 1); assert.match(f.store.getSnapshot().issue.message, /先刷新核对/); assert.equal(JSON.stringify(f.store.getSnapshot().issue).includes("private text"), false);
});

test("readonly own resources remain viewable; no-read/403/401/foreign404 clear all private data", async t => {
  const f = fixture(t, { permissions: [READ] }); await f.store.start(); await f.store.openDetail("agent-a"); await f.store.loadVersions();
  assert.ok(f.store.getSnapshot().versions.length); await f.store.openCreate(); await f.store.openEdit(); f.store.requestDelete(); await f.store.confirmMutation(); assert.equal(f.calls.some(c => c.method !== "GET"), false);
  f.controls.permissions = []; await f.store.refresh(); assert.equal(f.store.getSnapshot().detail, null); assert.deepEqual(f.store.getSnapshot().items, []);
  f.controls.permissions = [READ, MANAGE]; await f.store.refresh(); await fill(f);
  for (const status of [403, 401, 404]) {
    f.controls.override = null; await f.store.start(); await fill(f);
    f.controls.override = ({ path }) => path.endsWith("/agent-a") ? response(null, status) : undefined;
    await f.store.openDetail("agent-a"); const s=f.store.getSnapshot(); assert.equal(s.detail, null); assert.equal(s.draft.name, ""); assert.deepEqual(s.versions, []); assert.equal(s.issue.status, status);
    if (status === 401) { assert.equal(s.principal, null); assert.equal(f.unauthorized(), 1); }
  }
});

test("disabled/unconfigured/network/empty states are observed distinctly without guessed cause", async t => {
  const f = fixture(t); f.controls.override = ({ path }) => path === "/client/ai/personal-agents" ? response(null, 404) : undefined;
  await f.store.start(); assert.equal(f.store.getSnapshot().issue.kind, "unavailable"); assert.match(f.store.getSnapshot().issue.message, /可能/);
  f.controls.override = ({ path }) => path === "/client/ai/personal-agents" ? response({ items: [], nextCursor: null }) : undefined;
  await f.store.refresh(); assert.equal(f.store.getSnapshot().issue, null); assert.deepEqual(f.store.getSnapshot().items, []);
  f.controls.override = () => { throw new TypeError("Synthetic failure"); }; await f.store.refresh(); assert.equal(f.store.getSnapshot().issue.kind, "network");
  assert.equal(agentIssue({ status: 503 }).kind, "service-unavailable");
});

test("unconfigured page makes zero network requests", async t => {
  const f = fixture(t, { configured: false }); await f.store.start(); assert.equal(f.store.getSnapshot().issue.kind, "unconfigured"); assert.equal(f.calls.length, 0);
});

test("Agent/Skill list and version cursors are actual, ordered and scope-bound", async t => {
  const f = fixture(t);
  f.controls.override = ({ path, url }) => {
    const q = new URL(url).searchParams;
    if (path === "/client/ai/personal-agents") return response(q.has("afterId") ? { items: [agent({ id: "agent-z", revision: 15 })], nextCursor: null } : { items: Array.from({ length: 20 }, (_,i) => agent({ id: `agent-${String(i).padStart(2,"0")}`, revision: 15 })), nextCursor: "agent-19" });
    if (path === "/client/ai/personal-agents/agent-a") return response(agent({ revision: 15 }));
    if (path.endsWith("/agent-a/versions")) { const before=Number(q.get("beforeRevision") ?? 16); const items=Array.from({ length: Math.min(10,before-1) }, (_,i) => { const { updatedAt: _date, ...a }=agent({ id: `version-${before-1-i}`, revision: before-1-i }); void _date; return { ...a, agentId:"agent-a" }; }); return response({ items, nextCursor: items.length===10 ? items.at(-1).revision : null }); }
    if (path === "/client/ai/skills") return response(q.has("afterId") ? { items: [skill({ id:"skill-z", revision:15 })], nextCursor:null } : { items: Array.from({length:20},(_,i)=>skill({id:`skill-${String(i).padStart(2,"0")}`,revision:15})),nextCursor:"skill-19" });
    if (path.endsWith("/skill-z/versions")) { const before=Number(q.get("beforeRevision")??16);const items=Array.from({length:Math.min(10,before-1)},(_,i)=>({...skillVersion(before-1-i,"skill-z"),code:"my-skill"}));return response({items,nextCursor:items.length===10?items.at(-1).revision:null}); }
  };
  await f.store.start(); assert.equal(f.store.getSnapshot().nextCursor,"agent-19"); await f.store.nextPage(); assert.equal(f.store.getSnapshot().items[0].id,"agent-z");
  await f.store.openDetail("agent-a"); await f.store.loadVersions(); assert.equal(f.store.getSnapshot().versionCursor,6); await f.store.loadVersions(true); assert.equal(f.store.getSnapshot().versions[0].revision,5);
  await fill(f); await f.store.loadSkills(true); assert.equal(f.store.getSnapshot().skills[0].id,"skill-z"); await f.store.selectSkill("skill-z"); assert.equal(f.store.getSnapshot().skillVersionCursor,6); await f.store.loadSkillVersions(); assert.equal(f.store.getSnapshot().skillVersions[0].revision,5);
  assert.ok(f.calls.some(c=>c.url.includes("afterId=agent-19"))); assert.ok(f.calls.some(c=>c.url.includes("beforeRevision=6"))); assert.ok(f.calls.some(c=>c.url.includes("afterId=skill-19")));
});

test("malformed/foreign history response is refused rather than painted as own", async t => {
  const f=fixture(t);await f.store.start();await f.store.openDetail("agent-a");
  f.controls.override=({path})=>path.endsWith("/versions")?response({items:[{...agent(),agentId:"foreign-agent"}],nextCursor:null}):undefined;
  await f.store.loadVersions();assert.equal(f.store.getSnapshot().issue.kind,"invalid-response");assert.equal(f.store.getSnapshot().detail,null);assert.deepEqual(f.store.getSnapshot().versions,[]);
});

for (const operation of ["list", "get", "models", "skills", "skillVersions", "pinGet", "pinVersions", "agentVersions", "save"]) {
  for (const lateError of [false,true]) test(`late old ${operation} ${lateError?"rejection":"success"}, finally and busy cannot repaint a switched principal/space`, { timeout: 5000 }, async t=>{
    const f=fixture(t);await f.store.start("space-a");await f.store.openDetail("agent-a");await fill(f);
    if(operation==="pinGet"||operation==="pinVersions"){await f.store.selectSkill("skill-a");f.store.addPin("skill-a-v1");}
    if(operation==="agentVersions"){await f.store.openDetail("agent-a");}
    const hit=deferred(), release=deferred(); let blocked=false; t.after(() => release.resolve());
    const match=({path,method})=> operation==="list"?path==="/client/ai/personal-agents"&&method==="GET":operation==="get"?path.endsWith("/agent-a"):operation==="models"?path.endsWith("/model-options"):operation==="skills"?path==="/client/ai/skills":operation==="skillVersions"||operation==="pinVersions"?path.endsWith("/skill-a/versions"):operation==="pinGet"?path.endsWith("/skill-a"):operation==="agentVersions"?path.endsWith("/agent-a/versions"):method==="POST";
    f.controls.override=async c=>{if(!blocked&&c.workspaceId==="space-a"&&match(c)){blocked=true;hit.resolve();await release.promise;if(lateError)throw new TypeError("Synthetic old private error");return response(operation==="save"||operation==="get"?agent({name:"OLD PRIVATE"}):{items:[],nextCursor:null});}};
    let pending;
    if(operation==="list")pending=f.store.refresh();else if(operation==="get")pending=f.store.openDetail("agent-a");else if(operation==="models")pending=f.store.refreshModels();else if(operation==="skills")pending=f.store.loadSkills();else if(operation==="skillVersions")pending=f.store.selectSkill("skill-a");else if(operation==="pinGet"||operation==="pinVersions")pending=f.store.recheckPins();else if(operation==="agentVersions")pending=f.store.loadVersions();else{f.store.requestSave();pending=f.store.confirmMutation();}
    await Promise.race([hit.promise, pending.then(() => { if (!blocked) throw new Error("SYNTHETIC_BARRIER_NOT_REACHED"); })]);f.controls.principal="principal-b";await f.store.selectWorkspace("space-b");const before=JSON.stringify(f.store.getSnapshot());release.resolve();await pending;await flush();assert.equal(JSON.stringify(f.store.getSnapshot()),before);assert.equal(f.store.getSnapshot().principal.id,"principal-b");assert.equal(f.store.getSnapshot().workspaceId,"space-b");assert.equal(f.store.getSnapshot().busy,false);
  });
}

test("disposal/pagehide/visibility clears memory; late save cannot restore it; focus refresh revalidates",async t=>{
  const f=fixture(t);await f.store.start();await fill(f);const gate=deferred(),hit=deferred();
  f.controls.override=async({method})=>{if(method==="POST"){hit.resolve();await gate.promise;return response(agent());}};
  f.store.requestSave();const pending=f.store.confirmMutation();await hit.promise;f.store.dispose();gate.resolve();await pending;await flush();
  assert.equal(f.store.getSnapshot().principal,null);assert.equal(f.store.getSnapshot().draft.name,"");assert.deepEqual(f.store.getSnapshot().models,null);
  await f.store.refresh();assert.equal(f.store.getSnapshot().principal.id,"principal-a");assert.equal(f.store.getSnapshot().draft.name,"");
  await fill(f);await f.store.signOut();assert.equal(f.store.getSnapshot().principal,null);assert.equal(f.store.getSnapshot().draft.instructions,"");
});

test("timeout bounds dependent reads even if transport ignores signal",async t=>{
  const f=fixture(t,{timeoutMs:20});await f.store.start();await fill(f);f.controls.override=({path})=>path.endsWith("/model-options")?new Promise(()=>{}):undefined;
  const keepAlive=setTimeout(()=>{},100);t.after(()=>clearTimeout(keepAlive));await f.store.refreshModels();assert.equal(f.store.getSnapshot().busy,false);assert.equal(f.store.getSnapshot().issue.kind,"network");
});

test("source wiring has real factories, permission-gated navigation, bounded tables, lifecycle and no persistence",()=>{
  const ui=readFileSync(new URL("../../apps/web/app/components/client-agent-library.tsx",import.meta.url),"utf8"),state=readFileSync(new URL("../../apps/web/app/components/client-agent-library-state.mjs",import.meta.url),"utf8");
  assert.match(ui,/agentsClientFactory: createPersonalAgentsClient/);assert.match(ui,/skillsClientFactory: createPersonalSkillsClient/);assert.match(ui,/request: clientApi/);
  assert.match(ui,/pagehide/);assert.match(ui,/visibilitychange/);assert.match(ui,/"focus"/);assert.match(ui,/scroll=\{\{ x:/);assert.match(ui,/<Modal/);assert.match(ui,/Space wrap/);
  assert.doesNotMatch(ui+state,/localStorage|sessionStorage|indexedDB|sendBeacon|console\.|telemetry|journal/);
  const skillUi=readFileSync(new URL("../../apps/web/app/components/client-skill-library.tsx",import.meta.url),"utf8"),workbench=readFileSync(new URL("../../apps/web/app/components/client-ai-workbench.tsx",import.meta.url),"utf8");
  assert.match(skillUi,/canRead && <Link href=\{`\/client\/agents/);assert.match(workbench,/permissions.includes\("workspace.ai.assets.read"\) && <>.*\/client\/agents/);
});
