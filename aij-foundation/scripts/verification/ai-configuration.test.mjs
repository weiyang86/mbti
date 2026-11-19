import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";
import { repositoryRoot } from "../database/connection.mjs";
import { createRuntimeFixture, writeRuntimeEvidence } from "./runtime-fixture.mjs";

const require = createRequire(join(repositoryRoot, "apps/api/package.json"));
const SECRET_ENV = "AIJ_SECRET_AIJ_FOUNDATION_TEST_AI_PROVIDER_KEY";
const SECRET_REF = "env://AIJ_SECRET_AIJ_FOUNDATION_TEST_AI_PROVIDER_KEY";
const SECRET_VALUE = "synthetic-ai-provider-credential-only";

function bodyData(response) { return response.body?.data; }

test("AF-095 AI Provider configuration uses project ScopedConfig, RBAC and SecretRef status-only projection", { timeout: 240_000 }, async t => {
  const f = await createRuntimeFixture("AF-095", { enabledPlugins: ["aij-ai"], rbacFixture: true });
  const originalSecret = process.env[SECRET_ENV];
  process.env[SECRET_ENV] = SECRET_VALUE;
  const passwordRecord = JSON.parse(readFileSync(f.rbacFixture.accounts[0].initialPasswordFile, "utf8"));
  const passwordFor = username => passwordRecord.accounts.find(account => account.username === username)?.password;
  const configToken = await f.login("af095-config", passwordFor("af095-config"));
  const secretToken = await f.login("af095-secret", passwordFor("af095-secret"));
  const readerToken = await f.login("af095-reader", passwordFor("af095-reader"));
  const events = [];
  const noSecretEcho = (response, { allowReference = false } = {}) => {
    assert.equal(response.text.includes(SECRET_VALUE), false, "HTTP body never contains a secret value");
    if (!allowReference) assert.equal(response.text.includes(SECRET_REF), false, "AI settings API never returns the reference string");
    events.push({ status: response.response.status, bodyBytes: Buffer.byteLength(response.text) });
  };
  const put = (key, configValue, valueType = "string", authorization = configToken, expected = 200, scope = "project") =>
    f.request("/admin/scoped-configs/" + key, { expected, method: "PUT", authorization, body: { scope, configValue, valueType, isPublic: false, status: "active", expectedVersion: 0 } });

  try {
    const { AiProviderConfigurationPort, AiCapabilityPolicyPort } = require("../../apps/api/dist/plugins/aij-ai/ai-provider.js");
    await t.test("anonymous and ordinary reader are denied; UI permission is backed by API RBAC", async () => {
      const anonymous = await f.request("/admin/scoped-configs", { expected: 401, authorization: null }); noSecretEcho(anonymous);
      const reader = await f.request("/admin/scoped-configs", { expected: 403, authorization: readerToken }); noSecretEcho(reader);
      const deniedWrite = await put("ai.providerCode", "fixture-provider", "string", readerToken, 403); noSecretEcho(deniedWrite);
      const initial = await f.request("/admin/scoped-configs", { authorization: configToken }); noSecretEcho(initial);
      assert.deepEqual(bodyData(initial), []);
      assert.equal(await f.prisma.scopedConfig.count(), 0);
    });

    await t.test("AI config values are strict, private, and project-only", async () => {
      for (const [key, value, type, scope, expected] of [
        ["ai.providerCode", "bad/provider", "string", "project", 400],
        ["ai.modelCode", "bad model", "string", "project", 400],
        ["ai.providerCode", "fixture-provider", "string", "organization", 400],
        ["capabilities.ai.text.generate", "not-a-boolean", "boolean", "project", 400]
      ]) noSecretEcho(await put(key, value, type, configToken, expected, scope));
      assert.equal(await f.prisma.scopedConfig.count(), 0, "rejected values created no configuration rows");
      assert.equal(await f.prisma.auditLog.count({ where: { module: "configuration" } }), 0, "rejected values created no audit entries");
    });

    await t.test("authorized config-only role can save non-secret AI settings; credential binding requires SecretRef permission", async () => {
      for (const [key, value, type] of [["ai.providerCode", "fixture-provider", "string"], ["ai.modelCode", "fixture-model-v1", "string"], ["capabilities.ai.text.generate", "true", "boolean"]]) {
        const response = await put(key, value, type); noSecretEcho(response); assert.equal(bodyData(response).version, 1);
      }
      const deniedRef = await put("ai.credentialRef", SECRET_REF, "secretRef", configToken, 403); noSecretEcho(deniedRef);
      assert.equal(await f.prisma.scopedConfig.count({ where: { configKey: "ai.credentialRef" } }), 0);
    });

    await t.test("SecretCenter binds a synthetic ref, and config HTTP returns only availability status", async () => {
      const created = await f.request("/admin/secret-references", { expected: 201, method: "POST", authorization: secretToken, body: { ref: SECRET_REF } }); noSecretEcho(created, { allowReference: true });
      assert.equal(bodyData(created).configured, true);
      assert.equal(bodyData(created).ref, SECRET_REF, "SecretCenter exposes only the opaque reference to its authorized owner");
      const bound = await put("ai.credentialRef", SECRET_REF, "secretRef", secretToken); noSecretEcho(bound);
      assert.equal(bodyData(bound).referenceConfigured, true);
      assert.equal(Object.hasOwn(bodyData(bound), "configValue"), false);
      const list = await f.request("/admin/scoped-configs", { authorization: configToken }); noSecretEcho(list);
      const row = bodyData(list).find(value => value.configKey === "ai.credentialRef");
      assert.equal(row.pluginCode, undefined, "safe configuration projection does not reveal internal plugin wiring");
      assert.equal(row.referenceConfigured, true);
      assert.equal(Object.hasOwn(row, "configValue"), false);
      assert.equal(row.scope, "project");
      const resolved = await f.request("/admin/scoped-configs/ai.credentialRef/resolved", { authorization: configToken }); noSecretEcho(resolved);
      assert.equal(bodyData(resolved).referenceConfigured, true);
      assert.equal(Object.hasOwn(bodyData(resolved), "configValue"), false);
      const context = await f.request("/project/context", { authorization: null }); noSecretEcho(context);
      assert.equal(JSON.stringify(bodyData(context)).includes("ai.credentialRef"), false, "anonymous context excludes plugin-private settings");
      assert.equal(await f.prisma.scopedConfig.count({ where: { pluginCode: "aij-ai", scope: "project" } }), 4);
      assert.equal(await f.prisma.configurationChange.count({ where: { pluginCode: "aij-ai" } }), 4);
      const changes = await f.prisma.configurationChange.findMany({ where: { pluginCode: "aij-ai" }, select: { auditLogId: true, configKey: true, changeMetadata: true } });
      assert.ok(changes.every(change => change.auditLogId && !JSON.stringify(change.changeMetadata).includes(SECRET_REF)));
    });

    await t.test("AI runtime adapter consumes project-owned config internally and denies a missing backing secret", async () => {
      const project = await f.prisma.projectProfile.findUniqueOrThrow({ where: { code: "aij-foundation-test" }, select: { id: true } });
      const configuration = f.app.get(AiProviderConfigurationPort);
      const capability = f.app.get(AiCapabilityPolicyPort);
      const resolved = await f.prisma.$transaction(tx => configuration.resolveActive(tx, project.id, "text.generate"));
      assert.deepEqual(resolved, { providerCode: "fixture-provider", modelCode: "fixture-model-v1", credentialRef: SECRET_REF });
      await f.prisma.$transaction(tx => capability.assertEnabled(tx, project.id, "text.generate"));
      delete process.env[SECRET_ENV];
      const status = await f.request("/admin/scoped-configs", { authorization: configToken }); noSecretEcho(status);
      assert.equal(bodyData(status).find(value => value.configKey === "ai.credentialRef").referenceConfigured, false);
      await assert.rejects(() => f.prisma.$transaction(tx => configuration.resolveActive(tx, project.id, "text.generate")), /AI provider credentials are unavailable/);
      process.env[SECRET_ENV] = SECRET_VALUE;
      const configChange = await f.request("/admin/scoped-configs/capabilities.ai.text.generate", { expected: 200, method: "PUT", authorization: configToken,
        body: { scope: "project", configValue: "false", valueType: "boolean", isPublic: false, status: "disabled", expectedVersion: 1 } }); noSecretEcho(configChange);
      await assert.rejects(() => f.prisma.$transaction(tx => capability.assertEnabled(tx, project.id, "text.generate")), /AI capability is unavailable/);
    });

    await t.test("persisted audit and configuration data contain no raw SecretRef or secret value", async () => {
      const configs = await f.prisma.scopedConfig.findMany({ where: { pluginCode: "aij-ai" }, select: { configKey: true, configValue: true } });
      const reference = configs.find(row => row.configKey === "ai.credentialRef");
      assert.equal(reference?.configValue, SECRET_REF, "only the opaque reference is stored for the server-side resolver");
      const persisted = JSON.stringify({ changes: await f.prisma.configurationChange.findMany({ where: { pluginCode: "aij-ai" } }), audits: await f.prisma.auditLog.findMany({ where: { module: "configuration" } }) });
      assert.equal(persisted.includes(SECRET_VALUE), false);
      assert.equal(persisted.includes(SECRET_REF), false, "audit and change metadata do not duplicate the reference");
      assert.equal(persisted.includes("AIJ_SECRET_AIJ_FOUNDATION_TEST_AI_PROVIDER_KEY"), false);
      await writeRuntimeEvidence("AF-095", f.lease.id, "ai-configuration.json", { projectId: "synthetic-project", events, privateSettingsNotPublic: true, secretRefStatusOnly: true, rawSecretPersisted: false, providerInvocationCount: 0 });
    });
  } finally {
    await f.close();
    if (originalSecret === undefined) delete process.env[SECRET_ENV]; else process.env[SECRET_ENV] = originalSecret;
  }
});
