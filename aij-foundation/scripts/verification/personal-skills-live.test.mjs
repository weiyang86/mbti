// ROOT ONLY. Fresh AF-154 lease; requires root task registration, merged schema/migration,
// generated Prisma, built packages/API and isolated test database scheduling. NOT_RUN by worker.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { join,resolve } from 'node:path';
import{execFileSync}from'node:child_process';
import{mkdirSync,writeFileSync}from'node:fs';
import test from 'node:test';
import { createAcceptance, migrate } from '../database/migration.mjs';
import { seedDatabase } from '../database/seed.mjs';
import { clientEnvironment } from './client-auth-fixture.mjs';
import { repositoryRoot, withDatabase,checkDatabase,readDatabaseEnvironment } from '../database/connection.mjs';
const require=createRequire(join(repositoryRoot,'apps/api/package.json'));
const task='AF-154';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return{promise,resolve};};

test('AF-154 fresh real Cookie/API/PostgreSQL private Skills acceptance', {timeout:360000},async t=>{
  assert.equal(process.env.AIJ_AF154_ROOT_LIVE,'1');
  assert.equal(resolve(process.cwd()),'/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation');
  const git=flag=>resolve(repositoryRoot,execFileSync('git',['rev-parse',flag],{encoding:'utf8'}).trim());assert.equal(git('--git-dir'),git('--git-common-dir'));
  assert.equal(execFileSync('git',['branch','--show-current'],{encoding:'utf8'}).trim(),'dev');await checkDatabase('test');
  const lease=await createAcceptance('test',task);
  assert.equal((await migrate({mode:'test',action:'deploy',acceptanceId:lease.id})).exitCode,0);
  assert.equal((await migrate({mode:'test',action:'status',acceptanceId:lease.id})).exitCode,0);
  await seedDatabase({mode:'test',acceptanceId:lease.id,generateCredentials:true,runtimeManagement:true,pluginManagement:true});
  const previous={...process.env};let app;const proof={task,acceptanceId:lease.id,database:lease.database};
  try {
    const env=clientEnvironment(lease.id,task);
    for(const key of Object.keys(process.env))delete process.env[key];
    Object.assign(process.env,env,{ASYNC_RUNTIME_ENABLED:'false',ENABLED_PLUGINS:'aij-ai'});
    const {createApplication}=require('../../apps/api/dist/bootstrap.js');
    const {PrismaService}=require('../../apps/api/dist/prisma/prisma.service.js');
    const {AiPersonalSkillsService}=require('../../apps/api/dist/plugins/aij-ai/ai-personal-skills.service.js');
    app=await createApplication();await app.listen(0,'127.0.0.1');
    const prisma=app.get(PrismaService),service=app.get(AiPersonalSkillsService);
    const base=`http://127.0.0.1:${app.getHttpServer().address().port}/api`,root=base+'/client/ai/skills';
    const db=operation=>withDatabase('test',readDatabaseEnvironment('test',process.env,lease.id),operation,{acceptanceId:lease.id});
    const project=await prisma.projectProfile.findUniqueOrThrow({where:{code:'aij-foundation-test'}});
    const {PluginCatalog}=require('../../apps/api/dist/plugin-runtime/plugin-catalog.js'),{PluginLifecycleService}=require('../../apps/api/dist/plugin-runtime/plugin-lifecycle.service.js');
    const admin=await prisma.sysUser.findUniqueOrThrow({where:{username:'aij-admin'}}),catalog=app.get(PluginCatalog),lifecycle=app.get(PluginLifecycleService);
    await lifecycle.install('aij-ai',catalog.manifest('aij-ai').version,admin.id,'af154-install');await lifecycle.enable('aij-ai',admin.id,'af154-enable');proof.realPluginLifecycle=true;
    const {Prisma}=require('@prisma/client');const models=Prisma.dmmf.datamodel.models.filter(m=>['AiPersonalSkill','AiPersonalSkillVersion'].includes(m.name));assert.equal(models.length,2);
    for(const model of models){
      const columns=await prisma.$queryRaw`SELECT column_name,data_type,is_nullable,character_maximum_length,datetime_precision FROM information_schema.columns WHERE table_schema='public' AND table_name=${model.dbName}`;
      const fields=model.fields.filter(f=>f.kind==='scalar');assert.deepEqual(columns.map(c=>c.column_name).sort(),fields.map(f=>f.dbName??f.name).sort());
      for(const field of fields){const col=columns.find(c=>c.column_name===(field.dbName??field.name));assert.equal(col.is_nullable,field.isRequired?'NO':'YES');
        assert.equal(col.data_type,field.type==='Int'?'integer':field.type==='DateTime'?'timestamp without time zone':field.name==='code'||field.name==='name'?'character varying':'text');
        if(['code','name'].includes(field.name))assert.equal(col.character_maximum_length,field.name==='code'?63:100);if(field.type==='DateTime')assert.equal(col.datetime_precision,3);
      }
    }
    const fks=await prisma.$queryRaw`SELECT conname,confupdtype::text AS confupdtype,confdeltype::text AS confdeltype FROM pg_constraint WHERE conrelid IN ('public.ai_personal_skill'::regclass,'public.ai_personal_skill_version'::regclass) AND contype='f'`;
    assert.equal(fks.length,5);assert.ok(fks.every(f=>f.confupdtype==='r'&&f.confdeltype==='r'));proof.schemaColumnAndForeignKeyParity=true;
    const checks=await prisma.$queryRaw`SELECT conname FROM pg_constraint WHERE conrelid IN ('public.ai_personal_skill'::regclass,'public.ai_personal_skill_version'::regclass) AND contype='c'`;assert.equal(checks.length,8);proof.sqlOnlyConstraints=8;

    const bcrypt=require('bcryptjs'),accounts=[],cookies=[],spaces=[];
    for(let i=0;i<3;i++){
      const password='Af154-'+randomBytes(24).toString('hex');
      const account=await prisma.memberUser.create({data:{email:`af154-${randomUUID()}@example.test`,nickname:'Synthetic AF154 member',passwordHash:await bcrypt.hash(password,12),emailVerifiedAt:new Date()}});accounts.push(account);
      const login=await fetch(base+'/client/auth/login',{method:'POST',headers:{origin:env.WEB_URL,'content-type':'application/json'},body:JSON.stringify({email:account.email,password}),signal:AbortSignal.timeout(15000)});
      assert.equal(login.status,200);const cookie=login.headers.get('set-cookie');assert.ok(cookie.includes('HttpOnly')&&cookie.includes('SameSite=Strict'));cookies.push(cookie.split(';')[0]);await login.arrayBuffer();
    }
    const request=async(method,path='',{actor=0,workspace=spaces[0]?.id,body,status=200,origin=env.WEB_URL,headers={}}={})=>{
      const response=await fetch(root+path,{method,headers:{connection:'close',...(actor===null?{}:{cookie:cookies[actor]}),...(workspace?{'x-aij-workspace-id':workspace}:{}),...(origin?{origin}:{}),...(body===undefined?{}:{'content-type':'application/json'}),...headers},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
      const raw=await response.text();if(Array.isArray(status))assert.ok(status.includes(response.status),`${method} personal Skill unexpected HTTP ${response.status}`);
      else assert.equal(response.status,status,`${method} personal Skill route returned ${response.status}`);
      assert.match(response.headers.get('cache-control')||'',/no-store/);
      const data=raw?JSON.parse(raw).data:null;return Array.isArray(status)?{status:response.status,data}:data;
    };
    for(let i=0;i<2;i++){
      const response=await fetch(base+'/client/workspaces',{method:'POST',headers:{cookie:cookies[i],origin:env.WEB_URL,'content-type':'application/json'},body:JSON.stringify({name:'AF154 synthetic space '+i,idempotencyKey:'af154-'+randomUUID()}),signal:AbortSignal.timeout(15000)});
      assert.equal(response.status,201);spaces.push((await response.json()).data);
    }
    const ownerRoles=[];
    for(const [i,w]of spaces.entries()){
      const owner=await prisma.clientWorkspaceRole.findUniqueOrThrow({where:{workspaceId_code:{workspaceId:w.id,code:'OWNER'}}});ownerRoles.push(owner);
      await prisma.clientWorkspaceMembership.create({data:{workspaceId:w.id,memberId:accounts[1-i].id,roleId:owner.id}});
    }
    const memberRole=await prisma.clientWorkspaceRole.findUniqueOrThrow({where:{workspaceId_code:{workspaceId:spaces[0].id,code:'MEMBER'}}});
    await prisma.clientWorkspaceMembership.create({data:{workspaceId:spaces[0].id,memberId:accounts[2].id,roleId:memberRole.id}});
    // Hash every public table, omitting only session last_seen_at/updated_at auth bookkeeping.
    const tableHashes=()=>db(async client=>{
      const tables=(await client.query("SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname='public' ORDER BY tablename")).rows;
      const result={};
      for(const {tablename}of tables){
        assert.match(tablename,/^[A-Za-z_][A-Za-z0-9_]*$/);
        const projection=tablename==='client_auth_session'?"(to_jsonb(t)-'last_seen_at'-'updated_at')::text":'row_to_json(t)::text';
        const rows=(await client.query('SELECT '+projection+' AS row FROM public."'+tablename+'" t')).rows.map(r=>r.row).sort();
        result[tablename]=createHash('sha256').update(JSON.stringify(rows)).digest('hex');
      }
      return result;
    });
    const denied=async operation=>{const before=await tableHashes();await operation();assert.deepEqual(await tableHashes(),before,'denial must change zero durable domain/audit rows');};
    const initial={code:'private-prompt',name:'Private AF154 name sentinel',instructions:'Private AF154 instruction sentinel; $(never-executed)'};let skill;
    await t.test('HTTP whitelist/origin/auth/default permission denial; no writes',async()=>{
      for(const extra of ['memberId','workspaceId','projectId','ownerId','script','file','ref'])await denied(()=>request('POST','',{body:{...initial,[extra]:'forged'},status:400}));
      await denied(()=>request('POST','',{body:initial,origin:'https://foreign.invalid',status:403}));
      await denied(()=>request('POST','',{body:initial,origin:null,status:403}));
      await denied(()=>request('POST','',{body:initial,headers:{'sec-fetch-site':'cross-site'},status:403}));
      await denied(()=>request('GET','',{actor:null,status:401}));
      await denied(()=>request('GET','',{actor:2,status:403}));
      await denied(()=>request('POST','',{actor:2,body:initial,status:403}));
      await denied(()=>request('GET','?limit=51',{status:400}));
    });
    await t.test('concurrent create, replay/content conflict, immutable history and CAS',async()=>{
      const made=await Promise.all([request('POST','',{body:initial,status:201}),request('POST','',{body:initial,status:201})]);skill=made[0];assert.equal(skill.id,made[1].id);
      assert.equal((await request('POST','',{body:initial,status:201})).id,skill.id);
      assert.equal(await prisma.aiPersonalSkillVersion.count(),1);assert.equal(await prisma.auditLog.count({where:{resourceId:skill.id}}),1);
      await denied(()=>request('POST','',{body:{...initial,instructions:'changed'},status:409}));
      await denied(()=>request('PATCH','/'+skill.id,{body:{name:initial.name,instructions:'second',expectedRevision:2},status:409}));
      await request('PATCH','/'+skill.id,{body:{name:initial.name,instructions:initial.instructions,expectedRevision:1}});
      assert.equal(await prisma.aiPersonalSkillVersion.count(),1);
      const edits=await Promise.all(['a','b'].map(instructions=>request('PATCH','/'+skill.id,{body:{name:'Edited',instructions,expectedRevision:1},status:[200,409]})));
      assert.deepEqual(edits.map(r=>r.status).sort(),[200,409]);
      await denied(()=>request('PATCH','/'+skill.id,{body:{name:'Edited',instructions:'stale',expectedRevision:1},status:409}));
      assert.equal((await request('GET','/'+skill.id)).revision,2);
      const versions=await request('GET','/'+skill.id+'/versions?limit=1');assert.equal(versions.items[0].revision,2);assert.equal(versions.nextCursor,2);
      const older=await request('GET','/'+skill.id+'/versions?beforeRevision=2');assert.equal(older.items[0].instructions,initial.instructions);
      assert.equal((await request('GET','?limit=1')).items.length,1);
      await assert.rejects(prisma.aiPersonalSkillVersion.updateMany({where:{skillId:skill.id},data:{instructions:'tamper'}}));
      await assert.rejects(prisma.aiPersonalSkillVersion.deleteMany({where:{skillId:skill.id}}));
      const audits=await prisma.auditLog.findMany({where:{resourceId:skill.id}});assert.equal(audits.length,2);assert.equal(JSON.stringify(audits).includes(initial.name),false);assert.equal(JSON.stringify(audits).includes(initial.instructions),false);assert.ok(audits.every(a=>a.userId===accounts[0].id));
    });
    await t.test('compiled ESM/CJS SDK uses actual cookie/workspace transport and HTTP409 errors',async()=>{
      const cjs=require('../../packages/sdk/dist/index.cjs');
      const esm=await import(new URL('../../packages/sdk/dist/index.mjs',import.meta.url));
      for(const sdkModule of [cjs,esm]){
        assert.equal(typeof sdkModule.createAiRunRecoveryClient,'function');
        const api=sdkModule.createClientApi(()=>base);
        const client=sdkModule.createPersonalSkillsClient((path,options={})=>api(path,{...options,headers:{cookie:cookies[0],origin:env.WEB_URL}}));
        assert.equal((await client.get(spaces[0].id,skill.id)).revision,2);
        assert.ok((await client.list(spaces[0].id,{limit:1})).items.length>0);
        assert.equal((await client.versions(spaces[0].id,skill.id,{limit:1})).items[0].revision,2);
        await assert.rejects(client.update(spaces[0].id,skill.id,{name:'stale',instructions:'stale',expectedRevision:1}),e=>e instanceof sdkModule.ClientRequestFailure&&e.status===409);
      }
    });
    await t.test('other owner, other workspace and unknown IDs have equal denial without existence leaks',async()=>{
      const ownOther=await request('POST','',{actor:1,workspace:spaces[1].id,body:initial,status:201});assert.notEqual(ownOther.id,skill.id);
      for(const opts of [{actor:1},{workspace:spaces[1].id},{actor:1,workspace:spaces[1].id}])for(const id of [skill.id,randomUUID()]){
        await denied(()=>request('GET','/'+id,{...opts,status:404}));await denied(()=>request('GET','/'+id+'/versions',{...opts,status:404}));
        await denied(()=>request('PATCH','/'+id,{...opts,body:{name:'x',instructions:'x',expectedRevision:2},status:404}));
        await denied(()=>request('DELETE','/'+id,{...opts,body:{expectedRevision:2},status:404}));
      }
    });
    await t.test('disabled/removed/deleted member, workspace, role, permission, grant and plugin rechecked',async()=>{
      const membership=await prisma.clientWorkspaceMembership.findUniqueOrThrow({where:{workspaceId_memberId:{workspaceId:spaces[0].id,memberId:accounts[0].id}}});
      const permission=await prisma.clientWorkspacePermission.findUniqueOrThrow({where:{code:'workspace.ai.assets.manage'}});
      const grant=await prisma.clientWorkspaceRolePermission.findUniqueOrThrow({where:{roleId_permissionId:{roleId:ownerRoles[0].id,permissionId:permission.id}}});
      for(const [model,id,field,off,on,httpStatus]of [
        ['memberUser',accounts[0].id,'status','disabled','active',401],['memberUser',accounts[0].id,'deletedAt',new Date(),null,401],
        ['clientWorkspace',spaces[0].id,'status','disabled','active',403],['clientWorkspace',spaces[0].id,'deletedAt',new Date(),null,403],
        ['clientWorkspaceMembership',membership.id,'status','disabled','active',403],
        ['clientWorkspaceMembership',membership.id,'disabledAt',new Date(),null,403],['clientWorkspaceMembership',membership.id,'removedAt',new Date(),null,403],['clientWorkspaceMembership',membership.id,'deletedAt',new Date(),null,403],
        ['clientWorkspaceRole',ownerRoles[0].id,'status','disabled','active',403],['clientWorkspaceRole',ownerRoles[0].id,'deletedAt',new Date(),null,403],
        ['clientWorkspacePermission',permission.id,'status','disabled','active',403],['clientWorkspacePermission',permission.id,'deletedAt',new Date(),null,403],
        ['clientWorkspaceRolePermission',grant.id,'deletedAt',new Date(),null,403]
      ]){await prisma[model].update({where:{id},data:{[field]:off}});try{await denied(()=>request('PATCH','/'+skill.id,{body:{name:'x',instructions:'x',expectedRevision:2},status:httpStatus}));}finally{await prisma[model].update({where:{id},data:{[field]:on}});}}
      await prisma.pluginInstallation.update({where:{projectId_pluginCode:{projectId:project.id,pluginCode:'aij-ai'}},data:{status:'installed'}});
      try{await denied(()=>request('GET','',{status:404}));}finally{await prisma.pluginInstallation.update({where:{projectId_pluginCode:{projectId:project.id,pluginCode:'aij-ai'}},data:{status:'enabled'}});}
      await prisma.projectProfile.update({where:{id:project.id},data:{status:'disabled'}});
      try{await denied(()=>request('GET','',{status:503}));}finally{await prisma.projectProfile.update({where:{id:project.id},data:{status:'active'}});}
    });
    await t.test('SQL audit fault rolls back both current row and new snapshot',async()=>{
      await db(async client=>{await client.query("CREATE FUNCTION public.af154_audit_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.module='aij-ai' AND NEW.resource_type='ai_personal_skill' THEN RAISE EXCEPTION 'synthetic audit fault'; END IF; RETURN NEW; END $$");await client.query('CREATE TRIGGER af154_audit_fault BEFORE INSERT ON public.audit_log FOR EACH ROW EXECUTE FUNCTION public.af154_audit_fault()');});
      try{
        await denied(()=>request('POST','',{body:{...initial,code:'audit-fault'},status:503}));
        await denied(()=>request('PATCH','/'+skill.id,{body:{name:'fault',instructions:'fault',expectedRevision:2},status:503}));
        await denied(()=>request('DELETE','/'+skill.id,{body:{expectedRevision:2},status:503}));
      }finally{await db(async client=>{await client.query('DROP TRIGGER af154_audit_fault ON public.audit_log');await client.query('DROP FUNCTION public.af154_audit_fault()');});}
    });
    await t.test('PostgreSQL blocks real grant revocation behind an in-flight shared permission fence',async()=>{
      const entered=deferred(),release=deferred(),revoker=deferred();
      const original=service.audit.bind(service);let pending,revocation;
      service.audit=async(...args)=>{entered.resolve();await release.promise;return original(...args);};
      try{
        pending=request('POST','',{body:{...initial,code:'permission-fence'},status:201});await Promise.race([entered.promise,pending.then(()=>{throw new Error('request finished before permission fence barrier');})]);
        revocation=db(async client=>{await client.query('BEGIN');const pid=(await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;revoker.resolve(pid);
          try{await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['aij-client-workspace-membership:'+spaces[0].id]);await client.query("UPDATE public.client_workspace_role_permission SET deleted_at=CURRENT_TIMESTAMP WHERE role_id=$1 AND permission_id=(SELECT id FROM public.client_workspace_permission WHERE code='workspace.ai.assets.manage')",[ownerRoles[0].id]);await client.query('COMMIT');}catch(e){await client.query('ROLLBACK');throw e;}});
        const pid=await Promise.race([revoker.promise,revocation.then(()=>{throw new Error('revocation finished before its PG pid');})]);let blocked=false;
        for(let i=0;i<20;i++) {blocked=await db(async client=>(await client.query('SELECT cardinality(pg_blocking_pids($1))>0 AS blocked',[pid])).rows[0].blocked);if(blocked)break;await sleep(25);}
        assert.equal(blocked,true,'a distinct real PG session is blocked on the in-flight grant row lock');proof.pgBlockingObserved=true;
        release.resolve();await pending;await revocation;
        await denied(()=>request('POST','',{body:{...initial,code:'after-revocation'},status:403}));
      }finally{release.resolve();service.audit=original;await pending?.catch(()=>{});await revocation?.catch(()=>{});await prisma.clientWorkspaceRolePermission.updateMany({where:{roleId:ownerRoles[0].id,permission:{code:'workspace.ai.assets.manage'}},data:{deletedAt:null}});}
    });
    await t.test('soft delete is stable, retains immutable snapshots and never resurrects',async()=>{
      const before=await prisma.aiPersonalSkillVersion.count({where:{skillId:skill.id}});
      const deleted=await request('DELETE','/'+skill.id,{body:{expectedRevision:2}});assert.equal(deleted.deleted,true);
      assert.deepEqual(await request('DELETE','/'+skill.id,{body:{expectedRevision:2}}),deleted);
      await denied(()=>request('GET','/'+skill.id,{status:404}));await denied(()=>request('GET','/'+skill.id+'/versions',{status:404}));
      await denied(()=>request('PATCH','/'+skill.id,{body:{name:'revive',instructions:'revive',expectedRevision:2},status:404}));
      await denied(()=>request('POST','',{body:initial,status:409}));
      assert.equal(await prisma.aiPersonalSkillVersion.count({where:{skillId:skill.id}}),before);
    });
    await t.test('100-live quota enforced under concurrent create',async()=>{
      const count=await prisma.aiPersonalSkill.count({where:{workspaceId:spaces[0].id,memberId:accounts[0].id,deletedAt:null}});
      for(let i=count;i<99;i++)await request('POST','',{body:{...initial,code:'quota-'+i},status:201});
      const results=await Promise.all(['quota-final-a','quota-final-b'].map(code=>request('POST','',{body:{...initial,code},status:[201,409]})));
      assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);
      await denied(()=>request('POST','',{body:{...initial,code:'quota-overflow'},status:409}));
      assert.equal(await prisma.aiPersonalSkill.count({where:{workspaceId:spaces[0].id,memberId:accounts[0].id,deletedAt:null}}),100);proof.quota100=true;
    });
    proof.currentRows=await prisma.aiPersonalSkill.count();proof.versionRows=await prisma.aiPersonalSkillVersion.count();proof.personalSkillAuditRows=await prisma.auditLog.count({where:{resourceType:'ai_personal_skill'}});
  }finally{
    try{await app?.close();const pools=await withDatabase('test',readDatabaseEnvironment('test',process.env,lease.id),async c=>(await c.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND application_name LIKE 'aij-api:%'")).rows[0].n,{acceptanceId:lease.id});assert.equal(pools,0);proof.applicationPools=pools;proof.appClosed=true;
      const folder=join(repositoryRoot,'.artifacts/auto-ai-program-20261105/AF-154');mkdirSync(folder,{recursive:true,mode:0o700});writeFileSync(join(folder,'live-'+lease.id+'.json'),JSON.stringify({...proof,status:'EVIDENCE_RECORDED_FORMAL_REPORT_IS_AUTHORITY'},null,2)+'\n',{mode:0o600});
    }finally{for(const key of Object.keys(process.env))delete process.env[key];Object.assign(process.env,previous);}
  }
});
