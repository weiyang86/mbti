import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const queue = JSON.parse(readFileSync("docs/planning/CODING_QUEUE.json", "utf8"));
const snapshotBytes = readFileSync(queue.continuousQueueRun.snapshot);
const baseline = JSON.parse(readFileSync(".artifacts/continuous/2026-10-31-to-G19/AF-086-baseline.json", "utf8"));
const currentHead = execFileSync("git", ["--no-optional-locks", "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const branch = execFileSync("git", ["--no-optional-locks", "rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8" }).trim();
const assignments = queue.formalTaskIdAssignmentsHistory.filter(item => item.ids?.["G5-04"] === "AF-086");
const runs = queue.taskExecutions.filter(item => item.formalTaskId === "AF-086");
const prerequisites = ["AF-080", "AF-081", "AF-082", "AF-083", "AF-084", "AF-085"]
  .map(id => queue.taskExecutions.filter(item => item.formalTaskId === id).findLast(item => item.status === "CODE_VERIFIED"));

assert.equal(createHash("sha256").update(snapshotBytes).digest("hex"), queue.continuousQueueRun.snapshotSha256, "frozen queue snapshot is unchanged");
assert.equal(queue.status, "CONTINUOUS_TO_G19_IN_PROGRESS");
assert.equal(queue.activeRun.scopeSnapshotSha256, queue.continuousQueueRun.snapshotSha256);
assert.equal(queue.activeRun.batch, "NEXT-13");
assert.equal(queue.activeRun.currentCard, "G5-04/AF-086");
assert.equal(queue.formalTaskIdAssignments.ids["G5-04"], "AF-086");
assert.equal(assignments.length, 1, "G5-04/AF-086 has one collision-checked formal assignment");
assert.equal(runs.length, 1, "AF-086 has one execution record");
assert.equal(runs[0].alias, "G5-04");
assert.equal(runs[0].status, "IN_PROGRESS");
assert.equal(runs[0].ownerAcceptance, "PENDING_UNIFIED_OWNER_CHECK");
assert.ok(prerequisites.every(item => item), "NEXT-12 and G5-01 through G5-03 are code verified");
assert.ok(prerequisites.every(item => item.ownerAcceptance === "PENDING_UNIFIED_OWNER_CHECK"), "predecessor owner acceptance remains pending");
assert.equal(baseline.formalTaskId, "AF-086");
assert.equal(baseline.branch, "dev");
assert.equal(currentHead, baseline.head, "card source baseline remains at the saved dev HEAD before closeout");
assert.equal(branch, "dev");

console.log("AF-086 unique assignment, frozen queue, predecessor code status, pending owner acceptance and saved dev baseline are intact.");
