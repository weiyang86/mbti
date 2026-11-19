// ROOT ONLY / Worker NOT_RUN. Requires fresh registered AF-167 lease, integrated AF161/163
// actual schema/controllers/module and AiPersonalAgentMemoryContextService provider wiring.
// Run original private/catalog TEXT/JSON/image, retention, consumer and fencing gates too.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { createRemainingClientFixture } from './remaining-client-fixture.mjs';
import { publishPersonalAgentFixture } from './personal-agent-publication-fixture.mjs';
import { prepareAiCenter } from './ai-center-fixture.mjs';
import { readDatabaseEnvironment, withDatabase } from '../database/connection.mjs';
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

test('AF-167 fresh actual API/JobService/PG/Trace/budget with RAM-only memory and owned loopback upstream', { timeout: 360000 }, async t => {
  assert.equal(process.env.AIJ_AF167_ROOT_LIVE, 'true');
  assert.equal(resolve(process.cwd()), '/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation');
  const git = flag => resolve(execFileSync('git', ['rev-parse', flag], { encoding: 'utf8' }).trim());
  assert.equal(git('--git-dir'), git('--git-common-dir'));
  assert.equal(execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim(), 'dev');
  const f = await createRemainingClientFixture('AF-167', { configuration: true, secrets: true, runtimeManagement: true, pluginManagement: true, storageEnabled: true, realPluginLifecycle: true });
  const database = readDatabaseEnvironment('test', process.env, f.lease.id);
  const db = op => withDatabase('test', database, op, { acceptanceId: f.lease.id });
  const proof = { task: 'AF-167', acceptanceId: f.lease.id, database: f.lease.database, status: 'EVIDENCE_ONLY_FORMAL_REPORT_IS_AUTHORITY', plaintextLeaks: 0, observedCrudWaits: 0 };
  const { JobService } = f.requireApi('async-runtime/job.service.js');
  const { RuntimeRegistry } = f.requireApi('async-runtime/registry.js');
  const { AiCenterHttpTransport, compileAgent } = f.requireApi('plugins/aij-ai/ai-center-provider.js');
  const { AiPersonalAgentMemoryContextService } = f.requireApi('plugins/aij-ai/ai-personal-agent-memory-context.service.js');
  const { SecretRefPort } = f.requireApi('secret-center/secret-ref.js');
  let jobs, memoryService, secrets, originalSecret, originalRevalidate, concurrentApp, concurrentBase;
  const opt = { cookie: f.cookies[0], workspaceId: f.workspaces[0].id };
  let server, calls = 0, lastBody, mode = 'text', holdEntered, holdRelease, agent, ai, transport;
  const request = async (method, path, { status = 200, body, ...options } = {}) => {
    const o = { ...opt, ...options };
    const response = await fetch((o.targetBase ?? f.baseUrl) + '/' + path, { method, headers: { connection: 'close', cookie: o.cookie,
      origin: process.env.WEB_URL, 'x-aij-workspace-id': o.workspaceId, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    const text = await response.text(); assert.equal(response.status, status, 'Unexpected HTTP status (body intentionally omitted)');
    if (path.startsWith('client/ai/')) assert.match(response.headers.get('cache-control') || '', /no-store/);
    return text ? JSON.parse(text).data : null;
  };
  const makeAgent = async (options = {}, format = 'text') => {
    const model = await request('GET', 'client/ai/personal-agents/model-options', options);
    const created = await request('POST', 'client/ai/personal-agents', { ...options, status: 201, body: { code: 'af167-' + randomUUID(), name: 'Synthetic private Agent',
      instructions: 'PRIVATE_AGENT_BASE', enabled: true, modelCode: 'advice-text', modelRevision: model.items.find(m => m.code === 'advice-text').revision,
      catalogVersion: model.catalogVersion, inputFields: ['text'], outputFormat: format, outputFields: format === 'json' ? ['answer'] : [], skillBindings: [] } });
    return publishPersonalAgentFixture(request, created, options);
  };
  const makeMemory = async (patch = {}, options = {}) => request('POST', 'client/ai/personal-memories', { ...options, status: 201, body: {
    code: 'af167-' + randomUUID(), title: 'PRIVATE_TITLE_' + randomUUID(), content: 'PRIVATE_BODY_' + randomUUID(), kind: 'confirmed_fact', enabled: true, agentIds: [agent.id], ...patch } });
  const edit = (m, patch = {}, options = {}) => { const { title, content, kind, enabled, agentIds, revision } = m;
    return request('PATCH', 'client/ai/personal-memories/' + m.id, { ...options, body: { title, content, kind, enabled, agentIds, expectedRevision: revision, ...patch } }); };
  const erase = (m, options = {}) => request('DELETE', 'client/ai/personal-memories/' + m.id, { ...options, body: { expectedRevision: m.revision } });
  const submit = (key = 'af167-' + randomUUID(), a = agent, status = 202) => request('POST', 'client/ai/personal-agents/' + a.id + '/runs', { status, body: {
    input: { text: 'SYNTHETIC_TASK_INPUT' }, idempotencyKey: key, expectedRevision: a.revision } });
  const counts = async () => [await f.prisma.aiAgentRun.count(), await f.prisma.runtimeJob.count({ where: { jobType: 'aij-ai.agent-execute' } }), await f.prisma.aiEvaluationBudgetReservation.count(), calls];
  const claim = async () => { const rows = await jobs.claim('af167-worker', 1, 60000); assert.equal(rows.length, 1); return rows[0]; };
  const execute = async () => { const job = await claim(); await jobs.execute(job); return job; };
  const row = id => f.prisma.aiAgentRun.findUniqueOrThrow({ where: { id } });
  const deniedRun = async (id, beforeCalls) => {
    const r = await row(id); assert.equal(r.status, 'failed'); assert.equal(r.attemptedAt, null);
    assert.equal(r.budgetStatus, 'released'); assert.equal(calls, beforeCalls);
    const reservation = await f.prisma.aiEvaluationBudgetReservation.findUniqueOrThrow({ where: { id } });
    assert.equal(reservation.status, 'settled'); assert.equal(reservation.chargedNanos, 0n);
    assert.equal(r.estimatedCostNanos, 0n);
  };
  // Query every actual public table. Current body exists only in its AF163 owner before erasure.
  // Never write captured messages, body, title, digests or row dumps to evidence files.
  const scanPlaintext = async (memories, currentAllowed) => db(async client => {
    const tables = (await client.query("SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname='public'")).rows;
    let leaks = 0;
    for (const { tablename } of tables) {
      assert.match(tablename, /^[A-Za-z_][A-Za-z0-9_]*$/);
      for (const m of memories) {
        const allowCurrent = currentAllowed && tablename === 'ai_personal_memory';
        const result = await client.query('SELECT count(*)::int AS count FROM public."' + tablename + '" t WHERE (strpos(row_to_json(t)::text,$1)>0 OR strpos(row_to_json(t)::text,$2)>0)' + (allowCurrent ? ' AND t.id <> $3' : ''), allowCurrent ? [m.title, m.content, m.id] : [m.title, m.content]);
        leaks += result.rows[0].count;
      }
    }
    assert.equal(leaks, 0, 'Plaintext escaped its current memory owner'); return leaks;
  });
  try {
    jobs = f.app.get(JobService); memoryService = f.app.get(AiPersonalAgentMemoryContextService); secrets = f.app.get(SecretRefPort);
    originalSecret = secrets.resolveTrusted; originalRevalidate = memoryService.revalidate;
    assert.equal(Object.getPrototypeOf(jobs), JobService.prototype);
    assert.equal(f.app.get(RuntimeRegistry).jobRegistration('aij-ai.agent-execute', 1).executionMode, 'orchestrated');
    assert.equal(Object.getPrototypeOf(memoryService), AiPersonalAgentMemoryContextService.prototype);
    ai = await prepareAiCenter(f); const catalog = structuredClone(ai.catalog);
    catalog.providers.forEach(p => { p.liveEnabled = true; }); await ai.save(catalog);
    process.env.AI_CENTER_LIVE_ENABLED = 'true'; process.env.AI_CENTER_CLIENT_EXECUTION_ENABLED = 'true';
    // The network boundary alone is redirected; all authorization, compiler, Job, Trace and budget owners are real.
    server = createServer(async (req, res) => {
      calls++; let raw = ''; for await (const b of req) raw += b; lastBody = JSON.parse(raw);
      assert.equal(req.headers.authorization, 'Bearer ' + ai.credential);
      if (mode === 'hold') { holdEntered.resolve(); await holdRelease.promise; }
      if (mode === 'lost') { req.socket.destroy(); return; }
      res.setHeader('content-type', 'application/json');
      if (req.url === '/v1/images/generations') {
        res.end(JSON.stringify({ data: [{ b64_json: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jfP8AAAAASUVORK5CYII=' }] })); return;
      }
      assert.equal(req.url, '/v1/chat/completions');
      // Constant synthetic output: no manufactured echo conceals persisted bookkeeping copies.
      res.end(JSON.stringify({ model: lastBody.model, choices: [{ finish_reason: 'stop', message: { content: mode === 'json' ? '{"answer":"CONSTANT_OUTPUT"}' : 'CONSTANT_OUTPUT' } }], usage: { prompt_tokens: 20, completion_tokens: 10 } }));
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r)); transport = f.app.get(AiCenterHttpTransport);
    transport.request = (url, init) => { assert.ok(['https://api.openai.com/v1/chat/completions', 'https://api.openai.com/v1/images/generations'].includes(url));
      assert.equal(init.redirect, 'error'); return fetch('http://127.0.0.1:' + server.address().port + new URL(url).pathname, init); };
    const otherSpace = f.workspaces[1].id;
    for (const [memberId, workspaceId] of [[f.accounts[1].id, opt.workspaceId], [f.accounts[0].id, otherSpace]]) {
      const role = await f.prisma.clientWorkspaceRole.findUniqueOrThrow({ where: { workspaceId_code: { workspaceId, code: 'OWNER' } } });
      await f.prisma.clientWorkspaceMembership.create({ data: { memberId, workspaceId, roleId: role.id } });
    }
    // Production PrismaService deliberately has one connection. A second actual host gets
    // its own protected pool so concurrent HTTP really reaches PostgreSQL, rather than
    // exhausting the first host's pool while a test barrier holds its sole connection.
    const { createApplication } = f.requireApi('bootstrap.js'), { PrismaService } = f.requireApi('prisma/prisma.service.js');
    concurrentApp = await createApplication(); await concurrentApp.listen(0, '127.0.0.1');
    assert.equal((await concurrentApp.get(PrismaService).readiness()).ready, true);
    concurrentBase = 'http://127.0.0.1:' + concurrentApp.getHttpServer().address().port + '/api';
    agent = await makeAgent();
    await t.test('real compiled selection is explicit, composite scoped, TEXT/JSON only, with no persisted body before or after erasure', async () => {
      const foreignOptions = { cookie: f.cookies[1] }, spaceOptions = { workspaceId: otherSpace };
      const other = await makeAgent(), foreign = await makeAgent(foreignOptions), space = await makeAgent(spaceOptions);
      const included = await makeMemory(), excluded = [await makeMemory({ enabled: false }), await makeMemory({ agentIds: [] }),
        await makeMemory({ agentIds: [other.id] }), await makeMemory({ agentIds: [foreign.id] }, foreignOptions), await makeMemory({ agentIds: [space.id] }, spaceOptions)];
      const key = 'af167-replay-' + randomUUID(), admissionBefore = await counts(); const r = await submit(key); const before = await counts();
      assert.deepEqual(before.map((n, i) => n - admissionBefore[i]), [1, 1, 1, 0]);
      assert.deepEqual((await row(r.id)).snapshot.source.memoryRefs, [{ memoryId: included.id, revision: included.revision }]);
      proof.plaintextLeaks += await scanPlaintext([included], true);
      await execute(); assert.ok(lastBody.messages.some(m => m.role === 'user' && m.content.includes(included.content)));
      assert.equal(lastBody.messages[0].content, 'PRIVATE_AGENT_BASE');
      for (const m of excluded) assert.equal(JSON.stringify(lastBody).includes(m.content), false);
      assert.deepEqual((await row(r.id)).output, 'CONSTANT_OUTPUT');
      const replay = await submit(key); assert.equal(replay.id, r.id); await request('GET', 'client/ai/run-requests/' + key);
      const after = await counts(); assert.deepEqual(after.map((n, i) => n - before[i]), [0, 0, 0, 1]);
      const jsonAgent = await makeAgent({}, 'json'); let current = await edit(included, { agentIds: [agent.id, jsonAgent.id] });
      mode = 'json'; const j = await submit(undefined, jsonAgent); await execute(); mode = 'text';
      assert.deepEqual((await row(j.id)).output, { answer: 'CONSTANT_OUTPUT' }); assert.ok(JSON.stringify(lastBody).includes(included.content));
      proof.plaintextLeaks += await scanPlaintext([included], true);
      await erase(current); proof.plaintextLeaks += await scanPlaintext([included], false);
      assert.equal(await f.prisma.aiPersonalMemoryAgentGrant.count({ where: { memoryId: included.id } }), 0);
      assert.equal((await f.prisma.aiPersonalMemory.findUniqueOrThrow({ where: { id: included.id } })).content, null);
      assert.equal((await row(r.id)).output, 'CONSTANT_OUTPUT');
      await submit(key); assert.equal(calls, after[3] + 1); // Deleted memory never causes exact replay reselection.
      await erase(excluded[0]); await erase(excluded[1]); await erase(excluded[2]);
    });
    await t.test('ordinary no-memory and old queued snapshots retain exact messages/hash; catalog receives none', async () => {
      const inactive = await makeMemory({ enabled: false }); const key = 'af167-old-' + randomUUID(); const r = await submit(key);
      const admitted = await row(r.id), expected = compileAgent(admitted.snapshot, admitted.input);
      assert.equal(Object.hasOwn(admitted.snapshot.source, 'memoryRefs'), false);
      const enabled = await edit(inactive, { enabled: true }); await execute(); assert.deepEqual(lastBody.messages, expected);
      assert.equal((await row(r.id)).requestHash, admitted.requestHash); const before = calls;
      const c = await request('POST', 'client/ai/agents/buddy-advice/runs', { status: 202, body: { input: { selfType: 'ENFP', buddyType: 'INTJ' }, idempotencyKey: 'af167-catalog-' + randomUUID() } });
      await execute(); assert.equal((await row(c.id)).snapshot.source, undefined); assert.equal(lastBody.messages.length, 2);
      assert.equal(JSON.stringify(lastBody).includes(inactive.content), false); assert.equal(calls, before + 1); await erase(enabled);
    });
    await t.test('queued edits/disables/revokes/deletes and current role revocation block transport and release only unattempted budget', async () => {
      for (const action of ['edit', 'disable', 'revoke', 'delete', 'role']) {
        let m = await makeMemory(); const r = await submit(), before = calls;
        let membership;
        if (action === 'delete') await erase(m);
        else if (action === 'role') { membership = await f.prisma.clientWorkspaceMembership.findFirstOrThrow({ where: { memberId: f.accounts[0].id, workspaceId: opt.workspaceId } });
          await f.prisma.clientWorkspaceRole.update({ where: { id: membership.roleId }, data: { status: 'disabled' } }); }
        else m = await edit(m, action === 'edit' ? { content: 'CHANGED_' + randomUUID() } : action === 'disable' ? { enabled: false } : { agentIds: [] });
        try { await execute(); await deniedRun(r.id, before); }
        finally { if (membership) await f.prisma.clientWorkspaceRole.update({ where: { id: membership.roleId }, data: { status: 'active' } }); }
        if (action !== 'delete') await erase(m);
      }
    });
    await t.test('actual credential read barrier then grant revocation denies before transport', async () => {
      let m = await makeMemory(); const r = await submit(), before = calls, entered = deferred(), release = deferred();
      secrets.resolveTrusted = async function(...args) { const value = await originalSecret.apply(this, args); entered.resolve(); await release.promise; return value; };
      const job = await claim(), work = jobs.execute(job);
      try { await entered.promise; m = await edit(m, { agentIds: [] }); }
      finally { release.resolve(); secrets.resolveTrusted = originalSecret; }
      await work; await deniedRun(r.id, before); await erase(m);
    });
    await t.test('actual PG observes concurrent CRUD/grant/delete waiting on scope fences without Agent lock inversion', async () => {
      for (const action of ['edit', 'grant', 'delete']) {
        let m = await makeMemory(); const r = await submit(), before = calls, entered = deferred(), release = deferred(), crudDone = deferred(); let checks = 0;
        memoryService.revalidate = async function(...args) { const value = await originalRevalidate.apply(this, args); if (++checks === 1) { entered.resolve(); await release.promise; } return value; };
        secrets.resolveTrusted = async function(...args) { const value = await originalSecret.apply(this, args); await crudDone.promise; return value; };
        const job = await claim(), work = jobs.execute(job); await entered.promise;
        const mutation = (action === 'delete' ? erase(m, { targetBase: concurrentBase }) : edit(m, action === 'grant' ? { agentIds: [] } : { content: 'CHANGED_' + randomUUID() }, { targetBase: concurrentBase })).then(value => { if (action !== 'delete') m = value; return value; }).finally(() => crudDone.resolve());
        let waits = 0;
        try {
          for (let i = 0; i < 80 && !waits; i++) {
            waits = await db(async client => Number((await client.query("SELECT count(*) AS count FROM pg_stat_activity WHERE datname=current_database() AND application_name LIKE 'aij-api:%' AND wait_event_type='Lock' AND cardinality(pg_blocking_pids(pid))>0 AND query LIKE '%pg_advisory_xact_lock%'")).rows[0].count));
            if (!waits) await pause(25);
          }
        } finally { release.resolve(); }
        try { await mutation; await work; assert.ok(waits > 0, 'PG must observe the real concurrent CRUD wait'); proof.observedCrudWaits++; await deniedRun(r.id, before); }
        finally { memoryService.revalidate = originalRevalidate; secrets.resolveTrusted = originalSecret; }
        if (action !== 'delete') await erase(m);
      }
    });
    await t.test('actual lease clock expiry during the final memory check leaves every attempt side effect fenced', async () => {
      const m = await makeMemory(), r = await submit(), beforeCalls = calls, job = await claim();
      // Core renews the lease when it admits the claim. Inject the short real expiry
      // only afterward, at actual credential IO, without changing the captured claim.
      secrets.resolveTrusted = async function(...args) {
        const value = await originalSecret.apply(this, args);
        await f.prisma.runtimeJob.update({ where: { id: job.id }, data: { leaseExpiresAt: new Date(Date.now() + 1250) } });
        return value;
      };
      let checks = 0, observed = false, frozen;
      memoryService.revalidate = async function(...args) {
        const context = await originalRevalidate.apply(this, args);
        if (++checks === 2) {
          const tx = args[0];
          frozen = { run: await tx.aiAgentRun.findUniqueOrThrow({ where: { id: r.id } }), traces: await tx.aiExecutionTrace.findMany({ where: { jobId: job.id } }), budget: await tx.aiEvaluationBudgetReservation.findUniqueOrThrow({ where: { id: r.id } }) };
          for (let i = 0; i < 100; i++) {
            observed = await db(async c => (await c.query('SELECT lease_expires_at < clock_timestamp() AS expired FROM public.runtime_job WHERE id=$1', [job.id])).rows[0].expired);
            if (observed) break; await pause(25);
          }
          assert.equal(observed, true, 'actual PostgreSQL clock must pass the owned claim expiry');
        }
        return context;
      };
      try { await jobs.execute(job);
      assert.equal(checks, 2); assert.equal(observed, true); assert.equal(calls, beforeCalls);
      assert.deepEqual(await row(r.id), frozen.run); assert.equal((await row(r.id)).attemptedAt, null);
      assert.deepEqual(await f.prisma.aiExecutionTrace.findMany({ where: { jobId: job.id } }), frozen.traces);
      assert.deepEqual(await f.prisma.aiEvaluationBudgetReservation.findUniqueOrThrow({ where: { id: r.id } }), frozen.budget);
      // Original runtime expiry/reconciliation owns terminalization, not the expired callback.
      assert.deepEqual(await jobs.claim('af167-expiry-cleaner', 1, 60000), []);
      await request('GET', 'client/ai/runs/' + r.id); await deniedRun(r.id, beforeCalls);
      proof.leaseExpiryFenceObserved = true;
      } finally { memoryService.revalidate = originalRevalidate; secrets.resolveTrusted = originalSecret; await erase(m); }
    });
    await t.test('query9 and combined compiler bound reject admission without a Job or reservation', async () => {
      const memories = []; for (let i = 0; i < 9; i++) memories.push(await makeMemory());
      let before = await counts(); await submit(undefined, agent, 409); assert.deepEqual(await counts(), before);
      for (const m of memories) await erase(m);
      const large = []; for (let i = 0; i < 8; i++) large.push(await makeMemory({ content: 'X'.repeat(4000) }));
      before = await counts(); await submit(undefined, agent, 503); assert.deepEqual(await counts(), before);
      for (const m of large) await erase(m);
    });
    await t.test('valid memory never permits stale nonce completion; unknown outcomes retain reservation and never resend', async () => {
      const m = await makeMemory(), r = await submit(), old = await claim(); assert.equal(old.max_attempts, 1);
      holdEntered = deferred(); holdRelease = deferred(); mode = 'hold'; const work = jobs.execute(old); await holdEntered.promise;
      // Test-only attempt ceiling allows a real second claim; no marker deletion or captured claim mutation.
      await f.prisma.runtimeJob.update({ where: { id: old.id }, data: { maxAttempts: 2, leaseExpiresAt: new Date(Date.now() - 1000) } });
      const fresh = await claim(); assert.equal(fresh.lease_owner, old.lease_owner); assert.notEqual(fresh.lease_nonce, old.lease_nonce); await jobs.execute(fresh);
      const frozenRun = await row(r.id), frozenBudget = await f.prisma.aiEvaluationBudgetReservation.findUniqueOrThrow({ where: { id: r.id } });
      const frozenTraces = await f.prisma.aiExecutionTrace.findMany({ where: { jobId: old.id } });
      holdRelease.resolve(); await work; mode = 'text'; assert.deepEqual(await row(r.id), frozenRun);
      assert.deepEqual(await f.prisma.aiEvaluationBudgetReservation.findUniqueOrThrow({ where: { id: r.id } }), frozenBudget);
      assert.deepEqual(await f.prisma.aiExecutionTrace.findMany({ where: { jobId: old.id } }), frozenTraces);
      const key = 'af167-unknown-' + randomUUID(), unknown = await submit(key), before = calls; mode = 'lost'; const job = await execute(); mode = 'text';
      assert.equal((await row(unknown.id)).status, 'unknown'); assert.equal((await row(unknown.id)).budgetStatus, 'reserved');
      const unknownCounts = await counts();
      await jobs.execute(job); await submit(key); await request('GET', 'client/ai/run-requests/' + key); assert.equal(calls, before + 1);
      assert.deepEqual(await counts(), unknownCounts);
      await erase(m);
    });
    await t.test('catalog image and private retention retain original owners', async () => {
      const image = await request('POST', 'client/ai/agents/avatar-maker/runs', { status: 202, body: { input: { mbtiType: 'INFP', style: 'abstract' }, idempotencyKey: 'af167-image-' + randomUUID() } });
      await execute(); const result = await row(image.id); assert.equal(result.status, 'succeeded'); assert.ok(result.imageAssetId);
      assert.equal(result.snapshot.source, undefined);
      const r = await submit(); await execute();
      const { AiCenterRunService } = f.requireApi('plugins/aij-ai/ai-center-run.service.js');
      await f.prisma.aiAgentRun.update({ where: { id: r.id }, data: { expiresAt: new Date(Date.now() - 1) } });
      await f.app.get(AiCenterRunService).cleanup(); const purged = await row(r.id);
      assert.equal(purged.snapshot, null); assert.equal(purged.input, null); assert.equal(purged.output, null);
      await request('GET', 'client/ai/runs/' + r.id, { status: 410 });
    });
  } finally {
    if (holdRelease) holdRelease.resolve();
    if (memoryService && originalRevalidate) memoryService.revalidate = originalRevalidate;
    if (secrets && originalSecret) secrets.resolveTrusted = originalSecret;
    await concurrentApp?.close();
    lastBody = undefined; if (server) { server.closeAllConnections(); await new Promise(r => server.close(r)); }
    try {
      const { LocalStorageAdapter } = f.requireApi('files/local-storage.adapter.js');
      for (const asset of await f.prisma.fileAsset.findMany({ where: { ownerType: 'ai-run' } })) await f.app.get(LocalStorageAdapter).remove(asset.objectKey);
      proof.upstreamCalls = calls; proof.finalCounts = await counts();
    } finally { await f.close(); }
    const sessions = await db(async client => (await client.query("SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND application_name LIKE 'aij-api:%'")).rows);
    assert.deepEqual(sessions, [], 'owned application pools must close'); proof.applicationPools = 0; proof.ownedServicesClosed = true;
    const folder = join(process.cwd(), '.artifacts/auto-ai-program-20261105/AF-167'); mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, 'live-' + f.lease.id + '.json'), JSON.stringify(proof, null, 2) + '\n');
  }
});
