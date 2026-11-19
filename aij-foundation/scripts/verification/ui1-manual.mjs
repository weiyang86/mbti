import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { repositoryRoot, assertLocalPath, acceptanceRecord, withDatabase, readDatabaseEnvironment } from "../database/connection.mjs";
import { assertPortAvailable } from "../port-availability.mjs";
import { prepareAuthManual, stopAuthManual } from "./auth-manual.mjs";
import { inspectApi } from "./readiness-manual.mjs";

const sleep = ms => new Promise(r => setTimeout(r, ms));
function paths(task) { assert.ok(["AF-028", "AF-029", "AF-030", "AF-031", "AF-032", "AF-033", "AF-035", "AF-036", "AF-037", "AF-038", "AF-043"].includes(task)); const directory = join(repositoryRoot, ".artifacts", task.toLowerCase()); assertLocalPath(directory); return { directory, stateFile: join(directory, "web.json") }; }
function owned(state, actual) {
  assert.equal(acceptanceRecord("test", state.acceptanceId).task, state.task);
  assert.equal(actual.pid, state.process.pid); assert.ok(actual.ppid === state.process.ppid || actual.ppid === 1);
  assert.equal(actual.birth, state.process.birth); assert.equal(actual.cwd, resolve(repositoryRoot, "apps/web"));
  assert.equal(actual.command, process.execPath + " " + resolve(repositoryRoot, "scripts/verification/ui1-web-host.mjs"));
}
async function waitWeb() {
  for (let i = 0; i < 80; i++) {
    try { const response = await fetch("http://127.0.0.1:3655/login", { signal: AbortSignal.timeout(1500) }); if (response.status === 200 && (await response.text()).includes("欢迎回来")) return; } catch { /* bounded owned startup */ }
    await sleep(200);
  }
  throw new Error("Owned Web failed readiness");
}
async function locked(task, operation) {
  const { directory } = paths(task); mkdirSync(directory, { recursive: true }); const lock = join(directory, "web.lock");
  writeFileSync(lock, JSON.stringify({ pid: process.pid, ppid: process.ppid, cwd: process.cwd() }), { flag: "wx", mode: 0o600 });
  try { return await operation(); } finally { unlinkSync(lock); }
}
async function stopWeb(state) {
  const actual = inspectApi(state.process.pid), { directory, stateFile } = paths(state.task);
  if (actual) {
    owned(state, actual); writeFileSync(join(directory, "web-stop-" + state.runId + ".json"), JSON.stringify({ assertion: "PID/PPID/CWD/command/birth checked", actual }, null, 2));
    process.kill(actual.pid, "SIGTERM");
  }
  for (let i = 0; i < 50; i++) { if (!inspectApi(state.process.pid)) { state.status = "STOPPED"; writeFileSync(stateFile, JSON.stringify(state, null, 2)); return; } await sleep(100); }
  throw new Error("Owned Web did not stop; no forced kill");
}
export async function prepareUi1(task) {
  return locked(task, async () => {
    const { directory, stateFile } = paths(task), previous = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile)) : null;
    if (previous?.status === "PREPARED" && inspectApi(previous.process.pid)) { owned(previous, inspectApi(previous.process.pid)); const api = await prepareAuthManual(task); assert.equal(api.acceptanceId, previous.acceptanceId); previous.apiPid = api.pid; await waitWeb(); writeFileSync(stateFile, JSON.stringify(previous, null, 2)); return previous; }
    await assertPortAvailable(3655); const api = await prepareAuthManual(task), runId = randomUUID();
    const logFile = join(directory, "web-" + runId + ".log"), fd = openSync(logFile, "wx", 0o600);
    const child = spawn(process.execPath, [resolve(repositoryRoot, "scripts/verification/ui1-web-host.mjs")], { cwd: resolve(repositoryRoot, "apps/web"), detached: true,
      env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, LANG: "C.UTF-8", LC_ALL: "C.UTF-8", NODE_ENV: "production", APP_ENV: "test", RUNTIME_PROFILE: "host", PROJECT_ID: "aij-foundation", AUTH_ENABLED: "false", DATABASE_ENABLED: "false", CLIENT_AUTH_ENABLED: "false", ENABLED_PLUGINS: "", WEB_PORT: "3655", API_PORT: "3656", WEB_URL: "http://localhost:3655", NEXT_PUBLIC_API_URL: "http://localhost:3656/api", ...(["AF-035", "AF-036", "AF-037", "AF-038", "AF-043"].includes(task) ? { AIJ_NEXT_DIST_DIR: ".next-" + task.toLowerCase().replaceAll("-", "") } : {}) }, stdio: ["ignore", fd, fd] });
    closeSync(fd); assert.ok(child.pid); child.unref(); let actual;
    for (let i = 0; i < 30; i++) { actual = inspectApi(child.pid); if (actual?.birth && actual.cwd) break; await sleep(100); }
    assert.ok(actual); const state = { task, runId, status: "STARTING", process: actual, acceptanceId: api.acceptanceId, database: api.database, apiPid: api.pid, apiState: join(directory, "manual.json"), username: api.username, initialPasswordFile: api.initialPasswordFile,
      loginUrl: "http://localhost:3655/login", adminUrl: "http://localhost:3655/admin", dictionaryUrl: "http://localhost:3655/auth/dictionaries", configurationUrl: "http://localhost:3655/auth/configuration", secretReferencesPageUrl: "http://localhost:3655/auth/secrets", secretReferencesApiUrl: "http://localhost:3656/api/admin/secret-references", auditLogsPageUrl: "http://localhost:3655/auth/audit-logs", auditLogsApiUrl: "http://localhost:3656/api/admin/logs", apiUrl: "http://localhost:3656/api", logFile, stopCommand: "node scripts/verification/ui1-manual.mjs stop --task " + task,
      cleanup: "Retain synthetic database and credentials; stop only recorded processes, no reset/drop/down -v" };
    owned(state, actual); writeFileSync(stateFile, JSON.stringify(state, null, 2));
    try { await waitWeb(); state.status = "PREPARED"; writeFileSync(stateFile, JSON.stringify(state, null, 2)); return state; }
    catch (error) { await stopWeb(state); await stopAuthManual(task); throw error; }
  });
}
export async function stopUi1(task) {
  return locked(task, async () => {
    const { stateFile } = paths(task); if (existsSync(stateFile)) await stopWeb(JSON.parse(readFileSync(stateFile)));
    await stopAuthManual(task); return { task, status: "STOPPED", dataRetained: true };
  });
}
export async function expireUi1(task) {
  return locked(task, async () => {
  const { stateFile } = paths(task); const state = JSON.parse(readFileSync(stateFile)); assert.equal(state.task, task); assert.equal(state.status, "PREPARED");
  owned(state, inspectApi(state.process.pid));
  return withDatabase("test", readDatabaseEnvironment("test", process.env, state.acceptanceId), async client => {
    const result = await client.query("UPDATE public.admin_auth_session SET expires_at=NOW() WHERE user_id=(SELECT id FROM public.sys_user WHERE username='aij-admin') AND namespace='aij-foundation:test' AND transport='cookie' AND revoked_at IS NULL AND expires_at>NOW() RETURNING id");
    return { task, expiredSyntheticBrowserSessions: result.rowCount, database: state.database };
  }, { acceptanceId: state.acceptanceId });
  });
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const [action, flag, task, ...extra] = process.argv.slice(2); assert.equal(flag, "--task"); assert.equal(extra.length, 0); assert.ok(["prepare", "stop", "expire"].includes(action)); paths(task);
    console.log(JSON.stringify(await (action === "prepare" ? prepareUi1(task) : action === "stop" ? stopUi1(task) : expireUi1(task))));
  } catch { console.error(JSON.stringify({ status: "REJECTED", reason: "Owned UI-1 operation failed; inspect local evidence, no forced kill/reset" })); process.exitCode = 2; }
}
