import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import pg from "pg";
import test from "node:test";
import { seedArguments, seedDatabase, validateInitialPassword, SeedError } from "../database/seed.mjs";
import { repositoryRoot } from "../database/connection.mjs";

const secret = "T7-" + randomBytes(24).toString("hex");
const url = mode => "postgresql://aij_foundation_" + mode + ":" + secret + "@127.0.0.1:" + (mode === "dev" ? 55432 : 55433) + "/aij_foundation_" + mode;
test("seed CLI requires an explicit mode, one optional separator and only declared flags", () => {
  assert.deepEqual(seedArguments(["--", "test", "--generate-credentials", "--acceptance", "a".repeat(16)]), { mode: "test", acceptanceId: "a".repeat(16), generateCredentials: true });
  assert.deepEqual(seedArguments(["test", "--admin-users"]), { mode: "test", acceptanceId: undefined, generateCredentials: false, adminUsers: true });
  assert.throws(() => seedArguments(["test", "--admin-users", "--admin-users"]));
  assert.deepEqual(seedArguments(["test", "--rbac-management"]), { mode: "test", acceptanceId: undefined, generateCredentials: false, rbacManagement: true });
  assert.throws(() => seedArguments(["test", "--rbac-management", "--rbac-management"]));
  assert.deepEqual(seedArguments(["test", "--files"]), { mode: "test", acceptanceId: undefined, generateCredentials: false, fileManagement: true });
  assert.throws(() => seedArguments(["test", "--files", "--files"]));
  assert.deepEqual(seedArguments(["test", "--runtime"]), { mode: "test", acceptanceId: undefined, generateCredentials: false, runtimeManagement: true });
  assert.throws(() => seedArguments(["test", "--runtime", "--runtime"]));
  assert.deepEqual(seedArguments(["test", "--plugin-management"]), { mode: "test", acceptanceId: undefined, generateCredentials: false, pluginManagement: true });
  assert.throws(() => seedArguments(["test", "--plugin-management", "--plugin-management"]));
  assert.deepEqual(seedArguments(["test", "--client-session-management"]), { mode: "test", acceptanceId: undefined, generateCredentials: false, clientSessionManagement: true });
  assert.throws(() => seedArguments(["test", "--client-session-management", "--client-session-management"]));
  assert.deepEqual(seedArguments(["dev"]), { mode: "dev", acceptanceId: undefined, generateCredentials: false });
  for (const args of [[], ["both"], ["production"], ["test", "--", "--"], ["test", "reset"], ["test", "--password", secret], ["test", "--acceptance"], ["test", "--acceptance", "../old"], ["test", "--generate-credentials", "--generate-credentials"], ["test", "--acceptance", "a".repeat(16), "--acceptance", "b".repeat(16)]]) assert.throws(() => seedArguments(args));
});
test("initial credential policy rejects missing, templates, weak and bcrypt-truncated inputs without exposing their values", () => {
  assert.ok(validateInitialPassword(secret) === secret);
  for (const value of [undefined, "", "admin123", "a".repeat(32), "dev-admin-123456", "Replace-This-Template-2026!", "Password-Example-123456789!", "T7-" + "x".repeat(70), "T7-" + "密".repeat(24), "T7-" + "x".repeat(25) + "\n"]) {
    assert.throws(() => validateInitialPassword(value), e => e instanceof SeedError && e.code === "CREDENTIAL_INVALID" && (!value || !e.message.includes(value)));
  }
});
for (const [name, mode, extra] of [
  ["test never falls back to dev", "test", { TEST_DATABASE_URL: "", DATABASE_URL: url("dev") }],
  ["dev URL cannot act as test", "test", { TEST_DATABASE_URL: url("dev") }],
  ["test URL cannot act as dev", "dev", { DATABASE_URL: url("test") }],
  ["test runtime cannot select dev", "dev", { NODE_ENV: "test", DATABASE_URL: url("dev") }],
  ["old port is rejected", "test", { TEST_DATABASE_URL: url("test").replace("55433", "15435") }],
  ["external host is rejected", "test", { TEST_DATABASE_URL: url("test").replace("127.0.0.1", "example.invalid") }],
  ["template DB password is rejected", "test", { TEST_DATABASE_URL: url("test").replace(secret, "replace-this-template-password-1234567890") }],
  ["missing initial input is rejected", "test", { TEST_DATABASE_URL: url("test"), AIJ_INITIAL_ADMIN_PASSWORD: "" }],
  ["template initial input is rejected", "test", { TEST_DATABASE_URL: url("test"), AIJ_INITIAL_ADMIN_PASSWORD: "ChangeMe-Template-123456789!" }],
  ["wrong product is rejected", "test", { TEST_DATABASE_URL: url("test"), PROJECT_ID: "qingqi-consultant" }]
]) {
  test("seed refuses before connection: " + name, async () => {
    const connect = pg.Client.prototype.connect;
    let attempts = 0;
    pg.Client.prototype.connect = function () { attempts++; throw new Error("Forbidden test connection"); };
    try { await assert.rejects(seedDatabase({ mode }, { PATH: process.env.PATH, HOME: process.env.HOME, AIJ_INITIAL_ADMIN_PASSWORD: secret, ...extra })); }
    finally { pg.Client.prototype.connect = connect; }
    assert.equal(attempts, 0);
    const child = spawnSync(process.execPath, ["scripts/db-seed.mjs", mode], { cwd: repositoryRoot, encoding: "utf8", timeout: 10000, env: { PATH: process.env.PATH, HOME: process.env.HOME, AIJ_INITIAL_ADMIN_PASSWORD: secret, ...extra } });
    assert.equal(child.status, 2); assert.equal(JSON.parse(child.stderr).status, "REJECTED");
    assert.ok(!(child.stdout + child.stderr).includes(secret)); assert.ok(!/\$2[aby]\$\d\d\$/.test(child.stdout + child.stderr), "No password hash in output");
  });
}
test("unknown/missing acceptance cannot authorize Seed or a future task", async () => {
  for (const task of ["AF-025", "F03", ""]) {
    const { createAcceptance } = await import("../database/migration.mjs");
    await assert.rejects(createAcceptance("test", task));
  }
  const child = spawnSync(process.execPath, ["scripts/db-seed.mjs", "test", "--acceptance", "a".repeat(16), "--generate-credentials"], { cwd: repositoryRoot, encoding: "utf8", timeout: 10000, env: { PATH: process.env.PATH, HOME: process.env.HOME } });
  assert.equal(child.status, 2); assert.ok(!/\$2[aby]\$\d\d\$/.test(child.stdout + child.stderr), "No password hash in output");
});
