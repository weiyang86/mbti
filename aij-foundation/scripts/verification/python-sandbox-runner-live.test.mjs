/** ROOT ONLY. Never invoke Docker from a Worker. No pull/build/global list/prune/config changes here. */
import assert from 'node:assert/strict';
import { execFileSync, execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import {randomBytes} from 'node:crypto';
import { join, resolve, isAbsolute } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const main = '/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation';
const acknowledged = process.env.AIJ_PYTHON_SANDBOX_LIVE_ACK === 'OWNED_CONTAINERS_ONLY';
const cli = process.env.AIJ_PYTHON_SANDBOX_DOCKER_CLI;
const image = process.env.AIJ_PYTHON_SANDBOX_IMAGE;
const env = { PATH: '/usr/bin:/bin', HOME: '/nonexistent', DOCKER_CONFIG: '/nonexistent/aij-python-docker-config', LANG: 'C.UTF-8' };
const runFile = promisify(execFile);

await test('AF-175 ROOT ONLY fresh real Docker container gate', { skip: !acknowledged && 'NOT_RUN: root ownership acknowledgement absent', timeout: 180_000 }, async t => {
  // All guards run before even inspecting the daemon/image.
  assert.equal(realpathSync(process.cwd()), realpathSync(main), 'must run in original main workspace');
  assert.equal(execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim(), 'dev');
  assert.ok(typeof cli === 'string' && isAbsolute(cli), 'trusted absolute CLI required');
  assert.match(image ?? '', /^docker\.io\/library\/python@sha256:[a-f0-9]{64}$/);
  const require = createRequire(import.meta.url);
  const base = resolve('.artifacts/af175'); mkdirSync(base, { recursive: true });
  const compiled=resolve(process.env.AIJ_AF175_COMPILED_API_DIR || 'apps/api/dist');
  assert.equal(compiled,resolve('apps/api/dist'),'actual root API build required; no scratch transpilation');
  const { PythonSandboxRunner } = require(join(compiled, 'plugins/aij-ai/python-sandbox-runner.js'));
  const runner = new PythonSandboxRunner({ enabled: true, dockerCliPath: cli, approvedImage: image });
  const owned = new Map();
  const proof={status:'INCOMPLETE',image,cli,ownedContainers:[],allOwnedAbsent:false,policyErrors:[]};
  const proofPath=join(base,'live-'+randomBytes(8).toString('hex')+'.json');
  const save=()=>writeFileSync(proofPath,JSON.stringify(proof,null,2)+'\n');save();
  const docker = async args => {
    try { return (await runFile(cli, args, { env, cwd: '/', timeout: 5_000, maxBuffer: 64 * 1024, shell: false })).stdout; }
    catch (error) {
      const target = args.at(-1);
      const missing = error.code === 1 && [`Error: No such container: ${target}`, `Error: No such object: ${target}`,
        `Error response from daemon: No such container: ${target}`].includes(String(error.stderr).trim());
      const safe = new Error('Owned Docker control request failed');
      Object.defineProperty(safe, 'missing', { value: missing });
      throw safe;
    }
  };
  const inspect = async target => JSON.parse(await docker(['container', 'inspect', target]))[0];
  const absent = async target => {
    try { await docker(['container', 'inspect', target]); return false; }
    catch (error) {
      return error.missing === true;
    }
  };
  const localImage = JSON.parse(await docker(['image', 'inspect', '--format', '{{json .Id}}', image]));
  assert.match(localImage, /^sha256:[a-f0-9]{64}$/); // Missing image is a real gate failure; do not pull here.
  const original = runner.process.bind(runner);
  let abortOnCreate, abortOnStart, observedStartAbort=Promise.resolve(false);
  // Test-only observation of actual create responses, never a substituted process/daemon.
  runner.process = async (args, ...rest) => {
    try {
    if (args[1] === 'start') {
      const entry = owned.get(args.at(-1)); assert.ok(entry, 'start only recorded own full ID');
      const info = await inspect(entry.id);
      assert.equal(info.Id, entry.id); assert.equal(info.Name, `/${entry.name}`);
      assert.equal(info.Config.Labels['io.aij.python-sandbox.nonce'], entry.nonce);
      assert.equal(info.Config.Image, image); assert.equal(info.Image, localImage);
      assert.equal(info.Config.OpenStdin, true); assert.equal(info.Config.StdinOnce, true);
      assert.equal(info.Config.User, '65532:65532'); assert.equal(info.Config.WorkingDir, '/work');
      assert.equal(info.HostConfig.NetworkMode, 'none'); assert.equal(info.HostConfig.ReadonlyRootfs, true);
      assert.equal(info.HostConfig.Privileged, false); assert.deepEqual(info.HostConfig.CapDrop, ['ALL']);
      assert.ok(info.HostConfig.SecurityOpt.includes('no-new-privileges'));
      assert.equal(info.HostConfig.SecurityOpt.some(v => v.includes('unconfined')), false);
      assert.equal(info.HostConfig.PidsLimit, 32); assert.equal(info.HostConfig.NanoCpus, 1_000_000_000);
      assert.equal(info.HostConfig.Memory, 256 * 1024 * 1024); assert.equal(info.HostConfig.MemorySwap, 256 * 1024 * 1024);
      assert.equal(info.HostConfig.LogConfig.Type, 'none');
      assert.deepEqual(info.HostConfig.Binds ?? [], []); assert.deepEqual(info.HostConfig.Devices ?? [], []);
      assert.deepEqual(info.HostConfig.PortBindings ?? {}, {}); assert.equal(info.HostConfig.PublishAllPorts, false);
      assert.notEqual(info.HostConfig.PidMode, 'host'); assert.equal(info.HostConfig.IpcMode, 'private');
      assert.equal(info.HostConfig.CgroupnsMode, 'private');
      assert.deepEqual(info.HostConfig.Tmpfs, { '/work': 'rw,noexec,nosuid,size=64m,mode=1777', '/tmp': 'rw,noexec,nosuid,size=16m,mode=1777' });
      assert.ok(info.Mounts.every(m => m.Type === 'tmpfs' && ['/work', '/tmp'].includes(m.Destination)));
      assert.deepEqual(info.HostConfig.Ulimits.map(v => [v.Name, v.Soft, v.Hard]).sort(), [['core', 0, 0], ['nofile', 64, 64]]);
      assert.deepEqual(info.Config.Entrypoint, ['/usr/local/bin/python3']);
      const allowedEnv = new Set(['PATH', 'LANG', 'PYTHON_VERSION', 'PYTHON_SHA256', 'GPG_KEY', 'HOME', 'HOSTNAME']);
      for (const value of info.Config.Env) assert.ok(allowedEnv.has(value.split('=')[0]), 'image env allowlist; never print credential data');
      if (abortOnStart) {
        const controller=abortOnStart;
        observedStartAbort=(async()=>{
          for(let i=0;i<100;i++){
            const current=await inspect(entry.id);
            if(current.State.Status==='running'){proof.abortAtRunning=true;save();controller.abort();return true;}
            await new Promise(resolve=>setTimeout(resolve,10));
          }
          return false;
        })();
      }
    }
    if (['kill', 'rm'].includes(args[1])) {
      const entry = owned.get(args.at(-1)); assert.ok(entry, 'mutation only recorded own full ID');
      const info = await inspect(entry.id);
      assert.equal(info.Name, `/${entry.name}`); assert.equal(info.Config.Labels['io.aij.python-sandbox.nonce'], entry.nonce);
      assert.equal(info.Config.Image, image); assert.equal(info.Image, localImage);
    }
    const result = await original(args, ...rest);
    if (args[1] === 'create' && result.code === 0 && !result.fault) {
      const id = result.stdout.toString('utf8').trim(); assert.match(id, /^[a-f0-9]{64}$/);
      owned.set(id, { id, name: args[args.indexOf('--name') + 1], nonce: args[args.indexOf('--label') + 1].split('=')[1] });
      proof.ownedContainers=[...owned.values()];save();
      if (abortOnCreate) abortOnCreate.abort();
    }
    return result;
    } catch(error){proof.policyErrors.push({operation:args[1],kind:error.name,message:String(error.message).split('\n')[0]});save();throw error;}
  };
  const run = async (script, input = {}, options = {}) => {
    const result = await runner.run({ script, inputJson: JSON.stringify(input), ...options });
    assert.equal(result.cleanupConfirmed, true, `cleanup required: ${result.outcome}`);
    for (const entry of owned.values()) { assert.equal(await absent(entry.id), true); assert.equal(await absent(entry.name), true); }
    return result;
  };
  try {
    await t.test('actual arithmetic and JSON Unicode', async () => {
      const result = await run('import json\nprint(json.dumps({"n":input_data["n"]*6,"text":input_data["text"]},ensure_ascii=False))', { n: 7, text: '合成 🐍' });
      assert.equal(result.outcome, 'SUCCESS'); assert.deepEqual(JSON.parse(result.stdout), { n: 42, text: '合成 🐍' });
    });
    await t.test('UID, caps, no-new-privileges, default seccomp, filesystem, resource policy and absent credentials', async () => {
      const result = await run(`import os,json,resource
assert os.getuid()==65532 and os.getgid()==65532
status=dict(line.split(":",1) for line in open("/proc/self/status") if ":" in line)
assert int(status["CapEff"].strip(),16)==0
assert status["NoNewPrivs"].strip()=="1" and status["Seccomp"].strip()=="2"
assert resource.getrlimit(resource.RLIMIT_NOFILE)==(64,64)
assert resource.getrlimit(resource.RLIMIT_CORE)==(0,0)
for path in ["/work/owned-test","/tmp/owned-test"]:
 open(path,"w").write("synthetic")
try:
 open("/owned-root-denied","w").write("x")
 raise AssertionError("root write allowed")
except OSError: pass
assert not os.path.exists("/var/run/docker.sock")
assert set(os.environ).issubset({"PATH","LANG","PYTHON_VERSION","PYTHON_SHA256","GPG_KEY","HOME","HOSTNAME"})
assert open("/sys/fs/cgroup/memory.max").read().strip()=="268435456"
assert open("/sys/fs/cgroup/pids.max").read().strip()=="32"
assert open("/sys/fs/cgroup/cpu.max").read().split()[0]=="100000"
print("policy-ok")`);
      assert.equal(result.outcome, 'SUCCESS'); assert.equal(result.stdout.trim(), 'policy-ok');
    });
    await t.test('DNS/outbound/host loopback unavailable', async () => {
      const result = await run(`import socket
for address in [("1.1.1.1",443),("127.0.0.1",3656),("host.docker.internal",3656)]:
 try:
  s=socket.create_connection(address,timeout=0.3);s.close();raise AssertionError("connection allowed")
 except OSError: pass
try:
 socket.getaddrinfo("example.com",443);raise AssertionError("DNS allowed")
except OSError: pass
print("network-denied")`);
      assert.equal(result.outcome, 'SUCCESS'); assert.equal(result.stdout.trim(), 'network-denied');
    });
    await t.test('nonzero and strict invalid UTF8', async () => {
      assert.equal((await run('raise RuntimeError("synthetic")')).outcome, 'SCRIPT_NONZERO');
      assert.equal((await run('import os\nos.write(1,b"\\xff")')).outcome, 'INVALID_UTF8');
    });
    await t.test('stdout/stderr floods and timeout always clean owned container', async () => {
      assert.equal((await run('import os\nwhile True: os.write(1,b"x"*8192)')).outcome, 'OUTPUT_LIMIT');
      assert.equal((await run('import os\nwhile True: os.write(2,b"x"*8192)')).outcome, 'OUTPUT_LIMIT');
      assert.equal((await run('while True: pass', {}, { timeoutMs: 1500 })).outcome, 'TIMEOUT');
    });
    await t.test('memory and PID enforcement', async () => {
      assert.equal((await run('a=bytearray(1024*1024*1024)', {}, { timeoutMs: 10_000 })).outcome, 'OOM_KILLED');
      const result = await run(`import os,time
children=[]
try:
 for i in range(40):
  pid=os.fork()
  if pid==0:
   time.sleep(5);os._exit(0)
  children.append(pid)
 raise AssertionError("pids limit not enforced")
except BlockingIOError:
 print("pids-denied",flush=True)
finally:
 for pid in children:
  os.kill(pid,9);os.waitpid(pid,0)
`);
      assert.equal(result.outcome, 'SUCCESS'); assert.equal(result.stdout.trim(), 'pids-denied');
    });
    await t.test('abort races after actual create and at attached start use only own IDs', async () => {
      abortOnCreate = new AbortController();
      assert.equal((await run('print(42)', {}, { signal: abortOnCreate.signal })).outcome, 'ABORTED'); abortOnCreate = undefined;
      abortOnStart = new AbortController();
      assert.equal((await run('import time\ntime.sleep(20)', {}, { signal: abortOnStart.signal })).outcome, 'ABORTED'); assert.equal(await observedStartAbort,true,'abort after actual running observation');abortOnStart = undefined;
    });
  } finally {
    // Read only exact IDs/names recorded above; adapter is solely responsible for mutations/cleanup.
    for (const entry of owned.values()) { assert.equal(await absent(entry.id), true, 'owned ID lingering'); assert.equal(await absent(entry.name), true, 'owned name lingering'); }
    proof.allOwnedAbsent=true;proof.status='EVIDENCE_ONLY_FORMAL_REPORT_IS_AUTHORITY';save();
  }
});
