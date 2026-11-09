import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve, join } from 'node:path';
assert.deepEqual(process.argv.slice(2), ['--root-af213']);
const root = '/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation'; assert.equal(process.cwd(), root);
const artifact = resolve('.artifacts/auto-ai-program-20261105/W20/AF-213-actual-' + randomUUID()); mkdirSync(artifact, { recursive: true, mode: 0o700 });
const r = spawnSync(process.execPath, ['--test', '--test-reporter=tap', 'scripts/verification/client-personal-script-live.test.mjs'], {
  cwd: root, env: { ...process.env, AIJ_AF213_ROOT_ACCEPTANCE: 'true', AIJ_AF213_EVIDENCE: artifact }, encoding: 'utf8', timeout: 660000, maxBuffer: 4 * 1024 * 1024
});
writeFileSync(join(artifact, 'live.log'), (r.stdout ?? '') + '\n' + (r.stderr ?? ''), { mode: 0o600 });
assert.equal(r.error, undefined, 'Actual acceptance failed to finish; see ' + artifact); assert.equal(r.status, 0, 'Actual acceptance failed; see ' + artifact);
for (const p of [/# tests 8\b/, /# pass 8\b/, /# fail 0\b/, /# skipped 0\b/]) assert.match(r.stdout, p);
console.log(JSON.stringify({ task: 'AF-213', status: 'PASS', artifact, actualScenes: 7, native: 'original Skill page, scope-bound public SDK panel', vendor: 'DEFERRED_NOT_PASSED' }));
