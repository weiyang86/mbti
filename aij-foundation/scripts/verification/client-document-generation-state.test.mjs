import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { createPersonalDocumentGenerationClient } from '../../packages/sdk/dist/index.mjs';
import { createDocumentGenerationController } from '../../apps/web/app/components/client-document-generation-state.mjs';

const sha = value => createHash('sha256').update(value, 'utf8').digest('hex');
const docId = '11111111-1111-4111-8111-111111111111';
const agentId = '22222222-2222-4222-8222-222222222222';
const agent = { id: agentId, revision: 2, name: '章节助手' };
const permissions = ['workspace.documents.read', 'workspace.ai.read', 'workspace.ai.assets.read', 'workspace.documents.manage', 'workspace.ai.execute'];
const startTime = Date.parse('2026-11-09T00:00:00.000Z');
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
function makeSource(auth, body = '# 第一章\n原已保存内容\n', revision = 3) {
  const hash = sha(body);
  return { pin: { ...auth, documentId: docId, revision, bodySha256: hash, sectionId: 'section-0', start: 0, end: body.length, sectionSha256: hash },
    document: { id: docId, code: 'my-document', name: '我的文档', revision, createdAt: '2026-11-08T00:00:00.000Z', updatedAt: '2026-11-09T00:00:00.000Z', body },
    index: { format: 'aij-plain-sections-v1', documentId: docId, revision, bodySha256: hash, bodyLength: body.length, bodyByteLength: Buffer.byteLength(body),
      sections: [{ id: 'section-0', index: 0, title: '第一章', level: 1, start: 0, end: body.length }] } };
}
function origin(saved, instruction) {
  const p = saved.pin;
  return { format: 'aij-document-generation-v1', document: { format: 'aij-document-section-source-v1', indexFormat: 'aij-plain-sections-v1', documentId: p.documentId,
    revision: p.revision, bodySha256: p.bodySha256, sectionId: p.sectionId, start: p.start, end: p.end, sectionSha256: p.sectionSha256 },
  agentId, agentVersionId: 'version-2', agentRevision: 2, agentPublicationEpoch: 4, catalogVersion: 7, modelCode: 'text-model', modelRevision: 3,
  instructionSha256: sha(instruction), inputSha256: sha(JSON.stringify([['instruction', instruction], ['source', saved.document.body]])), maximumEstimatedCostNanos: '9007199254740993' };
}
function fixture(options = {}) {
  const f = { auth: { memberId: 'member-1', workspaceId: 'workspace-1', roleId: 'role-1', roleCode: 'owner', sessionGeneration: 'session-1',
    permissions: [...permissions], validationKey: 'validated-1' }, active: true, calls: [], verifies: [], rejected: [], hooks: {}, entry: null,
  time: startTime, availability: 'ready', configured: true, refPatch: {}, status: 'succeeded', output: '生成结果', documentCurrent: true, contentAvailable: true, sendCount: 0, loadCount: 0, ackCount: 0, suspendCount: 0 };
  f.saved = makeSource(f.auth, options.body);
  f.updateAuth = patch => { f.auth = { ...f.auth, ...patch }; if (f.saved) f.saved = { ...f.saved, pin: { ...f.saved.pin, ...f.auth } }; };
  const listeners = new Set(); f.notify = () => { for (const fn of listeners) fn(); };
  f.scope = {
    active: () => f.active, peekAuth: () => f.auth, peekSaved: () => f.saved,
    async verifySource(pin, mode, signal) {
      assert.ok(signal instanceof AbortSignal); f.verifies.push({ pin, mode });
      return f.hooks.verifySource ? f.hooks.verifySource(pin, mode, signal) : f.saved;
    },
    async verifyRecovery(own, signal) { assert.ok(signal instanceof AbortSignal); assert.equal(own.memberId, f.auth.memberId); return f.hooks.verifyRecovery ? f.hooks.verifyRecovery(own, signal) : f.auth; },
    onScopeRejected(status) { f.rejected.push(status); f.controller.setContext(null); f.hooks.parentClear?.(); }
  };
  f.assets = {
    async list(own, after, signal) { assert.ok(signal instanceof AbortSignal); f.calls.push(['list', after, own]); return f.hooks.list ? f.hooks.list(after) : { items: [agent], nextCursor: null }; },
    async inspect(own, id, signal) { assert.ok(signal instanceof AbortSignal); assert.equal(id, agentId); f.calls.push(['inspect', id, own]); return f.hooks.inspect ? f.hooks.inspect() : { agent, availability: f.availability }; }
  };
  f.run = ref => ({ origin: ref, run: { id: 'run-1', agentCode: `personal:${ref.agentId}`, status: f.status, output: f.status === 'succeeded' ? f.output : null,
    failureCode: ['unknown', 'failed'].includes(f.status) ? 'execution_unknown' : null, estimatedCostNanos: f.status === 'failed' ? '0' : ref.maximumEstimatedCostNanos,
    budgetStatus: f.status === 'succeeded' ? 'settled' : f.status === 'failed' ? 'released' : 'reserved', imageAssetId: null,
    createdAt: new Date(startTime).toISOString(), expiresAt: new Date(startTime + 3600000).toISOString() } });
  f.recovery = () => {
    const r = f.run(f.entry.origin);
    return { origin: r.origin, documentCurrent: f.documentCurrent,
      request: { id: r.run.id, agentCode: r.run.agentCode, status: r.run.status, budgetStatus: r.run.budgetStatus,
        createdAt: r.run.createdAt, expiresAt: r.run.expiresAt, contentAvailable: f.contentAvailable } };
  };
  // Actual public SDK + actual WebCrypto; this in-process transport never opens a socket.
  f.api = createPersonalDocumentGenerationClient(async (path, input) => {
    assert.ok(input.signal instanceof AbortSignal); assert.equal(input.workspaceId, 'workspace-1');
    f.calls.push([path, input]);
    if (f.hooks.transport) { const result = f.hooks.transport(path, input); if (result !== undefined) return result; }
    if (path.endsWith('/preview')) {
      const body = JSON.parse(input.body);
      assert.deepEqual(Object.keys(body).sort(), ['agentId', 'agentRevision', 'bodySha256', 'documentId', 'expectedRevision', 'instruction', 'sectionId'].sort());
      return { origin: { ...origin(f.saved, body.instruction), ...f.refPatch }, inputFields: ['source', 'instruction'], modelExecutionConfigured: f.configured };
    }
    if (path === '/client/ai/document-generations') { const body = JSON.parse(input.body); f.serverOrigin = body.origin; return f.run(body.origin); }
    if (path.startsWith('/client/ai/document-generation-runs/')) return f.run(f.serverOrigin ?? f.entry.origin);
    if (path.startsWith('/client/ai/document-generation-requests/')) return f.recovery();
    throw new Error('Unexpected SDK route');
  });
  f.journal = {
    getSnapshot: () => f.entry,
    subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); },
    async load(own, signal) { assert.ok(signal instanceof AbortSignal); f.loadCount++; return f.entry; },
    async submitOnce(intent, send, signal) {
      assert.ok(signal instanceof AbortSignal);
      if (f.entry) return null;
      f.entry = { ...intent.owner, agentId: intent.origin.agentId, revision: intent.origin.agentRevision, key: 'opaque_key_1', digest: intent.digest,
        runId: null, status: 'unconfirmed', family: 'document-generation', origin: intent.origin, attempted: true };
      f.notify(); f.sendCount++;
      const result = await send(f.entry.key);
      if (f.hooks.afterSend) await f.hooks.afterSend();
      signal.throwIfAborted();
      f.entry = { ...f.entry, runId: result.run.id, status: result.run.status }; f.notify(); return result;
    },
    async bind(expected, m, signal) { signal.throwIfAborted(); assert.equal(expected.key, f.entry.key); f.entry = { ...f.entry, runId: m.runId, status: m.status }; f.notify(); return f.entry; },
    async acknowledgeTerminal(expected, verify, signal) {
      f.ackCount++; assert.equal(expected.key, f.entry.key); const result = await verify(); signal.throwIfAborted();
      if (!['succeeded', 'failed'].includes(result.request.status)) return false;
      f.entry = null; f.notify(); return true;
    },
    suspend() { f.suspendCount++; }
  };
  f.controller = createDocumentGenerationController({ scope: f.scope, assets: f.assets, api: f.api, journal: f.journal, now: () => f.time, timeoutMs: options.timeoutMs ?? 300 });
  f.controller.setContext('full-pin-context-1');
  f.count = suffix => f.calls.filter(c => typeof c[0] === 'string' && c[0].includes(suffix)).length;
  f.prepare = async (instruction = '  保留原指令\r\n') => {
    await f.controller.loadAgents(false); await f.controller.selectAgent(agentId); f.controller.setInstruction(instruction); await f.controller.preview();
    assert.ok(f.controller.getSnapshot().preview, f.controller.getSnapshot().issue);
  };
  f.confirm = async () => { await f.controller.requestConfirmation(); assert.equal(f.controller.getSnapshot().confirmation, true); f.controller.setAcknowledged(true); };
  f.submit = async () => { await f.prepare(); await f.confirm(); await f.controller.confirmSubmit(); };
  return f;
}
function privateCleared(c) {
  const s = c.getSnapshot();
  assert.equal(s.contextKey, null); assert.equal(s.source, null); assert.equal(s.instruction, ''); assert.equal(s.preview, null);
  assert.equal(s.run, null); assert.equal(s.recovery, null); assert.equal(s.confirmation, false); assert.equal(s.acknowledged, false);
  assert.equal(s.issue, ''); assert.equal(s.notice, ''); assert.deepEqual(s.allowed, []); assert.equal(s.busy, false);
}

