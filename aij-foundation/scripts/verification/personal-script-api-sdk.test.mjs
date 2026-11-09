import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import ts from 'typescript';

const require = createRequire(resolve('apps/api/package.json'));
require('ts-node').register({ project: resolve('apps/api/tsconfig.json'), transpileOnly: true });
require('reflect-metadata');
const dto = require(resolve('apps/api/src/plugins/aij-ai/ai-personal-script-execution.dto.ts'));
const ctrl = require(resolve('apps/api/src/plugins/aij-ai/ai-personal-script-execution.controller.ts'));
const { CLIENT_WORKSPACE_PERMISSIONS_KEY } = require(resolve('apps/api/src/client-workspaces/client-workspace-permission.decorator.ts'));
const { createClientApi } = await import('../../packages/sdk/dist/index.mjs');
const temp = mkdtempSync(join(tmpdir(), 'aij-af211-'));
process.on('exit', () => rmSync(temp, { recursive: true, force: true }));
const sdk = [];
for (const [module, suffix] of [[ts.ModuleKind.ES2022, 'mjs'], [ts.ModuleKind.CommonJS, 'cjs']]) {
  const source = resolve('packages/sdk/src/personal-script-execution.ts');
  const output = ts.transpileModule(readFileSync(source, 'utf8'), { fileName: source, compilerOptions: { module, target: ts.ScriptTarget.ES2022, strict: true }, reportDiagnostics: true });
  assert.equal(output.diagnostics.length, 0);
  const path = join(temp, 'sdk.' + suffix); writeFileSync(path, output.outputText);
  sdk.push([suffix, suffix === 'mjs' ? await import(pathToFileURL(path)) : require(path)]);
}
const hash = s => createHash('sha256').update(s).digest('hex');
const policy = hash('{"version":"aij-private-python-json-v1","language":"python","sourceBytes":65536,"inputBytes":16384,"outputBytes":65536,"depth":16,"entries":2048,"timeoutMs":30000,"network":"none","tools":[],"attachments":[]}');
const versionId = '31c46c8a-38e4-493b-82cc-e4f69de26be0', runId = '41c46c8a-38e4-493b-82cc-e4f69de26be0', assetId = '51c46c8a-38e4-493b-82cc-e4f69de26be0';
const create = () => ({ skillId: 'skill', expectedRevision: 1, name: 'private', instructions: 'instructions', scriptSource: 'print(input_data)' });
const input = () => ({ scriptVersionId: versionId, input: { z: [true, null, 3], a: 'private' }, idempotencyKey: 'original-key' });
const ref = () => ({ scriptVersionId: versionId, skillId: 'skill', skillVersionId: 'opaque-version', revision: 2, scriptDigest: hash(create().scriptSource), policyDigest: policy });
const output = Buffer.from(' {"ok":true}\n');
const meta = () => ({ assetId, mimeType: 'application/json', originalName: `script-${runId}.json`, size: output.length, checksum: hash(output), createdAt: '2026-11-07T00:00:01.000Z' });
const run = (success = false) => ({ id: runId, script: ref(), jobId: assetId, jobStatus: success ? 'completed' : 'pending', outcome: success ? 'SUCCESS' : null, attempted: success, result: success ? meta() : null, createdAt: '2026-11-07T00:00:00.000Z', expiresAt: '2026-11-14T00:00:00.000Z' });
const headers = () => new Headers({ 'content-type': 'application/json', 'content-length': String(output.length), 'content-disposition': `attachment; filename="script-${runId}.json"`, 'x-aij-script-run-id': runId, 'x-aij-script-version-id': versionId, 'x-aij-asset-id': assetId, 'x-aij-checksum-sha256': hash(output), 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' });
const status = n => e => e.getStatus?.() === n;

for (const [kind, mod] of sdk) {
  test(kind + ': seven methods through original ClientApi, one fetch each including binary stream', async () => {
    const oldFetch = globalThis.fetch, calls = [];
    const responses = [ref(), { ref: ref(), scriptSource: create().scriptSource }, { configured: true, canExecute: false, reason: 'not_permitted' }, run(), run(), run(), null];
    globalThis.fetch = async (url, options) => {
      calls.push({ url, options }); const body = responses.shift();
      return body ? new Response(JSON.stringify({ success: true, data: body, message: 'ok' }), { headers: { 'content-type': 'application/json' } }) : new Response(new ReadableStream({ start(c) { c.enqueue(output.subarray(0, 3)); c.enqueue(output.subarray(3)); c.close(); } }), { headers: headers() });
    };
    try {
      const c = mod.createPersonalScriptExecutionClient(createClientApi(() => 'https://aij.invalid/api'));
      assert.deepEqual(Object.keys(c).sort(), ['createVersion','version','capability','submit','recover','read','download'].sort());
      await c.createVersion('space', create()); await c.version('space', versionId); assert.equal((await c.capability('space')).canExecute, false);
      await c.submit('space', input()); await c.recover('space', 'original-key'); await c.read('space', runId);
      assert.deepEqual(Buffer.from((await c.download('space', run(true))).bytes), output);
      assert.equal(calls.length, 7); assert.deepEqual(calls.map(c => c.options.method), ['POST','GET','GET','POST','GET','GET','GET']);
      for (const { url, options } of calls) { assert.ok(url.startsWith('https://aij.invalid/api/client/script-executions/')); assert.ok(!url.includes('private')); assert.equal(options.credentials, 'include'); assert.equal(options.cache, 'no-store'); assert.equal(options.headers.get('x-aij-workspace-id'), 'space'); }
    } finally { globalThis.fetch = oldFetch; }
  });
  test(kind + ': strict request validation, no getters/prototypes/unicode/nonfinite/oversize fields', async () => {
    let calls = 0; const c = mod.createPersonalScriptExecutionClient(async () => { calls++; return ref(); });
    const bad = [undefined, null, [], new Date(), { ...input(), workspaceId: 'spoof' }, { ...input(), input: Infinity }, { ...input(), input: { constructor: 'x' } }, { ...input(), input: '\ud800' }, { ...input(), input: '中'.repeat(5500) }];
    const cycle = {}; cycle.self = cycle; bad.push({ ...input(), input: cycle });
    const getter = input(); Object.defineProperty(getter, 'input', { enumerable: true, get() { return assert.fail('getter invoked'); } }); bad.push(getter);
    const sparse = []; sparse.length = 1; bad.push({ ...input(), input: sparse });
    for (const b of bad) await assert.rejects(c.submit('space', b), TypeError);
    for (const b of [{ ...create(), scriptSource: '\udfff' }, { ...create(), scriptSource: '\0' }, { ...create(), scriptSource: '中'.repeat(21846) }, { ...create(), expectedRevision: Infinity }, { ...create(), name: ' x' }, { ...create(), actor: 'spoof' }]) await assert.rejects(c.createVersion('space', b), TypeError);
    await assert.rejects(c.read('space', runId, { headers: {} }), TypeError); assert.equal(calls, 0);
  });
  test(kind + ': strict ref/source/run/capability response and consistency checks', async () => {
    let response; const c = mod.createPersonalScriptExecutionClient(async () => response);
    for (const patch of [r => r.script.policyDigest = 'a'.repeat(64), r => r.script.scriptDigest = 'A'.repeat(64), r => r.script.revision = 0, r => r.jobStatus = 'queued', r => r.result = meta(), r => r.outcome = 'vendor-text', r => r.createdAt = '2026-02-30T00:00:00.000Z', r => r.expiresAt = r.createdAt, r => r.script.session = 'secret', r => r.jobId = 'opaque']) { response = run(); patch(response); await assert.rejects(c.read('space', runId), TypeError); }
    for (const patch of [r => r.result.size = 65537, r => r.result.originalName = 'other.json', r => r.attempted = false, r => r.result.createdAt = r.expiresAt]) { response = run(true); patch(response); await assert.rejects(c.read('space', runId), TypeError); }
    response = { ref: ref(), scriptSource: 'changed' }; await assert.rejects(c.version('space', versionId));
    response = { configured: false, canExecute: true, reason: 'ready' }; await assert.rejects(c.capability('space'));
    response = { configured: false, canExecute: false, reason: 'not_configured' }; await c.capability('space');
    response = run(); response.id = assetId; await assert.rejects(c.read('space', runId));
  });
  test(kind + ': every download provenance header, hash, output parser and abort failure clears bytes', async () => {
    for (const header of [...headers().keys(), 'content-encoding']) {
      const bytes = new Uint8Array(output), h = headers(); h.set(header, 'wrong');
      const c = mod.createPersonalScriptExecutionClient(async () => ({ bytes, headers: h }));
      await assert.rejects(c.download('space', run(true))); assert.ok(bytes.every(n => n === 0), header);
    }
    for (const content of ['{"a":1,"a":2}', '{"__proto__":1}', '1e999', 'null null', '"\\ud800"', '\ufeffnull']) {
      const bytes = new TextEncoder().encode(content), expected = run(true); expected.result.size = bytes.length; expected.result.checksum = hash(bytes);
      const h = headers(); h.set('content-length', String(bytes.length)); h.set('x-aij-checksum-sha256', hash(bytes));
      await assert.rejects(mod.createPersonalScriptExecutionClient(async () => ({ bytes, headers: h })).download('space', expected)); assert.ok(bytes.every(n => n === 0));
    }
    const bytes = new Uint8Array(output); bytes[1] = 32; const c = mod.createPersonalScriptExecutionClient(async () => ({ bytes, headers: headers() })); await assert.rejects(c.download('space', run(true))); assert.ok(bytes.every(n => n === 0));
    const abort = new AbortController(), b = new Uint8Array(output); abort.abort();
    await assert.rejects(mod.createPersonalScriptExecutionClient(async () => ({ bytes: b, headers: headers() })).download('space', run(true), { signal: abort.signal })); assert.ok(b.every(n => n === 0));
  });
  test(kind + ': unknown POST never retries, explicit key recovery is GET only', async () => {
    const calls = []; let fail = true;
    const c = mod.createPersonalScriptExecutionClient(async (path, options) => { calls.push({ path, options }); if (fail) throw Error('transport'); return run(); });
    await assert.rejects(c.submit('space', input())); assert.equal(calls.length, 1); fail = false; await c.recover('space', 'original-key'); assert.equal(calls.length, 2); assert.equal(calls[1].options.method, 'GET'); assert.equal(calls[1].options.body, undefined);
  });
}

test('DTO exact byte/depth/entry limits, canonical input and original source preservation', () => {
  assert.deepEqual(dto.scriptCreate(create()), create()); assert.equal(dto.scriptCreate({ ...create(), scriptSource: ' '.repeat(65536) }).scriptSource.length, 65536);
  for (const v of [null, false, true, 0, 'text', [], {}]) assert.deepEqual(dto.scriptSubmit({ ...input(), input: v }).input, v);
  assert.deepEqual(Object.keys(dto.scriptSubmit(input()).input), ['a','z']);
  let v = null; for (let i = 0; i < 16; i++) v = [v]; dto.scriptSubmit({ ...input(), input: v });
  assert.throws(() => dto.scriptSubmit({ ...input(), input: [v] }), status(400));
  dto.scriptSubmit({ ...input(), input: Array(2048).fill(null) }); assert.throws(() => dto.scriptSubmit({ ...input(), input: Array(2049).fill(null) }), status(400));
  dto.scriptSubmit({ ...input(), input: 'x'.repeat(16382) }); assert.throws(() => dto.scriptSubmit({ ...input(), input: 'x'.repeat(16383) }), status(400));
  assert.throws(() => dto.scriptCreate({ ...create(), scriptSource: 'x'.repeat(65537) }), status(400));
});
function response() { const r = new EventEmitter(); r.headers = {}; r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v; }; r.end = (b, done) => { r.bytes = Buffer.from(b); done(); }; return r; }

test('actual body-parser stream with early media/private hook rejects duplicate keys, bad UTF8, unicode inflation and unsafe JSON', async () => {
  const parser = require('body-parser');
  async function parse(bytes, media = 'application/json', url = '/api/client/script-executions/runs') {
    const req = Readable.from([bytes.subarray(0, 3), bytes.subarray(3)]); req.url = url; req.method = 'POST'; req.headers = { 'content-type': media, 'content-length': String(bytes.length) };
    const res = response(); let error;
    ctrl.scriptExecutionPrivateMiddleware(req, res, e => { error = e; });
    if (!error) await new Promise(resolve => parser.json({ limit: '100kb', verify: ctrl.scriptExecutionJsonVerify })(req, res, e => { error = e; resolve(); }));
    return { req, res, error };
  }
  const good = await parse(Buffer.from(JSON.stringify(input()))); assert.equal(good.error, undefined); assert.deepEqual(good.req.body, input());
  for (const content of ['{"input":{"a":1,"\\u0061":2}}', '{"constructor":1}', '{"x":1e999}', '{"x":"\\ud800"}', '{}{}', '\ufeff{}']) { const r = await parse(Buffer.from(content)); assert.ok(r.error, content); assert.equal(r.res.headers['cache-control'], 'private, no-store'); }
  const bad = await parse(Buffer.from([123,34,120,34,58,34,255,34,125])); assert.ok(bad.error);
  for (const media of ['text/plain','application/json; charset=latin1','multipart/form-data','application/x-www-form-urlencoded']) { const r = await parse(Buffer.from('{}'), media); assert.equal(r.error.getStatus(), 415); }
  const large = await parse(Buffer.from(JSON.stringify({ ...create(), scriptSource: '\u0001'.repeat(20000) }))); assert.equal(large.error.status, 413); assert.equal(large.res.headers['x-content-type-options'], 'nosniff');
  const other = await parse(Buffer.from('{"x":1,"x":2}'), 'application/json', '/api/other'); assert.equal(other.error, undefined); assert.equal(other.res.headers['cache-control'], undefined);
});

test('controller guarded scopes/claims/session gate, exact permissions, Origin, DI failure and binary result', async () => {
  const calls = [], claims = { sub: 'member', sessionId: 'session', tokenVersion: 2 }, auth = { assertSessionInTransaction: async (tx, c) => { calls.push(['gate',tx,c]); } };
  const assets = { createVersion: async (...args) => { calls.push(['create', ...args]); await args[3]('tx'); return ref(); }, readVersion: async (...args) => { calls.push(['version', ...args]); return { ref: ref(), scriptSource: create().scriptSource }; } };
  const runs = Object.fromEntries(['submit','read','recover','capability'].map(method => [method, async (...args) => { calls.push([method,...args]); return method === 'read' ? run(true) : run(); }]));
  let contentBytes; runs.content = async (...args) => { calls.push(['content',...args]); contentBytes = Buffer.from(output); return { meta: meta(), bytes: contentBytes }; };
  const c = new ctrl.AiPersonalScriptExecutionController(assets, runs, { getOrThrow: () => 'http://127.0.0.1:3655' }, auth);
  const req = { client: { id: 'member' }, clientClaims: claims, workspaceContext: { workspaceId: 'space' }, headers: { origin: 'http://127.0.0.1:3655' }, correlationId: 'correlation' };
  await c.createVersion(req, create(), {}); assert.deepEqual(calls[0].slice(0, 3), ['create','member','space']); assert.deepEqual(calls[1], ['gate','tx',claims]);
  await c.version(req, versionId, {}); await c.submit(req, input(), {}); await c.capability(req, {}); await c.recover(req, 'original-key', {}); await c.read(req, runId, {});
  assert.deepEqual(calls.find(c => c[0] === 'submit').slice(-2), [claims,'correlation']);
  const res = response(); await c.content(req, runId, {}, res); assert.deepEqual(res.bytes, output); assert.ok(contentBytes.every(v => v === 0)); assert.equal(res.headers['x-aij-script-version-id'], versionId); assert.equal(res.headers['content-type'], 'application/json');
  assert.throws(() => c.submit({ ...req, headers: { origin: 'https://evil.invalid' } }, input(), {}), status(403));
  assert.throws(() => c.read({ ...req, clientClaims: undefined }, runId, {}), status(401));
  assert.throws(() => c.read(req, runId, { workspaceId: 'spoof' }), status(400)); assert.throws(() => c.read(req, runId, {}, {}), status(400));
  const absent = new ctrl.AiPersonalScriptExecutionController(undefined, undefined, { getOrThrow: () => '' }, auth); assert.throws(() => absent.capability(req, {}), status(503));
  const perms = method => Reflect.getMetadata(CLIENT_WORKSPACE_PERMISSIONS_KEY, c[method]);
  assert.deepEqual(perms('capability'), ['workspace.ai.assets.read']); assert.deepEqual(perms('createVersion'), ['workspace.ai.assets.manage','workspace.ai.scripts.manage']);
  assert.deepEqual(perms('submit'), ['workspace.ai.assets.read','workspace.ai.execute','workspace.ai.scripts.execute']);
  for (const name of ['read','recover','content']) assert.deepEqual(perms(name), ['workspace.ai.assets.read','workspace.ai.read','workspace.ai.scripts.execute']);
});

test('strict targeted SDK and API typecheck (no full API build)', () => {
  for (const [roots, options] of [
    [['packages/sdk/src/personal-script-execution.ts'], { module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, lib: ['lib.es2022.d.ts','lib.dom.d.ts'], types: [] }],
    [['apps/api/src/plugins/aij-ai/ai-personal-script-execution.controller.ts','apps/api/src/plugins/aij-ai/ai-personal-script-execution.dto.ts'], { module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.Node10, experimentalDecorators: true, emitDecoratorMetadata: true, esModuleInterop: true, typeRoots: [resolve('node_modules/@types')], types: ['node'] }]
  ]) {
    const program = ts.createProgram(roots.map(p => resolve(p)), { ...options, target: ts.ScriptTarget.ES2022, strict: true, skipLibCheck: true, noEmit: true });
    const diagnostics = ts.getPreEmitDiagnostics(program);
    assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCurrentDirectory: () => process.cwd(), getCanonicalFileName: f => f, getNewLine: () => '\n' }));
  }
});

