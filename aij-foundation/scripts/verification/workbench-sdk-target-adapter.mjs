// The root starts the original AF198 runtime with its own task's fresh lease.
// This adapter never creates a DB, transport, consumer UI, or native driver.
import { writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import {
  artifactDirectory, buildEvidence, check, countersProjection, fail, nativeReceipt, projectDatabase, repositoryRoot,
  readyLease, regularFile, requiredNativeCases, sha256, verifyConsumer
} from './workbench-sdk-target-adapter-evidence.mjs';
export { requiredNativeCases } from './workbench-sdk-target-adapter-evidence.mjs';

const actors = ['owner', 'other', 'other-member', 'no-permission', 'anonymous', null];
const adoptedRuntimes = new WeakSet();
const safePath = (base, path) => {
  check(typeof path === 'string' && path.length <= 4096, 'HTTP_PATH');
  const url = new URL(path.replace(/^\//, ''), base + '/');
  check(url.origin === new URL(base).origin && url.pathname.startsWith('/api/client/'), 'HTTP_PATH');
  return url.pathname; // Query values and headers never enter evidence.
};

export async function createWorkbenchTargetAdapter({ runtime, packages, mountConsumer, nativeDriver }) {
  check(runtime && typeof mountConsumer === 'function' && (nativeDriver === undefined || typeof nativeDriver === 'function'), 'OPTIONS');
  for (const method of ['counters', 'databaseSnapshot', 'request', 'fetchAsActor', 'pumpJobs', 'close']) check(typeof runtime[method] === 'function', 'RUNTIME_METHOD');
  for (const key of ['projectId', 'workspaceId', 'memberId', 'agentCode', 'apiBaseUrl']) check(typeof runtime[key] === 'string' && runtime[key].length > 0, 'RUNTIME_METADATA');
  const api = new URL(runtime.apiBaseUrl);
  check(api.protocol === 'http:' && api.hostname === '127.0.0.1' && api.port && api.pathname === '/api' && api.href === runtime.apiBaseUrl && !api.username && !api.password, 'API_ORIGIN');
  await readyLease(runtime); await artifactDirectory(runtime.artifactDirectory);
  check(packages && Object.keys(packages).sort().join(',') === 'contractsTgz,sdkTgz', 'PACKAGES');
  const packagePaths = Object.freeze({ sdkTgz: packages.sdkTgz, contractsTgz: packages.contractsTgz });
  for (const path of Object.values(packagePaths)) await regularFile(path, 32 * 1024 * 1024);
  const before = countersProjection(await runtime.counters());
  check(!adoptedRuntimes.has(runtime), 'RUNTIME_ALREADY_ADOPTED'); adoptedRuntimes.add(runtime);
  const observations = { request: [], fetchAsActor: [] }, acceptedNative = new Map(), operations = new Set();
  let closing = false, closePromise, mountPromise, mountAttempted = false, host, consumer, nativeRunId;
  const available = () => check(!closing, 'ADAPTER_CLOSED');
  /** @template T @param {() => T | Promise<T>} action @returns {Promise<T>} */
  const operation = action => {
    available();
    const promise = Promise.resolve().then(action); operations.add(promise);
    promise.then(() => operations.delete(promise), () => operations.delete(promise));
    return promise;
  };
  const observe = (kind, actor, method, path, status, bytes) => {
    check(actors.includes(actor) && typeof method === 'string' && /^[A-Z]+$/.test(method) &&
      Number.isInteger(status) && status >= 100 && status <= 599 && observations.request.length + observations.fetchAsActor.length < 1024, 'HTTP_OBSERVATION');
    observations[kind].push({ method, path, actor, status, bodySha256: sha256(bytes) });
  };
  const close = () => closePromise ??= (async () => {
    closing = true;
    const failures = [];
    // All already-acquired resources are attempted, even when another close fails.
    await Promise.allSettled([...operations]);
    let hostResult, runtimeResult;
    try {
      if (host) { hostResult = await host.close(); check(hostResult?.ownedSockets === 0, 'HOST_SOCKETS'); }
    } catch { failures.push('HOST'); }
    try {
      runtimeResult = await runtime.close();
      check(runtimeResult?.applicationPools0 === true && runtimeResult?.ownedSockets0 === true &&
        runtimeResult?.fetchRestored === true && runtimeResult?.environmentRestored === true, 'RUNTIME_CLOSURE');
    } catch { failures.push('RUNTIME'); }
    acceptedNative.clear();
    if (failures.length) fail('CLOSE_' + failures.join('_'));
    const result = { applicationPools0: true, ownedSockets0: true, fetchRestored: true, environmentRestored: true,
      applicationPools: 0, ownedSockets: 0, hostOwnedSockets: host ? hostResult.ownedSockets : 0 };
    // Zeroes above are exposed only after measured owner results equal true/zero.
    const path = join(runtime.artifactDirectory, 'af215-adapter-close.json'), observedAt = new Date().toISOString();
    await writeFile(path, JSON.stringify({ task: runtime.task, acceptanceId: runtime.acceptanceId, observedAt, ...result }) + '\n', { mode: 0o600, flag: 'wx' });
    const bytes = await regularFile(path);
    return Object.freeze({ ...result, evidence: Object.freeze({ path: relative(repositoryRoot, path), kind: 'closed', sha256: bytes.sha256,
      task: runtime.task, acceptanceId: runtime.acceptanceId, observedAt }) });
  })();
  const adapter = {
    task: runtime.task, approvedLeaseTask: runtime.approvedLeaseTask, acceptanceId: runtime.acceptanceId, projectId: runtime.projectId,
    workspaceId: runtime.workspaceId, memberId: runtime.memberId, agentCode: runtime.agentCode, apiBaseUrl: runtime.apiBaseUrl, artifactDirectory: runtime.artifactDirectory,
    workspaceIds: runtime.workspaceIds,
    transportEvidence: typeof runtime.transportEvidence === 'function' ? (...args) => { available(); return runtime.transportEvidence(...args); } : undefined,
    packages: packagePaths, ...packagePaths,
    counters: (...args) => operation(() => runtime.counters(...args)),
    databaseSnapshot: (...args) => operation(() => runtime.databaseSnapshot(...args)),
    pumpJobs: (...args) => operation(() => runtime.pumpJobs(...args)),
    request: options => operation(async () => {
      // Call exactly once; unknown writes remain unknown and are never retried.
      const result = await runtime.request(options);
      const serialized = JSON.stringify(result.body);
      check(typeof serialized === 'string' && Buffer.byteLength(serialized) <= 1024 * 1024, 'HTTP_BODY_BOUNDS');
      observe('request', options.actor === undefined ? 'owner' : options.actor, options.method ?? 'GET', safePath(runtime.apiBaseUrl, options.path), result.status, serialized);
      return result;
    }),
    fetchAsActor: (actor, url, init = {}, ...rest) => operation(async () => {
      const response = await runtime.fetchAsActor(actor, url, init, ...rest);
      // Read only a clone. Preserve the caller's real Response and body stream.
      const reader = response.clone().body?.getReader(), chunks = [];
      let size = 0;
      try {
        if (reader) for (;;) {
          const next = await reader.read(); if (next.done) break;
          size += next.value.byteLength; check(size <= 1024 * 1024, 'HTTP_BODY_BOUNDS'); chunks.push(next.value);
        }
      } catch (error) { void reader?.cancel().catch(() => {}); throw error; }
      finally { reader?.releaseLock(); }
      observe('fetchAsActor', actor, init.method ?? 'GET', safePath(runtime.apiBaseUrl, url), response.status, Buffer.concat(chunks));
      return response;
    }),
    mountConsumer: options => {
      available(); check(!mountAttempted, 'CONSUMER_ALREADY_MOUNTED'); mountAttempted = true;
      mountPromise = operation(async () => {
        check(options && options.route === '/af191-consumer/' && typeof options.handler === 'function', 'CONSUMER_MOUNT');
        await verifyConsumer(runtime, packagePaths, options.consumer);
        const binding = await mountConsumer({ consumer: options.consumer, handler: options.handler, route: options.route });
        // Retain acquired close before validating origin, so close still owns it.
        if (binding && typeof binding.close === 'function') host = binding;
        check(host, 'HOST_CLOSE_REQUIRED');
        const origin = new URL(binding.origin);
        check(origin.protocol === 'http:' && origin.hostname === '127.0.0.1' && origin.port && origin.origin === binding.origin, 'HOST_ORIGIN');
        consumer = options.consumer;
        return Object.freeze({ origin: binding.origin, route: options.route });
      });
      return mountPromise;
    },
    native: (name, args = {}) => operation(async () => {
      if (!nativeDriver) fail('NATIVE_DRIVER_REQUIRED');
      check(requiredNativeCases.includes(name), 'NATIVE_CASE');
      check(consumer && host, 'CONSUMER_NOT_MOUNTED');
      check(args && typeof args === 'object' && !Array.isArray(args), 'NATIVE_ARGS');
      check(!nativeRunId || !args.runId || args.runId === nativeRunId, 'NATIVE_RUN');
      await readyLease(runtime);
      const startedAt = Date.now();
      const receipt = await nativeDriver(name, args, { runtime, consumer, hostOrigin: host.origin, artifactDirectory: runtime.artifactDirectory });
      const endedAt = Date.now();
      const safe = await nativeReceipt(runtime, name, receipt, startedAt, endedAt, args.runId ?? nativeRunId);
      projectDatabase(runtime, await runtime.databaseSnapshot(receipt.runId), receipt.runId);
      nativeRunId = receipt.runId;
      acceptedNative.set(receipt, { startedAt, endedAt, safe });
      return receipt; // Output remains RAM-only; evidence projects safe fields.
    }),
    evidence: options => operation(async () => {
      check(options && consumer && options.consumer === consumer, 'EVIDENCE_CONSUMER');
      return buildEvidence({ ...options, runtime, packages: packagePaths, before, observations, acceptedNative });
    }),
    close
  };
  // Auth/transport helpers remain original owner calls, including their refusals.
  for (const method of ['loginCredentials', 'withOwnerReadOnly', 'revokeOwnerSessions', 'verifyTransportFence']) {
    if (typeof runtime[method] === 'function') adapter[method] = (...args) => operation(() => runtime[method](...args));
  }
  return Object.freeze(adapter);
}
