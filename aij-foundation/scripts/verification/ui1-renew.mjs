// Explicit retirement of stale AF-029 pointers only. No database/service operations.
import * as fs from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import environment from "../runtime-environment.cjs";
import { assertPortAvailable } from "../port-availability.mjs";

const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const check = (condition, code) => { if (!condition) throw Object.assign(new Error(code), { code }); };

// ESRCH is the only proof of absence. Permission/inspection errors fail closed;
// even a reused PID must be resolved by the coordinator, never signalled here.
export function processExists(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { if (error.code === "ESRCH") return false; throw error; }
}

export function renewalArguments(args) {
  const [action, taskFlag, task, leaseFlag, acceptanceId, ...extra] = args;
  check(action === "archive" && taskFlag === "--task" && leaseFlag === "--acceptance" && !extra.length, "USAGE");
  check(task === "AF-029", "UNSUPPORTED_TASK");
  check(typeof acceptanceId === "string" && /^[a-f0-9]{16}$/.test(acceptanceId), "INVALID_LEASE");
  return { task, acceptanceId };
}

// Adapters permit real temporary-file tests without touching the repository's
// acceptance instances or binding ports. Production always uses these defaults.
export async function archiveUi1({ task, acceptanceId }, adapters = {}) {
  check(task === "AF-029", "UNSUPPORTED_TASK");
  check(typeof acceptanceId === "string" && /^[a-f0-9]{16}$/.test(acceptanceId), "INVALID_LEASE");
  const root = resolve(adapters.root ?? environment.repositoryRoot);
  const io = adapters.io ?? fs;
  const exists = adapters.processExists ?? processExists;
  const portAvailable = adapters.assertPortAvailable ?? assertPortAvailable;
  const directory = join(root, ".artifacts/af-029");
  const statePaths = [join(directory, "manual.json"), join(directory, "web.json")];
  const leasePath = join(root, ".local-data/postgres/acceptance", acceptanceId + ".json");
  const ownerPath = join(root, ".local-data/postgres/test/owner.json");
  const schemaPath = join(root, "apps/api/prisma/schema.prisma");
  const lockPaths = [join(directory, "web.lock"), join(directory, "manual.lock")];
  let archiveDirectory;

  function local(path) {
    check(typeof path === "string" && isAbsolute(path) && resolve(path) === path, "INVALID_LOCAL_PATH");
    const rel = relative(root, path);
    check(rel && !rel.startsWith(".." + sep) && rel !== ".." && !isAbsolute(rel), "INVALID_LOCAL_PATH");
    let cursor = root;
    check(!io.lstatSync(cursor).isSymbolicLink(), "SYMLINK_REJECTED");
    for (const component of rel.split(sep)) {
      cursor = join(cursor, component);
      check(!io.lstatSync(cursor, { throwIfNoEntry: false })?.isSymbolicLink(), "SYMLINK_REJECTED");
    }
    return path;
  }
  function read(path) {
    local(path);
    check(io.lstatSync(path, { throwIfNoEntry: false })?.isFile(), "REQUIRED_FILE_MISSING");
    return io.readFileSync(path);
  }
  function persist(path, bytes) {
    local(path);
    io.writeFileSync(path, bytes, { flag: "wx", mode: 0o600 });
    const fd = io.openSync(path, "r");
    try { io.fsyncSync(fd); } finally { io.closeSync(fd); }
    check(read(path).equals(Buffer.from(bytes)), "ARCHIVE_HASH_MISMATCH");
  }
  function syncDirectory(path) {
    const fd = io.openSync(local(path), "r");
    try { io.fsyncSync(fd); } finally { io.closeSync(fd); }
  }
  function snapshot() {
    const bytes = statePaths.map(read);
    const [manual, web] = bytes.map(value => JSON.parse(value));
    const leaseBytes = read(leasePath), ownerBytes = read(ownerPath), schemaBytes = read(schemaPath);
    const lease = JSON.parse(leaseBytes), owner = JSON.parse(ownerBytes);
    // Same repository/test-instance invariants as acceptanceRecord; this tool
    // deliberately does not resolve a connection or migrate a historical lease.
    const database = "aij_foundation_af029_test_" + acceptanceId;
    check(lease.task === task && lease.id === acceptanceId && lease.mode === "test" && lease.ready === true &&
      lease.repository === root && lease.database === database &&
      owner.repository === root && owner.mode === "test" && owner.project === "aij-foundation-test" &&
      /^[a-f0-9-]{36}$/.test(owner.instanceId) && lease.instanceId === owner.instanceId, "LEASE_OWNERSHIP_MISMATCH");
    check(typeof lease.schemaSha256 === "string" && /^[a-f0-9]{64}$/.test(lease.schemaSha256), "INVALID_SCHEMA_SNAPSHOT");
    const currentSchemaSha256 = hash(schemaBytes);
    check(lease.schemaSha256 !== currentSchemaSha256, "SCHEMA_UNCHANGED");
    for (const [index, state] of [manual, web].entries()) {
      check(state.task === task && state.acceptanceId === acceptanceId && state.database === database &&
        ["PREPARED", "STOPPED", "STARTING"].includes(state.status), "STATE_OWNERSHIP_MISMATCH");
      const p = state.process;
      check(p && Number.isSafeInteger(p.pid) && p.pid > 1 && Number.isSafeInteger(p.ppid) && p.ppid > 0 &&
        typeof p.birth === "string" && p.birth.trim() && p.cwd === join(root, index ? "apps/web" : "apps/api") &&
        p.command === process.execPath + " " + join(root, index ? "scripts/verification/ui1-web-host.mjs" : "apps/api/dist/main.js"), "INVALID_PROCESS_RECORD");
    }
    check(manual.pid === manual.process.pid && web.apiPid === manual.pid && web.apiState === statePaths[0], "STATE_PROCESS_MISMATCH");
    const credentialPath = join(root, ".local-data/seed/test", database, "initial-admin.json");
    check(manual.initialPasswordFile === credentialPath && web.initialPasswordFile === credentialPath, "CREDENTIAL_PATH_MISMATCH");
    local(credentialPath);
    check(io.lstatSync(credentialPath, { throwIfNoEntry: false })?.isFile(), "CREDENTIAL_FILE_MISSING");
    return { bytes, manual, web, lease, leaseBytes, ownerBytes, schemaBytes, currentSchemaSha256, credentialPath };
  }
  async function quiescent(state) {
    for (const pid of new Set([state.manual.pid, state.web.process.pid, state.web.apiPid])) {
      check(await exists(pid) === false, "PROCESS_ALIVE_OR_UNKNOWN");
    }
    for (const port of [3655, 3656]) await portAvailable(port);
  }
  function unchanged(before, after) {
    check(before.bytes.every((bytes, i) => bytes.equals(after.bytes[i])) &&
      before.leaseBytes.equals(after.leaseBytes) && before.ownerBytes.equals(after.ownerBytes) &&
      before.schemaBytes.equals(after.schemaBytes), "EVIDENCE_CHANGED");
  }

  // Rejections for absent/still-current states have no filesystem side effects.
  const initial = snapshot();
  await quiescent(initial);
  const heldLocks = [];
  let keepLocks = false;
  let original;
  let result, failure;
  const removed = [];
  try {
    for (const path of lockPaths) {
      local(path);
      io.writeFileSync(path, JSON.stringify({ task, acceptanceId, pid: process.pid, operation: "AF-132 explicit archive" }) + "\n", { flag: "wx", mode: 0o600 });
      heldLocks.push(path);
    }
    original = snapshot();
    unchanged(initial, original);
    await quiescent(original);
    const attemptId = randomUUID();
    archiveDirectory = join(directory, "renewals", acceptanceId, attemptId);
    local(archiveDirectory);
    io.mkdirSync(archiveDirectory, { recursive: true, mode: 0o700 });
    const files = statePaths.map((path, i) => ({
      source: path, archive: join(archiveDirectory, i ? "web.json" : "manual.json"),
      sha256: hash(original.bytes[i]), bytes: original.bytes[i].length
    }));
    for (const [i, file] of files.entries()) persist(file.archive, original.bytes[i]);
    // This immutable intent and both verified original-byte copies precede
    // EVERY unlink. Locks fence existing prepare/stop entry points.
    const manifest = {
      task, operation: "AF-132 explicit stale-state archive", attemptId, createdAt: new Date().toISOString(),
      status: "ARCHIVE_VERIFIED_RELEASE_PENDING", repository: root, acceptanceId,
      retainedDatabase: original.lease.database, leasePath, leaseSha256: hash(original.leaseBytes),
      previousSchemaSha256: original.lease.schemaSha256, currentSchemaSha256: original.currentSchemaSha256,
      files, credentialPath: original.credentialPath,
      retained: "Original lease/snapshot, databases, volumes, all credentials and logs; only manual.json/web.json pointers are retired",
      next: ["Coordinator: pnpm run verify:task -- AF-029", "Coordinator: pnpm run verify:task -- AF-029 --prepare-manual",
        "Record new lease/version/URLs/credential location; browser empty/wrong/correct login, refresh, logout and anonymous rejection; OWNER_CHECK_PENDING only"],
      recovery: "If failed.json exists OR complete.json is absent, do not prepare. Restore any missing source from its archive using exclusive create, verify both SHA-256 values; never overwrite a differing source. A failed record takes precedence over a complete marker. Resolve retained locks with coordinator ownership checks before retrying; retain this attempt."
    };
    persist(join(archiveDirectory, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
    // Persist every newly created directory entry, including renewals itself,
    // before the first source unlink (not just the leaf archive files).
    for (let path = archiveDirectory; ; path = dirname(path)) {
      syncDirectory(path);
      if (path === directory) break;
    }
    await quiescent(original);
    unchanged(original, snapshot());
    for (const [i, file] of files.entries()) check(read(file.archive).equals(original.bytes[i]), "ARCHIVE_HASH_MISMATCH");
    for (const [i, path] of statePaths.entries()) {
      check(read(path).equals(original.bytes[i]), "EVIDENCE_CHANGED");
      io.unlinkSync(path);
      removed.push(i);
    }
    syncDirectory(directory);
    persist(join(archiveDirectory, "complete.json"), JSON.stringify({ task, acceptanceId, status: "ARCHIVED_FOR_RENEWAL", completedAt: new Date().toISOString() }) + "\n");
    syncDirectory(archiveDirectory);
    result = { task, acceptanceId, status: "ARCHIVED_FOR_RENEWAL", archiveDirectory, manifestPath: join(archiveDirectory, "manifest.json"), dataRetained: true };
  } catch (error) {
    // Restore exclusively: an unexpected writer's differing bytes are never
    // overwritten. If restoration fails, leave locks to block implicit prepare.
    const recovery = [];
    for (const i of removed) {
      try {
        const path = statePaths[i];
        if (!io.existsSync(local(path))) {
          persist(path, original.bytes[i]);
        }
        check(read(path).equals(original.bytes[i]), "RECOVERY_SOURCE_DIFFERS");
        recovery.push({ source: path, restored: true, sha256: hash(original.bytes[i]) });
      } catch { keepLocks = true; recovery.push({ source: statePaths[i], restored: false }); }
    }
    if (removed.length) {
      try { syncDirectory(directory); } catch { keepLocks = true; }
    }
    if (archiveDirectory) {
      try {
        persist(join(archiveDirectory, "failed.json"), JSON.stringify({ task, acceptanceId, status: "FAILED", recovery, locksRetained: keepLocks }) + "\n");
        syncDirectory(archiveDirectory);
      } catch { /* Original archive/intent and lock evidence remain available. */ }
    }
    failure = Object.assign(new Error("UI-1 renewal rejected or failed; inspect retained evidence"), {
      code: keepLocks ? "RECOVERY_REQUIRED_LOCKS_RETAINED" : "ARCHIVE_FAILED", archiveDirectory, cause: error
    });
  }
  if (!keepLocks) for (const path of heldLocks.reverse()) {
    try { io.unlinkSync(path); }
    catch (cause) { throw Object.assign(new Error("Coordinator must inspect retained renewal locks"), { code: "LOCK_RELEASE_FAILED", archiveDirectory, cause, archiveFailure: failure }); }
  }
  if (failure) throw failure;
  return result;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { console.log(JSON.stringify(await archiveUi1(renewalArguments(process.argv.slice(2))))); }
  catch (error) {
    console.error(JSON.stringify({ status: "REJECTED", reason: "AF-029 explicit archive failed; no reset/drop/credential overwrite", code: error.code, archiveDirectory: error.archiveDirectory }));
    process.exitCode = 2;
  }
}
