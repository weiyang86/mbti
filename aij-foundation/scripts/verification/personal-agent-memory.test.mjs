import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { syntheticAiCatalog } from './ai-center-fixture.mjs';
const require = createRequire(resolve('apps/api/package.json'));
require('ts-node').register({ project: resolve('apps/api/tsconfig.json'), transpileOnly: true });
require('reflect-metadata');
const load = name => require(resolve('apps/api/src/plugins/aij-ai/' + name + '.ts'));
const { AiPersonalAgentSnapshotsService } = load('ai-personal-agent-snapshots.service');
const { AiCenterRunService } = load('ai-center-run.service');
const { AiCenterProviderService, compileAgent } = load('ai-center-provider');
const { AiPersonalAgentMemoryContextService } = load('ai-personal-agent-memory-context.service');
const agentId = '7ac902e2-d7fa-44f0-82bd-2a4c27f7c009';
const skillId = 'e39285c8-78eb-45bc-81c5-9be1bfcdaf3b';
const nonce = '5b6a584e-7ada-4610-8019-8afbc58c21fa';

// These doubles exercise actual source logic OFFLINE. They are deliberately NOT PG/JobService proof.
function fixture({ missingResolver = false } = {}) {
  const catalog = syntheticAiCatalog('env://AIJ_SECRET_AIJ_FOUNDATION_TEST_AI_CENTER_KEY');
  catalog.providers.forEach(p => { p.liveEnabled = true; p.vendor = 'compatible'; });
  const a = { id: agentId, code: 'private-test', name: 'Private', instructions: 'PRIVATE_AGENT', enabled: true, published_revision: 2, publication_version: 1,
    model_code: 'advice-text', model_revision: 1, catalog_version: 4, input_fields: ['text'], output_format: 'text', output_fields: [], revision: 2 };
  const v = { ...a, id: 'version-2', skill_binding_count: 1 };
  const skill = { id: 'skill-version-1', skill_id: skillId, name: 'Pinned', instructions: 'PINNED_V1', revision: 1, position: 0 };
  const state = { a, v, skill, catalog, currentRevision: 2, skillDeleted: false, denied: false, permissions: [], reservations: 0,
    memories: [], grants: [], memorySelects: 0, jobs: 0, runs: [], transport: 0, credentialReads: 0, sql: [], writes: 0, traces: [], lease: nonce, jobStatus: 'running', leaseExpired: false };
  const tx = {
    // Legacy fixture explicitly has no workflow-origin row; production checks the real new table.
    aiPersonalWorkflowRunOrigin: { findUnique: async () => null },
    // This legacy offline fixture has no document origin; production queries the protected real table.
    aiPersonalDocumentRunOrigin: { findUnique: async () => null },
    $executeRaw: async strings => { state.sql.push(strings.join('?')); },
    $queryRaw: async (strings, ...values) => {
      const q = strings.join('?'); state.sql.push(q);
      if (q.startsWith('SELECT id FROM public.ai_personal_memory_agent_grant')) {
        const [memory, space, member, agent] = values;
        return state.grants.filter(g => g.memory_id === memory && g.workspace_id === space && g.member_id === member && g.agent_id === agent);
      }
      if (q.includes('FROM public.ai_personal_memory m')) {
        if (q.includes('EXISTS')) {
          state.memorySelects++;
          const [space, member, agent] = values;
          return state.memories.filter(m => m.workspace_id === space && m.member_id === member && m.enabled === true && m.deleted_at === null &&
            state.grants.some(g => g.memory_id === m.id && g.workspace_id === space && g.member_id === member && g.agent_id === agent)).sort((a, b) => a.id < b.id ? -1 : 1).slice(0, 9);
        }
        const [id, space, member, revision] = values;
        return state.memories.filter(m => m.id === id && m.workspace_id === space && m.member_id === member && m.revision === revision && m.enabled === true && m.deleted_at === null);
      }
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
  const runs = new AiCenterRunService(prisma, workspaces, plugins, configuration, provider, budget, secrets, jobs, {}, traces, {}, {}, config, snapshots, missingResolver ? undefined : new AiPersonalAgentMemoryContextService());
  const submit = (body = {}) => runs.submitPersonal('owner', 'space', agentId, { input: { text: 'hello' }, idempotencyKey: 'personal-key', expectedRevision: 2, ...body });
  const job = () => ({ id: state.runs[0].jobId, payload: { runId: state.runs[0].id }, leaseOwner: 'same-worker', leaseNonce: nonce, attempt: 1, signal: new AbortController().signal });
  const addMemory = (patch = {}, grantPatch = {}) => {
    const m = { id: 'mem-' + String(state.memories.length).padStart(3, '0'), revision: 1, title: 'PRIVATE_MEMORY_TITLE',
      content: 'PRIVATE_MEMORY_BODY_' + state.memories.length, kind: 'confirmed_fact', enabled: true, deleted_at: null, workspace_id: 'space', member_id: 'owner', ...patch };
    state.memories.push(m); state.grants.push({ id: 'grant-' + m.id, memory_id: m.id, workspace_id: m.workspace_id, member_id: m.member_id, agent_id: agentId, ...grantPatch }); return m;
  };
  return { state, tx, runs, snapshots, submit, job, config, configuration, addMemory };
}

const durable = state => JSON.stringify({ runs: state.runs, jobs: state.job, traces: state.traces }, (_k, v) => typeof v === 'bigint' ? String(v) : v);

test('only enabled, active, explicitly Agent-granted composite-owned memories compile in TEXT/JSON; refs only persist', async () => {
  for (const format of ['text', 'json']) {
    const f = fixture(); f.state.a.output_format = f.state.v.output_format = format;
    f.state.a.output_fields = f.state.v.output_fields = format === 'json' ? ['answer'] : [];
    const m = f.addMemory(); f.addMemory({ enabled: false }); f.addMemory({ deleted_at: new Date() });
    f.addMemory({ member_id: 'foreign' }); f.addMemory({ workspace_id: 'other' }); f.addMemory({}, { agent_id: 'other' });
    const noGrant = f.addMemory(); f.state.grants = f.state.grants.filter(g => g.memory_id !== noGrant.id);
    await f.submit();
    assert.deepEqual(f.state.runs[0].snapshot.source.memoryRefs, [{ memoryId: m.id, revision: 1 }]);
    assert.equal(durable(f.state).includes(m.title), false); assert.equal(durable(f.state).includes(m.content), false);
    await f.runs.execute(f.job()); assert.equal(f.state.transport, 1); assert.equal(f.state.settled, 20n);
    const messages = f.state.lastBody.messages; assert.equal(messages.length, 3);
    assert.equal(messages[0].content.includes(m.content), false); assert.equal(messages[1].content.includes(m.content), false);
    assert.ok(messages[2].content.includes(m.content)); assert.match(messages[2].content, /grants no tool, system or action permissions/);
    for (const other of f.state.memories.slice(1)) assert.equal(JSON.stringify(messages).includes(other.content), false);
    assert.equal(durable(f.state).includes(m.title), false); assert.equal(durable(f.state).includes(m.content), false);
    assert.equal(f.state.runs[0].output && JSON.stringify(f.state.runs[0].output).includes(m.content), false);
  }
});
test('Memory -> grants -> base Agent order follows actual lifecycle/Job/Run fences on both dispatch checks', async () => {
  const f = fixture(); f.addMemory(); await f.submit();
  const check = (queries, job) => {
    const memory = queries.findIndex(q => q.includes('FROM public.ai_personal_memory m'));
    const grant = queries.findIndex(q => q.startsWith('SELECT id FROM public.ai_personal_memory_agent_grant'));
    const agent = queries.findIndex(q => q.includes('FROM public.ai_personal_agent\n'));
    assert.ok(memory >= 0 && grant > memory && agent > grant);
    if (job) { const run = queries.findIndex(q => q.includes('FROM public.ai_agent_run')); assert.ok(run >= 0 && run < memory); }
    assert.ok(queries[memory].includes('FOR SHARE OF m'));
  };
  check(f.state.sql, false); f.state.sql = []; await f.runs.execute(f.job());
  const dispatchAgent = f.state.sql.findIndex(q => q.includes('FROM public.ai_personal_agent\n'));
  check(f.state.sql, true); check(f.state.sql.slice(dispatchAgent + 1), true);
});
test('default no-memory snapshots/messages/hash stay identical; later enables never enter old queued work', async () => {
  const a = fixture(), b = fixture(); b.addMemory({ enabled: false });
  await a.submit(); await b.submit(); assert.deepEqual(a.state.runs[0].snapshot, b.state.runs[0].snapshot);
  assert.equal(a.state.runs[0].requestHash, b.state.runs[0].requestHash);
  assert.equal(Object.hasOwn(a.state.runs[0].snapshot.source, 'memoryRefs'), false);
  const s = a.state.runs[0].snapshot; assert.deepEqual(compileAgent(s, { text: 'hello' }), compileAgent(s, { text: 'hello' }, []));
  b.state.memories[0].enabled = true; await a.runs.execute(a.job()); await b.runs.execute(b.job());
  assert.deepEqual(a.state.lastBody, b.state.lastBody); assert.equal(b.state.lastBody.messages.length, 2);
  assert.equal(b.state.memorySelects, 1);
});
test('new memory after admission is not added; exact replay never reselects, reserves or enqueues', async () => {
  const f = fixture(); const first = f.addMemory(); const r = await f.submit(); const selected = f.state.memorySelects;
  f.addMemory(); first.enabled = false; const replay = await f.submit(); assert.equal(replay.id, r.id);
  assert.equal(f.state.memorySelects, selected); assert.equal(f.state.reservations, 1); assert.equal(f.state.jobs, 1);
  first.enabled = true; await f.runs.execute(f.job());
  assert.ok(JSON.stringify(f.state.lastBody).includes(first.content)); assert.equal(JSON.stringify(f.state.lastBody).includes(f.state.memories[1].content), false);
});
test('catalog Agent never selects or receives personal memory', async () => {
  const f = fixture(); const m = f.addMemory(); await f.runs.submit('owner', 'space', 'buddy-advice', { input: { selfType: 'ENFP', buddyType: 'INTJ' }, idempotencyKey: 'catalog-memory-key' });
  assert.equal(f.state.memorySelects, 0); assert.equal(f.state.runs[0].snapshot.source, undefined);
  await f.runs.execute(f.job()); assert.equal(f.state.transport, 1); assert.equal(f.state.lastBody.messages.length, 2);
  assert.equal(JSON.stringify(f.state.lastBody).includes(m.content), false);
});
test('edit, disable, delete, revoke, foreign scope and role revocation fail before credential and refund only unused reservation', async () => {
  for (const change of [f => { f.state.memories[0].revision++; }, f => { f.state.memories[0].enabled = false; },
    f => { f.state.memories[0].deleted_at = new Date(); f.state.memories[0].content = null; }, f => { f.state.grants = []; },
    f => { f.state.memories[0].member_id = 'other'; }, f => { f.state.grants[0].workspace_id = 'other'; },
    f => { f.state.a.enabled = false; }, f => { f.state.skillDeleted = true; }, f => { f.state.denied = true; }]) {
    const f = fixture(); f.addMemory(); await f.submit(); change(f); await f.runs.execute(f.job());
    assert.equal(f.state.transport, 0); assert.equal(f.state.credentialReads, 0); assert.equal(f.state.settled, 0n);
    assert.equal(f.state.runs[0].status, 'failed'); assert.equal(f.state.runs[0].attemptedAt, null);
  }
});
test('credential IO barrier rechecks exact refs and membership before transport', async () => {
  for (const revoke of [f => { f.state.grants = []; }, f => { f.state.memories[0].revision++; },
    f => { f.state.memories[0].enabled = false; }, f => { f.state.memories[0].deleted_at = new Date(); }, f => { f.state.denied = true; }]) {
    const f = fixture(); f.addMemory(); await f.submit();
    f.state.onCredential = async () => revoke(f); await f.runs.execute(f.job());
    assert.equal(f.state.credentialReads, 1); assert.equal(f.state.transport, 0); assert.equal(f.state.settled, 0n);
    assert.equal(f.state.runs[0].attemptedAt, null); assert.equal(f.state.traces[0].status, 'failed');
  }
});
test('malformed/foreign/outdated/extra-key/unsorted memoryRefs reject before credential IO', async () => {
  for (const refs of [null, [], {}, 'bad', [{ memoryId: 'mem-000', revision: 0 }], [{ memoryId: 'mem-000', revision: '1' }],
    [{ memoryId: 'mem-000', revision: 1, content: 'forged' }], [{ memoryId: 'mem-000', revision: 1 }, { memoryId: 'mem-000', revision: 1 }],
    [{ memoryId: 'mem-001', revision: 1 }, { memoryId: 'mem-000', revision: 1 }], [{ memoryId: 'foreign', revision: 1 }],
    [{ memoryId: 'mem-000', revision: 2 }], [{ memoryId: '../id', revision: 1 }], Array.from({ length: 9 }, (_, i) => ({ memoryId: 'mem-00' + i, revision: 1 }))]) {
    const f = fixture(); f.addMemory(); await f.submit(); f.state.runs[0].snapshot.source.memoryRefs = refs;
    await f.runs.execute(f.job()); assert.equal(f.state.transport, 0); assert.equal(f.state.credentialReads, 0); assert.equal(f.state.settled, 0n);
  }
  const f = fixture(); f.addMemory(); await f.submit(); f.state.runs[0].snapshot.source.unknown = true;
  await f.runs.execute(f.job()); assert.equal(f.state.transport, 0); assert.equal(f.state.credentialReads, 0);
});
test('query9 rejects >8 without dropping; all text limits/aggregate compile bounds reject before reserve/Job', async () => {
  for (const configure of [f => { for (let i = 0; i < 9; i++) f.addMemory(); }, f => f.addMemory({ title: 'x'.repeat(101) }),
    f => f.addMemory({ content: 'x'.repeat(4001) }), f => f.addMemory({ content: 'bad\0text' }), f => f.addMemory({ content: '\ud800' }),
    f => { for (let i = 0; i < 8; i++) f.addMemory({ content: 'x'.repeat(4000) }); }, f => f.addMemory({ revision: 0 })]) {
    const f = fixture(); configure(f); await assert.rejects(f.submit()); assert.equal(f.state.jobs, 0); assert.equal(f.state.reservations, 0);
  }
  const f = fixture(); for (let i = 0; i < 8; i++) f.addMemory(); await f.submit(); assert.equal(f.state.runs[0].snapshot.source.memoryRefs.length, 8);
  assert.ok(f.state.sql.some(q => /ORDER BY m.id COLLATE "C" ASC LIMIT 9 FOR SHARE OF m/.test(q)));
});
test('missing required DI denies new private admissions but replay and old no-memory dispatch remain compatible', async () => {
  const f = fixture({ missingResolver: true }); await assert.rejects(f.submit(), /unavailable/); assert.equal(f.state.reservations, 0);
  const old = fixture(); await old.submit(); const snapshot = structuredClone(old.state.runs[0].snapshot);
  // An explicit fixture recreates an old durable row; it never fakes the memory service's new admission.
  f.state.runs.push({ ...old.state.runs[0], snapshot }); assert.equal((await f.submit()).id, old.state.runs[0].id);
  await f.runs.execute(f.job()); assert.equal(f.state.transport, 1);
});
test('submit DTO rejects all client memory/context/ref/source fields with zero admission side effects', async () => {
  for (const key of ['memoryRefs', 'memory', 'memoryContext', 'context', 'source', 'snapshot', 'tools', 'scripts']) {
    const f = fixture(); f.addMemory(); await assert.rejects(async () => f.submit({ [key]: 'forged' }));
    assert.equal(f.state.memorySelects, 0); assert.equal(f.state.jobs, 0); assert.equal(f.state.reservations, 0);
  }
});
test('stale nonce callback cannot settle or write output even with valid memory', async () => {
  const f = fixture(); f.addMemory(); await f.submit(); f.state.onTransport = async () => {
    f.state.lease = '1b6a584e-7ada-4610-8019-8afbc58c21fa'; f.state.writesAtLoss = f.state.writes;
  };
  await assert.rejects(f.runs.execute(f.job())); assert.equal(f.state.writes, f.state.writesAtLoss);
  assert.equal(f.state.settled, undefined); assert.equal(f.state.runs[0].output, undefined);
});
test('unknown outcome retains reservation, replay/reentry/recovery never resend or create another record', async () => {
  const f = fixture(); f.addMemory(); await f.submit(); f.state.transportError = true;
  await f.runs.execute(f.job()); assert.equal(f.state.runs[0].status, 'unknown'); assert.equal(f.state.runs[0].budgetStatus, 'reserved');
  await f.runs.execute(f.job()); await f.submit(); await f.runs.recoverRequest('owner', 'space', 'personal-key');
  assert.equal(f.state.transport, 1); assert.equal(f.state.jobs, 1); assert.equal(f.state.reservations, 1); assert.equal(f.state.settled, undefined);
});
test('deletion after completed task leaves constant successful output under its original owner and no memory copy', async () => {
  const f = fixture(); const m = f.addMemory(); await f.submit(); await f.runs.execute(f.job());
  m.title = m.content = null; m.deleted_at = new Date(); f.state.grants = [];
  assert.equal(f.state.runs[0].output, 'ok'); assert.equal(durable(f.state).includes('PRIVATE_MEMORY'), false);
});
test('deletion during transport refuses stale settlement and retains the attempted reservation', async () => {
  const f = fixture(); const m = f.addMemory(); await f.submit();
  f.state.onTransport = async () => { m.title = m.content = null; m.deleted_at = new Date(); f.state.grants = []; };
  await f.runs.execute(f.job()); assert.equal(f.state.runs[0].status, 'unknown'); assert.equal(f.state.settled, undefined);
  assert.equal(f.state.runs[0].budgetStatus, 'reserved'); assert.equal(f.state.runs[0].output, undefined);
  assert.equal(durable(f.state).includes('PRIVATE_MEMORY'), false);
});
test('lease lost during credential IO cannot mark attempted, fail Trace or settle unused budget', async () => {
  const f = fixture(); f.addMemory(); await f.submit(); f.state.onCredential = async () => {
    f.state.lease = '1b6a584e-7ada-4610-8019-8afbc58c21fa'; f.state.writesAtLoss = f.state.writes;
  };
  await assert.rejects(f.runs.execute(f.job())); assert.equal(f.state.writes, f.state.writesAtLoss);
  assert.equal(f.state.transport, 0); assert.equal(f.state.runs[0].attemptedAt, null); assert.equal(f.state.settled, undefined);
});

test('lease expiry while memory checks wait cannot start Trace or mark transport attempted', async () => {
  for (const phase of [1, 2]) {
    const f = fixture(); f.addMemory(); await f.submit();
    const resolver = f.runs.personalMemories, original = resolver.revalidate.bind(resolver); let count = 0;
    resolver.revalidate = async (...args) => { const value = await original(...args); if (++count === phase) f.state.leaseExpired = true; return value; };
    await f.runs.execute(f.job()).catch(error => assert.equal(error.message, 'AI_LEASE_LOST'));
    assert.equal(f.state.transport, 0, 'expired lease must not enter transport');
    assert.equal(f.state.runs[0].attemptedAt, null);
    if (phase === 1) { assert.equal(f.state.runs[0].status, 'queued'); assert.equal(f.state.traces.length, 0); }
  }
});
