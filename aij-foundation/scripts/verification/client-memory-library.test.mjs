// Offline synthetic transport with actual compiled public SDK; never database/API evidence.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createClientApi, createPersonalMemoriesClient, createPersonalAgentsClient, ClientRequestFailure } from "../../packages/sdk/dist/index.mjs";
import { createMemoryLibrary, validMemoryDraft, memoryIssue } from "../../apps/web/app/components/client-memory-library-state.mjs";
const READ = "workspace.ai.assets.read", MANAGE = "workspace.ai.assets.manage";
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; };
const tick = () => new Promise(r => setImmediate(r));
const fail = status => new ClientRequestFailure(status);
const date = "2026-11-05T00:00:00.000Z";
const memory = (extra = {}) => ({ id: "m01", code: "my-memory", title: "Private title", content: "Private confirmed content", kind: "confirmed_fact", enabled: false, agentIds: [], revision: 1, createdAt: date, updatedAt: date, ...extra });
const agent = (extra = {}) => ({ id: "a01", code: "my-agent", name: "Own Agent name", enabled: false, ...extra });
function fixture({ permissions = [READ,MANAGE], handler, timeoutMs = 3000, configured, unauthorized } = {}) {
  const calls = []; let rows = [memory()], deleted = false;
  const request = async (path, options = {}) => {
    calls.push({ path, ...options });
    const override = await handler?.(path, options, calls); if (override !== undefined) return override;
    if (path === "/client/auth/me") return { id: "owner", nickname: "Owner" };
    if (path.startsWith("/client/workspaces?")) return { items: ["w1","w2"].map(id => ({ workspace: { id, name: id }, role: { name: "Synthetic role" } })) };
    if (path === "/client/workspaces/context") return { workspaceId: options.workspaceId, workspaceName: options.workspaceId, permissions };
    if (path === "/client/auth/logout") return {};
    if (path.startsWith("/client/ai/personal-agents")) {
      if (path.endsWith("/a01")) return agent();
      if (/personal-agents\/[^?]+$/.test(path)) throw fail(404);
      return { items: [agent()], nextCursor: null };
    }
    const body = options.body ? JSON.parse(options.body) : null;
    if (options.method === "POST") { if (deleted) throw fail(409); rows = [memory(body)]; return rows[0]; }
    if (options.method === "PATCH") { if (body.expectedRevision !== rows[0].revision) throw fail(409); const {expectedRevision, ...fields} = body; rows = [memory({ ...rows[0], ...fields, revision: expectedRevision+1 })]; return rows[0]; }
    if (options.method === "DELETE") { deleted = true; const result = { id: "m01", deleted: true, revision: rows[0].revision+1 }; rows = []; return result; }
    if (/personal-memories\/[^?]+$/.test(path)) { if (!rows.length) throw fail(404); return rows[0]; }
    return { items: rows.map(({content: _content, agentIds: _agents, ...s}) => { void _content; void _agents; return s; }), nextCursor: null };
  };
  const store = createMemoryLibrary({ request, memoriesClientFactory: createPersonalMemoriesClient, agentsClientFactory: createPersonalAgentsClient, timeoutMs, configured, onUnauthorized: unauthorized });
  return { store, calls };
}
const fill = s => { for (const [k,v] of Object.entries({code:"new-memory",title:"New title",content:"New content",kind:"preference"})) s.setDraft(k,v); };
const assertCleared = s => {
  const v = s.getSnapshot();
  for (const key of ["items","agents"]) assert.deepEqual(v[key],[]);
  for (const key of ["detail","editor","confirmation"]) assert.equal(v[key],null);
  assert.deepEqual(v.grants,{}); assert.equal(v.draft.title,""); assert.equal(v.draft.content,""); assert.deepEqual(v.draft.agentIds,[]); assert.equal(v.notice,"");
};

