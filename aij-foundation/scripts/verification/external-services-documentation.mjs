import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const folder = "docs/planning/auto-ai-program-20261105/";
const read = p => JSON.parse(readFileSync(p, "utf8"));
const hash = value => createHash("sha256").update(value).digest("hex");
const git = (...args) => execFileSync("git", args);
assert.equal(git("branch", "--show-current").toString().trim(), "dev");
assert.equal(git("remote", "get-url", "origin").toString().trim(), "git@github.com:weiyang86/aij-foundation.git");
const program = read(folder + "program.json"), queue = read("docs/planning/CODING_QUEUE.json");
const card = program.nextWaves.find(w => w.id === "W15").cards.find(c => c.id === "AF-195");
assert.equal(card.candidateStopped, true);
assert.equal(read(card.writerStoppedEvidence).result.state, "released");
assert.equal(card.candidateCommit, "9e4c7f87647785de8373e6f3f670e302fb6c3fff");
assert.equal(card.documentationReview.receipt, "msg_4911dad8b586");
const manifest = read(card.bootstrapManifest.path);
assert.equal(hash(readFileSync(card.bootstrapManifest.path)), card.bootstrapManifest.sha256);
for (const file of manifest.files) assert.equal(hash(git("show", card.bootstrapCommit + ":" + file.path)), file.sha256);
assert.deepEqual(git("diff", "--name-only", card.bootstrapCommit, card.candidateCommit).toString().trim().split("\n").sort(), [...card.allowPaths].sort());
assert.deepEqual(readFileSync("docs/execution/AF-195-candidate.md"), git("show", card.candidateCommit + ":docs/execution/AF-195-candidate.md"));

const matrix = read(folder + "W15/EXTERNAL_SERVICES_ACCEPTANCE.json");
assert.equal(matrix.schemaVersion, 2);
assert.equal(matrix.sourceCommit, "7203fa0313e3eeec542bd735c25fe9a47a7eedba");
git("merge-base", "--is-ancestor", matrix.sourceCommit, "HEAD");
assert.equal(matrix.vendorAcceptance, "DEFERRED_NOT_PASSED");
assert.equal(matrix.targetAcceptance, "NOT_RUN_TARGET_ACCEPTANCE");
assert.equal(matrix.ownerAcceptance, "PENDING");
assert.equal(matrix.integrations.length, 2);
for (const integration of matrix.integrations) {
  const row = queue.taskExecutions.find(r => r.formalTaskId === integration.card);
  assert.equal(row.status, "CODE_VERIFIED");
  assert.equal(row.integrationTaskId, integration.taskId);
  const receipt = read(".artifacts/auto-ai-program-20261105/" + integration.card + "/I-complete.json");
  assert.equal(receipt.result.taskId, integration.taskId); assert.equal(receipt.result.status, "completed");
  assert.equal(git("show", "-s", "--format=%s", integration.commit).toString().trim(), row.title);
  git("merge-base", "--is-ancestor", integration.commit, "HEAD");
  const report = read(row.report); assert.equal(report.status, "PASS");
  assert.ok([...report.prerequisites, ...report.steps].every(s => s.effectiveExitCode === 0 && !s.tests?.skipped && !s.tests?.failed));
}
assert.equal(matrix.sourceAnchors.length, 8);
for (const source of matrix.sourceAnchors) {
  assert.equal(hash(readFileSync(source.path)), source.sha256);
  assert.equal(hash(git("show", matrix.sourceCommit + ":" + source.path)), source.sha256);
}
assert.equal(matrix.evidenceSources.length, 4);
for (const e of matrix.evidenceSources) assert.equal(hash(readFileSync(e.path)), e.sha256);
const guiPath = matrix.evidenceSources.find(e => /browser-.*-evidence\.json$/.test(e.path)).path;
const gui = read(guiPath), closed = read(matrix.evidenceSources.find(e => /closed-/.test(e.path)).path);
assert.equal(gui.status, "PASS"); assert.equal(gui.leaseId, "15299139377d232b");
assert.equal(gui.buildId, "Q0wR9ACwg1jpj_aqT4AjP");
assert.deepEqual(gui.cases, ["desktop-blank-draft", "unknown-save-explicit-get", "cas-preserves-user-draft", "unmount-stale-read", "mobile390", "current-permission-refusal"]);
assert.equal(gui.trueOsDocumentHidden, "NOT_PROVEN_HERE_AF191_REMAINS_PENDING");
assert.equal(closed.acceptanceId, gui.leaseId); assert.equal(closed.status, "CLOSED");
assert.equal(closed.ownedSockets, 0); assert.equal(closed.applicationPools, 0); assert.equal(closed.fixtureClosed, true);
assert.equal(matrix.scenarios.length, 10);
assert.equal(new Set(matrix.scenarios.map(s => s.id)).size, 10);
const sources = new Set(matrix.evidenceSources.map(e => e.path));
let checks = 0;
for (const scenario of matrix.scenarios) {
  assert.equal(scenario.evidenceReviewedByRoot, true);
  assert.ok(scenario.steps.length && scenario.expected.length && scenario.checks.length);
  assert.equal(scenario.overallStatus, scenario.checks.some(c => c.status !== "PASS" && c.layer !== "VENDOR") ? "PARTIAL" : "PASS_LOCAL_SCOPE");
  for (const check of scenario.checks) {
    checks++;
    assert.ok(["PASS", "PARTIAL", "NOT_RUN"].includes(check.status));
    if (check.status === "NOT_RUN") { assert.equal(check.evidenceRef, null); assert.ok(check.remaining); continue; }
    const [path, fragment] = check.evidenceRef.split("#"); assert.ok(sources.has(path));
    if (fragment) {
      if (path === guiPath) assert.ok(gui.cases.includes(fragment));
      else assert.ok(read(path).steps.some(s => s.id === fragment && s.effectiveExitCode === 0));
    }
  }
}
for (const id of ["catalog-14", "secret-ref", "private-data", "responsive-keyboard"]) assert.equal(matrix.scenarios.find(s => s.id === id).overallStatus, "PARTIAL");
const doc = readFileSync("docs/development/EXTERNAL_SERVICES_CONFIGURATION.md", "utf8");
for (const token of ["/auth/configuration", "admin.config.manage", "admin.secret.manage", "credentialRefs", "null", "expectedVersion", "读取最新版本", "确认使用最新版本", "手动保存", "configuredTrusted → exists", "AbortSignal", "epoch", "DEFERRED_NOT_PASSED", "不是客户端 Workspace", "站内信", "reset/drop"]) assert.ok(doc.includes(token), token);
assert.ok(program.requirements.every(r => r.status === "NOT_RUN_TARGET_ACCEPTANCE"));
assert.equal(program.gitPolicy.pushCurrentLocalCommits, false);
console.log(JSON.stringify({ status: "PASS", kind: "DOCUMENT_SOURCE_AND_EXISTING_EVIDENCE_INTEGRITY_ONLY", task: "AF-195", candidateDelta: 3, sourceAnchors: 8, scenarios: 10, checks, targetAcceptanceAdded: 0, vendorAcceptance: matrix.vendorAcceptance, ownerAcceptance: "PENDING" }));
