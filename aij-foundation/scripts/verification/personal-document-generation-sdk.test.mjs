// AF229 offline candidate: frozen-wire transport collaborators only; no actual auth/PG/runtime acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import ts from 'typescript';

const root = fileURLToPath(new URL('../../', import.meta.url));
const source = join(root, 'packages/sdk/src/personal-document-generation.ts');
const artifacts = join(root, '.artifacts/AF-229');
mkdirSync(artifacts, { recursive: true });
const formatDiagnostics = d => ts.formatDiagnosticsWithColorAndContext(d, {
  getCanonicalFileName: v => v, getCurrentDirectory: () => root, getNewLine: () => '\n'
});
// Semantically check actual new source and its existing type imports; emit ONLY the new module.
for (const [module, moduleResolution, ext] of [
  [ts.ModuleKind.NodeNext, ts.ModuleResolutionKind.NodeNext, 'mjs'],
  [ts.ModuleKind.CommonJS, ts.ModuleResolutionKind.Node10, 'cjs']
]) {
  const program = ts.createProgram([source], {
    target: ts.ScriptTarget.ES2022, module, moduleResolution, strict: true,
    skipLibCheck: true, types: [], lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'], declaration: true
  });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.equal(diagnostics.length, 0, formatDiagnostics(diagnostics));
  const result = program.emit(program.getSourceFile(source), (name, data) => {
    const file = join(artifacts, `personal-document-generation.${name.endsWith('.d.ts') ? `d.${ext === 'mjs' ? 'mts' : 'cts'}` : ext}`);
    writeFileSync(file, data);
  });
  assert.equal(result.emitSkipped, false);
  assert.equal(result.diagnostics.length, 0, formatDiagnostics(result.diagnostics));
}
const esm = await import(pathToFileURL(join(artifacts, 'personal-document-generation.mjs')).href);
const require = createRequire(import.meta.url);
const cjs = require(join(artifacts, 'personal-document-generation.cjs'));
const documentId = '12345678-1234-4234-8234-123456789abc';
const agentId = '22345678-1234-4234-8234-123456789abc';
const sha = value => createHash('sha256').update(value, 'utf8').digest('hex');
const instruction = '  保持原样\r\n😀  ';
function origin() {
  return { format: 'aij-document-generation-v1', document: { format: 'aij-document-section-source-v1', indexFormat: 'aij-plain-sections-v1', documentId,
    revision: 7, bodySha256: sha('# source\r\n😀'), sectionId: 'section-0', start: 0, end: 12, sectionSha256: sha('# source\r\n😀') },
  agentId, agentVersionId: 'opaque_version', agentRevision: 3, agentPublicationEpoch: 4, catalogVersion: 5, modelCode: 'text-model', modelRevision: 6,
  instructionSha256: sha(instruction), inputSha256: 'd'.repeat(64), maximumEstimatedCostNanos: '123' };
}
function previewBody() { return { documentId, expectedRevision: 7, bodySha256: origin().document.bodySha256, sectionId: 'section-0', agentId, agentRevision: 3, instruction }; }
function submitBody() { return { origin: origin(), instruction, idempotencyKey: 'request_123' }; }
function preview() { return { origin: origin(), inputFields: ['source', 'instruction'], modelExecutionConfigured: false }; }
function run() { return { id: 'run_1', agentCode: 'personal:' + agentId, status: 'succeeded', output: '生成正文😀\r\n', failureCode: null,
  estimatedCostNanos: '12', budgetStatus: 'settled', imageAssetId: null, createdAt: '2026-11-09T00:00:00.000Z', expiresAt: '2026-11-16T00:00:00.000Z' }; }
function envelope() { return { run: run(), origin: origin() }; }
function recovery() { return { request: { id: 'run_1', agentCode: 'personal:' + agentId, status: 'unknown', budgetStatus: 'reserved',
  createdAt: '2026-11-09T00:00:00.000Z', expiresAt: '2026-11-16T00:00:00.000Z', contentAvailable: false }, origin: origin(), documentCurrent: false }; }
const badType = e => e instanceof TypeError && !Object.hasOwn(e, 'status') && !e.message.includes('PRIVATE');
function accessor(obj, key, mark) { Object.defineProperty(obj, key, { enumerable: true, get() { mark.called = true; throw Error('PRIVATE getter'); } }); }