test("compiled SDK defaults, canonical grants, replacement omission, validation and exact CAS", async () => {
  const calls=[]; const api=createPersonalMemoriesClient(async(path,options)=>{calls.push({path,...options});return {};});
  const {id:_id,revision:_revision,createdAt:_createdAt,updatedAt:_updatedAt,enabled:_enabled,agentIds:_agentIds,...input}=memory(); void _id;void _revision;void _createdAt;void _updatedAt;void _enabled;void _agentIds;
  await api.create("w1",input); assert.equal(JSON.parse(calls.at(-1).body).enabled,false);assert.deepEqual(JSON.parse(calls.at(-1).body).agentIds,[]);
  await api.create("w1",{...input,enabled:true,agentIds:["z","a"]});assert.deepEqual(JSON.parse(calls.at(-1).body).agentIds,["a","z"]);
  const {code:_code,...update}=input;void _code;
  await api.update("w1","m01",{...update,expectedRevision:7});assert.deepEqual(JSON.parse(calls.at(-1).body),{...update,enabled:false,agentIds:[],expectedRevision:7});
  await api.delete("w1","m01",7);assert.deepEqual(JSON.parse(calls.at(-1).body),{expectedRevision:7});
  for(const bad of [{agentIds:["a","a"]},{agentIds:Array.from({length:17},(_,i)=>"a"+i)},{enabled:"true"},{content:" "},{title:"x".repeat(101)},{kind:"inferred"},{content:"\ud800"}])assert.throws(()=>api.create("w1",{...input,...bad}));
  assert.throws(()=>api.update("w1","m01",{...update,expectedRevision:0}));
  assert.throws(()=>api.create("w1",{...input,workspaceId:"foreign"}));
});

test("actual clientApi transport includes Cookie/no-store/header and AbortSignal without leaking content", async () => {
  const original=globalThis.fetch;let captured;
  globalThis.fetch=async(url,options)=>{captured={url,...options};return new Response(JSON.stringify({success:true,data:{items:[],nextCursor:null},message:"ok"}),{status:200});};
  try{const controller=new AbortController();const transport=createClientApi(()=>"http://127.0.0.1:12345/api");await createPersonalMemoriesClient((path,options)=>transport(path,{...options,signal:controller.signal})).list("w1",{limit:20,afterId:"m01"});assert.equal(captured.credentials,"include");assert.equal(captured.cache,"no-store");assert.equal(captured.headers.get("x-aij-workspace-id"),"w1");assert.equal(captured.signal,controller.signal);assert.equal(captured.body,undefined);assert.ok(captured.url.endsWith("?limit=20&afterId=m01"));}finally{globalThis.fetch=original;}
});

test("verify me/workspaces/context before summary only; no eager body or Agent fetch",async()=>{
  const {store:s,calls}=fixture();await s.start("w2");assert.deepEqual(calls.map(c=>c.path),["/client/auth/me","/client/workspaces?page=1&pageSize=100","/client/workspaces/context","/client/ai/personal-memories?limit=20"]);assert.equal(calls[2].workspaceId,"w2");assert.equal(s.getSnapshot().items[0].content,undefined);assert.equal(s.getSnapshot().items[0].agentIds,undefined);s.dispose();
});

test("create opt-in NONE, named disabled Agent preauthorization, confirm once, current detail, revoke and erase",async()=>{
  const {store:s,calls}=fixture();await s.start();await s.openCreate();assert.equal(s.getSnapshot().draft.enabled,false);assert.deepEqual(s.getSnapshot().draft.agentIds,[]);fill(s);s.addGrant("foreign");assert.deepEqual(s.getSnapshot().draft.agentIds,[]);s.addGrant("a01");s.addGrant("a01");s.setDraft("enabled",true);assert.equal(s.getSnapshot().grants.a01.name,"Own Agent name");assert.equal(s.getSnapshot().grants.a01.enabled,false);s.requestSave();assert.equal(s.getSnapshot().confirmation,"create");s.setDraft("content","blocked");assert.equal(s.getSnapshot().draft.content,"New content");assert.equal(calls.filter(x=>x.method==="POST").length,0);await s.confirmMutation();assert.equal(calls.filter(x=>x.method==="POST").length,1);await s.confirmMutation();assert.equal(calls.filter(x=>x.method==="POST").length,1);
  await s.openDetail("m01");assert.equal(s.getSnapshot().detail.content,"New content");await s.openEdit();s.removeGrant("a01");s.setDraft("enabled",false);s.requestSave();s.cancelConfirmation();assert.equal(s.getSnapshot().confirmation,null);s.requestSave();await s.confirmMutation();const sent=JSON.parse(calls.find(x=>x.method==="PATCH").body);assert.equal(sent.expectedRevision,1);assert.equal(sent.enabled,false);assert.deepEqual(sent.agentIds,[]);
  await s.openDetail("m01");s.requestDelete();assert.equal(s.getSnapshot().confirmation,"delete");assert.equal(s.getSnapshot().draft.content,"");await s.confirmMutation();assert.deepEqual(JSON.parse(calls.find(x=>x.method==="DELETE").body),{expectedRevision:2});assert.equal(s.getSnapshot().items.length,0);assert.match(s.getSnapshot().notice,/无法恢复/);s.dispose();assertCleared(s);
});

