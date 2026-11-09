import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const read=p=>readFileSync(p,'utf8');
execFileSync('git',['merge-base','--is-ancestor','2fc301a760328a77ee310a53bb05223cc380f73c','HEAD']);
const q=JSON.parse(read('docs/planning/CODING_QUEUE.json')),c=q.taskExecutions.find(c=>c.formalTaskId==='AF-159');
assert.equal(c.candidateStopped,true);assert.equal(c.candidateCommit,'ba249ef273f72255cfd311a5156c27eda8ec0459');assert.equal(c.bootstrapCommit,'57b9c39936955fcaf1a1b33970d7573b375cb032');
for(const id of ['AF-154','AF-150','AF-158']){const prior=q.taskExecutions.find(c=>c.formalTaskId===id);assert.equal(prior.status,'CODE_VERIFIED');assert.equal(JSON.parse(read(prior.report)).status,'PASS');}
const schema=read('apps/api/prisma/schema.prisma'),proposal=read('docs/execution/AF-159-schema.prisma');
const memoryStart=schema.indexOf('model AiPersonalMemory {');const agentPart=schema.slice(schema.indexOf('model AiPersonalAgent {'),memoryStart<0?undefined:memoryStart).split('\n').filter(l=>!['personalMemoryGrants AiPersonalMemoryAgentGrant[]','personalWorkflowBindings AiPersonalWorkflowAgentBinding[]'].includes(l.trim())).join('\n');assert.equal(agentPart.trim(),proposal.slice(proposal.indexOf('model AiPersonalAgent {')).trim());
const model=name=>schema.match(new RegExp('model '+name+' \\{([\\s\\S]*?)\\n\\}'))?.[1];
for(const name of ['MemberUser','ClientWorkspace']){assert.ok(model(name)?.includes('personalAiAgents AiPersonalAgent[]'));assert.ok(model(name)?.includes('personalAiAgentVersions AiPersonalAgentVersion[]'));}
assert.ok(model('AiPersonalSkillVersion')?.includes('personalAgentBindings AiPersonalAgentSkillBinding[]'));
assert.ok(model('AiPersonalSkillVersion')?.includes('@@unique([id, workspaceId, memberId], map: "ai_personal_skill_version_id_scope_key")'));
const module=read('apps/api/src/plugins/aij-ai/ai-runtime.module.ts');for(const item of ['AiPersonalAgentsController','AiPersonalAgentsService','PersonalAgentNoStoreGuard'])assert.ok(module.includes(item));
assert.ok(read('packages/sdk/src/index.ts').includes('export * from "./personal-agents.js";'));
for(const p of ['scripts/runtime-environment.cjs','scripts/database/migration.mjs','scripts/database/seed.mjs','scripts/verification/auth-support.mjs','scripts/verification/client-auth-fixture.mjs'])assert.equal(read(p).split('"AF-159"').length-1,p.endsWith('auth-support.mjs')?3:1);
console.log(JSON.stringify({status:'PASS',candidateStopped:true,exactProposal:true,task:'AF-159',kind:'integration-prerequisite-not-product-acceptance'}));
