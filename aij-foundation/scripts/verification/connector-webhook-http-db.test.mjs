import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";
import { createRuntimeFixture } from "./runtime-fixture.mjs";

const require = createRequire(join(process.cwd(), "apps/api/package.json"));
const { SecretRefPort } = require(join(process.cwd(), "apps/api/dist/secret-center/secret-ref.js"));

const secretName = "AIJ_SECRET_AIJ_FOUNDATION_TEST_CONNECTOR_WEBHOOK_KEY";
const secretRef = "env://" + secretName;
const signingSecret = "AF100-synthetic-signing-secret-9wR4pD7m";
const defaultProjectCode = "aij-foundation-test";
const connectorCode = "aij-generic-webhook";
function signature(rawBody, timestamp, idempotencyKey, key = signingSecret, projectCode = defaultProjectCode, code = connectorCode) {
  const canonical = Buffer.concat([Buffer.from("v1\n" + projectCode + "\n" + code + "\n" + timestamp + "\n" + idempotencyKey + "\n", "utf8"), rawBody]);
  return "v1=" + createHmac("sha256", key).update(canonical).digest("hex");
}

async function send(baseUrl, { payload, rawBody, id = "evt-af100-0001", timestamp = String(Math.floor(Date.now() / 1000)), key = signingSecret, signatureOverride, authorization, contentType = "application/json", projectCode = defaultProjectCode, signedProjectCode = projectCode } = {}) {
  const bytes = rawBody ?? Buffer.from(JSON.stringify(payload ?? { kind: "synthetic", value: 7 }), "utf8");
  const headers = { "content-type": contentType, "x-aij-webhook-timestamp": timestamp, "x-aij-webhook-idempotency-key": id,
    "x-aij-webhook-signature": signatureOverride ?? signature(bytes, timestamp, id, key, signedProjectCode) };
  if (authorization) headers.authorization = authorization;
  const response = await fetch(baseUrl + "/integrations/webhooks/" + projectCode + "/" + connectorCode, { method: "POST", headers, body: bytes, signal: AbortSignal.timeout(8000) });
  return { response, body: await response.json() };
}

