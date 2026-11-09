import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { posix } from "node:path";

const task = process.argv[2];
assert.ok(["AF-185", "AF-186", "AF-187"].includes(task));
assert.equal(process.argv.length, 3);
assert.equal(process.cwd(), "/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation");
const git = (...args) => execFileSync("git", args, { maxBuffer: 16 * 1024 * 1024 });
const read = path => JSON.parse(readFileSync(path, "utf8"));
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const source = "48e8d26ea1dcd67df65d316a0edfdec4bcb2d502";
assert.equal(git("branch", "--show-current").toString().trim(), "dev");
git("merge-base", "--is-ancestor", source, "HEAD");
const manifest = read("docs/planning/auto-ai-program-20261105/program.json");
const card = manifest.nextWaves.find(w => w.id === "W13").cards.find(c => c.id === task);
const row = read("docs/planning/CODING_QUEUE.json").taskExecutions.find(r => r.formalTaskId === task);
assert.equal(row.candidateStopped, true);
assert.equal(row.candidateCommit, card.candidateCommit);
assert.match(row.candidateCommit, /^[a-f0-9]{40}$/);
assert.equal(git("rev-parse", row.candidateCommit + "^").toString().trim(), manifest.workerBase);
const actualPaths = git("diff-tree", "--no-commit-id", "--name-only", "-r", row.candidateCommit).toString().trim().split("\n");
assert.deepEqual(actualPaths.sort(), [...card.allowPaths].sort());
for (const path of card.allowPaths) assert.deepEqual(readFileSync(path), git("show", row.candidateCommit + ":" + path));
const auditPath = card.allowPaths.find(p => p.endsWith("_TARGET_AUDIT.json"));
const audit = read(auditPath);
const narrative = readFileSync(card.allowPaths.find(p => p.endsWith("_TARGET_AUDIT.md")), "utf8");
const exact = (object, keys) => assert.deepEqual(Object.keys(object).sort(), [...keys].sort());
exact(audit, ["schemaVersion", "taskId", "title", "sourceHead", "requirementIds", "requirements", "suggestedCards", "limitations", "workerEngineeringHours"]);
assert.equal(audit.schemaVersion, 1);
assert.equal(audit.taskId, task);
assert.equal(audit.title, card.title);
assert.equal(audit.sourceHead, source);
assert.deepEqual(audit.requirementIds, card.requirements);
assert.deepEqual(audit.requirements.map(r => r.id), card.requirements);
assert.ok(audit.workerEngineeringHours > 0 && audit.workerEngineeringHours <= 1.5);
const baseline = JSON.parse(git("show", source + ":docs/planning/ai-platform-baseline-20261105/traceability.json"));
const acceptance = git("show", source + ":docs/planning/ai-platform-baseline-20261105/DELIVERY_AND_ACCEPTANCE.md").toString("utf8");
const oldManifest = JSON.parse(git("show", source + ":docs/planning/auto-ai-program-20261105/program.json"));
const oldQueue = JSON.parse(git("show", source + ":docs/planning/CODING_QUEUE.json"));
const integrationIds = new Set([oldManifest.governanceTaskId, ...[oldManifest.wave1, ...oldManifest.nextWaves].flatMap(w => [w.governanceTaskId, ...w.cards.map(c => c.integrationTaskId)]), ...oldQueue.taskExecutions.map(r => r.integrationTaskId)].filter(Boolean));
const approved = new Map(read("docs/planning/auto-ai-program-20261105/W13/audit-inputs.json").approvedReports.map(r => [r.path, r]));
const strings = (items, allowEmpty = false) => {
  assert.ok(Array.isArray(items) && (allowEmpty || items.length > 0));
  assert.ok(items.every(item => typeof item === "string" && item.trim().length > 0));
};
const pathCheck = path => {
  assert.ok(typeof path === "string" && path === posix.normalize(path) && !path.startsWith("/") && !path.split("/").includes(".."));
  assert.doesNotMatch(path, /(?:^|\/)(?:\.env[^/]*|\.git|node_modules)(?:\/|$)|[\r\n\0]/);
};
const blobs = new Map(), reports = new Map();
let sourceAnchors = 0, reportReferences = 0;
for (const requirement of audit.requirements) {
  exact(requirement, ["id", "title", "acceptanceId", "coverage", "targetAcceptance", "sourceEvidence", "runtimeEvidence", "currentSurface", "remainingScenarios", "externalInputs", "closurePlan"]);
  const frozen = baseline.requirements.find(r => r.id === requirement.id);
  assert.equal(requirement.title, frozen.title);
  assert.equal(requirement.acceptanceId, frozen.acceptanceId);
  assert.ok(narrative.includes(frozen.requirement), "frozen requirement text changed: " + requirement.id);
  const scenario = acceptance.split("\n").find(line => line.startsWith("| " + frozen.acceptanceId + " |"));
  assert.ok(scenario);
  for (const text of scenario.split("|").slice(3, 5).map(text => text.trim())) assert.ok(narrative.includes(text), "frozen acceptance text changed: " + frozen.acceptanceId);
  assert.ok(["READY_FOR_TARGET_ACCEPTANCE", "PARTIAL", "MISSING", "UNPROVEN"].includes(requirement.coverage));
  assert.equal(requirement.targetAcceptance, "NOT_RUN_BY_THIS_AUDIT");
  assert.ok(typeof requirement.currentSurface === "string" && requirement.currentSurface.trim());
  strings(requirement.remainingScenarios); strings(requirement.closurePlan); strings(requirement.externalInputs, true);
  assert.ok(Array.isArray(requirement.sourceEvidence) && Array.isArray(requirement.runtimeEvidence));
  for (const evidence of requirement.sourceEvidence) {
    exact(evidence, ["path", "sha256", "lineStart", "lineEnd", "claim"]); pathCheck(evidence.path);
    assert.match(evidence.path, /^(?:apps\/api\/(?:src|prisma)\/|apps\/web\/app\/|packages\/|scripts\/|docs\/|package\.json$|pnpm-lock\.yaml$|pnpm-workspace\.yaml$|Dockerfile$|compose[^/]*\.ya?ml$)/);
    if (!blobs.has(evidence.path)) blobs.set(evidence.path, git("show", source + ":" + evidence.path));
    const blob = blobs.get(evidence.path);
    assert.equal(digest(blob), evidence.sha256);
    assert.ok(Number.isInteger(evidence.lineStart) && Number.isInteger(evidence.lineEnd) && evidence.lineStart >= 1 && evidence.lineEnd >= evidence.lineStart);
    assert.ok(evidence.lineEnd <= blob.toString("utf8").split("\n").length && evidence.lineEnd - evidence.lineStart < 100);
    assert.ok(typeof evidence.claim === "string" && evidence.claim.trim()); sourceAnchors++;
  }
  for (const evidence of requirement.runtimeEvidence) {
    exact(evidence, ["report", "sha256", "claim", "limits"]);
    assert.equal(approved.get(evidence.report)?.sha256, evidence.sha256, "unapproved runtime evidence");
    if (!reports.has(evidence.report)) {
      const bytes = readFileSync(evidence.report); assert.equal(digest(bytes), evidence.sha256);
      const report = JSON.parse(bytes); assert.equal(report.status, "PASS"); assert.equal(report.exitCode, 0);
      for (const step of [...report.prerequisites, ...report.steps]) {
        assert.equal(step.effectiveExitCode, 0); assert.ok(!step.timedOut && !step.overflow);
        if (step.tests) for (const key of ["failed", "skipped", "cancelled", "todo"]) assert.equal(step.tests[key] ?? 0, 0);
      }
      reports.set(evidence.report, report);
    }
    assert.ok(typeof evidence.claim === "string" && evidence.claim.trim());
    assert.ok(typeof evidence.limits === "string" && evidence.limits.trim()); reportReferences++;
  }
}
assert.ok(Array.isArray(audit.suggestedCards) && audit.suggestedCards.length > 0 && audit.suggestedCards.length <= 3);
const proposalKeys = new Set(audit.suggestedCards.map(c => c.key)), writerPaths = new Set();
assert.equal(proposalKeys.size, audit.suggestedCards.length);
for (const proposal of audit.suggestedCards) {
  exact(proposal, ["key", "title", "hoursIncludingRoot", "allowPaths", "rootWiring", "dependsOnIntegrationTasks", "dependsOnProposals", "outcome", "acceptance", "closesRequirements", "remainingAfterCard"]);
  assert.ok(typeof proposal.title === "string" && proposal.title.trim());
  assert.ok(proposal.hoursIncludingRoot > 0 && proposal.hoursIncludingRoot <= 4);
  strings(proposal.allowPaths); strings(proposal.rootWiring, true); strings(proposal.acceptance); strings(proposal.remainingAfterCard);
  for (const path of proposal.allowPaths) { pathCheck(path); assert.ok(!writerPaths.has(path), "overlapping proposed Writers: " + path); writerPaths.add(path); }
  for (const path of proposal.rootWiring) pathCheck(path);
  strings(proposal.dependsOnIntegrationTasks, true); strings(proposal.dependsOnProposals, true); strings(proposal.closesRequirements, true);
  for (const dependency of proposal.dependsOnIntegrationTasks) assert.ok(integrationIds.has(dependency), "not a real integration dependency: " + dependency);
  for (const dependency of proposal.dependsOnProposals) assert.ok(proposalKeys.has(dependency) && dependency !== proposal.key);
  for (const id of proposal.closesRequirements) assert.ok(card.requirements.includes(id));
  assert.ok(typeof proposal.outcome === "string" && proposal.outcome.trim());
}
strings(audit.limitations);
const visit = (key, chain = []) => {
  assert.ok(!chain.includes(key), "proposed dependency cycle");
  for (const dependency of audit.suggestedCards.find(c => c.key === key).dependsOnProposals) visit(dependency, [...chain, key]);
};
for (const key of proposalKeys) visit(key);
const directory = ".artifacts/auto-ai-program-20261105/" + task; mkdirSync(directory, { recursive: true });
const result = { status: "PASS", kind: "audit-document-integrity-not-product-or-target-acceptance", task, source, requirements: audit.requirements.length, sourceBlobs: blobs.size, sourceAnchors, reports: reports.size, reportReferences, proposals: audit.suggestedCards.length, coverage: audit.requirements.reduce((counts, r) => ({ ...counts, [r.coverage]: (counts[r.coverage] ?? 0) + 1 }), {}) };
writeFileSync(directory + "/review-proof.json", JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result));
