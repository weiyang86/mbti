import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { createAcceptance, migrate } from "../database/migration.mjs";
import { seedDatabase } from "../database/seed.mjs";
import { repositoryRoot } from "../database/connection.mjs";
import { authEnvironment, authKeys } from "./auth-support.mjs";

const require = createRequire(join(repositoryRoot, "apps/api/package.json"));
require("ts-node").register({ project: "apps/api/tsconfig.json", transpileOnly: true });
const manifest = {
  manifestVersion: 2, code: "af070-fixture", name: "AF-070 synthetic plugin", version: "0.2.0", coreVersionRange: "^0.1.0",
  dependencies: {}, optionalDependencies: {}, permissions: [], menus: [], frontendRoutes: [], configSchema: {}, migrations: [],
  lifecycle: {}, events: [], jobs: [], featureFlags: [{ code: "af070-fixture.sample", defaultEnabled: false }]
};
class SyntheticPluginModule {}
const catalogEntries = new Map([[manifest.code, { manifest, module: SyntheticPluginModule, owner: "@aij/af070-fixture" }]]);

async function listenEphemeral(app) {
  await app.init();
  await app.listen(0, "127.0.0.1");
  const address = app.getHttpServer().address();
  assert.ok(address && typeof address === "object" && address.port > 0);
  return `http://127.0.0.1:${address.port}/api`;
}

