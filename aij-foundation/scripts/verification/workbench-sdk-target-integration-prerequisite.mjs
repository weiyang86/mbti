import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const read = p => JSON.parse(readFileSync(p, 'utf8'));
const row = read('docs/planning/CODING_QUEUE.json').taskExecutions.find(r => r.formalTaskId === 'AF-191');
assert.equal(git('branch', '--show-current'), 'dev');
assert.equal(git('remote', 'get-url', 'origin'), 'git@github.com:weiyang86/aij-foundation.git');
assert.equal(git('rev-parse', 'origin/dev'), '94b0236f775fa40a07944c5e0545ac6ce0e123f3');
assert.equal(row.candidateStopped, true); assert.equal(row.candidateReceipt, 'msg_183889068f99');
assert.equal(row.candidateCommit, '7c51dc2c8ddf4eb405d721992d62394d610fc3f3');
assert.equal(row.bootstrapCommit, '04e3856466a210456c30f1b7f528b8d6d873b60c');
assert.equal(git('rev-parse', row.candidateCommit + '^'), row.bootstrapCommit);
assert.equal(git('rev-parse', row.bootstrapCommit + '^'), '94b0236f775fa40a07944c5e0545ac6ce0e123f3');
const m = read('docs/planning/auto-ai-program-20261105/program.json');
const card = m.nextWaves.find(w => w.id === 'W14').cards.find(c => c.id === row.formalTaskId);
assert.deepEqual(git('diff', '--name-only', row.bootstrapCommit, row.candidateCommit).split('\n').sort(), [...card.allowPaths].sort());
const bytes = readFileSync(card.bootstrapManifest.path);
assert.equal(createHash('sha256').update(bytes).digest('hex'), card.bootstrapManifest.sha256);
for (const file of JSON.parse(bytes).files) assert.equal(createHash('sha256').update(execFileSync('git', ['show', row.bootstrapCommit + ':' + file.path])).digest('hex'), file.sha256);
for (const id of [...card.codeDeps,"task_47a05b50c759","task_b477e786e0e7"]) {
  const dep = read('docs/planning/CODING_QUEUE.json').taskExecutions.find(r => r.integrationTaskId === id);
  assert.equal(dep.status, 'CODE_VERIFIED'); assert.equal(read(dep.report).status, 'PASS');
}
// W22 explicitly resumes against the latest verified source. Later verified
// document-renderer dependencies supersede the old W14 dependency snapshot;
// pending/local dependency changes are still rejected byte for byte.
assert.equal(m.nextWaves.find(w => w.id === 'W22').sourceHead, 'dc13430835ae89b58ae18577be12643224c9c55e');
// AF220 added the authorized ai:local script after W22 began. Pin that actual
// verified commit, preserving byte-for-byte rejection of any pending changes.
const dependenciesSource = '95b34d45ec6861d39060d08607c3f3ad8f886021';
assert.equal(m.nextWaves.find(w => w.id === 'W22').resumedCards.find(c => c.formalTaskId === 'AF-191').dependencyBaseline, dependenciesSource);
execFileSync('git', ['merge-base', '--is-ancestor', dependenciesSource, 'HEAD']);
for (const p of ['package.json', 'apps/api/package.json', 'apps/web/package.json', 'pnpm-lock.yaml']) assert.deepEqual(readFileSync(p), execFileSync('git', ['show', dependenciesSource + ':' + p]));
console.log(JSON.stringify({ status: 'PASS', stopped: row.candidateReceipt, candidatePaths: card.allowPaths.length, bootstrapBlobs: JSON.parse(bytes).files.length, sourceOnlyBootstrapExcluded: true, sharedWriter: 'root', dependenciesUnchanged: true }));
