// ALL tests use synthetic collaborators and filesystem fixtures: composition only.
// No App/PG/HTTP server/GUI/vendor is started, and no target acceptance is claimed.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, realpath, symlink, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { gzipSync, deflateSync } from 'node:zlib';
import { createWorkbenchTargetAdapter, requiredNativeCases } from './workbench-sdk-target-adapter.mjs';
import { repositoryRoot, sha256, verifyConsumer, nativeReceipt, projectDatabase } from './workbench-sdk-target-adapter-evidence.mjs';

const privateText = 'UNIT_ONLY_PRIVATE_OUTPUT_NEVER_PERSIST';
async function files(directory, prefix = '') {
  const result = [];
  for (const d of await readdir(directory, { withFileTypes: true })) {
    // The synthetic archive models pnpm pack, which excludes OS metadata.
    if (d.name.startsWith('._')) continue;
    if (d.isDirectory()) result.push(...await files(join(directory, d.name), prefix + d.name + '/'));
    else result.push(prefix + d.name);
  }
  return result.sort();
}
function tar(entries) {
  const chunks = [];
  for (const [name, bytes] of entries) {
    const header = Buffer.alloc(512);
    header.write('package/' + name); header.write('0000644\0', 100); header.write('0000000\0', 108); header.write('0000000\0', 116);
    header.write(bytes.length.toString(8).padStart(11, '0') + '\0', 124); header.write('00000000000\0', 136);
    header.fill(32, 148, 156); header.write('0', 156); header.write('ustar\0', 257); header.write('00', 263);
    header.write([...header].reduce((a, b) => a + b, 0).toString(8).padStart(6, '0') + '\0 ', 148);
    chunks.push(header, bytes, Buffer.alloc((512 - bytes.length % 512) % 512));
  }
  return gzipSync(Buffer.concat([...chunks, Buffer.alloc(1024)]));
}
function png(width) {
  const crc = b => { let n = 0xffffffff; for (const v of b) { n ^= v; for (let k = 0; k < 8; k++) n = (n >>> 1) ^ ((n & 1) ? 0xedb88320 : 0); } return (n ^ 0xffffffff) >>> 0; };
  const chunk = (name, data) => {
    const length = Buffer.alloc(4), checksum = Buffer.alloc(4), body = Buffer.concat([Buffer.from(name), data]);
    length.writeUInt32BE(data.length); checksum.writeUInt32BE(crc(body)); return Buffer.concat([length, body, checksum]);
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.alloc(1 + width * 4))), chunk('IEND', Buffer.alloc(0))]);
}

