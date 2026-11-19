import assert from "node:assert/strict";
import test from "node:test";
import { controlledClock, loadSource, nest } from "./optimization-delta/source-loader.mjs";
import { diagnoseRuntimeReadiness, readRuntimeReadiness, RuntimeReadinessError, waitForRuntimeReadiness } from "./runtime-readiness-diagnostics.mjs";

const epoch = Date.UTC(2026, 10, 5);
const stamp = ms => new Date(ms).toISOString();
const state = (at = epoch) => ({ status: "running", hasError: false, lastPollAt: stamp(at) });
function ready(at = epoch) {
  return { status: 200, body: { success: true, data: {
    ready: true, reason: "READY", database: { ready: true, reason: "READY" }, worker: state(at), scheduler: state(at)
  } } };
}
function starting() {
  const observation = ready(); observation.status = 503;
  Object.assign(observation.body.data, { ready: false, reason: "ASYNC_RUNTIME_UNHEALTHY",
    worker: { status: "running", hasError: false, lastPollAt: null }, scheduler: { status: "running", hasError: false, lastPollAt: null } });
  return observation;
}
function virtual(options = {}) {
  let time = epoch;
  return { timeoutMs: 1_000, requestTimeoutMs: 100, intervalMs: 100,
    now: () => time, monotonicNow: () => time, sleep: async ms => { time += ms; }, ...options };
}
async function rejectsCode(promise, code) {
  let caught;
  await assert.rejects(promise, error => { caught = error; return error instanceof RuntimeReadinessError && error.code === code; });
  return caught;
}

// Execute the actual health/controller/liveness and worker/scheduler source with
// synthetic dependency ports; no bootstrap, sockets, Prisma client or database.
function sourceFixture() {
  const clock = controlledClock();
  const { RuntimeHealthService } = loadSource("apps/api/src/async-runtime/runtime-health.service.ts", { "@nestjs/common": nest }, { Date: clock.Date });
  const prisma = { readiness: async () => ({ ready: true, reason: "READY" }), $queryRaw: async () => [] };
  const health = new RuntimeHealthService(prisma);
  const decorator = () => () => {};
  const decorators = { ...nest, Controller: decorator, Get: decorator, Header: decorator, Param: decorator,
    Query: decorator, Req: decorator, Res: decorator, Post: decorator, ValidationPipe: class {} };
  const { RuntimeAdminController } = loadSource("apps/api/src/async-runtime/runtime-admin.controller.ts", {
    "@nestjs/common": decorators, "../common/decorators/permissions.decorator": { Permissions: decorator },
    "../../../../scripts/runtime-policy.cjs": { RUNTIME_MANAGE_PERMISSION: "manage", RUNTIME_READ_PERMISSION: "read" },
    "./runtime-admin.dto": { RuntimeJobListDto: class {}, RuntimeOutboxListDto: class {} }
  });
  const controller = new RuntimeAdminController({ readiness: () => health.snapshot() });
  const { HealthController } = loadSource("apps/api/src/health.controller.ts", { "@nestjs/common": decorators });
  const live = new HealthController({ getOrThrow: key => key === "capabilities" ? { database: true } : "synthetic" });
  const { SchedulerService } = loadSource("apps/api/src/async-runtime/scheduler.service.ts", {
    "@nestjs/common": nest, "@prisma/client": { Prisma: {} }, "./runtime-contracts": { safeRuntimeError: () => "SANITIZED" }
  }, { Date: clock.Date });
  const scheduler = new SchedulerService(prisma, {}, { scheduleDefinitions: () => [] }, health);
  const { RuntimeWorkerService } = loadSource("apps/api/src/async-runtime/runtime-worker.service.ts", {
    "@nestjs/common": nest, "node:crypto": { randomUUID: () => "synthetic" }, "./runtime-contracts": { safeRuntimeError: () => "SANITIZED" }
  }, { Date: clock.Date, process: { env: {}, pid: 1 }, setInterval: () => ({ unref() {} }), clearInterval() {} });
  const worker = new RuntimeWorkerService({ claim: async () => [] }, { claim: async () => [] }, scheduler, health, { get: () => true });
  worker.onModuleInit();
  return { clock, health, prisma, worker, scheduler, live,
    probe: async () => {
      const response = { statusCode: 200 };
      const data = await controller.readiness(response);
      return JSON.parse(JSON.stringify({ status: response.statusCode, body: { success: true, data } }));
    },
    progress: async () => { await worker.poll(); await scheduler.tick("synthetic"); }
  };
}

