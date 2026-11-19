import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { ServiceUnavailableException, BadRequestException, ConflictException } = require("@nestjs/common");
const {
  PaymentProviderRegistry,
  validatePaymentProviderRequest,
  validatePaymentProviderResult
} = require("../../apps/api/dist/plugins/aij-payment/payment-provider.js");
const {
  PAYMENT_ORDER_STATES,
  PAYMENT_ATTEMPT_STATES,
  PAYMENT_TRANSACTION_KINDS,
  assertPaymentOrderTransition,
  assertPaymentAttemptTransition,
  validatePaymentTransactionFact
} = require("../../apps/api/dist/plugins/aij-payment/payment-state.js");

const request = () => ({
  projectId: "synthetic-project-01",
  paymentOrderId: "synthetic-order-01",
  paymentAttemptId: "synthetic-attempt-01",
  orderNo: "AIJPAY-synthetic-01",
  amountMinor: "1250",
  currency: "USD",
  currencyExponent: 2,
  idempotencyKey: "synthetic-idem-01"
});

test("provider registry is static, rejects duplicate/malformed adapters, and has no implicit live provider", () => {
  const provider = { providerCode: "fixture-offline", async createPayment() { return {}; }, async queryPayment() { return {}; } };
  assert.throws(() => new PaymentProviderRegistry([]).get("fixture-offline"), ServiceUnavailableException);
  assert.throws(() => new PaymentProviderRegistry([provider, provider]), /registration is invalid/);
  assert.throws(() => new PaymentProviderRegistry([{ ...provider, providerCode: "bad provider" }]), /registration is invalid/);
  assert.throws(() => new PaymentProviderRegistry([{ ...provider, queryPayment: undefined }]), /registration is invalid/);
  assert.equal(new PaymentProviderRegistry([provider]).get("fixture-offline"), provider);
});

test("provider request accepts only the immutable server-owned amount and identity snapshot", () => {
  const accepted = validatePaymentProviderRequest(request());
  assert.equal(accepted.amountMinor, "1250");
  assert.equal(Object.isFrozen(accepted), true);
  for (const patch of [
    { amountMinor: "0" }, { amountMinor: "-1" }, { amountMinor: "01" }, { amountMinor: "1.25" },
    { amountMinor: "9223372036854775808" }, { currency: "usd" }, { currency: "US" },
    { currencyExponent: -1 }, { currencyExponent: 7 }, { projectId: "" }
  ]) assert.throws(() => validatePaymentProviderRequest({ ...request(), ...patch }), BadRequestException);
  assert.throws(() => validatePaymentProviderRequest({ ...request(), credential: "synthetic-secret" }), BadRequestException);
  assert.throws(() => validatePaymentProviderRequest({ ...request(), rawBody: "provider data" }), BadRequestException);
});

test("normalized provider result excludes raw payload, credentials, and provider-owned price", () => {
  assert.deepEqual(validatePaymentProviderResult({ providerReference: "provider-ref-01", status: "pending", observedAt: "2026-11-01T00:00:00Z" }), {
    providerReference: "provider-ref-01", status: "pending", observedAt: "2026-11-01T00:00:00.000Z"
  });
  assert.throws(() => validatePaymentProviderResult({ providerReference: "ref", status: "settled", observedAt: "2026-11-01T00:00:00Z" }), ServiceUnavailableException);
  for (const extra of [{ amountMinor: "1" }, { currency: "USD" }, { rawBody: "secret" }, { credential: "secret" }]) {
    assert.throws(() => validatePaymentProviderResult({ providerReference: "ref", status: "succeeded", observedAt: "2026-11-01T00:00:00Z", ...extra }), ServiceUnavailableException);
  }
});

test("provider receives credentials out of band and cannot mutate the normalized request", async () => {
  const received = [];
  const provider = {
    providerCode: "fixture-offline",
    async createPayment(input, credential) { received.push({ input, credential }); return { providerReference: "fixture-ref", status: "pending", observedAt: "2026-11-01T00:00:00Z" }; },
    async queryPayment(input, credential) { received.push({ input, credential }); return { providerReference: input.providerReference, status: "succeeded", observedAt: "2026-11-01T00:00:01Z" }; }
  };
  const validated = validatePaymentProviderRequest(request());
  const syntheticCredential = "synthetic-only-not-a-provider-key";
  const receipt = validatePaymentProviderResult(await new PaymentProviderRegistry([provider]).get("fixture-offline").createPayment(validated, syntheticCredential));
  assert.equal(receipt.status, "pending");
  assert.equal(received[0].credential, syntheticCredential);
  assert.equal(Object.hasOwn(received[0].input, "credential"), false);
  assert.equal(JSON.stringify(received[0].input).includes(syntheticCredential), false);
});

test("order and attempt state have one explicit default-deny transition policy", () => {
  assert.deepEqual(PAYMENT_ORDER_STATES, ["created", "pending", "succeeded", "failed", "closed"]);
  assert.deepEqual(PAYMENT_ATTEMPT_STATES, ["created", "submitting", "pending", "succeeded", "failed", "unknown", "cancelled"]);
  assert.equal(assertPaymentOrderTransition("created", "pending"), undefined);
  assert.equal(assertPaymentOrderTransition("pending", "succeeded"), undefined);
  assert.equal(assertPaymentAttemptTransition("created", "submitting"), undefined);
  assert.equal(assertPaymentAttemptTransition("submitting", "unknown"), undefined);
  assert.equal(assertPaymentAttemptTransition("unknown", "succeeded"), undefined);
  assert.throws(() => assertPaymentOrderTransition("succeeded", "pending"), ConflictException);
  assert.throws(() => assertPaymentOrderTransition("created", "succeeded"), ConflictException);
  assert.throws(() => assertPaymentAttemptTransition("failed", "pending"), ConflictException);
  assert.throws(() => assertPaymentAttemptTransition("forged", "succeeded"), ConflictException);
});

test("transaction facts are immutable append-only entries and reject amount or currency mutation", () => {
  assert.deepEqual(PAYMENT_TRANSACTION_KINDS, ["charge", "refund", "reversal"]);
  const fact = validatePaymentTransactionFact({
    paymentOrderId: "synthetic-order-01", paymentAttemptId: "synthetic-attempt-01", kind: "charge",
    providerReference: "provider-ref-01", amountMinor: "1250", currency: "USD", occurredAt: "2026-11-01T00:00:00Z"
  });
  assert.equal(Object.isFrozen(fact), true);
  assert.equal(fact.occurredAt, "2026-11-01T00:00:00.000Z");
  assert.throws(() => validatePaymentTransactionFact({ ...fact, amountMinor: "-1" }), ConflictException);
  assert.throws(() => validatePaymentTransactionFact({ ...fact, currency: "usd" }), ConflictException);
  assert.throws(() => validatePaymentTransactionFact({ ...fact, status: "deleted" }), ConflictException);
});