test('no automatic requests, storage loads, polling or resubmission on context, snapshot or subscriptions', async () => {
  const f = fixture(); let published = 0; const off = f.controller.subscribe(() => published++);
  for (let i = 0; i < 4; i++) { f.controller.setContext('full-pin-context-1'); f.controller.getSnapshot(); }
  await tick(); assert.equal(f.calls.length, 0); assert.equal(f.loadCount, 0); assert.equal(published, 0);
  await f.controller.confirmSubmit(); await f.controller.readResult(); assert.equal(f.calls.length, 0);
  off(); f.controller.suspend(); f.controller.dispose(); f.controller.dispose(); privateCleared(f.controller);
});

test('three explicit original previews, canonical raw digest, double click submits once and active read alone reveals output', async () => {
  const f = fixture(); await f.prepare(); const quote = f.controller.getSnapshot().preview;
  assert.equal(quote.origin.maximumEstimatedCostNanos, '9007199254740993');
  assert.equal(f.count('/preview'), 1); assert.equal(f.count('/client/ai/document-generations'), 1); // preview only
  await f.confirm(); await Promise.all([f.controller.confirmSubmit(), f.controller.confirmSubmit()]);
  assert.equal(f.count('/preview'), 3); assert.equal(f.calls.filter(c => c[0] === '/client/ai/document-generations').length, 1); assert.equal(f.sendCount, 1);
  assert.equal(f.entry.digest, sha(JSON.stringify(['personal-document-generation-v1', quote.origin, '  保留原指令\r\n'])));
  assert.equal(f.controller.getSnapshot().run.run.output, null); assert.equal(f.controller.getSnapshot().recoveryPending, true);
  assert.ok(f.verifies.some(x => x.mode === 'execute'));
  await f.controller.readResult(); assert.equal(f.controller.getSnapshot().run.run.output, '生成结果');
  assert.equal(f.count('/document-generation-runs/'), 1); await f.controller.confirmSubmit(); assert.equal(f.sendCount, 1);
  f.controller.dispose();
});

