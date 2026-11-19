import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createAcceptance, migrate } from "../database/migration.mjs";
import { seedDatabase } from "../database/seed.mjs";
import { repositoryRoot } from "../database/connection.mjs";
import { authEnvironment, authKeys } from "./auth-support.mjs";

const require = createRequire(join(repositoryRoot, "apps/api/package.json"));
require("ts-node").register({ project: "apps/api/tsconfig.json", transpileOnly: true });

function manifest(code, version, overrides = {}) {
  return {
    manifestVersion: 2, code, name: `AF-071 ${code}`, version, coreVersionRange: "^0.1.0",
    dependencies: {}, optionalDependencies: {}, permissions: [], menus: [], frontendRoutes: [], configSchema: {},
    migrations: [], lifecycle: {}, events: [], jobs: [], featureFlags: [{ code: `${code}.sample`, defaultEnabled: false }],
    ...overrides
  };
}

class BasePluginModule {}
class AppPluginModule {}
class RangePluginModule {}
const registrations = new Map([
  ["af071-base", { manifest: manifest("af071-base", "1.2.0"), module: BasePluginModule, owner: "@aij/af071-base" }],
  ["af071-app", { manifest: manifest("af071-app", "1.0.0", { dependencies: { "af071-base": "^1.0.0" }, optionalDependencies: { "af071-optional": "^1.0.0" } }), module: AppPluginModule, owner: "@aij/af071-app" }],
  ["af071-range-app", { manifest: manifest("af071-range-app", "1.0.0", { dependencies: { "af071-base": "^1.0.0" } }), module: RangePluginModule, owner: "@aij/af071-range-app" }]
]);

async function listenEphemeral(app) {
  await app.init();
  await app.listen(0, "127.0.0.1");
  const address = app.getHttpServer().address();
  assert.ok(address && typeof address === "object" && address.port > 0);
  return `http://127.0.0.1:${address.port}/api`;
}

test("plugin dependency graph and lifecycle guards use real HTTP and isolated PostgreSQL", { timeout: 180000 }, async t => {
  assert.ok(repositoryRoot.endsWith("aij-foundation"));
  const lease = await createAcceptance("test", "AF-071");
  await migrate({ mode: "test", action: "deploy", acceptanceId: lease.id });
  const seeded = await seedDatabase({ mode: "test", acceptanceId: lease.id, generateCredentials: true, pluginManagement: true });
  const password = JSON.parse(readFileSync(seeded.credentials.file, "utf8")).password;
  const keys = authKeys(lease.id, "AF-071");
  const originalEnv = { ...process.env };
  let app;
  try {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, authEnvironment(lease.id, keys.secret, "AF-071"));
    const { PluginCatalog } = require("../../apps/api/src/plugin-runtime/plugin-catalog.ts");
    const catalog = new PluginCatalog(registrations);
    assert.deepEqual(catalog.dependencyOrder(), ["af071-base", "af071-app", "af071-range-app"]);
    assert.deepEqual(catalog.dependentsOf("af071-base").map(item => item.code), ["af071-app", "af071-range-app"]);

    const { createApplication } = require("../../apps/api/dist/bootstrap.js");
    app = await createApplication({ pluginCatalog: catalog });
    const base = await listenEphemeral(app);
    const { PrismaService } = require("../../apps/api/dist/prisma/prisma.service.js");
    const prisma = app.get(PrismaService);
    const request = async (path, { method = "GET", token, body } = {}) => {
      const response = await fetch(`${base}/${path}`, {
        method,
        headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(10000)
      });
      const raw = await response.text();
      let data; try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
      return { status: response.status, data: data?.data ?? data };
    };
    const login = await request("auth/login", { method: "POST", body: { username: "aij-admin", password } });
    assert.equal(login.status, 200);
    const token = login.data.accessToken;
    const project = await prisma.projectProfile.findUniqueOrThrow({ where: { code: "aij-foundation-test" }, select: { id: true } });
    const installationCount = () => prisma.pluginInstallation.count({ where: { projectId: project.id } });
    const auditCount = () => prisma.auditLog.count({ where: { module: "plugin-runtime" } });

    await t.test("missing, inactive and incompatible dependencies reject before transition writes", async () => {
      const beforeInstallations = await installationCount();
      const beforeAudits = await auditCount();
      const missing = await request("admin/plugins/af071-app/install", { method: "POST", token, body: { version: "1.0.0" } });
      assert.equal(missing.status, 409);
      assert.equal(await installationCount(), beforeInstallations);
      assert.equal(await auditCount(), beforeAudits);

      const baseInstall = await request("admin/plugins/af071-base/install", { method: "POST", token, body: { version: "1.2.0" } });
      assert.equal(baseInstall.status, 201);
      const appInstall = await request("admin/plugins/af071-app/install", { method: "POST", token, body: { version: "1.0.0" } });
      assert.equal(appInstall.status, 201, "absent optional dependency must not block install");
      assert.equal((await request("admin/plugins/af071-app/enable", { method: "POST", token })).status, 409);

      await prisma.pluginInstallation.update({ where: { projectId_pluginCode: { projectId: project.id, pluginCode: "af071-base" } }, data: { version: "0.9.0" } });
      const beforeRangeReject = await installationCount();
      const incompatible = await request("admin/plugins/af071-range-app/install", { method: "POST", token, body: { version: "1.0.0" } });
      assert.equal(incompatible.status, 409);
      assert.equal(await installationCount(), beforeRangeReject);
    });

    await t.test("dependency order enables the app and prevents disabling an active dependency", async () => {
      await prisma.pluginInstallation.update({ where: { projectId_pluginCode: { projectId: project.id, pluginCode: "af071-base" } }, data: { version: "1.2.0" } });
      const baseEnabled = await request("admin/plugins/af071-base/enable", { method: "POST", token });
      assert.equal(baseEnabled.status, 200);
      const appEnabled = await request("admin/plugins/af071-app/enable", { method: "POST", token });
      assert.equal(appEnabled.status, 200);
      const beforeDenied = await auditCount();
      const baseDisableDenied = await request("admin/plugins/af071-base/disable", { method: "POST", token });
      assert.equal(baseDisableDenied.status, 409);
      assert.equal(await auditCount(), beforeDenied);
      const appDisabled = await request("admin/plugins/af071-app/disable", { method: "POST", token });
      assert.equal(appDisabled.status, 200);
      const baseDisabled = await request("admin/plugins/af071-base/disable", { method: "POST", token });
      assert.equal(baseDisabled.status, 200);
      const persisted = await prisma.pluginInstallation.findMany({ where: { projectId: project.id, pluginCode: { in: ["af071-base", "af071-app"] } }, orderBy: { pluginCode: "asc" }, select: { pluginCode: true, status: true } });
      assert.deepEqual(persisted, [{ pluginCode: "af071-app", status: "installed" }, { pluginCode: "af071-base", status: "installed" }]);
      assert.ok(await auditCount() >= 6);
    });

    const report = { apiOrigin: new URL(base).origin, testDatabase: lease.database, dependencyOrder: catalog.dependencyOrder(), requiredChecks: 7, optionalMissingAccepted: true, staticMissingAndCycleTests: "plugin-manifest.test.mjs", noSourceData: true };
    const { mkdirSync, writeFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const evidenceDirectory = join(repositoryRoot, ".artifacts/verification/AF-071/plugin-dependencies");
    mkdirSync(evidenceDirectory, { recursive: true });
    writeFileSync(join(evidenceDirectory, "http-postgres.json"), JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
    await app.close(); app = undefined;
  } finally {
    if (app) await app.close();
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, originalEnv);
  }
});
