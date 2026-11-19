import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const queue = JSON.parse(readFileSync("docs/planning/CODING_QUEUE.json", "utf8"));
const task = queue.taskExecutions.filter(entry => entry.formalTaskId === "AF-087");
assert.equal(task.length, 1, "AF-087 is uniquely assigned");
assert.equal(task[0].alias, "G6-05");
assert.equal(queue.activeRun.currentCard, "G6-05/AF-087");
assert.equal(queue.formalTaskIdAssignments.ids["G6-05"], "AF-087");
assert.equal(queue.formalTaskIdAssignmentsHistory.filter(entry => entry.ids?.["G6-05"] === "AF-087").length, 1);
for (const formalTaskId of ["AF-039", "AF-040", "AF-041", "AF-083", "AF-084", "AF-085", "AF-086"]) {
  const dependency = queue.taskExecutions.find(entry => entry.formalTaskId === formalTaskId);
  assert.equal(dependency?.status, "CODE_VERIFIED", `${formalTaskId} card-level prerequisite is verified`);
}
for (const formalTaskId of ["AF-083", "AF-084", "AF-085", "AF-086"]) {
  const dependency = queue.taskExecutions.find(entry => entry.formalTaskId === formalTaskId);
  assert.equal(dependency.ownerAcceptance, "PENDING_UNIFIED_OWNER_CHECK", `${formalTaskId} owner acceptance is not inferred`);
}
assert.equal(queue.taskExecutions.find(entry => entry.formalTaskId === "AF-086")?.git?.status, "COMMITTED_PUSHED");
const snapshot = readFileSync(".artifacts/continuous/2026-10-31-to-G19/queue-start.json");
assert.equal(createHash("sha256").update(snapshot).digest("hex"), "1813aca58714326adad067835b54cba70aeab5db8091e890ae642b1272f69960", "Continuous queue snapshot is unchanged");
assert.equal(execFileSync("git", ["--no-optional-locks", "branch", "--show-current"], { encoding: "utf8" }).trim(), "dev");
const baseline = JSON.parse(readFileSync(".artifacts/continuous/2026-10-31-to-G19/AF-087-baseline.json", "utf8"));
assert.equal(execFileSync("git", ["--no-optional-locks", "rev-parse", "HEAD"], { encoding: "utf8" }).trim(), baseline.head);
console.log("AF-087 unique assignment, G4/G5 code dependencies, pending owner states and frozen queue snapshot verified");
