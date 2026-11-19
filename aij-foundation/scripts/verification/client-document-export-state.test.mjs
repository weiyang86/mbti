import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocumentExportStore } from '../../apps/web/app/components/client-document-export-state.mjs';

const scope = { workspaceId: 'workspace-a', memberId: 'member-a', sessionKey: 'session-a', roleId: 'role-a', validationKey: 'validation-a', permissions: ['workspace.documents.read', 'workspace.documents.export'] };
const doc = { id: 'doc-a', revision: 1, name: 'private name' };
const meta = (format = 'pdf', extra = {}) => ({ id: `export-${format}`, documentId: doc.id, revision: doc.revision, format, mimeType: format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: 3, checksum: 'a'.repeat(64), rendererVersion: 'aij-plain-document-v1', pageCount: format === 'docx' ? null : 1, createdAt: '2026-11-07T00:00:00.000Z', ...extra });
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const flush = () => new Promise(resolve => setImmediate(resolve));
function fixture(overrides = {}, context = {}) {
  const calls = [], urls = [], revoked = [], downloads = [], failures = [];
  const api = {
    async capability() { calls.push('capability'); return { configured: true, canExport: true, reason: 'ready' }; },
    async create(w, input, options) { calls.push(['create', w, input, options]); return meta(input.format); },
    async list(w, input, options) { calls.push(['list', w, input, options]); return { items: [meta()] }; },
    async get() { return meta(); },
    async download(w, expected, options) { calls.push(['download', w, expected, options]); return { bytes: new Uint8Array([1, 2, 3]), filename: `document.${expected.format}`, mimeType: expected.mimeType, checksum: expected.checksum }; },
    ...overrides
  };
  const host = { createObjectURL(bytes, type) { urls.push([Array.from(bytes), type]); return `blob:test-${urls.length}`; }, revokeObjectURL(url) { revoked.push(url); }, download(url, name) { downloads.push([url, name]); } };
  const store = createDocumentExportStore(api, host, e => failures.push(e));
  store.setContext({ scope, document: doc, hasUnsavedChanges: false, ...context });
  return { store, api, host, calls, urls, revoked, downloads, failures };
}

test('explicit success uses saved revision and requires separate download; no IO on setContext', async () => {
  const f = fixture(); assert.deepEqual(f.calls, []);
  assert.equal(f.store.canCreate(), false);
  await f.store.capability(); await f.store.create('docx');
  assert.deepEqual(f.calls[1].slice(0, 3), ['create', scope.workspaceId, { documentId: doc.id, expectedRevision: 1, format: 'docx' }]);
  assert.equal(f.store.getSnapshot().items[0].format, 'docx'); assert.equal(f.store.getSnapshot().unknown, false);
  assert.deepEqual(f.downloads, []); f.store.clear();
});

test('saved-only and independent read+export permission gate every explicit action', async () => {
  for (const context of [{ document: null }, { hasUnsavedChanges: true }, { scope: null }, { scope: { ...scope, permissions: ['workspace.documents.read', 'workspace.documents.manage'] } }, { scope: { ...scope, permissions: ['workspace.documents.export'] } }]) {
    const f = fixture({}, context); await f.store.capability(); await f.store.create('pdf'); await f.store.list(); await f.store.download('export-pdf');
    assert.equal(f.calls.some(c => Array.isArray(c)), false); assert.equal(f.store.canCreate(), false); f.store.clear();
  }
});

test('configuration absent disables generation while allowing existing exports', async () => {
  const f = fixture({ async capability() { return { configured: false, canExport: false, reason: 'not_configured' }; } });
  await f.store.capability(); await f.store.create('pdf'); assert.equal(f.store.getSnapshot().capability.reason, 'not_configured');
  assert.equal(f.store.canCreate(), false); assert.equal(f.store.canRead(), true); await f.store.list(); assert.equal(f.store.getSnapshot().items.length, 1); await f.store.download('export-pdf'); assert.equal(f.downloads.length, 1); assert.equal(f.calls.some(c => c[0] === 'create'), false); f.store.clear();
});

