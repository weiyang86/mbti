import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { repositoryRoot } from "../database/connection.mjs";

const run = (...args) => execFileSync("git", ["--no-optional-locks", ...args], { cwd: repositoryRoot, encoding: "utf8" }).trim();
const queue = JSON.parse(readFileSync(repositoryRoot + "/docs/planning/CODING_QUEUE.json", "utf8"));
const baseline = JSON.parse(readFileSync(repositoryRoot + "/.artifacts/continuous/2026-10-31-to-G19/AF-090-baseline.json", "utf8"));
const snapshotPath = repositoryRoot + "/" + baseline.frozenQueueSnapshot;
const snapshotHash = createHash("sha256").update(readFileSync(snapshotPath)).digest("hex");

assert.equal(run("branch", "--show-current"), "dev", "the card remains on dev");
assert.equal(run("rev-parse", "HEAD"), baseline.head, "the card starts at its saved HEAD");
assert.equal(baseline.formalIdCollisionScan.id, "AF-090");
for (const key of ["gitHistoryNoMatch", "trackedContentNoMatch", "workingTreeContentNoMatch", "executionFilenameNoMatch", "queueAssignmentFree"])
  assert.equal(baseline.formalIdCollisionScan[key], true, `AF-090 collision scan: ${key}`);
assert.equal(snapshotHash, baseline.frozenQueueSnapshotSha256, "the frozen NEXT-12..G19 queue snapshot is unchanged");
assert.equal(queue.formalTaskIdAssignments.ids["G6-08"], "AF-090");
const task = queue.taskExecutions.find(item => item.formalTaskId === "AF-090");
assert.ok(task && task.alias === "G6-08" && task.status === "IN_PROGRESS");
assert.equal(task.ownerAcceptance, "PENDING_UNIFIED_OWNER_CHECK");
for (const id of ["AF-087", "AF-088", "AF-089"]) {
  const dependency = queue.taskExecutions.find(item => item.formalTaskId === id);
  assert.ok(dependency && dependency.status === "CODE_VERIFIED", `${id} dependency is code-verified`);
  assert.equal(dependency.git?.status, "COMMITTED_AND_PUSHED", `${id} dependency is committed and pushed`);
  assert.equal(dependency.ownerAcceptance, "PENDING_UNIFIED_OWNER_CHECK", `${id} owner acceptance stays pending`);
}
assert.equal(queue.activeRun?.currentCard, "G6-08/AF-090");
assert.equal(queue.continuousQueueRun?.currentCard, "G6-08/AF-090");
for (const path of [
  "apps/api/src/admin-clients/admin-client-directory.controller.ts",
  "apps/api/src/admin-clients/admin-client-directory.service.ts",
  "apps/web/app/auth/clients/page.tsx",
  "apps/web/app/components/admin-client-directory.tsx",
  "apps/web/app/components/admin-shell.tsx"
]) readFileSync(repositoryRoot + "/" + path);
process.stdout.write(JSON.stringify({ status: "PREFLIGHT_OK", task: "AF-090", alias: "G6-08", branch: "dev", head: baseline.head,
  frozenQueueSha256: snapshotHash, dependencies: ["AF-087", "AF-088", "AF-089"], ownerAcceptance: "PENDING_UNIFIED_OWNER_CHECK" }) + "\n");