async function fixture(t, options = {}) {
  const id = randomBytes(8).toString('hex');
  const artifacts = join(repositoryRoot, '.artifacts/af215-composition-units'); await mkdir(artifacts, { recursive: true });
  const artifactDirectory = await mkdtemp(join(artifacts, 'case-'));
  const external = await realpath(await mkdtemp(join(tmpdir(), 'aij-af215-composition-')));
  const leasePath = join(repositoryRoot, '.local-data/postgres/acceptance', id + '.json'); await mkdir(dirname(leasePath), { recursive: true });
  await writeFile(leasePath, JSON.stringify({ task: 'AF-215', id, mode: 'test', ready: true, repository: repositoryRoot,
    database: 'aij_foundation_af215_test_' + id, createdAt: new Date(Date.now() - 2000).toISOString(), instanceId: 'SYNTHETIC_COMPOSITION_ONLY' }), { flag: 'wx' });
  t.after(async () => { await rm(external, { recursive: true, force: true }); await rm(artifactDirectory, { recursive: true, force: true }); await rm(leasePath, { force: true }); });
  const consumer = { directory: external, packages: {}, installedHashes: {} }, packages = {}, lock = { lockfileVersion: 3, packages: {} };
  for (const name of ['contracts', 'sdk']) {
    const source = JSON.parse(await readFile(join(repositoryRoot, 'packages', name, 'package.json'), 'utf8'));
    const metadata = { ...source, ...(name === 'sdk' ? { dependencies: { '@aij/contracts': consumer.packages.contracts.version } } : {}) };
    const graph = new Map([['package.json', Buffer.from(JSON.stringify(metadata))]]);
    for (const path of await files(join(repositoryRoot, 'packages', name, 'dist'))) graph.set('dist/' + path, await readFile(join(repositoryRoot, 'packages', name, 'dist', path)));
    const archive = tar(graph);
    packages[name + 'Tgz'] = join(artifactDirectory, name + '.tgz'); await writeFile(packages[name + 'Tgz'], archive);
    await writeFile(join(external, name + '.tgz'), archive);
    consumer.packages[name] = { version: source.version, sha256: sha256(archive) };
    for (const [path, bytes] of graph) {
      const destination = join(external, 'node_modules/@aij', name, path); await mkdir(dirname(destination), { recursive: true }); await writeFile(destination, bytes);
      consumer.installedHashes[`node_modules/@aij/${name}/${path}`] = sha256(bytes);
    }
    lock.packages['node_modules/@aij/' + name] = { version: source.version, resolved: 'file:' + name + '.tgz',
      integrity: 'sha512-' + createHash('sha512').update(archive).digest('base64'), ...(metadata.dependencies ? { dependencies: metadata.dependencies } : {}) };
  }
  const lockBytes = Buffer.from(JSON.stringify(lock)); await writeFile(join(external, 'package-lock.json'), lockBytes); consumer.lockSha256 = sha256(lockBytes);
  await writeFile(join(external, '.aij-target-consumer-owned.json'), JSON.stringify({ schemaVersion: 1, task: 'AF-215', acceptanceId: id }));
  const counts = { runs: 0, jobs: 0, traces: 0, upstream: 0, submits: 0 }, calls = [], db = {
    run: { id: 'run1', projectId: 'project1', workspaceId: 'workspace1', memberId: 'member1', agentCode: 'general-text', jobId: 'job1', status: 'succeeded', budgetStatus: 'settled', output: privateText },
    job: { id: 'job1', scopeId: 'project1', workspaceId: 'workspace1', jobType: 'aij-ai.agent-execute', status: 'completed', attempts: 1 },
    traces: [{ id: 'trace1', projectId: 'project1', jobId: 'job1', attempt: 1, status: 'succeeded', costSource: 'unreported', costAmountNanos: null }]
  };
  const runtime = {
    task: 'AF-215', approvedLeaseTask: 'AF-215', acceptanceId: id, projectId: 'project1', workspaceId: 'workspace1', memberId: 'member1', agentCode: 'general-text',
    apiBaseUrl: 'http://127.0.0.1:32123/api', artifactDirectory,
    transportEvidence: () => ({ unchanged: true, ownOverride: false, forwarded: 0, upstream: 0, rejected: 0 }),
    counters: async () => counts,
    databaseSnapshot: async (...args) => { calls.push(['databaseSnapshot', ...args]); return db; },
    pumpJobs: async (...args) => { calls.push(['pumpJobs', ...args]); return ['job1']; },
    request: async arg => { calls.push(['request', arg]); if (options.requestError) throw options.requestError; return { status: 200, body: { output: privateText } }; },
    fetchAsActor: async (...args) => { calls.push(['fetchAsActor', ...args]); return new Response(privateText, { status: 200 }); },
    close: async () => { calls.push(['runtimeClose']); if (options.closeError) throw Error('synthetic close failure'); return { applicationPools0: true, ownedSockets0: true, fetchRestored: true, environmentRestored: options.environmentRestored ?? true }; }
  };
  const matrix = [];
  for (const name of ['esm', 'cjs', 'esm-types', 'cjs-types']) {
    const stdoutPath = join(artifactDirectory, name + '.out'), stderrPath = join(artifactDirectory, name + '.err');
    await writeFile(stdoutPath, privateText); await writeFile(stderrPath, '');
    matrix.push({ name, command: [process.execPath, name], cwd: external, exitCode: 0, startedAt: new Date(Date.now() - 1000).toISOString(), finishedAt: new Date().toISOString(), stdoutPath, stderrPath });
  }
  const mount = { consumer, handler() {}, route: '/af191-consumer/' };
  const create = extra => createWorkbenchTargetAdapter({ runtime, packages, mountConsumer: async args => {
    calls.push(['mount', args]); if (options.mountWait) await options.mountWait;
    return { origin: options.origin ?? 'http://127.0.0.1:32124', close: async () => { calls.push(['hostClose']); if (options.hostError) throw Error('synthetic host failure'); return { ownedSockets: options.hostSockets ?? 0 }; } };
  }, ...extra });
  const driver = async (name, args, context) => {
    calls.push(['native', name, args, context]); const width = name.startsWith('mobile390-') ? 390 : 1440;
    const path = join(artifactDirectory, name + '.png'), bytes = png(width); await writeFile(path, bytes);
    return { task: runtime.task, acceptanceId: id, case: name, native: true, runId: 'run1', observedAt: new Date().toISOString(), viewportWidth: width,
      screenshot: { path, sha256: sha256(bytes) }, status: name.endsWith('-submit') ? 'queued' : 'succeeded', output: privateText,
      submissionUnconfirmedObserved: true, recoveryGetObserved: true, postCount: 1, privateContentCleared: true, hiddenObserved: true,
      apiStatus: { anonymous: 401, 'no-permission': 403, 'other-member': 404, 'scope-change': 404, 'role-change': 403, 'session-change': 401 }[name] };
  };
  return { runtime, packages, consumer, matrix, counts, calls, db, mount, create, driver, leasePath };
}

