import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import test from 'node:test';
import ts from 'typescript';

const root = resolve(import.meta.dirname, '../..');
const require = createRequire(resolve(root, 'apps/api/package.json'));
require('ts-node').register({ project: resolve(root, 'apps/api/tsconfig.json'), transpileOnly: true });
require('reflect-metadata');
const { AiCenterRunService } = require('../../apps/api/src/plugins/aij-ai/ai-center-run.service.ts');
const { AiCenterClientController } = require('../../apps/api/src/plugins/aij-ai/ai-center-client.controller.ts');
const { WorkspaceContextGuard } = require('../../apps/api/src/client-workspaces/workspace-context.guard.ts');
const { WorkspaceContextService } = require('../../apps/api/src/client-workspaces/workspace-context.service.ts');
const { ClientAuthGuard } = require('../../apps/api/src/client-auth/client-auth.guard.ts');
const { PluginRuntimeAccessService } = require('../../apps/api/src/plugin-runtime/plugin-runtime-access.service.ts');
const { CLIENT_WORKSPACE_PERMISSIONS_KEY } = require('../../apps/api/src/client-workspaces/client-workspace-permission.decorator.ts');
const { CLIENT_WORKSPACE_PERMISSION: P } = require('../../apps/api/src/client-workspaces/client-workspace-permissions.ts');
const { PATH_METADATA, METHOD_METADATA, GUARDS_METADATA, HEADERS_METADATA } = require('@nestjs/common/constants');
const { Reflector } = require('@nestjs/core');
const { JwtService } = require('@nestjs/jwt');
const { ForbiddenException } = require('@nestjs/common');
const metadataKeys = ['id', 'agentCode', 'status', 'budgetStatus', 'createdAt', 'expiresAt', 'contentAvailable'].sort();
const selectKeys = ['id', 'agentCode', 'status', 'budgetStatus', 'createdAt', 'expiresAt', 'contentPurgedAt'].sort();
const rejectStatus = status => error => error.getStatus?.() === status;
const forbidden = new Proxy({}, { get: (_target, name) => { throw new Error('Unexpected dependency: ' + String(name)); } });

function fixture() {
  const row = { id: 'run-a', agentCode: 'removed-agent', status: 'unknown', budgetStatus: 'reserved', createdAt: new Date('2026-01-01'), expiresAt: new Date(Date.now() + 60000), contentPurgedAt: null,
    projectId: 'product-a', workspaceId: 'space-a', memberId: 'member-a', idempotencyKey: 'original-key', input: 'private-input', output: 'private-output', snapshot: { credentialRef: 'private-ref' }, requestHash: 'private-hash', jobId: 'private-job' };
  const calls = [];
  const prisma = {
    memberUser: { findFirst: async query => { calls.push(['member', query]); return query.where.id === 'inactive' ? null : { id: query.where.id }; } },
    $transaction: async fn => fn(forbidden),
    aiAgentRun: { findUnique: async query => {
      calls.push(['lookup', query]);
      const scope = query.where.projectId_workspaceId_memberId_idempotencyKey;
      if (!Object.entries(scope).every(([key, value]) => row[key] === value)) return null;
      // Deliberately return extra fields to also exercise the explicit response projection.
      return row;
    } }
  };
  const workspaces = { resolve: async (...args) => { calls.push(['permissions', ...args]); } };
  let projectId = 'product-a';
  const plugins = { assertEnabled: async code => { calls.push(['plugin', code]); }, projectId: async () => projectId };
  const runs = new AiCenterRunService(prisma, workspaces, plugins, forbidden, forbidden, forbidden, forbidden, forbidden, forbidden, forbidden, forbidden, forbidden, forbidden);
  runs.submit = runs.read = runs.reconcile = runs.finishFailure = () => { throw new Error('Execution/state mutation forbidden'); };
  return { runs, row, calls, workspaces, plugins, setProject: id => { projectId = id; } };
}

