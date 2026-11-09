import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import process from "node:process";
import { URL, fileURLToPath } from "node:url";

const apiRoot = fileURLToPath(new URL("../", import.meta.url));
const childEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  key !== "NODE_TEST_CONTEXT" && key !== "NODE_OPTIONS"));

test("the registered task runner executes the real typed notification contract suite", (context) => {
  const result = spawnSync(process.execPath, [
    "--test", "-r", "ts-node/register", "--test-reporter=tap", "test/notification-contract.test.ts"
  ], { cwd: apiRoot, encoding: "utf8", timeout: 50_000, maxBuffer: 1024 * 1024, env: childEnv });

  context.diagnostic(result.stdout ?? "");
  if (result.stderr) context.diagnostic(result.stderr);
  assert.ifError(result.error);
  assert.equal(result.status, 0, "typed notification contract test process must exit successfully");
  assert.match(result.stdout, /# tests 6\b/);
  assert.match(result.stdout, /# pass 6\b/);
  assert.match(result.stdout, /# fail 0\b/);
  assert.match(result.stdout, /# skipped 0\b/);
  assert.match(result.stdout, /# todo 0\b/);
});
