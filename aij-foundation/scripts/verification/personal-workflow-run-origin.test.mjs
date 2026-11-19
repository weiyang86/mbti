import { createRequire } from 'node:module';
import Module from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';
const require = createRequire(import.meta.url), ts = require('typescript');
const apiRequire = createRequire(resolve('apps/api/package.json'));
const nest = apiRequire('@nestjs/common');
function load(name, overrides = {}) {
  const file = resolve('apps/api/src/plugins/aij-ai/' + name + '.ts');
  const m = new Module(file); m.filename = file; m.paths = Module._nodeModulePaths(resolve('apps/api'));
  m.require = path => overrides[path] ?? apiRequire(path);
  m._compile(ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true, emitDecoratorMetadata: true,
  }}).outputText, file);
  return m.exports;
}
const o = load('ai-personal-workflow-run-origin.service');
const { personalAgentRunPreviewQuery } = load('ai-personal-agent-run-previews.dto', {
  './ai-personal-agents.dto': load('ai-personal-agents.dto'),
});
const { AiPersonalWorkflowRunsService: Runs } = load('ai-personal-workflow-runs.service', {
  './ai-personal-workflow-run-origin.service': o,
  './ai-personal-agent-run-previews.service': { AiPersonalAgentRunPreviewsService: class {} },
});
const ref = { id: '11111111-1111-4111-8111-111111111111', workflowId: 'w', workflowVersionId: 'wv', revision: 1,
  graphDigest: 'a'.repeat(64), publicationEpoch: 1, nodeId: 'agent', agentId: 'a', agentVersionId: 'av', agentRevision: 1, agentPublicationEpoch: 1 };