test('actual controller binds authenticated aiRead GET with private no-store', async () => {
  const handler = AiCenterClientController.prototype.recoverRequest;
  assert.equal(Reflect.getMetadata(PATH_METADATA, AiCenterClientController), 'client/ai');
  assert.equal(Reflect.getMetadata(PATH_METADATA, handler), 'run-requests/:key');
  assert.equal(Reflect.getMetadata(METHOD_METADATA, handler), 0);
  assert.deepEqual(Reflect.getMetadata(GUARDS_METADATA, AiCenterClientController), [WorkspaceContextGuard]);
  assert.deepEqual(Reflect.getMetadata(CLIENT_WORKSPACE_PERMISSIONS_KEY, handler), [P.aiRead]);
  assert.ok(Reflect.getMetadata(HEADERS_METADATA, handler).some(h => h.name === 'Cache-Control' && h.value === 'private, no-store'));
  const f = fixture(), controller = new AiCenterClientController(f.runs, forbidden);
  assert.equal((await controller.recoverRequest('original-key', { client: { id: 'member-a' }, workspaceContext: { workspaceId: 'space-a' } })).id, 'run-a');
  assert.throws(() => controller.recoverRequest('original-key', {}), rejectStatus(403));
});

test('stored statuses/budget stay untouched; contentAvailable describes retention only', async t => {
  for (const [status, budgetStatus] of [['queued', 'reserved'], ['running', 'reserved'], ['succeeded', 'settled'], ['failed', 'released'], ['unknown', 'reserved']]) {
    await t.test(status, async () => {
      const f = fixture(); Object.assign(f.row, { status, budgetStatus });
      const before = structuredClone(f.row);
      const result = await f.runs.recoverRequest('member-a', 'space-a', 'original-key');
      assert.deepEqual(Object.keys(result).sort(), metadataKeys);
      assert.equal(result.status, status); assert.equal(result.budgetStatus, budgetStatus); assert.equal(result.contentAvailable, true);
      assert.deepEqual(f.row, before);
      const query = f.calls.find(c => c[0] === 'lookup')[1];
      assert.deepEqual(Object.keys(query.select).sort(), selectKeys);
      assert.ok(Object.values(query.select).every(v => v === true));
      assert.deepEqual(query.where, { projectId_workspaceId_memberId_idempotencyKey: { projectId: 'product-a', workspaceId: 'space-a', memberId: 'member-a', idempotencyKey: 'original-key' } });
      assert.deepEqual(f.calls.filter(c => ['permissions', 'plugin'].includes(c[0])), [['permissions', 'member-a', 'space-a', [P.aiRead]], ['plugin', 'aij-ai']]);
    });
  }
  for (const state of [{ expiresAt: new Date(Date.now() - 1) }, { contentPurgedAt: new Date() }, { expiresAt: new Date(0), contentPurgedAt: new Date() }]) {
    await t.test('expired/purged reference remains unknown and reserved', async () => {
      const f = fixture(); Object.assign(f.row, state);
      const result = await f.runs.recoverRequest('member-a', 'space-a', 'original-key');
      assert.equal(result.contentAvailable, false); assert.equal(result.status, 'unknown'); assert.equal(result.budgetStatus, 'reserved');
    });
  }
});

test('request key uses original submit grammar and rejects before querying', async t => {
  for (const key of ['', 'short', 'x'.repeat(129), 'bad/key---', 'bad key---', 'bad.key---', 'bad%key---', '中文中文中文中文', null, undefined, 123, ['original-key']]) {
    await t.test('invalid ' + JSON.stringify(key), async () => {
      const f = fixture(); await assert.rejects(f.runs.recoverRequest('member-a', 'space-a', key), rejectStatus(400));
      assert.equal(f.calls.filter(c => c[0] === 'lookup').length, 0);
    });
  }
  for (const key of ['12345678', 'A_z-09'.padEnd(128, '_')]) {
    const f = fixture(); f.row.idempotencyKey = key;
    assert.equal((await f.runs.recoverRequest('member-a', 'space-a', key)).id, 'run-a');
  }
});

