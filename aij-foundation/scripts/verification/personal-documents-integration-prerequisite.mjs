import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const read = p => JSON.parse(readFileSync(p, 'utf8'));
const row = read('docs/planning/CODING_QUEUE.json').taskExecutions.find(r => r.formalTaskId === 'AF-190');
assert.equal(git('branch', '--show-current'), 'dev');
assert.equal(git('remote', 'get-url', 'origin'), 'git@github.com:weiyang86/aij-foundation.git');
assert.equal(git('rev-parse', 'origin/dev'), '94b0236f775fa40a07944c5e0545ac6ce0e123f3');
assert.equal(row.candidateStopped, true); assert.equal(row.candidateReceipt, 'msg_a55bbe92fc4c');
assert.equal(row.candidateCommit, '994b323a47df77493f80d2ac78e97f96b1f8b5a9');
assert.equal(row.bootstrapCommit, '0ce1b50a9f840cc8d4860b8c4bf3d6f246cb7540');
assert.equal(git('rev-parse', row.candidateCommit + '^'), row.bootstrapCommit);
assert.equal(git('rev-parse', row.bootstrapCommit + '^'), '94b0236f775fa40a07944c5e0545ac6ce0e123f3');
const m = read('docs/planning/auto-ai-program-20261105/program.json');
const card = m.nextWaves.find(w => w.id === 'W14').cards.find(c => c.id === row.formalTaskId);
assert.deepEqual(git('diff', '--name-only', row.bootstrapCommit, row.candidateCommit).split('\n').sort(), [...card.allowPaths].sort());
const bytes = readFileSync(card.bootstrapManifest.path);
assert.equal(createHash('sha256').update(bytes).digest('hex'), card.bootstrapManifest.sha256);
for (const file of JSON.parse(bytes).files) assert.equal(createHash('sha256').update(execFileSync('git', ['show', row.bootstrapCommit + ':' + file.path])).digest('hex'), file.sha256);
for (const id of card.codeDeps) {
  const dep = read('docs/planning/CODING_QUEUE.json').taskExecutions.find(r => r.integrationTaskId === id);
  assert.equal(dep.status, 'CODE_VERIFIED'); assert.equal(read(dep.report).status, 'PASS');
}
for (const p of ['package.json', 'apps/api/package.json', 'apps/web/package.json', 'pnpm-lock.yaml']) assert.deepEqual(readFileSync(p), execFileSync('git', ['show', 'dffa493b145114fc49f8c5d63c10938fd327f5ba:' + p]));
console.log(JSON.stringify({ status: 'PASS', stopped: row.candidateReceipt, candidatePaths: card.allowPaths.length, bootstrapBlobs: JSON.parse(bytes).files.length, sourceOnlyBootstrapExcluded: true, sharedWriter: 'root', dependenciesUnchanged: true }));
