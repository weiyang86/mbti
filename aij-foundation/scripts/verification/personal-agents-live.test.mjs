// ROOT ONLY / WORKER NOT_RUN. Requires AF-159 registrations, schema/migration,
// SDK exports + module wiring, generated client and fresh built API/packages.
// Uses a NEW acceptance lease; never adopts AF-154 or a prior AF-159 database.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import test from 'node:test';
import {createAcceptance,migrate} from '../database/migration.mjs';
import {seedDatabase} from '../database/seed.mjs';
import {clientEnvironment} from './client-auth-fixture.mjs';
import {syntheticAiCatalog} from './ai-center-fixture.mjs';
import {repositoryRoot,checkDatabase,withDatabase,readDatabaseEnvironment} from '../database/connection.mjs';
const require=createRequire(join(repositoryRoot,'apps/api/package.json'));
const task='AF-159';
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const pause=ms=>new Promise(r=>setTimeout(r,ms));

test('AF-159 fresh Cookie/API/PostgreSQL private Agents + exact Skill pins',{timeout:420000},async t=>{
  assert.equal(process.env.AIJ_AF159_ROOT_LIVE,'1');
  assert.equal(resolve(process.cwd()),'/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation');
  const git=flag=>resolve(repositoryRoot,execFileSync('git',['rev-parse',flag],{encoding:'utf8'}).trim());assert.equal(git('--git-dir'),git('--git-common-dir'));
  assert.equal(execFileSync('git',['branch','--show-current'],{encoding:'utf8'}).trim(),'dev');
  await checkDatabase('test');const lease=await createAcceptance('test',task);
  assert.equal((await migrate({mode:'test',action:'deploy',acceptanceId:lease.id})).exitCode,0);
  assert.equal((await migrate({mode:'test',action:'status',acceptanceId:lease.id})).exitCode,0);
  await seedDatabase({mode:'test',acceptanceId:lease.id,generateCredentials:true,runtimeManagement:true,pluginManagement:true,configuration:true,secrets:true,aiCenter:true});
  const previous={...process.env},proof={task,acceptanceId:lease.id,database:lease.database,status:'RUNNING'};let app;
  try{
    const env=clientEnvironment(lease.id,task);for(const k of Object.keys(process.env))delete process.env[k];Object.assign(process.env,env,{ASYNC_RUNTIME_ENABLED:'false',ENABLED_PLUGINS:'aij-ai',AI_CENTER_LIVE_ENABLED:'false'});
    const {createApplication}=require('../../apps/api/dist/bootstrap.js'),{PrismaService}=require('../../apps/api/dist/prisma/prisma.service.js');
    app=await createApplication();await app.listen(0,'127.0.0.1');const prisma=app.get(PrismaService);
    const base=`http://127.0.0.1:${app.getHttpServer().address().port}/api`,route='/client/ai/personal-agents';
    const db=op=>withDatabase('test',readDatabaseEnvironment('test',process.env,lease.id),op,{acceptanceId:lease.id});
    const {PluginCatalog}=require('../../apps/api/dist/plugin-runtime/plugin-catalog.js'),{PluginLifecycleService}=require('../../apps/api/dist/plugin-runtime/plugin-lifecycle.service.js');
    const admin=await prisma.sysUser.findUniqueOrThrow({where:{username:'aij-admin'}}),lifecycle=app.get(PluginLifecycleService),pluginCatalog=app.get(PluginCatalog);
    await lifecycle.install('aij-ai',pluginCatalog.manifest('aij-ai').version,admin.id,'af159-install');await lifecycle.enable('aij-ai',admin.id,'af159-enable');
    const {AiCenterConfigurationService}=require('../../apps/api/dist/plugins/aij-ai/ai-center-configuration.service.js'),config=app.get(AiCenterConfigurationService);
    const secretKey='AIJ_SECRET_AIJ_FOUNDATION_TEST_AF159';process.env[secretKey]='synthetic-'+randomBytes(24).toString('hex');const ref='env://'+secretKey;
    await prisma.secretReference.create({data:{ref,provider:'env'}});
    let catalog=syntheticAiCatalog(ref),catalogVersion=(await config.save({catalog,expectedVersion:0},admin.id,'af159-catalog')).version;
    const saveCatalog=async next=>{const saved=await config.save({catalog:next,expectedVersion:catalogVersion},admin.id,'af159-catalog');catalog=saved.catalog;catalogVersion=saved.version;};
    const {AiCenterHttpTransport}=require('../../apps/api/dist/plugins/aij-ai/ai-center-provider.js');let upstream=0;app.get(AiCenterHttpTransport).request=async()=>{upstream++;throw new Error('Unexpected AI upstream');};
    const tableHashes=()=>db(async client=>{
      const tables=(await client.query("SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname='public' ORDER BY tablename")).rows,out={};
      for(const {tablename}of tables){assert.match(tablename,/^[A-Za-z_][A-Za-z0-9_]*$/);const projection=tablename==='client_auth_session'?"(to_jsonb(t)-'last_seen_at'-'updated_at')::text":'row_to_json(t)::text';const rows=(await client.query('SELECT '+projection+' AS row FROM public."'+tablename+'" t')).rows.map(r=>r.row).sort();out[tablename]=createHash('sha256').update(JSON.stringify(rows)).digest('hex');}return out;
    });
    const denied=async op=>{const before=await tableHashes();await op();assert.deepEqual(await tableHashes(),before,'denial must change zero durable domain/audit rows');};
    const executionBefore=await tableHashes();
    const cookies=[],accounts=[],spaces=[];
    for(let i=0;i<3;i++){
      const password='Af159-'+randomBytes(24).toString('hex'),account=await prisma.memberUser.create({data:{email:`af159-${randomUUID()}@example.test`,nickname:'AF159 synthetic',passwordHash:await require('bcryptjs').hash(password,12),emailVerifiedAt:new Date()}});accounts.push(account);
      const r=await fetch(base+'/client/auth/login',{method:'POST',headers:{origin:env.WEB_URL,'content-type':'application/json'},body:JSON.stringify({email:account.email,password}),signal:AbortSignal.timeout(15000)});assert.equal(r.status,200);const cookie=r.headers.get('set-cookie');assert.match(cookie,/HttpOnly/);cookies.push(cookie.split(';')[0]);await r.arrayBuffer();
    }
    const request=async(method,path='',{actor=0,workspace=spaces[0]?.id,body,status=200,origin=env.WEB_URL,headers={},prefix=route}={})=>{
      const r=await fetch(base+prefix+path,{method,headers:{connection:'close',...(actor===null?{}:{cookie:cookies[actor]}),...(workspace?{'x-aij-workspace-id':workspace}:{}),...(origin?{origin}:{}),...(body===undefined?{}:{'content-type':'application/json'}),...headers},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
      const raw=await r.text();if(Array.isArray(status))assert.ok(status.includes(r.status),`unexpected HTTP ${r.status}`);else assert.equal(r.status,status,`${method} ${prefix}${path} HTTP ${r.status}`);
      if(prefix===route){assert.match(r.headers.get('cache-control')||'',/no-store/);assert.match(r.headers.get('x-correlation-id')||'',/^[A-Za-z0-9._:-]{8,128}$/);}
      const data=raw?JSON.parse(raw).data:null;return Array.isArray(status)?{status:r.status,data}:data;
    };
    for(let i=0;i<2;i++)spaces.push(await request('POST','',{prefix:'/client/workspaces',actor:i,body:{name:'AF159 space '+i,idempotencyKey:'af159-'+randomUUID()},status:201}));
    const ownerRoles=[];for(const [i,w]of spaces.entries()){const role=await prisma.clientWorkspaceRole.findUniqueOrThrow({where:{workspaceId_code:{workspaceId:w.id,code:'OWNER'}}});ownerRoles.push(role);await prisma.clientWorkspaceMembership.create({data:{workspaceId:w.id,memberId:accounts[1-i].id,roleId:role.id}});}
    const memberRole=await prisma.clientWorkspaceRole.findUniqueOrThrow({where:{workspaceId_code:{workspaceId:spaces[0].id,code:'MEMBER'}}});await prisma.clientWorkspaceMembership.create({data:{workspaceId:spaces[0].id,memberId:accounts[2].id,roleId:memberRole.id}});
    const skillInput={code:'private-prompt',name:'AF159 own Skill',instructions:'Private Skill prompt sentinel'},skill=await request('POST','',{prefix:'/client/ai/skills',body:skillInput,status:201});
    const foreign=await request('POST','',{prefix:'/client/ai/skills',actor:1,body:skillInput,status:201});
    const otherSpace=await request('POST','',{prefix:'/client/ai/skills',workspace:spaces[1].id,body:skillInput,status:201});
    const skillVersion=(await request('GET','/'+skill.id+'/versions',{prefix:'/client/ai/skills'})).items[0];
    const options=await request('GET','/model-options');assert.deepEqual(options,{catalogVersion,items:[{code:'advice-text',name:'Synthetic advice model',revision:1,capability:'text'}]});
    assert.equal(JSON.stringify(options).includes(ref),false);assert.equal(JSON.stringify(options).includes('https:'),false);
    const initial={code:'private-agent',name:'Private AF159 Agent sentinel',instructions:'Private Agent prompt sentinel',modelCode:options.items[0].code,modelRevision:options.items[0].revision,catalogVersion,inputFields:['question'],outputFormat:'json',outputFields:['answer'],skillBindings:[{skillId:skill.id,revision:1}]};
    const edit=extra=>{const input={...initial,...extra};delete input.code;return input;};let agent;
    await t.test('strict body/query/origin/session/member allowlist denials have no-store and correlation',async()=>{
      for(const key of ['memberId','workspaceId','ownerId','projectId','credentialRef','baseUrl','tools','script','published'])await denied(()=>request('POST','',{body:{...initial,[key]:'forged'},status:400}));
      for(const path of ['?limit=51','/model-options?keys=true'])await denied(()=>request('GET',path,{status:400}));
      for(const origin of [null,'https://foreign.invalid'])await denied(()=>request('POST','',{body:initial,origin,status:403}));
      await denied(()=>request('POST','',{body:initial,headers:{'sec-fetch-site':'cross-site'},status:403}));
      await denied(()=>request('GET','',{actor:null,status:401}));await denied(()=>request('GET','',{actor:2,status:403}));await denied(()=>request('POST','',{actor:2,body:initial,status:403}));
      for(const binding of [{skillId:foreign.id,revision:1},{skillId:otherSpace.id,revision:1},{skillId:skill.id,revision:99}])await denied(()=>request('POST','',{body:{...initial,skillBindings:[binding]},status:404}));
      await denied(()=>request('POST','',{body:{...initial,skillBindings:[{skillId:skill.id,revision:1,skillVersionId:skillVersion.id}]},status:400}));
      await denied(()=>request('POST','',{body:{...initial,modelCode:'avatar-image'},status:409}));
    });
    await t.test('real concurrent create, exact replay, content conflict, no-op and CAS',async()=>{
      const made=await Promise.all([request('POST','',{body:initial,status:201}),request('POST','',{body:initial,status:201})]);agent=made[0];assert.equal(made[1].id,agent.id);assert.equal(agent.enabled,false);assert.equal(agent.skillBindings[0].skillVersionId,skillVersion.id);
      assert.equal((await request('POST','',{body:initial,status:201})).id,agent.id);await denied(()=>request('POST','',{body:{...initial,instructions:'different'},status:409}));
      await request('PATCH','/'+agent.id,{body:edit({expectedRevision:1})});assert.equal(await prisma.aiPersonalAgentVersion.count({where:{agentId:agent.id}}),1);
      const results=await Promise.all(['a','b'].map(name=>request('PATCH','/'+agent.id,{body:edit({name,expectedRevision:1}),status:[200,409]})));assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
      await denied(()=>request('PATCH','/'+agent.id,{body:edit({expectedRevision:1}),status:409}));assert.equal((await request('GET','/'+agent.id)).revision,2);
      const page=await request('GET','/'+agent.id+'/versions?limit=1');assert.equal(page.nextCursor,2);assert.equal((await request('GET','/'+agent.id+'/versions?beforeRevision=2')).items[0].revision,1);
      assert.deepEqual((await config.read(admin.id)).catalog,catalog,'private assets must not edit the product catalog');
      const audits=await prisma.auditLog.findMany({where:{resourceType:'ai_personal_agent',resourceId:agent.id}});assert.equal(audits.length,2);assert.equal(JSON.stringify(audits).includes(initial.instructions),false);assert.equal(JSON.stringify(audits).includes(initial.name),false);assert.ok(audits.every(a=>a.userId===accounts[0].id&&a.requestSummary.correlationId));
    });
    await t.test('saved pins survive Skill changes; foreign owner/space and inactive Skill cannot be saved',async()=>{
      await request('PATCH','/'+skill.id,{prefix:'/client/ai/skills',body:{name:skillInput.name,instructions:'Skill revision two sentinel',expectedRevision:1}});
      const pinned=(await request('GET','/'+agent.id+'/versions')).items[0].skillBindings[0];assert.deepEqual(pinned,{skillId:skill.id,skillVersionId:skillVersion.id,revision:1});assert.deepEqual(Object.keys(pinned).sort(),['revision','skillId','skillVersionId']);
      for(const opts of [{actor:1},{workspace:spaces[1].id}])for(const id of [agent.id,randomUUID()])for(const [method,path,body]of [['GET','/'+id],['GET','/'+id+'/versions'],['PATCH','/'+id,edit({expectedRevision:2})],['DELETE','/'+id,{expectedRevision:2}]])await denied(()=>request(method,path,{...opts,body,status:404}));
      await request('DELETE','/'+skill.id,{prefix:'/client/ai/skills',body:{expectedRevision:2}});
      await denied(()=>request('PATCH','/'+agent.id,{body:edit({expectedRevision:2}),status:404}));assert.equal((await request('GET','/'+agent.id)).skillBindings[0].skillVersionId,skillVersion.id);
    });
    // Use a still-active Skill for the remaining save tests. Historical pins above stay unchanged.
    const activeSkill=await request('POST','',{prefix:'/client/ai/skills',body:{...skillInput,code:'active-prompt'},status:201});
    const active=()=>({...initial,catalogVersion,modelRevision:catalog.models.find(m=>m.code===initial.modelCode).revision,skillBindings:[{skillId:activeSkill.id,revision:1}]});
    await t.test('first-party Aliyun and DeepSeek model options are actually saveable without execution',async()=>{
      const original=structuredClone(catalog);
      try{
        for(const vendor of ['aliyun','deepseek']){
          const baseUrl=vendor==='aliyun'?'https://dashscope.aliyuncs.com/compatible-mode/v1':'https://api.deepseek.com/v1';
          await saveCatalog({...original,providers:original.providers.map(p=>p.code==='text-provider'?{...p,vendor,baseUrl}:p),models:original.models.map(m=>m.code===initial.modelCode?{...m,upstreamModel:vendor==='aliyun'?'qwen3.8-max':'deepseek-chat',tokenParameter:vendor==='aliyun'?'max_completion_tokens':'max_tokens'}:m)});
          const choices=await request('GET','/model-options');assert.equal(choices.items[0].code,initial.modelCode);assert.equal(choices.catalogVersion,catalogVersion);
          const saved=await request('POST','',{body:{...active(),code:'vendor-'+vendor},status:201});assert.equal(saved.modelCode,choices.items[0].code);assert.equal(saved.catalogVersion,choices.catalogVersion);assert.equal(upstream,0);
        }
      }finally{await saveCatalog(original);}
    });
    await t.test('disabled model/provider, stale catalog revision, role/plugin lifecycle deny saving',async()=>{
      const stale=active();await saveCatalog({...catalog,agents:[],models:catalog.models.map(m=>m.code===initial.modelCode?{...m,enabled:false}:m)});assert.equal((await request('GET','/model-options')).items.length,0);
      await denied(()=>request('POST','',{body:{...active(),code:'disabled-model'},status:409}));
      await saveCatalog({...catalog,models:catalog.models.map(m=>({...m,enabled:true}))});await denied(()=>request('POST','',{body:{...stale,code:'stale-model'},status:409}));
      await saveCatalog({...catalog,agents:[],providers:catalog.providers.map(p=>({...p,enabled:false}))});await denied(()=>request('POST','',{body:{...active(),code:'disabled-provider'},status:409}));await saveCatalog({...catalog,providers:catalog.providers.map(p=>({...p,enabled:true}))});
      const role=ownerRoles[0];await prisma.clientWorkspaceRole.update({where:{id:role.id},data:{status:'disabled'}});try{await denied(()=>request('POST','',{body:{...active(),code:'disabled-role'},status:403}));}finally{await prisma.clientWorkspaceRole.update({where:{id:role.id},data:{status:'active'}});}
      await lifecycle.disable('aij-ai',admin.id,'af159-disable');try{await denied(()=>request('GET','/model-options',{status:404}));}finally{await lifecycle.enable('aij-ai',admin.id,'af159-enable-again');}
    });
    await t.test('DB composite scopes, immutable history/bindings and full slot retention',async()=>{
      const {Prisma}=require('@prisma/client');assert.equal(Prisma.dmmf.datamodel.models.filter(m=>['AiPersonalAgent','AiPersonalAgentVersion','AiPersonalAgentSkillBinding'].includes(m.name)).length,3);
      const version=await prisma.aiPersonalAgentVersion.findFirstOrThrow({where:{agentId:agent.id,revision:1}}),binding=await prisma.aiPersonalAgentSkillBinding.findFirstOrThrow({where:{agentVersionId:version.id}});
      for(const sql of ['UPDATE public.ai_personal_agent_version SET name=name','DELETE FROM public.ai_personal_agent_version','TRUNCATE public.ai_personal_agent_version CASCADE','UPDATE public.ai_personal_agent_skill_binding SET position=position','DELETE FROM public.ai_personal_agent_skill_binding','TRUNCATE public.ai_personal_agent_skill_binding','UPDATE public.ai_personal_agent SET member_id=member_id||\'x\''])await assert.rejects(db(c=>c.query(sql)));
      await assert.rejects(prisma.aiPersonalAgentSkillBinding.create({data:{id:randomUUID(),agentVersionId:version.id,workspaceId:spaces[0].id,memberId:accounts[0].id,skillVersionId:skillVersion.id,position:1}}));
      const foreignVersion=await prisma.aiPersonalSkillVersion.findFirstOrThrow({where:{skillId:foreign.id}});
      await assert.rejects(prisma.$transaction(async tx=>{const v=await tx.aiPersonalAgentVersion.create({data:{agentId:agent.id,workspaceId:spaces[0].id,memberId:accounts[0].id,code:initial.code,name:'Scope probe',instructions:'Scope probe',enabled:false,modelCode:initial.modelCode,modelRevision:1,catalogVersion:1,inputFields:['x'],outputFormat:'text',outputFields:[],revision:99,skillBindingCount:1}});await tx.aiPersonalAgentSkillBinding.create({data:{agentVersionId:v.id,workspaceId:spaces[0].id,memberId:accounts[0].id,skillVersionId:foreignVersion.id,position:0}});}));
      await assert.rejects(prisma.aiPersonalAgentVersion.create({data:{agentId:agent.id,workspaceId:spaces[0].id,memberId:accounts[0].id,code:initial.code,name:'Incomplete probe',instructions:'Incomplete',enabled:false,modelCode:initial.modelCode,modelRevision:1,catalogVersion:1,inputFields:['x'],outputFormat:'text',outputFields:[],revision:99,skillBindingCount:1}}));
      assert.equal((await prisma.aiPersonalAgentSkillBinding.findUniqueOrThrow({where:{id:binding.id}})).skillVersionId,skillVersion.id);
      for(const model of Prisma.dmmf.datamodel.models.filter(m=>['AiPersonalAgent','AiPersonalAgentVersion','AiPersonalAgentSkillBinding'].includes(m.name))){
        const columns=await prisma.$queryRaw`SELECT column_name,data_type,is_nullable,character_maximum_length,datetime_precision FROM information_schema.columns WHERE table_schema='public' AND table_name=${model.dbName}`;
        const fields=model.fields.filter(f=>f.kind==='scalar');assert.deepEqual(columns.map(c=>c.column_name).sort(),fields.map(f=>f.dbName??f.name).sort());
        for(const field of fields){const c=columns.find(c=>c.column_name===(field.dbName??field.name));assert.equal(c.is_nullable,field.isRequired?'NO':'YES');
          const expected=field.type==='Int'?(['position','skillBindingCount'].includes(field.name)?'smallint':'integer'):field.type==='DateTime'?'timestamp without time zone':field.type==='Boolean'?'boolean':field.type==='Json'?'jsonb':['code','name','modelCode','outputFormat'].includes(field.name)?'character varying':'text';assert.equal(c.data_type,expected);
          if(field.type==='DateTime')assert.equal(c.datetime_precision,3);
        }
      }
      const fks=await prisma.$queryRaw`SELECT confupdtype::text AS u,confdeltype::text AS d FROM pg_constraint WHERE conrelid IN ('public.ai_personal_agent'::regclass,'public.ai_personal_agent_version'::regclass,'public.ai_personal_agent_skill_binding'::regclass) AND contype='f'`;assert.equal(fks.length,7);assert.ok(fks.every(f=>f.u==='r'&&f.d==='r'));
    });
    await t.test('SQL audit fault rolls back current row + snapshot + bindings and tombstone',async()=>{
      await db(async c=>{await c.query("CREATE FUNCTION public.af159_audit_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.resource_type='ai_personal_agent' THEN RAISE EXCEPTION 'synthetic audit fault'; END IF; RETURN NEW; END $$");await c.query('CREATE TRIGGER af159_audit_fault BEFORE INSERT ON public.audit_log FOR EACH ROW EXECUTE FUNCTION public.af159_audit_fault()');});
      try{await denied(()=>request('POST','',{body:{...active(),code:'audit-fault'},status:503}));await denied(()=>request('PATCH','/'+agent.id,{body:{...edit(active()),expectedRevision:2},status:503}));await denied(()=>request('DELETE','/'+agent.id,{body:{expectedRevision:2},status:503}));}finally{await db(async c=>{await c.query('DROP TRIGGER af159_audit_fault ON public.audit_log');await c.query('DROP FUNCTION public.af159_audit_fault()');});}
    });
    await t.test('real shared membership fence blocks revocation until save commits',async()=>{
      const {AiPersonalAgentsService}=require('../../apps/api/dist/plugins/aij-ai/ai-personal-agents.service.js'),service=app.get(AiPersonalAgentsService),original=service.audit.bind(service),entered=deferred(),release=deferred(),revoker=deferred();let pending,revocation;
      service.audit=async(...args)=>{entered.resolve();await release.promise;return original(...args);};
      try{pending=request('POST','',{body:{...active(),code:'permission-fence'},status:201});await Promise.race([entered.promise,pending.then(()=>{throw new Error('save missed fence barrier');})]);
        revocation=db(async c=>{await c.query('BEGIN');revoker.resolve((await c.query('SELECT pg_backend_pid() AS id')).rows[0].id);try{await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['aij-client-workspace-membership:'+spaces[0].id]);await c.query("UPDATE public.client_workspace_role SET status='disabled' WHERE id=$1",[ownerRoles[0].id]);await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}});
        const pid=await revoker.promise;let blocked=false;for(let i=0;i<20;i++){blocked=await db(async c=>(await c.query('SELECT cardinality(pg_blocking_pids($1))>0 AS b',[pid])).rows[0].b);if(blocked)break;await pause(25);}assert.equal(blocked,true);release.resolve();await pending;await revocation;await denied(()=>request('POST','',{body:{...active(),code:'after-revoke'},status:403}));proof.pgFenceObserved=true;
      }finally{release.resolve();service.audit=original;await pending?.catch(()=>{});await revocation?.catch(()=>{});await prisma.clientWorkspaceRole.update({where:{id:ownerRoles[0].id},data:{status:'active'}});}
    });
    await t.test('compiled ESM/CJS SDK actual transport and 409 type',async()=>{
      for(const sdk of [require('../../packages/sdk/dist/index.cjs'),await import(new URL('../../packages/sdk/dist/index.mjs',import.meta.url))]){
        const api=sdk.createClientApi(()=>base),client=sdk.createPersonalAgentsClient((p,o={})=>api(p,{...o,headers:{cookie:cookies[0],origin:env.WEB_URL}}));
        assert.equal((await client.modelOptions(spaces[0].id)).catalogVersion,catalogVersion);assert.equal((await client.get(spaces[0].id,agent.id)).revision,2);assert.ok((await client.list(spaces[0].id,{limit:1})).items.length>0);assert.equal((await client.versions(spaces[0].id,agent.id,{limit:1})).items[0].revision,2);
        await assert.rejects(client.update(spaces[0].id,agent.id,{...edit(active()),expectedRevision:1}),e=>e instanceof sdk.ClientRequestFailure&&e.status===409);
      }
    });
    await t.test('stable tombstone retains immutable pins, hides history and rejects revival',async()=>{
      const count=await prisma.aiPersonalAgentVersion.count({where:{agentId:agent.id}}),gone=await request('DELETE','/'+agent.id,{body:{expectedRevision:2}});assert.equal(gone.deleted,true);assert.deepEqual(await request('DELETE','/'+agent.id,{body:{expectedRevision:1}}),gone);
      await denied(()=>request('GET','/'+agent.id,{status:404}));await denied(()=>request('GET','/'+agent.id+'/versions',{status:404}));await denied(()=>request('POST','',{body:{...active(),code:initial.code},status:409}));assert.equal(await prisma.aiPersonalAgentVersion.count({where:{agentId:agent.id}}),count);
      await assert.rejects(prisma.aiPersonalAgent.update({where:{id:agent.id},data:{deletedAt:null}}));
    });
    await t.test('real quota under concurrent 100th creation',async()=>{
      const count=await prisma.aiPersonalAgent.count({where:{workspaceId:spaces[0].id,memberId:accounts[0].id,deletedAt:null}});for(let i=count;i<99;i++)await request('POST','',{body:{...active(),code:'quota-'+i},status:201});
      const results=await Promise.all(['quota-last-a','quota-last-b'].map(code=>request('POST','',{body:{...active(),code},status:[201,409]})));assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);assert.equal(await prisma.aiPersonalAgent.count({where:{workspaceId:spaces[0].id,memberId:accounts[0].id,deletedAt:null}}),100);
    });
    const final=await tableHashes();for(const table of Object.keys(executionBefore).filter(name=>/^(runtime_job|runtime_outbox|ai_agent_run|ai_execution_trace|ai_.*budget.*|ai_.*usage.*|ai_evaluation_record)$/.test(name)))assert.equal(final[table],executionBefore[table],table+' must remain unchanged');assert.equal(upstream,0);
    proof.upstreamCalls=upstream;proof.executionLedgersUnchanged=true;proof.currentRows=await prisma.aiPersonalAgent.count();proof.versionRows=await prisma.aiPersonalAgentVersion.count();proof.bindingRows=await prisma.aiPersonalAgentSkillBinding.count();proof.status='EVIDENCE_RECORDED_FORMAL_REPORT_IS_AUTHORITY';
  }finally{
    try{await app?.close();proof.applicationPools=await withDatabase('test',readDatabaseEnvironment('test',process.env,lease.id),async c=>(await c.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND application_name LIKE 'aij-api:%'")).rows[0].n,{acceptanceId:lease.id});assert.equal(proof.applicationPools,0);const folder=join(repositoryRoot,'.artifacts/auto-ai-program-20261105/AF-159');mkdirSync(folder,{recursive:true,mode:0o700});writeFileSync(join(folder,'live-'+lease.id+'.json'),JSON.stringify(proof,null,2)+'\n',{mode:0o600});}
    finally{for(const k of Object.keys(process.env))delete process.env[k];Object.assign(process.env,previous);}
  }
});
