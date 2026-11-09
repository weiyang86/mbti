import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readDatabaseEnvironment, withDatabase } from '../database/connection.mjs';
const folder = '.artifacts/auto-ai-program-20261105/AF-189/';
const read = p => JSON.parse(readFileSync(p, 'utf8'));
const hash = p => createHash('sha256').update(readFileSync(p)).digest('hex');
assert.equal(process.cwd(), '/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation');
assert.equal(execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim(), 'dev');
const source = read(folder + 'live-source-manifest.json'), runtime = read(folder + 'native-runtime.json');
assert.equal(runtime.status, 'CLOSED');
assert.equal(source.capturedDuringSameLiveAcceptance, runtime.acceptanceId);
for (const entries of [source.sources, source.compiled, source.nativeReceiptHashes]) {
  assert.ok(Object.keys(entries).length > 5);
  for (const [path, expected] of Object.entries(entries)) assert.equal(hash(path), expected, path);
}
const proof = read(folder + runtime.acceptanceId + '/publication-proof.json');
assert.equal(proof.status, 'EVIDENCE_RECORDED_FORMAL_VERIFY_TASK_REMAINS_AUTHORITY');
assert.equal(proof.acceptanceId, runtime.acceptanceId);
for (const name of ['denials', 'atomicCasSdk', 'twoApiCasAndDatabaseImmutability', 'publicationGrantFence', 'queuedAba', 'invalidationAndLegacy', 'dependencies', 'postIoAndNonce']) assert.equal(proof.checks[name], true, name);
assert.equal(proof.pools0, true);
assert.equal(proof.native.buildId, runtime.buildId);
assert.equal(proof.native.agentId, runtime.agentId);
assert.equal(proof.native.documentHidden, 'NOT_PROVEN');
for (const name of ['publishRunUnpublish', 'readonly', 'casIntent', 'unknownReadAcknowledge', 'scopeSessionRoleRace', 'nativeFocusUnmount']) {
  assert.equal(proof.native.cases[name].status, 'PASS');
  assert.ok(proof.native.cases[name].screenshots.length >= 6);
  for (const path of proof.native.cases[name].screenshots) {
    assert.ok(statSync(path).size > 100);
    assert.equal(readFileSync(path).subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  }
}
assert.match(source.liveTestLog, /^\.artifacts\/auto-ai-program-20261105\/AF-189\/live-final\d+\.log$/);
const tap = readFileSync(source.liveTestLog, 'utf8');
for (const line of ['# tests 10', '# pass 10', '# fail 0', '# skipped 0']) assert.ok(tap.includes(line), line);
assert.doesNotMatch(tap, /^not ok|^ {4}not ok/m);
assert.equal(runtime.traffic.filter(t => t.lostAfterCommit).length, 1);
assert.equal(runtime.traffic.filter(t => t.method === 'POST' && t.path === `/api/client/ai/personal-agents/${runtime.agentId}/runs`).length, 1);
const database = readDatabaseEnvironment('test', process.env, runtime.acceptanceId);
await withDatabase('test', database, async client => {
  const migration = (await client.query('SELECT checksum,finished_at,rolled_back_at FROM public._prisma_migrations WHERE migration_name=$1', ['20261106020000_personal_agent_publication'])).rows;
  assert.equal(migration.length, 1); assert.ok(migration[0].finished_at); assert.equal(migration[0].rolled_back_at, null);
  assert.equal(migration[0].checksum, hash('apps/api/prisma/migrations/20261106020000_personal_agent_publication/migration.sql'));
  const runs = (await client.query('SELECT id,status,budget_status,job_id,snapshot,output FROM public.ai_agent_run WHERE agent_code=$1', ['personal:' + runtime.agentId])).rows;
  assert.equal(runs.length, 1); assert.equal(runs[0].status, 'succeeded'); assert.equal(runs[0].budget_status, 'settled');
  assert.equal(runs[0].snapshot.source.publicationVersion, 1); assert.equal(runs[0].output, 'AF189_SYNTHETIC_OUTPUT');
  assert.equal((await client.query('SELECT count(*)::int AS n FROM public.ai_execution_trace WHERE job_id=$1', [runs[0].job_id])).rows[0].n, 1);
  assert.equal((await client.query('SELECT count(*)::int AS n FROM public.runtime_job WHERE id=$1', [runs[0].job_id])).rows[0].n, 1);
  const pools = (await client.query("SELECT pid FROM pg_stat_activity WHERE datname LIKE 'aij_foundation_af189_test_%' AND pid<>pg_backend_pid() AND backend_type='client backend'")).rows;
  assert.deepEqual(pools, []);
}, { acceptanceId: runtime.acceptanceId });
console.log(JSON.stringify({ status: 'PASS', scope: 'Hash-linked existing real same-fixture PG/API/packedSDK/native acceptance; not a replacement for executing the harness', acceptanceId: runtime.acceptanceId, tests: 10, nativeCases: 6, oneNativeRunJobTrace: true, allAf189Pools0: true, ownerAcceptance: 'PENDING', fullTargetAcceptance: 'NOT_RUN', limits: ['Owned synthetic upstream, not live paid vendor', 'True document-hidden and OS picker NOT_PROVEN'] }));
