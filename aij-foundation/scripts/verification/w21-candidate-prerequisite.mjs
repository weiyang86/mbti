import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const task = process.argv[2]; assert.deepEqual(process.argv.slice(2), [task]); assert.ok(['AF-218','AF-217'].includes(task));
const read = p => JSON.parse(readFileSync(p, 'utf8')), hash = b => createHash('sha256').update(b).digest('hex');
const git = (...args) => execFileSync('git', args, { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024 });
assert.equal(process.cwd(), '/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation');
assert.equal(git('branch', '--show-current').toString().trim(), 'dev'); assert.equal(git('remote', 'get-url', 'origin').toString().trim(), 'git@github.com:weiyang86/aij-foundation.git');
git('merge-base', '--is-ancestor', 'bfbfa65ea42deec8d8f949113a2604d814e14e55', 'HEAD');
assert.equal(read('.artifacts/verification/AF-216/run-HeYcSI/report.json').status, 'PASS');
const p = read('docs/planning/auto-ai-program-20261105/program.json'), c = p.nextWaves.find(w => w.id === 'W21').cards.find(c => c.id === task);
const expected = { 'AF-218': ['msg_b43859f88fa4','6497a87e52270e67e55040e830c894eadccbae6c'], 'AF-217': ['msg_61be9308c255','f948d5e81c61dc6be6d2cc66343e1b246b534782'] }[task];
assert.equal(c.candidateStopped, true); assert.equal(c.candidateReceipt, expected[0]); assert.equal(c.candidateCommit, expected[1]); assert.equal(c.allowPaths.length, 6);
assert.equal(git('rev-parse', c.candidateCommit + '^').toString().trim(), c.bootstrapCommit);
assert.equal(hash(readFileSync(c.bootstrapManifest.path)), c.bootstrapManifest.sha256);
const manifest = read(c.bootstrapManifest.path); assert.equal(manifest.files.length, 1009);
const batch = spawnSync('git', ['cat-file', '--batch'], { input: manifest.files.map(f => c.bootstrapCommit + ':' + f.path).join('\n') + '\n', maxBuffer: 64 * 1024 * 1024 });
assert.equal(batch.status, 0); let offset = 0;
for (const file of manifest.files) {
  const end = batch.stdout.indexOf(10, offset), parts = batch.stdout.subarray(offset, end).toString().split(' '); assert.equal(parts[1], 'blob'); const size = Number(parts[2]); offset = end + 1;
  assert.equal(hash(batch.stdout.subarray(offset, offset + size)), file.sha256, file.path); offset += size; assert.equal(batch.stdout[offset++], 10);
}
assert.equal(offset, batch.stdout.length); assert.deepEqual(git('diff', '--name-status', c.bootstrapCommit, c.candidateCommit).toString().trim().split('\n').sort(), c.allowPaths.map(p => 'A\t' + p).sort());
const tasks = JSON.parse(execFileSync('orca', ['orchestration', 'task-list', '--run', 'run_72ed314cead8', '--json'], { maxBuffer: 8 * 1024 * 1024 })).result.tasks;
for (const id of c.integrationDeps) assert.equal(tasks.find(t => t.id === id)?.status, 'completed', id);
assert.deepEqual(JSON.parse(tasks.find(t => t.id === c.integrationTaskId).deps), c.integrationDeps);
if (task === 'AF-217') {
  assert.equal(tasks.find(t => t.id === 'task_ef8d52c0b666')?.status, 'completed', 'Verified shared native-helper integration and bounded AF218 correction must be completed');
  git('merge-base', '--is-ancestor', '4dc8defdb74e724174e208547e64f9b97fd1a3a3', 'HEAD');
  assert.deepEqual(readFileSync('scripts/verification/w21-native-browser.mjs'), git('show', '0e7f3b1c2131bb52370123edc836d1ce9e7e6350:scripts/verification/w21-native-browser.mjs'));
  for (const path of ['apps/api/src/client-workspaces/client-workspace-context.controller.ts', 'apps/api/src/plugins/aij-ai/ai-personal-workflows.service.ts', 'apps/api/src/plugins/aij-ai/ai-personal-workflow-publication.service.ts', 'apps/api/src/plugins/aij-ai/ai-personal-workflow-runs.service.ts']) assert.deepEqual(readFileSync(path), git('show', 'f0e12d76b0c2c5dccf4d1c56369019e979e52902:' + path));
}
const frozen = read(`docs/planning/auto-ai-program-20261105/W21/${task}-ROOT_SOURCES.json`);
for (const f of frozen.files) assert.equal(hash(readFileSync(f.path)), f.sha256, f.path);
for (const f of read('.artifacts/auto-ai-program-20261105/W21/'+task.replace('-','')+'-before.json').files.filter(f => /AF-191|workbench-sdk-target|AF-208.md|AIJ-Base-1.0-Orca-Execution-Playbook/.test(f.path))) assert.equal(hash(readFileSync(f.path)), f.sha256, f.path);
for (const path of ['package.json', 'apps/api/package.json', 'packages/sdk/package.json', 'pnpm-lock.yaml', 'apps/api/prisma/schema.prisma', 'apps/api/src/client-auth/client-auth.service.ts', 'apps/api/src/client-workspaces/workspace-context.service.ts', 'apps/api/src/plugins/aij-ai/ai-personal-agents.service.ts', 'apps/api/src/plugins/aij-ai/ai-personal-agent-publications.service.ts', 'apps/api/src/async-runtime/job.service.ts', 'apps/api/src/plugins/aij-ai/ai-center-run.service.ts']) assert.deepEqual(readFileSync(path), git('show', 'f0e12d76b0c2c5dccf4d1c56369019e979e52902:' + path));
assert.ok(p.requirements.every(r => r.status === 'NOT_RUN_TARGET_ACCEPTANCE')); assert.equal(p.gitPolicy.pushCurrentLocalCommits, false);
console.log(JSON.stringify({ status: 'PASS', task, bootstrapBlobs: 1009, stoppedCandidatePaths: 6, rootFrozenInputs: frozen.files.length, actualCompletedCodeDeps: c.integrationDeps, originalOwnersUnchanged: true, vendor: 'DEFERRED_NOT_PASSED' }));
