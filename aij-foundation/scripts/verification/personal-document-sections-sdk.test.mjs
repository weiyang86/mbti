// AF224 candidate only: frozen-wire synthetic ports and loopback HTTP, never actual AF223/auth/PG acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { createServer } from 'node:http';
import ts from 'typescript';

const root = fileURLToPath(new URL('../../', import.meta.url));
const source = join(root, 'packages/sdk/src/personal-document-sections.ts');
const artifacts = join(root, '.artifacts/AF-224');
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
    const file = join(artifacts, `personal-document-sections.${name.endsWith('.d.ts') ? `d.${ext === 'mjs' ? 'mts' : 'cts'}` : ext}`);
    writeFileSync(file, data);
  });
  assert.equal(result.emitSkipped, false);
  assert.equal(result.diagnostics.length, 0, formatDiagnostics(result.diagnostics));
}
const esm = await import(pathToFileURL(join(artifacts, 'personal-document-sections.mjs')).href);
const require = createRequire(import.meta.url);
const cjs = require(join(artifacts, 'personal-document-sections.cjs'));
const documentId = '12345678-1234-4234-8234-123456789abc';
const otherId = '22345678-1234-4234-8234-123456789abc';
const sha = value => createHash('sha256').update(value, 'utf8').digest('hex');
function doc(body = '正文\r\n# One\r\n😀\r\n## Two\r\n尾\r\n') {
  return { id: documentId, code: 'sample-document', name: '文档', revision: 7,
    createdAt: '2026-11-08T00:00:00.000Z', updatedAt: '2026-11-08T00:00:00.000Z', body };
}
// Hand-authored boundaries from frozen wire, deliberately independent of AF223 parser implementation.
function wire(document = doc(), cuts = [0, document.body.indexOf('# One'), document.body.indexOf('## Two')], titles = ['正文', 'One', 'Two'], levels = [0, 1, 2]) {
  return { format: 'aij-plain-sections-v1', documentId: document.id, revision: document.revision,
    bodySha256: sha(document.body), bodyLength: document.body.length, bodyByteLength: Buffer.byteLength(document.body),
    sections: cuts.map((start, index) => ({ id: `section-${index}`, index, title: titles[index], level: levels[index], start, end: cuts[index + 1] ?? document.body.length })) };
}
const one = document => wire(document, [0], ['正文'], [0]);
const clone = value => structuredClone(value);
function input(document = doc(), index = wire(document), replacement = '# Changed\r\n新😀\r\n', sectionId = 'section-1') {
  return { document, index, replacement, sectionId };
}
const badType = e => e instanceof TypeError && !Object.hasOwn(e, 'status') && !e.message.includes('PRIVATE');
function accessor(value, key, flag) {
  const result = clone(value);
  Object.defineProperty(result, key, { enumerable: true, get() { flag.called = true; throw new Error('PRIVATE getter'); } });
  return result;
}