test('capability denial and inconsistent capability fail closed', async () => {
  for (const cap of [
    { configured: true, canExport: false, reason: 'not_permitted' },
    { configured: false, canExport: false, reason: 'not_permitted' },
    { configured: false, canExport: true, reason: 'not_configured' },
    { configured: true, canExport: false, reason: 'not_configured' },
    { configured: true, canExport: true, reason: 'not_configured' },
    { configured: false, canExport: true, reason: 'ready' },
    { configured: true, canExport: false, reason: 'ready' },
    { configured: true, canExport: true, reason: 'not_permitted' }, {}
  ]) {
    const f = fixture({ async capability() { return cap; } });
    await f.store.capability(); await f.store.create('pdf'); await f.store.list(); await f.store.download('export-pdf');
    assert.equal(f.store.canCreate(), false); assert.equal(f.store.canRead(), false);
    assert.deepEqual(f.downloads, []); assert.equal(f.calls.some(c => Array.isArray(c)), false); f.store.clear();
  }
});

test('synchronous busy lock prevents concurrent Word/PDF/list/download requests', async () => {
  const d = deferred(); let n = 0;
  const f = fixture({ create() { n++; return d.promise; } }); await f.store.capability();
  const a = f.store.create('pdf'); const b = f.store.create('docx'); const c = f.store.list();
  assert.equal(f.store.getSnapshot().busy, true); await flush(); assert.equal(n, 1);
  d.resolve(meta()); await Promise.all([a, b, c]); assert.equal(f.store.getSnapshot().busy, false); f.store.clear();
});

test('network/5xx/malformed success lock POST until successful current list AND explicit acknowledgement', async () => {
  for (const result of ['network', 503, 'bad-success']) {
    let creates = 0;
    const f = fixture({ async create() { creates++; if (result === 'bad-success') return meta('pdf', { revision: 2 }); throw result === 'network' ? new Error('private transport error') : { status: result }; } });
    await f.store.capability(); await f.store.create('pdf');
    assert.equal(f.store.getSnapshot().unknown, true); await f.store.acknowledge(); await f.store.create('docx'); assert.equal(creates, 1);
    await f.store.list(); assert.equal(f.store.getSnapshot().checked, true); assert.equal(f.store.canCreate(), false);
    await f.store.acknowledge(); assert.equal(f.store.canCreate(), true); assert.equal(f.store.getSnapshot().issue, ''); f.store.clear();
  }
});

test('failed/malformed reconciliation never unlocks, including duplicate formats and wrong revision', async () => {
  for (const items of [[meta('pdf', { revision: 2 })], [meta(), meta()], [meta('pdf', { checksum: 'bad' })]]) {
    const f = fixture({ async create() { throw { status: 503 }; }, async list() { return { items }; } });
    await f.store.capability(); await f.store.create('pdf'); await f.store.list(); await f.store.acknowledge();
    assert.equal(f.store.getSnapshot().unknown, true); assert.equal(f.store.getSnapshot().checked, false); f.store.clear();
  }
});

test('attempted400/409 preserve original unknown lock until original-version read and fresh explicit ACK', async () => {
  for (const code of [400, 409]) {
    const f = fixture({ async create() { throw { status: code }; } }); await f.store.capability(); await f.store.create('pdf');
    assert.equal(f.store.getSnapshot().unknown, true); assert.equal(f.store.getSnapshot().conflict, code === 409);
    f.store.setContext({ scope, document: { ...doc, revision: 2 }, hasUnsavedChanges: false }); await f.store.capability();
    assert.equal(f.store.canCreate(), false); await f.store.list();
    assert.equal(f.calls.find(c => Array.isArray(c) && c[0] === 'list')[2].revision, 1);
    await f.store.acknowledge(); assert.equal(f.store.canCreate(), true); assert.equal(doc.revision, 1); f.store.clear();
  }
});

 test('another member/workspace/document cannot acknowledge the original unknown generation', async () => {
  for (const change of [{ scope: { ...scope, memberId: 'other' } }, { scope: { ...scope, workspaceId: 'other' } }, { document: { ...doc, id: 'other' } }]) {
    const f = fixture({ async create() { throw { status: 503 }; }, async list(w, input) { return { items: [meta('pdf', { documentId: input.documentId, revision: input.revision })] }; } });
    await f.store.capability(); await f.store.create('pdf');
    f.store.setContext({ scope, document: doc, hasUnsavedChanges: false, ...change }); await f.store.capability(); await f.store.list();
    assert.equal(f.store.getSnapshot().checked, false); await f.store.acknowledge(); assert.equal(f.store.getSnapshot().unknown, true);
    f.store.setContext({ scope, document: doc, hasUnsavedChanges: false }); await f.store.capability(); await f.store.list(); await f.store.acknowledge(); assert.equal(f.store.getSnapshot().unknown, false); f.store.clear();
  }
});