test('composition only: exact delegation, no POST retry, no changed owner status, absent native refuses', async t => {
  const f = await fixture(t), a = await f.create();
  for (const key of ['task', 'approvedLeaseTask', 'acceptanceId', 'projectId', 'workspaceId', 'memberId', 'agentCode', 'apiBaseUrl', 'artifactDirectory']) assert.equal(a[key], f.runtime[key]);
  assert.equal(await a.counters(), f.counts); assert.equal(await a.databaseSnapshot('run1'), f.db); assert.equal(f.db.job.status, 'completed');
  assert.deepEqual(a.transportEvidence(), f.runtime.transportEvidence());
  assert.deepEqual(await a.pumpJobs(1), ['job1']); assert.deepEqual(f.calls.find(c => c[0] === 'pumpJobs'), ['pumpJobs', 1]);
  await a.request({ method: 'POST', path: 'client/ai/agents/general-text/runs', body: { goal: privateText } });
  assert.equal(f.calls.filter(c => c[0] === 'request').length, 1);
  const response = await a.fetchAsActor('owner', f.runtime.apiBaseUrl + '/client/ai/runs/run1?private=' + privateText);
  assert.equal(await response.text(), privateText);
  await assert.rejects(a.native('desktop-workbench-read'), /NATIVE_DRIVER_REQUIRED/);
  const promise = a.close(); assert.equal(a.close(), promise); assert.equal((await promise).applicationPools, 0);
  assert.equal(f.calls.filter(c => c[0] === 'runtimeClose').length, 1); assert.throws(() => a.counters(), /ADAPTER_CLOSED/);
});

test('composition only: unknown POST propagates once; no manufactured observation or retry', async t => {
  const unknown = Error('UNKNOWN_WRITE'), f = await fixture(t, { requestError: unknown }), a = await f.create();
  await assert.rejects(a.request({ method: 'POST', path: 'client/ai/agents/general-text/runs' }), error => error === unknown);
  assert.equal(f.calls.filter(c => c[0] === 'request').length, 1); await a.close();
});

