// Composition assertions and byte evidence. These do not certify target acceptance.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstat, readFile, readdir, realpath, mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, inflateSync } from 'node:zlib';

export const repositoryRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const fail = code => { throw new Error(`AF215_${code}`); };
export const inside = (parent, child) => child.startsWith(parent + sep);
export const check = (condition, code) => { if (!condition) fail(code); };
export const requiredNativeCases = Object.freeze([
  'desktop-workbench-submit', 'desktop-workbench-read', 'desktop-consumer-read',
  'mobile390-workbench-read', 'mobile390-consumer-read', 'anonymous', 'no-permission',
  'other-member', 'scope-change', 'role-change', 'session-change', 'blur', 'document-hidden', 'unmount'
]);
export const requiredPackageMatrix = Object.freeze(['esm', 'cjs', 'esm-types', 'cjs-types']);
export function countersProjection(value) {
  const result = {};
  for (const key of ['runs', 'jobs', 'traces', 'upstream', 'submits']) {
    check(Number.isSafeInteger(value?.[key]) && value[key] >= 0, 'COUNTERS'); result[key] = value[key];
  }
  return result;
}

// Reject symlinks at every component, including parent directories, before reading.
export async function regularFile(path, limit = 8 * 1024 * 1024) {
  check(typeof path === 'string' && isAbsolute(path) && resolve(path) === path, 'FILE_PATH');
  let current = path;
  while (dirname(current) !== current) {
    check(!(await lstat(current)).isSymbolicLink(), 'FILE_SYMLINK');
    current = dirname(current);
  }
  const stat = await lstat(path);
  check(stat.isFile() && stat.size <= limit, 'FILE_BOUNDS');
  const bytes = await readFile(path);
  check(bytes.length === stat.size, 'FILE_CHANGED');
  return { bytes, stat, sha256: sha256(bytes) };
}

export async function artifactDirectory(path) {
  check(typeof path === 'string' && isAbsolute(path) && inside(join(repositoryRoot, '.artifacts'), path), 'ARTIFACT_DIRECTORY');
  check(await realpath(path) === path && (await lstat(path)).isDirectory(), 'ARTIFACT_DIRECTORY');
  execFileSync('git', ['check-ignore', '--quiet', '--', path], { cwd: repositoryRoot, stdio: 'pipe' });
  return path;
}

export async function readyLease(runtime) {
  check(['AF-191', 'AF-215'].includes(runtime.task) && runtime.approvedLeaseTask === runtime.task, 'LEASE_TASK');
  check(/^[a-f0-9]{16}$/.test(runtime.acceptanceId), 'LEASE_ID');
  const file = await regularFile(join(repositoryRoot, '.local-data/postgres/acceptance', runtime.acceptanceId + '.json'));
  const record = JSON.parse(file.bytes.toString('utf8'));
  check(record.task === runtime.task && record.id === runtime.acceptanceId && record.mode === 'test' && record.ready === true &&
    record.repository === repositoryRoot && record.database === `aij_foundation_${runtime.task.toLowerCase().replaceAll('-', '')}_test_${runtime.acceptanceId}` &&
    Number.isFinite(Date.parse(record.createdAt)) && Date.parse(record.createdAt) <= Date.now(), 'LEASE_RECORD');
  // Do not copy database credentials, the complete ownership file, or environment.
  return { task: record.task, id: record.id, mode: record.mode, ready: record.ready, createdAt: record.createdAt };
}

function archiveGraph(bytes) {
  const tar = gunzipSync(bytes, { maxOutputLength: 64 * 1024 * 1024 });
  const files = new Map();
  for (let offset = 0; offset + 512 <= tar.length;) {
    const h = tar.subarray(offset, offset + 512); offset += 512;
    if (h.every(b => b === 0)) break;
    const str = b => b.toString('utf8').replace(/\0.*$/s, '');
    const checksum = parseInt(str(h.subarray(148, 156)).trim(), 8);
    check(checksum === [...h].reduce((sum, value, index) => sum + (index >= 148 && index < 156 ? 32 : value), 0), 'ARCHIVE_CHECKSUM');
    const name = str(h.subarray(0, 100)), prefix = str(h.subarray(345, 500));
    const path = prefix ? prefix + '/' + name : name;
    const sizeText = str(h.subarray(124, 136)).trim();
    check(/^[0-7]+$/.test(sizeText), 'ARCHIVE_SIZE');
    const size = parseInt(sizeText, 8), type = str(h.subarray(156, 157));
    check(offset + size <= tar.length && ['0', '', '5'].includes(type), 'ARCHIVE_ENTRY');
    check(path.startsWith('package/') && !/[\\\r\n]/.test(path) && !path.split('/').includes('..'), 'ARCHIVE_PATH');
    if (type !== '5') {
      check(!files.has(path) && files.size < 2048 && size <= 8 * 1024 * 1024, 'ARCHIVE_BOUNDS');
      files.set(path.slice(8), tar.subarray(offset, offset + size));
    }
    offset += Math.ceil(size / 512) * 512;
  }
  check(files.has('package.json') && files.has('dist/index.mjs') && files.has('dist/index.cjs') && files.has('dist/index.d.mts') && files.has('dist/index.d.cts'), 'ARCHIVE_GRAPH');
  return files;
}

