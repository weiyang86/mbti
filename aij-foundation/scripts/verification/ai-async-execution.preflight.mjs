import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { schemaInvocation } from "../prisma-schema.mjs";
import { repositoryRoot } from "../database/connection.mjs";

assert.equal(process.versions.node.split(".")[0], "24", "repository Node major is 24");
schemaInvocation(["validate"]);
const queue = JSON.parse(readFileSync(new URL("../../docs/planning/CODING_QUEUE.json", import.meta.url), "utf8"));
assert.equal(queue.nextCardCandidate?.formalTaskId, "AF-092");
assert.equal(queue.nextCardCandidate?.alias, "G15-02");
assert.equal(queue.formalTaskIdAssignments?.ids?.["G15-02"], "AF-092");
const executions = queue.taskExecutions || [];
const current = executions.find(entry => entry.formalTaskId === "AF-092");
const prerequisite = executions.find(entry => entry.formalTaskId === "AF-091");
assert.equal(current?.status, "IN_PROGRESS");
assert.equal(prerequisite?.status, "CODE_VERIFIED");
assert.equal(prerequisite?.git?.status, "COMMITTED_AND_PUSHED");
assert.equal(repositoryRoot, process.cwd(), "verification is running from this repository root");
console.log("AF-092 preflight: frozen queue assignment, AF-091 code/push dependency and Node/Prisma schema verified");
