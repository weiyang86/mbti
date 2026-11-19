import { performance } from "node:perf_hooks";

const reasons = new Set([
  "READY", "ASYNC_RUNTIME_DISABLED", "ASYNC_RUNTIME_UNHEALTHY", "DATABASE_UNAVAILABLE",
  "DATABASE_NOT_CONFIGURED", "DATABASE_IDENTITY_MISMATCH", "MIGRATION_METADATA_UNAVAILABLE",
  "MIGRATIONS_MISSING", "MIGRATIONS_INCOMPLETE", "SHUTTING_DOWN"
]);
const statuses = new Set(["starting", "running", "disabled", "stopped"]);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);

class ProbeError extends Error {
  constructor(code) { super(code); this.code = code; }
}

export class RuntimeReadinessError extends Error {
  constructor(code, diagnostics) {
    // Only whitelisted observations enter errors/reporter output; never attach a raw cause.
    super(`${code}: ${JSON.stringify(diagnostics)}`);
    this.code = code;
    this.diagnostics = diagnostics;
  }
}

// The signal covers both the HTTP request and consumption of its body.
export async function readRuntimeReadiness({ baseUrl, token, signal, fetchImpl = fetch }) {
  const response = await fetchImpl(baseUrl + "/admin/runtime/readiness", {
    headers: { authorization: "Bearer " + token }, signal, redirect: "error"
  });
  // Auth failures must fail immediately even if their response body is malformed.
  if (response.status !== 200 && response.status !== 503) return { status: response.status };
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); }
  catch { throw new ProbeError("MALFORMED_RESPONSE"); }
  return { status: response.status, body, text };
}

function stateProjection(state, now) {
  if (!object(state) || !statuses.has(state.status) || typeof state.hasError !== "boolean") throw new ProbeError("MALFORMED_RESPONSE");
  let timestamp = null;
  if (state.lastPollAt !== null) {
    if (typeof state.lastPollAt !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(state.lastPollAt)) throw new ProbeError("MALFORMED_RESPONSE");
    timestamp = Date.parse(state.lastPollAt);
    if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== state.lastPollAt) throw new ProbeError("MALFORMED_RESPONSE");
  }
  return { status: state.status, lastPollAt: state.lastPollAt, hasError: state.hasError, heartbeatAgeMs: timestamp === null ? null : now - timestamp };
}

const fresh = state => state.status === "running" && !state.hasError && state.heartbeatAgeMs !== null && state.heartbeatAgeMs >= 0 && state.heartbeatAgeMs < 30_000;

export function diagnoseRuntimeReadiness(observation, { now = Date.now(), heartbeatAfter = null } = {}) {
  const status = Number.isInteger(observation?.status) && observation.status >= 100 && observation.status <= 599 ? observation.status : null;
  const summary = { httpStatus: status };
  if (status === 401 || status === 403) return { ...summary, failure: "PERMISSION_DENIED" };
  if (status !== 200 && status !== 503) return { ...summary, failure: "UNEXPECTED_HTTP_STATUS" };
  try {
    const body = observation.body;
    if (!object(body)) throw new ProbeError("MALFORMED_RESPONSE");
    // During DB failure the actual admin Auth/RBAC guards can reject before the
    // health service runs. This exact safe envelope proves no runtime state.
    if (status === 503 && body.success === false && body.data === null && body.message === "Service unavailable") {
      return { ...summary, ready: false, reason: "SERVICE_UNAVAILABLE_BEFORE_RUNTIME_SNAPSHOT", database: null, worker: null, scheduler: null, waitingFor: ["runtime-snapshot"] };
    }
    const data = body.data;
    if (body.success !== true || !object(data) || typeof data.ready !== "boolean" || !object(data.database) || typeof data.database.ready !== "boolean" || !reasons.has(data.database.reason)) throw new ProbeError("MALFORMED_RESPONSE");
    // The current queue-query failure branch omits top-level reason. Preserve
    // that fact and its database reason instead of inventing a runtime cause.
    if (data.reason !== undefined && !reasons.has(data.reason)) throw new ProbeError("MALFORMED_RESPONSE");
    if (data.reason === undefined && data.database.ready) throw new ProbeError("MALFORMED_RESPONSE");
    const worker = stateProjection(data.worker, now), scheduler = stateProjection(data.scheduler, now);
    Object.assign(summary, { ready: data.ready, reason: data.reason ?? null,
      database: { ready: data.database.ready, reason: data.database.reason }, worker, scheduler });
    const healthy = data.database.ready && fresh(worker) && fresh(scheduler);
    if (data.ready !== (status === 200) || data.ready !== healthy ||
        data.database.ready !== (data.database.reason === "READY") ||
        (data.ready ? data.reason !== "READY" : data.reason === "READY")) throw new ProbeError("READINESS_CONTRACT_MISMATCH");
    const waitingFor = [];
    if (!data.ready) waitingFor.push("runtime-ready");
    for (const [name, state] of [["worker", worker], ["scheduler", scheduler]]) {
      if (heartbeatAfter !== null && (state.lastPollAt === null || Date.parse(state.lastPollAt) <= heartbeatAfter)) waitingFor.push(name + "-heartbeat-after-recovery");
    }
    return { ...summary, waitingFor };
  } catch (error) {
    return { ...summary, failure: error instanceof ProbeError ? error.code : "MALFORMED_RESPONSE" };
  }
}