test("actual startup source returns 503 until actual worker/scheduler progress; bounded wait records 503 to READY", async () => {
  const f = sourceFixture(); let calls = 0;
  const result = await waitForRuntimeReadiness({
    ...virtual({ now: () => f.clock.Date.now(), monotonicNow: () => f.clock.Date.now(), sleep: async ms => f.clock.advance(ms) }),
    probe: async () => { if (++calls === 2) await f.progress(); return f.probe(); }
  });
  assert.deepEqual(result.diagnostics.observations.map(row => row.httpStatus), [503, 200]);
  assert.equal(result.diagnostics.observations[0].worker.lastPollAt, null);
  assert.equal(result.diagnostics.observations[0].reason, "ASYNC_RUNTIME_UNHEALTHY");
  assert.equal(result.observation.body.data.ready, true);
  assert.equal(result.diagnostics.outcome, "READY");
});

test("actual stale/error/disabled/DB failures stay 503 and process liveness remains process scope", async t => {
  const f = sourceFixture();
  for (const kind of ["stale-boundary", "worker-error", "scheduler-error", "disabled", "database", "queue-query"]) {
    await t.test(kind, async () => {
      f.prisma.readiness = async () => ({ ready: true, reason: "READY" });
      f.prisma.$queryRaw = async () => [];
      f.health.worker.status = "running"; f.health.worker.lastError = null;
      await f.progress();
      if (kind === "stale-boundary") f.clock.advance(30_000);
      if (kind === "worker-error") f.health.worker.lastError = "synthetic-private-error";
      if (kind === "scheduler-error") f.health.scheduler.lastError = "synthetic-private-error";
      if (kind === "disabled") f.health.worker.status = "disabled";
      if (kind === "database") f.prisma.readiness = async () => ({ ready: false, reason: "DATABASE_UNAVAILABLE" });
      if (kind === "queue-query") f.prisma.$queryRaw = async () => { throw new Error("synthetic-private-error"); };
      const observation = await f.probe();
      assert.equal(observation.status, 503); assert.equal(observation.body.data.ready, false);
      assert.equal(diagnoseRuntimeReadiness(observation, { now: f.clock.Date.now() }).failure, undefined);
      assert.equal(f.live.health().scope, "process"); assert.equal(f.live.health().status, "ok");
    });
  }
});

test("continuous 503 fails at the deadline with all observations retained", async () => {
  const error = await rejectsCode(waitForRuntimeReadiness({ ...virtual(), probe: async () => starting() }), "READINESS_TIMEOUT");
  assert.equal(error.diagnostics.elapsedMs, 1_000);
  assert.equal(error.diagnostics.observations.length, 10);
  assert.ok(error.diagnostics.observations.every(row => row.httpStatus === 503 && !row.ready));
});

test("a separate attempt cap also prevents unbounded retries under a frozen injected clock", async () => {
  const error = await rejectsCode(waitForRuntimeReadiness({ ...virtual({ sleep: async () => {} }), probe: async () => starting() }), "READINESS_ATTEMPT_LIMIT");
  assert.equal(error.diagnostics.attempts, 11);
});

test("401/403 fail immediately without consuming or logging denied bodies", async t => {
  for (const status of [401, 403]) await t.test(String(status), async () => {
    let calls = 0;
    const error = await rejectsCode(waitForRuntimeReadiness({ ...virtual(), probe: async signal => readRuntimeReadiness({
      baseUrl: "http://synthetic.invalid/api", token: "PRIVATE_TOKEN", signal,
      fetchImpl: async () => { calls++; return { status, text: () => { throw new Error("PRIVATE_BODY"); } }; }
    }) }), "PERMISSION_DENIED");
    assert.equal(calls, 1); assert.doesNotMatch(error.message, /PRIVATE/);
  });
});

test("unexpected HTTP statuses never become successful readiness", async t => {
  for (const status of [302, 404, 429, 500]) await t.test(String(status), async () => {
    const error = await rejectsCode(waitForRuntimeReadiness({ ...virtual(), probe: async () => ({ status, body: ready().body }) }), "UNEXPECTED_HTTP_STATUS");
    assert.equal(error.diagnostics.attempts, 1);
  });
});

