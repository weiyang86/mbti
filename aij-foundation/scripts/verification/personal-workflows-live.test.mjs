// ROOT ONLY / WORKER NOT_RUN. Requires AF-170 registrations, schema/migration,
// SDK exports + module wiring, generated client and fresh built API/packages.
// Uses a NEW acceptance lease; never adopts AF-154 or a prior AF-170 database.
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
const task='AF-170';
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const pause=ms=>new Promise(r=>setTimeout(r,ms));

test('AF-170 fresh Cookie/API/PostgreSQL private workflow drafts + exact Agent pins',{timeout:420000},async t=>{
  assert.equal(process.env.AIJ_AF170_ROOT_LIVE,'1');
  assert.equal(resolve(process.cwd()),'/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation');
  const git=flag=>resolve(repositoryRoot,execFileSync('git',['rev-parse',flag],{encoding:'utf8'}).trim());assert.equal(git('--git-dir'),git('--git-common-dir'));
  assert.equal(execFileSync('git',['branch','--show-current'],{encoding:'utf8'}).trim(),'dev');
  await checkDatabase('test');const lease=await createAcceptance('test',task);
  assert.equal((await migrate({mode:'test',action:'deploy',acceptanceId:lease.id})).exitCode,0);
  assert.equal((await migrate({mode:'test',action:'status',acceptanceId:lease.id})).exitCode,0);
  await seedDatabase({mode:'test',acceptanceId:lease.id,generateCredentials:true,runtimeManagement:true,pluginManagement:true,configuration:true,secrets:true,aiCenter:true});
  const previous={...process.env},proof={task,acceptanceId:lease.id,database:lease.database,status:'RUNNING'};let app, secondApp;
  try{
    const env=clientEnvironment(lease.id,task);for(const k of Object.keys(process.env))delete process.env[k];Object.assign(process.env,env,{ASYNC_RUNTIME_ENABLED:'false',ENABLED_PLUGINS:'aij-ai',AI_CENTER_LIVE_ENABLED:'false'});
    const {createApplication}=require('../../apps/api/dist/bootstrap.js'),{PrismaService}=require('../../apps/api/dist/prisma/prisma.service.js');
    app=await createApplication();app.use('/_af170-raw-body',(req,res)=>res.json({checksum:createHash('sha256').update(req.rawBody??Buffer.alloc(0)).digest('hex')}));await app.listen(0,'127.0.0.1');secondApp=await createApplication();await secondApp.listen(0,'127.0.0.1');const prisma=app.get(PrismaService);
    const base=`http://127.0.0.1:${app.getHttpServer().address().port}/api`,secondBase=`http://127.0.0.1:${secondApp.getHttpServer().address().port}/api`,route='/client/ai/personal-workflows';
    const db=op=>withDatabase('test',readDatabaseEnvironment('test',process.env,lease.id),op,{acceptanceId:lease.id});
    const {PluginCatalog}=require('../../apps/api/dist/plugin-runtime/plugin-catalog.js'),{PluginLifecycleService}=require('../../apps/api/dist/plugin-runtime/plugin-lifecycle.service.js');
    const admin=await prisma.sysUser.findUniqueOrThrow({where:{username:'aij-admin'}}),lifecycle=app.get(PluginLifecycleService),pluginCatalog=app.get(PluginCatalog);
    await lifecycle.install('aij-ai',pluginCatalog.manifest('aij-ai').version,admin.id,'af170-install');await lifecycle.enable('aij-ai',admin.id,'af170-enable');
    const {AiCenterConfigurationService}=require('../../apps/api/dist/plugins/aij-ai/ai-center-configuration.service.js'),config=app.get(AiCenterConfigurationService);
    const secretKey='AIJ_SECRET_AIJ_FOUNDATION_TEST_AF170';process.env[secretKey]='synthetic-'+randomBytes(24).toString('hex');const ref='env://'+secretKey;
    await prisma.secretReference.create({data:{ref,provider:'env'}});
    await config.save({catalog:syntheticAiCatalog(ref),expectedVersion:0},admin.id,'af170-catalog');
    const {AiCenterHttpTransport}=require('../../apps/api/dist/plugins/aij-ai/ai-center-provider.js');let upstream=0;app.get(AiCenterHttpTransport).request=async()=>{upstream++;throw new Error('Unexpected AI upstream');};
    const tableHashes=()=>db(async client=>{
      const tables=(await client.query("SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname='public' ORDER BY tablename")).rows,out={};
      for(const {tablename}of tables){assert.match(tablename,/^[A-Za-z_][A-Za-z0-9_]*$/);const projection=tablename==='client_auth_session'?"(to_jsonb(t)-'last_seen_at'-'updated_at')::text":'row_to_json(t)::text';const rows=(await client.query('SELECT '+projection+' AS row FROM public."'+tablename+'" t')).rows.map(r=>r.row).sort();out[tablename]=createHash('sha256').update(JSON.stringify(rows)).digest('hex');}return out;
    });
    const denied=async op=>{const before=await tableHashes();await op();assert.deepEqual(await tableHashes(),before,'denial must change zero durable domain/audit rows');};
    const executionBefore=await tableHashes();
    const cookies=[],accounts=[],spaces=[];
    for(let i=0;i<3;i++){
      const password='Af159-'+randomBytes(24).toString('hex'),account=await prisma.memberUser.create({data:{email:`af170-${randomUUID()}@example.test`,nickname:'AF170 synthetic',passwordHash:await require('bcryptjs').hash(password,12),emailVerifiedAt:new Date()}});accounts.push(account);
      const r=await fetch(base+'/client/auth/login',{method:'POST',headers:{origin:env.WEB_URL,'content-type':'application/json'},body:JSON.stringify({email:account.email,password}),signal:AbortSignal.timeout(15000)});assert.equal(r.status,200);const cookie=r.headers.get('set-cookie');assert.match(cookie,/HttpOnly/);cookies.push(cookie.split(';')[0]);await r.arrayBuffer();
    }
    const request=async(method,path='',{host=base,rawBody,actor=0,workspace=spaces[0]?.id,body,status=200,origin=env.WEB_URL,headers={},prefix=route}={})=>{
      const r=await fetch(host+prefix+path,{method,headers:{connection:'close',...(actor===null?{}:{cookie:cookies[actor]}),...(workspace?{'x-aij-workspace-id':workspace}:{}),...(origin?{origin}:{}),...(body===undefined&&rawBody===undefined?{}:{'content-type':'application/json'}),...headers},body:rawBody??(body===undefined?undefined:JSON.stringify(body)),signal:AbortSignal.timeout(15000)});
      const raw=await r.text();if(Array.isArray(status))assert.ok(status.includes(r.status),`unexpected HTTP ${r.status}`);else assert.equal(r.status,status,`${method} ${prefix}${path} HTTP ${r.status}`);
      if(prefix===route){assert.equal(r.headers.get('cache-control'),'private, no-store');assert.match(r.headers.get('x-correlation-id')||'',/^[A-Za-z0-9._:-]{8,128}$/);}
      const data=raw?JSON.parse(raw).data:null;return Array.isArray(status)?{status:r.status,data}:data;
    };
    for(let i=0;i<2;i++)spaces.push(await request('POST','',{prefix:'/client/workspaces',actor:i,body:{name:'AF170 space '+i,idempotencyKey:'af170-'+randomUUID()},status:201}));
    const ownerRoles=[];for(const [i,w]of spaces.entries()){const role=await prisma.clientWorkspaceRole.findUniqueOrThrow({where:{workspaceId_code:{workspaceId:w.id,code:'OWNER'}}});ownerRoles.push(role);await prisma.clientWorkspaceMembership.create({data:{workspaceId:w.id,memberId:accounts[1-i].id,roleId:role.id}});}
    const memberRole=await prisma.clientWorkspaceRole.findUniqueOrThrow({where:{workspaceId_code:{workspaceId:spaces[0].id,code:'MEMBER'}}});await prisma.clientWorkspaceMembership.create({data:{workspaceId:spaces[0].id,memberId:accounts[2].id,roleId:memberRole.id}});
    const edge=(from,to,port='next',input='in')=>({from,port,to,input});
    const ownSkill=await request('POST','',{prefix:'/client/ai/skills',body:{code:'workflow-skill',name:'Skill',instructions:'private Skill instruction sentinel'},status:201});
    const makeAgent=async(actor=0,workspace=spaces[0].id,code='workflow-agent')=>{
      const options=await request('GET','/model-options',{prefix:'/client/ai/personal-agents',actor,workspace});
      return request('POST','',{prefix:'/client/ai/personal-agents',actor,workspace,body:{code,name:'Agent',instructions:'private Agent instruction sentinel',enabled:false,modelCode:options.items[0].code,modelRevision:options.items[0].revision,catalogVersion:options.catalogVersion,inputFields:['question'],outputFormat:'text',outputFields:[],skillBindings:actor===0&&workspace===spaces[0].id?[{skillId:ownSkill.id,revision:1}]:[]},status:201});
    };
    const own=await makeAgent(),foreign=await makeAgent(1),otherSpace=await makeAgent(0,spaces[1].id);
    const pinned=(await prisma.aiPersonalAgentVersion.findMany({where:{agentId:own.id,revision:1}}))[0];
    const graph=()=>({schemaVersion:1,inputKeys:['question'],nodes:[{id:'start',type:'start'},
      {id:'condition',type:'condition',predicate:{key:'question',op:'exists'},joinId:'cj'},
      {id:'parallel',type:'parallel',branches:['a','b'],joinId:'pj'},{id:'agent',type:'agent',agentId:own.id,revision:1},
      {id:'loop',type:'loop',maxIterations:20,body:{nodes:[{id:'bs',type:'start'},{id:'approval',type:'human-approval',label:'Private label sentinel'},{id:'be',type:'end'}],edges:[edge('bs','approval'),edge('approval','be')]}},
      {id:'pj',type:'join',forkId:'parallel'},{id:'cj',type:'join',forkId:'condition'},{id:'end',type:'end'}],
      edges:[edge('start','condition'),edge('condition','parallel','true'),edge('condition','cj','false','false'),edge('parallel','agent','a'),edge('parallel','loop','b'),edge('agent','pj','next','a'),edge('loop','pj','next','b'),edge('pj','cj','next','true'),edge('cj','end')]});
    const initial={code:'private-workflow',name:'Private workflow name sentinel',graph:graph()};
    const edit=extra=>({name:initial.name,graph:graph(),expectedRevision:1,...extra});let asset;
    const runtimeTables=Object.keys(executionBefore).filter(k=>/runtime_|ai_.*run|ai_execution|ai_.*trace|budget|usage|memory|notification|payment/.test(k));
    const runtimeBaseline=await tableHashes();
    await t.test('real read-only grant and revoked session fence; other OWNER remains private',async()=>{
      const permission=await prisma.clientWorkspacePermission.findUniqueOrThrow({where:{code:'workspace.ai.assets.read'}});
      const grant=await prisma.clientWorkspaceRolePermission.create({data:{roleId:memberRole.id,permissionId:permission.id}});
      try{assert.deepEqual((await request('GET','',{actor:2})).items,[]);await denied(()=>request('POST','',{actor:2,body:initial,status:403}));}
      finally{await prisma.clientWorkspaceRolePermission.delete({where:{id:grant.id}});}
      const session=await prisma.clientAuthSession.findFirstOrThrow({where:{memberId:accounts[0].id,status:'active'}});
      await prisma.clientAuthSession.update({where:{id:session.id},data:{status:'revoked'}});
      try{await denied(()=>request('GET','',{status:401}));}finally{await prisma.clientAuthSession.update({where:{id:session.id},data:{status:'active'}});}
    });
    await t.test('cross-product signed token and expired private session are refused',async()=>{
      const {CLIENT_JWT_SERVICE}=require('../../apps/api/dist/client-auth/client-auth.security.js');
      const jwt=app.get(CLIENT_JWT_SERVICE),token=cookies[0].slice(cookies[0].indexOf('=')+1),payload=jwt.decode(token);
      const unsigned=Object.fromEntries(Object.entries(payload).filter(([key])=>!['exp','iat','iss','aud'].includes(key)));const other=await jwt.signAsync({...unsigned,projectId:'another-product'}),name=cookies[0].slice(0,cookies[0].indexOf('='));
      await denied(()=>request('GET','',{headers:{cookie:name+'='+other},status:401}));
      const session=await prisma.clientAuthSession.findUniqueOrThrow({where:{id:payload.sessionId}});
      await prisma.clientAuthSession.update({where:{id:session.id},data:{expiresAt:new Date(Date.now()-1000)}});
      try{await denied(()=>request('GET','',{status:401}));}finally{await prisma.clientAuthSession.update({where:{id:session.id},data:{expiresAt:session.expiresAt}});}
    });
    await t.test('actual session/member/owner/space/Origin/strict graph refusals cause zero durable changes',async()=>{
      const raw='{"fixture": "owned raw body / 原始缓冲"}';
      const response=await fetch(base.replace(/\/api$/,'')+'/_af170-raw-body',{method:'POST',headers:{'content-type':'application/json'},body:raw,signal:AbortSignal.timeout(10000)});
      assert.equal(response.status,200);assert.deepEqual(await response.json(),{checksum:createHash('sha256').update(raw).digest('hex')});

      for(const key of ['memberId','workspaceId','enabled','published','script','tools','agentBindings','agentVersionId'])await denied(()=>request('POST','',{body:{...initial,[key]:'forged'},status:400}));
      for(const origin of [null,'https://foreign.invalid'])await denied(()=>request('POST','',{body:initial,origin,status:403}));
      await denied(()=>request('POST','',{body:initial,headers:{'sec-fetch-site':'cross-site'},status:403}));
      await denied(()=>request('GET','',{actor:null,status:401}));await denied(()=>request('GET','',{actor:2,status:403}));
      await denied(()=>request('GET','',{headers:{cookie:'invalid_client_scope=forged'},status:401}));
      for(const path of ['?limit=21','?afterId=../x','?workspaceId=forged','?limit=1&limit=2'])await denied(()=>request('GET',path,{status:400}));
      for(const agent of [foreign,otherSpace,{id:randomUUID()}]){const g=graph();g.nodes.find(n=>n.type==='agent').agentId=agent.id;await denied(()=>request('POST','',{body:{...initial,graph:g},status:404}));}
      for(const mutation of [g=>g.edges.push(g.edges[0]),g=>g.edges[0].to='missing',g=>g.nodes.find(n=>n.type==='loop').maxIterations=21,g=>g.nodes.find(n=>n.type==='agent').agentVersionId=pinned.id,g=>g.nodes.find(n=>n.type==='condition').predicate={key:'question',op:'eval',source:'process.exit()'}]){const g=graph();mutation(g);await denied(()=>request('POST','',{body:{...initial,graph:g},status:400}));}
      await denied(()=>request('POST','',{rawBody:'{"code":"a","code":"b"}',status:400}));
      await denied(()=>request('POST','',{rawBody:'{"x":"'+ 'x'.repeat(100000)+'"}',status:413}));
    });
    await t.test('two real API hosts create/replay/noop/CAS and immutable history',async()=>{
      const made=await Promise.all([request('POST','',{body:initial,status:201}),request('POST','',{host:secondBase,body:initial,status:201})]);asset=made[0];assert.equal(made[1].id,asset.id);assert.equal(asset.status,'DRAFT');assert.equal(asset.structuralValidity,'VALID');
      assert.deepEqual(asset.agentBindings,[{nodeId:'agent',agentId:own.id,revision:1,agentVersionId:pinned.id}]);
      const reordered=graph();reordered.nodes.reverse();reordered.edges.reverse();await request('PATCH','/'+asset.id,{body:edit({graph:reordered})});assert.equal(await prisma.aiPersonalWorkflowVersion.count({where:{workflowId:asset.id}}),1);
      const raced=await Promise.all([request('PATCH','/'+asset.id,{body:edit({name:'A'}),status:[200,409]}),request('PATCH','/'+asset.id,{host:secondBase,body:edit({name:'B'}),status:[200,409]})]);assert.deepEqual(raced.map(r=>r.status).sort(),[200,409]);
      const current=await request('GET','/'+asset.id);assert.equal(current.revision,2);assert.deepEqual(await request('POST','',{body:initial,status:201}),current);
      await denied(()=>request('PATCH','/'+asset.id,{body:edit({name:'stale'}),status:409}));await denied(()=>request('POST','',{body:{...initial,name:'conflict'},status:409}));
      const v=await request('GET','/'+asset.id+'/versions/1');assert.equal(v.name,initial.name);assert.equal(v.agentBindings[0].agentVersionId,pinned.id);
      const versions=await request('GET','/'+asset.id+'/versions?limit=1');assert.equal(versions.nextCursor,2);assert.equal(versions.items[0].graph,undefined);assert.equal((await request('GET','/'+asset.id+'/versions?beforeRevision=2')).items[0].revision,1);
      assert.equal((await request('GET')).items[0].graph,undefined);
      const audits=await prisma.auditLog.findMany({where:{resourceType:'ai_personal_workflow',resourceId:asset.id}});assert.equal(audits.length,2);for(const x of ['Private label sentinel',initial.name,'private Agent instruction sentinel','question'])assert.ok(!JSON.stringify(audits).includes(x));
      for(const opts of [{actor:1},{workspace:spaces[1].id}])for(const [method,path,body]of [['GET','/'+asset.id],['GET','/'+asset.id+'/versions'],['GET','/'+asset.id+'/versions/1'],['PATCH','/'+asset.id,edit({expectedRevision:2})],['DELETE','/'+asset.id,{expectedRevision:2}]])await denied(()=>request(method,path,{...opts,body,status:404}));
    });
    await t.test('actual PostgreSQL rollback on audit failure and immutable/composite/count constraints',async()=>{
      await db(c=>c.query(`CREATE FUNCTION public.af170_audit_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.resource_type='ai_personal_workflow' THEN RAISE EXCEPTION 'synthetic AF170 audit fault'; END IF; RETURN NEW; END $$; CREATE TRIGGER af170_audit_fault BEFORE INSERT ON public.audit_log FOR EACH ROW EXECUTE FUNCTION public.af170_audit_fault()`));
      try{await denied(()=>request('POST','',{body:{...initial,code:'audit-rollback'},status:503}));}finally{await db(c=>c.query('DROP TRIGGER af170_audit_fault ON public.audit_log; DROP FUNCTION public.af170_audit_fault()'));}
      const version=await prisma.aiPersonalWorkflowVersion.findFirstOrThrow({where:{workflowId:asset.id,revision:1}});
      for(const [sql,values]of [
        ['UPDATE public.ai_personal_workflow SET initial_digest=repeat(\'a\',64) WHERE id=$1',[asset.id]],
        ['UPDATE public.ai_personal_workflow SET code=\'changed\' WHERE id=$1',[asset.id]],
        ['UPDATE public.ai_personal_workflow_version SET name=\'forged\' WHERE id=$1',[version.id]],
        ['DELETE FROM public.ai_personal_workflow_agent_binding WHERE workflow_version_id=$1',[version.id]],
        ['UPDATE public.ai_personal_workflow SET revision=revision+1,content_digest=repeat(\'a\',64) WHERE id=$1',[asset.id]],
        ['INSERT INTO public.ai_personal_workflow_agent_binding (id,workflow_version_id,workspace_id,member_id,node_id,agent_version_id) VALUES ($1,$2,$3,$4,\'unknownNode\',$5)',[randomUUID(),version.id,spaces[0].id,accounts[0].id,pinned.id]]
      ])await assert.rejects(db(c=>c.query(sql,values)));
      const before=await tableHashes();
      await assert.rejects(db(async c=>{
        await c.query('BEGIN');try{
          await c.query("UPDATE public.ai_personal_workflow SET name='missing binding',revision=revision+1,content_digest=repeat('a',64),updated_at=CURRENT_TIMESTAMP WHERE id=$1",[asset.id]);
          await c.query(`INSERT INTO public.ai_personal_workflow_version (id,workflow_id,workspace_id,member_id,code,name,graph,graph_digest,content_digest,revision,created_at,agent_binding_count)
            SELECT $2,id,workspace_id,member_id,code,name,graph,graph_digest,content_digest,revision,updated_at,1 FROM public.ai_personal_workflow WHERE id=$1`,[asset.id,randomUUID()]);
          await c.query('COMMIT');
        }catch(e){await c.query('ROLLBACK');throw e;}
      }));assert.deepEqual(await tableHashes(),before,'deferred missing-binding failure rolls current and snapshot back');
      await assert.rejects(db(c=>c.query(`INSERT INTO public.ai_personal_workflow_agent_binding (id,workflow_version_id,workspace_id,member_id,node_id,agent_version_id) VALUES ($1,$2,$3,$4,'agent',$5)`,[randomUUID(),version.id,spaces[1].id,accounts[0].id,pinned.id])));
      assert.equal((await request('GET','/'+asset.id+'/versions/1')).name,initial.name);
    });
    await t.test('real Agent row lock delays save, committed deletion refuses; saved pin stays private and immutable',async()=>{
      const agent=await request('GET','/'+own.id,{prefix:'/client/ai/personal-agents'});
      await request('PATCH','/'+own.id,{prefix:'/client/ai/personal-agents',body:{name:agent.name,instructions:'Agent revision two sentinel',enabled:false,modelCode:agent.modelCode,modelRevision:agent.modelRevision,catalogVersion:agent.catalogVersion,inputFields:agent.inputFields,outputFormat:agent.outputFormat,outputFields:agent.outputFields,skillBindings:agent.skillBindings.map(b=>({skillId:b.skillId,revision:b.revision})),expectedRevision:agent.revision}});
      assert.equal((await request('GET','/'+asset.id+'/versions/1')).agentBindings[0].agentVersionId,pinned.id);
      const blocker=deferred(),release=deferred();let blocked;
      const lock=db(async c=>{await c.query('BEGIN');try{await c.query('SELECT id FROM public.ai_personal_agent WHERE id=$1 FOR UPDATE',[own.id]);blocker.resolve();await release.promise;await c.query('UPDATE public.ai_personal_agent SET deleted_at=CURRENT_TIMESTAMP,published_revision=NULL,publication_version=publication_version+1,updated_at=CURRENT_TIMESTAMP WHERE id=$1',[own.id]);await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}});
      await blocker.promise;let settled=false;const pending=request('POST','',{body:{...initial,code:'locked-agent'},status:404}).finally(()=>{settled=true;});
      try{for(let i=0;i<100;i++){blocked=await db(async c=>(await c.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%ai_personal_agent%'")).rows[0].n);if(blocked)break;await pause(20);}assert.ok(blocked);assert.equal(settled,false);}finally{release.resolve();await lock;}await pending;
      assert.equal((await request('GET','/'+asset.id)).agentBindings[0].agentVersionId,pinned.id);
      await denied(()=>request('PATCH','/'+asset.id,{body:edit({expectedRevision:2}),status:404}));
    });
    await t.test('real permission, organization and project lifecycle locks fence through transaction',async()=>{
      const project=await prisma.projectProfile.findFirstOrThrow({where:{code:env.PROJECT_ID+'-test'}});
      const membership=await prisma.clientWorkspaceMembership.findUniqueOrThrow({where:{workspaceId_memberId:{workspaceId:spaces[0].id,memberId:accounts[0].id}}});
      const manage=await prisma.clientWorkspacePermission.findUniqueOrThrow({where:{code:'workspace.ai.assets.manage'}});
      const installation=await prisma.pluginInstallation.findFirstOrThrow({where:{projectId:project.id,pluginCode:'aij-ai'}});
      const fences=[['plugin_installation',installation.id],['client_workspace_membership',membership.id],['client_workspace_role',ownerRoles[0].id],['client_workspace_permission',manage.id],['project_profile',project.id],['organization_profile',project.organizationId],['member_user',accounts[0].id],['client_workspace',spaces[0].id]];
      proof.fenceStatuses=[];
      for(const [table,id]of fences){
        assert.match(table,/^[a-z_]+$/);const ready=deferred(),release=deferred();
        const locking=db(async c=>{await c.query('BEGIN');try{await c.query(`SELECT id FROM public.${table} WHERE id=$1 FOR UPDATE`,[id]);ready.resolve();await release.promise;await c.query(`UPDATE public.${table} SET status=$2 WHERE id=$1`,[id,table==='plugin_installation'?'installed':'disabled']);await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}});
        await ready.promise;
        // A row that changes while the capability FOR SHARE predicate waits disappears
        // from that statement (404); a new project lookup after commit is unavailable (503).
        const projectFence=['project_profile','organization_profile'].includes(table);
        const expected=table==='plugin_installation'||projectFence?[404]:table==='member_user'?[401,403]:[403];
        const body={code:'fence-'+table.replaceAll('_','-'),name:'Fence',graph:{schemaVersion:1,inputKeys:[],nodes:[{id:'s',type:'start'},{id:'e',type:'end'}],edges:[edge('s','e')]}};
        const pending=request('POST','',{body,status:expected});
        try{
          let n=0;for(let i=0;i<100;i++){n=await db(async c=>(await c.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND cardinality(pg_blocking_pids(pid))>0")).rows[0].n);if(n)break;await pause(20);}assert.ok(n);
          release.resolve();await locking;const refused=await pending;
          const sample={table,status:refused.status};
          if(projectFence){const fresh=await request('POST','',{body,status:[503]});sample.freshStatus=fresh.status;}
          proof.fenceStatuses.push(sample);
        }finally{
          release.resolve();await locking;await pending.catch(()=>{});
          await db(c=>c.query(`UPDATE public.${table} SET status=$2 WHERE id=$1`,[id,table==='plugin_installation'?'enabled':'active']));
        }
        assert.equal(await prisma.aiPersonalWorkflow.count({where:{code:body.code}}),0);
      }
    });
    await lifecycle.disable('aij-ai',admin.id,'af170-disable');await denied(()=>request('GET','',{status:404}));await lifecycle.enable('aij-ai',admin.id,'af170-enable-again');
    await t.test('two-host serialized quota caps active assets at 100; tombstones never revive or reuse code',async()=>{
      const small={schemaVersion:1,inputKeys:[],nodes:[{id:'s',type:'start'},{id:'e',type:'end'}],edges:[edge('s','e')]};
      while(await prisma.aiPersonalWorkflow.count({where:{workspaceId:spaces[0].id,memberId:accounts[0].id,deletedAt:null}})<99)await request('POST','',{body:{code:'quota-'+randomUUID(),name:'Quota',graph:small},status:201});
      const raced=await Promise.all([request('POST','',{body:{code:'last-a',name:'Quota',graph:small},status:[201,409]}),request('POST','',{host:secondBase,body:{code:'last-b',name:'Quota',graph:small},status:[201,409]})]);assert.deepEqual(raced.map(r=>r.status).sort(),[201,409]);assert.equal(await prisma.aiPersonalWorkflow.count({where:{workspaceId:spaces[0].id,memberId:accounts[0].id,deletedAt:null}}),100);
      await request('DELETE','/'+asset.id,{body:{expectedRevision:2}});await denied(()=>request('POST','',{body:initial,status:409}));await denied(()=>request('GET','/'+asset.id+'/versions/1',{status:404}));
      await assert.rejects(db(c=>c.query('UPDATE public.ai_personal_workflow SET deleted_at=NULL WHERE id=$1',[asset.id])));
    });
    await t.test('actual packed public SDK ESM/CJS and strict declarations',async()=>{
      // Root provides independently installed unpacked consumer, not source aliases.
      const consumer=previous.AIJ_AF170_PACKED_CONSUMER;assert.ok(consumer,'root must pack/install the SDK with workflow index exports');
      const consumerRequire=createRequire(join(resolve(consumer),'package.json'));
      const cjs=consumerRequire('@aij/sdk');const esm=await import((await import('node:url')).pathToFileURL(consumerRequire.resolve('@aij/sdk').replace(/index\.cjs$/,'index.mjs')));
      for(const sdk of [cjs,esm]){assert.equal(typeof sdk.createPersonalWorkflowsClient,'function');const api=sdk.createClientApi(()=>base),client=sdk.createPersonalWorkflowsClient(async(path,options)=>api(path,{...options,headers:{cookie:cookies[0],origin:env.WEB_URL}}));assert.ok(Array.isArray((await client.list(spaces[0].id,{limit:1})).items));
        const graph={schemaVersion:1,inputKeys:[],nodes:[{id:'s',type:'start'},{id:'e',type:'end'}],edges:[edge('s','e')]};
        const made=await client.create(spaces[0].id,{code:'packed-'+randomUUID(),name:'Packed draft',graph});assert.equal(made.status,'DRAFT');assert.equal(made.revision,1);
        assert.equal((await client.get(spaces[0].id,made.id)).id,made.id);
        const changed=await client.update(spaces[0].id,made.id,{name:'Packed revision two',graph,expectedRevision:1});assert.equal(changed.revision,2);
        assert.equal((await client.versions(spaces[0].id,made.id,{limit:1})).items[0].revision,2);
        assert.equal((await client.getVersion(spaces[0].id,made.id,1)).name,'Packed draft');
        assert.equal((await client.delete(spaces[0].id,made.id,2)).deleted,true);
        await assert.rejects(client.get(spaces[0].id,made.id),error=>error instanceof sdk.ClientRequestFailure&&error.status===404);
      }
      proof.packedEsmCjsCrudHistory=true;
      execFileSync('pnpm',['exec','tsc','--noEmit','--strict','--skipLibCheck','--module','NodeNext','--moduleResolution','NodeNext','af170-consumer.mts','af170-consumer.cts'],{cwd:consumer,stdio:'pipe'});
    });
    const after=await tableHashes();for(const table of runtimeTables)assert.equal(after[table],runtimeBaseline[table],table+' must remain untouched');assert.equal(upstream,0);
    proof.status='EVIDENCE_RECORDED_FORMAL_REPORT_IS_AUTHORITY';proof.runtimeTables=runtimeTables;proof.upstream=upstream;
  }finally{
    if(secondApp)await secondApp.close();if(app)await app.close();
    const active=await withDatabase('test',readDatabaseEnvironment('test',process.env,lease.id),async c=>(await c.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND application_name LIKE 'aij-api:%'")).rows[0].n,{acceptanceId:lease.id});assert.equal(active,0);proof.poolsAfter=active;
    for(const k of Object.keys(process.env))delete process.env[k];Object.assign(process.env,previous);
    const directory=resolve(repositoryRoot,'.artifacts/verification/AF-170');mkdirSync(directory,{recursive:true});writeFileSync(join(directory,'live-'+lease.id+'.json'),JSON.stringify(proof,null,2)+'\n');
  }
});