test('cancel confirmation revokes checkbox and fences a delayed confirmation without submit', async () => {
  const f = fixture(); await f.prepare(); await f.confirm(); f.controller.cancelConfirmation();
  assert.equal(f.controller.getSnapshot().acknowledged, false); await f.controller.confirmSubmit(); assert.equal(f.sendCount, 0);
  const held = deferred(); f.hooks.verifySource = () => held.promise;
  const action = f.controller.requestConfirmation(); await tick(); f.controller.cancelConfirmation(); held.resolve(f.saved); await action;
  assert.equal(f.controller.getSnapshot().confirmation, false); assert.equal(f.controller.getSnapshot().busy, false); assert.equal(f.sendCount, 0);
  f.controller.dispose();
});

test('every original quote field change refuses confirmation and submit, preserving no replacement quote', async t => {
  const patches = { agentVersionId: 'new-version', agentPublicationEpoch: 5, catalogVersion: 8, modelCode: 'other-model', modelRevision: 4,
    inputSha256: sha('different-input'), maximumEstimatedCostNanos: '9007199254740994', agentId: '33333333-3333-4333-8333-333333333333', agentRevision: 3,
    instructionSha256: sha('wrong-instruction'), format: 'wrong' };
  for (const [key, value] of Object.entries(patches)) await t.test(key, async () => {
    const f = fixture(); await f.prepare(); f.refPatch = { [key]: value }; await f.controller.requestConfirmation();
    assert.equal(f.controller.getSnapshot().confirmation, false); assert.equal(f.controller.getSnapshot().preview, null); assert.equal(f.sendCount, 0); f.controller.dispose();
  });
  const f = fixture(); await f.prepare(); await f.confirm(); f.refPatch.maximumEstimatedCostNanos = '1'; await f.controller.confirmSubmit();
  assert.equal(f.sendCount, 0); assert.equal(f.controller.getSnapshot().preview, null); f.controller.dispose();
});

