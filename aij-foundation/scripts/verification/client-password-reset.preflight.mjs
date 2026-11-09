import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const queue = JSON.parse(readFileSync("docs/planning/CODING_QUEUE.json", "utf8"));
const snapshotBytes = readFileSync(queue.continuousQueueRun.snapshot);
const baseline = JSON.parse(readFileSync(".artifacts/continuous/2026-10-31-to-G19/AF-085-baseline.json", "utf8"));
const currentHead = execFileSync("git", ["--no-optional-locks", "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const branch = execFileSync("git", ["--no-optional-locks", "rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8" }).trim();
const runs = queue.taskExecutions.filter(item => item.formalTaskId === "AF-085");
const dependencies = ["AF-080", "AF-081", "AF-082", "AF-083", "AF-084"].map(id => queue.taskExecutions.find(item => item.formalTaskId === id));

assert.equal(createHash("sha256").update(snapshotBytes).digest("hex"), queue.continuousQueueRun.snapshotSha256, "the authorized queue snapshot is unchanged");
assert.equal(queue.activeRun.scopeSnapshotSha256, queue.continuousQueueRun.snapshotSha256);
assert.equal(queue.status, "CONTINUOUS_TO_G19_IN_PROGRESS");
assert.equal(queue.activeRun.batch, "NEXT-13");
assert.equal(queue.activeRun.currentCard, "G5-03/AF-085");
assert.equal(queue.formalTaskIdAssignments.ids["G5-03"], "AF-085");
assert.equal(queue.formalTaskIdAssignmentsHistory.filter(item => item.ids?.["G5-03"] === "AF-085").length, 1);
assert.equal(runs.length, 1, "AF-085 has one execution record");
assert.equal(runs[0].alias, "G5-03");
assert.ok(["IN_PROGRESS", "CODE_VERIFIED"].includes(runs[0].status));
assert.equal(runs[0].ownerAcceptance, "PENDING_UNIFIED_OWNER_CHECK");
assert.ok(dependencies.every(item => item?.status === "CODE_VERIFIED"), "all registered predecessor cards are code verified");
assert.ok(dependencies.every(item => item.ownerAcceptance === "PENDING_UNIFIED_OWNER_CHECK"), "predecessor owner acceptance remains pending");
assert.equal(baseline.task, "G5-03 / AF-085");
assert.equal(baseline.branch, "dev");
assert.equal(baseline.head, currentHead, "the tracked dev baseline has not moved before this card commit");
assert.equal(runs[0].baseline.head, baseline.head);
assert.equal(branch, "dev", "card remains on the authorized development branch");

console.log("AF-085 is uniquely assigned on the frozen G5-03 queue; all predecessors are CODE_VERIFIED, owner acceptance is pending, and the pre-commit dev baseline is intact.");
