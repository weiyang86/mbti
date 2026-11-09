import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { syntheticAiCatalog } from './ai-center-fixture.mjs';
const require = createRequire(resolve('apps/api/package.json'));
require('ts-node').register({ project: resolve('apps/api/tsconfig.json'), transpileOnly: true });
require('reflect-metadata');
const load = name => require(resolve('apps/api/src/plugins/aij-ai/' + name + '.ts'));
const { AiPersonalAgentSnapshotsService } = load('ai-personal-agent-snapshots.service');
const { AiCenterRunService } = load('ai-center-run.service');
const { AiPersonalAgentRunsService, personalAgentRunRequest } = load('ai-personal-agent-runs.service');
const { AiPersonalAgentRunsController, PersonalAgentRunNoStoreGuard } = load('ai-personal-agent-runs.controller');
const { validateAiCatalog } = load('ai-center-policy');
const { AiCenterProviderService, compileAgent } = load('ai-center-provider');
const { CLIENT_WORKSPACE_PERMISSION: P } = require(resolve('apps/api/src/client-workspaces/client-workspace-permissions.ts'));
const agentId = '7ac902e2-d7fa-44f0-82bd-2a4c27f7c009';
const skillId = 'e39285c8-78eb-45bc-81c5-9be1bfcdaf3b';
const nonce = '5b6a584e-7ada-4610-8019-8afbc58c21fa';

