// Actual candidate sources with small in-memory collaborators. NOT PG/HTTP/Docker acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createHash, webcrypto } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ts from 'typescript';
import { EventEmitter } from 'node:events';
const require = createRequire(new URL('../../apps/api/package.json', import.meta.url));
require('ts-node').register({project:fileURLToPath(new URL('../../apps/api/tsconfig.json',import.meta.url)),transpileOnly:true,moduleTypes:{'**/packages/sdk/src/**':'cjs'}});
require('reflect-metadata');
const {PersonalDocumentExportsService}=require('../../apps/api/src/documents/personal-document-exports.service.ts');
const {PersonalDocumentExportsController}=require('../../apps/api/src/documents/personal-document-exports.controller.ts');
const {DocumentExportProfile}=require('../../apps/api/src/documents/document-export-profile.ts');
const {createDocumentExportDto,listDocumentExportsDto}=require('../../apps/api/src/documents/personal-document-exports.dto.ts');
const scratch=mkdtempSync(join(tmpdir(),'aij-af202-'));
process.on('exit',()=>rmSync(scratch,{recursive:true,force:true}));
for(const stem of ['client-binary-response','personal-document-exports'])for(const [module,ext] of [[ts.ModuleKind.CommonJS,'cjs'],[ts.ModuleKind.ES2022,'mjs']]){
 const source=readFileSync(new URL('../../packages/sdk/src/'+stem+'.ts',import.meta.url),'utf8').replaceAll("'./client-binary-response.js'", "'./client-binary-response."+ext+"'");
 writeFileSync(join(scratch,stem+'.'+ext),ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module,strict:true}}).outputText);
}
const {createPersonalDocumentExportsClient,parseDocumentExportMeta}=require(join(scratch,'personal-document-exports.cjs'));
const {readClientBinaryResponse}=require(join(scratch,'client-binary-response.cjs'));
const {ForbiddenException,ConflictException,NotFoundException,UnauthorizedException}=require('@nestjs/common');
const id='12345678-1234-4234-8234-123456789abc';
const input={documentId:id,expectedRevision:1,format:'pdf'};
const bytes=Buffer.from('%PDF-actual-collaborator-bytes');
const checksum=createHash('sha256').update(bytes).digest('hex');
const status=n=>e=>e.getStatus?.()===n;
function fixture(){
 const f={rows:[],assets:new Map(),stages:new Map(),audits:[],revision:1,permitted:true,deleted:false,active:0,renders:0,discard:0,unknown:false,auditFail:false,dbUnknown:false};
 let chain=Promise.resolve();
 const query=async (strings,...v)=>{const q=strings.join('?');
  if(q.startsWith('INSERT')){const [rid,did,w,m,p,r,a,fmt,version,pages]=v;const row={id:rid,document_id:did,workspace_id:w,member_id:m,project_id:p,revision:r,file_asset_id:a,format:fmt,renderer_version:version,page_count:pages,created_at:new Date('2026-11-07T00:00:00.000Z')};f.rows.push(row);return[row];}
  if(q.includes('WHERE document_id='))return f.rows.filter(r=>r.document_id===v[0]&&r.revision===v[1]&&(q.includes('AND format=')?r.format===v[2]:true));
  if(q.includes('WHERE id='))return f.rows.filter(r=>r.id===v[0]&&r.workspace_id===(v.length===4?v[2]:v[1])&&r.member_id===(v.length===4?v[3]:v[2]));
  throw Error('Unexpected query');};
 const tx={$queryRaw:query,auditLog:{create:async({data})=>{if(f.auditFail)throw Error('audit');f.audits.push(data);}}};
 const documents={exportCapability:async(_m,_w,c)=>({configured:c,canExport:c&&f.permitted,reason:!f.permitted?'not_permitted':c?'ready':'not_configured'}),withCurrentDocument:(_m,_w,d,r,fn)=>{
  const work=chain.then(async()=>{if(f.dbUnknown)throw Error('database unknown');if(!f.permitted)throw new ForbiddenException();if(f.deleted||d!==id)throw new NotFoundException();if(r!==undefined&&r!==f.revision)throw new ConflictException();
   const prior={rows:[...f.rows],assets:new Map(f.assets),audits:[...f.audits]}; f.active++;
   let result;try{result=await fn(tx,{id,name:'Private name',body:'Private body',revision:f.revision},'project');}catch(e){Object.assign(f,prior);throw e;}finally{f.active--;}
   if(f.unknown&&f.rows.length){f.unknown=false;f.afterUnknown?.();throw Error('lost commit acknowledgement');}return result;});chain=work.catch(()=>{});return work;}};
 const files={stage:async(scope,spec)=>{const ticket={assetId:'asset-'+f.stages.size};f.stages.set(ticket,{...spec,bytes:Buffer.from(spec.bytes),size:spec.bytes.length});await f.onStage?.();return ticket;},
  commitInTransaction:async(_tx,t)=>{f.assets.set(t.assetId,f.stages.get(t));},confirm:async t=>{assert.ok(f.assets.has(t.assetId));f.stages.delete(t);},discard:async t=>{f.discard++;if(f.dbUnknown||f.discardUnknown)throw Error('unknown');if(f.assets.has(t.assetId))return{removed:false,retainedBecauseCommitted:true};f.stages.delete(t);return{removed:true,retainedBecauseCommitted:false};},
  readInTransaction:async(_tx,a,scope)=>{assert.equal(scope.workspaceId,'space');const c=f.assets.get(a);if(!c)throw new NotFoundException();return {...c,bytes:Buffer.from(c.bytes)};}};
 const executor={run:async({signal})=>{assert.equal(f.active,0);f.renders++;const returnedBytes=Buffer.from(bytes);f.returnedBytes=returnedBytes;await f.during?.(signal);return {outcome:f.outcome??'SUCCESS',cleanupConfirmed:f.cleanupConfirmed??true,artifact:{bytes:returnedBytes,format:'pdf',mimeType:'application/pdf',size:bytes.length,sha256:checksum,pageCount:1,rendererVersion:'aij-plain-document-v1'}};}};
 f.tx=tx;
 f.service=new PersonalDocumentExportsService({$queryRaw:query},documents,files,new DocumentExportProfile(executor,true));return f;
}
test('DTO rejects unknown fields, wrong revisions and duplicate query arrays',()=>{
 assert.deepEqual(createDocumentExportDto(input),input);
 for(const b of [{...input,ownerId:'other'},{...input,expectedRevision:'1'},{...input,expectedRevision:201},{...input,format:'html'}])assert.throws(()=>createDocumentExportDto(b),status(400));
 assert.throws(()=>listDocumentExportsDto({documentId:id,revision:['1','2']}),status(400));
});
test('default profile is disabled and uses actual executor safe refusal',async()=>{const p=new DocumentExportProfile();assert.equal(p.configured,false);assert.equal((await p.executor.run({input:{}})).outcome,'DISABLED');});
test('render occurs outside transactions, persisted tuple reused, private metadata exact',async()=>{const f=fixture();const m=await f.service.create('member','space',input);assert.equal(m.checksum,checksum);assert.equal(f.audits.length,1);assert.equal(await f.service.create('member','space',input).then(r=>r.id),m.id);assert.equal(f.renders,1);assert.equal(f.assets.size,1);assert.equal('body' in m,false);assert.deepEqual((await f.service.list('member','space',{documentId:id,revision:'1'})).items,[m]);});
test('concurrent same tuple has one relation, file and audit; loser stage cleaned',async()=>{const f=fixture();let release;const gate=new Promise(r=>release=r);f.during=async()=>{if(f.renders===2)release();await gate;};const [a,b]=await Promise.all([f.service.create('member','space',input),f.service.create('member','space',input)]);assert.equal(a.id,b.id);assert.equal(f.rows.length,1);assert.equal(f.assets.size,1);assert.equal(f.audits.length,1);assert.equal(f.discard,1);});
test('revision change/revocation/deletion during renderer refuses and discards stage',async()=>{for(const mutate of [f=>f.revision++,f=>f.permitted=false,f=>f.deleted=true]){const f=fixture();f.during=()=>mutate(f);await assert.rejects(f.service.create('member','space',input));assert.equal(f.rows.length,0);assert.equal(f.assets.size,0);assert.equal(f.stages.size,0);}});
test('audit failure rolls back both relation/file metadata and cleans stage',async()=>{const f=fixture();f.auditFail=true;await assert.rejects(f.service.create('member','space',input),status(503));assert.equal(f.rows.length,0);assert.equal(f.assets.size,0);assert.equal(f.stages.size,0);});
test('lost commit response recovers exact id/asset without duplicate audit',async()=>{const f=fixture();f.unknown=true;const m=await f.service.create('member','space',input);assert.equal(m.id,f.rows[0].id);assert.equal(f.assets.size,1);assert.equal(f.audits.length,1);assert.equal(f.discard,0);});
test('unknown database retains staged bytes and returns safe unavailable',async()=>{const f=fixture();f.during=()=>{f.dbUnknown=true;};await assert.rejects(f.service.create('member','space',input),status(503));assert.equal(f.stages.size,1);});
test('old export readable after revision change but current permission/deletion deny',async()=>{const f=fixture();const m=await f.service.create('member','space',input);f.revision=2;assert.equal((await f.service.get('member','space',m.id,true)).content.checksum,checksum);f.permitted=false;await assert.rejects(f.service.get('member','space',m.id),status(403));f.permitted=true;f.deleted=true;await assert.rejects(f.service.get('member','space',m.id),status(404));});
test('controller cancellation listens to premature response close, not normal request close',async()=>{const req=new EventEmitter();Object.assign(req,{client:{id:'member'},workspaceContext:{workspaceId:'space'},headers:{origin:'http://local'}});const res=new EventEmitter();res.writableFinished=false;const controller=new PersonalDocumentExportsController({create:async(_m,_w,_b,s)=>{req.emit('close');assert.equal(s.aborted,false);res.emit('close');assert.equal(s.aborted,true);}}, {getOrThrow:()=> 'http://local'});await controller.create(req,res,input,{});assert.equal(res.listenerCount('close'),0);});
function meta(){return {id,documentId:id,revision:1,format:'pdf',mimeType:'application/pdf',size:bytes.length,checksum,rendererVersion:'aij-plain-document-v1',pageCount:1,createdAt:'2026-11-07T00:00:00.000Z'};}
function headers(m=meta()){return new Headers({'content-length':String(m.size),'content-type':m.mimeType,'content-disposition':`attachment; filename="document-${id}-r1.pdf"`,'x-aij-document-id':id,'x-aij-document-revision':'1','x-aij-export-id':id,'x-aij-checksum-sha256':checksum,'x-aij-renderer-version':m.rendererVersion,'cache-control':'private, no-store','x-content-type-options':'nosniff'});}
test('bounded reader actual stream success, overflow, short read, missing length, cancellation',async()=>{
 assert.deepEqual((await readClientBinaryResponse(new Response(bytes,{headers:headers()}))).bytes,new Uint8Array(bytes));
 for(const [body,h] of [[bytes,{'content-length':'1'}],[bytes,{'content-length':'100'}],[bytes,{}],[bytes,{'content-length':'5242881'}]])await assert.rejects(readClientBinaryResponse(new Response(body,{headers:h})));
 const ac=new AbortController();let cancelled=false;const r=new Response(new ReadableStream({pull(){ac.abort();},cancel(){cancelled=true;}}),{headers:{'content-length':'1'}});await assert.rejects(readClientBinaryResponse(r,10,ac.signal));assert.equal(cancelled,true);
});
test('SDK exact success, one POST on unknown, invalid metadata, download SHA and header fencing',async()=>{
 Object.defineProperty(globalThis,'crypto',{value:webcrypto,configurable:true});let calls=0;
 const sdk=createPersonalDocumentExportsClient(async(_p,o)=>{calls++;if(o.responseKind==='binary')return readClientBinaryResponse(new Response(bytes,{headers:headers()}),o.maxResponseBytes,o.signal);return meta();});
 assert.deepEqual(await sdk.create('space',input),meta());assert.equal(calls,1);assert.equal((await sdk.download('space',meta())).checksum,checksum);
 const broken=createPersonalDocumentExportsClient(async()=>{calls++;return {...meta(),body:'leak'};});const before=calls;await assert.rejects(broken.create('space',input));assert.equal(calls,before+1);
 assert.throws(()=>parseDocumentExportMeta({...meta(),pageCount:null}));
 for(const bad of ['hash','header']){const data={bytes:new Uint8Array(bytes),headers:headers()};if(bad==='hash')data.bytes[0]=0;else data.headers.set('x-aij-document-id','other');await assert.rejects(createPersonalDocumentExportsClient(async()=>data).download('space',meta()));assert.ok(data.bytes.every(v=>v===0));}
});

