import assert from 'node:assert/strict';
import test from 'node:test';
import {createRemainingClientFixture} from './remaining-client-fixture.mjs';

test('AI lifecycle, health and independent lease admission reject stale/reentrant execution and recover',async()=>{
 const f=await createRemainingClientFixture('AF-121');
 try {
  const {PluginManagementModule}=f.requireApi('plugin-runtime/plugin-management.module.js');
  const catalog=PluginManagementModule.forRoot().providers.find(p=>p.provide?.name==='PluginCatalog').useValue;
  assert.ok(catalog.list().some(p=>p.code==='aij-ai'));
  const {RuntimeHealthService}=f.requireApi('async-runtime/runtime-health.service.js');
  const health=f.app.get(RuntimeHealthService);
  health.worker={status:'running',instanceId:'fixture',lastPollAt:new Date(Date.now()-3600000),lastError:null};
  health.scheduler={...health.worker};assert.equal((await health.snapshot()).ready,false);
  health.worker.lastPollAt=new Date();health.scheduler.lastPollAt=new Date();assert.equal((await health.snapshot()).ready,true);
  health.worker.lastError='synthetic';assert.equal((await health.snapshot()).ready,false);
  const {RuntimeRegistry}=f.requireApi('async-runtime/registry.js');
  const {JobService}=f.requireApi('async-runtime/job.service.js');
  const {PluginRuntimeAccessService}=f.requireApi('plugin-runtime/plugin-runtime-access.service.js');
  const registry=new RuntimeRegistry();let calls=0,release,entered;
  const barrier=new Promise(r=>{release=r;});const started=new Promise(r=>{entered=r;});
  registry.registerOrchestratedJob('test.fencing',1,async()=>{calls++;entered();await barrier;return{resultReference:{ok:true}};});
  const jobs=new JobService(f.prisma,registry,f.app.get(PluginRuntimeAccessService));
  const second=new JobService(f.prisma,registry,f.app.get(PluginRuntimeAccessService));
  const job=await jobs.enqueue({type:'test.fencing',version:1,payload:{},scope:{type:'global',id:'test-fencing'},idempotencyKey:'lease',maxAttempts:3,timeoutMs:10000});
  const [oldClaim]=await jobs.claim('old',1,1000);
  await f.prisma.runtimeJob.update({where:{id:job.id},data:{leaseExpiresAt:new Date(Date.now()-1000)}});
  const [newClaim]=await jobs.claim('new',1,1000);assert.equal(newClaim.attempts,2);
  await jobs.execute(oldClaim);assert.equal(calls,0);
  const work=jobs.execute(newClaim);await started;
  await second.execute(newClaim);assert.equal(calls,1);release();await work;
  assert.equal((await f.prisma.runtimeJob.findUniqueOrThrow({where:{id:job.id}})).status,'completed');
  await jobs.execute(newClaim);assert.equal(calls,1);
  const opt={cookie:f.cookies[0],workspaceId:f.workspaces[0].id};
  await f.prisma.pluginInstallation.update({where:{projectId_pluginCode:{projectId:f.project.id,pluginCode:'aij-ai'}},data:{status:'installed'}});
  await f.request('GET','client/ai/knowledge/documents',{...opt,status:404});
  await f.request('POST','client/ai/knowledge/documents',{...opt,body:{documentCode:'disabled',title:'Synthetic',content:'Synthetic'},status:404});
  await f.request('POST','client/ai/knowledge/query',{...opt,body:{query:'Synthetic'},status:404});
  await f.prisma.pluginInstallation.update({where:{projectId_pluginCode:{projectId:f.project.id,pluginCode:'aij-ai'}},data:{status:'enabled'}});
  await f.request('GET','client/ai/knowledge/documents',opt);
 }finally{await f.close();}
});
