import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const queue = JSON.parse(readFileSync("docs/planning/CODING_QUEUE.json", "utf8"));
const baseline = JSON.parse(readFileSync(".artifacts/continuous/2026-11-01-to-G19/AF-098-baseline.json", "utf8"));
const dependencies = ["AF-095", "AF-096", "AF-097"].map(id => queue.taskExecutions.find(item => item.formalTaskId === id));
const task = queue.taskExecutions.find(item => item.formalTaskId === "AF-098");
const history = queue.formalTaskIdAssignmentsHistory.flatMap(entry => Object.entries(entry.ids ?? {}).filter(([alias, id]) => alias === "G16-04" || id === "AF-098"));

assert.equal(process.versions.node.split(".")[0], "24");
assert.equal(execFileSync("git", ["--no-optional-locks", "branch", "--show-current"], { encoding: "utf8" }).trim(), "dev");
assert.equal(execFileSync("git", ["--no-optional-locks", "rev-parse", "HEAD"], { encoding: "utf8" }).trim(), baseline.head);
assert.equal(execFileSync("git", ["--no-optional-locks", "rev-parse", "origin/dev"], { encoding: "utf8" }).trim(), baseline.originDevTrackingRef);
assert.equal(baseline.liveOriginDev, baseline.head);
assert.equal(queue.formalTaskIdAssignments.ids["G16-04"], "AF-098");
assert.equal(history.length, 1, "one unique formal assignment exists for this card");
assert.equal(queue.nextCardCandidate?.alias, "G16-04");
assert.equal(queue.nextCardCandidate?.formalTaskId, "AF-098");
assert.equal(task?.alias, "G16-04");
assert.equal(task?.title, "Provider 缺失、超预算、队列失败和撤权后的失败闭合及恢复");
assert.equal(task?.ownerAcceptance, "PENDING_UNIFIED_OWNER_CHECK");
assert.ok(["IN_PROGRESS", "CODE_VERIFIED", "CODE_VERIFIED_PENDING_GIT_CLOSEOUT", "COMMITTED_AND_PUSHED"].includes(task?.status));
for (const dependency of dependencies) {
  assert.equal(dependency?.status, "CODE_VERIFIED");
  assert.equal(dependency?.git?.status, "COMMITTED_AND_PUSHED");
  assert.equal(dependency?.ownerAcceptance, "PENDING_UNIFIED_OWNER_CHECK");
}
for (const file of [
  "apps/api/src/plugins/aij-ai/ai-execution.service.ts",
  "apps/api/src/plugins/aij-ai/ai-execution-trace.service.ts",
  "apps/api/src/plugins/aij-ai/ai-trace-query.controller.ts",
  "apps/api/src/async-runtime/job.service.ts",
  "apps/api/src/rbac/permissions.service.ts",
  "apps/api/src/plugin-runtime/plugin-runtime-access.service.ts",
  "scripts/verification/runtime-fixture.mjs",
  "scripts/verification/rbac-fixture.mjs",
  "docs/execution/AF-097.md"
]) assert.ok(existsSync(file), "existing owner/dependency source exists: " + file);
assert.equal(task?.dataOwner?.includes("aij-ai"), true);
assert.equal(baseline.formalIdCollisionScan.allocation, "AF-098 uniquely available for G16-04");
console.log("AF-098 preflight: unique assignment, AF-095/096/097 dependencies, owner sources and frozen dev baseline verified");