test('SDK standalone strict types and emitted ESM/CJS runtime agree',async()=>{
 const source=fileURLToPath(new URL('../../packages/sdk/src/personal-document-exports.ts',import.meta.url));
 const p=ts.createProgram([source],{noEmit:true,strict:true,skipLibCheck:true,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.NodeNext,moduleResolution:ts.ModuleResolutionKind.NodeNext,lib:['lib.es2022.d.ts','lib.dom.d.ts'],types:[]});
 const diagnostics=ts.getPreEmitDiagnostics(p);assert.equal(diagnostics.length,0,ts.formatDiagnosticsWithColorAndContext(diagnostics,{getCanonicalFileName:x=>x,getCurrentDirectory:()=>process.cwd(),getNewLine:()=>String.fromCharCode(10)}));
 const esm=await import('file://'+join(scratch,'personal-document-exports.mjs'));
 assert.deepEqual(await esm.createPersonalDocumentExportsClient(async()=>meta()).create('space',input),meta());
});

test('targeted API sources typecheck without full API build',()=>{
 const roots=['personal-document-exports.dto','personal-document-exports.service','personal-document-exports.controller','document-export-profile','personal-documents.service'].map(n=>fileURLToPath(new URL('../../apps/api/src/documents/'+n+'.ts',import.meta.url)));
 const p=ts.createProgram(roots,{noEmit:true,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,moduleResolution:ts.ModuleResolutionKind.Node10,strict:true,skipLibCheck:true,experimentalDecorators:true,emitDecoratorMetadata:true,esModuleInterop:true,types:['node']});
 const d=ts.getPreEmitDiagnostics(p);assert.equal(d.length,0,ts.formatDiagnosticsWithColorAndContext(d,{getCanonicalFileName:x=>x,getCurrentDirectory:()=>process.cwd(),getNewLine:()=>String.fromCharCode(10)}));
});
test('actual document fence requires read and independent export, expected revision and current head',async()=>{
 const {PersonalDocumentsService}=require('../../apps/api/src/documents/personal-documents.service.ts');const permissions=[];
 let head={id,revision:1,deleted_at:null},allowed=true;
 const tx={$queryRaw:async strings=>strings.join('').includes('personal_document')?[head]:[{id:'project'}],$executeRaw:async()=>{}};
 const documents=new PersonalDocumentsService({$transaction:fn=>fn(tx)},{assertWritePermissionInTransaction:async(_t,_m,_w,p)=>{permissions.push(p);if(p.endsWith('.export')&&!allowed)throw new ForbiddenException();}},{projectId:async()=> 'project',assertEnabledInTransaction:async()=>{}});
 await documents.withCurrentDocument('member','space',id,1,async(_t,d,p)=>{assert.equal(d,head);assert.equal(p,'project');});
 assert.deepEqual(permissions,['workspace.documents.read','workspace.documents.export']);
 allowed=false;await assert.rejects(documents.withCurrentDocument('member','space',id,1,async()=>assert.fail()),status(403));
 assert.equal((await documents.exportCapability('member','space',true)).reason,'not_permitted');
 allowed=true;head={...head,revision:2};await assert.rejects(documents.withCurrentDocument('member','space',id,1,async()=>assert.fail()),status(409));
 head={...head,deleted_at:new Date()};await assert.rejects(documents.withCurrentDocument('member','space',id,undefined,async()=>assert.fail()),status(404));
});

