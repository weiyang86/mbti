import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";
import { repositoryRoot } from "../database/connection.mjs";

const require = createRequire(join(repositoryRoot, "apps/api/package.json"));
const { validatePaymentCallbackPayload } = require(join(repositoryRoot, "apps/api/dist/plugins/aij-payment/payment-callback.dto.js"));
const { verifyPaymentCallbackSignature } = require(join(repositoryRoot, "apps/api/dist/plugins/aij-payment/payment-callback-signature.js"));

const context = { projectCode: "aij-foundation-test", providerCode: "synthetic-test" };
const secret = "synthetic-only-no-provider-secret";
const payload = () => ({ eventId: "af105-event-0001", orderNo: "AIJPAY-synthetic-order-1", providerReference: "synthetic-reference-1", status: "succeeded", amountMinor: "2599", currency: "CNY", occurredAt: new Date().toISOString() });
function signed(rawBody, eventId, now = Date.now(), signerContext = context) {
  const timestamp = String(Math.floor(now / 1000));
  const digest = createHmac("sha256", secret).update(Buffer.concat([
    Buffer.from(`v1\n${signerContext.projectCode}\n${signerContext.providerCode}\n${timestamp}\n${eventId}\n`, "utf8"), rawBody
  ])).digest("hex");
  return { timestamp, eventId, signature: "v1=" + digest };
}

test("payment callback DTO accepts only normalized facts and rejects raw/provider extras", () => {
  const valid = payload();
  assert.equal(validatePaymentCallbackPayload(valid).amountMinor, "2599");
  assert.throws(() => validatePaymentCallbackPayload({ ...valid, credential: secret }), /invalid/i);
  assert.throws(() => validatePaymentCallbackPayload({ ...valid, amountMinor: "0" }), /invalid/i);
  assert.throws(() => validatePaymentCallbackPayload({ ...valid, currency: "usd" }), /invalid/i);
  assert.throws(() => validatePaymentCallbackPayload({ ...valid, eventId: "short" }), /invalid/i);
  assert.throws(() => validatePaymentCallbackPayload({ ...valid, occurredAt: "not-a-date" }), /invalid/i);
});

test("payment callback signature binds the exact raw body, event id and project/provider context", () => {
  const body = Buffer.from(JSON.stringify(payload()));
  const headers = signed(body, "af105-event-0001");
  assert.equal(verifyPaymentCallbackSignature(body, headers, secret, context).idempotencyKey, "af105-event-0001");
  assert.throws(() => verifyPaymentCallbackSignature(Buffer.concat([body, Buffer.from(" ")]), headers, secret, context), /authentication failed/i);
  assert.throws(() => verifyPaymentCallbackSignature(body, headers, secret, { ...context, projectCode: "other-project" }), /authentication failed/i);
  assert.throws(() => verifyPaymentCallbackSignature(body, signed(body, headers.eventId, Date.now() - 301_000), secret, context), /authentication failed/i);
});
