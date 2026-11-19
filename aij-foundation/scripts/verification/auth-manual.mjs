import { UI2_TASKS, prepareUi2Fixture } from "./ui2-fixture.mjs";
import assert from "node:assert/strict";
import { prepareClientFixture, clientEnvironment, clientKeys } from "./client-auth-fixture.mjs";
import { prepareAuditObservation } from "./audit-log-fixture.mjs";
import { prepareSecretStore } from "./secret-store-fixture.mjs";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { acceptanceRecord, assertLocalPath, profile, repositoryRoot } from "../database/connection.mjs";
import { createAcceptance, migrate } from "../database/migration.mjs";
import { seedDatabase } from "../database/seed.mjs";
import { assertPortAvailable } from "../port-availability.mjs";
import { authEnvironment, authKeys } from "./auth-support.mjs";
import { inspectApi } from "./readiness-manual.mjs";
import { applicationSessions, waitReady } from "./readiness-support.mjs";
import { prepareRbacFixture } from "./rbac-fixture.mjs";

function location(task) {
  assert.ok(["AF-013", "AF-014", "AF-015", "AF-016", "AF-017", "AF-018", "AF-019", "AF-020", "AF-021", "AF-022", "AF-023", "AF-024", "AF-025-A", "AF-028", "AF-029", "AF-030", "AF-031", "AF-032", "AF-033", "AF-035", "AF-036", "AF-037", "AF-038", "AF-043"].includes(task));
  const directory = join(repositoryRoot, ".artifacts", task.toLowerCase());
  return { directory, statePath: join(directory, "manual.json") };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const save = state => { const { statePath } = location(state.task); assertLocalPath(statePath); writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n", { mode: 0o600 }); };
function assertOwned(state, actual) {
  location(state.task); assert.equal(acceptanceRecord("test", state.acceptanceId).task, state.task);
  assert.ok(actual.ppid === state.process.ppid || actual.ppid === 1, "Owned process parent must be recorded or adopted by init");
  assert.equal(actual.pid, state.pid); assert.equal(actual.command, state.process.command); assert.equal(actual.birth, state.process.birth);
  assert.equal(actual.cwd, resolve(repositoryRoot, "apps/api"));
  assert.equal(actual.command, process.execPath + " " + resolve(repositoryRoot, "apps/api/dist/main.js"));
}
async function locked(task, operation) {
  const { directory } = location(task);
  assertLocalPath(directory); mkdirSync(directory, { recursive: true, mode: 0o700 }); const path = join(directory, "manual.lock");
  writeFileSync(path, JSON.stringify({ pid: process.pid, ppid: process.ppid, cwd: process.cwd() }), { flag: "wx", mode: 0o600 });
  try { return await operation(); } finally { unlinkSync(path); }
}
async function stop(state) {
  const { directory } = location(state.task);
  const actual = inspectApi(state.pid);
  if (actual) {
    assertOwned(state, actual);
    writeFileSync(join(directory, "stop-" + state.runId + ".json"), JSON.stringify({ assertion: "PID/PPID/CWD/command/birth checked before exact owned PID signal", actual }, null, 2) + "\n");
    process.kill(state.pid, "SIGTERM");
  }
  for (let i = 0; i < 50; i++) {
    if (!inspectApi(state.pid) && (await applicationSessions(state.acceptanceId, state.task)).length === 0) {
      state.status = "STOPPED"; state.sessions = []; save(state); return state;
    }
    await sleep(100);
  }
  throw new Error("Owned API or pool did not close; no force kill");
}
export async function prepareAuthManual(task = "AF-013") {
  const { directory, statePath } = location(task);
  return locked(task, async () => {
    const previous = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : undefined;
    if (previous) assert.equal(previous.task, task);
    if (previous?.status === "PREPARED") {
      const actual = inspectApi(previous.pid);
      if (actual) { assertOwned(previous, actual); await waitReady(); return previous; }
    }
    await assertPortAvailable(3656);
    let lease, seeded, accounts = previous?.accounts;
    if (previous) {
      assert.equal(previous.task, task); lease = acceptanceRecord("test", previous.acceptanceId);
      await migrate({ mode: "test", action: "status", acceptanceId: lease.id });
      // Existing accounts and initial files are never reset, even after a manual password change.
      assertLocalPath(previous.initialPasswordFile); assert.ok(existsSync(previous.initialPasswordFile));
    } else {
      lease = await createAcceptance("test", task); await migrate({ mode: "test", action: "deploy", acceptanceId: lease.id });
      if (UI2_TASKS.includes(task)) { const fixture = await prepareUi2Fixture(lease.id, task); seeded = fixture.seed; accounts = fixture.accounts; }
      else if (task === "AF-025-A") { const fixture = await prepareClientFixture(lease.id); seeded = fixture.seed; accounts = fixture.accounts; }
      else if (["AF-014", "AF-015", "AF-016", "AF-017", "AF-018", "AF-019", "AF-020", "AF-021", "AF-022", "AF-023", "AF-024"].includes(task)) { const fixture = await prepareRbacFixture(lease.id, task); seeded = fixture.seed; accounts = fixture.accounts; }
      else seeded = await seedDatabase({ mode: "test", acceptanceId: lease.id, generateCredentials: true, adminUsers: ["AF-028", "AF-029", "AF-030", "AF-031", "AF-032", "AF-033"].includes(task) });
    }
    const auditObservation = task === "AF-024" ? await prepareAuditObservation(lease.id) : undefined;
    const store = task === "AF-023" ? prepareSecretStore(lease.id) : undefined;
    const keys = authKeys(lease.id, task), runId = randomUUID(), logFile = join(directory, "manual-" + runId + ".log"); assertLocalPath(logFile);
    const fd = openSync(logFile, "wx", 0o600);
    const child = spawn(process.execPath, [resolve(repositoryRoot, "apps/api/dist/main.js")], { cwd: resolve(repositoryRoot, "apps/api"), detached: true,
      env: Object.fromEntries(Object.entries(task === "AF-025-A" ? clientEnvironment(lease.id) : authEnvironment(lease.id, keys.secret, task)).filter(([, v]) => v !== undefined)), stdio: ["ignore", fd, fd] });
    closeSync(fd); assert.ok(child.pid); child.unref();
    let actual;
    for (let i = 0; i < 20; i++) { await sleep(100); actual = inspectApi(child.pid); if (actual?.cwd && actual?.birth) break; }
    assert.ok(actual); const p = profile("test");
    const state = { task, status: "STARTING", runId, pid: child.pid, process: actual, acceptanceId: lease.id, database: lease.database,
      ...(task === "AF-025-A" ? { customerAccounts: accounts, customerPasswordFile: accounts[0].initialPasswordFile, clientKeyFile: clientKeys(lease.id).file, cookieName: "aij_foundation_test_client_session", clientIssuer: "urn:aij:aij-foundation:test:api:client", clientAudience: "urn:aij:aij-foundation:test:client", requiredOrigin: "http://localhost:3655" } : {}),
      ...(store ? { secretStoreFile: store.file, syntheticStoreKeyFile: store.keyFile, syntheticReferences: store.references, secretsUrl: "http://localhost:3656/api/admin/secret-references" } : {}), ...(auditObservation ? { auditObservationId: auditObservation.id, auditLogsUrl: "http://localhost:3656/api/admin/logs" } : {}), username: "aij-admin", ...(accounts ? { accounts } : {}), initialPasswordFile: seeded?.credentials.file ?? previous.initialPasswordFile, jwtKeyFile: keys.path,
      databaseRole: p.user, databasePasswordFile: p.secretFile, logFile,
      healthUrl: "http://localhost:3656/api/health", readyUrl: "http://localhost:3656/api/ready",
      loginUrl: "http://localhost:3656/api/" + (task === "AF-025-A" ? "client/auth/login" : "auth/login"), meUrl: "http://localhost:3656/api/" + (task === "AF-025-A" ? "client/auth/me" : "auth/me"),
      stopCommand: ["AF-028", "AF-029", "AF-030", "AF-031", "AF-032", "AF-033", "AF-035", "AF-036", "AF-037", "AF-038", "AF-043"].includes(task) ? "node scripts/verification/ui1-manual.mjs stop --task " + task : task === "AF-025-A" ? "node scripts/verification/client-auth-manual.mjs stop" : task === "AF-024" ? "node scripts/verification/audit-logs-manual.mjs stop" : task === "AF-023" ? "node scripts/verification/secrets-manual.mjs stop" : task === "AF-022" ? "node scripts/verification/configuration-manual.mjs stop" : task === "AF-021" ? "node scripts/verification/dictionaries-manual.mjs stop" : task === "AF-020" ? "node scripts/verification/menus-manual.mjs stop" : task === "AF-019" ? "node scripts/verification/rbac-management-manual.mjs stop --task AF-019" : task === "AF-018" ? "node scripts/verification/admin-users-manual.mjs stop --task AF-018" : "node scripts/verification/" + (task === "AF-017" ? "rbac-enforcement" : task === "AF-016" ? "rbac-management" : task === "AF-015" ? "admin-users" : task === "AF-014" ? "rbac" : "auth") + "-manual.mjs stop", cleanup: "Stop only recorded owned API; retain synthetic databases/volumes/credentials. No reset/drop/down -v.",
      scope: UI2_TASKS.includes(task) ? "UI-2 owned synthetic management observation; Web recorded separately" : ["AF-028", "AF-029", "AF-030", "AF-031", "AF-032", "AF-033"].includes(task) ? "UI-1 synthetic administrator browser login/session/logout only; Web recorded separately; no customer lifecycle or UI-2" : task === "AF-025-A" ? "Synthetic client login/me only; no registration, logout/revocation, password change, consent, tenancy or Web" : "Synthetic core observation only; no Web, customer tenancy, refresh or logout/revocation",
      rolesUrl: "http://localhost:3656/api/admin/roles", permissionDefinitionsUrl: "http://localhost:3656/api/admin/permissions/manage",
      dictionariesUrl: "http://localhost:3656/api/admin/dicts",
      adminUsersUrl: "http://localhost:3656/api/admin/users", permissionsUrl: "http://localhost:3656/api/admin/permissions", myPermissionsUrl: "http://localhost:3656/api/admin/permissions/my" };
    assertOwned(state, actual); save(state);
    try { await waitReady(); state.status = "PREPARED"; state.sessions = await applicationSessions(lease.id, task); save(state); return state; }
    catch (error) { await stop(state); throw error; }
  });
}
export async function stopAuthManual(task = "AF-013") {
  const { statePath } = location(task);
  return locked(task, async () => { const state = JSON.parse(readFileSync(statePath, "utf8")); assert.equal(state.task, task); return stop(state); });
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    const args = process.argv.slice(2); assert.equal(args.length, 1); assert.ok(["prepare", "stop"].includes(args[0]));
    console.log(JSON.stringify(await (args[0] === "prepare" ? prepareAuthManual() : stopAuthManual())));
  } catch { console.error(JSON.stringify({ status: "REJECTED", reason: "Owned auth preparation/stop failed; inspect local state and process ownership; no credential reset or force kill" })); process.exitCode = 2; }
}