for(const permissions of [[],[MANAGE],[READ]])test(`permission gate ${permissions.join("+")||"none"}`,async()=>{
  const {store:s,calls}=fixture({permissions});await s.start();await s.openCreate();s.requestSave();s.requestDelete();await s.confirmMutation();assert.equal(s.getSnapshot().editor,null);assert.equal(calls.some(c=>["POST","PATCH","DELETE"].includes(c.method)),false);
  if(permissions.includes(READ)){await s.openDetail("m01");assert.ok(s.getSnapshot().detail);assert.equal(calls.filter(c=>c.path.includes("personal-memories")).length,2);}else assert.equal(calls.some(c=>c.path.includes("personal-memories")),false);s.dispose();
});

test("unavailable saved grant has no invented identity and requires removal; only own paginated choices",async()=>{
  const {store:s}=fixture({handler:(path)=>path.endsWith("/m01")?memory({enabled:true,agentIds:["gone"]}):undefined});await s.start();await s.openDetail("m01");assert.deepEqual(s.getSnapshot().grants.gone,{available:false});await s.openEdit();assert.equal(s.readyToSave(),false);s.removeGrant("gone");assert.equal(s.readyToSave(),true);s.addGrant("a01");assert.equal(s.readyToSave(),true);s.dispose();
});

for(const status of [400,401,403,404,409,503])test(`mutation ${status} has safe feedback, no retry and private draft removed`,async()=>{
  const {store:s,calls}=fixture({handler:(_p,o)=>{if(o.method==="PATCH")throw fail(status);}});await s.start();await s.openDetail("m01");await s.openEdit();s.setDraft("content","change");s.requestSave();await s.confirmMutation();assert.equal(s.getSnapshot().issue.status,status);assert.equal(s.getSnapshot().confirmation,null);assert.equal(s.getSnapshot().draft.content,"");await s.confirmMutation();assert.equal(calls.filter(x=>x.method==="PATCH").length,1);if(status===409)assert.match(s.getSnapshot().issue.message,/重新读取/);if([401,403].includes(status))assertCleared(s);s.dispose();
});

test("mutation confirmed then list fails preserves partial outcome and never invites resubmit",async()=>{
  let written=false;const {store:s,calls}=fixture({handler:(p,o)=>{if(o.method==="POST"){written=true;return memory({code:"new-memory",title:"New title",content:"New content",kind:"preference"});}if(written&&p.endsWith("?limit=20"))throw fail(503);}});await s.start();await s.openCreate();fill(s);s.requestSave();await s.confirmMutation();assert.match(s.getSnapshot().notice,/已确认保存/);assert.match(s.getSnapshot().issue.message,/写入已确认/);assert.equal(s.getSnapshot().draft.content,"");assert.equal(calls.filter(x=>x.method==="POST").length,1);s.dispose();
});

test("create replay may return current changed state; no overwrite or guessed grants",async()=>{
  const {store:s,calls}=fixture({handler:(_p,o)=>o.method==="POST"?memory({code:"new-memory",revision:9,title:"Previously changed",content:"Current server body",agentIds:["a01"]}):undefined});await s.start();await s.openCreate();fill(s);s.requestSave();await s.confirmMutation();assert.equal(s.getSnapshot().detail,null);assert.match(s.getSnapshot().notice,/相同编号/);assert.equal(calls.some(c=>c.method==="PATCH"),false);s.dispose();
});