const scope = { projectId: 'p', memberId: 'm', workspaceId: 'ws' };
const claims = { sub: 'm', sessionId: 's', tokenVersion: 1 };
const snapshot = () => ({ agent: { code: 'personal:a', revision: 1, inputFields: ['text'] }, source: { type: 'personal', agentId: 'a', versionId: 'av', revision: 1, publicationVersion: 1, skills: [], workflowOrigin: { ...ref } } });
const run = () => ({ ...scope, id: 'r', snapshot: snapshot() });
function fixture() {
  const f = { rows: [], calls: [], current: { ...ref }, active: true, epoch: 1, auditFail: false };
  f.tx = { $queryRaw: async () => f.rows,
    $executeRaw: async (_strings, ...v) => { f.calls.push('insert'); f.rows.push({ run_id: v[0], project_id: v[1], workspace_id: v[2], member_id: v[3], publication_id: v[4], ref: JSON.parse(v[5]), session_id: v[6], token_version: v[7] }); },
    auditLog: { create: async () => { f.calls.push('audit'); if (f.auditFail) throw Error('audit unavailable'); } },
    aiAgentRun: { findFirst: async () => ({ id: 'r' }) },
  };
  f.auth = { assertSessionInTransaction: async (_tx, c) => { f.calls.push('session:' + c.sessionId); if (!f.active || c.tokenVersion !== f.epoch) throw new nest.UnauthorizedException('Invalid client session'); } };
  f.pub = { resolveInTransaction: async (tx, _s, _id, gate) => { f.calls.push('workflow'); await gate(tx); return { projectId: 'p', ref: f.current, inputFields: ['text'] }; } };
  f.pub.resolveForReadInTransaction = async (tx, _s, _id, gate) => { f.calls.push('workflow-read'); await gate(tx); return { projectId: 'p', ref: f.current, inputFields: ['text'] }; };
  f.origin = new o.AiPersonalWorkflowRunOriginService(f.pub, f.auth);
  f.record = () => f.origin.recordOrigin(f.tx, run(), { ref, inputFields: ['text'] }, claims);
  return f;
}
const status = n => e => e.getStatus?.() === n;
test('strict ref copies/freeze; rejects limits, unknown keys, getters and prototypes', () => {
  const copy = o.workflowRef(ref); assert.notEqual(copy, ref); assert(Object.isFrozen(copy));
  for (const bad of [{ ...ref, revision: 0 }, { ...ref, agentPublicationEpoch: 2147483648 }, { ...ref, revision: NaN }, { ...ref, secret: 'x' }, Object.create(ref), { ...ref, get nodeId() { throw Error('getter executed'); } }]) assert.throws(() => o.workflowRef(bad), status(409));
});
test('same hash independent of input ordering; full epoch/publication domains separated; input limits', () => {
  const h = o.workflowRequestHash(ref, { b: '2', a: '1' }); assert.equal(h, o.workflowRequestHash({ ...ref }, { a: '1', b: '2' }));
  for (const field of ['publicationEpoch', 'agentPublicationEpoch', 'agentRevision']) assert.notEqual(h, o.workflowRequestHash({ ...ref, [field]: 2 }, { b: '2', a: '1' }));
  assert.notEqual(h, o.workflowRequestHash({ ...ref, id: '22222222-1111-4111-8111-111111111111' }, { b: '2', a: '1' }));
  assert.throws(() => o.workflowRequestHash(ref, { text: 'x'.repeat(2001) }), status(400));
});
test('actual record matches original snapshot and inserts relation plus body-free audit', async () => {
  const f = fixture(); await f.record(); assert.deepEqual(f.calls, ['insert', 'audit']);
  await f.origin.assertOriginCurrent(f.tx, run()); assert.deepEqual(f.calls.slice(2), ['workflow', 'session:s']);
  const invalid = run(); invalid.snapshot.source.publicationVersion = 2;
  await assert.rejects(f.origin.recordOrigin(f.tx, invalid, { ref, inputFields: ['text'] }, claims), status(409));
  assert.equal(f.rows.length, 1);
});
test('audit rejection propagates to owning transaction; collaborator rollback simulation is not PG evidence', async () => {
  const f = fixture(); f.auditFail = true;
  await assert.rejects((async () => { const before = [...f.rows]; try { await f.record(); } catch (e) { f.rows = before; throw e; } })());
  assert.equal(f.rows.length, 0); assert.deepEqual(f.calls, ['insert', 'audit']);
});
test('legacy, missing relation/marker/port, scoped mismatch, and unknown extension preservation', async () => {
  const f = fixture(); await f.origin.assertOriginCurrent(f.tx, { ...run(), snapshot: {} });
  await assert.rejects(f.origin.assertOriginCurrent(f.tx, run()), status(409));
  await f.record(); await assert.rejects(f.origin.assertOriginCurrent(f.tx, { ...run(), snapshot: {} }), status(409));
  await assert.rejects(new o.AiPersonalWorkflowRunOriginService().resolveOrigin(f.tx, scope, ref.id, claims), status(503));
  f.rows[0].workspace_id = 'other'; await assert.rejects(f.origin.assertOriginCurrent(f.tx, run()), status(409));
  const s = snapshot(); s.source.unknown = true; assert.equal(o.withoutWorkflowMarker(s, ref).source.unknown, true); assert(!('workflowOrigin' in o.withoutWorkflowMarker(s, ref).source));
});
test('runtime detects workflow ABA and Agent publication ABA and original session rotation', async () => {
  for (const field of ['publicationEpoch', 'agentPublicationEpoch']) { const f = fixture(); await f.record(); f.current[field]++;
    await assert.rejects(f.origin.assertOriginCurrent(f.tx, run()), status(409)); }
  const f = fixture(); await f.record(); f.epoch = 2; await assert.rejects(f.origin.assertOriginCurrent(f.tx, run()), status(401));
});
async function serviceFixture() {
  const f = fixture(); await f.record(); f.calls = [];
  f.result = { id: 'r', agentCode: 'personal:a', status: 'unknown', output: null, failureCode: null, estimatedCostNanos: '1', budgetStatus: 'reserved', imageAssetId: null, createdAt: new Date(0), expiresAt: new Date(1000) };
  f.driver = { submitWorkflow: async () => { f.calls.push('submit'); return f.result; }, read: async () => { f.calls.push('read'); return f.result; }, recoverRequest: async () => { f.calls.push('recover'); return { ...f.result, contentAvailable: false }; } };
  f.access = { withCurrent: async (_m, _w, _p, op) => { f.calls.push('begin'); try { return await op(f.tx, scope); } finally { f.calls.push('end'); } }, assertAgentCurrent: async () => { f.calls.push('agent'); } };
  f.preview = { preview: async (_member, _workspace, _agent, query) => { assert.equal(personalAgentRunPreviewQuery(query).expectedRevision, 1); f.calls.push('preview'); return { personalAgentId: 'a', revision: 1, inputFields: ['text'], maximumEstimatedCostNanos: '5', modelExecutionConfigured: false }; } };
  f.service = new Runs(f.access, f.origin, f.driver, f.preview); return f;
}
test('one admission, current reads in short transactions and exact unknown state', async () => {
  const f = await serviceFixture(); const result = await f.service.submit('m', 'ws', { publicationId: ref.id, input: { text: 'hello' }, idempotencyKey: 'request_1' }, claims);
  assert.equal(result.run.status, 'unknown'); assert.equal(f.calls.filter(x => x === 'submit').length, 1);
  assert.deepEqual(f.calls, ['begin', 'workflow', 'session:s', 'agent', 'end', 'submit', 'begin', 'workflow', 'session:s', 'agent', 'end']);
});
test('new query session accepted while original runtime session is rejected', async () => {
  const f = await serviceFixture(); f.epoch = 2;
  const out = await f.service.read('m', 'ws', 'r', { sub: 'm', sessionId: 'new', tokenVersion: 2 }); assert.equal(out.run.status, 'unknown');
  await assert.rejects(f.origin.assertOriginCurrent(f.tx, run()), status(401)); assert(!JSON.stringify(out).includes('session'));
});
test('late IO revocation/ABA blocks output and never retries admission', async () => {
  for (const change of [f => { f.active = false; }, f => { f.current.publicationEpoch++; }]) {
    const f = await serviceFixture(); f.driver.submitWorkflow = async () => { f.calls.push('submit'); change(f); return f.result; };
    await assert.rejects(f.service.submit('m', 'ws', { publicationId: ref.id, input: { text: 'hello' }, idempotencyKey: 'request_1' }, claims));
    assert.equal(f.calls.filter(x => x === 'submit').length, 1);
  }
});
test('network uncertainty fixed 503; identity/body errors fixed; no implicit retry', async () => {
  const f = await serviceFixture(); f.driver.submitWorkflow = async () => { f.calls.push('submit'); throw Error('private secret network'); };
  await assert.rejects(f.service.submit('m', 'ws', { publicationId: ref.id, input: { text: 'hello' }, idempotencyKey: 'request_1' }, claims), e => e.getStatus() === 503 && !e.message.includes('secret'));
  assert.equal(f.calls.filter(x => x === 'submit').length, 1);
  await assert.rejects(f.service.read('m', 'ws', 'r', { ...claims, sub: 'other' }), status(401));
  await assert.rejects(f.service.submit('m', 'ws', { publicationId: ref.id, input: {}, idempotencyKey: 'request_1', extra: 1 }, claims), status(400));
});
test('preview/recover compose original owners without submit; configured false and expired content preserved', async () => {
  const f = await serviceFixture(); const p = await f.service.preview('m', 'ws', ref.id, claims); assert.equal(p.modelExecutionConfigured, false);
  const r = await f.service.recover('m', 'ws', 'request_1', claims); assert.equal(r.request.contentAvailable, false); assert.equal(r.request.status, 'unknown');
  assert(!f.calls.includes('submit')); assert(f.calls.indexOf('agent') > f.calls.indexOf('workflow'));
  f.driver.read = async () => { throw new nest.GoneException('AI run content expired'); };
  await assert.rejects(f.service.read('m', 'ws', 'r', claims), status(410));
});
test('scoped FK/unique refusal propagates without audit or retry (DB collaborator, not actual constraints)', async () => {
  for (const code of ['23503', '23505']) {
    const f = fixture(); let inserts = 0;
    f.tx.$executeRaw = async () => { inserts++; throw Object.assign(Error('constraint rejected'), { code }); };
    await assert.rejects(f.record(), e => e.code === code); assert.equal(inserts, 1); assert(!f.calls.includes('audit'));
  }
});
test('lease gate precedes origin and no authority survives late IO (hook collaborator, not runtime lease evidence)', async () => {
  const f = fixture(); await f.record(); f.calls = [];
  const phase = async validLease => { if (!validLease) throw Error('AI_LEASE_LOST'); await f.origin.assertOriginCurrent(f.tx, run()); f.calls.push('agent'); };
  await assert.rejects(phase(false), /AI_LEASE_LOST/); assert.deepEqual(f.calls, []);
  await phase(true); assert.deepEqual(f.calls, ['workflow', 'session:s', 'agent']);
  f.active = false; await assert.rejects(phase(true), status(401)); assert.equal(f.calls.filter(x => x === 'agent').length, 1);
});
test('read rejects invisible origins and current grants; preview post-check rejects changes', async () => {
  const f = await serviceFixture(); f.rows = [];
  await assert.rejects(f.service.read('m', 'ws', 'r', claims), status(404)); assert(!f.calls.includes('read'));
  f.access.withCurrent = async () => { throw new nest.ForbiddenException('Workflow permission denied'); };
  await assert.rejects(f.service.read('m', 'ws', 'r', claims), status(403));
  const g = await serviceFixture(); g.preview.preview = async () => { g.current.agentPublicationEpoch++; return { personalAgentId: 'a', revision: 1, inputFields: ['text'], maximumEstimatedCostNanos: '0', modelExecutionConfigured: false }; };
  await assert.rejects(g.service.preview('m', 'ws', ref.id, claims), status(409));
});
test('submit refuses driver result that does not belong to the admitted request key', async () => {
  const f = await serviceFixture(); f.result.id = 'different-run';
  await assert.rejects(f.service.submit('m', 'ws', { publicationId: ref.id, input: { text: 'hello' }, idempotencyKey: 'request_1' }, claims), status(409));
});
async function permissionFixture(grants) {
  const f = await serviceFixture(); f.grants = new Set(grants); f.effects = { provider: 0, enqueue: 0, reserve: 0 };
  const requireGrants = permissions => { if (permissions.some(p => !f.grants.has(p))) throw new nest.ForbiddenException('Workflow permission denied'); };
  const baseAccess = f.access.withCurrent;
  f.access.withCurrent = async (m, w, permissions, operation) => { requireGrants(permissions); return baseAccess(m, w, permissions, operation); };
  for (const [method, permission] of [['resolveForReadInTransaction', 'ai.read'], ['resolveInTransaction', 'ai.execute']]) {
    const original = f.pub[method];
    f.pub[method] = async (...args) => { f.calls.push(method); requireGrants(['ai.assets.read', permission, 'workspace.ai.workflows.execute']); return original(...args); };
  }
  f.driver.submitWorkflow = async () => { f.calls.push('submit'); f.effects.enqueue++; f.effects.reserve++; return f.result; };
  return f;
}
const readGrants = ['ai.assets.read', 'ai.read', 'workspace.ai.workflows.execute'];
const executeGrants = ['ai.assets.read', 'ai.execute', 'workspace.ai.workflows.execute'];
const body = { publicationId: ref.id, input: { text: 'hello' }, idempotencyKey: 'request_1' };
test('R1 read-only grants allow read and recover via explicit read resolver with fresh query session', async () => {
  const f = await permissionFixture(readGrants); f.epoch = 2;
  const query = { ...claims, sessionId: 'new', tokenVersion: 2 };
  assert.equal((await f.service.read('m', 'ws', 'r', query)).run.status, 'unknown');
  assert.equal((await f.service.recover('m', 'ws', 'request_1', query)).request.status, 'unknown');
  assert.equal(f.calls.filter(x => x === 'resolveForReadInTransaction').length, 4);
  assert(!f.calls.includes('resolveInTransaction')); assert(!f.calls.includes('session:s'));
  assert.equal(f.calls.filter(x => x === 'session:new').length, 4);
  assert.deepEqual(f.effects, { provider: 0, enqueue: 0, reserve: 0 });
});
test('R1 every read grant is required even when execution is allowed; no fallback or effects', async () => {
  for (const missing of readGrants) {
    const f = await permissionFixture([...new Set([...readGrants, ...executeGrants])].filter(g => g !== missing));
    await assert.rejects(f.service.read('m', 'ws', 'r', claims), status(403));
    await assert.rejects(f.service.recover('m', 'ws', 'request_1', claims), status(403));
    assert(!f.calls.includes('read')); assert(!f.calls.includes('recover')); assert(!f.calls.includes('resolveInTransaction'));
    assert.deepEqual(f.effects, { provider: 0, enqueue: 0, reserve: 0 });
  }
});
test('R1 read grants never downgrade submit, preview, admission or runtime execution', async () => {
  const f = await permissionFixture(readGrants);
  await assert.rejects(f.service.submit('m', 'ws', body, claims), status(403));
  await assert.rejects(f.service.preview('m', 'ws', ref.id, claims), status(403));
  await assert.rejects(f.origin.resolveOrigin(f.tx, scope, ref.id, claims), status(403));
  await assert.rejects(f.origin.assertOriginCurrent(f.tx, run()), status(403));
  assert.equal(f.calls.filter(x => x === 'resolveInTransaction').length, 2);
  assert(!f.calls.includes('resolveForReadInTransaction')); assert(!f.calls.includes('preview'));
  assert.deepEqual(f.effects, { provider: 0, enqueue: 0, reserve: 0 });
});
test('R1 execute-only grants retain submit pre/post and preview execute fences', async () => {
  const f = await permissionFixture(executeGrants);
  await f.service.submit('m', 'ws', body, claims); await f.service.preview('m', 'ws', ref.id, claims);
  assert.equal(f.calls.filter(x => x === 'resolveInTransaction').length, 4);
  assert(!f.calls.includes('resolveForReadInTransaction')); assert.equal(f.effects.enqueue, 1); assert.equal(f.effects.reserve, 1);
  // Grant revoked during original driver IO: post-check cannot fall back to a usable read resolver.
  const g = await permissionFixture([...executeGrants, 'ai.read']);
  g.driver.submitWorkflow = async () => { g.grants.delete('ai.execute'); return g.result; };
  await assert.rejects(g.service.submit('m', 'ws', body, claims), status(403));
  assert(!g.calls.includes('resolveForReadInTransaction'));
});
test('R1 read authorization is rechecked after IO; read resolver 403 is never retried as execute', async () => {
  const f = await permissionFixture([...readGrants, 'ai.execute']);
  f.driver.read = async () => { f.grants.delete('ai.read'); return f.result; };
  await assert.rejects(f.service.read('m', 'ws', 'r', claims), status(403)); assert(!f.calls.includes('resolveInTransaction'));
  const g = await permissionFixture([...readGrants, 'ai.execute']);
  g.pub.resolveForReadInTransaction = async () => { g.calls.push('denied-read'); throw new nest.ForbiddenException('Workflow permission denied'); };
  await assert.rejects(g.service.recover('m', 'ws', 'request_1', claims), status(403));
  assert.equal(g.calls.filter(x => x === 'denied-read').length, 1); assert(!g.calls.includes('resolveInTransaction'));
});
test('R1 both resolvers share strict project/ref/input/session checks; absent read port fails closed', async () => {
  for (const method of ['resolveOrigin', 'resolveReadOrigin']) {
    const f = fixture();
    await assert.rejects(f.origin[method](f.tx, { ...scope, projectId: 'other' }, ref.id, claims), status(409));
    f.current = { ...ref, unexpected: true }; await assert.rejects(f.origin[method](f.tx, scope, ref.id, claims), status(409));
    f.current = { ...ref }; f.active = false; await assert.rejects(f.origin[method](f.tx, scope, ref.id, claims), status(401));
    f.active = true;
    const port = method === 'resolveOrigin' ? 'resolveInTransaction' : 'resolveForReadInTransaction';
    f.pub[port] = async () => ({ projectId: 'p', ref, inputFields: ['text', 'text'] });
    await assert.rejects(f.origin[method](f.tx, scope, ref.id, claims), status(409));
  }
  const f = fixture(); delete f.pub.resolveForReadInTransaction;
  await assert.rejects(f.origin.resolveReadOrigin(f.tx, scope, ref.id, claims), status(503)); assert.deepEqual(f.calls, []);
});