test("malformed JSON and malformed health shapes fail instead of retrying", async t => {
  await t.test("JSON", async () => {
    await rejectsCode(waitForRuntimeReadiness({ ...virtual(), probe: signal => readRuntimeReadiness({ baseUrl: "http://synthetic.invalid/api", token: "private", signal,
      fetchImpl: async () => ({ status: 503, text: async () => "PRIVATE_NOT_JSON" }) }) }), "MALFORMED_RESPONSE");
  });
  for (const [name, mutate] of [
    ["empty", row => { row.body = {}; }],
    ["arbitrary503", row => { row.status = 503; row.body = { success: false, data: null, message: "PRIVATE_ERROR" }; }],
    ["stringReady", row => { row.body.data.ready = "true"; }],
    ["missingHeartbeat", row => { delete row.body.data.worker.lastPollAt; }],
    ["invalidTimestamp", row => { row.body.data.worker.lastPollAt = "PRIVATE_TOKEN"; }],
    ["unknownReason", row => { row.body.data.reason = "PRIVATE_PAYLOAD"; }],
    ["unknownStatus", row => { row.body.data.worker.status = "PRIVATE_SECRET"; }]
  ]) await t.test(name, async () => {
    const row = ready(); mutate(row);
    const error = await rejectsCode(waitForRuntimeReadiness({ ...virtual(), probe: async () => row }), "MALFORMED_RESPONSE");
    assert.equal(error.diagnostics.attempts, 1); assert.doesNotMatch(error.message, /PRIVATE/);
  });
});

test("HTTP 200 must match READY, DB readiness and fresh error-free heartbeats", async t => {
  for (const [name, mutate] of [
    ["503Ready", row => { row.status = 503; }],
    ["200NotReady", row => { row.body.data.ready = false; }],
    ["stale", row => { row.body.data.worker.lastPollAt = stamp(epoch - 30_000); }],
    ["future", row => { row.body.data.scheduler.lastPollAt = stamp(epoch + 1); }],
    ["error", row => { row.body.data.worker.hasError = true; }],
    ["database", row => { row.body.data.database = { ready: false, reason: "DATABASE_UNAVAILABLE" }; }]
  ]) await t.test(name, async () => {
    const row = ready(); mutate(row);
    await rejectsCode(waitForRuntimeReadiness({ ...virtual(), probe: async () => row }), "READINESS_CONTRACT_MISMATCH");
  });
});

test("known guard-level DB 503 is recorded as unknown runtime state, then requires a real snapshot", async () => {
  let calls = 0;
  const result = await waitForRuntimeReadiness({ ...virtual(), probe: async () => ++calls === 1
    ? { status: 503, body: { success: false, data: null, message: "Service unavailable" } } : ready(epoch + 100) });
  assert.equal(result.diagnostics.observations[0].reason, "SERVICE_UNAVAILABLE_BEFORE_RUNTIME_SNAPSHOT");
  assert.equal(result.diagnostics.observations[0].database, null);
  assert.equal(result.diagnostics.observations[1].httpStatus, 200);
});

test("DB recovery requires both heartbeats strictly after the restore barrier", async () => {
  let calls = 0;
  const result = await waitForRuntimeReadiness({ ...virtual(), heartbeatAfter: epoch, probe: async () => {
    const row = ready();
    if (++calls >= 2) row.body.data.worker.lastPollAt = stamp(epoch + 100);
    if (calls >= 3) row.body.data.scheduler.lastPollAt = stamp(epoch + 200);
    return row;
  } });
  assert.equal(calls, 3);
  assert.deepEqual(result.diagnostics.observations.map(row => row.waitingFor), [
    ["worker-heartbeat-after-recovery", "scheduler-heartbeat-after-recovery"], ["scheduler-heartbeat-after-recovery"], []
  ]);
});

test("actual DB failure/recovery source cannot bypass the post-restore heartbeat barrier", async () => {
  const f = sourceFixture(); await f.progress();
  f.prisma.readiness = async () => ({ ready: false, reason: "DATABASE_UNAVAILABLE" });
  const unavailable = await f.probe();
  assert.equal(unavailable.status, 503);
  assert.equal(diagnoseRuntimeReadiness(unavailable).database.reason, "DATABASE_UNAVAILABLE");
  f.clock.advance(1_000);
  const restoredAt = f.clock.Date.now();
  f.prisma.readiness = async () => ({ ready: true, reason: "READY" });
  let calls = 0;
  const result = await waitForRuntimeReadiness({
    ...virtual({ now: () => f.clock.Date.now(), monotonicNow: () => f.clock.Date.now(), sleep: async ms => f.clock.advance(ms) }),
    heartbeatAfter: restoredAt, probe: async () => {
      if (++calls === 2) await f.worker.poll();
      if (calls === 3) await f.scheduler.tick("synthetic");
      return f.probe();
    }
  });
  assert.deepEqual(result.diagnostics.observations.map(row => row.waitingFor), [
    ["worker-heartbeat-after-recovery", "scheduler-heartbeat-after-recovery"], ["scheduler-heartbeat-after-recovery"], []
  ]);
  assert.equal(result.diagnostics.observations[0].httpStatus, 200, "DB ready and old fresh heartbeats alone are insufficient recovery evidence");
});

