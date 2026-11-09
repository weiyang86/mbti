import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { taskRegistry } from "./registry.mjs";

const baseline = JSON.parse(readFileSync(".artifacts/continuous/2026-11-02-to-G19B/batch-baseline.json", "utf8"));
const start = JSON.parse(readFileSync(".artifacts/continuous/2026-11-02-to-G19B/AF-113-prechange-evidence.json", "utf8"));
const queue = JSON.parse(readFileSync("docs/planning/CODING_QUEUE.json", "utf8"));
const batch = queue.proposedBatches.find(item => item.id === "NEXT-19B");
const task = queue.taskExecutions.find(item => item.formalTaskId === "AF-113");
const previous = queue.taskExecutions.find(item => item.formalTaskId === "AF-112");
const ownerHash = createHash("sha256").update(JSON.stringify(queue.ownerAcceptanceRecords)).digest("hex");
const ids = batch?.formalTaskIds;

assert.equal(execFileSync("git", ["--no-optional-locks", "branch", "--show-current"], { encoding: "utf8" }).trim(), "dev");
assert.equal(execFileSync("git", ["--no-optional-locks", "rev-parse", "HEAD"], { encoding: "utf8" }).trim(), baseline.head);
assert.equal(execFileSync("git", ["--no-optional-locks", "rev-parse", "origin/dev"], { encoding: "utf8" }).trim(), baseline.originDevTrackingRef);
assert.equal(createHash("sha256").update(readFileSync(".git/index")).digest("hex"), baseline.ordinaryIndexSha256);
assert.equal(ownerHash, start.ownerAcceptanceRecordsSha256, "owner acceptance history is immutable during this batch");
assert.deepEqual(ids, { "G19-05": "AF-112", "G19-06": "AF-113", "G19-07": "AF-114" });
assert.equal(batch?.status, "IN_PROGRESS");
assert.equal(batch?.executionProgress?.currentCard, "G19-06/AF-113");
assert.ok(batch?.executionProgress?.codeVerified?.includes("G19-05/AF-112"));
assert.equal(batch?.executionProgress?.liveDeepSeek, false);
assert.equal(batch?.executionProgress?.liveCustomerData, false);
assert.equal(batch?.executionProgress?.paidRequests, false);
assert.equal(batch?.executionProgress?.fileImport, false);
assert.equal(previous?.status, "CODE_VERIFIED");
assert.equal(previous?.ownerAcceptance, "PENDING_UNIFIED_OWNER_CHECK");
assert.equal(task?.alias, "G19-06");
assert.ok(["IN_PROGRESS", "CODE_VERIFIED"].includes(task?.status));
assert.equal(task?.ownerAcceptance, "PENDING_UNIFIED_OWNER_CHECK");
assert.equal(taskRegistry["AF-113"]?.steps?.some(step => step.testFiles?.includes("scripts/verification/g19-knowledge-management-web-http-db.test.mjs")), true);
assert.equal(existsSync("apps/web/app/client/knowledge/page.tsx"), true);
for (const id of ["AF-108", "AF-109", "AF-110", "AF-111"]) {
  const dependency = queue.taskExecutions.find(item => item.formalTaskId === id);
  assert.equal(dependency?.status, "CODE_VERIFIED", `${id} remains code-verified`);
  assert.equal(dependency?.ownerAcceptance, "PENDING_UNIFIED_OWNER_CHECK", `${id} owner acceptance is not inferred`);
}
const sidecarIndex = ".artifacts/continuous/2026-11-02-to-G19B/AF-112-working.index";
assert.equal(existsSync(sidecarIndex), true, "reuse the already isolated sidecar index; do not touch the ordinary index");
console.log("AF-113 preflight: authorization, AF-112 dependency, reserved ID, owner boundary, test DB scope, dev baseline and untouched ordinary index verified.");
