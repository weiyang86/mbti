import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import { createRemainingClientFixture } from './remaining-client-fixture.mjs';
import { prepareAiCenter } from './ai-center-fixture.mjs';
import { readDatabaseEnvironment, withDatabase } from '../database/connection.mjs';
import { publishPersonalAgentFixture } from './personal-agent-publication-fixture.mjs';

// ROOT ONLY: requires AF-161's real DB task registration, integrated AF157/159 tables,
// controller/providers and recovery route. No alternate task identity, fake JobService,
// production host relaxation, marker deletion or captured-claim worker mutation is allowed.
test('AF-161 real session/API/JobService/Registry/PG/Trace/budget and loopback upstream', {
  timeout: 360000, skip: process.env.AIJ_AF161_ROOT_LIVE !== 'true'
}, async t => {
  const f = await createRemainingClientFixture('AF-161', { configuration: true, secrets: true, runtimeManagement: true, pluginManagement: true, storageEnabled: true, realPluginLifecycle: true });
  const database = readDatabaseEnvironment('test', process.env, f.lease.id);
  const proof={task:'AF-161',acceptanceId:f.lease.id,database:f.lease.database,status:'EVIDENCE_RECORDED_FORMAL_REPORT_IS_AUTHORITY'};
  const { CLIENT_WORKSPACE_PERMISSION: P } = f.requireApi('client-workspaces/client-workspace-permissions.js');
  const { JobService } = f.requireApi('async-runtime/job.service.js');
  const { RuntimeRegistry } = f.requireApi('async-runtime/registry.js');
  const { AiCenterHttpTransport } = f.requireApi('plugins/aij-ai/ai-center-provider.js');
  const jobs = f.app.get(JobService), registry = f.app.get(RuntimeRegistry);
  const opt = { cookie: f.cookies[0], workspaceId: f.workspaces[0].id };
  let server, calls = 0, mode = 'text', lastBody, release, entered;
  const request = async (method, path, options = {}) => {
    const r = await f.request(method, path, { ...opt, ...options });
    assert.match(r.response.headers.get('cache-control') || '', /no-store/);
    return r;
  };
  const counts = async () => [await f.prisma.aiAgentRun.count(), await f.prisma.runtimeJob.count({ where: { jobType: 'aij-ai.agent-execute' } }), await f.prisma.aiEvaluationBudgetReservation.count(), calls];
  const unchanged = async operation => { const before = await counts(); await operation(); assert.deepEqual(await counts(), before); };
  const claim = async () => { const rows = await jobs.claim('af161-worker', 1, 60000); assert.equal(rows.length, 1); return rows[0]; };
  const execute = async () => { const row = await claim(); await jobs.execute(row); return row; };
  let agent, skill, ai, version, catalog;
  const legacyPCode = 'p-' + randomUUID();
  const runBody = key => ({ input: { text: 'SYNTHETIC_PRIVATE_INPUT' }, idempotencyKey: key, expectedRevision: agent.revision });
  const submit = (key, options = {}) => request('POST', `client/ai/personal-agents/${agent.id}/runs`, { body: runBody(key), status: 202, ...options });
  const read = id => request('GET', `client/ai/runs/${id}`);
  const refreshAgent = async (changes = {}) => {
    const { id, revision } = agent;
    const content = Object.fromEntries(Object.entries(agent).filter(([k]) => !['id', 'code', 'revision', 'createdAt', 'updatedAt'].includes(k)));
    // Asset GET includes server version ids; save accepts only the Skill id/revision pins.
    content.skillBindings = content.skillBindings.map(({ skillId, revision }) => ({ skillId, revision }));
    agent = (await request('PATCH', `client/ai/personal-agents/${id}`, { status: 200, body: { ...content, expectedRevision: revision, ...changes } })).data;
    if (agent.enabled) await publishPersonalAgentFixture(request, agent);
  };
  const makeAgent = async format => {
    const options = (await request('GET', 'client/ai/personal-agents/model-options')).data;
    const created = (await request('POST', 'client/ai/personal-agents', { status: 201, body: { code: 'af161-' + randomUUID(), name: 'Synthetic private Agent',
      instructions: 'PRIVATE_AGENT_FIRST', enabled: true, modelCode: 'advice-text', modelRevision: options.items.find(m => m.code === 'advice-text').revision,
      catalogVersion: options.catalogVersion, inputFields: ['text'], outputFormat: format, outputFields: format === 'json' ? ['answer'] : [],
      skillBindings: [{ skillId: skill.id, revision: 1 }] } })).data;
    return publishPersonalAgentFixture(request, created);
  };
  try {
    const { AiPersonalAgentSnapshotsService } = f.requireApi('plugins/aij-ai/ai-personal-agent-snapshots.service.js');
    assert.equal(Object.getPrototypeOf(jobs), JobService.prototype);
    assert.equal(registry.jobRegistration('aij-ai.agent-execute', 1).executionMode, 'orchestrated');
    assert.ok(f.app.get(AiPersonalAgentSnapshotsService));
    ai = await prepareAiCenter(f); catalog = structuredClone(ai.catalog); for (const p of catalog.providers) p.liveEnabled = true;
    catalog.agents.push({ ...catalog.agents[0], code: legacyPCode, inputFields: ['text'] });
    version = (await ai.save(catalog)).data.version;
    skill = (await request('POST', 'client/ai/skills', { status: 201, body: { code: 'af161-pinned', name: 'Synthetic Skill', instructions: 'PRIVATE_PINNED_SKILL_V1' } })).data;
    agent = await makeAgent('text');
    await unchanged(() => submit('default-disabled', { status: 503 }));
    process.env.AI_CENTER_CLIENT_EXECUTION_ENABLED = 'true'; process.env.AI_CENTER_LIVE_ENABLED = 'true';
    server = createServer(async (req, res) => {
      calls++; assert.equal(req.headers.authorization, 'Bearer ' + ai.credential);
      let raw = ''; for await (const b of req) raw += b; lastBody = JSON.parse(raw);
      if (mode === 'hold') { entered(); await new Promise(r => { release = r; }); }
      if (mode === 'lost') { req.socket.destroy(); return; }
      if (mode === 'timeout') return;
      res.setHeader('content-type', 'application/json');
      const image = req.url === '/v1/images/generations';
      if (image) { res.end(JSON.stringify({ data: [{ b64_json: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jfP8AAAAASUVORK5CYII=' }] })); return; }
      assert.equal(req.url, '/v1/chat/completions');
      res.end(JSON.stringify({ model: lastBody.model, choices: [{ finish_reason: 'stop', message: { content: mode === 'json' ? '{"answer":"SYNTHETIC_OUTPUT"}' : 'SYNTHETIC_OUTPUT' } }], usage: { prompt_tokens: 20, completion_tokens: 10 } }));
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    f.app.get(AiCenterHttpTransport).request = (url, init) => {
      assert.ok(['https://api.openai.com/v1/chat/completions', 'https://api.openai.com/v1/images/generations'].includes(url));
      assert.equal(init.redirect, 'error'); assert.equal(init.method, 'POST');
      return fetch(`http://127.0.0.1:${server.address().port}${new URL(url).pathname}`, { ...init, ...(mode === 'timeout' ? { signal: AbortSignal.any([init.signal, AbortSignal.timeout(100)]) } : {}) });
    };
    await t.test('same origin/session/private scope/strict fields/revision deny with zero admissions', async () => {
      await unchanged(() => submit('foreign-origin', { origin: 'https://foreign.invalid', status: 403 }));
      await unchanged(() => submit('no-session-key', { cookie: undefined, status: 401 }));
      await unchanged(() => submit('other-space-key', { workspaceId: f.workspaces[1].id, status: 403 }));
      await f.prisma.clientWorkspaceMembership.create({ data: { memberId: f.accounts[1].id, workspaceId: opt.workspaceId,
        roleId: (await f.prisma.clientWorkspaceRole.findUniqueOrThrow({ where: { workspaceId_code: { workspaceId: opt.workspaceId, code: 'OWNER' } } })).id } });
      await unchanged(() => submit('other-owner-key', { cookie: f.cookies[1], status: 404 }));
      for (const field of ['model', 'provider', 'snapshot', 'source', 'memberId', 'workspaceId', 'tool', 'script', 'knowledge', 'memory'])
        await unchanged(() => submit('forgery-' + field, { body: { ...runBody('forgery-' + field), [field]: 'forged' }, status: 400 }));
      await unchanged(() => submit('stale-revision', { body: { ...runBody('stale-revision'), expectedRevision: agent.revision + 1 }, status: 409 }));
      await refreshAgent({ enabled: false }); await unchanged(() => submit('disabled-agent', { status: 404 })); await refreshAgent({ enabled: true });
    });
    await t.test('active project/org/member/role/membership/grants are authoritative at admission', async () => {
      const member = await f.prisma.clientWorkspaceMembership.findFirstOrThrow({ where: { memberId: f.accounts[0].id, workspaceId: opt.workspaceId } });
      const project = await f.prisma.projectProfile.findUniqueOrThrow({ where: { id: f.project.id } });
      for (const [delegate, id, expectedStatus] of [[f.prisma.projectProfile, project.id, 503], [f.prisma.organizationProfile, project.organizationId, 503],
        [f.prisma.memberUser, f.accounts[0].id, 401], [f.prisma.clientWorkspace, opt.workspaceId, 403],
        [f.prisma.clientWorkspaceRole, member.roleId, 403], [f.prisma.clientWorkspaceMembership, member.id, 403]]) {
        const previous = await delegate.findUniqueOrThrow({ where: { id } });
        await delegate.update({ where: { id }, data: { status: 'disabled' } });
        try {
          const before = await counts();
          const response = await fetch(f.baseUrl + `/client/ai/personal-agents/${agent.id}/runs`, { method: 'POST', headers: { cookie: opt.cookie, origin: process.env.WEB_URL, 'x-aij-workspace-id': opt.workspaceId, 'content-type': 'application/json' }, body: JSON.stringify(runBody('inactive-' + id)) });
          assert.equal(response.status, expectedStatus); assert.match(response.headers.get('cache-control') || '', /no-store/); await response.text(); assert.deepEqual(await counts(), before);
        } finally { await delegate.update({ where: { id }, data: { status: previous.status } }); }
      }
      for (const code of [P.aiExecute, P.aiAssetsRead]) {
        const permission = await f.prisma.clientWorkspacePermission.findFirstOrThrow({ where: { code } });
        const grant = await f.prisma.clientWorkspaceRolePermission.findFirstOrThrow({ where: { roleId: member.roleId, permissionId: permission.id, deletedAt: null } });
        await f.prisma.clientWorkspaceRolePermission.update({ where: { id: grant.id }, data: { deletedAt: new Date() } });
        try { await unchanged(() => submit('no-grant-' + code.replaceAll('.', '-'), { status: 403 })); }
        finally { await f.prisma.clientWorkspaceRolePermission.update({ where: { id: grant.id }, data: { deletedAt: null } }); }
      }
    });
    await t.test('concurrent canonical replay, response-loss recovery, one Job/reserve/upstream/trace and pinned Skill', async () => {
      await request('PATCH', `client/ai/skills/${skill.id}`, { body: { name: skill.name, instructions: 'LATER_SKILL_V2_MUST_NOT_COMPILE', expectedRevision: 1 } });
      const before = await counts(); const [a, b] = await Promise.all([submit('concurrent-personal'), submit('concurrent-personal')]); assert.equal(a.data.id, b.data.id);
      const after = await counts(); assert.deepEqual(after.map((n, i) => n - before[i]), [1, 1, 1, 0]);
      await unchanged(() => submit('concurrent-personal', { body: { ...runBody('concurrent-personal'), input: { text: 'different' } }, status: 409 }));
      await unchanged(() => request('POST', `client/ai/agents/${legacyPCode}/runs`, { status: 409, body: { input: runBody('concurrent-personal').input, idempotencyKey: 'concurrent-personal' } }));
      const job = await execute(); await jobs.execute(job); assert.equal(calls - before[3], 1);
      const r = (await read(a.data.id)).data; assert.equal(r.status, 'succeeded'); assert.equal(r.budgetStatus, 'settled'); assert.equal(r.agentCode, 'personal:' + agent.id);
      assert.match(lastBody.messages[0].content, /^PRIVATE_AGENT_FIRST\n\nPRIVATE_PINNED_SKILL_V1/); assert.equal(JSON.stringify(lastBody).includes('LATER_SKILL'), false);
      assert.equal(await f.prisma.aiExecutionTrace.count({ where: { jobId: job.id } }), 1);
      const ignored = await fetch(f.baseUrl + `/client/ai/personal-agents/${agent.id}/runs`, { method: 'POST', headers: { cookie: opt.cookie, origin: process.env.WEB_URL, 'x-aij-workspace-id': opt.workspaceId, 'content-type': 'application/json' }, body: JSON.stringify(runBody('response-lost-client')) });
      assert.equal(ignored.status, 202); await ignored.body.cancel();
      const recovered = (await request('GET', 'client/ai/run-requests/response-lost-client')).data;
      const pending = await f.prisma.aiAgentRun.findUniqueOrThrow({ where: { id: recovered.id } }); assert.equal(pending.status, 'queued');
      await execute(); const beforeRecovery = await counts(); await request('GET', 'client/ai/run-requests/response-lost-client'); assert.deepEqual(await counts(), beforeRecovery);
      await request('GET', `client/ai/runs/${r.id}`, { cookie: f.cookies[1], status: 404 });
    });
    await t.test('JSON uses same pipeline and prompt pins', async () => {
      agent = await makeAgent('json'); mode = 'json'; const r = (await submit('private-json-key')).data; await execute();
      assert.deepEqual((await read(r.id)).data.output, { answer: 'SYNTHETIC_OUTPUT' }); assert.match(lastBody.messages[0].content, /PRIVATE_PINNED_SKILL_V1/); mode = 'text';
    });
    await t.test('queued private Agent disable or new revision prevents transport', async () => {
      for (const changes of [{ enabled: false }, { instructions: 'NEW_PRIVATE_REVISION' }]) {
        const r = (await submit('queue-agent-' + agent.revision)).data, before = calls;
        await refreshAgent(changes); await execute(); assert.equal((await read(r.id)).data.status, 'failed'); assert.equal(calls, before);
        await refreshAgent({ enabled: true, instructions: 'PRIVATE_AGENT_FIRST' });
      }
    });
    await t.test('queued Skill deletion and role revocation prevent transport', async () => {
      let r = (await submit('queue-role-revoke')).data; const job = await claim(), before = calls;
      const membership = await f.prisma.clientWorkspaceMembership.findFirstOrThrow({ where: { memberId: f.accounts[0].id, workspaceId: opt.workspaceId } });
      await f.prisma.clientWorkspaceRole.update({ where: { id: membership.roleId }, data: { status: 'disabled' } }); await jobs.execute(job);
      await f.prisma.clientWorkspaceRole.update({ where: { id: membership.roleId }, data: { status: 'active' } });
      assert.equal((await read(r.id)).data.status, 'failed'); assert.equal(calls, before);
      r = (await submit('queue-skill-delete')).data;
      await request('DELETE', `client/ai/skills/${skill.id}`, { body: { expectedRevision: 2 } }); await execute();
      assert.equal((await read(r.id)).data.status, 'failed'); assert.equal(calls, before);
      await unchanged(() => submit('deleted-pin-denied', { status: 404 }));
      skill = (await request('POST', 'client/ai/skills', { status: 201, body: { code: 'af161-other', name: 'Other', instructions: 'PRIVATE_PINNED_SKILL_V1' } })).data;
      agent = await makeAgent('text');
    });
    await t.test('actual lifecycle disable gates admission and claimed job; no upstream', async () => {
      const r = (await submit('queue-plugin-disable')).data, job = await claim(), before = calls;
      await f.request('POST', 'admin/plugins/aij-ai/disable', { token: ai.token, status: 200 });
      await unchanged(() => submit('disabled-plugin', { status: 404 })); await jobs.execute(job); assert.equal(calls, before);
      await f.request('POST', 'admin/plugins/aij-ai/enable', { token: ai.token, status: 200 });
      await jobs.cancel(job.id); assert.equal((await read(r.id)).data.budgetStatus, 'released');
    });
    await t.test('current model/provider/catalog drift and workspace budget gates deny with no admission', async () => {
      for (const mutate of [c => { c.models[0].enabled = false; for (const a of c.agents.filter(a => a.modelCode === 'advice-text')) a.published = false; }, c => { c.providers[0].enabled = false; for (const a of c.agents.filter(a => a.modelCode === 'advice-text')) a.published = false; }]) {
        const changed = structuredClone(catalog); mutate(changed); version = (await ai.save(changed, version)).data.version;
        await unchanged(() => submit('model-provider-' + version, { status: 409 })); version = (await ai.save(catalog, version)).data.version;
      }
      agent = await makeAgent('text');
      const queued = (await submit('queue-model-disable')).data, before = calls;
      const changed = structuredClone(catalog); changed.models[0].enabled = false; for (const a of changed.agents.filter(a => a.modelCode === 'advice-text')) a.published = false;
      version = (await ai.save(changed, version)).data.version; await execute(); assert.equal((await read(queued.id)).data.status, 'failed'); assert.equal(calls, before);
      catalog.workspaceMonthlyBudgetNanos = '1'; version = (await ai.save(catalog, version)).data.version; agent = await makeAgent('text');
      await unchanged(() => submit('budget-exhausted', { status: 429 }));
      catalog.workspaceMonthlyBudgetNanos = '1000000000'; version = (await ai.save(catalog, version)).data.version; agent = await makeAgent('text');
    });
    await t.test('late old nonce cannot commit or settle a newer lease with same worker id', async () => {
      const r = (await submit('stale-nonce-key')).data, old = await claim(); assert.equal(old.max_attempts, 1);
      mode = 'hold'; const started = new Promise(resolve => { entered = resolve; }); const work = jobs.execute(old); await started;
      // A test-only higher attempt ceiling permits a genuine second claim; never delete admission
      // markers, reset attempts, replace JobService, or change the captured worker identity.
      await f.prisma.runtimeJob.update({ where: { id: old.id }, data: { maxAttempts: 2, leaseExpiresAt: new Date(Date.now() - 1000) } });
      const fresh = await claim(); assert.equal(fresh.lease_owner, old.lease_owner); assert.notEqual(fresh.lease_nonce, old.lease_nonce); assert.equal(fresh.attempts, old.attempts + 1);
      await jobs.execute(fresh); const before = await f.prisma.aiAgentRun.findUniqueOrThrow({ where: { id: r.id } });
      const budget = await f.prisma.aiEvaluationBudgetReservation.findUniqueOrThrow({ where: { id: r.id } });
      release(); await work; mode = 'text'; assert.deepEqual(await f.prisma.aiAgentRun.findUniqueOrThrow({ where: { id: r.id } }), before);
      assert.deepEqual(await f.prisma.aiEvaluationBudgetReservation.findUniqueOrThrow({ where: { id: r.id } }), budget); assert.equal(before.status, 'unknown'); assert.equal(before.budgetStatus, 'reserved');
    });
    await t.test('lost upstream response is unknown/reserved without resend', async () => {
      for (const failure of ['lost', 'timeout']) {
      mode = failure; const key = failure + '-upstream-response'; const r = (await submit(key)).data, before = calls; const job = await execute();
      const result = (await read(r.id)).data; assert.equal(result.status, 'unknown'); assert.equal(result.budgetStatus, 'reserved');
      assert.equal((await f.prisma.aiEvaluationBudgetReservation.findUniqueOrThrow({ where: { id: r.id } })).status, 'reserved');
      await jobs.execute(job); await request('GET', 'client/ai/run-requests/' + key); assert.equal(calls, before + 1); mode = 'text';
      }
    });
    await t.test('legacy catalog text/image/recovery plus retention and redaction remain compatible', async () => {
      assert.ok((await request('GET', 'client/ai/agents')).data.some(a => a.code === legacyPCode));
      for (const [code, input] of [[legacyPCode, { text: 'SYNTHETIC_PRIVATE_INPUT' }], ['buddy-advice', { selfType: 'ENFP', buddyType: 'INTJ' }], ['avatar-maker', { mbtiType: 'INFP', style: 'abstract' }]]) {
        const key = 'legacy-' + code; const r = (await request('POST', `client/ai/agents/${code}/runs`, { status: 202, body: { idempotencyKey: key, input } })).data;
        await execute(); assert.equal((await read(r.id)).data.status, 'succeeded'); await request('GET', 'client/ai/run-requests/' + key);
        if (code === 'avatar-maker') { const image = await fetch(f.baseUrl + `/client/ai/runs/${r.id}/image`, { headers: { cookie: opt.cookie, 'x-aij-workspace-id': opt.workspaceId } }); assert.equal(image.status, 200); await image.arrayBuffer(); }
      }
      const { AiCenterRunService } = f.requireApi('plugins/aij-ai/ai-center-run.service.js');
      const r = (await submit('retention-private')).data; await execute(); await f.prisma.aiAgentRun.update({ where: { id: r.id }, data: { expiresAt: new Date(Date.now() - 1) } });
      await f.app.get(AiCenterRunService).cleanup(); await request('GET', `client/ai/runs/${r.id}`, { status: 410 });
      const purged = await f.prisma.aiAgentRun.findUniqueOrThrow({ where: { id: r.id } }); assert.equal(purged.input, null); assert.equal(purged.snapshot, null); assert.equal(purged.output, null);
      const traces = JSON.stringify(await f.prisma.aiExecutionTrace.findMany()); const audits = JSON.stringify(await f.prisma.auditLog.findMany());
      for (const secret of [ai.credential, 'SYNTHETIC_PRIVATE_INPUT', 'PRIVATE_AGENT_FIRST', 'PRIVATE_PINNED_SKILL_V1']) { assert.equal(traces.includes(secret), false); assert.equal(audits.includes(secret), false); }
    });
  } finally {
    if (release) release();
    if (server) { server.closeAllConnections(); await new Promise(r => server.close(r)); }
    const { LocalStorageAdapter } = f.requireApi('files/local-storage.adapter.js');
    for (const asset of await f.prisma.fileAsset.findMany({ where: { ownerType: 'ai-run' } })) await f.app.get(LocalStorageAdapter).remove(asset.objectKey);
    proof.ownedUpstreamCalls=calls;proof.finalCounts=await counts();
    await f.close();
    const sessions = await withDatabase('test', database, async client => (await client.query("SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND application_name LIKE 'aij-api:%'")).rows, { acceptanceId: f.lease.id });
    assert.deepEqual(sessions, [], 'all owned API pools must be closed');
    proof.applicationPools=0;proof.ownedServicesClosed=true;const folder=join(process.cwd(),'.artifacts/auto-ai-program-20261105/AF-161');mkdirSync(folder,{recursive:true});writeFileSync(join(folder,'live-'+f.lease.id+'.json'),JSON.stringify(proof,null,2)+'\n',{mode:0o600});
  }
});
