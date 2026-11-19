import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const folder = 'docs/planning/auto-ai-program-20261105/', read = p => JSON.parse(readFileSync(p, 'utf8'));
const hash = b => createHash('sha256').update(b).digest('hex');
const git = (...a) => execFileSync('git', a, { maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
assert.equal(process.cwd(), '/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation'); assert.equal(git('branch', '--show-current').toString().trim(), 'dev');
assert.equal(git('remote', 'get-url', 'origin').toString().trim(), 'git@github.com:weiyang86/aij-foundation.git');
const program = read(folder + 'program.json'), card = program.nextWaves.find(w => w.id === 'W17').cards.find(c => c.id === 'AF-203');
assert.equal(card.revisionStopped, true); assert.equal(card.revisionReceipt, 'msg_13f38c3da836'); assert.equal(card.candidateCommit, '5a8bbf320acc282b8f21be02071f309da24b64aa');
assert.equal(hash(readFileSync(card.bootstrapManifest.path)), card.bootstrapManifest.sha256);
const manifest = read(card.bootstrapManifest.path); assert.equal(manifest.files.length, 867);
const batch = spawnSync('git', ['cat-file', '--batch'], { input: manifest.files.map(f => card.bootstrapCommit + ':' + f.path).join('\n') + '\n', maxBuffer: 64 * 1024 * 1024 });
assert.equal(batch.status, 0); let offset = 0;
for (const f of manifest.files) { const end = batch.stdout.indexOf(10, offset), parts = batch.stdout.subarray(offset, end).toString().split(' '); assert.equal(parts[1], 'blob'); const size = Number(parts[2]); offset = end + 1; assert.equal(hash(batch.stdout.subarray(offset, offset + size)), f.sha256, f.path); offset += size; assert.equal(batch.stdout[offset++], 10); }
assert.equal(offset, batch.stdout.length);
assert.deepEqual(git('diff', '--name-only', card.bootstrapCommit, card.candidateCommit).toString().trim().split('\n').sort(), [...card.allowPaths].sort());
const sources = read(folder + 'W21/AF-203-ROOT_SOURCES.json');
for (const f of sources.files) assert.equal(hash(readFileSync(f.path)), f.sha256, f.path);
for (const path of ['package.json', 'pnpm-lock.yaml', 'apps/api/package.json', 'packages/sdk/src/index.ts', 'packages/sdk/src/personal-document-exports.ts', 'apps/api/prisma/schema.prisma', 'apps/api/src/bootstrap.ts', 'apps/api/src/client-auth/client-auth.service.ts', 'apps/api/src/documents/personal-document-exports.controller.ts', 'apps/api/src/documents/personal-document-exports.service.ts', 'apps/api/src/files/generated-file-assets.service.ts', 'apps/api/src/documents/document-renderer.ts', 'apps/api/src/documents/document-export-executor.ts']) {
  assert.equal(hash(readFileSync(path)), hash(git('show', 'f0e12d76b0c2c5dccf4d1c56369019e979e52902:' + path)), path);
}
const tasks = JSON.parse(execFileSync('orca', ['orchestration', 'task-list', '--run', 'run_72ed314cead8', '--json'], { maxBuffer: 8 * 1024 * 1024 })).result.tasks;
for (const id of ['task_f22906679b97', 'task_b701da0766e1', 'task_7b2182d35e86']) assert.equal(tasks.find(t => t.id === id)?.status, 'completed', id);
assert.equal(read('.artifacts/verification/AF-202/run-fZysq0/report.json').status, 'PASS');
git('merge-base', '--is-ancestor', '2ee9172a30be7694dc2cb097a43fbce1f0a14e65', 'HEAD');
git('merge-base', '--is-ancestor', '47b75817e41c7b1ecfe69a3738e487461fd1839d', 'HEAD');
for (const f of read('.artifacts/auto-ai-program-20261105/W21/before.json').files.filter(f => /AF-191|workbench-sdk-target|AIJ-Base-1.0-Orca-Execution-Playbook|AF-208\.md/.test(f.path))) assert.equal(hash(readFileSync(f.path)), f.sha256, f.path);
assert.ok(program.requirements.every(r => r.status === 'NOT_RUN_TARGET_ACCEPTANCE')); assert.equal(program.gitPolicy.pushCurrentLocalCommits, false);
console.log(JSON.stringify({ task: 'AF-203', status: 'PASS', stoppedCandidatePaths: 6, originalBootstrapBlobs: 867,
  rootCorrectionsFrozen: true, actualCompletedI202I216AndReadOnlySupport: true, originalApiSdkSchemaUnchangedFromValidatedF0e: true, full40: false, vendor: 'DEFERRED_NOT_PASSED' }));
