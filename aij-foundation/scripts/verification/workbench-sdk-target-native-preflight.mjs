// Root-only read-only native gate. Missing GUI permission must fail before any database or application work.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
assert.equal(process.cwd(), '/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation');
assert.equal(execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim(), 'dev');
const directory=resolve('.artifacts/auto-ai-program-20261105/AF-191');mkdirSync(directory,{recursive:true});
const command=['computer','get-app-state','--app','com.stablyai.orca','--query','AF191','--max-elements','8','--no-screenshot'];
function observe(restore=false){let raw;try{raw=execFileSync('/usr/local/bin/orca',[...command,...(restore?['--restore-window']:[]),'--json'],{encoding:'utf8',timeout:15000,maxBuffer:1024*1024});}catch(error){raw=error.stdout;}try{return JSON.parse(raw);}catch{return{ok:false,error:{code:'native_host_unavailable'}};}}
const initialReceipt=observe();
// The documented single recovery restores a hidden/minimized window; it does not grant permission.
const restored=initialReceipt.ok!==true&&initialReceipt.error?.code==='window_not_found';
const receipt=restored?observe(true):initialReceipt;
writeFileSync(directory+'/native-preflight.json',JSON.stringify({task:'AF-191',observedAt:new Date().toISOString(),command:'/usr/local/bin/orca '+command.join(' '),initialReceipt,restored,receipt},null,2)+'\n',{mode:0o600});
if(receipt.ok!==true){process.stderr.write('AF191_NATIVE_ENVIRONMENT_BLOCKED: '+String(receipt.error?.code??'unavailable')+'; complete native target cases remain unverified; no permission changes or synthetic visibility events.\n');process.exitCode=1;}
else process.stdout.write('AF191_NATIVE_HOST_READABLE; actual hidden/focus cases still require complete root live adapter.\n');
