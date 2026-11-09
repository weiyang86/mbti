import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { join } from "node:path";
import { repositoryRoot, profile, readDatabaseEnvironment, withDatabase } from "../database/connection.mjs";
import { assertContainerOwnership, sentinel } from "../database/managed.mjs";

const parent = join(repositoryRoot, ".artifacts/af-005/integration");
mkdirSync(parent, { recursive: true });
const root = mkdtempSync(join(parent, "run-"));
let sequence = 0;
function run(command, extra = {}) {
  const child = spawnSync(command[0], command.slice(1), {
    cwd: repositoryRoot, encoding: "utf8", timeout: 50000,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, ...extra }
  });
  const output = child.stdout + child.stderr;
  for (const mode of ["dev", "test"]) {
    const password = readFileSync(profile(mode).secretFile, "utf8");
    assert.ok(!output.includes(password) && !output.includes(encodeURIComponent(password)), "actual database credentials must not leave ignored local files");
  }
  writeFileSync(join(root, String(++sequence).padStart(3, "0") + ".json"),
    JSON.stringify({ command, exitCode: child.status, stdout: child.stdout, stderr: child.stderr }, null, 2));
  assert.equal(child.error, undefined, "actual command must finish");
  const json = output.split("\n").find((line) => line.startsWith("{"));
  return { ...child, result: json ? JSON.parse(json) : undefined };
}
const lifecycle = (action, mode) => run(["pnpm", "run", "db:" + action, "--", mode]);
const hash = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

