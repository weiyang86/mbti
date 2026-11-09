import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  SyntheticTestPaymentPayableSource,
  UnavailablePaymentCredentialResolver,
  UnavailablePaymentPayableSource,
  validatePaymentPayableSnapshot
} = require("../../apps/api/dist/plugins/aij-payment/payment-payable-source.js");

const lookup = Object.freeze({
  projectId: "project-test",
  workspaceId: "workspace-test",
  memberId: "member-test",
  payableReference: "synthetic-plan-fee"
});

test("payment payable source keeps price, identity and credential references on the server owner", async t => {
  const source = new SyntheticTestPaymentPayableSource();
  const snapshot = await source.resolve(lookup);
  assert.deepEqual(validatePaymentPayableSnapshot(snapshot, lookup.payableReference), {
    owner: "aij-payment-test-fixture",
    reference: "synthetic-plan-fee",
    amountMinor: "2599",
    currency: "CNY",
    currencyExponent: 2,
    providerCode: "synthetic-test",
    credentialRef: "test-only:payment-fixture"
  });
  assert.equal(Object.isFrozen(snapshot), true);

  await t.test("unknown or incomplete payable lookup is rejected", async () => {
    await assert.rejects(source.resolve({ ...lookup, payableReference: "unknown" }), error => error.getStatus?.() === 404);
    await assert.rejects(source.resolve({ ...lookup, memberId: "" }), error => error.getStatus?.() === 404);
  });

  await t.test("malformed or client-shaped source snapshots fail closed", async () => {
    const invalid = [
      null,
      [],
      { ...snapshot, amountMinor: "0" },
      { ...snapshot, currency: "usd" },
      { ...snapshot, reference: "another-reference" },
      { ...snapshot, clientPrice: 1 },
      { ...snapshot, credentialRef: "" }
    ];
    for (const value of invalid) assert.throws(() => validatePaymentPayableSnapshot(value, lookup.payableReference), error => error.getStatus?.() === 503);
  });

  await t.test("production payable and credential adapters remain unavailable by default", async () => {
    await assert.rejects(new UnavailablePaymentPayableSource().resolve(lookup), error => error.getStatus?.() === 503);
    await assert.rejects(new UnavailablePaymentCredentialResolver().resolve("env:missing"), error => error.getStatus?.() === 503);
  });
});
