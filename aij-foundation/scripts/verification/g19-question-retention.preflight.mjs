import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { taskRegistry } from "./registry.mjs";

const baseline = JSON.parse(readFileSync(".artifacts/af-115/baseline.json", "utf8"));
const startQueue = JSON.parse(readFileSync(".artifacts/af-115/inherited-snapshots/CODING_QUEUE.json", "utf8"));
const queue = JSON.parse(readFileSync("docs/planning/CODING_QUEUE.json", "utf8"));
const hash = value => createHash("sha256").update(value).digest("hex");
const ownerAcceptanceSha256 = hash(JSON.stringify(queue.ownerAcceptanceRecords));

assert.equal(execFileSync("git", ["--no-optional-locks", "branch", "--show-current"], { encoding: "utf8" }).trim(), "dev");
assert.equal(execFileSync("git", ["--no-optional-locks", "rev-parse", "HEAD"], { encoding: "utf8" }).trim(), baseline.head);
assert.equal(execFileSync("git", ["--no-optional-locks", "rev-parse", "origin/dev"], { encoding: "utf8" }).trim(), baseline.originDev);
assert.equal(hash(readFileSync(".git/index")), baseline.ordinaryIndexSha256, "ordinary Git index remains untouched");
assert.equal(ownerAcceptanceSha256, baseline.ownerAcceptanceRecordsSha256, "owner acceptance records remain unchanged");
assert.equal(startQueue.taskExecutions.some(row => row.formalTaskId === "AF-115" || row.alias === "G19-08"), false);
assert.equal(queue.formalTaskIdAssignmentsHistory.filter(row => row.ids?.["G19-08"] === "AF-115").length, 1);
assert.equal(queue.taskExecutions.filter(row => row.formalTaskId === "AF-115").length, 1);
assert.equal(queue.taskExecutions.find(row => row.formalTaskId === "AF-115")?.title, "G19 客户问答 7 天到期与内容清理");
assert.ok(["IN_PROGRESS", "CODE_VERIFIED"].includes(queue.taskExecutions.find(row => row.formalTaskId === "AF-115")?.status));
assert.equal(queue.taskExecutions.find(row => row.formalTaskId === "AF-115")?.ownerAcceptance, "PENDING_UNIFIED_OWNER_CHECK");
for (const id of ["AF-108", "AF-109", "AF-110", "AF-111", "AF-112", "AF-113", "AF-114"]) {
  const dependency = queue.taskExecutions.find(row => row.formalTaskId === id);
  assert.equal(dependency?.status, "CODE_VERIFIED", `${id} dependency is CODE_VERIFIED`);
  assert.equal(dependency?.ownerAcceptance, "PENDING_UNIFIED_OWNER_CHECK", `${id} acceptance remains pending`);
}
for (const batchId of ["NEXT-19A", "NEXT-19B"]) {
  const batch = queue.proposedBatches.find(row => row.id === batchId);
  assert.ok(batch);
  assert.equal(batch.status, "OWNER_CHECK_PENDING");
}
assert.equal(taskRegistry["AF-115"]?.title, "G19 客户问答 7 天到期与内容清理");
assert.ok(taskRegistry["AF-115"]?.steps?.some(step => step.testFiles?.includes("scripts/verification/g19-question-retention-http-db.test.mjs")));
console.log("AF-115 preflight: dev/origin baseline, untouched ordinary index, unchanged owner acceptance, unique mapping, verified dependencies, and real HTTP+PostgreSQL registration confirmed.");
