import { execFileSync, spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { seedBaseDevelopment } from "../database/seed.mjs";
import { assertPortAvailable } from "../port-availability.mjs";
import { assertPath, assertRepository, createLocalState, paths, profile, readLocalState, refuse, root, systemEnvironment, writePrivate } from "./config.mjs";
import { assertNoResources, inspectResources, localDocker, startDatabase, stopDatabase } from "./docker.mjs";
import { migrateBase } from "./database.mjs";
import { buildApplications, hasBuild } from "./build.mjs";
import { checkedProcesses, saveProcesses, snapshot, stopServices } from "./processes.mjs";

export const help = `Usage: node scripts/base-development/cli.mjs <init|start|status|stop> [--build]
  init          Create only new dedicated Base resources, deploy registered migrations and run the shared seed.
                Repeated init preserves menus, passwords, grants and custom configuration; no reset/reconciliation.
  start         Resume the locally owned database and API/Web, building isolated outputs if absent.
  start --build Rebuild apps/api/.base-dev-dist and apps/web/.next-base-dev (first stop Base services).
  status        Report recorded ownership and service state without printing secrets.
  stop          Stop only verified owned API/Web supervisors and database container; retain DB/volume/credentials.
Project aij-base-dev / development: http://127.0.0.1:3855/login; API http://127.0.0.1:3856/api; PostgreSQL 127.0.0.1:55434.
Run from the canonical repository root. Runtime secrets: .local-data/base-development/runtime.env (0600).
Initial administrator: aij-admin; initial-only password file .local-data/base-development/initial-admin.json (0600).
No fixture, test runtime, reverse proxy, host dev/test target, password recovery or destructive lifecycle is supported.
After source changes use stop, start --build; the first start builds automatically. Services persist after this CLI exits.
`;
export function argumentsFor(args) {
  if (args.length === 0 || args.length === 1 && ["help", "--help", "-h"].includes(args[0])) return { action: "help", build: false };
  const [action, flag, ...extra] = args;
  if (!["init", "start", "status", "stop"].includes(action) || extra.length || flag !== undefined && (action !== "start" || flag !== "--build")) refuse("Invalid Base command; use --help");
  return { action, build: flag === "--build" };
}
export function assertIgnored(pathsToCheck) {
  for (const path of pathsToCheck) {
    assertPath(path);
    try { execFileSync("git", ["--no-optional-locks", "check-ignore", "--quiet", "--", path], { cwd: root, stdio: "ignore", env: systemEnvironment() }); }
    catch { refuse("Base local state/build outputs must be Git-ignored before writing: " + path); }
  }
}
async function locked(operation) {
  const parent = dirname(profile.directory); assertPath(parent);
  const lock = join(parent, ".base-development-operation.lock"); assertPath(lock, { restricted: true });
  assertIgnored([lock, ...Object.values(paths)]);
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  try { writeFileSync(lock, JSON.stringify({ pid: process.pid, repository: root, createdAt: new Date().toISOString() }) + "\n", { flag: "wx", mode: 0o600 }); }
  catch { refuse("Another Base operation/lock exists; inspect its process owner, no automatic removal"); }
  try { return await operation(); } finally { unlinkSync(lock); }
}
async function startService(application, owner, running) {
  await assertPortAvailable(application === "api" ? profile.apiPort : profile.webPort);
  const log = join(profile.directory, application + ".log"); assertPath(log, { restricted: true });
  const fd = openSync(log, "a", 0o600);
  const child = spawn(process.execPath, ["scripts/base-development/service.mjs", application, owner.instanceId], {
    cwd: root, env: systemEnvironment(), detached: true, stdio: ["ignore", fd, fd]
  });
  closeSync(fd);
  let spawnFailed = false; child.once("error", () => { spawnFailed = true; });
  let record;
  for (let count = 0; count < 30; count++) {
    if (spawnFailed || child.exitCode !== null || child.signalCode !== null) refuse("Base " + application + " supervisor exited before process registration");
    if (child.pid) record = snapshot(child.pid);
    if (record?.command.endsWith("scripts/base-development/service.mjs " + application + " " + owner.instanceId)) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!record?.command.endsWith("scripts/base-development/service.mjs " + application + " " + owner.instanceId)) refuse("Base supervisor identity was not recorded; inspect owned service state");
  running[application] = record;
  saveProcesses(owner, running); child.unref();
}
async function ready(application, owner) {
  const url = application === "api" ? "http://127.0.0.1:3856/api/ready" : "http://127.0.0.1:3855/login";
  for (let count = 0; count < 180; count++) {
    if (!checkedProcesses(owner)[application]) refuse("Base " + application + " exited before readiness; inspect its private log");
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (response.status === 200) {
        if (application === "api") {
          const health = await fetch("http://127.0.0.1:3856/api/health", { signal: AbortSignal.timeout(1000) });
          const payload = (await health.json()).data;
          if (health.status !== 200 || payload?.service !== "aij-base-dev-api" || payload?.namespace !== "aij-base-dev:development") refuse("Base API readiness identity differs from the declared project");
        }
        return;
      }
    } catch { /* bounded readiness probe, no alternate target */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  refuse("Base " + application + " readiness timed out; recorded services retained for inspection/stop");
}
export async function runCommand({ action, build }) {
  if (action === "help") return help;
  assertRepository();
  if (action === "status" && !existsSync(profile.directory)) return { status: "NOT_INITIALIZED", project: profile.project };
  return locked(async () => {
    let state, handle;
    if (!existsSync(profile.directory)) {
      if (action !== "init") refuse("Initialize the dedicated Base target first: base:dev init");
      handle = localDocker(); assertNoResources(handle);
      for (const port of [profile.webPort, profile.apiPort, profile.dbPort]) await assertPortAvailable(port);
      state = createLocalState(handle);
    } else { state = readLocalState(); handle = localDocker(state.owner); }
    const container = inspectResources(handle, state.owner);
    const running = checkedProcesses(state.owner);
    if (action === "status") return {
      status: "OWNED", project: profile.project, initialized: state.owner.initialized, instanceId: state.owner.instanceId,
      database: { running: !!container?.State.Running, port: profile.dbPort, volume: profile.volume },
      services: running, web: "http://127.0.0.1:3855/login", api: "http://127.0.0.1:3856/api", initialCredentialFile: paths.credentials
    };
    if (action === "stop") {
      const services = await stopServices(state.owner);
      return { status: "STOPPED", services, database: stopDatabase(handle, state.owner) };
    }
    if (action === "init") {
      await startDatabase(handle, state);
      await migrateBase(state.values, "deploy");
      const seeded = await seedBaseDevelopment();
      writePrivate(paths.owner, { ...state.owner, initialized: true });
      return { status: "INITIALIZED", project: profile.project, menus: seeded.baseDevelopment.menus, username: seeded.username, initialCredentialFile: seeded.credentials.file, existingCredentialsAndGrantsPreserved: true, next: "node scripts/base-development/cli.mjs start" };
    }
    if (!state.owner.initialized) refuse("Base initialization is incomplete; retry init without replacing local state");
    const needsBuild = build || !hasBuild(state.owner);
    if (needsBuild && Object.keys(running).length) refuse("Stop owned Base services before rebuilding isolated outputs");
    // Check both unowned ports before database/build/service mutations.
    for (const [name, port] of [["api", profile.apiPort], ["web", profile.webPort]]) if (!running[name]) await assertPortAvailable(port);
    await startDatabase(handle, state);
    await migrateBase(state.values, "status");
    if (needsBuild) {
      assertIgnored([join(profile.apiOutput, "main.js"), join(profile.webOutput, "BUILD_ID")]);
      buildApplications(state.owner, state.values);
    }
    for (const application of ["api", "web"]) {
      if (!running[application]) await startService(application, state.owner, running);
      await ready(application, state.owner);
    }
    return { status: "RUNNING", project: profile.project, web: "http://127.0.0.1:3855/login", api: "http://127.0.0.1:3856/api", initialCredentialFile: paths.credentials, services: checkedProcesses(state.owner) };
  });
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const result = await runCommand(argumentsFor(process.argv.slice(2)));
    process.stdout.write(typeof result === "string" ? result : JSON.stringify(result, null, 2) + "\n");
  } catch (error) {
    // Only policy errors contain controlled text. Raw filesystem/JSON/driver causes stay private.
    process.stderr.write(JSON.stringify({ status: "REJECTED", reason: error.exitCode ? error.message : "Base operation failed; inspect local ownership/configuration without replacing data" }) + "\n");
    process.exitCode = error.exitCode || 2;
  }
}