test("AF-100 verifies webhook signatures and idempotency through real Nest HTTP and isolated PostgreSQL", { timeout: 300_000 }, async t => {
  const originalSecret = process.env[secretName];
  const fixture = await createRuntimeFixture("AF-100");
  try {
    process.env[secretName] = signingSecret;
    const project = await fixture.prisma.projectProfile.findUniqueOrThrow({ where: { code: "aij-foundation-test" }, select: { id: true } });
    await fixture.prisma.secretReference.create({ data: { ref: secretRef, provider: "env", description: "AF-100 synthetic webhook signing key" } });
    const installation = await fixture.prisma.connectorInstallation.create({ data: {
      projectId: project.id, connectorCode: "aij-generic-webhook", manifestVersion: "1.0.0", scopes: ["webhook:receive"],
      secretRef, status: "configured", version: 1
    } });
    const projectRow = await fixture.prisma.projectProfile.findUniqueOrThrow({ where: { id: project.id }, select: { organizationId: true } });
    const otherProject = await fixture.prisma.projectProfile.create({ data: { code: "synthetic-other-test", name: "Synthetic other test project", organizationId: projectRow.organizationId, environment: "test" }, select: { id: true } });
    await fixture.prisma.connectorInstallation.create({ data: {
      projectId: otherProject.id, connectorCode: connectorCode, manifestVersion: "1.0.0", scopes: ["webhook:receive"], secretRef, status: "configured", version: 1
    } });

    await t.test("valid signed callback is public without an admin JWT and persists only digest metadata", async () => {
      const rawBody = Buffer.from('{"kind":"synthetic","value":7}', "utf8");
      const result = await send(fixture.baseUrl, { rawBody, id: "evt-af100-valid-001" });
      assert.equal(result.response.status, 202);
      assert.equal(result.response.headers.get("cache-control"), "no-store");
      assert.equal(result.body.data.accepted, true);
      assert.equal(result.body.data.duplicate, false);
      const row = await fixture.prisma.connectorInboundEvent.findUniqueOrThrow({ where: { projectId_connectorCode_idempotencyKey: {
        projectId: project.id, connectorCode: "aij-generic-webhook", idempotencyKey: "evt-af100-valid-001"
      } } });
      assert.equal(row.payloadSha256, createHash("sha256").update(rawBody).digest("hex"));
      assert.equal(row.installationVersion, installation.version);
      assert.equal(JSON.stringify(row).includes(rawBody.toString()), false);
      assert.equal(JSON.stringify(row).includes(signingSecret), false);
      assert.equal(Object.hasOwn(row, "payload"), false);
      assert.equal(Object.hasOwn(row, "signature"), false);
    });

    await t.test("forged, tampered, stale and future callbacks are rejected without writes", async () => {
      const before = await fixture.prisma.connectorInboundEvent.count();
      const forged = await send(fixture.baseUrl, { id: "evt-af100-forged-001", key: "wrong-synthetic-key-123456" });
      assert.equal(forged.response.status, 401);
      const bodyA = Buffer.from('{"kind":"synthetic","value":8}', "utf8");
      const bodyB = Buffer.from('{"kind":"synthetic","value":9}', "utf8");
      const tampered = await send(fixture.baseUrl, { rawBody: bodyB, id: "evt-af100-tampered-01", signatureOverride: signature(bodyA, String(Math.floor(Date.now() / 1000)), "evt-af100-tampered-01") });
      assert.equal(tampered.response.status, 401);
      const now = Math.floor(Date.now() / 1000);
      for (const [id, timestamp] of [["evt-af100-stale-0001", String(now - 301)], ["evt-af100-future-001", String(now + 301)]]) {
        const stale = await send(fixture.baseUrl, { id, timestamp });
        assert.equal(stale.response.status, 401);
      }
      const malformed = await send(fixture.baseUrl, { id: "short", signatureOverride: "invalid" });
      assert.equal(malformed.response.status, 400);
      const wrongType = await send(fixture.baseUrl, { id: "evt-af100-type-001", contentType: "text/plain" });
      assert.equal(wrongType.response.status, 400);
      const crossProjectReplay = await send(fixture.baseUrl, { id: "evt-af100-cross-001", projectCode: "synthetic-other-test", signedProjectCode: defaultProjectCode });
      assert.equal(crossProjectReplay.response.status, 401, "a signed request is bound to its project route and cannot be replayed across projects");
      assert.equal(await fixture.prisma.connectorInboundEvent.count(), before);
    });

    await t.test("same key and digest is an idempotent duplicate; same key with different content conflicts", async () => {
      const rawBody = Buffer.from('{"kind":"synthetic","value":7}', "utf8");
      const duplicate = await send(fixture.baseUrl, { rawBody, id: "evt-af100-valid-001" });
      assert.equal(duplicate.response.status, 202);
      assert.equal(duplicate.body.data.duplicate, true);
      const conflict = await send(fixture.baseUrl, { payload: { kind: "synthetic", value: 10 }, id: "evt-af100-valid-001" });
      assert.equal(conflict.response.status, 409);
      assert.equal(await fixture.prisma.connectorInboundEvent.count(), 1);
    });

    await t.test("disabled or out-of-scope connector and unknown project fail closed", async () => {
      await fixture.prisma.connectorInstallation.update({ where: { id: installation.id }, data: { status: "disabled", version: { increment: 1 } } });
      assert.equal((await send(fixture.baseUrl, { id: "evt-af100-disabled-01" })).response.status, 404);
      await fixture.prisma.connectorInstallation.update({ where: { id: installation.id }, data: { status: "configured", scopes: ["webhook:read"], version: { increment: 1 } } });
      assert.equal((await send(fixture.baseUrl, { id: "evt-af100-scope-0001" })).response.status, 404);
      assert.equal((await send(fixture.baseUrl, { projectCode: "unknown-project", id: "evt-af100-unknown-01" })).response.status, 404);
      assert.equal(await fixture.prisma.connectorInboundEvent.count(), 1);
    });

    await t.test("SecretRef revocation racing with an in-flight signed request fails before event persistence", async () => {
      await fixture.prisma.connectorInstallation.update({ where: { id: installation.id }, data: { status: "configured", scopes: ["webhook:receive"], version: { increment: 1 } } });
      const secretPort = fixture.app.get(SecretRefPort);
      const originalResolve = secretPort.resolveTrusted.bind(secretPort);
      secretPort.resolveTrusted = async ref => {
        const resolved = await originalResolve(ref);
        await fixture.prisma.secretReference.update({ where: { ref }, data: { status: "disabled" } });
        return resolved;
      };
      try {
        const revoked = await send(fixture.baseUrl, { id: "evt-af100-revoked-01" });
        assert.equal(revoked.response.status, 404);
        assert.equal(await fixture.prisma.connectorInboundEvent.count(), 1);
      } finally {
        secretPort.resolveTrusted = originalResolve;
      }
    });
  } finally {
    await fixture.close();
    if (originalSecret === undefined) delete process.env[secretName]; else process.env[secretName] = originalSecret;
  }
});
