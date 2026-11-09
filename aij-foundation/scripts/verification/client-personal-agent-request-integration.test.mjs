import assert from 'node:assert/strict';
import test from 'node:test';
import { createPersonalAgentRun, parsePersonalJournal, personalJournalKey, personalRunIssue } from '../../apps/web/app/components/client-personal-agent-run-state.mjs';
import { createDocumentGenerationJournal, PersonalRequestJournalError } from '../../apps/web/app/components/client-personal-agent-request-journal.mjs';
import { createPersonalAgentRunPreviewsClient, createPersonalAgentRunsClient, createAiClient, createAiRunRecoveryClient, createPersonalAgentsClient } from '../../packages/sdk/dist/index.mjs';

const agentId='22345678-1234-4234-8234-123456789abc', memberId='mixed-owner',workspaceId='mixed-space',owner={memberId,workspaceId};
const origin={format:'aij-document-generation-v1',document:{format:'aij-document-section-source-v1',indexFormat:'aij-plain-sections-v1',documentId:'12345678-1234-4234-8234-123456789abc',revision:1,bodySha256:'b'.repeat(64),sectionId:'section-0',start:0,end:12,sectionSha256:'c'.repeat(64)},agentId,agentVersionId:'version-1',agentRevision:3,agentPublicationEpoch:1,catalogVersion:1,modelCode:'text-model',modelRevision:1,instructionSha256:'a'.repeat(64),inputSha256:'e'.repeat(64),maximumEstimatedCostNanos:'123'};
const documentEntry={memberId,workspaceId,agentId,revision:3,key:'document-original-key',digest:'d'.repeat(64),runId:null,status:'unconfirmed',family:'document-generation',origin,attempted:true};
const run={id:'legacy-run',agentCode:`personal:${agentId}`,status:'succeeded',budgetStatus:'settled',output:'LEGACY_PRIVATE_OUTPUT',failureCode:null,estimatedCostNanos:'1',imageAssetId:null,createdAt:'2026-11-09T00:00:00.000Z',expiresAt:'2099-11-16T00:00:00.000Z'};
function fixture(initial=[documentEntry]) {
 const map=new Map([[personalJournalKey(memberId),JSON.stringify({version:1,entries:initial})]]),calls=[];
 const storage={getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,value)},withRecoveryLock=(name,fn)=>navigator.locks.request(name,{mode:'exclusive'},fn);
 const request=async(path,options={})=>{
  calls.push({path,...options});
  if(path==='/client/auth/me')return {id:memberId};
  if(path.startsWith('/client/workspaces?'))return {total:1,items:[{workspace:{id:workspaceId,name:'Space'},role:{name:'Owner'}}]};
  if(path==='/client/workspaces/context')return {workspaceId,workspaceName:'Space',permissions:['workspace.ai.execute','workspace.ai.assets.read','workspace.ai.read']};
  if(path.startsWith('/client/ai/personal-agents?'))return {items:[{id:agentId,revision:3,enabled:true}],nextCursor:null};
  if(path.includes('/run-preview?'))return {personalAgentId:agentId,code:'own-agent',name:'Agent',revision:3,inputFields:['question'],outputFormat:'text',outputFields:[],capability:'text',modelCode:'text-model',modelRevision:1,catalogVersion:1,maximumEstimatedCostNanos:'123',modelExecutionConfigured:true};
  if(path.endsWith('/runs')&&options.method==='POST'){assert.equal(JSON.parse(options.body).idempotencyKey,'legacy-submit-key');return run;}
  if(path.endsWith('/run-requests/legacy-submit-key'))return Object.fromEntries([...Object.entries(run).filter(([key])=>['id','agentCode','status','budgetStatus','createdAt','expiresAt'].includes(key)),['contentAvailable',true]]);
  if(path==='/client/ai/runs/legacy-run')return run;
  assert.fail('Unexpected legacy route '+path);
 };
 const controller=createPersonalAgentRun({agentId,request,previewsClientFactory:createPersonalAgentRunPreviewsClient,runsClientFactory:createPersonalAgentRunsClient,aiClientFactory:createAiClient,recoveryClientFactory:createAiRunRecoveryClient,agentsClientFactory:createPersonalAgentsClient,journalStorage:()=>storage,withRecoveryLock,makeKey:()=> 'legacy-submit-key'});
 return {controller,storage,calls,withRecoveryLock,entries:()=>parsePersonalJournal(storage.getItem(personalJournalKey(memberId)),memberId)};
}
test('original exports share the actual journal error and parser implementation',()=>{
 assert.equal(personalRunIssue(new PersonalRequestJournalError()).kind,'storage');
 assert.deepEqual(parsePersonalJournal(JSON.stringify({version:1,entries:[documentEntry]}),memberId),[documentEntry]);
});
test('actual original controller never routes document entry to generic GET and retains it across legacy submit and ACK',async()=>{
 const f=fixture();try{
  await f.controller.start(workspaceId);assert.equal(f.controller.getSnapshot().journal,null);
  assert.equal(f.calls.filter(c=>c.path.includes('/run-requests/')||c.path.startsWith('/client/ai/runs/')).length,0);
  f.controller.setInput('question','LEGACY_PRIVATE_INPUT');f.controller.requestConfirmation();await f.controller.confirmSubmit();
  assert.equal(f.calls.filter(c=>c.method==='POST').length,1);assert.equal(f.controller.getSnapshot().run.id,'legacy-run');
  const entries=f.entries();assert.equal(entries.length,2);assert.deepEqual(entries.find(e=>e.family),documentEntry);assert.equal(Object.keys(entries.find(e=>!e.family)).length,8);
  await f.controller.newTask();assert.deepEqual(f.entries(),[documentEntry]);
  const raw=f.storage.getItem(personalJournalKey(memberId));assert.ok(!raw.includes('PRIVATE'));assert.equal(f.controller.getSnapshot().journal,null);
 }finally{f.controller.dispose();}
});
test('legacy recovery uses only its original key and mixed-family CAS preserves document metadata',async()=>{
 const legacy={memberId,workspaceId,agentId,revision:3,key:'legacy-submit-key',digest:'f'.repeat(64),runId:null,status:'unconfirmed'};
 const f=fixture([documentEntry,legacy]);try{
  await f.controller.start(workspaceId);assert.equal(f.controller.getSnapshot().run.output,'LEGACY_PRIVATE_OUTPUT');
  assert.deepEqual(f.calls.filter(c=>c.path.includes('/run-requests/')).map(c=>c.path),['/client/ai/run-requests/legacy-submit-key']);
  assert.deepEqual(f.entries().find(e=>e.family),documentEntry);await f.controller.newTask();assert.deepEqual(f.entries(),[documentEntry]);
 }finally{f.controller.dispose();}
});
test('document port does not borrow legacy identity and unknown ACK retains both families',async()=>{
 const legacy={memberId,workspaceId,agentId,revision:3,key:'legacy-submit-key',digest:'f'.repeat(64),runId:null,status:'unconfirmed'};
 const f=fixture([legacy]);const journal=createDocumentGenerationJournal({journalStorage:()=>f.storage,withRecoveryLock:f.withRecoveryLock,makeKey:()=>documentEntry.key});let sends=0;
 try{
  await assert.rejects(journal.submitOnce({owner,origin,digest:'d'.repeat(64)},async()=>{sends++;throw Error('Synthetic lost reply');},new AbortController().signal));
  assert.equal(sends,1);assert.equal(f.entries().length,2);assert.deepEqual(f.entries().find(e=>!e.family),legacy);
  const entry=await journal.load(owner,new AbortController().signal);assert.equal(entry.key,documentEntry.key);
  await f.controller.start(workspaceId);assert.equal(sends,1);assert.deepEqual(f.entries().find(e=>e.family),entry);
 }finally{journal.suspend();f.controller.dispose();}
});
