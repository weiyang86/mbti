import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const queue = JSON.parse(readFileSync("docs/planning/CODING_QUEUE.json", "utf8"));
const snapshot = readFileSync(queue.continuousQueueRun.snapshot);
const baseline = JSON.parse(readFileSync(".artifacts/continuous/2026-10-31-to-G19/AF-084-baseline.json", "utf8"));
const run = queue.taskExecutions.filter(item => item.formalTaskId === "AF-084");
const prior = queue.taskExecutions.find(item => item.formalTaskId === "AF-083");
const next12 = queue.taskExecutions.filter(item => ["AF-080", "AF-081", "AF-082"].includes(item.formalTaskId));

assert.equal(createHash("sha256").update(snapshot).digest("hex"), queue.continuousQueueRun.snapshotSha256);
assert.equal(queue.activeRun.scopeSnapshotSha256, queue.continuousQueueRun.snapshotSha256);
assert.equal(queue.status, "CONTINUOUS_TO_G19_IN_PROGRESS");
assert.equal(queue.activeRun.batch, "NEXT-13");
assert.equal(queue.activeRun.currentCard, "G5-02/AF-084");
assert.equal(queue.formalTaskIdAssignments.ids["G5-02"], "AF-084");
assert.equal(queue.formalTaskIdAssignmentsHistory.filter(item => item.ids?.["G5-02"] === "AF-084").length, 1);
assert.equal(run.length, 1);
assert.equal(run[0].alias, "G5-02");
assert.ok(["IN_PROGRESS", "CODE_VERIFIED"].includes(run[0].status));
assert.equal(run[0].ownerAcceptance, "PENDING_UNIFIED_OWNER_CHECK");
assert.equal(prior?.status, "CODE_VERIFIED");
assert.equal(prior?.ownerAcceptance, "PENDING_UNIFIED_OWNER_CHECK");
assert.equal(next12.length, 3);
assert.ok(next12.every(item => item.status === "CODE_VERIFIED"));
assert.equal(baseline.formalTaskId, "AF-084");
assert.equal(baseline.branch, "dev");
assert.equal(baseline.head, run[0].baseline.head);
assert.equal(execFileSync("git", ["--no-optional-locks", "rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8" }).trim(), "dev");
assert.equal(execFileSync("git", ["--no-optional-locks", "rev-parse", "HEAD"], { encoding: "utf8" }).trim(), baseline.head);

console.log("AF-084 is the unique active G5-02 card on the frozen queue; AF-083/NEXT-12 code dependencies and owner-pending states are intact.");
