import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createRuntimeFixture } from "./runtime-fixture.mjs";

const secretName = "AIJ_SECRET_AIJ_FOUNDATION_TEST_CONNECTOR_WEBHOOK_KEY";
const secretRef = "env://" + secretName;
const rawCredential = "K8!connector-vault-value-74Dq2p9V6s3X";
const validConfig = { scopes: ["webhook:receive", "webhook:read"], secretRef, expectedVersion: 0 };

test("AF-099 enforces the connector manifest allowlist, project scope, RBAC and SecretRef boundary over real HTTP/PostgreSQL", { timeout: 300_000 }, async t => {
  const f = await createRuntimeFixture("AF-099", { rbacFixture: true });
  try {
    const accountDoc = JSON.parse(await readFile(f.rbacFixture.accounts[0].initialPasswordFile, "utf8"));
    const manager = accountDoc.accounts.find(account => account.username === "af099-integration-manager");
    const denied = accountDoc.accounts.find(account => account.username === "af099-no-access");
    assert.ok(manager && denied, "isolated DB contains a connector manager and a default-deny role");
    const managerToken = await f.login(manager.username, manager.password);
    const deniedToken = await f.login(denied.username, denied.password);
    const project = await f.prisma.projectProfile.findUniqueOrThrow({ where: { code: "aij-foundation-test" }, select: { id: true } });
    process.env[secretName] = rawCredential;

    await t.test("only the registered static contract is listed; anonymous and unauthorized reads are denied", async () => {
      await f.request("/admin/integrations/connectors", { expected: 401, authorization: null });
      await f.request("/admin/integrations/connectors", { expected: 403, authorization: deniedToken });
      const catalog = await f.request("/admin/integrations/connectors", { authorization: managerToken });
      assert.deepEqual(catalog.body.data.map(item => item.code), ["aij-generic-webhook"]);
      assert.deepEqual(catalog.body.data[0].scopes, ["webhook:receive", "webhook:read"]);
      assert.deepEqual(catalog.body.data[0].secretProviders, ["env", "local"]);
      const list = await f.request("/admin/integrations/projects/aij-foundation-test/connectors", { authorization: managerToken });
      assert.deepEqual(list.body.data, []);
    });

    await t.test("unregistered connector, ungranted role, invalid manifest scopes and raw credential fields fail without writes", async () => {
      const path = "/admin/integrations/projects/aij-foundation-test/connectors/";
      await f.request(path + "not-registered", { expected: 404, method: "PUT", body: validConfig, authorization: managerToken });
      await f.request(path + "aij-generic-webhook", { expected: 403, method: "PUT", body: validConfig, authorization: deniedToken });
      await f.request(path + "aij-generic-webhook", { expected: 400, method: "PUT", body: { ...validConfig, scopes: ["webhook:admin"] }, authorization: managerToken });
      await f.request(path + "aij-generic-webhook", { expected: 400, method: "PUT", body: { ...validConfig, scopes: ["webhook:read", "webhook:read"] }, authorization: managerToken });
      await f.request(path + "aij-generic-webhook", { expected: 400, method: "PUT", body: { ...validConfig, credential: rawCredential }, authorization: managerToken });
      await f.request(path + "aij-generic-webhook", { expected: 403, method: "PUT", body: { ...validConfig, secretRef: "env://AIJ_SECRET_OTHER_PROJECT_TEST_CONNECTOR_KEY" }, authorization: managerToken });
      assert.equal(await f.prisma.connectorInstallation.count(), 0, "all rejected writes leave the connector table empty");
    });

    await t.test("missing configured SecretRef is rejected; no connector state is persisted", async () => {
      await f.request("/admin/integrations/projects/aij-foundation-test/connectors/aij-generic-webhook", {
        expected: 400, method: "PUT", authorization: managerToken, body: { ...validConfig, secretRef: "env://AIJ_SECRET_AIJ_FOUNDATION_TEST_CONNECTOR_MISSING" }
      });
      assert.equal(await f.prisma.connectorInstallation.count(), 0);
    });

    await t.test("valid project setup persists scopes and only a reference; safe response and audit never reveal raw credentials", async () => {
      await f.prisma.secretReference.create({ data: { ref: secretRef, provider: "env", description: "AF-099 synthetic connector signing key" } });
      const response = await f.request("/admin/integrations/projects/aij-foundation-test/connectors/aij-generic-webhook", {
        expected: 200, method: "PUT", authorization: managerToken, body: validConfig
      });
      assert.equal(response.body.data.connectorCode, "aij-generic-webhook");
      assert.equal(response.body.data.status, "configured");
      assert.equal(response.body.data.secretConfigured, true);
      assert.equal(response.body.data.version, 1);
      assert.deepEqual(response.body.data.scopes, ["webhook:read", "webhook:receive"]);
      assert.equal(response.body.data.secretRef, secretRef);
      assert.equal(JSON.stringify(response.body).includes(rawCredential), false);

      const row = await f.prisma.connectorInstallation.findUniqueOrThrow({ where: { projectId_connectorCode: { projectId: project.id, connectorCode: "aij-generic-webhook" } } });
      assert.equal(row.secretRef, secretRef);
      assert.equal(JSON.stringify(row).includes(rawCredential), false);
      const audits = await f.prisma.auditLog.findMany({ where: { module: "integration-center", resourceId: row.id } });
      assert.equal(audits.length, 1);
      assert.equal(audits[0].action, "connector_configured");
      const changes = await f.prisma.configurationChange.findMany({ where: { scopeId: project.id, configKey: "integration.connector" } });
      assert.equal(changes.length, 1);
      assert.equal(JSON.stringify({ audits, changes }).includes(rawCredential), false);
    });

    await t.test("versioned update is atomic and a stale version cannot overwrite connector scopes", async () => {
      const path = "/admin/integrations/projects/aij-foundation-test/connectors/aij-generic-webhook";
      const update = await f.request(path, { expected: 200, method: "PUT", authorization: managerToken, body: { ...validConfig, scopes: ["webhook:receive"], expectedVersion: 1 } });
      assert.equal(update.body.data.version, 2);
      assert.deepEqual(update.body.data.scopes, ["webhook:receive"]);
      await f.request(path, { expected: 409, method: "PUT", authorization: managerToken, body: { ...validConfig, expectedVersion: 1 } });
      const row = await f.prisma.connectorInstallation.findUniqueOrThrow({ where: { projectId_connectorCode: { projectId: project.id, connectorCode: "aij-generic-webhook" } } });
      assert.equal(row.version, 2);
      assert.deepEqual(row.scopes, ["webhook:receive"]);
      const list = await f.request("/admin/integrations/projects/aij-foundation-test/connectors", { authorization: managerToken });
      assert.equal(list.body.data.length, 1);
      assert.equal(list.body.data[0].secretConfigured, true);
    });
  } finally {
    await f.close();
  }
});
