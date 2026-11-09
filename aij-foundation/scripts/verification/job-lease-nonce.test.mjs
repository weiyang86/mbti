import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import test from 'node:test';
import { loadSource, nest } from './optimization-delta/source-loader.mjs';

// Offline execution of actual services. Recording persistence below verifies predicates;
// PostgreSQL locks/rollback/session behavior belongs to job-lease-nonce-live.test.mjs.
const require = createRequire(resolve('apps/api/package.json'));
const { Prisma } = require('@prisma/client');
const logger = class { log() {} warn() {} };
const contracts = loadSource('apps/api/src/async-runtime/runtime-contracts.ts', {
  '@nestjs/common': nest, 'node:crypto': { randomUUID },
  '../audit-log/audit-redaction': loadSource('apps/api/src/audit-log/audit-redaction.ts')
});
const { RuntimeRegistry } = loadSource('apps/api/src/async-runtime/registry.ts', { '@nestjs/common': nest });
const { JobService } = loadSource('apps/api/src/async-runtime/job.service.ts', {
  '@nestjs/common': { ...nest, Logger: logger }, '@prisma/client': { Prisma },
  'node:crypto': { randomUUID }, 'node:util': { isDeepStrictEqual }, './runtime-contracts': contracts
}, { AbortController, setTimeout, clearTimeout });
const { RuntimeAdminService } = loadSource('apps/api/src/async-runtime/runtime-admin.service.ts', {
  '@nestjs/common': nest, '../../../../scripts/runtime-policy.cjs': { RUNTIME_MANAGE_PERMISSION: 'runtime.manage' }
});
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
function claim(nonce = randomUUID()) {
  return { id: 'synthetic-job', job_type: 'test.nonce', job_version: 1, payload: {}, scope: 'global', scope_id: 'test',
    plugin_code: '', idempotency_key: 'synthetic-key', correlation_id: null, attempts: 1, max_attempts: 1,
    timeout_ms: 5000, lease_owner: 'same-worker', lease_nonce: nonce };
}
function fixture(mode = 'orchestrated', handler = async () => {}) {
  const captured = claim(), writes = [], queries = [], finds = [], callbacks = [];
  let row = { id: captured.id, status: 'running', attempts: 1, leaseOwner: captured.lease_owner, leaseNonce: captured.lease_nonce,
    leaseExpiresAt: new Date(Date.now() + 20000), deletedAt: null }, ledger, enabled = true, serial = Promise.resolve();
  const registry = new RuntimeRegistry();
  registry[mode === 'orchestrated' ? 'registerOrchestratedJob' : 'registerJob']('test.nonce', 1, async (...args) => {
    callbacks.push(args); return handler(...args);
  });
  const matches = where => Object.entries(where).every(([key, value]) => key === 'leaseExpiresAt' ? row[key] > value.gt : row[key] === value);
  const tx = {
    $queryRaw: async (strings, ...values) => {
      queries.push({ text: strings.join('?'), values });
      assert.match(strings.join('?'), /lease_nonce = \?::uuid/);
      return row.status === 'running' && row.id === values[0] && row.leaseOwner === values[1] && row.attempts === values[2] && row.leaseNonce === values[3] && row.leaseExpiresAt > new Date() ? [{ id: row.id }] : [];
    },
    runtimeJob: {
      updateMany: async input => { writes.push(input); if (!matches(input.where)) return { count: 0 }; Object.assign(row, input.data); return { count: 1 }; },
      update: async input => { writes.push(input); Object.assign(row, input.data); return row; },
      findFirst: async () => row,
      count: async () => 1,
      findMany: async input => { finds.push(input); return [Object.fromEntries(Object.keys(input.select).map(k => [k, row[k] ?? null]))]; }
    },
    runtimeIdempotency: {
      findUnique: async () => ledger,
      upsert: async ({ create, update }) => { ledger = ledger ? { ...ledger, ...update } : { status: 'processing', ...create }; },
      create: async ({ data }) => { ledger = { ...data, status: 'processing' }; },
      update: async ({ data }) => { Object.assign(ledger, data); }
    }
  };
  const prisma = { ...tx,
    $transaction: callback => { const work = serial.then(() => callback(tx)); serial = work.catch(() => {}); return work; },
    $executeRaw: async (strings, ...values) => { queries.push({ text: strings.join('?'), values }); return 0; },
    $queryRaw: async sql => {
      queries.push(sql); const nonce = sql.values.find(v => typeof v === 'string' && uuid.test(v));
      assert.ok(nonce); row = { ...row, status: 'running', leaseOwner: 'same-worker', attempts: row.attempts + 1, leaseNonce: nonce, leaseExpiresAt: new Date(Date.now() + 20000) };
      return [{ ...captured, attempts: row.attempts, lease_nonce: nonce }];
    }
  };
  const access = { enabledCodes: async () => [], isEnabled: async () => enabled, projectId: async () => 'test', assertEnabledInTransaction: async () => { if (!enabled) throw new Error('disabled'); } };
  const jobs = new JobService(prisma, registry, access);
  return { jobs, captured, writes, queries, callbacks, finds, tx, prisma, registry, get row() { return row; }, get ledger() { return ledger; }, setEnabled: value => { enabled = value; } };
}
function assertFenced(write, captured) {
  assert.equal(write.where.id, captured.id); assert.equal(write.where.status, 'running');
  assert.equal(write.where.leaseOwner, captured.lease_owner); assert.equal(write.where.attempts, captured.attempts);
  assert.equal(write.where.leaseNonce, captured.lease_nonce); assert.equal(write.where.deletedAt, null);
  assert.ok(write.where.leaseExpiresAt.gt instanceof Date);
}