for (const [mode, sdk] of [['ESM', esm], ['CJS', cjs]]) {
  const { createPersonalDocumentSectionsClient: client, composePersonalDocumentSectionDraft: compose } = sdk;
  test(`${mode}: standalone compiled module has no runtime imports and public factories exist`, () => {
    const emitted = readFileSync(join(artifacts, `personal-document-sections.${mode === 'ESM' ? 'mjs' : 'cjs'}`), 'utf8');
    assert.doesNotMatch(emitted, /(?:require\(|\bfrom\s+["']|\bimport\s*\()/);
    assert.deepEqual(Object.keys(sdk).sort(), ['composePersonalDocumentSectionDraft', 'createPersonalDocumentSectionsClient']);
  });
  test(`${mode}: one explicit scoped GET, canonical revision/UUID, signal and immutable detached result`, async () => {
    const raw = wire(); const controller = new AbortController(); const calls = [];
    const api = client(async (path, options) => { calls.push({ path, options }); return raw; });
    const result = await api.get('workspace_1', documentId.toUpperCase(), 7, controller.signal);
    assert.deepEqual(calls, [{ path: `/client/documents/${documentId}/sections?expectedRevision=7`, options: {
      workspaceId: 'workspace_1', method: 'GET', signal: controller.signal, cache: 'no-store'
    } }]);
    assert.deepEqual(result, raw); assert.ok(Object.isFrozen(api) && Object.isFrozen(result));
    assert.ok(Object.isFrozen(result.sections) && result.sections.every(Object.isFrozen));
    raw.sections[0].title = 'changed'; assert.equal(result.sections[0].title, '正文');
    assert.throws(() => { result.sections[0].start = 99; }, TypeError);
  });
  test(`${mode}: URL/header coercion and noncanonical input denied before transport`, async () => {
    let calls = 0; const api = client(async () => { calls++; return wire(); });
    for (const scope of ['', '../x', 'x?owner=other', 'x\r\ny', 'x'.repeat(129), {}, ['workspace']]) await assert.rejects(api.get(scope, documentId, 7), badType);
    for (const id of ['../x', `${documentId}?x=1`, new URL('https://example.test'), {}, `${documentId}/sections`]) await assert.rejects(api.get('space', id, 7), badType);
    for (const revision of [0, -0, 201, 7.1, NaN, Infinity, '7', '07', ['7'], { valueOf() { throw Error('PRIVATE'); } }]) await assert.rejects(api.get('space', documentId, revision), badType);
    await assert.rejects(api.get('space', documentId, 7, {}), badType);
    assert.equal(calls, 0); assert.throws(() => client({}), badType);
    for (const revision of [1, 200]) assert.equal((await client(async () => ({ ...wire(), revision })).get('s', documentId, revision)).revision, revision);
  });
  test(`${mode}: malformed successes stay TypeError; HTTP/abort rejection identity preserved without retry`, async () => {
    const malformed = [null, [], { ...wire(), documentId: otherId }, { ...wire(), revision: 8 }, { ...wire(), body: 'PRIVATE' }];
    for (const raw of malformed) {
      let calls = 0; await assert.rejects(client(async () => { calls++; return raw; }).get('s', documentId, 7), badType); assert.equal(calls, 1);
    }
    for (const error of [Object.assign(new Error('HTTP'), { status: 401 }), Object.assign(new Error('HTTP'), { status: 403 }), Object.assign(new Error('HTTP'), { status: 404 }), Object.assign(new Error('HTTP'), { status: 409 }), new DOMException('Aborted', 'AbortError')]) {
      let calls = 0; await assert.rejects(client(async () => { calls++; throw error; }).get('s', documentId, 7), e => e === error); assert.equal(calls, 1);
    }
  });
  test(`${mode}: strict wire shape, ranges, hash, size, titles, dense arrays and descriptor rejection`, async () => {
    const mutators = [
      v => { delete v.revision; }, v => { v[Symbol('hidden')] = true; }, v => { v.format = 'other'; },
      v => { v.bodySha256 = 'A'.repeat(64); }, v => { v.bodySha256 = '0'.repeat(63); },
      v => { v.bodyLength++; }, v => { v.bodyByteLength = 65537; }, v => { v.bodyByteLength = v.bodyLength - 1; },
      v => { v.bodyLength = -0; }, v => { v.sections = []; }, v => { v.sections = Array(129).fill(v.sections[0]); },
      v => { v.sections[1].start++; }, v => { v.sections[1].start--; }, v => { v.sections[2].end--; },
      v => { v.sections[0].start = 1; }, v => { v.sections[1].end = v.sections[1].start; },
      v => { v.sections[1].id = 'section-01'; }, v => { v.sections[1].index = 0; }, v => { v.sections[1].level = 7; },
      v => { v.sections[1].level = 0; }, v => { v.sections[0].title = 'other'; }, v => { v.sections[1].title = ''; },
      v => { v.sections[1].title = ' a'; }, v => { v.sections[1].title = 'a\t'; }, v => { v.sections[1].title = '😀'.repeat(257); },
      v => { v.sections[1].title = 'PRIVATE\n'; }, v => { v.sections[1].title = '\ud800'; },
      v => { v.sections[1].extra = true; }, v => { v.sections.extra = true; }, v => { delete v.sections[1]; },
      v => { Object.setPrototypeOf(v, { inherited: true }); }, v => { Object.setPrototypeOf(v.sections, {}); },
      v => { Object.setPrototypeOf(v.sections[0], { title: 'PRIVATE' }); },
      v => { Object.defineProperty(v, 'revision', { value: 7, enumerable: false }); }
    ];
    for (const mutate of mutators) { const v = wire(); mutate(v); await assert.rejects(client(async () => v).get('s', documentId, 7), badType); }
    for (const position of ['root', 'section', 'array']) {
      const flag = { called: false }; let v = wire();
      if (position === 'root') v = accessor(v, 'bodyLength', flag);
      if (position === 'section') v.sections[0] = accessor(v.sections[0], 'title', flag);
      if (position === 'array') Object.defineProperty(v.sections, '0', { enumerable: true, get() { flag.called = true; throw Error('PRIVATE'); } });
      await assert.rejects(client(async () => v).get('s', documentId, 7), badType); assert.equal(flag.called, false);
    }
    const good = wire(); good.sections[1].title = '😀'.repeat(256);
    assert.equal((await client(async () => good).get('s', documentId, 7)).sections[1].title, good.sections[1].title);
    const empty = doc(''); const invalidEmpty = one(empty); invalidEmpty.sections[0].level = 1;
    await assert.rejects(client(async () => invalidEmpty).get('s', documentId, 7), badType);
  });
  test(`${mode}: null-prototype plain records allowed; hostile descriptor traps fail without private messages`, async () => {
    const index = wire(); Object.setPrototypeOf(index, null); Object.setPrototypeOf(index.sections[0], null);
    assert.equal((await client(async () => index).get('s', documentId, 7)).bodySha256, sha(doc().body));
    const hostile = new Proxy(wire(), { getPrototypeOf() { throw new Error('PRIVATE trap'); } });
    await assert.rejects(client(async () => hostile).get('s', documentId, 7), badType);
    const value = input(); value.document = new Proxy(value.document, { ownKeys() { throw Error('PRIVATE trap'); } });
    await assert.rejects(compose(value), badType);
    const symbolic = wire(); symbolic.sections[Symbol('PRIVATE')] = true;
    await assert.rejects(client(async () => symbolic).get('s', documentId, 7), badType);
  });
  test(`${mode}: helper performs no HTTP and refuses unavailable WebCrypto without fallback`, async () => {
    const fetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
    const cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto'); let calls = 0;
    try {
      Object.defineProperty(globalThis, 'fetch', { configurable: true, value() { calls++; throw Error('Unexpected HTTP'); } });
      assert.equal((await compose(input())).changed, true); assert.equal(calls, 0);
      Object.defineProperty(globalThis, 'crypto', { configurable: true, value: undefined });
      await assert.rejects(compose(input()), badType); assert.equal(calls, 0);
    } finally {
      Object.defineProperty(globalThis, 'fetch', fetchDescriptor);
      Object.defineProperty(globalThis, 'crypto', cryptoDescriptor);
    }
  });
  test(`${mode}: exact full-block replacement preserves prefix/suffix UTF8, frozen output, input unchanged`, async () => {
    const value = input(); const before = clone(value); const selected = value.index.sections[1];
    const result = await compose(value);
    assert.deepEqual(value, before); assert.ok(Object.isFrozen(result));
    assert.deepEqual(Object.keys(result).sort(), ['body', 'changed', 'documentId', 'expectedRevision', 'sectionId', 'sourceSha256']);
    assert.deepEqual(result, { documentId, expectedRevision: 7, sourceSha256: sha(value.document.body), sectionId: 'section-1',
      body: value.document.body.slice(0, selected.start) + value.replacement + value.document.body.slice(selected.end), changed: true });
    assert.deepEqual(Buffer.from(result.body.slice(0, selected.start)), Buffer.from(value.document.body.slice(0, selected.start)));
    assert.deepEqual(Buffer.from(result.body.slice(selected.start + value.replacement.length)), Buffer.from(value.document.body.slice(selected.end)));
  });
  test(`${mode}: LF/CRLF/CR, BOM, literal replacement character, emoji, combining marks and fences remain exact`, async () => {
    for (const ending of ['\n', '\r\n', '\r']) {
      const a = `\ufeffpreface e\u0301 �😀${ending}`;
      const b = `# First${ending}\`\`\`${ending}# not a heading${ending}\`\`\`${ending}`;
      const c = `## Last${ending}尾😀`;
      const document = doc(a + b + c), index = wire(document, [0, a.length, a.length + b.length]);
      const result = await compose(input(document, index, `# Whole block${ending}新�😀${ending}`));
      assert.equal(result.body, a + `# Whole block${ending}新�😀${ending}` + c);
      assert.equal((await compose(input(document, index, b))).changed, false);
    }
  });
  test(`${mode}: empty document/empty replacement/noop/last block and all 128 sections`, async () => {
    for (const body of ['', 'plain 😀', '# One\n']) {
      const document = doc(body); const result = await compose(input(document, one(document), body, 'section-0'));
      assert.equal(result.changed, false); assert.equal(result.body, body);
      assert.equal((await compose(input(document, one(document), '', 'section-0'))).body, '');
    }
    const value = input(); const s = value.index.sections[1];
    assert.equal((await compose({ ...value, replacement: '' })).body, value.document.body.slice(0, s.start) + value.document.body.slice(s.end));
    assert.ok((await compose({ ...value, sectionId: 'section-2', replacement: 'last without newline' })).body.endsWith('last without newline'));
    const blocks = Array.from({ length: 128 }, (_, i) => `# H${i}\n`); let offset = 0;
    const cuts = blocks.map(b => { const start = offset; offset += b.length; return start; });
    const document = doc(blocks.join('')), index = wire(document, cuts, blocks.map((_, i) => `H${i}`), blocks.map(() => 1));
    assert.equal((await compose(input(document, index, blocks[127], 'section-127'))).changed, false);
  });
  test(`${mode}: rejects wrong scope/revision/hash/length and forged boundaries`, async () => {
    const values = [
      v => { v.document.id = otherId; }, v => { v.document.revision++; }, v => { v.index.bodySha256 = '0'.repeat(64); },
      v => { v.index.bodyByteLength++; }, v => { v.index.bodyLength++; }, v => { v.sectionId = 'section-99'; },
      v => { v.sectionId = 'section-01'; }, v => { v.replacement = 'no trailing newline'; },
      v => { v.index.sections[0].end--; v.index.sections[1].start--; }, // middle of CRLF
      v => { v.index.sections[1].start++; v.index.sections[0].end++; } // middle of heading
    ];
    for (const change of values) { const value = input(); change(value); await assert.rejects(compose(value), badType); }
    const document = doc('😀\n# Next\n'); const index = wire(document, [0, 1], ['正文', 'Next'], [0, 1]);
    await assert.rejects(compose(input(document, index, '\n')), badType); // splits a surrogate pair
    for (const replacement of ['\ud800\n', '\udc00\n', '\ud800a\n', '\u0000\n', '\u007f\n', '\u0085\n']) await assert.rejects(compose({ ...input(), replacement }), badType);
  });
  test(`${mode}: exact 65536-byte limit and overflow by multibyte/composed total`, async () => {
    for (const body of ['a'.repeat(65536), '😀'.repeat(16384), '中'.repeat(21845) + 'x']) {
      const document = doc(body); assert.equal((await compose(input(document, one(document), body, 'section-0'))).changed, false);
      await assert.rejects(compose(input(document, one(document), body + 'x', 'section-0')), badType);
    }
    const document = doc('a'.repeat(65534) + '\nX'), index = wire(document, [0, 65535], ['正文', 'X'], [0, 1]);
    await assert.rejects(compose(input(document, index, 'YY', 'section-1')), badType);
    const oversized = doc('a'.repeat(65537)); await assert.rejects(compose(input(oversized, one(oversized), '', 'section-0')), badType);
  });
  test(`${mode}: helper rejects extras/prototypes/getters in every input owner, no caller mutation across await`, async () => {
    for (const target of ['input', 'document', 'index', 'section']) {
      const value = input(); const owner = target === 'input' ? value : target === 'section' ? value.index.sections[0] : value[target];
      owner.extra = 'PRIVATE'; await assert.rejects(compose(value), badType);
      delete owner.extra; Object.setPrototypeOf(owner, { inherited: true }); await assert.rejects(compose(value), badType);
    }
    for (const [target, key] of [['input', 'replacement'], ['document', 'body'], ['index', 'sections'], ['section', 'start']]) {
      let value = input(); const flag = { called: false };
      if (target === 'input') value = accessor(value, key, flag);
      else if (target === 'section') value.index.sections[0] = accessor(value.index.sections[0], key, flag);
      else value[target] = accessor(value[target], key, flag);
      await assert.rejects(compose(value), badType); assert.equal(flag.called, false);
    }
    const value = input(), original = clone(value); const pending = compose(value);
    value.document.body = 'caller changed'; value.index.sections[1].start = 0; value.replacement = 'changed'; value.sectionId = 'section-0';
    const result = await pending; const s = original.index.sections[1];
    assert.equal(result.body, original.document.body.slice(0, s.start) + original.replacement + original.document.body.slice(s.end));
    assert.equal(result.sectionId, 'section-1');
  });
}

test('loopback synthetic transport uses exact read and propagates refusal; it is NOT the AF223 API', async () => {
  const requests = []; const index = wire(); let status = 200;
  const server = createServer((req, res) => {
    requests.push({ path: req.url, method: req.method, workspace: req.headers['x-aij-workspace-id'] });
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'private, no-store' });
    res.end(JSON.stringify(status === 200 ? index : { rejected: true }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    // Explicit synthetic ClientApi collaborator; does not substitute for root public-entry tests.
    const api = async (path, options) => {
      const response = await fetch(base + path, { method: options.method, signal: options.signal, cache: options.cache,
        headers: { 'x-aij-workspace-id': options.workspaceId } });
      if (!response.ok) throw Object.assign(new Error('Synthetic HTTP refusal'), { status: response.status });
      return response.json();
    };
    const client = esm.createPersonalDocumentSectionsClient(api);
    assert.deepEqual(await client.get('s', documentId, 7), index);
    for (const refusal of [401, 403, 404, 409]) { status = refusal; await assert.rejects(client.get('s', documentId, 7), e => e.status === refusal); }
    assert.equal(requests.length, 5); assert.ok(requests.every(r => r.method === 'GET' && r.path === `/client/documents/${documentId}/sections?expectedRevision=7` && r.workspace === 's'));
  } finally { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});

test('actual public type signatures compile without editing public index', () => {
  const consumer = join(artifacts, 'types-consumer.mts');
  const relativeSource = '../../packages/sdk/src/personal-document-sections.js';
  writeFileSync(consumer, `import { createPersonalDocumentSectionsClient, composePersonalDocumentSectionDraft } from '${relativeSource}';
import type { PersonalDocumentSection, PersonalDocumentSectionIndex, PersonalDocumentSectionDraft, ComposePersonalDocumentSectionDraftInput } from '${relativeSource}';
import type { ClientApi } from '../../packages/sdk/src/index.js';
declare const api: ClientApi; declare const input: ComposePersonalDocumentSectionDraftInput;
const index: Promise<PersonalDocumentSectionIndex> = createPersonalDocumentSectionsClient(api).get('s', input.document.id, 1);
const draft: Promise<PersonalDocumentSectionDraft> = composePersonalDocumentSectionDraft(input);
const section: PersonalDocumentSection = input.index.sections[0];
// @ts-expect-error readonly section
section.start = 2;
// @ts-expect-error numeric canonical revision only
createPersonalDocumentSectionsClient(api).get('s', input.document.id, '1');
void index; void draft;
`);
  const program = ts.createProgram([consumer], { noEmit: true, strict: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, types: [], lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'] });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.equal(diagnostics.length, 0, formatDiagnostics(diagnostics));
});
