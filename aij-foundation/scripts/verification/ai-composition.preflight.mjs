import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const queue = JSON.parse(readFileSync("docs/planning/CODING_QUEUE.json", "utf8"));
const baseline = JSON.parse(readFileSync(".artifacts/continuous/2026-11-01-to-G19/AF-097-baseline.json", "utf8"));
const assignment = queue.formalTaskIdAssignments?.ids;
const historyMatches = (queue.formalTaskIdAssignmentsHistory ?? []).flatMap(entry =>
  Object.entries(entry.ids ?? {}).filter(([alias, formalId]) => alias === "G16-03" || formalId === "AF-097")
);
const card = queue.taskExecutions?.find(entry => entry.formalTaskId === "AF-097");
const dependencies = ["AF-095", "AF-096"].map(id => queue.taskExecutions?.find(entry => entry.formalTaskId === id));

assert.equal(process.versions.node.split(".")[0], "24");
assert.equal(execFileSync("git", ["--no-optional-locks", "branch", "--show-current"], { encoding: "utf8" }).trim(), "dev");
assert.equal(execFileSync("git", ["--no-optional-locks", "rev-parse", "HEAD"], { encoding: "utf8" }).trim(), baseline.head);
assert.equal(execFileSync("git", ["--no-optional-locks", "rev-parse", "origin/dev"], { encoding: "utf8" }).trim(), baseline.originDevTrackingRef);
assert.equal(baseline.head, "c5309dc941b9241cc97373d0992fc397d4b3c876");
assert.equal(baseline.branch, "dev");
assert.equal(assignment?.["G16-03"], "AF-097");
assert.equal(historyMatches.length, 1, "G16-03/AF-097 has one assignment history entry and no reuse");
assert.equal(card?.alias, "G16-03");
assert.equal(card?.title, "角色拒绝、预算限制、插件关停和端到端组合回归");
assert.equal(card?.ownerAcceptance, "PENDING_UNIFIED_OWNER_CHECK");
assert.ok(["IN_PROGRESS", "CODE_VERIFIED"].includes(card?.status));
assert.equal(dependencies.length, 2);
for (const dependency of dependencies) {
  assert.equal(dependency?.status, "CODE_VERIFIED");
  assert.equal(dependency?.git?.status, "COMMITTED_AND_PUSHED");
  assert.equal(dependency?.ownerAcceptance, "PENDING_UNIFIED_OWNER_CHECK");
}
for (const file of ["apps/api/src/plugins/aij-ai/ai-execution.service.ts", "apps/api/src/plugins/aij-ai/ai-execution-trace.service.ts", "apps/api/src/plugins/aij-ai/ai-trace-query.controller.ts", "apps/api/src/async-runtime/job.service.ts", "apps/api/src/rbac/permissions.service.ts", "apps/api/src/plugin-runtime/plugin-runtime-access.service.ts", "scripts/verification/runtime-fixture.mjs", "scripts/verification/rbac-fixture.mjs"]) {
  assert.ok(existsSync(file), "owner source exists: " + file);
}
assert.equal(baseline.dataOwner, "aij-ai owns model execution and AiExecutionTrace; AsyncRuntime owns durable RuntimeJob/attempt; RBAC owns server permission decisions; project plugin lifecycle gate remains server-side; test uses only an offline synthetic Provider.");
console.log("AF-097 preflight: unique assignment, pushed AF-095/096 dependencies, owner boundaries and frozen dev baseline verified");