for (const [mode, sdk] of [['ESM', esm], ['CJS', cjs]]) {
  const create = sdk.createPersonalDocumentGenerationClient;
  test(`${mode}: isolated module has one public runtime factory and no runtime dependency/import`, () => {
    assert.deepEqual(Object.keys(sdk), ['createPersonalDocumentGenerationClient']);
    assert.doesNotMatch(readFileSync(join(artifacts, `personal-document-generation.${mode === 'ESM' ? 'mjs' : 'cjs'}`), 'utf8'), /(?:require\(|\bfrom\s+["']|\bimport\s*\()/);
    assert.throws(() => create({}), badType);
  });
  test(`${mode}: four explicit operations each use one original scoped request, raw POST instruction and exact AbortSignal`, async () => {
    const calls = [], abort = new AbortController(); let result = preview();
    const client = create(async (path, options) => { calls.push({ path, options }); return result; });
    const p = await client.preview('workspace_1', previewBody(), abort.signal); assert.deepEqual(p, preview());
    result = envelope(); const s = await client.submit('workspace_1', submitBody(), abort.signal); assert.deepEqual(s, result);
    const r = await client.read('workspace_1', 'run_1', abort.signal); assert.deepEqual(r, result);
    result = recovery(); const k = await client.recover('workspace_1', 'request_123', abort.signal); assert.deepEqual(k, result);
    assert.deepEqual(calls.map(c => c.path), ['/client/ai/document-generations/preview', '/client/ai/document-generations',
      '/client/ai/document-generation-runs/run_1', '/client/ai/document-generation-requests/request_123']);
    assert.deepEqual(calls.map(c => c.options.method), ['POST', 'POST', 'GET', 'GET']);
    for (const c of calls) {
      assert.equal(c.options.workspaceId, 'workspace_1'); assert.equal(c.options.signal, abort.signal); assert.equal(c.options.cache, 'no-store');
      assert.equal(Object.hasOwn(c.options, 'headers'), false); assert.equal(c.path.includes('instruction'), false);
    }
    assert.deepEqual(JSON.parse(calls[0].options.body), previewBody()); assert.deepEqual(JSON.parse(calls[1].options.body), submitBody());
    assert.equal(calls[2].options.body, undefined); assert.equal(calls[3].options.body, undefined);
    assert.ok(Object.isFrozen(client) && Object.isFrozen(p.inputFields) && Object.isFrozen(s.run) && Object.isFrozen(s.origin.document));
    assert.ok(Object.isFrozen(k.request)); assert.equal(Object.hasOwn(k.request, 'output'), false);
    result.request.status = 'succeeded'; assert.equal(k.request.status, 'unknown');
  });
  test(`${mode}: input scope, key, id, signal and exact request bodies rejected before any transport`, async () => {
    let calls = 0; const client = create(async () => { calls++; return preview(); });
    for (const scope of ['', '../other', 'scope?owner=x', 'scope\r\nx', 'a'.repeat(129), {}, ['space']]) {
      await assert.rejects(client.preview(scope, previewBody()), badType);
      await assert.rejects(client.submit(scope, submitBody()), badType);
      await assert.rejects(client.read(scope, 'run_1'), badType);
      await assert.rejects(client.recover(scope, 'request_123'), badType);
    }
    for (const id of ['', '../run', 'run?output=1', 'a'.repeat(129), {}, ['run']]) await assert.rejects(client.read('s', id), badType);
    for (const key of ['', 'short', '../request_123', 'a'.repeat(129), {}]) await assert.rejects(client.recover('s', key), badType);
    await assert.rejects(client.preview('s', previewBody(), {}), badType);
    for (const value of [null, [], { ...previewBody(), workspaceId: 'spoofed' }, { ...previewBody(), projectId: 'spoofed' }, { ...submitBody(), memberId: 'spoofed' }]) {
      await assert.rejects(client.preview('s', value), badType);
    }
    const changes = [v => { v.expectedRevision = -0; }, v => { v.expectedRevision = 201; }, v => { v.expectedRevision = '7'; },
      v => { v.agentRevision = 2147483648; }, v => { v.agentRevision = 1.5; }, v => { v.agentId = agentId.toUpperCase(); },
      v => { v.sectionId = 'section-01'; }, v => { v.sectionId = 'section-128'; }, v => { v.bodySha256 = 'A'.repeat(64); },
      v => { v.instruction = ' \t\r\n'; }, v => { v.instruction = '😀'.repeat(1001); }];
    for (const change of changes) { const value = previewBody(); change(value); await assert.rejects(client.preview('s', value), badType); }
    for (const change of [v => { v.idempotencyKey = 'short'; }, v => { v.origin.maximumEstimatedCostNanos = '9223372036854775808'; },
      v => { v.origin.agentVersionId = '../bad'; }, v => { v.origin.document.end = v.origin.document.start; }, v => { v.extra = true; }]) {
      const value = submitBody(); change(value); await assert.rejects(client.submit('s', value), badType);
    }
    assert.equal(calls, 0);
  });
  test(`${mode}: descriptor/prototype/pollution rejection at every request depth never evaluates accessors`, async () => {
    let calls = 0; const client = create(async () => { calls++; return envelope(); });
    for (const place of ['root', 'origin', 'document']) {
      const value = submitBody(), target = place === 'root' ? value : place === 'origin' ? value.origin : value.origin.document;
      const mark = { called: false }; accessor(target, place === 'root' ? 'instruction' : place === 'origin' ? 'agentId' : 'start', mark);
      await assert.rejects(client.submit('s', value), badType); assert.equal(mark.called, false);
      for (const change of [v => Object.defineProperty(v, 'hidden', { value: 'PRIVATE' }), v => { v[Symbol('PRIVATE')] = true; },
        v => Object.defineProperty(v, '__proto__', { value: {}, enumerable: true }), v => Object.setPrototypeOf(v, { PRIVATE: true })]) {
        const input = submitBody(), object = place === 'root' ? input : place === 'origin' ? input.origin : input.origin.document;
        change(object); await assert.rejects(client.submit('s', input), badType);
      }
    }
    const hostile = new Proxy(submitBody(), { getPrototypeOf() { throw Error('PRIVATE trap'); } });
    await assert.rejects(client.submit('s', hostile), badType); assert.equal(calls, 0);
  });
  test(`${mode}: exact wire refs, statuses, output, dates and costs; malformed successes become safe TypeError`, async () => {
    const changes = [v => { v.snapshot = 'PRIVATE'; }, v => { v.run.trace = 'PRIVATE'; }, v => { v.origin.session = 'PRIVATE'; },
      v => { v.origin.document.body = 'PRIVATE'; }, v => { v.run.output = { text: 'PRIVATE' }; }, v => { v.run.output = 'a'.repeat(64001); },
      v => { v.run.imageAssetId = 'image_1'; }, v => { v.run.status = 'completed'; }, v => { v.run.budgetStatus = 'reserved'; },
      v => { v.run.failureCode = 'PRIVATE detail'; }, v => { v.run.createdAt = new Date(v.run.createdAt); },
      v => { v.run.createdAt = '2026-11-09T00:00:00Z'; }, v => { v.run.createdAt = '2026-02-30T00:00:00.000Z'; },
      v => { v.run.createdAt = v.run.expiresAt; }, v => { v.run.estimatedCostNanos = '01'; }, v => { v.run.estimatedCostNanos = '-1'; },
      v => { v.run.estimatedCostNanos = '9223372036854775808'; }, v => { v.run.id = 'different'; }, v => { v.run.agentCode = 'personal:' + documentId; },
      v => { v.origin.format = 'future'; }, v => { v.origin.agentVersionId = ''; }, v => { v.origin.agentPublicationEpoch = 0; },
      v => { v.origin.modelCode = 'Text'; }, v => { v.origin.modelRevision = -0; }, v => { v.origin.instructionSha256 = 'A'.repeat(64); },
      v => { v.origin.maximumEstimatedCostNanos = 123; }, v => { v.origin.document.sectionId = 'section-01'; },
      v => { v.origin.document.end = 65537; }, v => { v.origin.document.revision = 201; }, v => { v.origin.document.start = -0; }];
    for (const change of changes) {
      const raw = envelope(); change(raw); let calls = 0;
      await assert.rejects(create(async () => { calls++; return raw; }).read('s', 'run_1'), badType); assert.equal(calls, 1);
    }
    for (const state of ['queued', 'running', 'succeeded', 'failed', 'unknown']) {
      const value = envelope(); Object.assign(value.run, { status: state, budgetStatus: state === 'succeeded' ? 'settled' : state === 'failed' ? 'released' : 'reserved',
        output: state === 'succeeded' ? 'a'.repeat(64000) : null, failureCode: ['failed', 'unknown'].includes(state) ? 'SOURCE_CHANGED' : null,
        estimatedCostNanos: state === 'failed' ? '0' : '12' });
      assert.equal((await create(async () => value).read('s', 'run_1')).run.status, state);
      if (state !== 'succeeded') { value.run.output = 'PRIVATE'; await assert.rejects(create(async () => value).read('s', 'run_1'), badType); }
    }
  });
  test(`${mode}: response nested accessor/symbol/hidden/prototype traps rejected without private messages`, async () => {
    for (const place of ['root', 'run', 'origin', 'document']) {
      const value = envelope(), target = place === 'root' ? value : place === 'document' ? value.origin.document : value[place];
      const key = place === 'root' ? 'run' : place === 'run' ? 'output' : place === 'origin' ? 'agentId' : 'start', mark = { called: false };
      accessor(target, key, mark); await assert.rejects(create(async () => value).read('s', 'run_1'), badType); assert.equal(mark.called, false);
      for (const mutate of [v => Object.defineProperty(v, 'hidden', { value: true }), v => { v[Symbol('hidden')] = true; }, v => Object.setPrototypeOf(v, { private: true })]) {
        const raw = envelope(), object = place === 'root' ? raw : place === 'document' ? raw.origin.document : raw[place];
        mutate(object); await assert.rejects(create(async () => raw).read('s', 'run_1'), badType);
      }
    }
    await assert.rejects(create(async () => new Proxy(envelope(), { ownKeys() { throw Error('PRIVATE trap'); } })).read('s', 'run_1'), badType);
  });
  test(`${mode}: preview binds selector/Agent and fixed tuple; submit binds the entire canonical ref`, async () => {
    for (const change of [v => { v.origin.document.revision++; }, v => { v.origin.document.bodySha256 = 'e'.repeat(64); },
      v => { v.origin.document.sectionId = 'section-1'; }, v => { v.origin.agentRevision++; }, v => { v.origin.agentId = documentId; },
      v => { v.origin.instructionSha256 = sha('different raw instruction'); },
      v => { v.inputFields.reverse(); }, v => { v.inputFields.push('extra'); }, v => { v.modelExecutionConfigured = 'true'; }]) {
      const raw = preview(); change(raw); await assert.rejects(create(async () => raw).preview('s', previewBody()), badType);
    }
    for (const where of ['tuple', 'index']) {
      const value = preview(), mark = { called: false };
      if (where === 'tuple') value.inputFields.extra = true; else accessor(value.inputFields, '0', mark);
      await assert.rejects(create(async () => value).preview('s', previewBody()), badType); assert.equal(mark.called, false);
    }
    for (const change of [v => { v.origin.maximumEstimatedCostNanos = '124'; }, v => { v.origin.inputSha256 = 'e'.repeat(64); },
      v => { v.origin.instructionSha256 = 'e'.repeat(64); }, v => { v.origin.document.sectionSha256 = 'e'.repeat(64); },
      v => { v.origin.agentVersionId = 'new_version'; }, v => { v.origin.catalogVersion++; }, v => { v.origin.modelRevision++; }]) {
      const raw = envelope(); change(raw); await assert.rejects(create(async () => raw).submit('s', submitBody()), badType);
    }
  });
  test(`${mode}: recovery observes original metadata only, preserves unknown/reserved and content/source availability independently`, async () => {
    for (const documentCurrent of [true, false]) for (const contentAvailable of [true, false]) {
      const raw = recovery(); raw.documentCurrent = documentCurrent; raw.request.contentAvailable = contentAvailable; let calls = 0;
      const result = await create(async () => { calls++; return raw; }).recover('s', 'request_123');
      assert.deepEqual(result, raw); assert.equal(calls, 1); assert.equal(result.request.budgetStatus, 'reserved');
    }
    for (const change of [v => { v.request.output = 'PRIVATE'; }, v => { v.request.input = 'PRIVATE'; }, v => { v.documentCurrent = 1; },
      v => { v.request.contentAvailable = 'false'; }, v => { v.request.budgetStatus = 'released'; }]) {
      const raw = recovery(); change(raw); await assert.rejects(create(async () => raw).recover('s', 'request_123'), badType);
    }
  });
  test(`${mode}: HTTP status and abort errors retain exact original identity on every operation without retry`, async () => {
    for (const error of [...[400, 401, 403, 404, 409, 410, 503].map(status => Object.assign(new Error('Original safe transport failure'), { status })), new DOMException('Aborted', 'AbortError')]) {
      let calls = 0; const client = create(async () => { calls++; throw error; });
      for (const operation of [() => client.preview('s', previewBody()), () => client.submit('s', submitBody()), () => client.read('s', 'run_1'), () => client.recover('s', 'request_123')]) {
        const before = calls; await assert.rejects(operation(), e => e === error); assert.equal(calls, before + 1);
      }
    }
    const signal = AbortSignal.abort(); let seen;
    await create(async (_path, options) => { seen = options.signal; return envelope(); }).read('s', 'run_1', signal);
    assert.equal(seen, signal);
  });
  test(`${mode}: preview checks the raw UTF8 instruction digest and fails safely when WebCrypto is unavailable`, async () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto'); let calls = 0;
    try {
      Object.defineProperty(globalThis, 'crypto', { configurable: true, value: undefined });
      await assert.rejects(create(async () => { calls++; return preview(); }).preview('s', previewBody()), badType);
      assert.equal(calls, 1);
    } finally { Object.defineProperty(globalThis, 'crypto', descriptor); }
  });
  test(`${mode}: plain null-prototype input/result and raw instruction snapshot stay detached across transport await`, async () => {
    const input = submitBody(), raw = envelope();
    for (const value of [input, input.origin, input.origin.document, raw, raw.run, raw.origin, raw.origin.document]) Object.setPrototypeOf(value, null);
    let finish, body; const client = create((_path, options) => { body = JSON.parse(options.body); return new Promise(resolve => { finish = resolve; }); });
    const pending = client.submit('s', input); input.instruction = 'changed'; input.origin.modelCode = 'changed';
    assert.equal(body.instruction, instruction); assert.equal(body.origin.modelCode, 'text-model');
    finish(raw); const result = await pending; raw.origin.document.end = 99; assert.equal(result.origin.document.end, 12);
  });
}

test('actual new SDK source signatures compile with NodeNext and readonly wire types without changing public barrel', () => {
  const consumer = join(artifacts, 'types-consumer.mts');
  writeFileSync(consumer, `import { createPersonalDocumentGenerationClient } from '../../packages/sdk/src/personal-document-generation.js';
import type { DocumentGenerationPreviewBody, DocumentGenerationSubmitBody, DocumentGenerationRef, DocumentGenerationPreview, DocumentGenerationRunEnvelope, DocumentGenerationRecovery } from '../../packages/sdk/src/personal-document-generation.js';
import type { ClientApi } from '../../packages/sdk/src/index.js';
declare const api: ClientApi; declare const body: DocumentGenerationPreviewBody; declare const submission: DocumentGenerationSubmitBody; declare const ref: DocumentGenerationRef;
const client = createPersonalDocumentGenerationClient(api); const signal = new AbortController().signal;
const p: Promise<DocumentGenerationPreview> = client.preview('s', body, signal);
const s: Promise<DocumentGenerationRunEnvelope> = client.submit('s', submission, signal);
const r: Promise<DocumentGenerationRunEnvelope> = client.read('s', 'run', signal);
const k: Promise<DocumentGenerationRecovery> = client.recover('s', 'request_123', signal);
// @ts-expect-error immutable reference
ref.document.start = 1;
// @ts-expect-error exact typed body
client.preview('s', { ...body, workspaceId: 'spoof' });
// @ts-expect-error signal must be an AbortSignal
client.read('s', 'run', {});
void p; void s; void r; void k;
`);
  const program = ts.createProgram([consumer], { noEmit: true, strict: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, types: [], lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'] });
  const diagnostics = ts.getPreEmitDiagnostics(program); assert.equal(diagnostics.length, 0, formatDiagnostics(diagnostics));
});
