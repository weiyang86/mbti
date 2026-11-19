import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

const folder = 'docs/planning/auto-ai-program-20261105/';
const evidence = '.artifacts/auto-ai-program-20261105/W22/';
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const git = (...args) => execFileSync('git', args, { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
const source = 'dc13430835ae89b58ae18577be12643224c9c55e';
const origin = '94b0236f775fa40a07944c5e0545ac6ce0e123f3';
assert.equal(git('branch', '--show-current').toString().trim(), 'dev');
assert.equal(git('remote', 'get-url', 'origin').toString().trim(), 'git@github.com:weiyang86/aij-foundation.git');
assert.equal(git('rev-parse', 'origin/dev').toString().trim(), origin);
git('merge-base', '--is-ancestor', source, 'HEAD');
const remote = read(evidence + 'remote-and-ports.json');
assert.equal(remote.readOnly, true);
assert.equal(remote.stdout, origin + '\trefs/heads/dev');
assert.deepEqual(remote.ports, [3955, 3956, 55435].map(port => ({ port, occupied: false })));
const program = read(folder + 'program.json'), queue = read('docs/planning/CODING_QUEUE.json');
const wave = program.nextWaves.find(w => w.id === 'W22');
assert.equal(wave.ownerInstruction, '按照以上规划开始进行开发');
assert.equal(wave.governanceCard, 'AF-219');
assert.equal(wave.scopeCardCount, 4);
assert.equal(wave.cards.length, 2);
assert.equal(wave.resumedCards.length, 1);
assert.equal(wave.budgetHours, 11);
assert.equal(wave.cards.reduce((sum, c) => sum + c.hours, wave.governanceHours) + wave.resumedCards[0].additionalHoursLimit, 11);
assert.equal(wave.automaticContinuation, false);
for (const key of ['dbWriters', 'heavyBuilds', 'linuxExecutors', 'nativeGui']) assert.equal(wave.workerLimits[key], 1);
assert.equal(wave.workerLimits.candidateBacklogBeforeNewDispatch, 2);
assert.equal(program.gitPolicy.pushCurrentLocalCommits, false);
assert.equal(program.gitPolicy.mergeMain, false);
const baselineProgram = read(evidence + 'before/' + folder + 'program.json');
const baselineQueue = read(evidence + 'before/docs/planning/CODING_QUEUE.json');
assert.deepEqual(program.requirements, baselineProgram.requirements);
assert.ok(program.requirements.every(r => r.status === 'NOT_RUN_TARGET_ACCEPTANCE'));
assert.deepEqual(program.nextWaves.slice(0, -1), baselineProgram.nextWaves);
assert.deepEqual(queue.ownerAcceptanceRecords, baselineQueue.ownerAcceptanceRecords);
assert.deepEqual(queue.taskExecutions.slice(0, baselineQueue.taskExecutions.length), baselineQueue.taskExecutions);
const manifestPath = folder + 'W22/SOURCE_BOOTSTRAP.json';
const manifest = read(manifestPath), manifestHash = hash(readFileSync(manifestPath));
assert.equal(manifest.sourceCommit, source); assert.equal(manifest.originDev, origin);
assert.equal(manifest.files.length, 1026);
const blobData = execFileSync('git', ['cat-file', '--batch'], {
  input: manifest.files.map(file => file.oid).join('\n') + '\n', maxBuffer: 64 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe']
});
let offset = 0;
const paths = new Set();
for (const file of manifest.files) {
  assert.ok(!paths.has(file.path)); paths.add(file.path);
  assert.doesNotMatch(file.path, /(?:^|\/)(?:\._[^/]*|\.env[^/]*|node_modules|uploads|dist|\.next[^/]*|\.artifacts)(?:\/|$)/);
  assert.ok(['100644', '100755'].includes(file.mode));
  const end = blobData.indexOf(10, offset), header = blobData.subarray(offset, end).toString().split(' ');
  assert.equal(header[0], file.oid); assert.equal(header[1], 'blob'); assert.equal(Number(header[2]), file.bytes);
  offset = end + 1;
  assert.equal(hash(blobData.subarray(offset, offset + file.bytes)), file.sha256, file.path);
  offset += file.bytes; assert.equal(blobData[offset++], 10);
  assert.equal(git('rev-parse', source + ':' + file.path).toString().trim(), file.oid, file.path);
}
assert.equal(offset, blobData.length);
for (const file of read(folder + 'W22/GOVERNANCE_INPUTS.json').files) assert.equal(hash(readFileSync(file.path)), file.sha256, file.path);
assert.equal(hash(readFileSync(wave.contract.path)), wave.contract.sha256);
const tasks = JSON.parse(execFileSync('orca', ['orchestration', 'task-list', '--run', 'run_72ed314cead8', '--json'], { maxBuffer: 8 * 1024 * 1024 })).result.tasks;
const task = id => { const item = tasks.find(t => t.id === id); assert.ok(item, id); return item; };
for (const id of JSON.parse(task(wave.governanceTaskId).deps)) assert.equal(task(id).status, 'completed', id);
const receipts = read(evidence + 'task-receipts.json');
const taskIds = new Set(receipts.map(r => r.result.taskId));
assert.equal(taskIds.size, 6); assert.ok(taskIds.has(wave.governanceTaskId));
const candidatePaths = new Set();
for (const card of wave.cards) {
  assert.ok(card.hours <= 4 && card.workerHoursLimit === 1.5 && card.workerHoursLimit < card.hours);
  assert.deepEqual(card.bootstrapManifest, { path: manifestPath, sha256: manifestHash, sourceCommit: source });
  assert.equal(card.model, 'inherited-default'); assert.equal(card.effort, 'inherited-default');
  assert.deepEqual(JSON.parse(task(card.candidateTaskId).deps), card.codeDeps);
  assert.deepEqual(JSON.parse(task(card.integrationTaskId).deps), card.integrationDeps);
  assert.ok(card.codeDeps.includes(wave.governanceTaskId));
  for (const dep of card.codeDeps.filter(d => d !== wave.governanceTaskId)) assert.equal(task(dep).status, 'completed', dep);
  const row = queue.taskExecutions.find(r => r.formalTaskId === card.id);
  assert.equal(row.title, card.title); assert.equal(row.candidateTaskId, card.candidateTaskId); assert.equal(row.integrationTaskId, card.integrationTaskId);
  const spec = readFileSync(card.spec, 'utf8');
  for (const token of [card.title, source, origin, manifestHash, 'STOP ALL WRITING', 'Candidate not CODE_VERIFIED', 'ALLOW PATHS ONLY:']) assert.ok(spec.includes(token), token);
  for (const path of card.allowPaths) {
    assert.ok(!paths.has(path), 'allowPaths must be new relative to verified source');
    assert.ok(!candidatePaths.has(path), 'parallel overlap'); candidatePaths.add(path);
    assert.equal(existsSync(path), false, 'candidate must not pre-exist before dispatch: ' + path);
    assert.ok(spec.includes('- ' + path + '\n'), path);
    assert.doesNotMatch(path, /(?:schema\.prisma|registry\.mjs|CODING_QUEUE\.json|package\.json|pnpm-lock\.yaml)$/);
  }
}
const resumed = wave.resumedCards[0];
assert.equal(resumed.formalTaskId, 'AF-191'); assert.equal(resumed.priorEffectiveHoursConservativeCarry, 1.5);
assert.equal(resumed.previousCapHistorical, 3); assert.equal(resumed.currentTotalHoursCap, 4); assert.equal(resumed.additionalHoursLimit, 2.5);
assert.deepEqual(JSON.parse(task(resumed.rootContinuationTaskId).deps), resumed.codeDeps);
assert.equal(task('task_383cde85f7a3').status, 'completed');
assert.equal(task('task_2d6e6640b4d0').status, 'completed');
assert.notEqual(task(resumed.integrationTaskId).status, 'completed');
assert.notEqual(queue.taskExecutions.find(r => r.formalTaskId === 'AF-191').status, 'CODE_VERIFIED');
for (const file of read(evidence + 'INTEGRATION_BASELINE.json').files) {
  assert.equal(read(file.report).status, 'PASS'); assert.equal(task(file.integrationTaskId).status, 'completed');
  git('merge-base', '--is-ancestor', file.commit, source);
  assert.equal(git('show', '-s', '--format=%s', file.commit).toString().trim(), file.title);
}
const mutable = new Set(['docs/current/CURRENT_STATE.md', 'docs/planning/CODING_QUEUE.json', folder + 'program.json', 'scripts/verification/registry.mjs', 'docs/planning/owner-handoff-20261108/NEXT_WORK_PLAN.md']);
for (const file of read(evidence + 'preserved-before.json')) if (!mutable.has(file.path)) assert.equal(hash(readFileSync(file.path)), file.sha256, file.path);
console.log(JSON.stringify({ status: 'PASS', scope: 'W22_GOVERNANCE_NOT_PRODUCT_ACCEPTANCE', sourceBlobs: paths.size,
  actualTasks: taskIds.size, cards: 4, newHours: 11, af191PriorHours: 1.5, af191TotalCap: 4,
  inheritedWorkPreserved: true, externalLiveActions: 'DEFERRED', owner: 'PENDING' }));
