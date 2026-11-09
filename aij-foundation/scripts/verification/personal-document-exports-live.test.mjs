// Root-only real protected PG, production API, original Docker renderer and outside-repo packed SDK.
import assert from 'node:assert/strict';
import test from 'node:test';
import {fork,execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {createServer,request as httpRequest} from 'node:http';
import {once} from 'node:events';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {readFile,writeFile,readdir,realpath} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {createRemainingClientFixture} from './remaining-client-fixture.mjs';
import {withDatabase,readDatabaseEnvironment,repositoryRoot} from '../database/connection.mjs';
const task='AF-202',route='/client/document-exports',image='sha256:b2322ac98afa484dd6722fc3e19775fca9c0bc8e360e9843b9dd0da663a602c1';
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return{promise,resolve};};
const pause=ms=>new Promise(r=>setTimeout(r,ms));const hash=b=>createHash('sha256').update(b).digest('hex');
const nativeFetch=globalThis.fetch;
test('AF202 real document export API, immutable artifact/file relation, current authorization and installed SDK',{timeout:540000},async t=>{
 assert.equal(process.env.AIJ_AF202_ROOT_ACCEPTANCE,'true');assert.equal(process.cwd(),repositoryRoot);
 const consumer=await realpath(process.env.AIJ_AF202_PACKED_CONSUMER);assert.match(consumer,/^\/private\/tmp\/aij-af202-packed-[A-Za-z0-9]+$/);
 const sdk=await import(pathToFileURL(join(consumer,'node_modules/@aij/sdk/dist/index.mjs')));
 const {resolveRuntimeEnvironment,readApplicationEnvironment}=createRequire(import.meta.url)('../runtime-environment.cjs');
 let f,child,disabled,unavailableApp,storage,directory,proxy,releaseHeld;const rows=[],messages=[],cases=[];let failed,peerClosed=false;
 const ownKeys=new Set(),waiters=new Map();
 const message=kind=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>{waiters.delete(kind);reject(Error('AF202_PEER_'+kind));},30000);waiters.set(kind,v=>{clearTimeout(timer);resolve(v);});const stored=messages.findIndex(v=>v.kind===kind);if(stored>=0)waiters.get(kind)(messages.splice(stored,1)[0]);});
 const step=async(name,fn)=>{let error;await t.test(name,async()=>{try{await fn();cases.push({name,status:'PASS'});}catch(e){error=e;cases.push({name,status:'FAIL'});throw e;}});if(error)throw error;};
 try{
  const inspect=JSON.parse(execFileSync('/usr/local/bin/docker',['image','inspect',image],{encoding:'utf8'}));assert.equal(inspect[0].Id,image);assert.equal(inspect[0].Os,'linux');
  f=await createRemainingClientFixture(task,{workbenchTargetSafety:true,storageEnabled:true,documentExport:{approvedImage:image,dockerCliPath:'/usr/local/bin/docker'}});
  const {ConfigService}=createRequire(join(repositoryRoot,'apps/api/package.json'))('@nestjs/config');
  const {GeneratedFileAssetsService}=f.requireApi('files/generated-file-assets.service.js');const files=f.app.get(GeneratedFileAssetsService);
  const {LocalStorageAdapter}=f.requireApi('files/local-storage.adapter.js');storage=f.app.get(LocalStorageAdapter);directory=f.app.get(ConfigService).getOrThrow('storageRoot');
  const {PersonalDocumentsService}=f.requireApi('documents/personal-documents.service.js'),documents=f.app.get(PersonalDocumentsService);
  const {PersonalDocumentExportsService}=f.requireApi('documents/personal-document-exports.service.js'),exports=f.app.get(PersonalDocumentExportsService);
  const {DocumentExportProfile}=f.requireApi('documents/document-export-profile.js');assert.equal(f.app.get(DocumentExportProfile).configured,true);
  const member=f.accounts[0].id,workspace=f.workspaces[0].id,origin=process.env.WEB_URL;
  const db=fn=>withDatabase('test',readDatabaseEnvironment('test',process.env,f.lease.id),fn,{acceptanceId:f.lease.id});
  const counters=async()=>[await f.prisma.aiAgentRun.count(),await f.prisma.runtimeJob.count(),await f.prisma.aiExecutionTrace.count()];const before=await counters();
  const objects=async()=>(await readdir(join(directory,'objects')).catch(e=>{if(e.code==='ENOENT')return[];throw e;})).filter(n=>!n.startsWith('._'));
  const originalStage=files.stage.bind(files);let held;
  files.stage=async(...args)=>{const ticket=await originalStage(...args);if(held){const gate=held;held=undefined;gate.ready.resolve();await gate.release.promise;}return ticket;};
  const hold=()=>{const gate={ready:deferred(),release:deferred()};held=gate;releaseHeld=()=>gate.release.resolve();return gate;};
  const req=async(method,path='',{body,raw,actor=0,space=workspace,status=200,base=f.baseUrl,requestOrigin=origin,headers={}}={})=>{
   const r=await nativeFetch(base+route+path,{method,headers:{connection:'close',...(actor===null?{}:{cookie:f.cookies[actor]}),...(space?{'x-aij-workspace-id':space}:{}),...(requestOrigin?{origin:requestOrigin}:{}),...(body===undefined&&raw===undefined?{}:{'content-type':'application/json'}),...headers},body:raw??(body===undefined?undefined:JSON.stringify(body)),signal:AbortSignal.timeout(45000)});
   const bytes=Buffer.from(await r.arrayBuffer());assert.equal(r.status,status,method+' '+path+' '+bytes.toString().slice(0,350));assert.equal(r.headers.get('cache-control'),'private, no-store');assert.equal(r.headers.get('x-content-type-options'),'nosniff');
   if(status>=400)for(const key of ['x-aij-document-id','x-aij-export-id','x-aij-checksum-sha256','content-disposition'])assert.equal(r.headers.get(key),null);
   return{response:r,bytes,data:r.headers.get('content-type')?.includes('json')?JSON.parse(bytes.toString()).data:undefined};
  };
  const createDoc=async(label='document')=>documents.create(member,workspace,{code:'af202-'+randomUUID(),name:'导出验证 '+label,body:'自有合成中文正文\n\n真实附件、权限与下载验证。\nEnd'});
  const input=(d,format='pdf')=>({documentId:d.id,expectedRevision:d.revision,format});
  const assertNoNew=async(fn)=>{const n=await f.prisma.personalDocumentExport.count(),a=await f.prisma.fileAsset.count(),audit=await f.prisma.auditLog.count({where:{action:'personal_document_exported'}});await fn();assert.equal(await f.prisma.personalDocumentExport.count(),n);assert.equal(await f.prisma.fileAsset.count(),a);assert.equal(await f.prisma.auditLog.count({where:{action:'personal_document_exported'}}),audit);};
  let d,pdf,docx;
  await step('strict default-off configuration, real disabled capability and parser/CSRF/auth refusal without writes',async()=>{
   const base=readApplicationEnvironment(process.env);for(const key of ['AIJ_DOCUMENT_EXPORT_ENABLED','AIJ_DOCUMENT_EXPORT_IMAGE_ID','AIJ_DOCUMENT_EXPORT_DOCKER_CLI'])delete base[key];assert.equal(resolveRuntimeEnvironment(base).documentExport.enabled,false);
   for(const patch of [{AIJ_DOCUMENT_EXPORT_ENABLED:'1'},{AIJ_DOCUMENT_EXPORT_ENABLED:'true'},{AIJ_DOCUMENT_EXPORT_DOCKER_CLI:'relative/docker'},{AIJ_DOCUMENT_EXPORT_DOCKER_CLI:'/tmp/../docker'},{AIJ_DOCUMENT_EXPORT_DOCKER_CLI:'/tmp/docker\n'},{AIJ_DOCUMENT_EXPORT_IMAGE_ID:'latest'},{AIJ_DOCUMENT_EXPORT_ENABLED:'true',AIJ_DOCUMENT_EXPORT_IMAGE_ID:image,AIJ_DOCUMENT_EXPORT_DOCKER_CLI:'/usr/local/bin/docker',STORAGE_ENABLED:'false'}])assert.throws(()=>resolveRuntimeEnvironment({...base,...patch}));
   const enabled=process.env.AIJ_DOCUMENT_EXPORT_ENABLED;process.env.AIJ_DOCUMENT_EXPORT_ENABLED='false';try{disabled=await f.requireApi('bootstrap.js').createApplication();await disabled.listen(0,'127.0.0.1');}finally{process.env.AIJ_DOCUMENT_EXPORT_ENABLED=enabled;}
   const disabledBase='http://127.0.0.1:'+disabled.getHttpServer().address().port+'/api';
   assert.deepEqual((await req('GET','/capability',{base:disabledBase})).data,{configured:false,canExport:false,reason:'not_configured'});
   d=await createDoc('PDF and Word');
   await assertNoNew(async()=>{await req('POST','',{base:disabledBase,body:input(d),status:503});await req('POST','',{body:input(d),actor:null,status:401});await req('POST','',{body:input(d),requestOrigin:'https://foreign.invalid',status:403});await req('POST','',{body:{...input(d),unexpected:true},status:400});await req('POST','',{raw:'{"documentId":"'+d.id+'","expectedRevision":1,"format":"pdf","format":"docx"}',status:400});await req('GET','?documentId='+d.id+'&revision=1&extra=1',{status:400});});
   const cli=process.env.AIJ_DOCUMENT_EXPORT_DOCKER_CLI;process.env.AIJ_DOCUMENT_EXPORT_DOCKER_CLI='/private/tmp/aij-af202-unavailable-cli';try{unavailableApp=await f.requireApi('bootstrap.js').createApplication();await unavailableApp.listen(0,'127.0.0.1');}finally{process.env.AIJ_DOCUMENT_EXPORT_DOCKER_CLI=cli;}
   await assertNoNew(async()=>req('POST','',{base:'http://127.0.0.1:'+unavailableApp.getHttpServer().address().port+'/api',body:input(d),status:503}));
   unavailableApp.getHttpServer().closeAllConnections();await unavailableApp.close();unavailableApp=undefined;
   assert.deepEqual((await req('GET','/capability')).data,{configured:true,canExport:true,reason:'ready'});
  });
  await step('real Linux renders both formats through HTTP and original private FileAsset, public installed SDK checks full bytes',async()=>{
   let fetches=0;globalThis.fetch=(url,options={})=>{fetches++;const headers=new Headers(options.headers);headers.set('cookie',f.cookies[0]);headers.set('origin',origin);headers.set('connection','close');assert.equal('workspaceId' in options,false);assert.equal('responseKind' in options,false);assert.equal('maxResponseBytes' in options,false);assert.equal(options.credentials,'include');assert.equal(options.cache,'no-store');return nativeFetch(url,{...options,headers});};
   const client=sdk.createPersonalDocumentExportsClient(sdk.createClientApi(()=>f.baseUrl));
   try{for(const format of ['pdf','docx']){const meta=await client.create(workspace,input(d,format));const downloaded=await client.download(workspace,meta);assert.equal(hash(downloaded.bytes),meta.checksum);assert.equal(downloaded.bytes.length,meta.size);assert.match(Buffer.from(downloaded.bytes).subarray(0,5).toString(),format==='pdf'?/^%PDF-/:/^PK/);downloaded.bytes.fill(0);assert.equal((await client.get(workspace,meta.id)).id,meta.id);if(format==='pdf')pdf=meta;else docx=meta;rows.push(meta);}}
   finally{globalThis.fetch=nativeFetch;}assert.equal(fetches,6);
   assert.equal((await req('GET','?documentId='+d.id+'&revision=1')).data.items.length,2);
   for(const m of [pdf,docx]){const relation=await f.prisma.personalDocumentExport.findUniqueOrThrow({where:{id:m.id}});const a=await f.prisma.fileAsset.findUniqueOrThrow({where:{id:relation.fileAssetId}});assert.equal(a.projectId,f.project.id);assert.notEqual(a.projectId,'aij-foundation');for(const [key,value]of Object.entries({workspaceId:workspace,ownerId:member,uploaderId:member,pluginCode:'aij-ai',storageType:'local'}))assert.equal(a[key],value);ownKeys.add(a.objectKey);assert.equal(hash(await storage.read(a.objectKey)),m.checksum);assert.equal(a.url,'/api/client/document-exports/'+m.id+'/content');}
   await assertNoNew(async()=>assert.equal((await req('POST','',{body:input(d),status:201})).data.id,pdf.id));
   const r=await req('GET','/'+pdf.id+'/content');assert.equal(hash(r.bytes),pdf.checksum);assert.equal(r.response.headers.get('access-control-allow-origin'),origin);assert.equal(r.response.headers.get('access-control-allow-credentials'),'true');const exposed=r.response.headers.get('access-control-expose-headers').toLowerCase().split(',');for(const h of ['content-disposition','x-content-type-options','x-aij-document-id','x-aij-document-revision','x-aij-export-id','x-aij-checksum-sha256','x-aij-renderer-version'])assert.ok(exposed.includes(h));
  });
  await step('database unique/FK/version/owner and immutable UPDATE DELETE TRUNCATE guards, additive permission does not reactivate',async()=>{
   await db(async c=>{
    for(const sql of ['UPDATE public.personal_document_export SET page_count=page_count WHERE id=$1','DELETE FROM public.personal_document_export WHERE id=$1','TRUNCATE public.personal_document_export'])await assert.rejects(c.query(sql,sql.includes('$1')?[pdf.id]:[]),e=>e.code==='23514');
    const select='INSERT INTO public.personal_document_export(id,document_id,workspace_id,member_id,project_id,revision,file_asset_id,format,renderer_version,page_count) SELECT $1,document_id,workspace_id,member_id,project_id,revision,file_asset_id,format,renderer_version,page_count FROM public.personal_document_export WHERE id=$2';await assert.rejects(c.query(select,[randomUUID(),pdf.id]),e=>e.code==='23505');
    for(const [field,value]of [['document_id',randomUUID()],['revision',199],['workspace_id',f.workspaces[1].id],['file_asset_id','missing']]){const fields=['document_id','workspace_id','member_id','project_id','revision','file_asset_id','format','renderer_version','page_count'];const expressions=fields.map(k=>k===field?'$3':k);await assert.rejects(c.query('INSERT INTO public.personal_document_export(id,'+fields.join(',')+') SELECT $1,'+expressions.join(',')+' FROM public.personal_document_export WHERE id=$2',[randomUUID(),pdf.id,value]),e=>['23503','23505'].includes(e.code));}
    const upgrade=(await readFile(join(repositoryRoot,'apps/api/prisma/migrations/20261107010000_personal_document_exports/migration.sql'),'utf8')).split('-- Incremental export permission')[1];await c.query('BEGIN');try{await c.query("UPDATE public.client_workspace_permission SET status='disabled' WHERE code='workspace.documents.export'");await c.query('-- Incremental export permission'+upgrade);assert.equal((await c.query("SELECT status FROM public.client_workspace_permission WHERE code='workspace.documents.export'")).rows[0].status,'disabled');await c.query("UPDATE public.client_workspace_role_permission SET deleted_at=CURRENT_TIMESTAMP WHERE permission_id IN (SELECT id FROM public.client_workspace_permission WHERE code='workspace.documents.export')");await c.query('-- Incremental export permission'+upgrade);assert.equal((await c.query("SELECT count(*)::int AS n FROM public.client_workspace_role_permission WHERE permission_id IN (SELECT id FROM public.client_workspace_permission WHERE code='workspace.documents.export') AND deleted_at IS NULL")).rows[0].n,0);}finally{await c.query('ROLLBACK');}
   });
  });
  await step('two independent API OS processes render concurrently, unique tuple commits once and losing object removed',async()=>{
   child=fork(join(repositoryRoot,'scripts/verification/personal-document-exports-peer.mjs'),[],{cwd:repositoryRoot,env:{...process.env,AIJ_AF202_ROOT_PEER:'true'},stdio:['ignore','ignore','pipe','ipc']});let stderr='';child.stderr.on('data',b=>{stderr+=b.toString();assert.ok(stderr.length<65536);});child.on('message',v=>{const receiver=waiters.get(v.kind);if(receiver){waiters.delete(v.kind);receiver(v);}else messages.push(v);});
   const ready=await message('ready');assert.equal(ready.pid,child.pid);assert.notEqual(ready.pid,process.pid);const peerBase='http://127.0.0.1:'+ready.port+'/api';const doc=await createDoc('concurrent'),gate=hold();child.send({kind:'arm'});await message('armed');
   const a=req('POST','',{body:input(doc),status:201}),b=req('POST','',{body:input(doc),base:peerBase,status:201});
   try{await Promise.all([gate.ready.promise,message('staged')]);}finally{gate.release.resolve();child.send({kind:'release'});}
   const [one,two]=await Promise.all([a,b]);assert.equal(one.data.id,two.data.id);assert.equal(await f.prisma.personalDocumentExport.count({where:{documentId:doc.id}}),1);assert.equal(await f.prisma.auditLog.count({where:{action:'personal_document_exported',afterData:{path:['documentId'],equals:doc.id}}}),1);assert.equal((await objects()).length,await f.prisma.fileAsset.count());
   child.send({kind:'close'});const closed=await message('closed');assert.equal(closed.listening,false);const exit=await once(child,'exit');assert.equal(exit[0],0);peerClosed=true;assert.equal(stderr,'');
  });
  await step('real document revision edit while rendered file is held refuses stale commit and preserves latest text',async()=>{
   const doc=await createDoc('revision fence'),gate=hold();const pending=req('POST','',{body:input(doc),status:409});await gate.ready.promise;try{await documents.update(member,workspace,doc.id,{expectedRevision:1,name:doc.name,body:'已保存新版本'});}finally{gate.release.resolve();}await pending;assert.equal(await f.prisma.personalDocumentExport.count({where:{documentId:doc.id}}),0);assert.equal((await documents.get(member,workspace,doc.id)).body,'已保存新版本');
  });
  await step('current export grant, membership and plugin revocation after actual render refuse commit and clean owned stage',async()=>{
   const permission=await f.prisma.clientWorkspacePermission.findUniqueOrThrow({where:{code:'workspace.documents.export'}});const membership=await f.prisma.clientWorkspaceMembership.findUniqueOrThrow({where:{workspaceId_memberId:{workspaceId:workspace,memberId:member}}});
   const grant=await f.prisma.clientWorkspaceRolePermission.findUniqueOrThrow({where:{roleId_permissionId:{roleId:membership.roleId,permissionId:permission.id}}});
   for(const mode of ['grant','membership','plugin','session','tokenVersion']){const doc=await createDoc(mode),gate=hold(),pending=req('POST','',{body:input(doc),status:mode==='plugin'?404:['session','tokenVersion'].includes(mode)?401:403});await gate.ready.promise;try{
    if(mode==='grant')await f.prisma.clientWorkspaceRolePermission.update({where:{id:grant.id},data:{deletedAt:new Date()}});if(mode==='membership')await f.prisma.clientWorkspaceMembership.update({where:{id:membership.id},data:{status:'disabled'}});if(mode==='plugin')await f.prisma.pluginInstallation.update({where:{projectId_pluginCode:{projectId:f.project.id,pluginCode:'aij-ai'}},data:{status:'installed'}});if(mode==='session')await f.prisma.clientAuthSession.updateMany({where:{memberId:member,revokedAt:null},data:{revokedAt:new Date()}});if(mode==='tokenVersion')await f.prisma.memberUser.update({where:{id:member},data:{tokenVersion:{increment:1}}});
   }finally{gate.release.resolve();}
   try{await pending;assert.equal(await f.prisma.personalDocumentExport.count({where:{documentId:doc.id}}),0);}finally{if(mode==='grant')await f.prisma.clientWorkspaceRolePermission.update({where:{id:grant.id},data:{deletedAt:null}});if(mode==='membership')await f.prisma.clientWorkspaceMembership.update({where:{id:membership.id},data:{status:membership.status}});if(mode==='plugin')await f.prisma.pluginInstallation.update({where:{projectId_pluginCode:{projectId:f.project.id,pluginCode:'aij-ai'}},data:{status:'enabled'}});if(['session','tokenVersion'].includes(mode)){const secrets=JSON.parse(await readFile(f.accounts[0].initialPasswordFile,'utf8'));const password=secrets.accounts.find(a=>a.id===member).password;const login=await nativeFetch(f.baseUrl+'/client/auth/login',{method:'POST',headers:{origin,'content-type':'application/json',connection:'close'},body:JSON.stringify({email:f.accounts[0].email,password}),signal:AbortSignal.timeout(15000)});assert.equal(login.status,200);f.cookies[0]=login.headers.get('set-cookie').split(';')[0];await login.arrayBuffer();}}}
   assert.equal((await objects()).length,await f.prisma.fileAsset.count());
  });
  await step('real audit INSERT trigger failure rolls back relation and FileAsset and removes staged object',async()=>{
   const doc=await createDoc('audit rollback');await db(async c=>{await c.query("CREATE FUNCTION public.aij_af202_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='personal_document_exported' THEN RAISE EXCEPTION 'AF202_EXPECTED_AUDIT'; END IF; RETURN NEW; END $$");await c.query('CREATE TRIGGER aij_af202_audit_failure BEFORE INSERT ON public.audit_log FOR EACH ROW EXECUTE FUNCTION public.aij_af202_audit_failure()');});
   try{await assertNoNew(async()=>req('POST','',{body:input(doc),status:503}));assert.equal((await objects()).length,await f.prisma.fileAsset.count());}finally{await db(async c=>{await c.query('DROP TRIGGER aij_af202_audit_failure ON public.audit_log');await c.query('DROP FUNCTION public.aij_af202_audit_failure()');});}
  });
  await step('actual aborted HTTP response before commit is observed by controller; completed renderer buffer/stage is discarded',async()=>{
   const doc=await createDoc('abort'),gate=hold(),controller=new AbortController(),done=deferred();const create=exports.create.bind(exports);exports.create=(...args)=>create(...args).finally(()=>done.resolve());
   const pending=nativeFetch(f.baseUrl+route,{method:'POST',headers:{cookie:f.cookies[0],origin,'x-aij-workspace-id':workspace,'content-type':'application/json',connection:'close'},body:JSON.stringify(input(doc)),signal:controller.signal});const refused=assert.rejects(pending);await gate.ready.promise;
   try{controller.abort();await refused;await pause(100);}finally{gate.release.resolve();}await done.promise;exports.create=create;
   assert.equal(await f.prisma.personalDocumentExport.count({where:{documentId:doc.id}}),0);assert.equal((await objects()).length,await f.prisma.fileAsset.count());
  });
  await step('actual response lost after commit: installed SDK sends one POST, explicit GET recovers original artifact',async()=>{
   const doc=await createDoc('lost return');let posts=0;
   proxy=createServer((request,response)=>{const upstream=httpRequest(f.baseUrl+request.url,{method:request.method,headers:request.headers},up=>{const chunks=[];up.on('data',b=>chunks.push(b));up.on('end',()=>{if(request.method==='POST'){posts++;response.destroy();}else{response.writeHead(up.statusCode,up.headers);response.end(Buffer.concat(chunks));}});});upstream.on('error',()=>response.destroy());request.pipe(upstream);});await new Promise(r=>proxy.listen(0,'127.0.0.1',r));
   globalThis.fetch=(url,options={})=>{const headers=new Headers(options.headers);headers.set('cookie',f.cookies[0]);headers.set('origin',origin);headers.set('connection','close');return nativeFetch(url,{...options,headers});};
   try{const client=sdk.createPersonalDocumentExportsClient(sdk.createClientApi(()=> 'http://127.0.0.1:'+proxy.address().port));await assert.rejects(client.create(workspace,input(doc)));assert.equal(posts,1);const found=await client.list(workspace,{documentId:doc.id,revision:1});assert.equal(found.items.length,1);assert.equal(await f.prisma.personalDocumentExport.count({where:{documentId:doc.id}}),1);assert.equal(await f.prisma.auditLog.count({where:{action:'personal_document_exported',resourceId:found.items[0].id}}),1);assert.equal(posts,1);}finally{globalThis.fetch=nativeFetch;proxy.closeAllConnections();await new Promise(r=>proxy.close(r));proxy=undefined;}
  });
  await step('old versions remain readable with current access, foreign owner/scope, file corruption, deletion and revoked session refuse',async()=>{
   await documents.update(member,workspace,d.id,{expectedRevision:1,name:d.name,body:'第二版本正文'});assert.equal(hash((await req('GET','/'+pdf.id+'/content')).bytes),pdf.checksum);assert.equal((await req('GET','?documentId='+d.id+'&revision=1')).data.items.length,2);
   await assertNoNew(async()=>{await req('GET','/'+pdf.id,{actor:1,space:f.workspaces[1].id,status:404});await req('GET','/'+pdf.id,{space:f.workspaces[1].id,status:403});});
   const file=await f.prisma.fileAsset.findFirstOrThrow({where:{url:'/api/client/document-exports/'+pdf.id+'/content'}}),actual=await storage.read(file.objectKey);await writeFile(join(directory,'objects',file.objectKey),'OWNED_CORRUPTION');try{await req('GET','/'+pdf.id+'/content',{status:503});}finally{await writeFile(join(directory,'objects',file.objectKey),actual);}await documents.delete(member,workspace,d.id,{expectedRevision:2});await req('GET','/'+pdf.id,{status:404});
   await f.prisma.clientAuthSession.updateMany({where:{memberId:member,revokedAt:null},data:{revokedAt:new Date()}});await req('GET','/capability',{status:401});
  });
  assert.deepEqual(await counters(),before);assert.equal(cases.length,10);
  await writeFile(join(f.artifactDirectory,'document-exports-evidence.json'),JSON.stringify({status:'PASS',task,acceptanceId:f.lease.id,cases,peerPid:child.pid,peerClosed,packedSdk:true,image,fullTargetAcceptance:false,vendor:'DEFERRED_NOT_PASSED',browserCors:'HTTP headers only; actual browser is AF203'},null,2));
 }catch(error){failed=error;}
 finally{
  globalThis.fetch=nativeFetch;releaseHeld?.();
  const cleanup=[];if(proxy){try{proxy.closeAllConnections();await new Promise(r=>proxy.close(r));}catch(e){cleanup.push(e);}}
  if(child&&!peerClosed){try{child.send({kind:'close'});await Promise.race([once(child,'exit'),pause(10000).then(()=>{throw Error('AF202_PEER_NOT_CLOSED');})]);peerClosed=true;}catch(e){cleanup.push(e);}}
  if(unavailableApp){try{unavailableApp.getHttpServer().closeAllConnections();await unavailableApp.close();}catch(e){cleanup.push(e);}}
  if(disabled){try{disabled.getHttpServer().closeAllConnections();await disabled.close();assert.equal(disabled.getHttpServer().listening,false);}catch(e){cleanup.push(e);}}
  if(f&&storage){try{for(const name of(await readdir(join(directory,'objects')).catch(()=>[])).filter(n=>!n.startsWith('._'))){assert.match(name,/^[a-f0-9-]{36}$/);ownKeys.add(name);await storage.remove(name);}assert.equal((await readdir(join(directory,'objects')).catch(e=>{if(e.code==='ENOENT')return[];throw e;})).filter(n=>!n.startsWith('._')).length,0);}catch(e){cleanup.push(e);}}
  if(f){try{await f.close();assert.equal(f.closure().applicationPools,0);assert.equal(f.closure().ownedSockets,0);}catch(e){cleanup.push(e);}await writeFile(join(f.artifactDirectory,'document-exports-close.json'),JSON.stringify({status:failed||cleanup.length?'FAILED':'CLOSED',peerClosed,ownObjectsRemoved:ownKeys.size,closure:f.closure(),cleanupErrors:cleanup.map(e=>e.message)},null,2));console.log(JSON.stringify({task,evidenceDirectory:f.artifactDirectory,peerClosed,ownObjectsRemoved:ownKeys.size,cleanupErrors:cleanup.length}));}
  if(cleanup.length)failed=new AggregateError([...(failed?[failed]:[]),...cleanup],'AF202_CLEANUP_FAILED');
 }
 if(failed)throw failed;
});
