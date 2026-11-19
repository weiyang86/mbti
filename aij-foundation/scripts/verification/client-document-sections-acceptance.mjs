import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
assert.deepEqual(process.argv.slice(2), ['--root-af225']);
assert.equal(process.cwd(), '/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation');
const root = process.cwd(), parent = join(root, '.artifacts/auto-ai-program-20261105/AF-225'); mkdirSync(parent, { recursive: true });
const artifact = mkdtempSync(join(parent, 'acceptance-'));
const consumer = realpathSync(mkdtempSync('/private/tmp/aij-af225-packed-')); mkdirSync(join(consumer, 'packs'));
const run = (binary, args, cwd = root, env = process.env, timeout = 120000) => {
  const child = spawnSync(binary, args, { cwd, env, encoding: 'utf8', timeout, maxBuffer: 4 * 1024 * 1024 });
  if (child.status !== 0) { writeFileSync(join(artifact, 'failure.log'), (child.stdout ?? '') + '\n' + (child.stderr ?? ''), { mode: 0o600 }); throw Error('AF225_ACTUAL_ACCEPTANCE_FAILED: ' + artifact); }
  return child.stdout;
};
try {
  const window = run('/usr/local/bin/orca', ['computer', 'get-app-state', '--app', 'com.stablyai.orca', '--restore-window', '--query', '最小化', '--no-screenshot', '--json']);
  const native = JSON.parse(window); writeFileSync(join(artifact, 'native-window-preflight.json'), window, { mode: 0o600 }); assert.equal(native.ok, true);
  for (const name of ['contracts', 'sdk']) run('pnpm', ['pack', '--pack-destination', join(consumer, 'packs')], join(root, 'packages', name));
  const packs = readdirSync(join(consumer, 'packs')).filter(name => name.endsWith('.tgz') && !name.startsWith('._')); assert.equal(packs.length, 2);
  writeFileSync(join(consumer, 'package.json'), '{"private":true,"type":"module"}'); writeFileSync(join(consumer, '.af225-owned'), 'AF-225\n');
  run('npm', ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', ...packs.map(name => join(consumer, 'packs', name))], consumer);
  const log = run(process.execPath, ['--test', '--test-reporter=tap', 'scripts/verification/client-document-sections-live.test.mjs'], root,
    { ...process.env, AIJ_AF225_ROOT_ACCEPTANCE: 'true', AIJ_AF225_PACKED_CONSUMER: consumer, AIJ_AF225_ROOT_ARTIFACT: artifact }, 900000);
  writeFileSync(join(artifact, 'live.log'), log, { mode: 0o600 });
  for (const pattern of [/# tests 1\b/, /# pass 1\b/, /# fail 0\b/, /# skipped 0\b/]) assert.match(log, pattern);
  console.log(JSON.stringify({ task: 'AF-225', status: 'PASS', artifact, ownerAcceptance: 'PENDING' }));
} finally { assert.match(consumer, /^\/private\/tmp\/aij-af225-packed-[A-Za-z0-9]+$/); rmSync(consumer, { recursive: true, force: false }); }
