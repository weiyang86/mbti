// Detached, persistent supervisor. Only CLI-recorded supervisors receive stop signals.
import { spawn } from "node:child_process";
import { readLocalState, refuse, redact } from "./config.mjs";
import { launchPlan } from "./build.mjs";
import { snapshot } from "./processes.mjs";

const [application, instanceId] = process.argv.slice(2);
const state = readLocalState();
if (state.owner.instanceId !== instanceId || !["api", "web"].includes(application) || process.argv.length !== 4) refuse("Base service launch owner mismatch");
const plan = launchPlan(application, state.values);
const child = spawn(process.execPath, [plan.binary, ...plan.args], { cwd: plan.cwd, env: plan.env, stdio: ["ignore", "pipe", "pipe"] });
let birth;
const capture = setInterval(() => { if (!birth && child.pid) birth = snapshot(child.pid)?.birth; }, 50);
function pipeSafe(stream, output) {
  let pending = "";
  stream.on("data", chunk => {
    pending += chunk.toString();
    const lines = pending.split("\n"); pending = lines.pop();
    for (const line of lines) output.write(redact(line, state.values) + "\n");
  });
  stream.on("end", () => { if (pending) output.write(redact(pending, state.values)); });
}
pipeSafe(child.stdout, process.stdout); pipeSafe(child.stderr, process.stderr);
let stopping = false;
for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => {
  if (stopping) return;
  stopping = true;
  try {
    const actual = snapshot(child.pid);
    if (actual) {
      if (!birth || actual.birth !== birth || actual.ppid !== process.pid || actual.uid !== process.getuid() || actual.cwd !== plan.cwd ||
          !(actual.command.includes(plan.binary) || application === "web" && /^next-server \(v16\./.test(actual.command))) refuse("Base child process identity changed; left untouched");
      child.kill("SIGTERM");
    }
  } catch { process.stderr.write("Base child identity could not be verified; manual ownership inspection required\n"); stopping = false; }
});
child.once("error", () => { clearInterval(capture); process.exitCode = 1; });
child.once("exit", code => { clearInterval(capture); process.exitCode = code ?? (stopping ? 0 : 1); });
