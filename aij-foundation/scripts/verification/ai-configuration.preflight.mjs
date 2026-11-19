import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { schemaInvocation } from "../prisma-schema.mjs";

const queue = JSON.parse(readFileSync("docs/planning/CODING_QUEUE.json", "utf8"));
const assignment = queue.formalTaskIdAssignments;
const task = queue.taskExecutions.find(row => row.formalTaskId === "AF-095");
const historicalMatches = queue.formalTaskIdAssignmentsHistory.flatMap(row => Object.entries(row.ids || {}).filter(([, id]) => id === "AF-095"));
assert.equal(process.versions.node.split(".")[0], "24");
schemaInvocation(["validate"]);
assert.equal(assignment?.batch, "NEXT-16");
assert.equal(assignment?.ids?.["G16-01"], "AF-095");
assert.equal(historicalMatches.length, 1);
assert.equal(task?.alias, "G16-01");
assert.equal(task?.status, "IN_PROGRESS");
assert.equal(queue.proposedBatches.find(row => row.id === "NEXT-15B")?.status, "OWNER_CHECK_PENDING");
for (const id of ["AF-093", "AF-094"]) {
  const dependency = queue.taskExecutions.find(row => row.formalTaskId === id);
  assert.equal(dependency?.status, "CODE_VERIFIED");
  assert.equal(dependency?.git?.status, "COMMITTED_AND_PUSHED");
}
const head = execFileSync("git", ["--no-optional-locks", "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const base = JSON.parse(readFileSync(".artifacts/continuous/2026-11-01-to-G19/AF-095-baseline.json", "utf8"));
assert.equal(head, base.head);
assert.equal(execFileSync("git", ["--no-optional-locks", "rev-parse", "origin/dev"], { encoding: "utf8" }).trim(), base.originDevTrackingRef);
for (const file of ["apps/api/src/plugins/aij-ai/ai-provider.ts", "apps/api/src/plugins/aij-ai/ai-runtime.module.ts", "apps/web/app/components/admin-configuration.tsx"]) assert.ok(readFileSync(file, "utf8").length > 0);
console.log("AF-095 assignment unique; AF-093/094 dependencies code-verified and pushed; baseline/head tracking ref and AI/Web owner files verified");
