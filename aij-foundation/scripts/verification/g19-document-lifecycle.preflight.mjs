import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { taskRegistry } from "./registry.mjs";

const baseline = JSON.parse(readFileSync(".artifacts/continuous/2026-11-02-to-G19B/batch-baseline.json", "utf8"));
const start = JSON.parse(readFileSync(".artifacts/continuous/2026-11-02-to-G19B/AF-112-prechange-evidence.json", "utf8"));
const queue = JSON.parse(readFileSync("docs/planning/CODING_QUEUE.json", "utf8"));
const batch = queue.proposedBatches.find(item => item.id === "NEXT-19B");
const task = queue.taskExecutions.find(item => item.formalTaskId === "AF-112");
const ids = batch?.formalTaskIds;
const ownerHash = createHash("sha256").update(JSON.stringify(queue.ownerAcceptanceRecords)).digest("hex");

assert.equal(execFileSync("git", ["--no-optional-locks", "branch", "--show-current"], { encoding: "utf8" }).trim(), "dev");
assert.equal(execFileSync("git", ["--no-optional-locks", "rev-parse", "HEAD"], { encoding: "utf8" }).trim(), baseline.head);
assert.equal(execFileSync("git", ["--no-optional-locks", "rev-parse", "origin/dev"], { encoding: "utf8" }).trim(), baseline.originDevTrackingRef);
assert.equal(createHash("sha256").update(readFileSync(".git/index")).digest("hex"), baseline.ordinaryIndexSha256);
assert.equal(start.af112AlreadyRegistered, false);
assert.equal(start.af112RecordExists, false);
assert.equal(ownerHash, start.ownerAcceptanceRecordsSha256, "prior owner acceptance records are immutable in this card");
const sidecarIndex = ".artifacts/continuous/2026-11-02-to-G19B/AF-112-working.index";
if (!existsSync(sidecarIndex)) {
  execFileSync("git", ["--no-optional-locks", "read-tree", baseline.head], {
    env: { ...process.env, GIT_INDEX_FILE: sidecarIndex }
  });
}
assert.deepEqual(ids, { "G19-05": "AF-112", "G19-06": "AF-113", "G19-07": "AF-114" });
assert.equal(batch?.status, "IN_PROGRESS");
assert.match(batch?.authorizationSource ?? "", /批准启动 NEXT-19B/);
assert.equal(batch?.executionProgress?.currentCard, task?.status === "CODE_VERIFIED" ? "G19-06/AF-113" : "G19-05/AF-112");
assert.equal(batch?.executionProgress?.liveDeepSeek, false);
assert.equal(batch?.executionProgress?.liveCustomerData, false);
assert.equal(batch?.executionProgress?.paidRequests, false);
assert.equal(batch?.executionProgress?.fileImport, false);
assert.equal(task?.alias, "G19-05");
assert.ok(["IN_PROGRESS", "CODE_VERIFIED"].includes(task?.status));
assert.equal(task?.ownerAcceptance, "PENDING_UNIFIED_OWNER_CHECK");
assert.equal(taskRegistry["AF-112"]?.steps?.some(step => step.testFiles?.includes("scripts/verification/g19-knowledge-document-lifecycle-http-db.test.mjs")), true);
for (const id of ["AF-108", "AF-109", "AF-110", "AF-111"]) {
  const previous = queue.taskExecutions.find(item => item.formalTaskId === id);
  assert.equal(previous?.status, "CODE_VERIFIED", `${id} dependency code status`);
  assert.equal(previous?.git?.status, "COMMITTED_AND_PUSHED", `${id} dependency Git status`);
  assert.equal(previous?.ownerAcceptance, "PENDING_UNIFIED_OWNER_CHECK", `${id} owner acceptance remains pending`);
}
console.log("AF-112 preflight: authorized batch, dependency states, owner boundary, formal IDs, dev baseline and untouched ordinary index verified.");