test('composition only: mounted outside marked consumer and hashed bounded evidence, no private bodies', async t => {
  const f = await fixture(t), a = await f.create();
  const mounted = await a.mountConsumer(f.mount); assert.equal(mounted.origin, 'http://127.0.0.1:32124');
  assert.equal(f.calls.find(c => c[0] === 'mount')[1].handler, f.mount.handler);
  assert.throws(() => a.mountConsumer(f.mount), /ALREADY_MOUNTED/);
  await a.request({ path: 'client/ai/runs/run1?secret=' + privateText });
  await a.fetchAsActor('anonymous', f.runtime.apiBaseUrl + '/client/ai/runs/run1');
  const evidence = await a.evidence({ consumer: f.consumer, runId: 'run1', native: [], matrix: f.matrix,
    sourceFiles: ['scripts/verification/workbench-sdk-target-adapter.mjs'] });
  assert.equal(evidence.native, 'NOT_RUN'); assert.equal(evidence.targetAcceptance, 'NOT_RUN_TARGET_ACCEPTANCE');
  assert.ok(!evidence.files.some(d => d.kind.startsWith('native')));
  for (const d of evidence.files) {
    const bytes = await readFile(resolve(repositoryRoot, d.path)); assert.equal(sha256(bytes), d.sha256); assert.equal(d.acceptanceId, f.runtime.acceptanceId);
    if (d.kind !== 'source') assert.ok(!bytes.includes(Buffer.from(privateText)), d.kind);
  }
  const http = JSON.parse(await readFile(resolve(repositoryRoot, evidence.files.find(d => d.kind === 'http').path), 'utf8'));
  assert.equal(http.hashBasis.request, 'JSON.stringify-returned-body');
  assert.deepEqual(Object.keys(http.observations.request[0]).sort(), ['actor', 'bodySha256', 'method', 'path', 'status']);
  assert.equal(http.observations.request[0].path, '/api/client/ai/runs/run1');
  const pg = JSON.parse(await readFile(resolve(repositoryRoot, evidence.files.find(d => d.kind === 'pg').path), 'utf8'));
  assert.equal(pg.database.job.status, 'completed'); assert.equal(pg.database.run.output, undefined);
  const { evidence: closed, ...closure } = await a.close();
  assert.deepEqual(closure, { applicationPools0: true, ownedSockets0: true, fetchRestored: true, environmentRestored: true, applicationPools: 0, ownedSockets: 0, hostOwnedSockets: 0 });
  assert.equal(closed.kind, 'closed'); assert.equal(sha256(await readFile(resolve(repositoryRoot, closed.path))), closed.sha256);
});

test('composition only: exact native allowlist, receipt binding, all branch projections and tamper rejection', async t => {
  assert.deepEqual(requiredNativeCases, ['desktop-workbench-submit', 'desktop-workbench-read', 'desktop-consumer-read', 'mobile390-workbench-read', 'mobile390-consumer-read', 'anonymous', 'no-permission', 'other-member', 'scope-change', 'role-change', 'session-change', 'blur', 'document-hidden', 'unmount']);
  const f = await fixture(t), a = await f.create({ nativeDriver: f.driver });
  await assert.rejects(a.native('blur'), /CONSUMER_NOT_MOUNTED/); await a.mountConsumer(f.mount);
  for (const alias of ['hidden', 'unload', 'unknown']) await assert.rejects(a.native(alias), /NATIVE_CASE/);
  const receipts = [];
  for (const name of requiredNativeCases) receipts.push(await a.native(name, { runId: 'run1' }));
  assert.equal(f.calls.filter(c => c[0] === 'native').length, 14);
  await assert.rejects(a.native('blur', { runId: 'other-run' }), /NATIVE_RUN/);
  assert.equal(f.calls.find(c => c[0] === 'native')[2].runId, 'run1');
  assert.equal(f.calls.find(c => c[0] === 'native')[3].runtime, f.runtime);
  const evidence = await a.evidence({ consumer: f.consumer, runId: 'run1', native: receipts, matrix: f.matrix, sourceFiles: [] });
  assert.equal(evidence.native, 'PARTIAL_OBSERVED_NATIVE'); // Synthetic tests never certify full target/native acceptance.
  assert.equal(evidence.files.filter(d => d.kind === 'native-png').length, 14);
  const receiptFile = evidence.files.find(d => d.kind === 'native-receipt' && d.path.includes('desktop-consumer-read'));
  const projected = JSON.parse(await readFile(resolve(repositoryRoot, receiptFile.path), 'utf8'));
  assert.equal(projected.output, undefined); assert.equal(projected.outputSha256, sha256(privateText));
  receipts[0].acceptanceId = 'borrowed';
  await assert.rejects(a.evidence({ consumer: f.consumer, runId: 'run1', native: receipts, matrix: f.matrix, sourceFiles: [] }), /NATIVE_BINDING/);
  await a.close();
});