test("20 row cursor list and Agent options use real next cursor without fetching all details",async()=>{
  const memories=Array.from({length:20},(_,i)=>memory({id:`m${String(i).padStart(2,"0")}`}));const agents=Array.from({length:20},(_,i)=>agent({id:`a${String(i).padStart(2,"0")}`}));
  const {store:s,calls}=fixture({handler:(p)=>{if(p.includes("personal-memories?")&&!p.includes("afterId"))return {items:memories,nextCursor:"m19"};if(p.includes("personal-memories?")&&p.includes("afterId"))return {items:[memory({id:"m20"})],nextCursor:null};if(p.includes("personal-agents?")&&!p.includes("afterId"))return {items:agents,nextCursor:"a19"};if(p.includes("personal-agents?")&&p.includes("afterId"))return {items:[agent({id:"a20",name:"Next named Agent"})],nextCursor:null};}});
  await s.start();await s.nextPage();assert.equal(s.getSnapshot().items[0].id,"m20");assert.ok(calls.some(c=>c.path.endsWith("afterId=m19")));await s.openCreate();fill(s);s.addGrant("a00");await s.loadAgents(true);assert.equal(s.getSnapshot().agents[0].name,"Next named Agent");assert.ok(calls.some(c=>c.path.endsWith("afterId=a19")));s.addGrant("a20");assert.deepEqual(s.getSnapshot().draft.agentIds,["a00","a20"]);assert.equal(calls.filter(c=>c.path.includes("personal-memories/")).length,0);s.dispose();
});

for(const operation of ["me","workspaces","context","list","detail","grant","options","next-options","next-list","create","update","delete","logout"]){
  for(const late of ["resolve","reject"])test(`old scope ${operation} late ${late} and finally cannot repopulate after disposal/new scope`,async()=>{
    const gate=deferred();let armed=false,hit=false;
    const matches=(p,o)=>operation==="me"?p.endsWith("/me"):operation==="workspaces"?p.includes("workspaces?"):operation==="context"?p.endsWith("/context"):operation==="list"?p.includes("personal-memories?"):operation==="detail"?p.endsWith("/m01"):operation==="grant"?p.endsWith("/a01"):operation==="options"?p.includes("personal-agents?"):operation==="next-options"?p.includes("personal-agents?")&&p.includes("afterId"):operation==="next-list"?p.includes("personal-memories?")&&p.includes("afterId"):operation==="logout"?p.endsWith("/logout"):o.method===({create:"POST",update:"PATCH",delete:"DELETE"}[operation]);
    const {store:s}=fixture({handler:(p,o)=>{if(armed&&!hit&&matches(p,o)){hit=true;return gate.promise;}if(operation==="grant"&&p.endsWith("/m01"))return memory({agentIds:["a01"]});if(operation==="next-list"&&p.includes("personal-memories?"))return {items:Array.from({length:20},(_,i)=>memory({id:`m${String(i).padStart(2,"0")}`})),nextCursor:"m19"};if(operation==="next-options"&&p.includes("personal-agents?"))return {items:Array.from({length:20},(_,i)=>agent({id:`a${String(i).padStart(2,"0")}`})),nextCursor:"a19"};}});
    let pending;
    if(["me","workspaces","context","list"].includes(operation)){armed=true;pending=s.start();}
    else{await s.start();if(["create","options","next-options"].includes(operation)){if(operation==="options"){armed=true;pending=s.openCreate();}else{await s.openCreate();fill(s);armed=true;if(operation==="create"){s.requestSave();pending=s.confirmMutation();}else pending=s.loadAgents(true);}}
      else if(["update","delete"].includes(operation)){await s.openDetail("m01");if(operation==="update"){await s.openEdit();s.setDraft("content","change");s.requestSave();}else s.requestDelete();armed=true;pending=s.confirmMutation();}
      else{armed=true;pending=operation==="next-list"?s.nextPage():operation==="logout"?s.signOut():s.openDetail("m01");}}
    for(let i=0;i<20&&!hit;i++)await tick();assert.equal(hit,true);s.dispose();assertCleared(s);await s.start("w2");const before=s.getSnapshot();if(late==="resolve")gate.resolve(memory({content:"STALE PRIVATE"}));else gate.reject(fail(401));await pending;await tick();assert.equal(s.getSnapshot(),before);assert.equal(s.getSnapshot().workspaceId,"w2");assert.equal(s.getSnapshot().busy,false);s.dispose();
  });
}

