// ROOT ONLY / WORKER NOT_RUN. Fresh AF-166 lease, integrated AF-163 API/Schema,
// root registry/fixture allowlists and freshly compiled API + public SDK required.
// No external upstream, no AF-167 injection, no reuse of AF-163 acceptance evidence.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import { createAcceptance, migrate } from "../database/migration.mjs";
import { seedDatabase } from "../database/seed.mjs";
import { clientEnvironment } from "./client-auth-fixture.mjs";
import { syntheticAiCatalog } from "./ai-center-fixture.mjs";
import { repositoryRoot, checkDatabase, withDatabase, readDatabaseEnvironment } from "../database/connection.mjs";
import { createClientApi, createPersonalMemoriesClient, createPersonalAgentsClient, ClientRequestFailure } from "../../packages/sdk/dist/index.mjs";
import { createMemoryLibrary } from "../../apps/web/app/components/client-memory-library-state.mjs";
const require = createRequire(join(repositoryRoot,"apps/api/package.json"));
const task = "AF-166";
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const cleared = s => { const v=s.getSnapshot();assert.equal(v.detail,null);assert.equal(v.editor,null);assert.equal(v.confirmation,null);assert.equal(v.draft.content,"");assert.equal(v.draft.title,"");assert.deepEqual(v.draft.agentIds,[]);assert.deepEqual(v.grants,{});assert.deepEqual(v.agents,[]);assert.deepEqual(v.items,[]);assert.equal(v.issue,null);assert.equal(v.notice,""); };

