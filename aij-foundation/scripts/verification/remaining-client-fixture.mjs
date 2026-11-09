import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createAcceptance, migrate } from "../database/migration.mjs";
import { clientEnvironment, prepareClientFixture } from "./client-auth-fixture.mjs";
const require=createRequire(join(process.cwd(),'apps/api/package.json'));
async function createLegacyRemainingClientFixture(task, options = {}) {
  const lease=await createAcceptance('test',task);
  assert.equal((await migrate({mode:'test',action:'deploy',acceptanceId:lease.id})).exitCode,0);
  assert.equal((await migrate({mode:'test',action:'status',acceptanceId:lease.id})).exitCode,0);
  const fixture=await prepareClientFixture(lease.id,task,options);
  const secrets=JSON.parse(await readFile(fixture.accounts[0].initialPasswordFile,'utf8'));
  // Resolve the allowlisted environment before clearing the caller's PATH/HOME.
  // clientEnvironment also checks owned key files through a git subprocess.
  const applicationEnvironment=clientEnvironment(lease.id,task);
  const previous={...process.env};for(const key of Object.keys(process.env))delete process.env[key];
  Object.assign(process.env,applicationEnvironment,{ASYNC_RUNTIME_ENABLED:'false',ENABLED_PLUGINS:'aij-ai',AIJ_TEST_AI_PROVIDER_MODE:'offline-knowledge',...(options.storageEnabled?{STORAGE_ENABLED:'true'}:{})});
  const {createApplication}=require('../../apps/api/dist/bootstrap.js');
  const {PrismaService}=require('../../apps/api/dist/prisma/prisma.service.js');
  if (options.testKnowledgeWebImportTransport !== undefined) assert.ok(['AF-179', 'AF-181', 'AF-182', 'AF-189'].includes(task));
  const app=await createApplication({testKnowledgeWebImportTransport:options.testKnowledgeWebImportTransport,testBrowserOrigin:options.testBrowserOrigin});await app.listen(0,'127.0.0.1');
  const baseUrl=`http://127.0.0.1:${app.getHttpServer().address().port}/api`;
  const requestOrigin=options.testBrowserOrigin??process.env.WEB_URL;
  const request=async(method,path,{token,cookie,workspaceId,body,form,status=200,origin=requestOrigin}={})=>{
    const response=await fetch(baseUrl+'/'+path,{method,headers:{connection:'close',...(token?{authorization:'Bearer '+token}:{}),...(cookie?{cookie}:{}),...(workspaceId?{'x-aij-workspace-id':workspaceId}:{}),...(origin?{origin}:{}),...(body===undefined?{}:{'content-type':'application/json'})},body:form??(body===undefined?undefined:JSON.stringify(body)),signal:AbortSignal.timeout(15000)});
    const text=await response.text();assert.equal(response.status,status,`${method} ${path}: ${text}`);return{text,response,data:text?JSON.parse(text).data:null};
  };
  const cookies=[];const workspaces=[];
  for(const [i,account]of fixture.accounts.entries()){
    const password=secrets.accounts.find(x=>x.id===account.id).password;
    const login=await request('POST','client/auth/login',{body:{email:account.email,password}});const cookie=login.response.headers.get('set-cookie').split(';')[0];cookies.push(cookie);
    const w=await request('POST','client/workspaces',{cookie,body:{name:`${task} Synthetic ${i}`,idempotencyKey:`${task}-workspace-${i}`},status:201});workspaces.push(w.data);
  }
  const prisma=app.get(PrismaService);const project=await prisma.projectProfile.findFirstOrThrow();
  if (options.realPluginLifecycle === true) {
    assert.ok(['AF-161', 'AF-167', 'AF-169', 'AF-179', 'AF-181', 'AF-182', 'AF-189'].includes(task));
    const {PluginCatalog}=require('../../apps/api/dist/plugin-runtime/plugin-catalog.js');
    const {PluginLifecycleService}=require('../../apps/api/dist/plugin-runtime/plugin-lifecycle.service.js');
    const admin=await prisma.sysUser.findUniqueOrThrow({where:{username:'aij-admin'}}),catalog=app.get(PluginCatalog),lifecycle=app.get(PluginLifecycleService);
    await lifecycle.install('aij-ai',catalog.manifest('aij-ai').version,admin.id,task.toLowerCase()+'-fixture-install');
    await lifecycle.enable('aij-ai',admin.id,task.toLowerCase()+'-fixture-enable');
  } else {
  await prisma.pluginInstallation.upsert({where:{projectId_pluginCode:{projectId:project.id,pluginCode:'aij-ai'}},create:{projectId:project.id,pluginCode:'aij-ai',version:'0.1.0',owner:'@aij/api',status:'enabled',installedAt:new Date(),enabledAt:new Date()},update:{status:'enabled'}});
  }
  return{app,prisma,project,lease,seed:fixture.seed,accounts:fixture.accounts,cookies,workspaces,request,baseUrl,requireApi:file=>require(join(process.cwd(),'apps/api/dist',file)),close:async()=>{await app.close();for(const key of Object.keys(process.env))delete process.env[key];Object.assign(process.env,previous);}};
}

// Root-only opt-in: existing callers keep their original behavior.
export const workbenchTargetSafetyVersion = 1;
export async function createRemainingClientFixture(task, options = {}) {
  if (options.workbenchTargetSafety !== undefined) {
    assert.equal(options.workbenchTargetSafety, true);
    assert.ok(["AF-198", "AF-191", "AF-201", "AF-202", "AF-203", "AF-205", "AF-206", "AF-207", "AF-209", "AF-210", "AF-211", "AF-214", "AF-215", "AF-213", "AF-218", "AF-217", "AF-221", "AF-223", "AF-224", "AF-225", "AF-227", "AF-228", "AF-229", "AF-232"].includes(task));
    const { createSafeWorkbenchRuntimeFixture } = await import("./workbench-runtime-safe-fixture.mjs");
    return createSafeWorkbenchRuntimeFixture(task, options);
  }
  return createLegacyRemainingClientFixture(task, options);
}
