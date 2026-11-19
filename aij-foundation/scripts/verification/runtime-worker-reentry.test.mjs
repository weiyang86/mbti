import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { controlledClock, loadSource, nest } from './optimization-delta/source-loader.mjs';

// Execute the repository's worker, health, scheduler and error sanitizer. Only
// I/O dependencies and interval registration are substituted; no app or DB starts.
const contracts = loadSource('apps/api/src/async-runtime/runtime-contracts.ts', {
  '@nestjs/common': nest,
  'node:crypto': { randomUUID },
  '../audit-log/audit-redaction': loadSource('apps/api/src/audit-log/audit-redaction.ts')
});
const phases = ['outboxClaim', 'outboxDeliver', 'jobClaim', 'jobExecute'];

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fixture({ enabled = true } = {}) {
  const clock = controlledClock();
  const globals = { Date: clock.Date };
  const { RuntimeHealthService } = loadSource('apps/api/src/async-runtime/runtime-health.service.ts', {
    '@nestjs/common': nest
  }, globals);
  const health = new RuntimeHealthService({
    readiness: async () => ({ ready: true, reason: 'READY' }),
    $queryRaw: async () => []
  });
  const event = { id: 'synthetic-event' }, job = { id: 'synthetic-job' };
  const defaults = {
    outboxClaim: () => [event], outboxDeliver: () => undefined,
    jobClaim: () => [job], jobExecute: () => undefined
  };
  const effects = { ...defaults }, calls = [], timers = [];
  const invoke = async (phase, ...args) => {
    calls.push({ phase, args });
    return effects[phase](...args);
  };
  const jobs = {
    claim: (...args) => invoke('jobClaim', ...args),
    execute: (...args) => invoke('jobExecute', ...args)
  };
  const { SchedulerService } = loadSource('apps/api/src/async-runtime/scheduler.service.ts', {
    '@nestjs/common': nest, '@prisma/client': { Prisma: {} }, './runtime-contracts': contracts
  }, globals);
  // Empty definitions allow the real scheduler owner to publish its heartbeat
  // without a lease query or enqueue. A worker poll must never publish it.
  const scheduler = new SchedulerService({}, jobs, { scheduleDefinitions: () => [] }, health);
  const { RuntimeWorkerService } = loadSource('apps/api/src/async-runtime/runtime-worker.service.ts', {
    '@nestjs/common': nest, 'node:crypto': { randomUUID }, './runtime-contracts': contracts
  }, {
    ...globals, process: { env: {}, pid: 1 },
    setInterval: (callback, delay) => {
      const timer = { callback, delay, cleared: false, unref() {} };
      timers.push(timer);
      return timer;
    },
    clearInterval: timer => { timer.cleared = true; }
  });
  const worker = new RuntimeWorkerService({
    claim: (...args) => invoke('outboxClaim', ...args),
    deliver: (...args) => invoke('outboxDeliver', ...args)
  }, jobs, scheduler, health, {
    get: key => { assert.equal(key, 'asyncRuntimeEnabled'); return enabled; }
  });
  worker.onModuleInit();
  return {
    clock, health, worker, scheduler, defaults, effects, calls, timers, event, job,
    setEnabled: value => { enabled = value; },
    // Keep the scheduler independently fresh to isolate worker readiness.
    snapshot: async () => { await scheduler.tick('synthetic-scheduler'); return health.snapshot(); }
  };
}

