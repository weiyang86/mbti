import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { taskRegistry } from "./registry.mjs";

const paths = [
  "docs/development/AI_KNOWLEDGE_QA.md",
  "docs/current/CURRENT_STATE.md",
  "docs/execution/AF-111.md",
  "docs/planning/CODING_QUEUE.json",
  "scripts/verification/g19-knowledge-evaluation.cases.mjs",
  "scripts/verification/g19-knowledge-evaluation.cases.test.mjs",
  "scripts/verification/g19-knowledge-evaluation.diff-check.mjs",
  "scripts/verification/g19-knowledge-evaluation-http-db.test.mjs",
  "scripts/verification/g19-knowledge-evaluation.preflight.mjs",
  "scripts/verification/registry.mjs"
];
const entry = taskRegistry["AF-111"];
assert.ok(entry, "AF-111 is registered");
assert.equal(entry.title, "20例合成知识问答评测与跨工作区真实HTTP回归");
assert.ok(entry.steps.some(step => step.id === "synthetic-case-contract" && step.testFiles.includes("scripts/verification/g19-knowledge-evaluation.cases.test.mjs")));
assert.ok(entry.steps.some(step => step.id === "real-http-postgresql-evaluation" && step.testFiles.includes("scripts/verification/g19-knowledge-evaluation-http-db.test.mjs")));

for (const path of paths) {
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  assert.equal(lines.some(line => /^(?:<{7} |={7}$|>{7} )/.test(line)), false, `${path}: no merge conflict marker`);
  assert.equal(lines.some(line => /[\t ]+$/.test(line)), false, `${path}: no trailing whitespace`);
}
JSON.parse(readFileSync("docs/planning/CODING_QUEUE.json", "utf8"));
const env = { ...process.env, GIT_INDEX_FILE: ".artifacts/continuous/2026-11-01-to-G19/AF-107-working.index" };
execFileSync("git", ["--no-optional-locks", "diff", "--check", "--", ...paths], { stdio: "inherit", env });
execFileSync("git", ["--no-optional-locks", "diff", "--cached", "--check", "HEAD", "--", ...paths], { stdio: "inherit", env });
console.log(`AF-111 queue JSON, registration/test binding, conflict markers, whitespace and isolated-index diff checks passed for ${paths.length} paths.`);
