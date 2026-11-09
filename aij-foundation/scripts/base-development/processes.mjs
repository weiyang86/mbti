import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { paths, profile, root, assertPath, refuse, writePrivate, systemEnvironment } from "./config.mjs";

function execute(binary, args) { return execFileSync(binary, args, { env: systemEnvironment(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); }
function decodeLsof(value) {
  return value?.replace(/(?:\\x[0-9a-f]{2})+/gi, bytes => Buffer.from([...bytes.matchAll(/\\x([0-9a-f]{2})/gi)].map(match => Number.parseInt(match[1], 16))).toString("utf8"));
}
export function snapshot(pid) {
  if (!Number.isInteger(pid) || pid < 2) refuse("Invalid Base process PID");
  try {
    const line = execute("ps", ["-p", String(pid), "-o", "pid=,ppid=,uid=,lstart=,command="]).trim();
    const match = line.match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.{24})\s+(.+)$/);
    const cwd = decodeLsof(execute("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"]).split("\n").find(line => line.startsWith("n"))?.slice(1));
    if (!match || !cwd) refuse("Cannot establish Base PID/birth/CWD/command identity");
    return { pid: Number(match[1]), ppid: Number(match[2]), uid: Number(match[3]), birth: match[4], command: match[5], cwd };
  } catch (error) {
    // An empty ps result confirms absence. Inspection failures never authorize a kill.
    const result = execute("ps", ["-e", "-o", "pid="]).trim().split(/\s+/).map(Number);
    if (!result.includes(pid)) return null;
    if (error.exitCode) throw error;
    refuse("Base process is alive but its identity cannot be established; left untouched");
  }
}
export function assertProcessIdentity(saved, actual, owner, application) {
  if (!saved || !actual || saved.pid !== actual.pid || saved.birth !== actual.birth || saved.command !== actual.command ||
      actual.uid !== process.getuid() || actual.cwd !== root || saved.cwd !== root ||
      !["api", "web"].includes(application) || !actual.command.endsWith("scripts/base-development/service.mjs " + application + " " + owner.instanceId)) refuse("Base PID/birth/CWD/command changed; process left untouched");
  return true;
}
export function readProcesses(owner) {
  const stat = assertPath(paths.processes, { restricted: true });
  if (!stat) return {};
  const saved = JSON.parse(readFileSync(paths.processes, "utf8"));
  if (saved.instanceId !== owner.instanceId || saved.repository !== root || Object.keys(saved.services || {}).some(key => !["api", "web"].includes(key))) refuse("Base process record belongs to a different owner");
  return saved.services;
}
export function saveProcesses(owner, services) { writePrivate(paths.processes, { instanceId: owner.instanceId, repository: root, services }); }
export function checkedProcesses(owner) {
  const saved = readProcesses(owner), running = {};
  for (const [name, record] of Object.entries(saved)) {
    const actual = snapshot(record.pid);
    if (actual) { assertProcessIdentity(record, actual, owner, name); running[name] = actual; }
  }
  return running;
}
export async function stopServices(owner) {
  const running = checkedProcesses(owner); // Validate every process before stopping any.
  for (const [name, record] of Object.entries(running).reverse()) {
    assertProcessIdentity(record, snapshot(record.pid), owner, name);
    process.kill(record.pid, "SIGTERM");
    for (let count = 0; count < 100 && snapshot(record.pid); count++) await new Promise(resolve => setTimeout(resolve, 100));
    if (snapshot(record.pid)) refuse("Owned Base service did not stop; no forced/port-based kill performed");
    delete running[name]; saveProcesses(owner, running);
  }
  return { stopped: true, credentialsRetained: existsSync(paths.credentials), databaseVolumeRetained: profile.volume };
}
