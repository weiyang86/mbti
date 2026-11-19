import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
assert.deepEqual(process.argv.slice(2), ['--root-af203']);
assert.equal(process.cwd(), '/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation');
const root = process.cwd(), folder = join(root, '.artifacts/auto-ai-program-20261105/W21', 'AF-203-acceptance-' + randomUUID());
mkdirSync(folder, { recursive: true, mode: 0o700 });
const consumer = realpathSync(mkdtempSync('/private/tmp/aij-af203-packed-')); mkdirSync(join(consumer, 'packs'));
const run = (cmd, args, cwd = root, env = process.env, timeout = 120000) => {
  const result = spawnSync(cmd, args, { cwd, env, encoding: 'utf8', timeout, maxBuffer: 4 * 1024 * 1024 });
  if (result.error || result.status !== 0) { writeFileSync(join(folder, 'failed.log'), (result.stdout ?? '') + '\n' + (result.stderr ?? '')); assert.fail('AF203 actual acceptance failed: ' + folder); }
  return result.stdout;
};
try {
  const window = restore => {
    const result = spawnSync('/usr/local/bin/orca', ['computer', 'get-app-state', '--app', 'com.stablyai.orca', ...(restore ? ['--restore-window'] : []), '--query', '最小化', '--no-screenshot', '--json'], { encoding: 'utf8', timeout: 25000, maxBuffer: 1024 * 1024 });
    const receipt = JSON.parse(result.stdout); writeFileSync(join(folder, restore ? 'native-restored-preflight.json' : 'native-preflight.json'), JSON.stringify(receipt, null, 2)); return receipt;
  };
  let native = window(false); if (!native.ok && native.error?.code === 'window_not_found') native = window(true);
  assert.equal(native.ok, true, 'Actual native window required BEFORE any fresh DB/application');
  for (const name of ['contracts', 'sdk']) run('pnpm', ['pack', '--pack-destination', join(consumer, 'packs')], join(root, 'packages', name));
  const packs = readdirSync(join(consumer, 'packs')).filter(name => name.endsWith('.tgz')); assert.equal(packs.length, 2);
  writeFileSync(join(consumer, 'package.json'), '{"private":true,"type":"module"}');
  run('npm', ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', ...packs.map(name => join(consumer, 'packs', name))], consumer);
  const log = run(process.execPath, ['--test', '--test-reporter=tap', 'scripts/verification/client-document-export-browser-live.test.mjs'], root, { ...process.env, AIJ_AF203_ROOT_ACCEPTANCE: 'true', AIJ_AF203_PACKED_CONSUMER: consumer }, 780000);
  writeFileSync(join(folder, 'browser.log'), log); for (const pattern of [/# tests 1\b/, /# pass 1\b/, /# fail 0\b/, /# skipped 0\b/]) assert.match(log, pattern);
  console.log(JSON.stringify({ task: 'AF-203', status: 'PASS', folder, scope: 'Original production page, fresh actual Word/PDF OS files and hashes, original SDK cross-port CORS, unknown lock, real hidden and current/late denial', vendor: 'DEFERRED_NOT_PASSED' }));
} finally {
  assert.match(consumer, /^\/private\/tmp\/aij-af203-packed-[A-Za-z0-9]+$/); rmSync(consumer, { recursive: true, force: false });
}
