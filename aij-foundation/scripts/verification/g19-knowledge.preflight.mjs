import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const queue = JSON.parse(readFileSync("docs/planning/CODING_QUEUE.json", "utf8"));
const baselinePath = ".artifacts/continuous/2026-11-02-to-G19/G19-B1-baseline-2026-11-02.json";
const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
const plan = JSON.parse(readFileSync(".artifacts/continuous/2026-11-02-to-G19/G19-B1-plan.json", "utf8"));
const assignment = queue.formalTaskIdAssignments;
const batch = queue.proposedBatches.find(item => item.id === "NEXT-19A");
const execution = queue.taskExecutions.find(item => item.formalTaskId === "AF-108");
const migration = readFileSync("apps/api/prisma/migrations/20261102000000_ai_knowledge_document/migration.sql", "utf8");

assert.equal(execFileSync("git", ["--no-optional-locks", "branch", "--show-current"], { encoding: "utf8" }).trim(), "dev");
assert.equal(execFileSync("git", ["--no-optional-locks", "rev-parse", "HEAD"], { encoding: "utf8" }).trim(), baseline.head);
assert.equal(execFileSync("git", ["--no-optional-locks", "rev-parse", "origin/dev"], { encoding: "utf8" }).trim(), baseline.originDevTracking);
assert.equal(plan.baseline.head, baseline.head);
assert.equal(plan.baseline.originDevTracking, baseline.originDevTracking);
assert.equal(plan.baseline.ordinaryIndexSha256, baseline.ordinaryIndexSha256);
assert.equal(plan.baseline.sidecarIndexSha256AtStart, "50156f0f2af1991412854accce903fc3a23f83379754ad8e63b1635379ba131e");
assert.equal(plan.batch, "NEXT-19A");
assert.deepEqual(plan.cards.map(card => [card.alias, card.formalTaskId]), [
  ["G19-01", "AF-108"], ["G19-02", "AF-109"], ["G19-03", "AF-110"], ["G19-04", "AF-111"]
]);
assert.deepEqual(assignment.ids, { "G19-01": "AF-108", "G19-02": "AF-109", "G19-03": "AF-110", "G19-04": "AF-111" });
assert.equal(queue.taskExecutions.filter(item => item.formalTaskId === "AF-108").length, 1);
assert.equal(execution?.alias, "G19-01");
assert.ok(["IN_PROGRESS", "CODE_VERIFIED"].includes(execution?.status));
assert.equal(execution?.ownerAcceptance, "PENDING_UNIFIED_OWNER_CHECK");
assert.ok(["AUTHORIZED_IN_PROGRESS", "CODE_VERIFIED_OWNER_CHECK_PENDING"].includes(batch?.status));
assert.equal(batch?.formalTaskIds?.["G19-01"], "AF-108");
const af107Commits = execFileSync("git", ["--no-optional-locks", "log", "--format=%H", "--grep=合成支付轨迹对账"], { encoding: "utf8" }).trim().split("\n").filter(Boolean);
assert.ok(af107Commits.length > 0, "AF-107 commit is present in local Git history");
assert.ok(af107Commits.some(commit => {
  try { execFileSync("git", ["--no-optional-locks", "merge-base", "--is-ancestor", commit, baseline.head]); return true; }
  catch { return false; }
}), "AF-107 commit is an ancestor of the frozen baseline HEAD");
assert.equal(execution?.dataOwner, "apps/api/src/plugins/aij-ai owns knowledge documents, retrieval, and question results; ClientWorkspace owns authenticated tenant membership and permission context; AsyncRuntime owns durable jobs/attempts; SecretRef and AiExecutionTraceService remain the only credential and trace/cost owners.");
assert.equal(batch?.executionProgress?.liveDeepSeek, false);
assert.equal(batch?.executionProgress?.liveCustomerData, false);
assert.equal(batch?.executionProgress?.paidRequests, false);
for (const forbidden of ["company_profile", "diagnosis", "business_order", "merchant_credential", "customer_email"]) {
  assert.equal(migration.toLowerCase().includes(forbidden), false, `migration excludes ${forbidden}`);
}
assert.ok(queue.ownerAcceptanceRecords?.some(item => item.scope?.includes("AF-025-A") && item.status === "ACCEPTED_BY_OWNER_2026-10-30"));
assert.match(readFileSync("docs/execution/G19-00.md", "utf8"), /首次 G19 评测全程累计上限 10 元/);
console.log("AF-108 baseline, G19-00/G18-05 dependencies, one-owner boundary, ID assignment, no-live-provider policy and pending owner-acceptance status verified.");
