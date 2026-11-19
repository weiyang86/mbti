import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const baselinePath = ".artifacts/continuous/2026-11-02-to-G19/AF-111-baseline.json";
const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
const queue = JSON.parse(readFileSync("docs/planning/CODING_QUEUE.json", "utf8"));
const headQueue = JSON.parse(execFileSync("git", ["--no-optional-locks", "show", "HEAD:docs/planning/CODING_QUEUE.json"], { encoding: "utf8" }));
const execution = id => queue.taskExecutions.find(item => item.formalTaskId === id);
const headExecution = id => headQueue.taskExecutions.find(item => item.formalTaskId === id);
const expectedEntries = [
  "M\tdocs/development/AI_KNOWLEDGE_QA.md",
  "M\tdocs/current/CURRENT_STATE.md",
  "A\tdocs/execution/AF-111.md",
  "M\tdocs/planning/CODING_QUEUE.json",
  "A\tscripts/verification/g19-knowledge-evaluation.cases.mjs",
  "A\tscripts/verification/g19-knowledge-evaluation.cases.test.mjs",
  "A\tscripts/verification/g19-knowledge-evaluation.diff-check.mjs",
  "A\tscripts/verification/g19-knowledge-evaluation-http-db.test.mjs",
  "A\tscripts/verification/g19-knowledge-evaluation.preflight.mjs",
  "M\tscripts/verification/registry.mjs"
].sort();

assert.equal(execFileSync("git", ["--no-optional-locks", "branch", "--show-current"], { encoding: "utf8" }).trim(), "dev");
assert.equal(execFileSync("git", ["--no-optional-locks", "rev-parse", "HEAD"], { encoding: "utf8" }).trim(), baseline.head);
assert.equal(execFileSync("git", ["--no-optional-locks", "rev-parse", "origin/dev"], { encoding: "utf8" }).trim(), baseline.originDevTrackingRef);
assert.equal(baseline.head, "02e004cb6909ea2d4fe7ae97d8c4d4d11f2d5a09");
assert.equal(baseline.liveOriginDevReadback, baseline.head);
assert.equal(createHash("sha256").update(readFileSync(baseline.ordinaryGitIndex.path)).digest("hex"), baseline.ordinaryGitIndex.sha256);
assert.equal(baseline.ordinaryGitIndex.used, false);
assert.equal(baseline.sidecarGitIndex.path, ".artifacts/continuous/2026-11-01-to-G19/AF-107-working.index");

for (const id of ["AF-108", "AF-109", "AF-110"]) {
  const prior = headExecution(id);
  assert.equal(prior?.status, "CODE_VERIFIED", `${id} is code-verified at the frozen HEAD`);
  assert.equal(prior?.git?.status, "COMMITTED_AND_PUSHED", `${id} was committed and pushed`);
}
assert.equal(headQueue.formalTaskIdAssignments.ids["G19-04"], "AF-111");
assert.equal(headQueue.taskExecutions.filter(item => item.formalTaskId === "AF-111").length, 1);
assert.equal(execution("AF-111")?.alias, "G19-04");
assert.equal(execution("AF-111")?.title, "20例合成知识问答评测与跨工作区真实HTTP回归");
assert.equal(execution("AF-111")?.ownerAcceptance, "PENDING_UNIFIED_OWNER_CHECK");
assert.match(execution("AF-111")?.dataOwner ?? "", /aij-ai.*ClientWorkspace.*AsyncRuntime.*SecretRef.*AiExecutionTraceService/);
assert.ok(["IN_PROGRESS", "CODE_VERIFIED"].includes(execution("AF-111")?.status));
if (execution("AF-111")?.status === "CODE_VERIFIED") assert.equal(execution("AF-111")?.verification?.status, "PASS");
for (const id of ["AF-108", "AF-109", "AF-110"]) assert.equal(execution(id)?.ownerAcceptance, "PENDING_UNIFIED_OWNER_CHECK");

const sidecarEnv = { ...process.env, GIT_INDEX_FILE: baseline.sidecarGitIndex.path };
const sidecarHash = createHash("sha256").update(readFileSync(baseline.sidecarGitIndex.path)).digest("hex");
const staged = execFileSync("git", ["--no-optional-locks", "diff", "--cached", "--name-status", "HEAD"], { encoding: "utf8", env: sidecarEnv }).trim().split("\n").filter(Boolean).sort();
if (staged.length === 0) assert.equal(sidecarHash, baseline.sidecarGitIndex.sha256);
else assert.deepEqual(staged, expectedEntries);

assert.equal(queue.proposedBatches.find(item => item.id === "NEXT-19A")?.currentCard, "G19-04/AF-111");
assert.equal(queue.proposedBatches.find(item => item.id === "NEXT-19A")?.executionProgress?.liveDeepSeek, false);
assert.equal(queue.proposedBatches.find(item => item.id === "NEXT-19A")?.executionProgress?.liveCustomerData, false);
assert.equal(queue.proposedBatches.find(item => item.id === "NEXT-19A")?.executionProgress?.paidRequests, false);
console.log(JSON.stringify({ task: "AF-111", branch: "dev", head: baseline.head, dependencies: ["AF-108", "AF-109", "AF-110"], ordinaryIndexUnchanged: true, sidecarStagedPaths: staged.length, liveDeepSeek: false, liveCustomerData: false, paidRequests: false }));
