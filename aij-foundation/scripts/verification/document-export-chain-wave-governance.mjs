import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const folder = 'docs/planning/auto-ai-program-20261105/';
const read = p => JSON.parse(readFileSync(p, 'utf8'));
const hash = b => createHash('sha256').update(b).digest('hex');
const git = (...a) => execFileSync('git', a);
assert.equal(git('branch', '--show-current').toString().trim(), 'dev');
assert.equal(git('remote', 'get-url', 'origin').toString().trim(), 'git@github.com:weiyang86/aij-foundation.git');
const program = read(folder + 'program.json'), queue = read('docs/planning/CODING_QUEUE.json');
const wave = program.nextWaves.find(w => w.id === 'W17');
assert.equal(program.limits.automaticNextWave, true);
assert.equal(wave.governanceCard, 'AF-200'); assert.equal(wave.governanceTaskId, 'task_967d45ab2c1c');
assert.equal(wave.estimatedHours, 11.75); assert.equal(wave.cards.reduce((n, c) => n + c.hours, .75), 11.75);
assert.equal(wave.workerLimits.maxActiveWorkersIncludingRoot, 4);
for (const k of ['dbWriters', 'heavyBuilds', 'nativeGui']) assert.equal(wave.workerLimits[k], 1);
assert.equal(program.nextWaves.find(w => w.id === 'W16').status, 'OWNER_CHECK_PENDING');
assert.equal(git('rev-parse', 'origin/dev').toString().trim(), wave.originDev);
git('merge-base', '--is-ancestor', wave.sourceHead, 'HEAD');
const sourcePath = folder + 'W17/SOURCE_BOOTSTRAP.json', source = read(sourcePath), digest = hash(readFileSync(sourcePath));
assert.equal(source.sourceCommit, wave.sourceHead); assert.equal(source.originDev, wave.originDev); assert.equal(source.files.length, 867);
const all = new Set();
for (const f of source.files) {
  assert.ok(!all.has(f.path)); all.add(f.path);
  assert.match(f.path, /^(?:apps\/(?:api|web)\/|packages\/(?:contracts|core|runtime-contracts|sdk|ui)\/|scripts\/|ops\/document-export\/|(?:package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|tsconfig\.base\.json|eslint\.config\.mjs)$)/);
  assert.doesNotMatch(f.path, /(?:^|\/)(?:\.\.?|\._[^/]*|\.env[^/]*|node_modules|dist|\.next[^/]*|uploads|migrations)(?:\/|$)/);
  assert.equal(hash(git('show', wave.sourceHead + ':' + f.path)), f.sha256);
}
assert.equal(source.integrationEvidence.length, 4);
for (const e of source.integrationEvidence) {
  const row = queue.taskExecutions.find(r => r.formalTaskId === e.card);
  assert.equal(row.status, 'CODE_VERIFIED'); assert.equal(row.integrationTaskId, e.integrationTaskId); assert.equal(read(e.report).status, 'PASS');
  const receipt = read('.artifacts/auto-ai-program-20261105/' + e.card + '/I-complete.json');
  assert.equal(receipt.result.taskId, e.integrationTaskId); assert.equal(receipt.result.status, 'completed');
  git('merge-base', '--is-ancestor', e.commit, 'HEAD'); assert.equal(git('show', '-s', '--format=%s', e.commit).toString().trim(), row.title);
}
const ids = new Set(read('.artifacts/auto-ai-program-20261105/W17/task-receipts.json').map(r => r.result.taskId ?? r.result.id ?? r.result.task?.id));
assert.equal(ids.size, 7); assert.ok(ids.has(wave.governanceTaskId));
assert.deepEqual(wave.cards.map(c => [c.id, c.model, c.effort]), [['AF-201', 'gpt-6.1-sol', 'high'], ['AF-202', 'gpt-6-astra', 'high'], ['AF-203', 'gpt-6.1-terra', 'high']]);
const paths = new Set();
for (const c of wave.cards) {
  assert.deepEqual(c.bootstrapManifest, { path: sourcePath, sha256: digest, sourceCommit: wave.sourceHead });
  assert.ok(ids.has(c.candidateTaskId)); assert.ok(ids.has(c.integrationTaskId)); assert.ok(c.codeDeps.includes(wave.governanceTaskId));
  assert.ok(c.hours <= 4 && c.workerHoursLimit < c.hours);
  const spec = readFileSync(c.spec, 'utf8');
  for (const token of [c.title, wave.sourceHead, wave.originDev, digest, 'STOP ALL WRITING', 'Candidate not CODE_VERIFIED', 'ALLOW PATHS ONLY:']) assert.ok(spec.includes(token), token);
  for (const p of c.allowPaths) { assert.ok(!paths.has(p)); paths.add(p); assert.ok(spec.includes('- ' + p + '\n')); }
}
assert.ok(wave.cards[1].integrationDeps.includes(wave.cards[0].integrationTaskId));
assert.ok(wave.cards[2].integrationDeps.includes(wave.cards[1].integrationTaskId));
const contract = readFileSync(folder + 'W17/CONTRACT.md', 'utf8');
for (const t of ['GeneratedFileAssetsService', 'commitInTransaction', 'retainedBecauseCommitted', 'opaque', 'FileContentService', 'DocumentExportExecutor', 'workspace.documents.export', '/client/document-exports', 'responseKind', 'WebCrypto', '原生14', 'ObjectURL', '未知', 'DEFERRED_NOT_PASSED']) assert.ok(contract.includes(t), t);
for (const f of read('.artifacts/auto-ai-program-20261105/W17/preserved-before.json').filter(f => f.path.includes('AF-191') || f.path.includes('workbench-sdk-target') || f.path.endsWith('AIJ-Base-1.0-Orca-Execution-Playbook.md'))) assert.equal(hash(readFileSync(f.path)), f.sha256);
assert.ok(program.requirements.every(r => r.status === 'NOT_RUN_TARGET_ACCEPTANCE'));
assert.notEqual(program.nextWaves.find(w => w.id === 'W14').cards.find(c => c.id === 'AF-191').status, 'CODE_VERIFIED');
assert.equal(program.ownerExecutionDirectives.find(d => d.id === 'OWNER_BLANK_CREDENTIALS_20261106').externalAcceptance, 'DEFERRED_NOT_PASSED');
assert.equal(program.gitPolicy.pushCurrentLocalCommits, false); assert.equal(program.gitPolicy.mergeMain, false);
console.log(JSON.stringify({ status: 'PASS', kind: 'BOUNDED_GOVERNANCE_NOT_PRODUCT_ACCEPTANCE', wave: 'W17', sourceFiles: source.files.length, hours: 11.75, cards: 4, codeTargetsAccepted: 0, vendor: 'DEFERRED_NOT_PASSED', owner: 'PENDING' }));