async function boundedProbe(probe, timeoutMs) {
  const controller = new AbortController();
  let timer;
  const expired = new Promise((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new ProbeError("REQUEST_TIMEOUT")); }, timeoutMs);
  });
  try { return await Promise.race([expired, Promise.resolve().then(() => probe(controller.signal))]); }
  finally { clearTimeout(timer); }
}

export async function waitForRuntimeReadiness({
  probe, timeoutMs = 20_000, requestTimeoutMs = 8_000, intervalMs = 200,
  heartbeatAfter = null, now = Date.now, monotonicNow = () => performance.now(), sleep = delay
}) {
  if (typeof probe !== "function" || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000 ||
      !Number.isInteger(requestTimeoutMs) || requestTimeoutMs < 1 || requestTimeoutMs > 8_000 ||
      !Number.isInteger(intervalMs) || intervalMs < 1 || intervalMs > 5_000 ||
      (heartbeatAfter !== null && (!Number.isFinite(heartbeatAfter) || heartbeatAfter < 0))) throw new Error("INVALID_READINESS_WAIT_OPTIONS");
  const start = monotonicNow(), deadline = start + timeoutMs;
  const diagnostics = { timeoutMs, requestTimeoutMs, intervalMs, heartbeatAfter, attempts: 0, observations: [] };
  const fail = code => { throw new RuntimeReadinessError(code, { ...diagnostics, elapsedMs: Math.max(0, Math.round(monotonicNow() - start)), outcome: code }); };
  // Both wall duration and attempt count are bounded, including a nonconverging
  // 200 response whose heartbeats still precede the recovery barrier.
  const maxAttempts = Math.min(201, Math.ceil(timeoutMs / intervalMs) + 1);
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const remaining = deadline - monotonicNow();
    if (remaining <= 0) fail("READINESS_TIMEOUT");
    diagnostics.attempts = attempt;
    let observation;
    try { observation = await boundedProbe(probe, Math.min(requestTimeoutMs, remaining)); }
    catch (error) { fail(error instanceof ProbeError ? error.code : "REQUEST_FAILED"); }
    const summary = diagnoseRuntimeReadiness(observation, { now: now(), heartbeatAfter });
    diagnostics.observations.push({ attempt, elapsedMs: Math.max(0, Math.round(monotonicNow() - start)), ...summary });
    if (summary.failure) fail(summary.failure);
    if (monotonicNow() >= deadline) fail("READINESS_TIMEOUT");
    if (summary.ready && summary.waitingFor.length === 0) {
      return { observation, diagnostics: { ...diagnostics, elapsedMs: Math.max(0, Math.round(monotonicNow() - start)), outcome: "READY" } };
    }
    if (attempt < maxAttempts) await sleep(Math.min(intervalMs, deadline - monotonicNow()));
  }
  fail("READINESS_ATTEMPT_LIMIT");
}
