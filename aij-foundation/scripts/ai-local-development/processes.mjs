import { existsSync, readFileSync } from "node:fs";
import { paths, profile, root, assertPath, refuse, writePrivate, validateOwner } from "./config.mjs";

// Reuse the existing PID/birth/CWD inspection implementation; no process-name or port kill.
export { snapshot } from "../base-development/processes.mjs";
import { snapshot } from "../base-development/processes.mjs";
export function assertProcessIdentity(saved, actual, owner, application) {
  validateOwner(owner);
  if (!saved || !actual || saved.pid !== actual.pid || saved.birth !== actual.birth || saved.command !== actual.command || saved.uid !== actual.uid ||
      actual.uid !== process.getuid() || actual.cwd !== root || saved.cwd !== root ||
      !["api", "web"].includes(application) || !actual.command.endsWith("scripts/ai-local-development/service.mjs " + application + " " + owner.instanceId)) refuse("AI local PID/birth/CWD/command changed; process left untouched");
  return true;
}
export function readProcesses(owner) {
  validateOwner(owner);
  const stat = assertPath(paths.processes, { restricted: true });
  if (!stat) return {};
  const saved = JSON.parse(readFileSync(paths.processes, "utf8"));
  if (saved.instanceId !== owner.instanceId || saved.repository !== root || !saved.services || typeof saved.services !== "object" || Array.isArray(saved.services) || Object.keys(saved.services).some(key => !["api", "web"].includes(key))) refuse("AI local process record belongs to a different owner");
  return saved.services;
}
export function saveProcesses(owner, services) {
  validateOwner(owner);
  for (const [name, record] of Object.entries(services)) assertProcessIdentity(record, record, owner, name);
  writePrivate(paths.processes, { instanceId: owner.instanceId, repository: root, services });
}
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
    if (snapshot(record.pid)) refuse("Owned AI local service did not stop; no forced/port-based kill performed");
    delete running[name]; saveProcesses(owner, running);
  }
  return { stopped: true, credentialsRetained: existsSync(paths.credentials), databaseVolumeRetained: profile.volume };
}
