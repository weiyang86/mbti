import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp, cp, rm, realpath, lstat, chmod } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { buildRuntimeBundle, removeRuntimeBundle } from '../document-export/runtime-bundle.mjs';

assert.deepEqual(process.argv.slice(2), ['--root-af199']);
assert.equal(process.cwd(), '/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation');
const root = process.cwd(), folder = path.join(root, '.artifacts/auto-ai-program-20261105/W16');
const read = async p => JSON.parse(await readFile(p, 'utf8'));
assert.equal((await read(path.join(root, '.artifacts/verification/AF-197/run-LueteM/report.json'))).status, 'PASS');
assert.equal((await read(path.join(root, '.artifacts/auto-ai-program-20261105/AF-197/I-complete.json'))).result.status, 'completed');
const tools = await read(path.join(folder, 'AF-199-tools-preparation.json'));
assert.match(tools.directory, /^\/private\/tmp\/aij-af199-linux-tools-[A-Za-z0-9]+$/);
assert.equal(await realpath(tools.directory), tools.directory);
const dockerBinary = path.join(tools.directory, 'extracted/usr/bin/docker');
assert.ok((await lstat(dockerBinary)).isFile());
const readerImage = 'sha256:80acefd47947dff8c2b664de6021bb9282c117532d540c6453707cbf958018bf';
const docker = '/usr/local/bin/docker';
const nonce = randomBytes(24).toString('hex'), name = 'aij-af199-qa-' + nonce;
const scratch = await mkdtemp('/private/tmp/aij-af199-root-');
const packet = path.join(scratch, 'qa'), bundle = path.join(scratch, 'runtime');
const output = path.join(folder, 'AF-199-linux-' + nonce);
await mkdir(packet); await mkdir(output, { mode: 0o777 }); await chmod(output, 0o777);
const hash = b => createHash('sha256').update(b).digest('hex');
function ctl(args) {
  const r = spawnSync(docker, args, { encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024 });
  assert.equal(r.error, undefined); assert.equal(r.status, 0, r.stderr?.slice(0, 2000)); return r.stdout;
}
const inventory = () => ctl(['container', 'ls', '-aq', '--no-trunc', '--filter', 'label=io.aij.document-export.nonce']).trim().split('\n').filter(Boolean).sort();
const baseline = inventory();
let built = false, outcome, primaryError;
const cleanupErrors = [];
try {
  await buildRuntimeBundle({ destination: bundle, repositoryRoot: root }); built = true;
  // Exact public-code closure only, not repository/node_modules/env/data mounts.
  const api = path.join(packet, 'apps/api'); await mkdir(path.join(api, 'dist/documents'), { recursive: true });
  for (const file of ['document-renderer.js', 'document-renderer-cli.js']) await cp(path.join(bundle, file), path.join(api, 'dist/documents', file));
  await cp(path.join(root, 'apps/api/package.json'), path.join(api, 'package.json'));
  await cp(path.join(bundle, 'node_modules'), path.join(packet, 'node_modules'), { recursive: true });
  await cp(path.join(bundle, 'assets'), path.join(packet, 'assets'), { recursive: true });
  const deps = await read(path.join(folder, 'AF-197-private-deps.json'));
  const require = createRequire(path.join(deps.directory, 'package.json'));
  for (const pkg of ['typescript', '@types/node', 'undici-types']) {
    const file = require.resolve(pkg + '/package.json'), dir = path.dirname(file);
    await cp(dir, path.join(packet, 'node_modules', pkg), { recursive: true, filter: p => !path.relative(dir, p).split(path.sep).includes('node_modules') });
  }
  const sources = [
    'apps/api/src/documents/document-export-executor.ts',
    'scripts/document-export/runtime-bundle.mjs', 'scripts/document-export/build-runtime-image.mjs',
    'scripts/verification/document-export-executor-live.test.mjs', 'ops/document-export/Dockerfile',
  ];
  for (const file of sources) { const target = path.join(packet, file); await mkdir(path.dirname(target), { recursive: true }); await cp(path.join(root, file), target); }
  const code = `import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {spawnSync,execFileSync} from 'node:child_process';
import {buildRuntimeImage} from './scripts/document-export/build-runtime-image.mjs';
assert.equal(process.platform,'linux');
const cli=execFileSync('/usr/bin/docker',['version','--format','{{json .}}'],{encoding:'utf8'});writeFileSync('/output/docker-version.json',cli);
const built=await buildRuntimeImage({rootIntegration:true,dockerCliPath:'/usr/bin/docker'});
writeFileSync('/output/production-image.json',JSON.stringify(built,null,2));
assert.equal(JSON.parse(execFileSync('/usr/bin/docker',['image','inspect','--format','{{json .Id}}',built.imageId],{encoding:'utf8'})),built.imageId);
const test=spawnSync(process.execPath,['--test','--test-reporter=tap','scripts/verification/document-export-executor-live.test.mjs'],{env:{...process.env,AF199_ROOT_LIVE:'1',AF199_DOCKER_CLI:'/usr/bin/docker',AF199_IMAGE_ID:built.imageId},encoding:'utf8',timeout:210000,maxBuffer:4*1024*1024});
writeFileSync('/output/live.stdout.log',test.stdout??'');writeFileSync('/output/live.stderr.log',test.stderr??'');
assert.equal(test.error,undefined);assert.equal(test.status,0,'Actual Linux live test failed, see retained logs');
for(const pattern of [/# tests 1\\b/,/# pass 1\\b/,/# fail 0\\b/,/# skipped 0\\b/])assert.match(test.stdout,pattern);
console.log(JSON.stringify({status:'PASS',imageId:built.imageId,platform:process.platform,realTests:1,skipped:0}));
`;
  await writeFile(path.join(packet, 'run.mjs'), code);
  const packetReceipt = { nonce, sources: await Promise.all(sources.map(async file => ({ path: file, sha256: hash(await readFile(path.join(packet, file))) }))),
    cliSha256: hash(await readFile(dockerBinary)), nodeVersion: process.version,
    boundary: 'Trusted fixed QA host with controlled Docker socket; only narrow code/runtime closure mounted. Customer render children have no host mounts/network/env and retain original production isolation.' };
  await writeFile(path.join(output, 'packet.json'), JSON.stringify(packetReceipt, null, 2));
  const args = ['run', '--pull=never', '--rm', '-i', '--name', name, '--label', 'io.aij.qa.task=AF-199', '--label', 'io.aij.qa.nonce=' + nonce,
    '--read-only', '--network=none', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--user=0:0',
    '--memory=2g', '--pids-limit=256', '--cpus=2', '--tmpfs', '/tmp:rw,noexec,nosuid,size=1g,mode=1777', '--workdir=/qa',
    '--mount', `type=bind,src=${packet},dst=/qa,readonly`, '--mount', `type=bind,src=${dockerBinary},dst=/usr/bin/docker,readonly`,
    '--mount', 'type=bind,src=/var/run/docker.sock,dst=/var/run/docker.sock', '--mount', `type=bind,src=${output},dst=/output`,
    readerImage, '/usr/local/bin/node', '/qa/run.mjs'];
  const result = spawnSync(docker, args, { encoding: 'utf8', timeout: 390000, maxBuffer: 4 * 1024 * 1024 });
  await writeFile(path.join(output, 'qa.stdout.log'), result.stdout ?? ''); await writeFile(path.join(output, 'qa.stderr.log'), result.stderr ?? '');
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, 'Actual Linux QA failed; inspect ' + output);
  outcome = JSON.parse(result.stdout.trim()); assert.equal(outcome.status, 'PASS'); assert.equal(outcome.skipped, 0);
  assert.deepEqual(inventory(), baseline);
} catch (error) { primaryError = error; }
finally {
  try {
    const ids = ctl(['container', 'ls', '-aq', '--no-trunc', '--filter', 'name=^/' + name + '$']).trim();
    if (ids) {
      assert.match(ids, /^[a-f0-9]{64}$/);
      const [info] = JSON.parse(ctl(['container', 'inspect', ids]));
      assert.equal(info.Name, '/' + name); assert.equal(info.Config.Labels['io.aij.qa.nonce'], nonce); assert.equal(info.Config.Image, readerImage);
      ctl(['container', 'rm', '-f', ids]);
    }
    assert.equal(ctl(['container', 'ls', '-aq', '--no-trunc', '--filter', 'name=^/' + name + '$']).trim(), '');
  } catch (error) { cleanupErrors.push(error); }
  try { assert.deepEqual(inventory(), baseline); } catch (error) { cleanupErrors.push(error); }
  if (built) { try { await removeRuntimeBundle(bundle); await assert.rejects(lstat(bundle), { code: 'ENOENT' }); } catch (error) { cleanupErrors.push(error); } }
  if (cleanupErrors.length === 0) await rm(scratch, { recursive: true });
  await writeFile(path.join(output, 'cleanup.json'), JSON.stringify({ primaryFailure: primaryError?.message ?? null, cleanupErrors: cleanupErrors.map(e => e.message), baseline, remaining: inventory() }, null, 2));
}
if (primaryError || cleanupErrors.length) throw new AggregateError([...(primaryError ? [primaryError] : []), ...cleanupErrors], 'AF199_LINUX_OR_CLEANUP_FAILED: ' + output);
const evidence = { status: 'PASS', task: 'AF-199', nonce, output, outcome, readerImage, qaContainerRemoved: true, ownedContainersUnchanged: true, runtimeBundleRemoved: true,
  externalAcceptance: 'DEFERRED_NOT_PASSED', full40: 'NOT_RUN_TARGET_ACCEPTANCE', productionExposure: 'INTERNAL_DEFAULT_OFF_NO_API_OR_ATTACHMENTS' };
await writeFile(path.join(output, 'evidence.json'), JSON.stringify(evidence, null, 2));
await writeFile(path.join(folder, 'AF-199-linux-latest.json'), JSON.stringify({ output }, null, 2));
console.log(JSON.stringify(evidence));
