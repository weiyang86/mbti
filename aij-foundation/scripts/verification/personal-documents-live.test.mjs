// ROOT ONLY. Worker MUST NOT run: real protected fresh PG migration, compiled API and installed packed SDK.
// Missing production Web adapter is a FAILURE. Never skip, use source SDK, or adopt a previous lease.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {existsSync,mkdirSync,writeFileSync,readFileSync,readdirSync,realpathSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import test from 'node:test';
import {createAcceptance,migrate} from '../database/migration.mjs';
import {seedDatabase} from '../database/seed.mjs';
import {clientEnvironment} from './client-auth-fixture.mjs';
import {repositoryRoot,checkDatabase,withDatabase,readDatabaseEnvironment} from '../database/connection.mjs';
const require=createRequire(join(repositoryRoot,'apps/api/package.json'));
const task='AF-190',route='/client/documents';
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return{promise,resolve};};
const pause=ms=>new Promise(r=>setTimeout(r,ms));

test('AF-190 fresh PG/API/packed SDK and production native desktop/mobile documents',{timeout:540000},async t=>{
  assert.equal(process.env.AIJ_AF190_ROOT_LIVE,'1','root must explicitly authorize real acceptance');
  assert.equal(resolve(process.cwd()),'/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation');
  const git=flag=>resolve(repositoryRoot,execFileSync('git',['rev-parse',flag],{encoding:'utf8'}).trim());assert.equal(git('--git-dir'),git('--git-common-dir'));
  assert.equal(execFileSync('git',['branch','--show-current'],{encoding:'utf8'}).trim(),'dev');
  const checkedArtifact=(raw,label)=>{assert.equal(typeof raw,'string',label+' required');const p=realpathSync(raw);assert.ok(p.startsWith(join(repositoryRoot,'.artifacts')+'/'),label+' must be a real root ignored artifact');execFileSync('git',['check-ignore','--quiet',p],{stdio:'ignore'});return p;};
  const consumer=checkedArtifact(process.env.AIJ_AF190_PACKED_CONSUMER,'packed consumer');
  const browserPath=checkedArtifact(process.env.AIJ_AF190_BROWSER_ADAPTER,'production native browser adapter');assert.ok(existsSync(browserPath));
  const browser=await import(pathToFileURL(browserPath));assert.equal(typeof browser.verifyPersonalDocumentsBrowser,'function','no missing adapter fallback');
  await checkDatabase('test');const lease=await createAcceptance('test',task);
  assert.equal((await migrate({mode:'test',action:'deploy',acceptanceId:lease.id})).exitCode,0);
  assert.equal((await migrate({mode:'test',action:'status',acceptanceId:lease.id})).exitCode,0);
  await seedDatabase({mode:'test',acceptanceId:lease.id,generateCredentials:true,pluginManagement:true,runtimeManagement:true});
  const nativeHost=await browser.preparePersonalDocumentsHost(),browserOrigin=nativeHost.origin;
  const previous={...process.env},proof={task,acceptanceId:lease.id,database:lease.database,status:'RUNNING'},logs=[];let app,peer;
  try{
    const env=clientEnvironment(lease.id,task);for(const k of Object.keys(process.env))delete process.env[k];Object.assign(process.env,env,{ASYNC_RUNTIME_ENABLED:'false',ENABLED_PLUGINS:'aij-ai',AI_CENTER_LIVE_ENABLED:'false'});
    const {createApplication}=require('../../apps/api/dist/bootstrap.js'),{PrismaService}=require('../../apps/api/dist/prisma/prisma.service.js');
    app=await createApplication({testBrowserOrigin:browserOrigin});app.useLogger(Object.fromEntries(['log','error','warn','debug','verbose','fatal'].map(k=>[k,(...args)=>logs.push(args.map(v=>typeof v==='string'?v:JSON.stringify(v)).join(' '))])));
    await app.listen(0,'127.0.0.1');const prisma=app.get(PrismaService),base=`http://127.0.0.1:${app.getHttpServer().address().port}/api`;
    peer=await createApplication({testBrowserOrigin:browserOrigin});peer.useLogger(Object.fromEntries(['log','error','warn','debug','verbose','fatal'].map(k=>[k,(...args)=>logs.push(args.map(v=>typeof v==='string'?v:JSON.stringify(v)).join(' '))])));await peer.listen(0,'127.0.0.1');const peerBase=`http://127.0.0.1:${peer.getHttpServer().address().port}/api`;
    const db=op=>withDatabase('test',readDatabaseEnvironment('test',process.env,lease.id),op,{acceptanceId:lease.id});
    const {PluginCatalog}=require('../../apps/api/dist/plugin-runtime/plugin-catalog.js'),{PluginLifecycleService}=require('../../apps/api/dist/plugin-runtime/plugin-lifecycle.service.js');
    const admin=await prisma.sysUser.findUniqueOrThrow({where:{username:'aij-admin'}}),lifecycle=app.get(PluginLifecycleService),catalog=app.get(PluginCatalog);
    await lifecycle.install('aij-ai',catalog.manifest('aij-ai').version,admin.id,'af190-install');await lifecycle.enable('aij-ai',admin.id,'af190-enable');
    const {PersonalDocumentsService}=require('../../apps/api/dist/documents/personal-documents.service.js'),service=app.get(PersonalDocumentsService);
    const {AiCenterHttpTransport}=require('../../apps/api/dist/plugins/aij-ai/ai-center-provider.js');let upstream=0;for(const host of [app,peer])host.get(AiCenterHttpTransport).request=async()=>{upstream++;throw new Error('Unexpected provider call');};
    const tableHashes=()=>db(async c=>{const out={};for(const {tablename}of (await c.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows){assert.match(tablename,/^[A-Za-z_][A-Za-z0-9_]*$/);const projection=tablename==='client_auth_session'?"(to_jsonb(t)-'last_seen_at'-'updated_at')::text":'row_to_json(t)::text';out[tablename]=createHash('sha256').update(JSON.stringify((await c.query('SELECT '+projection+' AS row FROM public."'+tablename+'" t')).rows.map(r=>r.row).sort())).digest('hex');}return out;});
    const cookies=[],accounts=[],spaces=[],loginCredentials=[];
    for(let i=0;i<3;i++){
      const password='Af190-'+randomBytes(24).toString('hex'),account=await prisma.memberUser.create({data:{email:`af190-${randomUUID()}@example.test`,nickname:'AF190 synthetic',passwordHash:await require('bcryptjs').hash(password,12),emailVerifiedAt:new Date()}});accounts.push(account);loginCredentials.push({email:account.email,password});
      const r=await fetch(base+'/client/auth/login',{method:'POST',headers:{origin:browserOrigin,'content-type':'application/json',connection:'close'},body:JSON.stringify({email:account.email,password}),signal:AbortSignal.timeout(15000)});assert.equal(r.status,200);assert.match(r.headers.get('set-cookie')||'',/HttpOnly/);cookies.push(r.headers.get('set-cookie').split(';')[0]);await r.arrayBuffer();
    }
    const request=async(method,path='',{actor=0,workspace=spaces[0]?.id,body,status=200,origin=browserOrigin,headers={},prefix=route,apiBase=base}={})=>{
      const r=await fetch(apiBase+prefix+path,{method,headers:{connection:'close',...(actor===null?{}:{cookie:cookies[actor]}),...(workspace?{'x-aij-workspace-id':workspace}:{}),...(origin?{origin}:{}),...(body===undefined?{}:{'content-type':'application/json'}),...headers},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
      const raw=await r.text();assert.ok((Array.isArray(status)?status:[status]).includes(r.status),`${method} ${prefix}${path}: HTTP ${r.status}`);
      if(prefix===route){assert.match(r.headers.get('cache-control')||'',/private/);assert.match(r.headers.get('cache-control')||'',/no-store/);assert.match(r.headers.get('x-correlation-id')||'',/^[A-Za-z0-9._:-]{8,128}$/);}
      const data=raw?JSON.parse(raw).data:null;return Array.isArray(status)?{status:r.status,data}:data;
    };
    for(let i=0;i<2;i++)spaces.push(await request('POST','',{prefix:'/client/workspaces',actor:i,body:{name:'AF190 space '+i,idempotencyKey:'af190-'+randomUUID()},status:201}));
    const role=await prisma.clientWorkspaceRole.findUniqueOrThrow({where:{workspaceId_code:{workspaceId:spaces[0].id,code:'OWNER'}}});
    await prisma.clientWorkspaceMembership.create({data:{workspaceId:spaces[0].id,memberId:accounts[1].id,roleId:role.id}});
    const otherRole=await prisma.clientWorkspaceRole.findUniqueOrThrow({where:{workspaceId_code:{workspaceId:spaces[1].id,code:'OWNER'}}});
    await prisma.clientWorkspaceMembership.create({data:{workspaceId:spaces[1].id,memberId:accounts[0].id,roleId:otherRole.id}});
    const reader=await prisma.clientWorkspaceRole.create({data:{workspaceId:spaces[0].id,code:'AF190_READER',name:'Read only'}});
    const readPermission=await prisma.clientWorkspacePermission.findUniqueOrThrow({where:{code:'workspace.documents.read'}});
    await prisma.clientWorkspaceRolePermission.create({data:{roleId:reader.id,permissionId:readPermission.id}});
    const contextPermission=await prisma.clientWorkspacePermission.findUniqueOrThrow({where:{code:'workspace.context.read'}});await prisma.clientWorkspaceRolePermission.create({data:{roleId:reader.id,permissionId:contextPermission.id}});await prisma.clientWorkspaceMembership.create({data:{workspaceId:spaces[0].id,memberId:accounts[2].id,roleId:reader.id}});
    const denied=async op=>{const before=await tableHashes();await op();assert.deepEqual(await tableHashes(),before,'refusal must leave domain/audit unchanged');};
    const initial={code:'private-text',name:'AF190 name sentinel',body:'AF190 private body sentinel\r\n\t🙂中文'},edit=(extra={})=>({expectedRevision:1,name:initial.name,body:initial.body,...extra});let document;
    const ledgersBefore=await tableHashes();
    const sub=async(name,fn)=>{let failure;await t.test(name,async()=>{try{await fn();}catch(error){failure=error;throw error;}});if(failure)throw failure;};
    await sub('fresh migration creates scope-safe foreign keys, UUID heads and immutable append constraints',async()=>{
      const constraints=await db(async c=>(await c.query("SELECT conname,contype,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid IN ('public.personal_document'::regclass,'public.personal_document_version'::regclass)")).rows);
      for(const name of ['personal_document_owner_fk','personal_document_scope_key','personal_document_code_key','personal_document_version_scope_fk','personal_document_version_revision_key'])assert.ok(constraints.some(c=>c.conname===name),name+' missing');
      assert.match(constraints.find(c=>c.conname==='personal_document_version_scope_fk').definition,/FOREIGN KEY \(document_id, workspace_id, member_id\)/);
      await assert.rejects(db(c=>c.query('INSERT INTO public.personal_document (id,workspace_id,member_id,code,name,body) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),spaces[1].id,accounts[2].id,'foreign-member','No',''])));
      await assert.rejects(db(c=>c.query('INSERT INTO public.personal_document (id,workspace_id,member_id,code,name,body) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),spaces[0].id,accounts[0].id,'no-version','No',''])),'head must have a matching immutable version at commit');
      // Run the exact shipped additive DML against existing OWNER roles, then roll back the test.
      const upgrade=readFileSync(join(repositoryRoot,'apps/api/prisma/migrations/20261106030000_personal_documents/migration.sql'),'utf8').split('-- Add new permissions')[1];
      await db(async c=>{await c.query('BEGIN');try{
        await c.query("DELETE FROM public.client_workspace_role_permission WHERE role_id=$1 AND permission_id IN (SELECT id FROM public.client_workspace_permission WHERE code LIKE 'workspace.documents.%')",[otherRole.id]);
        await c.query('-- Add new permissions'+upgrade);
        assert.equal((await c.query("SELECT count(*)::int AS n FROM public.client_workspace_role_permission rp JOIN public.client_workspace_permission p ON p.id=rp.permission_id WHERE rp.role_id=$1 AND p.code LIKE 'workspace.documents.%'",[otherRole.id])).rows[0].n,2);
        await c.query("UPDATE public.client_workspace_role_permission SET deleted_at=CURRENT_TIMESTAMP WHERE role_id=$1 AND permission_id=$2",[otherRole.id,readPermission.id]);
        await c.query("UPDATE public.client_workspace_permission SET status='disabled' WHERE code='workspace.documents.manage'");
        await c.query('-- Add new permissions'+upgrade);
        assert.ok((await c.query('SELECT deleted_at FROM public.client_workspace_role_permission WHERE role_id=$1 AND permission_id=$2',[otherRole.id,readPermission.id])).rows[0].deleted_at);
        assert.equal((await c.query("SELECT status FROM public.client_workspace_permission WHERE code='workspace.documents.manage'")).rows[0].status,'disabled');
      }finally{await c.query('ROLLBACK');}});
    });
    await sub('strict requests, anonymous/read-only/namespace/origin/size refusals and no-store malformed JSON',async()=>{
      for(const options of [{actor:null,status:401},{actor:2,status:403},{actor:2,workspace:spaces[1].id,status:403},{workspace:null,status:400},{origin:null,status:403},{origin:'https://foreign.example',status:403},{headers:{'sec-fetch-site':'cross-site'},status:403}])await denied(()=>request('POST','',{...options,body:initial}));
      const {JwtService}=require('@nestjs/jwt'),jwt=app.get(JwtService);
      for(const claims of [{sub:admin.id,tokenKind:'admin',projectId:env.PROJECT_ID,environment:'test'},{sub:accounts[0].id,tokenKind:'client',projectId:'foreign-product',environment:'test'}]){const token=await jwt.signAsync(claims);await denied(()=>request('GET','',{actor:null,headers:{authorization:'Bearer '+token},status:401}));}
      for(const field of ['memberId','workspaceId','projectId','organizationId','source','versions','restore','modelCode'])await denied(()=>request('POST','',{body:{...initial,[field]:'forged'},status:400}));
      for(const body of ['a'.repeat(65537),'🙂'.repeat(16385),'\u0000','\u0001','\u007f','\uD800'])await denied(()=>request('POST','',{body:{...initial,body},status:400}));
      for(const name of ['',' space','space ','\n','\u200B','x'.repeat(161)])await denied(()=>request('POST','',{body:{...initial,name},status:400}));
      for(const query of ['?limit=51','?limit=1&limit=2','?afterId=not-uuid','?memberId=forged'])await denied(()=>request('GET',query,{status:400}));
      await denied(async()=>{const r=await fetch(base+route,{method:'POST',headers:{cookie:cookies[0],origin:browserOrigin,'x-aij-workspace-id':spaces[0].id,'content-type':'application/json',connection:'close'},body:'{',signal:AbortSignal.timeout(15000)});assert.equal(r.status,400);assert.match(r.headers.get('cache-control')||'',/no-store/);await r.arrayBuffer();});
      for(const raw of ['{"code":"strict-note","name":"Strict","body":"first","bo\\u0064y":"second"}','{"__proto__":{}}'])await denied(async()=>{const r=await fetch(base+route,{method:'POST',headers:{cookie:cookies[0],origin:browserOrigin,'x-aij-workspace-id':spaces[0].id,'content-type':'application/json',connection:'close'},body:raw,signal:AbortSignal.timeout(15000)});assert.equal(r.status,400);assert.match(r.headers.get('cache-control')||'',/no-store/);await r.arrayBuffer();});
    });
    await sub('no model/key manual edit, immutable versions, replay/CAS/no-op and metadata-only pagination',async()=>{
      assert.equal(await prisma.secretReference.count(),0,'fresh test fixture must not configure a model/key');
      document=await request('POST','',{body:initial,status:201});assert.equal(document.revision,1);assert.equal(document.body,initial.body);
      assert.deepEqual(await request('POST','',{body:initial,status:201}),document);const before=await tableHashes();assert.deepEqual(await request('PATCH','/'+document.id,{body:edit()}),document);assert.deepEqual(await tableHashes(),before);
      document=await request('PATCH','/'+document.id,{body:edit({body:'AF190 second body sentinel'})});assert.equal(document.revision,2);
      assert.deepEqual(await request('POST','',{body:initial,status:201}),document);await denied(()=>request('POST','',{body:{...initial,body:'changed initial'},status:409}));await denied(()=>request('PATCH','/'+document.id,{body:edit(),status:409}));
      for(const options of [{actor:1},{workspace:spaces[1].id}]){assert.equal((await request('GET','',options)).items.length,0);for(const [method,path,body]of [['GET','/'+document.id],['PATCH','/'+document.id,edit()],['DELETE','/'+document.id,{expectedRevision:2}],['GET','/'+document.id+'/versions'],['GET','/'+document.id+'/versions/1']])await denied(()=>request(method,path,{...options,body,status:404}));}
      for(const q of ['', '/versions']){const r=await request('GET',q?'/'+document.id+q+'?limit=1':'?limit=1');for(const item of r.items)assert.equal(Object.hasOwn(item,'body'),false);}
      const history=await request('GET','/'+document.id+'/versions?limit=1');assert.equal(history.items[0].revision,2);assert.equal(history.nextCursor,2);assert.equal((await request('GET','/'+document.id+'/versions?beforeRevision=2')).items[0].revision,1);
      assert.equal((await request('GET','/'+document.id+'/versions/1')).body,initial.body);
      const max=await request('POST','',{body:{code:'exact-64k',name:'UTF8',body:'🙂'.repeat(16384)},status:201});assert.equal(Buffer.byteLength(max.body),65536);await request('POST','',{body:{code:'empty-body',name:'Empty',body:''},status:201});
      const tabs=await request('POST','',{body:{code:'exact-tabs',name:'Tabs',body:'\t'.repeat(65536)},status:201});assert.equal(tabs.body.length,65536,'transport must accept valid decoded body beyond global 100kb wire size');
      const versions=await db(async c=>(await c.query('SELECT * FROM public.personal_document_version WHERE document_id=$1 ORDER BY revision',[document.id])).rows);assert.equal(versions.length,2);assert.equal(versions[0].body,initial.body);
      for(const sql of ['UPDATE public.personal_document_version SET body=body WHERE document_id=$1','DELETE FROM public.personal_document_version WHERE document_id=$1'])await assert.rejects(db(c=>c.query(sql,[document.id])));
      await assert.rejects(db(c=>c.query('TRUNCATE public.personal_document_version')));
      await assert.rejects(db(c=>c.query('INSERT INTO public.personal_document_version (id,document_id,workspace_id,member_id,revision,name,body) VALUES($1,$2,$3,$4,3,$5,$6)',[randomUUID(),document.id,spaces[0].id,accounts[1].id,'forged','forged'])));
    });
    await sub('two real API CAS requests commit once and audit failure rolls back head+history',async()=>{
      const results=await Promise.all(['race-a','race-b'].map((body,i)=>request('PATCH','/'+document.id,{body:edit({expectedRevision:2,body}),status:[200,409],apiBase:i?peerBase:base})));assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);document=results.find(r=>r.status===200).data;
      const before=await tableHashes(),original=service.audit;service.audit=async()=>{throw new Error('AF190 audit body sentinel');};try{await request('PATCH','/'+document.id,{body:edit({expectedRevision:3,body:'AF190 rollback sentinel'}),status:503});assert.deepEqual(await tableHashes(),before);}finally{service.audit=original;}
    });
    await sub('held member/role/plugin row revocations serialize against accepted save and reject subsequent access',async()=>{
      const project=await prisma.projectProfile.findUniqueOrThrow({where:{code:'aij-foundation-test'}}),installation=await prisma.pluginInstallation.findUniqueOrThrow({where:{projectId_pluginCode:{projectId:project.id,pluginCode:'aij-ai'}}});
      for(const [table,id,bad,good,denial]of [['member_user',accounts[0].id,'disabled','active',401],['client_workspace_role',role.id,'disabled','active',403],['plugin_installation',installation.id,'installed','enabled',404]]){
        const entered=deferred(),release=deferred(),pidReady=deferred(),original=service.audit;let pending,revocation;
        service.audit=async(...args)=>{await original.apply(service,args);entered.resolve();await release.promise;};
        try{pending=request('PATCH','/'+document.id,{body:edit({expectedRevision:document.revision,body:'held '+table})});await Promise.race([entered.promise,pending.then(()=>{throw new Error('Save ended before held-scope gate');})]);
          revocation=db(async c=>{await c.query('BEGIN');try{pidReady.resolve((await c.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);await c.query('UPDATE public."'+table+'" SET status=$1 WHERE id=$2',[bad,id]);await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}});
          revocation.catch(()=>{});const pid=await pidReady.promise;let blocked=false;for(let i=0;i<40;i++){blocked=await db(async c=>(await c.query('SELECT cardinality(pg_blocking_pids($1))>0 AS b',[pid])).rows[0].b);if(blocked)break;await pause(25);}assert.equal(blocked,true,table+' revocation must be blocked by held verified scope');release.resolve();document=await pending;await revocation;await denied(()=>request('GET','/'+document.id,{status:denial}));
        }finally{release.resolve();service.audit=original;await pending?.catch(()=>{});await revocation?.catch(()=>{});await db(c=>c.query('UPDATE public."'+table+'" SET status=$1 WHERE id=$2',[good,id]));}
      }
      proof.heldRevocations=true;
    });
    await sub('history cap 200 is atomic, no-op at cap allowed, no prior history deleted',async()=>{
      const capped=await request('POST','',{body:{code:'history-cap',name:'Cap',body:''},status:201});for(let rev=1;rev<200;rev++)await request('PATCH','/'+capped.id,{body:{expectedRevision:rev,name:'Cap',body:'revision '+(rev+1)}});
      const before=await tableHashes();await request('PATCH','/'+capped.id,{body:{expectedRevision:200,name:'Cap',body:'revision 200'}});assert.deepEqual(await tableHashes(),before);
      await denied(()=>request('PATCH','/'+capped.id,{body:{expectedRevision:200,name:'Cap',body:'over cap'},status:409}));assert.equal(await db(async c=>(await c.query('SELECT count(*)::int AS n FROM public.personal_document_version WHERE document_id=$1',[capped.id])).rows[0].n),200);
    });
    await sub('installed packed ESM/CJS SDK success and readonly/foreign/anonymous refusal',async()=>{
      const cr=createRequire(join(consumer,'package.json')),resolved=realpathSync(cr.resolve('@aij/sdk'));assert.ok(resolved.startsWith(consumer+'/node_modules/'),'installed artifact, not symlink/workspace source');
      for(const sdk of [cr('@aij/sdk'),await import(pathToFileURL(join(consumer,'node_modules/@aij/sdk/dist/index.mjs')))]){
        assert.equal(typeof sdk.createPersonalDocumentsClient,'function');const api=sdk.createClientApi(()=>base),client=sdk.createPersonalDocumentsClient((p,o)=>api(p,{...o,headers:{cookie:cookies[0],origin:browserOrigin}}));
        const r=await client.create(spaces[0].id,{code:'packed-'+randomUUID(),name:'Packed',body:'Exact\r\n\t🙂'});assert.equal((await client.getVersion(spaces[0].id,r.id,1)).body,r.body);assert.equal((await client.versions(spaces[0].id,r.id)).items.length,1);assert.ok((await client.list(spaces[0].id,{limit:1})).items.length);
        const changed=await client.update(spaces[0].id,r.id,{expectedRevision:1,name:'Packed',body:'Updated'});assert.equal(changed.revision,2);await assert.rejects(client.update(spaces[0].id,r.id,{expectedRevision:1,name:'Packed',body:'Stale'}),e=>e.status===409);
        for(const [actor,ws,code]of [[null,spaces[0].id,401],[1,spaces[0].id,404],[0,spaces[1].id,404]]){const foreign=sdk.createPersonalDocumentsClient((p,o)=>api(p,{...o,headers:actor===null?{}:{cookie:cookies[actor]}}));await assert.rejects(foreign.get(ws,r.id),e=>e.status===code);}
        const readonly=sdk.createPersonalDocumentsClient((p,o)=>api(p,{...o,headers:{cookie:cookies[2],origin:browserOrigin}}));await assert.rejects(readonly.create(spaces[0].id,{code:'refused',name:'No',body:''}),e=>e.status===403);assert.equal((await client.delete(spaces[0].id,r.id,2)).deleted,true);
      }
    });
    await sub('tombstone hides all content/history, code permanent and no restore',async()=>{
      const history=await request('GET','/'+document.id+'/versions');await request('DELETE','/'+document.id,{body:{expectedRevision:document.revision}});
      for(const path of ['/'+document.id,'/'+document.id+'/versions','/'+document.id+'/versions/1'])await denied(()=>request('GET',path,{status:404}));await denied(()=>request('POST','',{body:initial,status:409}));
      assert.equal(await db(async c=>(await c.query('SELECT count(*)::int AS n FROM public.personal_document_version WHERE document_id=$1',[document.id])).rows[0].n),history.items.length);
      await assert.rejects(db(c=>c.query('UPDATE public.personal_document SET deleted_at=NULL WHERE id=$1',[document.id])));
    });
    await sub('real quota race at 99 active documents yields one commit, no duplicate code or history',async()=>{
      const count=await db(async c=>(await c.query('SELECT count(*)::int AS n FROM public.personal_document WHERE workspace_id=$1 AND member_id=$2 AND deleted_at IS NULL',[spaces[0].id,accounts[0].id])).rows[0].n);
      for(let i=count;i<99;i++)await request('POST','',{body:{code:'quota-'+i,name:'Quota',body:''},status:201});const race=await Promise.all(['quota-final-a','quota-final-b'].map((code,i)=>request('POST','',{body:{code,name:'Quota',body:''},status:[201,409],apiBase:i?peerBase:base})));assert.deepEqual(race.map(r=>r.status).sort(),[201,409]);
    });
    // Production Web + native browser adapter must perform real interactions and return actual artifact paths.
    // It must create in actor1's personal scope (actor0 quota is intentionally full), use wrapper/public SDK and built Web.
    proof.browser=await browser.verifyPersonalDocumentsBrowser({base,leaseId:lease.id,accounts:accounts.map(a=>({id:a.id,email:a.email})),loginCredentials,workspaceId:spaces[0].id,secondWorkspaceId:spaces[1].id,readOnlyRoleId:reader.id,origin:browserOrigin,prisma,request});
    for(const key of ['productionWeb','desktopCreateSaveHistory','mobile390','casConflictDraftRetained','oldScopeFenced','readOnly','unknownReadAck','keyboardLabelsFocus','noPrivateCache'])assert.equal(proof.browser[key],true,'missing native production browser proof: '+key);
    assert.ok(Array.isArray(proof.browser.artifacts)&&proof.browser.artifacts.length>0);for(const p of proof.browser.artifacts)checkedArtifact(p,'browser evidence');
    const final=await tableHashes();for(const table of Object.keys(ledgersBefore).filter(name=>/^(runtime_|ai_agent_run|ai_execution_trace|ai_.*budget|ai_.*usage|file_asset|ai_knowledge|payment_)/.test(name)))assert.equal(final[table],ledgersBefore[table],table+' must not change');
    const audits=await prisma.auditLog.findMany({where:{resourceType:'personal_document'}});for(const a of audits){for(const secret of [initial.name,initial.body,'AF190 second body sentinel','AF190 rollback sentinel'])assert.equal(JSON.stringify(a).includes(secret),false);assert.equal(a.requestSummary,null);assert.deepEqual(Object.keys(a.afterData).sort(),['action','revision']);}
    await db(async c=>{for(const {tablename}of (await c.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT IN ('personal_document','personal_document_version')")).rows){assert.match(tablename,/^[A-Za-z_][A-Za-z0-9_]*$/);for(const r of (await c.query('SELECT row_to_json(t)::text AS row FROM public."'+tablename+'" t')).rows)for(const secret of [initial.name,initial.body,'AF190 second body sentinel','AF190 rollback sentinel'])assert.equal(r.row.includes(secret),false,tablename+' leaked private content');}});
    for(const secret of [initial.name,initial.body,'AF190 second body sentinel','AF190 rollback sentinel'])assert.equal(logs.join('\n').includes(secret),false);assert.equal(upstream,0);proof.upstreamCalls=upstream;proof.executionLedgersUnchanged=true;
    const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
    const sources=['apps/api/src/app.module.ts','apps/api/src/bootstrap.ts','apps/api/src/client-workspaces/client-workspace-permissions.ts','apps/api/prisma/schema.prisma','apps/api/prisma/migrations/20261106030000_personal_documents/migration.sql','apps/web/app/client/documents/page.tsx','apps/web/app/components/client-ai-workbench.tsx','packages/sdk/src/index.ts','packages/sdk/src/personal-documents.ts',...['module','controller','service','dto'].map(n=>'apps/api/src/documents/personal-documents.'+n+'.ts'),...['manager.tsx','access.ts','library.tsx','link.tsx'].map(n=>'apps/web/app/components/client-document-'+n),'scripts/verification/personal-documents.test.mjs',...['live.test.mjs','acceptance.test.mjs','browser.mjs'].map(n=>'scripts/verification/personal-documents-'+n)];
    proof.sourceHashes=Object.fromEntries(sources.map(p=>[p,hash(join(repositoryRoot,p))]));
    const compiled=['apps/api/dist/app.module.js','apps/api/dist/bootstrap.js','apps/api/dist/client-workspaces/client-workspace-permissions.js',...['module','controller','service','dto'].map(n=>'apps/api/dist/documents/personal-documents.'+n+'.js'),...['index.cjs','index.mjs','index.d.ts','index.d.cts','index.d.mts'].map(n=>'packages/sdk/dist/'+n),'apps/web/.next-af190/BUILD_ID',...readdirSync(join(repositoryRoot,'apps/web/.next-af190/static/chunks'),{recursive:true}).filter(p=>p.endsWith('.js')&&!p.startsWith('._')).map(p=>'apps/web/.next-af190/static/chunks/'+p)];
    proof.compiledHashes=Object.fromEntries(compiled.map(p=>[p,hash(join(repositoryRoot,p))]));
    for(const name of ['index.cjs','index.mjs'])assert.equal(hash(join(consumer,'node_modules/@aij/sdk/dist',name)),hash(join(repositoryRoot,'packages/sdk/dist',name)),'installed artifact must be this actual build');
    proof.nativeReceiptHashes=Object.fromEntries(proof.browser.artifacts.map(p=>[p,hash(p)]));
    proof.appliedMigration=await db(async c=>(await c.query("SELECT migration_name,checksum FROM public._prisma_migrations WHERE migration_name='20261106030000_personal_documents' AND finished_at IS NOT NULL AND rolled_back_at IS NULL")).rows[0]);
    assert.equal(proof.appliedMigration.checksum,hash(join(repositoryRoot,'apps/api/prisma/migrations/20261106030000_personal_documents/migration.sql')));proof.status='EVIDENCE_RECORDED_FORMAL_REPORT_IS_AUTHORITY';
  }catch(error){proof.status='FAILED';throw error;}finally{
    try{await nativeHost.close();await peer?.close();await app?.close();proof.applicationPools=await withDatabase('test',readDatabaseEnvironment('test',process.env,lease.id),async c=>(await c.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND backend_type='client backend'")).rows[0].n,{acceptanceId:lease.id});const folder=join(repositoryRoot,'.artifacts/auto-ai-program-20261105/AF-190');mkdirSync(folder,{recursive:true,mode:0o700});const path=join(folder,'live-'+lease.id+'.json');writeFileSync(path,JSON.stringify(proof,null,2)+'\n',{mode:0o600});assert.equal(proof.applicationPools,0);if(proof.status==='EVIDENCE_RECORDED_FORMAL_REPORT_IS_AUTHORITY')writeFileSync(join(folder,'latest-live.json'),JSON.stringify({path,sha256:createHash('sha256').update(readFileSync(path)).digest('hex')})+'\n',{mode:0o600});}
    finally{for(const k of Object.keys(process.env))delete process.env[k];Object.assign(process.env,previous);}
  }
});
