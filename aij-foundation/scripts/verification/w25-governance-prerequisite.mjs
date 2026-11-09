import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
const folder = 'docs/planning/auto-ai-program-20261105/', artifact = '.artifacts/auto-ai-program-20261105/W25/';
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 }).trim();
const source = '46079d20b55b4c581cc5cd0a8464ad2e0dd55326', origin = '94b0236f775fa40a07944c5e0545ac6ce0e123f3';
assert.equal(git('branch', '--show-current'), 'dev');
assert.equal(git('remote', 'get-url', 'origin'), 'git@github.com:weiyang86/aij-foundation.git');
assert.equal(git('rev-parse', 'origin/dev'), origin);
assert.equal(git('ls-remote', 'origin', 'refs/heads/dev'), origin + '\trefs/heads/dev');
git('merge-base', '--is-ancestor', source, 'HEAD');
const p = read(folder + 'program.json'), q = read('docs/planning/CODING_QUEUE.json');
const oldP = read(artifact + 'before/' + folder + 'program.json'), oldQ = read(artifact + 'before/docs/planning/CODING_QUEUE.json');
const w = p.nextWaves.find(row => row.id === 'W25');
assert.equal(w.ownerInstruction, '已经验收完成，请自动开启下一批，快速完成所有的开发工作');
assert.equal(w.scopeCardCount, 4); assert.equal(w.cards.length, 3); assert.equal(w.ownerAcceptance, 'PENDING');
assert.equal(w.budgetHours, 12); assert.equal(w.estimatedHours, 12); assert.equal(w.governanceHours, 1.25); assert.equal(w.governanceRootHoursLimit, .5);
assert.equal(w.readOnlyPlannerBudget, .75); assert.equal(w.readOnlyPlannerHoursCarried, .65);
assert.equal(w.readOnlyPlanners.length, 3);
assert.equal(w.readOnlyPlanners.reduce((sum, row) => sum + row.hoursCarried, 0), .65);
assert.equal(w.cards.reduce((total, card) => total + card.hours, w.governanceHours), 12);
assert.equal(w.automaticContinuation, true);
for (const key of ['dbWriters', 'heavyBuilds', 'linuxExecutors', 'nativeGui']) assert.equal(w.workerLimits[key], 1);
assert.equal(w.workerLimits.maxActiveWorkersIncludingRoot, 4);
assert.deepEqual(p.nextWaves.slice(0, -1), oldP.nextWaves);
for (const key of ['requirements', 'ownerExecutionDirectives', 'gitPolicy', 'externalGates']) assert.deepEqual(p[key], oldP[key]);
assert.equal(p.gitPolicy.pushCurrentLocalCommits, false); assert.equal(p.gitPolicy.mergeMain, false);
assert.deepEqual(q.ownerAcceptanceRecords, oldQ.ownerAcceptanceRecords);
assert.deepEqual(q.taskExecutions.slice(0, oldQ.taskExecutions.length), oldQ.taskExecutions);
assert.equal(q.taskExecutions.length, oldQ.taskExecutions.length + 4);
assert.deepEqual(w.externalPolicy, oldP.nextWaves.at(-1).externalPolicy);
const tasks = JSON.parse(execFileSync('/usr/local/bin/orca', ['orchestration', 'task-list', '--run', 'run_72ed314cead8', '--json'], { maxBuffer: 32 * 1024 * 1024 })).result.tasks;
const task = id => { const t = tasks.find(row => row.id === id); assert.ok(t, id); return t; };
assert.equal(task(w.governanceTaskId).id, 'task_0b13cb98ad28');
const messages = read(artifact + 'readonly-reports.json').result.messages;
for (const planner of w.readOnlyPlanners) {
 assert.equal(task(planner.taskId).status, 'completed'); assert.equal(planner.filesWritten, 0);
 const report = messages.find(row => row.id === planner.stopReceipt); assert.ok(report); assert.match(report.body, /STOP ALL WRITING/);
 const payload = typeof report.payload === 'string' ? JSON.parse(report.payload) : report.payload;
 assert.equal(payload.taskId, planner.taskId); assert.equal(payload.dispatchId, planner.dispatchId);
}
for (const id of JSON.parse(task(w.governanceTaskId).deps)) assert.equal(task(id).status, 'completed');
const prev = oldP.nextWaves.find(row => row.id === 'W24');
for (const card of prev.cards) {
 assert.equal(card.status, 'CODE_VERIFIED'); assert.equal(read(card.report).status, 'PASS');
 assert.equal(task(card.integrationTaskId).status, 'completed');
}
assert.equal(git('show', '-s', '--format=%s', source), '提供章节生成预览任务API与公共SDK');
const mp = folder + 'W25/SOURCE_BOOTSTRAP.json', m = read(mp), mh = sha(readFileSync(mp));
assert.equal(m.sourceCommit, source); assert.equal(m.originDev, origin); assert.equal(m.files.length, 1112);
assert.equal(mh, '105443376feda721bcc0196921333f655a9f0f9aeb0a6d4c8dea7664e0bb7001');
const tree = new Map(git('ls-tree', '-r', source).split('\n').map(line => { const split = line.indexOf('\t'); return [line.slice(split + 1), line.slice(0, split).split(' ')]; }));
const all = execFileSync('git', ['cat-file', '--batch'], { input: m.files.map(file => file.oid + '\n').join(''), stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
let offset = 0; const paths = new Set();
for (const file of m.files) {
 assert.ok(!paths.has(file.path)); paths.add(file.path);
 assert.ok(['100644', '100755'].includes(file.mode));
 assert.deepEqual(tree.get(file.path), [file.mode, 'blob', file.oid]);
 assert.doesNotMatch(file.path, /(?:^|\/)(?:\._[^/]*|node_modules|uploads|dist|\.next[^/]*|\.artifacts)(?:\/|$)/);
 if (file.path.split('/').some(part => part.startsWith('.env'))) assert.ok(file.path.endsWith('.env.example'));
 const end = all.indexOf(10, offset), [oid, kind, size] = all.subarray(offset, end).toString().split(' ');
 assert.equal(oid, file.oid); assert.equal(kind, 'blob'); assert.equal(Number(size), file.bytes);
 assert.equal(sha(all.subarray(end + 1, end + 1 + Number(size))), file.sha256); offset = end + 2 + Number(size);
}
assert.equal(offset, all.length);
const own = new Set();
for (const card of w.cards) {
 assert.ok(card.hours <= 4 && card.workerHoursLimit <= 1.5); assert.equal(card.ownerAcceptance ?? 'PENDING', 'PENDING');
 assert.equal(card.model, 'inherited-default'); assert.equal(card.effort, 'inherited-default');
 assert.deepEqual(JSON.parse(task(card.candidateTaskId).deps), card.codeDeps);
 assert.deepEqual(JSON.parse(task(card.integrationTaskId).deps), card.integrationDeps);
 assert.ok(card.codeDeps.includes(w.governanceTaskId));
 for (const dep of card.codeDeps.filter(id => id !== w.governanceTaskId)) assert.equal(task(dep).status, 'completed');
 const row = q.taskExecutions.find(item => item.formalTaskId === card.id);
 assert.equal(row.title, card.title); assert.equal(row.integrationTaskId, card.integrationTaskId); assert.equal(row.candidateTaskId, card.candidateTaskId);
 const spec = readFileSync(card.spec, 'utf8');
 for (const token of [card.title, source, origin, mh, 'STOP ALL WRITING', 'Candidate not CODE_VERIFIED', 'ALLOW PATHS ONLY:']) assert.ok(spec.includes(token), token);
 for (const path of card.allowPaths) {
  assert.ok(!paths.has(path)); assert.ok(!own.has(path)); own.add(path);
  assert.equal(existsSync(path), false, path); assert.ok(spec.includes('- ' + path + '\n'));
  assert.doesNotMatch(path, /(?:schema\.prisma|registry\.mjs|CODING_QUEUE\.json|package\.json|pnpm-lock\.yaml)$/);
 }
}
assert.ok(w.cards[1].integrationDeps.includes(w.cards[0].integrationTaskId));
assert.ok(w.cards[2].integrationDeps.includes(w.cards[1].integrationTaskId));
for (const file of read(folder + 'W25/GOVERNANCE_INPUTS.json').files) assert.equal(sha(readFileSync(file.path)), file.sha256, file.path);
assert.equal(sha(readFileSync(w.contract.path)), w.contract.sha256);
for (const file of read(artifact + 'protected.json')) assert.equal(sha(readFileSync(file.path)), file.sha256, file.path);
console.log(JSON.stringify({ status: 'PASS', kind: 'W25_GOVERNANCE_ONLY_NOT_PRODUCT_ACCEPTANCE', immutableSourceBlobs: 1112, actualTasks: 7, candidates: 3, batchHours: 12, readOnlyPlannerHoursIncluded: .65, previousAcceptanceUnchanged: true, originalOwners: 'shared personal-agent journal/document scope and save/restore/export locks', dbBuildLinuxNativeEach: 1, page: 'NEXT_WAVE', remoteOrPaidActions: 'NOT_AUTHORIZED' }));
