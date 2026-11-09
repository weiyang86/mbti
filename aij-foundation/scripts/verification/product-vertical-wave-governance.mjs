import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const source = "b434da8ba34f03b07b83f03be19b20061bb92fa9";
const base = "94b0236f775fa40a07944c5e0545ac6ce0e123f3";
const folder = "docs/planning/auto-ai-program-20261105/";
const read = p => JSON.parse(readFileSync(p, "utf8"));
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
assert.equal(process.cwd(), "/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation");
assert.equal(git("branch", "--show-current"), "dev");
assert.equal(git("remote", "get-url", "origin"), "git@github.com:weiyang86/aij-foundation.git");
assert.equal(git("rev-parse", "origin/dev"), base);
git("merge-base", "--is-ancestor", source, "HEAD");
const m = read(folder + "program.json"), q = read("docs/planning/CODING_QUEUE.json");
const previous = m.nextWaves.find(w => w.id === "W13");
assert.equal(previous.status, "OWNER_CHECK_PENDING");
assert.equal(previous.effectiveEngineeringHoursEstimated, 3.25);
assert.deepEqual(previous.exitEvidence.map(r => r.card), ["AF-184", "AF-185", "AF-186", "AF-187"]);
for (const e of previous.exitEvidence) {
  const row = q.taskExecutions.find(r => r.formalTaskId === e.card);
  assert.equal(row.status, "CODE_VERIFIED");
  assert.equal(row.ownerAcceptance, "PENDING");
  assert.equal(row.integrationTaskId, e.integrationTaskId);
  assert.equal(read(e.report).status, "PASS");
  git("merge-base", "--is-ancestor", e.commit, "HEAD");
  assert.equal(git("show", "-s", "--format=%s", e.commit), row.title);
  const receipt = read(".artifacts/auto-ai-program-20261105/" + (e.card === "AF-184" ? "W13" : e.card) + "/I-complete.json");
  assert.equal(receipt.result.taskId, row.integrationTaskId);
  assert.equal(receipt.result.status, "completed");
}
const coverage = read(folder + "W14/TARGET_COVERAGE.json");
assert.equal(coverage.reviewedAtHead, source);
assert.deepEqual(coverage.counts, { READY_FOR_TARGET_ACCEPTANCE: 1, PARTIAL: 28, MISSING: 11, UNPROVEN: 0 });
assert.equal(coverage.requirements.length, 40);
assert.deepEqual(coverage.requirements.map(r => r.id).sort(), m.requirements.map(r => r.id).sort());
assert.ok(coverage.requirements.every(r => r.targetAcceptance === "NOT_RUN_BY_THIS_AUDIT"));
assert.ok(m.requirements.every(r => r.status === "NOT_RUN_TARGET_ACCEPTANCE"));
for (const item of coverage.requirements) {
  const original = m.requirements.find(r => r.id === item.id).coverageAudits.find(a => a.card === item.auditCard);
  assert.equal(original.coverage, item.coverage);
}
const wave = m.nextWaves.find(w => w.id === "W14");
assert.equal(wave.estimatedHours, 11.25);
assert.equal(wave.cards.length, 3);
assert.deepEqual(wave.workerLimits, { productCodeWorkers: 3, maxActiveWorkersIncludingRoot: 4, dbWriters: 1, heavyBuilds: 1 });
assert.equal(wave.sourceHead, source);
assert.equal(wave.originDev, base);
assert.deepEqual(wave.cards.map(c => [c.id, c.hours, c.workerHoursLimit]), [["AF-189", 3.5, 1.5], ["AF-190", 4, 1.5], ["AF-191", 3, 1.25]]);
assert.equal(wave.cards.reduce((sum, c) => sum + c.hours, 0) + .75, wave.estimatedHours);
const bp = folder + "W14/SOURCE_BOOTSTRAP.json", bootstrap = read(bp), bh = hash(readFileSync(bp));
assert.equal(bootstrap.sourceCommit, source);
assert.equal(bootstrap.originDev, base);
const paths = new Set();
for (const file of bootstrap.files) {
  assert.ok(!paths.has(file.path)); paths.add(file.path);
  assert.match(file.path, /^(?:apps\/(?:api|web)\/|packages\/(?:contracts|core|runtime-contracts|sdk|ui)\/|scripts\/|(?:package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|tsconfig\.base\.json|eslint\.config\.mjs)$)/);
  assert.doesNotMatch(file.path, /(?:^|\/)(?:\.\.?|\._[^/]*|\.env[^/]*|node_modules|dist|\.next|uploads|migrations)(?:\/|$)/);
  assert.match(file.sha256, /^[0-9a-f]{64}$/);
  const frozen = execFileSync("git", ["show", source + ":" + file.path]);
  assert.equal(hash(frozen), file.sha256, file.path);
  if (file.path === "scripts/verification/registry.mjs") {
    // AF188 appends its own root-only registration after the frozen registry;
    // the child receives exactly the historical blob, never the live registry.
    const current = readFileSync(file.path, "utf8");
    assert.ok(current.startsWith(frozen.toString("utf8")));
    assert.match(current.slice(frozen.toString("utf8").length), /taskRegistry\['AF-188'\]/);
  } else {
    assert.equal(hash(readFileSync(file.path)), file.sha256, "Root source changed before dispatch: " + file.path);
  }
}
assert.ok(paths.has("apps/api/prisma/schema.prisma"));
assert.ok(paths.has("packages/sdk/src/index.ts"));
assert.ok(paths.has("scripts/prisma-schema.mjs"));
for (const card of wave.cards) {
  assert.deepEqual(card.bootstrap, []);
  assert.deepEqual(card.bootstrapManifest, { path: bp, sha256: bh, sourceCommit: source });
  const spec = readFileSync(card.spec, "utf8");
  for (const text of [card.title, source, base, bh, "SOURCE_BOOTSTRAP.json", "STOP ALL WRITING", "No DB/migrate/seed/Docker", "Candidate not CODE_VERIFIED", "ALLOW PATHS ONLY:"]) assert.ok(spec.includes(text), card.id + ":" + text);
  assert.ok(card.allowPaths.every(p => spec.includes("- " + p + "\n")));
  assert.ok(card.codeDeps.every(id => q.taskExecutions.some(r => r.integrationTaskId === id && r.status === "CODE_VERIFIED")));
}
assert.match(readFileSync(wave.cards[0].spec, "utf8"), /ABA/);
assert.match(readFileSync(wave.cards[0].spec, "utf8"), /absent legacy epoch fail closed/);
assert.match(readFileSync(wave.cards[1].spec, "utf8"), /Word\/PDF\/AI章节重生成\/恢复保留未实现|Word\/PDF\/section regen later/);
assert.match(readFileSync(wave.cards[2].spec, "utf8"), /missing evidence FAIL not SKIP/);
console.log(JSON.stringify({ status: "PASS", kind: "finite-product-vertical-governance-not-product-or-target-acceptance", source, originDev: base, sourceOnlyBootstrapFiles: paths.size, coverage: coverage.counts, workers: 3, effectiveHoursIncludingRoot: wave.estimatedHours, dbWriters: 1, heavyBuilds: 1, ownerAcceptance: "PENDING" }));