test('all nine document ref fields and source/agent identity are checked independently of SDK decoding', async t => {
  const f0 = fixture(); const base = origin(f0.saved, 'do it'); f0.controller.dispose();
  const values = { format: 'wrong', indexFormat: 'wrong', documentId: '33333333-3333-4333-8333-333333333333', revision: 4,
    bodySha256: sha('other-body'), sectionId: 'section-1', start: 1, end: base.document.end - 1, sectionSha256: sha('other-section') };
  for (const [key, value] of Object.entries(values)) await t.test(key, async () => {
    const f = fixture(); const api = { ...f.api, async preview() { return { origin: { ...origin(f.saved, 'do it'), document: { ...origin(f.saved, 'do it').document, [key]: value } }, inputFields: ['source', 'instruction'], modelExecutionConfigured: true }; } };
    f.controller.setBindings({ scope: f.scope, assets: f.assets, api, journal: f.journal }); f.controller.setContext('new-bindings');
    await f.controller.loadAgents(false); await f.controller.selectAgent(agentId); f.controller.setInstruction('do it'); await f.controller.preview();
    assert.equal(f.controller.getSnapshot().preview, null); assert.equal(f.sendCount, 0); f.controller.dispose();
  });
});

test('canonical comparison ignores object insertion order and permission order', async () => {
  const f = fixture(); const original = f.api.preview;
  const reverse = value => Object.fromEntries(Object.entries(value).reverse());
  const api = { ...f.api, async preview(...args) { const result = await original(...args); return reverse({ ...result, origin: reverse({ ...result.origin, document: reverse(result.origin.document) }) }); } };
  f.controller.setBindings({ scope: f.scope, assets: f.assets, api, journal: f.journal }); f.controller.setContext('canonical');
  await f.prepare(); f.auth.permissions.reverse(); f.saved = { ...f.saved, document: reverse(f.saved.document), index: reverse(f.saved.index), pin: { ...f.saved.pin, permissions: [...f.auth.permissions] } };
  await f.confirm(); await f.controller.confirmSubmit(); assert.equal(f.sendCount, 1); f.controller.dispose();
});

test('instruction, Agent, source, context, role, session, permissions and validation changes revoke all consent', async t => {
  for (const kind of ['instruction', 'agent', 'source', 'context', 'roleId', 'roleCode', 'sessionGeneration', 'permissions', 'validationKey', 'memberId', 'workspaceId']) await t.test(kind, async () => {
    const f = fixture(); await f.prepare(); await f.confirm();
    if (kind === 'instruction') f.controller.setInstruction('changed raw');
    else if (kind === 'agent') await f.controller.selectAgent(agentId);
    else if (kind === 'source') f.saved = makeSource(f.auth, '# 第一章\n新的来源\n', 4);
    else if (kind === 'context') f.controller.setContext('another-full-pin');
    else f.updateAuth({ [kind]: kind === 'permissions' ? permissions.filter(p => p !== 'workspace.ai.execute') : 'changed' });
    await f.controller.confirmSubmit(); assert.equal(f.sendCount, 0); assert.equal(f.controller.getSnapshot().confirmation, false);
    if (!['instruction', 'agent', 'context'].includes(kind)) privateCleared(f.controller); f.controller.dispose();
  });
});

