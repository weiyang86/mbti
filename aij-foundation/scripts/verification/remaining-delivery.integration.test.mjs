import assert from "node:assert/strict";
import {createServer} from "node:http";
import {randomBytes} from "node:crypto";
import test from "node:test";
import {createRemainingClientFixture} from "./remaining-client-fixture.mjs";
import {LAUNCH_PLUGIN_CODES,assertLaunchPlugins} from "../plugin-launch-policy.mjs";

test('AF-120 delivery integration joins import, runtime answers, evaluation and durable DeepSeek budget',{timeout:360000},async t=>{
  const f=await createRemainingClientFixture('AF-120');const[alpha,beta]=f.workspaces;const[cookie,foreign]=f.cookies;
  const options={cookie,workspaceId:alpha.id};let server,question,evaluation,calls=0;
  const envKey='AIJ_SECRET_AIJ_FOUNDATION_TEST_AF120_PROVIDER_KEY';const syntheticCredential='af120-synthetic-'+randomBytes(24).toString('hex');process.env[envKey]=syntheticCredential;
  const ref='env://'+envKey;
  const setConfig=async(provider,model)=>{
    for(const [configKey,configValue,valueType]of [['ai.providerCode',provider,'string'],['ai.modelCode',model,'string'],['ai.credentialRef',ref,'secretRef'],['capabilities.ai.text.generate','true','boolean']]){
      await f.prisma.scopedConfig.upsert({where:{scope_scopeId_pluginCode_configKey:{scope:'project',scopeId:f.project.id,pluginCode:'aij-ai',configKey}},create:{scope:'project',scopeId:f.project.id,pluginCode:'aij-ai',configKey,configValue,valueType,name:'Synthetic delivery config',sensitive:valueType==='secretRef',isPublic:false},update:{configValue,valueType}});
    }
  };
  try{
    await f.prisma.secretReference.create({data:{ref,provider:'env',description:'Synthetic in-memory test credential only'}});
    await setConfig('offline-knowledge','synthetic-qa-v1');
    await t.test('launcher and API share the actual three trusted plugin registrations',()=>{
      const {resolvePluginModules}=f.requireApi('plugin-runtime/plugin-runtime.module.js');
      assertLaunchPlugins(LAUNCH_PLUGIN_CODES);assert.equal(resolvePluginModules(LAUNCH_PLUGIN_CODES).length,3);
      assert.throws(()=>assertLaunchPlugins(['unknown-plugin']));assert.throws(()=>resolvePluginModules(['unknown-plugin']));
    });
    await t.test('file import becomes real queued answer, source citation and separate evaluation record',async()=>{
      const form=new FormData();form.append('documentCode','integration-guide');form.append('title','Synthetic delivery guide');form.append('file',new Blob(['Aurora guide delivery uses synthetic evidence only.'],{type:'text/plain'}),'integration.txt');
      const doc=(await f.request('POST','client/ai/knowledge/documents/import',{...options,form,status:201})).data;
      question=(await f.request('POST','client/ai/knowledge/questions',{...options,body:{query:'aurora guide delivery',idempotencyKey:'integration-answer'}})).data;assert.equal(question.status,'queued');
      const {JobService}=f.requireApi('async-runtime/job.service.js');const jobs=f.app.get(JobService);
      const claimed=await jobs.claim('af120-knowledge-worker',10,60000);assert.equal(claimed.length,1);await jobs.execute(claimed[0]);
      const answered=(await f.request('GET',`client/ai/knowledge/questions/${question.id}`,options)).data;
      assert.equal(answered.status,'answered');assert.equal(answered.citations[0].documentId,doc.id);assert.ok(answered.answer.includes('synthetic evidence'));
      evaluation=(await f.request('POST','client/ai/knowledge/evaluations',{...options,body:{questionId:question.id,runKey:'delivery-run',caseKey:'case-1'}})).data;assert.equal(evaluation.status,'answered');
      await f.request('GET',`client/ai/knowledge/evaluations/${evaluation.id}`,{cookie:foreign,workspaceId:beta.id,status:404});
    });
    await t.test('production execution, actual SecretRef, Trace and persistent budget run compose over offline HTTP',async()=>{
      await setConfig('deepseek','deepseek-flash');
      const {AiEvaluationBudgetService}=f.requireApi('plugins/aij-ai/ai-evaluation-budget.service.js');
      const {DeepSeekProvider,DEEPSEEK_ENDPOINT}=f.requireApi('plugins/aij-ai/deepseek-provider.js');
      const {AiModelExecutionService}=f.requireApi('plugins/aij-ai/ai-execution.service.js');
      const {AiExecutionTraceService}=f.requireApi('plugins/aij-ai/ai-execution-trace.service.js');
      const {AiProviderRegistry,AiProviderConfigurationPort,AiCapabilityPolicyPort}=f.requireApi('plugins/aij-ai/ai-provider.js');
      const {SecretRefPort}=f.requireApi('secret-center/secret-ref.js');const{PluginRuntimeAccessService}=f.requireApi('plugin-runtime/plugin-runtime-access.service.js');
      const{RuntimeRegistry}=f.requireApi('async-runtime/registry.js');const{JobService}=f.requireApi('async-runtime/job.service.js');
      const policy={projectId:f.project.id,runKey:'af120-synthetic-budget',modelCode:'deepseek-flash',modelVersion:'DeepSeek-V4.1-Flash-1017',priceVersion:'deepseek-flash-2026-11-04',usdCnyMicros:'7200000',maxOutputTokens:2048,expiresAt:new Date(Date.now()+86400000).toISOString()};
      const config={get:k=>({AI_EVALUATION_BUDGET_JSON:JSON.stringify(policy),AI_DEEPSEEK_LIVE_ENABLED:'true',AI_DEEPSEEK_UPSTREAM_CONFIRMED:'true',AI_DEEPSEEK_DATA_CLASS:'synthetic-or-deidentified'})[k]};
      const budget=new AiEvaluationBudgetService(f.prisma,config);
      server=createServer(async(req,res)=>{calls++;assert.equal(req.headers.authorization,'Bearer '+syntheticCredential);for await(const chunk of req){assert.ok(chunk.byteLength > 0);}res.setHeader('content-type','application/json');res.end(JSON.stringify({model:'deepseek-flash',choices:[{finish_reason:'stop',message:{content:JSON.stringify({answer:'Synthetic HTTP answer'})}}],usage:{prompt_tokens:64,completion_tokens:8,total_tokens:72,prompt_cache_hit_tokens:0,prompt_cache_miss_tokens:64}}));});
      await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}`;
      const provider=new DeepSeekProvider(config,budget,async(endpoint,init)=>{assert.equal(endpoint,DEEPSEEK_ENDPOINT);return fetch(url,init);});
      const registry=new RuntimeRegistry();const plugins=f.app.get(PluginRuntimeAccessService);const jobs=new JobService(f.prisma,registry,plugins);
      const execution=new AiModelExecutionService(f.prisma,plugins,jobs,registry,f.app.get(AiCapabilityPolicyPort),f.app.get(AiProviderConfigurationPort),budget,f.app.get(SecretRefPort),new AiProviderRegistry([provider]),f.app.get(AiExecutionTraceService));execution.onModuleInit();
      const input={capabilityCode:'text.generate',payload:{query:'synthetic evaluation',evidence:[{documentId:'synthetic-source',title:'Synthetic source',excerpt:'Synthetic evidence only.'}]}};
      const submitted=await execution.submit(input,{idempotencyKey:'af120-budgeted-call'});const[claimed]=await jobs.claim('af120-provider-worker',1,60000);assert.equal(claimed.id,submitted.id);await jobs.execute(claimed);
      assert.equal((await f.prisma.runtimeJob.findUniqueOrThrow({where:{id:submitted.id}})).status,'completed');assert.equal(calls,1);
      const trace=await f.prisma.aiExecutionTrace.findUniqueOrThrow({where:{jobId_attempt:{jobId:submitted.id,attempt:1}}});assert.equal(trace.providerCode,'deepseek');assert.equal(trace.status,'succeeded');assert.equal(trace.costSource,'unreported');assert.equal(trace.costAmountNanos,null);
      const reservation=await f.prisma.aiEvaluationBudgetReservation.findUniqueOrThrow({where:{id:trace.id}});assert.equal(reservation.status,'settled');assert.equal(reservation.chargedNanos,budget.estimate(policy,64,8));
      assert.equal(JSON.stringify(trace).includes(syntheticCredential),false);
      await f.prisma.aiEvaluationBudgetRun.update({where:{id:reservation.runId},data:{usedNanos:10000000000n}});
      const count=await f.prisma.runtimeJob.count();await assert.rejects(execution.submit(input,{idempotencyKey:'af120-cap-denial'}),e=>e.getStatus()===429);assert.equal(await f.prisma.runtimeJob.count(),count);assert.equal(calls,1);
    });
    await t.test('disabling plugin prevents new imports without creating content or files',async()=>{
      await f.prisma.pluginInstallation.update({where:{projectId_pluginCode:{projectId:f.project.id,pluginCode:'aij-ai'}},data:{status:'installed'}});
      const count=await f.prisma.aiKnowledgeDocument.count();const form=new FormData();form.append('documentCode','disabled-import');form.append('title','Synthetic disabled');form.append('file',new Blob(['Synthetic disabled content'],{type:'text/plain'}),'disabled.txt');
      await f.request('POST','client/ai/knowledge/documents/import',{...options,form,status:404});assert.equal(await f.prisma.aiKnowledgeDocument.count(),count);assert.equal(await f.prisma.fileAsset.count(),0);
    });
  }finally{if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}await f.close();}
});
