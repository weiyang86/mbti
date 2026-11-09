import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createRuntimeFixture } from "./runtime-fixture.mjs";

const project = "aij-foundation-test";
const connector = "aij-generic-webhook";
const managerBase = `/admin/integrations/projects/${project}/connectors/${connector}`;
const projectOperationsBase = `/admin/integrations/projects/${project}/operations`;
const oldName = "AIJ_SECRET_AIJ_FOUNDATION_TEST_AF102_OLD";
const rotatedName = "AIJ_SECRET_AIJ_FOUNDATION_TEST_AF102_ROTATED";
const disabledRotationName = "AIJ_SECRET_AIJ_FOUNDATION_TEST_AF102_DISABLED_ROTATION";
const oldRef = `env://${oldName}`;
const rotatedRef = `env://${rotatedName}`;
const disabledRotationRef = `env://${disabledRotationName}`;
const oldSecret = "AF102-synthetic-old-signing-value-7dE2";
const rotatedSecret = "AF102-synthetic-rotated-signing-value-8mQ4";
const disabledRotationSecret = "AF102-synthetic-disabled-rotation-value-5vK9";

function webhookSignature(rawBody, timestamp, idempotencyKey, key) {
  const canonical = Buffer.concat([Buffer.from(`v1\n${project}\n${connector}\n${timestamp}\n${idempotencyKey}\n`, "utf8"), rawBody]);
  return `v1=${createHmac("sha256", key).update(canonical).digest("hex")}`;
}

