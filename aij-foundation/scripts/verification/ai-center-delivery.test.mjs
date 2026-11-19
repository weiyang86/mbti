import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {join} from 'node:path';
import {createRemainingClientFixture} from './remaining-client-fixture.mjs';
import {prepareAiCenter} from './ai-center-fixture.mjs';
const require=createRequire(join(process.cwd(),'packages/sdk/package.json'));

test('AI center menu/permissions and rebuilt SDK exercise real HTTP; paid entitlement path defaults closed',async()=>{
 const f=await createRemainingClientFixture('AF-124',{aiCenter:true});
 try{
  const ai=await prepareAiCenter(f);assert.equal(f.seed.aiCenter.menus.length,2);await ai.save();
  const menu=(await f.request('GET','admin/menus/my',{token:ai.token})).data;const paths=menu.map(m=>m.path);assert.ok(paths.includes('/auth/ai/center'));assert.ok(paths.includes('/auth/ai/usage'));
  const {createClientApi,createAiClient,ClientRequestFailure}=require('./dist/index.cjs');const api=createClientApi(()=>f.baseUrl);
  const client=createAiClient((path,options={})=>api(path,{...options,headers:{...options.headers,cookie:f.cookies[0],origin:process.env.WEB_URL}}));
  const workspace=f.workspaces[0].id;assert.equal((await client.listAgents(workspace)).length,2);
  await assert.rejects(client.submit(workspace,'buddy-advice',{selfType:'ENFP',buddyType:'INTJ'},'sdk-default-closed'),e=>e instanceof ClientRequestFailure&&e.status===503);
  process.env.AI_CENTER_LIVE_ENABLED='true';process.env.AI_CENTER_CLIENT_EXECUTION_ENABLED='true';const c=structuredClone(ai.catalog);c.providers.forEach(p=>{p.liveEnabled=true;});await ai.save(c,1);
  const run=await client.submit(workspace,'buddy-advice',{selfType:'ENFP',buddyType:'INTJ'},'sdk-real-queue');assert.equal(run.status,'queued');assert.equal((await client.read(workspace,run.id)).id,run.id);assert.equal(client.imagePath(run.id),`/client/ai/runs/${run.id}/image`);
  const {JobService}=f.requireApi('async-runtime/job.service.js');const row=await f.prisma.aiAgentRun.findUniqueOrThrow({where:{id:run.id}});await f.app.get(JobService).cancel(row.jobId);assert.equal((await client.read(workspace,run.id)).budgetStatus,'released');
  await f.prisma.pluginInstallation.update({where:{projectId_pluginCode:{projectId:f.project.id,pluginCode:'aij-ai'}},data:{status:'installed'}});
  const disabled=(await f.request('GET','admin/menus/my',{token:ai.token})).data;assert.ok(!disabled.some(m=>m.path?.startsWith('/auth/ai/')));
  await f.request('GET','admin/ai/center/configuration',{token:ai.token,status:404});
  assert.equal(await f.prisma.aiExecutionTrace.count(),0,'SDK integration never contacts a paid provider');
 }finally{await f.close();}
});
