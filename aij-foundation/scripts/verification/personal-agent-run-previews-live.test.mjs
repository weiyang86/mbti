// ROOT ONLY. Worker NOT_RUN. Requires fresh AF-165 registration, module/SDK exports,
// early no-store middleware BEFORE parsers, integrated AF157/159/161 and fresh build.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { request as httpRequest } from 'node:http';
import ts from 'typescript';
import { publishPersonalAgentFixture } from './personal-agent-publication-fixture.mjs';
import { createAcceptance, migrate } from '../database/migration.mjs';
import { seedDatabase } from '../database/seed.mjs';
import { clientEnvironment } from './client-auth-fixture.mjs';
import { syntheticAiCatalog } from './ai-center-fixture.mjs';
import { repositoryRoot, checkDatabase, withDatabase, readDatabaseEnvironment } from '../database/connection.mjs';

const require = createRequire(join(repositoryRoot, 'apps/api/package.json'));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const pause = ms => new Promise(r => setTimeout(r, ms));
const safeKeys = ['personalAgentId', 'code', 'name', 'revision', 'inputFields', 'outputFormat', 'outputFields', 'capability',
  'modelCode', 'modelRevision', 'catalogVersion', 'maximumEstimatedCostNanos', 'modelExecutionConfigured'].sort();

