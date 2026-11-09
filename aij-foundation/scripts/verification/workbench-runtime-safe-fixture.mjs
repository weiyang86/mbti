// Root-only opt-in for the AF198/AF191 acceptance process; never imported by production.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createAcceptance, migrate } from '../database/migration.mjs';
import { repositoryRoot, readDatabaseEnvironment, withDatabase } from '../database/connection.mjs';
import { clientEnvironment, prepareClientFixture } from './client-auth-fixture.mjs';
const requireApi = createRequire(join(repositoryRoot, 'apps/api/package.json'));
const faults = ['before-app-return', 'listen', 'login', 'database-unavailable'];
const replaceEnvironment = values => { for (const key of Object.keys(process.env)) delete process.env[key]; Object.assign(process.env, values); };

export async function createSafeWorkbenchRuntimeFixture(task, options) {
  assert.ok(['AF-198', 'AF-191', 'AF-221', 'AF-223', 'AF-224', 'AF-225', 'AF-227', 'AF-228', 'AF-229', 'AF-232', 'AF-201', 'AF-202', 'AF-203', 'AF-205', 'AF-206', 'AF-207', 'AF-209', 'AF-210', 'AF-211', 'AF-214', 'AF-215', 'AF-213', 'AF-218', 'AF-217'].includes(task));
  assert.equal(process.env['AIJ_' + task.replace('-', '') + '_ROOT_ACCEPTANCE'], 'true');
  assert.equal(process.cwd(), repositoryRoot);
  assert.equal(execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim(), 'dev');
  const gitDir = key => resolve(repositoryRoot, execFileSync('git', ['rev-parse', key], { encoding: 'utf8' }).trim());
  assert.equal(gitDir('--git-dir'), gitDir('--git-common-dir'));
  assert.equal(options.workbenchTargetSafety, true);
  if (options.storageEnabled !== undefined) { assert.ok(['AF-201', 'AF-202', 'AF-203', 'AF-210', 'AF-211', 'AF-213', 'AF-221', 'AF-223', 'AF-224', 'AF-225', 'AF-227', 'AF-228'].includes(task)); assert.equal(options.storageEnabled, true); }
  if (options.workbenchFailureAt !== undefined) { assert.equal(task, 'AF-198'); assert.ok(faults.includes(options.workbenchFailureAt)); }
  if (options.documentExport !== undefined) { assert.ok(['AF-202', 'AF-203', 'AF-221', 'AF-223', 'AF-224', 'AF-225', 'AF-227', 'AF-228'].includes(task)); assert.equal(options.storageEnabled, true); assert.deepEqual(Object.keys(options.documentExport).sort(), ['approvedImage', 'dockerCliPath']); }
  if (options.scriptSandbox !== undefined) { assert.ok(['AF-210', 'AF-211', 'AF-213'].includes(task)); assert.equal(options.storageEnabled, true); assert.deepEqual(Object.keys(options.scriptSandbox).sort(), ['approvedImage', 'dockerCliPath']); }
  const previous = { ...process.env };
  const parent = join(repositoryRoot, '.artifacts/auto-ai-program-20261105', task);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const artifactDirectory = await mkdtemp(join(parent, 'fixture-'));
  assert.equal(await realpath(artifactDirectory), artifactDirectory);
  execFileSync('git', ['check-ignore', '--quiet', artifactDirectory], { stdio: 'ignore' });
  let lease, observerEnvironment, app, prisma, apiServer, occupiedServer, Logger, loggerState, closure;
  let stage = 'ACCEPTANCE', closing, offlineObserver, databaseBlocked = false, databaseRefusalObserved = false;
  const alivePids = new Set();
  const observe = operation => offlineObserver ? operation(offlineObserver) : withDatabase('test', observerEnvironment, operation, { acceptanceId: lease.id });
  const capturePids = async () => {
    const rows = await observe(async client => (await client.query('SELECT pid FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()', [lease.database])).rows);
    for (const row of rows) alivePids.add(row.pid);
  };
  const close = () => closing ??= (async () => {
    const failures = []; let applicationPools, ownedSockets, databaseAcceptingConnections;
    const attempt = async (label, operation) => { try { await operation(); } catch { failures.push(label); } };
    try {
      await attempt('APP', async () => { apiServer?.closeAllConnections(); await app?.close(); });
      // A partially initialized App may fail its destroy hook. This acquired
      // Prisma instance still belongs solely to this fixture.
      await attempt('PRISMA', async () => { await prisma?.$disconnect(); });
      await attempt('LISTEN_PROBE', async () => { if (occupiedServer?.listening) await new Promise((yes, no) => occupiedServer.close(e => e ? no(e) : yes())); });
      await attempt('API_SOCKETS', async () => {
        ownedSockets = apiServer ? await new Promise((yes, no) => apiServer.getConnections((e, n) => e ? no(e) : yes(n))) : 0;
        assert.equal(ownedSockets, 0); assert.ok(!apiServer?.listening);
      });
      if (lease?.ready && observerEnvironment) {
        await attempt('POOLS', async () => {
          applicationPools = await observe(async client => (await client.query('SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()', [lease.database])).rows[0].n);
          assert.equal(applicationPools, 0);
        });
      }
    } finally {
      if (databaseBlocked) await attempt('DATABASE_RESTORE', async () => {
        assert.ok(offlineObserver); await offlineObserver.query('ALTER DATABASE "' + lease.database + '" ALLOW_CONNECTIONS true'); databaseBlocked = false;
      });
      if (lease?.ready && observerEnvironment) await attempt('DATABASE_STATE', async () => {
        databaseAcceptingConnections = await observe(async client => (await client.query('SELECT datallowconn FROM pg_database WHERE datname=$1', [lease.database])).rows[0].datallowconn);
        assert.equal(databaseAcceptingConnections, true);
      });
      if (Logger && loggerState) {
        Logger.staticInstanceRef = loggerState.instance; Logger.logLevels = loggerState.levels;
        Logger.logBuffer = loggerState.buffer; Logger.isBufferAttached = loggerState.attached;
      }
      replaceEnvironment(previous);
    }
    closure = { task, acceptanceId: lease?.id ?? null, stage, status: failures.length ? 'CLEANUP_FAILED' : 'CLOSED', failedSteps: failures,
      applicationPidsObserved: [...alivePids], applicationPools, ownedSockets, applicationPools0: applicationPools === 0,
      ownedSockets0: ownedSockets === 0, databaseAcceptingConnections, databaseRefusalObserved, environmentRestored: true };
    await writeFile(join(artifactDirectory, 'closed.json'), JSON.stringify(closure, null, 2), { flag: 'wx', mode: 0o600 });
    if (failures.length) throw new Error('AF198_FIXTURE_CLEANUP_FAILED');
    return closure;
  })();
  try {
    lease = await createAcceptance('test', task);
    observerEnvironment = readDatabaseEnvironment('test', previous, lease.id);
    stage = 'MIGRATION';
    for (const action of ['deploy', 'status']) assert.equal((await migrate({ mode: 'test', action, acceptanceId: lease.id })).exitCode, 0);
    stage = 'SEED';
    const fixture = await prepareClientFixture(lease.id, task, { ...options, pluginManagement: true });
    const secrets = JSON.parse(await readFile(fixture.accounts[0].initialPasswordFile, 'utf8'));
    const applicationEnvironment = clientEnvironment(lease.id, task);
    replaceEnvironment({ ...applicationEnvironment, ASYNC_RUNTIME_ENABLED: 'false', ENABLED_PLUGINS: 'aij-ai', AIJ_TEST_AI_PROVIDER_MODE: 'offline-knowledge', ...(options.storageEnabled === true ? { STORAGE_ENABLED: 'true', LOCAL_STORAGE_ROOT: join(artifactDirectory, 'aij-foundation/test/storage') } : {}), ...(options.documentExport ? { AIJ_DOCUMENT_EXPORT_ENABLED: 'true', AIJ_DOCUMENT_EXPORT_IMAGE_ID: options.documentExport.approvedImage, AIJ_DOCUMENT_EXPORT_DOCKER_CLI: options.documentExport.dockerCliPath } : {}) });
    ({ Logger } = requireApi('@nestjs/common'));
    loggerState = { instance: Logger.staticInstanceRef, levels: Logger.logLevels, buffer: Logger.logBuffer, attached: Logger.isBufferAttached };
    Logger.detachBuffer(); Logger.overrideLogger(false);
    const { NestFactory } = requireApi('@nestjs/core');
    const { PrismaService } = requireApi(join(repositoryRoot, 'apps/api/dist/prisma/prisma.service.js'));
    const { createApplication } = requireApi(join(repositoryRoot, 'apps/api/dist/bootstrap.js'));
    const initialize = async () => {
      stage = 'APPLICATION';
      const originalCreate = NestFactory.create, descriptor = Object.getOwnPropertyDescriptor(NestFactory, 'create');
      NestFactory.create = async function (module, config) {
        // Root-only trusted DI on the original module, one real runner and original owner instances.
        const runtime = requireApi(join(repositoryRoot, 'apps/api/dist/plugins/aij-ai/ai-runtime.module.js')).AiRuntimeModule;
        const providers = Reflect.getMetadata('providers', runtime);
        try {
          if (options.scriptSandbox) {
            const { SCRIPT_SANDBOX_OPTIONS } = requireApi(join(repositoryRoot, 'apps/api/dist/plugins/aij-ai/ai-personal-script-execution.service.js'));
            Reflect.defineMetadata('providers', [...providers, { provide: SCRIPT_SANDBOX_OPTIONS, useValue: { enabled: true, ...options.scriptSandbox } }], runtime);
          }
          app = await originalCreate.call(this, module, { ...config, abortOnError: false, logger: false });
        } finally { Reflect.defineMetadata('providers', providers, runtime); }
        apiServer = app.getHttpServer(); prisma = app.get(PrismaService);
        if (options.workbenchFailureAt === 'before-app-return') {
          await app.init(); assert.equal((await prisma.readiness()).ready, true); await capturePids();
          throw new Error('AF198_EXPECTED_APP_RETURN_FAILURE');
        }
        return app;
      };
      try { app = await createApplication({ testBrowserOrigin: options.testBrowserOrigin }); }
      finally { if (descriptor) Object.defineProperty(NestFactory, 'create', descriptor); else delete NestFactory.create; }
      await app.init();
      const probe = await prisma.readiness();
      if (options.workbenchFailureAt === 'database-unavailable') { stage = 'DATABASE_UNAVAILABLE'; assert.equal(probe.ready, false); assert.equal(probe.reason, 'DATABASE_UNAVAILABLE'); databaseRefusalObserved = true; throw new Error('AF198_EXPECTED_DATABASE_UNAVAILABLE'); }
      assert.equal(probe.ready, true); await capturePids();
      stage = 'LISTEN'; let port = 0;
      if (options.workbenchFailureAt === 'listen') {
        occupiedServer = createServer(); await new Promise((yes, no) => { occupiedServer.once('error', no); occupiedServer.listen(0, '127.0.0.1', yes); }); port = occupiedServer.address().port;
      }
      await app.listen(port, '127.0.0.1');
    };
    if (options.workbenchFailureAt === 'database-unavailable') {
      // PostgreSQL refuses disallowing the database of the current connection.
      // Keep a validated observer in this repository's test control database;
      // mutate only the recorded, newly created AF198 child database.
      await withDatabase('test', readDatabaseEnvironment('test', previous), async client => {
        offlineObserver = client;
        assert.match(lease.database, /^aij_foundation_af198_test_[a-f0-9]{16}$/);
        try {
          const database = (await client.query('SELECT datallowconn,pg_get_userbyid(datdba)=current_user AS owned FROM pg_database WHERE datname=$1', [lease.database])).rows[0];
          assert.deepEqual(database, { datallowconn: true, owned: true });
          await client.query('ALTER DATABASE "' + lease.database + '" ALLOW_CONNECTIONS false'); databaseBlocked = true;
          await initialize(); throw new Error('AF198_UNEXPECTED_DATABASE_SUCCESS');
        } finally { try { await close(); } finally { offlineObserver = undefined; } }
      });
    } else await initialize();
    const baseUrl = `http://127.0.0.1:${apiServer.address().port}/api`, requestOrigin = options.testBrowserOrigin ?? process.env.WEB_URL;
    const request = async (method, path, { token, cookie, workspaceId, body, status = 200, origin = requestOrigin } = {}) => {
      const response = await fetch(baseUrl + '/' + path, { method, headers: { connection: 'close', ...(token ? { authorization: 'Bearer ' + token } : {}), ...(cookie ? { cookie } : {}), ...(workspaceId ? { 'x-aij-workspace-id': workspaceId } : {}), ...(origin ? { origin } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
      const text = await response.text(); assert.equal(response.status, status, 'AF198_FIXTURE_HTTP_STATUS');
      return { text, response, data: text ? JSON.parse(text).data : null };
    };
    stage = 'LOGIN'; const cookies = [], workspaces = [];
    for (const [i, account] of fixture.accounts.entries()) {
      const password = options.workbenchFailureAt === 'login' ? randomUUID() : secrets.accounts.find(a => a.id === account.id).password;
      const login = await request('POST', 'client/auth/login', { body: { email: account.email, password } });
      cookies.push(login.response.headers.get('set-cookie').split(';')[0]);
      const workspace = await request('POST', 'client/workspaces', { cookie: cookies[i], body: { name: `${task} Synthetic ${i}`, idempotencyKey: `${task}-workspace-${i}` }, status: 201 });
      workspaces.push(workspace.data);
    }
    stage = 'LIFECYCLE';
    const project = await prisma.projectProfile.findFirstOrThrow();
    const module = p => requireApi(join(repositoryRoot, 'apps/api/dist', p));
    const { PluginCatalog } = module('plugin-runtime/plugin-catalog.js'), { PluginLifecycleService } = module('plugin-runtime/plugin-lifecycle.service.js');
    const admin = await prisma.sysUser.findUniqueOrThrow({ where: { username: 'aij-admin' } });
    const catalog = app.get(PluginCatalog), lifecycle = app.get(PluginLifecycleService);
    await lifecycle.install('aij-ai', catalog.manifest('aij-ai').version, admin.id, task.toLowerCase() + '-fixture-install');
    await lifecycle.enable('aij-ai', admin.id, task.toLowerCase() + '-fixture-enable');
    stage = 'READY'; await capturePids();
    return { app, prisma, project, lease, seed: fixture.seed, accounts: fixture.accounts, cookies, workspaces, request, baseUrl, artifactDirectory,
      requireApi: module, close, closure: () => closure, applicationPidsObserved: () => [...alivePids] };
  } catch (error) {
    // Diagnostic codes and source frames only; never retain parser messages,
    // SQL parameters, credentials, response bodies or full Error objects.
    const diagnostic = { name: ['AssertionError', 'DatabaseOperationError', 'DatabaseTargetError', 'SeedError'].includes(error?.name) ? error.name : 'Error',
      code: typeof error?.code === 'string' && /^[A-Z0-9_]{2,60}$/.test(error.code) ? error.code : 'UNAVAILABLE',
      frames: String(error?.stack ?? '').split('\n').filter(line => /^\s+at /.test(line)).slice(0, 7) };
    let cleanup;
    try { cleanup = await close(); } catch { throw new Error('AF198_FIXTURE_START_AND_CLEANUP_FAILED'); }
    await writeFile(join(artifactDirectory, 'failed.json'), JSON.stringify({ task, acceptanceId: lease?.id, stage, diagnostic, status: 'EXPECTED_OR_RETAINED_START_FAILURE', cleanup }, null, 2), { flag: 'wx', mode: 0o600 });
    throw new Error('AF198_FIXTURE_START_FAILED');
  }
}
