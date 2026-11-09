import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const paths = [
  "apps/api/src/plugins/aij-ai/ai-knowledge.controller.ts",
  "apps/api/src/plugins/aij-ai/ai-knowledge.dto.ts",
  "apps/api/src/plugins/aij-ai/ai-knowledge.service.ts",
  "scripts/database/migration.mjs",
  "scripts/database/seed.mjs",
  "scripts/runtime-environment.cjs",
  "scripts/verification/auth-support.mjs",
  "scripts/verification/client-auth-fixture.mjs",
  "scripts/verification/g19-document-lifecycle.preflight.mjs",
  "scripts/verification/g19-document-lifecycle.diff-check.mjs",
  "scripts/verification/g19-knowledge-document-lifecycle-http-db.test.mjs",
  "scripts/verification/registry.mjs",
  "docs/execution/AF-112.md",
  "docs/development/AI_KNOWLEDGE_QA.md",
  "docs/current/CURRENT_STATE.md",
  "docs/planning/CODING_QUEUE.json"
];
for (const path of paths) {
  const contents = readFileSync(path, "utf8");
  const lines = contents.split(/\r?\n/);
  assert.equal(lines.some(line => /^(?:<{7} |={7}$|>{7} )/.test(line)), false, `${path}: no merge marker`);
  assert.equal(lines.some(line => /[\t ]+$/.test(line)), false, `${path}: no trailing whitespace`);
}
JSON.parse(readFileSync("docs/planning/CODING_QUEUE.json", "utf8"));
execFileSync("git", ["--no-optional-locks", "diff", "--check", "--", ...paths], {
  stdio: "inherit",
  env: { ...process.env, GIT_INDEX_FILE: ".artifacts/continuous/2026-11-02-to-G19B/AF-112-working.index" }
});
console.log(`AF-112 formatting and queue checks passed for ${paths.length} registered paths using the isolated working index.`);
