import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const read = p => JSON.parse(readFileSync(p, 'utf8'));
const sha = b => createHash('sha256').update(b).digest('hex');
const git = (...args) => execFileSync('git', args, { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024 });
const folder = 'docs/planning/auto-ai-program-20261105/';
const baseline = '129aa515b5c7fd8a3269d97b3521136fc641f59d';
assert.equal(git('branch', '--show-current').toString().trim(), 'dev');
assert.equal(git('remote', 'get-url', 'origin').toString().trim(), 'git@github.com:weiyang86/aij-foundation.git');
git('merge-base', '--is-ancestor', baseline, 'HEAD');
assert.equal(git('rev-parse', 'origin/dev').toString().trim(), '94b0236f775fa40a07944c5e0545ac6ce0e123f3');
assert.equal(read('.artifacts/verification/AF-211/run-zWnbhV/report.json').status, 'PASS');
const manifest = read(folder + 'W20/SOURCE_BOOTSTRAP.json');
assert.equal(manifest.sourceCommit, baseline); assert.equal(manifest.files.length, 961);
const tree = new Map(git('ls-tree', '-r', baseline).toString().trim().split('\n').map(line => [line.split('\t')[1], line.split(' ')[2].split('\t')[0]]));
const blobs = manifest.files.map(f => tree.get(f.path)); assert.ok(blobs.every(Boolean));
const batch = spawnSync('git', ['cat-file', '--batch'], { input: blobs.join('\n') + '\n', maxBuffer: 64 * 1024 * 1024 });
assert.equal(batch.status, 0); let offset = 0;
for (const file of manifest.files) {
  const end = batch.stdout.indexOf(10, offset); const parts = batch.stdout.subarray(offset, end).toString().split(' ');
  assert.equal(parts[1], 'blob'); const size = Number(parts[2]); offset = end + 1;
  const bytes = batch.stdout.subarray(offset, offset + size); offset += size;
  assert.equal(batch.stdout[offset++], 10); assert.equal(sha(bytes), file.sha256, file.path);
}
assert.equal(offset, batch.stdout.length);
for (const f of read(folder + 'W20/GOVERNANCE_INPUTS.json').files) { const bytes = readFileSync(f.path); assert.equal(sha(bytes), f.sha256, f.path); assert.equal(bytes.toString().endsWith('\n\n'), false, 'New input blank EOF: ' + f.path); }
const program = read(folder + 'program.json'), queue = read('docs/planning/CODING_QUEUE.json');
const wave = program.nextWaves.find(w => w.id === 'W20'); assert.equal(wave.cards.length, 3);
assert.equal(wave.estimatedHours, 11.75); assert.equal(wave.governanceHours, 0.75);
assert.equal(wave.cards.reduce((n, c) => n + c.hours, wave.governanceHours), 11.75);
const tasks = JSON.parse(execFileSync('orca', ['orchestration', 'task-list', '--run', 'run_72ed314cead8', '--json'], { maxBuffer: 4 * 1024 * 1024 })).result.tasks;
const task = id => { const t = tasks.find(t => t.id === id); assert.ok(t, id); return t; };
assert.equal(wave.governanceTaskId, 'task_04ba27b7c5dd');
const originalDeps = JSON.parse(task(wave.governanceTaskId).deps); for (const id of originalDeps) assert.equal(task(id).status, 'completed');
const paths = new Set();
for (const c of wave.cards) {
  assert.ok(c.hours <= 4 && c.workerHoursLimit < c.hours);
  assert.ok(c.codeDeps.includes(wave.governanceTaskId));
  assert.deepEqual(JSON.parse(task(c.candidateTaskId).deps), c.codeDeps);
  assert.deepEqual(JSON.parse(task(c.integrationTaskId).deps), c.integrationDeps);
  for (const dep of c.codeDeps.filter(d => d !== wave.governanceTaskId)) assert.equal(task(dep).status, 'completed');
  const row = queue.taskExecutions.find(t => t.formalTaskId === c.id); assert.equal(row.title, c.title); assert.equal(row.candidateTaskId, c.candidateTaskId); assert.equal(row.integrationTaskId, c.integrationTaskId);
  for (const path of c.allowPaths) { assert.equal(paths.has(path), false); paths.add(path); assert.doesNotMatch(path, /(?:schema\.prisma|registry\.mjs|CODING_QUEUE\.json|package\.json|pnpm-lock\.yaml)$/); assert.equal(tree.has(path), false); }
}
const mutable = new Set(['docs/current/CURRENT_STATE.md', 'docs/planning/CODING_QUEUE.json', folder + 'program.json', 'scripts/verification/registry.mjs']);
for (const f of read('.artifacts/auto-ai-program-20261105/W20/before.json').files) if (!mutable.has(f.path)) assert.equal(sha(readFileSync(f.path)), f.sha256, f.path);
assert.ok(program.requirements.every(r => r.status === 'NOT_RUN_TARGET_ACCEPTANCE')); assert.equal(program.gitPolicy.pushCurrentLocalCommits, false);
console.log(JSON.stringify({ status: 'PASS', scope: 'governance-only-not-product-acceptance', immutableBlobs: 961, actualTasks: 7, actualOriginalDependenciesCompleted: true, boundedHours: 11.75, inheritedChangesPreserved: true, full40: 'NOT_RUN_TARGET_ACCEPTANCE', vendor: 'DEFERRED_NOT_PASSED' }));
