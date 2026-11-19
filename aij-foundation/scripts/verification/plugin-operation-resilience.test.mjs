import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createAcceptance, migrate } from "../database/migration.mjs";
import { seedDatabase } from "../database/seed.mjs";
import { repositoryRoot } from "../database/connection.mjs";
import { authEnvironment, authKeys } from "./auth-support.mjs";

const require = createRequire(join(repositoryRoot, "apps/api/package.json"));
require("ts-node").register({ project: "apps/api/tsconfig.json", transpileOnly: true });
const { PluginCatalog } = require("../../apps/api/src/plugin-runtime/plugin-catalog.ts");
const { PluginLifecycleService } = require("../../apps/api/src/plugin-runtime/plugin-lifecycle.service.ts");
const { MAX_PLUGIN_OPERATION_ATTEMPTS, publicPluginFailureReason, safePluginFailureReason } = require("../../apps/api/src/plugin-runtime/plugin-operation-policy.ts");

const manifest = {
  manifestVersion: 2, code: "af069-fixture", name: "AF-069 synthetic plugin", version: "0.2.0", coreVersionRange: "^0.1.0",
  dependencies: {}, optionalDependencies: {}, permissions: [], menus: [], frontendRoutes: [], configSchema: {}, migrations: [],
  lifecycle: {}, events: [], jobs: [], featureFlags: [{ code: "af069-fixture.sample", defaultEnabled: false }]
};
class SyntheticPluginModule {}
const catalogEntries = new Map([[manifest.code, { manifest, module: SyntheticPluginModule, owner: "@aij/af069-fixture" }]]);

test("failure categories expose no provider message or secret", () => {
  const secret = "postgres://user:private-pass@host/db token=synthetic-secret";
  assert.equal(safePluginFailureReason(new Error(secret)), "PLUGIN_OPERATION_FAILED");
  assert.equal(safePluginFailureReason(Object.assign(new Error(secret), { name: "TimeoutError" })), "PLUGIN_TIMEOUT");
  assert.equal(publicPluginFailureReason(secret), "PLUGIN_OPERATION_FAILED");
  assert.equal(publicPluginFailureReason("PLUGIN_VALIDATION_FAILED"), "PLUGIN_VALIDATION_FAILED");
  assert.equal(MAX_PLUGIN_OPERATION_ATTEMPTS, 3);
});

