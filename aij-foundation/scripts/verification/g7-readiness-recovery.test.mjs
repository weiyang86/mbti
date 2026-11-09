import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { closeSync, mkdirSync, mkdtempSync, openSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import { createAcceptance, migrate } from "../database/migration.mjs";
import { applicationSessions, readinessEnvironment, setTaskDatabaseConnections } from "./readiness-support.mjs";
import { inspectApi } from "./readiness-manual.mjs";
import { assertPortAvailable } from "../port-availability.mjs";
import { repositoryRoot } from "../database/connection.mjs";

const task = "AF-044";
const apiDir = resolve(repositoryRoot, "apps/api");
const apiMain = resolve(apiDir, "dist/main.js");
const sleep = ms => new Promise(resolveSleep => setTimeout(resolveSleep, ms));

async function get(path) {
  const response = await fetch("http://127.0.0.1:3656/api/" + path, { signal: AbortSignal.timeout(3000) });
  return { status: response.status, body: await response.json() };
}

async function waitFor(path, status, reason) {
  const deadline = Date.now() + 12000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const result = await get(path);
      if (result.status === status && (!reason || result.body.data?.reason === reason || result.body.reason === reason)) return result;
      lastError = new Error("Unexpected " + path + " HTTP " + result.status + " (" + (result.body.data?.reason ?? result.body.reason ?? "no reason") + ")");
    } catch (error) { lastError = error; }
    await sleep(100);
  }
  throw lastError ?? new Error("Timed out waiting for " + path);
}

