import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const folder = 'docs/planning/auto-ai-program-20261105/';
const evidence = '.artifacts/auto-ai-program-20261105/W18/';
const read = p => JSON.parse(readFileSync(p, 'utf8'));
const hash = b => createHash('sha256').update(b).digest('hex');
const git = (...args) => execFileSync('git', args, { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024 });
const program = read(folder + 'program.json');
const queue = read('docs/planning/CODING_QUEUE.json');
const wave = program.nextWaves.find(w => w.id === 'W18');
assert.equal(git('branch', '--show-current').toString().trim(), 'dev');
assert.equal(git('remote', 'get-url', 'origin').toString().trim(), 'git@github.com:weiyang86/aij-foundation.git');
assert.equal(program.limits.automaticNextWave, true);
assert.equal(wave.governanceCard, 'AF-204');
assert.equal(wave.governanceTaskId, 'task_ccfab276cb0a');
assert.equal(wave.estimatedHours, 11.75);
assert.equal(wave.cards.reduce((n, c) => n + c.hours, wave.governanceHours), 11.75);
assert.equal(wave.workerLimits.maxActiveWorkersIncludingRoot, 4);
for (const key of ['dbWriters', 'heavyBuilds', 'nativeGui']) assert.equal(wave.workerLimits[key], 1);
assert.deepEqual(wave.parallelToPendingWave.cards, ['AF-203']);
assert.notEqual(queue.taskExecutions.find(c => c.formalTaskId === 'AF-203').status, 'CODE_VERIFIED');
assert.notEqual(queue.taskExecutions.find(c => c.formalTaskId === 'AF-191').status, 'CODE_VERIFIED');
assert.equal(read('.artifacts/verification/AF-203/run-DA1CkO/report.json').status, 'FAIL');
assert.equal(git('rev-parse', 'origin/dev').toString().trim(), wave.originDev);
git('merge-base', '--is-ancestor', wave.sourceHead, 'HEAD');
const sourcePath = folder + 'W18/SOURCE_BOOTSTRAP.json';
const source = read(sourcePath), digest = hash(readFileSync(sourcePath));
assert.equal(source.sourceCommit, wave.sourceHead);
assert.equal(source.originDev, wave.originDev);
assert.equal(source.files.length, 885);
const paths = new Set();
for (const f of source.files) {
  assert.ok(!paths.has(f.path)); paths.add(f.path);
  assert.match(f.path, /^(?:apps\/(?:api|web)\/|packages\/(?:contracts|core|runtime-contracts|sdk|ui)\/|scripts\/|ops\/document-export\/|(?:package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|tsconfig\.base\.json|eslint\.config\.mjs)$)/);
  assert.doesNotMatch(f.path, /(?:^|\/)(?:\.\.?|\._[^/]*|\.env[^/]*|node_modules|dist|\.next[^/]*|uploads|migrations|document-fonts)(?:\/|$)/);
  assert.equal(hash(git('show', wave.sourceHead + ':' + f.path)), f.sha256, f.path);
}
const tasks = read(evidence + 'actual-task-snapshot.json').result.tasks;
assert.equal(source.integrationEvidence.length, 5);
for (const e of source.integrationEvidence) {
  const row = queue.taskExecutions.find(c => c.formalTaskId === e.card);
  assert.equal(row.status, 'CODE_VERIFIED');
  assert.equal(row.integrationTaskId, e.integrationTaskId);
  assert.equal(read(e.report).status, 'PASS');
  assert.equal(tasks.find(t => t.id === e.integrationTaskId).status, 'completed');
  git('merge-base', '--is-ancestor', e.commit, wave.sourceHead);
  assert.equal(git('show', '-s', '--format=%s', e.commit).toString().trim(), row.title);
}
const ids = new Set(read(evidence + 'task-receipts.json').map(r => r.result.taskId));
assert.equal(ids.size, 7); assert.ok(ids.has(wave.governanceTaskId));
assert.deepEqual(wave.cards.map(c => [c.id, c.model, c.effort]), [['AF-205', 'gpt-6.1-sol', 'high'], ['AF-206', 'gpt-6-astra', 'high'], ['AF-207', 'gpt-6.1-sol', 'high']]);
const writers = new Set();
for (const c of wave.cards) {
  assert.deepEqual(c.bootstrapManifest, { path: sourcePath, sha256: digest, sourceCommit: wave.sourceHead });
  assert.ok(ids.has(c.candidateTaskId)); assert.ok(ids.has(c.integrationTaskId));
  assert.ok(c.hours <= 4 && c.workerHoursLimit < c.hours && c.noGuiDependency);
  assert.deepEqual(JSON.parse(tasks.find(t => t.id === c.candidateTaskId).deps), c.codeDeps);
  assert.deepEqual(JSON.parse(tasks.find(t => t.id === c.integrationTaskId).deps), c.integrationDeps);
  const spec = readFileSync(c.spec, 'utf8');
  for (const t of [c.title, wave.sourceHead, wave.originDev, digest, 'STOP ALL WRITING', 'Candidate not CODE_VERIFIED', 'ALLOW PATHS ONLY:']) assert.ok(spec.includes(t), t);
  for (const p of c.allowPaths) { assert.ok(!writers.has(p)); writers.add(p); assert.ok(spec.includes('- ' + p + '\n')); }
}
assert.ok(wave.cards[1].integrationDeps.includes(wave.cards[0].integrationTaskId));
assert.ok(wave.cards[2].integrationDeps.includes(wave.cards[1].integrationTaskId));
const contract = readFileSync(wave.contract.path, 'utf8');
assert.equal(hash(contract), wave.contract.sha256);
for (const t of ['AiPersonalWorkflowPublicationService', 'PersonalWorkflowPublicationAccess', 'AiPersonalWorkflowRunOriginService', 'AiPersonalWorkflowRunsService', 'WorkflowRef', 'personal-workflow-v1', 'workflowOrigin', 'assertSessionInTransaction', 'maxAttempts1', '/client/workflow-executions', 'createPersonalWorkflowExecutionClient', 'DEFERRED_NOT_PASSED']) assert.ok(contract.includes(t), t);
const historical = JSON.parse(git('show', wave.sourceHead + ':' + folder + 'program.json'));
for (const correction of program.requirementCoverageCorrections.filter(c => c.id.startsWith('AF204_'))) {
  const original = correction.originalPointer.split('/').slice(1).reduce((v, k) => v[k], historical);
  assert.deepEqual(correction.originalRecord, original);
  assert.deepEqual(program.requirements.find(r => r.id === 'REQ-005').verifiedSlices.find(s => s.card === original.card), original);
  assert.ok(correction.primaryRequirements.includes('REQ-008'));
  assert.ok(program.requirements.find(r => r.id === 'REQ-008').verifiedSlices.some(s => s.card === original.card && s.mappingCorrection === correction.id));
}
assert.equal(program.requirementCoverageCorrections.filter(c => c.id.startsWith('AF204_')).length, 2);
assert.deepEqual(program.requirements.map(r => [r.id, r.status]), historical.requirements.map(r => [r.id, r.status]));
assert.ok(program.requirements.every(r => r.status === 'NOT_RUN_TARGET_ACCEPTANCE'));
for (const f of read(evidence + 'preserved-before.json').filter(f => !['docs/current/CURRENT_STATE.md', 'docs/planning/CODING_QUEUE.json', folder + 'program.json', 'scripts/verification/registry.mjs'].includes(f.path))) assert.equal(hash(readFileSync(f.path)), f.sha256, 'Preserve inherited pending work: ' + f.path);
assert.equal(program.ownerExecutionDirectives.find(d => d.id === 'OWNER_BLANK_CREDENTIALS_20261106').externalAcceptance, 'DEFERRED_NOT_PASSED');
assert.equal(program.gitPolicy.pushCurrentLocalCommits, false);
assert.equal(program.gitPolicy.mergeMain, false);
console.log(JSON.stringify({ status: 'PASS', kind: 'BOUNDED_GOVERNANCE_ONLY', sourceBlobs: paths.size, tasks: ids.size, cards: 4, hoursIncludingRoot: 11.75, coverageCorrections: 2, targetAcceptanceAdded: 0, nativePending: ['AF-191', 'AF-203'], vendor: 'DEFERRED_NOT_PASSED', owner: 'PENDING' }));
