import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";
import { createAcceptance, migrate } from "../database/migration.mjs";
import { seedDatabase } from "../database/seed.mjs";
import { repositoryRoot } from "../database/connection.mjs";
import { authEnvironment, authKeys } from "./auth-support.mjs";

const require = createRequire(join(repositoryRoot, "apps/api/package.json"));
require("ts-node").register({ project: "apps/api/tsconfig.json", transpileOnly: true });
const { PluginCatalog } = require("../../apps/api/src/plugin-runtime/plugin-catalog.ts");
const { PluginLifecycleService } = require("../../apps/api/src/plugin-runtime/plugin-lifecycle.service.ts");

const oldManifest = {
  manifestVersion: 2, code: "af072-fixture", name: "AF-072 synthetic plugin", version: "0.2.0", coreVersionRange: "^0.1.0",
  dependencies: {}, optionalDependencies: {}, permissions: [], menus: [], frontendRoutes: [], configSchema: {}, migrations: [],
  lifecycle: {}, events: [], jobs: [], featureFlags: [{ code: "af072-fixture.sample", defaultEnabled: false }]
};
const newManifest = { ...oldManifest, version: "0.3.0" };
const unrelatedManifest = { ...oldManifest, code: "af072-unrelated", name: "AF-072 unrelated plugin", version: "0.4.0", featureFlags: [{ code: "af072-unrelated.sample", defaultEnabled: false }] };
class SyntheticPluginModule {}
class UnrelatedSyntheticPluginModule {}

function lifecycle(prisma, access, runtime, targetManifest) {
  return new PluginLifecycleService(prisma, access, runtime, new PluginCatalog(new Map([
    [targetManifest.code, { manifest: targetManifest, module: SyntheticPluginModule, owner: "@aij/af072-fixture" }],
    [unrelatedManifest.code, { manifest: unrelatedManifest, module: UnrelatedSyntheticPluginModule, owner: "@aij/af072-unrelated" }]
  ])));
}

