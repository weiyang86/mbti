import assert from 'node:assert/strict';
import test from 'node:test';
import {createRemainingClientFixture} from './remaining-client-fixture.mjs';
import {prepareAiCenter} from './ai-center-fixture.mjs';
test('general AI config saves two providers/models, Agent Skills, validates scope and optimistic versions over HTTP',async()=>{
 const f=await createRemainingClientFixture('AF-122',{configuration:true,secrets:true});
 try{
  const ai=await prepareAiCenter(f);
  const admin=await f.prisma.sysUser.findFirstOrThrow({where:{isSuperAdmin:true}});
  await f.prisma.sysUser.update({where:{id:admin.id},data:{isSuperAdmin:false}});
  await f.request('GET','admin/ai/center/configuration',{token:ai.token,status:403});
  await f.prisma.sysUser.update({where:{id:admin.id},data:{isSuperAdmin:true}});
  await f.request('GET','admin/ai/center/configuration',{status:401});
  assert.equal((await f.request('GET','admin/ai/center/configuration',{token:ai.token})).data.version,0);
  const saved=(await ai.save()).data;assert.equal(saved.catalog.providers.length,2);assert.equal(saved.catalog.agents[0].skillCodes[0],'social-boundaries');
  await ai.save(ai.catalog,0,409);
  const bad=structuredClone(ai.catalog);bad.agents[0].modelCode='missing-model';await ai.save(bad,1,400);
  bad.agents[0].modelCode='advice-text';bad.providers[0].baseUrl='http://127.0.0.1:8080/v1';await ai.save(bad,1,400);
  const foreign=structuredClone(ai.catalog);foreign.providers[0].credentialRef='env://AIJ_SECRET_OTHER_PROJECT_TEST_PROVIDER';await ai.save(foreign,1,403);
  const disabled=structuredClone(ai.catalog);disabled.skills[0].enabled=false;await ai.save(disabled,1,400);
  const change=structuredClone(ai.catalog);change.skills[0].instructions+=' Avoid stereotypes.';
  const updated=(await ai.save(change,1)).data;assert.equal(updated.version,2);assert.equal(updated.catalog.skills[0].revision,2);assert.equal(updated.catalog.models[0].revision,1);
  const audits=await f.prisma.auditLog.findMany({where:{action:'ai_center_configuration_updated'}});assert.equal(audits.length,2);assert.equal(JSON.stringify(audits).includes(ai.credential),false);assert.equal(JSON.stringify(audits).includes(change.skills[0].instructions),false);
  assert.equal(await f.prisma.configurationChange.count({where:{configKey:'ai.center.catalog'}}),2);
  const config=(await f.request('GET','admin/scoped-configs',{token:ai.token,status:200})).data;assert.equal(JSON.stringify(config).includes(ai.ref),false);
  await f.prisma.pluginInstallation.update({where:{projectId_pluginCode:{projectId:f.project.id,pluginCode:'aij-ai'}},data:{status:'installed'}});
  await f.request('GET','admin/ai/center/configuration',{token:ai.token,status:404});
 }finally{await f.close();}
});
