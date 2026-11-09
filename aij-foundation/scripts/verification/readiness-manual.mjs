import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { acceptanceRecord, assertLocalPath, profile, repositoryRoot } from "../database/connection.mjs";
import environment from "../runtime-environment.cjs";
import { createAcceptance, migrate } from "../database/migration.mjs";
import { assertPortAvailable } from "../port-availability.mjs";
import { applicationSessions, readinessEnvironment, waitReady } from "./readiness-support.mjs";

const directory=join(repositoryRoot,".artifacts/af-011"),statePath=join(directory,"manual.json");
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
function command(binary,args) { const r=spawnSync(binary,args,{encoding:"utf8",timeout:5000,env:{PATH:process.env.PATH,HOME:process.env.HOME,LANG:"C.UTF-8",LC_ALL:"C.UTF-8"}});return r.status===0?r.stdout.trim():undefined; }
export function inspectApi(pid) {
  assert.ok(Number.isInteger(pid)&&pid>1);
  const text=command("ps",["-p",String(pid),"-o","pid=,ppid=,command="]);if(!text)return undefined;
  const match=text.match(/^(\d+)\s+(\d+)\s+(.+)$/);assert.ok(match);
  let cwd=command("lsof",["-a","-p",String(pid),"-d","cwd","-Fn"])?.split("\n").find(l=>l.startsWith("n"))?.slice(1);
  cwd=cwd?.replace(/(?:\\x[0-9a-f]{2})+/gi,bytes=>Buffer.from([...bytes.matchAll(/\\x([0-9a-f]{2})/gi)].map(m=>parseInt(m[1],16))).toString("utf8"));
  return {pid:Number(match[1]),ppid:Number(match[2]),command:match[3],cwd,birth:command("ps",["-p",String(pid),"-o","lstart="])};
}
function assertOwned(state,actual) {
  assert.equal(state.task,"AF-011");assert.equal(acceptanceRecord("test",state.acceptanceId).task,"AF-011");
  assert.equal(actual.pid,state.pid);assert.equal(actual.command,state.process.command);assert.equal(actual.birth,state.process.birth);
  assert.equal(actual.cwd,resolve(repositoryRoot,"apps/api"));assert.ok(actual.command.includes(resolve(repositoryRoot,"apps/api/dist/main.js")));
}
function save(state) { assertLocalPath(statePath);writeFileSync(statePath,JSON.stringify(state,null,2)+"\n",{mode:0o600}); }
async function stopOwnedState(state) {
  const actual=inspectApi(state.pid);
  if(actual){assertOwned(state,actual);writeFileSync(join(directory,"stop-"+state.runId+".json"),JSON.stringify({assertion:"PID/PPID/CWD/command/birth checked before exact owned PID signal",actual},null,2)+"\n");process.kill(state.pid,"SIGTERM");}
  for(let i=0;i<50;i++){
    const sessions=await applicationSessions(state.acceptanceId);
    const active=inspectApi(state.pid);
    if(!active&&sessions.length===0){state.status="STOPPED";state.sessions=[];save(state);return state;}
    await sleep(100);
  }
  throw new Error("Owned API/pool has not closed; no force kill performed");
}
async function locked(operation) {
  assertLocalPath(directory);mkdirSync(directory,{recursive:true,mode:0o700});const path=join(directory,"manual.lock");
  writeFileSync(path,JSON.stringify({pid:process.pid,ppid:process.ppid,cwd:process.cwd()}),{flag:"wx",mode:0o600});
  try{return await operation();}finally{unlinkSync(path);}
}
export async function prepareReadinessManual() {
  return locked(async()=>{
    const previous=existsSync(statePath)?JSON.parse(readFileSync(statePath,"utf8")):undefined;
    if(previous?.status==="PREPARED") {
      const actual=inspectApi(previous.pid);if(actual){assertOwned(previous,actual);await waitReady();return previous;}
    }
    await assertPortAvailable(3656);
    let lease;
    if(previous){assert.equal(previous.task,"AF-011");lease=acceptanceRecord("test",previous.acceptanceId);await migrate({mode:"test",action:"status",acceptanceId:lease.id});}
    else {lease=await createAcceptance("test","AF-011");await migrate({mode:"test",action:"deploy",acceptanceId:lease.id});}
    const runId=randomUUID(),logFile=join(directory,"manual-"+runId+".log");assertLocalPath(logFile);
    const fd=openSync(logFile,"wx",0o600);
    const child=spawn(process.execPath,[resolve(repositoryRoot,"apps/api/dist/main.js")],{cwd:resolve(repositoryRoot,"apps/api"),detached:true,env:Object.fromEntries(Object.entries(readinessEnvironment(lease.id)).filter(([,v])=>v!==undefined)),stdio:["ignore",fd,fd]});
    closeSync(fd);assert.ok(child.pid);child.unref();await sleep(100);
    let actual=inspectApi(child.pid);
    for(let i=0;i<20&&(!actual?.cwd||!actual?.birth);i++){await sleep(100);actual=inspectApi(child.pid);}
    assert.ok(actual,"Owned API must exist");
    const p=profile("test");
    const state={task:"AF-011",status:"STARTING",runId,pid:child.pid,process:actual,acceptanceId:lease.id,database:lease.database,role:p.user,
      passwordFile:p.secretFile,ownershipFile:join(repositoryRoot,".local-data/postgres/acceptance",lease.id+".json"),logFile,
      healthUrl:"http://localhost:3656/api/health",readyUrl:"http://localhost:3656/api/ready",databaseUrl:"postgresql://"+p.user+"@127.0.0.1:55433/"+lease.database,
      account:"local bootstrap DB role; no product administrator/member or new password",stopCommand:"node scripts/verification/readiness-manual.mjs stop",
      cleanup:"No automatic database/volume deletion; stop only the recorded owned API, retain fixture DB and credentials"};
    assertOwned(state,actual);save(state);
    try {await waitReady();state.status="PREPARED";state.sessions=await applicationSessions(lease.id);save(state);return state;}
    catch(error){await stopOwnedState(state);throw error;}
  });
}
export async function stopReadinessManual() {
  return locked(async()=>{
    const state=JSON.parse(readFileSync(statePath,"utf8"));assert.equal(state.task,"AF-011");
    return stopOwnedState(state);
  });
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
  try{const args=process.argv.slice(2);if(args.length!==1||!["prepare","stop"].includes(args[0]))throw new Error("Expected prepare or stop");console.log(JSON.stringify(await(args[0]==="prepare"?prepareReadinessManual():stopReadinessManual())));}
  catch(error){console.error(JSON.stringify({status:"REJECTED",reason:error instanceof environment.DatabaseOperationError || error instanceof environment.DatabaseTargetError?error.message:"Owned readiness preparation/stop failed; inspect ignored state and process ownership; no reset or force kill"}));process.exitCode=2;}
}
