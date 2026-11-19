import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const paths = [
  "apps/api/prisma/schema.prisma",
  "apps/api/prisma/migrations/20261102000000_ai_knowledge_document/migration.sql",
  "apps/api/src/client-workspaces/client-workspace-permissions.ts",
  "apps/api/src/client-auth/client-auth.module.ts",
  "apps/api/src/plugins/aij-ai/ai-knowledge.controller.ts",
  "apps/api/src/plugins/aij-ai/ai-knowledge.dto.ts",
  "apps/api/src/plugins/aij-ai/ai-knowledge.service.ts",
  "apps/api/src/plugins/aij-ai/ai-runtime.module.ts",
  "scripts/database/seed.mjs",
  "docs/development/AI_KNOWLEDGE_QA.md",
  "docs/execution/AF-108.md",
  "docs/generated/PRISMA_MODEL_OWNERSHIP.csv",
  "scripts/database/migration.mjs",
  "scripts/runtime-environment.cjs",
  "scripts/verification/auth-support.mjs",
  "scripts/verification/client-auth-fixture.mjs",
  "scripts/verification/g19-knowledge-http-db.test.mjs",
  "scripts/verification/g19-knowledge.preflight.mjs",
  "scripts/verification/g19-knowledge-schema.test.mjs",
  "scripts/verification/g19-knowledge.diff-check.mjs",
  "scripts/verification/registry.mjs",
  "scripts/verification/workspace-management.test.mjs",
  "docs/planning/CODING_QUEUE.json"
];
for (const path of paths) {
  const content = readFileSync(path, "utf8");
  const lines = content.split(/\r?\n/);
  assert.equal(lines.some(line => /^(?:<{7} |={7}$|>{7} )/.test(line)), false, `${path}: no merge conflict marker`);
  assert.equal(lines.some(line => /[\t ]+$/.test(line)), false, `${path}: no trailing whitespace`);
}
execFileSync("git", ["--no-optional-locks", "diff", "--check", "HEAD", "--", ...paths], { stdio: "inherit" });
JSON.parse(readFileSync("docs/planning/CODING_QUEUE.json", "utf8"));
console.log(`AF-108 diff/format check passed for ${paths.length} registered paths; queue parses as JSON.`);
