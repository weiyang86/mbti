import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { repositoryRoot } from "../database/connection.mjs";

assert.deepEqual(process.argv.slice(2), ["--root-af194"]);
assert.equal(process.cwd(), "/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation");
const directory = join(repositoryRoot, ".artifacts/auto-ai-program-20261105/W15", "AF-194-browser-" + randomUUID());
mkdirSync(directory, { recursive: true, mode: 0o700 });
const child = spawnSync(process.execPath, ["--test", "--test-reporter=tap", "scripts/verification/external-services-browser-live.test.mjs"], {
  cwd: repositoryRoot, env: { ...process.env, AIJ_AF194_ROOT_ACCEPTANCE: "true" },
  encoding: "utf8", maxBuffer: 4 * 1024 * 1024, timeout: 600000
});
writeFileSync(join(directory, "actual-browser.log"), (child.stdout || "") + "\n" + (child.stderr || ""), { flag: "wx", mode: 0o600 });
assert.equal(child.error, undefined, "GUI process error; inspect private browser log");
assert.equal(child.status, 0, "Actual GUI/HTTP/PG scenario failed; inspect private browser log");
for (const pattern of [/# tests 1\b/, /# pass 1\b/, /# fail 0\b/, /# skipped 0\b/]) assert.match(child.stdout, pattern);
console.log(JSON.stringify({ task: "AF-194", status: "PASS", evidenceDirectory: directory, scope: "REAL_PRODUCTION_BROWSER_HTTP_PG_NOT_VENDOR_ACCEPTANCE" }));