test("plugin management HTTP API and disabled runtime boundaries use isolated PostgreSQL", { timeout: 180000 }, async t => {
  assert.ok(repositoryRoot.endsWith("aij-foundation"));
  const lease = await createAcceptance("test", "AF-070");
  await migrate({ mode: "test", action: "deploy", acceptanceId: lease.id });
  const seeded = await seedDatabase({ mode: "test", acceptanceId: lease.id, generateCredentials: true, pluginManagement: true });
  const password = JSON.parse(readFileSync(seeded.credentials.file, "utf8")).password;
  const keys = authKeys(lease.id, "AF-070");
  const originalEnv = { ...process.env };
  let app, probeApp;
  const secretValue = randomBytes(32).toString("hex");
  const secretEnvName = "AIJ_SECRET_AIJ_FOUNDATION_TEST_AF070_TOKEN";
  try {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, authEnvironment(lease.id, keys.secret, "AF-070"), { [secretEnvName]: secretValue });
    const { PluginCatalog } = require("../../apps/api/src/plugin-runtime/plugin-catalog.ts");
    const { createApplication } = require("../../apps/api/dist/bootstrap.js");
    app = await createApplication({ pluginCatalog: new PluginCatalog(catalogEntries) });
    const base = await listenEphemeral(app);
    const { PrismaService } = require("../../apps/api/dist/prisma/prisma.service.js");
    const { PluginLifecycleService } = require("../../apps/api/dist/plugin-runtime/plugin-lifecycle.service.js");
    const { PluginRuntimeAccessService } = require("../../apps/api/dist/plugin-runtime/plugin-runtime-access.service.js");
    const { RuntimeRegistry } = require("../../apps/api/dist/async-runtime/registry.js");
    const { JobService } = require("../../apps/api/dist/async-runtime/job.service.js");
    const { SecretRefPort } = require("../../apps/api/dist/secret-center/secret-ref.js");
    const prisma = app.get(PrismaService), lifecycle = app.get(PluginLifecycleService);
    const admin = await prisma.sysUser.findUniqueOrThrow({ where: { username: "aij-admin" }, select: { id: true } });
    const access = app.get(PluginRuntimeAccessService), registry = app.get(RuntimeRegistry), jobs = app.get(JobService);
    const secretPort = app.get(SecretRefPort);
    const routeDir = join(repositoryRoot, ".artifacts/verification/AF-070/plugin-route"); mkdirSync(routeDir, { recursive: true });
    const save = (name, value) => writeFileSync(join(routeDir, name + ".json"), JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
    let adminToken, installationId;
    const responses = [];
    const request = async (path, { method = "GET", token, body } = {}) => {
      const response = await fetch(`${base}/${path}`, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10000) });
      const raw = await response.text();
      let result; try { result = raw ? JSON.parse(raw) : null; } catch { result = raw; }
      responses.push({ method, path, status: response.status, body: result });
      assert.ok(!raw.includes(secretValue), "HTTP response must not expose plugin secret");
      return { status: response.status, data: result?.data ?? result };
    };

    await t.test("manager-only lifecycle HTTP endpoints reject anonymous/ordinary actors and persist transitions", async () => {
      assert.equal((await request("admin/plugins")).status, 401);
      const adminLogin = await request("auth/login", { method: "POST", body: { username: "aij-admin", password } });
      assert.equal(adminLogin.status, 200); adminToken = adminLogin.data.accessToken;
      assert.equal((await request("admin/plugins", { token: adminToken })).status, 200);
      const bcrypt = require("bcryptjs"), readerPassword = "AF070.Reader.Password9";
      const reader = await prisma.sysUser.create({ data: { username: "af070-reader", passwordHash: await bcrypt.hash(readerPassword, 10), realName: "AF-070 reader", status: "active", isSuperAdmin: false }, select: { id: true } });
      const readerLogin = await request("auth/login", { method: "POST", body: { username: "af070-reader", password: readerPassword } }); assert.equal(readerLogin.status, 200);
      const deniedBefore = await prisma.pluginInstallation.count();
      assert.equal((await request(`admin/plugins/${manifest.code}/install`, { method: "POST", token: readerLogin.data.accessToken, body: { version: manifest.version } })).status, 403);
      assert.equal(await prisma.pluginInstallation.count(), deniedBefore);
      assert.equal((await request(`admin/plugins/${manifest.code}/install`, { method: "POST", token: adminToken, body: { version: "9.9.9" } })).status, 400);
      assert.equal((await request("admin/plugins/untrusted-fixture/install", { method: "POST", token: adminToken, body: { version: manifest.version } })).status, 404);
      const installed = await request(`admin/plugins/${manifest.code}/install`, { method: "POST", token: adminToken, body: { version: manifest.version } });
      assert.equal(installed.status, 201); assert.equal(installed.data.status, "installed");
      const enabled = await request(`admin/plugins/${manifest.code}/enable`, { method: "POST", token: adminToken });
      assert.equal(enabled.status, 200); assert.equal(enabled.data.status, "enabled");
      assert.equal((await request(`admin/plugins/${manifest.code}/operations`, { token: adminToken })).data.length, 2);
      assert.equal((await prisma.auditLog.count({ where: { module: "plugin-runtime", resourceId: installed.data.id, action: { in: ["install", "enable"] } } })), 2);
      save("management-http", { anonymousStatus: 401, ordinaryManagerStatus: 403, invalidVersionStatus: 400, untrustedPluginStatus: 404, installStatus: installed.status, enableStatus: enabled.status, operationRows: 2, audits: 2, readerId: reader.id });
      installationId = installed.data.id;
    });

    await t.test("enabled routes, plugin jobs and secret refs work only while the installation is enabled", async () => {
      const profile = await prisma.projectProfile.findUniqueOrThrow({ where: { code: "aij-foundation-test" }, select: { id: true } });
      const ref = `env://${secretEnvName}`;
      await prisma.secretReference.create({ data: { ref, provider: "env", status: "active" } });
      await prisma.scopedConfig.create({ data: { scope: "project", scopeId: profile.id, pluginCode: manifest.code, configKey: "synthetic.credential", configValue: ref, valueType: "secretRef", sensitive: true, name: "AF-070 synthetic credential" } });
      assert.equal(await secretPort.resolveTrustedForPlugin(manifest.code, ref), secretValue);
      assert.equal(await access.isEnabled(manifest.code), true);

      const { Controller, Get, Module } = require("@nestjs/common");
      const { ConfigModule } = require("@nestjs/config");
      const { NestFactory } = require("@nestjs/core");
      const { loadRuntimeEnvironment } = require("../../scripts/runtime-environment.cjs");
      const { PrismaModule } = require("../../apps/api/src/prisma/prisma.module.ts");
      const { PluginRuntimeAccessModule } = require("../../apps/api/src/plugin-runtime/plugin-runtime-access.module.ts");
      const { PluginRoute } = require("../../apps/api/src/plugin-runtime/plugin-enabled.guard.ts");
      class FixturePluginController { probe() { return { enabled: true }; } }
      Controller("plugins/af070-fixture")(FixturePluginController);
      const descriptor = Object.getOwnPropertyDescriptor(FixturePluginController.prototype, "probe");
      Get("probe")(FixturePluginController.prototype, "probe", descriptor);
      PluginRoute(manifest.code)(FixturePluginController.prototype, "probe", descriptor);
      class FixturePluginHostModule {}
      Module({ imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: [() => loadRuntimeEnvironment()] }), PrismaModule, PluginRuntimeAccessModule], controllers: [FixturePluginController] })(FixturePluginHostModule);
      probeApp = await NestFactory.create(FixturePluginHostModule, { logger: false });
      probeApp.setGlobalPrefix("api");
      const probeBase = await listenEphemeral(probeApp);
      assert.equal((await fetch(`${probeBase}/plugins/af070-fixture/probe`)).status, 200);

      let ran = false;
      registry.registerJob("af070.fixture.process", 1, async () => { ran = true; });
      assert.ok(registry.registeredJobDefinitions().some(entry => entry.type === "af070.fixture.process" && entry.version === 1));
      assert.deepEqual(await access.enabledCodes(), [manifest.code]);
      const job = await jobs.enqueue({ type: "af070.fixture.process", version: 1, payload: { marker: "synthetic" }, scope: { type: "plugin", id: profile.id, pluginCode: manifest.code }, idempotencyKey: "af070-job-before-disable", runAt: new Date(Date.now() - 5000) });
      const [claimed] = await jobs.claim("af070-test-worker", 10, 5000);
      if (!claimed) {
        const persisted = await prisma.runtimeJob.findUniqueOrThrow({ where: { id: job.id }, select: { id: true, jobType: true, jobVersion: true, pluginCode: true, status: true, runAt: true } });
        assert.fail(`Enabled plugin job was not claimable: ${JSON.stringify({ registered: registry.registeredJobDefinitions(), enabledPlugins: await access.enabledCodes(), persisted })}`);
      }
      assert.equal(claimed.id, job.id);

      const disabled = await request(`admin/plugins/${manifest.code}/disable`, { method: "POST", token: adminToken });
      assert.equal(disabled.status, 200); assert.equal(disabled.data.status, "installed");
      assert.equal((await fetch(`${probeBase}/plugins/af070-fixture/probe`)).status, 404);
      await assert.rejects(secretPort.resolveTrustedForPlugin(manifest.code, ref), error => error.status === 404);
      assert.equal(await access.isEnabled(manifest.code), false);
      await jobs.execute(claimed); assert.equal(ran, false);
      const deferred = await prisma.runtimeJob.findUniqueOrThrow({ where: { id: job.id }, select: { status: true, lastError: true, leaseOwner: true } });
      assert.equal(deferred.status, "retry"); assert.equal(deferred.lastError, "PLUGIN_DISABLED"); assert.equal(deferred.leaseOwner, null);
      await assert.rejects(jobs.enqueue({ type: "af070.fixture.process", version: 1, payload: {}, scope: { type: "plugin", id: profile.id, pluginCode: manifest.code }, idempotencyKey: "af070-job-after-disable" }), error => error.status === 404);
      const disabledClaim = await jobs.claim("af070-test-worker-disabled", 10, 5000); assert.deepEqual(disabledClaim, []);
      save("disabled-runtime", { enabledRouteStatus: 200, disabledRouteStatus: 404, enabledSecretResolvedServerSide: true, disabledSecretStatus: 404, enabledJobClaimed: true, disabledClaimCount: disabledClaim.length, inFlightJobHandlerRan: ran, deferredJob: deferred, disabledEnqueueStatus: 404 });
    });

    await t.test("operation history and retry API expose only fixed failure categories", async () => {
      const failureInput = "provider error postgres://admin:synthetic-password@db/aij token=af070-secret-marker";
      const failure = await lifecycle.recordFailure(installationId, "enable", admin.id, new Error(failureInput), "af070-failure");
      assert.equal(failure.failureReason, "PLUGIN_OPERATION_FAILED");
      const history = await request(`admin/plugins/${manifest.code}/operations`, { token: adminToken });
      assert.equal(history.status, 200); assert.ok(!JSON.stringify(history.data).includes(failureInput)); assert.ok(!JSON.stringify(history.data).includes("synthetic-password"));
      const retry = await request(`admin/plugins/installations/${installationId}/retry`, { method: "POST", token: adminToken, body: { failedOperationId: failure.id } });
      assert.equal(retry.status, 201); assert.equal(retry.data.status, "pending"); assert.equal(retry.data.failureReason, null);
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { resourceId: retry.data.id, action: "plugin-operation-retry-requested" }, select: { requestSummary: true } });
      assert.ok(!JSON.stringify(audit).includes(failureInput));
      save("operation-api", { failureCategory: failure.failureReason, historyStatus: history.status, historyRedacted: true, retryStatus: retry.status, retryState: retry.data.status, auditRedacted: true, responseSecretFree: true });
    });

    await app.close(); app = undefined;
    await probeApp.close(); probeApp = undefined;
  } finally {
    if (app) await app.close();
    if (probeApp) await probeApp.close();
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, originalEnv);
  }
});
