// Actual parent/controller/public SDK composition with synthetic transport, not PG/native evidence.
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import ts from 'typescript';
import * as sdk from '../../packages/sdk/dist/index.mjs';
import * as restore from '../../apps/web/app/components/client-document-restore-state.mjs';
import * as sections from '../../apps/web/app/components/client-document-sections-state.mjs';
const path=resolve('apps/web/app/components/client-document-manager.tsx'),local=createRequire(path),exports={};
const code=ts.transpileModule(readFileSync(path,'utf8'),{fileName:path,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
new Function('require','exports',code)(name=>name==='@aij/sdk'?sdk:name==='@aij/ui'?{PageHeading:()=>null}:name==='./admin-api'?{adminTheme:{}}:name==='./client-document-restore-state.mjs'?restore:name==='./client-document-sections-state.mjs'?sections:name.endsWith('-panel')?{ClientDocumentVersionRestorePanel:()=>null,ClientDocumentSectionsPanel:()=>null,ClientDocumentExportPanel:()=>null}:local(name),exports);
const id='12345678-1234-4234-8234-123456789abc',READ='workspace.documents.read',MANAGE='workspace.documents.manage',at='2026-11-08T00:00:00.000Z';
const scope=()=>({memberId:'member-a',workspaceId:'space-a',roleId:'role-a',roleCode:'OWNER',sessionKey:'a'.repeat(64),validationKey:'valid',permissions:[READ,MANAGE]});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function fixture(t){
  let head={id,code:'document-a',name:'PRIVATE document',body:'preface\r\n# One\r\nPRIVATE old\r\n## Two\rtail😀',revision:2,createdAt:at,updatedAt:at},verified=scope(),denied=0;
  const calls=[],controls={override:null};
  const raw=async(path,init={})=>{
    calls.push({path,method:init.method??'GET'});if(controls.override){const result=await controls.override(path,init);if(result!==undefined)return result;}
    if(path==='/client/auth/me')return {id:verified.memberId,email:null,nickname:'Synthetic'};
    if(path==='/client/workspaces/context')return {workspaceId:verified.workspaceId,workspaceCode:'synthetic',workspaceName:'Synthetic',roleId:verified.roleId,roleCode:verified.roleCode,permissions:verified.permissions,sessionGeneration:verified.sessionKey};
    if(path.endsWith('/sections?expectedRevision=2')){const cuts=[0,head.body.indexOf('# One'),head.body.indexOf('## Two')];return {format:'aij-plain-sections-v1',documentId:id,revision:head.revision,bodySha256:createHash('sha256').update(head.body).digest('hex'),bodyLength:head.body.length,bodyByteLength:Buffer.byteLength(head.body),sections:cuts.map((start,i)=>({id:'section-'+i,index:i,title:['正文','One','Two'][i],level:[0,1,2][i],start,end:cuts[i+1]??head.body.length}))};}
    if(path.endsWith('/versions?limit=10'))return {items:[{documentId:id,revision:1,name:'Old',createdAt:at}],nextCursor:null};
    if(path.endsWith('/versions/1'))return {documentId:id,revision:1,name:'Old',body:'PRIVATE historical',createdAt:at};
    assert.equal(path,'/client/documents/'+id);
    if(init.method==='PATCH'){const p=JSON.parse(init.body);assert.equal(p.expectedRevision,head.revision);head={...head,name:p.name,body:p.body,revision:head.revision+1};}return {...head};
  };
  const composition=exports.createDocumentComposition({api:sdk.createPersonalDocumentsClient(raw),request:raw,onAccessFailure:()=>denied++,isActive:()=>true});
  composition.manager.setScope(verified);t.after(()=>composition.dispose());
  const view=async()=>{await composition.manager.open(id);composition.manager.viewSaved();};
  const compare=async()=>{await view();await composition.sections.load();await composition.sections.select('section-1');composition.sections.draft('# Changed\r\nPRIVATE new\r\n');await composition.sections.preview();assert.ok(composition.sections.getSnapshot().comparison);};
  const proposal=()=>{const p=composition.sections.getSnapshot().comparison;assert.ok(p);return {...p,memberId:verified.memberId,workspaceId:verified.workspaceId,roleId:verified.roleId,roleCode:verified.roleCode,sessionGeneration:verified.sessionKey,permissions:[...verified.permissions].sort()};};
  return {...composition,calls,controls,view,compare,proposal,head:()=>head,denied:()=>denied,setVerified:p=>verified={...verified,...p}};
}
test('real composed child applies only to original full draft; one explicit original PATCH adds one version',async t=>{
  const f=fixture(t);await f.compare();const before=f.head().body;await f.sections.requestConfirmation();await f.sections.confirmDraft();
  assert.equal(f.manager.getSnapshot().editing,true);assert.ok(f.manager.getSnapshot().notice.includes('尚未保存'));assert.equal(f.head().body,before);assert.equal(f.calls.filter(c=>c.method==='PATCH').length,0);assert.equal(f.sections.getSnapshot().head,null);
  await f.manager.save();assert.equal(f.head().revision,3);assert.equal(f.calls.filter(c=>c.method==='PATCH').length,1);assert.match(f.head().body,/# Changed/);assert.ok(f.head().body.endsWith('## Two\rtail😀'));
});
test('forged source/id/revision/member/workspace/role/session/permissions/body proposals fail synchronously',async t=>{
  const f=fixture(t);await f.compare();const original=f.proposal();
  for(const patch of [{documentId:'other'},{expectedRevision:1},{sourceSha256:'0'.repeat(64)},{sectionId:'section-0'},{memberId:'other'},{workspaceId:'other'},{roleId:'other'},{roleCode:'OTHER'},{sessionGeneration:'b'.repeat(64)},{permissions:[READ]},{body:'forged'},{changed:false}])assert.equal(f.manager.applySectionDraft({...original,...patch}),false);
  assert.equal(f.manager.getSnapshot().editing,false);assert.equal(f.calls.filter(c=>c.method==='PATCH').length,0);
});
test('dirty original draft, absent source and saved-scope changes cannot be overwritten',async t=>{
  const f=fixture(t);await f.compare();const proposal=f.proposal();f.manager.editAgain();f.manager.draft('body','PRIVATE user existing');assert.equal(f.sections.getSnapshot().head,null);
  assert.equal(f.manager.applySectionDraft(proposal),false);assert.equal(f.manager.getSnapshot().body,'PRIVATE user existing');
  await f.view();assert.equal(f.manager.applySectionDraft(proposal),false);f.manager.setScope({...scope(),sessionKey:'b'.repeat(64)});assert.equal(f.manager.applySectionDraft(proposal),false);
});
test('restore operation immediately nulls the permanent sections controller before React effects',async t=>{
  const f=fixture(t);await f.compare();await f.restore.loadHistory();assert.equal(f.sections.getSnapshot().head,null);await f.restore.selectVersion(1);await f.restore.requestConfirmation();
  assert.equal(f.restore.getSnapshot().confirmation,true);const n=f.calls.length;await f.sections.load();assert.equal(f.calls.length,n);assert.equal(f.restore.getSnapshot().confirmation,true);
});
test('original unknown save lock blocks sections; close/reopen keeps same sole recovery owner',async t=>{
  const f=fixture(t);await f.compare();await f.sections.requestConfirmation();await f.sections.confirmDraft();f.controls.override=(_p,i)=>{if(i.method==='PATCH')throw new sdk.ClientRequestFailure(503);};await f.manager.save();
  assert.ok(f.manager.getSnapshot().recovery);assert.equal(f.sections.getSnapshot().head,null);const n=f.calls.length;await f.sections.load();assert.equal(f.calls.length,n);
  f.manager.close();await f.manager.open(id);assert.ok(f.manager.getSnapshot().recovery);assert.equal(f.sections.getSnapshot().head,null);
});
test('current child revocation and genuine parent conceal contract clear both private controllers and parent',async t=>{
  for(const code of [401,403,404]){const f=fixture(t);await f.compare();f.controls.override=()=>{throw new sdk.ClientRequestFailure(code);};await f.sections.requestConfirmation();assert.equal(f.manager.getSnapshot().detail,null);assert.equal(f.sections.getSnapshot().head,null);assert.equal(f.restore.getSnapshot().head,null);assert.equal(f.denied(),1);}
});
test('current equal-grant role/session changes reject before applying, including delayed reads after conceal',async t=>{
  for(const patch of [{roleId:'role-b'},{roleCode:'CHANGED'},{sessionKey:'b'.repeat(64)},{permissions:[READ]}]){const f=fixture(t);await f.compare();f.setVerified(patch);await f.sections.requestConfirmation();assert.equal(f.manager.getSnapshot().detail,null);assert.equal(f.calls.filter(c=>c.method==='PATCH').length,0);}
  const f=fixture(t);await f.compare();const wait=deferred();let entered=false;f.controls.override=path=>{if(path==='/client/auth/me'){entered=true;return wait.promise;}};const pending=f.sections.requestConfirmation();for(let i=0;!entered&&i<100;i++)await new Promise(r=>setImmediate(r));assert.equal(entered,true);f.conceal();wait.resolve({id:'member-a',email:null,nickname:'Synthetic'});await pending;assert.equal(f.sections.getSnapshot().head,null);assert.equal(f.manager.getSnapshot().detail,null);
});