test('other members, spaces, projects and absent keys have identical safe 404', async t => {
  for (const [member, workspace, project, key] of [['member-b', 'space-a', 'product-a', 'original-key'], ['member-a', 'space-b', 'product-a', 'original-key'], ['member-a', 'space-a', 'product-b', 'original-key'], ['member-a', 'space-a', 'product-a', 'missing-key']]) {
    await t.test([member, workspace, project, key].join('/'), async () => {
      const f = fixture(); f.setProject(project);
      await assert.rejects(f.runs.recoverRequest(member, workspace, key), error => error.getStatus() === 404 && error.message === 'AI run unavailable');
    });
  }
});

test('service rechecks active member, current permission and enabled plugin before lookup', async () => {
  const f = fixture();
  await assert.rejects(f.runs.recoverRequest('inactive', 'space-a', 'original-key'), rejectStatus(404));
  assert.deepEqual(f.calls[0][1], { where: { id: 'inactive', status: 'active', deletedAt: null }, select: { id: true } });
  assert.equal(f.calls.length, 1);
  f.workspaces.resolve = async () => { throw new ForbiddenException('Workspace access denied'); };
  await assert.rejects(f.runs.recoverRequest('member-a', 'space-a', 'original-key'), rejectStatus(403));
  assert.equal(f.calls.some(c => c[0] === 'lookup'), false);
  f.workspaces.resolve = async () => ({});
  f.plugins.assertEnabled = async () => { throw new ForbiddenException('Plugin capability unavailable'); };
  await assert.rejects(f.runs.recoverRequest('member-a', 'space-a', 'original-key'), rejectStatus(403));
  assert.equal(f.calls.some(c => c[0] === 'lookup'), false);
});

test('actual workspace resolver requires active membership, workspace, role and aiRead grant', async () => {
  let membership = null, query;
  const resolver = new WorkspaceContextService({ clientWorkspaceMembership: { findFirst: async q => { query = q; return membership; } } });
  await assert.rejects(resolver.resolve('member-a', 'space-a', [P.aiRead]), rejectStatus(403));
  assert.deepEqual(query.where, { memberId: 'member-a', workspaceId: 'space-a', status: 'active', disabledAt: null, removedAt: null, deletedAt: null, workspace: { is: { status: 'active', deletedAt: null } }, role: { is: { status: 'active', deletedAt: null } } });
  assert.deepEqual(query.select.role.select.rolePermissions.where, { deletedAt: null, permission: { is: { status: 'active', deletedAt: null } } });
  membership = { workspace: { id: 'space-a', code: 'a', name: 'A' }, role: { id: 'role-a', code: 'reader', rolePermissions: [] } };
  await assert.rejects(resolver.resolve('member-a', 'space-a', [P.aiRead]), rejectStatus(403));
  membership.role.rolePermissions = [{ permission: { code: P.aiRead } }];
  assert.deepEqual((await resolver.resolve('member-a', 'space-a', [P.aiRead])).permissions, [P.aiRead]);
  await assert.rejects(resolver.resolve('member-a', 'space-a', [P.aiExecute]), rejectStatus(403));
});

