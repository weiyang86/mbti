import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createAcceptance, migrate } from "../database/migration.mjs";
import { DatabaseOperationError, repositoryRoot } from "../database/connection.mjs";

// verify:task checks the parent's unique-writer acknowledgement and deliberately
// strips nonessential environment variables from children. Keep that boundary;
// this registered literal argument is the child process's explicit opt-in.
assert.deepEqual(process.argv.slice(2), ["--root-af193"], "Explicit registered root acceptance argument required");
assert.equal(process.cwd(), "/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation");
const directory = join(repositoryRoot, ".artifacts", "af-193", "acceptance", randomUUID());
mkdirSync(directory, { recursive: true, mode: 0o700 });
const write = (name, value) => writeFileSync(join(directory, name), value, { flag: "wx", mode: 0o600 });
let lease;
try {
  lease = await createAcceptance("test", "AF-193");
  for (const action of ["deploy", "status"]) assert.equal((await migrate({ mode: "test", action, acceptanceId: lease.id })).exitCode, 0);
  const result = spawnSync(process.execPath, ["--test", "--test-reporter=tap", "scripts/verification/external-services-live.test.mjs"], {
    cwd: repositoryRoot, env: { ...process.env, AIJ_AF193_ROOT_ACCEPTANCE: "true", DATABASE_ACCEPTANCE_ID: lease.id },
    encoding: "utf8", timeout: 120000, maxBuffer: 4 * 1024 * 1024
  });
  write("http-pg.log", (result.stdout || "") + "\n" + (result.stderr || ""));
  assert.equal(result.error, undefined, "Acceptance child failed; inspect private artifact");
  assert.equal(result.status, 0, "Actual HTTP/PG assertions failed; inspect private artifact");
  assert.match(result.stdout, /# tests 1\b/);
  assert.match(result.stdout, /# pass 1\b/);
  assert.match(result.stdout, /# fail 0\b/);
  assert.match(result.stdout, /# skipped 0\b/);
  const receipt = { task: "AF-193", status: "PASS", acceptanceId: lease.id, database: lease.database, target: "127.0.0.1:55433", realHttpAndPostgreSQL: true, externalVendorCalls: "NOT_RUN_OWNER_DEFERRED", leaseRetained: true };
  write("receipt.json", JSON.stringify(receipt, null, 2) + "\n");
  console.log(JSON.stringify({ ...receipt, evidenceDirectory: directory }));
} catch (error) {
  write("failure.json", JSON.stringify({ task: "AF-193", status: "FAIL", acceptanceId: lease?.id ?? null, reason: error instanceof DatabaseOperationError ? error.message : "Actual acceptance assertion failed; inspect private log", vendorAcceptance: "NOT_RUN" }, null, 2) + "\n");
  console.error(JSON.stringify({ task: "AF-193", status: "FAIL", evidenceDirectory: directory }));
  process.exitCode = 1;
}