test('source and instruction UTF16 2000 boundaries, hashes and saved full chapter bytes', async t => {
  for (const size of [2000, 2001]) await t.test(`source-${size}`, async () => {
    const body = '# 一\n' + 'a'.repeat(size - 4), f = fixture({ body });
    if (size === 2000) { await f.prepare(); assert.equal(f.controller.getSnapshot().source.text, body); }
    else { privateCleared(f.controller); await f.controller.preview(); assert.equal(f.count('/preview'), 0); }
    f.controller.dispose();
  });
  for (const text of ['a'.repeat(2000), '😀'.repeat(1000), 'a'.repeat(2001), ' '.repeat(2000), '']) await t.test(`instruction-${text.length}-${text.codePointAt(0)}`, async () => {
    const f = fixture(); await f.controller.loadAgents(false); await f.controller.selectAgent(agentId); f.controller.setInstruction(text); await f.controller.preview();
    assert.equal(Boolean(f.controller.getSnapshot().preview), Boolean(text.trim()) && text.length <= 2000); f.controller.dispose();
  });
  const f = fixture(); f.saved = { ...f.saved, pin: { ...f.saved.pin, sectionSha256: sha('bad') } }; f.controller.setContext('invalid-hash');
  await f.controller.loadAgents(false); await f.controller.selectAgent(agentId); f.controller.setInstruction('do it'); await f.controller.preview();
  assert.equal(f.count('/preview'), 0); f.controller.dispose();
});

test('strict descriptor snapshot does not execute getters and freezes source before crypto yields', async () => {
  let getterCalls = 0; const f = fixture();
  Object.defineProperty(f.saved.document, 'body', { enumerable: true, get() { getterCalls++; return 'secret'; } });
  f.controller.setContext('getter'); privateCleared(f.controller); assert.equal(getterCalls, 0); f.controller.dispose();
  const g = fixture(); await g.controller.loadAgents(false); await g.controller.selectAgent(agentId); g.controller.setInstruction('do it');
  const held = deferred(); const subtle = globalThis.crypto.subtle, original = subtle.digest;
  Object.defineProperty(subtle, 'digest', { configurable: true, value() { return held.promise; } });
  try {
    const action = g.controller.preview(); await tick(); g.saved.document.body = '# 第一章\n恶意可变来源\n'; held.resolve(new ArrayBuffer(32)); await action;
    privateCleared(g.controller); assert.equal(g.count('/preview'), 0);
  } finally { Object.defineProperty(subtle, 'digest', { configurable: true, value: original }); g.controller.dispose(); }
});

test('current 401/403/404 synchronously clear parent and child; older rejection never clears a new scope', async t => {
  for (const status of [401, 403, 404]) await t.test(String(status), async () => {
    const f = fixture(); f.hooks.list = () => { throw { status }; }; let observed = false;
    f.hooks.parentClear = () => { privateCleared(f.controller); observed = true; };
    await f.controller.loadAgents(false); assert.deepEqual(f.rejected, [status]); assert.equal(observed, true); privateCleared(f.controller); f.controller.dispose();
  });
  const f = fixture(); const held = deferred(); f.hooks.list = () => held.promise;
  const old = f.controller.loadAgents(false); await tick(); f.controller.setContext('new-pin');
  f.hooks.list = null; await f.controller.loadAgents(false); held.reject({ status: 403 }); await old;
  assert.deepEqual(f.rejected, []); assert.equal(f.controller.getSnapshot().contextKey, 'new-pin'); assert.equal(f.controller.getSnapshot().agents.length, 1); f.controller.dispose();
});

test('ignored abort is bounded, late success cannot publish and cancel/dispose are synchronous', async () => {
  const f = fixture({ timeoutMs: 15 }); const held = deferred(); f.hooks.list = () => held.promise;
  await f.controller.loadAgents(false); assert.equal(f.controller.getSnapshot().busy, false); assert.ok(f.controller.getSnapshot().issue);
  f.controller.suspend(); privateCleared(f.controller); held.resolve({ items: [agent], nextCursor: null }); await tick(); privateCleared(f.controller);
  f.controller.setContext('new'); assert.equal(f.controller.getSnapshot().agents.length, 0); f.controller.dispose(); privateCleared(f.controller);
});

