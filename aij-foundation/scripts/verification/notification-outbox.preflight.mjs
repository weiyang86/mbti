import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const queue = JSON.parse(readFileSync("docs/planning/CODING_QUEUE.json", "utf8"));
const snapshotPath = queue.activeRun.scopeSnapshot;
const snapshot = readFileSync(snapshotPath);
const start = JSON.parse(snapshot);
const baseline = JSON.parse(readFileSync(".artifacts/continuous/2026-10-31-to-G19/AF-081-baseline.json", "utf8"));
assert.equal(createHash("sha256").update(snapshot).digest("hex"), queue.activeRun.scopeSnapshotSha256);
assert.equal(queue.status, "CONTINUOUS_TO_G19_IN_PROGRESS");
assert.equal(queue.activeRun.batch, "NEXT-12");
assert.equal(queue.activeRun.writer, "Codex");
assert.equal(queue.formalTaskIdAssignments.ids["G14-02"], "AF-081");
assert.equal(queue.formalTaskIdAssignmentsHistory.filter(entry => entry.ids?.["G14-02"] === "AF-081").length, 1);
assert.equal(queue.taskExecutions.filter(entry => entry.formalTaskId === "AF-081").length, 1);
const prerequisite = queue.taskExecutions.find(entry => entry.formalTaskId === "AF-080");
assert.equal(prerequisite?.status, "CODE_VERIFIED");
assert.equal(prerequisite?.verification?.status, "CODE_VERIFIED");
assert.equal(prerequisite?.git?.remoteReadbackSha, prerequisite?.git?.commitSha);
const execution = queue.taskExecutions.find(entry => entry.formalTaskId === "AF-081");
assert.ok(["IN_PROGRESS", "CODE_VERIFIED"].includes(execution?.status));
if (execution.status === "IN_PROGRESS") assert.equal(queue.activeRun.currentCard, "G14-02/AF-081");
else assert.ok(queue.proposedBatches.find(batch => batch.id === "NEXT-12")?.executionProgress.completed.includes("G14-02/AF-081"));
assert.equal(baseline.taskId, "AF-081");
assert.equal(baseline.branch, "dev");
assert.equal(baseline.head, execFileSync("git", ["--no-optional-locks", "rev-parse", "HEAD"], { encoding: "utf8" }).trim());
assert.equal(baseline.ownerAcceptance, "PENDING_UNIFIED_OWNER_CHECK");
assert.deepEqual(queue.ownerAcceptanceRecords, start.ownerAcceptanceRecords, "prior acceptance state must remain unchanged");
for (const dependency of ["NEXT-05", "NEXT-10B"]) {
  assert.ok(queue.proposedBatches.find(batch => batch.id === dependency)?.status.startsWith("CODE_VERIFIED"));
}
console.log("AF-081 assignment, frozen scope, AF-080 dependency, current baseline and owner acceptance are intact.");