for (const phase of phases) {
  test(`AF-137 stalled ${phase}: 60s of reentry cannot refresh health or duplicate work`, { timeout: 5000 }, async () => {
    const f = fixture(), entered = deferred(), gate = deferred();
    f.effects[phase] = () => { entered.resolve(); return gate.promise; };
    const first = f.worker.poll(), reentries = [];
    let completed = 0;
    try {
      await entered.promise;
      const startedAt = f.health.worker.lastPollAt;
      assert.equal(startedAt.getTime(), f.clock.Date.now());
      assert.equal((await f.snapshot()).ready, true);
      for (const delta of [29_999, 1, 30_000]) {
        f.clock.advance(delta);
        for (let i = 0; i < 3; i++) {
          reentries.push(f.worker.poll().then(() => { completed++; }));
        }
        assert.equal(f.health.worker.lastPollAt, startedAt, 'reentry cannot publish a heartbeat');
        assert.equal(f.calls.filter(call => call.phase === 'outboxClaim').length, 1);
        assert.equal(f.calls.filter(call => call.phase === phase).length, 1);
        const state = await f.snapshot();
        assert.equal(state.ready, delta === 29_999, 'stale begins at exactly 30 seconds');
      }
      assert.equal(f.clock.Date.now() - startedAt.getTime(), 60_000);
      assert.equal(completed, 0, 'reentrant callers wait for the active poll');
      gate.resolve(f.defaults[phase]());
      await Promise.all([first, ...reentries]);
      assert.equal(completed, 9);
      assert.deepEqual(f.calls.map(call => call.phase), phases, 'the stalled round claims/delivers/executes once');
      assert.equal(f.health.worker.lastPollAt, startedAt, 'completion is not a new poll');
      assert.equal((await f.snapshot()).ready, false);

      f.effects[phase] = f.defaults[phase];
      f.clock.advance(1000);
      await f.worker.poll();
      assert.equal(f.health.worker.lastPollAt.getTime(), f.clock.Date.now());
      assert.deepEqual(f.calls.map(call => call.phase), [...phases, ...phases]);
      assert.equal((await f.snapshot()).ready, true, 'a genuine new round restores readiness');
      for (const call of f.calls.filter(call => call.phase.endsWith('Claim'))) {
        assert.equal(call.args[0], f.health.worker.instanceId);
        assert.equal(call.args[1], 1);
      }
      assert.equal(f.calls.find(call => call.phase === 'outboxDeliver').args[0], f.event);
      assert.equal(f.calls.find(call => call.phase === 'jobExecute').args[0], f.job);
    } finally {
      gate.resolve(f.defaults[phase]());
      await Promise.allSettled([first, ...reentries]);
      await f.worker.onModuleDestroy();
    }
  });
}

for (const phase of phases) {
  test(`AF-137 ${phase} rejection: error is sanitized, reentry cannot clear it, next success recovers`, { timeout: 5000 }, async () => {
    const f = fixture(), entered = deferred(), gate = deferred();
    f.effects[phase] = () => { entered.resolve(); return gate.promise; };
    const first = f.worker.poll();
    let reentry;
    try {
      await entered.promise;
      const startedAt = f.health.worker.lastPollAt;
      f.clock.advance(60_000);
      reentry = f.worker.poll();
      gate.reject(new Error('synthetic password=must-never-appear'));
      await Promise.all([first, reentry]);
      assert.equal(f.health.worker.lastPollAt, startedAt);
      assert.equal(f.health.worker.lastError, 'RUNTIME_OPERATION_FAILED');
      assert.deepEqual(f.calls.map(call => call.phase), phases.slice(0, phases.indexOf(phase) + 1));
      let state = await f.snapshot();
      assert.equal(state.ready, false);
      assert.equal(state.worker.hasError, true);
      assert.ok(!JSON.stringify(state).includes('must-never-appear'));

      // A fresh but still blocked recovery round must retain the previous error.
      const recoveryEntered = deferred(), recoveryGate = deferred();
      f.effects[phase] = f.defaults[phase];
      f.effects.outboxClaim = () => { recoveryEntered.resolve(); return recoveryGate.promise; };
      f.clock.advance(1000);
      const recovery = f.worker.poll();
      try {
        await recoveryEntered.promise;
        const recoveryAt = f.health.worker.lastPollAt;
        f.clock.advance(1000);
        const recoveryReentry = f.worker.poll();
        assert.equal(f.health.worker.lastPollAt, recoveryAt);
        assert.equal(f.health.worker.lastError, 'RUNTIME_OPERATION_FAILED');
        state = await f.snapshot();
        assert.equal(state.ready, false, 'fresh heartbeat alone cannot clear an error');
        recoveryGate.resolve(f.defaults.outboxClaim());
        await Promise.all([recovery, recoveryReentry]);
        assert.equal(f.health.worker.lastError, null);
        assert.equal((await f.snapshot()).ready, true);
      } finally {
        recoveryGate.resolve(f.defaults.outboxClaim());
        await recovery;
      }
    } finally {
      gate.resolve(f.defaults[phase]());
      await Promise.allSettled([first, reentry]);
      await f.worker.onModuleDestroy();
    }
  });
}

test('AF-137 disabled startup admits no polling or timers and remains disabled after destroy', async () => {
  const f = fixture({ enabled: false });
  assert.equal(f.timers.length, 0);
  assert.equal(f.health.worker.status, 'disabled');
  assert.equal(f.health.scheduler.status, 'disabled');
  f.clock.advance(60_000);
  await Promise.all([f.worker.poll(), f.worker.poll()]);
  assert.equal(f.health.worker.lastPollAt, null);
  assert.equal(f.health.scheduler.lastPollAt, null);
  assert.equal(f.calls.length, 0);
  assert.equal((await f.health.snapshot()).reason, 'ASYNC_RUNTIME_DISABLED');
  await f.worker.onModuleDestroy();
  assert.equal(f.health.worker.status, 'disabled');
  assert.equal(f.health.scheduler.status, 'disabled');
});

