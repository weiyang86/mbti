// ROOT ONLY: import through a trusted exact-runner adapter which sets AIJ_AF145_LIVE=1.
// Worker may syntax-check/lint this file but must never execute it.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import test from 'node:test';

const task = 'AF-145';
const authorizedRoot = '/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation';
const repositoryRoot = resolve(import.meta.dirname, '../..');
const projection = ['id', 'agentCode', 'status', 'budgetStatus', 'createdAt', 'expiresAt', 'contentAvailable'].sort();
function check(condition) { if (!condition) throw new Error('AF145 live assertion failed (raw details withheld)'); }
const restoreEnvironment = previous => { for (const key of Object.keys(process.env)) delete process.env[key]; Object.assign(process.env, previous); };
const digest = rows => createHash('sha256').update(JSON.stringify(rows, (_key, value) => typeof value === 'bigint' ? value.toString() : value)).digest('hex');

test('AF145 root-only real Cookie/HTTP/PostgreSQL read-only request recovery', { timeout: 240000 }, async t => {
  check(process.env.AIJ_AF145_LIVE === '1' && repositoryRoot === authorizedRoot && process.cwd() === authorizedRoot);
  check(realpathSync(repositoryRoot) === realpathSync(authorizedRoot));
  const git = (...args) => execFileSync('git', args, { cwd: repositoryRoot, encoding: 'utf8' }).trim();
  check(realpathSync(resolve(repositoryRoot, git('rev-parse', '--git-dir'))) === realpathSync(resolve(repositoryRoot, git('rev-parse', '--git-common-dir'))));
  check(git('branch', '--show-current') === 'dev');
  // All imports capable of accessing a database occur after the root/main-worktree/opt-in gates.
  const { createAcceptance, migrate } = await import('../database/migration.mjs');
  const { acceptanceRecord, assertLocalPath, readDatabaseEnvironment, withDatabase } = await import('../database/connection.mjs');
  const { prepareClientFixture, clientEnvironment } = await import('./client-auth-fixture.mjs');
  const require = createRequire(join(repositoryRoot, 'apps/api/package.json'));
  const previous = { ...process.env }, directory = join(repositoryRoot, '.artifacts/auto-ai-program-20261105/AF-145');
  assertLocalPath(directory); mkdirSync(directory, { recursive: true, mode: 0o700 });
  const reportPath = join(directory, 'live-' + randomUUID() + '.json');
  const evidence = { task, status: 'RUNNING', cases: [], liveVendor: 'NOT_RUN', browser: 'NOT_RUN', cleanup: { hooksRestored: false, ownedRowsRemoved: false, appClosed: false, pools0: false } };
  const save = () => writeFileSync(reportPath, JSON.stringify(evidence, null, 2) + '\n', { mode: 0o600 });
  let lease, app, prisma, failed = false, casesFailed = false;
  const runIds = [], jobIds = [], budgetIds = [];
  const hooks = [], prohibitedCalls = {};
  const scenario = async (name, action) => {
    if (casesFailed) return;
    await t.test(name, async () => {
      try { await action(); evidence.cases.push({ name, status: 'PASS' }); }
      catch { casesFailed = true; failed = true; evidence.cases.push({ name, status: 'FAILED' }); throw new Error('AF145 live scenario failed: ' + name + ' (raw details withheld)'); }
      finally { save(); }
    });
  };
  try {
    lease = await createAcceptance('test', task);
    check(lease.task === task && /^aij_foundation_af145_test_[a-f0-9]{16}$/.test(lease.database));
    evidence.leaseId = lease.id;
    check((await migrate({ mode: 'test', action: 'deploy', acceptanceId: lease.id })).exitCode === 0);
    check((await migrate({ mode: 'test', action: 'status', acceptanceId: lease.id })).exitCode === 0);
    const members = await prepareClientFixture(lease.id, task);
    const credentials = JSON.parse(readFileSync(members.accounts[0].initialPasswordFile, 'utf8')).accounts;
    restoreEnvironment({ ...clientEnvironment(lease.id, task), ASYNC_RUNTIME_ENABLED: 'false', ENABLED_PLUGINS: 'aij-ai', AI_CENTER_CLIENT_EXECUTION_ENABLED: 'false', AI_CENTER_LIVE_ENABLED: 'false' });
    const { createApplication } = require('./dist/bootstrap.js');
    const { PrismaService } = require('./dist/prisma/prisma.service.js');
    app = await createApplication();
    prisma = app.get(PrismaService);
    await app.listen(0, '127.0.0.1');
    const baseUrl = `http://127.0.0.1:${app.getHttpServer().address().port}/api`;
    // No raw body, Cookie, key, request URL or driver error may appear in assertions/evidence.
    const request = async (method, path, { cookie, workspaceId, body, status = 200 } = {}) => {
      const response = await fetch(baseUrl + '/' + path, { method, headers: { connection: 'close', origin: process.env.WEB_URL, ...(cookie ? { cookie } : {}), ...(workspaceId ? { 'x-aij-workspace-id': workspaceId } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000) });
      const text = await response.text(); check(response.status === status);
      let envelope; try { envelope = text ? JSON.parse(text) : null; } catch { check(false); }
      return { response, envelope, data: envelope?.data };
    };
    const cookies = [], workspaces = [];
    for (const account of members.accounts) {
      const credential = credentials.find(row => row.id === account.id);
      const login = await request('POST', 'client/auth/login', { body: { email: account.email, password: credential.password } });
      const cookie = login.response.headers.get('set-cookie')?.split(';')[0]; check(cookie); cookies.push(cookie);
      workspaces.push((await request('POST', 'client/workspaces', { cookie, body: { name: 'AF145 synthetic workspace', idempotencyKey: 'af145-space-' + workspaces.length }, status: 201 })).data);
    }
    const [member, other] = members.accounts, [workspace, otherWorkspace] = workspaces;
    const project = await prisma.projectProfile.findFirstOrThrow({ where: { code: 'aij-foundation-test' } });
    await prisma.pluginInstallation.upsert({ where: { projectId_pluginCode: { projectId: project.id, pluginCode: 'aij-ai' } }, create: { projectId: project.id, pluginCode: 'aij-ai', version: '0.1.0', owner: '@aij/api', status: 'enabled', installedAt: new Date(), enabledAt: new Date() }, update: { status: 'enabled' } });
    const owner = await prisma.clientWorkspaceRole.findUniqueOrThrow({ where: { workspaceId_code: { workspaceId: workspace.id, code: 'OWNER' } } });
    const otherOwner = await prisma.clientWorkspaceRole.findUniqueOrThrow({ where: { workspaceId_code: { workspaceId: otherWorkspace.id, code: 'OWNER' } } });
    await prisma.clientWorkspaceMembership.create({ data: { workspaceId: workspace.id, memberId: other.id, roleId: owner.id } });
    await prisma.clientWorkspaceMembership.create({ data: { workspaceId: otherWorkspace.id, memberId: member.id, roleId: otherOwner.id } });
    const membership = await prisma.clientWorkspaceMembership.findUniqueOrThrow({ where: { workspaceId_memberId: { workspaceId: workspace.id, memberId: member.id } } });
    const options = { cookie: cookies[0], workspaceId: workspace.id };
    const budget = await prisma.aiEvaluationBudgetRun.create({ data: { projectId: project.id, runKey: 'af145-synthetic-budget', policyHash: 'a'.repeat(64), usedNanos: 0n, kind: 'application' } }); budgetIds.push(budget.id);
    const seeded = [];
    const seedRun = async (key, status, budgetStatus, extra = {}) => {
      const id = randomUUID(), jobId = randomUUID(); jobIds.push(jobId); runIds.push(id);
      const scope = { projectId: project.id, workspaceId: workspace.id, memberId: member.id, ...extra };
      await prisma.runtimeJob.create({ data: { id: jobId, jobType: 'aij-ai.agent-execute', jobVersion: 1, payload: { runId: id }, scope: 'plugin', scopeId: scope.projectId, pluginCode: 'aij-ai', workspaceId: scope.workspaceId, status: status === 'queued' ? 'pending' : status === 'succeeded' ? 'completed' : 'dead', idempotencyKey: 'af145-job-' + id, maxAttempts: 1 } });
      const chargedNanos = budgetStatus === 'released' ? 0n : 100n;
      const row = await prisma.aiAgentRun.create({ data: { id, jobId, projectId: scope.projectId, workspaceId: scope.workspaceId, memberId: scope.memberId, agentCode: 'removed-synthetic-agent', agentRevision: 1, catalogVersion: 1, idempotencyKey: key, requestHash: 'b'.repeat(64), status, budgetStatus, estimatedCostNanos: chargedNanos, snapshot: { credentialRef: 'synthetic-forbidden-reference' }, input: { private: 'synthetic-private-input' }, output: 'synthetic-private-output', attemptedAt: status === 'queued' ? null : new Date(), expiresAt: extra.expiresAt ?? new Date(Date.now() + 3600000), contentPurgedAt: extra.contentPurgedAt ?? null } });
      await prisma.aiEvaluationBudgetReservation.create({ data: { id, runId: budget.id, reservedNanos: 100n, chargedNanos, status: budgetStatus === 'released' ? 'settled' : budgetStatus } });
      await prisma.aiEvaluationBudgetRun.update({ where: { id: budget.id }, data: { usedNanos: { increment: chargedNanos } } });
      seeded.push(row); return row;
    };
    for (const [status, budgetStatus] of [['queued', 'reserved'], ['running', 'reserved'], ['succeeded', 'settled'], ['failed', 'released'], ['unknown', 'reserved']]) await seedRun('af145-' + status, status, budgetStatus);
    await seedRun('af145-expired', 'unknown', 'reserved', { expiresAt: new Date(Date.now() - 1) });
    const purged = await seedRun('af145-purged', 'succeeded', 'settled', { contentPurgedAt: new Date() });
    const { Prisma } = require('@prisma/client');
    await prisma.aiAgentRun.update({ where: { id: purged.id }, data: { input: Prisma.DbNull, output: Prisma.DbNull, snapshot: Prisma.DbNull } });
    // Duplicate keys in every other scope must neither displace nor reveal this member's run.
    await seedRun('af145-queued', 'unknown', 'reserved', { memberId: other.id });
    await seedRun('af145-queued', 'unknown', 'reserved', { workspaceId: otherWorkspace.id });
    await seedRun('af145-queued', 'unknown', 'reserved', { projectId: 'af145-foreign-project' });
    await seedRun('af145-foreign-member', 'unknown', 'reserved', { memberId: other.id });
    await seedRun('af145-foreign-space', 'unknown', 'reserved', { workspaceId: otherWorkspace.id });
    await seedRun('af145-foreign-project', 'unknown', 'reserved', { projectId: 'af145-foreign-project' });
    const trap = (file, className, methods) => {
      const instance = app.get(require('./dist/' + file)[className]);
      for (const method of methods) {
        const original = instance[method], name = className + '.' + method;
        prohibitedCalls[name] = 0;
        hooks.push(() => { instance[method] = original; });
        instance[method] = () => { prohibitedCalls[name]++; throw new Error('Prohibited execution dependency'); };
      }
    };
    trap('plugins/aij-ai/ai-center-configuration.service.js', 'AiCenterConfigurationService', ['current']);
    trap('plugins/aij-ai/ai-center-provider.js', 'AiCenterProviderService', ['invoke', 'assertLive']);
    trap('plugins/aij-ai/ai-center-budget.service.js', 'AiCenterBudgetService', ['reserve', 'settle']);
    trap('async-runtime/job.service.js', 'JobService', ['enqueueInTransaction']);
    const state = async () => {
      const names = ['aiAgentRun', 'runtimeJob', 'aiEvaluationBudgetRun', 'aiEvaluationBudgetReservation', 'aiExecutionTrace'];
      const result = {};
      for (const name of names) { const rows = await prisma[name].findMany({ orderBy: { id: 'asc' } }); result[name] = { count: rows.length, sha256: digest(rows) }; }
      return result;
    };
    const before = await state(); evidence.before = before;
    const recover = (key, opts = options, status = 200) => request('GET', 'client/ai/run-requests/' + encodeURIComponent(key), { ...opts, status });
    await scenario('all-stored-statuses-expired-purged-with-execution-and-config-unavailable', async () => {
      check(await prisma.scopedConfig.count({ where: { pluginCode: 'aij-ai' } }) === 0);
      check(await prisma.secretReference.count() === 0);
      for (const row of seeded.slice(0, 7)) {
        const result = await recover(row.idempotencyKey); check(result.response.headers.get('cache-control') === 'private, no-store');
        check(digest(Object.keys(result.data).sort()) === digest(projection));
        check(result.data.id === row.id && result.data.agentCode === row.agentCode && result.data.status === row.status && result.data.budgetStatus === row.budgetStatus);
        check(result.data.createdAt === row.createdAt.toISOString() && result.data.expiresAt === row.expiresAt.toISOString());
        check(result.data.contentAvailable === (!row.contentPurgedAt && row.expiresAt.getTime() > Date.now()));
      }
      // A dead runtime job with a stored running run remains running/reserved, no reconciliation.
      check((await recover('af145-running')).data.status === 'running');
      await request('POST', 'client/ai/agents/removed-synthetic-agent/runs', { ...options, body: { idempotencyKey: 'af145-post-disabled', input: {} }, status: 503 });
    });
    await scenario('uniform-404-for-other-member-space-project-and-missing', async () => {
      const envelopes = [];
      for (const key of ['af145-foreign-member', 'af145-foreign-space', 'af145-foreign-project', 'af145-missing']) {
        const result = await recover(key, options, 404); envelopes.push(result.envelope);
        check(!JSON.stringify(result.envelope).includes(key));
      }
      // Correlation IDs may differ; application failure code/message must be uniform.
      check(envelopes.every(body => body.code === envelopes[0].code && body.message === envelopes[0].message));
      check((await recover('af145-queued')).data.id === seeded[0].id);
      check((await recover('af145-queued', { cookie: cookies[1], workspaceId: workspace.id })).data.id === seeded[7].id);
      check((await recover('af145-queued', { cookie: cookies[0], workspaceId: otherWorkspace.id })).data.id === seeded[8].id);
    });
    await scenario('anonymous-invalid-cookie-and-invalid-key', async () => {
      await recover('af145-queued', { workspaceId: workspace.id }, 401);
      await recover('af145-queued', { cookie: 'invalid_client=invalid', workspaceId: workspace.id }, 401);
      await recover('af145-queued', { cookie: cookies[0] }, 400);
      for (const key of ['short', 'x'.repeat(129), 'bad.key---', 'bad key---', '中文中文中文中文']) await recover(key, options, 400);
    });
    await scenario('current-member-membership-workspace-role-grant-and-plugin-revocations', async () => {
      const denyWhile = async (model, where, data, restore, expected = 403) => {
        await prisma[model].update({ where, data });
        try { await recover('af145-queued', options, expected); }
        finally { await prisma[model].update({ where, data: restore }); }
      };
      await denyWhile('memberUser', { id: member.id }, { status: 'disabled' }, { status: 'active' }, 401);
      await denyWhile('clientWorkspaceMembership', { id: membership.id }, { status: 'disabled', disabledAt: new Date() }, { status: 'active', disabledAt: null });
      await denyWhile('clientWorkspace', { id: workspace.id }, { status: 'disabled' }, { status: 'active' });
      await denyWhile('clientWorkspaceRole', { id: owner.id }, { status: 'disabled' }, { status: 'active' });
      const read = await prisma.clientWorkspacePermission.findUniqueOrThrow({ where: { code: 'workspace.ai.read' } });
      await denyWhile('clientWorkspaceRolePermission', { roleId_permissionId: { roleId: owner.id, permissionId: read.id } }, { deletedAt: new Date() }, { deletedAt: null });
      const execute = await prisma.clientWorkspacePermission.findUniqueOrThrow({ where: { code: 'workspace.ai.execute' } });
      await prisma.clientWorkspaceRolePermission.update({ where: { roleId_permissionId: { roleId: owner.id, permissionId: execute.id } }, data: { deletedAt: new Date() } });
      try { check((await recover('af145-queued')).data.id === seeded[0].id); }
      finally { await prisma.clientWorkspaceRolePermission.update({ where: { roleId_permissionId: { roleId: owner.id, permissionId: execute.id } }, data: { deletedAt: null } }); }
      await denyWhile('pluginInstallation', { projectId_pluginCode: { projectId: project.id, pluginCode: 'aij-ai' } }, { status: 'installed' }, { status: 'enabled' }, 404);
    });
    await scenario('exported-sdk-consumes-real-cookie-http-without-retry-or-post', async () => {
      // Root exports the module and rebuilds SDK before this live test.
      const sdk = createRequire(join(repositoryRoot, 'packages/sdk/package.json'))('./dist/index.cjs');
      check(typeof sdk.createAiRunRecoveryClient === 'function');
      const api = sdk.createClientApi(() => baseUrl), calls = [];
      const client = sdk.createAiRunRecoveryClient((path, opts) => { calls.push({ path, opts }); return api(path, { ...opts, headers: { cookie: cookies[0] } }); });
      const recovered = await client.recoverRequest(workspace.id, 'af145-unknown');
      check(recovered.id === seeded[4].id && recovered.status === 'unknown' && recovered.budgetStatus === 'reserved');
      let rejected = false;
      try { await client.recoverRequest(workspace.id, 'af145-missing'); } catch (error) { rejected = error instanceof sdk.ClientRequestFailure && error.status === 404; }
      check(rejected && calls.length === 2 && calls.every(call => call.opts.method === 'GET' && call.opts.body === undefined));
    });
    await scenario('row-job-budget-and-trace-counts-and-entire-stored-state-unchanged', async () => {
      const after = await state(); evidence.after = after;
      check(digest(before) === digest(after));
      check(after.aiExecutionTrace.count === 0);
      check(Object.values(prohibitedCalls).every(count => count === 0));
      evidence.prohibitedCalls = prohibitedCalls;
    });
    evidence.status = failed ? 'FAILED' : 'PASS';
  } catch {
    failed = true; evidence.status = 'FAILED'; evidence.reason = 'Live setup or verification failed; raw details withheld';
  } finally {
    const cleanup = async (name, operation) => { try { await operation(); evidence.cleanup[name] = true; } catch { failed = true; evidence.cleanup[name] = false; } };
    await cleanup('hooksRestored', async () => { for (const restore of hooks.reverse()) restore(); });
    await cleanup('ownedRowsRemoved', async () => {
      if (!prisma) return;
      await prisma.$transaction(async tx => {
        await tx.aiEvaluationBudgetReservation.deleteMany({ where: { id: { in: runIds } } });
        await tx.aiAgentRun.deleteMany({ where: { id: { in: runIds } } });
        await tx.runtimeJob.deleteMany({ where: { id: { in: jobIds } } });
        await tx.aiEvaluationBudgetRun.deleteMany({ where: { id: { in: budgetIds } } });
      });
      check(await prisma.aiAgentRun.count({ where: { id: { in: runIds } } }) === 0 && await prisma.runtimeJob.count({ where: { id: { in: jobIds } } }) === 0);
    });
    await cleanup('appClosed', async () => { if (app) await app.close(); if (prisma) await prisma.$disconnect(); });
    restoreEnvironment(previous);
    await cleanup('pools0', async () => {
      check(lease && acceptanceRecord('test', lease.id).task === task);
      const count = await withDatabase('test', readDatabaseEnvironment('test', previous, lease.id), async client => (await client.query("SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND application_name LIKE 'aij-api:%'")).rows[0].count, { acceptanceId: lease.id });
      check(count === 0);
    });
    evidence.status = failed ? 'FAILED' : 'PASS'; save();
  }
  assert.equal(failed, false, 'AF145 live verification failed; inspect safe aggregate evidence');
});
