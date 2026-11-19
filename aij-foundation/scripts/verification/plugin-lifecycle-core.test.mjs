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
const manifest = {
  manifestVersion: 2, code: "af068-fixture", name: "AF-068 synthetic plugin", version: "0.2.0", coreVersionRange: "^0.1.0",
  dependencies: {}, optionalDependencies: {}, permissions: [], menus: [], frontendRoutes: [], configSchema: {}, migrations: [],
  lifecycle: {}, events: [], jobs: [], featureFlags: [{ code: "af068-fixture.sample", defaultEnabled: false }]
};
class SyntheticPluginModule {}
const registration = new Map([[manifest.code, { manifest, module: SyntheticPluginModule, owner: "@aij/af068-fixture" }]]);

test("plugin lifecycle uses real PostgreSQL transactions, project scope and registered catalog only", { timeout: 90000 }, async t => {
  assert.ok(repositoryRoot.endsWith("aij-foundation"));
  const lease = await createAcceptance("test", "AF-068");
  await migrate({ mode: "test", action: "deploy", acceptanceId: lease.id });
  const seeded = await seedDatabase({ mode: "test", acceptanceId: lease.id, generateCredentials: true, pluginManagement: true });
  assert.equal(seeded.status, "SEEDED");
  assert.equal(seeded.pluginManagement.code, "admin.plugin.manage");
  assert.ok(seeded.credentials.file.startsWith(repositoryRoot + "/.local-data/seed/test/"));

  const keys = authKeys(lease.id, "AF-068");
  const originalEnv = { ...process.env };
  let app;
  try {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, authEnvironment(lease.id, keys.secret, "AF-068"));
    const { createApplication } = require("../../apps/api/dist/bootstrap.js");
    app = await createApplication(); await app.init();
    const { PrismaService } = require("../../apps/api/dist/prisma/prisma.service.js");
    const prisma = app.get(PrismaService);
    const { ConfigService } = require("@nestjs/config");
    const { ManagementAccessService } = require("../../apps/api/dist/rbac/management-access.service.js");
    const access = app.get(ManagementAccessService);
    const config = app.get(ConfigService);
    const admin = await prisma.sysUser.findUniqueOrThrow({ where: { username: "aij-admin" }, select: { id: true } });
    const service = new PluginLifecycleService(prisma, access, config, new PluginCatalog(registration));
    const readiness = await prisma.readiness(); assert.deepEqual(readiness, { ready: true, reason: "READY" });

    await t.test("install, enable and disable transition the persisted status and operation rows", async () => {
      const installed = await service.install(manifest.code, manifest.version, admin.id, "af068-install");
      assert.equal(installed.status, "installed"); assert.equal(installed.version, "0.2.0"); assert.equal(installed.owner, "@aij/af068-fixture");
      const enabled = await service.enable(manifest.code, admin.id, "af068-enable"); assert.equal(enabled.status, "enabled"); assert.ok(enabled.enabledAt);
      const disabled = await service.disable(manifest.code, admin.id, "af068-disable"); assert.equal(disabled.status, "installed"); assert.ok(disabled.disabledAt);
      await service.install(manifest.code, manifest.version, admin.id, "af068-idempotent-install");
      await service.disable(manifest.code, admin.id, "af068-idempotent-disable");
      assert.equal(await prisma.pluginOperation.count({ where: { installationId: installed.id } }), 3);
      const audits = await prisma.auditLog.findMany({ where: { resourceId: installed.id, module: "plugin-runtime" }, orderBy: { action: "asc" }, select: { action: true, status: true } });
      assert.deepEqual(audits.map(row => row.action).sort(), ["disable", "enable", "install"]); assert.ok(audits.every(row => row.status === "success"));
    });

    await t.test("only registered plugin versions are accepted and invalid transitions roll back", async () => {
      const before = await prisma.pluginInstallation.count();
      await assert.rejects(service.install("untrusted-plugin", manifest.version, admin.id), error => error.status === 404);
      await assert.rejects(service.install(manifest.code, "9.9.9", admin.id), error => error.status === 400);
      await assert.rejects(service.enable("missing-plugin", admin.id), error => error.status === 404);
      assert.equal(await prisma.pluginInstallation.count(), before);
      const current = await prisma.pluginInstallation.findFirstOrThrow({ where: { pluginCode: manifest.code } });
      assert.equal(current.status, "installed");
    });

    await t.test("upgrade requires a disabled installation and a newer trusted release", async () => {
      const baseProject = await prisma.projectProfile.findFirstOrThrow({ where: { code: "aij-foundation-test" }, select: { id: true, organizationId: true } });
      const secondaryCode = "af068-secondary-test";
      const secondary = await prisma.projectProfile.create({ data: { id: randomUUID(), organizationId: baseProject.organizationId, code: secondaryCode, name: "AF-068 isolated project", environment: "test" }, select: { id: true } });
      await prisma.pluginInstallation.create({ data: { projectId: secondary.id, pluginCode: manifest.code, version: "0.1.0", owner: "@aij/af068-fixture", status: "installed", installedAt: new Date() } });
      const otherProjectService = new PluginLifecycleService(prisma, access, { getOrThrow: key => key === "projectId" ? "af068-secondary" : "test" }, new PluginCatalog(registration));
      const upgraded = await otherProjectService.upgrade(manifest.code, manifest.version, admin.id, "af068-upgrade");
      assert.equal(upgraded.projectId, secondary.id); assert.equal(upgraded.version, "0.2.0"); assert.equal(upgraded.status, "installed");
      const main = await prisma.projectProfile.findFirstOrThrow({ where: { code: "aij-foundation-test" }, select: { id: true } });
      const [mainInstall, secondaryInstall] = await Promise.all([
        prisma.pluginInstallation.findUniqueOrThrow({ where: { projectId_pluginCode: { projectId: main.id, pluginCode: manifest.code } } }),
        prisma.pluginInstallation.findUniqueOrThrow({ where: { projectId_pluginCode: { projectId: secondary.id, pluginCode: manifest.code } } })
      ]);
      assert.notEqual(mainInstall.id, secondaryInstall.id); assert.equal(mainInstall.version, "0.2.0");
      await otherProjectService.enable(manifest.code, admin.id);
      await assert.rejects(otherProjectService.upgrade(manifest.code, manifest.version, admin.id), error => error.status === 409);
    });

    await t.test("the service permission gate rejects a non-manager before catalog or data changes", async () => {
      const reader = await prisma.sysUser.create({ data: { username: "af068-no-permission", passwordHash: "synthetic-unusable-hash", realName: "AF-068 reader", status: "active", isSuperAdmin: false }, select: { id: true } });
      const before = await prisma.pluginInstallation.count();
      await assert.rejects(service.install(manifest.code, manifest.version, reader.id), error => error.status === 403);
      assert.equal(await prisma.pluginInstallation.count(), before);
    });

    await app.close(); app = undefined;
  } finally {
    if (app) await app.close();
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, originalEnv);
  }
});
