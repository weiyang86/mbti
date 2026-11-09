import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { taskRegistry } from "./registry.mjs";

const queue = JSON.parse(readFileSync("docs/planning/CODING_QUEUE.json", "utf8"));
const baseline = JSON.parse(readFileSync(".artifacts/continuous/2026-11-01-to-G19/AF-105-baseline.json", "utf8"));
const records = queue.taskExecutions.filter(entry => entry.formalTaskId === "AF-105");
const task = records[0];
const git = args => execFileSync("git", ["--no-optional-locks", ...args], { encoding: "utf8" }).trim();
const dependency = id => queue.taskExecutions.find(entry => entry.formalTaskId === id);
const batch = queue.proposedBatches.find(entry => entry.id === "NEXT-18B");

assert.equal(records.length, 1, "AF-105 has a unique execution record");
assert.equal(git(["branch", "--show-current"]), "dev");
assert.equal(git(["rev-parse", "HEAD"]), baseline.head, "frozen AF-105 parent is unchanged before commit");
assert.equal(git(["rev-parse", "origin/dev"]), baseline.originDevTrackingRef, "local tracking ref is unchanged");
assert.equal(queue.formalTaskIdAssignments.ids["G18-03"], "AF-105");
assert.equal(batch.formalTaskIds["G18-03"], "AF-105");
assert.equal(batch.currentCard, "G18-03/AF-105");
assert.ok(["IN_PROGRESS", "CODE_VERIFIED"].includes(task.status));
assert.equal(task.title, "回调验签、重放拒绝、状态机和对账审计");
assert.equal(task.ownerAcceptance, "PENDING_UNIFIED_OWNER_CHECK");
for (const id of ["AF-103", "AF-104"]) {
  assert.equal(dependency(id)?.status, "CODE_VERIFIED", `${id} code dependency passed`);
  assert.equal(dependency(id)?.verification?.status, "PASS", `${id} registered verification passed`);
}
for (const title of ["支付 Provider contract 与订单/尝试/交易状态 owner 明确", "创建支付请求/查询状态及幂等键；金额和币种由服务端决定"]) {
  const commit = execFileSync("git", ["--no-optional-locks", "log", "-1", "--format=%H", "--grep=" + title, baseline.head], { encoding: "utf8" }).trim();
  assert.match(commit, /^[0-9a-f]{40}$/, `git history contains pushed task title: ${title}`);
  execFileSync("git", ["--no-optional-locks", "merge-base", "--is-ancestor", commit, baseline.head], { stdio: "ignore" });
  execFileSync("git", ["--no-optional-locks", "merge-base", "--is-ancestor", commit, baseline.originDevTrackingRef], { stdio: "ignore" });
}
assert.equal(taskRegistry["AF-105"]?.title, task.title);
assert.ok(taskRegistry["AF-105"]?.steps.some(step => step.testFiles?.includes("scripts/verification/payment-callback-http-db.test.mjs")), "AF-105 registers its actual HTTP/DB test file");
assert.equal(task.dataOwner.includes("aij-payment"), true);
assert.equal(task.dataOwner.includes("IntegrationCenter ledger"), true);
assert.equal(createHash("sha256").update(readFileSync(".git/index")).digest("hex"), baseline.ordinaryIndex.sha256, "ordinary index remains byte-for-byte unchanged and is not used by this run");
console.log("AF-105 assignment, dependencies, baseline, payment owner, pending owner acceptance, and real test registration verified.");
