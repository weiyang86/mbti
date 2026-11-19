import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, realpathSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';

assert.deepEqual(process.argv.slice(2), ['--root-af214']);
const root = '/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation';
assert.equal(process.cwd(), root);
const artifact = join(root, '.artifacts/auto-ai-program-20261105/W20', 'AF-214-actual-' + randomUUID());
mkdirSync(artifact, { recursive: true, mode: 0o700 });
const consumer = realpathSync(mkdtempSync('/private/tmp/aij-af214-packed-'));
mkdirSync(join(consumer, 'packs'));
const run = (command, args, cwd = root, env = process.env, timeout = 180000) => {
  const r = spawnSync(command, args, { cwd, env, encoding: 'utf8', timeout, maxBuffer: 8 * 1024 * 1024 });
  if (r.error || r.status !== 0) {
    writeFileSync(join(artifact, 'failed-command.log'), (r.stdout ?? '') + '\n' + (r.stderr ?? ''));
    assert.fail('AF214 command failed; retained evidence: ' + artifact);
  }
  return r.stdout;
};
try {
  for (const name of ['contracts', 'sdk']) run('pnpm', ['pack', '--pack-destination', join(consumer, 'packs')], join(root, 'packages', name));
  const packs = readdirSync(join(consumer, 'packs')).filter(n => n.endsWith('.tgz') && !n.startsWith('._'));
  assert.equal(packs.length, 2);
  writeFileSync(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  run('npm', ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', ...packs.map(n => join(consumer, 'packs', n))], consumer);
  const hash = b => createHash('sha256').update(b).digest('hex');
  let byteMatchedFiles = 0;
  for (const name of ['contracts', 'sdk']) {
    const installed = realpathSync(join(consumer, 'node_modules/@aij', name));
    assert.ok(installed.startsWith(consumer + '/node_modules/'));
    const files = readdirSync(join(root, 'packages', name, 'dist')).filter(n => !n.startsWith('._')).sort();
    assert.deepEqual(readdirSync(join(installed, 'dist')).filter(n => !n.startsWith('._')).sort(), files);
    for (const file of files) { assert.equal(hash(readFileSync(join(installed, 'dist', file))), hash(readFileSync(join(root, 'packages', name, 'dist', file)))); byteMatchedFiles++; }
  }
  writeFileSync(join(consumer, 'entry.mjs'), "export * from '@aij/sdk';\n");
  const types = `import {createClientApi,createKnowledgeCitationsClient,type KnowledgeCitationSource} from '@aij/sdk';
const c=createKnowledgeCitationsClient(createClientApi(()=> 'http://example.invalid/api'));
const value:Promise<KnowledgeCitationSource>=c.read('space','aaaaaaaaaaaaaaaaaaaa','bbbbbbbbbbbbbbbbbbbb',{signal:new AbortController().signal});void value;
// @ts-expect-error callers cannot authorize themselves
c.read('space','aaaaaaaaaaaaaaaaaaaa','bbbbbbbbbbbbbbbbbbbb',{memberId:'forged'});
`;
  for (const ext of ['mts', 'cts']) {
    writeFileSync(join(consumer, 'types.' + ext), types);
    run(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--skipLibCheck', '--target', 'ES2022', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--lib', 'ES2022,DOM', join(consumer, 'types.' + ext)], consumer);
  }
  const log = run(process.execPath, ['--test', '--test-reporter=tap', 'scripts/verification/knowledge-citations-live.test.mjs'], root,
    { ...process.env, AIJ_AF214_ROOT_ACCEPTANCE: 'true', AIJ_AF214_PACKED_CONSUMER: consumer, AIJ_AF214_EVIDENCE: artifact }, 600000);
  writeFileSync(join(artifact, 'live.log'), log);
  for (const pattern of [/# fail 0\b/, /# skipped 0\b/, /# pass [1-9]\d*\b/]) assert.match(log, pattern);
  writeFileSync(join(artifact, 'packed-evidence.json'), JSON.stringify({ outsideRepository: true, independentEsmCjsNodeNext: true, byteMatchedFiles, noRootNodeModulesBorrowed: true }, null, 2) + '\n');
  console.log(JSON.stringify({ task: 'AF-214', status: 'PASS', byteMatchedFiles, artifact, vendor: 'DEFERRED_NOT_PASSED' }));
} finally {
  assert.match(consumer, /^\/private\/tmp\/aij-af214-packed-[A-Za-z0-9]+$/);
  rmSync(consumer, { recursive: true, force: false });
}
