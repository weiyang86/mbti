import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, readdir, realpath, writeFile, copyFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { startWorkbenchTargetRuntime } from './workbench-sdk-target-runtime.mjs';
import { createWorkbenchTargetAdapter } from './workbench-sdk-target-adapter.mjs';

assert.deepEqual(process.argv.slice(2), ['--root-af215']);
const root = '/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation'; assert.equal(process.cwd(), root);
process.env.AIJ_AF215_ROOT_ACCEPTANCE = 'true';
const exec = promisify(execFile), hash = value => createHash('sha256').update(value).digest('hex');
const beforeEnvironment = { ...process.env }, beforeFetch = globalThis.fetch;
let runtime, adapter, consumerDirectory, server, mountClosed = false;
const proof = { task: 'AF-215', scope: 'actual composition, not native14/target/vendor acceptance', checks: [] }, matrix = [];
const check = async (name, action) => { await action(); proof.checks.push(name); };
try {
  runtime = await startWorkbenchTargetRuntime({ task: 'AF-215', transport: 'AiCenterHttpTransport:owned-loopback', concurrency: 1, freshLease: true });
  const artifact = runtime.artifactDirectory; proof.acceptanceId = runtime.acceptanceId;
  const run = async (name, command, args, cwd, environment = process.env) => {
    const startedAt = new Date().toISOString(); let r, exitCode = 0;
    try { r = await exec(command, args, { cwd, env: environment, timeout: 120000, maxBuffer: 2 * 1024 * 1024 }); }
    catch (e) { r = e; exitCode = e.code ?? 1; }
    const finishedAt = new Date().toISOString(), stdoutPath = join(artifact, name + '.stdout.log'), stderrPath = join(artifact, name + '.stderr.log');
    await writeFile(stdoutPath, r.stdout ?? '', { mode: 0o600 }); await writeFile(stderrPath, r.stderr ?? '', { mode: 0o600 });
    assert.equal(exitCode, 0, 'Actual subprocess failed: ' + name + '; see ' + artifact);
    return { name, command: [command, ...args], cwd, exitCode, startedAt, finishedAt, stdoutPath, stderrPath };
  };
  consumerDirectory = await realpath(await mkdtemp('/private/tmp/aij-af215-packed-'));
  await mkdir(join(artifact, 'packs'));
  const packages = {}, consumer = { directory: consumerDirectory, packages: {}, installedHashes: {}, lockSha256: '' };
  for (const name of ['contracts', 'sdk']) {
    await run('pack-' + name, 'pnpm', ['pack', '--pack-destination', join(artifact, 'packs')], join(root, 'packages', name));
    const names = (await readdir(join(artifact, 'packs'))).filter(f => f.startsWith('aij-' + name + '-') && f.endsWith('.tgz'));
    assert.equal(names.length, 1); packages[name + 'Tgz'] = join(artifact, 'packs', names[0]);
    const bytes = await readFile(packages[name + 'Tgz']); await copyFile(packages[name + 'Tgz'], join(consumerDirectory, name + '.tgz'));
    const metadata = JSON.parse(await readFile(join(root, 'packages', name, 'package.json'), 'utf8'));
    consumer.packages[name] = { version: metadata.version, sha256: hash(bytes) };
  }
  await writeFile(join(consumerDirectory, '.aij-target-consumer-owned.json'), JSON.stringify({ schemaVersion: 1, task: 'AF-215', acceptanceId: runtime.acceptanceId }));
  await writeFile(join(consumerDirectory, 'package.json'), JSON.stringify({ name: 'af215-original-sdk-composition', private: true, type: 'module' }));
  await run('install', 'npm', ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--save-exact', './contracts.tgz', './sdk.tgz'], consumerDirectory);
  const collect = async (directory, prefix) => { for (const f of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, f.name), key = prefix + '/' + f.name;
    if (f.isDirectory()) await collect(path, key); else consumer.installedHashes[key] = hash(await readFile(path));
  } };
  for (const name of ['contracts', 'sdk']) {
    const prefix = 'node_modules/@aij/' + name, directory = join(consumerDirectory, prefix);
    consumer.installedHashes[prefix + '/package.json'] = hash(await readFile(join(directory, 'package.json')));
    await collect(join(directory, 'dist'), prefix + '/dist');
  }
  consumer.lockSha256 = hash(await readFile(join(consumerDirectory, 'package-lock.json')));
  const mountConsumer = async ({ consumer: supplied, handler, route }) => {
    assert.equal(supplied, consumer); assert.equal(route, '/af191-consumer/');
    // An original SDK HTTP composition host, not a second product consumer UI.
    server = createServer((req, res) => { void handler(req, res).catch(() => { if (!res.headersSent) res.writeHead(502); res.end(); }); });
    await new Promise((yes, no) => { server.once('error', no); server.listen(0, '127.0.0.1', yes); });
    return { origin: `http://127.0.0.1:${server.address().port}`, close: async () => {
      server.closeAllConnections(); await new Promise(r => server.close(r));
      const ownedSockets = await new Promise((yes, no) => server.getConnections((e, n) => e ? no(e) : yes(n)));
      assert.equal(server.listening, false); assert.equal(ownedSockets, 0); mountClosed = true; return { ownedSockets };
    } };
  };
  adapter = await createWorkbenchTargetAdapter({ runtime, packages, mountConsumer });
  await check('missing native driver rejects before any mount or fallback', async () => {
    await assert.rejects(adapter.native('desktop-consumer-read'), /AF215_NATIVE_DRIVER_REQUIRED/); assert.equal(server, undefined);
  });
  const actor = 'owner'; let held = false, runId;
  const handler = async (req, res) => {
    assert.ok(req.url.startsWith('/api/client/'));
    const chunks = []; let size = 0; for await (const b of req) { size += b.length; assert.ok(size <= 8192); chunks.push(b); }
    const body = Buffer.concat(chunks), headers = {};
    for (const name of ['content-type', 'x-aij-workspace-id']) if (req.headers[name]) headers[name] = req.headers[name];
    const upstream = await adapter.fetchAsActor(actor, runtime.apiBaseUrl + req.url.slice(4), { method: req.method, headers, ...(body.length ? { body } : {}) });
    const bytes = Buffer.from(await upstream.arrayBuffer());
    if (held && req.method === 'POST') { held = false; assert.equal(upstream.status, 202); runId = JSON.parse(bytes.toString()).data.id; res.destroy(); return; }
    res.writeHead(upstream.status, Object.fromEntries(upstream.headers)); res.end(bytes);
  };
  const binding = await adapter.mountConsumer({ consumer, handler, route: '/af191-consumer/' });
  const processEnv = { ...beforeEnvironment, AIJ_AF215_BASE: binding.origin + '/api', AIJ_AF215_WORKSPACE: runtime.workspaceId };
  const key = 'af215-' + randomUUID();
  await writeFile(join(consumerDirectory, 'esm.mjs'), `import assert from 'node:assert/strict';import{createClientApi,createAiClient,createAiRunRecoveryClient}from'@aij/sdk';
const api=createClientApi(()=>process.env.AIJ_AF215_BASE),c=createAiClient(api),w=process.env.AIJ_AF215_WORKSPACE;
assert.ok((await c.listAgents(w)).some(a=>a.code==='general-text'));
await assert.rejects(c.submit(w,'general-text',{goal:'Synthetic composition goal'},${JSON.stringify(key)}),e=>e instanceof TypeError);
const recovered=await createAiRunRecoveryClient(api).recoverRequest(w,${JSON.stringify(key)});assert.equal(recovered.status,'queued');
assert.equal((await c.read(w,recovered.id)).id,recovered.id);\n`);
  // The original App commits one POST, then this owned proxy loses its response.
  held = true;
  matrix.push(await run('esm', process.execPath, ['esm.mjs'], consumerDirectory, processEnv));
  assert.ok(runId); proof.runId = runId;
  await check('outside installed ESM real one-POST unknown response and same-key GET recovery', async () => {
    assert.deepEqual(await adapter.counters(), { runs: 1, jobs: 1, traces: 0, upstream: 0, submits: 1 });
    assert.equal((await adapter.pumpJobs()).length, 1); assert.deepEqual(await adapter.pumpJobs(), []);
  });
  await writeFile(join(consumerDirectory, 'cjs.cjs'), `const assert=require('node:assert/strict');const{createClientApi,createAiClient}=require('@aij/sdk');
(async()=>{const c=createAiClient(createClientApi(()=>process.env.AIJ_AF215_BASE));const r=await c.read(process.env.AIJ_AF215_WORKSPACE,process.env.AIJ_AF215_RUN_ID);assert.equal(r.id,process.env.AIJ_AF215_RUN_ID);assert.equal(r.status,'succeeded');assert.equal(r.output,'Synthetic goal completed.');assert.equal(r.budgetStatus,'settled');})().catch(()=>{process.exitCode=1;});\n`);
  matrix.push(await run('cjs', process.execPath, ['cjs.cjs'], consumerDirectory, { ...processEnv, AIJ_AF215_RUN_ID: runId }));
  const types = "import{createClientApi,createAiClient,createAiRunRecoveryClient}from'@aij/sdk';import type{AiAgentRunResult}from'@aij/contracts';const api=createClientApi(()=> 'http://example.invalid/api');const c=createAiClient(api);const r:Promise<AiAgentRunResult>=c.read('workspace','run');void r;void c.submit('workspace','agent',{goal:'text'},'key');void createAiRunRecoveryClient(api).recoverRequest('workspace','key');\n";
  for (const ext of ['mts', 'cts']) {
    await writeFile(join(consumerDirectory, 'types.' + ext), types);
    matrix.push(await run(ext === 'mts' ? 'esm-types' : 'cjs-types', process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--skipLibCheck', '--target', 'ES2022', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--lib', 'ES2022,DOM', 'types.' + ext], consumerDirectory, beforeEnvironment));
  }
  await check('unchanged original transport and actual same Run/Job/Trace truth', async () => {
    const db = await adapter.databaseSnapshot(runId); assert.equal(db.run.id, runId); assert.equal(db.run.workspaceId, runtime.workspaceId); assert.equal(db.run.memberId, runtime.memberId);
    assert.equal(db.run.status, 'succeeded'); assert.equal(db.run.jobId, db.job.id); assert.equal(db.job.status, 'completed'); assert.equal(db.job.attempts, 1);
    assert.equal(db.traces.length, 1); assert.equal(db.traces[0].jobId, db.job.id); assert.equal(db.traces[0].status, 'succeeded');
    assert.equal(db.traces[0].costSource, 'unreported'); assert.equal(db.traces[0].costAmountNanos, null);
    assert.deepEqual(await adapter.counters(), { runs: 1, jobs: 1, traces: 1, upstream: 1, submits: 1 });
    assert.equal((await adapter.verifyTransportFence()).unchanged, true); assert.equal(adapter.transportEvidence().ownOverride, false);
  });
  await check('actual anonymous/permission/other member/workspace/current role/session refusals create no extra execution', async () => {
    const path = `client/ai/runs/${runId}`;
    for (const [actor, status] of [['anonymous', 401], ['no-permission', 403], ['other-member', 404]]) assert.equal((await adapter.request({ actor, path })).status, status);
    assert.equal((await adapter.request({ path, workspaceId: runtime.workspaceIds.second })).status, 404);
    await adapter.withOwnerReadOnly(async () => assert.equal((await adapter.request({ path: 'client/ai/agents' })).status, 403));
    await adapter.revokeOwnerSessions(); assert.equal((await adapter.request({ path })).status, 401);
    assert.deepEqual(await adapter.counters(), { runs: 1, jobs: 1, traces: 1, upstream: 1, submits: 1 });
  });
  await check('actual lease/pack/install/lock/PG/HTTP/matrix descriptors hash bytes without manufacturing native proof', async () => {
    const evidence = await adapter.evidence({ consumer, runId, native: [], matrix, sourceFiles: ['scripts/verification/workbench-sdk-target-adapter.mjs', 'scripts/verification/workbench-sdk-target-adapter-evidence.mjs', 'scripts/verification/workbench-sdk-target-runtime.mjs'] });
    assert.equal(evidence.native, 'NOT_RUN');
    for (const d of evidence.files) { assert.equal(d.task, 'AF-215'); assert.equal(d.acceptanceId, runtime.acceptanceId); assert.equal(hash(await readFile(join(root, d.path))), d.sha256); }
    proof.descriptors = evidence;
  });
  const closed = await adapter.close(); assert.equal(await adapter.close(), closed); assert.equal(mountClosed, true);
  for (const key of ['applicationPools0', 'ownedSockets0', 'fetchRestored', 'environmentRestored']) assert.equal(closed[key], true);
  assert.equal(globalThis.fetch, beforeFetch); assert.deepEqual({ ...process.env }, beforeEnvironment);
  await check('real acquired host and original runtime both close after invalid origin and missing injected closure proof', async () => {
    const second = await startWorkbenchTargetRuntime({ task: 'AF-215', transport: 'AiCenterHttpTransport:owned-loopback', concurrency: 1, freshLease: true });
    let acquired, secondAdapter;
    try {
      await writeFile(join(consumerDirectory, '.aij-target-consumer-owned.json'), JSON.stringify({ schemaVersion: 1, task: 'AF-215', acceptanceId: second.acceptanceId }));
      // Explicit root-only receipt fault injection: the actual owner is never
      // patched. It still closes and returns measured truth, which is checked
      // below. The adapter must reject the injected port's incomplete receipt.
      const incompletePort = { ...second, close: async () => { const truth = await second.close(); return { applicationPools0: truth.applicationPools0, ownedSockets0: truth.ownedSockets0, fetchRestored: truth.fetchRestored }; } };
      secondAdapter = await createWorkbenchTargetAdapter({ runtime: incompletePort, packages, mountConsumer: async () => {
        acquired = createServer((_, res) => { res.writeHead(404); res.end(); });
        await new Promise((yes, no) => { acquired.once('error', no); acquired.listen(0, '127.0.0.1', yes); });
        return { origin: `http://localhost:${acquired.address().port}`, close: async () => {
          acquired.closeAllConnections(); await new Promise(r => acquired.close(r));
          return { ownedSockets: await new Promise((yes, no) => acquired.getConnections((e, n) => e ? no(e) : yes(n))) };
        } };
      } });
      await assert.rejects(secondAdapter.mountConsumer({ consumer, handler, route: '/af191-consumer/' }), /AF215_HOST_ORIGIN/);
      const closeFailure = secondAdapter.close(); assert.equal(secondAdapter.close(), closeFailure); await assert.rejects(closeFailure, /AF215_CLOSE_RUNTIME/);
      assert.equal(acquired.listening, false);
      const actual = await second.close();
      for (const key of ['applicationPools0', 'ownedSockets0', 'fetchRestored', 'environmentRestored']) assert.equal(actual[key], true);
      assert.equal(globalThis.fetch, beforeFetch); assert.deepEqual({ ...process.env }, beforeEnvironment);
      proof.failureClosure = { acceptanceId: second.acceptanceId, invalidHostRejected: true, incompleteInjectedReceiptRejected: true, originalMeasuredClosure: actual };
    } finally {
      if (secondAdapter) await secondAdapter.close().catch(() => {});
      await second.close();
      if (acquired?.listening) { acquired.closeAllConnections(); await new Promise(r => acquired.close(r)); }
    }
  });
  proof.closed = closed; proof.status = 'PASS';
  await writeFile(join(artifact, 'af215-root-actual.json'), JSON.stringify(proof, null, 2) + '\n');
  console.log(JSON.stringify({ task: 'AF-215', status: 'PASS', acceptanceId: runtime.acceptanceId, checks: proof.checks.length, artifact, native: 'NOT_RUN', vendor: 'DEFERRED_NOT_PASSED' }));
} finally {
  if (adapter) await adapter.close(); else if (runtime) await runtime.close();
  if (server?.listening) { server.closeAllConnections(); await new Promise(r => server.close(r)); }
  if (consumerDirectory) { assert.match(consumerDirectory, /^\/private\/tmp\/aij-af215-packed-[A-Za-z0-9]+$/); await rm(consumerDirectory, { recursive: true }); }
}
