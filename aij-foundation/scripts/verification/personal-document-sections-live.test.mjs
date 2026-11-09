// Root-only actual original API/PG/auth/document/file owners. No fabricated replies.
import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createRemainingClientFixture} from './remaining-client-fixture.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const root='/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation';
test('AF223 real section API preserves original document/history/export/runtime owners', {timeout:300000}, async()=>{
  assert.equal(process.env.AIJ_AF223_ROOT_ACCEPTANCE,'true'); assert.equal(process.cwd(),root);
  let f,storage,failure,phase='SETUP'; const cases=[];
  try {
    f=await createRemainingClientFixture('AF-223',{workbenchTargetSafety:true,storageEnabled:true,
      documentExport:{approvedImage:'sha256:b2322ac98afa484dd6722fc3e19775fca9c0bc8e360e9843b9dd0da663a602c1',dockerCliPath:'/usr/local/bin/docker'}});
    const sdk=await import('../../packages/sdk/dist/index.mjs');
    const raw=sdk.createClientApi(()=>f.baseUrl),workspace=f.workspaces[0].id,member=f.accounts[0].id;
    const request=(path,options={})=>raw(path,{...options,headers:{...Object.fromEntries(new Headers(options.headers)),cookie:f.cookies[0],origin:process.env.WEB_URL,connection:'close'}});
    const documents=sdk.createPersonalDocumentsClient(request),exports=sdk.createPersonalDocumentExportsClient(request);
    const {LocalStorageAdapter}=f.requireApi('files/local-storage.adapter.js');storage=f.app.get(LocalStorageAdapter);
    const requireApi=createRequire(join(root,'apps/api/package.json'));
    const {buildPersonalDocumentSectionIndex:build}=requireApi(join(root,'apps/api/dist/documents/personal-document-sections.js'));
    const domain=async()=>hash(JSON.stringify(await Promise.all([
      f.prisma.personalDocument.findMany({orderBy:{id:'asc'}}),f.prisma.personalDocumentVersion.findMany({orderBy:{id:'asc'}}),
      f.prisma.personalDocumentExport.findMany({orderBy:{id:'asc'}}),f.prisma.fileAsset.findMany({orderBy:{id:'asc'}}),
      f.prisma.auditLog.count({where:{module:'personal_documents'}}),f.prisma.aiAgentRun.count(),f.prisma.runtimeJob.count(),f.prisma.aiExecutionTrace.count()
    ])));
    const http=async(path,{cookie=f.cookies[0],wid=workspace,method='GET'}={})=>{
      const r=await fetch(f.baseUrl+'/'+path,{method,headers:{...(cookie?{cookie}:{}),...(wid?{'x-aij-workspace-id':wid}:{}),origin:process.env.WEB_URL,connection:'close'},signal:AbortSignal.timeout(15000)});
      return {status:r.status,cache:r.headers.get('cache-control'),payload:await r.json()};
    };
    const read=async(label,path,status,options)=>{
      phase=label;const before=await domain(),r=await http(path,options);assert.equal(r.status,status);
      assert.ok(r.cache?.includes('private')&&r.cache.includes('no-store'));assert.equal(await domain(),before);
      if(status!==200)assert.equal(r.payload.data===null,true);
      cases.push({case:label,status,domainUnchanged:true,noStore:true});return r.payload.data;
    };
    let doc=await documents.create(workspace,{code:'af223-sections',name:'Section source',body:'AF223 original immutable export.'});
    const old=await documents.getVersion(workspace,doc.id,1),oldExports=[];
    for(const format of ['docx','pdf'])oldExports.push(await exports.create(workspace,{documentId:doc.id,expectedRevision:1,format}));
    const oldBytes=await Promise.all(oldExports.map(e=>exports.download(workspace,e)));
    const body='\uFEFFpreamble\r\n# First \u{1f600}\r\nhandwritten\r\n````code\r# fenced\r`````\r## Second\nlast\u0301';
    doc=await documents.update(workspace,doc.id,{expectedRevision:1,name:doc.name,body});
    const path='client/documents/'+doc.id+'/sections',url=path+'?expectedRevision='+doc.revision;
    const index=await read('real-current-exact-unicode-line-endings-and-fence',url,200);
    assert.equal(hash(JSON.stringify(index)),hash(JSON.stringify(build({id:doc.id,revision:doc.revision,body}))));
    assert.equal(index.sections.map(s=>body.slice(s.start,s.end)).join('')===body,true);assert.equal(index.sections.length,3);
    for(const [label,query]of [['stale','expectedRevision=1'],['missing',''],['leading-zero','expectedRevision=02'],['duplicate','expectedRevision=2&expectedRevision=2'],['array','expectedRevision[]=2'],['extra','expectedRevision=2&extra=1'],['prototype','expectedRevision=2&__proto__=x'],['constructor','expectedRevision=2&constructor=x'],['newline','expectedRevision=2%0A']])await read('query-'+label,path+(query?'?'+query:''),label==='stale'?409:400);
    await read('anonymous',url,401,{cookie:null});
    // A valid second member in the same workspace proves ownership, beyond membership checks.
    const owner=await f.prisma.clientWorkspaceMembership.findUniqueOrThrow({where:{workspaceId_memberId:{workspaceId:workspace,memberId:member}}});
    await f.prisma.clientWorkspaceMembership.create({data:{workspaceId:workspace,memberId:f.accounts[1].id,roleId:owner.roleId,status:'active'}});
    await read('other-member-same-workspace',url,404,{cookie:f.cookies[1]});
    await read('other-workspace',url,404,{cookie:f.cookies[1],wid:f.workspaces[1].id});
    const permission=await f.prisma.clientWorkspacePermission.findUniqueOrThrow({where:{code:'workspace.documents.read'}});
    await f.prisma.clientWorkspacePermission.update({where:{id:permission.id},data:{status:'disabled'}});
    try{await read('current-read-permission-disabled',url,403);}finally{await f.prisma.clientWorkspacePermission.update({where:{id:permission.id},data:{status:permission.status}});}
    for(const [label,model,id,status]of [['plugin',f.prisma.pluginInstallation,(await f.prisma.pluginInstallation.findFirstOrThrow({where:{pluginCode:'aij-ai'}})).id,'installed'],['project',f.prisma.projectProfile,f.project.id,'disabled']]){
      const prior=await model.findUniqueOrThrow({where:{id}});await model.update({where:{id},data:{status}});
      try{const original=await http('client/documents/'+doc.id);assert.ok([403,404,503].includes(original.status));await read(label+'-unavailable-original-owner-refusal',url,original.status);}finally{await model.update({where:{id},data:{status:prior.status}});}
    }
    const empty=await documents.create(workspace,{code:'af223-empty',name:'Empty',body:''});
    const emptyIndex=await read('empty-body-exact-single-zero-range','client/documents/'+empty.id+'/sections?expectedRevision=1',200);assert.equal(emptyIndex.sections.length,1);assert.equal(emptyIndex.bodyLength,0);
    let bounded=await documents.create(workspace,{code:'af223-limits',name:'Limits',body:Array.from({length:128},(_,i)=>'# H'+i+'\n').join('')});
    const limitPath='client/documents/'+bounded.id+'/sections';assert.equal((await read('exact-128-blocks',limitPath+'?expectedRevision=1',200)).sections.length,128);
    bounded=await documents.update(workspace,bounded.id,{expectedRevision:1,name:bounded.name,body:'# P\n'+bounded.body});
    await read('129-blocks-refuse-no-truncation',limitPath+'?expectedRevision=2',400);
    bounded=await documents.update(workspace,bounded.id,{expectedRevision:2,name:bounded.name,body:'# '+ '\u{1f600}'.repeat(256)});
    assert.equal([...(await read('256-codepoint-heading',limitPath+'?expectedRevision=3',200)).sections[0].title].length,256);
    bounded=await documents.update(workspace,bounded.id,{expectedRevision:3,name:bounded.name,body:'# '+'x'.repeat(257)});
    await read('257-codepoint-heading-refuses',limitPath+'?expectedRevision=4',400);
    await documents.delete(workspace,bounded.id,4);await read('deleted-current-document',limitPath+'?expectedRevision=4',404);
    assert.equal(hash(JSON.stringify(await documents.getVersion(workspace,doc.id,1))),hash(JSON.stringify(old)));
    for(const [i,e]of oldExports.entries()){assert.equal(hash(JSON.stringify(await exports.get(workspace,e.id))),hash(JSON.stringify(e)));assert.equal(hash((await exports.download(workspace,e)).bytes),hash(oldBytes[i].bytes));}
    assert.equal(await f.prisma.aiAgentRun.count(),0);assert.equal(await f.prisma.runtimeJob.count(),0);assert.equal(await f.prisma.aiExecutionTrace.count(),0);
    await request('/client/auth/logout',{method:'POST'});await read('original-session-revoked',url,401);
    await writeFile(join(f.artifactDirectory,'sections-proof.json'),JSON.stringify({task:'AF-223',status:'PASS',acceptanceId:f.lease.id,ownerAcceptance:'PENDING',cases,oldHistoryAndExportBytesUnchanged:true,modelRuntimeWrites:0},null,2),{mode:0o600});
  }catch(error){failure=error;if(f)await writeFile(join(f.artifactDirectory,'sections-failure.json'),JSON.stringify({phase,code:error?.code??'FAILED',frames:String(error?.stack??'').split('\n').filter(l=>/^\s+at /.test(l)).slice(0,6)},null,2),{mode:0o600});}
  finally{
    if(f){if(storage)for(const asset of await f.prisma.fileAsset.findMany({select:{objectKey:true}}))if(await storage.exists(asset.objectKey))await storage.remove(asset.objectKey);
      const closed=await f.close();assert.equal(closed.applicationPools0,true);assert.equal(closed.ownedSockets0,true);assert.equal(closed.environmentRestored,true);}
  }
  if(failure)throw Error('AF223_REAL_ACCEPTANCE_FAILED_AT_'+phase);
});
