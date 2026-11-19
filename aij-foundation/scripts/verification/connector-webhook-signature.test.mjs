import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { WEBHOOK_MAX_BODY_BYTES, verifyWebhookSignature } from "../../apps/api/dist/integration-center/connector-webhook-signature.js";

const secret = "AF100-synthetic-signing-secret-9wR4pD7m";
const timestamp = String(Math.floor(Date.now() / 1000));
const body = Buffer.from('{"kind":"synthetic","value":7}', "utf8");
const key = "evt-af100-0001";
const route = { projectCode: "aij-foundation-test", connectorCode: "aij-generic-webhook" };
function sign(raw = body, at = timestamp, id = key, signingSecret = secret, identity = route) {
  const canonical = Buffer.concat([Buffer.from("v1\n" + identity.projectCode + "\n" + identity.connectorCode + "\n" + at + "\n" + id + "\n", "utf8"), raw]);
  return "v1=" + createHmac("sha256", signingSecret).update(canonical).digest("hex");
}

test("AF-100 verifies the canonical HMAC against exact request bytes", () => {
  assert.deepEqual(verifyWebhookSignature(body, { timestamp, idempotencyKey: key, signature: sign() }, secret, route), {
    timestampSeconds: Number(timestamp), idempotencyKey: key
  });
  assert.throws(() => verifyWebhookSignature(Buffer.from(body.toString() + " "), { timestamp, idempotencyKey: key, signature: sign() }, secret, route), e => e.getStatus?.() === 401);
  assert.throws(() => verifyWebhookSignature(body, { timestamp, idempotencyKey: key, signature: sign(body, timestamp, key, "different synthetic secret") }, secret, route), e => e.getStatus?.() === 401);
  assert.throws(() => verifyWebhookSignature(body, { timestamp, idempotencyKey: key, signature: sign() }, secret, { ...route, projectCode: "other-project" }), e => e.getStatus?.() === 401);
});

test("AF-100 rejects malformed or missing signature metadata before accepting an event", () => {
  for (const headers of [
    { timestamp: undefined, idempotencyKey: key, signature: sign() },
    { timestamp, idempotencyKey: "short", signature: sign() },
    { timestamp, idempotencyKey: key, signature: "sha256=" + "0".repeat(64) },
    { timestamp, idempotencyKey: key, signature: undefined }
  ]) assert.throws(() => verifyWebhookSignature(body, headers, secret, route), e => e.getStatus?.() === 400);
});

test("AF-100 rejects stale and future timestamps outside the five-minute window", () => {
  const now = Number(timestamp) * 1000;
  for (const offset of [-301, 301]) {
    const at = String(Number(timestamp) + offset);
    assert.throws(() => verifyWebhookSignature(body, { timestamp: at, idempotencyKey: key, signature: sign(body, at) }, secret, { ...route, nowMilliseconds: now }), e => e.getStatus?.() === 401);
  }
  for (const offset of [-300, 300]) {
    const at = String(Number(timestamp) + offset);
    assert.equal(verifyWebhookSignature(body, { timestamp: at, idempotencyKey: key, signature: sign(body, at) }, secret, { ...route, nowMilliseconds: now }).timestampSeconds, Number(at));
  }
});

test("AF-100 enforces a bounded nonempty raw body", () => {
  assert.throws(() => verifyWebhookSignature(undefined, { timestamp, idempotencyKey: key, signature: sign() }, secret, route), e => e.getStatus?.() === 400);
  assert.throws(() => verifyWebhookSignature(Buffer.alloc(WEBHOOK_MAX_BODY_BYTES + 1), { timestamp, idempotencyKey: key, signature: sign() }, secret, route), e => e.getStatus?.() === 400);
  assert.throws(() => verifyWebhookSignature(Buffer.alloc(0), { timestamp, idempotencyKey: key, signature: sign() }, secret, route), e => e.getStatus?.() === 400);
});
