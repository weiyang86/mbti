import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const folder = "docs/planning/auto-ai-program-20261105/";
const read = path => JSON.parse(readFileSync(path, "utf8"));
const hash = value => createHash("sha256").update(value).digest("hex");
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
assert.equal(process.cwd(), "/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation");
assert.equal(git("branch", "--show-current"), "dev");
assert.equal(git("remote", "get-url", "origin"), "git@github.com:weiyang86/aij-foundation.git");
const program = read(folder + "program.json");
const queue = read("docs/planning/CODING_QUEUE.json");
const wave = program.nextWaves.find(w => w.id === "W15");
assert.equal(wave.estimatedHours, 10.25);
assert.equal(wave.cards.reduce((sum, card) => sum + card.hours, .75), wave.estimatedHours);
assert.equal(wave.governanceCard, "AF-192");
assert.equal(wave.cards.length, 3);
assert.deepEqual(wave.cards.map(c => [c.id, c.model, c.effort]), [
  ["AF-193", "gpt-6.1-sol", "high"],
  ["AF-194", "gpt-6.1-terra", "high"],
  ["AF-195", "gpt-6-luna", "medium"]
]);
assert.equal(wave.workerLimits.maxActiveWorkersIncludingRoot, 4);
assert.equal(wave.workerLimits.dbWriters, 1);
assert.equal(wave.workerLimits.heavyBuilds, 1);
assert.equal(git("rev-parse", "origin/dev"), wave.originDev);
git("merge-base", "--is-ancestor", wave.sourceHead, "HEAD");
const directive = program.ownerExecutionDirectives.find(d => d.id === "OWNER_BLANK_CREDENTIALS_20261106");
assert.equal(directive.credentialDefaults, "EMPTY_NO_PLACEHOLDERS");
assert.equal(directive.externalAcceptance, "DEFERRED_NOT_PASSED");
assert.equal(directive.preserveFrozenBaseline, true);
assert.equal(program.requirements.length, 40);
assert.ok(program.requirements.every(r => r.status === "NOT_RUN_TARGET_ACCEPTANCE"));
const earlier = program.nextWaves.find(w => w.id === "W14").cards.find(c => c.id === "AF-191");
assert.notEqual(earlier.status, "CODE_VERIFIED");
assert.ok(!earlier.localCommit || earlier.localCommit === "NOT_COMMITTED_INCOMPLETE_CARD");

const manifestPath = folder + "W15/SOURCE_BOOTSTRAP.json";
const manifest = read(manifestPath);
const manifestHash = hash(readFileSync(manifestPath));
assert.equal(manifest.sourceCommit, wave.sourceHead);
assert.equal(manifest.originDev, wave.originDev);
const paths = new Set();
for (const file of manifest.files) {
  assert.ok(!paths.has(file.path)); paths.add(file.path);
  assert.match(file.path, /^(?:apps\/(?:api|web)\/|packages\/(?:contracts|core|runtime-contracts|sdk|ui)\/|scripts\/|(?:package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|tsconfig\.base\.json|eslint\.config\.mjs)$)/);
  assert.doesNotMatch(file.path, /(?:^|\/)(?:\.\.?|\._[^/]*|\.env[^/]*|node_modules|dist|\.next|uploads|migrations)(?:\/|$)/);
  assert.equal(hash(execFileSync("git", ["show", wave.sourceHead + ":" + file.path])), file.sha256);
}
for (const path of ["apps/api/prisma/schema.prisma", "packages/sdk/src/index.ts", "scripts/prisma-schema.mjs"]) assert.ok(paths.has(path));
for (const evidence of manifest.integrationEvidence) {
  const row = queue.taskExecutions.find(r => r.formalTaskId === evidence.card);
  assert.equal(row.status, "CODE_VERIFIED");
  assert.equal(row.integrationTaskId, evidence.integrationTaskId);
  assert.equal(read(evidence.report).status, "PASS");
  git("merge-base", "--is-ancestor", evidence.commit, "HEAD");
  assert.equal(git("show", "-s", "--format=%s", evidence.commit), row.title);
  const receipt = read(".artifacts/auto-ai-program-20261105/" + evidence.card + "/I-complete.json");
  assert.equal(receipt.result.taskId, evidence.integrationTaskId);
  assert.equal(receipt.result.status, "completed");
}
for (const card of wave.cards) {
  assert.deepEqual(card.bootstrapManifest, { path: manifestPath, sha256: manifestHash, sourceCommit: wave.sourceHead });
  const spec = readFileSync(card.spec, "utf8");
  for (const token of [card.title, manifestHash, wave.sourceHead, wave.originDev, "STOP ALL WRITING", "Candidate not CODE_VERIFIED", "ALLOW PATHS ONLY:"]) assert.ok(spec.includes(token));
  assert.ok(card.allowPaths.every(path => spec.includes("- " + path + "\n")));
  assert.ok(card.codeDeps.includes(wave.governanceTaskId));
  assert.ok(card.hours <= 4 && card.workerHoursLimit < card.hours);
}
const contract = readFileSync(folder + "W15/CONTRACT.md", "utf8");
for (const token of ["runtimeEnabled:false", "externalVerification:'not_run'", "admin.config.manage", "admin.secret.manage", "credentialRefs", "ConfigurationChange", "待配置", "真实账号/密钥留空"]) assert.ok(contract.includes(token), token);
assert.equal(program.gitPolicy.pushCurrentLocalCommits, false);
assert.equal(program.gitPolicy.mergeMain, false);
console.log(JSON.stringify({ status: "PASS", kind: "bounded-blank-credential-governance-only", wave: wave.id, source: wave.sourceHead, bootstrapFiles: paths.size, hoursIncludingRoot: wave.estimatedHours, models: wave.cards.map(c => c.model), vendorAcceptance: "DEFERRED_NOT_PASSED", targetAcceptanceAdded: 0, ownerAcceptance: "PENDING" }));