// These doubles exercise actual source logic OFFLINE. They are deliberately NOT PG/JobService proof.
function fixture() {
  const catalog = syntheticAiCatalog('env://AIJ_SECRET_AIJ_FOUNDATION_TEST_AI_CENTER_KEY');
  catalog.providers.forEach(p => { p.liveEnabled = true; p.vendor = 'compatible'; });
  const a = { id: agentId, code: 'private-test', name: 'Private', instructions: 'PRIVATE_AGENT', enabled: true, published_revision: 2, publication_version: 1,
    model_code: 'advice-text', model_revision: 1, catalog_version: 4, input_fields: ['text'], output_format: 'text', output_fields: [], revision: 2 };
  const v = { ...a, id: 'version-2', skill_binding_count: 1 };
  const skill = { id: 'skill-version-1', skill_id: skillId, name: 'Pinned', instructions: 'PINNED_V1', revision: 1, position: 0 };
  const state = { a, v, skill, catalog, currentRevision: 2, skillDeleted: false, denied: false, permissions: [], reservations: 0,
    jobs: 0, runs: [], transport: 0, credentialReads: 0, sql: [], writes: 0, traces: [], lease: nonce, jobStatus: 'running', leaseExpired: false };
  const tx = {
    // Legacy fixture explicitly has no workflow-origin row; production checks the real new table.
    aiPersonalWorkflowRunOrigin: { findUnique: async () => null },
    // This legacy offline fixture has no document origin; production queries the protected real table.
    aiPersonalDocumentRunOrigin: { findUnique: async () => null },
    $executeRaw: async strings => { state.sql.push(strings.join('?')); },
    $queryRaw: async (strings, ...values) => {
      const q = strings.join('?'); state.sql.push(q);
      if (q.includes('ai_personal_agent_skill_binding')) return state.skillDeleted ? [] : (state.skills || [state.skill]);
      if (q.includes('ai_personal_agent_version')) return [state.v];
      if (q.includes('ai_personal_agent')) return state.a ? [state.a] : [];
      if (q.includes('runtime_job')) return values.length === 1 || (!state.leaseExpired && values.includes(state.lease) && values.includes('same-worker') && values.includes(1)) ? [{ id: 'job-1', status: state.jobStatus, scope_id: 'project', workspace_id: 'space' }] : [];
      return [{ id: 'locked' }];
    },
    aiAgentRun: {
      findUnique: async () => state.runs[0] || null,
      findUniqueOrThrow: async () => { if (!state.runs[0]) throw new Error('absent'); return state.runs[0]; },
      create: async ({ data }) => { const r = { ...data, status: 'queued', budgetStatus: 'reserved', createdAt: new Date(), attemptedAt: null }; state.runs.push(r); return r; },
      update: async ({ data }) => { state.writes++; Object.assign(state.runs[0], data); return state.runs[0]; }
    },
    aiExecutionTrace: {
      upsert: async ({ create }) => { state.writes++; const r = { ...create, id: 'trace', status: 'running' }; state.traces.push(r); return r; },
      updateMany: async ({ data }) => { state.writes++; Object.assign(state.traces[0], data); return { count: 1 }; },
      findMany: async () => state.traces.filter(t => t.status === 'running')
    }
  };
  let serial = Promise.resolve();
  const prisma = { ...tx, memberUser: { findFirst: async () => ({ id: 'owner' }) }, $transaction: operation => { const result = serial.then(() => operation(tx)); serial = result.catch(() => {}); return result; } };
  const workspaces = { resolve: async () => {}, assertWritePermissionInTransaction: async (store, member, space, permission) => {
    assert.equal(store, tx); state.permissions.push(permission); if (state.denied || member !== 'owner' || space !== 'space') throw new Error('permission denied');
  } };
  const plugins = { assertEnabled: async () => {}, projectId: async () => 'project', assertEnabledInTransaction: async () => { if (state.denied) throw new Error('disabled'); } };
  const configuration = { current: async () => ({ projectId: 'project', version: 4, catalog }), approvedBases: () => [] };
  const config = { get: key => ['AI_CENTER_LIVE_ENABLED', 'AI_CENTER_CLIENT_EXECUTION_ENABLED'].includes(key) ? 'true' : undefined, getOrThrow: () => 'https://web.invalid' };
  const transport = { request: async (_url, init) => {
    state.transport++; state.lastBody = JSON.parse(init.body);
    if (state.transportError) throw new Error('response lost');
    if (state.onTransport) await state.onTransport();
    return new Response(JSON.stringify({ model: 'synthetic-text-v1', choices: [{ finish_reason: 'stop', message: { content: a.output_format === 'json' ? '{"answer":"ok"}' : 'ok' } }], usage: { prompt_tokens: 10, completion_tokens: 4 } }), { headers: { 'content-type': 'application/json' } });
  } };
  const provider = new AiCenterProviderService(config, transport);
  const budget = { reserve: async () => { state.reservations++; return 100n; }, estimate: () => 20n,
    settle: async (_tx, _id, amount) => { state.writes++; state.settled = amount; } };
  const secrets = { configuredTrusted: async () => true, resolveTrusted: async () => { state.credentialReads++; if (state.onCredential) await state.onCredential(); return 'synthetic'; } };
  const jobs = { enqueueInTransaction: async (_tx, input) => { state.jobs++; state.job = input; } };
  const traces = { fail: async () => { state.writes++; state.traces[0].status = 'failed'; }, succeed: async () => { state.writes++; state.traces[0].status = 'succeeded'; } };
  const snapshots = new AiPersonalAgentSnapshotsService();
  const runs = new AiCenterRunService(prisma, workspaces, plugins, configuration, provider, budget, secrets, jobs, {}, traces, {}, {}, config, snapshots, { select: async () => ({ refs: [], context: [] }), revalidate: async () => [] });
  const submit = (body = {}) => runs.submitPersonal('owner', 'space', agentId, { input: { text: 'hello' }, idempotencyKey: 'personal-key', expectedRevision: 2, ...body });
  const job = () => ({ id: state.runs[0].jobId, payload: { runId: state.runs[0].id }, leaseOwner: 'same-worker', leaseNonce: nonce, attempt: 1, signal: new AbortController().signal });
  return { state, tx, runs, snapshots, submit, job, config, configuration };
}