test("ownership guard refuses other project/instance/CWD/image/port/mount before lifecycle actions", () => {
  const p = profile("test"); const state = { instanceId: randomUUID() };
  const config = {
    Config: { Image: "postgres:16-alpine@sha256:e013e867e712fec275706a6c51c966f0bb0c93cfa8f51000f85a15f9865a28cb", Labels: {
      "io.aij.owner": "aij-foundation", "io.aij.mode": "test", "io.aij.instance": state.instanceId,
      "com.docker.compose.project": p.project, "com.docker.compose.service": "postgres",
      "com.docker.compose.project.working_dir": repositoryRoot, "com.docker.compose.project.config_files": p.composeFile
    } },
    HostConfig: { PortBindings: { "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "55433" }] } },
    Mounts: [{ Type: "volume", Name: p.volume, Destination: "/var/lib/postgresql/data" }]
  };
  assert.equal(assertContainerOwnership(config, p, state), true);
  const mutations = [
    (c) => c.Config.Labels["io.aij.owner"] = "other-project",
    (c) => c.Config.Labels["io.aij.instance"] = randomUUID(),
    (c) => c.Config.Labels["com.docker.compose.project.working_dir"] = "/other",
    (c) => c.Config.Labels["com.docker.compose.project.config_files"] = "/other/compose.yml",
    (c) => c.Config.Image = "postgres:latest",
    (c) => c.HostConfig.PortBindings["5432/tcp"][0].HostIp = "0.0.0.0",
    (c) => c.HostConfig.PortBindings["5432/tcp"][0].HostPort = "15435",
    (c) => c.Mounts[0].Name = profile("dev").volume,
    (c) => c.Mounts.push({ Type: "bind", Source: "/other", Destination: "/uploads" })
  ];
  for (const mutate of mutations) {
    const bad = structuredClone(config); mutate(bad);
    assert.throws(() => assertContainerOwnership(bad, p, state));
  }
});

test("real independent PostgreSQL instances, target refusal, busy port and persistent sentinels", { timeout: 55000 }, async (t) => {
  const credentialPaths = ["dev", "test"].flatMap((mode) => [profile(mode).secretFile, profile(mode).environmentFile, profile(mode).stateFile]);
  const originalHashes = credentialPaths.map(hash);
  const sourcePaths = ["package.json", "ops/compose.dev.yml", "ops/compose.test.yml", "scripts/database/managed.mjs", "scripts/db-check.mjs"].map((path) => join(repositoryRoot, path));
  const sourceHashes = sourcePaths.map(hash);
  let started, devSentinel, testSentinel;
  await t.test("db:up starts only two declared projects with independent identities and volumes", () => {
    const up = lifecycle("up", "both");
    assert.equal(up.status, 0);
    assert.equal(up.result.status, "RUNNING");
    started = up.result.databases;
    assert.equal(started.length, 2);
    for (const [index, mode] of ["dev", "test"].entries()) {
      const actual = started[index]; const p = profile(mode);
      assert.equal(actual.identity.database, p.database);
      assert.equal(actual.identity.user, p.user);
      assert.equal(actual.identity.sessionUser, p.user);
      assert.equal(actual.target.port, p.port);
      assert.equal(actual.project, p.project);
      assert.equal(actual.volume, p.volume);
      assert.equal(actual.connectionAttempted, true);
    }
    for (const key of ["project", "volume", "containerId", "instanceId"]) assert.notEqual(started[0][key], started[1][key]);
  });
  await t.test("both TCP connections coexist and report different actual cluster identifiers", async () => {
    const results = await Promise.all(["dev", "test"].map((mode) => withDatabase(mode, readDatabaseEnvironment(mode), async (client, target, identity) => {
      const { rows: [row] } = await client.query("SELECT system_identifier::text AS cluster FROM pg_control_system(), pg_sleep(0.1)");
      return { target, identity, cluster: row.cluster };
    })));
    assert.notEqual(results[0].cluster, results[1].cluster);
    assert.notEqual(results[0].identity.database, results[1].identity.database);
    writeFileSync(join(root, "simultaneous-connections.json"), JSON.stringify(results, null, 2));
  });
  await t.test("default db:check performs authenticated SQL identity checks for both modes", () => {
    for (const mode of ["dev", "test"]) {
      const result = run(["pnpm", "run", "db:check", "--", mode]);
      assert.equal(result.status, 0);
      assert.equal(result.result.status, "CONNECTED");
      assert.equal(result.result.connectionAttempted, true);
      assert.equal(result.result.identity.database, profile(mode).database);
    }
  });
  await t.test("wrong password fails real authentication; wrong/original targets fail before connection", () => {
    const valid = readDatabaseEnvironment("test").TEST_DATABASE_URL;
    const bad = new URL(valid); bad.password = randomBytes(32).toString("hex");
    const authentication = run([process.execPath, "scripts/db-check.mjs", "test"], { TEST_DATABASE_URL: bad.toString() });
    assert.equal(authentication.status, 3);
    assert.equal(authentication.result.connectionAttempted, true);
    assert.match(authentication.result.reason, /28P01/);
    assert.ok(!(authentication.stdout + authentication.stderr).includes(bad.password));
    for (const target of [readDatabaseEnvironment("dev").DATABASE_URL, valid.replace(":55433/", ":15435/"), valid.replace("@127.0.0.1:", "@203.0.113.10:")]) {
      const result = run([process.execPath, "scripts/db-check.mjs", "test"], { TEST_DATABASE_URL: target });
      assert.equal(result.status, 2);
      assert.equal(result.result.connectionAttempted, false);
    }
  });
  await t.test("additive synthetic rows are separate and repeated preparation preserves existing records", async () => {
    devSentinel = await sentinel("dev"); testSentinel = await sentinel("test");
    assert.notEqual(devSentinel.sentinel.marker, testSentinel.sentinel.marker);
    const repeated = await sentinel("test");
    assert.deepEqual(repeated.sentinel, testSentinel.sentinel);
    writeFileSync(join(root, "sentinels-before.json"), JSON.stringify([devSentinel, testSentinel], null, 2));
  });
  await t.test("occupied 55432 refuses startup, reports PID/PPID/CWD/command and leaves listener alive", async () => {
    assert.equal(lifecycle("stop", "dev").status, 0);
    const listener = createServer();
    try {
      await new Promise((accept, reject) => { listener.once("error", reject); listener.listen(55432, "127.0.0.1", accept); });
      const refused = lifecycle("up", "dev");
      assert.equal(refused.status, 4);
      assert.match(refused.result.reason, /occupied/);
      const owner = refused.result.owners.find((entry) => entry.pid === process.pid);
      assert.ok(owner);
      assert.equal(owner.ppid, process.ppid);
      assert.equal(owner.cwd, repositoryRoot);
      assert.match(owner.command, /node/);
      assert.equal(listener.listening, true);
    } finally {
      if (listener.listening) await new Promise((accept) => listener.close(accept));
      const restored = lifecycle("up", "dev");
      assert.equal(restored.status, 0);
      assert.equal(restored.result.databases[0].containerId, started[0].containerId);
    }
  });
  await t.test("restart exact owned IDs after PID checks; both sentinels survive unchanged", async () => {
    const restart = lifecycle("restart", "both");
    assert.equal(restart.status, 0);
    for (const row of restart.result.databases) {
      assert.ok(row.before.pid > 0);
      assert.match(row.before.processes, /PPID/);
      assert.equal(row.before.cwd, "/var/lib/postgresql/data");
      assert.match(row.before.command, /postgres/);
    }
    const afterDev = await sentinel("dev"); const afterTest = await sentinel("test");
    assert.deepEqual(afterDev.sentinel, devSentinel.sentinel);
    assert.deepEqual(afterTest.sentinel, testSentinel.sentinel);
    writeFileSync(join(root, "sentinels-after.json"), JSON.stringify([afterDev, afterTest], null, 2));
  });
  await t.test("idempotent up never resets credentials and verifier does not modify source", () => {
    assert.equal(lifecycle("up", "both").status, 0);
    assert.deepEqual(credentialPaths.map(hash), originalHashes);
    assert.deepEqual(sourcePaths.map(hash), sourceHashes);
  });
  await t.test("cleanup refuses running instances; stopped-container cleanup retains volumes and sentinel data on recreation", async () => {
    assert.equal(lifecycle("cleanup", "both").status, 2);
    assert.equal(lifecycle("stop", "both").status, 0);
    const cleaned = lifecycle("cleanup", "both");
    assert.equal(cleaned.status, 0);
    assert.equal(cleaned.result.status, "CLEANED_WITH_DATA_RETAINED");
    const recreated = lifecycle("up", "both");
    assert.equal(recreated.status, 0);
    assert.notEqual(recreated.result.databases[0].containerId, started[0].containerId);
    assert.deepEqual((await sentinel("dev")).sentinel, devSentinel.sentinel);
    assert.deepEqual((await sentinel("test")).sentinel, testSentinel.sentinel);
    assert.deepEqual(credentialPaths.map(hash), originalHashes);
  });
});
