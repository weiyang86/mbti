import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const queue = JSON.parse(readFileSync("docs/planning/CODING_QUEUE.json", "utf8"));
const baseline = JSON.parse(readFileSync(".artifacts/continuous/2026-11-01-to-G19/AF-100-baseline.json", "utf8"));
const assignmentHistory = queue.formalTaskIdAssignmentsHistory.flatMap(entry => Object.entries(entry.ids ?? {})
  .filter(([alias, id]) => alias === "G17-02" || id === "AF-100"));
const dependency = queue.taskExecutions.find(entry => entry.formalTaskId === "AF-099");
const task = queue.taskExecutions.find(entry => entry.formalTaskId === "AF-100");
const run = args => execFileSync("git", ["--no-optional-locks", ...args], { encoding: "utf8" }).trim();

assert.equal(process.versions.node.split(".")[0], "24");
assert.equal(run(["branch", "--show-current"]), "dev");
assert.equal(run(["rev-parse", "HEAD"]), baseline.head, "no different commit was introduced while AF-100 was in progress");
assert.equal(run(["rev-parse", "origin/dev"]), baseline.originDev, "origin/dev tracking baseline is unchanged before closeout");
assert.equal(baseline.branch, "dev");
assert.equal(baseline.head, baseline.originDev);
assert.equal(baseline.ordinaryIndexSha256, "56d3468e5d0750b00170c69213edb42943765e0364331a5917498ef067ae7755");
assert.deepEqual(baseline.af100CollisionScan.workingTreeMatches, []);
assert.equal(baseline.af100CollisionScan.executionFileExists, false);
assert.equal(baseline.af100CollisionScan.history, "");
assert.equal(queue.formalTaskIdAssignments.batch, "NEXT-17");
assert.equal(queue.formalTaskIdAssignments.ids["G17-02"], "AF-100");
assert.equal(assignmentHistory.length, 1, "AF-100 is assigned exactly once to G17-02");
assert.equal(dependency?.alias, "G17-01");
assert.equal(dependency?.formalTaskId, "AF-099");
assert.equal(dependency?.status, "CODE_VERIFIED");
assert.equal(dependency?.git?.status, "COMMITTED_AND_PUSHED");
assert.equal(dependency?.ownerAcceptance, "PENDING_UNIFIED_OWNER_CHECK");
assert.equal(task?.alias, "G17-02");
assert.equal(task?.title, "webhook 签名验证、时间窗、防重放和幂等入站记录");
assert.ok(["IN_PROGRESS", "CODE_VERIFIED"].includes(task?.status));
assert.equal(queue.nextCardCandidate?.formalTaskId, "AF-100");
assert.equal(queue.nextCardCandidate?.title, task.title);
assert.equal(task?.ownerAcceptance, "PENDING_UNIFIED_OWNER_CHECK");
assert.equal(queue.proposedBatches.find(batch => batch.id === "NEXT-17")?.formalTaskIds?.["G17-02"], "AF-100");
for (const file of [
  "apps/api/src/integration-center/integration-center.module.ts",
  "apps/api/src/integration-center/connector-manifest.ts",
  "apps/api/src/secret-center/secret-ref.ts",
  "apps/api/src/secret-center/secret-center.service.ts",
  "apps/api/src/prisma/prisma.service.ts",
  "apps/api/prisma/schema.prisma",
  "apps/api/prisma/migrations/20261101010000_integration_connector_installation/migration.sql",
  "scripts/verification/runtime-fixture.mjs",
  "docs/generated/PRISMA_MODEL_OWNERSHIP.csv"
]) assert.ok(existsSync(file), "required existing owner/AF-099 dependency exists: " + file);
console.log("AF-100 preflight: collision scan, AF-099 dependency, dev baseline, PostgreSQL owner and Integration/SecretCenter boundaries verified");
