import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const root = "/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation";
const source = "48e8d26ea1dcd67df65d316a0edfdec4bcb2d502";
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const read = path => JSON.parse(readFileSync(path, "utf8"));
assert.equal(process.cwd(), root);
assert.equal(git("branch", "--show-current"), "dev");
assert.equal(git("remote", "get-url", "origin"), "git@github.com:weiyang86/aij-foundation.git");
assert.equal(git("rev-parse", "origin/dev"), "94b0236f775fa40a07944c5e0545ac6ce0e123f3");
git("merge-base", "--is-ancestor", source, "HEAD");
const manifest = read("docs/planning/auto-ai-program-20261105/program.json");
const queue = read("docs/planning/CODING_QUEUE.json");
const previous = manifest.nextWaves.find(w => w.id === "W12");
assert.equal(previous.status, "OWNER_CHECK_PENDING");
assert.equal(previous.effectiveEngineeringHoursEstimated, 8);
for (const id of ["AF-180", "AF-181", "AF-182", "AF-183"]) {
  const row = queue.taskExecutions.find(row => row.formalTaskId === id);
  assert.equal(row.status, "CODE_VERIFIED");
  assert.equal(row.ownerAcceptance, "PENDING");
  assert.equal(read(row.report).status, "PASS");
  const folder = id === "AF-180" ? "W12" : id;
  const receipt = read(".artifacts/auto-ai-program-20261105/" + folder + "/I-complete.json");
  assert.equal(receipt.result.taskId, row.integrationTaskId);
  assert.equal(receipt.result.status, "completed");
}
const wave = manifest.nextWaves.find(w => w.id === "W13");
assert.equal(wave.estimatedHours, 9.75);
assert.equal(wave.cards.length, 3);
assert.equal(wave.workerLimits.readOnlyAuditWorkers, 3);
assert.equal(wave.workerLimits.productCodeWorkers, 0);
assert.equal(wave.workerLimits.maxActiveWorkersIncludingRoot, 4);
const covered = [];
for (const card of wave.cards) {
  assert.equal(card.readOnlyAudit, true);
  assert.equal(card.readSourceCommit, source);
  assert.deepEqual(card.bootstrap, []);
  assert.equal(card.hours, 3);
  assert.equal(card.allowPaths.length, 3);
  assert.match(readFileSync(card.spec, "utf8"), /NOT_RUN_BY_THIS_AUDIT/);
  assert.match(readFileSync(card.spec, "utf8"), /No CODE_VERIFIED\/AC PASS inference from source alone/);
  covered.push(...card.requirements);
}
assert.deepEqual(covered.sort(), manifest.requirements.map(r => r.id).sort());
assert.ok(manifest.requirements.every(r => r.status === "NOT_RUN_TARGET_ACCEPTANCE"));
const inputs = read("docs/planning/auto-ai-program-20261105/W13/audit-inputs.json");
assert.equal(inputs.sourceHead, source);
assert.equal(inputs.rootReadOnly, root);
const paths = new Set();
for (const report of inputs.approvedReports) {
  assert.match(report.path, /^\.artifacts\/verification\/AF-[A-Za-z0-9-]+\/run-[A-Za-z0-9]+\/report\.json$/);
  assert.ok(!paths.has(report.path)); paths.add(report.path);
  const raw = readFileSync(report.path);
  assert.equal(createHash("sha256").update(raw).digest("hex"), report.sha256);
  assert.equal(JSON.parse(raw).status, "PASS");
}
console.log(JSON.stringify({ status: "PASS", kind: "read-only-target-audit-governance-not-product-acceptance", source, requirements: covered.length, approvedReports: paths.size, workers: 3, noBootstrap: true }));
