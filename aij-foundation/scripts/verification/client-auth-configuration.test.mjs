import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import environment from "../runtime-environment.cjs";
import { parseArguments, runTask } from "./runner.mjs";

const base = () => ({ CLIENT_AUTH_ENABLED: "true", DATABASE_ENABLED: "true", APP_ENV: "test", NODE_ENV: "test",
  CLIENT_JWT_SECRET: randomBytes(32).toString("hex"), CLIENT_AUTH_RATE_LIMIT_SECRET: randomBytes(32).toString("hex"), CLIENT_AUTH_TOKEN_SECRET: randomBytes(32).toString("hex"),
  TEST_DATABASE_URL: "postgresql://aij_foundation_test:" + randomBytes(32).toString("hex") + "@127.0.0.1:55433/aij_foundation_test" });
test("client-only opt-in requires three independent auth/token keys and protected DB, not unused administrator keys", () => {
  const input = base(), config = environment.loadRuntimeEnvironment(input);
  assert.equal(config.capabilities.clientAuth, true); assert.equal(config.capabilities.auth, false);
  assert.equal(config.clientSessionCookie, "aij_foundation_test_client_session");
  assert.ok(!JSON.stringify(config).includes(input.CLIENT_JWT_SECRET));
  assert.throws(() => environment.loadRuntimeEnvironment({ ...input, DATABASE_ENABLED: "false" }), /requires the database/);
  assert.throws(() => environment.loadRuntimeEnvironment({ ...input, CLIENT_AUTH_ENABLED: "yes" }), /CLIENT_AUTH_ENABLED/);
  assert.doesNotThrow(() => environment.loadRuntimeEnvironment({ CLIENT_AUTH_ENABLED: "false", CLIENT_JWT_SECRET: "template", CLIENT_AUTH_RATE_LIMIT_SECRET: "" }));
});
test("client JWT, rate-limit and one-time-token keys reject missing/template/weak/shared keys and cross-environment identity", () => {
  const input = base();
  for (const key of ["CLIENT_JWT_SECRET", "CLIENT_AUTH_RATE_LIMIT_SECRET", "CLIENT_AUTH_TOKEN_SECRET"]) for (const value of [undefined, "", "dev-client-secret-change-me", "a".repeat(64)]) {
    assert.throws(() => environment.loadRuntimeEnvironment({ ...input, [key]: value }), e => e.message.includes(key) && (!value || !e.message.includes(value)));
  }
  assert.throws(() => environment.loadRuntimeEnvironment({ ...input, CLIENT_AUTH_RATE_LIMIT_SECRET: input.CLIENT_JWT_SECRET }), /reuse/);
  assert.throws(() => environment.loadRuntimeEnvironment({ ...input, CLIENT_AUTH_TOKEN_SECRET: input.CLIENT_JWT_SECRET }), /reuse/);
  assert.throws(() => environment.loadRuntimeEnvironment({ ...input, CLIENT_AUTH_TOKEN_SECRET: input.CLIENT_AUTH_RATE_LIMIT_SECRET }), /reuse/);
  assert.throws(() => environment.loadRuntimeEnvironment({ ...input, AUTH_ENABLED: "true", JWT_SECRET: input.CLIENT_JWT_SECRET }), /reuse/);
  for (const issuer of ["qingqi-api", "urn:aij:other:test:api", "urn:aij:aij-foundation:development:api"]) assert.throws(() => environment.loadRuntimeEnvironment({ ...input, JWT_ISSUER: issuer }));
  assert.throws(() => environment.loadRuntimeEnvironment({ ...input, TEST_DATABASE_URL: "", DATABASE_URL: input.TEST_DATABASE_URL }));
});
test("subtask CLI accepts exact AF-025-A while parent/future tasks fail closed", async () => {
  assert.deepEqual(parseArguments(["--", "AF-025-A"]), { taskId: "AF-025-A", prepareManual: false });
  for (const arg of ["AF-025-AA", "AF-025-a", "AF-025-A;exit 0", "AF-025-A/../B"]) assert.throws(() => parseArguments([arg]));
  for (const task of ["AF-025", "AF-025-B", "AF-034"]) {
    const result = await runTask(task, { log: () => {} }); assert.equal(result.exitCode, 2); assert.equal(result.report.status, "FAIL"); assert.equal(result.report.steps.length, 0);
  }
});
