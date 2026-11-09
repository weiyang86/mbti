import { verifyOwnerAcceptanceHistory } from './owner-acceptance-history.mjs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const folder = 'docs/planning/auto-ai-program-20261105/';
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const digest = value => createHash('sha256').update(value).digest('hex');
const manifest = read(folder + 'program.json');
const queue = read('docs/planning/CODING_QUEUE.json');
const baseline = read('docs/planning/ai-platform-baseline-20261105/traceability.json');
assert.equal(process.versions.node.split('.')[0], '24');
assert.equal(manifest.authorization, 'OWNER_CONTINUOUS_IMPLEMENTATION_20261105');
assert.equal(manifest.baselineId, baseline.baselineId);
assert.equal(manifest.requirements.length, 40);
assert.deepEqual(manifest.requirements.map(r => [r.id, r.phase, r.acceptanceId]), baseline.requirements.map(r => [r.id, r.phase, r.acceptanceId]));
assert.equal(new Set(manifest.requirements.map(r => r.id)).size, 40);
assert.equal(manifest.phases.length, 8);
const visit = (id, chain = []) => {
  assert.ok(!chain.includes(id), 'phase cycle');
  const phase = manifest.phases.find(p => p.id === id);
  assert.ok(phase, 'unknown phase dependency');
  for (const dep of phase.dependsOn) visit(dep, [...chain, id]);
};
for (const phase of manifest.phases) visit(phase.id);
execFileSync('git', ['merge-base', '--is-ancestor', manifest.baselineFreezeCommit, 'HEAD']);
execFileSync('git', ['merge-base', '--is-ancestor', baseline.sourceHead, manifest.baselineFreezeCommit]);
// Frozen source evidence stays valid after subsequent implementation changes.
for (const evidence of baseline.evidence) {
  assert.equal(digest(execFileSync('git', ['show', `${baseline.sourceHead}:${evidence.path}`])), evidence.sha256, evidence.id);
}
assert.equal(manifest.limits.dbWriters, 1);
assert.equal(manifest.limits.heavyBuilds, 1);
assert.equal(manifest.limits.automaticNextWave, true);
const tasks = new Set([manifest.governanceTaskId, manifest.readOnlyPlannerTaskId]);
const activePaths = new Set();
const waves = [manifest.wave1, ...(manifest.nextWaves ?? [])];
for (const wave of waves) {
 assert.ok(wave.cards.length + 1 <= manifest.limits.maxCardsPerWave);
 assert.ok(wave.estimatedHours <= manifest.limits.maxEffectiveHoursPerWave);
 if (wave.governanceTaskId) {
  assert.ok(!tasks.has(wave.governanceTaskId)); tasks.add(wave.governanceTaskId);
 }
 const paths = new Set();
 for (const card of wave.cards) {
  assert.ok(card.hours <= manifest.limits.maxHoursPerCard);
  assert.ok(card.scopeBaseVerifiedEqual);
  assert.ok(readFileSync(card.spec, 'utf8').includes(card.title));
  assert.ok(!tasks.has(card.candidateTaskId)); tasks.add(card.candidateTaskId);
  assert.ok(!tasks.has(card.integrationTaskId)); tasks.add(card.integrationTaskId);
  for (const path of card.allowPaths) {
    assert.ok(!paths.has(path), 'concurrent writer overlap: ' + path); paths.add(path);
    if (card.status !== 'CODE_VERIFIED') {
      assert.ok(!activePaths.has(path), 'active waves overlap: ' + path); activePaths.add(path);
    }
    assert.doesNotMatch(path, /(?:^|\/)(?:AGENTS\.md|CODING_QUEUE\.json|registry\.mjs|schema\.prisma|package\.json|pnpm-lock\.yaml)$/);
  }
  const row = queue.taskExecutions.find(r => r.formalTaskId === card.id);
  assert.equal(row.title, card.title); assert.equal(row.runId, manifest.runId);
  assert.equal(row.candidateTaskId, card.candidateTaskId); assert.equal(row.integrationTaskId, card.integrationTaskId);
  if (card.revisionTaskId) {
    assert.ok(!tasks.has(card.revisionTaskId)); tasks.add(card.revisionTaskId);
    assert.equal(row.revisionTaskId, card.revisionTaskId);
  }
 }
}
const historicalQueue = JSON.parse(execFileSync('git', ['show', `${manifest.baselineFreezeCommit}:docs/planning/CODING_QUEUE.json`], { encoding: 'utf8' }));
const acceptedAppends = verifyOwnerAcceptanceHistory(queue.ownerAcceptanceRecords, historicalQueue.ownerAcceptanceRecords, path => {
 const bytes = readFileSync(path); return { data: JSON.parse(bytes.toString('utf8')), sha256: digest(bytes) };
});
for (const accepted of acceptedAppends) for (const evidence of accepted.cards) {
 const row = queue.taskExecutions.find(item => item.formalTaskId === evidence.formalTaskId);
 assert.equal(row?.status, 'CODE_VERIFIED'); assert.equal(row.ownerAcceptance, 'ACCEPTED_BY_OWNER');
 assert.equal(row.title, evidence.title); assert.equal(row.integrationTaskId, evidence.integrationTaskId);
 assert.equal(read(evidence.report).status, 'PASS');
 assert.equal(execFileSync('git', ['show', '-s', '--format=%s', evidence.commit], { encoding: 'utf8' }).trim(), evidence.title);
 execFileSync('git', ['merge-base', '--is-ancestor', evidence.commit, 'HEAD']);
}
const historicalIds = new Set(historicalQueue.taskExecutions.map(t => t.formalTaskId));
assert.deepEqual(queue.taskExecutions.filter(t => historicalIds.has(t.formalTaskId)), historicalQueue.taskExecutions, 'historical execution snapshots changed');
assert.equal(manifest.gitPolicy.mergeMain, false);
assert.equal(manifest.gitPolicy.pushCurrentLocalCommits, false);
assert.equal(queue.aiPlatformContinuousProgram.runId, manifest.runId);
console.log(JSON.stringify({ status: 'PASS', kind: 'governance-static-check-not-product-acceptance', requirements: 40, phases: 8, waves: waves.length, codeCards: waves.reduce((n, wave) => n + wave.cards.length, 0), sourceAnchors: baseline.evidence.length, overlappingPaths: 0, historicalOwnerAcceptanceUnchanged: true }));