test("request timeout settles busy state even if transport ignores AbortSignal; late result ignored",async()=>{
  const gate=deferred();const {store:s}=fixture({timeoutMs:15,handler:p=>p.endsWith("/m01")?gate.promise:undefined});await s.start();const keepAlive=setTimeout(()=>{},100);try{await s.openDetail("m01");assert.equal(s.getSnapshot().issue.kind,"timeout");assert.equal(s.getSnapshot().busy,false);const before=s.getSnapshot();gate.resolve(memory());await tick();assert.equal(s.getSnapshot(),before);}finally{clearTimeout(keepAlive);s.dispose();}
});

test("unconfigured, empty, network, malformed, missing space are distinct safe states",async()=>{
  const a=fixture({configured:()=>false});await a.store.start();assert.equal(a.calls.length,0);assert.equal(a.store.getSnapshot().issue.kind,"unconfigured");a.store.dispose();
  const b=fixture({handler:p=>p.includes("personal-memories?")?{items:[],nextCursor:null}:undefined});await b.store.start();assert.equal(b.store.getSnapshot().issue,null);assert.deepEqual(b.store.getSnapshot().items,[]);b.store.dispose();
  const c=fixture({handler:p=>{if(p.includes("personal-memories?"))throw new Error("PRIVATE SECRET");}});await c.store.start();assert.equal(c.store.getSnapshot().issue.kind,"network");assert.equal(JSON.stringify(c.store.getSnapshot()).includes("PRIVATE SECRET"),false);c.store.dispose();
  const d=fixture({handler:p=>p.includes("personal-memories?")?{items:[{}],nextCursor:null}:undefined});await d.store.start();assert.equal(d.store.getSnapshot().issue.kind,"invalid-response");d.store.dispose();
  const e=fixture();await e.store.start("foreign-space");assert.equal(e.store.getSnapshot().issue.kind,"space-unavailable");assert.equal(e.calls.some(x=>x.path.includes("personal-memories")),false);e.store.dispose();
});

