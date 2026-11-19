import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { taskRegistry } from "./registry.mjs";

const queue = JSON.parse(readFileSync("docs/planning/CODING_QUEUE.json", "utf8"));
const baseline = JSON.parse(readFileSync(".artifacts/continuous/2026-11-01-to-G19/AF-104-baseline.json", "utf8"));
const records = queue.taskExecutions.filter(entry => entry.formalTaskId === "AF-104");
const task = records[0];
const verifiedBaseQueue = JSON.parse(execFileSync("git", ["--no-optional-locks", "show", "HEAD:docs/planning/CODING_QUEUE.json"], { encoding: "utf8" }));
const dependency = verifiedBaseQueue.taskExecutions.find(entry => entry.formalTaskId === "AF-103");

assert.equal(records.length, 1, "AF-104 has one queue execution record");
assert.equal(execFileSync("git", ["--no-optional-locks", "branch", "--show-current"], { encoding: "utf8" }).trim(), "dev");
assert.equal(execFileSync("git", ["--no-optional-locks", "rev-parse", "HEAD"], { encoding: "utf8" }).trim(), baseline.head);
assert.equal(execFileSync("git", ["--no-optional-locks", "rev-parse", "origin/dev"], { encoding: "utf8" }).trim(), baseline.originDevTrackingRef);
assert.equal(queue.formalTaskIdAssignments.ids["G18-02"], "AF-104");
assert.equal(task?.alias, "G18-02");
assert.equal(task?.title, "创建支付请求/查询状态及幂等键；金额和币种由服务端决定");
assert.ok(["IN_PROGRESS", "CODE_VERIFIED"].includes(task?.status));
assert.equal(task?.ownerAcceptance, "PENDING_UNIFIED_OWNER_CHECK");
assert.equal(dependency?.status, "CODE_VERIFIED");
assert.equal(dependency?.verification?.status, "PASS");
assert.equal(dependency?.git?.status, "COMMITTED_AND_PUSHED");
assert.equal(taskRegistry["AF-104"]?.title, task?.title);
assert.equal(queue.activeRun?.currentCard, "G18-02/AF-104");
assert.ok(queue.activeRun?.authorizedCards?.includes("G18-02/AF-104"));

for (const file of [
  "docs/execution/AF-104.md",
  "apps/api/src/plugins/aij-payment/payment.service.ts",
  "apps/api/src/plugins/aij-payment/payment.controller.ts",
  "apps/api/src/plugins/aij-payment/payment-payable-source.ts",
  "scripts/verification/payment-request-http-db.test.mjs",
  "apps/api/prisma/migrations/20261101040000_payment_request/migration.sql"
]) assert.equal(existsSync(file), true, `missing AF-104 file: ${file}`);

const contract = readFileSync("apps/api/src/plugins/aij-payment/payment.service.ts", "utf8");
assert.equal(contract.includes("qingqi-ai-consultant"), false, "service has no source-repository dependency");
console.log("AF-104 assignment, frozen dev baseline, pushed AF-103 dependency, local payment owner, and task files verified.");