test('abort during executor cleanup zeroes the original returned buffer before any stage',async()=>{
 const f=fixture(), abort=new AbortController();
 f.during=signal=>{assert.equal(signal,abort.signal);assert.ok(f.returnedBytes.some(v=>v!==0));abort.abort();};
 await assert.rejects(f.service.create('member','space',input,abort.signal),status(503));
 assert.equal(f.renders,1);assert.ok(Buffer.isBuffer(f.returnedBytes));assert.ok(f.returnedBytes.every(v=>v===0));
 assert.equal(f.stages.size,0);assert.equal(f.assets.size,0);assert.equal(f.rows.length,0);assert.equal(f.audits.length,0);assert.equal(f.discard,0);
});
test('rejected executor artifact is zeroed for failed outcome and unconfirmed cleanup',async()=>{
 for(const overrides of [{outcome:'CLEANUP_UNCONFIRMED'},{cleanupConfirmed:false}]){
  const f=fixture();Object.assign(f,overrides);
  await assert.rejects(f.service.create('member','space',input),status(503));
  assert.ok(f.returnedBytes.every(v=>v===0));assert.equal(f.stages.size,0);assert.equal(f.assets.size,0);
 }
});
test('success clears only executor RAM while persisted attachment bytes stay intact',async()=>{
 const f=fixture();const m=await f.service.create('member','space',input);
 assert.ok(f.returnedBytes.every(v=>v===0));
 assert.deepEqual((await f.service.get('member','space',m.id,true)).content.bytes,bytes);
});

