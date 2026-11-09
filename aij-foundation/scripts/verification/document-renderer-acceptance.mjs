import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, realpathSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
assert.deepEqual(process.argv.slice(2), ['--root-af197']);
const root = '/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation';
assert.equal(process.cwd(), root);
const folder = '.artifacts/auto-ai-program-20261105/W16';
const deps = JSON.parse(readFileSync(join(folder, 'AF-197-private-deps.json')));
assert.equal(deps.task, 'AF-197');
assert.match(deps.directory, /^\/private\/tmp\/aij-af197-root-deps-[A-Za-z0-9]+$/);
assert.equal(realpathSync(deps.directory), deps.directory);
assert.equal(createHash('sha256').update(readFileSync(join(deps.directory, 'package.json'))).digest('hex'), deps.manifestSha256);
const directory = join(folder, 'AF-197-formats-' + randomUUID());
mkdirSync(directory, { recursive: true, mode: 0o700 });
const child = spawnSync(process.execPath, ['--test', '--test-reporter=tap', 'scripts/verification/document-renderer.test.mjs'], {
  env: { ...process.env, AF197_TEST_DEPENDENCY_ROOT: deps.directory }, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, timeout: 180000,
});
writeFileSync(join(directory, 'formats.log'), (child.stdout ?? '') + '\n' + (child.stderr ?? ''), { mode: 0o600 });
assert.equal(child.error, undefined); assert.equal(child.status, 0, directory);
for (const pattern of [/# tests 7\b/, /# pass 7\b/, /# fail 0\b/, /# skipped 0\b/]) assert.match(child.stdout, pattern);
console.log(JSON.stringify({ status: 'PASS', task: 'AF-197', actualFormatTests: 7, skipped: 0, directory }));
