import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { taskRegistry } from "./registry.mjs";

const queue = JSON.parse(readFileSync("docs/planning/CODING_QUEUE.json", "utf8"));
const snapshotPath = ".artifacts/continuous/2026-10-31-to-G19/queue-start.json";
const snapshot = readFileSync(snapshotPath);
const expectedSnapshotSha256 = "1813aca58714326adad067835b54cba70aeab5db8091e890ae642b1272f69960";
const assignment = queue.formalTaskIdAssignments;
const task = queue.taskExecutions.find(entry => entry.formalTaskId === "AF-091");
const batch = queue.proposedBatches.find(entry => entry.id === "NEXT-15A");
const active = queue.activeRun;

assert.equal(createHash("sha256").update(snapshot).digest("hex"), expectedSnapshotSha256, "frozen continuous queue snapshot changed");
assert.equal(execFileSync("git", ["--no-optional-locks", "branch", "--show-current"], { encoding: "utf8" }).trim(), "dev");
assert.equal(assignment?.ids?.["G15-01"], "AF-091", "formal G15-01 assignment missing");
assert.equal(queue.formalTaskIdAssignmentsHistory.filter(entry => entry.ids?.["G15-01"] === "AF-091").length, 1);
assert.equal(queue.taskExecutions.filter(entry => entry.formalTaskId === "AF-091").length, 1);
assert.equal(task?.alias, "G15-01");
assert.equal(task?.executionRecord, "docs/execution/AF-091.md");
assert.ok(["IN_PROGRESS", "CODE_VERIFIED"].includes(task?.status));
assert.equal(task?.ownerAcceptance, "PENDING_UNIFIED_OWNER_CHECK");
assert.equal(batch?.formalTaskIds?.["G15-01"], "AF-091");
assert.equal(active?.currentCard, "G15-01/AF-091");
assert.ok(["IN_PROGRESS", "CODE_VERIFIED"].includes(active?.cardStatus));
for (const id of ["AF-049", "AF-050", "AF-051", "AF-052", "AF-071", "AF-072"]) {
  assert.equal(queue.taskExecutions.find(entry => entry.formalTaskId === id)?.status, "CODE_VERIFIED", `${id} dependency is not code verified`);
}
for (const id of ["AF-049", "AF-050", "AF-051", "AF-052", "AF-071", "AF-072", "AF-090"]) {
  assert.equal(queue.taskExecutions.find(entry => entry.formalTaskId === id)?.ownerAcceptance, "PENDING_UNIFIED_OWNER_CHECK", `${id} acceptance history changed`);
}
assert.equal(taskRegistry["AF-091"]?.title, task?.title, "registry title and queue title differ");
assert.ok(existsSync("docs/execution/AF-091.md"));
console.log("Frozen NEXT-12–19 scope, unique AF-091 allocation, G15-01 dependencies and pending owner states verified");