async function startApi(id, evidenceDir) {
  const runId = randomUUID();
  const logFile = join(evidenceDir, "api-" + runId + ".log");
  const fd = openSync(logFile, "wx", 0o600);
  const child = spawn(process.execPath, [apiMain], {
    cwd: apiDir,
    detached: true,
    env: readinessEnvironment(id, task),
    stdio: ["ignore", fd, fd]
  });
  closeSync(fd);
  assert.ok(child.pid, "Owned API process has a PID");
  const deadline = Date.now() + 5000;
  let actual;
  while (Date.now() < deadline) {
    actual = inspectApi(child.pid);
    if (actual?.cwd && actual?.birth) break;
    await sleep(100);
  }
  assert.ok(actual?.cwd && actual?.birth, "API identity must be inspectable before use or stop");
  assert.equal(actual.pid, child.pid);
  assert.ok(actual.ppid === process.pid || actual.ppid === 1);
  assert.equal(actual.cwd, apiDir);
  assert.equal(actual.command, process.execPath + " " + apiMain);
  const owned = { child, pid: child.pid, ppid: actual.ppid, cwd: actual.cwd, command: actual.command, birth: actual.birth, logFile, runId };
  try {
    await waitFor("health", 200);
  } catch (error) {
    await stopApi(owned, id, evidenceDir);
    throw error;
  }
  writeFileSync(join(evidenceDir, "start-" + runId + ".json"), JSON.stringify({ task, assertion: "PID/PPID/CWD/command/birth verified", process: { pid: owned.pid, ppid: owned.ppid, cwd: owned.cwd, command: owned.command, birth: owned.birth } }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  return owned;
}

async function stopApi(owned, acceptanceId, evidenceDir) {
  const actual = inspectApi(owned.pid);
  if (actual) {
    assert.equal(actual.pid, owned.pid);
    assert.ok(actual.ppid === owned.ppid || actual.ppid === 1);
    assert.equal(actual.cwd, owned.cwd);
    assert.equal(actual.command, owned.command);
    assert.equal(actual.birth, owned.birth);
    const exit = owned.child.exitCode !== null
      ? Promise.resolve(owned.child.exitCode)
      : new Promise(resolveExit => owned.child.once("exit", resolveExit));
    writeFileSync(join(evidenceDir, "stop-" + owned.runId + ".json"), JSON.stringify({ task, signal: "SIGTERM", assertion: "PID/PPID/CWD/command/birth rechecked before signaling", process: actual }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    process.kill(actual.pid, "SIGTERM");
    const result = await Promise.race([exit, sleep(8000).then(() => "timeout")]);
    assert.notEqual(result, "timeout", "Owned API exits on SIGTERM; no force-kill fallback");
  }
  assert.equal(inspectApi(owned.pid), undefined, "Owned API process is stopped");
  assert.deepEqual(await applicationSessions(acceptanceId, task), [], "No Prisma pool sessions remain for this logical DB");
}

test("G7-03 real API process restart, task-owned database outage and recovery", { timeout: 180000 }, async t => {
  await assertPortAvailable(3656);
  const lease = await createAcceptance("test", task);
  const migration = await migrate({ mode: "test", action: "deploy", acceptanceId: lease.id });
  assert.equal(migration.exitCode, 0);
  const evidenceRoot = join(repositoryRoot, ".artifacts/af-044");
  mkdirSync(evidenceRoot, { recursive: true });
  const evidenceDir = mkdtempSync(join(evidenceRoot, "service-"));
  const record = value => writeFileSync(join(evidenceDir, "result-" + randomUUID() + ".json"), JSON.stringify({ task, database: lease.database, ...value }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  let owned;
  let dbUnavailable = false;
  try {
    await t.test("service starts against the isolated migrated DB and reports ready/live", async () => {
      owned = await startApi(lease.id, evidenceDir);
      const ready = await waitFor("ready", 200, "READY");
      const live = await get("health");
      assert.equal(live.status, 200); assert.equal(live.body.data.scope, "process");
      record({ phase: "initial-ready", pid: owned.pid, ready, live });
    });

    await t.test("owned API restart closes the exact process and its Prisma pool", async () => {
      await stopApi(owned, lease.id, evidenceDir); owned = undefined;
      await assertPortAvailable(3656);
      record({ phase: "first-stop", processStopped: true, prismaSessions: 0 });
    });

    await t.test("database connection loss returns ready 503 while liveness remains 200, then same process recovers", async () => {
      const state = await setTaskDatabaseConnections(lease.id, false, task);
      assert.equal(state.datallowconn, false); dbUnavailable = true;
      owned = await startApi(lease.id, evidenceDir);
      const unavailable = await waitFor("ready", 503, "DATABASE_UNAVAILABLE");
      const live = await get("health");
      assert.equal(live.status, 200); assert.equal(live.body.data.scope, "process");
      const failureText = JSON.stringify(unavailable);
      assert.doesNotMatch(failureText, /postgresql:|PrismaClient|password|stack|55433|aij_foundation_af044/);
      const pidDuringOutage = owned.pid;
      const restored = await setTaskDatabaseConnections(lease.id, true, task);
      assert.equal(restored.datallowconn, true); dbUnavailable = false;
      const recovered = await waitFor("ready", 200, "READY");
      assert.equal(inspectApi(pidDuringOutage)?.pid, pidDuringOutage, "Recovery uses the same live process");
      record({ phase: "db-outage-recovery", unavailable, live, recovered, sameProcessPid: pidDuringOutage, databaseRestored: true, postgresContainerStopped: false });
      await stopApi(owned, lease.id, evidenceDir); owned = undefined;
    });

    await t.test("second clean API restart returns ready and leaves no connection pool", async () => {
      owned = await startApi(lease.id, evidenceDir);
      const ready = await waitFor("ready", 200, "READY");
      assert.equal((await get("health")).status, 200);
      await stopApi(owned, lease.id, evidenceDir); owned = undefined;
      record({ phase: "second-restart", ready, prismaSessions: 0, postgresContainerStopped: false });
    });

    await t.test("task-owned DB accepts connections again and service processes left no sessions", async () => {
      assert.equal((await setTaskDatabaseConnections(lease.id, true, task)).datallowconn, true);
      assert.deepEqual(await applicationSessions(lease.id, task), []);
      const status = await migrate({ mode: "test", action: "status", acceptanceId: lease.id });
      assert.equal(status.exitCode, 0);
      record({ phase: "final-status", migrationStatus: "UP_TO_DATE", prismaSessions: 0, noResetDropOrVolumeCleanup: true });
    });
  } finally {
    if (dbUnavailable) await setTaskDatabaseConnections(lease.id, true, task);
    if (owned) await stopApi(owned, lease.id, evidenceDir);
  }
});