test('AF-165 fresh real session/PG/plugin/API/packed SDK SAFE readonly preflight', {
  timeout: 360000, skip: process.env.AIJ_AF165_ROOT_LIVE !== '1'
}, async t => {
  assert.equal(resolve(process.cwd()), '/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation');
  assert.equal(execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim(), 'dev');
  const gitPath = flag => resolve(repositoryRoot, execFileSync('git', ['rev-parse', flag], { encoding: 'utf8' }).trim());
  assert.equal(gitPath('--git-dir'), gitPath('--git-common-dir'), 'root database writer only');
  await checkDatabase('test'); const lease = await createAcceptance('test', 'AF-165');
  assert.equal((await migrate({ mode: 'test', action: 'deploy', acceptanceId: lease.id })).exitCode, 0);
  assert.equal((await migrate({ mode: 'test', action: 'status', acceptanceId: lease.id })).exitCode, 0);
  await seedDatabase({ mode: 'test', acceptanceId: lease.id, generateCredentials: true, runtimeManagement: true,
    pluginManagement: true, configuration: true, secrets: true, aiCenter: true });
  const previous = { ...process.env }, proof = { task: 'AF-165', acceptanceId: lease.id, database: lease.database, status: 'RUNNING' };
  const folder = join(repositoryRoot, '.artifacts/auto-ai-program-20261105/AF-165', lease.id);
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  let app, database;
  try {
    const env = clientEnvironment(lease.id, 'AF-165');
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, env, { ASYNC_RUNTIME_ENABLED: 'false', ENABLED_PLUGINS: 'aij-ai',
      AI_CENTER_CLIENT_EXECUTION_ENABLED: 'false', AI_CENTER_LIVE_ENABLED: 'false' });
    database = readDatabaseEnvironment('test', process.env, lease.id);
    const db = op => withDatabase('test', database, op, { acceptanceId: lease.id });
    const { createApplication } = require('../../apps/api/dist/bootstrap.js');
    const { PrismaService } = require('../../apps/api/dist/prisma/prisma.service.js');
    app = await createApplication(); await app.listen(0, '127.0.0.1'); const prisma = app.get(PrismaService);
    const base = `http://127.0.0.1:${app.getHttpServer().address().port}/api`, route = '/client/ai/personal-agents';
    const { PluginCatalog } = require('../../apps/api/dist/plugin-runtime/plugin-catalog.js');
    const { PluginLifecycleService } = require('../../apps/api/dist/plugin-runtime/plugin-lifecycle.service.js');
    const { AiCenterConfigurationService } = require('../../apps/api/dist/plugins/aij-ai/ai-center-configuration.service.js');
    const { AiCenterBudgetService } = require('../../apps/api/dist/plugins/aij-ai/ai-center-budget.service.js');
    const { AiPersonalAgentSnapshotsService } = require('../../apps/api/dist/plugins/aij-ai/ai-personal-agent-snapshots.service.js');
    const { AiCenterHttpTransport } = require('../../apps/api/dist/plugins/aij-ai/ai-center-provider.js');
    const { SecretRefPort } = require('../../apps/api/dist/secret-center/secret-ref.js');
    const { CLIENT_WORKSPACE_PERMISSION: P } = require('../../apps/api/dist/client-workspaces/client-workspace-permissions.js');
    const admin = await prisma.sysUser.findUniqueOrThrow({ where: { username: 'aij-admin' } });
    const lifecycle = app.get(PluginLifecycleService), pc = app.get(PluginCatalog), config = app.get(AiCenterConfigurationService);
    await lifecycle.install('aij-ai', pc.manifest('aij-ai').version, admin.id, 'af165-install');
    await lifecycle.enable('aij-ai', admin.id, 'af165-enable');
    // Fail-fast sentinels prove preflight never reaches secret resolution or upstream transport.
    let transports = 0, resolutions = 0;
    app.get(AiCenterHttpTransport).request = async () => { transports++; throw new Error('Unexpected preflight transport'); };
    const secrets = app.get(SecretRefPort);
    secrets.resolveTrusted = secrets.resolveTrustedForPlugin = async () => { resolutions++; throw new Error('Unexpected preflight secret resolution'); };
    const secretKey = 'AIJ_SECRET_AIJ_FOUNDATION_TEST_AF165'; process.env[secretKey] = 'synthetic-' + randomBytes(24).toString('hex');
    const ref = 'env://' + secretKey, reference = await prisma.secretReference.create({ data: { ref, provider: 'env' } });
    let catalog = syntheticAiCatalog(ref), catalogVersion = 0;
    catalog.agents.push({ ...catalog.agents[0], code: 'p-' + randomUUID() });
    const saveCatalog = async next => {
      const saved = await config.save({ catalog: next, expectedVersion: catalogVersion }, admin.id, 'af165-catalog');
      catalog = saved.catalog; catalogVersion = saved.version;
    };
    await saveCatalog(catalog);
    const cookies = [], accounts = [], spaces = [];
    for (let i = 0; i < 2; i++) {
      const password = 'Af165-' + randomBytes(24).toString('hex');
      const account = await prisma.memberUser.create({ data: { email: `af165-${randomUUID()}@example.test`, nickname: 'AF165 synthetic',
        passwordHash: await require('bcryptjs').hash(password, 12), emailVerifiedAt: new Date() } }); accounts.push(account);
      const r = await fetch(base + '/client/auth/login', { method: 'POST', headers: { origin: env.WEB_URL, 'content-type': 'application/json' },
        body: JSON.stringify({ email: account.email, password }), signal: AbortSignal.timeout(15000) });
      assert.equal(r.status, 200); cookies.push(r.headers.get('set-cookie').split(';')[0]); await r.arrayBuffer();
    }
    const request = async (method, path, { actor = 0, workspace = spaces[0]?.id, body, status = 200, origin = env.WEB_URL, headers = {} } = {}) => {
      const r = await fetch(base + path, { method, headers: { connection: 'close', ...(actor === null ? {} : { cookie: cookies[actor] }),
        ...(workspace ? { 'x-aij-workspace-id': workspace } : {}), ...(origin ? { origin } : {}),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
        body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
      const text = await r.text(); assert.equal(r.status, status, `${method} ${path}: ${text}`);
      if (path.startsWith(route)) assert.equal(r.headers.get('cache-control'), 'private, no-store');
      return text ? JSON.parse(text).data : undefined;
    };
    for (let i = 0; i < 2; i++) spaces.push(await request('POST', '/client/workspaces', { actor: i, status: 201,
      body: { name: 'AF165 synthetic ' + i, idempotencyKey: 'af165-' + randomUUID() } }));
    const roles = [];
    for (const [i, w] of spaces.entries()) {
      const role = await prisma.clientWorkspaceRole.findUniqueOrThrow({ where: { workspaceId_code: { workspaceId: w.id, code: 'OWNER' } } }); roles.push(role);
      await prisma.clientWorkspaceMembership.create({ data: { workspaceId: w.id, memberId: accounts[1 - i].id, roleId: role.id } });
    }
    const skill = await request('POST', '/client/ai/skills', { status: 201, body: { code: 'af165-skill', name: 'Synthetic Skill', instructions: 'AF165_PRIVATE_SKILL_SENTINEL' } });
    const makeAgent = async (extra = {}) => {
      const created = await request('POST', route, { status: 201, body: {
      code: 'af165-' + randomUUID(), name: 'AF165 Agent', instructions: 'AF165_PRIVATE_AGENT_SENTINEL', enabled: true,
      modelCode: 'advice-text', modelRevision: catalog.models[0].revision, catalogVersion,
      inputFields: ['question'], outputFormat: 'json', outputFields: ['answer'], skillBindings: [{ skillId: skill.id, revision: 1 }], ...extra
      } });
      if (created.enabled) await publishPersonalAgentFixture((method, path, options) => request(method, '/' + path, options), created);
      return created;
    };
    let agent = await makeAgent();
    const previewPath = (suffix = '', id = agent.id) => `${route}/${id}/run-preview?expectedRevision=${agent.revision}${suffix}`;
    const tableHashes = () => db(async c => {
      const tables = (await c.query("SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname='public' ORDER BY tablename")).rows, hashes = {};
      for (const { tablename } of tables) {
        assert.match(tablename, /^[A-Za-z_][A-Za-z0-9_]*$/);
        // Session liveness timestamps belong to authentication; every domain/audit row is exact.
        const projection = tablename === 'client_auth_session' ? "(to_jsonb(t)-'last_seen_at'-'updated_at')::text" : 'row_to_json(t)::text';
        const rows = (await c.query('SELECT ' + projection + ' AS row FROM public."' + tablename + '" t')).rows.map(r => r.row).sort();
        hashes[tablename] = createHash('sha256').update(JSON.stringify(rows)).digest('hex');
      }
      return hashes;
    });
    const unchanged = async op => { const before = await tableHashes(); const out = await op(); assert.deepEqual(await tableHashes(), before); return out; };
    const checkSafe = (p, ready) => {
      assert.deepEqual(Object.keys(p).sort(), safeKeys); assert.equal(p.personalAgentId, agent.id); assert.equal(p.code, agent.code);
      assert.equal(p.name, agent.name); assert.equal(p.revision, agent.revision); assert.equal(p.capability, 'text');
      assert.deepEqual(p.inputFields, ['question']); assert.deepEqual(p.outputFields, ['answer']); assert.equal(p.outputFormat, 'json');
      assert.equal(p.maximumEstimatedCostNanos, app.get(AiCenterBudgetService).estimate(catalog.models[0]).toString());
      assert.equal(p.modelExecutionConfigured, ready);
      assert.doesNotMatch(JSON.stringify(p), /AF165_PRIVATE_|https:|env:|credential|upstreamModel|providerCode|instructions|snapshot|memory/i);
    };
    await t.test('default-off GET succeeds without Origin and changes zero execution/budget/catalog/assets/audit rows', async () => {
      await unchanged(async () => { for (let i = 0; i < 4; i++) checkSafe(await request('GET', previewPath(), { origin: null }), false); });
      await unchanged(async () => checkSafe(await request('GET', previewPath(), { origin: 'https://foreign.invalid', headers: { 'sec-fetch-site': 'cross-site' } }), false));
    });
    await t.test('configured true uses owned synthetic reference only; each flag and missing metadata safely yields false with cost', async () => {
      catalog.providers[0].liveEnabled = true; await saveCatalog(catalog); agent = await makeAgent();
      process.env.AI_CENTER_CLIENT_EXECUTION_ENABLED = 'true'; process.env.AI_CENTER_LIVE_ENABLED = 'true';
      await unchanged(async () => checkSafe(await request('GET', previewPath()), true));
      for (const key of ['AI_CENTER_CLIENT_EXECUTION_ENABLED', 'AI_CENTER_LIVE_ENABLED']) {
        process.env[key] = 'false'; try { await unchanged(async () => checkSafe(await request('GET', previewPath()), false)); } finally { process.env[key] = 'true'; }
      }
      await prisma.secretReference.update({ where: { id: reference.id }, data: { status: 'disabled' } });
      try { await unchanged(async () => checkSafe(await request('GET', previewPath()), false)); }
      finally { await prisma.secretReference.update({ where: { id: reference.id }, data: { status: 'active' } }); }
      assert.equal(transports, 0); assert.equal(resolutions, 0);
    });
    await t.test('strict queries, cross-owner/space/session/permission/read-only grants and revision refusals stay no-store', async () => {
      await unchanged(() => request('GET', previewPath(), { actor: null, status: 401 }));
      await unchanged(() => request('GET', previewPath(), { actor: 1, status: 404 }));
      await unchanged(() => request('GET', previewPath(), { workspace: spaces[1].id, status: 404 }));
      for (const field of ['workspaceId', 'memberId', 'source', 'snapshot', 'model', 'provider', 'input', 'memory', 'tools'])
        await unchanged(() => request('GET', previewPath('&' + field + '=forged'), { status: 400 }));
      for (const suffix of ['', '0', '01', '-1', '1e2', '2147483648', `${agent.revision}&expectedRevision=${agent.revision}`])
        await unchanged(() => request('GET', `${route}/${agent.id}/run-preview?expectedRevision=${suffix}`, { status: 400 }));
      await unchanged(() => request('GET', `${route}/${agent.id}/run-preview`, { status: 400 }));
      await unchanged(() => request('GET', `${route}/p-${agent.id}/run-preview?expectedRevision=1`, { status: 400 }));
      await unchanged(() => request('GET', `${route}/${agent.id}/run-preview?expectedRevision=${agent.revision + 1}`, { status: 409 }));
      for (const code of [P.aiExecute, P.aiAssetsRead]) {
        const permission = await prisma.clientWorkspacePermission.findFirstOrThrow({ where: { code } });
        const grant = await prisma.clientWorkspaceRolePermission.findFirstOrThrow({ where: { roleId: roles[0].id, permissionId: permission.id, deletedAt: null } });
        await prisma.clientWorkspaceRolePermission.update({ where: { id: grant.id }, data: { deletedAt: new Date() } });
        try { await unchanged(() => request('GET', previewPath(), { status: 403 })); }
        finally { await prisma.clientWorkspaceRolePermission.update({ where: { id: grant.id }, data: { deletedAt: null } }); }
      }
    });
    await t.test('early parser/body failures are private before guards', async () => {
      const ordinary = await fetch(base + '/client/auth/me', { signal: AbortSignal.timeout(10000) });
      assert.equal(ordinary.status, 401); assert.equal(ordinary.headers.get('cache-control'), 'no-store');
      assert.deepEqual(await ordinary.json(), { success: false, data: null, message: 'Invalid credentials or authorization' });

      const raw = (body, path = previewPath()) => new Promise((resolve, reject) => {
        const req = httpRequest(base + path, { method: 'GET', headers: { cookie: cookies[0], origin: env.WEB_URL,
          'x-aij-workspace-id': spaces[0].id, 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)) } }, res => {
          let text = ''; res.setEncoding('utf8'); res.on('data', b => { text += b; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
        }); req.setTimeout(15000, () => req.destroy(new Error('raw GET timeout'))); req.on('error', reject); req.end(body);
      });
      for (const body of ['{', '{}', '{"workspaceId":"forged"}', '{"huge":"' + 'x'.repeat(120000) + '"}']) await unchanged(async () => {
        const r = await raw(body); assert.ok([400, 413].includes(r.status), 'Rejected raw GET status ' + r.status + ', bytes ' + Buffer.byteLength(body)); assert.equal(r.headers['cache-control'], 'private, no-store');
      });
      await unchanged(async () => { const r = await raw('{}', `${route}/%ZZ/run-preview?expectedRevision=1`); assert.equal(r.status, 400); assert.equal(r.headers['cache-control'], 'private, no-store'); });
    });
    await t.test('actual private revision/Skill/catalog/model/provider and plugin lifecycle are authoritative', async () => {
      const disabled = await makeAgent({ enabled: false }); await unchanged(() => request('GET', previewPath('', disabled.id), { status: 404 }));
      await request('PATCH', '/client/ai/skills/' + skill.id, { body: { name: skill.name, instructions: 'LATER_VERSION_NOT_THE_PIN', expectedRevision: 1 } });
      await unchanged(async () => checkSafe(await request('GET', previewPath()), true));
      await lifecycle.disable('aij-ai', admin.id, 'af165-disable');
      try { await unchanged(() => request('GET', previewPath(), { status: 404 })); }
      finally { await lifecycle.enable('aij-ai', admin.id, 'af165-enable-again'); }
      const original = structuredClone(catalog);
      for (const mutate of [c => { c.models[0].enabled = false; }, c => { c.providers[0].enabled = false; }]) {
        const next = structuredClone(original); next.agents = []; mutate(next); await saveCatalog(next);
        await unchanged(() => request('GET', previewPath(), { status: 409 })); await saveCatalog(original); agent = await makeAgent();
      }
      const stale = agent; await saveCatalog(catalog); await unchanged(() => request('GET', previewPath('', stale.id), { status: 409 })); agent = await makeAgent();
      await request('DELETE', '/client/ai/skills/' + skill.id, { body: { expectedRevision: 2 } });
      await unchanged(() => request('GET', previewPath(), { status: 404 }));
      agent = await makeAgent({ skillBindings: [] }); // Remaining tests need no deleted pin.
    });
    await t.test('active project/org/member/workspace/role/membership state gates reads', async () => {
      const project = await prisma.projectProfile.findFirstOrThrow(), membership = await prisma.clientWorkspaceMembership.findFirstOrThrow({ where: { workspaceId: spaces[0].id, memberId: accounts[0].id } });
      for (const [delegate, id, status] of [[prisma.projectProfile, project.id, 503], [prisma.organizationProfile, project.organizationId, 503],
        [prisma.memberUser, accounts[0].id, 401], [prisma.clientWorkspace, spaces[0].id, 403],
        [prisma.clientWorkspaceRole, roles[0].id, 403], [prisma.clientWorkspaceMembership, membership.id, 403]]) {
        const previous = await delegate.findUniqueOrThrow({ where: { id } }); await delegate.update({ where: { id }, data: { status: 'disabled' } });
        try { await unchanged(() => request('GET', previewPath(), { status })); }
        finally { await delegate.update({ where: { id }, data: { status: previous.status } }); }
      }
    });
    await t.test('real membership and plugin lifecycle locks serialize revocation until readonly transaction commits', async () => {
      const snapshots = app.get(AiPersonalAgentSnapshotsService), original = snapshots.resolve.bind(snapshots);
      const project = await prisma.projectProfile.findFirstOrThrow();
      for (const kind of ['membership', 'plugin']) {
        const entered = deferred(), release = deferred(), revoker = deferred(); let pending, revoke;
        snapshots.resolve = async (...args) => { const value = await original(...args); entered.resolve(); await release.promise; return value; };
        try {
          pending = request('GET', previewPath()); await Promise.race([entered.promise, pending.then(() => { throw new Error('preview missed lock barrier'); })]);
          revoke = db(async c => {
            await c.query('BEGIN'); revoker.resolve((await c.query('SELECT pg_backend_pid() AS id')).rows[0].id);
            try {
              if (kind === 'membership') {
                await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', ['aij-client-workspace-membership:' + spaces[0].id]);
                await c.query("UPDATE public.client_workspace_role SET status='disabled' WHERE id=$1", [roles[0].id]);
              } else {
                await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['plugin-lifecycle:' + project.id + ':aij-ai']);
                await c.query("UPDATE public.plugin_installation SET status='installed' WHERE project_id=$1 AND plugin_code='aij-ai'", [project.id]);
              }
              await c.query('COMMIT');
            } catch (e) { await c.query('ROLLBACK'); throw e; }
          });
          const pid = await revoker.promise; let blocked = false;
          for (let i = 0; i < 30; i++) { blocked = await db(async c => (await c.query('SELECT cardinality(pg_blocking_pids($1))>0 AS b', [pid])).rows[0].b); if (blocked) break; await pause(25); }
          assert.equal(blocked, true, kind + ' fence must be observed in pg_blocking_pids'); release.resolve(); await pending; await revoke;
          await unchanged(() => request('GET', previewPath(), { status: kind === 'membership' ? 403 : 404 })); proof[kind + 'FenceObserved'] = true;
        } finally {
          release.resolve(); snapshots.resolve = original; await pending?.catch(() => {}); await revoke?.catch(() => {});
          if (kind === 'membership') await prisma.clientWorkspaceRole.update({ where: { id: roles[0].id }, data: { status: 'active' } });
          else await lifecycle.enable('aij-ai', admin.id, 'af165-enable-after-fence');
        }
      }
    });
    await t.test('packed compiled ESM/CJS factories use actual ClientApi and strict types, including 401/403/404/409', async () => {
      const packed = join(folder, 'packed'), modules = join(packed, 'node_modules/@aij'); mkdirSync(modules, { recursive: true });
      for (const name of ['contracts', 'sdk']) {
        const output = join(modules, name); mkdirSync(output, { recursive: true });
        execFileSync('pnpm', ['pack', '--pack-destination', packed], { cwd: join(repositoryRoot, 'packages', name), stdio: 'pipe' });
        execFileSync('tar', ['-xzf', join(packed, `aij-${name}-0.1.0.tgz`), '-C', output, '--strip-components=1']);
      }
      writeFileSync(join(packed, 'package.json'), '{"private":true,"type":"module"}');
      const consumer = join(packed, 'consumer.mjs'); writeFileSync(consumer, "export * from '@aij/sdk';\n");
      const packedRequire = createRequire(join(packed, 'consumer.cjs'));
      for (const sdk of [packedRequire('@aij/sdk'), await import(pathToFileURL(consumer))]) {
        const api = sdk.createClientApi(() => base);
        const client = sdk.createPersonalAgentRunPreviewsClient((p, o = {}) => api(p, { ...o, headers: { cookie: cookies[0] } }));
        await unchanged(async () => checkSafe(await client.preview(spaces[0].id, agent.id, agent.revision), true));
        await unchanged(() => assert.rejects(client.preview(spaces[0].id, agent.id, agent.revision + 1), e => e instanceof sdk.ClientRequestFailure && e.status === 409));
        await unchanged(() => assert.rejects(client.preview(spaces[1].id, agent.id, agent.revision), e => e instanceof sdk.ClientRequestFailure && e.status === 404));
        await unchanged(() => assert.rejects(client.preview('not-a-membership', agent.id, agent.revision), e => e instanceof sdk.ClientRequestFailure && e.status === 403));
        const anonymous = sdk.createPersonalAgentRunPreviewsClient(api);
        await unchanged(() => assert.rejects(anonymous.preview(spaces[0].id, agent.id, agent.revision), e => e instanceof sdk.ClientRequestFailure && e.status === 401));
      }
      const sources = [];
      for (const ext of ['mts', 'cts']) {
        const path = join(packed, 'types.' + ext); sources.push(path);
        writeFileSync(path, `import {createPersonalAgentRunPreviewsClient, type PersonalAgentRunPreview} from '@aij/sdk';
          const c=createPersonalAgentRunPreviewsClient(async <T,>()=>({} as T)); const p:Promise<PersonalAgentRunPreview>=c.preview('space','${agent.id}',1);void p;
          // @ts-expect-error revision must be number
          c.preview('space','${agent.id}','1');
          // @ts-expect-error no body argument
          c.preview('space','${agent.id}',1,{snapshot:{}});
          function safe(p:PersonalAgentRunPreview){const text:'text'=p.capability;void text;
          // @ts-expect-error no secret field
          p.credentialRef;}void safe;`);
      }
      const program = ts.createProgram(sources, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext,
        moduleResolution: ts.ModuleResolutionKind.NodeNext, strict: true, skipLibCheck: true, noEmit: true, types: [], lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'] });
      assert.deepEqual(ts.getPreEmitDiagnostics(program).map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')), []);
      proof.packedEsmCjsAndStrictTypes = true;
    });
    assert.equal(transports, 0); assert.equal(resolutions, 0);
    proof.transportCalls = transports; proof.secretResolutions = resolutions; proof.domainHashesUnchangedPerRead = true;
    proof.status = 'EVIDENCE_RECORDED_FORMAL_REPORT_IS_AUTHORITY';
  } finally {
    try {
      await app?.close();
      if (database) {
        proof.applicationPools = await withDatabase('test', database, async c => (await c.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND application_name LIKE 'aij-api:%'")).rows[0].n, { acceptanceId: lease.id });
        assert.equal(proof.applicationPools, 0);
      }
      writeFileSync(join(folder, 'live.json'), JSON.stringify(proof, null, 2) + '\n', { mode: 0o600 });
    } finally { for (const k of Object.keys(process.env)) delete process.env[k]; Object.assign(process.env, previous); }
  }
});