test('actual guard chain checks Cookie claims, product scope and current workspace permissions', async () => {
  const jwt = new JwtService({ secret: 'synthetic-af145-source-only-secret' });
  const values = { clientSessionCookie: 'af145_client', projectId: 'product-a', environment: 'test', issuer: 'urn:af145:test', namespace: 'af145_test' };
  const config = { getOrThrow: key => values[key] };
  let principal = { id: 'member-a' }, resolved;
  const auth = new ClientAuthGuard(jwt, { authenticate: async () => principal }, config);
  const guard = new WorkspaceContextGuard(new Reflector(), auth, { resolve: async (...args) => { resolved = args; return { workspaceId: args[1] }; } });
  let request = { headers: { 'x-aij-workspace-id': 'space-a' } };
  const ctx = { switchToHttp: () => ({ getRequest: () => request }), getHandler: () => AiCenterClientController.prototype.recoverRequest, getClass: () => AiCenterClientController };
  await assert.rejects(guard.canActivate(ctx), rejectStatus(401));
  const claims = { sub: 'member-a', tokenKind: 'client', projectId: 'product-a', environment: 'test', iss: 'urn:af145:test:client', aud: 'urn:aij:af145_test:client', sessionId: 'session-a', tokenVersion: 0 };
  const cookie = extra => 'af145_client=' + jwt.sign({ ...claims, ...extra }, { expiresIn: 300 });
  request.headers.cookie = cookie({ projectId: 'product-b' });
  await assert.rejects(guard.canActivate(ctx), rejectStatus(401));
  request.headers.cookie = cookie({});
  assert.equal(await guard.canActivate(ctx), true);
  assert.deepEqual(resolved, ['member-a', 'space-a', [P.aiRead]]);
  principal = null; request = { headers: { cookie: cookie({}), 'x-aij-workspace-id': 'space-a' } };
  await assert.rejects(guard.canActivate(ctx), rejectStatus(401));
  principal = { id: 'member-a' }; request = { headers: { cookie: cookie({}) } };
  await assert.rejects(guard.canActivate(ctx), rejectStatus(400));
});

test('actual plugin gate resolves only current active project installation', async () => {
  let enabled = 'enabled', projectQuery, installationQuery, locks = 0;
  const tx = { projectProfile: { findFirst: async q => { projectQuery = q; return { id: 'product-a' }; } }, pluginInstallation: { findUnique: async q => { installationQuery = q; return { status: enabled }; } }, $executeRaw: async () => { locks++; } };
  const plugins = new PluginRuntimeAccessService({ readiness: async () => ({ ready: true }), $transaction: async fn => fn(tx) }, { getOrThrow: key => ({ projectId: 'product', environment: 'test' })[key] });
  await plugins.assertEnabled('aij-ai');
  assert.deepEqual(projectQuery.where, { code: 'product-test', status: 'active', deletedAt: null, organization: { status: 'active', deletedAt: null } });
  assert.deepEqual(installationQuery.where, { projectId_pluginCode: { projectId: 'product-a', pluginCode: 'aij-ai' } });
  enabled = 'installed'; await assert.rejects(plugins.assertEnabled('aij-ai'), rejectStatus(404));
  assert.equal(locks, 2);
});

const sdkSource = readFileSync(resolve(root, 'packages/sdk/src/ai-run-recovery.ts'), 'utf8');
const sdkCode = ts.transpileModule(sdkSource, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
const { createAiRunRecoveryClient } = await import('data:text/javascript;base64,' + Buffer.from(sdkCode).toString('base64'));

test('actual SDK is GET-only, carries current workspace, encodes key and preserves stored metadata', async () => {
  const calls = [], reference = { id: 'run-a', agentCode: 'removed-agent', status: 'unknown', budgetStatus: 'reserved', createdAt: '2026-01-01T00:00:00.000Z', expiresAt: '2026-01-08T00:00:00.000Z', contentAvailable: false };
  const client = createAiRunRecoveryClient(async (...args) => { calls.push(args); return reference; });
  assert.strictEqual(await client.recoverRequest('space-a', 'original-key'), reference);
  await client.recoverRequest('space-b', 'a/b?&%#');
  assert.deepEqual(calls, [['/client/ai/run-requests/original-key', { method: 'GET', workspaceId: 'space-a' }], ['/client/ai/run-requests/a%2Fb%3F%26%25%23', { method: 'GET', workspaceId: 'space-b' }]]);
  assert.deepEqual(Object.keys(client), ['recoverRequest']);
});

test('SDK surfaces missing, denied and invalid responses without submitting or retrying', async t => {
  for (const status of [400, 401, 403, 404, 503]) await t.test(String(status), async () => {
    let calls = 0; const failure = Object.assign(new Error('Client request failed'), { status });
    const client = createAiRunRecoveryClient(async () => { calls++; throw failure; });
    await assert.rejects(client.recoverRequest('space-a', 'original-key'), error => error === failure);
    assert.equal(calls, 1);
  });
});