test('claim binds a fresh cryptographic v4 nonce for each invocation and returns persisted identity', async () => {
  const f = fixture();
  const [a] = await f.jobs.claim('same-worker', 1, 1000), [b] = await f.jobs.claim('same-worker', 1, 1000);
  assert.match(a.lease_nonce, uuid); assert.match(b.lease_nonce, uuid); assert.notEqual(a.lease_nonce, b.lease_nonce);
  for (const sql of f.queries.filter(q => q.sql)) {
    assert.match(sql.sql, /lease_nonce = \?::uuid/); assert.match(sql.sql, /j\.lease_nonce/);
    assert.ok(!sql.sql.includes(a.lease_nonce)); assert.ok(sql.values.includes(a.lease_nonce) || sql.values.includes(b.lease_nonce));
    assert.match(sql.sql, /FOR UPDATE SKIP LOCKED/); assert.match(sql.sql, /attempts < max_attempts/);
  }
});

for (const nonce of [undefined, null, '', 'invalid', "'; DROP TABLE runtime_job; --", '00000000-0000-0000-0000-000000000000']) {
  test(`missing/malformed nonce fails closed before persistence or callback: ${String(nonce)}`, async () => {
    const f = fixture(); await f.jobs.execute({ ...f.captured, lease_nonce: nonce });
    assert.equal(await f.jobs.admitLease(f.tx, { ...f.captured, lease_nonce: nonce }), false);
    assert.throws(() => f.jobs.leaseWhere({ ...f.captured, lease_nonce: nonce }));
    assert.equal(f.queries.length, 0); assert.equal(f.writes.length, 0); assert.equal(f.callbacks.length, 0);
  });
}

for (const mode of ['transactional', 'orchestrated']) {
  test(`${mode} supplies nonce to callback and fences heartbeat/completion`, async () => {
    const f = fixture(mode, async () => ({ resultReference: { receipt: 'synthetic' } }));
    await f.jobs.execute(f.captured);
    assert.equal(f.callbacks.length, 1); assert.equal(f.callbacks[0][0].leaseNonce, f.captured.lease_nonce);
    assert.equal(f.row.status, 'completed'); assert.equal(f.row.leaseNonce, null);
    assert.equal(f.ledger.status, 'completed'); assert.equal(f.writes.length, mode === 'orchestrated' ? 3 : 2);
    f.writes.forEach(write => assertFenced(write, f.captured));
    await f.jobs.execute(f.captured); assert.equal(f.callbacks.length, 1);
  });
  test(`${mode} stale identity cannot enter, extend, or complete same owner+attempt with new nonce`, async () => {
    const f = fixture(mode); f.row.leaseNonce = randomUUID(); const expires = f.row.leaseExpiresAt;
    await f.jobs.execute(f.captured);
    assert.equal(f.callbacks.length, 0); assert.equal(f.writes.length, 0); assert.equal(f.row.leaseExpiresAt, expires); assert.equal(f.row.status, 'running');
  });
}

