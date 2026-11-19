import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import environment from "../runtime-environment.cjs";

const base = () => ({ AUTH_ENABLED: "true", DATABASE_ENABLED: "true", APP_ENV: "test", NODE_ENV: "test", JWT_SECRET: randomBytes(32).toString("hex"), TEST_DATABASE_URL: "postgresql://aij_foundation_test:" + randomBytes(32).toString("hex") + "@127.0.0.1:55433/aij_foundation_test" });
test("administrator auth is opt-in and requires a protected database, without demanding unused client credentials", () => {
  const values = base(), runtime = environment.loadRuntimeEnvironment(values);
  assert.equal(runtime.capabilities.auth, true); assert.equal(runtime.databaseTarget.port, 55433);
  assert.ok(!JSON.stringify(runtime).includes(values.JWT_SECRET));
  assert.throws(() => environment.loadRuntimeEnvironment({ ...values, DATABASE_ENABLED: "false" }), /requires the database/);
  assert.equal(environment.loadRuntimeEnvironment({ AUTH_ENABLED: "false", JWT_SECRET: "template", CLIENT_JWT_SECRET: "template" }).capabilities.auth, false);
});
test("enabled administrator JWT has no missing/template/weak fallback and preserves explicit reserved-key separation", () => {
  const values = base();
  for (const value of [undefined, "", "dev-admin-secret-change-me", "replace-template-key-12345678901234567890", "a".repeat(64)]) {
    assert.throws(() => environment.loadRuntimeEnvironment({ ...values, JWT_SECRET: value }), e => /JWT_SECRET/.test(e.message) && (!value || !e.message.includes(value)));
  }
  assert.throws(() => environment.loadRuntimeEnvironment({ ...values, CLIENT_JWT_SECRET: values.JWT_SECRET }), /reuse/);
  assert.doesNotThrow(() => environment.loadRuntimeEnvironment({ ...values, CLIENT_JWT_SECRET: "", CLIENT_AUTH_RATE_LIMIT_SECRET: "", CLIENT_AUTH_TOKEN_SECRET: "" }));
});
test("administrator host configuration rejects old/cross-environment issuer and test DB fallback", () => {
  for (const issuer of ["qingqi-api", "urn:aij:other:test:api", "urn:aij:aij-foundation:development:api"]) assert.throws(() => environment.loadRuntimeEnvironment({ ...base(), JWT_ISSUER: issuer }));
  assert.throws(() => environment.loadRuntimeEnvironment({ ...base(), TEST_DATABASE_URL: "", DATABASE_URL: "postgresql://aij_foundation_dev:template@127.0.0.1:55432/aij_foundation_dev" }));
});
