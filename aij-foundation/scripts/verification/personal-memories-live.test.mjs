// ROOT ONLY / WORKER NOT_RUN. Root registers AF-163 lease/runner, app module, SDK exports
// and schema proposal first, then uses protected isolated DB + fresh generated/build artifacts.
// Worker must never run this file. Fresh lease only; no adoption/reset or prior-card evidence.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import test from 'node:test';
import {createAcceptance,migrate} from '../database/migration.mjs';
import {seedDatabase} from '../database/seed.mjs';
import {clientEnvironment} from './client-auth-fixture.mjs';
import {syntheticAiCatalog} from './ai-center-fixture.mjs';
import {repositoryRoot,checkDatabase,withDatabase,readDatabaseEnvironment} from '../database/connection.mjs';
const require=createRequire(join(repositoryRoot,'apps/api/package.json'));
const task='AF-163';
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const pause=ms=>new Promise(r=>setTimeout(r,ms));

test('AF-163 fresh Cookie/API/PostgreSQL personal memory erasure + explicit Agent grants',{timeout:420000},async t=>{
  assert.equal(process.env.AIJ_AF163_ROOT_LIVE,'1');
  assert.equal(resolve(process.cwd()),'/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation');
  const git=flag=>resolve(repositoryRoot,execFileSync('git',['rev-parse',flag],{encoding:'utf8'}).trim());assert.equal(git('--git-dir'),git('--git-common-dir'));
  assert.equal(execFileSync('git',['branch','--show-current'],{encoding:'utf8'}).trim(),'dev');
  const packedConsumer=process.env.AIJ_AF163_PACKED_CONSUMER;assert.equal(typeof packedConsumer,'string');assert.ok(resolve(packedConsumer).startsWith(join(repositoryRoot,'.artifacts')+'/'));
  await checkDatabase('test');const lease=await createAcceptance('test',task);
  assert.equal((await migrate({mode:'test',action:'deploy',acceptanceId:lease.id})).exitCode,0);
  assert.equal((await migrate({mode:'test',action:'status',acceptanceId:lease.id})).exitCode,0);
  await seedDatabase({mode:'test',acceptanceId:lease.id,generateCredentials:true,runtimeManagement:true,pluginManagement:true,configuration:true,secrets:true,aiCenter:true});
  const previous={...process.env},proof={task,acceptanceId:lease.id,database:lease.database,status:'RUNNING'};let app;
  try{
    const env=clientEnvironment(lease.id,task);for(const k of Object.keys(process.env))delete process.env[k];Object.assign(process.env,env,{ASYNC_RUNTIME_ENABLED:'false',ENABLED_PLUGINS:'aij-ai',AI_CENTER_LIVE_ENABLED:'false'});
    const {createApplication}=require('../../apps/api/dist/bootstrap.js'),{PrismaService}=require('../../apps/api/dist/prisma/prisma.service.js');
    app=await createApplication();await app.listen(0,'127.0.0.1');const prisma=app.get(PrismaService);
    const base=`http://127.0.0.1:${app.getHttpServer().address().port}/api`,route='/client/ai/personal-memories';
    const db=op=>withDatabase('test',readDatabaseEnvironment('test',process.env,lease.id),op,{acceptanceId:lease.id});
    const {PluginCatalog}=require('../../apps/api/dist/plugin-runtime/plugin-catalog.js'),{PluginLifecycleService}=require('../../apps/api/dist/plugin-runtime/plugin-lifecycle.service.js');
    const admin=await prisma.sysUser.findUniqueOrThrow({where:{username:'aij-admin'}}),lifecycle=app.get(PluginLifecycleService),pluginCatalog=app.get(PluginCatalog);
    await lifecycle.install('aij-ai',pluginCatalog.manifest('aij-ai').version,admin.id,'af163-install');await lifecycle.enable('aij-ai',admin.id,'af163-enable');
    const {AiCenterConfigurationService}=require('../../apps/api/dist/plugins/aij-ai/ai-center-configuration.service.js'),config=app.get(AiCenterConfigurationService);
    const secretKey='AIJ_SECRET_AIJ_FOUNDATION_TEST_AF163';process.env[secretKey]='synthetic-'+randomBytes(24).toString('hex');const ref='env://'+secretKey;
    await prisma.secretReference.create({data:{ref,provider:'env'}});
    let catalog=syntheticAiCatalog(ref),catalogVersion=(await config.save({catalog,expectedVersion:0},admin.id,'af163-catalog')).version;
    const {AiCenterHttpTransport}=require('../../apps/api/dist/plugins/aij-ai/ai-center-provider.js');let upstream=0;app.get(AiCenterHttpTransport).request=async()=>{upstream++;throw new Error('Unexpected AI upstream');};
    const tableHashes=()=>db(async client=>{
      const tables=(await client.query("SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname='public' ORDER BY tablename")).rows,out={};
      for(const {tablename}of tables){assert.match(tablename,/^[A-Za-z_][A-Za-z0-9_]*$/);const projection=tablename==='client_auth_session'?"(to_jsonb(t)-'last_seen_at'-'updated_at')::text":'row_to_json(t)::text';const rows=(await client.query('SELECT '+projection+' AS row FROM public."'+tablename+'" t')).rows.map(r=>r.row).sort();out[tablename]=createHash('sha256').update(JSON.stringify(rows)).digest('hex');}return out;
    });
    const denied=async op=>{const before=await tableHashes();await op();assert.deepEqual(await tableHashes(),before,'denial must change zero durable domain/audit rows');};
    const executionBefore=await tableHashes();
    const cookies=[],accounts=[],spaces=[];
    for(let i=0;i<3;i++){
      const password='Af159-'+randomBytes(24).toString('hex'),account=await prisma.memberUser.create({data:{email:`af163-${randomUUID()}@example.test`,nickname:'AF163 synthetic',passwordHash:await require('bcryptjs').hash(password,12),emailVerifiedAt:new Date()}});accounts.push(account);
      const r=await fetch(base+'/client/auth/login',{method:'POST',headers:{origin:env.WEB_URL,'content-type':'application/json'},body:JSON.stringify({email:account.email,password}),signal:AbortSignal.timeout(15000)});assert.equal(r.status,200);const cookie=r.headers.get('set-cookie');assert.match(cookie,/HttpOnly/);cookies.push(cookie.split(';')[0]);await r.arrayBuffer();
    }
    const request=async(method,path='',{actor=0,workspace=spaces[0]?.id,body,status=200,origin=env.WEB_URL,headers={},prefix=route}={})=>{
      const r=await fetch(base+prefix+path,{method,headers:{connection:'close',...(actor===null?{}:{cookie:cookies[actor]}),...(workspace?{'x-aij-workspace-id':workspace}:{}),...(origin?{origin}:{}),...(body===undefined?{}:{'content-type':'application/json'}),...headers},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
      const raw=await r.text();if(Array.isArray(status))assert.ok(status.includes(r.status),`unexpected HTTP ${r.status}`);else assert.equal(r.status,status,`${method} ${prefix}${path} HTTP ${r.status}`);
      if(prefix===route){assert.match(r.headers.get('cache-control')||'',/no-store/);assert.match(r.headers.get('x-correlation-id')||'',/^[A-Za-z0-9._:-]{8,128}$/);}
      const data=raw?JSON.parse(raw).data:null;return Array.isArray(status)?{status:r.status,data}:data;
    };
    for(let i=0;i<2;i++)spaces.push(await request('POST','',{prefix:'/client/workspaces',actor:i,body:{name:'AF163 space '+i,idempotencyKey:'af163-'+randomUUID()},status:201}));
    const ownerRoles=[];for(const [i,w]of spaces.entries()){const role=await prisma.clientWorkspaceRole.findUniqueOrThrow({where:{workspaceId_code:{workspaceId:w.id,code:'OWNER'}}});ownerRoles.push(role);await prisma.clientWorkspaceMembership.create({data:{workspaceId:w.id,memberId:accounts[1-i].id,roleId:role.id}});}
    const memberRole=await prisma.clientWorkspaceRole.findUniqueOrThrow({where:{workspaceId_code:{workspaceId:spaces[0].id,code:'MEMBER'}}});await prisma.clientWorkspaceMembership.create({data:{workspaceId:spaces[0].id,memberId:accounts[2].id,roleId:memberRole.id}});
    const model=catalog.models.find(m=>m.enabled&&m.capability==='text');assert.ok(model);
    const agentInput={code:'memory-private-agent',name:'AF163 Agent private name sentinel',instructions:'AF163 Agent instructions sentinel',enabled:false,
      modelCode:model.code,modelRevision:model.revision,catalogVersion,inputFields:['request'],outputFormat:'text',outputFields:[],skillBindings:[]};
    const agent=await request('POST','',{prefix:'/client/ai/personal-agents',body:agentInput,status:201});
    const foreignAgent=await request('POST','',{prefix:'/client/ai/personal-agents',actor:1,body:agentInput,status:201});
    const spaceAgent=await request('POST','',{prefix:'/client/ai/personal-agents',workspace:spaces[1].id,body:agentInput,status:201});
    const secondAgent=await request('POST','',{prefix:'/client/ai/personal-agents',body:{...agentInput,code:'memory-second-agent'},status:201});
    const tombstoneAgent=await request('POST','',{prefix:'/client/ai/personal-agents',body:{...agentInput,code:'memory-tombstone-agent'},status:201});
    await request('DELETE','/'+tombstoneAgent.id,{prefix:'/client/ai/personal-agents',body:{expectedRevision:1}});
    const initial={code:'explicit-private-memory',title:'AF163 private memory title sentinel',content:'AF163 explicitly confirmed private text sentinel',kind:'confirmed_fact',enabled:true,agentIds:[agent.id]};
    const edit=(extra={})=>{const body={...initial,...extra};delete body.code;return {...body,expectedRevision:extra.expectedRevision??1};};
    let memory;
    await t.test('Cookie/context/Origin/allowlist/size refusals are no-store with zero durable changes',async()=>{
      for(const [field,value]of Object.entries({memberId:accounts[1].id,workspaceId:spaces[1].id,source:'automatic',system:true,global:true,secret:'opaque',tools:[],upload:'file',restore:true}))
        await denied(()=>request('POST','',{body:{...initial,[field]:value},status:400}));
      for(const bad of [{content:' '},{content:'x'.repeat(4001)},{title:'x'.repeat(101)},{kind:'inferred_fact'},{enabled:'true'},{agentIds:[agent.id,agent.id]},{agentIds:Array.from({length:17},()=>randomUUID())}])
        await denied(()=>request('POST','',{body:{...initial,...bad},status:400}));
      for(const options of [{actor:null,status:401},{actor:2,status:403},{actor:2,workspace:spaces[1].id,status:403},{workspace:null,status:400},{origin:null,status:403},{origin:'https://foreign.example',status:403},{headers:{'sec-fetch-site':'cross-site'},status:403}])
        await denied(()=>request('POST','',{...options,body:initial}));
      for(const query of ['?memberId=other','?limit=51','?limit=1&limit=2','?afterId=..%2Fother'])await denied(()=>request('GET',query,{status:400}));
      for(const agentId of [foreignAgent.id,spaceAgent.id,tombstoneAgent.id,randomUUID()])await denied(()=>request('POST','',{body:{...initial,agentIds:[agentId]},status:404}));
      await denied(async()=>{const r=await fetch(base+route,{method:'POST',headers:{cookie:cookies[0],origin:env.WEB_URL,'x-aij-workspace-id':spaces[0].id,'content-type':'application/json'},body:'{',signal:AbortSignal.timeout(15000)});assert.equal(r.status,400);assert.match(r.headers.get('cache-control')||'',/no-store/);await r.arrayBuffer();});
      assert.equal(await prisma.aiPersonalMemory.count(),0);
    });
    await t.test('single current owner, disabled Agent preauthorization, safe summary and exact initial replay',async()=>{
      memory=await request('POST','',{body:initial,status:201});assert.equal(memory.revision,1);assert.equal(memory.enabled,true);assert.deepEqual(memory.agentIds,[agent.id]);
      assert.equal((await prisma.aiPersonalAgent.findUniqueOrThrow({where:{id:agent.id}})).enabled,false,'disabled Agent may be preauthorized; no execution');
      assert.deepEqual(await request('POST','',{body:initial,status:201}),memory);
      await denied(()=>request('POST','',{body:{...initial,content:'Different initial text'},status:409}));
      for(const options of [{actor:1},{workspace:spaces[1].id}]){
        assert.equal((await request('GET','',options)).items.length,0);
        for(const id of [memory.id,randomUUID()])for(const [method,path,body]of [['GET','/'+id],['PATCH','/'+id,edit()],['DELETE','/'+id,{expectedRevision:1}]])await denied(()=>request(method,path,{...options,body,status:404}));
      }
      const row=await prisma.aiPersonalMemory.findUniqueOrThrow({where:{id:memory.id}});assert.equal(row.content,initial.content);assert.equal(row.title,initial.title);assert.match(row.initialDigest,/^[a-f0-9]{64}$/);
      const grants=await prisma.aiPersonalMemoryAgentGrant.findMany({where:{memoryId:memory.id}});assert.equal(grants.length,1);assert.equal(grants[0].memberId,accounts[0].id);assert.equal(grants[0].workspaceId,spaces[0].id);assert.equal(grants[0].agentId,agent.id);
      const list=await request('GET','?limit=1');assert.equal(Object.hasOwn(list.items[0],'content'),false);assert.equal(Object.hasOwn(list.items[0],'agentIds'),false);assert.equal(JSON.stringify(list).includes(initial.content),false);
      assert.deepEqual(await request('PATCH','/'+memory.id,{body:edit()}),memory,'noop does not increment revision');
      const defaulted=await request('POST','',{body:{code:'default-opt-out',title:'Explicit default',content:'Explicit default body',kind:'preference'},status:201});assert.equal(defaulted.enabled,false);assert.deepEqual(defaulted.agentIds,[]);
      const page=await request('GET','?limit=1');assert.ok(page.nextCursor);const next=await request('GET','?limit=1&afterId='+page.nextCursor);assert.notEqual(next.items[0].id,page.items[0].id);
    });
    await t.test('CAS and full replacement revoke grants atomically without a plaintext version',async()=>{
      const changed=await request('PATCH','/'+memory.id,{body:edit({title:'AF163 current title sentinel',content:'AF163 current text sentinel',agentIds:[secondAgent.id]})});assert.equal(changed.revision,2);assert.deepEqual(changed.agentIds,[secondAgent.id]);
      await denied(()=>request('PATCH','/'+memory.id,{body:edit(),status:409}));
      assert.deepEqual(await request('POST','',{body:initial,status:201}),changed,'exact initial replay returns current state without resurrecting old grants');
      const removed=await request('PATCH','/'+memory.id,{body:edit({expectedRevision:2,content:'AF163 current text sentinel',agentIds:[],enabled:false})});assert.equal(removed.revision,3);assert.equal(removed.enabled,false);assert.deepEqual(removed.agentIds,[]);
      assert.equal(await prisma.aiPersonalMemoryAgentGrant.count({where:{memoryId:memory.id}}),0);
      const tables=await prisma.$queryRaw`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'ai_personal_memory%' ORDER BY tablename`;
      assert.deepEqual(tables.map(r=>r.tablename),['ai_personal_memory','ai_personal_memory_agent_grant']);
      const audits=await prisma.auditLog.findMany({where:{resourceType:'ai_personal_memory'}});
      for(const audit of audits){assert.equal(audit.requestSummary,null);const json=JSON.stringify(audit);for(const text of [initial.content,initial.title,agentInput.name,'AF163 current text sentinel','AF163 current title sentinel'])assert.equal(json.includes(text),false);}
    });
    await t.test('active member/workspace/role/grant/project/org/plugin must remain current',async()=>{
      for(const [delegate,id]of [['memberUser',accounts[0].id],['clientWorkspace',spaces[0].id],['clientWorkspaceRole',ownerRoles[0].id]]){
        await prisma[delegate].update({where:{id},data:{status:'disabled'}});try{await denied(()=>request('GET','/'+memory.id,{status:delegate==='memberUser'?401:403}));}finally{await prisma[delegate].update({where:{id},data:{status:'active'}});}
      }
      const membership=await prisma.clientWorkspaceMembership.findUniqueOrThrow({where:{workspaceId_memberId:{workspaceId:spaces[0].id,memberId:accounts[0].id}}});
      await prisma.clientWorkspaceMembership.update({where:{id:membership.id},data:{status:'disabled',disabledAt:new Date()}});try{await denied(()=>request('GET','/'+memory.id,{status:403}));}finally{await prisma.clientWorkspaceMembership.update({where:{id:membership.id},data:{status:'active',disabledAt:null}});}
      const permission=await prisma.clientWorkspacePermission.findUniqueOrThrow({where:{code:'workspace.ai.assets.manage'}});
      const grant=await prisma.clientWorkspaceRolePermission.findUniqueOrThrow({where:{roleId_permissionId:{roleId:ownerRoles[0].id,permissionId:permission.id}}});
      await prisma.clientWorkspaceRolePermission.update({where:{id:grant.id},data:{deletedAt:new Date()}});try{await denied(()=>request('PATCH','/'+memory.id,{body:edit({expectedRevision:3}),status:403}));}finally{await prisma.clientWorkspaceRolePermission.update({where:{id:grant.id},data:{deletedAt:null}});}
      const project=await prisma.projectProfile.findUniqueOrThrow({where:{code:'aij-foundation-test'}});
      for(const [delegate,id]of [['projectProfile',project.id],['organizationProfile',project.organizationId]]){
        await prisma[delegate].update({where:{id},data:{status:'disabled'}});try{await denied(()=>request('GET','/'+memory.id,{status:503}));}finally{await prisma[delegate].update({where:{id},data:{status:'active'}});}
      }
      await lifecycle.disable('aij-ai',admin.id,'af163-disable');try{await denied(()=>request('GET','/'+memory.id,{status:404}));}finally{await lifecycle.enable('aij-ai',admin.id,'af163-enable-again');}
    });
    await t.test('generated models, columns/nullability/types/constraints/indexes and scope FK parity',async()=>{
      const {Prisma}=require('@prisma/client'),models=Prisma.dmmf.datamodel.models.filter(m=>['AiPersonalMemory','AiPersonalMemoryAgentGrant'].includes(m.name));assert.equal(models.length,2);
      for(const model of models){const columns=await prisma.$queryRaw`SELECT column_name,data_type,is_nullable,character_maximum_length,datetime_precision,column_default FROM information_schema.columns WHERE table_schema='public' AND table_name=${model.dbName}`;
        const fields=model.fields.filter(f=>f.kind==='scalar');assert.deepEqual(columns.map(c=>c.column_name).sort(),fields.map(f=>f.dbName??f.name).sort());
        for(const field of fields){const c=columns.find(c=>c.column_name===(field.dbName??field.name));assert.equal(c.is_nullable,field.isRequired?'NO':'YES');
          const type=field.type==='Int'?'integer':field.type==='Boolean'?'boolean':field.type==='DateTime'?'timestamp without time zone':['code','title','kind','initialDigest'].includes(field.name)?'character varying':'text';assert.equal(c.data_type,type);if(field.type==='DateTime')assert.equal(c.datetime_precision,3);if(['updatedAt','createdAt'].includes(field.name))assert.match(c.column_default,/CURRENT_TIMESTAMP|now\(\)/);
          if(type==='character varying')assert.equal(c.character_maximum_length,{code:63,title:100,kind:14,initialDigest:64}[field.name]);}
      }
      const constraints=await prisma.$queryRaw`SELECT conname,contype::text AS type,confupdtype::text AS u,confdeltype::text AS d,pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid IN ('public.ai_personal_memory'::regclass,'public.ai_personal_memory_agent_grant'::regclass)`;
      const fks=constraints.filter(c=>c.type==='f');assert.equal(fks.length,4);assert.ok(fks.every(c=>c.u==='r'&&c.d==='r'));
      for(const name of ['ai_personal_memory_owner_code_key','ai_personal_memory_id_scope_key','ai_personal_memory_content_check','ai_personal_memory_code_check','ai_personal_memory_revision_check','ai_personal_memory_grant_agent_key','ai_personal_memory_erasure_guard'])assert.ok(constraints.some(c=>c.conname===name),name);
      for(const [name,target]of [['ai_personal_memory_grant_agent_scope_fkey','ai_personal_agent'],['ai_personal_memory_grant_memory_scope_fkey','ai_personal_memory']]){const c=fks.find(c=>c.conname===name);assert.match(c.def,/workspace_id, member_id/);assert.ok(c.def.includes(target));}
      const indexes=await prisma.$queryRaw`SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename IN ('ai_personal_memory','ai_personal_memory_agent_grant')`;
      for(const name of ['ai_personal_memory_owner_page_idx','ai_personal_memory_member_idx','ai_personal_memory_grant_agent_scope_idx','ai_personal_memory_grant_memory_scope_idx'])assert.ok(indexes.some(i=>i.indexname===name));
      const triggers=await prisma.$queryRaw`SELECT tgname FROM pg_trigger WHERE tgrelid IN ('public.ai_personal_memory'::regclass,'public.ai_personal_memory_agent_grant'::regclass) AND NOT tgisinternal`;
      for(const name of ['ai_personal_memory_guard','ai_personal_memory_grant_guard','ai_personal_memory_truncate_guard','ai_personal_memory_erasure_guard'])assert.ok(triggers.some(t=>t.tgname===name));
      for(const sql of ['UPDATE public.ai_personal_memory SET member_id=member_id||\'x\',revision=revision+1','UPDATE public.ai_personal_memory SET code=code||\'x\',revision=revision+1','UPDATE public.ai_personal_memory SET content=NULL,revision=revision+1','UPDATE public.ai_personal_memory SET kind=\'inferred\',revision=revision+1','UPDATE public.ai_personal_memory SET content=repeat(\'a\',4001),revision=revision+1','DELETE FROM public.ai_personal_memory','TRUNCATE public.ai_personal_memory CASCADE'])await assert.rejects(db(c=>c.query(sql)));
      for(const ref of [foreignAgent,spaceAgent,tombstoneAgent])await assert.rejects(prisma.aiPersonalMemoryAgentGrant.create({data:{memoryId:memory.id,workspaceId:spaces[0].id,memberId:accounts[0].id,agentId:ref.id}}));
      const granted=await request('PATCH','/'+memory.id,{body:edit({expectedRevision:3,agentIds:[agent.id]})});assert.equal(granted.revision,4);
      await assert.rejects(db(c=>c.query('UPDATE public.ai_personal_memory SET title=NULL,content=NULL,kind=NULL,enabled=NULL,initial_digest=NULL,deleted_at=CURRENT_TIMESTAMP,revision=revision+1 WHERE id=$1',[memory.id])),'direct erasure with live grants must fail');
    });
    await t.test('SQL audit fault rolls back content/grants/create/delete, not just response',async()=>{
      await db(async c=>{await c.query("CREATE FUNCTION public.af163_audit_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.resource_type='ai_personal_memory' THEN RAISE EXCEPTION 'synthetic AF163 audit fault'; END IF; RETURN NEW; END; $$");await c.query('CREATE TRIGGER af163_audit_fault BEFORE INSERT ON public.audit_log FOR EACH ROW EXECUTE FUNCTION public.af163_audit_fault()');});
      try{
        await denied(()=>request('POST','',{body:{...initial,code:'audit-fault'},status:503}));
        await denied(()=>request('PATCH','/'+memory.id,{body:edit({expectedRevision:4,content:'Audit rollback body sentinel',agentIds:[secondAgent.id]}),status:503}));
        await denied(()=>request('DELETE','/'+memory.id,{body:{expectedRevision:4},status:503}));
      }finally{await db(async c=>{await c.query('DROP TRIGGER af163_audit_fault ON public.audit_log');await c.query('DROP FUNCTION public.af163_audit_fault()');});}
    });
    await t.test('PG session shows current permission revocation blocked until memory+grant save commits',async()=>{
      const {AiPersonalMemoriesService}=require('../../apps/api/dist/plugins/aij-ai/ai-personal-memories.service.js'),service=app.get(AiPersonalMemoriesService),original=service.audit.bind(service),entered=deferred(),release=deferred(),revoker=deferred();let pending,revocation;
      service.audit=async(...args)=>{entered.resolve();await release.promise;return original(...args);};
      try{pending=request('POST','',{body:{...initial,code:'permission-fence'},status:201});await Promise.race([entered.promise,pending.then(()=>{throw new Error('save missed fence barrier');})]);
        revocation=db(async c=>{await c.query('BEGIN');revoker.resolve((await c.query('SELECT pg_backend_pid() AS id')).rows[0].id);try{await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['aij-client-workspace-membership:'+spaces[0].id]);await c.query("UPDATE public.client_workspace_role SET status='disabled' WHERE id=$1",[ownerRoles[0].id]);await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}});
        const pid=await revoker.promise;let blocked=false;for(let i=0;i<40;i++){blocked=await db(async c=>(await c.query('SELECT cardinality(pg_blocking_pids($1))>0 AS b',[pid])).rows[0].b);if(blocked)break;await pause(25);}assert.equal(blocked,true);release.resolve();await pending;await revocation;
        await denied(()=>request('POST','',{body:{...initial,code:'after-revoke'},status:403}));proof.pgFenceObserved=true;
      }finally{release.resolve();service.audit=original;await pending?.catch(()=>{});await revocation?.catch(()=>{});await prisma.clientWorkspaceRole.update({where:{id:ownerRoles[0].id},data:{status:'active'}});}
    });
    await t.test('real concurrent replay and CAS serialize; Agent tombstone denies new grant without ref mutation',async()=>{
      const replay=await Promise.all([1,2].map(()=>request('POST','',{body:{...initial,code:'concurrent-initial'},status:201})));assert.equal(replay[0].id,replay[1].id);assert.equal(await prisma.auditLog.count({where:{resourceType:'ai_personal_memory',resourceId:replay[0].id}}),1);
      const cas=await Promise.all(['first','second'].map(title=>request('PATCH','/'+replay[0].id,{body:edit({title,agentIds:[secondAgent.id]}),status:[200,409]})));assert.deepEqual(cas.map(r=>r.status).sort(),[200,409]);
      await request('DELETE','/'+secondAgent.id,{prefix:'/client/ai/personal-agents',body:{expectedRevision:1}});
      const agentRows=await prisma.aiPersonalAgentVersion.findMany({where:{agentId:secondAgent.id}});
      await denied(()=>request('POST','',{body:{...initial,code:'no-resurrect-agent',agentIds:[secondAgent.id]},status:404}));
      await denied(()=>request('PATCH','/'+memory.id,{body:edit({expectedRevision:4,agentIds:[secondAgent.id]}),status:404}));
      assert.ok((await prisma.aiPersonalAgent.findUniqueOrThrow({where:{id:secondAgent.id}})).deletedAt);assert.deepEqual(await prisma.aiPersonalAgentVersion.findMany({where:{agentId:secondAgent.id}}),agentRows);
    });
    await t.test('packed SDK ESM/CJS consumer resolves exports and real HTTP 409 behavior',async()=>{
      // Root must first build+pack/install @aij/contracts and @aij/sdk into an isolated ignored consumer.
      const consumer=packedConsumer;assert.ok(consumer,'packed consumer directory required, never silently use source/dist');
      const consumerPath=resolve(consumer);assert.ok(consumerPath.startsWith(join(repositoryRoot,'.artifacts')+'/'));execFileSync('git',['check-ignore','--quiet',consumerPath],{stdio:'ignore'});
      const consumerRequire=createRequire(join(consumerPath,'package.json')),sdkPath=consumerRequire.resolve('@aij/sdk');assert.ok(sdkPath.startsWith(consumerPath+'/node_modules/'));
      const esPath=join(consumerPath,'node_modules/@aij/sdk/dist/index.mjs');
      for(const sdk of [consumerRequire('@aij/sdk'),await import(pathToFileURL(esPath))]){
        assert.equal(typeof sdk.createPersonalMemoriesClient,'function');const api=sdk.createClientApi(()=>base),client=sdk.createPersonalMemoriesClient((p,o={})=>api(p,{...o,headers:{cookie:cookies[0],origin:env.WEB_URL}}));
        const made=await client.create(spaces[0].id,{code:'packed-'+randomUUID(),title:'Packed explicit memory',content:'Packed SDK explicit submission',kind:'task_summary'});assert.equal(made.enabled,false);assert.deepEqual(made.agentIds,[]);
        assert.equal((await client.get(spaces[0].id,memory.id)).revision,4);assert.ok((await client.list(spaces[0].id,{limit:1})).items.length);
        await assert.rejects(client.update(spaces[0].id,memory.id,edit({expectedRevision:1})),e=>e instanceof sdk.ClientRequestFailure&&e.status===409);
        const updated=await client.update(spaces[0].id,made.id,{title:made.title,content:made.content,kind:made.kind,agentIds:[agent.id],enabled:true,expectedRevision:1});assert.equal(updated.revision,2);assert.equal((await client.delete(spaces[0].id,made.id,2)).deleted,true);
      }
    });
    await t.test('erasure nulls content/title/digest and all grants, stable deletion and irreversible tombstone',async()=>{
      const gone=await request('DELETE','/'+memory.id,{body:{expectedRevision:4}});assert.deepEqual(gone,{id:memory.id,revision:5,deleted:true});assert.deepEqual(await request('DELETE','/'+memory.id,{body:{expectedRevision:1}}),gone);
      await denied(()=>request('GET','/'+memory.id,{status:404}));await denied(()=>request('PATCH','/'+memory.id,{body:edit({expectedRevision:5}),status:404}));await denied(()=>request('POST','',{body:initial,status:409}));
      const row=await prisma.aiPersonalMemory.findUniqueOrThrow({where:{id:memory.id}});for(const key of ['title','content','kind','enabled','initialDigest'])assert.equal(row[key],null);assert.equal(await prisma.aiPersonalMemoryAgentGrant.count({where:{memoryId:memory.id}}),0);
      await assert.rejects(prisma.aiPersonalMemory.update({where:{id:memory.id},data:{deletedAt:null,title:initial.title,content:initial.content,kind:initial.kind,enabled:false,revision:6}}));
      // Other active memories intentionally retain their own explicit content. Erase them too, then inspect EVERY table.
      const active=await prisma.aiPersonalMemory.findMany({where:{deletedAt:null,workspaceId:spaces[0].id,memberId:accounts[0].id}});
      for(const r of active)await request('DELETE','/'+r.id,{body:{expectedRevision:r.revision}});
      await db(async c=>{const tables=(await c.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows;
        for(const {tablename}of tables){assert.match(tablename,/^[A-Za-z_][A-Za-z0-9_]*$/);const rows=(await c.query('SELECT row_to_json(t)::text AS row FROM public."'+tablename+'" t')).rows;
          for(const r of rows)for(const text of [initial.content,initial.title,'AF163 current text sentinel','AF163 current title sentinel','Audit rollback body sentinel'])assert.equal(r.row.includes(text),false,tablename+' retained erased plaintext');}});
      const errors=await fetch(base+route+'/'+memory.id,{headers:{cookie:cookies[0],'x-aij-workspace-id':spaces[0].id}});assert.equal(errors.status,404);assert.equal((await errors.text()).includes(initial.content),false);
      proof.erasureAllTables=true;
    });
    await t.test('real concurrent 200th active creation, deleted code never reusable',async()=>{
      for(let i=0;i<199;i++)await request('POST','',{body:{...initial,code:'quota-'+i,content:'AF163 quota explicit body'},status:201});
      const results=await Promise.all(['quota-last-a','quota-last-b'].map(code=>request('POST','',{body:{...initial,code,content:'AF163 quota explicit body'},status:[201,409]})));assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);assert.equal(await prisma.aiPersonalMemory.count({where:{workspaceId:spaces[0].id,memberId:accounts[0].id,deletedAt:null}}),200);
      await denied(()=>request('POST','',{body:initial,status:409}));
    });
    const final=await tableHashes();for(const table of Object.keys(executionBefore).filter(name=>/^(runtime_job|runtime_outbox|ai_agent_run|ai_execution_trace|ai_.*budget.*|ai_.*usage.*|ai_evaluation_record)$/.test(name)))assert.equal(final[table],executionBefore[table],table+' must remain unchanged');assert.equal(upstream,0);
    proof.upstreamCalls=upstream;proof.executionLedgersUnchanged=true;proof.currentRows=await prisma.aiPersonalMemory.count();proof.grantRows=await prisma.aiPersonalMemoryAgentGrant.count();proof.status='EVIDENCE_RECORDED_FORMAL_REPORT_IS_AUTHORITY';
  }finally{
    try{await app?.close();proof.applicationPools=await withDatabase('test',readDatabaseEnvironment('test',process.env,lease.id),async c=>(await c.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND application_name LIKE 'aij-api:%'")).rows[0].n,{acceptanceId:lease.id});assert.equal(proof.applicationPools,0);const folder=join(repositoryRoot,'.artifacts/auto-ai-program-20261105/AF-163');mkdirSync(folder,{recursive:true,mode:0o700});writeFileSync(join(folder,'live-'+lease.id+'.json'),JSON.stringify(proof,null,2)+'\n',{mode:0o600});}
    finally{for(const k of Object.keys(process.env))delete process.env[k];Object.assign(process.env,previous);}
  }
});