test('same claim duplicate admission executes once; manual reset with same worker and attempt reaches callback again', async () => {
  const entered = deferred(), barrier = deferred(); let calls = 0;
  const f = fixture('orchestrated', async () => {
    if (++calls === 1) { entered.resolve(); await barrier.promise; throw Object.assign(new Error('synthetic ambiguous'), { runtimeRetryable: false }); }
    return { resultReference: { receipt: 'retry-reached-handler' } };
  });
  const work = f.jobs.execute(f.captured); await entered.promise;
  assert.equal(f.ledger.resultReference.leaseNonce, f.captured.lease_nonce);
  await Promise.all([f.jobs.execute(f.captured), f.jobs.execute(f.captured)]); assert.equal(f.callbacks.length, 1);
  barrier.resolve(); await work; assert.equal(f.row.status, 'dead');
  await f.jobs.retry(f.captured.id); assert.equal(f.row.attempts, 0); assert.equal(f.row.leaseNonce, null);
  const [fresh] = await f.jobs.claim('same-worker', 1, 1000);
  assert.equal(fresh.attempts, 1); assert.equal(fresh.lease_owner, f.captured.lease_owner); assert.notEqual(fresh.lease_nonce, f.captured.lease_nonce);
  await f.jobs.execute(f.captured); assert.equal(f.callbacks.length, 1);
  await f.jobs.execute(fresh); assert.equal(f.callbacks.length, 2); assert.equal(f.row.status, 'completed');
  assert.equal(f.callbacks[1][0].leaseNonce, fresh.lease_nonce); assert.equal(f.ledger.resultReference.receipt, 'retry-reached-handler');
});

for (const reject of [false, true]) {
  test(`stale in-flight ${reject ? 'failure' : 'success'} cannot mutate or extend replacement lease`, async () => {
    const entered = deferred(), gate = deferred();
    const f = fixture('orchestrated', async () => { entered.resolve(); await gate.promise; if (reject) throw new Error('synthetic'); return { resultReference: { old: true } }; });
    const work = f.jobs.execute(f.captured); await entered.promise;
    const freshNonce = randomUUID(); f.row.leaseNonce = freshNonce; const expiry = f.row.leaseExpiresAt;
    gate.resolve(); await work;
    assert.equal(f.row.leaseNonce, freshNonce); assert.equal(f.row.status, 'running'); assert.equal(f.row.leaseExpiresAt, expiry);
    assert.equal(f.ledger.status, 'processing'); f.writes.forEach(w => assertFenced(w, f.captured));
  });
}

test('plugin deferral and handler failure are nonce fenced and clear a valid lease', async () => {
  for (const stale of [false, true]) {
    const f = fixture(); f.captured.plugin_code = 'synthetic-plugin'; f.setEnabled(false);
    if (stale) f.row.leaseNonce = randomUUID();
    await f.jobs.execute(f.captured); assert.equal(f.callbacks.length, 0);
    assertFenced(f.writes[0], f.captured); assert.equal(f.row.status, stale ? 'running' : 'retry');
    if (!stale) assert.equal(f.row.leaseNonce, null);
  }
  const f = fixture('transactional', async () => { throw new Error('synthetic'); });
  await f.jobs.execute(f.captured); assert.equal(f.row.status, 'dead');
  f.writes.forEach(w => assertFenced(w, f.captured));
});

test('completed ledger replay is nonce fenced and does not call orchestrated handler again', async () => {
  const f = fixture(); await f.jobs.execute(f.captured);
  Object.assign(f.row, { status: 'running', leaseOwner: 'same-worker', leaseNonce: randomUUID(), leaseExpiresAt: new Date(Date.now() + 20000) });
  const replay = { ...f.captured, lease_nonce: f.row.leaseNonce };
  await f.jobs.execute(replay); assert.equal(f.callbacks.length, 1); assert.equal(f.row.status, 'completed');
  f.writes.slice(3).forEach(w => assertFenced(w, replay));
});

test('admin list and JobService list explicit safe projections exclude internal nonce; admin retry clears it', async () => {
  const f = fixture(); await f.jobs.list();
  const admin = new RuntimeAdminService(f.prisma, { database: work => work(), write: (_id, _p, work) => work(f.tx), audit: async () => {} }, {});
  const listed = await admin.jobs({ page: 1, pageSize: 10 });
  assert.equal('leaseNonce' in listed.items[0], false);
  assert.ok(f.finds.every(q => !Object.hasOwn(q.select, 'leaseNonce')));
  f.row.status = 'dead'; await admin.retryJob(f.captured.id, 'operator');
  assert.equal(f.row.attempts, 0); assert.equal(f.row.leaseNonce, null);
});

test('one nullable UUID column proposal with no ledger, default, or production schema mutation', () => {
  const sql = readFileSync('apps/api/prisma/migrations/20261105020000_runtime_job_lease_nonce/migration.sql', 'utf8');
  assert.match(sql, /ALTER TABLE "runtime_job" ADD COLUMN "lease_nonce" UUID;/);
  assert.equal(sql.match(/ALTER TABLE/g)?.length, 1); assert.doesNotMatch(sql, /NOT NULL|DEFAULT|CREATE TABLE/);
  assert.match(readFileSync('docs/execution/AF-157-schema.prisma', 'utf8'), /leaseNonce String\? @map\("lease_nonce"\) @db\.Uuid/);
});
