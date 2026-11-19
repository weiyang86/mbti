// Owned synthetic transport/loopback only; this is never PostgreSQL/API proof.
import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import { createClientApi, createPersonalWorkflowsClient, validatePersonalWorkflowDraft } from "../../packages/sdk/dist/index.mjs";
import { buildLinearWorkflow, classifyLinearWorkflow, createLinearDragController, createWorkflowLibrary } from "../../apps/web/app/components/client-workflow-library-state.mjs";
const clone = structuredClone, base = "/client/ai/personal-workflows", agentsBase = "/client/ai/personal-agents";
const now = "2026-11-06T00:00:00.000Z", tick = () => new Promise(r => setImmediate(r));
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a;reject=b; }); return {promise,resolve,reject}; };
const digest = graph => createHash("sha256").update(validatePersonalWorkflowDraft(graph).canonical).digest("hex");
const summary = w => Object.fromEntries(Object.entries(w).filter(([k]) => !["graph","agentBindings"].includes(k)));
const history = (w,full=true) => { const v=clone(full?w:summary(w));delete v.updatedAt;return {...v,id:`version-${w.revision}`,workflowId:w.id}; };
const step = (agentId="agent-a",revision=1) => ({agentId,revision});
function fixture({ readonly=false, graph=buildLinearWorkflow(["question"],[step("agent-a",2),step("agent-b"),step()]), timeoutMs=100 }={}) {
  const agents=["a","b"].map(k=>({id:`agent-${k}`,code:`own-${k}`,name:`Own ${k}`,enabled:true,revision:k==="a"?2:1,createdAt:now,updatedAt:now}));
  let current={id:"workflow-a",code:"own-flow",name:"Private linear flow",revision:1,graph,graphDigest:digest(graph),status:"DRAFT",structuralValidity:"VALID",createdAt:now,updatedAt:now,agentBindings:validatePersonalWorkflowDraft(graph).agentRefs.map(p=>({...p,agentVersionId:`${p.agentId}-v${p.revision}`}))};
  const versions=[clone(current)], calls=[];let intercept=null;
  const request=async(path,o={})=>{
    calls.push({path,...o});if(intercept){const v=await intercept(path,o);if(v!==undefined)return v;}
    if(path==="/client/auth/me")return {id:"member-a",email:null,nickname:"Synthetic"};
    if(path.startsWith("/client/workspaces?"))return {page:1,pageSize:100,total:2,items:["space-a","space-b"].map(id=>({membershipId:`m-${id}`,joinedAt:now,workspace:{id,code:id,name:id,status:"active"},role:{id:"role-a",code:"OWNER",name:"Owner"}}))};
    if(path==="/client/workspaces/context")return {workspaceId:o.workspaceId,workspaceCode:o.workspaceId,workspaceName:o.workspaceId,roleId:"role-a",roleCode:"OWNER",permissions:["workspace.ai.assets.read",...(readonly?[]:["workspace.ai.assets.manage"])],sessionGeneration:"a".repeat(64)};
    if(path==="/client/auth/logout")return {signedOut:true};
    if(path.startsWith(agentsBase+"?"))return {items:clone(agents),nextCursor:null};
    if(path.startsWith(agentsBase+"/")) {
      const a=agents.find(a=>path.startsWith(`${agentsBase}/${a.id}/versions?`));if(!a)throw {status:404};
      const q=new URL(path,"http://synthetic.test").searchParams,before=Number(q.get("beforeRevision")||a.revision+1),limit=Number(q.get("limit"));
      return {items:Array.from({length:a.revision},(_,i)=>a.revision-i).filter(r=>r<before).slice(0,limit).map(revision=>({id:`${a.id}-v${revision}`,agentId:a.id,code:a.code,name:a.name,enabled:true,revision,createdAt:now,instructions:"INSTRUCTION_PAYLOAD_MUST_NOT_SURVIVE",modelCode:"advice-text",modelRevision:1,catalogVersion:1,inputFields:["question"],outputFormat:"text",outputFields:[],skillBindings:[]})),nextCursor:null};
    }
    if(path.startsWith(base)) {
      if(o.workspaceId==="space-b") {if(path===base+"?limit=20")return {items:[],nextCursor:null};throw {status:404};}
      if(o.method==="PATCH") {
        const b=JSON.parse(o.body);if(b.expectedRevision!==current.revision)throw {status:409};
        const graph=validatePersonalWorkflowDraft(b.graph).graph,graphDigest=digest(graph);
        if(b.name!==current.name||graphDigest!==current.graphDigest) {current={...current,name:b.name,graph,graphDigest,revision:current.revision+1,agentBindings:validatePersonalWorkflowDraft(graph).agentRefs.map(p=>({...p,agentVersionId:`${p.agentId}-v${p.revision}`}))};versions.push(clone(current));}
        return clone(current);
      }
      if(path===base+"?limit=20")return {items:[summary(current)],nextCursor:null};
      if(path.includes("/versions?"))return {items:versions.slice().reverse().map(w=>history(w,false)),nextCursor:null};
      if(/\/versions\/\d+$/.test(path))return history(versions.find(w=>w.revision===Number(path.split("/").at(-1))));
      return clone(current);
    }
    assert.fail("Unexpected synthetic route");
  };
  const store=createWorkflowLibrary({request,timeoutMs});
  return {store,request,calls,agents,versions,current:()=>current,intercept:f=>{intercept=f;},writes:()=>calls.filter(c=>c.method==="PATCH"),open:async()=>{await store.start("space-a");await store.openDetail("workflow-a");store.openLinearEdit();}};
}
const bounds=[0,1,2].map(i=>({left:0,right:300,top:i*100,bottom:i*100+90}));

