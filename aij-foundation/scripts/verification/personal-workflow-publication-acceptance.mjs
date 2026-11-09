import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
assert.deepEqual(process.argv.slice(2), ['--root-af205']);
assert.equal(process.cwd(), '/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation');
const directory = join('.artifacts/auto-ai-program-20261105/W18', 'AF-205-actual-' + randomUUID());
mkdirSync(directory, { recursive: true, mode: 0o700 });
const r = spawnSync(process.execPath, ['--test', '--test-reporter=tap', 'scripts/verification/personal-workflow-publication-live.test.mjs'], {
  env: { ...process.env, AIJ_AF205_ROOT_ACCEPTANCE: 'true' }, encoding: 'utf8', timeout: 480000, maxBuffer: 4 * 1024 * 1024,
});
writeFileSync(join(directory, 'live.log'), (r.stdout ?? '') + '\n' + (r.stderr ?? ''), { mode: 0o600, flag: 'wx' });
assert.equal(r.error, undefined); assert.equal(r.status, 0, directory);
for (const p of [/# tests 11\b/, /# pass 11\b/, /# fail 0\b/, /# skipped 0\b/]) assert.match(r.stdout, p);
console.log(JSON.stringify({ status: 'PASS', task: 'AF-205', realPgScenarios: 10, tapTestsIncludingParent: 11, skipped: 0, directory }));
