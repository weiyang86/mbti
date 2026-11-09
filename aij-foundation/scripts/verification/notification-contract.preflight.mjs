import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const queue = JSON.parse(readFileSync("docs/planning/CODING_QUEUE.json", "utf8"));
const startQueue = JSON.parse(readFileSync(".artifacts/continuous/2026-10-31-to-G19/queue-start.json", "utf8"));
const ids = { "G14-01": "AF-080", "G14-02": "AF-081", "G14-03": "AF-082" };
const batch = queue.proposedBatches.find((entry) => entry.id === "NEXT-12");
assert.equal(batch?.status, "AUTHORIZED_IN_PROGRESS");
const execution = queue.taskExecutions.find((entry) => entry.formalTaskId === "AF-080");
assert.equal(execution?.alias, "G14-01");
if (execution?.status === "CODE_VERIFIED") {
  assert.ok(batch.executionProgress.completed.includes("G14-01/AF-080"));
  assert.ok(!batch.executionProgress.remaining.includes("G14-01/AF-080"));
} else {
  assert.equal(execution?.status, "IN_PROGRESS");
  assert.equal(queue.activeRun?.currentCard, "G14-01/AF-080");
}
for (const [alias, id] of Object.entries(ids)) {
  assert.equal(batch.formalTaskIds?.[alias], id);
  assert.equal(queue.formalTaskIdAssignmentsHistory.filter((entry) => entry.ids?.[alias] === id).length, 1);
  assert.equal(queue.taskExecutions.filter((entry) => entry.formalTaskId === id).length, 1);
}
assert.ok(existsSync("docs/execution/AF-080.md"), "AF-080 execution record must exist before verification");
assert.deepEqual(queue.ownerAcceptanceRecords, startQueue.ownerAcceptanceRecords, "existing owner acceptance records must remain unchanged");
for (const batchId of ["NEXT-05", "NEXT-10B"]) {
  const dependency = queue.proposedBatches.find((entry) => entry.id === batchId);
  assert.ok(dependency?.status.startsWith("CODE_VERIFIED"), `${batchId} prerequisite must remain code-verified`);
}
console.log("NEXT-12 scope, AF-080..082 unique assignments, and CODE_VERIFIED dependencies are registered.");
