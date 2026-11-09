import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { profile, repositoryRoot } from "../database/connection.mjs";
import { assertPortAvailable } from "../port-availability.mjs";
import { applicationSessions, response } from "./readiness-support.mjs";

test("manual preparation uses real main/SIGTERM hooks, owns PID and closes its pool",{timeout:55000},async(t)=>{
  const parent=join(repositoryRoot,".artifacts/af-011/manual-test");mkdirSync(parent,{recursive:true});const root=mkdtempSync(join(parent,"run-"));let state;
  function run(action){const r=spawnSync(process.execPath,["scripts/verification/readiness-manual.mjs",action],{cwd:repositoryRoot,encoding:"utf8",timeout:40000,env:{PATH:process.env.PATH,HOME:process.env.HOME}});assert.equal(r.status,0,r.stderr);writeFileSync(join(root,action+".json"),JSON.stringify({command:[process.execPath,"scripts/verification/readiness-manual.mjs",action],exitCode:r.status,stdout:r.stdout,stderr:r.stderr},null,2)+"\n");return JSON.parse(r.stdout);}
  try{
    await t.test("safe hook starts only the declared API and reports no password",async()=>{
      state=run("prepare");assert.equal(state.status,"PREPARED");assert.equal(state.role,"aij_foundation_test");assert.equal(state.passwordFile,profile("test").secretFile);
      assert.equal((await response("ready",200)).data.reason,"READY");assert.equal((await response("health",200)).data.database,"configured");
      const password=readFileSync(state.passwordFile,"utf8");assert.ok(!JSON.stringify(state).includes(password));assert.ok(!readFileSync(state.logFile,"utf8").includes(password));assert.equal((await applicationSessions(state.acceptanceId)).length,1);
    });
    await t.test("repeat preparation keeps database, credentials and owned PID",()=>{const repeated=run("prepare");assert.equal(repeated.pid,state.pid);assert.equal(repeated.acceptanceId,state.acceptanceId);});
    await t.test("verified SIGTERM closes the real main process and zero API sessions remain",async()=>{const stopped=run("stop");assert.equal(stopped.status,"STOPPED");assert.deepEqual(await applicationSessions(state.acceptanceId),[]);await assertPortAvailable(3656);state=undefined;});
  }finally{if(state)run("stop");}
});
