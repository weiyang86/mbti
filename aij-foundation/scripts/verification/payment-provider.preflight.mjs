import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { taskRegistry } from "./registry.mjs";

const queue = JSON.parse(readFileSync("docs/planning/CODING_QUEUE.json", "utf8"));
const baseline = JSON.parse(readFileSync(".artifacts/continuous/2026-11-01-to-G19/AF-103-baseline.json", "utf8"));
const task = queue.taskExecutions.find(entry => entry.formalTaskId === "AF-103");
assert.equal(execFileSync("git", ["--no-optional-locks", "branch", "--show-current"], { encoding: "utf8" }).trim(), "dev");
assert.equal(execFileSync("git", ["--no-optional-locks", "rev-parse", "HEAD"], { encoding: "utf8" }).trim(), baseline.head);
assert.equal(execFileSync("git", ["--no-optional-locks", "rev-parse", "origin/dev"], { encoding: "utf8" }).trim(), baseline.trackingRef);
assert.equal(queue.formalTaskIdAssignments.ids["G18-01"], "AF-103");
assert.equal(task?.alias, "G18-01");
assert.ok(["IN_PROGRESS", "CODE_VERIFIED"].includes(task?.status), "AF-103 must be actively executed or code verified");
assert.equal(task?.ownerAcceptance, "PENDING_UNIFIED_OWNER_CHECK");
assert.equal(taskRegistry["AF-103"]?.title, task?.title);
for (const file of [
  "docs/execution/AF-103.md",
  "apps/api/src/plugins/aij-payment/payment-provider.ts",
  "apps/api/src/plugins/aij-payment/payment-state.ts",
  "scripts/verification/payment-provider-contract.test.mjs"
]) assert.equal(existsSync(file), true, `missing registered source: ${file}`);
const schema = readFileSync("apps/api/prisma/schema.prisma", "utf8");
assert.equal(/^model Payment(?:Order|Attempt|Transaction)\s*\{/m.test(schema), false,
  "G18-01 must not preempt G18-02 persistence/API ownership");
const contract = readFileSync("apps/api/src/plugins/aij-payment/payment-provider.ts", "utf8");
assert.equal(contract.includes("qingqi-ai-consultant"), false);
console.log("AF-103 assignment, frozen baseline, unique Payment provider owner, and deferred G18-02 persistence boundary verified.");
