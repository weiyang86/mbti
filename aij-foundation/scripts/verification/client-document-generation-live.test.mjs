// Root-only actual public SDK + guarded original access + controller + sole journal.
// Product API/Auth/PG/JobService/Trace are real; only the counted provider is local synthetic HTTP.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import ts from 'typescript';
import * as sdk from '../../packages/sdk/dist/index.mjs';
import { createDocumentGenerationController } from '../../apps/web/app/components/client-document-generation-state.mjs';
import { createDocumentGenerationJournal, personalJournalKey } from '../../apps/web/app/components/client-personal-agent-request-journal.mjs';
import { createWorkflowRuntimeFixture } from './personal-workflow-runtime-fixture.mjs';

function loadTypescript(path) {
 const exports={};const code=ts.transpileModule(readFileSync(path,'utf8'),{fileName:resolve(path),compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 new Function('require','exports',code)(name=>{assert.equal(name,'@aij/sdk');return sdk;},exports);return exports;
}
const accessModule=loadTypescript('apps/web/app/components/client-document-access.ts');
const generationModule=loadTypescript('apps/web/app/components/client-document-generation-access.ts');
const signal=()=>new AbortController().signal;

test('AF232 real controller current-source preview, shared-journal once admission, original-key lost reply and read-only/current refusals', {timeout:540000}, async()=>{
 assert.equal(process.env.AIJ_AF232_ROOT_ACCEPTANCE,'true');
 const parent='.artifacts/auto-ai-program-20261105/W25';mkdirSync(parent,{recursive:true});const artifact=mkdtempSync(join(parent,'AF232-live-'));
 let f,relay,failure,phase='SETUP',dropNext=false,cookie,identity=null,saved=null,documentScope=null,active=true,denials=0;
 const controllers=[],proof=[],forwarded=[];let admissionPosts=0;
 try {
  f=await createWorkflowRuntimeFixture('AF-232');assert.equal(f.lease.task,'AF-232');assert.match(f.lease.database,/af232/i);cookie=f.cookies[0];
  const agent=await f.request('POST','client/ai/personal-agents',{status:201,body:{...f.content,code:'generation-controller-agent',inputFields:['source','instruction']}});
  const publication=await f.request('GET',`client/ai/personal-agents/${agent.id}/publication`);
  await f.request('POST',`client/ai/personal-agents/${agent.id}/publication/publish`,{body:{expectedAgentRevision:publication.revision,expectedPublicationVersion:publication.publicationVersion}});
  const document=await f.request('POST','client/documents',{status:201,body:{code:'controller-'+randomUUID(),name:'Private saved source',body:'# Source\r\nSYNTHETIC_CONTROLLER_SOURCE\r\n'}});
  relay=createServer(async(req,res)=>{
   try {
    const url=new URL(req.url,'http://127.0.0.1');assert.ok(url.pathname.startsWith('/api/client/'));assert.ok(['GET','POST'].includes(req.method));
    const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=Buffer.concat(chunks);
    const response=await fetch(f.baseUrl+url.pathname.slice(4)+url.search,{method:req.method,headers:{cookie,origin:process.env.WEB_URL,'x-aij-workspace-id':f.workspace,connection:'close',...(body.length?{'content-type':'application/json'}:{})},body:body.length?body:undefined,signal:AbortSignal.timeout(20000)});
    const bytes=Buffer.from(await response.arrayBuffer());forwarded.push({method:req.method,path:url.pathname,status:response.status});
    if(req.method==='POST'&&url.pathname==='/api/client/ai/document-generations')admissionPosts++;
    const headers={'content-type':'application/json','cache-control':response.headers.get('cache-control')??'private, no-store'};
    if(dropNext&&req.method==='POST'&&url.pathname==='/api/client/ai/document-generations'&&response.status===202){dropNext=false;res.writeHead(202,{...headers,'content-length':String(bytes.length)});res.flushHeaders();res.write(bytes.subarray(0,8));setTimeout(()=>res.destroy(),20);return;}
    res.writeHead(response.status,headers);res.end(bytes);
   }catch{if(!res.headersSent)res.writeHead(500);res.end();}
  });
  await new Promise(resolve=>relay.listen(0,'127.0.0.1',resolve));const raw=sdk.createClientApi(()=>'http://127.0.0.1:'+relay.address().port+'/api');
  const access=accessModule.createDocumentAccess(raw);
  const readScope=async(workspaceId,signal)=>{
   const p=await raw('/client/auth/me',{signal}),c=await raw('/client/workspaces/context',{workspaceId,signal});await raw('/client/documents?limit=1',{workspaceId,signal});
   const permissions=[...c.permissions].sort();return {workspaceId,memberId:p.id,roleId:c.roleId,roleCode:c.roleCode,sessionKey:c.sessionGeneration,validationKey:JSON.stringify([c.roleId,c.roleCode,permissions]),permissions};
  };
  const deny=()=>{denials++;identity=null;saved=null;access.clear();for(const controller of controllers)controller.suspend();};
  access.setHandlers(readScope,deny);
  const documents=sdk.createPersonalDocumentsClient(access.request),sections=sdk.createPersonalDocumentSectionsClient(access.request);
  const refresh=async()=>{
   documentScope=await readScope(f.workspace,signal());access.setScope(documentScope);
   identity={memberId:documentScope.memberId,workspaceId:documentScope.workspaceId,roleId:documentScope.roleId,roleCode:documentScope.roleCode,sessionGeneration:documentScope.sessionKey,permissions:documentScope.permissions,validationKey:documentScope.validationKey};
   const head=await documents.get(f.workspace,document.id,signal()),index=await sections.get(f.workspace,document.id,head.revision,signal());
   saved=await generationModule.buildDocumentGenerationSource(identity,head,index,'section-0');
   for(const controller of controllers)controller.setContext(JSON.stringify([identity,saved.pin]));
  };
  await refresh();
  const values=new Map(),storage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)},lock=(name,fn)=>navigator.locks.request(name,{mode:'exclusive'},fn);
  const makeController=()=>{
   const journal=createDocumentGenerationJournal({journalStorage:()=>storage,withRecoveryLock:lock});
   const ports=generationModule.createDocumentGenerationAccess({request:access.request,peekAuth:()=>identity,peekSaved:()=>saved,isActive:()=>active,onScopeRejected:deny});
   const controller=createDocumentGenerationController({...ports,journal,timeoutMs:20000});controllers.push(controller);controller.setContext(JSON.stringify([identity,saved.pin]));return controller;
  };
  const prepare=async controller=>{await controller.loadAgents(false);assert.equal(controller.getSnapshot().issue,'');await controller.selectAgent(agent.id);assert.equal(controller.getSnapshot().availability,'ready');controller.setInstruction('Revise the complete selected section.');await controller.preview();assert.ok(controller.getSnapshot().preview);await controller.requestConfirmation();assert.equal(controller.getSnapshot().confirmation,true);controller.setAcknowledged(true);};
  const counts=async()=>({runs:await f.prisma.aiAgentRun.count(),jobs:await f.prisma.runtimeJob.count(),reservations:await f.prisma.aiEvaluationBudgetReservation.count(),origins:await f.prisma.aiPersonalDocumentRunOrigin.count(),traces:await f.prisma.aiExecutionTrace.count(),calls:f.state.calls});
  const first=makeController(),second=makeController(),before=await counts();
  phase='PREVIEW_AND_ONCE';await prepare(first);await prepare(second);assert.deepEqual(await counts(),before);
  await Promise.all([first.confirmSubmit(),second.confirmSubmit()]);assert.equal(admissionPosts,1);let after=await counts();
  for(const key of ['runs','jobs','reservations','origins'])assert.equal(after[key],before[key]+1);assert.equal(after.calls,before.calls);assert.equal(after.traces,before.traces);
  assert.equal(first.getSnapshot().run?.run.output??null,null);await f.execute();await first.recover();await first.readResult();assert.equal(first.getSnapshot().run?.run.output,'WORKFLOW_SYNTHETIC_OUTPUT');
  after=await counts();assert.equal(after.calls,before.calls+1);assert.equal(after.traces,before.traces+1);assert.equal((await documents.get(f.workspace,document.id)).revision,1);
  proof.push({case:'two_real_controllers_shared_original_journal_one_run_job_reservation_origin_trace_counted_provider',previewNoWrites:true,admissionPosts:1,documentRevision:1});
  await first.acknowledgeRecovery();assert.equal(first.getSnapshot().recoveryPending,false);second.suspend();second.setContext(JSON.stringify([identity,saved.pin]));
  phase='LOST_REPLY';await prepare(first);dropNext=true;const beforeLost=await counts();await first.confirmSubmit();assert.equal(first.getSnapshot().recoveryPending,true);assert.equal(first.getSnapshot().run,null);assert.equal(admissionPosts,2);
  after=await counts();assert.equal(after.runs,beforeLost.runs+1);assert.equal(after.jobs,beforeLost.jobs+1);const original=JSON.parse(storage.getItem(personalJournalKey(f.member))).entries.find(e=>e.family==='document-generation');assert.equal(original.status,'unconfirmed');assert.equal(original.runId,null);
  first.suspend();await refresh();const beforeRecover=admissionPosts;await first.recover();assert.equal(first.getSnapshot().recovery?.request.status,'queued');assert.equal(admissionPosts,beforeRecover);await f.execute();await first.recover();await first.readResult();assert.equal(first.getSnapshot().run?.run.output,'WORKFLOW_SYNTHETIC_OUTPUT');
  proof.push({case:'actual_product_committed_202_partial_body_disconnect_then_original_key_GET_without_resend',persistedKey:true,extraPosts:0});
  phase='READ_ONLY';await f.setGrant('workspace.ai.execute',false);await f.setGrant('workspace.documents.manage',false);await refresh();await first.recover();await first.readResult();assert.equal(first.getSnapshot().run?.run.output,'WORKFLOW_SYNTHETIC_OUTPUT');assert.equal(admissionPosts,2);
  const priorSession=identity.sessionGeneration,login=await f.loginAgain();cookie=login.cookie;await refresh();assert.notEqual(identity.sessionGeneration,priorSession);
  await first.recover();await first.readResult();assert.equal(first.getSnapshot().run?.run.output,'WORKFLOW_SYNTHETIC_OUTPUT');assert.equal(admissionPosts,2);
  proof.push({case:'actual_new_session_recovers_previous_session_origin_under_current_read_only_auth',noResubmit:true});
  await first.acknowledgeRecovery();await first.loadAgents(false);await first.selectAgent(agent.id);assert.equal(first.getSnapshot().availability,'ready');first.setInstruction('Read-only quote');await first.preview();assert.ok(first.getSnapshot().preview);assert.equal(first.getSnapshot().allowed.includes('confirm'),false);
  proof.push({case:'actual_read_only_three_grants_recover_read_and_preview_without_legacy_execute_only_endpoint',noWriteGrants:true});
  await f.setGrant('workspace.ai.execute',true);await f.setGrant('workspace.documents.manage',true);await refresh();
  phase='DEFAULT_OFF';process.env.AI_CENTER_CLIENT_EXECUTION_ENABLED='false';await first.loadAgents(false);await first.selectAgent(agent.id);first.setInstruction('No execution configured');await first.preview();assert.equal(first.getSnapshot().preview?.modelExecutionConfigured,false);assert.equal(first.getSnapshot().allowed.includes('confirm'),false);assert.equal(admissionPosts,2);process.env.AI_CENTER_CLIENT_EXECUTION_ENABLED='true';
  proof.push({case:'actual_execution_off_still_preview_no_submit',configured:false});
  phase='SOURCE_AND_SCOPE_REFUSAL';const oldSaved=saved;await f.request('PATCH','client/documents/'+document.id,{cookie,body:{expectedRevision:1,name:document.name,body:document.body+'External revision\r\n'}});await first.preview();assert.equal(first.getSnapshot().run,null);assert.equal(first.getSnapshot().preview,null);assert.equal(admissionPosts,2);assert.equal(saved,oldSaved);
  await refresh();const currentPub=await f.request('GET',`client/ai/personal-agents/${agent.id}/publication`,{cookie});
  const unpublished=await f.request('POST',`client/ai/personal-agents/${agent.id}/publication/unpublish`,{cookie,body:{expectedAgentRevision:currentPub.revision,expectedPublicationVersion:currentPub.publicationVersion}});
  await first.loadAgents(false);await first.selectAgent(agent.id);assert.equal(first.getSnapshot().availability,'unpublished');assert.equal(first.getSnapshot().allowed.includes('preview'),false);assert.equal(admissionPosts,2);
  await f.request('POST',`client/ai/personal-agents/${agent.id}/publication/publish`,{cookie,body:{expectedAgentRevision:unpublished.revision,expectedPublicationVersion:unpublished.publicationVersion}});
  proof.push({case:'actual_agent_unpublish_prevents_new_preview_and_submit',admissionPosts:2});
  await f.setGrant('workspace.ai.assets.read',false);await first.selectAgent(agent.id);assert.ok(denials>0);assert.equal(identity,null);assert.equal(first.getSnapshot().contextKey,null);assert.equal(first.getSnapshot().source,null);assert.equal(second.getSnapshot().source,null);assert.equal(admissionPosts,2);
  proof.push({case:'actual_revision_and_grant_refusal_clear_output_and_current_parent_children',parentCleared:true,admissionPosts:2});
  await f.setGrant('workspace.ai.assets.read',true);await refresh();await first.loadAgents(false);await first.selectAgent(agent.id);first.setInstruction('Session denial');
  await f.request('POST','client/auth/logout',{cookie});await first.preview();assert.equal(identity,null);assert.equal(first.getSnapshot().source,null);assert.equal(second.getSnapshot().source,null);assert.equal(admissionPosts,2);
  proof.push({case:'actual_current_session_revocation_clears_parent_and_children',noResubmit:true});
  const rawJournal=storage.getItem(personalJournalKey(f.member));for(const secret of ['SYNTHETIC_CONTROLLER_SOURCE','Revise the complete','WORKFLOW_SYNTHETIC_OUTPUT'])assert.ok(!rawJournal.includes(secret));
  active=false;for(const controller of controllers)controller.suspend();assert.equal(forwarded.filter(x=>x.method==='PATCH').length,0);
  writeFileSync(join(artifact,'proof.json'),JSON.stringify({task:'AF-232',status:'PASS',phase,proof,ownerAcceptance:'PENDING',nativeDocumentPage:'NOT_RUN_AF233',forwarded},null,2)+'\n');
 }catch(error){failure=error;writeFileSync(join(artifact,'failure.json'),JSON.stringify({phase,name:error.name,message:error.message,status:error.status,proof,admissionPosts,forwarded},null,2)+'\n');throw error;}
 finally{
  for(const controller of controllers)controller.dispose();
  if(relay){relay.closeAllConnections();await new Promise(resolve=>relay.close(resolve));}
  if(f){const closed=await f.close();assert.equal(closed.applicationPools,0);assert.equal(closed.ownedSockets,0);assert.equal(closed.providerClosed,true);writeFileSync(join(artifact,'cleanup.json'),JSON.stringify({phase,failed:Boolean(failure),applicationPools0:true,ownedSockets0:true,providerClosed:true})+'\n');}
 }
});
