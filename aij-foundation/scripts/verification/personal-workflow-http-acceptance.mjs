import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, realpathSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
assert.deepEqual(process.argv.slice(2), ['--root-af207']);
const root = '/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation'; assert.equal(process.cwd(), root);
const artifact = join(root, '.artifacts/auto-ai-program-20261105/W18', 'AF-207-actual-' + randomUUID()); mkdirSync(artifact, { recursive: true, mode: 0o700 });
const consumer = realpathSync(mkdtempSync('/private/tmp/aij-af207-packed-')); mkdirSync(join(consumer, 'packs'));
const run = (command, args, cwd = root, env = process.env, timeout = 180000) => {
  const r = spawnSync(command, args, { cwd, env, encoding: 'utf8', timeout, maxBuffer: 4 * 1024 * 1024 });
  if (r.error || r.status !== 0) { writeFileSync(join(artifact, 'failed-command.log'), (r.stdout ?? '') + '\n' + (r.stderr ?? '')); assert.fail('AF207 command failed: ' + artifact); }
  return r.stdout;
};
try {
  for (const name of ['contracts', 'sdk']) run('pnpm', ['pack', '--pack-destination', join(consumer, 'packs')], join(root, 'packages', name));
  const packs = readdirSync(join(consumer, 'packs')).filter(n => n.endsWith('.tgz') && !n.startsWith('._')); assert.equal(packs.length, 2);
  writeFileSync(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  run('npm', ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', ...packs.map(n => join(consumer, 'packs', n))], consumer);
  const digest = b => createHash('sha256').update(b).digest('hex'); let byteMatchedFiles = 0;
  for (const name of ['contracts', 'sdk']) {
    const installed = realpathSync(join(consumer, 'node_modules/@aij', name)); assert.ok(installed.startsWith(consumer + '/node_modules/'));
    for (const file of readdirSync(join(root, 'packages', name, 'dist')).filter(n => !n.startsWith('._'))) {
      assert.equal(digest(readFileSync(join(installed, 'dist', file))), digest(readFileSync(join(root, 'packages', name, 'dist', file)))); byteMatchedFiles++;
    }
  }
  writeFileSync(join(consumer, 'entry.mjs'), "export * from '@aij/sdk';\n");
  const types = `import {createClientApi,createPersonalWorkflowExecutionClient,type WorkflowRef,type PublicationMetadata,type Preview,type RunEnvelope,type RecoveryEnvelope} from '@aij/sdk';
const client=createPersonalWorkflowExecutionClient(createClientApi(()=> 'http://example.invalid/api'));declare const ref:WorkflowRef;
const meta:Promise<PublicationMetadata>=client.publication('space',ref.workflowId);void meta;
void client.publish('space',{workflowId:ref.workflowId,expectedRevision:1,expectedPublicationEpoch:0});
void client.unpublish('space',ref.workflowId,{expectedRevision:1,expectedPublicationEpoch:1});
const preview:Promise<Preview>=client.preview('space',ref.id);void preview;
const run:Promise<RunEnvelope>=client.submit('space',{publicationId:ref.id,input:{text:'synthetic'},idempotencyKey:'request_key'});void run;
const recovery:Promise<RecoveryEnvelope>=client.recover('space','request_key');void recovery;void client.read('space','run');
// @ts-expect-error server identity/session can never be supplied in workflow input
client.submit('space',{publicationId:ref.id,input:{},idempotencyKey:'request_key',memberId:'forged'});
// @ts-expect-error publication epoch is numeric
client.unpublish('space',ref.workflowId,{expectedRevision:1,expectedPublicationEpoch:'1'});
// @ts-expect-error no client-selected read or fallback mode
client.read('space','run',{mode:'read'});
`;
  for (const ext of ['mts', 'cts']) { writeFileSync(join(consumer, 'types.' + ext), types); run(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--skipLibCheck', '--target', 'ES2022', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--lib', 'ES2022,DOM', join(consumer, 'types.' + ext)], consumer); }
  const log = run(process.execPath, ['--test', '--test-reporter=tap', 'scripts/verification/personal-workflow-http-live.test.mjs'], root, { ...process.env, AIJ_AF207_ROOT_ACCEPTANCE: 'true', AIJ_AF207_PACKED_CONSUMER: consumer }, 720000);
  writeFileSync(join(artifact, 'live.log'), log);
  for (const p of [/# tests 13\b/, /# pass 13\b/, /# fail 0\b/, /# skipped 0\b/]) assert.match(log, p);
  writeFileSync(join(artifact, 'packed-evidence.json'), JSON.stringify({ outsideRepository: true, independentEsmCjsNodeNext: true, byteMatchedFiles, noRootNodeModulesBorrowed: true }));
  console.log(JSON.stringify({ status: 'PASS', task: 'AF-207', actualHttpScenarios: 12, tapTests: 13, byteMatchedFiles, artifact, externalVendor: 'DEFERRED_NOT_PASSED' }));
} finally { assert.match(consumer, /^\/private\/tmp\/aij-af207-packed-[A-Za-z0-9]+$/); rmSync(consumer, { recursive: true, force: false }); }
