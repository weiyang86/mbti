// Offline synthetic transport only. This is compiled SDK/page-state proof, NOT PG/API acceptance.
import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import { createClientApi, createPersonalWorkflowsClient, validatePersonalWorkflowDraft } from "../../packages/sdk/dist/index.mjs";
import { createWorkflowLibrary, buildLinearWorkflow, parseWorkflow, parseWorkflowPage } from "../../apps/web/app/components/client-workflow-library-state.mjs";
const READ = "workspace.ai.assets.read", MANAGE = "workspace.ai.assets.manage", base = "/client/ai/personal-workflows";
const now = "2026-11-05T12:00:00.000Z", clone = structuredClone;
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const edge = (from,to,port="next",input="in") => ({ from,port,to,input });
export function complexGraph() { return validatePersonalWorkflowDraft({ schemaVersion: 1, inputKeys: ["question"], nodes: [
  { id: "start", type: "start" }, { id: "condition", type: "condition", predicate: { key: "question", op: "eq", valueType: "string", value: "private-condition" }, joinId: "conditionJoin" },
  { id: "parallel", type: "parallel", branches: ["left","right"], joinId: "parallelJoin" }, { id: "agent", type: "agent", agentId: "agent-a", revision: 1 },
  { id: "loop", type: "loop", maxIterations: 2, body: { nodes: [{ id: "loopStart", type: "start" }, { id: "approval", type: "human-approval", label: "Private approval label" }, { id: "loopEnd", type: "end" }], edges: [edge("loopStart","approval"),edge("approval","loopEnd")] } },
  { id: "parallelJoin", type: "join", forkId: "parallel" }, { id: "conditionJoin", type: "join", forkId: "condition" }, { id: "end", type: "end" }
], edges: [edge("start","condition"),edge("condition","parallel","true"),edge("condition","conditionJoin","false","false"),edge("parallel","agent","left"),edge("parallel","loop","right"),edge("agent","parallelJoin","next","left"),edge("loop","parallelJoin","next","right"),edge("parallelJoin","conditionJoin","next","true"),edge("conditionJoin","end")] }).graph; }
function workflow(graph = buildLinearWorkflow(["question"],[{ agentId: "agent-a", revision: 1 }]), extra = {}) {
  const v = validatePersonalWorkflowDraft(graph);
  return { id: "workflow-a", code: "draft-code", name: "Private workflow", revision: 1, graphDigest: createHash("sha256").update(v.canonical).digest("hex"), status: "DRAFT", structuralValidity: "VALID", createdAt: now, updatedAt: now, graph: clone(graph), agentBindings: v.agentRefs.map(p => ({ ...p, agentVersionId: `${p.agentId}-v${p.revision}` })), ...extra };
}
const toSummary = w => { return Object.fromEntries(Object.entries(w).filter(([k]) => !["graph","agentBindings"].includes(k))); };
const history = (w, full = true) => { const v = Object.fromEntries(Object.entries(full ? clone(w) : toSummary(w)).filter(([k]) => k !== "updatedAt")); return { ...v, id: `version-${w.revision}`, workflowId: w.id }; };
function fixture({ readonly = false, initial = null } = {}) {
  let current = clone(initial), versions = initial ? [clone(initial)] : [], fail = null, intercept = null;
  const calls = [], storage = [];
  const agent = { id: "agent-a", code: "own-agent", name: "Own Agent", enabled: true, revision: 2, createdAt: now, updatedAt: now };
  const agentVersion = revision => ({ id: `agent-a-v${revision}`, agentId: agent.id, code: agent.code, name: agent.name, enabled: true, revision, createdAt: now, instructions: "Private Agent instruction must never be retained", modelCode: "advice-text", modelRevision: 1, catalogVersion: 1, inputFields: ["question"], outputFormat: "text", outputFields: [], skillBindings: [] });
  const request = async (path, options = {}) => {
    calls.push({ path, ...options }); if (intercept) { const v = await intercept(path, options); if (v !== undefined) return v; }
    if (fail) throw fail;
    if (path === "/client/auth/me") return { id: "member-a", email: "member@example.test", nickname: "Synthetic member" };
    if (path.startsWith("/client/workspaces?")) return { page: 1, pageSize: 100, total: 2, items: ["space-a","space-b"].map(id => ({ membershipId: `membership-${id}`, joinedAt: now, workspace: { id, code: id, name: id, status: "active" }, role: { id: "role-a", code: "OWNER", name: "Owner" } })) };
    if (path === "/client/workspaces/context") return { workspaceId: options.workspaceId, workspaceCode: options.workspaceId, workspaceName: "Synthetic space", roleId: "role-a", roleCode: "OWNER", permissions: readonly ? [READ] : [READ,MANAGE], sessionGeneration: "a".repeat(64) };
    if (path === "/client/auth/logout") return { signedOut: true };
    if (path.startsWith("/client/ai/personal-agents?")) return { items: [clone(agent)], nextCursor: null };
    if (path.startsWith("/client/ai/personal-agents/agent-a/versions")) { const q = new URL(path, "http://fixture.test").searchParams, before = Number(q.get("beforeRevision") || 3), limit = Number(q.get("limit")); return { items: [2,1].filter(r => r < before).slice(0,limit).map(agentVersion), nextCursor: null }; }
    if (path.startsWith(base)) {
      if (options.workspaceId === "space-b") { if (path === base+"?limit=20") return {items:[],nextCursor:null}; throw {status:404}; }
      const url = new URL(path, "http://fixture.test"), body = options.body && JSON.parse(options.body), method = options.method || "GET";
      if (method === "POST") { if (current) { if (body.code !== current.code) throw { status: 409 }; return clone(current); } current = workflow(body.graph, { code: body.code, name: body.name }); versions.push(clone(current)); return clone(current); }
      if (method === "PATCH") { assert.equal(body.expectedRevision, current.revision); assert.deepEqual(body.graph, current.graph); if (body.name !== current.name) { current = { ...current, name: body.name, revision: current.revision+1 }; versions.push(clone(current)); } return clone(current); }
      if (method === "DELETE") { assert.equal(body.expectedRevision, current.revision); const deleted = { id: current.id, revision: current.revision, deleted: true }; current = null; return deleted; }
      if (url.pathname === base) return { items: current ? [toSummary(current)] : [], nextCursor: null };
      if (url.pathname.endsWith("/versions")) return { items: versions.slice().reverse().map(w => history(w,false)), nextCursor: null };
      if (/\/versions\/\d+$/.test(url.pathname)) { const w = versions.find(w => w.revision === Number(url.pathname.split("/").at(-1))); if (!w) throw { status: 404 }; return history(w); }
      if (!current) throw { status: 404 }; return clone(current);
    }
    assert.fail(`Unexpected fixture path ${path}`);
  };
  const store = createWorkflowLibrary({ request, timeoutMs: 100 });
  return { store, request, calls, agent, storage, current: () => current, fail: e => { fail = e; }, intercept: f => { intercept = f; }, writes: () => calls.filter(c => ["POST","PATCH","DELETE"].includes(c.method) && c.path.startsWith(base)) };
}
async function fill(f) { await f.store.start("space-a"); await f.store.openCreate(); f.store.setDraft("code","my-workflow"); f.store.setDraft("name","My workflow"); f.store.setDraft("inputKeys","question, context"); await f.store.selectAgent("agent-a"); }
function emptyPrivate(store) { const s = store.getSnapshot(); assert.deepEqual(s.items,[]); assert.equal(s.detail,null); assert.deepEqual(s.versions,[]); assert.equal(s.historical,null); assert.equal(s.editor,null); assert.equal(s.confirmation,null); assert.equal(s.draft.name,""); assert.equal(s.draft.code,""); assert.equal(s.draft.inputKeys,""); assert.deepEqual(s.draft.steps,[]); assert.deepEqual(s.agents,[]); assert.deepEqual(s.agentVersions,[]); assert.equal(s.replay,false); assert.equal(s.busy,false); }