test('explicit acknowledgement performs a fresh authorized read and keeps lock after late denial', async () => {
  const f = fixture({ async create() { throw { status: 503 }; } }); await f.store.capability(); await f.store.create('pdf'); await f.store.list();
  f.api.list = async () => { throw { status: 403 }; }; await f.store.acknowledge();
  assert.equal(f.store.getSnapshot().unknown, true); assert.equal(f.store.getSnapshot().checked, false); assert.equal(f.store.getSnapshot().items.length, 0); f.store.clear();
});

test('401/403/404 clear panel and invoke parent access failure once', async () => {
  for (const action of ['create', 'list', 'download']) for (const code of [401, 403, 404]) {
    const f = fixture({ [action]: async () => { throw { status: code }; } }); await f.store.capability();
    if (action === 'download') { await f.store.list(); await f.store.download('export-pdf'); } else await f.store[action]('pdf');
    assert.equal(f.failures.length, 1); assert.deepEqual(f.store.getSnapshot().items, []); assert.equal(f.store.getSnapshot().capability, null); assert.equal(f.store.canRead(), false); f.store.clear();
  }
});

test('late POST after workspace/role/session/permission/document/revision changes is discarded and remains unknown', async () => {
  for (const change of [{ scope: { ...scope, workspaceId: 'b' } }, { scope: { ...scope, roleId: 'b' } }, { scope: { ...scope, sessionKey: 'b' } }, { scope: { ...scope, validationKey: 'b' } }, { scope: { ...scope, permissions: ['workspace.documents.read'] } }, { document: { ...doc, id: 'doc-b' } }, { document: { ...doc, revision: 2 } }, { hasUnsavedChanges: true }]) {
    const d = deferred(); let signal;
    const f = fixture({ create(w, input, options) { signal = options.signal; return d.promise; } }); await f.store.capability(); const p = f.store.create('pdf'); await flush();
    f.store.setContext({ scope, document: doc, hasUnsavedChanges: false, ...change }); assert.equal(signal.aborted, true);
    d.resolve(meta()); await p; assert.deepEqual(f.store.getSnapshot().items, []); assert.equal(f.store.getSnapshot().unknown, true); assert.equal(f.store.getSnapshot().busy, false); f.store.clear();
  }
});

test('blur/hidden/unmount conceal and abort even when API ignores abort; only fresh validation resumes', async () => {
  for (const action of ['conceal', 'clear']) {
    const d = deferred(); const f = fixture({ create: () => d.promise }); await f.store.capability(); const p = f.store.create('pdf'); await flush();
    f.store[action](); await p; assert.equal(f.store.getSnapshot().unknown, true); assert.equal(f.store.getSnapshot().suspended, true);
    if (action === 'conceal') { f.store.setContext({ scope, document: doc, hasUnsavedChanges: false }); assert.equal(f.store.getSnapshot().suspended, true); }
    f.store.setContext({ scope: { ...scope, validationKey: 'fresh' }, document: doc, hasUnsavedChanges: false }); await f.store.capability(); assert.equal(f.store.canCreate(), false);
    d.resolve(meta()); await flush(); assert.deepEqual(f.store.getSnapshot().items, []); await f.store.list(); await f.store.acknowledge(); assert.equal(f.store.canCreate(), true); f.store.clear();
  }
});

test('late capability/list cannot publish into a changed scope', async () => {
  for (const action of ['capability', 'list']) {
    const d = deferred(); const f = fixture(); await f.store.capability(); f.api[action] = () => d.promise;
    const p = f.store[action](); await flush(); f.store.setContext({ scope: { ...scope, memberId: 'other' }, document: doc, hasUnsavedChanges: false });
    d.resolve(action === 'list' ? { items: [meta()] } : { configured: true, canExport: true, reason: 'ready' }); await p;
    assert.equal(f.store.getSnapshot().capability, null); assert.deepEqual(f.store.getSnapshot().items, []); f.store.clear();
  }
});

