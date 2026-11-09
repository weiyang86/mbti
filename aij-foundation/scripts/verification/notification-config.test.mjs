import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";
import { repositoryRoot } from "../database/connection.mjs";
import { createRuntimeFixture, writeRuntimeEvidence } from "./runtime-fixture.mjs";

const require = createRequire(join(repositoryRoot, "apps/api/package.json"));

test("AF-082 manages notification SecretRef configuration through real HTTP, RBAC and PostgreSQL", { timeout: 240_000 }, async t => {
  const f = await createRuntimeFixture("AF-082", { rbacFixture: true });
  try {
    const fixture = f.rbacFixture;
    const accounts = JSON.parse(await (await import("node:fs/promises")).readFile(fixture.accounts[0].initialPasswordFile, "utf8")).accounts;
    const manager = accounts.find(account => account.username === "af082-manager");
    const reader = accounts.find(account => account.username === "af082-reader");
    assert.ok(manager && reader);
    const managerToken = await f.login(manager.username, manager.password);
    const readerToken = await f.login(reader.username, reader.password);
    const { NotificationManagementService } = require("../../apps/api/dist/plugins/aij-notification/notification-management.service.js");
    assert.ok(f.app.get(NotificationManagementService));
    assert.deepEqual(f.registry.registeredEventDefinitions().filter(item => item.type.startsWith("aij-notification.")), [],
      "management/setup API is present even while the notification runtime plugin is not enabled");

    const project = await f.prisma.projectProfile.findUniqueOrThrow({ where: { code: "aij-foundation-test" }, select: { id: true } });
    const suffix = f.lease.id.toUpperCase().replace(/-/g, "_");
    const refs = [
      `env://AIJ_SECRET_AIJ_FOUNDATION_TEST_AF082_EMAIL_${suffix}`,
      `env://AIJ_SECRET_AIJ_FOUNDATION_TEST_AF082_EMAIL_NEXT_${suffix}`
    ];
    const outsideProjectRef = `env://AIJ_SECRET_OTHER_TEST_AF082_EMAIL_${suffix}`;
    const rawSecretMarker = `af082-raw-secret-${suffix}`;
    const initialReferenceCount = await f.prisma.secretReference.count();

    await t.test("anonymous and ordinary users cannot read or change notification settings", async () => {
      await f.request("/admin/notifications/status", { expected: 401, authorization: null });
      await f.request("/admin/notifications/status", { expected: 403, authorization: readerToken });
      await f.request("/admin/notifications/channels/email", { expected: 403, method: "PATCH", authorization: readerToken,
        body: { secretRef: refs[0], expectedVersion: 0 } });
      assert.equal(await f.prisma.scopedConfig.count({ where: { pluginCode: "aij-notification", configKey: { startsWith: "notification.channel." } } }), 0);
    });

    await t.test("status exposes setup state while plugin runtime is disabled and starts uninstalled", async () => {
      const result = await f.request("/admin/notifications/status", { authorization: managerToken });
      assert.equal(result.body.data.plugin.installationStatus, "uninstalled");
      assert.equal(result.body.data.plugin.deliveryEnabled, false);
      assert.equal(result.body.data.channels.find(channel => channel.channel === "email").configured, false);
      assert.equal(result.body.data.channels.find(channel => channel.channel === "in_app").requiresSecretRef, false);
      await f.request("/admin/notifications/channels/email", { expected: 409, method: "PATCH", authorization: managerToken,
        body: { secretRef: refs[0], expectedVersion: 0 } });
      await f.request("/admin/notifications/channels/not-a-channel", { expected: 400, method: "PATCH", authorization: managerToken,
        body: { secretRef: refs[0], expectedVersion: 0 } });
      assert.equal(await f.prisma.scopedConfig.count({ where: { pluginCode: "aij-notification", configKey: { startsWith: "notification.channel." } } }), 0);
    });

    await f.prisma.pluginInstallation.create({ data: {
      projectId: project.id, pluginCode: "aij-notification", version: "0.1.0", owner: "@aij/api", status: "installed", installedAt: new Date()
    } });
    for (const ref of refs) await f.prisma.secretReference.create({ data: { ref, provider: "env", description: "AF-082 synthetic reference" } });

    await t.test("set, rotate and clear only registered project-owned references with optimistic versions", async () => {
      const set = await f.request("/admin/notifications/channels/email", { method: "PATCH", authorization: managerToken,
        body: { secretRef: refs[0], expectedVersion: 0 } });
      assert.equal(set.body.data.configured, true); assert.equal(set.body.data.referenceRegistered, true);
      assert.equal(set.body.data.credentialMaterialChecked, false); assert.equal(set.body.data.secretRef, refs[0]); assert.equal(set.body.data.version, 1);
      let config = await f.prisma.scopedConfig.findUniqueOrThrow({ where: { scope_scopeId_pluginCode_configKey: {
        scope: "project", scopeId: project.id, pluginCode: "aij-notification", configKey: "notification.channel.email.secretRef"
      } } });
      assert.equal(config.configValue, refs[0]); assert.equal(config.valueType, "secretRef"); assert.equal(config.sensitive, true); assert.equal(config.isPublic, false);

      const rotate = await f.request("/admin/notifications/channels/email", { method: "PATCH", authorization: managerToken,
        body: { secretRef: refs[1], expectedVersion: 1 } });
      assert.equal(rotate.body.data.secretRef, refs[1]); assert.equal(rotate.body.data.version, 2);
      config = await f.prisma.scopedConfig.findUniqueOrThrow({ where: { id: config.id } });
      assert.equal(config.configValue, refs[1], "only the latest reference is kept in the live configuration row");
      await f.request("/admin/notifications/channels/email", { expected: 409, method: "PATCH", authorization: managerToken,
        body: { secretRef: refs[0], expectedVersion: 1 } });
      assert.equal((await f.prisma.scopedConfig.findUniqueOrThrow({ where: { id: config.id } })).configValue, refs[1]);

      const clear = await f.request("/admin/notifications/channels/email", { method: "PATCH", authorization: managerToken,
        body: { secretRef: null, expectedVersion: 2 } });
      assert.equal(clear.body.data.configured, false); assert.equal(clear.body.data.status, "disabled"); assert.equal(clear.body.data.version, 3);
      assert.ok(!Object.hasOwn(clear.body.data, "secretRef"));
      const afterClear = await f.request("/admin/notifications/status", { authorization: managerToken });
      const email = afterClear.body.data.channels.find(channel => channel.channel === "email");
      assert.equal(email.configured, false); assert.equal(email.status, "disabled"); assert.equal(email.version, 3);
      assert.ok(!Object.hasOwn(email, "secretRef"));
    });

    await t.test("foreign references, unregistered values and raw credentials are rejected without echo or writes", async () => {
      const before = await f.prisma.scopedConfig.count({ where: { pluginCode: "aij-notification", configKey: { startsWith: "notification.channel." } } });
      const foreign = await f.request("/admin/notifications/channels/email", { expected: 403, method: "PATCH", authorization: managerToken,
        body: { secretRef: outsideProjectRef, expectedVersion: 3 } });
      const literal = await f.request("/admin/notifications/channels/email", { expected: 400, method: "PATCH", authorization: managerToken,
        body: { secretRef: rawSecretMarker, expectedVersion: 3 } });
      const unknown = await f.request("/admin/notifications/channels/email", { expected: 400, method: "PATCH", authorization: managerToken,
        body: { secretRef: refs[0], expectedVersion: 3, credential: rawSecretMarker } });
      for (const result of [foreign, literal, unknown]) assert.ok(!result.text.includes(rawSecretMarker));
      assert.equal(await f.prisma.scopedConfig.count({ where: { pluginCode: "aij-notification", configKey: { startsWith: "notification.channel." } } }), before);
      assert.equal(await f.prisma.secretReference.count(), initialReferenceCount + refs.length, "unregistered/raw values are never auto-registered");
    });

    await t.test("audit and configuration history contain only safe metadata; no provider secret is resolved or sent", async () => {
      const changes = await f.prisma.configurationChange.findMany({ where: { pluginCode: "aij-notification", configKey: "notification.channel.email.secretRef" }, orderBy: { createdAt: "asc" } });
      assert.equal(changes.length, 3);
      assert.deepEqual(changes.map(change => change.eventType), ["notification.channel.configured", "notification.channel.configured", "notification.channel.cleared"]);
      assert.deepEqual(changes.map(change => change.configVersion), [1, 2, 3]);
      assert.ok(changes.every(change => change.changeMetadata && !JSON.stringify(change.changeMetadata).includes(refs[0]) && !JSON.stringify(change.changeMetadata).includes(refs[1])));
      const audit = await f.prisma.auditLog.findMany({ where: { module: "aij-notification", resourceType: "notification-channel" } });
      assert.equal(audit.length, 3);
      assert.ok(audit.every(row => row.status === "success" && !JSON.stringify(row).includes(refs[0]) && !JSON.stringify(row).includes(refs[1]) && !JSON.stringify(row).includes(rawSecretMarker)));
      assert.equal(await f.prisma.runtimeOutbox.count({ where: { producer: "aij-notification" } }), 0, "configuration never triggers an external delivery");
      assert.equal(await f.prisma.secretReference.count(), initialReferenceCount + refs.length);
    });

    const saved = await writeRuntimeEvidence("AF-082", f.lease.id, "notification-config.json", {
      database: f.lease.database, pluginEnabledForRuntime: false, pluginInstallation: "installed", managerHttpStatus: 200,
      deniedAnonymousHttpStatus: 401, deniedReaderHttpStatus: 403, setVersion: 1, rotateVersion: 2, clearVersion: 3,
      secretMaterialResolved: false, providerCalls: 0, rawCredentialPersisted: false, liveProviderConfigured: false,
      references: refs.length, configurationChanges: 3, safeAuditRows: 3
    });
    assert.match(saved, /notification-config\.json$/);
  } finally {
    await f.close();
  }
});
