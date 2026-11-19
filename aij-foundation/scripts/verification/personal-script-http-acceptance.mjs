import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, realpathSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
assert.deepEqual(process.argv.slice(2), ['--root-af211']);
const root = '/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation'; assert.equal(process.cwd(), root);
const artifact = join(root, '.artifacts/auto-ai-program-20261105/W19', 'AF-211-actual-' + randomUUID()); mkdirSync(artifact, { recursive: true, mode: 0o700 });
const consumer = realpathSync(mkdtempSync('/private/tmp/aij-af211-packed-')); mkdirSync(join(consumer, 'packs'));
const run = (command, args, cwd = root, env = process.env, timeout = 180000) => {
  const r = spawnSync(command, args, { cwd, env, encoding: 'utf8', timeout, maxBuffer: 4 * 1024 * 1024 });
  if (r.error || r.status !== 0) { writeFileSync(join(artifact, 'failed-command.log'), (r.stdout ?? '') + '\n' + (r.stderr ?? '')); assert.fail('AF211 command failed: ' + artifact); }
  return r.stdout;
};
try {
  for (const name of ['contracts', 'sdk']) run('pnpm', ['pack', '--pack-destination', join(consumer, 'packs')], join(root, 'packages', name));
  const packs = readdirSync(join(consumer, 'packs')).filter(n => n.endsWith('.tgz') && !n.startsWith('._')); assert.equal(packs.length, 2);
  writeFileSync(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  run('npm', ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', ...packs.map(n => join(consumer, 'packs', n))], consumer);
  let byteMatchedFiles = 0; const hash = b => createHash('sha256').update(b).digest('hex');
  for (const name of ['contracts', 'sdk']) {
    const installed = realpathSync(join(consumer, 'node_modules/@aij', name)); assert.ok(installed.startsWith(consumer + '/node_modules/'));
    for (const file of readdirSync(join(root, 'packages', name, 'dist')).filter(n => !n.startsWith('._'))) {
      assert.equal(hash(readFileSync(join(installed, 'dist', file))), hash(readFileSync(join(root, 'packages', name, 'dist', file)))); byteMatchedFiles++;
    }
  }
  writeFileSync(join(consumer, 'entry.mjs'), "export * from '@aij/sdk';\n");
  const types = `import {createClientApi,createPersonalScriptExecutionClient,type ScriptRef,type ScriptRun,type ScriptCapability,type ScriptCreateInput} from '@aij/sdk';
const c=createPersonalScriptExecutionClient(createClientApi(()=> 'http://example.invalid/api'));declare const ref:ScriptRef;declare const run:ScriptRun;declare const input:ScriptCreateInput;
const version:Promise<ScriptRef>=c.createVersion('space',input);void version;void c.version('space',ref.scriptVersionId);
const capability:Promise<ScriptCapability>=c.capability('space');void capability;
void c.submit('space',{scriptVersionId:ref.scriptVersionId,input:null,idempotencyKey:'request_key'});void c.recover('space','request_key');void c.read('space',run.id);void c.download('space',run,{signal:new AbortController().signal});
// @ts-expect-error server identity cannot be supplied in a script request
c.submit('space',{scriptVersionId:ref.scriptVersionId,input:{},idempotencyKey:'request_key',memberId:'forged'});
// @ts-expect-error callers cannot select a fallback read mode
c.read('space',run.id,{mode:'read'});
`;
  for (const ext of ['mts', 'cts']) { writeFileSync(join(consumer, 'types.' + ext), types); run(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--skipLibCheck', '--target', 'ES2022', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--lib', 'ES2022,DOM', join(consumer, 'types.' + ext)], consumer); }
  const log = run(process.execPath, ['--test', '--test-reporter=tap', 'scripts/verification/personal-script-http-live.test.mjs'], root, { ...process.env, AIJ_AF211_ROOT_ACCEPTANCE: 'true', AIJ_AF211_PACKED_CONSUMER: consumer }, 660000);
  writeFileSync(join(artifact, 'live.log'), log);
  for (const p of [/# tests 11\b/, /# pass 11\b/, /# fail 0\b/, /# skipped 0\b/]) assert.match(log, p);
  writeFileSync(join(artifact, 'packed-evidence.json'), JSON.stringify({ outsideRepository: true, independentEsmCjsNodeNext: true, byteMatchedFiles, noRootNodeModulesBorrowed: true }));
  console.log(JSON.stringify({ status: 'PASS', task: 'AF-211', actualHttpScenarios: 10, tapTests: 11, byteMatchedFiles, artifact, vendor: 'DEFERRED_NOT_PASSED' }));
} finally { assert.match(consumer, /^\/private\/tmp\/aij-af211-packed-[A-Za-z0-9]+$/); rmSync(consumer, { recursive: true, force: false }); }
