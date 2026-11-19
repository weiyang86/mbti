import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const folder = "docs/planning/auto-ai-program-20261105/";
const read = p => JSON.parse(readFileSync(p, "utf8"));
const hash = b => createHash("sha256").update(b).digest("hex");
const git = (...args) => execFileSync("git", args);
assert.equal(git("branch", "--show-current").toString().trim(), "dev");
assert.equal(git("remote", "get-url", "origin").toString().trim(), "git@github.com:weiyang86/aij-foundation.git");
const program = read(folder + "program.json"), queue = read("docs/planning/CODING_QUEUE.json");
assert.equal(program.limits.automaticNextWave, true);
const wave = program.nextWaves.find(w => w.id === "W16");
assert.equal(wave.governanceCard, "AF-196"); assert.equal(wave.governanceTaskId, "task_13e0324e932e");
assert.equal(wave.estimatedHours, 11.75); assert.equal(wave.cards.reduce((sum, c) => sum + c.hours, .75), 11.75);
assert.equal(wave.workerLimits.maxActiveWorkersIncludingRoot, 4);
assert.equal(wave.workerLimits.dbWriters, 1); assert.equal(wave.workerLimits.heavyBuilds, 1); assert.equal(wave.workerLimits.nativeGui, 1);
assert.deepEqual(wave.cards.map(c => [c.id, c.model, c.effort]), [["AF-197", "gpt-6.1-sol", "high"], ["AF-198", "gpt-6-astra", "high"], ["AF-199", "gpt-6.1-sol", "high"]]);
assert.equal(git("rev-parse", "origin/dev").toString().trim(), wave.originDev);
git("merge-base", "--is-ancestor", wave.sourceHead, "HEAD");
assert.equal(program.nextWaves.find(w => w.id === "W15").status, "OWNER_CHECK_PENDING");
const sourcePath = folder + "W16/SOURCE_BOOTSTRAP.json", source = read(sourcePath), digest = hash(readFileSync(sourcePath));
assert.equal(source.sourceCommit, wave.sourceHead); assert.equal(source.originDev, wave.originDev);
assert.equal(source.files.length, 843);
const paths = new Set();
for (const file of source.files) {
  assert.ok(!paths.has(file.path)); paths.add(file.path);
  assert.match(file.path, /^(?:apps\/(?:api|web)\/|packages\/(?:contracts|core|runtime-contracts|sdk|ui)\/|scripts\/|(?:package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|tsconfig\.base\.json|eslint\.config\.mjs)$)/);
  assert.doesNotMatch(file.path, /(?:^|\/)(?:\.\.?|\._[^/]*|\.env[^/]*|node_modules|dist|\.next[^/]*|uploads|migrations)(?:\/|$)/);
  assert.equal(hash(git("show", wave.sourceHead + ":" + file.path)), file.sha256);
}
assert.equal(source.integrationEvidence.length, 5);
for (const e of source.integrationEvidence) {
  const row = queue.taskExecutions.find(r => r.formalTaskId === e.card);
  assert.equal(row.status, "CODE_VERIFIED"); assert.equal(row.integrationTaskId, e.integrationTaskId);
  assert.equal(read(e.report).status, "PASS");
  const receipt = read(".artifacts/auto-ai-program-20261105/" + e.card + "/I-complete.json");
  assert.equal(receipt.result.taskId, e.integrationTaskId); assert.equal(receipt.result.status, "completed");
  git("merge-base", "--is-ancestor", e.commit, "HEAD");
  assert.equal(git("show", "-s", "--format=%s", e.commit).toString().trim(), row.title);
}
const receipts = read(".artifacts/auto-ai-program-20261105/W16/task-receipts.json");
const ids = new Set(receipts.map(r => r.result.taskId ?? r.result.id ?? r.result.task?.id));
assert.equal(ids.size, 7); assert.ok(ids.has(wave.governanceTaskId));
const allow = new Set();
for (const c of wave.cards) {
  assert.deepEqual(c.bootstrapManifest, { path: sourcePath, sha256: digest, sourceCommit: wave.sourceHead });
  assert.ok(ids.has(c.candidateTaskId)); assert.ok(ids.has(c.integrationTaskId));
  assert.ok(c.codeDeps.includes(wave.governanceTaskId)); assert.ok(c.hours <= 4 && c.workerHoursLimit < c.hours);
  const spec = readFileSync(c.spec, "utf8");
  for (const token of [c.title, wave.sourceHead, wave.originDev, digest, "STOP ALL WRITING", "Candidate not CODE_VERIFIED", "ALLOW PATHS ONLY:"]) assert.ok(spec.includes(token));
  for (const path of c.allowPaths) { assert.ok(!allow.has(path)); allow.add(path); assert.ok(spec.includes("- " + path + "\n")); }
}
const dependency = read(folder + "W16/RENDERER_DEPENDENCY_PLAN.json");
assert.equal(dependency.docx.version, "9.15.2"); assert.equal(dependency.pdfkit.version, "0.20.2");
assert.equal(dependency.font.commit, "f8d157532fbfaeda587e826d4cd5b21a49186f7c");
assert.equal(dependency.font.files[0].sha256, "2c76254f6fc379fddfce0a7e84fb5385bb135d3e399294f6eeb6680d0365b74b");
for (const file of dependency.font.files) assert.equal(hash(readFileSync(".artifacts/auto-ai-program-20261105/W16/preparation/" + file.path)), file.sha256);
assert.match(dependency.linuxNodeImage, /^docker\.io\/library\/node@sha256:[a-f0-9]{64}$/);
const contract = readFileSync(folder + "W16/CONTRACT.md", "utf8");
for (const token of ["renderPlainDocument", "buildRuntimeBundle", "aij-plain-document-v1", "65536", "5MiB", "2048", "AF-198", "AiCenterHttpTransport.request", "不合成/修改Response", "native", "DEFERRED_NOT_PASSED"]) assert.ok(contract.includes(token), token);
for (const p of read(".artifacts/auto-ai-program-20261105/W16/preserved-before.json").filter(p => p.path.includes("AF-191") || p.path.includes("workbench-sdk-target") || p.path.endsWith("AIJ-Base-1.0-Orca-Execution-Playbook.md"))) assert.equal(hash(readFileSync(p.path)), p.sha256, p.path);
assert.ok(program.requirements.every(r => r.status === "NOT_RUN_TARGET_ACCEPTANCE"));
assert.notEqual(program.nextWaves.find(w => w.id === "W14").cards.find(c => c.id === "AF-191").status, "CODE_VERIFIED");
assert.equal(program.ownerExecutionDirectives.find(d => d.id === "OWNER_BLANK_CREDENTIALS_20261106").externalAcceptance, "DEFERRED_NOT_PASSED");
assert.equal(program.gitPolicy.pushCurrentLocalCommits, false); assert.equal(program.gitPolicy.mergeMain, false);
console.log(JSON.stringify({ status: "PASS", kind: "BOUNDED_GOVERNANCE_NOT_PRODUCT_ACCEPTANCE", wave: "W16", sourceFiles: source.files.length, hours: 11.75, cards: 4, codeTargetsAccepted: 0, vendorAcceptance: "DEFERRED_NOT_PASSED", ownerAcceptance: "PENDING" }));
