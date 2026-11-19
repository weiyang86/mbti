// ROOT ONLY / WORKER NOT_RUN. Fresh AF-173 lease + five guard registrations,
// integrated AF170 API/Schema/module, built public SDK/API, generated Prisma.
// No database imports or service startup before the explicit root gate.
import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createClientApi, createPersonalWorkflowsClient, createPersonalAgentsClient, validatePersonalWorkflowDraft, ClientRequestFailure } from "../../packages/sdk/dist/index.mjs";
import { createWorkflowLibrary, buildLinearWorkflow } from "../../apps/web/app/components/client-workflow-library-state.mjs";
const task = "AF-173", root = "/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation", READ = "workspace.ai.assets.read";
const deferred = () => { let resolve; const promise = new Promise(r => { resolve=r; }); return {promise,resolve}; };
const status = n => e => e instanceof ClientRequestFailure && e.status === n;
function emptyPrivate(store) { const s=store.getSnapshot(); assert.equal(s.detail,null); assert.equal(s.historical,null); assert.equal(s.editor,null); assert.equal(s.confirmation,null); assert.deepEqual(s.versions,[]); assert.equal(s.draft.name,""); assert.deepEqual(s.draft.steps,[]); assert.equal(s.replay,false); }
async function fill(store, code, agent, revision=1) { await store.openCreate(); store.setDraft("code",code); store.setDraft("name","AF173 synthetic draft"); store.setDraft("inputKeys","question"); await store.selectAgent(agent.id); store.addStep(revision); assert.equal(store.readyToSave(),true); store.requestSave(); }
function complexGraph(agentId) {
  const edge=(from,to,port="next",input="in")=>({from,port,to,input});
  return validatePersonalWorkflowDraft({schemaVersion:1,inputKeys:["question"],nodes:[{id:"start",type:"start"},{id:"condition",type:"condition",predicate:{key:"question",op:"exists"},joinId:"cj"},{id:"parallel",type:"parallel",branches:["a","b"],joinId:"pj"},{id:"agent",type:"agent",agentId,revision:1},{id:"loop",type:"loop",maxIterations:2,body:{nodes:[{id:"bs",type:"start"},{id:"approval",type:"human-approval",label:"AF173 private placeholder"},{id:"be",type:"end"}],edges:[edge("bs","approval"),edge("approval","be")]}},{id:"pj",type:"join",forkId:"parallel"},{id:"cj",type:"join",forkId:"condition"},{id:"end",type:"end"}],edges:[edge("start","condition"),edge("condition","parallel","true"),edge("condition","cj","false","false"),edge("parallel","agent","a"),edge("parallel","loop","b"),edge("agent","pj","next","a"),edge("loop","pj","next","b"),edge("pj","cj","next","true"),edge("cj","end")]}).graph;
}

