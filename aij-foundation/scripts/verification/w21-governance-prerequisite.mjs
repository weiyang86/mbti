import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const folder = 'docs/planning/auto-ai-program-20261105/';
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const git = (...args) => execFileSync('git', args, { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024 });
const source = 'f0e12d76b0c2c5dccf4d1c56369019e979e52902';
assert.equal(git('branch', '--show-current').toString().trim(), 'dev');
assert.equal(git('remote', 'get-url', 'origin').toString().trim(), 'git@github.com:weiyang86/aij-foundation.git');
git('merge-base', '--is-ancestor', source, 'HEAD');
assert.equal(git('rev-parse', 'origin/dev').toString().trim(), '94b0236f775fa40a07944c5e0545ac6ce0e123f3');
const remote = read('.artifacts/progress-20261108/w21-remote-readback.json');
assert.equal(remote.readOnly, true);
assert.equal(remote.stdout.trim(), '94b0236f775fa40a07944c5e0545ac6ce0e123f3\trefs/heads/dev');
for (const path of ['AF-213/run-PqWTzY', 'AF-214/run-askjbq', 'AF-215/run-2BQoTY']) {
  const report = read('.artifacts/verification/' + path + '/report.json');
  assert.equal(report.status, 'PASS'); assert.equal(report.exitCode, 0);
}
const manifest = read(folder + 'W21/SOURCE_BOOTSTRAP.json');
assert.equal(manifest.sourceCommit, source); assert.equal(manifest.files.length, 1009);
const batch = spawnSync('git', ['cat-file', '--batch'], {
  input: manifest.files.map(file => source + ':' + file.path).join('\n') + '\n', maxBuffer: 64 * 1024 * 1024
});
assert.equal(batch.status, 0); let offset = 0;
for (const file of manifest.files) {
  const end = batch.stdout.indexOf(10, offset), parts = batch.stdout.subarray(offset, end).toString().split(' ');
  assert.equal(parts[1], 'blob'); const size = Number(parts[2]); offset = end + 1;
  assert.equal(hash(batch.stdout.subarray(offset, offset + size)), file.sha256, file.path); offset += size;
  assert.equal(batch.stdout[offset++], 10);
  assert.doesNotMatch(file.path, /(?:^|\/)(?:node_modules|uploads|\.artifacts)(?:\/|$)/);
}
assert.equal(offset, batch.stdout.length);
for (const file of read(folder + 'W21/GOVERNANCE_INPUTS.json').files) {
  const bytes = readFileSync(file.path); assert.equal(hash(bytes), file.sha256, file.path);
  assert.equal(bytes.toString().endsWith('\n\n'), false, file.path + ' blank EOF');
}
const program = read(folder + 'program.json'), queue = read('docs/planning/CODING_QUEUE.json');
const wave = program.nextWaves.find(w => w.id === 'W21');
assert.equal(wave.sourceHead, source); assert.equal(wave.cards.length, 2); assert.equal(wave.resumedCards.length, 1);
assert.equal(wave.scopeCardCount, wave.cards.length + wave.resumedCards.length + 1); assert.equal(wave.scopeCardCount, 4);
assert.equal(wave.estimatedHours, 8.75);
assert.equal(wave.cards.reduce((sum, card) => sum + card.hours, wave.governanceHours) + wave.resumedCards[0].additionalHoursLimit, 8.75);
assert.equal(wave.automaticContinuation, false);
const tasks = JSON.parse(execFileSync('orca', ['orchestration', 'task-list', '--run', 'run_72ed314cead8', '--json'], { maxBuffer: 8 * 1024 * 1024 })).result.tasks;
const task = id => { const value = tasks.find(t => t.id === id); assert.ok(value, id); return value; };
for (const id of JSON.parse(task(wave.governanceTaskId).deps)) assert.equal(task(id).status, 'completed', id);
for (const id of ['task_a4eb80626149', 'task_eb4d68ce61d0', 'task_df3d85227c3f']) assert.equal(task(id).status, 'completed', id);
const tree = new Set(git('ls-tree', '-r', '--name-only', source).toString().trim().split('\n')), paths = new Set();
for (const card of wave.cards) {
  assert.ok(card.hours <= 4 && card.workerHoursLimit < card.hours && card.codeDeps.includes(wave.governanceTaskId));
  assert.deepEqual(JSON.parse(task(card.candidateTaskId).deps), card.codeDeps);
  assert.deepEqual(JSON.parse(task(card.integrationTaskId).deps), card.integrationDeps);
  for (const id of card.codeDeps.filter(id => id !== wave.governanceTaskId)) assert.equal(task(id).status, 'completed', id);
  const row = queue.taskExecutions.find(t => t.formalTaskId === card.id);
  assert.equal(row.title, card.title); assert.equal(row.candidateTaskId, card.candidateTaskId); assert.equal(row.integrationTaskId, card.integrationTaskId);
  for (const path of card.allowPaths) {
    assert.equal(tree.has(path), false, path); assert.equal(paths.has(path), false, path); paths.add(path);
    assert.doesNotMatch(path, /(?:schema\.prisma|registry\.mjs|CODING_QUEUE\.json|package\.json|pnpm-lock\.yaml)$/);
  }
}
const resumed = wave.resumedCards[0]; assert.equal(resumed.formalTaskId, 'AF-203');
assert.equal(resumed.currentTotalHoursCap, 4); assert.equal(resumed.priorEffectiveHoursConservativeCarry, 3);
assert.equal(resumed.additionalHoursLimit, 1); assert.equal(resumed.reviewIncludedHoursLimit, 0.15);
assert.equal(resumed.previousCapHistorical, 3.5);
assert.deepEqual(JSON.parse(task(resumed.supportTaskId).deps), resumed.codeDeps);
assert.equal(task('task_f22906679b97').status, 'completed'); task(resumed.integrationTaskId);
assert.equal(hash(readFileSync(resumed.snapshotManifest)), resumed.snapshotSha256);
for (const file of read(resumed.snapshotManifest).files) assert.equal(hash(readFileSync(file.snapshot)), file.sha256, file.path);
const audit = read(folder + 'W21/PROGRESS_BASELINE.json');
assert.equal(audit.sourceHead, source); assert.equal(audit.requirements.length, 40);
assert.deepEqual(audit.requirements.map(r => r.id), program.requirements.map(r => r.id));
assert.equal(audit.requirements.reduce((sum, r) => sum + r.score, 0), 1350); assert.equal(audit.indexPercent, 33.75);
assert.ok(audit.requirements.every(r => [0, 25, 50, 75].includes(r.score) && r.fullTarget === 'NOT_RUN_TARGET_ACCEPTANCE'));
const mutable = new Set(['docs/current/CURRENT_STATE.md', 'docs/planning/CODING_QUEUE.json', folder + 'program.json', 'scripts/verification/registry.mjs']);
for (const file of read('.artifacts/auto-ai-program-20261105/W21/before.json').files) if (!mutable.has(file.path)) {
  assert.equal(hash(readFileSync(file.path)), file.sha256, file.path);
}
assert.ok(program.requirements.every(r => r.status === 'NOT_RUN_TARGET_ACCEPTANCE'));
assert.equal(program.gitPolicy.pushCurrentLocalCommits, false);
console.log(JSON.stringify({ status: 'PASS', scope: 'governance-only-not-product-acceptance', immutableBlobs: 1009,
  scopedCards: 4, newCandidateWriters: 2, resumedRootWriter: 1, readOnlySupport: 1, hours: 8.75,
  auditCoverageIndex: 33.75, historicalFailuresAndWorkPreserved: true, vendor: 'DEFERRED_NOT_PASSED', owner: 'PENDING' }));
