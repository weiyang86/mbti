// ROOT ONLY. Never skip: absence of real registrations/builds/native adapter is FAIL.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { randomUUID, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRemainingClientFixture } from './remaining-client-fixture.mjs';
import { prepareAiCenter } from './ai-center-fixture.mjs';
import { readDatabaseEnvironment, withDatabase } from '../database/connection.mjs';
const root = '/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation';
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function waitGate(promise) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Synthetic IO barrier not reached')), 15000); })]); }
  finally { clearTimeout(timer); }
}
const counter = p => ({ expectedAgentRevision: p.revision, expectedPublicationVersion: p.publicationVersion });
const publicKeys = ['agentId', 'revision', 'publishedRevision', 'publicationVersion', 'published', 'dependencyReadiness'].sort();
async function packedSdk(folder) {
  const consumer = join(folder, 'consumer'), packs = join(folder, 'packs');
  mkdirSync(consumer, { recursive: true }); mkdirSync(packs, { recursive: true });
  for (const name of ['contracts', 'sdk']) {
    assert.ok(existsSync(join(root, 'packages', name, 'dist/index.cjs')), 'root must build real packages first');
    execFileSync('pnpm', ['pack', '--pack-destination', packs], { cwd: join(root, 'packages', name), stdio: 'pipe' });
  }
  writeFileSync(join(consumer, 'package.json'), JSON.stringify({ private: true, name: 'af189-packed-consumer', version: '0.0.0' }));
  execFileSync('npm', ['install', '--ignore-scripts', '--offline', '--no-audit', '--no-fund', '--package-lock=false',
    join(packs, 'aij-contracts-0.1.0.tgz'), join(packs, 'aij-sdk-0.1.0.tgz')], { cwd: consumer, stdio: 'pipe' });
  const req = createRequire(join(consumer, 'package.json')), cjs = req('@aij/sdk');
  const esm = await import(pathToFileURL(join(consumer, 'node_modules/@aij/sdk/dist/index.mjs')).href);
  assert.equal(typeof cjs.createPersonalAgentPublicationsClient, 'function', 'public CJS export required');
  assert.equal(typeof esm.createPersonalAgentPublicationsClient, 'function', 'public ESM export required');
  return cjs;
}