async function sendWebhook(baseUrl, key, id) {
  const rawBody = Buffer.from(JSON.stringify({ kind: "synthetic", task: "AF-102", id }), "utf8");
  const timestamp = String(Math.floor(Date.now() / 1000));
  const response = await fetch(`${baseUrl}/integrations/webhooks/${project}/${connector}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-aij-webhook-timestamp": timestamp,
      "x-aij-webhook-idempotency-key": id,
      "x-aij-webhook-signature": webhookSignature(rawBody, timestamp, id, key)
    },
    body: rawBody,
    signal: AbortSignal.timeout(8000)
  });
  return { response, body: await response.json() };
}

test("AF-102 rotates synthetic SecretRefs, controls connector lifecycle and rejects stale in-flight callbacks using real PostgreSQL/Nest HTTP", { timeout: 300_000 }, async t => {
  const fixture = await createRuntimeFixture("AF-102", { rbacFixture: true });
  try {
    process.env[oldName] = oldSecret;
    process.env[rotatedName] = rotatedSecret;
    process.env[disabledRotationName] = disabledRotationSecret;
    const credentials = JSON.parse(await readFile(fixture.rbacFixture.accounts[0].initialPasswordFile, "utf8"));
    const manager = credentials.accounts.find(account => account.username === "af102-integration-manager");
    const denied = credentials.accounts.find(account => account.username === "af102-no-access");
    assert.ok(manager && denied, "isolated test DB provides a manager and a default-deny account");
    const managerToken = await fixture.login(manager.username, manager.password);
    const deniedToken = await fixture.login(denied.username, denied.password);
    const projectRow = await fixture.prisma.projectProfile.findUniqueOrThrow({ where: { code: project }, select: { id: true } });
    const refs = [oldRef, rotatedRef, disabledRotationRef];
    for (const ref of refs) await fixture.prisma.secretReference.create({ data: { ref, provider: "env", description: "AF-102 synthetic SecretRef" } });

    const configure = (secretRef, expectedVersion) => fixture.request(managerBase, {
      method: "PUT", authorization: managerToken,
      body: { scopes: ["webhook:receive", "webhook:read"], secretRef, expectedVersion }
    });
    const lifecycle = (action, expectedVersion, authorization = managerToken, extra = {}) => fixture.request(`${managerBase}/lifecycle`, {
      method: "PATCH", authorization, body: { action, expectedVersion, ...extra }
    });

    await t.test("configuration rotates to a new reference without persisting or returning secret values", async () => {
      const configured = await configure(oldRef, 0);
      assert.equal(configured.body.data.status, "configured");
      assert.equal(configured.body.data.version, 1);
      const acceptedOld = await sendWebhook(fixture.baseUrl, oldSecret, "evt-af102-old-001");
      assert.equal(acceptedOld.response.status, 202);
      const rotated = await configure(rotatedRef, 1);
      assert.equal(rotated.body.data.secretRef, rotatedRef);
      assert.equal(rotated.body.data.version, 2);
      const oldKeyRejected = await sendWebhook(fixture.baseUrl, oldSecret, "evt-af102-old-rejected-1");
      assert.equal(oldKeyRejected.response.status, 401, "the old key is not used after reference rotation");
      const newKeyAccepted = await sendWebhook(fixture.baseUrl, rotatedSecret, "evt-af102-new-001");
      assert.equal(newKeyAccepted.response.status, 202, "the next request resolves the current reference");
      assert.equal(JSON.stringify([configured, rotated]).includes(oldSecret), false);
      assert.equal(JSON.stringify([configured, rotated]).includes(rotatedSecret), false);
    });

    await t.test("anonymous, default-deny, malformed and stale lifecycle requests are rejected", async () => {
      await fixture.request(`${managerBase}/lifecycle`, { expected: 401, method: "PATCH", authorization: null,
        body: { action: "disable", expectedVersion: 2 } });
      await fixture.request(`${managerBase}/lifecycle`, { expected: 403, method: "PATCH", authorization: deniedToken,
        body: { action: "disable", expectedVersion: 2 } });
      await fixture.request(`${managerBase}/lifecycle`, { expected: 400, method: "PATCH", authorization: managerToken,
        body: { action: "pause", expectedVersion: 2 } });
      await fixture.request(`${managerBase}/lifecycle`, { expected: 400, method: "PATCH", authorization: managerToken,
        body: { action: "disable", expectedVersion: 2, secret: rotatedSecret } });
      await fixture.request(`${managerBase}/lifecycle`, { expected: 409, method: "PATCH", authorization: managerToken,
        body: { action: "disable", expectedVersion: 1 } });
      const stillActive = await fixture.prisma.connectorInstallation.findUniqueOrThrow({ where: { projectId_connectorCode: {
        projectId: projectRow.id, connectorCode: connector
      } } });
      assert.equal(stillActive.status, "configured");
      assert.equal(stillActive.version, 2);
    });

    await t.test("disable fails closed, rotation while disabled does not reactivate, and configured current reference is required to resume", async () => {
      const disabled = await lifecycle("disable", 2);
      assert.equal(disabled.body.data.status, "disabled");
      assert.equal(disabled.body.data.version, 3);
      assert.equal((await sendWebhook(fixture.baseUrl, rotatedSecret, "evt-af102-disabled-001")).response.status, 404);
      await fixture.request(`${projectOperationsBase}?page=1&pageSize=10`, { expected: 200, authorization: managerToken }).then(async result => {
        assert.equal(result.body.data.items.length, 0, "a disabled connector has no operational history in this fresh fixture");
      });
      await fixture.request(`${managerBase}/operations`, { expected: 404, method: "POST", authorization: managerToken, body: { type: "secret_reference_check" } });

      delete process.env[rotatedName];
      await fixture.request(`${managerBase}/lifecycle`, { expected: 409, method: "PATCH", authorization: managerToken,
        body: { action: "enable", expectedVersion: 3 } });
      process.env[rotatedName] = rotatedSecret;
      const unchanged = await fixture.prisma.connectorInstallation.findUniqueOrThrow({ where: { projectId_connectorCode: {
        projectId: projectRow.id, connectorCode: connector
      } } });
      assert.equal(unchanged.status, "disabled");
      assert.equal(unchanged.version, 3);

      const rotatedWhileDisabled = await configure(disabledRotationRef, 3);
      assert.equal(rotatedWhileDisabled.body.data.status, "disabled");
      assert.equal(rotatedWhileDisabled.body.data.version, 4);
      assert.equal((await sendWebhook(fixture.baseUrl, disabledRotationSecret, "evt-af102-disabled-rotation-01")).response.status, 404);
      const enabled = await lifecycle("enable", 4);
      assert.equal(enabled.body.data.status, "enabled");
      assert.equal(enabled.body.data.version, 5);
      assert.equal((await sendWebhook(fixture.baseUrl, disabledRotationSecret, "evt-af102-enabled-001")).response.status, 202);
      assert.equal((await sendWebhook(fixture.baseUrl, rotatedSecret, "evt-af102-obsolete-001")).response.status, 401);
    });

    await t.test("disable during verification invalidates the in-flight snapshot before an event is persisted", async () => {
      const secretPort = fixture.app.get((await import("../../apps/api/dist/secret-center/secret-ref.js")).SecretRefPort);
      const originalResolve = secretPort.resolveTrusted.bind(secretPort);
      let entered;
      const resolving = new Promise(resolve => { entered = resolve; });
      let release;
      const gate = new Promise(resolve => { release = resolve; });
      secretPort.resolveTrusted = async ref => {
        const secret = await originalResolve(ref);
        entered();
        await gate;
        return secret;
      };
      const beforeCount = await fixture.prisma.connectorInboundEvent.count({ where: { projectId: projectRow.id, connectorCode: connector } });
      const request = sendWebhook(fixture.baseUrl, disabledRotationSecret, "evt-af102-inflight-001");
      let resolveTimer;
      try {
        await Promise.race([resolving, new Promise((_, reject) => {
          resolveTimer = setTimeout(() => reject(new Error("Webhook did not reach the SecretRef resolution barrier")), 5_000);
        })]);
        const paused = await lifecycle("disable", 5);
        assert.equal(paused.body.data.status, "disabled");
        assert.equal(paused.body.data.version, 6);
      } finally {
        clearTimeout(resolveTimer);
        release();
      }
      const stale = await request;
      assert.equal(stale.response.status, 404, "stale signed snapshot is rejected after lifecycle version/status changed");
      assert.equal(await fixture.prisma.connectorInboundEvent.count({ where: { projectId: projectRow.id, connectorCode: connector } }), beforeCount,
        "the rejected in-flight request leaves no receipt or idempotency row");
      secretPort.resolveTrusted = originalResolve;

      const resumed = await lifecycle("enable", 6);
      assert.equal(resumed.body.data.status, "enabled");
      const sameIdAccepted = await sendWebhook(fixture.baseUrl, disabledRotationSecret, "evt-af102-inflight-001");
      assert.equal(sameIdAccepted.response.status, 202, "the uncommitted idempotency key can be used after safe reactivation");
      const receipt = await fixture.prisma.connectorInboundEvent.findFirstOrThrow({ where: {
        projectId: projectRow.id, connectorCode: connector, idempotencyKey: "evt-af102-inflight-001"
      } });
      assert.equal(receipt.installationVersion, resumed.body.data.version);
      assert.equal(Object.hasOwn(receipt, "payload"), false);
      assert.equal(Object.hasOwn(receipt, "signature"), false);
    });

    await t.test("lifecycle transitions are audited with redacted metadata and old credentials are absent from stored values", async () => {
      const changes = await fixture.prisma.configurationChange.findMany({ where: {
        scope: "project", scopeId: projectRow.id, pluginCode: connector, configKey: "integration.connector.lifecycle"
      }, orderBy: [{ createdAt: "asc" }] });
      assert.deepEqual(changes.map(change => change.eventType), ["connector_disabled", "connector_enabled", "connector_disabled", "connector_enabled"]);
      assert.ok(changes.every(change => change.auditLogId && change.changeMetadata.version));
      const installation = await fixture.prisma.connectorInstallation.findUniqueOrThrow({ where: { projectId_connectorCode: {
        projectId: projectRow.id, connectorCode: connector
      } } });
      const receipts = await fixture.prisma.connectorInboundEvent.findMany({ where: { projectId: projectRow.id, connectorCode: connector } });
      const logs = await fixture.prisma.auditLog.findMany({ where: { resourceId: installation.id } });
      const stored = JSON.stringify({ installation, receipts, changes, logs });
      for (const secret of [oldSecret, rotatedSecret, disabledRotationSecret]) assert.equal(stored.includes(secret), false);
      assert.equal(receipts.some(receipt => receipt.idempotencyKey === "evt-af102-disabled-001"), false);
      assert.equal(receipts.some(receipt => receipt.idempotencyKey === "evt-af102-inflight-001"), true);
    });
  } finally {
    await fixture.close();
  }
});
