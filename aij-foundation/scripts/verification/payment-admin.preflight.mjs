import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { taskRegistry } from "./registry.mjs";

const queue = JSON.parse(readFileSync("docs/planning/CODING_QUEUE.json", "utf8"));
const baseline = JSON.parse(readFileSync(".artifacts/continuous/2026-11-01-to-G19/AF-106-baseline.json", "utf8"));
const record = queue.taskExecutions.find(item => item.formalTaskId === "AF-106");
const title = "管理查询/人工退款申请界面与离线协议 fixture；真实资金操作不自动执行";
const verifiedBaseQueue = JSON.parse(execFileSync("git", ["--no-optional-locks", "show", "HEAD:docs/planning/CODING_QUEUE.json"], { encoding: "utf8" }));
const dependency = verifiedBaseQueue.taskExecutions.find(item => item.formalTaskId === "AF-105");

assert.equal(execFileSync("git", ["--no-optional-locks", "branch", "--show-current"], { encoding: "utf8" }).trim(), "dev");
assert.equal(execFileSync("git", ["--no-optional-locks", "rev-parse", "HEAD"], { encoding: "utf8" }).trim(), baseline.head);
assert.equal(execFileSync("git", ["--no-optional-locks", "rev-parse", "origin/dev"], { encoding: "utf8" }).trim(), baseline.originDevTrackingRef);
assert.equal(queue.formalTaskIdAssignments.ids["G18-04"], "AF-106");
assert.equal(record?.alias, "G18-04");
assert.equal(record?.title, title);
assert.equal(record?.ownerAcceptance, "PENDING_UNIFIED_OWNER_CHECK");
assert.ok(["IN_PROGRESS", "CODE_VERIFIED"].includes(record?.status));
assert.equal(dependency?.status, "COMMITTED_AND_PUSHED");
assert.equal(dependency?.git?.status, "COMMITTED_AND_PUSHED");
assert.equal(taskRegistry["AF-106"]?.title, title);
assert.equal(queue.activeRun?.currentCard, "G18-04/AF-106");
assert.equal(baseline.originalIndexRecovered, false, "unavailable original Git index stays explicitly unrecovered");
for (const file of [
  "docs/execution/AF-106.md",
  "apps/api/prisma/migrations/20261101100000_payment_refund_request/migration.sql",
  "apps/api/src/plugins/aij-payment/payment-admin.controller.ts",
  "apps/api/src/plugins/aij-payment/payment-admin.service.ts",
  "apps/web/app/auth/payments/page.tsx",
  "apps/web/app/components/admin-payments.tsx"
]) assert.equal(existsSync(file), true, `AF-106 implementation file exists: ${file}`);
console.log("AF-106 assignment, frozen baseline, AF-105 dependency, owner, pending acceptance, and payment UI/API files verified.");
