import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
assert.deepEqual(process.argv.slice(2), ['--root-af206']);
assert.equal(process.cwd(), '/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation');
const directory = join('.artifacts/auto-ai-program-20261105/W18', 'AF-206-original-' + randomUUID());
mkdirSync(directory, { recursive: true, mode: 0o700 });
const cases = [
  { card: 'AF205', file: 'scripts/verification/personal-workflow-publication-live.test.mjs', minimum: 11, env: { AIJ_AF205_ROOT_ACCEPTANCE: 'true' } },
  { card: 'AF123', file: 'scripts/verification/ai-center-runs.test.mjs', minimum: 11, env: {} },
  { card: 'AF161', file: 'scripts/verification/personal-agent-runs-live.test.mjs', minimum: 12, env: { AIJ_AF161_ROOT_LIVE: 'true' } },
];
const results = [];
// Separate OS processes, strictly sequential: every file owns a new isolated logical DB.
for (const c of cases) {
  const r = spawnSync(process.execPath, ['--test', '--test-reporter=tap', c.file], { env: { ...process.env, ...c.env }, encoding: 'utf8', timeout: 480000, maxBuffer: 4 * 1024 * 1024 });
  writeFileSync(join(directory, c.card + '.log'), (r.stdout ?? '') + '\n' + (r.stderr ?? ''), { mode: 0o600, flag: 'wx' });
  assert.equal(r.error, undefined); assert.equal(r.status, 0, directory + '/' + c.card);
  const tests = Number(/^# tests (\d+)$/m.exec(r.stdout)?.[1]), pass = Number(/^# pass (\d+)$/m.exec(r.stdout)?.[1]);
  assert.ok(tests >= c.minimum); assert.equal(tests, pass);
  for (const p of [/^# fail 0$/m, /^# skipped 0$/m, /^# cancelled 0$/m]) assert.match(r.stdout, p);
  results.push({ card: c.card, tests, pass });
}
console.log(JSON.stringify({ status: 'PASS', kind: 'ORIGINAL_REAL_PG_HTTP_RUNTIME_REGRESSIONS_NOT_VENDOR', results, directory }));