test('lost submit reply never retries, new session and changed/missing source recover only original metadata', async () => {
  const f = fixture(); f.hooks.afterSend = () => { throw new Error('reply lost after original execution'); };
  await f.submit(); assert.equal(f.sendCount, 1); assert.equal(f.entry.runId, null); assert.equal(f.controller.getSnapshot().recoveryPending, true);
  await f.controller.confirmSubmit(); assert.equal(f.sendCount, 1);
  f.controller.suspend(); f.updateAuth({ sessionGeneration: 'session-2' }); f.saved = null; f.controller.setContext('new-session-without-source');
  assert.equal(f.controller.getSnapshot().source, null); assert.equal(f.loadCount, 0);
  f.documentCurrent = false; await f.controller.recover(); assert.equal(f.count('/document-generation-requests/'), 1);
  assert.equal(f.controller.getSnapshot().recovery.request.id, 'run-1'); assert.equal(f.controller.getSnapshot().run, null);
  assert.equal(f.controller.getSnapshot().allowed.includes('read'), false); await f.controller.readResult(); assert.equal(f.count('/document-generation-runs/'), 0);
  assert.equal(f.sendCount, 1); await f.controller.acknowledgeRecovery(); assert.equal(f.entry, null); assert.equal(f.controller.getSnapshot().recovery, null); f.controller.dispose();
});

test('unknown/reserved and 410 preserve pending key; acknowledgement re-verifies instead of unlocking', async () => {
  const f = fixture(); f.status = 'unknown'; await f.submit(); await f.controller.recover();
  assert.equal(f.controller.getSnapshot().allowed.includes('read'), false); await f.controller.readResult(); assert.equal(f.count('/document-generation-runs/'), 0);
  const key = f.entry.key; await f.controller.acknowledgeRecovery(); assert.equal(f.entry.key, key); assert.equal(f.controller.getSnapshot().recoveryPending, true);
  f.hooks.transport = path => { if (path.includes('/document-generation-requests/')) throw { status: 410 }; };
  await f.controller.recover(); assert.equal(f.entry.key, key); assert.ok(f.controller.getSnapshot().issue); assert.equal(f.sendCount, 1); f.controller.dispose();
});

test('submit aborted after send preserves original journal and no late output; explicit recover only', async () => {
  const f = fixture(); await f.prepare(); await f.confirm(); const held = deferred();
  f.hooks.transport = path => path === '/client/ai/document-generations' ? held.promise : undefined;
  const action = f.controller.confirmSubmit();
  for (let i = 0; i < 30 && !f.sendCount; i++) await tick();
  assert.equal(f.sendCount, 1); const ref = f.entry.origin; f.controller.suspend(); privateCleared(f.controller);
  held.resolve(f.run(ref)); await action; privateCleared(f.controller); assert.equal(f.entry.runId, null);
  f.controller.setContext('resumed'); assert.equal(f.controller.getSnapshot().recoveryPending, true); assert.equal(f.sendCount, 1);
  await f.controller.recover(); assert.equal(f.controller.getSnapshot().recovery.request.id, 'run-1'); f.controller.dispose();
});

test('current authorization and full source must survive both sides of an awaited result read', async () => {
  const f = fixture(); await f.submit(); const held = deferred();
  f.hooks.transport = path => path.includes('/document-generation-runs/') ? held.promise : undefined;
  const reading = f.controller.readResult(); for (let i = 0; i < 30 && !f.count('/document-generation-runs/'); i++) await tick();
  f.updateAuth({ roleCode: 'viewer' }); held.resolve(f.run(f.entry.origin)); await reading; privateCleared(f.controller); f.controller.dispose();
});

test('64000 output boundary, expiry concealment and not-configured read/recover', async t => {
  for (const size of [64000, 64001]) await t.test(String(size), async () => {
    const f = fixture(); await f.submit(); f.output = 'x'.repeat(size); await f.controller.readResult();
    assert.equal(f.controller.getSnapshot().run?.run.output?.length ?? 0, size === 64000 ? 64000 : 0);
    if (size === 64000) { f.time += 3600000; assert.equal(f.controller.getSnapshot().run.run.output, null); assert.equal(f.controller.getSnapshot().allowed.includes('read'), false); }
    f.controller.dispose();
  });
  const f = fixture(); await f.submit(); f.controller.suspend(); f.configured = false; f.controller.setContext('config-off');
  await f.controller.recover(); await f.controller.readResult(); assert.equal(f.controller.getSnapshot().run.run.output, '生成结果'); f.controller.dispose();
});

test('read-only three permissions permit preview/recovery but no confirmation or execution', async () => {
  const f = fixture(); f.updateAuth({ permissions: permissions.slice(0, 3) }); f.controller.setContext('read-only');
  await f.prepare(); await f.controller.requestConfirmation(); await f.controller.confirmSubmit(); assert.equal(f.sendCount, 0); assert.equal(f.controller.getSnapshot().confirmation, false);
  f.controller.dispose();
  const g = fixture(); g.configured = false; await g.prepare(); await g.controller.requestConfirmation(); assert.equal(g.sendCount, 0); assert.equal(g.controller.getSnapshot().confirmation, false); g.controller.dispose();
});

