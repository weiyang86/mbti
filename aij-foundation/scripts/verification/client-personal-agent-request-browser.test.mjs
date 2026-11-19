// Root-only browser primitive acceptance. HTTP admission is a counted synthetic fixture,
// not the product API/PG runtime; those integration checks belong to AF232/AF233.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { w21NativeBrowser } from './w21-native-browser.mjs';

test('AF231 actual same-origin browser tabs use native Web Storage/Web Locks, persist before lost reply, and require fresh terminal ACK', {timeout:120000},async()=>{
 assert.equal(process.env.AIJ_AF231_BROWSER,'true');
 const parent='.artifacts/auto-ai-program-20261105/W25';mkdirSync(parent,{recursive:true});const artifact=mkdtempSync(join(parent,'AF231-browser-'));
 for(const name of ['first','second','reload'])mkdirSync(join(artifact,name));
 const first=w21NativeBrowser(join(artifact,'first')),second=w21NativeBrowser(join(artifact,'second')),reload=w21NativeBrowser(join(artifact,'reload'));let host;
 const agentId='22345678-1234-4234-8234-123456789abc',owner={memberId:'af231-'+randomUUID(),workspaceId:'browser-space'};
 const origin={format:'aij-document-generation-v1',document:{format:'aij-document-section-source-v1',indexFormat:'aij-plain-sections-v1',documentId:'12345678-1234-4234-8234-123456789abc',revision:1,bodySha256:'b'.repeat(64),sectionId:'section-0',start:0,end:12,sectionSha256:'c'.repeat(64)},agentId,agentVersionId:'version-1',agentRevision:3,agentPublicationEpoch:1,catalogVersion:1,modelCode:'text-model',modelRevision:1,instructionSha256:'a'.repeat(64),inputSha256:'e'.repeat(64),maximumEstimatedCostNanos:'9223372036854775807'};
 const legacy={...owner,agentId,revision:3,key:'legacy-original-key',digest:'f'.repeat(64),runId:null,status:'unconfirmed'};
 const fixture={owner,origin,legacy};let admits=0,gets=0,admittedKey=null,status='unknown';const ready=new Map();
 const script=`import {personalJournalKey,parsePersonalJournal,createPersonalRequestJournalStorage,createDocumentGenerationJournal} from '/journal.mjs';
 const fixture=await(await fetch('/fixture.json')).json();const {owner,origin,legacy}=fixture;const bucket=personalJournalKey(owner.memberId);
 const check=v=>{if(!v)throw Error('ASSERTION');};const display=(text)=>document.getElementById('status').textContent=text;
 const config={journalStorage:()=>localStorage,withRecoveryLock:(name,fn)=>navigator.locks.request(name,{mode:'exclusive'},fn),makeKey:()=>crypto.randomUUID()};
 const journal=createDocumentGenerationJournal(config),store=createPersonalRequestJournalStorage(config);const role=new URL(location.href).searchParams.get('role');
 const read=()=>parsePersonalJournal(localStorage.getItem(bucket),owner.memberId);
 const original=async()=>{const entry=await journal.load(owner,new AbortController().signal);check(entry);const response=await fetch('/recover/'+entry.key);check(response.ok);const value=await response.json();return {entry,value};};
 document.getElementById('recover').onclick=async()=>{try{const {entry,value}=await original();await journal.bind(entry,{runId:value.request.id,status:value.request.status,origin:value.origin},new AbortController().signal);display('AF231_RECOVERED_UNKNOWN');}catch{display('AF231_FAIL_RECOVER');}};
 document.getElementById('ack').onclick=async()=>{try{const entry=await journal.load(owner,new AbortController().signal);const ended=await journal.acknowledgeTerminal(entry,async()=>{const response=await fetch('/recover/'+entry.key);check(response.ok);return response.json();},new AbortController().signal);if(ended){check(JSON.stringify(read())===JSON.stringify([legacy]));display('AF231_TERMINAL_ACK');}else{check(read().length===2);display('AF231_UNKNOWN_LOCKED');}}catch{display('AF231_FAIL_ACK');}};
 void(async()=>{try{
  check(isSecureContext&&navigator.locks&&localStorage);document.getElementById('capability').textContent=JSON.stringify({secure:isSecureContext,nativeLocks:typeof navigator.locks.request==='function',localStorage:typeof localStorage.setItem==='function'});
  if(role==='reload'){const before=read();check(before.length===2);journal.suspend();check(journal.getSnapshot(owner)===null);check(JSON.stringify(read())===JSON.stringify(before));display('AF231_RELOAD_NO_POST');return;}
  if(role==='one')localStorage.setItem(bucket,JSON.stringify({version:1,entries:[legacy]}));
  display('AF231_READY');await fetch('/ready/'+role);
  try{await journal.submitOnce({owner,origin,digest:'d'.repeat(64)},async key=>{const response=await fetch('/admit',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({key})});check(response.ok);return response.json();},new AbortController().signal);}catch{}
  const entries=read();check(entries.length===2);check(JSON.stringify(entries.find(e=>!e.family))===JSON.stringify(legacy));const entry=entries.find(e=>e.family);check(entry.attempted&&entry.status==='unconfirmed'&&entry.runId===null);check(!localStorage.getItem(bucket).includes('PRIVATE'));
  // An original-family CAS must preserve the document-family entry in this real browser bucket.
  const selector={family:'personal-agent',workspaceId:owner.workspaceId,agentId:origin.agentId};
  await store.locked(owner.memberId,()=>true,()=>store.compareExchange(owner.memberId,selector,legacy,legacy,()=>true));check(read().find(e=>e.family).key===entry.key);
  display('AF231_TAB_PASS');
 }catch{display('AF231_FAIL_MAIN');}})();`;
 try{
  host=createServer(async(req,res)=>{
   const url=new URL(req.url,'http://127.0.0.1');res.setHeader('cache-control','no-store');
   if(req.method==='GET'&&url.pathname==='/'){res.setHeader('content-type','text/html; charset=utf-8');res.end('<!doctype html><meta charset="utf-8"><title>AF231 owned browser primitive fixture</title><p id="status">Loading</p><pre id="capability"></pre><button id="recover">Recover original metadata</button><button id="ack">Verify terminal state</button><script type="module" src="/fixture.mjs"></script>');return;}
   if(req.method==='GET'&&url.pathname==='/journal.mjs'){res.setHeader('content-type','text/javascript');res.end(readFileSync('apps/web/app/components/client-personal-agent-request-journal.mjs'));return;}
   if(req.method==='GET'&&url.pathname==='/fixture.mjs'){res.setHeader('content-type','text/javascript');res.end(script);return;}
   if(req.method==='GET'&&url.pathname==='/fixture.json'){res.setHeader('content-type','application/json');res.end(JSON.stringify(fixture));return;}
   if(req.method==='GET'&&url.pathname.startsWith('/ready/')){ready.set(url.pathname,res);if(ready.size===2){for(const response of ready.values())response.end('start');ready.clear();}return;}
   if(req.method==='POST'&&url.pathname==='/admit'){
    let raw='';for await(const part of req)raw+=part;const value=JSON.parse(raw);assert.deepEqual(Object.keys(value),['key']);admits++;admittedKey=value.key;
    // Send actual response bytes before dropping the incomplete body. A reset before
    // any response bytes permits browser transport retries and is a different fault.
    res.writeHead(202,{'content-type':'application/json','content-length':'8192'});res.flushHeaders();res.write('{"accepted":');
    setTimeout(()=>res.destroy(),20);return;
   }
   if(req.method==='GET'&&url.pathname.startsWith('/recover/')){
    gets++;assert.equal(url.pathname.split('/').at(-1),admittedKey);res.setHeader('content-type','application/json');
    res.end(JSON.stringify({origin,documentCurrent:false,request:{id:'browser-run',agentCode:'personal:'+agentId,status,budgetStatus:status==='unknown'?'reserved':'settled',createdAt:'2026-11-09T00:00:00.000Z',expiresAt:'2099-11-16T00:00:00.000Z',contentAvailable:false}}));return;
   }
   res.statusCode=404;res.end();
  });
  await new Promise(resolve=>host.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+host.address().port;
  await first.action('create',['--url',base+'/?role=one']);await first.action('snapshot',['--full']);await first.wait('AF231_READY');
  await second.action('create',['--url',base+'/?role=two']);await second.action('snapshot',['--full']);
  await first.wait('AF231_TAB_PASS');await second.wait('AF231_TAB_PASS');assert.equal(admits,1);assert.ok(admittedKey);
  const capabilities=await first.read('JSON.parse(document.getElementById("capability").textContent)');assert.deepEqual(capabilities,{secure:true,nativeLocks:true,localStorage:true});
  await reload.action('create',['--url',base+'/?role=reload']);await reload.action('snapshot',['--full']);await reload.wait('AF231_RELOAD_NO_POST');assert.equal(admits,1);assert.equal(gets,0);
  await first.activate('Recover original metadata');await first.wait('AF231_RECOVERED_UNKNOWN');assert.equal(gets,1);
  await first.activate('Verify terminal state');await first.wait('AF231_UNKNOWN_LOCKED');assert.equal(gets,2);assert.equal(admits,1);
  status='succeeded';await first.activate('Verify terminal state');await first.wait('AF231_TERMINAL_ACK');assert.equal(gets,3);assert.equal(admits,1);
  const proof={task:'AF-231',status:'PASS',actualBrowserContexts:3,capabilities,syntheticAdmissionPosts:admits,freshRecoveryGets:gets,lostReplyPreserved:true,remountNoPost:true,unknownKeptLocked:true,terminalFreshAck:true,otherFamilyPreserved:true,productApiPg:'NOT_RUN_UNCHANGED_DEFERRED_AF232_AF233',ownerAcceptance:'PENDING'};
  writeFileSync(join(artifact,'proof.json'),JSON.stringify(proof,null,2)+'\n');console.log(JSON.stringify(proof));
 }finally{
  await reload.close();await second.close();await first.close();
  if(host){for(const response of ready.values())response.end();host.closeAllConnections();await new Promise(resolve=>host.close(resolve));}
 }
});