test('original ClientApi binary streaming rejects truncated/oversize/aborted streams with one fetch', async () => {
  const oldFetch = globalThis.fetch;
  try {
    for (const mode of ['short','long','abort','bad-length']) {
      let count = 0, cancelled = false; const abort = new AbortController();
      const h = headers(); if (mode === 'bad-length') h.set('content-length', '65537');
      globalThis.fetch = async () => {
        count++;
        return new Response(new ReadableStream({
          start(c) { if (mode === 'short') { c.enqueue(output.subarray(0, 2)); c.close(); } else if (mode === 'long') { c.enqueue(new Uint8Array(output.length + 1)); c.close(); } else if (mode === 'abort') { c.enqueue(output); queueMicrotask(() => abort.abort()); } },
          cancel() { cancelled = true; }
        }), { headers: h });
      };
      await assert.rejects(sdk[0][1].createPersonalScriptExecutionClient(createClientApi(() => 'https://aij.invalid')).download('space', run(true), { signal: abort.signal }));
      assert.equal(count, 1); if (mode === 'abort' || mode === 'bad-length') assert.equal(cancelled, true);
    }
  } finally { globalThis.fetch = oldFetch; }
});

test('strict MTS and CTS consumers match both candidate runtime branches (not installed tarball acceptance)', () => {
  const source = resolve('packages/sdk/src/personal-script-execution.ts'); let declaration;
  const program = ts.createProgram([source], { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, strict: true, skipLibCheck: true, declaration: true, emitDeclarationOnly: true, types: [], lib: ['lib.es2022.d.ts','lib.dom.d.ts'] });
  const result = program.emit(undefined, (file, contents) => { if (file.endsWith('/personal-script-execution.d.ts')) declaration = contents; });
  assert.equal(result.emitSkipped, false); assert.ok(declaration);
  for (const suffix of ['mts','cts']) {
    const runtime = suffix === 'mts' ? 'mjs' : 'cjs';
    const types = declaration.replace("'./index.js'", JSON.stringify(resolve('packages/sdk/dist/index.' + runtime))).replace("'./client-binary-response.js'", JSON.stringify(resolve('packages/sdk/dist/client-binary-response.' + runtime)));
    writeFileSync(join(temp, 'sdk.d.' + suffix), types);
    const consumer = join(temp, 'consumer.' + suffix);
    writeFileSync(consumer, `import { createPersonalScriptExecutionClient, type ScriptRun, type ScriptRef } from './sdk.${runtime}';\ndeclare const api: import(${JSON.stringify(resolve('packages/sdk/dist/index.' + runtime))}).ClientApi;\nconst c = createPersonalScriptExecutionClient(api);\nconst ref: Promise<ScriptRef> = c.createVersion('space', { skillId: 'skill', expectedRevision: 1, name: 'name', instructions: 'text', scriptSource: 'print(1)' });\ndeclare const run: ScriptRun;\nc.download('space', run, { signal: new AbortController().signal }); c.submit('space', { scriptVersionId: 'id', input: null, idempotencyKey: 'key' });\nvoid ref;\n// @ts-expect-error options never accept headers or caller identity\nc.capability('space', { headers: {} });\n// @ts-expect-error submit requires original key\nc.submit('space', { scriptVersionId: 'id', input: null });\n`);
    const p = ts.createProgram([consumer], { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, strict: true, skipLibCheck: false, noEmit: true, types: [], lib: ['lib.es2022.d.ts','lib.dom.d.ts'] });
    const errors = ts.getPreEmitDiagnostics(p); assert.equal(errors.length, 0, ts.formatDiagnosticsWithColorAndContext(errors, { getCurrentDirectory: () => process.cwd(), getCanonicalFileName: f => f, getNewLine: () => '\n' }));
  }
});


test('server content keeps bytes alive until end callback and clears on close failure', async () => {
  for (const disconnect of [false, true]) {
    const bytes = Buffer.from(output), claims = { sub: 'member', sessionId: 'session', tokenVersion: 1 };
    const c = new ctrl.AiPersonalScriptExecutionController(undefined, { content: async () => ({ meta: meta(), bytes }), read: async () => run(true) }, {}, {});
    const req = { client: { id: 'member' }, clientClaims: claims, workspaceContext: { workspaceId: 'space' }, headers: {} };
    const res = response(); let complete;
    res.end = (value, done) => { assert.equal(value, bytes); complete = done; };
    const pending = c.content(req, runId, {}, res); const checked = disconnect ? assert.rejects(pending) : pending;
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(bytes, output); assert.equal(typeof complete, 'function');
    if (disconnect) res.emit('close'); else complete();
    await checked; assert.ok(bytes.every(n => n === 0));
  }
});