test('composition only: lease mismatch/not-ready, marker, lock, full graph, source and symlink fences', async t => {
  const f = await fixture(t), lease = JSON.parse(await readFile(f.leasePath));
  f.runtime.approvedLeaseTask = 'AF-191'; await assert.rejects(f.create(), /LEASE_TASK/); f.runtime.approvedLeaseTask = 'AF-215';
  await writeFile(f.leasePath, JSON.stringify({ ...lease, ready: false })); await assert.rejects(f.create(), /LEASE_RECORD/); await writeFile(f.leasePath, JSON.stringify(lease));
  const marker = join(f.consumer.directory, '.aij-target-consumer-owned.json');
  await writeFile(marker, JSON.stringify({ schemaVersion: 1, task: 'AF-215', acceptanceId: 'other' }));
  await assert.rejects(verifyConsumer(f.runtime, f.packages, f.consumer), /CONSUMER_MARKER/);
  await writeFile(marker, JSON.stringify({ schemaVersion: 1, task: 'AF-215', acceptanceId: f.runtime.acceptanceId }));
  f.consumer.lockSha256 = '0'.repeat(64); await assert.rejects(verifyConsumer(f.runtime, f.packages, f.consumer), /LOCK_HASH/);
  f.consumer.lockSha256 = sha256(await readFile(join(f.consumer.directory, 'package-lock.json')));
  const nested = Object.keys(f.consumer.installedHashes).find(p => p.startsWith('node_modules/@aij/sdk/dist/') && !p.endsWith('/index.mjs'));
  const path = join(f.consumer.directory, nested), original = await readFile(path); await writeFile(path, 'tampered');
  await assert.rejects(verifyConsumer(f.runtime, f.packages, f.consumer), /INSTALLED_HASH/);
  await writeFile(path, original); await rm(path); await symlink(join(repositoryRoot, 'packages/sdk/dist/index.mjs'), path);
  await assert.rejects(verifyConsumer(f.runtime, f.packages, f.consumer), /INSTALLED_SYMLINK/);
});

test('composition only: receipt refuses stale/bad PNG, other run/task, privacy/status and hidden aliases', async t => {
  const f = await fixture(t), receipt = await f.driver('document-hidden', {}, {}), now = Date.now();
  for (const delta of [{ task: 'AF-191' }, { runId: 'other' }, { privateContentCleared: false }, { hiddenObserved: false }, { viewportWidth: 390 }, { observedAt: new Date(now - 100000).toISOString() }]) {
    await assert.rejects(nativeReceipt(f.runtime, 'document-hidden', { ...receipt, ...delta }, now - 1000, now + 1000, 'run1'), /NATIVE_/);
  }
  await utimes(receipt.screenshot.path, new Date(0), new Date(0));
  await assert.rejects(nativeReceipt(f.runtime, 'document-hidden', receipt, now - 1000, now + 1000, 'run1'), /NATIVE_PNG/);
  const anonymous = await f.driver('anonymous', {}, {});
  await assert.rejects(nativeReceipt(f.runtime, 'anonymous', { ...anonymous, apiStatus: 200 }, now - 1000, Date.now() + 1000, 'run1'), /NATIVE_STATUS/);
  const corrupt = await readFile(anonymous.screenshot.path); corrupt[corrupt.length - 1] ^= 1;
  await writeFile(anonymous.screenshot.path, corrupt); anonymous.screenshot.sha256 = sha256(corrupt);
  await assert.rejects(nativeReceipt(f.runtime, 'anonymous', anonymous, now - 1000, Date.now() + 1000, 'run1'), /NATIVE_PNG/);
  assert.throws(() => projectDatabase(f.runtime, { ...f.db, run: { ...f.db.run, workspaceId: 'other' } }, 'run1'), /DATABASE_RUN_BINDING/);
});