test('paging is explicit, bounded, sorted, unique and never inspects a whole list', async () => {
  const f = fixture(); let page = 0;
  f.hooks.list = () => { page++; const id = `${String(page).padStart(8, '0')}-2222-4222-8222-222222222222`; return { items: [{ ...agent, id }], nextCursor: id }; };
  await f.controller.loadAgents(false); assert.equal(f.count('inspect'), 0); assert.equal(page, 1);
  for (let i = 0; i < 25; i++) await f.controller.loadAgents(true);
  assert.equal(page, 20); assert.equal(f.controller.getSnapshot().agents.length, 20); assert.equal(f.controller.getSnapshot().hasNextAgents, false);
  assert.equal(f.count('inspect'), 0); f.controller.dispose();
  const g = fixture(); g.hooks.list = () => ({ items: [agent, agent], nextCursor: null }); await g.controller.loadAgents(false);
  assert.equal(g.controller.getSnapshot().agents.length, 0); assert.ok(g.controller.getSnapshot().issue); g.controller.dispose();
});

test('bindings change, inactive source and disposal fence old results without implicit traffic', async () => {
  const f = fixture(); await f.prepare(); const held = deferred(); f.hooks.verifySource = () => held.promise;
  const old = f.controller.requestConfirmation(); await tick();
  f.controller.setBindings({ scope: { ...f.scope }, assets: f.assets, api: f.api, journal: f.journal }); privateCleared(f.controller);
  held.resolve(f.saved); await old; privateCleared(f.controller);
  f.controller.setContext('new-bindings'); f.active = false; privateCleared(f.controller); f.controller.dispose();
});

test('two controllers sharing the injected journal cannot replace an attempted request', async () => {
  const f = fixture(); await f.prepare(); await f.confirm();
  const other = createDocumentGenerationController({ scope: f.scope, assets: f.assets, api: f.api, journal: f.journal, now: () => f.time });
  other.setContext('other-view'); await other.loadAgents(false); await other.selectAgent(agentId); other.setInstruction('another-instruction'); await other.preview(); await other.requestConfirmation(); other.setAcknowledged(true);
  await Promise.all([f.controller.confirmSubmit(), other.confirmSubmit()]); assert.equal(f.sendCount, 1);
  assert.equal(f.calls.filter(c => c[0] === '/client/ai/document-generations').length, 1); assert.equal(f.entry.key, 'opaque_key_1');
  other.dispose(); f.controller.dispose();
});

test('parent callback reentrancy preserves a new epoch, and a no-op callback still clears the rejected child', async () => {
  const f = fixture(); f.scope.onScopeRejected = status => { f.rejected.push(status); };
  f.hooks.list = () => { throw { status: 403 }; };
  await f.controller.loadAgents(false); assert.deepEqual(f.rejected, [403]); privateCleared(f.controller); f.controller.dispose();
  const g = fixture();
  g.hooks.parentClear = () => { g.updateAuth({ sessionGeneration: 'new-session' }); g.controller.setContext('new-authority'); };
  g.hooks.list = () => { throw { status: 403 }; };
  await g.controller.loadAgents(false); assert.deepEqual(g.rejected, [403]); assert.equal(g.controller.getSnapshot().contextKey, 'new-authority'); g.controller.dispose();
});

test('mismatching recovery origin or run never binds, displays output or acknowledges the original key', async t => {
  for (const mismatch of ['origin', 'run']) await t.test(mismatch, async () => {
    const f = fixture(); await f.submit(); const key = f.entry.key;
    f.hooks.transport = path => {
      if (path.includes('/document-generation-requests/')) {
        const result = f.recovery();
        return mismatch === 'origin' ? { ...result, origin: { ...result.origin, catalogVersion: 99 } } : { ...result, request: { ...result.request, id: 'different-run' } };
      }
    };
    await f.controller.recover(); assert.equal(f.entry.key, key); assert.equal(f.controller.getSnapshot().recovery, null);
    await f.controller.acknowledgeRecovery(); assert.equal(f.entry.key, key); assert.equal(f.controller.getSnapshot().recoveryPending, true); f.controller.dispose();
  });
});

