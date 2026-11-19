import assert from 'node:assert/strict';
import test from 'node:test';
import {createServer} from 'node:http';
import {createRemainingClientFixture} from './remaining-client-fixture.mjs';
import {prepareAiCenter} from './ai-center-fixture.mjs';

test('general Agents text/image, existing Trace/budget/files and own-member isolation over real HTTP/PostgreSQL',{timeout:360000},async t=>{
 const f=await createRemainingClientFixture('AF-123',{configuration:true,secrets:true,runtimeManagement:true,storageEnabled:true});
 let server,calls=0,mode='success';const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jfP8AAAAASUVORK5CYII=','base64');
 const opt={cookie:f.cookies[0],workspaceId:f.workspaces[0].id};
 const {JobService}=f.requireApi('async-runtime/job.service.js'),jobs=f.app.get(JobService);
 const {AiCenterRunService}=f.requireApi('plugins/aij-ai/ai-center-run.service.js'),runs=f.app.get(AiCenterRunService);
 const {LocalStorageAdapter}=f.requireApi('files/local-storage.adapter.js');
 const execute=async()=>{const rows=await jobs.claim('af123-worker',1,60000);assert.equal(rows.length,1);await jobs.execute(rows[0]);return rows[0];};
 const submit=async(key,agent='buddy-advice',input={selfType:'ENFP',buddyType:'INTJ'},status=202)=>f.request('POST',`client/ai/agents/${agent}/runs`,{...opt,body:{idempotencyKey:key,input},status});
 try{
  const ai=await prepareAiCenter(f);let catalog=ai.catalog,version=(await ai.save()).data.version;
  await t.test('default-deny, input whitelist, explicit origin and authentication',async()=>{
   await submit('default-deny',undefined,undefined,503);assert.equal(await f.prisma.aiAgentRun.count(),0);
   await f.request('GET','client/ai/agents',{workspaceId:opt.workspaceId,status:401});
   const body={idempotencyKey:'origin-denied',input:{selfType:'ENFP',buddyType:'INTJ'}};
   await f.request('POST','client/ai/agents/buddy-advice/runs',{...opt,body,origin:'https://foreign.invalid',status:403});
   process.env.AI_CENTER_CLIENT_EXECUTION_ENABLED='true';
   await submit('invalid-input','buddy-advice',{selfType:'ENFP',buddyType:'INTJ',provider:'forged'},400);
   assert.equal((await f.request('GET','client/ai/agents',opt)).data.length,2);
  });
  process.env.AI_CENTER_LIVE_ENABLED='true';process.env.AI_CENTER_CLIENT_EXECUTION_ENABLED='true';catalog=structuredClone(catalog);for(const p of catalog.providers)p.liveEnabled=true;version=(await ai.save(catalog,version)).data.version;
  server=createServer(async(req,res)=>{
   calls++;assert.equal(req.headers.authorization,'Bearer '+ai.credential);let raw='';for await(const b of req)raw+=b;const body=JSON.parse(raw);
   res.setHeader('content-type','application/json');
   if(mode==='error'){res.statusCode=503;res.end('{}');return;}
   if(mode==='redirect'){res.statusCode=302;res.setHeader('location','http://127.0.0.1:1/forbidden');res.end('{}');return;}
   if(req.url==='/v1/images/generations'){assert.equal(body.n,1);assert.equal(body.output_format,'png');res.end(JSON.stringify({data:[{b64_json:mode==='bad-image'?Buffer.from('not png').toString('base64'):png.toString('base64')}]}));return;}
   assert.equal(req.url,'/v1/chat/completions');assert.ok(body.messages[0].content.includes('Social')||body.messages[0].content.includes('social'));assert.ok(body.messages[0].content.includes('clinical'));
   res.end(JSON.stringify({model:body.model,choices:[{finish_reason:'stop',message:{content:mode==='json'?' {"suggestion":"Respect boundaries"}':'Ask about shared interests and respect boundaries.'}}],...(mode==='no-usage'?{}:{usage:{prompt_tokens:20,completion_tokens:10,prompt_tokens_details:{cached_tokens:2}}})}));
  });await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const {AiCenterHttpTransport}=f.requireApi('plugins/aij-ai/ai-center-provider.js');
  f.app.get(AiCenterHttpTransport).request=async(url,init)=>{assert.equal(new URL(url).origin,'https://api.openai.com');assert.equal(init.redirect,'error');return fetch(`http://127.0.0.1:${server.address().port}${new URL(url).pathname}`,init);};
  let textRun,imageRun;
  await t.test('durable text with ordered Skill, idempotency and provider usage, no invented cost receipt',async()=>{
   const duplicates=await Promise.all([submit('advice-success'),submit('advice-success')]);textRun=duplicates[0].data;assert.equal(textRun.id,duplicates[1].data.id);const before=await f.prisma.aiEvaluationBudgetReservation.count();
   const replay=(await submit('advice-success')).data;assert.equal(replay.id,textRun.id);assert.equal(await f.prisma.aiEvaluationBudgetReservation.count(),before);
   await submit('advice-success','buddy-advice',{selfType:'INTP',buddyType:'INTJ'},409);
   const claim=await execute();await jobs.execute(claim);assert.equal(calls,1);
   const result=(await f.request('GET',`client/ai/runs/${textRun.id}`,opt)).data;assert.equal(result.status,'succeeded');assert.equal(result.budgetStatus,'settled');assert.equal(result.estimatedCostNanos,'40000');assert.ok(result.output.includes('boundaries'));
   const trace=await f.prisma.aiExecutionTrace.findUniqueOrThrow({where:{jobId_attempt:{jobId:claim.id,attempt:1}}});assert.equal(trace.promptTokens,20);assert.equal(trace.completionTokens,10);assert.equal(trace.cachedTokens,2);assert.equal(trace.costSource,'unreported');assert.equal(trace.costAmountNanos,null);
   assert.equal(JSON.stringify(trace).includes('ENFP'),false);assert.equal(JSON.stringify(trace).includes(ai.credential),false);
  });
  await t.test('image is a private FileAsset and isolated even from another member in the same Workspace',async()=>{
   imageRun=(await submit('image-success','avatar-maker',{mbtiType:'INFP',style:'abstract illustration'})).data;const claim=await execute();
   const result=(await f.request('GET',`client/ai/runs/${imageRun.id}`,opt)).data;assert.equal(result.status,'succeeded');assert.ok(result.imageAssetId);
   const trace=await f.prisma.aiExecutionTrace.findUniqueOrThrow({where:{jobId_attempt:{jobId:claim.id,attempt:1}}});assert.equal(trace.imageCount,1);
   const image=await fetch(f.baseUrl+`/client/ai/runs/${imageRun.id}/image`,{headers:{cookie:opt.cookie,'x-aij-workspace-id':opt.workspaceId}});assert.equal(image.status,200);assert.equal(image.headers.get('content-type'),'image/png');assert.deepEqual(Buffer.from(await image.arrayBuffer()),png);
   await f.request('GET',`client/ai/runs/${imageRun.id}`,{cookie:f.cookies[1],workspaceId:f.workspaces[1].id,status:404});
   const owner=await f.prisma.clientWorkspaceRole.findUniqueOrThrow({where:{workspaceId_code:{workspaceId:opt.workspaceId,code:'OWNER'}}});
   await f.prisma.clientWorkspaceMembership.create({data:{workspaceId:opt.workspaceId,memberId:f.accounts[1].id,roleId:owner.id}});
   await f.request('GET',`client/ai/runs/${imageRun.id}`,{cookie:f.cookies[1],workspaceId:opt.workspaceId,status:404});
   const denied=await fetch(f.baseUrl+`/client/ai/runs/${imageRun.id}/image`,{headers:{cookie:f.cookies[1],'x-aij-workspace-id':opt.workspaceId}});assert.equal(denied.status,404);await denied.text();
  });
  await t.test('changed queued config releases unused budget without calling upstream',async()=>{
   const queued=(await submit('changed-before-start')).data,before=calls;
   catalog=structuredClone(catalog);catalog.agents[0].instructions+=' Keep the answer concise.';version=(await ai.save(catalog,version)).data.version;
   await execute();const result=(await f.request('GET',`client/ai/runs/${queued.id}`,opt)).data;assert.equal(result.status,'failed');assert.equal(result.estimatedCostNanos,'0');assert.equal(result.budgetStatus,'released');assert.equal(calls,before);
  });
  await t.test('upstream failure, redirect, missing usage and invalid image retain reservation; never automatically retry',async()=>{
   for(const next of ['error','redirect','no-usage','bad-image']){mode=next;const queued=(await submit('uncertain-'+next,next==='bad-image'?'avatar-maker':'buddy-advice',next==='bad-image'?{mbtiType:'INFJ',style:'abstract'}:undefined)).data;const claim=await execute();const result=(await f.request('GET',`client/ai/runs/${queued.id}`,opt)).data;assert.equal(result.status,'unknown');assert.equal(result.budgetStatus,'reserved');assert.ok(BigInt(result.estimatedCostNanos)>0n);await jobs.retry(claim.id).catch(()=>undefined);await jobs.execute(claim);}
   mode='success';
  });
  await t.test('structured JSON output and alternate provider model selection',async()=>{
   catalog=structuredClone(catalog);catalog.models.push({...catalog.models[0],code:'alternate-text',providerCode:'image-provider',upstreamModel:'synthetic-alternate-v1'});catalog.agents[0].modelCode='alternate-text';catalog.agents[0].outputFormat='json';catalog.agents[0].outputFields=['suggestion'];version=(await ai.save(catalog,version)).data.version;
   mode='json';const run=(await submit('structured-json')).data;const claim=await execute();const result=(await f.request('GET',`client/ai/runs/${run.id}`,opt)).data;assert.deepEqual(result.output,{suggestion:'Respect boundaries'});
   const trace=await f.prisma.aiExecutionTrace.findUniqueOrThrow({where:{jobId_attempt:{jobId:claim.id,attempt:1}}});assert.equal(trace.providerCode,'image-provider');assert.equal(trace.modelCode,'alternate-text');
   mode='success';catalog.agents[0].modelCode='advice-text';catalog.agents[0].outputFormat='text';catalog.agents[0].outputFields=[];version=(await ai.save(catalog,version)).data.version;
  });
  await t.test('DeepSeek confirmation cannot be bypassed by a compatible-provider alias',async()=>{
   const aliased=structuredClone(catalog);aliased.providers[0].vendor='compatible';aliased.providers[0].baseUrl='https://api.deepseek.com/v1';version=(await ai.save(aliased,version)).data.version;const before=calls;
   await submit('deepseek-unconfirmed',undefined,undefined,503);assert.equal(calls,before);version=(await ai.save(catalog,version)).data.version;
  });
  await t.test('process-loss recovery marks unknown and preserves budget without a second upstream call',async()=>{
   const queued=(await submit('crash-recovery')).data;const run=await f.prisma.aiAgentRun.findUniqueOrThrow({where:{id:queued.id}});const before=calls;
   const {AiExecutionTraceService}=f.requireApi('plugins/aij-ai/ai-execution-trace.service.js');const traces=f.app.get(AiExecutionTraceService);
   const trace=await traces.start({jobId:run.jobId,attempt:1,correlationId:run.jobId,projectId:f.project.id,capabilityCode:'text.generate',input:{}});
   await f.prisma.aiAgentRun.update({where:{id:run.id},data:{status:'running',attemptedAt:new Date()}});await f.prisma.runtimeJob.update({where:{id:run.jobId},data:{status:'dead'}});
   const result=(await f.request('GET',`client/ai/runs/${run.id}`,opt)).data;assert.equal(result.status,'unknown');assert.equal(result.budgetStatus,'reserved');assert.equal((await f.prisma.aiExecutionTrace.findUniqueOrThrow({where:{id:trace.id}})).status,'failed');
   await jobs.retry(run.jobId);await execute();assert.equal(calls,before);
  });
  await t.test('concurrent budget admission, same key and cancellation release are durable',async()=>{
   catalog=structuredClone(catalog);catalog.workspaceMonthlyBudgetNanos='25000000';
   // Use a fresh workspace to keep this cap independent of prior retained ambiguous reservations.
   const fresh=(await f.request('POST','client/workspaces',{cookie:opt.cookie,body:{name:'Synthetic budget concurrency',idempotencyKey:'af123-budget-workspace'},status:201})).data;
   version=(await ai.save(catalog,version)).data.version;
   const responses=await Promise.all(['concurrent-a','concurrent-b'].map(key=>fetch(f.baseUrl+'/client/ai/agents/buddy-advice/runs',{method:'POST',headers:{cookie:opt.cookie,origin:process.env.WEB_URL,'x-aij-workspace-id':fresh.id,'content-type':'application/json'},body:JSON.stringify({idempotencyKey:key,input:{selfType:'ENFP',buddyType:'INTJ'}})})));
   assert.deepEqual(responses.map(r=>r.status).sort(),[202,429]);const accepted=await responses.find(r=>r.status===202).json();await responses.find(r=>r.status===429).text();
   const run=await f.prisma.aiAgentRun.findUniqueOrThrow({where:{id:accepted.data.id}});await jobs.cancel(run.jobId);
   const result=(await f.request('GET',`client/ai/runs/${run.id}`,{cookie:opt.cookie,workspaceId:fresh.id})).data;assert.equal(result.budgetStatus,'released');assert.equal(result.estimatedCostNanos,'0');
  });
  await t.test('seven-day prompt purge preserves image asset and redacted operational usage',async()=>{
   await f.prisma.aiAgentRun.update({where:{id:imageRun.id},data:{expiresAt:new Date(Date.now()-1)}});await runs.cleanup();
   await f.request('GET',`client/ai/runs/${imageRun.id}`,{...opt,status:410});const row=await f.prisma.aiAgentRun.findUniqueOrThrow({where:{id:imageRun.id}});assert.equal(row.input,null);assert.equal(row.snapshot,null);assert.equal(row.output,null);assert.ok(row.imageAssetId);
   const image=await fetch(f.baseUrl+`/client/ai/runs/${imageRun.id}/image`,{headers:{cookie:opt.cookie,'x-aij-workspace-id':opt.workspaceId}});assert.equal(image.status,200);await image.arrayBuffer();
   const usage=(await f.request('GET','admin/ai/center/usage',{token:ai.token})).data;assert.equal(usage.costKind,'internal_estimate');assert.ok(usage.models.some(m=>m.imageCount===1));assert.equal(JSON.stringify(usage).includes('ENFP'),false);assert.equal(JSON.stringify(usage).includes(ai.credential),false);
  });
 }finally{
  if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}
  const assets=await f.prisma.fileAsset.findMany({where:{ownerType:'ai-run'}});for(const a of assets)await f.app.get(LocalStorageAdapter).remove(a.objectKey);
  await f.close();
 }
});
