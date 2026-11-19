import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const base = resolve('.artifacts/af175');
mkdirSync(base, { recursive: true });
const compiled = mkdtempSync(join(base, 'compiled-'));
execFileSync(process.execPath, [require.resolve('typescript/bin/tsc'),
  'apps/api/src/plugins/aij-ai/python-sandbox-runner.ts', '--module', 'commonjs', '--target', 'ES2022',
  '--moduleResolution', 'node', '--types', 'node', '--strict', '--skipLibCheck', '--outDir', compiled], { stdio: 'pipe' });
const { PythonSandboxRunner } = require(join(compiled, 'python-sandbox-runner.js'));
const image = `docker.io/library/python@sha256:${'a'.repeat(64)}`;
const imageId = `sha256:${'b'.repeat(64)}`;
const id = 'c'.repeat(64);
const request = { script: 'PRIVATE_SCRIPT_never_execute_on_host', inputJson: '{"text":"合成 🐍"}' };
const delay = ms => new Promise(r => setTimeout(r, ms));

function fixture(mode = 'ok') {
  const dir = mkdtempSync(join(base, 'fake-'));
  const cli = join(dir, 'docker-owned-fixture');
  const state = join(dir, 'state.json');
  const log = join(dir, 'calls.jsonl');
  const seen = join(dir, 'seen');
  // This executable records the actual spawn protocol. It NEVER executes Python or the supplied source.
  writeFileSync(cli, `#!${process.execPath}
const fs=require('node:fs');
const args=process.argv.slice(2), mode=${JSON.stringify(mode)}, state=${JSON.stringify(state)}, log=${JSON.stringify(log)}, seen=${JSON.stringify(seen)};
const id=${JSON.stringify(id)}, image=${JSON.stringify(image)}, imageId=${JSON.stringify(imageId)};
fs.appendFileSync(log,JSON.stringify({args,env:process.env})+'\\n');
let s=fs.existsSync(state)?JSON.parse(fs.readFileSync(state)):null;
const save=()=>fs.writeFileSync(state,JSON.stringify(s));
const error=()=>{process.stderr.write('DAEMON_PRIVATE_SECRET');process.exitCode=1;};
const absent=()=>{process.stderr.write('Error: No such container: '+args.at(-1)+'\\n');process.exitCode=1;};
(async()=>{
if(args[0]==='image') {if(mode==='missing-image')return error(); console.log(JSON.stringify(imageId));return;}
if(args[1]==='create') {
 if(mode==='create-error')return error();
 if(mode==='create-timeout-absent'){await new Promise(r=>setTimeout(r,10000));return error();}
 s={id,name:'/'+args[args.indexOf('--name')+1],nonce:args[args.indexOf('--label')+1].split('=')[1],image,imageId,state:'created',exitCode:0,oomKilled:false};save();fs.writeFileSync(seen,'create');
 if(mode==='control-flood'){process.stdout.write('x'.repeat(32768));await new Promise(r=>setTimeout(r,10000));return;}
 if(mode==='create-timeout')await new Promise(r=>setTimeout(r,10000));
 if(mode==='create-delay')await new Promise(r=>setTimeout(r,250));
 if(mode==='lost-create')return error();
 console.log(mode==='bad-id'?'short-id':mode==='stale-create-id'?'e'.repeat(64):id);return;
}
if(args[1]==='inspect') {
 if(mode==='inspect-error'||(mode==='confirm-unavailable'&&fs.existsSync(seen)&&fs.readFileSync(seen,'utf8')==='removed'))return error();
 if(!s){if(mode==='missing-newline')console.log('');if(mode==='missing-array')console.log('[]');if(mode==='missing-nonempty')console.log('unexpected');return absent();}
 if(mode==='unknown-owner')s.nonce='foreign';
 if(mode==='unknown-image')s.imageId='sha256:'+'d'.repeat(64);
 if(mode==='unknown-name')s.name='/foreign';
 if(mode==='bad-inspect-id')s.id='short';
 if(mode==='stale-owner'&&s.state==='exited')s.nonce='foreign';
 console.log(mode==='malformed-inspect'?'not-json':JSON.stringify(s));return;
}
if(args[1]==='start') {
 s.state='running';save();fs.writeFileSync(seen,'start');
 if(mode==='start-error')return error();
 let input='';for await(const c of process.stdin)input+=c;
 fs.writeFileSync(${JSON.stringify(join(dir, 'protocol'))},input);
 if(mode==='slow'||mode==='start-delay'||mode==='owner-after-kill')await new Promise(r=>setTimeout(r,3000));
 if(mode==='output-flood'){process.stdout.write('x'.repeat(128*1024));await new Promise(r=>setTimeout(r,3000));return;}
 if(mode==='stderr-flood'){process.stderr.write('x'.repeat(128*1024));await new Promise(r=>setTimeout(r,3000));return;}
 s.state='exited';s.exitCode=mode==='nonzero'?7:mode==='oom'?137:0;s.oomKilled=mode==='oom';save();
 if(mode==='invalid-utf8')process.stdout.write(Buffer.from([0xc3,0x28]));
 else if(mode==='invalid-stderr')process.stderr.write(Buffer.from([0xff]));
 else if(mode==='exact-cap'){process.stdout.write('x'.repeat(65536));process.stderr.write('x'.repeat(65536));}
 else if(mode==='split-utf8'){const bytes=Buffer.from('合成 🐍');process.stdout.write(bytes.subarray(0,1));await new Promise(r=>setTimeout(r,10));process.stdout.write(bytes.subarray(1));}
 else {process.stdout.write('合成 🐍 42\\n');process.stderr.write('script-private-stderr');}
 process.exitCode=s.exitCode;return;
}
if(args[1]==='kill') {s.state='exited';s.exitCode=137;if(mode==='owner-after-kill')s.nonce='foreign';save();return;}
if(args[1]==='rm') {
 if(mode==='remove-error')return error();
 if(mode!=='remove-lies')fs.unlinkSync(state);
 fs.writeFileSync(seen,'removed');
 console.log(id);return;
}
throw Error('unexpected command');
})();
`, { mode: 0o700 });
  const runner = new PythonSandboxRunner({ enabled: true, dockerCliPath: cli, approvedImage: image });
  return { runner, cli, state, seen, dir, calls: () => existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(x => JSON.parse(x)) : [],
    cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
async function withFixture(mode, fn) { const f = fixture(mode); try { await fn(f); } finally { f.cleanup(); } }
async function until(f, stage) {
  for (let i = 0; i < 400; i++) { if (existsSync(f.seen) && readFileSync(f.seen, 'utf8') === stage) return; await delay(5); }
  assert.fail(`fixture did not reach ${stage}`);
}

try {
  await test('AF-175 compiled actual adapter: admission, data validation and no host fallback', async t => {
    await t.test('disabled by default; trusted config rejects mutable images and relative/missing CLI', async () => {
      assert.equal((await new PythonSandboxRunner().run(request)).outcome, 'DISABLED');
      for (const options of [{ dockerCliPath: 'docker', approvedImage: image }, { dockerCliPath: '/bin/docker', approvedImage: 'python:latest' },
        { dockerCliPath: '/bin/docker', approvedImage: image, maxConcurrency: 3 }]) {
        assert.equal((await new PythonSandboxRunner({ enabled: true, ...options }).run(request)).outcome, 'INVALID_CONFIGURATION');
      }
      assert.equal((await new PythonSandboxRunner({ enabled: true, dockerCliPath: '/nonexistent/docker', approvedImage: image }).run(request)).outcome, 'EXECUTION_FAILED');
    });
    await t.test('strict size, finite number, duplicate keys, Unicode, depth and key count refusal before CLI', async () => withFixture('ok', async f => {
      for (const bad of [{ script: 'x'.repeat(65537) }, { script: '\ud800' }, { inputJson: '1e400' }, { inputJson: 'NaN' },
        { inputJson: '"\\ud800"' }, { inputJson: '{"a":1,"\\u0061":2}' }, { inputJson: '"' + 'x'.repeat(262145) + '"' },
        { inputJson: '['.repeat(34) + '0' + ']'.repeat(34) }, { inputJson: JSON.stringify(Array(10001).fill(0)) }, { timeoutMs: 30001 }]) {
        assert.equal((await f.runner.run({ ...request, ...bad })).outcome, 'INVALID_INPUT');
      }
      assert.equal(f.calls().length, 0);
    }));
    await t.test('pre-aborted request and missing local image never create', async () => withFixture('missing-image', async f => {
      const abort = new AbortController(); abort.abort();
      assert.equal((await f.runner.run({ ...request, signal: abort.signal })).outcome, 'ABORTED');
      assert.equal((await f.runner.run(request)).outcome, 'IMAGE_UNAVAILABLE');
      assert.equal(f.calls().some(x => x.args[1] === 'create'), false);
    }));
  });
  await test('AF-175 precise spawn policy, JSON stdin and successful owned cleanup', async () => withFixture('ok', async f => {
    process.env.AIJ_SYNTHETIC_SECRET = 'never-inherit';
    const result = await f.runner.run(request);
    delete process.env.AIJ_SYNTHETIC_SECRET;
    assert.deepEqual(result, { outcome: 'SUCCESS', stdout: '合成 🐍 42\n', stderr: 'script-private-stderr', exitCode: 0, cleanupConfirmed: true });
    assert.ok(readFileSync(join(f.dir, 'protocol'), 'utf8').endsWith('\n'));
    assert.deepEqual(JSON.parse(readFileSync(join(f.dir, 'protocol'), 'utf8')), { script: request.script, input: JSON.parse(request.inputJson) });
    assert.equal(existsSync(f.state), false);
    const calls = f.calls(), create = calls.find(x => x.args[1] === 'create').args;
    const expected = ['container', 'create', '--pull', 'never', '--name', create[5], '--label', create[7],
      '--network', 'none', '--read-only', '--user', '65532:65532', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
      '--pids-limit', '32', '--cpus', '1', '--memory', '256m', '--memory-swap', '256m', '--ulimit', 'nofile=64:64', '--ulimit', 'core=0',
      '--log-driver', 'none', '--tmpfs', '/work:rw,noexec,nosuid,size=64m,mode=1777', '--tmpfs', '/tmp:rw,noexec,nosuid,size=16m,mode=1777',
      '--workdir', '/work', '--ipc', 'private', '--pid', '', '--cgroupns', 'private', '--no-healthcheck', '--interactive', '--attach', 'stdin', '--attach', 'stdout', '--attach', 'stderr',
      '--entrypoint', '/usr/local/bin/python3', image, '-I', '-S', '-B', '-u', '-c', create.at(-1)];
    assert.deepEqual(create, expected);
    assert.match(create[5], /^aij-python-[a-f0-9]{32}$/);
    assert.match(create[7], /^io\.aij\.python-sandbox\.nonce=[a-f0-9]{48}$/);
    for (const call of calls) {
      assert.equal(JSON.stringify(call.args).includes(request.script), false);
      assert.equal(JSON.stringify(call.args).includes('合成'), false);
      // macOS may inject this nonsecret CoreFoundation locale key after spawn.
      assert.deepEqual(Object.keys(call.env).filter(k => k !== '__CF_USER_TEXT_ENCODING').sort(), ['DOCKER_CONFIG', 'HOME', 'LANG', 'PATH']);
      assert.equal(call.env.AIJ_SYNTHETIC_SECRET, undefined);
    }
    assert.deepEqual(calls.find(x => x.args[1] === 'start').args, ['container', 'start', '--attach', '--interactive', id]);
    assert.equal(calls.some(x => ['pull', 'run', 'build', 'ps', 'prune'].includes(x.args[0])), false);
    assert.equal(calls.filter(x => x.args[1] === 'inspect').slice(-2).every(x => [id, create[5]].includes(x.args.at(-1))), true);
  }));
  await test('AF-175 bounded streams, safe nonzero and control errors', async t => {
    for (const [mode, outcome] of [['nonzero', 'SCRIPT_NONZERO'], ['oom', 'OOM_KILLED'], ['invalid-utf8', 'INVALID_UTF8'], ['invalid-stderr', 'INVALID_UTF8'],
      ['control-flood', 'EXECUTION_FAILED'], ['create-timeout', 'EXECUTION_FAILED'],
      ['output-flood', 'OUTPUT_LIMIT'], ['stderr-flood', 'OUTPUT_LIMIT'], ['start-error', 'EXECUTION_FAILED'],
      ['lost-create', 'EXECUTION_FAILED'], ['bad-id', 'EXECUTION_FAILED'], ['create-error', 'CLEANUP_UNCONFIRMED'], ['create-timeout-absent', 'CLEANUP_UNCONFIRMED']]) {
      await t.test(mode, () => withFixture(mode, async f => {
        const result = await f.runner.run(request);
        assert.equal(result.outcome, outcome);
        assert.equal(JSON.stringify(result).includes('DAEMON_PRIVATE_SECRET'), false);
        assert.ok(Buffer.byteLength(result.stdout) <= 65536 && Buffer.byteLength(result.stderr) <= 65536);
        if (mode !== 'create-error') assert.equal(existsSync(f.state), false);
        assert.equal(result.cleanupConfirmed, outcome !== 'CLEANUP_UNCONFIRMED');
      }));
    }
  });
  await test('AF-175 exact output caps and UTF8 split across chunks', async () => {
    await withFixture('exact-cap', async f => {
      const result = await f.runner.run(request); assert.equal(result.outcome, 'SUCCESS');
      assert.equal(Buffer.byteLength(result.stdout), 65536); assert.equal(Buffer.byteLength(result.stderr), 65536);
    });
    await withFixture('split-utf8', async f => {
      const result = await f.runner.run(request); assert.equal(result.outcome, 'SUCCESS'); assert.equal(result.stdout, '合成 🐍');
    });
  });
  await test('AF-175 actual Docker missing-object stdout formatting without accepting unknown output', async t => {
    for (const [mode, outcome] of [['missing-newline', 'SUCCESS'], ['missing-array', 'SUCCESS'], ['missing-nonempty', 'CLEANUP_UNCONFIRMED']]) {
      await t.test(mode, () => withFixture(mode, async f => {
        const result = await f.runner.run(request);
        assert.equal(result.outcome, outcome);assert.equal(result.cleanupConfirmed, outcome === 'SUCCESS');
        assert.equal(existsSync(f.state), false);
      }));
    }
  });
  await test('AF-175 unknown ownership and uncertain removal fail closed without touching a foreign ID', async t => {
    for (const mode of ['unknown-owner', 'unknown-image', 'unknown-name', 'bad-inspect-id', 'malformed-inspect', 'inspect-error', 'stale-owner', 'remove-error', 'remove-lies', 'stale-create-id', 'confirm-unavailable']) {
      await t.test(mode, () => withFixture(mode, async f => {
        const result = await f.runner.run(request);
        assert.equal(result.outcome, 'CLEANUP_UNCONFIRMED');
        assert.equal(result.cleanupConfirmed, false);
        assert.equal(result.stdout, ''); assert.equal(result.stderr, '');
        if (!mode.startsWith('remove-') && mode !== 'confirm-unavailable') assert.equal(f.calls().some(x => ['kill', 'rm'].includes(x.args[1])), false);
      }));
    }
  });
  await test('AF-175 cancellation at create/start, deadline and immediate concurrency refusal', async t => {
    await t.test('create settles before abort cleanup; never start after admission is cancelled', () => withFixture('create-delay', async f => {
      const controller = new AbortController();
      const run = f.runner.run({ ...request, signal: controller.signal });
      await until(f, 'create'); controller.abort();
      assert.equal((await run).outcome, 'ABORTED');
      assert.equal(f.calls().some(x => x.args[1] === 'start'), false);
      assert.equal(existsSync(f.state), false);
    }));
    await t.test('abort attached CLI still kills/removes exact owned container; no queued admissions', () => withFixture('slow', async f => {
      const controller = new AbortController();
      const run = f.runner.run({ ...request, signal: controller.signal });
      await until(f, 'start');
      assert.equal((await f.runner.run(request)).outcome, 'BUSY');
      const pre = new AbortController(); pre.abort();
      assert.equal((await f.runner.run({ ...request, signal: pre.signal })).outcome, 'ABORTED');
      controller.abort(); const result = await run;
      assert.equal(result.outcome, 'ABORTED'); assert.equal(result.cleanupConfirmed, true);
      assert.deepEqual(f.calls().find(x => x.args[1] === 'kill').args, ['container', 'kill', '--signal', 'KILL', id]);
      assert.equal(existsSync(f.state), false);
    }));
    await t.test('ownership changing after kill forbids removal', () => withFixture('owner-after-kill', async f => {
      const controller = new AbortController(); const run = f.runner.run({ ...request, signal: controller.signal });
      await until(f, 'start'); controller.abort();
      assert.equal((await run).outcome, 'CLEANUP_UNCONFIRMED');
      assert.equal(f.calls().filter(x => x.args[1] === 'kill').length, 1);
      assert.equal(f.calls().some(x => x.args[1] === 'rm'), false);
    }));
    await t.test('deadline removes running container; admission capacity returns', () => withFixture('slow', async f => {
      const result = await f.runner.run({ ...request, timeoutMs: 400 });
      assert.equal(result.outcome, 'TIMEOUT'); assert.equal(result.cleanupConfirmed, true);
      assert.equal(existsSync(f.state), false);
      assert.notEqual((await f.runner.run({ ...request, timeoutMs: 400 })).outcome, 'BUSY');
    }));
  });
} finally { rmSync(compiled, { recursive: true, force: true }); }
