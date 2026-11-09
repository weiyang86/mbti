import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import environment from "./runtime-environment.cjs";
import { assertLaunchPlugins } from "./plugin-launch-policy.mjs";
import { assertPortAvailable } from "./port-availability.mjs";

const [application, command] = process.argv.slice(2);
if (!["api", "web"].includes(application) || !["dev", "start", "build"].includes(command)) {
  throw new Error("Usage: run-app.mjs <api|web> <dev|start|build>");
}
const values = environment.readApplicationEnvironment();
const runtime = environment.resolveRuntimeEnvironment(values);
environment.assertRuntimeCapabilities(runtime);
assertLaunchPlugins(runtime.enabledPlugins);
// The source checkout owns the application code; a generated project root owns
// its storage and local configuration. Keep those two roots independent.
const workingDirectory = resolve(environment.repositoryRoot, "apps", application);
const require = createRequire(resolve(workingDirectory, "package.json"));
const port = application === "api" ? runtime.apiPort : runtime.webPort;
if (command !== "build") {
  await assertPortAvailable(port);
}
const binary = application === "api"
  ? (command === "start" ? resolve(workingDirectory, "dist/main.js") : require.resolve("@nestjs/cli/bin/nest.js"))
  : require.resolve("next/dist/bin/next");
const args = application === "api"
  ? (command === "start" ? [] : command === "dev" ? ["start", "--watch"] : ["build"])
  : command === "build" ? ["build", "--webpack"] : [command, "--webpack", "--port", String(port), "--hostname", "127.0.0.1"];
// `next start` does not accept the webpack build selector.
if (application === "web" && command === "start") args.splice(1, 1);
const child = spawn(process.execPath, [binary, ...args], {
  cwd: workingDirectory,
  // Give this invocation its own Unix group so stopping Nest also stops its API child.
  detached: process.platform !== "win32",
  stdio: "inherit",
  env: { ...values, NODE_ENV: command === "build" || command === "start" ? "production" : "development", APP_ENV: runtime.environment, WEB_PORT: String(runtime.webPort), API_PORT: String(runtime.apiPort), WEB_URL: runtime.webUrl, NEXT_PUBLIC_API_URL: runtime.apiUrl }
});
function stopOwnedProcessGroup(signal) {
  if (!child.pid) return;
  try {
    if (process.platform === "win32") child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => stopOwnedProcessGroup(signal));
child.once("error", (error) => { console.error(error.stack || error.message); process.exitCode = 1; });
child.once("exit", (code, signal) => {
  stopOwnedProcessGroup("SIGTERM");
  process.exitCode = code ?? (signal ? 1 : 0);
});