test('full saved document hash and multi-section exact ranges are verified before preview', async () => {
  const f = fixture(); const first = '# 第一章\n开头\n', second = '# 第二章\n完整正文\n', body = first + second;
  f.saved = makeSource(f.auth, body);
  f.saved.index.sections = [f.saved.index.sections[0], { id: 'section-1', index: 1, title: '第二章', level: 1, start: first.length, end: body.length }];
  f.saved.index.sections[0].end = first.length;
  f.saved.pin = { ...f.saved.pin, sectionId: 'section-1', start: first.length, sectionSha256: sha(second) };
  f.controller.setContext('second-section'); await f.prepare(); assert.equal(f.controller.getSnapshot().source.text, second);
  assert.equal(f.controller.getSnapshot().preview.origin.document.bodySha256, sha(body)); f.controller.dispose();
  const g = fixture(); g.saved.document.body += '改变但未改hash'; g.saved.index.bodyLength = g.saved.document.body.length;
  g.saved.index.bodyByteLength = Buffer.byteLength(g.saved.document.body); g.saved.index.sections[0].end = g.saved.document.body.length;
  g.saved.pin.end = g.saved.document.body.length; g.saved.pin.sectionSha256 = sha(g.saved.document.body); g.controller.setContext('body-hash-wrong');
  await g.controller.loadAgents(false); await g.controller.selectAgent(agentId); g.controller.setInstruction('do it'); await g.controller.preview();
  assert.equal(g.count('/preview'), 0); assert.equal(g.controller.getSnapshot().preview, null); g.controller.dispose();
});

test('unpublished/incompatible/unconfigured assets and changed revision cannot reach generation preview', async t => {
  for (const availability of ['unpublished', 'incompatible', 'not_configured', 'unavailable']) await t.test(availability, async () => {
    const f = fixture(); f.availability = availability; await f.controller.loadAgents(false); await f.controller.selectAgent(agentId);
    f.controller.setInstruction('do it'); await f.controller.preview(); assert.equal(f.count('/preview'), 0); assert.equal(f.sendCount, 0); f.controller.dispose();
  });
  const f = fixture(); await f.prepare(); f.hooks.inspect = () => ({ agent: { ...agent, revision: 3 }, availability: 'ready' }); await f.controller.requestConfirmation();
  assert.equal(f.controller.getSnapshot().confirmation, false); assert.equal(f.sendCount, 0); f.controller.dispose();
});

test('pending entry appearing during confirmation fences consent rather than adopting another request', async () => {
  const f = fixture(); await f.prepare(); const held = deferred(); f.hooks.verifySource = () => held.promise;
  const confirming = f.controller.requestConfirmation(); await tick();
  const ref = f.controller.getSnapshot().preview.origin;
  f.entry = { memberId: f.auth.memberId, workspaceId: f.auth.workspaceId, agentId, revision: 2, key: 'other_key_1', digest: sha('other-request'),
    runId: null, status: 'unconfirmed', family: 'document-generation', origin: ref, attempted: true }; f.notify();
  held.resolve(f.saved); await confirming; assert.equal(f.controller.getSnapshot().confirmation, false); assert.equal(f.sendCount, 0); f.controller.dispose();
});

test('unbound delayed journal send cannot call SDK after the caller timeout', async () => {
  const f = fixture({ timeoutMs: 15 }); let delayedSend, delayedSignal;
  f.journal.submitOnce = async (_intent, send, signal) => { delayedSend = send; delayedSignal = signal; return new Promise(() => {}); };
  await f.prepare(); await f.confirm(); await f.controller.confirmSubmit(); assert.ok(delayedSignal.aborted);
  await assert.rejects(() => delayedSend('late_key_1')); assert.equal(f.calls.filter(c => c[0] === '/client/ai/document-generations').length, 0);
  assert.equal(f.controller.getSnapshot().recoveryPending, true); f.controller.dispose();
});

test('dispose prevents synchronous subscriber reattachment and remains idempotent', async () => {
  const f = fixture(); await f.prepare();
  f.controller.subscribe(() => f.controller.setContext('subscriber-reattachment'));
  f.controller.dispose(); privateCleared(f.controller); f.controller.setContext('after-dispose'); privateCleared(f.controller);
  f.controller.dispose(); assert.equal(f.suspendCount, 1);
});