test("plugin failure persistence and retry requests use real PostgreSQL and permission checks", { timeout: 90000 }, async t => {
  assert.ok(repositoryRoot.endsWith("aij-foundation"));
  const lease = await createAcceptance("test", "AF-069");
  await migrate({ mode: "test", action: "deploy", acceptanceId: lease.id });
  await seedDatabase({ mode: "test", acceptanceId: lease.id, generateCredentials: true, pluginManagement: true });
  const keys = authKeys(lease.id, "AF-069");
  const originalEnv = { ...process.env };
  let app;
  try {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, authEnvironment(lease.id, keys.secret, "AF-069"));
    const { createApplication } = require("../../apps/api/dist/bootstrap.js");
    app = await createApplication(); await app.init();
    const { PrismaService } = require("../../apps/api/dist/prisma/prisma.service.js");
    const { ConfigService } = require("@nestjs/config");
    const { ManagementAccessService } = require("../../apps/api/dist/rbac/management-access.service.js");
    const prisma = app.get(PrismaService);
    const access = app.get(ManagementAccessService);
    const admin = await prisma.sysUser.findUniqueOrThrow({ where: { username: "aij-admin" }, select: { id: true } });
    const service = new PluginLifecycleService(prisma, access, app.get(ConfigService), new PluginCatalog(catalogEntries));
    const installed = await service.install(manifest.code, manifest.version, admin.id, "af069-install");
    const secretMessage = "provider failed: postgres://user:private-pass@host/db bearer=synthetic-secret";

    await t.test("failure closes installation and stores only a safe reason plus audit", async () => {
      const failed = await service.recordFailure(installed.id, "enable", admin.id, new Error(secretMessage), "af069-failure");
      assert.equal(failed.status, "failed");
      assert.equal(failed.failureReason, "PLUGIN_OPERATION_FAILED");
      assert.ok(!JSON.stringify(failed).includes(secretMessage));
      const operation = await prisma.pluginOperation.findUniqueOrThrow({ where: { id: failed.id } });
      const installation = await prisma.pluginInstallation.findUniqueOrThrow({ where: { id: installed.id } });
      assert.equal(operation.status, "failed"); assert.equal(operation.failureReason, "PLUGIN_OPERATION_FAILED");
      assert.equal(installation.status, "failed"); assert.equal(installation.failureReason, "PLUGIN_OPERATION_FAILED");
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { resourceId: failed.id, action: "plugin-operation-failed" } });
      assert.ok(!JSON.stringify({ operation, installation, audit }).includes("private-pass"));
      assert.ok(!JSON.stringify({ operation, installation, audit }).includes("synthetic-secret"));
    });

    await t.test("retry is explicit, permission gated, duplicate safe and bounded to three failed attempts", async () => {
      const latestFailure = await prisma.pluginOperation.findFirstOrThrow({ where: { installationId: installed.id, action: "enable", status: "failed" }, orderBy: { createdAt: "desc" } });
      const reader = await prisma.sysUser.create({ data: { username: "af069-reader", passwordHash: "synthetic-unusable-hash", realName: "AF-069 reader", status: "active", isSuperAdmin: false }, select: { id: true } });
      const beforeDenied = await prisma.pluginOperation.count({ where: { installationId: installed.id } });
      await assert.rejects(service.requestRetry(installed.id, latestFailure.id, reader.id), error => error.status === 403);
      assert.equal(await prisma.pluginOperation.count({ where: { installationId: installed.id } }), beforeDenied);

      const retry1 = await service.requestRetry(installed.id, latestFailure.id, admin.id, "af069-retry-1");
      assert.equal(retry1.status, "pending"); assert.equal(retry1.failureReason, null);
      assert.equal((await service.list()).installations.find(row => row.id === installed.id)?.status, "failed");
      await assert.rejects(service.requestRetry(installed.id, latestFailure.id, admin.id), error => error.status === 409);
      await service.recordFailure(installed.id, "enable", admin.id, new Error(secretMessage), "af069-retry-1-failed", retry1.id);

      const retry2Source = await prisma.pluginOperation.findFirstOrThrow({ where: { installationId: installed.id, action: "enable", status: "failed" }, orderBy: { createdAt: "desc" } });
      const retry2 = await service.requestRetry(installed.id, retry2Source.id, admin.id, "af069-retry-2");
      assert.equal(retry2.status, "pending");
      await service.recordFailure(installed.id, "enable", admin.id, new Error(secretMessage), "af069-retry-2-failed", retry2.id);
      const retry3Source = await prisma.pluginOperation.findFirstOrThrow({ where: { installationId: installed.id, action: "enable", status: "failed" }, orderBy: { createdAt: "desc" } });
      await assert.rejects(service.requestRetry(installed.id, retry3Source.id, admin.id), error => error.status === 409 && /limit/.test(error.message));
      assert.equal(await prisma.pluginOperation.count({ where: { installationId: installed.id, action: "enable", status: "failed" } }), MAX_PLUGIN_OPERATION_ATTEMPTS);
      const retries = await prisma.auditLog.findMany({ where: { action: "plugin-operation-retry-requested", module: "plugin-runtime" }, select: { resourceId: true } });
      assert.equal(retries.length, 2);
    });

    await t.test("retry lookup cannot cross the active project boundary", async () => {
      const failed = await prisma.pluginOperation.findFirstOrThrow({ where: { installationId: installed.id, action: "enable", status: "failed" } });
      const primaryProject = await prisma.projectProfile.findFirstOrThrow({ where: { code: "aij-foundation-test" }, select: { organizationId: true } });
      await prisma.projectProfile.create({ data: { id: randomUUID(), organizationId: primaryProject.organizationId, code: "af069-secondary-test", name: "AF-069 isolated project", environment: "test" } });
      const otherProjectService = new PluginLifecycleService(prisma, access, { getOrThrow: key => key === "projectId" ? "af069-secondary" : "test" }, new PluginCatalog(catalogEntries));
      await assert.rejects(otherProjectService.requestRetry(installed.id, failed.id, admin.id), error => error.status === 404);
    });

    await app.close(); app = undefined;
  } finally {
    if (app) await app.close();
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, originalEnv);
  }
});
