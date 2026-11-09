import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { migrationArguments, migrationPath } from "../database/migration.mjs";
import { repositoryRoot } from "../database/connection.mjs";

test("migrate parser permits only explicit mode plus deploy/status and one optional separator", () => {
  assert.deepEqual(migrationArguments(["--", "test", "deploy"]), { mode: "test", action: "deploy", acceptanceId: undefined });
  assert.deepEqual(migrationArguments(["dev", "status", "--acceptance", "a".repeat(16)]), { mode: "dev", action: "status", acceptanceId: "a".repeat(16) });
  for (const args of [[], ["deploy"], ["test", "reset"], ["test", "dev"], ["test", "resolve"], ["test", "deploy", "--", "--"], ["test", "deploy", "--schema", "elsewhere"], ["test", "deploy", "--acceptance"], ["production", "deploy"]]) assert.throws(() => migrationArguments(args));
});

test("initial SQL is independently bounded to 21 target tables/four enums and contains no data/history import", () => {
  const sql = readFileSync(migrationPath, "utf8");
  assert.equal([...sql.matchAll(/CREATE TABLE /g)].length, 21);
  assert.equal([...sql.matchAll(/CREATE TYPE /g)].length, 4);
  assert.equal([...sql.matchAll(/ADD CONSTRAINT .* FOREIGN KEY /g)].length, 13);
  assert.doesNotMatch(sql, /^\s*(?:DROP|TRUNCATE|INSERT|COPY|DELETE|UPDATE)\b|qingqi|CompanyProfile|SiteMedia|15435|_prisma_migrations/im);
});

const secret = randomBytes(32).toString("hex");
const url = (mode) => "postgresql://aij_foundation_" + mode + ":" + secret + "@127.0.0.1:" + (mode === "dev" ? 55432 : 55433) + "/aij_foundation_" + mode;
for (const [name, mode, extra] of [
  ["test has no dev fallback", "test", { TEST_DATABASE_URL: "", DATABASE_URL: url("dev") }],
  ["test refuses dev URL", "test", { TEST_DATABASE_URL: url("dev") }],
  ["dev refuses test URL", "dev", { DATABASE_URL: url("test") }],
  ["test runtime refuses dev selection", "dev", { NODE_ENV: "test", DATABASE_URL: url("dev") }],
  ["old database port", "test", { TEST_DATABASE_URL: url("test").replace("55433", "15435") }],
  ["external host", "test", { TEST_DATABASE_URL: url("test").replace("127.0.0.1", "example.invalid") }],
  ["template password", "test", { TEST_DATABASE_URL: url("test").replace(secret, "replace-this-template-password-1234567890") }]
]) {
  test("CLI rejects " + name + " before a connector or Prisma runs, with no password output", () => {
    const child = spawnSync(process.execPath, ["scripts/db-migrate.mjs", mode, "deploy"], { cwd: repositoryRoot, encoding: "utf8", timeout: 10000, env: { PATH: process.env.PATH, HOME: process.env.HOME, ...extra } });
    assert.equal(child.status, 2); const output = child.stdout + child.stderr;
    assert.ok(!output.includes(secret)); assert.ok(!output.includes("replace-this-template-password-1234567890"));
    const result = JSON.parse(child.stderr.trim()); assert.equal(result.status, "REJECTED");
    assert.equal(result.evidenceFile, undefined); assert.equal(result.connectionAttempted, undefined);
  });
}

test("missing/cross-path acceptance records cannot authorize a different database", () => {
  for (const id of ["a".repeat(16), "../../old", "", "A".repeat(16)]) {
    const child = spawnSync(process.execPath, ["scripts/db-check.mjs", "test", "--config-only", "--acceptance", id], { cwd: repositoryRoot, encoding: "utf8", timeout: 10000, env: { PATH: process.env.PATH, HOME: process.env.HOME } });
    assert.equal(child.status, 2); assert.equal(JSON.parse(child.stderr).connectionAttempted, false);
  }
});