test("upgrade rollback, retry idempotency and disabled-plugin recovery preserve project data", { timeout: 180000 }, async t => {
  assert.ok(repositoryRoot.endsWith("aij-foundation"));
  const lease = await createAcceptance("test", "AF-072");
  await migrate({ mode: "test", action: "deploy", acceptanceId: lease.id });
  await seedDatabase({ mode: "test", acceptanceId: lease.id, generateCredentials: true, pluginManagement: true });
  const keys = authKeys(lease.id, "AF-072");
  const originalEnv = { ...process.env };
  let app, triggerInstalled = false;
  try {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, authEnvironment(lease.id, keys.secret, "AF-072"));
    const { createApplication } = require("../../apps/api/dist/bootstrap.js");
    app = await createApplication();
    await app.init();
    const { PrismaService } = require("../../apps/api/dist/prisma/prisma.service.js");
    const { ConfigService } = require("@nestjs/config");
    const { ManagementAccessService } = require("../../apps/api/dist/rbac/management-access.service.js");
    const prisma = app.get(PrismaService), access = app.get(ManagementAccessService), runtime = app.get(ConfigService);
    const admin = await prisma.sysUser.findUniqueOrThrow({ where: { username: "aij-admin" }, select: { id: true } });
    const oldLifecycle = lifecycle(prisma, access, runtime, oldManifest);
    const newLifecycle = lifecycle(prisma, access, runtime, newManifest);
    const installed = await oldLifecycle.install(oldManifest.code, oldManifest.version, admin.id, "af072-install");
    const unrelated = await oldLifecycle.install(unrelatedManifest.code, unrelatedManifest.version, admin.id, "af072-unrelated-install");
    await oldLifecycle.enable(unrelatedManifest.code, admin.id, "af072-unrelated-enable");
    const project = await prisma.projectProfile.findUniqueOrThrow({ where: { code: "aij-foundation-test" }, select: { id: true } });
    const marker = "af072-preserved-config";
    await prisma.scopedConfig.create({ data: {
      scope: "project", scopeId: project.id, pluginCode: oldManifest.code, configKey: "af072.preserved", configValue: marker,
      valueType: "string", name: "AF-072 synthetic config", sensitive: false
    } });
    const baselineOperations = await prisma.pluginOperation.count({ where: { installationId: installed.id } });
    const baselineAudit = await prisma.auditLog.count({ where: { module: "plugin-runtime", resourceId: installed.id } });

    await t.test("PostgreSQL failure after version update rolls back only this upgrade transaction", async () => {
      await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION af072_inject_upgrade_failure() RETURNS trigger AS $$
        BEGIN
          IF NEW.action = 'upgrade' AND NEW.owner = '@aij/af072-fixture' THEN
            RAISE EXCEPTION 'AF072_SYNTHETIC_UPGRADE_FAILURE';
          END IF;
          RETURN NEW;
        END;
      $$ LANGUAGE plpgsql`);
      await prisma.$executeRawUnsafe("CREATE TRIGGER af072_inject_upgrade_failure BEFORE INSERT ON plugin_operation FOR EACH ROW EXECUTE FUNCTION af072_inject_upgrade_failure()");
      triggerInstalled = true;
      await assert.rejects(newLifecycle.upgrade(oldManifest.code, newManifest.version, admin.id, "af072-injected-upgrade"));
      const after = await prisma.pluginInstallation.findUniqueOrThrow({ where: { id: installed.id } });
      assert.equal(after.version, oldManifest.version);
      assert.equal(after.status, "installed");
      assert.equal(await prisma.pluginOperation.count({ where: { installationId: installed.id } }), baselineOperations);
      assert.equal(await prisma.auditLog.count({ where: { module: "plugin-runtime", resourceId: installed.id } }), baselineAudit);
      assert.equal((await prisma.scopedConfig.findFirstOrThrow({ where: { scope: "project", scopeId: project.id, pluginCode: oldManifest.code, configKey: "af072.preserved" } })).configValue, marker);
      assert.equal((await prisma.pluginInstallation.findUniqueOrThrow({ where: { id: unrelated.id } })).status, "enabled");
    });

    await prisma.$executeRawUnsafe("DROP TRIGGER IF EXISTS af072_inject_upgrade_failure ON plugin_operation");
    await prisma.$executeRawUnsafe("DROP FUNCTION IF EXISTS af072_inject_upgrade_failure()");
    triggerInstalled = false;

    await t.test("recorded upgrade failure restores prior version, records safe audit, and retry request is idempotent", async () => {
      await newLifecycle.upgrade(oldManifest.code, newManifest.version, admin.id, "af072-upgrade");
      const upgrade = await prisma.pluginOperation.findFirstOrThrow({ where: { installationId: installed.id, action: "upgrade", version: newManifest.version }, orderBy: { createdAt: "desc" } });
      assert.equal(upgrade.previousVersion, oldManifest.version);
      assert.equal((await newLifecycle.enable(oldManifest.code, admin.id, "af072-enable-before-failure")).status, "enabled");
      const secretFailure = new Error("migration failed postgres://user:private-pass@db/secret token=af072-private");
      const failed = await newLifecycle.recordFailure(installed.id, "upgrade", admin.id, secretFailure, "af072-upgrade-failed", upgrade.id);
      assert.equal(failed.status, "failed");
      assert.equal(failed.failureReason, "PLUGIN_OPERATION_FAILED");
      assert.equal(failed.previousVersion, oldManifest.version);
      const rolledBack = await prisma.pluginInstallation.findUniqueOrThrow({ where: { id: installed.id } });
      assert.equal(rolledBack.version, oldManifest.version);
      assert.equal(rolledBack.status, "installed");
      assert.equal(rolledBack.failureReason, null);
      assert.ok(rolledBack.disabledAt instanceof Date);
      const failureAudit = await prisma.auditLog.findFirstOrThrow({ where: { resourceId: failed.id, action: "plugin-operation-failed" } });
      assert.ok(!JSON.stringify({ failed, failureAudit }).includes("private-pass"));
      assert.ok(!JSON.stringify({ failed, failureAudit }).includes("af072-private"));

      const retry1 = await newLifecycle.requestRetry(installed.id, failed.id, admin.id, "af072-retry");
      assert.equal(retry1.status, "pending");
      assert.equal(retry1.retryOfOperationId, failed.id);
      const operationsBeforeDuplicate = await prisma.pluginOperation.count({ where: { installationId: installed.id } });
      const auditBeforeDuplicate = await prisma.auditLog.count({ where: { resourceId: retry1.id, action: "plugin-operation-retry-requested" } });
      const retryAgain = await newLifecycle.requestRetry(installed.id, failed.id, admin.id, "af072-retry-duplicate");
      assert.equal(retryAgain.id, retry1.id);
      assert.equal(await prisma.pluginOperation.count({ where: { installationId: installed.id } }), operationsBeforeDuplicate);
      assert.equal(await prisma.auditLog.count({ where: { resourceId: retry1.id, action: "plugin-operation-retry-requested" } }), auditBeforeDuplicate);
      const persistedRetry = await prisma.pluginOperation.findUniqueOrThrow({ where: { id: retry1.id } });
      assert.equal(persistedRetry.retryOfOperationId, failed.id);
      assert.equal(persistedRetry.previousVersion, oldManifest.version);
      assert.equal((await prisma.scopedConfig.findFirstOrThrow({ where: { scope: "project", scopeId: project.id, pluginCode: oldManifest.code, configKey: "af072.preserved" } })).configValue, marker);
      assert.equal((await prisma.pluginInstallation.findUniqueOrThrow({ where: { id: unrelated.id } })).status, "enabled");
    });

    await t.test("disable and re-enable recovery preserve plugin configuration and unrelated plugin state", async () => {
      assert.equal((await oldLifecycle.enable(oldManifest.code, admin.id, "af072-enable-before-disable")).status, "enabled");
      const disabled = await oldLifecycle.disable(oldManifest.code, admin.id, "af072-disable");
      assert.equal(disabled.status, "installed");
      assert.equal((await prisma.scopedConfig.findFirstOrThrow({ where: { scope: "project", scopeId: project.id, pluginCode: oldManifest.code, configKey: "af072.preserved" } })).configValue, marker);
      const restored = await oldLifecycle.enable(oldManifest.code, admin.id, "af072-enable-recovery");
      assert.equal(restored.status, "enabled");
      assert.equal((await prisma.pluginInstallation.findUniqueOrThrow({ where: { id: unrelated.id } })).status, "enabled");
      assert.equal(await prisma.auditLog.count({ where: { module: "plugin-runtime", resourceId: installed.id, action: { in: ["disable", "enable"] } } }), 4);
    });

    await app.close();
    app = undefined;
  } finally {
    if (triggerInstalled && app) {
      const prisma = app.get(require("../../apps/api/dist/prisma/prisma.service.js").PrismaService);
      await prisma.$executeRawUnsafe("DROP TRIGGER IF EXISTS af072_inject_upgrade_failure ON plugin_operation").catch(() => undefined);
      await prisma.$executeRawUnsafe("DROP FUNCTION IF EXISTS af072_inject_upgrade_failure()").catch(() => undefined);
    }
    if (app) await app.close();
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, originalEnv);
  }
});
