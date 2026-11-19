import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { repositoryRoot } from '../database/connection.mjs';
assert.deepEqual(process.argv.slice(2), ['--root-af198']);
assert.equal(process.cwd(), repositoryRoot);
const directory = join(repositoryRoot, '.artifacts/auto-ai-program-20261105/W16', 'AF-198-actual-' + randomUUID());
mkdirSync(directory, { recursive: true, mode: 0o700 });
for (const [name, expected] of [['workbench-sdk-target-runtime-live', 1], ['workbench-runtime-failure-live', 5]]) {
  const child = spawnSync(process.execPath, ['--test', '--test-reporter=tap', 'scripts/verification/' + name + '.test.mjs'], {
    cwd: repositoryRoot, env: { ...process.env, AIJ_AF198_ROOT_ACCEPTANCE: 'true' }, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, timeout: 540000
  });
  writeFileSync(join(directory, name + '.log'), (child.stdout || '') + '\n' + (child.stderr || ''), { mode: 0o600, flag: 'wx' });
  assert.equal(child.error, undefined, 'Actual process failed; see private evidence');
  assert.equal(child.status, 0, name + ' failed; inspect ' + directory);
  for (const pattern of [new RegExp('# tests ' + expected + '\\b'), new RegExp('# pass ' + expected + '\\b'), /# fail 0\b/, /# skipped 0\b/]) assert.match(child.stdout, pattern);
}
console.log(JSON.stringify({ task: 'AF-198', status: 'PASS', evidenceDirectory: directory, scope: 'REAL_APP_HTTP_PG_TRANSPORT_AND_START_FAILURE_CLEANUP_NOT_NATIVE_OR_VENDOR' }));
