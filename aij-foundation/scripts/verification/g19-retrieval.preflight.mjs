import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const sidecar = ".artifacts/continuous/2026-11-01-to-G19/AF-107-working.index";
const baselinePath = ".artifacts/continuous/2026-11-02-to-G19/AF-109-baseline.json";
const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
const queue = JSON.parse(readFileSync("docs/planning/CODING_QUEUE.json", "utf8"));
const git = args => execFileSync("git", ["--no-optional-locks", ...args], { encoding: "utf8" }).trim();
const hash = path => createHash("sha256").update(readFileSync(path)).digest("hex");

assert.equal(baseline.task, "AF-109 / G19-02");
assert.equal(git(["branch", "--show-current"]), "dev");
assert.equal(git(["rev-parse", "HEAD"]), baseline.head);
assert.equal(git(["rev-parse", "origin/dev"]), baseline.originDevTrackingRef);
assert.equal(baseline.liveOriginDevReadback, baseline.head);
assert.equal(hash(".git/index"), baseline.ordinaryGitIndex.sha256, "ordinary index remains untouched");
assert.equal(baseline.sidecarGitIndex.path, sidecar);
assert.ok(readFileSync(sidecar).length > 0, "approved sidecar index remains present");

const assignment = queue.formalTaskIdAssignments?.ids;
assert.equal(assignment?.["G19-02"], "AF-109");
assert.equal(queue.taskExecutions.filter(item => item.formalTaskId === "AF-109").length, 1);
const prerequisite = queue.taskExecutions.find(item => item.formalTaskId === "AF-108");
const task = queue.taskExecutions.find(item => item.formalTaskId === "AF-109");
assert.equal(prerequisite?.status, "CODE_VERIFIED");
assert.equal(prerequisite?.git?.status, "COMMITTED_AND_PUSHED");
assert.equal(prerequisite?.git?.remoteReadbackSha, baseline.dependency.commit);
assert.equal(task?.ownerAcceptance, "PENDING_UNIFIED_OWNER_CHECK");
assert.ok(["IN_PROGRESS", "CODE_VERIFIED"].includes(task?.status));
assert.equal(task?.baseline?.head, baseline.head);
assert.equal(queue.activeRun?.currentCard, "G19-02/AF-109");
assert.equal(queue.activeRun?.ownerAcceptance, "PENDING_UNIFIED_OWNER_CHECK");
execFileSync("git", ["--no-optional-locks", "merge-base", "--is-ancestor", baseline.dependency.commit, baseline.head]);
for (const forbidden of ["realDeepSeek", "customerData", "paidRequests"]) assert.equal(baseline.limits[forbidden], false);

console.log("AF-109 baseline, AF-108 dependency, unique task ID, aij-ai owner boundary and offline-only policy verified.");