async function walk(directory, prefix = '', sourceTree = false) {
  const files = [];
  for (const name of (await readdir(directory)).sort()) {
    const path = join(directory, name), stat = await lstat(path), key = prefix + name;
    check(!stat.isSymbolicLink(), 'INSTALLED_SYMLINK');
    if (sourceTree && name.startsWith('._')) {
      // The root's external macOS volume contains AppleDouble metadata which
      // pnpm pack does not emit. Ignore only validated OS metadata in SOURCE
      // dist, never installed/archive files or arbitrary hidden code.
      const metadata = await regularFile(path);
      check(metadata.bytes.length >= 8 && metadata.bytes.readUInt32BE(0) === 0x00051607
        && metadata.bytes.readUInt32BE(4) === 0x00020000, 'SOURCE_METADATA');
      continue;
    }
    if (stat.isDirectory()) files.push(...await walk(path, key + '/', sourceTree));
    else { check(stat.isFile(), 'INSTALLED_FILE'); files.push(key); }
    check(files.length <= 2048, 'INSTALLED_GRAPH_BOUNDS');
  }
  return files;
}

export async function verifyConsumer(runtime, packages, consumer) {
  check(consumer && typeof consumer.directory === 'string' && isAbsolute(consumer.directory) && await realpath(consumer.directory) === consumer.directory, 'CONSUMER_DIRECTORY');
  const directory = consumer.directory;
  const worktrees = execFileSync('git', ['worktree', 'list', '--porcelain', '-z'], { cwd: repositoryRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    .split('\0').filter(s => s.startsWith('worktree ')).map(s => s.slice(9));
  check(worktrees.length > 0 && worktrees.every(path => directory !== path && !inside(path, directory) && !inside(directory, path)), 'CONSUMER_OUTSIDE_WORKTREES');
  const marker = runtime.task === 'AF-191' ? '.af191-owned' : '.aij-target-consumer-owned.json';
  const marked = await regularFile(join(directory, marker), 1024);
  if (runtime.task === 'AF-191') check(marked.bytes.toString() === 'AF-191\n', 'CONSUMER_MARKER');
  else assert.deepEqual(JSON.parse(marked.bytes.toString()), { schemaVersion: 1, task: runtime.task, acceptanceId: runtime.acceptanceId }, 'AF215_CONSUMER_MARKER');
  const lock = await regularFile(join(directory, 'package-lock.json'));
  check(lock.sha256 === consumer.lockSha256, 'CONSUMER_LOCK_HASH');
  const lockJson = JSON.parse(lock.bytes.toString());
  check([2, 3].includes(lockJson.lockfileVersion) && lockJson.packages, 'CONSUMER_LOCK');
  check(Object.keys(lockJson.packages).every(p => !p.includes('/node_modules/@aij/')), 'NESTED_PACKAGE_OWNER');
  const graphs = {}, installedHashes = {}, archives = {};
  for (const name of ['sdk', 'contracts']) {
    const pack = await regularFile(packages[name + 'Tgz'], 32 * 1024 * 1024);
    const copy = await regularFile(join(directory, name + '.tgz'), 32 * 1024 * 1024);
    check(pack.sha256 === copy.sha256 && pack.sha256 === consumer.packages?.[name]?.sha256, 'PACK_HASH');
    const archive = archiveGraph(pack.bytes), metadata = JSON.parse(archive.get('package.json').toString());
    const source = JSON.parse((await regularFile(join(repositoryRoot, 'packages', name, 'package.json'))).bytes.toString());
    check(metadata.name === '@aij/' + name && metadata.version === source.version && metadata.version === consumer.packages[name].version &&
      metadata.private === true && metadata.license === 'UNLICENSED', 'PACK_METADATA');
    assert.deepEqual(metadata.exports, source.exports, 'AF215_PACK_EXPORTS');
    const expectedDeps = name === 'sdk' ? { '@aij/contracts': consumer.packages.contracts.version } : {};
    assert.deepEqual(metadata.dependencies ?? {}, expectedDeps, 'AF215_PACK_DEPENDENCIES');
    const locked = lockJson.packages['node_modules/@aij/' + name];
    check(locked && !locked.link && locked.version === metadata.version && locked.resolved === `file:${name}.tgz` &&
      locked.integrity === 'sha512-' + createHash('sha512').update(pack.bytes).digest('base64'), 'INSTALLED_LOCK');
    assert.deepEqual(locked.dependencies ?? {}, expectedDeps, 'AF215_LOCK_DEPENDENCIES');
    const installed = join(directory, 'node_modules/@aij', name);
    check(await realpath(installed) === installed, 'INSTALLED_SYMLINK');
    const graph = [...archive.keys()].filter(p => p === 'package.json' || p.startsWith('dist/')).sort();
    const installedFiles = await walk(installed);
    check(installedFiles.every(p => !p.split('/').includes('node_modules')), 'NESTED_PACKAGE_OWNER');
    const actual = installedFiles.filter(p => p === 'package.json' || p.startsWith('dist/')).sort();
    assert.deepEqual(actual, graph, 'AF215_INSTALLED_GRAPH');
    const sourceDist = await walk(join(repositoryRoot, 'packages', name, 'dist'), '', true);
    assert.deepEqual(graph.filter(p => p.startsWith('dist/')), sourceDist.map(p => 'dist/' + p).sort(), 'AF215_SOURCE_GRAPH');
    for (const path of graph) {
      const bytes = await regularFile(join(installed, path));
      check(bytes.sha256 === sha256(archive.get(path)), 'INSTALLED_HASH');
      if (path.startsWith('dist/')) check(bytes.sha256 === (await regularFile(join(repositoryRoot, 'packages', name, path))).sha256, 'SOURCE_DIST_HASH');
      installedHashes[`node_modules/@aij/${name}/${path}`] = bytes.sha256;
    }
    graphs[name] = graph; archives[name] = pack;
  }
  assert.deepEqual(installedHashes, consumer.installedHashes, 'AF215_DECLARED_INSTALLED_GRAPH');
  return { directory, graphs, archives, lock, installedHashes };
}

export function projectDatabase(runtime, db, runId) {
  check(db?.run?.id === runId && db.run.projectId === runtime.projectId && db.run.workspaceId === runtime.workspaceId &&
    db.run.memberId === runtime.memberId && db.run.agentCode === runtime.agentCode && db.run.jobId === db.job?.id &&
    db.job.scopeId === runtime.projectId && db.job.workspaceId === runtime.workspaceId && db.job.jobType === 'aij-ai.agent-execute' &&
    Array.isArray(db.traces) && db.traces.length <= 32 && db.traces.every(t => t.jobId === db.job.id && t.projectId === runtime.projectId), 'DATABASE_RUN_BINDING');
  const pick = (v, keys) => Object.fromEntries(keys.filter(k => Object.hasOwn(v, k)).map(k => [k, typeof v[k] === 'bigint' ? String(v[k]) : v[k]]));
  return { run: pick(db.run, ['id', 'projectId', 'workspaceId', 'memberId', 'agentCode', 'jobId', 'status', 'budgetStatus', 'estimatedCostNanos', 'sourceType']),
    job: pick(db.job, ['id', 'scopeId', 'workspaceId', 'jobType', 'status', 'attempts', 'maxAttempts']),
    traces: db.traces.map(t => pick(t, ['id', 'projectId', 'jobId', 'attempt', 'status', 'costSource', 'costAmountNanos'])) };
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function checkPng(bytes, width) {
  check(bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a', 'NATIVE_PNG');
  let offset = 8, header, ended = false;
  const compressed = [];
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset), end = offset + 12 + length;
    check(end <= bytes.length, 'NATIVE_PNG');
    const type = bytes.subarray(offset + 4, offset + 8).toString(), data = bytes.subarray(offset + 8, end - 4);
    check(crc32(bytes.subarray(offset + 4, end - 4)) === bytes.readUInt32BE(end - 4), 'NATIVE_PNG');
    if (!header) { check(type === 'IHDR' && length === 13, 'NATIVE_PNG'); header = data; }
    else check(type !== 'IHDR', 'NATIVE_PNG');
    if (type === 'IDAT') compressed.push(data);
    offset = end;
    if (type === 'IEND') { check(length === 0 && offset === bytes.length, 'NATIVE_PNG'); ended = true; break; }
  }
  check(header && ended && compressed.length > 0 && header.readUInt32BE(0) === width && header.readUInt32BE(4) > 0 &&
    header.readUInt32BE(4) <= 16384 && header[8] === 8 && [0, 2, 3, 4, 6].includes(header[9]) && header[10] === 0 && header[11] === 0 && header[12] === 0, 'NATIVE_PNG');
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[header[9]], row = 1 + width * channels;
  const pixels = inflateSync(Buffer.concat(compressed), { maxOutputLength: 96 * 1024 * 1024 });
  check(pixels.length === row * header.readUInt32BE(4), 'NATIVE_PNG');
  for (let y = 0; y < pixels.length; y += row) check(pixels[y] <= 4, 'NATIVE_PNG');
}

export async function nativeReceipt(runtime, name, receipt, startedAt, endedAt, expectedRunId) {
  check(receipt && receipt.task === runtime.task && receipt.acceptanceId === runtime.acceptanceId && receipt.case === name &&
    receipt.native === true && typeof receipt.runId === 'string' && (!expectedRunId || receipt.runId === expectedRunId), 'NATIVE_BINDING');
  const observed = Date.parse(receipt.observedAt);
  check(Number.isFinite(observed) && observed >= startedAt && observed <= endedAt, 'NATIVE_TIME');
  check(receipt.viewportWidth === (name.startsWith('mobile390-') ? 390 : 1440), 'NATIVE_VIEWPORT');
  check(typeof receipt.screenshot?.path === 'string' && inside(runtime.artifactDirectory, receipt.screenshot.path), 'NATIVE_SCREENSHOT_PATH');
  const png = await regularFile(receipt.screenshot.path, 16 * 1024 * 1024);
  check(png.sha256 === receipt.screenshot.sha256 &&
    png.stat.mtimeMs >= startedAt - 1000 && png.stat.mtimeMs <= endedAt + 1000, 'NATIVE_PNG');
  checkPng(png.bytes, receipt.viewportWidth);
  const safe = { task: runtime.task, acceptanceId: runtime.acceptanceId, case: name, native: true, runId: receipt.runId,
    observedAt: receipt.observedAt, viewportWidth: receipt.viewportWidth,
    screenshot: { path: receipt.screenshot.path, sha256: png.sha256 } };
  if (name === 'desktop-workbench-submit') {
    check(receipt.status === 'queued' && receipt.submissionUnconfirmedObserved === true && receipt.recoveryGetObserved === true && receipt.postCount === 1, 'NATIVE_SUBMIT');
    Object.assign(safe, { status: receipt.status, submissionUnconfirmedObserved: true, recoveryGetObserved: true, postCount: 1 });
  } else if (name.endsWith('-read')) {
    check(receipt.status === 'succeeded' && typeof receipt.output === 'string', 'NATIVE_READ');
    Object.assign(safe, { status: receipt.status, outputSha256: sha256(receipt.output) });
  } else {
    check(receipt.privateContentCleared === true, 'NATIVE_PRIVACY'); safe.privateContentCleared = true;
    const status = { anonymous: 401, 'no-permission': 403, 'other-member': 404, 'scope-change': 404, 'role-change': 403, 'session-change': 401 }[name];
    if (status) { check(receipt.apiStatus === status, 'NATIVE_STATUS'); safe.apiStatus = status; }
    if (name === 'document-hidden') { check(receipt.hiddenObserved === true, 'NATIVE_HIDDEN'); safe.hiddenObserved = true; }
  }
  return safe;
}

export async function buildEvidence({ runtime, packages, consumer, runId, native, matrix, sourceFiles, before, observations, acceptedNative }) {
  const lease = await readyLease(runtime), verified = await verifyConsumer(runtime, packages, consumer);
  check(typeof runId === 'string' && runId.length > 0 && runId.length <= 128, 'RUN_ID');
  const database = projectDatabase(runtime, await runtime.databaseSnapshot(runId), runId);
  const after = countersProjection(await runtime.counters());
  check(Array.isArray(native) && native.length <= requiredNativeCases.length, 'NATIVE_LIST');
  check(Array.isArray(matrix) && matrix.length === 4 && new Set(matrix.map(m => m.name)).size === 4 &&
    matrix.every(m => requiredPackageMatrix.includes(m.name)), 'PACKAGE_MATRIX');
  check(Array.isArray(sourceFiles) && sourceFiles.length <= 128 && new Set(sourceFiles).size === sourceFiles.length, 'SOURCE_FILES');
  const directory = join(runtime.artifactDirectory, 'adapter-evidence-' + randomUUID());
  await mkdir(directory, { mode: 0o700 });
  const files = [], now = new Date().toISOString();
  const save = async (name, kind, bytes) => {
    const path = join(directory, name); await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(path, bytes, { mode: 0o600, flag: 'wx' });
    const actual = await regularFile(path, 32 * 1024 * 1024);
    const descriptor = { path: relative(repositoryRoot, path), kind, sha256: actual.sha256, task: runtime.task, acceptanceId: runtime.acceptanceId, observedAt: now };
    files.push(descriptor); return descriptor;
  };
  const json = (name, kind, data) => save(name + '.json', kind, JSON.stringify(data, null, 2) + '\n');
  await json('lease', 'lease', lease);
  await json('http', 'http', { observations, hashBasis: { request: 'JSON.stringify-returned-body', fetchAsActor: 'response-body-bytes' } });
  await json('pg', 'pg', { before, after, database });
  for (const name of ['sdk', 'contracts']) {
    await save(name + '.tgz', 'packed-' + name, verified.archives[name].bytes);
    for (const path of verified.graphs[name]) await save('installed-' + name + '/' + path, 'installed-' + name, (await regularFile(join(verified.directory, 'node_modules/@aij', name, path))).bytes);
  }
  await save('package-lock.json', 'install-lock', verified.lock.bytes);
  await json('package-install', 'package-install', { packages: consumer.packages, installedHashes: verified.installedHashes, lockSha256: verified.lock.sha256 });
  // Root provides actual process receipts and bounded captured stdout/stderr files,
  // not PASS JSON. These descriptors never stand in for the root's assertions.
  const matrixRecords = [];
  for (const m of matrix) {
    check(m.exitCode === 0 && Array.isArray(m.command) && m.command.length > 0 && m.command.length <= 32 &&
      m.command.every(a => typeof a === 'string' && a.length <= 1024) && m.cwd === consumer.directory &&
      Date.parse(m.startedAt) >= Date.parse(lease.createdAt) && Date.parse(m.finishedAt) >= Date.parse(m.startedAt) && Date.parse(m.finishedAt) <= Date.now(), 'MATRIX_RECEIPT');
    const logs = {};
    for (const stream of ['stdout', 'stderr']) {
      check(typeof m[stream + 'Path'] === 'string' && inside(runtime.artifactDirectory, m[stream + 'Path']), 'MATRIX_LOG_PATH');
      const bytes = await regularFile(m[stream + 'Path'], 1024 * 1024);
      // Persist hashes only: compiler/process output can contain private inputs.
      logs[stream + 'Sha256'] = bytes.sha256;
    }
    matrixRecords.push({ name: m.name, exitCode: m.exitCode, commandSha256: sha256(JSON.stringify(m.command)), startedAt: m.startedAt, finishedAt: m.finishedAt, ...logs });
  }
  await json('package-matrix', 'package-matrix', matrixRecords);
  const cases = new Set();
  for (const receipt of native) {
    const accepted = acceptedNative.get(receipt);
    check(accepted && receipt.runId === runId && !cases.has(receipt.case), 'NATIVE_UNOBSERVED'); cases.add(receipt.case);
    const checked = await nativeReceipt(runtime, receipt.case, receipt, accepted.startedAt, accepted.endedAt, runId);
    assert.deepEqual(checked, accepted.safe, 'AF215_NATIVE_RECEIPT_CHANGED');
    await json('native-' + receipt.case, 'native-receipt', { ...checked, screenshot: { ...checked.screenshot, path: relative(repositoryRoot, checked.screenshot.path) } });
    files.push({ path: relative(repositoryRoot, checked.screenshot.path), kind: 'native-png', sha256: checked.screenshot.sha256,
      task: runtime.task, acceptanceId: runtime.acceptanceId, observedAt: checked.observedAt });
  }
  for (const path of sourceFiles) {
    check(typeof path === 'string' && !isAbsolute(path) && /^(apps|packages|scripts|docs)\//.test(path) && !path.split('/').includes('..') &&
      /\.(?:ts|tsx|mjs|cjs|json|md)$/.test(path) && !/(?:^|\/)(?:node_modules|dist|\.env[^/]*)(?:\/|$)/.test(path), 'SOURCE_PATH');
    const actual = await regularFile(resolve(repositoryRoot, path));
    files.push({ path, kind: 'source', sha256: actual.sha256, task: runtime.task, acceptanceId: runtime.acceptanceId, observedAt: now });
  }
  return { task: runtime.task, acceptanceId: runtime.acceptanceId, runId, files, native: cases.size ? 'PARTIAL_OBSERVED_NATIVE' : 'NOT_RUN',
    nativeCases: [...cases], targetAcceptance: 'NOT_RUN_TARGET_ACCEPTANCE' };
}
