import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {readFile,writeFile,lstat,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRemainingClientFixture} from './remaining-client-fixture.mjs';
import {w21NativeBrowser} from './w21-native-browser.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
test('AF224 outside public ESM/CJS/browser composes real original document and explicit original CAS save only',{timeout:300000},async()=>{
  assert.equal(process.env.AIJ_AF224_ROOT_ACCEPTANCE,'true');
  const consumer=await realpath(process.env.AIJ_AF224_PACKED_CONSUMER),artifact=process.env.AIJ_AF224_ROOT_ARTIFACT;
  assert.match(consumer,/^\/private\/tmp\/aij-af224-packed-[A-Za-z0-9]+$/);assert.equal(await readFile(join(consumer,'.af224-owned'),'utf8'),'AF-224\n');
  assert.equal((await lstat(join(consumer,'node_modules/@aij/sdk'))).isSymbolicLink(),false);
  const esm=await import(pathToFileURL(join(consumer,'node_modules/@aij/sdk/dist/index.mjs')).href);
  const cjs=createRequire(join(consumer,'package.json'))('@aij/sdk');
  const browser=w21NativeBrowser(artifact);let f,storage,host,failure,phase='SETUP',docId,wid;const requests=[],proof=[];
  try{
    f=await createRemainingClientFixture('AF-224',{workbenchTargetSafety:true,storageEnabled:true,documentExport:{approvedImage:'sha256:b2322ac98afa484dd6722fc3e19775fca9c0bc8e360e9843b9dd0da663a602c1',dockerCliPath:'/usr/local/bin/docker'}});
    wid=f.workspaces[0].id;const raw=esm.createClientApi(()=>f.baseUrl),request=(path,options={})=>{requests.push({method:options.method??'GET',path});return raw(path,{...options,headers:{cookie:f.cookies[0],origin:process.env.WEB_URL,connection:'close'}});};
    const docs=esm.createPersonalDocumentsClient(request),exports=esm.createPersonalDocumentExportsClient(request),sections=esm.createPersonalDocumentSectionsClient(request);
    const {LocalStorageAdapter}=f.requireApi('files/local-storage.adapter.js');storage=f.app.get(LocalStorageAdapter);
    let doc=await docs.create(wid,{code:'af224-public',name:'Public package source',body:'AF224 immutable export reference.'});docId=doc.id;
    const old=await docs.getVersion(wid,doc.id,1),oldExports=[];for(const format of ['docx','pdf'])oldExports.push(await exports.create(wid,{documentId:doc.id,expectedRevision:1,format}));
    const oldBytes=await Promise.all(oldExports.map(e=>exports.download(wid,e)));
    doc=await docs.update(wid,doc.id,{expectedRevision:1,name:doc.name,body:'preamble\r\n# One 😀\r\nold\r\n## Two\rtail\u0301'});
    const domain=async()=>sha(JSON.stringify(await Promise.all([f.prisma.personalDocument.findMany({orderBy:{id:'asc'}}),f.prisma.personalDocumentVersion.findMany({orderBy:{id:'asc'}}),f.prisma.personalDocumentExport.findMany({orderBy:{id:'asc'}}),f.prisma.fileAsset.findMany({orderBy:{id:'asc'}}),f.prisma.auditLog.count({where:{module:'personal_documents'}}),f.prisma.aiAgentRun.count(),f.prisma.runtimeJob.count(),f.prisma.aiExecutionTrace.count()])));
    phase='ESM_CJS_REAL_READ_COMPOSE';const before=await domain();const index=await sections.get(wid,doc.id,2),replacement='# Changed 😀\r\nnew\r\n';const selected=index.sections[1];
    const expected=doc.body.slice(0,selected.start)+replacement+doc.body.slice(selected.end),calls=requests.length;
    for(const sdk of [esm,cjs]){
      const actualIndex=await sdk.createPersonalDocumentSectionsClient(request).get(wid,doc.id,2);assert.deepEqual(actualIndex,index);
      const draft=await sdk.composePersonalDocumentSectionDraft({document:doc,index:actualIndex,sectionId:selected.id,replacement});assert.equal(draft.body,expected);assert.equal(draft.changed,true);assert.equal(draft.expectedRevision,2);
      const noop=await sdk.composePersonalDocumentSectionDraft({document:doc,index:actualIndex,sectionId:selected.id,replacement:doc.body.slice(selected.start,selected.end)});assert.equal(noop.changed,false);
      await assert.rejects(sdk.composePersonalDocumentSectionDraft({document:{...doc,body:doc.body+'tamper'},index:actualIndex,sectionId:selected.id,replacement}),TypeError);
      await assert.rejects(sdk.composePersonalDocumentSectionDraft({document:doc,index:actualIndex,sectionId:selected.id,replacement:'no line ending'}),TypeError);
    }
    assert.equal(requests.length,calls+2);assert.equal(await domain(),before);proof.push({case:'ESM_CJS_exact_prefix_suffix_noop_hash_and_boundary_refusal',originalDomainUnchanged:true});
    phase='ACTUAL_BROWSER';const browserRequests=[];
    const script=`import {createClientApi,createPersonalDocumentsClient,createPersonalDocumentSectionsClient,composePersonalDocumentSectionDraft} from '@aij/sdk';\ntry{const {wid,id}=await(await fetch('/fixture.json')).json();const request=createClientApi(()=>location.origin+'/api');const d=await createPersonalDocumentsClient(request).get(wid,id);const i=await createPersonalDocumentSectionsClient(request).get(wid,id,d.revision);const s=i.sections[1];const r='# Changed 😀\\r\\nnew\\r\\n';const p=await composePersonalDocumentSectionDraft({document:d,index:i,sectionId:s.id,replacement:r});if(!p.changed||p.body!==d.body.slice(0,s.start)+r+d.body.slice(s.end))throw Error();document.getElementById('status').textContent='AF224_BROWSER_PASS';}catch{document.getElementById('status').textContent='AF224_BROWSER_FAIL';}`;
    host=createServer(async(req,res)=>{try{
      res.setHeader('cache-control','private, no-store');const url=new URL(req.url,'http://127.0.0.1');
      if(req.method!=='GET'){res.writeHead(405).end();return;}
      if(url.pathname==='/'){res.setHeader('content-type','text/html; charset=utf-8');res.end('<!doctype html><title>AF224 installed public SDK</title><script type="importmap">'+JSON.stringify({imports:{'@aij/sdk':'/packages/sdk/index.mjs','@aij/contracts':'/packages/contracts/index.mjs'}})+'</script><script type="module" src="/app.mjs"></script><main><h1>Public SDK actual browser</h1><output id="status">RUNNING</output></main>');return;}
      if(url.pathname==='/app.mjs'){res.setHeader('content-type','text/javascript; charset=utf-8');res.end(script);return;}
      if(url.pathname==='/fixture.json'){res.setHeader('content-type','application/json');res.end(JSON.stringify({wid,id:docId}));return;}
      const file=url.pathname.match(/^\/packages\/(sdk|contracts)\/([a-z0-9-]+\.mjs)$/);if(file){res.setHeader('content-type','text/javascript');res.end(await readFile(join(consumer,'node_modules/@aij',file[1],'dist',file[2])));return;}
      if(url.pathname==='/api/client/documents/'+docId||url.pathname==='/api/client/documents/'+docId+'/sections'){
        assert.equal(req.headers['x-aij-workspace-id'],wid);browserRequests.push(url.pathname+url.search);
        const r=await fetch(f.baseUrl+url.pathname.slice(4)+url.search,{headers:{cookie:f.cookies[0],origin:process.env.WEB_URL,'x-aij-workspace-id':wid,connection:'close'}});res.writeHead(r.status,{'content-type':'application/json'});res.end(Buffer.from(await r.arrayBuffer()));return;}
      res.writeHead(404).end();
    }catch{res.writeHead(500).end();}});await new Promise((yes,no)=>{host.once('error',no);host.listen(0,'127.0.0.1',yes);});
    await browser.action('create',['--url','http://127.0.0.1:'+host.address().port+'/']);await browser.wait('AF224_BROWSER_PASS');assert.equal(await browser.read('document.getElementById("status").textContent'),'AF224_BROWSER_PASS');
    assert.equal(browserRequests.length,2);assert.equal(await domain(),before);await browser.close();await new Promise((yes,no)=>host.close(e=>e?no(e):yes()));host=undefined;proof.push({case:'actual_browser_installed_public_ESM_GET_and_WebCrypto_composition',reads:2,originalDomainUnchanged:true});
    phase='EXPLICIT_ORIGINAL_SAVE_AND_CAS';const next=await docs.update(wid,doc.id,{expectedRevision:2,name:doc.name,body:expected});assert.equal(next.revision,3);assert.equal(next.body,expected);
    assert.equal(await f.prisma.personalDocumentVersion.count({where:{documentId:doc.id}}),3);const afterSave=await domain();
    await assert.rejects(docs.update(wid,doc.id,{expectedRevision:2,name:doc.name,body:'stale'}),e=>e.status===409);await assert.rejects(sections.get(wid,doc.id,2),e=>e.status===409);assert.equal(await domain(),afterSave);
    assert.equal(sha(JSON.stringify(await docs.getVersion(wid,doc.id,1))),sha(JSON.stringify(old)));
    for(const [i,e]of oldExports.entries()){assert.equal(sha(JSON.stringify(await exports.get(wid,e.id))),sha(JSON.stringify(e)));assert.equal(sha((await exports.download(wid,e)).bytes),sha(oldBytes[i].bytes));}
    phase='CURRENT_REFUSALS';const foreign=esm.createPersonalDocumentSectionsClient((path,options={})=>raw(path,{...options,headers:{cookie:f.cookies[1],origin:process.env.WEB_URL}}));await assert.rejects(foreign.get(f.workspaces[1].id,doc.id,3),e=>e.status===404);
    const permission=await f.prisma.clientWorkspacePermission.findUniqueOrThrow({where:{code:'workspace.documents.read'}});await f.prisma.clientWorkspacePermission.update({where:{id:permission.id},data:{status:'disabled'}});try{await assert.rejects(sections.get(wid,doc.id,3),e=>e.status===403);}finally{await f.prisma.clientWorkspacePermission.update({where:{id:permission.id},data:{status:permission.status}});}
    await docs.delete(wid,doc.id,3);await assert.rejects(sections.get(wid,doc.id,3),e=>e.status===404);
    for(const model of [f.prisma.aiAgentRun,f.prisma.runtimeJob,f.prisma.aiExecutionTrace])assert.equal(await model.count(),0);
    assert.equal(requests.filter(r=>r.method==='PATCH').length,3);proof.push({case:'one_original_save_revision_and_stale_CAS_refusal',setupVersions:2,versions:3,sectionSuccessfulPatch:1,refusedPatch:1,oldHistoryAndExportsUnchanged:true,runtimeWrites:0});
    await writeFile(join(artifact,'proof.json'),JSON.stringify({task:'AF-224',status:'PASS',proof,ownerAcceptance:'PENDING'},null,2),{mode:0o600});
  }catch(e){failure=e;await writeFile(join(artifact,'live-failure.json'),JSON.stringify({phase,code:e?.code??'FAILED',status:e?.status,frames:String(e?.stack??'').split('\n').filter(l=>/^\s+at /.test(l)).slice(-6)},null,2),{mode:0o600});}
  finally{await browser.close();if(host){host.closeAllConnections();await new Promise((yes,no)=>host.close(e=>e?no(e):yes()));}if(f){if(storage)for(const a of await f.prisma.fileAsset.findMany({select:{objectKey:true}}))if(await storage.exists(a.objectKey))await storage.remove(a.objectKey);const closed=await f.close();assert.equal(closed.applicationPools0,true);assert.equal(closed.ownedSockets0,true);assert.equal(closed.environmentRestored,true);}}
  if(failure)throw Error('AF224_REAL_FAILED_AT_'+phase);
});