test('initial session fence refuses before rendering or any stage',async()=>{
 const f=fixture();let gates=0;
 const authorize=async tx=>{assert.equal(tx,f.tx);assert.equal(f.active,1);gates++;throw new UnauthorizedException('Invalid client session');};
 await assert.rejects(f.service.create('member','space',input,undefined,authorize),status(401));
 assert.equal(gates,1);assert.equal(f.renders,0);assert.equal(f.stages.size,0);assert.equal(f.rows.length,0);assert.equal(f.assets.size,0);assert.equal(f.audits.length,0);
});
test('session revocation during render or token version change during stage denies final transaction',async()=>{
 for(const phase of ['render','stage']){
  const f=fixture();let revoked=false,version=1,gates=0;
  const authorize=async tx=>{assert.equal(tx,f.tx);assert.equal(f.active,1);gates++;if(revoked||version!==1)throw new UnauthorizedException('Invalid client session');};
  if(phase==='render')f.during=()=>{revoked=true;};else f.onStage=()=>{version++;};
  await assert.rejects(f.service.create('member','space',input,undefined,authorize),status(401));
  assert.equal(gates,3);assert.equal(f.renders,1);assert.equal(f.discard,1);
  assert.equal(f.stages.size,0);assert.equal(f.rows.length,0);assert.equal(f.assets.size,0);assert.equal(f.audits.length,0);assert.ok(f.returnedBytes.every(v=>v===0));
 }
});
test('unknown commit recovery checks the same-transaction session gate before returning metadata',async()=>{
 const f=fixture();f.unknown=true;let gates=0;
 const authorize=async tx=>{assert.equal(tx,f.tx);assert.equal(f.active,1);gates++;};
 const result=await f.service.create('member','space',input,undefined,authorize);
 assert.equal(gates,3);assert.equal(result.id,f.rows[0].id);assert.equal(f.audits.length,1);assert.equal(f.assets.size,1);assert.ok(f.returnedBytes.every(v=>v===0));
});
test('revoked session after unknown commit returns 401 without exposing metadata or deleting committed bytes',async()=>{
 const f=fixture();f.unknown=true;let revoked=false,gates=0;
 f.afterUnknown=()=>{revoked=true;};
 const authorize=async tx=>{assert.equal(tx,f.tx);assert.equal(f.active,1);gates++;if(revoked)throw new UnauthorizedException('Invalid client session');};
 await assert.rejects(f.service.create('member','space',input,undefined,authorize),error=>{
  assert.equal(error.getStatus(),401);assert.equal(error.message,'Invalid client session');assert.equal(error.meta,undefined);return true;
 });
 assert.equal(gates,3);assert.equal(f.discard,1);assert.equal(f.rows.length,1);assert.equal(f.assets.size,1);assert.equal(f.audits.length,1);
 assert.deepEqual([...f.assets.values()][0].bytes,bytes);assert.ok(f.returnedBytes.every(v=>v===0));
});

test('session 401 remains authoritative when owner cleanup must retain an unknown stage',async()=>{
 const f=fixture();let revoked=false;
 f.onStage=()=>{revoked=true;f.discardUnknown=true;};
 const authorize=async()=>{if(revoked)throw new UnauthorizedException('Invalid client session');};
 await assert.rejects(f.service.create('member','space',input,undefined,authorize),status(401));
 assert.equal(f.discard,1);assert.equal(f.stages.size,1);assert.equal(f.assets.size,0);assert.equal(f.rows.length,0);assert.equal(f.audits.length,0);
 assert.ok(f.returnedBytes.every(v=>v===0));assert.deepEqual([...f.stages.values()][0].bytes,bytes);
});
