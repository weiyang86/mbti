// Root integration of the actual I215 adapter with the original AF191 target.
// Compatibility projections retain original byte descriptors; no product result is rewritten.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { startWorkbenchTargetRuntime } from './workbench-sdk-target-runtime.mjs';
import { createWorkbenchTargetAdapter } from './workbench-sdk-target-adapter.mjs';
import { sha256 } from './workbench-sdk-target-consumer.mjs';
import { createTargetHost } from './workbench-sdk-target-host.mjs';
import { targetNativeDriver } from './workbench-sdk-target-native-driver.mjs';
const exec = promisify(execFile);
const root = '/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation';

export async function startTargetAcceptance(options) {
  assert.equal(options.task, 'AF-191');
  const host = await createTargetHost();
  let runtime, adapter, driver, closePromise;
  try {
    runtime = await startWorkbenchTargetRuntime({ ...options, browserOrigin: host.origin });
    assert.equal(runtime.transportEvidence().unchanged, true);
    assert.equal(runtime.transportEvidence().ownOverride, false);
    host.attach(runtime.apiBaseUrl);
    const artifact = runtime.artifactDirectory;
    driver = targetNativeDriver(runtime, host);
    const run = async (name, binary, args, cwd) => {
      const startedAt = new Date().toISOString();
      let result, exitCode = 0;
      try { result = await exec(binary, args, { cwd, timeout: 120000, maxBuffer: 4 * 1024 * 1024 }); }
      catch (error) { result = error; exitCode = Number.isInteger(error.code) ? error.code : 1; }
      const finishedAt = new Date().toISOString();
      const stdoutPath = join(artifact, name + '.stdout.log'), stderrPath = join(artifact, name + '.stderr.log');
      await writeFile(stdoutPath, result.stdout ?? '', { mode: 0o600 }); await writeFile(stderrPath, result.stderr ?? '', { mode: 0o600 });
      assert.equal(exitCode, 0, 'Actual target process failed: ' + name + '; see ' + artifact);
      return { name, command: [binary, ...args], cwd, exitCode, startedAt, finishedAt, stdoutPath, stderrPath };
    };
    await mkdir(join(artifact, 'packs'));
    const packages = {};
    for (const name of ['contracts', 'sdk']) {
      await run('pack-' + name, 'pnpm', ['pack', '--pack-destination', join(artifact, 'packs')], join(root, 'packages', name));
      const names = (await readdir(join(artifact, 'packs'))).filter(n => n.startsWith('aij-' + name + '-') && n.endsWith('.tgz') && !n.startsWith('._'));
      assert.equal(names.length, 1); packages[name + 'Tgz'] = join(artifact, 'packs', names[0]);
    }
    adapter = await createWorkbenchTargetAdapter({ runtime, packages,
      mountConsumer: async ({ handler }) => {
        try { await host.mount(handler); }
        catch (error) { await host.close(); throw error; }
        return { origin: host.origin, close: async () => { await driver.close(); return host.close(); } };
      },
      nativeDriver: (name, args) => driver.native(name, args)
    });
    const save = async (name, kind, payload) => {
      const observedAt = new Date().toISOString(), path = join(artifact, 'af191-' + name + '.json');
      await writeFile(path, JSON.stringify({ task: 'AF-191', acceptanceId: runtime.acceptanceId, ...payload }, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
      return { path: relative(root, path), kind, task: 'AF-191', acceptanceId: runtime.acceptanceId, observedAt, sha256: sha256(await readFile(path)) };
    };
    return {
      ...adapter,
      transport: options.transport,
      async native(name, args) {
        const progressPath = join(artifact, 'af191-native-progress.json');
        await writeFile(progressPath, JSON.stringify({ case: name, stage: 'STARTED', observedAt: new Date().toISOString() }));
        try {
          const receipt = await adapter.native(name, args);
          await writeFile(progressPath, JSON.stringify({ case: name, stage: 'NATIVE_RECEIPT_VALIDATED', observedAt: new Date().toISOString() }));
          return receipt;
        } catch (error) {
          await writeFile(join(artifact, 'af191-native-failure.json'), JSON.stringify({ case: name,
            code: typeof error?.code === 'string' && /^[A-Z0-9_]{2,60}$/.test(error.code) ? error.code : 'FAILED',
            frames: String(error?.stack ?? '').split('\n').filter(line => /^\s+at /.test(line)).slice(0, 8) }, null, 2));
          throw error;
        }
      },
      async evidence({ consumer, runId, native, matrix, sourceFiles }) {
        assert.deepEqual(matrix, ['esm', 'cjs', 'esm-types', 'cjs-types']);
        // The original helper has run the module assertions. Capture four real
        // subprocess receipts as required by I215, including each declaration mode.
        const receipts = [];
        for (const name of ['esm', 'cjs', 'esm-types', 'cjs-types']) {
          const args = name === 'esm' ? ['matrix.mjs'] : name === 'cjs' ? ['matrix.cjs'] : [
            join(root, 'node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--module', 'NodeNext', '--moduleResolution', 'NodeNext',
            '--target', 'ES2022', '--lib', 'ES2022,DOM', name === 'esm-types' ? 'matrix.mts' : 'matrix.cts'
          ];
          receipts.push(await run(name, process.execPath, args, consumer.directory));
        }
        const bundle = await adapter.evidence({ consumer, runId, native, matrix: receipts,
          sourceFiles: sourceFiles.map(f => f.path).filter(path => !path.split('/').includes('dist')) });
        const readKind = async kind => {
          const descriptor = bundle.files.find(f => f.kind === kind); assert.ok(descriptor, kind);
          const bytes = await readFile(join(root, descriptor.path)); assert.equal(sha256(bytes), descriptor.sha256);
          return JSON.parse(bytes.toString('utf8'));
        };
        const lease = await readKind('lease'), http = await readKind('http'), pg = await readKind('pg'), install = await readKind('package-install');
        const files = bundle.files.filter(f => !['lease', 'http', 'pg', 'package-install', 'package-matrix', 'source', 'native-png'].includes(f.kind)).map(f => {
          if (f.kind.startsWith('installed-') && !f.path.endsWith('/dist/index.mjs')) return { ...f, kind: f.kind + '-graph-file' };
          return f;
        });
        const normalized = [...http.observations.request, ...http.observations.fetchAsActor].map(r => ({ ...r, path: r.path.replace(/^\/api(?=\/client\/)/, '') }));
        files.push(await save('lease', 'lease', lease));
        files.push(await save('http', 'http', { workspaceId: runtime.workspaceId, runId, responses: [...host.responses, ...normalized], originalEvidence: bundle.files.find(f => f.kind === 'http'),
          hashBasis: { relay: 'actual API response bytes', request: 'JSON.stringify-returned-body', fetchAsActor: 'actual response bytes' } }));
        files.push(await save('pg', 'pg', { workspaceId: runtime.workspaceId, runId, ...pg }));
        files.push(await save('package-install', 'package-install', { command: 'npm install --offline --ignore-scripts --no-audit --no-fund', exitCode: 0,
          ...install, originalEvidence: bundle.files.find(f => f.kind === 'package-install'), completionBasis: 'original installTargetConsumer returned after actual successful execFileSync, verified installed archive graph and lock' }));
        files.push(await save('package-matrix', 'package-matrix', { matrix: [...matrix, 'browser-importmap'], processReceipts: receipts.map(r => ({ name: r.name, exitCode: r.exitCode, startedAt: r.startedAt, finishedAt: r.finishedAt })),
          originalEvidence: bundle.files.find(f => f.kind === 'package-matrix') }));
        const nativeRecords = [];
        for (const value of native) {
          const path = relative(root, value.screenshot.path), png = bundle.files.find(f => f.kind === 'native-png' && f.path === path);
          assert.ok(png); assert.equal(png.sha256, value.screenshot.sha256);
          files.push({ ...png, kind: 'native', case: value.case, native: true, runId, viewportWidth: value.viewportWidth });
          nativeRecords.push({ case: value.case, native: true, runId, viewportWidth: value.viewportWidth, observedAt: value.observedAt,
            screenshotSha256: value.screenshot.sha256, ...(value.apiStatus === undefined ? {} : { apiStatus: value.apiStatus }),
            ...(value.privateContentCleared === undefined ? {} : { privateContentCleared: value.privateContentCleared }),
            ...(value.hiddenObserved === undefined ? {} : { hiddenObserved: value.hiddenObserved }) });
        }
        files.push(await save('native-receipts', 'native-receipts', { driver: 'orca-computer', browserDriver: 'Orca typed browser actions plus owned native Chrome pointer/addressbar/new-tab; readonly CDP observations and screenshots; no event injection', runId, receipts: nativeRecords }));
        // Preserve the unmodified I215 descriptor graph as supplemental evidence.
        files.push(await save('original-adapter-evidence', 'adapter-source-evidence', bundle));
        return files;
      },
      close() { return closePromise ??= (async () => {
        try {
          const result = await adapter.close();
          assert.equal(result.applicationPools, 0); assert.equal(result.ownedSockets, 0);
          const descriptor = await save('closed', 'closed', { applicationPools: result.applicationPools, ownedSockets: result.ownedSockets,
            environmentRestored: result.environmentRestored, fetchRestored: result.fetchRestored, originalEvidence: result.evidence });
          return { ...result, files: [descriptor] };
        } finally { await driver.close(); await host.close(); }
      })(); }
    };
  } catch (error) {
    try { if (adapter) await adapter.close(); else if (runtime) await runtime.close(); }
    finally { await driver?.close(); await host.close(); }
    throw error;
  }
}