test('strict boundary rejects source/context/model/tool/script and revision forgery', async () => {
  for (const body of [null, [], {}, { input: {}, idempotencyKey: 'personal-key' }, { input: {}, idempotencyKey: 'personal-key', expectedRevision: '2' }]) assert.throws(() => personalAgentRunRequest(agentId, body));
  for (const field of ['model', 'provider', 'snapshot', 'source', 'memberId', 'workspaceId', 'tools', 'scripts', 'knowledge', 'memory', 'fallback', 'BYOK']) {
    const f = fixture(); await assert.rejects(async () => f.submit({ [field]: 'forged' })); assert.equal(f.state.jobs, 0);
  }
  for (const input of [[], null, { text: '' }, { text: 'x'.repeat(2001) }, { text: 'hi', provider: 'bad' }, Object.assign(Object.create({ inherited: 'x' }), { text: 'hi' })]) {
    const f = fixture(); await assert.rejects(f.submit({ input })); assert.equal(f.state.reservations, 0);
  }
});
test('immutable historical Skill order and provenance come only from DB', async () => {
  const f = fixture(); const s = await f.snapshots.resolve(f.tx, await f.configuration.current(), 'owner', 'space', agentId, 2);
  assert.equal(s.agent.code, 'personal:' + agentId); assert.doesNotMatch(s.agent.code, /^[a-z][a-z0-9-]{1,62}$/); assert.equal(s.source.versionId, 'version-2');
  assert.equal(s.skills[0].revision, 1); assert.match(compileAgent(s, { text: 'hello' })[0].content, /PRIVATE_AGENT\n\nPINNED_V1/);
  f.state.currentRevision = 99; // Mutable Skill's later version is intentionally irrelevant to the historical join.
  assert.deepEqual(await f.snapshots.resolve(f.tx, await f.configuration.current(), 'owner', 'space', agentId, 2), s);
  f.state.skillDeleted = true; await assert.rejects(f.submit()); assert.equal(f.state.reservations, 0);
});
test('multiple immutable Skill pins preserve binding order in compilation', async () => {
  const f = fixture(); f.state.v.skill_binding_count = 2;
  f.state.skills = [f.state.skill, { ...f.state.skill, id: 'skill-version-other', skill_id: '27870614-6339-41e9-b4ce-dbe55b074f9e', instructions: 'SECOND_PIN', position: 1 }];
  const s = await f.snapshots.resolve(f.tx, await f.configuration.current(), 'owner', 'space', agentId, 2);
  assert.match(compileAgent(s, { text: 'hello' })[0].content, /^PRIVATE_AGENT\n\nPINNED_V1\n\nSECOND_PIN/);
  assert.deepEqual(s.source.skills.map(s => s.versionId), ['skill-version-1', 'skill-version-other']);
});
test('private active revision/model/provider/version/binding and context gates deny before reserve', async () => {
  for (const change of [f => { f.state.a = null; }, f => { f.state.a.enabled = false; }, f => { f.state.a.revision++; },
    f => { f.state.v.instructions = 'corrupt'; }, f => { f.state.v.skill_binding_count = 2; }, f => { f.state.skill.position = 2; },
    f => { f.state.catalog.models[0].revision++; }, f => { f.state.catalog.models[0].enabled = false; },
    f => { f.state.catalog.providers[0].enabled = false; }, f => { f.state.catalog.providers[0].liveEnabled = false; },
    f => { f.state.catalog.models[0].contextTokens = 1100; }, f => { f.state.denied = true; }]) {
    const f = fixture(); change(f); await assert.rejects(f.submit()); assert.equal(f.state.jobs, 0); assert.equal(f.state.transport, 0); assert.equal(f.state.reservations, 0);
  }
});
test('shared run key canonical replay produces one Job/reserve; other input/source/revision conflicts', async () => {
  const f = fixture(); const [a, b] = await Promise.all([f.submit(), f.submit()]); assert.equal(a.id, b.id);
  assert.equal(f.state.jobs, 1); assert.equal(f.state.reservations, 1); assert.equal(f.state.job.maxAttempts, 1);
  assert.deepEqual(new Set(f.state.permissions), new Set([P.aiExecute, P.aiAssetsRead]));
  await assert.rejects(f.submit({ input: { text: 'different' } }), /idempotency/);
  await assert.rejects(f.submit({ expectedRevision: 3 }), /idempotency/);
  await assert.rejects(f.runs.submit('owner', 'space', 'buddy-advice', { input: { text: 'hello' }, idempotencyKey: 'personal-key' }), /idempotency/);
});
test('one pipeline executes private text/JSON and settles existing Trace/budget', async () => {
  for (const format of ['text', 'json']) {
    const f = fixture(); f.state.a.output_format = f.state.v.output_format = format; f.state.a.output_fields = f.state.v.output_fields = format === 'json' ? ['answer'] : [];
    await f.submit(); await f.runs.execute(f.job());
    assert.equal(f.state.runs[0].status, 'succeeded'); assert.equal(f.state.transport, 1); assert.equal(f.state.traces.length, 1);
    assert.equal(f.state.settled, 20n); assert.match(f.state.lastBody.messages[0].content, /PINNED_V1/);
    assert.equal(JSON.stringify(f.state.traces).includes('hello'), false);
  }
});
test('dispatch revocation denies before credential/transport and releases unused reservation', async () => {
  for (const revoke of [f => { f.state.skillDeleted = true; }, f => { f.state.a.enabled = false; },
    f => { f.state.catalog.models[0].revision++; }, f => { f.state.denied = true; }]) {
    const f = fixture(); await f.submit(); revoke(f); await f.runs.execute(f.job());
    assert.equal(f.state.transport, 0); assert.equal(f.state.credentialReads, 0); assert.equal(f.state.runs[0].status, 'failed'); assert.equal(f.state.settled, 0n);
  }
});
test('dependency revocation during credential IO is rechecked before transport', async () => {
  const f = fixture(); await f.submit(); f.state.onCredential = async () => { f.state.skillDeleted = true; };
  await f.runs.execute(f.job()); assert.equal(f.state.transport, 0); assert.equal(f.state.runs[0].attemptedAt, null);
  assert.equal(f.state.settled, 0n); assert.equal(f.state.traces[0].status, 'failed');
});
test('legacy catalog snapshot without provenance uses the same provider/Trace/budget pipeline', async () => {
  const f = fixture(); await f.runs.submit('owner', 'space', 'buddy-advice', { input: { selfType: 'ENFP', buddyType: 'INTJ' }, idempotencyKey: 'legacy-catalog-key' });
  assert.equal(f.state.runs[0].snapshot.source, undefined); await f.runs.execute(f.job());
  assert.equal(f.state.runs[0].status, 'succeeded'); assert.equal(f.state.transport, 1); assert.equal(f.state.settled, 20n);
});
test('missing/malformed/stale nonce, expired lease and wrong worker fail closed on every mutation', async () => {
  for (const patch of [{ leaseNonce: undefined }, { leaseNonce: 'bad' }, { leaseNonce: '1b6a584e-7ada-4610-8019-8afbc58c21fa' }, { leaseOwner: undefined }, { leaseOwner: 'other-worker' }, { attempt: undefined }, { attempt: 2 }]) {
    const f = fixture(); await f.submit(); await assert.rejects(f.runs.execute({ ...f.job(), ...patch }));
    assert.equal(f.state.writes, 0); assert.equal(f.state.transport, 0); assert.equal(f.state.settled, undefined);
  }
  const f = fixture(); await f.submit(); f.state.leaseExpired = true; await assert.rejects(f.runs.execute(f.job())); assert.equal(f.state.writes, 0); assert.equal(f.state.transport, 0);
});
test('old callback cannot write output, fail trace or settle a newer same-worker nonce', async () => {
  const f = fixture(); await f.submit();
  f.state.onTransport = async () => { f.state.lease = '1b6a584e-7ada-4610-8019-8afbc58c21fa'; f.state.writesAtLoss = f.state.writes; };
  await assert.rejects(f.runs.execute(f.job())); assert.equal(f.state.writes, f.state.writesAtLoss); assert.equal(f.state.settled, undefined);
  assert.equal(f.state.runs[0].status, 'running'); assert.equal(f.state.runs[0].output, undefined);
});
test('ambiguous response retains budget and does not resend on reentry', async () => {
  const f = fixture(); await f.submit(); f.state.transportError = true; await f.runs.execute(f.job());
  assert.equal(f.state.runs[0].status, 'unknown'); assert.equal(f.state.runs[0].budgetStatus, 'reserved'); assert.equal(f.state.settled, undefined);
  await f.runs.execute(f.job()); assert.equal(f.state.transport, 1);
});
test('same origin/feature/session/strict query checks and no-store guard apply', () => {
  const f = fixture(), controller = new AiPersonalAgentRunsController(new AiPersonalAgentRunsService(f.runs), f.config);
  const request = { headers: { origin: 'https://foreign.invalid' }, client: { id: 'owner' }, workspaceContext: { workspaceId: 'space' } };
  assert.throws(() => controller.submit(agentId, {}, {}, request), /origin/);
  request.headers.origin = 'https://web.invalid'; assert.throws(() => controller.submit(agentId, {}, { source: 'forged' }, request));
  request.headers['sec-fetch-site'] = 'cross-site'; assert.throws(() => controller.submit(agentId, {}, {}, request), /origin/);
  let header; new PersonalAgentRunNoStoreGuard().canActivate({ switchToHttp: () => ({ getResponse: () => ({ setHeader: (_k, value) => { header = value; } }) }) }); assert.match(header, /no-store/);
});
test('SDK factory narrows submission and uses existing ClientApi workspace/transport', async () => {
  const source = ts.transpileModule(readFileSync('packages/sdk/src/personal-agent-runs.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const mod = { exports: {} }; new Function('exports', source)(mod.exports); const calls = [];
  const client = mod.exports.createPersonalAgentRunsClient((...args) => { calls.push(args); return Promise.resolve({ id: 'run' }); });
  const body = { input: { text: 'hello' }, idempotencyKey: 'sdk-personal-key', expectedRevision: 2 };
  assert.deepEqual(await client.submit('space', agentId, body), { id: 'run' }); assert.equal(calls[0][1].workspaceId, 'space');
  assert.equal(calls[0][0], '/client/ai/personal-agents/' + agentId + '/runs'); assert.deepEqual(JSON.parse(calls[0][1].body), body);
  assert.throws(() => client.submit('space', agentId, { ...body, provider: 'forged' })); assert.equal(calls.length, 1);
});

test('valid legacy p-UUID catalog code still lists/submits/executes with its unchanged hash', async () => {
  const f = fixture(), code = 'p-' + agentId;
  f.state.catalog.agents.push({ ...f.state.catalog.agents[0], code, inputFields: ['alpha', 'text'] });
  f.state.a.input_fields = f.state.v.input_fields = ['alpha', 'text'];
  validateAiCatalog(f.state.catalog); // Existing catalog policy accepts p-UUID without changes.
  const listed = await f.runs.agents('owner', 'space'); assert.ok(listed.some(a => a.code === code));
  const body = { input: { text: 'hello', alpha: 'first' }, idempotencyKey: 'legacy-p-uuid-key' };
  const admitted = await f.runs.submit('owner', 'space', code, body);
  const originalHash = createHash('sha256').update(JSON.stringify([code, [['alpha', 'first'], ['text', 'hello']]])).digest('hex');
  assert.equal(f.state.runs[0].requestHash, originalHash); assert.equal(admitted.agentCode, code);
  const replay = await f.runs.submit('owner', 'space', code, { ...body, input: { alpha: 'first', text: 'hello' } });
  assert.equal(replay.id, admitted.id); assert.equal(f.state.jobs, 1); assert.equal(f.state.reservations, 1);
  await assert.rejects(f.runs.submitPersonal('owner', 'space', agentId, { ...body, expectedRevision: 2 }), /idempotency/);
  assert.equal(f.state.jobs, 1); assert.equal(f.state.reservations, 1);
  await f.runs.execute(f.job()); assert.equal(f.state.runs[0].status, 'succeeded'); assert.equal(f.state.transport, 1);
});
