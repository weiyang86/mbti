import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { taskRegistry } from "./registry.mjs";

const paths = [
  "apps/web/app/client/knowledge/questions/page.tsx",
  "apps/web/app/components/client-knowledge-questions-page.tsx",
  "apps/web/app/components/client-knowledge-questions.ts",
  "apps/web/app/components/client-workspaces.tsx",
  "apps/web/app/globals.css",
  "scripts/database/migration.mjs",
  "scripts/database/seed.mjs",
  "scripts/runtime-environment.cjs",
  "scripts/verification/auth-support.mjs",
  "scripts/verification/client-auth-fixture.mjs",
  "scripts/verification/g19-knowledge-questions-web-http-db.test.mjs",
  "scripts/verification/g19-knowledge-questions.preflight.mjs",
  "scripts/verification/g19-knowledge-questions.diff-check.mjs",
  "scripts/verification/registry.mjs",
  "docs/execution/AF-113.md",
  "docs/execution/AF-114.md",
  "docs/development/AI_KNOWLEDGE_QA.md",
  "docs/current/CURRENT_STATE.md",
  "docs/planning/CODING_QUEUE.json"
];
const task = taskRegistry["AF-114"];
assert.equal(task?.title, "客户 Workspace 知识问答页");
assert.equal(task?.steps?.some(step => step.testFiles?.includes("scripts/verification/g19-knowledge-questions-web-http-db.test.mjs")), true);
const databaseTest = task.steps.find(step => step.testFiles?.includes("scripts/verification/g19-knowledge-questions-web-http-db.test.mjs"));
assert.equal(databaseTest.effects.testDatabase, true);
assert.ok(databaseTest.effects.services.some(service => service.includes("127.0.0.1")));
assert.equal(databaseTest.effects.uniqueWriter, false);
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
console.log(`AF-114 JSON/registration/format checks passed for ${paths.length} paths with the isolated working index.`);