test('AF-137 disabling during an active poll prevents admission and heartbeat; enabling allows a new round', { timeout: 5000 }, async () => {
  const f = fixture(), entered = deferred(), gate = deferred();
  f.effects.outboxClaim = () => { entered.resolve(); return gate.promise; };
  const first = f.worker.poll();
  try {
    await entered.promise;
    const startedAt = f.health.worker.lastPollAt;
    f.setEnabled(false);
    f.clock.advance(60_000);
    await Promise.all([f.worker.poll(), f.worker.poll()]);
    assert.equal(f.health.worker.lastPollAt, startedAt);
    assert.deepEqual(f.calls.map(call => call.phase), ['outboxClaim']);
    assert.equal((await f.snapshot()).ready, false);
    gate.resolve(f.defaults.outboxClaim());
    await first;
    assert.deepEqual(f.calls.map(call => call.phase), phases, 'already admitted work drains under the existing policy');
    await f.worker.poll();
    assert.equal(f.health.worker.lastPollAt, startedAt);
    assert.equal(f.calls.length, phases.length);
    f.setEnabled(true);
    f.effects.outboxClaim = f.defaults.outboxClaim;
    f.clock.advance(1000);
    await f.worker.poll();
    assert.equal(f.health.worker.lastPollAt.getTime(), f.clock.Date.now());
    assert.deepEqual(f.calls.map(call => call.phase), [...phases, ...phases]);
    assert.equal((await f.snapshot()).ready, true);
  } finally {
    gate.resolve(f.defaults.outboxClaim());
    await first;
    await f.worker.onModuleDestroy();
  }
});

for (const reject of [false, true]) {
  test(`AF-137 stopping drains an active poll on ${reject ? 'rejection' : 'success'} and blocks subsequent heartbeats`, { timeout: 5000 }, async () => {
    const f = fixture(), entered = deferred(), gate = deferred();
    f.effects.outboxClaim = () => { entered.resolve(); return gate.promise; };
    const first = f.worker.poll();
    let closing;
    try {
      await entered.promise;
      const startedAt = f.health.worker.lastPollAt;
      let stopped = false;
      closing = f.worker.onModuleDestroy().then(() => { stopped = true; });
      assert.deepEqual(f.timers.map(timer => timer.delay), [1000, 5000]);
      assert.ok(f.timers.every(timer => timer.cleared));
      f.clock.advance(60_000);
      await f.worker.poll();
      // Even an already queued timer callback obeys the stopping guard.
      f.timers.forEach(timer => timer.callback());
      assert.equal(stopped, false);
      assert.equal(f.health.worker.status, 'running');
      assert.equal(f.health.worker.lastPollAt, startedAt);
      assert.deepEqual(f.calls.map(call => call.phase), ['outboxClaim']);
      if (reject) gate.reject(new Error('synthetic drain failure'));
      else gate.resolve(f.defaults.outboxClaim());
      await Promise.all([first, closing]);
      assert.equal(stopped, true);
      assert.equal(f.health.worker.status, 'stopped');
      assert.equal(f.health.scheduler.status, 'stopped');
      assert.equal(f.health.worker.lastError, reject ? 'RUNTIME_OPERATION_FAILED' : null);
      assert.equal((await f.health.snapshot()).ready, false);
      const calls = f.calls.length;
      f.clock.advance(1000);
      await f.worker.poll();
      assert.equal(f.calls.length, calls);
      assert.equal(f.health.worker.lastPollAt, startedAt);
    } finally {
      gate.resolve(f.defaults.outboxClaim());
      await Promise.allSettled([first, closing]);
      await f.worker.onModuleDestroy();
    }
  });
}

test('AF-137 polling does not refresh the scheduler owner or change its 30s stale boundary', async () => {
  const f = fixture();
  try {
    assert.equal(f.health.worker.lastPollAt, null);
    await f.worker.poll();
    assert.equal(f.health.scheduler.lastPollAt, null);
    assert.equal((await f.health.snapshot()).ready, false);
    await f.scheduler.tick('synthetic-scheduler');
    const schedulerAt = f.health.scheduler.lastPollAt;
    assert.equal((await f.health.snapshot()).ready, true);
    f.clock.advance(29_999);
    await f.worker.poll();
    assert.equal((await f.health.snapshot()).ready, true);
    f.clock.advance(1);
    await f.worker.poll();
    assert.equal(f.health.scheduler.lastPollAt, schedulerAt);
    assert.equal((await f.health.snapshot()).ready, false);
    await f.scheduler.tick('synthetic-scheduler');
    assert.equal((await f.health.snapshot()).ready, true);
  } finally {
    await f.worker.onModuleDestroy();
  }
});