test('explicit download copies bytes to host, revokes URL and wipes source buffer on success/host failure', async () => {
  for (const failure of [false, true]) {
    const bytes = new Uint8Array([1, 2, 3]); const f = fixture({ async download() { return { bytes, filename: 'document.pdf', mimeType: meta().mimeType, checksum: meta().checksum }; } });
    if (failure) f.host.download = () => { throw new Error('host failed'); };
    await f.store.capability(); await f.store.list(); assert.deepEqual(f.urls, []); await f.store.download('export-pdf');
    assert.deepEqual(f.urls[0], [[1, 2, 3], 'application/pdf']); assert.deepEqual(f.revoked, ['blob:test-1']); assert.deepEqual([...bytes], [0, 0, 0]); f.store.clear(); assert.equal(f.revoked.length, 1);
  }
});

test('late binary after concealment is wiped without ObjectURL or download', async () => {
  const d = deferred(), bytes = new Uint8Array([1, 2, 3]); const f = fixture({ download: () => d.promise }); await f.store.capability(); await f.store.list();
  const p = f.store.download('export-pdf'); await flush(); f.store.conceal(); await p;
  d.resolve({ bytes, filename: 'document.pdf', mimeType: meta().mimeType, checksum: meta().checksum }); await flush();
  assert.deepEqual([...bytes], [0, 0, 0]); assert.deepEqual(f.urls, []); assert.deepEqual(f.downloads, []); f.store.clear();
});

test('bad download identity/filename/length never reaches browser host', async () => {
  for (const extra of [{ filename: '../secret.pdf' }, { filename: 'bad\n.pdf' }, { filename: 'document.docx' }, { mimeType: 'text/html' }, { checksum: 'b'.repeat(64) }, { bytes: new Uint8Array([1]) }]) {
    const f = fixture({ async download() { return { bytes: new Uint8Array([1, 2, 3]), filename: 'document.pdf', mimeType: meta().mimeType, checksum: meta().checksum, ...extra }; } });
    await f.store.capability(); await f.store.list(); await f.store.download('export-pdf'); assert.deepEqual(f.urls, []); assert.deepEqual(f.downloads, []); f.store.clear();
  }
});

test('conceal before dispatch prevents even the first deferred POST from executing', async () => {
  let calls = 0; const f = fixture({ async create() { calls++; return meta(); } }); await f.store.capability();
  const p = f.store.create('pdf'); f.store.conceal(); await p;
  assert.equal(calls, 0); assert.equal(f.store.getSnapshot().unknown, true); f.store.clear();
});

test('120-second mutation deadline aborts and stays unknown with no automatic retry', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const d = deferred(); let signal, count = 0;
  const f = fixture({ create(w, input, options) { signal = options.signal; count++; return d.promise; } }); await f.store.capability();
  const p = f.store.create('pdf'); await flush(); t.mock.timers.tick(120000); await p;
  assert.equal(signal.aborted, true); assert.equal(f.store.getSnapshot().busy, false); assert.equal(f.store.getSnapshot().unknown, true);
  d.resolve(meta()); await flush(); assert.deepEqual(f.store.getSnapshot().items, []); await f.store.create('pdf'); assert.equal(count, 1); f.store.clear();
});

test('30-second read deadline clears busy and wipes late binary even without a scope switch', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const d = deferred(), bytes = new Uint8Array([1, 2, 3]); const f = fixture({ download: () => d.promise }); await f.store.capability(); await f.store.list();
  const p = f.store.download('export-pdf'); await flush(); t.mock.timers.tick(30000); await p;
  assert.equal(f.store.getSnapshot().busy, false); d.resolve({ bytes, filename: 'document.pdf', mimeType: meta().mimeType, checksum: meta().checksum }); await flush();
  assert.deepEqual([...bytes], [0, 0, 0]); assert.deepEqual(f.urls, []); f.store.clear();
});