test("compiled SDK builds meaningful ordered linear draft; explicit historical/current pins, reorder/remove and exact POST", async () => {
  const f = fixture(); await fill(f); assert.equal(f.store.readyToSave(),false); assert.deepEqual(f.store.getSnapshot().draft.steps,[]);
  assert.equal(JSON.stringify(f.store.getSnapshot()).includes("Private Agent instruction"),false);
  f.store.addStep(1); f.store.addStep(2); f.store.moveStep(1,-1); f.store.addStep(1); f.store.removeStep(2);
  assert.deepEqual(f.store.getSnapshot().draft.steps.map(p => p.revision),[2,1]);
  assert.equal(f.store.readyToSave(),true); f.store.requestSave(); assert.equal(f.store.getSnapshot().confirmation.kind,"create");
  await f.store.confirmMutation(); assert.equal(f.writes().length,1);
  const body = JSON.parse(f.writes()[0].body), graph = validatePersonalWorkflowDraft(body.graph).graph;
  assert.deepEqual(body,{ code:"my-workflow",name:"My workflow",graph });
  assert.deepEqual(graph.edges,[edge("start","step1"),edge("step1","step2"),edge("step2","end")]);
  assert.equal(graph.nodes.find(n => n.id === "step1").revision,2); assert.equal(graph.nodes.find(n => n.id === "step2").revision,1);
  assert.equal(f.store.getSnapshot().detail.status,"DRAFT"); f.store.dispose();
});
test("complex graph rename preserves all topology and exact pins; no-op, immutable history, CAS delete", async () => {
  const original = workflow(complexGraph()), f = fixture({ initial: original }); await f.store.start("space-a"); await f.store.openDetail(original.id);
  f.store.openEdit(); f.store.setDraft("inputKeys","tamper"); f.store.addStep(2); assert.deepEqual(f.store.getSnapshot().draft.steps,[]);
  f.store.setDraft("name","Renamed"); f.store.requestSave(); await f.store.confirmMutation();
  assert.deepEqual(JSON.parse(f.writes()[0].body),{ expectedRevision:1,name:"Renamed",graph:original.graph });
  f.store.openEdit(); f.store.requestSave(); await f.store.confirmMutation(); assert.equal(f.current().revision,2);
  await f.store.loadVersions(); assert.equal(f.store.getSnapshot().versions.length,2); await f.store.previewVersion(1);
  assert.equal(f.store.getSnapshot().historical.name,original.name); assert.equal(f.store.getSnapshot().detail.name,"Renamed");
  assert.deepEqual(f.store.getSnapshot().historical.graph,original.graph); assert.deepEqual(f.store.getSnapshot().historical.agentBindings,original.agentBindings);
  f.store.requestDelete(); assert.equal(f.store.getSnapshot().confirmation.revision,2); await f.store.confirmMutation();
  assert.deepEqual(JSON.parse(f.writes().at(-1).body),{ expectedRevision:2 }); assert.equal(f.store.getSnapshot().detail,null); assert.match(f.store.getSnapshot().notice,/墓碑/); f.store.dispose();
});
test("strict public shape, digest, graph and binding corruption rejected; no private extra fields projected", async () => {
  const w = workflow(complexGraph());
  await parseWorkflow(w);
  const corrupt = [x => { x.extra="secret"; },x => { x.graph.extra=true; },x => { x.graph.nodes[0].instructions="secret"; },x => { x.graph.edges[0].to="missing"; },x => { x.graphDigest="0".repeat(64); },x => { x.agentBindings=[]; },x => { x.agentBindings[0].revision=2; },x => { x.agentBindings[0].secret="private"; },x => { x.status="PUBLISHED"; },x => { x.name=" bad "; },x => { x.revision=2147483648; },x => { x.agentBindings.push(clone(x.agentBindings[0])); }];
  for (const edit of corrupt) { const v = clone(w); edit(v); await assert.rejects(parseWorkflow(v)); }
  assert.throws(() => parseWorkflowPage({ items:[toSummary(w)], nextCursor:w.id }));
  assert.throws(() => parseWorkflowPage({ items:[toSummary(w)], nextCursor:null, secret:"hidden" }));
  const p = history(w); await assert.rejects(parseWorkflow(p,{ parent:w, version:{...history(w,false),revision:2} }));
  const getter = clone(w); Object.defineProperty(getter,"name",{ enumerable:true,get(){ throw new Error("must not execute accessor"); } }); await assert.rejects(parseWorkflow(getter),e => e.message !== "must not execute accessor");
});
test("strict paginated list 20/cursor and immutable summaries; malformed/order/scope fail closed", () => {
  const items = Array.from({length:20},(_,i) => toSummary(workflow(undefined,{id:`workflow-${String(i).padStart(2,"0")}`})));
  assert.equal(parseWorkflowPage({items,nextCursor:items.at(-1).id}).items.length,20);
  assert.throws(() => parseWorkflowPage({items:items.slice().reverse(),nextCursor:null}));
  assert.throws(() => parseWorkflowPage({items,nextCursor:"wrong"}));
  assert.throws(() => parseWorkflowPage({items,nextCursor:null},{afterId:items[0].id}));
});
test("missing/foreign selector never falls back; read-only cannot construct mutation UI state or POST", async () => {
  const f = fixture(); await f.store.start(); assert.equal(f.store.getSnapshot().workspaceId,""); assert.equal(f.calls.some(c => c.path.startsWith(base)),false);
  await f.store.start("foreign"); emptyPrivate(f.store); assert.equal(f.store.getSnapshot().issue.status,403);
  const ro = fixture({readonly:true, initial:workflow()}); await ro.store.start("space-a"); await ro.store.openDetail("workflow-a"); await ro.store.loadVersions(); await ro.store.previewVersion(1);
  await ro.store.openCreate(); ro.store.openEdit(); ro.store.requestDelete(); ro.store.requestSave(); await ro.store.confirmMutation();
  assert.equal(ro.store.getSnapshot().editor,null); assert.equal(ro.store.getSnapshot().confirmation,null); assert.equal(ro.writes().length,0); ro.store.dispose(); f.store.dispose();
});
test("dependency current revision change or disabled/missing agent blocks create, never silently chooses latest", async () => {
  for (const change of [a => { a.revision=3; },a => { a.enabled=false; }]) {
    const f=fixture(); await fill(f); f.store.addStep(2); change(f.agent); f.store.requestSave(); await f.store.confirmMutation();
    assert.equal(f.writes().length,0); assert.equal(f.store.getSnapshot().blocked,true); assert.equal(f.store.getSnapshot().draft.steps[0].revision,2); f.store.dispose();
  }
  const f=fixture(); await fill(f); f.store.addStep(1); f.intercept(path => path.startsWith("/client/ai/personal-agents?") ? {items:[],nextCursor:null} : undefined);
  f.store.requestSave(); await f.store.confirmMutation(); assert.equal(f.writes().length,0); f.store.dispose();
});
test("network create retains exact identity only in RAM, explicit replay returns CURRENT; 409 requires reload", async () => {
  const f=fixture(); await fill(f); f.store.addStep(1);
  let drop=true; f.intercept((path,o) => { if(path===base && o.method==="POST" && drop) { drop=false; throw new Error("private transport error must not be shown"); } });
  f.store.requestSave(); await f.store.confirmMutation(); assert.equal(f.writes().length,1); assert.equal(f.store.getSnapshot().replay,true);
  f.store.setDraft("code","different"); assert.equal(f.store.getSnapshot().draft.code,"my-workflow"); await f.store.replayCreate(); assert.equal(f.writes().length,2); assert.equal(f.writes()[0].body,f.writes()[1].body);
  f.store.openEdit(); f.store.setDraft("name","CAS rename"); f.intercept((path,o) => { if(o.method==="PATCH") throw {status:409}; });
  f.store.requestSave(); await f.store.confirmMutation(); assert.equal(f.store.getSnapshot().blocked,true); assert.equal(f.store.getSnapshot().confirmation,null);
  f.store.requestSave(); await f.store.confirmMutation(); assert.equal(f.writes().filter(c => c.method==="PATCH").length,1); f.store.dispose();
});
test("all lifecycle barriers clear private state, suppress stale success/rejection/finally and prohibit old-scope HTTP writes", async t => {
  for (const event of ["scope","focus","visibility","pagehide","account","logout","dispose"]) for (const reject of [false,true]) await t.test(`${event} late ${reject ? "reject" : "success"}`,async () => {
    const f=fixture({initial:workflow(complexGraph())}); await f.store.start("space-a"); await f.store.openDetail("workflow-a"); await f.store.loadVersions(); await f.store.previewVersion(1); f.store.requestDelete();
    const gate=deferred(); f.intercept((path,o) => o.method==="DELETE" ? gate.promise : undefined);
    const pending=f.store.confirmMutation(); await new Promise(r => setImmediate(r)); const signal=f.writes()[0].signal;
    if(event==="scope") await f.store.selectWorkspace("space-b"); else if(event==="focus") await f.store.refresh(); else if(event==="account") await f.store.start(); else if(event==="logout") await f.store.signOut(); else f.store.dispose();
    assert.equal(signal.aborted,true); const snapshot=clone(f.store.getSnapshot()); if (reject) gate.reject({status:401}); else gate.resolve({id:"workflow-a",revision:1,deleted:true}); await pending;
    assert.deepEqual(f.store.getSnapshot(),snapshot); assert.equal(f.store.getSnapshot().confirmation,null); assert.equal(f.store.getSnapshot().historical,null); assert.equal(f.writes().length,1); f.store.dispose(); emptyPrivate(f.store);
  });
  const f=fixture(); await fill(f); f.store.addStep(1); const gate=deferred(); f.intercept(path => path.startsWith("/client/ai/personal-agents?") ? gate.promise : undefined);
  f.store.requestSave(); const pending=f.store.confirmMutation(); await new Promise(r => setImmediate(r)); f.store.dispose(); gate.resolve({items:[f.agent],nextCursor:null}); await pending; assert.equal(f.writes().length,0); emptyPrivate(f.store);
});