test("source privacy/conditional modal/permission-only navigation and no injection dependency",()=>{
  const ui=readFileSync(new URL("../../apps/web/app/components/client-memory-library.tsx",import.meta.url),"utf8");const state=readFileSync(new URL("../../apps/web/app/components/client-memory-library-state.mjs",import.meta.url),"utf8");
  assert.match(ui,/\{state.confirmation && <Modal/);assert.match(ui,/scroll=\{\{ x: 640 \}\}/);assert.match(ui,/window.addEventListener\("focus", resume\)/);assert.match(ui,/visibilitychange/);assert.match(ui,/pagehide/);assert.match(ui,/adminTheme/);assert.match(ui,/PageHeading/);
  for(const source of [ui,state])assert.doesNotMatch(source,/localStorage|sessionStorage|console\.|indexedDB|sendBeacon|telemetry|AF.?167|journal|\/versions|restoreVersion/);
  const workbench=readFileSync(new URL("../../apps/web/app/components/client-ai-workbench.tsx",import.meta.url),"utf8");assert.match(workbench,/assets.read[\s\S]*?client\/memories/);assert.match(ui,/不可恢复|无法恢复/);
  assert.equal(validMemoryDraft(memory()),true);assert.equal(validMemoryDraft(memory({agentIds:["a","a"]})),false);assert.match(memoryIssue(fail(409),"update").message,/不会自动覆盖/);
});

// These cases target consequences of the shared timeout/epoch mechanism, rather than mirroring it.
test("16 unique named own grants maximum and canonical full-field submit",async()=>{
  const choices=Array.from({length:20},(_,i)=>agent({id:`a${String(i).padStart(2,"0")}`,name:`Own named ${i}`}));
  let sent;
  const {store:s}=fixture({handler:(p,o)=>{if(p.includes("personal-agents?"))return {items:choices,nextCursor:null};if(o.method==="POST"){sent=JSON.parse(o.body);return memory({...sent});}}});
  await s.start();await s.openCreate();fill(s);for(const a of [...choices].reverse())s.addGrant(a.id);assert.equal(s.getSnapshot().draft.agentIds.length,16);s.addGrant(choices[19].id);assert.equal(s.getSnapshot().draft.agentIds.length,16);assert.deepEqual(s.getSnapshot().draft.agentIds,[...s.getSnapshot().draft.agentIds].sort());s.requestSave();await s.confirmMutation();assert.deepEqual(Object.keys(sent).sort(),["code","title","content","kind","enabled","agentIds"].sort());assert.equal(sent.agentIds.length,16);s.dispose();
});

for(const operation of ["create","update","delete"])test(`unknown ${operation} timeout requires re-read and cannot retry`,async()=>{
  const gate=deferred();const method={create:"POST",update:"PATCH",delete:"DELETE"}[operation];let calls=0;
  const {store:s}=fixture({timeoutMs:15,handler:(_p,o)=>{if(o.method===method){calls++;return gate.promise;}}});await s.start();
  if(operation==="create"){await s.openCreate();fill(s);s.requestSave();}else{await s.openDetail("m01");if(operation==="update"){await s.openEdit();s.setDraft("content","change");s.requestSave();}else s.requestDelete();}
  const timer=setTimeout(()=>{},100);try{await s.confirmMutation();assert.equal(s.getSnapshot().issue.kind,"timeout");assert.match(s.getSnapshot().issue.message,/写入结果未确认/);assert.equal(s.getSnapshot().busy,false);assert.equal(s.getSnapshot().detail,null);assert.equal(s.getSnapshot().draft.content,"");await s.openCreate();assert.equal(s.getSnapshot().editor,null);await s.confirmMutation();assert.equal(calls,1);const before=s.getSnapshot();gate.resolve(memory());await tick();assert.equal(s.getSnapshot(),before);}finally{clearTimeout(timer);s.dispose();}
});

for(const boundary of ["space","refresh","logout","close"])test(`${boundary} immediately clears confirmation, content and grants before any request settles`,async()=>{
  let armed=false;const gate=deferred();const {store:s}=fixture({handler:(p)=>armed&&["/client/auth/me","/client/auth/logout"].includes(p)?gate.promise:undefined});await s.start();await s.openCreate();fill(s);s.addGrant("a01");s.requestSave();assert.ok(s.getSnapshot().confirmation);armed=true;
  const pending=boundary==="space"?s.selectWorkspace("w2"):boundary==="refresh"?s.refresh():boundary==="logout"?s.signOut():s.closeDetail();
  assert.equal(s.getSnapshot().confirmation,null);assert.equal(s.getSnapshot().draft.content,"");assert.deepEqual(s.getSnapshot().grants,{});assert.deepEqual(s.getSnapshot().agents,[]);s.dispose();gate.resolve({id:"new-principal"});await pending;assertCleared(s);
});

test("principal change re-verifies all permissions and clears previous private data without implicit space fallback",async()=>{
  let next=false;const {store:s,calls}=fixture({handler:(p)=>next&&p.endsWith("/me")?{id:"different-owner"}:next&&p.startsWith("/client/workspaces?")?{items:[{workspace:{id:"w3",name:"Other"},role:{name:"Owner"}}]}:undefined});await s.start("w2");await s.openCreate();fill(s);s.requestSave();next=true;await s.refresh();assert.equal(s.getSnapshot().principal.id,"different-owner");assert.equal(s.getSnapshot().workspaceId,"");assert.equal(s.getSnapshot().confirmation,null);assert.equal(s.getSnapshot().draft.content,"");assert.equal(s.getSnapshot().issue.kind,"space-unavailable");assert.equal(calls.at(-1).path,"/client/workspaces?page=1&pageSize=100");s.dispose();
});
