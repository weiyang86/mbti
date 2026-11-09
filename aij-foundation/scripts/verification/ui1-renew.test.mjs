import assert from "node:assert/strict";
import * as fs from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import test from "node:test";
import { archiveUi1, processExists, renewalArguments } from "./ui1-renew.mjs";

const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const task = "AF-029", acceptanceId = "b256f19c7593d266";
const request = { task, acceptanceId };
function fixture(t) {
  const root = fs.mkdtempSync(join(tmpdir(), "aij-ui1-renew-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  function put(path, bytes) {
    fs.mkdirSync(dirname(path), { recursive: true });
    fs.writeFileSync(path, bytes, { mode: 0o600 });
  }
  const directory = join(root, ".artifacts/af-029");
  const statePaths = [join(directory, "manual.json"), join(directory, "web.json")];
  const leasePath = join(root, ".local-data/postgres/acceptance", acceptanceId + ".json");
  const ownerPath = join(root, ".local-data/postgres/test/owner.json");
  const schemaPath = join(root, "apps/api/prisma/schema.prisma");
  const database = "aij_foundation_af029_test_" + acceptanceId;
  const credentialPath = join(root, ".local-data/seed/test", database, "initial-admin.json");
  const instanceId = "12345678-1234-1234-1234-123456789abc";
  const processRecord = (pid, web = false) => ({ pid, ppid: 700, birth: "Tue Oct 27 12:19:20 2026", cwd: join(root, web ? "apps/web" : "apps/api"),
    command: process.execPath + " " + join(root, web ? "scripts/verification/ui1-web-host.mjs" : "apps/api/dist/main.js") });
  const manual = { task, acceptanceId, database, status: "PREPARED", pid: 710, process: processRecord(710), initialPasswordFile: credentialPath, note: "合成旧状态" };
  const web = { task, acceptanceId, database, status: "STOPPED", process: processRecord(711, true), apiPid: 710, apiState: statePaths[0], initialPasswordFile: credentialPath };
  put(statePaths[0], " \n" + JSON.stringify(manual, null, 3) + "\r\n");
  put(statePaths[1], JSON.stringify(web) + "\n\n");
  put(leasePath, JSON.stringify({ task, id: acceptanceId, mode: "test", ready: true, repository: root, database, instanceId, schemaSha256: hash("old schema") }) + "\n");
  put(ownerPath, JSON.stringify({ repository: root, mode: "test", project: "aij-foundation-test", instanceId }));
  put(schemaPath, "current schema\n");
  put(credentialPath, "synthetic original credential; never read or rewritten\n");
  put(join(directory, "old-runtime.log"), "original log\n");
  put(join(root, ".local-data/postgres/test/postgres-password"), "synthetic-db-password\n");
  put(join(root, ".local-data/auth/old-key.json"), "synthetic-key\n");
  const probes = [];
  const adapters = { root, processExists: async pid => { probes.push(["pid", pid]); return false; },
    assertPortAvailable: async port => { probes.push(["port", port]); } };
  function mutate(path, change) { const value = JSON.parse(fs.readFileSync(path)); change(value); fs.writeFileSync(path, JSON.stringify(value)); }
  function tree(path = root) {
    return fs.readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(entry => {
      const file = join(path, entry.name);
      return entry.isDirectory() ? tree(file) : [{ path: relative(root, file), bytes: fs.readFileSync(file).toString("base64"), mode: fs.statSync(file).mode }];
    });
  }
  return { root, directory, statePaths, leasePath, ownerPath, schemaPath, credentialPath, adapters, probes, mutate, tree };
}
function code(expected) { return error => { assert.equal(error.code, expected); return true; }; }
const archives = f => fs.readdirSync(join(f.directory, "renewals", acceptanceId)).map(id => join(f.directory, "renewals", acceptanceId, id));
const assertUnlocked = f => { for (const name of ["web.lock", "manual.lock"]) assert.equal(fs.existsSync(join(f.directory, name)), false); };

test("CLI requires explicit archive, exactly AF-029 and a valid expected lease", async t => {
  assert.deepEqual(renewalArguments(["archive", "--task", task, "--acceptance", acceptanceId]), request);
  for (const args of [[], ["prepare", "--task", task, "--acceptance", acceptanceId], ["archive", "--task", task],
    ["archive", "--task", task, "--acceptance", acceptanceId, "--force"]]) assert.throws(() => renewalArguments(args), code("USAGE"));
  const f = fixture(t), before = f.tree();
  await assert.rejects(archiveUi1({ ...request, task: "AF-030" }, f.adapters), code("UNSUPPORTED_TASK"));
  await assert.rejects(archiveUi1({ ...request, acceptanceId: "../../bad" }, f.adapters), code("INVALID_LEASE"));
  assert.deepEqual(f.tree(), before);
  assert.deepEqual(f.probes, []);
});

test("absent or partial state and unchanged/invalid schema are refused without side effects", async t => {
  for (const mode of ["both missing", "manual missing", "web missing", "same schema", "bad schema hash"]) {
    await t.test(mode, async t => {
      const f = fixture(t);
      if (mode.includes("missing")) for (const [i, path] of f.statePaths.entries()) {
        if (mode.startsWith("both") || mode.startsWith(i ? "web" : "manual")) fs.unlinkSync(path);
      }
      if (mode === "same schema") f.mutate(f.leasePath, lease => { lease.schemaSha256 = hash(fs.readFileSync(f.schemaPath)); });
      if (mode === "bad schema hash") f.mutate(f.leasePath, lease => { lease.schemaSha256 = "forged"; });
      const before = f.tree();
      await assert.rejects(archiveUi1(request, f.adapters), code(mode === "same schema" ? "SCHEMA_UNCHANGED" : mode === "bad schema hash" ? "INVALID_SCHEMA_SNAPSHOT" : "REQUIRED_FILE_MISSING"));
      assert.deepEqual(f.tree(), before);
      assert.deepEqual(f.probes, []);
    });
  }
});

test("forged state/task/lease/owner/process/path records cannot retire pointers", async t => {
  const mutations = [
    ["state task", f => f.mutate(f.statePaths[0], s => { s.task = "AF-043"; })],
    ["web task", f => f.mutate(f.statePaths[1], s => { s.task = "AF-030"; })],
    ["state lease", f => f.mutate(f.statePaths[1], s => { s.acceptanceId = "0000000000000000"; })],
    ["lease task", f => f.mutate(f.leasePath, s => { s.task = "AF-124"; })],
    ["lease ID", f => f.mutate(f.leasePath, s => { s.id = "0000000000000000"; })],
    ["lease mode", f => f.mutate(f.leasePath, s => { s.mode = "dev"; })],
    ["lease repository", f => f.mutate(f.leasePath, s => { s.repository = "/somewhere/else"; })],
    ["lease database", f => f.mutate(f.leasePath, s => { s.database = "aij_foundation_test"; })],
    ["lease not ready", f => f.mutate(f.leasePath, s => { s.ready = false; })],
    ["lease instance", f => f.mutate(f.leasePath, s => { s.instanceId = "unknown"; })],
    ["owner instance", f => f.mutate(f.ownerPath, s => { s.instanceId = "unknown"; })],
    ["state database", f => f.mutate(f.statePaths[0], s => { s.database = "aij_foundation_test"; })],
    ["API PID", f => f.mutate(f.statePaths[1], s => { s.apiPid++; })],
    ["invalid PID", f => f.mutate(f.statePaths[0], s => { s.process.pid = 1; })],
    ["process command", f => f.mutate(f.statePaths[1], s => { s.process.command = "other service"; })],
    ["process cwd", f => f.mutate(f.statePaths[0], s => { s.process.cwd = "/other/repo/apps/api"; })],
    ["credential path", f => f.mutate(f.statePaths[1], s => { s.initialPasswordFile = "/other/credential"; })],
    ["linked state", f => { fs.renameSync(f.statePaths[0], f.statePaths[0] + ".saved"); fs.symlinkSync(f.statePaths[0] + ".saved", f.statePaths[0]); }]
  ];
  for (const [label, mutation] of mutations) await t.test(label, async t => {
    const f = fixture(t); mutation(f); const before = f.tree();
    await assert.rejects(archiveUi1(request, f.adapters));
    assert.deepEqual(f.tree(), before);
    assert.deepEqual(f.probes, []);
  });
});

test("live/reused API or Web PID, unknown liveness, occupied or unprobeable ports all refuse", async t => {
  for (const condition of ["API alive", "Web alive", "unknown process", "3655", "3656", "probe failed"]) await t.test(condition, async t => {
    const f = fixture(t), before = f.tree();
    const adapters = { ...f.adapters, processExists: async pid => {
      if (condition === "unknown process") throw Object.assign(new Error("denied"), { code: "EPERM" });
      return pid === (condition === "API alive" ? 710 : condition === "Web alive" ? 711 : -1);
    }, assertPortAvailable: async port => {
      if (condition === String(port) || condition === "probe failed") throw new Error("port unavailable");
    } };
    await assert.rejects(archiveUi1(request, adapters));
    assert.deepEqual(f.tree(), before);
  });
});

test("default liveness recognizes only ESRCH as absent and never sends a terminating signal", t => {
  const calls = [];
  const mock = t.mock.method(process, "kill", (pid, signal) => { calls.push([pid, signal]); return true; });
  assert.equal(processExists(710), true);
  mock.mock.mockImplementation(() => { throw Object.assign(new Error("absent"), { code: "ESRCH" }); });
  assert.equal(processExists(710), false);
  mock.mock.mockImplementation(() => { throw Object.assign(new Error("unknown"), { code: "EPERM" }); });
  assert.throws(() => processExists(710), code("EPERM"));
  assert.deepEqual(calls, [[710, 0]]);
});

test("archive verifies exact bytes and persists intent BEFORE release; all retained files stay identical", async t => {
  const f = fixture(t), before = f.tree(), originals = f.statePaths.map(path => fs.readFileSync(path));
  const originalHashes = originals.map(hash);
  let released = 0;
  const io = { ...fs, unlinkSync(path) {
    if (f.statePaths.includes(path)) {
      const [archive] = archives(f), manifest = JSON.parse(fs.readFileSync(join(archive, "manifest.json")));
      assert.equal(manifest.status, "ARCHIVE_VERIFIED_RELEASE_PENDING");
      assert.deepEqual(manifest.files.map(file => hash(fs.readFileSync(file.archive))), originalHashes);
      assert.deepEqual(manifest.files.map(file => file.sha256), originalHashes);
      for (const name of ["web.lock", "manual.lock"]) assert.ok(fs.existsSync(join(f.directory, name)));
      released++;
    }
    fs.unlinkSync(path);
  } };
  const result = await archiveUi1(request, { ...f.adapters, io });
  assert.equal(result.status, "ARCHIVED_FOR_RENEWAL"); assert.equal(released, 2);
  for (const [i, name] of ["manual.json", "web.json"].entries()) assert.deepEqual(fs.readFileSync(join(result.archiveDirectory, name)), originals[i]);
  assert.equal(JSON.parse(fs.readFileSync(join(result.archiveDirectory, "complete.json"))).status, result.status);
  const retained = before.filter(item => !f.statePaths.some(path => relative(f.root, path) === item.path));
  const after = f.tree();
  for (const item of retained) assert.deepEqual(after.find(row => row.path === item.path), item);
  assert.ok(f.probes.some(([kind, value]) => kind === "pid" && value === 710));
  assert.ok(f.probes.some(([kind, value]) => kind === "pid" && value === 711));
  assert.deepEqual(f.probes.filter(([kind]) => kind === "port").map(([, port]) => port), [3655, 3656, 3655, 3656, 3655, 3656]);
  assertUnlocked(f);
  const completeTree = f.tree();
  await assert.rejects(archiveUi1(request, f.adapters));
  assert.deepEqual(f.tree(), completeTree, "repeat must not create a second archive");
});

test("writer locks are respected and a partially acquired lock is released", async t => {
  for (const lock of ["web.lock", "manual.lock"]) await t.test(lock, async t => {
    const f = fixture(t); fs.writeFileSync(join(f.directory, lock), "other writer"); const before = f.tree();
    await assert.rejects(archiveUi1(request, f.adapters));
    assert.deepEqual(f.tree(), before);
  });
});

test("copy/hash/intent/release/completion failures preserve originals and recovery evidence", async t => {
  for (const point of ["copy write", "copy hash", "intent", "second release", "completion"]) await t.test(point, async t => {
    const f = fixture(t), originals = f.statePaths.map(path => fs.readFileSync(path));
    const credential = fs.readFileSync(f.credentialPath), lease = fs.readFileSync(f.leasePath);
    let faulted = false;
    const io = { ...fs, writeFileSync(path, bytes, options) {
      if (path.includes("/renewals/") && !faulted) {
        if ((point === "copy write" && path.endsWith("/web.json")) || (point === "intent" && path.endsWith("/manifest.json")) ||
          (point === "completion" && path.endsWith("/complete.json"))) { faulted = true; throw new Error("injected write failure"); }
        if (point === "copy hash" && path.endsWith("/manual.json")) { faulted = true; return fs.writeFileSync(path, "corrupt copy", options); }
      }
      return fs.writeFileSync(path, bytes, options);
    }, unlinkSync(path) {
      if (point === "second release" && path === f.statePaths[1] && !faulted) { faulted = true; throw new Error("injected release failure"); }
      return fs.unlinkSync(path);
    } };
    await assert.rejects(archiveUi1(request, { ...f.adapters, io }), code("ARCHIVE_FAILED"));
    assert.equal(faulted, true);
    for (const [i, path] of f.statePaths.entries()) assert.deepEqual(fs.readFileSync(path), originals[i]);
    assert.deepEqual(fs.readFileSync(f.credentialPath), credential); assert.deepEqual(fs.readFileSync(f.leasePath), lease);
    const [archive] = archives(f), failure = JSON.parse(fs.readFileSync(join(archive, "failed.json")));
    assert.equal(failure.status, "FAILED"); assert.equal(failure.locksRetained, false);
    assertUnlocked(f);
    // A restored stale state can be explicitly retried; the failed attempt stays.
    const result = await archiveUi1(request, f.adapters);
    assert.equal(result.status, "ARCHIVED_FOR_RENEWAL"); assert.equal(archives(f).length, 2);
    assert.ok(fs.existsSync(join(archive, "failed.json")));
  });
});

test("failed rollback retains locks and byte-valid copies for exclusive manual recovery", async t => {
  const f = fixture(t), originals = f.statePaths.map(path => fs.readFileSync(path));
  const io = { ...fs, unlinkSync(path) {
    if (path === f.statePaths[1]) throw new Error("cannot release web");
    return fs.unlinkSync(path);
  }, writeFileSync(path, bytes, options) {
    if (path === f.statePaths[0]) throw new Error("cannot restore API pointer");
    return fs.writeFileSync(path, bytes, options);
  } };
  await assert.rejects(archiveUi1(request, { ...f.adapters, io }), code("RECOVERY_REQUIRED_LOCKS_RETAINED"));
  const [archive] = archives(f), manifest = JSON.parse(fs.readFileSync(join(archive, "manifest.json")));
  assert.equal(fs.existsSync(f.statePaths[0]), false);
  for (const [i, file] of manifest.files.entries()) assert.deepEqual(fs.readFileSync(file.archive), originals[i]);
  for (const name of ["web.lock", "manual.lock"]) assert.ok(fs.existsSync(join(f.directory, name)));
  const beforeRetry = f.tree();
  await assert.rejects(archiveUi1(request, f.adapters)); assert.deepEqual(f.tree(), beforeRetry);
  // Simulate the documented exclusive restore after the coordinator verifies
  // this stopped operation's locks. Never overwrite an existing state.
  fs.copyFileSync(manifest.files[0].archive, manifest.files[0].source, fs.constants.COPYFILE_EXCL);
  assert.equal(hash(fs.readFileSync(manifest.files[0].source)), manifest.files[0].sha256);
  for (const name of ["web.lock", "manual.lock"]) fs.unlinkSync(join(f.directory, name));
  assert.equal((await archiveUi1(request, f.adapters)).status, "ARCHIVED_FOR_RENEWAL");
});

test("process, evidence or archive changes during recheck prevent any release", async t => {
  for (const change of ["process", "schema", "archive"]) await t.test(change, async t => {
    const f = fixture(t), originals = f.statePaths.map(path => fs.readFileSync(path));
    let probes = 0;
    await assert.rejects(archiveUi1(request, { ...f.adapters, assertPortAvailable: async () => {
      probes++;
      if (probes === 6 && change === "schema") fs.writeFileSync(f.schemaPath, "changed during archive");
      if (probes === 6 && change === "archive") fs.writeFileSync(join(archives(f)[0], "manual.json"), "corrupted archive");
    }, processExists: async () => change === "process" && probes >= 4 }));
    for (const [i, path] of f.statePaths.entries()) assert.deepEqual(fs.readFileSync(path), originals[i]);
    assertUnlocked(f);
  });
});

test("all archive ancestors are synced before release; late completion failure restores sources", async t => {
  const f = fixture(t), originals = f.statePaths.map(path => fs.readFileSync(path));
  const opened = new Map(), synced = new Set();
  let completeWritten = false;
  const io = { ...fs, openSync(path, flags) { const fd = fs.openSync(path, flags); opened.set(fd, path); return fd; },
    closeSync(fd) { opened.delete(fd); return fs.closeSync(fd); },
    fsyncSync(fd) {
      const path = opened.get(fd);
      if (completeWritten && path === archives(f)[0]) throw new Error("late directory sync failed");
      synced.add(path); return fs.fsyncSync(fd);
    }, writeFileSync(path, bytes, options) {
      const result = fs.writeFileSync(path, bytes, options);
      if (path.endsWith("/complete.json")) completeWritten = true;
      return result;
    }, unlinkSync(path) {
      if (f.statePaths.includes(path)) {
        const [archive] = archives(f);
        for (const parent of [archive, dirname(archive), dirname(dirname(archive)), f.directory]) assert.ok(synced.has(parent), parent);
      }
      return fs.unlinkSync(path);
    } };
  await assert.rejects(archiveUi1(request, { ...f.adapters, io }), code("ARCHIVE_FAILED"));
  const [archive] = archives(f);
  assert.ok(fs.existsSync(join(archive, "complete.json")), "late failure can leave a completion marker");
  assert.equal(JSON.parse(fs.readFileSync(join(archive, "failed.json"))).status, "FAILED", "failure takes precedence");
  for (const [i, path] of f.statePaths.entries()) assert.deepEqual(fs.readFileSync(path), originals[i]);
  assertUnlocked(f);
});

test("lock cleanup failure reports its archive and leaves fencing evidence for coordinator", async t => {
  const f = fixture(t);
  const io = { ...fs, unlinkSync(path) {
    if (path.endsWith("/manual.lock")) throw new Error("lock cleanup failed");
    return fs.unlinkSync(path);
  } };
  await assert.rejects(archiveUi1(request, { ...f.adapters, io }), error => {
    assert.equal(error.code, "LOCK_RELEASE_FAILED"); assert.ok(error.archiveDirectory); return true;
  });
  const [archive] = archives(f);
  assert.ok(fs.existsSync(join(archive, "complete.json")));
  assert.ok(fs.existsSync(join(f.directory, "manual.lock")));
  assert.ok(fs.existsSync(join(f.directory, "web.lock")));
  for (const path of f.statePaths) assert.equal(fs.existsSync(path), false);
});
