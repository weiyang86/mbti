import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { repositoryRoot } from "../database/connection.mjs";

const queue = JSON.parse(readFileSync(`${repositoryRoot}/docs/planning/CODING_QUEUE.json`, "utf8"));
const snapshotPath = `${repositoryRoot}/.artifacts/continuous/2026-10-31-to-G19/queue-start.json`;
const snapshot = readFileSync(snapshotPath);
const snapshotHash = createHash("sha256").update(snapshot).digest("hex");
const expectedSnapshot = "1813aca58714326adad067835b54cba70aeab5db8091e890ae642b1272f69960";
assert.equal(snapshotHash, expectedSnapshot, "continuous queue scope remains the frozen owner-approved snapshot");
assert.equal(execFileSync("git", ["--no-optional-locks", "branch", "--show-current"], { cwd: repositoryRoot, encoding: "utf8" }).trim(), "dev");
const assignments = queue.formalTaskIdAssignments?.ids;
assert.ok(assignments && assignments["G6-07"] === "AF-089", "G6-07 formal ID remains uniquely assigned");
const record = id => queue.taskExecutions?.find(task => task.formalTaskId === id);
const current = record("AF-089");
assert.ok(current && current.alias === "G6-07" && current.status === "IN_PROGRESS");
assert.equal(current.ownerAcceptance, "PENDING_UNIFIED_OWNER_CHECK");
assert.equal(current.baseline?.branch, "dev");
assert.equal(current.baseline?.head, "1dc111951bd3d656bcfd43d9643124bc63386d0d");
for (const id of ["AF-087", "AF-088"]) {
  const dependency = record(id);
  assert.ok(dependency, `${id} dependency is registered`);
  assert.equal(dependency.status, "CODE_VERIFIED", `${id} is code verified`);
  assert.equal(dependency.git?.status, "COMMITTED_AND_PUSHED", `${id} is committed and pushed`);
  assert.equal(dependency.ownerAcceptance, "PENDING_UNIFIED_OWNER_CHECK", `${id} remains pending owner acceptance`);
}
console.log(JSON.stringify({ card: "G6-07/AF-089", snapshotHash, dependencies: ["AF-087", "AF-088"], ownerAcceptance: "pending" }));
