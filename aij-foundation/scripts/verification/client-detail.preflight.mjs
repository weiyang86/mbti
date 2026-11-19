import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const queue = JSON.parse(readFileSync("docs/planning/CODING_QUEUE.json", "utf8"));
const snapshotPath = ".artifacts/continuous/2026-10-31-to-G19/queue-start.json";
const snapshotHash = createHash("sha256").update(readFileSync(snapshotPath)).digest("hex");
const branch = execFileSync("git", ["branch", "--show-current"], { encoding: "utf8" }).trim();
const task = queue.taskExecutions.filter(entry => entry.formalTaskId === "AF-088");
const assignment = queue.formalTaskIdAssignmentsHistory.filter(entry => entry.ids?.["G6-06"] === "AF-088");
const previous = queue.taskExecutions.find(entry => entry.formalTaskId === "AF-087");

assert.equal(branch, "dev", "G6-06 executes only on dev");
assert.equal(snapshotHash, "1813aca58714326adad067835b54cba70aeab5db8091e890ae642b1272f69960", "frozen queue snapshot is unchanged");
assert.equal(task.length, 1, "AF-088 is assigned exactly once");
assert.equal(task[0].alias, "G6-06");
assert.equal(assignment.length, 1, "formal assignment history has one AF-088 record");
assert.equal(queue.formalTaskIdAssignments.ids["G6-06"], "AF-088");
assert.equal(previous.status, "CODE_VERIFIED");
assert.equal(previous.git.status, "COMMITTED_AND_PUSHED");
assert.equal(previous.ownerAcceptance, "PENDING_UNIFIED_OWNER_CHECK", "AF-087 owner acceptance remains pending");
assert.equal(queue.activeRun.currentCard, "G6-06/AF-088");
assert.equal(task[0].dataOwner, "AdminClientDirectory is the read-only API projection; ClientAuth remains the sole MemberUser/session/consent state writer. This card adds only Web presentation consuming existing GET /api/admin/clients.");

process.stdout.write(JSON.stringify({
  status: "PREFLIGHT_OK",
  task: "AF-088",
  alias: "G6-06",
  branch,
  frozenQueueSha256: snapshotHash,
  dependency: "G6-05/AF-087 CODE_VERIFIED, committed, pushed; owner acceptance pending",
  scope: "read-only detail/status presentation using the existing customer API",
  owner: "ClientAuth owns customer writes; AdminClientDirectory owns authorized read projection"
}) + "\n");