test("AF-166 fresh real Cookie/API/DB + compiled SDK and private memory UI state",{timeout:420000},async t=>{
  assert.equal(process.env.AIJ_AF166_ROOT_LIVE,"1","Root explicitly opts into this fresh test");
  assert.equal(resolve(process.cwd()),"/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation");
  const git = f => resolve(repositoryRoot,execFileSync("git",["rev-parse",f],{encoding:"utf8"}).trim());
  assert.equal(git("--git-dir"),git("--git-common-dir"));assert.equal(execFileSync("git",["branch","--show-current"],{encoding:"utf8"}).trim(),"dev");
  await checkDatabase("test"); const lease=await createAcceptance("test",task);
  assert.equal((await migrate({mode:"test",action:"deploy",acceptanceId:lease.id})).exitCode,0);
  assert.equal((await migrate({mode:"test",action:"status",acceptanceId:lease.id})).exitCode,0);
  await seedDatabase({mode:"test",acceptanceId:lease.id,generateCredentials:true,runtimeManagement:true,pluginManagement:true,configuration:true,secrets:true,aiCenter:true});
  const previous={...process.env},proof={task,acceptanceId:lease.id,database:lease.database,status:"RUNNING",workerRun:false};let app;
  const stores=[];
  try {
    const env=clientEnvironment(lease.id,task);for(const key of Object.keys(process.env))delete process.env[key];Object.assign(process.env,env,{ASYNC_RUNTIME_ENABLED:"false",ENABLED_PLUGINS:"aij-ai",AI_CENTER_LIVE_ENABLED:"false"});
    const {createApplication}=require("../../apps/api/dist/bootstrap.js"),{PrismaService}=require("../../apps/api/dist/prisma/prisma.service.js");
    app=await createApplication();await app.listen(0,"127.0.0.1");const prisma=app.get(PrismaService);
    const base=`http://127.0.0.1:${app.getHttpServer().address().port}/api`;
    const db=op=>withDatabase("test",readDatabaseEnvironment("test",process.env,lease.id),op,{acceptanceId:lease.id});
    const hashes=()=>db(async c=>{const tables=(await c.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows,out={};for(const {tablename}of tables){assert.match(tablename,/^[A-Za-z_][A-Za-z0-9_]*$/);const projection=tablename==="client_auth_session"?"(to_jsonb(t)-'last_seen_at'-'updated_at')::text":"row_to_json(t)::text";const rows=(await c.query('SELECT '+projection+' AS row FROM public."'+tablename+'" t')).rows.map(r=>r.row).sort();out[tablename]=createHash("sha256").update(JSON.stringify(rows)).digest("hex");}return out;});
    const denied=async op=>{const before=await hashes();await op();assert.deepEqual(await hashes(),before,"denial must not change durable domain/audit rows");};
    const {PluginCatalog}=require("../../apps/api/dist/plugin-runtime/plugin-catalog.js"),{PluginLifecycleService}=require("../../apps/api/dist/plugin-runtime/plugin-lifecycle.service.js");
    const admin=await prisma.sysUser.findUniqueOrThrow({where:{username:"aij-admin"}}),lifecycle=app.get(PluginLifecycleService),catalogService=app.get(PluginCatalog);
    await lifecycle.install("aij-ai",catalogService.manifest("aij-ai").version,admin.id,"af166-install");await lifecycle.enable("aij-ai",admin.id,"af166-enable");
    const {AiCenterConfigurationService}=require("../../apps/api/dist/plugins/aij-ai/ai-center-configuration.service.js"),config=app.get(AiCenterConfigurationService);
    process.env.AIJ_SECRET_AIJ_FOUNDATION_TEST_AF166="synthetic-"+randomBytes(24).toString("hex");const ref="env://AIJ_SECRET_AIJ_FOUNDATION_TEST_AF166";await prisma.secretReference.create({data:{ref,provider:"env"}});
    const catalog=syntheticAiCatalog(ref),catalogVersion=(await config.save({catalog,expectedVersion:0},admin.id,"af166-catalog")).version;
    const {AiCenterHttpTransport}=require("../../apps/api/dist/plugins/aij-ai/ai-center-provider.js");let upstream=0;app.get(AiCenterHttpTransport).request=async()=>{upstream++;throw new Error("Unexpected AF166 upstream");};
    const initialHashes=await hashes(),cookies=[],accounts=[],spaces=[];
    for(let i=0;i<2;i++){
      const password="AF166-"+randomBytes(24).toString("hex"),account=await prisma.memberUser.create({data:{email:`af166-${randomUUID()}@example.test`,nickname:"AF166 synthetic",passwordHash:await require("bcryptjs").hash(password,12),emailVerifiedAt:new Date()}});accounts.push(account);
      const r=await fetch(base+"/client/auth/login",{method:"POST",headers:{origin:env.WEB_URL,"content-type":"application/json"},body:JSON.stringify({email:account.email,password}),signal:AbortSignal.timeout(15000)});assert.equal(r.status,200);assert.match(r.headers.get("set-cookie"),/HttpOnly/);cookies.push(r.headers.get("set-cookie").split(";")[0]);await r.arrayBuffer();
    }
    const apiFor=actor=>{const transport=createClientApi(()=>base);return (path,options={})=>transport(path,{...options,headers:{cookie:cookies[actor],origin:env.WEB_URL}});};
    const owner=apiFor(0),foreign=apiFor(1),memories=createPersonalMemoriesClient(owner),agents=createPersonalAgentsClient(owner);
    for(let i=0;i<2;i++)spaces.push(await owner("/client/workspaces",{method:"POST",body:JSON.stringify({name:"AF166 private space "+i,idempotencyKey:"af166-"+randomUUID()})}));
    const ownerRole=await prisma.clientWorkspaceRole.findUniqueOrThrow({where:{workspaceId_code:{workspaceId:spaces[0].id,code:"OWNER"}}});
    await prisma.clientWorkspaceMembership.create({data:{workspaceId:spaces[0].id,memberId:accounts[1].id,roleId:ownerRole.id}});
    const model=catalog.models.find(m=>m.enabled&&m.capability==="text");assert.ok(model);
    const agentInput={code:"af166-agent",name:"AF166 real own named Agent",instructions:"Synthetic Agent only",enabled:false,modelCode:model.code,modelRevision:model.revision,catalogVersion,inputFields:["request"],outputFormat:"text",outputFields:[],skillBindings:[]};
    const ownAgent=await agents.create(spaces[0].id,agentInput),foreignAgent=await createPersonalAgentsClient(foreign).create(spaces[0].id,{...agentInput,name:"AF166 foreign Agent"});
    const makeStore=request=>{const s=createMemoryLibrary({request,memoriesClientFactory:createPersonalMemoriesClient,agentsClientFactory:createPersonalAgentsClient});stores.push(s);return s;};
    const s=makeStore(owner);await s.start(spaces[0].id);assert.equal(s.getSnapshot().principal.id,accounts[0].id);
    const input={code:"af166-memory",title:"AF166 title sentinel",content:"AF166 explicit private content sentinel",kind:"confirmed_fact",enabled:true,agentIds:[ownAgent.id]};let made;
    const setInput=(store,fields)=>{for(const [k,v]of Object.entries(fields))if(!["agentIds"].includes(k))store.setDraft(k,v);};
    await t.test("create confirmation, disabled real named Agent preauthorization, full replacement/revoke, noop and replay",async()=>{
      await s.openCreate();assert.equal(s.getSnapshot().draft.enabled,false);assert.deepEqual(s.getSnapshot().draft.agentIds,[]);assert.ok(s.getSnapshot().agents.some(a=>a.id===ownAgent.id&&a.name===agentInput.name&&!a.enabled));assert.equal(s.getSnapshot().agents.some(a=>a.id===foreignAgent.id),false);
      setInput(s,input);s.addGrant(ownAgent.id);s.requestSave();assert.equal(s.getSnapshot().confirmation,"create");assert.equal(await prisma.aiPersonalMemory.count(),0);await s.confirmMutation();assert.equal(s.getSnapshot().issue,null);made=(await memories.list(spaces[0].id)).items.find(m=>m.code===input.code);assert.ok(made);
      await s.openDetail(made.id);assert.equal(s.getSnapshot().detail.content,input.content);assert.equal(s.getSnapshot().grants[ownAgent.id].name,agentInput.name);
      await s.openEdit();s.setDraft("title","AF166 changed title sentinel");s.requestSave();await s.confirmMutation();assert.equal((await memories.get(spaces[0].id,made.id)).revision,2);
      await s.openDetail(made.id);await s.openEdit();s.requestSave();await s.confirmMutation();assert.equal((await memories.get(spaces[0].id,made.id)).revision,2,"noop stays current");
      await s.openDetail(made.id);await s.openEdit();s.removeGrant(ownAgent.id);s.setDraft("enabled",false);s.requestSave();await s.confirmMutation();const current=await memories.get(spaces[0].id,made.id);assert.equal(current.revision,3);assert.equal(current.enabled,false);assert.deepEqual(current.agentIds,[]);
      assert.deepEqual(await memories.create(spaces[0].id,input),current,"initial replay returns current content without restoring grants");
      const omitted=await memories.update(spaces[0].id,made.id,{title:current.title,content:current.content,kind:current.kind,expectedRevision:3});assert.equal(omitted.enabled,false);assert.deepEqual(omitted.agentIds,[]);
    });
    await t.test("real 409 UI recovery, foreign404 and readonly403 change zero domain rows",async()=>{
      await s.openDetail(made.id);await s.openEdit();s.setDraft("content","AF166 pending draft");const c=await memories.get(spaces[0].id,made.id);await memories.update(spaces[0].id,made.id,{title:c.title,content:"AF166 concurrent content sentinel",kind:c.kind,enabled:false,agentIds:[],expectedRevision:c.revision});s.requestSave();await denied(()=>s.confirmMutation());assert.equal(s.getSnapshot().issue.status,409);assert.equal(s.getSnapshot().draft.content,"");assert.equal(s.getSnapshot().confirmation,null);
      await denied(()=>assert.rejects(createPersonalMemoriesClient(foreign).get(spaces[0].id,made.id),e=>e instanceof ClientRequestFailure&&e.status===404));
      await denied(()=>assert.rejects(memories.create(spaces[0].id,{...input,code:"af166-foreign-grant",agentIds:[foreignAgent.id]}),e=>e.status===404));
      const permission=await prisma.clientWorkspacePermission.findUniqueOrThrow({where:{code:"workspace.ai.assets.manage"}}),grant=await prisma.clientWorkspaceRolePermission.findUniqueOrThrow({where:{roleId_permissionId:{roleId:ownerRole.id,permissionId:permission.id}}});
      await prisma.clientWorkspaceRolePermission.update({where:{id:grant.id},data:{deletedAt:new Date()}});
      try {await s.refresh();await s.openDetail(made.id);assert.ok(s.getSnapshot().detail);await s.openEdit();assert.equal(s.getSnapshot().editor,null);await denied(()=>assert.rejects(memories.update(spaces[0].id,made.id,{title:input.title,content:input.content,kind:input.kind,expectedRevision:4}),e=>e.status===403));}
      finally{await prisma.clientWorkspaceRolePermission.update({where:{id:grant.id},data:{deletedAt:null}});}
    });
    await t.test("HTTP response barrier fences private detail/options/grants and mutation results after workspace change",async()=>{
      const c=await memories.get(spaces[0].id,made.id);await memories.update(spaces[0].id,made.id,{title:c.title,content:c.content,kind:c.kind,enabled:true,agentIds:[ownAgent.id],expectedRevision:c.revision});
      for(const target of ["detail","options","grant","mutation"]){
        const entered=deferred(),release=deferred();let armed=false,held=false;
        const store=makeStore(async(p,o)=>{const v=await owner(p,o);const matches=target==="detail"?p.endsWith("/"+made.id)&&o.method==="GET":target==="options"?p.includes("personal-agents?"):target==="grant"?p.endsWith("/"+ownAgent.id):o.method==="PATCH";if(armed&&!held&&matches){held=true;entered.resolve();await release.promise;}return v;});
        await store.start(spaces[0].id);let pending;
        if(target==="mutation"){await store.openDetail(made.id);await store.openEdit();store.setDraft("title","AF166 barrier change");store.requestSave();armed=true;pending=store.confirmMutation();}
        else{armed=true;pending=target==="options"?store.openCreate():store.openDetail(made.id);}
        try{await Promise.race([entered.promise,pending.then(()=>{throw new Error("AF166 real HTTP barrier missed");})]);const switched=store.selectWorkspace(spaces[1].id);assert.equal(store.getSnapshot().detail,null);assert.equal(store.getSnapshot().draft.content,"");assert.deepEqual(store.getSnapshot().grants,{});await switched;const before=store.getSnapshot();release.resolve();await pending;assert.equal(store.getSnapshot(),before);assert.equal(store.getSnapshot().workspaceId,spaces[1].id);}
        finally{release.resolve();await pending;store.dispose();cleared(store);}
      }
    });
    await t.test("real success followed by refresh transport failure has explicit partial outcome, not silent retry",async()=>{
      let committed=false;const store=makeStore(async(p,o)=>{if(committed&&p.includes("personal-memories?"))throw new ClientRequestFailure(503);const v=await owner(p,o);if(o.method==="POST"&&p.endsWith("personal-memories"))committed=true;return v;});await store.start(spaces[0].id);await store.openCreate();setInput(store,{code:"af166-partial",title:"AF166 partial title",content:"AF166 partial content",kind:"task_summary"});store.requestSave();await store.confirmMutation();assert.match(store.getSnapshot().notice,/已确认保存/);assert.match(store.getSnapshot().issue.message,/写入已确认/);assert.equal(store.getSnapshot().draft.content,"");assert.equal((await memories.list(spaces[0].id)).items.filter(m=>m.code==="af166-partial").length,1);store.dispose();cleared(store);
    });
    await t.test("actual list cursors and deleted/unreadable Agent require explicit grant removal",async()=>{
      const first=await memories.list(spaces[0].id,{limit:1});assert.ok(first.nextCursor);const next=await memories.list(spaces[0].id,{limit:1,afterId:first.nextCursor});assert.ok(next.items.length);assert.notEqual(next.items[0].id,first.items[0].id);
      await agents.delete(spaces[0].id,ownAgent.id,1);await s.refresh();await s.openDetail(made.id);assert.deepEqual(s.getSnapshot().grants[ownAgent.id],{available:false});await s.openEdit();assert.equal(s.readyToSave(),false);s.removeGrant(ownAgent.id);assert.equal(s.readyToSave(),true);s.requestSave();await s.confirmMutation();assert.deepEqual((await memories.get(spaces[0].id,made.id)).agentIds,[]);
    });
    await t.test("confirmation and all private UI state dispose immediately; deletion irreversibly erases current content/grants/code",async()=>{
      await s.openDetail(made.id);s.requestDelete();assert.equal(s.getSnapshot().confirmation,"delete");s.dispose();cleared(s);await s.refresh();assert.equal(s.getSnapshot().workspaceId,spaces[0].id);await s.openDetail(made.id);s.requestDelete();await s.confirmMutation();assert.equal(s.getSnapshot().issue,null);assert.match(s.getSnapshot().notice,/无法恢复/);
      await denied(()=>assert.rejects(memories.get(spaces[0].id,made.id),e=>e.status===404));await denied(()=>assert.rejects(memories.create(spaces[0].id,input),e=>e.status===409));const row=await prisma.aiPersonalMemory.findUniqueOrThrow({where:{id:made.id}});for(const k of ["title","content","kind","enabled","initialDigest"])assert.equal(row[k],null);assert.equal(await prisma.aiPersonalMemoryAgentGrant.count({where:{memoryId:made.id}}),0);
      const audits=await prisma.auditLog.findMany({where:{resourceType:"ai_personal_memory"}});for(const log of audits)for(const secret of [input.content,input.title,agentInput.name,"AF166 concurrent content sentinel"])assert.equal(JSON.stringify(log).includes(secret),false);
      const out=makeStore(owner);await out.start(spaces[0].id);await out.openCreate();setInput(out,{code:"af166-private-draft",title:"Private draft",content:"Private draft content"});out.requestSave();const logout=out.signOut();assert.equal(out.getSnapshot().confirmation,null);assert.equal(out.getSnapshot().draft.content,"");assert.deepEqual(out.getSnapshot().agents,[]);await logout;out.dispose();cleared(out);
    });
    const final=await hashes();const ledgers=Object.keys(initialHashes).filter(n=>/^(runtime_job|runtime_outbox|ai_agent_run|ai_execution_trace|ai_.*budget.*|ai_.*usage.*|ai_evaluation_record)$/.test(n));for(const name of ["runtime_job","ai_agent_run","ai_execution_trace"])assert.ok(ledgers.includes(name));for(const name of ledgers)assert.equal(final[name],initialHashes[name],name+" unchanged");assert.equal(upstream,0);
    proof.upstreamCalls=upstream;proof.executionLedgersUnchanged=ledgers;proof.httpBarriers=["detail","options","grant","mutation"];proof.status="EVIDENCE_RECORDED_ROOT_FORMAL_REPORT_IS_AUTHORITY";
  } finally {
    for(const s of stores)s.dispose();
    try {await app?.close();proof.applicationPools=await withDatabase("test",readDatabaseEnvironment("test",process.env,lease.id),async c=>(await c.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND application_name LIKE 'aij-api:%'")).rows[0].n,{acceptanceId:lease.id});assert.equal(proof.applicationPools,0);const folder=join(repositoryRoot,".artifacts/auto-ai-program-20261105/AF-166");mkdirSync(folder,{recursive:true,mode:0o700});writeFileSync(join(folder,"live-"+lease.id+".json"),JSON.stringify(proof,null,2)+"\n",{mode:0o600});}
    finally {for(const key of Object.keys(process.env))delete process.env[key];Object.assign(process.env,previous);}
  }
});
