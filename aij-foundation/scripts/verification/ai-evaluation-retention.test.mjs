import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createRemainingClientFixture } from "./remaining-client-fixture.mjs";
test('AF-118 independent evaluation records expire and purge through real HTTP/AsyncRuntime',{timeout:360000},async t=>{
  const f=await createRemainingClientFixture('AF-118');const [alpha,beta]=f.workspaces;const[cookie,foreign]=f.cookies;
  const options={cookie,workspaceId:alpha.id};const path='client/ai/knowledge/evaluations';let record,question;
  const makeQuestion=async(label,createdAt=new Date())=>f.prisma.aiKnowledgeQuestion.create({data:{workspaceId:alpha.id,memberId:f.accounts[0].id,idempotencyKeyHash:createHash('sha256').update(label).digest('hex'),requestFingerprint:createHash('sha256').update(label).digest('hex'),query:'Synthetic question user@example.test',answer:'Synthetic answer 13800138000',status:'answered',createdAt}});
  try{
    question=await makeQuestion('source');
    const body={questionId:question.id,runKey:'synthetic-run',caseKey:'case-1'};
    await t.test('capture actual terminal question with redaction and immutable case identity',async()=>{
      record=(await f.request('POST',path,{...options,body})).data;
      assert.equal(record.inputText,'Synthetic question [EMAIL]');assert.equal(record.outputText,'Synthetic answer [NUMBER]');
      const replay=(await f.request('POST',path,{...options,body})).data;assert.equal(replay.id,record.id);
      const other=await makeQuestion('other');await f.request('POST',path,{...options,body:{...body,questionId:other.id},status:409});
      assert.equal(await f.prisma.aiEvaluationRecord.count(),1);
    });
    await t.test('anonymous, foreign workspace, forged tenant and origin are rejected',async()=>{
      await f.request('GET',`${path}/${record.id}`,{workspaceId:alpha.id,status:401});
      await f.request('GET',`${path}/${record.id}`,{cookie:foreign,workspaceId:beta.id,status:404});
      await f.request('POST',path,{cookie:foreign,workspaceId:beta.id,body,status:404});
      await f.request('POST',path,{...options,body:{...body,workspaceId:beta.id},status:400});
      await f.request('POST',path,{...options,body,origin:'https://foreign.invalid',status:403});
    });
    await t.test('read denies exact seven-day boundary even before cleanup; late capture cannot extend source retention',async()=>{
      const boundary=new Date(Date.now()-7*86400000);await f.prisma.aiEvaluationRecord.update({where:{id:record.id},data:{createdAt:boundary}});
      const expired=await f.request('GET',`${path}/${record.id}`,{...options,status:410});assert.equal(expired.text.includes('Synthetic question'),false);assert.equal(expired.text.includes('[EMAIL]'),false);
      const old=await makeQuestion('old-source',boundary);await f.request('POST',path,{...options,body:{...body,questionId:old.id,caseKey:'old-case'},status:410});
      assert.equal((await f.prisma.aiEvaluationRecord.findUniqueOrThrow({where:{id:record.id}})).inputText,'Synthetic question [EMAIL]');
    });
    await t.test('real scheduler and worker purge only content; repetition has zero side effects',async()=>{
      const {SchedulerService}=f.requireApi('async-runtime/scheduler.service.js');const {JobService}=f.requireApi('async-runtime/job.service.js');
      const jobs=f.app.get(JobService);await f.app.get(SchedulerService).tick('af118-scheduler',new Date());
      const claimed=await jobs.claim('af118-worker',20,60000);for(const job of claimed)await jobs.execute(job);
      const cleaned=await f.prisma.aiEvaluationRecord.findUniqueOrThrow({where:{id:record.id}});assert.equal(cleaned.inputText,null);assert.equal(cleaned.outputText,null);assert.ok(cleaned.contentPurgedAt);assert.equal(cleaned.questionId,question.id);assert.equal(cleaned.status,'answered');
      const scheduled=await f.prisma.runtimeJob.findFirstOrThrow({where:{jobType:'aij-ai.evaluation-expiry-cleanup'}});assert.equal(scheduled.status,'completed');
      const repeat=await jobs.enqueue({type:'aij-ai.evaluation-expiry-cleanup',version:1,payload:{scheduledAt:new Date().toISOString()},scope:{type:'global',id:'aij-ai'},idempotencyKey:'af118-repeat',maxAttempts:1,timeoutMs:30000});
      const[next]=await jobs.claim('af118-repeat',1,60000);assert.equal(next.id,repeat.id);await jobs.execute(next);
      assert.deepEqual((await f.prisma.runtimeJob.findUniqueOrThrow({where:{id:repeat.id}})).resultReference,{cleanedCount:0});
      await f.request('GET',`${path}/${record.id}`,{...options,status:410});
    });
    await t.test('disabled plugin prevents evaluation reads',async()=>{
      await f.prisma.pluginInstallation.update({where:{projectId_pluginCode:{projectId:f.project.id,pluginCode:'aij-ai'}},data:{status:'installed'}});
      await f.request('GET',`${path}/${record.id}`,{...options,status:404});
    });
  }finally{await f.close();}
});