test("DB-ready 200 with only pre-recovery heartbeats still times out", async () => {
  const error = await rejectsCode(waitForRuntimeReadiness({ ...virtual(), heartbeatAfter: epoch, probe: async () => ready() }), "READINESS_TIMEOUT");
  assert.ok(error.diagnostics.observations.every(row => row.httpStatus === 200 && row.waitingFor.length === 2));
});

test("raw network errors are not retried or attached as a secret-bearing cause", async () => {
  const error = await rejectsCode(waitForRuntimeReadiness({ ...virtual(), probe: async () => { throw new Error("postgresql://PRIVATE_TOKEN:PRIVATE_SECRET/private payload"); } }), "REQUEST_FAILED");
  assert.equal(error.cause, undefined); assert.doesNotMatch(error.message, /PRIVATE|postgresql|payload/);
});

test("request timeout aborts a hung request even when it ignores the signal", async () => {
  let signal;
  const error = await rejectsCode(waitForRuntimeReadiness({ timeoutMs: 200, requestTimeoutMs: 10, probe: value => { signal = value; return new Promise(() => {}); } }), "REQUEST_TIMEOUT");
  assert.equal(signal.aborted, true); assert.equal(error.diagnostics.attempts, 1);
});

test("body-consumption timeout is bounded too", async () => {
  await rejectsCode(waitForRuntimeReadiness({ timeoutMs: 200, requestTimeoutMs: 10, probe: signal => readRuntimeReadiness({
    baseUrl: "http://synthetic.invalid/api", token: "PRIVATE_TOKEN", signal,
    fetchImpl: async () => ({ status: 200, text: () => new Promise(() => {}) })
  }) }), "REQUEST_TIMEOUT");
});

test("READY received at or after the overall deadline cannot pass", async () => {
  let time = epoch;
  await rejectsCode(waitForRuntimeReadiness({ ...virtual({ now: () => time, monotonicNow: () => time }), probe: async () => { time += 1_000; return ready(time); } }), "READINESS_TIMEOUT");
});

test("diagnostics whitelist fields while returned observation preserves raw body for leak assertions", async () => {
  const row = ready(); Object.assign(row.body, { accessToken: "PRIVATE_TOKEN" });
  Object.assign(row.body.data, { payload: { secret: "PRIVATE_PAYLOAD" } });
  Object.assign(row.body.data.worker, { instanceId: "PRIVATE_HOST", lastError: "PRIVATE_SECRET" });
  const result = await waitForRuntimeReadiness({ ...virtual(), probe: async () => row });
  assert.doesNotMatch(JSON.stringify(result.diagnostics), /PRIVATE|payload|secret|accessToken|lastError|instanceId/);
  assert.equal(result.observation.body.data.payload.secret, "PRIVATE_PAYLOAD");
});

test("HTTP probe uses only the configured route, bearer header, supplied signal and no redirects", async () => {
  const controller = new AbortController();
  const observation = await readRuntimeReadiness({ baseUrl: "http://synthetic.invalid/api", token: "synthetic", signal: controller.signal,
    fetchImpl: async (url, options) => {
      assert.equal(url, "http://synthetic.invalid/api/admin/runtime/readiness");
      assert.equal(options.signal, controller.signal); assert.equal(options.redirect, "error");
      assert.deepEqual(options.headers, { authorization: "Bearer synthetic" });
      return { status: 200, text: async () => JSON.stringify(ready().body) };
    } });
  assert.equal(observation.body.data.reason, "READY");
});

test("invalid or unbounded wait options are rejected before probing", async () => {
  for (const options of [{ timeoutMs: Infinity }, { timeoutMs: 60_001 }, { intervalMs: 0 }, { requestTimeoutMs: 8_001 }, { heartbeatAfter: "private" }]) {
    await assert.rejects(waitForRuntimeReadiness({ probe: () => assert.fail("must not probe"), ...options }), /INVALID_READINESS_WAIT_OPTIONS/);
  }
});
