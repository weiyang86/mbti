import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const folder = 'docs/planning/auto-ai-program-20261105/';
const evidence = '.artifacts/auto-ai-program-20261105/W19/';
const read = p => JSON.parse(readFileSync(p, 'utf8'));
const hash = b => createHash('sha256').update(b).digest('hex');
const git = (...args) => execFileSync('git', args, { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024 });
const program = read(folder + 'program.json'), queue = read('docs/planning/CODING_QUEUE.json');
const wave = program.nextWaves.find(w => w.id === 'W19');
assert.equal(git('branch', '--show-current').toString().trim(), 'dev');
assert.equal(git('remote', 'get-url', 'origin').toString().trim(), 'git@github.com:weiyang86/aij-foundation.git');
assert.equal(git('rev-parse', 'origin/dev').toString().trim(), wave.originDev);
git('merge-base', '--is-ancestor', wave.sourceHead, 'HEAD');
assert.equal(wave.sourceHead, '4cfb95436d894f9145662ecbd79c2ea1075c417c');
assert.equal(program.limits.automaticNextWave, true);
assert.equal(wave.governanceCard, 'AF-208');
assert.equal(wave.governanceTaskId, 'task_7f9a17a4355c');
assert.equal(wave.estimatedHours, 11.5);
assert.equal(wave.cards.reduce((n, c) => n + c.hours, wave.governanceHours), 11.5);
assert.equal(wave.workerLimits.maxActiveWorkersIncludingRoot, 4);
for (const key of ['dbWriters', 'heavyBuilds', 'linuxExecutors', 'nativeGui']) assert.equal(wave.workerLimits[key], 1);
assert.deepEqual(wave.parallelToPendingWave.cards, ['AF-203']);
for (const id of ['AF-191', 'AF-203']) assert.notEqual(queue.taskExecutions.find(c => c.formalTaskId === id).status, 'CODE_VERIFIED');
assert.equal(read('.artifacts/verification/AF-203/run-DA1CkO/report.json').status, 'FAIL');
const tasks = read(evidence + 'actual-task-snapshot.json').result.tasks;
const sourcePath = folder + 'W19/SOURCE_BOOTSTRAP.json', source = read(sourcePath), digest = hash(readFileSync(sourcePath));
assert.equal(source.sourceCommit, wave.sourceHead); assert.equal(source.originDev, wave.originDev); assert.equal(source.files.length, 910);
const paths = new Set();
for (const f of source.files) {
  assert.ok(!paths.has(f.path)); paths.add(f.path);
  assert.match(f.path, /^(?:apps\/(?:api|web)\/|packages\/(?:contracts|core|runtime-contracts|sdk|ui)\/|scripts\/|ops\/document-export\/|(?:package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|tsconfig\.base\.json|eslint\.config\.mjs)$)/);
  assert.doesNotMatch(f.path, /(?:^|\/)(?:\.\.?|\._[^/]*|\.env[^/]*|node_modules|dist|\.next[^/]*|uploads|migrations|document-fonts)(?:\/|$)/);
  assert.equal(hash(git('show', wave.sourceHead + ':' + f.path)), f.sha256, f.path);
}
assert.deepEqual(source.integrationEvidence.map(e => e.card), ['AF-154', 'AF-159', 'AF-175', 'AF-201', 'AF-207']);
for (const e of source.integrationEvidence) {
  const row = queue.taskExecutions.find(c => c.formalTaskId === e.card);
  assert.equal(row.status, 'CODE_VERIFIED'); assert.equal(row.integrationTaskId, e.integrationTaskId);
  assert.equal(read(e.report).status, 'PASS'); assert.equal(tasks.find(t => t.id === e.integrationTaskId).status, 'completed');
  git('merge-base', '--is-ancestor', e.commit, wave.sourceHead);
  assert.equal(git('show', '-s', '--format=%s', e.commit).toString().trim(), row.title);
}
assert.equal(read('.artifacts/auto-ai-program-20261105/AF-207/I-complete.json').result.status, 'completed');
assert.equal(read('.artifacts/auto-ai-program-20261105/AF-207/commit-receipt.json').sha, wave.sourceHead);
const receipts = new Set(read(evidence + 'task-receipts.json').map(r => r.result.taskId));
assert.equal(receipts.size, 7); assert.ok(receipts.has(wave.governanceTaskId));
assert.deepEqual(wave.cards.map(c => [c.id, c.model, c.effort]), [['AF-209', 'gpt-6.1-sol', 'high'], ['AF-210', 'gpt-6-astra', 'high'], ['AF-211', 'gpt-6.1-sol', 'high']]);
const writers = new Set();
for (const c of wave.cards) {
  assert.deepEqual(c.bootstrapManifest, { path: sourcePath, sha256: digest, sourceCommit: wave.sourceHead });
  assert.ok(receipts.has(c.candidateTaskId)); assert.ok(receipts.has(c.integrationTaskId));
  assert.ok(c.hours <= 4 && c.workerHoursLimit < c.hours && c.noGuiDependency);
  assert.deepEqual(JSON.parse(tasks.find(t => t.id === c.candidateTaskId).deps), c.codeDeps);
  assert.deepEqual(JSON.parse(tasks.find(t => t.id === c.integrationTaskId).deps), c.integrationDeps);
  const spec = readFileSync(c.spec, 'utf8');
  for (const token of [c.title, wave.sourceHead, wave.originDev, digest, wave.contract.sha256, 'STOP ALL WRITING', 'Candidate not CODE_VERIFIED', 'ALLOW PATHS ONLY:']) assert.ok(spec.includes(token), token);
  for (const path of c.allowPaths) { assert.ok(!writers.has(path)); writers.add(path); assert.ok(spec.includes('- ' + path + '\n')); }
}
assert.ok(wave.cards[1].integrationDeps.includes(wave.cards[0].integrationTaskId));
assert.ok(wave.cards[2].integrationDeps.includes(wave.cards[1].integrationTaskId));
const contract = readFileSync(wave.contract.path, 'utf8'); assert.equal(hash(contract), wave.contract.sha256);
for (const token of ['PersonalScriptSkillAccess', 'appendVersionInTransaction', 'ScriptRef', 'policyDigest', 'resolveForReadInTransaction', 'PythonSandboxRunner', 'GeneratedFileAssetsService', 'attempted_at', 'clock_timestamp', 'cleanupUnconfirmed', 'personal-script-v1', 'maxAttempts1', 'responseKind', 'DEFERRED_NOT_PASSED', 'readback', 'STOP ALL WRITING']) assert.ok(contract.includes(token), token);
const before = JSON.parse(git('show', wave.sourceHead + ':' + folder + 'program.json'));
assert.deepEqual(program.requirements, before.requirements, 'governance cannot promote or rewrite requirement coverage');
assert.ok(program.requirements.every(r => r.status === 'NOT_RUN_TARGET_ACCEPTANCE'));
const shared = ['docs/current/CURRENT_STATE.md', 'docs/planning/CODING_QUEUE.json', folder + 'program.json', 'scripts/verification/registry.mjs'];
for (const f of read(evidence + 'preserved-before.json').filter(f => !shared.includes(f.path))) assert.equal(hash(readFileSync(f.path)), f.sha256, f.path);
assert.equal(program.gitPolicy.pushCurrentLocalCommits, false); assert.equal(program.gitPolicy.mergeMain, false);
console.log(JSON.stringify({ status: 'PASS', kind: 'BOUNDED_GOVERNANCE_ONLY', sourceBlobs: paths.size, tasks: receipts.size, cards: 4, hoursIncludingRoot: 11.5, targetAcceptanceAdded: 0, vendor: 'DEFERRED_NOT_PASSED', owner: 'PENDING', nativePending: ['AF-191', 'AF-203'] }));
