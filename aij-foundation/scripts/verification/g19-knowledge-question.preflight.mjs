import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const queue = JSON.parse(readFileSync("docs/planning/CODING_QUEUE.json", "utf8"));
const execution = id => queue.taskExecutions.find(item => item.formalTaskId === id);
const baseline = JSON.parse(readFileSync(".artifacts/continuous/2026-11-02-to-G19/AF-110-baseline.json", "utf8"));
const assignment = queue.formalTaskIdAssignments;
const batch = queue.proposedBatches.find(item => item.id === "NEXT-19A");
const ordinaryIndex = baseline.ordinaryGitIndex;
const sidecarIndex = baseline.sidecarGitIndex;

assert.equal(execFileSync("git", ["--no-optional-locks", "branch", "--show-current"], { encoding: "utf8" }).trim(), "dev");
assert.equal(execFileSync("git", ["--no-optional-locks", "rev-parse", "HEAD"], { encoding: "utf8" }).trim(), baseline.head);
assert.equal(execFileSync("git", ["--no-optional-locks", "rev-parse", "origin/dev"], { encoding: "utf8" }).trim(), baseline.originDevTrackingRef);
const ordinaryIndexHash = createHash("sha256").update(readFileSync(".git/index")).digest("hex");
assert.equal(ordinaryIndexHash, ordinaryIndex.sha256);
assert.equal(ordinaryIndex.used, false);
assert.equal(sidecarIndex.path, ".artifacts/continuous/2026-11-01-to-G19/AF-107-working.index");
const sidecarHash = createHash("sha256").update(readFileSync(sidecarIndex.path)).digest("hex");
const expectedCardEntries = [
  "A\tapps/api/prisma/migrations/20261102010000_ai_knowledge_question/migration.sql",
  "M\tapps/api/prisma/schema.prisma",
  "M\tapps/api/src/plugins/aij-ai/ai-execution.service.ts",
  "M\tapps/api/src/plugins/aij-ai/ai-knowledge.controller.ts",
  "M\tapps/api/src/plugins/aij-ai/ai-knowledge.dto.ts",
  "M\tapps/api/src/plugins/aij-ai/ai-knowledge.service.ts",
  "M\tapps/api/src/plugins/aij-ai/ai-runtime.module.ts",
  "A\tapps/api/src/plugins/aij-ai/offline-test-ai-provider.ts",
  "M\tdocs/development/AI_KNOWLEDGE_QA.md",
  "A\tdocs/execution/AF-110.md",
  "M\tdocs/generated/PRISMA_MODEL_OWNERSHIP.csv",
  "M\tdocs/planning/CODING_QUEUE.json",
  "A\tscripts/verification/g19-knowledge-question-http-db.test.mjs",
  "A\tscripts/verification/g19-knowledge-question-policy.test.mjs",
  "A\tscripts/verification/g19-knowledge-question-schema.test.mjs",
  "A\tscripts/verification/g19-knowledge-question.diff-check.mjs",
  "A\tscripts/verification/g19-knowledge-question.preflight.mjs",
  "M\tscripts/verification/registry.mjs",
].sort();
const sidecarEnv = { ...process.env, GIT_INDEX_FILE: sidecarIndex.path };
const stagedCardEntries = execFileSync(
  "git",
  ["--no-optional-locks", "diff", "--cached", "--name-status", "HEAD"],
  { encoding: "utf8", env: sidecarEnv },
)
  .trim()
  .split("\n")
  .filter(Boolean)
  .sort();
if (stagedCardEntries.length === 0) {
  assert.equal(sidecarHash, sidecarIndex.sha256);
} else {
  assert.deepEqual(stagedCardEntries, expectedCardEntries);
}

assert.equal(assignment.ids["G19-03"], "AF-110");
assert.equal(queue.taskExecutions.filter(item => item.formalTaskId === "AF-110").length, 1);
assert.equal(execution("AF-110")?.alias, "G19-03");
assert.ok(["IN_PROGRESS", "CODE_VERIFIED"].includes(execution("AF-110")?.status));
if (execution("AF-110")?.status === "CODE_VERIFIED") {
  assert.equal(execution("AF-110")?.verification?.status, "PASS");
}
assert.equal(execution("AF-110")?.ownerAcceptance, "PENDING_UNIFIED_OWNER_CHECK");
for (const id of ["AF-108", "AF-109"]) {
  assert.equal(execution(id)?.status, "CODE_VERIFIED", `${id} dependency code verified`);
  assert.equal(execution(id)?.git?.status, "COMMITTED_AND_PUSHED", `${id} dependency committed and pushed`);
  assert.equal(execution(id)?.ownerAcceptance, "PENDING_UNIFIED_OWNER_CHECK", `${id} owner acceptance remains pending`);
}
assert.equal(batch?.formalTaskIds?.["G19-03"], "AF-110");
assert.equal(batch?.executionProgress?.liveDeepSeek, false);
assert.equal(batch?.executionProgress?.liveCustomerData, false);
assert.equal(batch?.executionProgress?.paidRequests, false);
assert.match(execution("AF-110")?.dataOwner ?? "", /aij-ai.*ClientWorkspace.*AsyncRuntime.*SecretRef.*AiExecutionTraceService/);
console.log("AF-110 baseline, ordinary/sidecar index hashes, AF-108/109 dependencies, unique formal ID, owner boundary, offline-only and pending owner-acceptance states verified.");
