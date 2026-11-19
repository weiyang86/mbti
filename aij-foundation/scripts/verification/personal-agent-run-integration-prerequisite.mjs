import assert from 'node:assert/strict';
import{readFileSync}from'node:fs';
import{execFileSync}from'node:child_process';
const read=p=>readFileSync(p,'utf8');
execFileSync('git',['merge-base','--is-ancestor','e2ae96025393ba141b0a1480f0324837dc10dea8','HEAD']);
const q=JSON.parse(read('docs/planning/CODING_QUEUE.json')),c=q.taskExecutions.find(c=>c.formalTaskId==='AF-161');
assert.equal(c.candidateStopped,true);assert.equal(c.candidateCommit,'18acdb45c1e1f5520dfd7bd0a7e70097c3279d66');assert.equal(c.bootstrapCommit,'38fdae15d424090c5bb62dd2a934df61a5fbef95');assert.equal(c.revisionTaskId,'task_286aaa168126');
for(const id of ['AF-159','AF-157','AF-150','AF-145']){const p=q.taskExecutions.find(c=>c.formalTaskId===id);assert.equal(p.status,'CODE_VERIFIED');assert.equal(JSON.parse(read(p.report)).status,'PASS');}
for(const path of ['scripts/runtime-environment.cjs','scripts/database/migration.mjs','scripts/database/seed.mjs','scripts/verification/auth-support.mjs','scripts/verification/client-auth-fixture.mjs'])assert.equal(read(path).split('"AF-161"').length-1,path.endsWith('auth-support.mjs')?3:1);
const module=read('apps/api/src/plugins/aij-ai/ai-runtime.module.ts');for(const v of ['AiPersonalAgentSnapshotsService','AiPersonalAgentRunsService','AiPersonalAgentRunsController','PersonalAgentRunNoStoreGuard'])assert.ok(module.includes(v));
assert.ok(read('packages/sdk/src/index.ts').includes('export * from "./personal-agent-runs.js";'));
const schema=read('apps/api/prisma/schema.prisma'),memoryStart=schema.indexOf('model AiPersonalMemory {');const original=schema.slice(0,memoryStart<0?undefined:memoryStart).split('\n').filter(l=>!['personalAiMemories AiPersonalMemory[]','personalMemoryGrants AiPersonalMemoryAgentGrant[]','personalWorkflows AiPersonalWorkflow[]','personalWorkflowBindings AiPersonalWorkflowAgentBinding[]'].includes(l.trim())).join('\n');assert.equal(original.trim(),execFileSync('git',['show','16cfeabbd248a9faff0efd77ad946b033d18e526:apps/api/prisma/schema.prisma'],{encoding:'utf8'}).trim());
console.log(JSON.stringify({status:'PASS',task:'AF-161',kind:'integration-prerequisite-only',newSchema:false}));
