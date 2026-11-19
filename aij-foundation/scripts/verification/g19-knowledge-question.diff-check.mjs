import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const paths = [
  "apps/api/prisma/schema.prisma",
  "apps/api/prisma/migrations/20261102010000_ai_knowledge_question/migration.sql",
  "apps/api/src/plugins/aij-ai/ai-execution.service.ts",
  "apps/api/src/plugins/aij-ai/ai-knowledge.controller.ts",
  "apps/api/src/plugins/aij-ai/ai-knowledge.dto.ts",
  "apps/api/src/plugins/aij-ai/ai-knowledge.service.ts",
  "apps/api/src/plugins/aij-ai/ai-runtime.module.ts",
  "apps/api/src/plugins/aij-ai/offline-test-ai-provider.ts",
  "docs/development/AI_KNOWLEDGE_QA.md",
  "docs/execution/AF-110.md",
  "docs/generated/PRISMA_MODEL_OWNERSHIP.csv",
  "docs/planning/CODING_QUEUE.json",
  "scripts/verification/g19-knowledge-question.preflight.mjs",
  "scripts/verification/g19-knowledge-question-schema.test.mjs",
  "scripts/verification/g19-knowledge-question-policy.test.mjs",
  "scripts/verification/g19-knowledge-question-http-db.test.mjs",
  "scripts/verification/g19-knowledge-question.diff-check.mjs",
  "scripts/verification/registry.mjs"
];
for (const path of paths) {
  const content = readFileSync(path, "utf8");
  const lines = content.split(/\r?\n/);
  assert.equal(lines.some(line => /^(?:<{7} |={7}$|>{7} )/.test(line)), false, `${path}: no merge conflict marker`);
  assert.equal(lines.some(line => /[\t ]+$/.test(line)), false, `${path}: no trailing whitespace`);
}
JSON.parse(readFileSync("docs/planning/CODING_QUEUE.json", "utf8"));
execFileSync("git", ["--no-optional-locks", "diff", "--check", "--", ...paths], {
  stdio: "inherit",
  env: { ...process.env, GIT_INDEX_FILE: ".artifacts/continuous/2026-11-01-to-G19/AF-107-working.index" }
});
console.log(`AF-110 diff/format check passed for ${paths.length} registered paths; queue parses as JSON; approved sidecar index used.`);