test("full canonical equality eligibility rejects labels, custom IDs/ports, reversed paths, empty and complex bodies",()=>{
  const graph=buildLinearWorkflow(["question"],[step(),step("agent-b")]);assert.deepEqual(classifyLinearWorkflow(graph).steps,[step(),step("agent-b")]);
  const labeled=clone(graph);labeled.nodes.find(n=>n.id==="step1").label="Keep me";assert.equal(classifyLinearWorkflow(labeled),null);
  const custom=clone(graph);custom.nodes.forEach(n=>{if(n.id==="step1")n.id="custom";});custom.edges.forEach(e=>{if(e.from==="step1")e.from="custom";if(e.to==="step1")e.to="custom";});assert.equal(classifyLinearWorkflow(custom),null);
  const reverse=clone(graph);reverse.edges=[{from:"start",port:"next",to:"step2",input:"in"},{from:"step2",port:"next",to:"step1",input:"in"},{from:"step1",port:"next",to:"end",input:"in"}];assert.equal(classifyLinearWorkflow(reverse),null);
  const approval=clone(graph);approval.nodes.find(n=>n.id==="step1").type="human-approval";delete approval.nodes.find(n=>n.id==="step1").agentId;delete approval.nodes.find(n=>n.id==="step1").revision;assert.equal(classifyLinearWorkflow(approval),null);
  const empty={schemaVersion:1,inputKeys:[],nodes:[{id:"start",type:"start"},{id:"end",type:"end"}],edges:[{from:"start",port:"next",to:"end",input:"in"}]};assert.equal(classifyLinearWorkflow(empty),null);
  for(const edit of [g=>{g.edges[0].port="other";},g=>{g.inputKeys=Array.from({length:21},(_,i)=>`key${i}`);},g=>{g.nodes[0].position={x:0,y:0};}]){const x=clone(graph);edit(x);assert.equal(classifyLinearWorkflow(x),null);}
  assert.throws(()=>buildLinearWorkflow([],Array.from({length:63},()=>step())));assert.throws(()=>buildLinearWorkflow([],[]));
});
test("real semantic pointer reorder + input/add/remove historical pins PATCH full graph; immutable old graph and exact no-op",async()=>{
  const f=fixture();await f.open();const s=f.store,original=clone(f.current()),token=s.getSnapshot().editorToken;
  assert.equal(Object.isFrozen(s.getSnapshot().editorBaseline.graph.nodes),true);
  const drag=createLinearDragController({token,count:3,reorder:s.reorderStep});assert.equal(drag.start(1,0),true);assert.equal(drag.move(1,20,220,bounds),2);drag.end(1);
  assert.deepEqual(s.getSnapshot().draft.steps.map(p=>p.agentId+":"+p.revision),["agent-b:1","agent-a:1","agent-a:2"]);
  s.setDraft("inputKeys","context, question");await s.selectAgent("agent-a");s.addStep(1);s.removeStep(1);s.setDraft("name","Edited linear flow");
  assert.deepEqual(s.getSnapshot().draft.steps.map(p=>p.revision),[1,2,1]);s.requestSave();await s.confirmMutation();assert.equal(s.getSnapshot().issue,null);
  const intended=buildLinearWorkflow(["context","question"],[step("agent-b"),step("agent-a",2),step()]);
  assert.deepEqual(JSON.parse(f.writes()[0].body),{expectedRevision:1,name:"Edited linear flow",graph:intended});assert.deepEqual(f.current().graph,intended);assert.equal(f.current().revision,2);
  assert.deepEqual(f.versions[0],original);assert.equal(f.current().agentBindings.find(p=>p.nodeId==="step3").agentVersionId,"agent-a-v1");
  s.openLinearEdit();s.requestSave();await s.confirmMutation();assert.equal(f.current().revision,2);assert.equal(f.versions.length,2);
  await s.loadVersions();await s.previewVersion(1);assert.deepEqual(s.getSnapshot().historical.graph,original.graph);assert.deepEqual(s.getSnapshot().historical.agentBindings,original.agentBindings);
  assert.equal(JSON.stringify(s.getSnapshot()).includes("INSTRUCTION_PAYLOAD"),false);s.dispose();
});
test("cancel preserves source and history cannot edit/restore; readonly and custom graphs stay honest",async()=>{
  const f=fixture();await f.open();const original=clone(f.current());f.store.moveStep(0,1);f.store.setDraft("inputKeys","changed");f.store.cancelEdit();assert.deepEqual(f.store.getSnapshot().detail,original);assert.equal(f.store.getSnapshot().draft.inputKeys,"");
  f.store.openLinearEdit();f.store.moveStep(0,1);await f.store.loadVersions();await f.store.previewVersion(1);assert.equal(f.store.getSnapshot().editor,null);assert.deepEqual(f.store.getSnapshot().detail,original);f.store.dispose();
  const ro=fixture({readonly:true});await ro.open();ro.store.openEdit();ro.store.setDraft("name","forbidden");ro.store.reorderStep(0,2);ro.store.requestSave();await ro.store.confirmMutation();assert.equal(ro.writes().length,0);assert.equal(ro.store.getSnapshot().editor,null);ro.store.dispose();
  const graph=buildLinearWorkflow([],[step()]);graph.nodes.find(n=>n.type==="agent").label="Custom preserved label";const c=fixture({graph});await c.open();assert.equal(c.store.getSnapshot().editor,null);c.store.openEdit();c.store.setDraft("inputKeys","forbidden");c.store.setDraft("name","Name only");c.store.requestSave();await c.store.confirmMutation();assert.deepEqual(JSON.parse(c.writes()[0].body).graph,graph);c.store.dispose();
});
test("pointercancel, invalid targets, foreign pointers, gaps/outside/nonfinite and out-of-range indices never reorder",()=>{
  const writes=[],d=createLinearDragController({token:5,count:3,reorder:(...args)=>writes.push(args)});
  for(const i of [-1,3,1.5,NaN])assert.equal(d.start(1,i),false);
  d.start(1,0);d.move(2,20,220,bounds);d.end(2);d.cancel();d.end(1);assert.deepEqual(writes,[]);
  for(const [x,y,b] of [[-1,220,bounds],[20,95,bounds],[20,1000,bounds],[NaN,220,bounds],[20,220,[]],[20,220,[bounds[1],bounds[0],bounds[2]]]]){d.start(1,0);assert.equal(d.move(1,x,y,b),null);d.end(1);}assert.deepEqual(writes,[]);
  d.start(1,0);d.move(1,20,220,bounds);d.cancel();d.end(1);assert.deepEqual(writes,[]);
  d.start(1,0);d.move(1,20,220,bounds);d.end(1);assert.deepEqual(writes,[[0,2,5]]);
});
test("old editor callbacks/pointer cannot mutate a new editor, scope, async epoch or blocked confirmation",async()=>{
  const f=fixture();await f.open();const s=f.store,old=s.getSnapshot().editorToken,d=createLinearDragController({token:old,count:3,reorder:s.reorderStep});d.start(1,0);d.move(1,20,220,bounds);
  s.cancelEdit();s.openLinearEdit();const snapshot=clone(s.getSnapshot());s.setDraft("name","stale",old);s.moveStep(0,1,old);s.removeStep(0,old);s.requestSave(old);await s.selectAgent("agent-a",false,old);d.end(1);assert.deepEqual(s.getSnapshot(),snapshot);
  const prior=s.getSnapshot().editorToken;await s.selectAgent("agent-a");s.addStep(1,prior);assert.equal(s.getSnapshot().draft.steps.length,3);
  const current=clone(s.getSnapshot());await s.selectAgent("foreign-agent");for(const index of [-1,3,0.5,NaN]){s.removeStep(index);s.reorderStep(index,0,s.getSnapshot().editorToken);}assert.deepEqual(s.getSnapshot(),current);
  s.requestSave();const confirmation=s.getSnapshot().confirmation.token;s.moveStep(0,1);assert.deepEqual(s.getSnapshot().draft.steps.map(p=>p.revision),[2,1,1]);s.cancelConfirmation();s.requestSave();s.cancelConfirmation(confirmation);assert.notEqual(s.getSnapshot().confirmation,null);await s.confirmMutation(confirmation);assert.equal(f.writes().length,0);await s.selectWorkspace("space-b");d.end(1);assert.equal(s.getSnapshot().editor,null);assert.equal(f.writes().length,0);s.dispose();
});
test("62-step cap refuses an additional pin; valid history is preserved when current Agent advances",async()=>{
  const f=fixture({graph:buildLinearWorkflow(["question"],[step()])});await f.open();await f.store.selectAgent("agent-a");for(let i=0;i<70;i++)f.store.addStep(1);assert.equal(f.store.getSnapshot().draft.steps.length,62);f.store.removeStep(61);f.agents[0].revision=3;f.store.requestSave();await f.store.confirmMutation();assert.equal(f.store.getSnapshot().issue,null);assert.equal(f.current().revision,2);assert.ok(f.current().agentBindings.every(p=>p.revision===1&&p.agentVersionId==="agent-a-v1"));f.store.dispose();
});
test("empty/excess/invalid input and missing/deleted/disabled/changed pins refuse without silently advancing",async t=>{
  for(const mode of ["empty","inputs","invalid","missing","disabled","changed","pin-missing","pin-wrong"])await t.test(mode,async()=>{
    const f=fixture();await f.open();const s=f.store;
    if(mode==="empty"){while(s.getSnapshot().draft.steps.length)s.removeStep(0);}
    if(mode==="inputs")s.setDraft("inputKeys",Array.from({length:21},(_,i)=>`key${i}`).join(","));
    if(mode==="invalid")s.setDraft("inputKeys","question,question");
    if(mode==="missing")f.agents.splice(0,1);if(mode==="disabled")f.agents[0].enabled=false;if(mode==="changed")f.agents[0].revision=3;
    if(mode.startsWith("pin-"))f.intercept(async(path,o)=>{if(!path.includes("/agent-a/versions?"))return; if(mode==="pin-missing")return {items:[],nextCursor:null};f.intercept(null);const value=await f.request(path,o);value.items[0].id="changed-version-id";return value;});
    s.requestSave();await s.confirmMutation();assert.equal(f.writes().length,0);if(!["empty","inputs","invalid"].includes(mode))assert.equal(s.getSnapshot().blocked,true);s.dispose();
  });
});
test("CAS/network/timeout and corrupt returned graph or binding close editor and block until explicit current reread",async t=>{
  for(const mode of ["cas","network","timeout","graph","binding","revision"])await t.test(mode,async()=>{
    const f=fixture({timeoutMs:20});await f.open();const s=f.store,original=clone(f.current());s.moveStep(0,1);const gate=deferred();
    f.intercept((path,o)=>{if(o.method!=="PATCH")return;if(mode==="cas")throw {status:409};if(mode==="network")throw new Error("PRIVATE_ERROR");if(mode==="timeout")return gate.promise;const body=JSON.parse(o.body),bad={...clone(original),name:body.name,graph:body.graph,graphDigest:digest(body.graph),revision:2,agentBindings:validatePersonalWorkflowDraft(body.graph).agentRefs.map(p=>({...p,agentVersionId:`${p.agentId}-v${p.revision}`}))};if(mode==="graph")return original;if(mode==="binding")bad.agentBindings[0].agentVersionId="wrong-pin";if(mode==="revision")bad.revision=99;return bad;});
    s.requestSave();const pending=s.confirmMutation(),keepAlive=setTimeout(()=>{},60);await pending;clearTimeout(keepAlive);assert.equal(s.getSnapshot().editor,null);assert.equal(s.getSnapshot().confirmation,null);assert.equal(s.getSnapshot().draft.name,"");assert.equal(JSON.stringify(s.getSnapshot()).includes("PRIVATE_ERROR"),false);
    if(["cas","network","timeout"].includes(mode)){assert.equal(s.getSnapshot().blocked,true);s.openLinearEdit();s.requestSave();await s.confirmMutation();assert.equal(f.writes().length,1);f.intercept(null);await s.openDetail("workflow-a");s.openLinearEdit();assert.equal(s.getSnapshot().editor,"linear");}
    else assert.equal(s.getSnapshot().context,null);
    const snap=clone(s.getSnapshot());gate.resolve(original);await tick();assert.deepEqual(s.getSnapshot(),snap);s.dispose();
  });
});
test("all scope/lifecycle fences abort actual pending PATCH and suppress late success/error; dependency barrier emits zero writes",async t=>{
  for(const event of ["scope","focus","visibility","pagehide","account","logout","dispose"])for(const reject of [false,true])await t.test(`${event} ${reject?"error":"success"}`,async()=>{
    const f=fixture();await f.open();const s=f.store;s.moveStep(0,1);s.requestSave();const reached=deferred(),gate=deferred();f.intercept((p,o)=>{if(o.method==="PATCH"){reached.resolve();return gate.promise;}});const pending=s.confirmMutation();await reached.promise;
    if(event==="scope")await s.selectWorkspace("space-b");else if(event==="focus")await s.refresh();else if(event==="account")await s.start("");else if(event==="logout")await s.signOut();else s.dispose();
    assert.equal(f.writes()[0].signal.aborted,true);assert.equal(s.getSnapshot().editor,null);assert.equal(s.getSnapshot().historical,null);assert.equal(s.getSnapshot().confirmation,null);const snap=clone(s.getSnapshot());if(reject)gate.reject({status:401});else gate.resolve(f.current());await pending;assert.deepEqual(s.getSnapshot(),snap);s.dispose();
  });
  const f=fixture();await f.open();f.store.moveStep(0,1);f.store.requestSave();const gate=deferred(),reached=deferred();f.intercept(path=>{if(path.startsWith(agentsBase+"?")){reached.resolve();return gate.promise;}});const pending=f.store.confirmMutation();await reached.promise;await f.store.selectWorkspace("space-b");gate.resolve({items:clone(f.agents),nextCursor:null});await pending;assert.equal(f.writes().length,0);f.store.dispose();
});
test("compiled SDK PATCH uses owned synthetic loopback, exact graph/revision/workspace and no unsupported layout",async t=>{
  const requests=[],f=fixture(),server=createServer(async(req,res)=>{let body="";for await(const c of req)body+=c;requests.push({headers:req.headers,method:req.method,url:req.url,body:JSON.parse(body)});res.setHeader("content-type","application/json");res.end(JSON.stringify({success:true,data:f.current(),message:"ok"}));});await new Promise(r=>server.listen(0,"127.0.0.1",r));t.after(()=>new Promise(r=>{server.closeAllConnections();server.close(r);}));
  const sdk=createPersonalWorkflowsClient(createClientApi(()=>`http://127.0.0.1:${server.address().port}`)),graph=buildLinearWorkflow(["question"],[step("agent-b"),step()]);await sdk.update("space-a","workflow-a",{name:"Changed",graph,expectedRevision:1});assert.equal(requests[0].method,"PATCH");assert.equal(requests[0].url,base+"/workflow-a");assert.equal(requests[0].headers["x-aij-workspace-id"],"space-a");assert.deepEqual(requests[0].body,{expectedRevision:1,name:"Changed",graph});assert.doesNotMatch(JSON.stringify(requests),/position|layout/);f.store.dispose();
});
test("compiled editor SSR has bounded connected cards, fixed names/codes/revisions, touch/keyboard and storage0",async()=>{
  const f=fixture();await f.open();const source=readFileSync(new URL("../../apps/web/app/components/client-workflow-linear-editor.tsx",import.meta.url),"utf8"),state=readFileSync(new URL("../../apps/web/app/components/client-workflow-library-state.mjs",import.meta.url),"utf8");
  assert.doesNotMatch(source+state,/localStorage|sessionStorage|indexedDB|console\.|dangerouslySetInnerHTML|eval\(/);for(const event of ["onPointerDown","onPointerMove","onPointerUp","onPointerCancel","onLostPointerCapture","onKeyDown"])assert.ok(source.includes(event));
  const require=createRequire(new URL("../../apps/web/package.json",import.meta.url)),requireEditor=id=>id.endsWith("client-workflow-library-state.mjs")?{createLinearDragController}:require(id),module={exports:{}};
  const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;new Function("require","module","exports",compiled)(requireEditor,module,module.exports);
  const html=require("react-dom/server").renderToStaticMarkup(require("react").createElement(module.exports.ClientWorkflowLinearEditor,{state:f.store.getSnapshot(),store:f.store,locked:false}));
  for(const text of ["开始","结束","Own a","own-a","固定 v2","固定 v1","方向键","上移步骤 1","下移步骤 1","移除步骤 1"])assert.ok(html.includes(text),text);
  assert.match(html,/overflow:auto/);assert.match(html,/touch-action:none/);assert.match(html,/min-height:44px/);assert.doesNotMatch(html,/INSTRUCTION_PAYLOAD|<script|<canvas|foreignObject/);f.store.dispose();
});
