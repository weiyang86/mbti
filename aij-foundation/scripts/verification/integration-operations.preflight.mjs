import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const queue = JSON.parse(readFileSync("docs/planning/CODING_QUEUE.json", "utf8"));
const baseline = JSON.parse(readFileSync(".artifacts/continuous/2026-11-01-to-G19/AF-101-baseline.json", "utf8"));
const task = queue.taskExecutions.find(row => row.formalTaskId === "AF-101");
const run = args => execFileSync("git", ["--no-optional-locks", ...args], { encoding: "utf8" }).trim();
const assignment = queue.formalTaskIdAssignmentsHistory.flatMap(entry => Object.entries(entry.ids ?? {}).filter(([alias, id]) => alias === "G17-03" || id === "AF-101"));
const previous = ["AF-099", "AF-100"].map(id => queue.taskExecutions.find(row => row.formalTaskId === id));

assert.equal(process.versions.node.split(".")[0], "24");
assert.equal(run(["branch", "--show-current"]), "dev");
assert.equal(run(["rev-parse", "HEAD"]), baseline.head, "AF-101 remains on its captured started-card baseline until code verification closes");
assert.equal(run(["rev-parse", "origin/dev"]), baseline.originDev);
assert.equal(baseline.originDev, baseline.head, "captured origin/dev matched the card baseline");
assert.equal(queue.formalTaskIdAssignments.batch, "NEXT-17");
assert.equal(queue.formalTaskIdAssignments.ids["G17-03"], "AF-101");
assert.equal(assignment.length, 1, "AF-101 is assigned only once to G17-03");
assert.equal(task?.alias, "G17-03");
assert.equal(task?.title, "失败重试/操作查询/权限页面及真实 HTTP/DB 测试");
assert.ok(["IN_PROGRESS", "CODE_VERIFIED"].includes(task?.status), "AF-101 remains the active card through verified Git closeout");
assert.equal(task?.ownerAcceptance, "PENDING_UNIFIED_OWNER_CHECK");
assert.equal(queue.activeRun.currentCard, "G17-03/AF-101");
assert.deepEqual(previous.map(row => row?.formalTaskId), ["AF-099", "AF-100"]);
assert.deepEqual(previous.map(row => row?.status), ["CODE_VERIFIED", "CODE_VERIFIED"]);
assert.deepEqual(previous.map(row => row?.git?.status), ["COMMITTED_AND_PUSHED", "COMMITTED_AND_PUSHED"], "code dependency cards have isolated pushes recorded");
assert.ok(previous.every(row => row?.ownerAcceptance === "PENDING_UNIFIED_OWNER_CHECK"), "pending owner acceptance is not rewritten");
assert.equal(baseline.collisionScan.allocation, "AF-101 uniquely available for G17-03");
for (const file of [
  "apps/api/src/integration-center/integration-center.module.ts",
  "apps/api/src/integration-center/connector-webhook.service.ts",
  "apps/api/src/secret-center/secret-ref.ts",
  "apps/api/src/rbac/management-access.service.ts",
  "apps/api/src/prisma/prisma.service.ts",
  "apps/web/app/components/admin-shell.tsx",
  "scripts/verification/runtime-fixture.mjs",
  "scripts/verification/rbac-fixture.mjs"
]) assert.ok(existsSync(file), "required owner exists: " + file);
console.log("AF-101 preflight: collision assignment, code dependencies, captured dev baseline, IntegrationCenter/SecretCenter/RBAC/Web owners verified");