test('API replacement aborts outstanding work and preserves recovery lock', async () => {
  const d = deferred(); const f = fixture({ create: () => d.promise }); await f.store.capability(); const p = f.store.create('pdf'); await flush();
  f.store.setApi({ ...f.api }); f.store.setContext({ scope, document: doc, hasUnsavedChanges: false }); await p; await f.store.capability();
  assert.equal(f.store.getSnapshot().unknown, true); assert.equal(f.store.canCreate(), false); d.resolve(meta()); await flush(); assert.deepEqual(f.store.getSnapshot().items, []); f.store.clear();
});

test('same-version conflict survives unsaved and focus changes', async () => {
  const f = fixture({ async create() { throw { status: 409 }; } }); await f.store.capability(); await f.store.create('pdf');
  f.store.setContext({ scope, document: doc, hasUnsavedChanges: true }); f.store.setContext({ scope, document: doc, hasUnsavedChanges: false });
  f.store.conceal(); f.store.setContext({ scope: { ...scope, validationKey: 'fresh' }, document: doc, hasUnsavedChanges: false }); await f.store.capability();
  assert.equal(f.store.getSnapshot().conflict, true); assert.equal(f.store.canCreate(), false); f.store.clear();
});

test('scope fence during ObjectURL creation revokes the new URL and prevents download', async () => {
  const f = fixture(); const createURL = f.host.createObjectURL;
  f.host.createObjectURL = (...args) => { const value = createURL(...args); f.store.conceal(); return value; };
  await f.store.capability(); await f.store.list(); await f.store.download('export-pdf');
  assert.deepEqual(f.revoked, ['blob:test-1']); assert.deepEqual(f.downloads, []); f.store.clear();
});


test('actual AF202 DOCX null pages succeeds through create, list and explicit download', async () => {
  const f = fixture({ async list() { return { items: [meta('docx'), meta('pdf', { pageCount: 100 })] }; } });
  await f.store.capability(); await f.store.create('docx');
  assert.equal(f.store.getSnapshot().unknown, false); assert.equal(f.store.getSnapshot().items[0].pageCount, null);
  await f.store.list(); assert.equal(f.store.getSnapshot().items.length, 2);
  assert.equal(f.store.getSnapshot().items[1].pageCount, 100);
  await f.store.download('export-docx'); assert.equal(f.downloads[0][1], 'document.docx');
  assert.equal(f.store.getSnapshot().issue, ''); f.store.clear();
});

test('format-specific pages and fixed renderer reject invalid success and invalid lists', async () => {
  for (const bad of [meta('docx', { pageCount: 1 }), meta('docx', { pageCount: 0 }), meta('pdf', { pageCount: null }), meta('pdf', { pageCount: 0 }), meta('pdf', { pageCount: 101 }), meta('pdf', { pageCount: 1.5 }), meta('pdf', { rendererVersion: 'renderer-v1' }), meta('docx', { rendererVersion: 'aij-plain-document-v2' })]) {
    const f = fixture({ async create() { return bad; }, async list() { return { items: [bad] }; } });
    await f.store.capability(); await f.store.create(bad.format);
    assert.equal(f.store.getSnapshot().unknown, true); assert.deepEqual(f.store.getSnapshot().items, []);
    await f.store.list(); await f.store.acknowledge();
    assert.equal(f.store.getSnapshot().unknown, true); assert.equal(f.store.getSnapshot().checked, false); f.store.clear();
  }
});

test('actual not_configured triple keeps existing DOCX/PDF readable and downloadable with permissions', async () => {
  const f = fixture({
    async capability() { return { configured: false, canExport: false, reason: 'not_configured' }; },
    async list() { return { items: [meta('docx'), meta()] }; }
  });
  await f.store.capability(); assert.deepEqual(f.store.getSnapshot().capability, { configured: false, canExport: false, reason: 'not_configured' });
  await f.store.create('docx'); await f.store.create('pdf'); assert.equal(f.store.canCreate(), false);
  await f.store.list(); await f.store.download('export-docx'); await f.store.download('export-pdf');
  assert.deepEqual(f.downloads.map(d => d[1]), ['document.docx', 'document.pdf']);
  assert.equal(f.calls.some(c => c[0] === 'create'), false); f.store.clear();
});
