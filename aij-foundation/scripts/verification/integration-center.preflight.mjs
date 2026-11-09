import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const queue = JSON.parse(readFileSync("docs/planning/CODING_QUEUE.json", "utf8"));
const baseline = JSON.parse(readFileSync(".artifacts/continuous/2026-11-01-to-G19/AF-099-baseline.json", "utf8"));
const task = queue.taskExecutions.find(row => row.formalTaskId === "AF-099");
const assignment = queue.formalTaskIdAssignmentsHistory.flatMap(entry => Object.entries(entry.ids ?? {}).filter(([alias, id]) => alias === "G17-01" || id === "AF-099"));
const next05 = queue.proposedBatches.find(row => row.id === "NEXT-05");
const next10b = queue.proposedBatches.find(row => row.id === "NEXT-10B");
const next16 = queue.proposedBatches.find(row => row.id === "NEXT-16");

assert.equal(process.versions.node.split(".")[0], "24");
assert.equal(execFileSync("git", ["--no-optional-locks", "branch", "--show-current"], { encoding: "utf8" }).trim(), "dev");
assert.equal(execFileSync("git", ["--no-optional-locks", "rev-parse", "HEAD"], { encoding: "utf8" }).trim(), baseline.head);
assert.equal(execFileSync("git", ["--no-optional-locks", "rev-parse", "origin/dev"], { encoding: "utf8" }).trim(), baseline.originDevTrackingRef);
assert.equal(baseline.liveOriginDev, baseline.head);
assert.equal(next05?.status, "CODE_VERIFIED_OWNER_CHECK_PENDING");
assert.equal(next10b?.status, "CODE_VERIFIED_PUSHED_OWNER_CHECK_PENDING");
assert.equal(next16?.status, "OWNER_CHECK_PENDING");
assert.equal(queue.formalTaskIdAssignments.batch, "NEXT-17");
assert.equal(queue.formalTaskIdAssignments.ids["G17-01"], "AF-099");
assert.equal(assignment.length, 1, "one unique G17-01/AF-099 assignment exists");
assert.equal(task?.alias, "G17-01");
assert.equal(task?.title, "Connector manifest、scope、SecretRef 和 allowlist");
assert.ok(["IN_PROGRESS", "CODE_VERIFIED"].includes(task?.status));
assert.equal(task?.ownerAcceptance, "PENDING_UNIFIED_OWNER_CHECK");
assert.equal(queue.activeRun.currentCard, "G17-01/AF-099");
assert.equal(queue.proposedBatches.find(row => row.id === "NEXT-17")?.formalTaskIds?.["G17-01"], "AF-099");
assert.equal(baseline.formalIdCollisionScan.allocation, "AF-099 uniquely available for G17-01");
for (const file of [
  "apps/api/src/secret-center/secret-ref.ts",
  "apps/api/src/secret-center/secret-center.module.ts",
  "apps/api/src/rbac/management-access.service.ts",
  "apps/api/src/prisma/prisma.service.ts",
  "apps/api/prisma/schema.prisma",
  "scripts/verification/runtime-fixture.mjs",
  "scripts/verification/rbac-fixture.mjs"
]) assert.ok(existsSync(file), "required shared owner exists: " + file);
console.log("AF-099 preflight: unique assignment, satisfied code dependencies, current dev baseline and shared owners verified");
