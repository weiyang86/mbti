import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const paths = [
  "apps/web/app/client/knowledge/page.tsx",
  "apps/web/app/components/client-knowledge-manager.tsx",
  "apps/web/app/components/client-knowledge-api.ts",
  "apps/web/app/components/client-knowledge-api.ts",
  "apps/web/app/components/client-workspaces.tsx",
  "scripts/database/migration.mjs",
  "scripts/database/seed.mjs",
  "scripts/runtime-environment.cjs",
  "scripts/verification/auth-support.mjs",
  "scripts/verification/client-auth-fixture.mjs",
  "scripts/verification/g19-knowledge-management-web-http-db.test.mjs",
  "scripts/verification/g19-knowledge-manager.preflight.mjs",
  "scripts/verification/g19-knowledge-manager.diff-check.mjs",
  "scripts/verification/registry.mjs",
  "docs/execution/AF-113.md",
  "docs/development/AI_KNOWLEDGE_QA.md",
  "docs/current/CURRENT_STATE.md",
  "docs/planning/CODING_QUEUE.json"
];
for (const path of paths) {
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  assert.equal(lines.some(line => /^(?:<{7} |={7}$|>{7} )/.test(line)), false, `${path}: no merge marker`);
  assert.equal(lines.some(line => /[\t ]+$/.test(line)), false, `${path}: no trailing whitespace`);
}
JSON.parse(readFileSync("docs/planning/CODING_QUEUE.json", "utf8"));
execFileSync("git", ["--no-optional-locks", "diff", "--check", "--", ...paths], {
  stdio: "inherit",
  env: { ...process.env, GIT_INDEX_FILE: ".artifacts/continuous/2026-11-02-to-G19B/AF-112-working.index" }
});
console.log(`AF-113 formatting and queue checks passed for ${paths.length} registered paths using the isolated working index.`);
