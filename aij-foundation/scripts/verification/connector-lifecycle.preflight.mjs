import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const root = process.cwd();
const queue = JSON.parse(readFileSync(join(root, "docs/planning/CODING_QUEUE.json"), "utf8"));
const baseline = JSON.parse(readFileSync(join(root, ".artifacts/continuous/2026-11-01-to-G19/AF-102-baseline.json"), "utf8"));
const run = args => execFileSync("git", ["--no-optional-locks", ...args], { cwd: root, encoding: "utf8" }).trim();

assert.equal(process.versions.node.split(".")[0], "24");
assert.equal(run(["branch", "--show-current"]), "dev");
assert.equal(run(["rev-parse", "HEAD"]), baseline.verificationContinuation.head, "only the documented metadata closeout may precede AF-102 verification");
assert.equal(run(["rev-parse", "origin/dev"]), baseline.verificationContinuation.originDevTrackingRef, "tracking ref matches the pushed metadata closeout");
assert.equal(run(["merge-base", "--is-ancestor", baseline.head, "HEAD"]) === "", true, "AF-102 start HEAD remains an ancestor");
const continuationPaths = run(["diff", "--name-only", baseline.head, "HEAD"]).split("\n").filter(Boolean).sort();
assert.deepEqual(continuationPaths, ["docs/execution/AF-100.md", "docs/planning/CODING_QUEUE.json"], "the only post-baseline committed changes are AF-100 metadata closeout");
const indexSha = createHash("sha256").update(readFileSync(join(root, ".git/index"))).digest("hex");
assert.equal(indexSha, baseline.resumptionObservation.ordinaryGitIndexSha256, "the ordinary index matches the captured post-remount preservation anchor");
// The separately isolated AF-100 metadata commit advanced HEAD. `diff --cached`
// is relative to HEAD, so its patch digest changes when the base advances even
// though the ordinary index bytes remain untouched. The raw index SHA anchors
// the inherited index without confusing a new base comparison for a mutation.

const assigned = queue.formalTaskIdAssignments;
assert.equal(assigned.batch, "NEXT-17B");
assert.equal(assigned.ids["G17-04"], "AF-102");
assert.equal(queue.taskExecutions.filter(entry => entry.formalTaskId === "AF-102").length, 1, "AF-102 has one execution entry");
assert.equal(queue.formalTaskIdAssignmentsHistory.filter(entry => entry.ids?.["G17-04"] === "AF-102").length, 1, "G17-04 has one historical assignment");
assert.equal(baseline.formalIdCollisionScan.repositoryRipgrepExit, 1);
assert.deepEqual(baseline.formalIdCollisionScan.repositoryRipgrepMatches, []);
assert.equal(baseline.formalIdCollisionScan.gitLogTitleMatches, "");
assert.ok(existsSync("docs/execution/AF-102.md"));

for (const dependencyId of ["AF-099", "AF-100", "AF-101"]) {
  const dependency = queue.taskExecutions.find(entry => entry.formalTaskId === dependencyId);
  assert.equal(dependency?.status, "CODE_VERIFIED");
  assert.equal(dependency?.git?.status, "COMMITTED_AND_PUSHED");
}
assert.equal(queue.activeRun.currentCard, "G17-04/AF-102");
assert.equal(queue.activeRun.ownerAcceptance, "PENDING_UNIFIED_OWNER_CHECK");
assert.equal(queue.taskExecutions.find(entry => entry.formalTaskId === "AF-102").ownerAcceptance, "PENDING_UNIFIED_OWNER_CHECK");

console.log(JSON.stringify({ task: "AF-102", preconditions: 13, passed: 13, baseline: baseline.head, ordinaryIndexSha256: indexSha }, null, 2));
