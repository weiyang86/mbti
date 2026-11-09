import { execFileSync, spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { assertPortAvailable } from "../port-availability.mjs";
import { assertPath, assertRepository, createLocalState, paths, profile, readLocalState, refuse, root, systemEnvironment, writePrivate, validateOwner, validateValues, assertExplicitEnvironmentSupport } from "./config.mjs";
import { assertNoResources, inspectResources, localDocker, startDatabase, stopDatabase } from "./docker.mjs";
import { migrateAiLocal } from "./database.mjs";
import { assertNoWebEnvironmentFiles, buildApplications, hasBuild } from "./build.mjs";
import { checkedProcesses, saveProcesses, snapshot, stopServices } from "./processes.mjs";

export const help = `Usage: node scripts/ai-local-development/cli.mjs <init|start|status|stop> [--build]
  init          Create only new dedicated AI local resources, deploy registered migrations and call the root-owned initialization hook.
                Repeated init preserves menus, passwords, grants and custom configuration; no reset/reconciliation; missing root hook fails.
  start         Resume the locally owned database and API/Web, building isolated outputs if absent.
  start --build Rebuild apps/api/.ai-local-dist and apps/web/.next-ai-local (first stop AI local services).
  status        Report recorded ownership and service state without printing secrets.
  stop          Stop only verified owned API/Web supervisors and database container; retain DB/volume/credentials.
Project aij-ai-local / development: http://127.0.0.1:3955/login; API http://127.0.0.1:3956/api; PostgreSQL 127.0.0.1:55435.
Run from the canonical repository root. Runtime secrets: .local-data/ai-local-development/runtime.env (0600).
Initial administrator: aij-admin; initial-only password file .local-data/ai-local-development/initial-admin.json (0600).
No fixture, test runtime, reverse proxy, host dev/test target, password recovery or destructive lifecycle is supported.
After source changes use stop, start --build; the first start builds automatically. Services persist after this CLI exits.
`;
export function argumentsFor(args) {
  if (args.length === 0 || args.length === 1 && ["help", "--help", "-h"].includes(args[0])) return { action: "help", build: false };
  const [action, flag, ...extra] = args;
  if (!["init", "start", "status", "stop"].includes(action) || extra.length || flag !== undefined && (action !== "start" || flag !== "--build")) refuse("Invalid AI local command; use --help");
  return { action, build: flag === "--build" };
}
export function assertIgnored(pathsToCheck) {
  for (const path of pathsToCheck) {
    assertPath(path);
    try { execFileSync("git", ["--no-optional-locks", "check-ignore", "--quiet", "--", path], { cwd: root, stdio: "ignore", env: systemEnvironment() }); }
    catch { refuse("AI local state/build outputs must be Git-ignored before writing: " + path); }
  }
}
async function locked(operation) {
  const parent = dirname(profile.directory); assertPath(parent);
  const lock = join(parent, ".ai-local-development-operation.lock"); assertPath(lock, { restricted: true });
  assertIgnored([lock, ...Object.values(paths)]);
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  try { writeFileSync(lock, JSON.stringify({ pid: process.pid, repository: root, createdAt: new Date().toISOString() }) + "\n", { flag: "wx", mode: 0o600 }); }
  catch { refuse("Another AI local operation/lock exists; inspect its process owner, no automatic removal"); }
  try { return await operation(); } finally { unlinkSync(lock); }
}
async function startService(application, owner, running) {
  await assertPortAvailable(application === "api" ? profile.apiPort : profile.webPort);
  const log = join(profile.directory, application + ".log"); assertPath(log, { restricted: true });
  const fd = openSync(log, "a", 0o600);
  const child = spawn(process.execPath, ["scripts/ai-local-development/service.mjs", application, owner.instanceId], {
    cwd: root, env: systemEnvironment(), detached: true, stdio: ["ignore", fd, fd]
  });
  closeSync(fd);
  child.unref();
  let spawnFailed = false; child.once("error", () => { spawnFailed = true; });
  let record;
  for (let count = 0; count < 30; count++) {
    if (spawnFailed || child.exitCode !== null || child.signalCode !== null) refuse("AI local " + application + " supervisor exited before process registration");
    if (child.pid) record = snapshot(child.pid);
    if (record?.command.endsWith("scripts/ai-local-development/service.mjs " + application + " " + owner.instanceId)) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!record?.command.endsWith("scripts/ai-local-development/service.mjs " + application + " " + owner.instanceId)) refuse("AI local supervisor identity was not recorded; inspect owned service state");
  running[application] = record;
  saveProcesses(owner, running);
}
async function ready(application, owner) {
  const url = application === "api" ? "http://127.0.0.1:3956/api/ready" : "http://127.0.0.1:3955/login";
  for (let count = 0; count < 180; count++) {
    if (!checkedProcesses(owner)[application]) refuse("AI local " + application + " exited before readiness; inspect its private log");
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (response.status === 200) {
        if (application === "api") {
          const health = await fetch("http://127.0.0.1:3956/api/health", { signal: AbortSignal.timeout(1000) });
          const payload = (await health.json()).data;
          if (health.status !== 200 || payload?.service !== "aij-ai-local-api" || payload?.namespace !== "aij-ai-local:development") refuse("AI local API readiness identity differs from the declared project");
        }
        return;
      }
    } catch { /* bounded readiness probe, no alternate target */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  refuse("AI local " + application + " readiness timed out; recorded services retained for inspection/stop");
}
// Loading happens only for init; no seed code or fixture owner is copied into this worker.
export async function loadInitializer(loader = specifier => import(specifier)) {
  const hook = join(root, "scripts/ai-local-development/root-initialization.mjs");
  assertPath(hook);
  let module;
  try { module = await loader(pathToFileURL(hook).href); }
  catch { refuse("Root initializeAiLocal hook is missing or could not load; initialization NOT_RUN"); }
  if (typeof module.initializeAiLocal !== "function") refuse("Root initializeAiLocal hook export is required; initialization NOT_RUN");
  return module.initializeAiLocal;
}
// Explicit offline collaborators are permitted for orchestration unit checks only.
// Production callers always pass the real root hook/database/owner-file operations below.
export async function initializeOwnedState(state, { initializeAiLocal, start, migrate, persist }) {
  validateOwner(state.owner);
  const runtime = validateValues(state.values);
  if ([initializeAiLocal, start, migrate, persist].some(value => typeof value !== "function")) refuse("Incomplete AI local initialization collaborators");
  await start(); await migrate();
  try { await initializeAiLocal({ owner: state.owner, values: state.values, runtime }); }
  catch { refuse("Root AI local initialization failed; initialized marker not written; owned resources retained"); }
  await persist({ ...state.owner, initialized: true });
  return { status: "INITIALIZED", project: profile.project, initialCredentialFile: paths.credentials,
    existingCredentialsAndGrantsPreserved: true, next: "node scripts/ai-local-development/cli.mjs start" };
}
export async function runCommand({ action, build }) {
  if (action === "help" && build === false) return help;
  const parsed = argumentsFor(build ? [action, "--build"] : [action]);
  if (parsed.action !== action || typeof build !== "boolean") refuse("Invalid AI local command object");
  if (action === "help") return help;
  assertRepository();
  let initializeAiLocal;
  if (action === "init") initializeAiLocal = await loadInitializer();
  if (["init", "start"].includes(action)) assertExplicitEnvironmentSupport();
  if (action === "status" && !existsSync(profile.directory)) return { status: "NOT_INITIALIZED", project: profile.project };
  return locked(async () => {
    let state, handle;
    if (!existsSync(profile.directory)) {
      if (action !== "init") refuse("Initialize the dedicated AI local target first: ai:local init");
      handle = localDocker(); assertNoResources(handle);
      for (const port of [profile.webPort, profile.apiPort, profile.dbPort]) await assertPortAvailable(port);
      state = createLocalState(handle);
    } else { state = readLocalState(); handle = localDocker(state.owner); }
    const container = inspectResources(handle, state.owner);
    const running = checkedProcesses(state.owner);
    if (action === "status") return {
      status: "OWNED", project: profile.project, initialized: state.owner.initialized, instanceId: state.owner.instanceId,
      database: { running: !!container?.State.Running, port: profile.dbPort, volume: profile.volume },
      readiness: "NOT_CHECKED", services: running, configuredWeb: "http://127.0.0.1:3955/login", configuredApi: "http://127.0.0.1:3956/api", initialCredentialFile: paths.credentials
    };
    if (action === "stop") {
      const services = await stopServices(state.owner);
      return { status: "STOPPED", services, database: stopDatabase(handle, state.owner) };
    }
    if (action === "init") {
      if (Object.keys(running).length) refuse("Stop owned AI local services before init");
      return initializeOwnedState(state, {
        initializeAiLocal, start: () => startDatabase(handle, state),
        migrate: () => migrateAiLocal(state.values, "deploy"), persist: owner => writePrivate(paths.owner, owner)
      });
    }
    if (!state.owner.initialized) refuse("AI local initialization is incomplete; retry init without replacing local state");
    const built = hasBuild(state.owner); // Validate any pre-existing output owner even for --build.
    const needsBuild = build || !built;
    if (needsBuild && Object.keys(running).length) refuse("Stop owned AI local services before rebuilding isolated outputs");
    assertNoWebEnvironmentFiles();
    // Check both unowned ports before database/build/service mutations.
    for (const [name, port] of [["api", profile.apiPort], ["web", profile.webPort]]) if (!running[name]) await assertPortAvailable(port);
    if (needsBuild) assertIgnored([join(profile.apiOutput, "main.js"), join(profile.webOutput, "BUILD_ID")]);
    await startDatabase(handle, state);
    await migrateAiLocal(state.values, "status");
    if (needsBuild) {
      buildApplications(state.owner, state.values);
    }
    for (const application of ["api", "web"]) {
      if (!running[application]) await startService(application, state.owner, running);
      await ready(application, state.owner);
    }
    return { status: "RUNNING", project: profile.project, web: "http://127.0.0.1:3955/login", api: "http://127.0.0.1:3956/api", initialCredentialFile: paths.credentials, services: checkedProcesses(state.owner) };
  });
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const result = await runCommand(argumentsFor(process.argv.slice(2)));
    process.stdout.write(typeof result === "string" ? result : JSON.stringify(result, null, 2) + "\n");
  } catch (error) {
    // Only policy errors contain controlled text. Raw filesystem/JSON/driver causes stay private.
    process.stderr.write(JSON.stringify({ status: "REJECTED", reason: error.exitCode ? error.message : "AI local operation failed; inspect local ownership/configuration without replacing data" }) + "\n");
    process.exitCode = error.exitCode || 2;
  }
}
