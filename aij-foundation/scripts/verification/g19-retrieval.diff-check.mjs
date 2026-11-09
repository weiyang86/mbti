import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { taskRegistry } from "./registry.mjs";

const queue = JSON.parse(readFileSync("docs/planning/CODING_QUEUE.json", "utf8"));
const task = queue.taskExecutions.find(item => item.formalTaskId === "AF-109");
const registration = taskRegistry["AF-109"];
assert.equal(task?.alias, "G19-02");
assert.equal(task?.ownerAcceptance, "PENDING_UNIFIED_OWNER_CHECK");
assert.ok(registration, "AF-109 has an explicit verification registry entry");
assert.ok(registration.prerequisites.length >= 2);
const tests = registration.steps.filter(item => item.kind === "node-test");
assert.ok(tests.length >= 2);
assert.ok(tests.every(item => item.testFiles?.length > 0));
for (const entry of [...registration.prerequisites, ...registration.steps]) {
  for (const file of entry.files) assert.ok(existsSync(file), `registered evidence path exists: ${file}`);
  for (const file of entry.testFiles ?? []) assert.ok(existsSync(file), `registered test exists: ${file}`);
}

const trackedCardFiles = [
  "apps/api/src/plugins/aij-ai/ai-knowledge.controller.ts",
  "apps/api/src/plugins/aij-ai/ai-knowledge.dto.ts",
  "apps/api/src/plugins/aij-ai/ai-knowledge.service.ts",
  "apps/api/src/plugins/aij-ai/ai-knowledge-retrieval.ts",
  "scripts/verification/g19-retrieval-policy.test.mjs",
  "scripts/verification/g19-retrieval-http-db.test.mjs",
  "scripts/verification/g19-retrieval.preflight.mjs",
  "scripts/verification/g19-retrieval.diff-check.mjs",
  "scripts/verification/registry.mjs",
  "docs/development/AI_KNOWLEDGE_QA.md",
  "docs/execution/AF-109.md"
];
const conflictMarkers = ["<".repeat(7), "=".repeat(7) + "\n", ">".repeat(7)];
for (const file of trackedCardFiles) {
  assert.ok(existsSync(file), `AF-109 file exists: ${file}`);
  const source = readFileSync(file, "utf8");
  assert.equal(conflictMarkers.some(marker => source.includes(marker)), false, `${file} has no merge-conflict marker`);
  for (const [index, line] of source.split("\n").entries()) assert.equal(/\s+$/.test(line), false, `${file}:${index + 1} has no trailing whitespace`);
}
execFileSync("git", ["--no-optional-locks", "diff", "--check", "HEAD", "--", ...trackedCardFiles.slice(0, 7), trackedCardFiles[9], trackedCardFiles[10]], { stdio: "inherit" });
console.log("AF-109 registered paths, test files, selected diff and whitespace/conflict checks passed.");
