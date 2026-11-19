import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, realpathSync, writeFileSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
assert.deepEqual(process.argv.slice(2), ['--root-af218']);
const root = '/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation'; assert.equal(process.cwd(), root);
const artifact = join(root, '.artifacts/auto-ai-program-20261105/W21', 'AF-218-actual-' + randomUUID()); mkdirSync(artifact, { recursive: true, mode: 0o700 });
const consumer = realpathSync(mkdtempSync('/private/tmp/aij-af218-packed-')); mkdirSync(join(consumer, 'packs'));
const run = (cmd, args, cwd = root, env = process.env, timeout = 180000) => {
  const r = spawnSync(cmd, args, { cwd, env, encoding: 'utf8', timeout, maxBuffer: 4 * 1024 * 1024 });
  if (r.error || r.status !== 0) { writeFileSync(join(artifact, 'failed-command.log'), (r.stdout ?? '') + '\n' + (r.stderr ?? '')); assert.fail('AF218 actual acceptance failed: ' + artifact); } return r.stdout;
};
try {
  for (const name of ['contracts', 'sdk']) run('pnpm', ['pack', '--pack-destination', join(consumer, 'packs')], join(root, 'packages', name));
  const packs = readdirSync(join(consumer, 'packs')).filter(n => n.endsWith('.tgz') && !n.startsWith('._')); assert.equal(packs.length, 2);
  writeFileSync(join(consumer, 'package.json'), '{"private":true,"type":"module"}'); run('npm', ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', ...packs.map(n => join(consumer, 'packs', n))], consumer);
  writeFileSync(join(consumer, 'entry.mjs'), "export * from '@aij/sdk';\n");
  const log = run(process.execPath, ['--test', '--test-reporter=tap', 'scripts/verification/client-agent-version-restore-live.test.mjs'], root, { ...process.env, AIJ_AF218_ROOT_ACCEPTANCE: 'true', AIJ_AF218_PACKED_CONSUMER: consumer, AIJ_AF218_EVIDENCE: artifact }, 660000);
  writeFileSync(join(artifact, 'live.log'), log); for (const p of [/# tests 10\b/, /# pass 10\b/, /# fail 0\b/, /# skipped 0\b/]) assert.match(log, p);
  console.log(JSON.stringify({ task: 'AF-218', status: 'PASS', artifact, scope: 'Original HTTP/PG/installed public SDK and production native Agent page; vendor deferred and owner pending' }));
} finally { assert.match(consumer, /^\/private\/tmp\/aij-af218-packed-[A-Za-z0-9]+$/); rmSync(consumer, { recursive: true, force: false }); }
