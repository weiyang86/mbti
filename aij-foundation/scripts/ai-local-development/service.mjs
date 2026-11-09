// Detached persistent supervisor for the real API/Next applications, never a fixture server.
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readLocalState, refuse, assertRepository, assertExplicitEnvironmentSupport } from "./config.mjs";
import { assertNoWebEnvironmentFiles, hasBuild, launchPlan } from "./build.mjs";
import { snapshot } from "./processes.mjs";

export function assertChildIdentity(actual, recorded, plan, application, parentPid) {
  if (!actual || !recorded || actual.pid !== recorded.pid || actual.birth !== recorded.birth ||
      actual.ppid !== parentPid || actual.uid !== process.getuid() || actual.cwd !== plan.cwd ||
      !(actual.command === recorded.command || application === "web" && /^next-server \(v16\.[0-9.]+\)$/.test(actual.command))) {
    refuse("AI local child PID/birth/CWD/command/parent identity changed; left untouched");
  }
  return true;
}
export function supervise(application, instanceId) {
  assertRepository();
  const state = readLocalState();
  if (!state.owner.initialized || state.owner.instanceId !== instanceId || !["api", "web"].includes(application)) refuse("AI local service launch owner mismatch");
  assertExplicitEnvironmentSupport(state.values);
  if (!hasBuild(state.owner)) refuse("AI local service requires an owned READY build");
  if (application === "web") assertNoWebEnvironmentFiles();
  const plan = launchPlan(application, state.values);
  const child = spawn(process.execPath, [plan.binary, ...plan.args], { cwd: plan.cwd, env: plan.env, stdio: ["ignore", "pipe", "pipe"] });
  // Never forward raw application exceptions/headers/body/provider output into supervisor logs.
  child.stdout.resume(); child.stderr.resume();
  let recorded;
  const capture = setInterval(() => {
    if (!recorded && child.pid) {
      try {
        const actual = snapshot(child.pid);
        if (actual?.ppid === process.pid && actual.uid === process.getuid() && actual.cwd === plan.cwd &&
            (actual.command.includes(plan.binary) || application === "web" && /^next-server \(v16\.[0-9.]+\)$/.test(actual.command))) recorded = actual;
      } catch { /* An unverified live process never authorizes a stop. */ }
    }
  }, 50);
  let stopping = false;
  for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    try {
      const actual = snapshot(child.pid);
      if (actual) { assertChildIdentity(actual, recorded, plan, application, process.pid); child.kill("SIGTERM"); }
    } catch {
      process.stderr.write("AI local child identity could not be verified; process retained for owner inspection\n"); stopping = false;
    }
  });
  child.once("error", () => { clearInterval(capture); process.stderr.write("AI local child spawn failed\n"); process.exitCode = 1; });
  child.once("exit", code => {
    clearInterval(capture);
    process.stderr.write("AI local child exited; application=" + application + "; code=" + (Number.isInteger(code) ? code : "signal") + "\n");
    process.exitCode = code ?? (stopping ? 0 : 1);
  });
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    if (process.argv.length !== 4) refuse("AI local service requires application and owner instance");
    supervise(...process.argv.slice(2));
  } catch { process.stderr.write("AI local service startup rejected; inspect owner/configuration\n"); process.exitCode = 2; }
}