test("a rejected create can be corrected; later ambiguous POST replays the corrected identity exactly", async () => {
  const f=fixture();await fill(f);f.store.addStep(1);let mode="invalid";
  f.intercept((path,o)=>{if(path===base&&o.method==="POST"){if(mode==="invalid")throw {status:400};if(mode==="lost")throw new Error("lost");}});
  f.store.requestSave();await f.store.confirmMutation();assert.equal(f.store.getSnapshot().replay,false);
  f.store.setDraft("code","corrected-code");f.store.setDraft("name","Corrected name");mode="lost";f.store.requestSave();await f.store.confirmMutation();assert.equal(f.store.getSnapshot().replay,true);
  mode="success";await f.store.replayCreate();assert.equal(f.writes()[1].body,f.writes()[2].body);assert.equal(JSON.parse(f.writes()[2].body).code,"corrected-code");f.store.dispose();
});
test("dependency read failure before POST has no create replay identity; malformed authority clears all private fields", async () => {
  const f=fixture(); await fill(f); f.store.addStep(1); f.intercept(path => { if(path.startsWith("/client/ai/personal-agents?")) throw {status:503}; });
  f.store.requestSave(); await f.store.confirmMutation(); assert.equal(f.writes().length,0); assert.equal(f.store.getSnapshot().replay,false); await f.store.replayCreate(); assert.equal(f.writes().length,0); f.store.dispose();
  for(const route of ["/client/auth/me","/client/workspaces?","/client/workspaces/context"]) {
    const g=fixture({initial:workflow()}); await g.store.start("space-a"); await g.store.openDetail("workflow-a"); g.intercept(path => path.startsWith(route) ? {id:"forged",secret:"private extra field"} : undefined);
    await g.store.refresh(); emptyPrivate(g.store); assert.match(g.store.getSnapshot().issue.message,/响应/); assert.equal(g.store.getSnapshot().context,null); g.store.dispose();
  }
});
test("every asynchronous read stage aborts on scope reset, including late rejection and timeout finally", async t => {
  const cases=[
    {name:"identity",path:"/client/auth/me",op:s=>s.start("space-a"),raw:{id:"member-a",email:"x@example.test",nickname:"member"}},
    {name:"membership",path:"/client/workspaces?",op:s=>s.start("space-a"),raw:{}},
    {name:"context",path:"/client/workspaces/context",op:s=>s.start("space-a"),raw:{}},
    {name:"summary",path:base+"?",op:s=>s.refresh(),raw:{items:[],nextCursor:null}},
    {name:"detail",path:base+"/workflow-a",op:s=>s.openDetail("workflow-a"),raw:workflow()},
    {name:"saved-agent-summary",path:"/client/ai/personal-agents?",op:s=>s.openDetail("workflow-a"),raw:{items:[],nextCursor:null}},
    {name:"history-list",path:base+"/workflow-a/versions?",op:s=>s.loadVersions(),raw:{items:[],nextCursor:null}},
    {name:"historical-graph",path:base+"/workflow-a/versions/1",op:s=>s.previewVersion(1),raw:history(workflow())},
    {name:"builder-agent-summary",path:"/client/ai/personal-agents?",op:s=>s.openCreate(),raw:{items:[],nextCursor:null}},
    {name:"agent-owned-versions",path:"/client/ai/personal-agents/agent-a/versions?",op:s=>s.selectAgent("agent-a"),raw:{items:[],nextCursor:null}}
  ];
  for(const c of cases) for(const reject of [false,true]) await t.test(`${c.name} late ${reject?"rejection":"success"}`,async()=>{
    const f=fixture({initial:workflow()}); await f.store.start("space-a"); await f.store.openDetail("workflow-a"); await f.store.loadVersions(); if(c.name==="agent-owned-versions") await f.store.openCreate();
    const gate=deferred(), reached=deferred(); f.intercept(path => { if(path.startsWith(c.path)) { reached.resolve(); return gate.promise; } }); const pending=c.op(f.store); await reached.promise;
    const call=f.calls.at(-1); f.store.dispose(); assert.equal(call.signal.aborted,true); if(reject)gate.reject({status:403});else gate.resolve(c.raw);await pending;emptyPrivate(f.store);
  });
});
test("timeout bounds a transport ignoring AbortSignal; late read cannot repopulate data", async () => {
  const gate=deferred(), f=fixture({initial:workflow()}); await f.store.start("space-a"); f.intercept(path => path===base+"/workflow-a" ? gate.promise : undefined);
  const pending=f.store.openDetail("workflow-a"); const keepAlive=setTimeout(()=>{},200); await pending; clearTimeout(keepAlive); assert.equal(f.store.getSnapshot().busy,false); assert.equal(f.store.getSnapshot().detail,null); gate.resolve(workflow()); await new Promise(r=>setImmediate(r)); assert.equal(f.store.getSnapshot().detail,null); f.store.dispose();
});
test("compiled clientApi + real SDK use owned synthetic loopback only, cookie/no-store/workspace headers and canonical graph", async t => {
  const requests=[], server=createServer(async (req,res) => { let body=""; for await(const part of req) body+=part; requests.push({url:req.url,headers:req.headers,body}); res.setHeader("content-type","application/json"); res.end(JSON.stringify({success:true,data:workflow(JSON.parse(body).graph),message:"ok"})); });
  await new Promise(r => server.listen(0,"127.0.0.1",r)); t.after(() => new Promise(r=>{server.closeAllConnections();server.close(r);}));
  const sdk=createPersonalWorkflowsClient(createClientApi(()=>`http://127.0.0.1:${server.address().port}`));
  const result=await sdk.create("space-a",{code:"draft-code",name:"Private workflow",graph:buildLinearWorkflow(["question"],[{agentId:"agent-a",revision:1}])}); await parseWorkflow(result);
  assert.equal(requests.length,1); assert.equal(requests[0].headers["x-aij-workspace-id"],"space-a"); assert.equal(requests[0].url,base); assert.equal(JSON.parse(requests[0].body).graph.nodes.length,3);
});
test("storage0, lifecycle wiring, conditional modal, ordinary fields and accessible bounded SVG render", async () => {
  const stateSource=readFileSync(new URL("../../apps/web/app/components/client-workflow-library-state.mjs",import.meta.url),"utf8"), ui=readFileSync(new URL("../../apps/web/app/components/client-workflow-library.tsx",import.meta.url),"utf8");
  assert.doesNotMatch(stateSource,/localStorage|sessionStorage|indexedDB|console\.|setInterval|fetch\(/); assert.doesNotMatch(ui,/localStorage|sessionStorage|dangerouslySetInnerHTML|JSON\.stringify/);
  for(const event of ["pagehide","pageshow","focus","visibilitychange"]) assert.ok(ui.includes(`addEventListener("${event}"`));
  assert.match(ui,/state\.confirmation && <Modal/); assert.match(ui,/onCancel=\{cancel\}/); assert.match(ui,/element\?\.isConnected/); assert.match(ui,/\.focus\(\)/); assert.match(ui,/aria-label="工作流名称"/); assert.match(ui,/aria-label="草稿步骤顺序"/);
  const require=createRequire(new URL("../../apps/web/package.json",import.meta.url));
  const source=readFileSync(new URL("../../apps/web/app/components/client-workflow-graph-preview.tsx",import.meta.url),"utf8");
  const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  const module={exports:{}}; new Function("require","module","exports",compiled)(require,module,module.exports);
  const React=require("react"), {renderToStaticMarkup}=require("react-dom/server");
  const html=renderToStaticMarkup(React.createElement(module.exports.ClientWorkflowGraphPreview,{graph:complexGraph(),bindings:workflow(complexGraph()).agentBindings,agents:[]}));
  for(const word of ["只读","开始","结束","Agent","条件","并行分支","汇合","有限循环","人工审批占位","private-condition","true","left","approval"]) assert.ok(html.includes(word),word);
  assert.match(html,/overflow:auto/); assert.match(html,/role="region"/); assert.doesNotMatch(html,/<script|<image|foreignObject|id="(?:agent|loop|condition)/);
});


test("original library accepts current64hex session generation and refuses missing/malformed/unknown context fields", async () => {
  const f=fixture();await f.store.start("space-a");assert.equal(f.store.getSnapshot().context.sessionGeneration,"a".repeat(64));
  for(const patch of [{sessionGeneration:undefined},{sessionGeneration:"a".repeat(63)},{sessionGeneration:"G".repeat(64)},{privateExtra:"secret"}]){
    const g=fixture();g.intercept(path=>path==="/client/workspaces/context"?{workspaceId:"space-a",workspaceCode:"space-a",workspaceName:"Synthetic space",roleId:"role-a",roleCode:"OWNER",permissions:[READ,MANAGE],sessionGeneration:"a".repeat(64),...patch}:undefined);
    await g.store.start("space-a");assert.equal(g.store.getSnapshot().context,null);assert.match(g.store.getSnapshot().issue.message,/响应/);g.store.dispose();
  }f.store.dispose();
});
