import assert from 'node:assert/strict';import test from 'node:test';import{createRequire}from'node:module';import{fileURLToPath}from'node:url';
const require=createRequire(new URL('../../apps/api/package.json',import.meta.url));require('ts-node').register({project:fileURLToPath(new URL('../../apps/api/tsconfig.json',import.meta.url)),transpileOnly:true,compilerOptions:{jsx:'react-jsx'},moduleTypes:{'**/packages/sdk/src/**':'cjs'}});
const {createDocumentAccess}=require('../../apps/web/app/components/client-document-access.ts');
const scope={workspaceId:'space',memberId:'member',roleId:'owner',sessionKey:'session',validationKey:'owner',permissions:['workspace.documents.read','workspace.documents.export']};
const meta={id:'12345678-1234-4234-8234-123456789abc',documentId:'12345678-1234-4234-8234-123456789abd',revision:1,format:'pdf',mimeType:'application/pdf',size:8,checksum:'a'.repeat(64),rendererVersion:'aij-plain-document-v1',pageCount:1,createdAt:'2026-11-07T00:00:00.000Z'};
test('actual public export factory shares document pre/post scope fence and clears late binary after role/session/workspace or generation change',async()=>{
 for(const change of [{...scope,roleId:'reader'},{...scope,sessionKey:'new'},{...scope,workspaceId:'elsewhere'},null]){
  const bytes=new Uint8Array([1,2,3,4,5,6,7,8]);let calls=0,checks=0,access;
  access=createDocumentAccess(async(_path,options)=>{calls++;assert.equal(options.responseKind,'binary');assert.equal(options.workspaceId,'space');assert.equal(options.maxResponseBytes,5*1024*1024);if(!change){access.clear();access.setScope(scope);}return{bytes,headers:new Headers()};});
  access.setScope(scope);access.setHandlers(async()=>++checks===1||!change?scope:change,()=>access.clear());
  await assert.rejects(access.exportsApi.download('space',meta),e=>e.status===403);assert.equal(calls,1);assert.ok(bytes.every(n=>n===0));
 }
});
test('actual export factory preflight rejection sends no mutation and unknown write sends exactly once',async()=>{
 let calls=0;const access=createDocumentAccess(async()=>{calls++;throw{status:503};});access.setScope(scope);access.setHandlers(async()=>{throw{status:403};},()=>{});
 await assert.rejects(access.exportsApi.create('space',{documentId:meta.documentId,expectedRevision:1,format:'pdf'}));assert.equal(calls,0);
 access.setHandlers(async()=>scope,()=>{});await assert.rejects(access.exportsApi.create('space',{documentId:meta.documentId,expectedRevision:1,format:'pdf'}));assert.equal(calls,1);
});

test('held real public-SDK list is discarded after conceal/revalidation, and a fresh explicit read succeeds without automatic replay',async()=>{
 const {createDocumentManagerStore}=require('../../apps/web/app/components/client-document-manager.tsx');
 let release,entered,requests=0,firstSignal;
 const started=new Promise(r=>{entered=r;}),held=new Promise(r=>{release=r;});
 const head=name=>({id:meta.documentId,code:'owned-note',name,revision:1,createdAt:'2026-11-07T00:00:00.000Z',updatedAt:'2026-11-07T00:00:00.000Z'});
 const access=createDocumentAccess(async(path,options)=>{assert.ok(path.startsWith('/client/documents?'));assert.equal(options.method,'GET');requests++;if(requests===1){firstSignal=options.signal;entered();return held;}return{items:[head('Current explicit read')],nextCursor:null};});
 access.setScope(scope);access.setHandlers(async()=>scope,()=>{});
 const store=createDocumentManagerStore(access.api);store.setScope(scope);
 const pending=store.list();await started;assert.equal(store.getSnapshot().busy,true);
 store.conceal();assert.equal(firstSignal.aborted,true);assert.deepEqual(store.getSnapshot().items,[]);assert.equal(store.getSnapshot().detail,null);
 await store.revalidate(async()=>scope);assert.equal(requests,1,'focus revalidation must not replay a list/mutation');
 release({items:[head('Stale held response')],nextCursor:null});await pending;
 assert.deepEqual(store.getSnapshot().items,[]);assert.equal(store.getSnapshot().issue,'');assert.equal(store.getSnapshot().scope.workspaceId,'space');
 await store.list();assert.equal(requests,2);assert.equal(store.getSnapshot().items[0].name,'Current explicit read');assert.equal(store.getSnapshot().busy,false);
 store.clear();assert.deepEqual(store.getSnapshot().items,[]);
});
