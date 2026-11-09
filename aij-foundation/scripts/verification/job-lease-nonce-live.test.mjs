import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import test from 'node:test';
import { checkDatabase, readDatabaseEnvironment, repositoryRoot, withDatabase } from '../database/connection.mjs';
import { seedDatabase } from '../database/seed.mjs';
import { createRuntimeFixture, writeRuntimeEvidence } from './runtime-fixture.mjs';

// ROOT ONLY, NOT_RUN by worker. Root registers AF-157 in the four protected
// allowlists/verify:task, applies the field proposal, migrates a fresh acceptance
// database and builds actual API before explicitly opting into this test.
const require = createRequire(resolve(repositoryRoot, 'apps/api/package.json'));
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
const bounded = work => Promise.race([work, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('AF157 barrier timeout')), 8000); timer.unref(); work.finally(() => clearTimeout(timer)).catch(() => {}); })]);

test('AF-157 fresh PostgreSQL: same worker manual retry, nonce admission and independent stale callbacks', { timeout: 180000 }, async t => {
  assert.equal(process.env.AIJ_AF157_ROOT_LIVE, 'true', 'ROOT ONLY: register guards and opt in; never run in worker');
  assert.equal(resolve(process.cwd()), '/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation');
  assert.equal(execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim(), 'dev');
  const gitPath = flag => resolve(repositoryRoot, execFileSync('git', ['rev-parse', flag], { encoding: 'utf8' }).trim());
  assert.equal(gitPath('--git-dir'), gitPath('--git-common-dir'));
  await checkDatabase('test');
  const f = await createRuntimeFixture('AF-157', { enabledPlugins: ['aij-ai'] });
  const databaseValues = readDatabaseEnvironment('test', process.env, f.lease.id);
  let second, closed = false;
  const gates = [], active = [], evidence = [];
  try {
    const { PrismaClient } = require('@prisma/client');
    const { RuntimeRegistry } = require(resolve(repositoryRoot, 'apps/api/dist/async-runtime/registry.js'));
    const { JobService } = require(resolve(repositoryRoot, 'apps/api/dist/async-runtime/job.service.js'));
    const { PluginRuntimeAccessService } = require(resolve(repositoryRoot, 'apps/api/dist/plugin-runtime/plugin-runtime-access.service.js'));
    const registry = new RuntimeRegistry(), access = f.app.get(PluginRuntimeAccessService);
    const jobs = new JobService(f.prisma, registry, access), worker = 'af157-persistent-worker';
    const url = new URL(databaseValues.TEST_DATABASE_URL); url.searchParams.set('connection_limit', '1'); url.searchParams.set('connect_timeout', '2');
    second = new PrismaClient({ datasources: { db: { url: url.href } } });
    const secondName = 'af157-session:' + f.lease.id;
    await second.$queryRaw`SELECT set_config('application_name', ${secondName}, false)`;
    const [a] = await f.prisma.$queryRaw`SELECT pg_backend_pid() AS pid`;
    const [b] = await second.$queryRaw`SELECT pg_backend_pid() AS pid`;
    assert.notEqual(a.pid, b.pid, 'independent PG sessions, not two aliases of one transaction');
    const other = new JobService(second, registry, access);
    const scope = { type: 'global', id: 'af157-' + f.lease.id };
    const read = id => second.runtimeJob.findUniqueOrThrow({ where: { id } });
    const enqueue = async (type, options = {}) => jobs.enqueue({ type, version: 1, payload: { synthetic: true }, scope,
      idempotencyKey: 'af157-' + randomUUID(), maxAttempts: 1, timeoutMs: 15000, ...options });
    const take = async id => { const rows = await jobs.claim(worker, 1, 1000); assert.equal(rows.length, 1); assert.equal(rows[0].id, id); assert.match(rows[0].lease_nonce, uuid); return rows[0]; };
    const ledger = row => second.runtimeIdempotency.findUniqueOrThrow({ where: { requestScope_scope_scopeId_pluginCode_owner_idempotencyKey: {
      requestScope: 'job', scope: row.scope, scopeId: row.scope_id, pluginCode: row.plugin_code, owner: row.job_type + '@' + row.job_version, idempotencyKey: row.idempotency_key
    } } });

    await t.test('processing same-claim reentry executes zero times; retry resets attempt1 on same worker and reaches real callback', async () => {
      const type = 'test.af157.manual'; let calls = 0; const received = [];
      const entered = deferred(), gate = deferred(); gates.push(gate);
      registry.registerOrchestratedJob(type, 1, async job => {
        calls++; received.push(job);
        if (calls === 1) { entered.resolve(); await gate.promise; throw Object.assign(new Error('synthetic ambiguous operation'), { runtimeRetryable: false }); }
        return { resultReference: { receipt: 'retry-handler-reached' } };
      });
      const job = await enqueue(type), old = await take(job.id);
      const work = jobs.execute(old); active.push(work); await bounded(entered.promise);
      const admission = await ledger(old); assert.equal(admission.status, 'processing'); assert.equal(admission.resultReference.leaseNonce, old.lease_nonce);
      await Promise.all([other.execute(old), other.execute(old)]); assert.equal(calls, 1);
      gate.resolve(); await bounded(work); assert.equal((await read(job.id)).status, 'dead');
      await jobs.retry(job.id); const reset = await read(job.id); assert.equal(reset.attempts, 0); assert.equal(reset.leaseNonce, null);
      const fresh = await take(job.id); assert.equal(fresh.lease_owner, old.lease_owner); assert.equal(fresh.attempts, old.attempts); assert.equal(fresh.attempts, 1); assert.notEqual(fresh.lease_nonce, old.lease_nonce);
      await other.execute(old); assert.equal(calls, 1);
      await jobs.execute(fresh); const result = await read(job.id);
      assert.equal(calls, 2); assert.equal(received[1].leaseNonce, fresh.lease_nonce); assert.equal(result.status, 'completed');
      assert.equal(result.resultReference.receipt, 'retry-handler-reached'); assert.equal((await ledger(fresh)).status, 'completed');
      evidence.push({ case: 'manual-same-worker-attempt1', jobId: job.id, oldNonce: old.lease_nonce, freshNonce: fresh.lease_nonce, calls, status: result.status });
    });

    for (const fail of [false, true]) {
      await t.test(`independent sessions: stale old ${fail ? 'failure' : 'success'} and heartbeat cannot touch replacement attempt1`, async () => {
        const type = 'test.af157.stale-' + (fail ? 'failure' : 'success'); let calls = 0;
        const entered = deferred(), gate = deferred(); gates.push(gate);
        registry.registerOrchestratedJob(type, 1, async () => {
          calls++; if (calls === 1) { entered.resolve(); await gate.promise; if (fail) throw new Error('synthetic stale failure'); }
          return { resultReference: { receipt: 'fresh-only' } };
        });
        const job = await enqueue(type), old = await take(job.id);
        const work = jobs.execute(old); active.push(work); await bounded(entered.promise);
        // Controlled fixture expiry while the real callback is held. The real claim
        // sweeper seals at maxAttempts=1; the real retry API resets it to zero.
        await second.runtimeJob.update({ where: { id: job.id }, data: { leaseExpiresAt: new Date(Date.now() - 1000) } });
        assert.deepEqual(await jobs.claim(worker, 1, 1000), []); assert.equal((await read(job.id)).status, 'dead');
        await jobs.retry(job.id); const fresh = await take(job.id);
        assert.equal(fresh.lease_owner, old.lease_owner); assert.equal(fresh.attempts, old.attempts); assert.notEqual(fresh.lease_nonce, old.lease_nonce);
        const before = await read(job.id);
        assert.equal(await second.$transaction(tx => other.admitLease(tx, old)), false, 'actual SQL admission refuses old heartbeat');
        await other.execute(old); assert.equal(calls, 1);
        gate.resolve(); await bounded(work);
        const after = await read(job.id);
        assert.equal(after.status, 'running'); assert.equal(after.leaseNonce, fresh.lease_nonce); assert.equal(after.attempts, 1);
        assert.equal(after.leaseExpiresAt.getTime(), before.leaseExpiresAt.getTime());
        assert.deepEqual(after.resultReference, before.resultReference); assert.equal((await ledger(old)).status, 'processing');
        await jobs.execute(fresh); assert.equal((await read(job.id)).status, 'completed'); assert.equal(calls, 2);
        evidence.push({ case: 'stale-' + (fail ? 'failure' : 'success'), jobId: job.id, calls, unchangedExpiry: true, oldNonce: old.lease_nonce, freshNonce: fresh.lease_nonce });
      });
    }

    await t.test('two sessions concurrent execution of the same claim admits one real orchestrated callback', async () => {
      const type = 'test.af157.concurrent'; let calls = 0;
      const entered = deferred(), gate = deferred(); gates.push(gate);
      registry.registerOrchestratedJob(type, 1, async () => { calls++; entered.resolve(); await gate.promise; return { resultReference: { once: true } }; });
      const job = await enqueue(type), claim = await take(job.id);
      const work = jobs.execute(claim); active.push(work); await bounded(entered.promise);
      await Promise.all([other.execute(claim), jobs.execute(claim)]); assert.equal(calls, 1);
      gate.resolve(); await bounded(work); assert.equal((await read(job.id)).status, 'completed');
      evidence.push({ case: 'concurrent-same-claim', jobId: job.id, calls });
    });

    await t.test('missing or malformed legacy nonce cannot execute or extend a valid lease', async () => {
      const type = 'test.af157.legacy'; let calls = 0; registry.registerJob(type, 1, async () => { calls++; });
      const job = await enqueue(type), claim = await take(job.id), before = await read(job.id);
      for (const nonce of [undefined, null, '', 'malformed']) await other.execute({ ...claim, lease_nonce: nonce });
      const after = await read(job.id); assert.equal(calls, 0); assert.equal(after.status, 'running'); assert.equal(after.leaseExpiresAt.getTime(), before.leaseExpiresAt.getTime());
      await jobs.execute(claim); assert.equal((await read(job.id)).status, 'completed'); assert.equal(calls, 1);
    });

    await t.test('expired running lease recovers with a fresh nonce; transactional default commits once', async () => {
      const type = 'test.af157.transactional'; let calls = 0;
      registry.registerJob(type, 1, async (job, tx) => {
        calls++; assert.ok(tx); assert.match(job.leaseNonce, uuid);
        await tx.auditLog.create({ data: { module: 'af157', action: 'transactional_effect', status: 'success', resourceType: 'runtime_job', resourceId: job.id } });
        return { resultReference: { once: true } };
      });
      const job = await enqueue(type, { maxAttempts: 2 }), old = await take(job.id);
      await second.runtimeJob.update({ where: { id: job.id }, data: { leaseExpiresAt: new Date(Date.now() - 1000) } });
      const fresh = await take(job.id); assert.equal(fresh.attempts, 2); assert.notEqual(fresh.lease_nonce, old.lease_nonce);
      await other.execute(old); assert.equal(calls, 0);
      await Promise.all([jobs.execute(fresh), other.execute(fresh)]);
      assert.equal(calls, 1); assert.equal((await read(job.id)).status, 'completed');
      assert.equal(await second.auditLog.count({ where: { module: 'af157', resourceId: job.id } }), 1);
      evidence.push({ case: 'expiry-default-transactional', jobId: job.id, calls, attempt: fresh.attempts });
    });

    await t.test('real plugin lifecycle/project gate: queued disable prevents execution and stale plugin defer cannot alter new nonce', async () => {
      // Extend only this fresh synthetic fixture's permission catalog through the real seed tool.
      await seedDatabase({ mode: 'test', acceptanceId: f.lease.id, generateCredentials: true, runtimeManagement: true, pluginManagement: true });
      await f.request('/admin/plugins/aij-ai/install', { method: 'POST', expected: 201, body: { version: '0.1.0' } });
      await f.request('/admin/plugins/aij-ai/enable', { method: 'POST' });
      const project = await f.prisma.projectProfile.findUniqueOrThrow({ where: { code: 'aij-foundation-test' } });
      const type = 'test.af157.plugin'; let calls = 0; registry.registerOrchestratedJob(type, 1, async () => { calls++; });
      const pluginScope = { type: 'plugin', id: project.id, pluginCode: 'aij-ai' };
      await assert.rejects(enqueue(type, { scope: { ...pluginScope, id: 'foreign-project' } }));
      const job = await enqueue(type, { scope: pluginScope }), old = await take(job.id);
      await second.runtimeJob.update({ where: { id: job.id }, data: { leaseExpiresAt: new Date(Date.now() - 1000) } });
      await jobs.claim(worker, 1, 1000); await jobs.retry(job.id); const fresh = await take(job.id);
      await f.request('/admin/plugins/aij-ai/disable', { method: 'POST' });
      const before = await read(job.id); await other.execute(old); const unchanged = await read(job.id);
      assert.equal(unchanged.status, 'running'); assert.equal(unchanged.leaseNonce, fresh.lease_nonce); assert.equal(unchanged.leaseExpiresAt.getTime(), before.leaseExpiresAt.getTime());
      await jobs.execute(fresh); const after = await read(job.id);
      assert.equal(calls, 0); assert.equal(after.status, 'retry'); assert.equal(after.lastError, 'PLUGIN_DISABLED'); assert.equal(after.leaseNonce, null);
      await jobs.cancel(job.id); await f.request('/admin/plugins/aij-ai/enable', { method: 'POST' });
      evidence.push({ case: 'plugin-disable', jobId: job.id, calls });
    });

    const projection = await f.request('/admin/runtime/jobs');
    assert.equal(JSON.stringify(projection.body).includes('leaseNonce'), false);
    assert.equal(JSON.stringify(projection.body).includes('lease_nonce'), false);
    assert.equal((await jobs.list()).some(row => Object.hasOwn(row, 'leaseNonce')), false);
    const appName = f.prisma.applicationName;
    await second.$disconnect(); second = undefined; await f.close(); closed = true;
    const connectionCount = await withDatabase('test', databaseValues, async client => (await client.query(
      'SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND application_name = ANY($1::text[])', [[appName, secondName]]
    )).rows[0].count, { acceptanceId: f.lease.id });
    assert.equal(connectionCount, 0, 'all owned application and second-session pools disconnected');
    await writeRuntimeEvidence('AF-157', f.lease.id, 'job-lease-nonce-live.json', { database: f.lease.database, independentSessionPids: [a.pid, b.pid], evidence,
      connectionCount, externalExactlyOnceClaimed: false, externalNetwork: false, controlledFixtureExpiryOnly: true });
  } finally {
    gates.forEach(gate => gate.resolve()); await Promise.allSettled(active);
    await second?.$disconnect(); if (!closed) await f.close();
  }
});