test('AF-189 root real fresh PG/API/packed SDK/publication/worker/native acceptance', { timeout: 850000 }, async t => {
  assert.equal(process.env.AIJ_AF189_ROOT_LIVE, '1', 'explicit root lease required; worker NOT_RUN');
  assert.equal(resolve(process.cwd()), root);
  assert.equal(execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim(), 'dev');
  const gitPath = flag => resolve(root, execFileSync('git', ['rev-parse', flag], { encoding: 'utf8' }).trim());
  assert.equal(gitPath('--git-dir'), gitPath('--git-common-dir'), 'root-only database writer');
  const adapterPath = process.env.AIJ_AF189_NATIVE_ADAPTER;
  assert.ok(adapterPath && isAbsolute(adapterPath) && existsSync(adapterPath), 'missing root native adapter is FAIL, never skip');
  assert.ok(relative(join(root, '.artifacts'), adapterPath) && !relative(join(root, '.artifacts'), adapterPath).startsWith('..'));
  const native = await import(pathToFileURL(adapterPath).href);
  assert.equal(typeof native.runNativePublicationAcceptance, 'function');
  const nativeHost = await native.prepareNativePublicationHost();
  const f = await createRemainingClientFixture('AF-189', { configuration: true, secrets: true, runtimeManagement: true,
    pluginManagement: true, storageEnabled: true, realPluginLifecycle: true, testBrowserOrigin: nativeHost.origin }).catch(async error => {
      await nativeHost.close(); throw error;
    });
  const folder = join(root, '.artifacts/auto-ai-program-20261105/AF-189', f.lease.id);
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  const proof = { task: 'AF-189', acceptanceId: f.lease.id, database: f.lease.database, status: 'RUNNING', checks: {} };
  const originalTransaction = f.prisma.$transaction.bind(f.prisma);
  f.prisma.$transaction = (...args) => originalTransaction(...args).catch(error => {
    // Root diagnostic codes only; never SQL parameters, private row details or credentials.
    writeFileSync(join(folder, 'transaction-failure.json'), JSON.stringify({ name: error?.name, code: error?.code,
      sqlState: error?.meta?.code, constraint: /constraint "([a-z0-9_]+)"/.exec(error?.meta?.message ?? '')?.[1],
      category: String(error?.meta?.message ?? '').slice(0, 50).replace(/[0-9a-f]{8}-[0-9a-f-]+/gi, '[ID]') }));
    throw error;
  });
  const sub = async (name, fn) => {
    let failure;
    await t.test(name, async () => { try { await fn(); } catch (error) { failure = error; throw error; } });
    if (failure) throw failure;
  };
  const database = readDatabaseEnvironment('test', process.env, f.lease.id);
  const db = op => withDatabase('test', database, op, { acceptanceId: f.lease.id });
  let jobs, secrets, secretResolve;
  const owner = { cookie: f.cookies[0], workspaceId: f.workspaces[0].id };
  let server, calls = 0, resolutions = 0, mode = 'text', barrier, release, agent, skill, content, config, catalogVersion, sdk;
  const request = async (method, path, options = {}) => {
    const r = await f.request(method, path, { ...owner, ...options });
    if (path.startsWith('client/ai/personal-agents')) assert.match(r.response.headers.get('cache-control') || '', /private, no-store/);
    return r;
  };
  const publication = () => request('GET', `client/ai/personal-agents/${agent.id}/publication`).then(r => r.data);
  const mutate = async (action, options = {}) => request('POST', `client/ai/personal-agents/${agent.id}/publication/${action}`,
    { body: counter(await publication()), ...options }).then(r => r.data);
  const run = (options = {}) => request('POST', `client/ai/personal-agents/${agent.id}/runs`, {
    status: 202, body: { expectedRevision: agent.revision, idempotencyKey: 'af189-' + randomUUID(), input: { text: 'AF189_SYNTHETIC_INPUT' } }, ...options }).then(r => r.data);
  const claim = async () => { const rows = await jobs.claim('af189-worker', 1, 60000); assert.equal(rows.length, 1); return rows[0]; };
  const execute = async () => { const j = await claim(); await jobs.execute(j); return j; };
  const counts = async () => [await f.prisma.aiAgentRun.count(), await f.prisma.runtimeJob.count(), await f.prisma.aiEvaluationBudgetReservation.count(), calls, resolutions];
  const hashes = () => db(async client => {
    const out = {};
    for (const { tablename } of (await client.query("SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname='public' ORDER BY tablename")).rows) {
      assert.match(tablename, /^[A-Za-z_][A-Za-z0-9_]*$/);
      const projection = tablename === 'client_auth_session' ? "(to_jsonb(t)-'last_seen_at'-'updated_at')::text" : 'row_to_json(t)::text';
      const rows = (await client.query('SELECT ' + projection + ' AS row FROM public."' + tablename + '" t')).rows.map(r => r.row).sort();
      out[tablename] = createHash('sha256').update(JSON.stringify(rows)).digest('hex');
    } return out;
  });
  const unchanged = async operation => { const before = await hashes(); await operation(); assert.deepEqual(await hashes(), before); };
  const makeAgent = async (extra = {}) => {
    const options = (await request('GET', 'client/ai/personal-agents/model-options')).data;
    content = { name: 'AF189 synthetic Agent', instructions: 'AF189_PRIVATE_INSTRUCTIONS', enabled: true, modelCode: 'advice-text',
      modelRevision: options.items.find(m => m.code === 'advice-text').revision, catalogVersion: options.catalogVersion,
      inputFields: ['text'], outputFormat: 'text', outputFields: [], skillBindings: [{ skillId: skill.id, revision: 1 }], ...extra };
    agent = (await request('POST', 'client/ai/personal-agents', { status: 201, body: { ...content, code: 'af189-' + randomUUID() } })).data;
    return agent;
  };
  try {
    const { JobService } = f.requireApi('async-runtime/job.service.js');
    const { SecretRefPort } = f.requireApi('secret-center/secret-ref.js');
    const { PersonalAgentPublicationValidator } = f.requireApi('plugins/aij-ai/ai-personal-agent-publications.service.js');
    assert.ok(f.app.get(PersonalAgentPublicationValidator), 'root common validation provider must really be registered');
    jobs = f.app.get(JobService); secrets = f.app.get(SecretRefPort); secretResolve = secrets.resolveTrusted.bind(secrets);
    secrets.resolveTrusted = async (...args) => { resolutions++; return secretResolve(...args); };
    sdk = await packedSdk(folder);
    const client = sdk.createPersonalAgentPublicationsClient(async (path, options) => (await request(options.method, path.slice(1), {
      workspaceId: options.workspaceId, body: options.body === undefined ? undefined : JSON.parse(options.body) })).data);
    config = await prepareAiCenter(f); const catalog = structuredClone(config.catalog); catalog.providers.forEach(p => { p.liveEnabled = true; });
    catalogVersion = (await config.save(catalog)).data.version;
    skill = (await request('POST', 'client/ai/skills', { status: 201, body: { code: 'af189-pin', name: 'AF189 synthetic Skill', instructions: 'AF189_PRIVATE_SKILL' } })).data;
    await makeAgent();
    process.env.AI_CENTER_CLIENT_EXECUTION_ENABLED = 'true'; process.env.AI_CENTER_LIVE_ENABLED = 'true';
    server = createServer(async (req, res) => {
      calls++; assert.equal(req.url, '/v1/chat/completions'); assert.equal(req.headers.authorization, 'Bearer ' + config.credential);
      for await (const part of req) { void part; /* consume synthetic input, never retain/log */ }
      if (mode === 'hold') { barrier.resolve(); await release.promise; }
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: 'AF189_SYNTHETIC_OUTPUT' } }], usage: { prompt_tokens: 20, completion_tokens: 10 } }));
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const { AiCenterHttpTransport } = f.requireApi('plugins/aij-ai/ai-center-provider.js');
    f.app.get(AiCenterHttpTransport).request = (url, init) => {
      assert.equal(url, 'https://api.openai.com/v1/chat/completions'); assert.equal(init.redirect, 'error');
      return fetch(`http://127.0.0.1:${server.address().port}/v1/chat/completions`, init);
    };
    await sub('new head unpublished; strict API denials/no-store/ownership/readonly have zero durable changes', async () => {
      const first = await publication(); assert.equal(first.published, false); assert.equal(first.publicationVersion, 0); assert.equal(first.publishedRevision, null);
      assert.deepEqual(Object.keys(first).sort(), publicKeys); assert.equal(first.dependencyReadiness.ready, true);
      await unchanged(() => run({ status: 409 }));
      for (const field of ['published', 'snapshot', 'instructions', 'memberId', 'workspaceId', 'skipPublished'])
        await unchanged(() => mutate('publish', { body: { ...counter(first), [field]: true }, status: 400 }));
      for (const origin of [null, 'https://foreign.invalid']) await unchanged(() => mutate('publish', { origin, status: 403 }));
      await unchanged(() => request('GET', `client/ai/personal-agents/${agent.id}/publication?revision=1`, { status: 400 }));
      await unchanged(() => request('GET', `client/ai/personal-agents/${agent.id}/publication`, { cookie: undefined, status: 401 }));
      const role = await f.prisma.clientWorkspaceRole.findUniqueOrThrow({ where: { workspaceId_code: { workspaceId: owner.workspaceId, code: 'OWNER' } } });
      const foreignMember = await f.prisma.clientWorkspaceMembership.create({ data: { memberId: f.accounts[1].id, workspaceId: owner.workspaceId, roleId: role.id } });
      await unchanged(() => request('GET', `client/ai/personal-agents/${agent.id}/publication`, { cookie: f.cookies[1], status: 404 }));
      await unchanged(() => mutate('publish', { cookie: f.cookies[1], status: 404 }));
      await f.prisma.clientWorkspaceMembership.delete({ where: { id: foreignMember.id } });
      const grant = await f.prisma.clientWorkspaceRolePermission.findFirstOrThrow({ where: { roleId: role.id, permission: { code: 'workspace.ai.assets.manage' } } });
      await f.prisma.clientWorkspaceRolePermission.update({ where: { id: grant.id }, data: { deletedAt: new Date() } });
      await unchanged(() => mutate('publish', { status: 403 })); assert.equal((await publication()).published, false);
      await f.prisma.clientWorkspaceRolePermission.update({ where: { id: grant.id }, data: { deletedAt: null } }); proof.checks.denials = true;
    });
    await sub('actual packed public SDK publish/noop/unpublish/CAS; metadata-only atomic audit; immutable authored history', async () => {
      const before = await counts(), history = await f.prisma.aiPersonalAgentVersion.findMany({ where: { agentId: agent.id } });
      const first = await client.get(owner.workspaceId, agent.id), p = await client.publish(owner.workspaceId, agent.id, counter(first));
      assert.equal(p.published, true); assert.equal(p.publicationVersion, 1); assert.equal(p.revision, agent.revision);
      const audit = await f.prisma.auditLog.findMany({ where: { resourceId: agent.id, action: 'personal_agent_published' } }); assert.equal(audit.length, 1);
      await unchanged(() => client.publish(owner.workspaceId, agent.id, counter(p)));
      await unchanged(() => mutate('publish', { body: counter(first), status: 409 }));
      assert.deepEqual(await counts(), before); assert.deepEqual(await f.prisma.aiPersonalAgentVersion.findMany({ where: { agentId: agent.id } }), history);
      assert.doesNotMatch(JSON.stringify(audit), /AF189_PRIVATE|credential|AF189_SYNTHETIC_INPUT/);
      assert.equal((await client.unpublish(owner.workspaceId, agent.id, counter(p))).published, false);
      const tx = f.prisma.$transaction.bind(f.prisma);
      f.prisma.$transaction = (fn, ...args) => typeof fn === 'function' ? tx(actual => fn(new Proxy(actual, { get(target, key) {
        if (key === 'auditLog') return new Proxy(target.auditLog, { get(audit, method) { if (method === 'create') return async () => { throw new Error('AF189 synthetic audit failure'); }; return audit[method]; } });
        const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
      } })), ...args) : tx(fn, ...args);
      try { await unchanged(() => mutate('publish', { status: 503 })); } finally { f.prisma.$transaction = tx; }
      proof.checks.atomicCasSdk = true;
    });
    await sub('two real API instances compete on the same publication CAS; original DB immutability still refuses tampering', async () => {
      const { createApplication } = f.requireApi('bootstrap.js');
      const { PrismaService } = f.requireApi('prisma/prisma.service.js');
      const second = await createApplication({ testBrowserOrigin: nativeHost.origin });
      try {
        await second.listen(0, '127.0.0.1'); assert.notEqual(second.get(PrismaService), f.prisma);
        const p = await publication(), body = JSON.stringify(counter(p));
        const post = base => fetch(base + `/client/ai/personal-agents/${agent.id}/publication/publish`, {
          method: 'POST', headers: { cookie: owner.cookie, origin: nativeHost.origin, 'x-aij-workspace-id': owner.workspaceId,
            'content-type': 'application/json', connection: 'close' }, body
        }).then(async response => ({ status: response.status, body: await response.json() }));
        const results = await Promise.all([post(f.baseUrl), post(`http://127.0.0.1:${second.getHttpServer().address().port}/api`)]);
        assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
        assert.equal((await publication()).publicationVersion, p.publicationVersion + 1);
        const before = await publication();
        for (const sql of [
          'UPDATE public.ai_personal_agent SET name=\'tampered\',publication_version=publication_version+1 WHERE id=$1',
          'UPDATE public.ai_personal_agent SET publication_version=publication_version+1 WHERE id=$1',
          'UPDATE public.ai_personal_agent_version SET name=\'tampered\' WHERE agent_id=$1'
        ]) await assert.rejects(db(c => c.query(sql, [agent.id])), error => error.message === 'Database connection/query failed: 55000');
        assert.deepEqual(await publication(), before);
        await mutate('unpublish'); proof.checks.twoApiCasAndDatabaseImmutability = true;
      } finally { await second.close(); }
    });
    await sub('publication transaction holds the current management grant until commit; later revocation refuses without epoch change', async () => {
      const validator = f.app.get(f.requireApi('plugins/aij-ai/ai-personal-agent-publications.service.js').PersonalAgentPublicationValidator);
      const original = validator.validate.bind(validator), entered = deferred(), allow = deferred(), revoker = deferred();
      const p = await publication();
      const membership = await f.prisma.clientWorkspaceMembership.findUniqueOrThrow({ where: { workspaceId_memberId: { workspaceId: owner.workspaceId, memberId: f.accounts[0].id } } });
      const grant = await f.prisma.clientWorkspaceRolePermission.findFirstOrThrow({ where: { roleId: membership.roleId, permission: { code: 'workspace.ai.assets.manage' } } });
      validator.validate = async (...args) => { await original(...args); entered.resolve(); await allow.promise; };
      let pending, revoke;
      try {
        pending = request('POST', `client/ai/personal-agents/${agent.id}/publication/publish`, { body: counter(p) });
        await waitGate(entered.promise);
        revoke = db(async c => {
          await c.query('BEGIN'); revoker.resolve((await c.query('SELECT pg_backend_pid() AS id')).rows[0].id);
          try { await c.query('UPDATE public.client_workspace_role_permission SET deleted_at=CURRENT_TIMESTAMP WHERE id=$1', [grant.id]); await c.query('COMMIT'); }
          catch (error) { await c.query('ROLLBACK'); throw error; }
        });
        const pid = await waitGate(revoker.promise); let blocked = false;
        for (let n = 0; n < 100 && !blocked; n++) {
          blocked = await db(async c => (await c.query('SELECT cardinality(pg_blocking_pids($1))>0 AS blocked', [pid])).rows[0].blocked);
          if (!blocked) await new Promise(r => setTimeout(r, 10));
        }
        assert.equal(blocked, true); allow.resolve(); await pending; await revoke;
        const after = await publication(); assert.equal(after.publicationVersion, p.publicationVersion + 1);
        await unchanged(() => mutate('unpublish', { status: 403 })); assert.deepEqual(await publication(), after);
        proof.checks.publicationGrantFence = true;
      } finally {
        allow.resolve(); validator.validate = original; await pending?.catch(() => {}); await revoke?.catch(() => {});
        await f.prisma.clientWorkspaceRolePermission.update({ where: { id: grant.id }, data: { deletedAt: null } });
      }
      await mutate('unpublish');
    });
    await sub('real publish -> run success; unpublish refusal; queued ABA refuses before credential/upstream', async () => {
      await mutate('publish'); const admitted = await run(); await execute();
      const completed = await f.prisma.aiAgentRun.findUniqueOrThrow({ where: { id: admitted.id } }); assert.equal(completed.status, 'succeeded'); assert.equal(completed.budgetStatus, 'settled');
      const queued = await run(), epoch = (await publication()).publicationVersion, old = await f.prisma.aiAgentRun.findUniqueOrThrow({ where: { id: queued.id } });
      assert.equal(old.snapshot.source.publicationVersion, epoch);
      await mutate('unpublish'); await unchanged(() => run({ status: 409 })); await mutate('publish');
      assert.equal((await publication()).revision, old.agentRevision); assert.ok((await publication()).publicationVersion > epoch);
      const before = [calls, resolutions]; await execute(); assert.deepEqual([calls, resolutions], before);
      const refused = await f.prisma.aiAgentRun.findUniqueOrThrow({ where: { id: queued.id } }); assert.equal(refused.status, 'failed'); assert.equal(refused.budgetStatus, 'released');
      proof.checks.queuedAba = true;
    });
    await sub('legacy absent epoch refuses; update/disable invalidate atomically; immutable history survives publication', async () => {
      const legacy = await run(), record = await f.prisma.aiAgentRun.findUniqueOrThrow({ where: { id: legacy.id } });
      const snapshot = structuredClone(record.snapshot); delete snapshot.source.publicationVersion;
      // Legacy provenance simulation ONLY. Never write published_revision or fake API publication.
      await f.prisma.aiAgentRun.update({ where: { id: record.id }, data: { snapshot } });
      const before = [calls, resolutions]; await execute(); assert.deepEqual([calls, resolutions], before);
      assert.equal((await f.prisma.aiAgentRun.findUniqueOrThrow({ where: { id: record.id } })).status, 'failed');
      const historical = await f.prisma.aiPersonalAgentVersion.findMany({ where: { agentId: agent.id } }), p = await publication();
      await request('PATCH', `client/ai/personal-agents/${agent.id}`, { body: { ...content, expectedRevision: agent.revision } });
      assert.deepEqual(await publication(), p, 'identical head edit is no-op');
      agent = (await request('PATCH', `client/ai/personal-agents/${agent.id}`, { body: { ...content, instructions: 'AF189_CHANGED', expectedRevision: agent.revision } })).data;
      const edited = await publication(); assert.equal(edited.published, false); assert.equal(edited.publicationVersion, p.publicationVersion + 1);
      for (const h of historical) assert.deepEqual(await f.prisma.aiPersonalAgentVersion.findUniqueOrThrow({ where: { id: h.id } }), h);
      await makeAgent(); await mutate('publish'); const enabled = await publication();
      agent = (await request('PATCH', `client/ai/personal-agents/${agent.id}`, { body: { ...content, enabled: false, expectedRevision: agent.revision } })).data;
      assert.equal((await publication()).published, false); assert.equal((await publication()).publicationVersion, enabled.publicationVersion + 1);
      await unchanged(() => mutate('publish', { status: 409 })); proof.checks.invalidationAndLegacy = true;
    });
    await sub('current dependency/lifecycle/member fences remain authoritative', async () => {
      await makeAgent();
      const prior = await counts(); await request('DELETE', `client/ai/skills/${skill.id}`, { body: { expectedRevision: skill.revision } });
      assert.equal((await publication()).dependencyReadiness.ready, false); await unchanged(() => mutate('publish', { status: 409 })); assert.deepEqual(await counts(), prior);
      skill = (await request('POST', 'client/ai/skills', { status: 201, body: { code: 'af189-pin-' + randomUUID(), name: 'AF189 restored pin', instructions: 'AF189_NEW_PIN' } })).data;
      await makeAgent();
      const membership = await f.prisma.clientWorkspaceMembership.findUniqueOrThrow({ where: { workspaceId_memberId: { workspaceId: owner.workspaceId, memberId: f.accounts[0].id } } });
      await f.prisma.clientWorkspaceRole.update({ where: { id: membership.roleId }, data: { status: 'disabled' } });
      await request('GET', `client/ai/personal-agents/${agent.id}/publication`, { status: 403 });
      await f.prisma.clientWorkspaceRole.update({ where: { id: membership.roleId }, data: { status: 'active' } });
      const { PluginLifecycleService } = f.requireApi('plugin-runtime/plugin-lifecycle.service.js');
      const lifecycle = f.app.get(PluginLifecycleService), admin = await f.prisma.sysUser.findUniqueOrThrow({ where: { username: 'aij-admin' } });
      await lifecycle.disable('aij-ai', admin.id, 'af189-dependency-disable');
      await unchanged(() => request('GET', `client/ai/personal-agents/${agent.id}/publication`, { status: 404 }));
      await lifecycle.enable('aij-ai', admin.id, 'af189-dependency-enable');
      for (const [model, identity] of [[f.prisma.projectProfile, f.project.id], [f.prisma.organizationProfile, f.project.organizationId]]) {
        await model.update({ where: { id: identity }, data: { status: 'disabled' } });
        // Existing project selector returns 503 when the active project/org context disappears.
        await request('GET', `client/ai/personal-agents/${agent.id}/publication`, { status: 503 });
        await model.update({ where: { id: identity }, data: { status: 'active' } });
      }
      await f.prisma.clientWorkspaceMembership.update({ where: { id: membership.id }, data: { status: 'disabled', disabledAt: new Date() } });
      await request('GET', `client/ai/personal-agents/${agent.id}/publication`, { status: 403 });
      await f.prisma.clientWorkspaceMembership.update({ where: { id: membership.id }, data: { status: 'active', disabledAt: null } });
      const changedCatalog = structuredClone(catalog); changedCatalog.agents = []; changedCatalog.models[0].enabled = false;
      // Catalog revision change makes the saved head stale even before inspecting the model.
      catalogVersion = (await config.save(changedCatalog, catalogVersion)).data.version;
      assert.equal((await publication()).dependencyReadiness.ready, false);
      await unchanged(() => mutate('publish', { status: 409 }));
      catalogVersion = (await config.save(catalog, catalogVersion)).data.version;
      await makeAgent(); await mutate('publish'); const deleted = { ...agent }, priorPublication = await publication();
      await request('DELETE', `client/ai/personal-agents/${agent.id}`, { body: { expectedRevision: agent.revision } });
      const deletedHead = await f.prisma.aiPersonalAgent.findUniqueOrThrow({ where: { id: deleted.id } });
      assert.equal(deletedHead.publishedRevision, null); assert.equal(deletedHead.publicationVersion, priorPublication.publicationVersion + 1);
      await request('GET', `client/ai/personal-agents/${deleted.id}/publication`, { status: 404 });
      await makeAgent(); proof.checks.dependencies = true;
    });
    await sub('post-IO unpublish revocation cannot settle; same-worker stale nonce retains original fencing', async () => {
      await mutate('publish'); const r = await run(), old = await claim(); mode = 'hold'; barrier = deferred(); release = deferred();
      const work = jobs.execute(old); await waitGate(barrier.promise); await mutate('unpublish'); release.resolve(); await work; mode = 'text';
      const revoked = await f.prisma.aiAgentRun.findUniqueOrThrow({ where: { id: r.id } }); assert.equal(revoked.status, 'unknown'); assert.equal(revoked.budgetStatus, 'reserved'); assert.equal(revoked.output, null);
      await mutate('publish'); const nonceRun = await run(), stale = await claim(); mode = 'hold'; barrier = deferred(); release = deferred();
      const staleWork = jobs.execute(stale); await waitGate(barrier.promise);
      await f.prisma.runtimeJob.update({ where: { id: stale.id }, data: { maxAttempts: 2, leaseExpiresAt: new Date(Date.now() - 1000) } });
      const fresh = await claim(); assert.equal(fresh.lease_owner, stale.lease_owner); assert.notEqual(fresh.lease_nonce, stale.lease_nonce); await jobs.execute(fresh);
      const runBefore = await f.prisma.aiAgentRun.findUniqueOrThrow({ where: { id: nonceRun.id } }), budgetBefore = await f.prisma.aiEvaluationBudgetReservation.findUniqueOrThrow({ where: { id: nonceRun.id } });
      release.resolve(); await staleWork; mode = 'text'; assert.deepEqual(await f.prisma.aiAgentRun.findUniqueOrThrow({ where: { id: nonceRun.id } }), runBefore);
      assert.deepEqual(await f.prisma.aiEvaluationBudgetReservation.findUniqueOrThrow({ where: { id: nonceRun.id } }), budgetBefore); proof.checks.postIoAndNonce = true;
      const membership = await f.prisma.clientWorkspaceMembership.findUniqueOrThrow({ where: { workspaceId_memberId: { workspaceId: owner.workspaceId, memberId: f.accounts[0].id } } });
      const roleRun = await run(), roleJob = await claim(); mode = 'hold'; barrier = deferred(); release = deferred();
      const roleWork = jobs.execute(roleJob); await waitGate(barrier.promise);
      await f.prisma.clientWorkspaceRole.update({ where: { id: membership.roleId }, data: { status: 'disabled' } });
      release.resolve(); await roleWork; mode = 'text';
      const roleRevoked = await f.prisma.aiAgentRun.findUniqueOrThrow({ where: { id: roleRun.id } });
      assert.equal(roleRevoked.status, 'unknown'); assert.equal(roleRevoked.budgetStatus, 'reserved'); assert.equal(roleRevoked.output, null);
      await f.prisma.clientWorkspaceRole.update({ where: { id: membership.roleId }, data: { status: 'active' } });
      const { PluginLifecycleService } = f.requireApi('plugin-runtime/plugin-lifecycle.service.js');
      const lifecycle = f.app.get(PluginLifecycleService), admin = await f.prisma.sysUser.findUniqueOrThrow({ where: { username: 'aij-admin' } });
      for (const kind of ['member', 'plugin']) {
        const admitted = await run(), claimNow = await claim(); mode = 'hold'; barrier = deferred(); release = deferred();
        const running = jobs.execute(claimNow); await waitGate(barrier.promise);
        try {
          if (kind === 'member') await f.prisma.memberUser.update({ where: { id: f.accounts[0].id }, data: { status: 'disabled' } });
          else await lifecycle.disable('aij-ai', admin.id, 'af189-postio-disable');
          release.resolve(); await running;
          const denied = await f.prisma.aiAgentRun.findUniqueOrThrow({ where: { id: admitted.id } });
          assert.equal(denied.status, 'unknown'); assert.equal(denied.budgetStatus, 'reserved'); assert.equal(denied.output, null);
        } finally {
          release.resolve(); await running; mode = 'text';
          if (kind === 'member') await f.prisma.memberUser.update({ where: { id: f.accounts[0].id }, data: { status: 'active' } });
          else await lifecycle.enable('aij-ai', admin.id, 'af189-postio-enable');
        }
      }
    });
    await sub('native existing Agent detail publish -> existing run consumer -> unpublish refusal and callback races', async () => {
      await makeAgent();
      const result = await native.runNativePublicationAcceptance({ fixture: f, agent, publication, mutate, request, folder, execute,
        // Native adapter MUST use actual UI buttons/Cookie API, never return marker success.
        expectedCases: ['publishRunUnpublish', 'readonly', 'casIntent', 'unknownReadAcknowledge', 'scopeSessionRoleRace', 'nativeFocusUnmount'] });
      for (const name of ['publishRunUnpublish', 'readonly', 'casIntent', 'unknownReadAcknowledge', 'scopeSessionRoleRace', 'nativeFocusUnmount']) {
        const c = result?.cases?.[name]; assert.equal(c?.status, 'PASS', name); assert.ok(Array.isArray(c.screenshots) && c.screenshots.length, name + ' screenshots required');
        for (const path of c.screenshots) { assert.ok(isAbsolute(path) && existsSync(path)); assert.ok(statSync(path).size > 100); }
      }
      proof.native = result; proof.documentHidden = result.documentHidden ?? 'NOT_PROVEN'; proof.filePicker = 'NOT_PROVEN';
    });
    assert.equal(catalogVersion > 0, true);
    assert.doesNotMatch(JSON.stringify(await f.prisma.auditLog.findMany()), /AF189_PRIVATE|AF189_SYNTHETIC_INPUT/);
    proof.status = 'EVIDENCE_RECORDED_FORMAL_VERIFY_TASK_REMAINS_AUTHORITY';
  } finally {
    release?.resolve();
    if (server) { server.closeAllConnections(); await new Promise(r => server.close(r)); }
    if (secrets && secretResolve) secrets.resolveTrusted = secretResolve;
    await nativeHost.close(); await f.close();
    const sessions = await withDatabase('test', database, async c => (await c.query("SELECT application_name FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND backend_type='client backend'")).rows, { acceptanceId: f.lease.id });
    assert.deepEqual(sessions, [], 'all owned pools0'); proof.pools0 = true;
    writeFileSync(join(folder, 'publication-proof.json'), JSON.stringify(proof, null, 2));
  }
});