test("AF-173 fresh real HTTP/PostgreSQL workflow page state acceptance (root only)", { timeout: 360000 }, async t => {
  assert.equal(process.env.AIJ_AF173_ROOT_LIVE,"1","ROOT_EXPLICIT_LIVE_GATE_REQUIRED"); assert.equal(resolve(process.cwd()),root,"ROOT_WORKTREE_REQUIRED");
  const git=flag=>resolve(root,execFileSync("git",["rev-parse",flag],{encoding:"utf8"}).trim()); assert.equal(git("--git-dir"),git("--git-common-dir")); assert.equal(execFileSync("git",["branch","--show-current"],{encoding:"utf8"}).trim(),"dev");
  const {createAcceptance,migrate}=await import("../database/migration.mjs"), {seedDatabase}=await import("../database/seed.mjs");
  const {clientEnvironment}=await import("./client-auth-fixture.mjs"), {syntheticAiCatalog}=await import("./ai-center-fixture.mjs");
  const {repositoryRoot,checkDatabase,withDatabase,readDatabaseEnvironment}=await import("../database/connection.mjs"); assert.equal(repositoryRoot,root);
  await checkDatabase("test"); const lease=await createAcceptance("test",task); assert.equal(lease.task,task); assert.match(lease.database,/af173/i);
  assert.equal((await migrate({mode:"test",action:"deploy",acceptanceId:lease.id})).exitCode,0); assert.equal((await migrate({mode:"test",action:"status",acceptanceId:lease.id})).exitCode,0);
  await seedDatabase({mode:"test",acceptanceId:lease.id,generateCredentials:true,runtimeManagement:true,pluginManagement:true,configuration:true,secrets:true,aiCenter:true});
  const previous={...process.env},require=createRequire(join(root,"apps/api/package.json")),stores=[],proof={task,acceptanceId:lease.id,database:lease.database,status:"INCOMPLETE"}; let app;
  try {
    const env=clientEnvironment(lease.id,task); for(const k of Object.keys(process.env)) delete process.env[k]; Object.assign(process.env,env,{ASYNC_RUNTIME_ENABLED:"false",ENABLED_PLUGINS:"aij-ai",AI_CENTER_LIVE_ENABLED:"false"});
    const {createApplication}=require("../../apps/api/dist/bootstrap.js"),{PrismaService}=require("../../apps/api/dist/prisma/prisma.service.js"); app=await createApplication(); await app.listen(0,"127.0.0.1"); const prisma=app.get(PrismaService),base=`http://127.0.0.1:${app.getHttpServer().address().port}/api`;
    const db=op=>withDatabase("test",readDatabaseEnvironment("test",process.env,lease.id),op,{acceptanceId:lease.id});
    const {PluginCatalog}=require("../../apps/api/dist/plugin-runtime/plugin-catalog.js"),{PluginLifecycleService}=require("../../apps/api/dist/plugin-runtime/plugin-lifecycle.service.js"),admin=await prisma.sysUser.findUniqueOrThrow({where:{username:"aij-admin"}}),lifecycle=app.get(PluginLifecycleService);
    await lifecycle.install("aij-ai",app.get(PluginCatalog).manifest("aij-ai").version,admin.id,"af173-install"); await lifecycle.enable("aij-ai",admin.id,"af173-enable");
    const secretKey="AIJ_SECRET_AIJ_FOUNDATION_TEST_AF173"; process.env[secretKey]="synthetic-"+randomBytes(24).toString("hex"); const ref="env://"+secretKey;
    await prisma.secretReference.create({data:{ref,provider:"env"}}); const {AiCenterConfigurationService}=require("../../apps/api/dist/plugins/aij-ai/ai-center-configuration.service.js"); await app.get(AiCenterConfigurationService).save({catalog:syntheticAiCatalog(ref),expectedVersion:0},admin.id,"af173-catalog");
    const {AiCenterHttpTransport}=require("../../apps/api/dist/plugins/aij-ai/ai-center-provider.js"); let upstream=0; app.get(AiCenterHttpTransport).request=async()=>{upstream++;throw new Error("AF173 must never execute upstream");};
    const hashes=()=>db(async c=>{const tables=(await c.query("SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname='public' ORDER BY tablename")).rows,out={}; for(const {tablename} of tables){assert.match(tablename,/^[a-zA-Z_][a-zA-Z0-9_]*$/);const projection=tablename==="client_auth_session"?"(to_jsonb(t)-'last_seen_at'-'updated_at')::text":"row_to_json(t)::text",rows=(await c.query('SELECT '+projection+' AS row FROM public."'+tablename+'" t')).rows.map(r=>r.row).sort();out[tablename]=createHash("sha256").update(JSON.stringify(rows)).digest("hex");}return out;});
    const accounts=[],cookies=[],spaces=[];
    for(let i=0;i<3;i++){const password="Af173-"+randomBytes(24).toString("hex"),account=await prisma.memberUser.create({data:{email:`af173-${randomUUID()}@example.test`,nickname:"AF173 synthetic member",emailVerifiedAt:new Date(),passwordHash:await require("bcryptjs").hash(password,12)}});accounts.push(account);const r=await fetch(base+"/client/auth/login",{method:"POST",headers:{origin:env.WEB_URL,"content-type":"application/json"},body:JSON.stringify({email:account.email,password}),signal:AbortSignal.timeout(15000)});assert.equal(r.status,200);assert.match(r.headers.get("set-cookie"),/HttpOnly/);cookies.push(r.headers.get("set-cookie").split(";")[0]);await r.arrayBuffer();}
    const request=actor=>{const api=createClientApi(()=>base);return (path,o={})=>api(path,{...o,headers:{...o.headers,cookie:cookies[actor],origin:env.WEB_URL}});};
    const owner=request(0),other=request(1),reader=request(2),sdk=createPersonalWorkflowsClient(owner),otherSdk=createPersonalWorkflowsClient(other),readerSdk=createPersonalWorkflowsClient(reader),agents=createPersonalAgentsClient(owner);
    for(let i=0;i<2;i++)spaces.push(await owner("/client/workspaces",{method:"POST",body:JSON.stringify({name:"AF173 synthetic space "+i,idempotencyKey:"af173-"+randomUUID()})}));
    const foreign=await other("/client/workspaces",{method:"POST",body:JSON.stringify({name:"AF173 foreign space",idempotencyKey:"af173-"+randomUUID()})});
    const ownerRole=await prisma.clientWorkspaceRole.findUniqueOrThrow({where:{workspaceId_code:{workspaceId:spaces[0].id,code:"OWNER"}}});
    for(const actor of [1,2])await prisma.clientWorkspaceMembership.create({data:{workspaceId:spaces[0].id,memberId:accounts[actor].id,roleId:ownerRole.id}});
    const options=await agents.modelOptions(spaces[0].id),model=options.items[0]; assert.ok(model);
    const content={name:"AF173 own Agent",instructions:"AF173 private instruction",enabled:true,modelCode:model.code,modelRevision:model.revision,catalogVersion:options.catalogVersion,inputFields:["question"],outputFormat:"text",outputFields:[],skillBindings:[]};
    const agent=await agents.create(spaces[0].id,{...content,code:"af173-agent"}); await agents.update(spaces[0].id,agent.id,{...content,name:"AF173 current v2",expectedRevision:1});
    const pin=await prisma.aiPersonalAgentVersion.findFirstOrThrow({where:{agentId:agent.id,revision:1}});
    const emptyGraph=validatePersonalWorkflowDraft({schemaVersion:1,inputKeys:[],nodes:[{id:"s",type:"start"},{id:"e",type:"end"}],edges:[{from:"s",port:"next",to:"e",input:"in"}]}).graph;
    const otherDraft=await otherSdk.create(spaces[0].id,{code:"other-owner",name:"Other owner private",graph:emptyGraph}),readerDraft=await readerSdk.create(spaces[0].id,{code:"reader-owned",name:"Reader private",graph:emptyGraph});
    const readRole=await prisma.clientWorkspaceRole.create({data:{workspaceId:spaces[0].id,code:"AF173_READER",name:"AF173 Reader"}}),permissions=await prisma.clientWorkspacePermission.findMany({where:{code:{in:["workspace.context.read",READ]},deletedAt:null,status:"active"}});assert.equal(permissions.length,2);
    await prisma.clientWorkspaceRolePermission.createMany({data:permissions.map(p=>({roleId:readRole.id,permissionId:p.id}))}); await prisma.clientWorkspaceMembership.update({where:{workspaceId_memberId:{workspaceId:spaces[0].id,memberId:accounts[2].id}},data:{roleId:readRole.id}});
    const baseline=await hashes(),runtimeTables=Object.keys(baseline).filter(k=>/runtime_|job|ai_.*run|ai_execution|trace|budget|usage|reservation|memory|notification|payment/.test(k));
    const store=createWorkflowLibrary({request:owner});stores.push(store);await store.start(spaces[0].id);
    let made;
    await t.test("real page state creates ordered own historical/current Agent steps",async()=>{
      await fill(store,"af173-linear",agent); store.cancelConfirmation(); store.addStep(2); store.moveStep(1,-1);store.addStep(1);store.removeStep(2);assert.deepEqual(store.getSnapshot().draft.steps.map(p=>p.revision),[2,1]);
      store.cancelConfirmation();store.requestSave();await store.confirmMutation();assert.equal(store.getSnapshot().issue,null);made=store.getSnapshot().detail;assert.ok(made);
      assert.deepEqual(made.graph,buildLinearWorkflow(["question"],[{agentId:agent.id,revision:2},{agentId:agent.id,revision:1}]));assert.equal(made.agentBindings.find(p=>p.nodeId==="step2").agentVersionId,pin.id);
    });
    await t.test("complex saved graph rename/noop keeps exact pins and real immutable historical graph",async()=>{
      const complex=await sdk.update(spaces[0].id,made.id,{name:"AF173 complex",graph:complexGraph(agent.id),expectedRevision:1});await store.openDetail(made.id);store.openEdit();store.setDraft("name","AF173 rename only");store.requestSave();await store.confirmMutation();assert.equal(store.getSnapshot().issue,null);assert.equal(store.getSnapshot().detail.revision,3);assert.deepEqual(store.getSnapshot().detail.graph,complex.graph);assert.deepEqual(store.getSnapshot().detail.agentBindings,complex.agentBindings);
      const count=await prisma.aiPersonalWorkflowVersion.count({where:{workflowId:made.id}});store.openEdit();store.requestSave();await store.confirmMutation();assert.equal(store.getSnapshot().detail.revision,3);assert.equal(await prisma.aiPersonalWorkflowVersion.count({where:{workflowId:made.id}}),count);
      await store.loadVersions();await store.previewVersion(1);assert.deepEqual(store.getSnapshot().historical.graph,made.graph);assert.deepEqual(store.getSnapshot().detail.graph,complex.graph);assert.equal(store.getSnapshot().historical.revision,1);
      await sdk.update(spaces[0].id,made.id,{name:"Concurrent rename",graph:complex.graph,expectedRevision:3});store.openEdit();store.setDraft("name","Stale rename");store.requestSave();await store.confirmMutation();assert.equal(store.getSnapshot().issue.status,409);assert.equal(store.getSnapshot().blocked,true);assert.equal(store.getSnapshot().confirmation,null);await store.openDetail(made.id);assert.equal(store.getSnapshot().detail.revision,4);
    });
    await t.test("real other OWNER isolation, two-space/foreign/missing selector and read-only own history",async()=>{
      assert.deepEqual((await sdk.list(spaces[0].id)).items.map(x=>x.id),[made.id]);assert.deepEqual((await otherSdk.list(spaces[0].id)).items.map(x=>x.id),[otherDraft.id]);assert.deepEqual((await sdk.list(spaces[1].id)).items,[]);
      await assert.rejects(otherSdk.get(spaces[0].id,made.id),status(404));await assert.rejects(sdk.get(spaces[1].id,made.id),status(404));await assert.rejects(sdk.list(foreign.id),status(403));
      const ro=createWorkflowLibrary({request:reader});stores.push(ro);await ro.start(spaces[0].id);assert.equal(ro.getSnapshot().items[0].id,readerDraft.id);await ro.openDetail(readerDraft.id);await ro.loadVersions();await ro.previewVersion(1);assert.equal(ro.getSnapshot().historical.id,(await readerSdk.getVersion(spaces[0].id,readerDraft.id,1)).id);await ro.openCreate();ro.openEdit();ro.requestDelete();assert.equal(ro.getSnapshot().editor,null);assert.equal(ro.getSnapshot().confirmation,null);
      const before=await hashes();await assert.rejects(readerSdk.delete(spaces[0].id,readerDraft.id,1),status(403));assert.deepEqual(await hashes(),before);
      await store.start(); // preferred remains explicit; use empty selector for absent.
      await store.start("");emptyPrivate(store);assert.equal(store.getSnapshot().workspaceId,"");await store.start(foreign.id);emptyPrivate(store);assert.equal(store.getSnapshot().issue.status,403);await store.start(spaces[0].id);
    });
    await t.test("lost real create response allows deliberate exact replay returning current and no duplicate creation",async()=>{
      let drop=true,initialBody;
      const ambiguous=createWorkflowLibrary({request:async(path,o)=>{const value=await owner(path,o);if(path==="/client/ai/personal-workflows"&&o?.method==="POST"&&drop){drop=false;initialBody=JSON.parse(o.body);throw new Error("synthetic lost response after commit");}return value;}});stores.push(ambiguous);await ambiguous.start(spaces[0].id);await fill(ambiguous,"af173-replay",agent);await ambiguous.confirmMutation();assert.equal(ambiguous.getSnapshot().replay,true);
      const created=(await sdk.list(spaces[0].id)).items.find(x=>x.code==="af173-replay"),current=await sdk.get(spaces[0].id,created.id);await sdk.update(spaces[0].id,created.id,{name:"Replay returns current v2",graph:current.graph,expectedRevision:1});await ambiguous.replayCreate();assert.equal(ambiguous.getSnapshot().detail.revision,2);assert.equal(ambiguous.getSnapshot().detail.name,"Replay returns current v2");assert.equal(await prisma.aiPersonalWorkflow.count({where:{workspaceId:spaces[0].id,memberId:accounts[0].id,code:initialBody.code}}),1);
    });
    await t.test("old-scope actual HTTP dependency read barrier cannot emit a later create",async()=>{
      const ready=deferred(),release=deferred();let hold=false,writes=0;
      const fenced=createWorkflowLibrary({request:async(path,o)=>{if(o?.method&&["POST","PATCH","DELETE"].includes(o.method)&&path.startsWith("/client/ai/personal-workflows"))writes++;const value=await owner(path,o);if(hold&&path.startsWith("/client/ai/personal-agents?")){hold=false;ready.resolve();await release.promise;}return value;}});stores.push(fenced);await fenced.start(spaces[0].id);await fill(fenced,"af173-never-sent",agent);hold=true;const pending=fenced.confirmMutation();await ready.promise;
      try{await fenced.selectWorkspace(spaces[1].id);emptyPrivate(fenced);}finally{release.resolve();}await pending;assert.equal(writes,0);assert.equal(await prisma.aiPersonalWorkflow.count({where:{code:"af173-never-sent"}}),0);assert.equal(fenced.getSnapshot().workspaceId,spaces[1].id);
    });
    await t.test("real disabled/current-changed dependency refuses creation; page focus/account/logout clears",async()=>{
      await store.start(spaces[0].id);await fill(store,"af173-disabled",agent,2);await agents.update(spaces[0].id,agent.id,{...content,enabled:false,expectedRevision:2});await store.confirmMutation();assert.equal(store.getSnapshot().blocked,true);assert.equal(await prisma.aiPersonalWorkflow.count({where:{code:"af173-disabled"}}),0);
      await store.openDetail(made.id);await store.loadVersions();await store.previewVersion(1);store.requestDelete();await store.refresh();emptyPrivate(store);await store.openDetail(made.id);store.requestDelete();store.dispose();emptyPrivate(store);
      const swapped=createWorkflowLibrary({request:other});stores.push(swapped);await swapped.start(spaces[0].id);assert.deepEqual(swapped.getSnapshot().items.map(v=>v.id),[otherDraft.id]);await swapped.openDetail(otherDraft.id);await swapped.signOut();emptyPrivate(swapped);
    });
    await t.test("actual deletion CAS and tombstone; plugin lifecycle denies reads",async()=>{
      await store.start(spaces[0].id);await store.openDetail(made.id);store.requestDelete();assert.equal(store.getSnapshot().confirmation.revision,4);await store.confirmMutation();assert.equal(store.getSnapshot().issue,null);assert.equal(store.getSnapshot().detail,null);await assert.rejects(sdk.get(spaces[0].id,made.id),status(404));await assert.rejects(sdk.create(spaces[0].id,{code:made.code,name:made.name,graph:made.graph}),status(409));
      const tombstone=await prisma.aiPersonalWorkflow.findUniqueOrThrow({where:{id:made.id}});assert.ok(tombstone.deletedAt);assert.equal(tombstone.revision,4);assert.equal(await prisma.aiPersonalWorkflowVersion.count({where:{workflowId:made.id}}),4);
      for(let i=0;i<20;i++)await sdk.create(spaces[0].id,{code:`af173-page-${i}`,name:"AF173 pagination",graph:emptyGraph});
      await store.refresh();assert.equal(store.getSnapshot().items.length,20);assert.ok(store.getSnapshot().nextCursor);const first=store.getSnapshot().items.map(v=>v.id);await store.nextPage();assert.equal(store.getSnapshot().items.length,1);assert.equal(store.getSnapshot().nextCursor,null);assert.ok(!first.includes(store.getSnapshot().items[0].id));assert.equal(store.getSnapshot().items[0].graph,undefined);
      await lifecycle.disable("aij-ai",admin.id,"af173-disable");await store.refresh();assert.equal(store.getSnapshot().issue.status,404);assert.deepEqual(store.getSnapshot().items,[]);await lifecycle.enable("aij-ai",admin.id,"af173-reenable");
    });
    const after=await hashes();for(const table of runtimeTables)assert.equal(after[table],baseline[table],table+" must remain untouched");assert.equal(upstream,0);proof.runtimeTables=runtimeTables;proof.upstream=upstream;
    for(const audit of await prisma.auditLog.findMany({where:{resourceType:"ai_personal_workflow"}}))assert.doesNotMatch(JSON.stringify(audit),/AF173 private|AF173 synthetic draft|question|placeholder/);
    proof.status="EVIDENCE_RECORDED_FORMAL_REPORT_IS_AUTHORITY";
  } finally {
    for(const s of stores)s.dispose();
    try{if(app){await app.close();assert.equal(app.getHttpServer().listening,false);}}finally{
    try{const active=await withDatabase("test",readDatabaseEnvironment("test",process.env,lease.id),async c=>(await c.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND application_name LIKE 'aij-api:%'")).rows[0].n,{acceptanceId:lease.id});assert.equal(active,0);proof.poolsAfter=active;}finally{for(const k of Object.keys(process.env))delete process.env[k];Object.assign(process.env,previous);const directory=resolve(root,".artifacts/verification/AF-173");mkdirSync(directory,{recursive:true});writeFileSync(join(directory,"live-"+lease.id+".json"),JSON.stringify(proof,null,2)+"\n");}
    }
  }
});