test('composition only: fabricated native/matrix success, unsafe source path and duplicate runtime refuse', async t => {
  const f = await fixture(t), a = await f.create(); await a.mountConsumer(f.mount);
  await assert.rejects(f.create(), /RUNTIME_ALREADY_ADOPTED/);
  const input = { consumer: f.consumer, runId: 'run1', native: [], matrix: f.matrix, sourceFiles: [] };
  await assert.rejects(a.evidence({ ...input, matrix: ['esm', 'cjs', 'esm-types', 'cjs-types'] }), /PACKAGE_MATRIX/);
  await assert.rejects(a.evidence({ ...input, matrix: f.matrix.map(m => ({ ...m, exitCode: 1 })) }), /MATRIX_RECEIPT/);
  const receipt = await f.driver('blur', {}, {});
  await assert.rejects(a.evidence({ ...input, native: [receipt] }), /NATIVE_UNOBSERVED/);
  await assert.rejects(a.evidence({ ...input, sourceFiles: ['scripts/../../.env'] }), /SOURCE_PATH/);
  const extra = join(f.consumer.directory, 'node_modules/@aij/sdk/dist/unlisted.mjs'); await writeFile(extra, 'export {};');
  await assert.rejects(a.evidence(input), /INSTALLED_GRAPH/);
  await a.close();
});

test('composition only: close attempts both owners after failures and caches rejection', async t => {
  for (const opts of [{ hostError: true }, { hostSockets: 1 }, { closeError: true }, { environmentRestored: false }]) {
    const f = await fixture(t, opts), a = await f.create(); await a.mountConsumer(f.mount);
    const closing = a.close(); assert.equal(a.close(), closing); await assert.rejects(closing, /CLOSE_/);
    assert.equal(f.calls.filter(c => c[0] === 'hostClose').length, 1); assert.equal(f.calls.filter(c => c[0] === 'runtimeClose').length, 1);
  }
});

test('composition only: malformed acquired host still closes and in-flight mount is joined', async t => {
  let release; const mountWait = new Promise(yes => { release = yes; });
  const f = await fixture(t, { mountWait }), a = await f.create(), pending = a.mountConsumer(f.mount), closing = a.close();
  release(); await pending; await closing;
  assert.equal(f.calls.filter(c => c[0] === 'hostClose').length, 1);
  const bad = await fixture(t, { origin: 'http://localhost:32124' }), b = await bad.create();
  await assert.rejects(b.mountConsumer(bad.mount), /HOST_ORIGIN/); await b.close();
  assert.equal(bad.calls.filter(c => c[0] === 'hostClose').length, 1);
});

test('source metadata fence never ignores an arbitrary dot-underscore module', async t => {
  const f = await fixture(t);
  const path = join(repositoryRoot, 'packages/sdk/dist', '._af215-' + randomBytes(8).toString('hex') + '.mjs');
  await writeFile(path, 'export const hiddenCode=true;', { flag: 'wx' });
  try { await assert.rejects(verifyConsumer(f.runtime, f.packages, f.consumer), /SOURCE_METADATA/); }
  finally { await rm(path); }
});
