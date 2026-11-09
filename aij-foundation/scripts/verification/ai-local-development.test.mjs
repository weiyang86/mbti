// Offline orchestration/guard tests only. No collaborator is evidence of real initialization.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import test from "node:test";
import pg from "pg";
import environment from "../runtime-environment.cjs";
import { argumentsFor, help, initializeOwnedState, loadInitializer, runCommand } from "../ai-local-development/cli.mjs";
import { assertDockerEndpoint, assertLocalStat, assertPath, assertExplicitEnvironmentSupport, fixedValues, paths, profile, publicEnvironment, redact, root, secretKeys, validateOwner, validateValues, writePrivate } from "../ai-local-development/config.mjs";
import { assertContainer, assertLabels, assertNoResources, inspectResources, validateCompose, stopDatabase } from "../ai-local-development/docker.mjs";
import { assertDatabaseIdentity, localMigrations, migrateAiLocal, withAiLocalDatabase } from "../ai-local-development/database.mjs";
import { assertBuildRecord, assertNoWebEnvironmentFiles, buildPlan, launchPlan } from "../ai-local-development/build.mjs";
import { assertProcessIdentity, snapshot } from "../ai-local-development/processes.mjs";
import { assertChildIdentity } from "../ai-local-development/service.mjs";
import { assertLocalMigrationLedger } from "../database/migration.mjs";

const initialStateExists = existsSync(profile.directory);
const owner = { version: 1, initialized: false, repository: root, machine: hostname(), uid: process.getuid(), project: profile.project,
  environment: "development", instanceId: randomUUID(), dockerContext: "offline-unit", dockerEndpoint: "unix:///nonexistent-aij-unit/docker.sock", createdAt: new Date().toISOString() };
function values() {
  return { ...fixedValues(), ...Object.fromEntries(secretKeys.map(key => [key, randomBytes(48).toString("hex")])),
    DATABASE_URL: `postgresql://${profile.user}:${randomBytes(32).toString("hex")}@127.0.0.1:55435/${profile.database}?schema=public` };
}
const labels = () => ({ "io.aij.owner": "aij-foundation", "io.aij.project": profile.project, "io.aij.environment": "development",
  "io.aij.instance": owner.instanceId, "io.aij.repository": root, "io.aij.uid": String(owner.uid), "io.aij.machine": owner.machine,
  "com.docker.compose.project": profile.project });
function container() {
  return { Id: "synthetic-owned-id", Name: "/" + profile.container,
    Config: { Image: profile.image, Entrypoint: ["docker-entrypoint.sh"], Cmd: ["postgres"], Labels: { ...labels(), "com.docker.compose.service": "postgres", "com.docker.compose.project.working_dir": root, "com.docker.compose.project.config_files": profile.composeFile } },
    HostConfig: { NetworkMode: "bridge", PortBindings: { "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "55435" }] } },
    Mounts: [{ Type: "volume", Name: profile.volume, Destination: "/var/lib/postgresql/data", RW: true }], State: { Running: true } };
}
function compose() {
  return { name: profile.project, services: { postgres: { container_name: profile.container, image: profile.image, network_mode: "bridge", restart: "unless-stopped",
    ports: [{ host_ip: "127.0.0.1", published: "55435", target: 5432 }], volumes: [{ type: "volume", source: "postgres_data", target: "/var/lib/postgresql/data" }],
    environment: { POSTGRES_DB: profile.database, POSTGRES_USER: profile.user, POSTGRES_PASSWORD: "synthetic-unit-only", POSTGRES_HOST_AUTH_METHOD: "scram-sha-256", POSTGRES_INITDB_ARGS: "--auth-host=scram-sha-256 --auth-local=scram-sha-256" },
    labels: labels(), healthcheck: { test: ["CMD", "pg_isready", "-h", "127.0.0.1", "-U", profile.user, "-d", profile.database] } } },
    volumes: { postgres_data: { name: profile.volume, labels: labels() } } };
}
// This module must never accidentally open a PG connection, even if a negative test regresses.
let attempts = 0;
const connect = pg.Client.prototype.connect;
test.before(() => { pg.Client.prototype.connect = () => { attempts++; throw new Error("Offline unit: DB connection forbidden"); }; });
test.after(() => { pg.Client.prototype.connect = connect; assert.equal(attempts, 0); });

test("CLI accepts only init/start/status/stop and start --build; help needs no Docker/hook", async () => {
  assert.deepEqual(argumentsFor([]), { action: "help", build: false });
  for (const action of ["init", "start", "status", "stop"]) assert.deepEqual(argumentsFor([action]), { action, build: false });
  assert.deepEqual(argumentsFor(["start", "--build"]), { action: "start", build: true });
  for (const args of [["reset"], ["cleanup"], ["adopt"], ["init", "--build"], ["stop", "--force"], ["start", "--build", "--build"], ["init", "--password", "private"], ["start", "--port", "3855"], ["start", "--live"]]) assert.throws(() => argumentsFor(args));
  await assert.rejects(runCommand({ action: "reset", build: false }));
  const result = spawnSync(process.execPath, ["scripts/ai-local-development/cli.mjs", "--help"], { cwd: root, env: { PATH: "/nonexistent" }, encoding: "utf8" });
  assert.equal(result.status, 0); assert.equal(result.stdout, help);
  assert.match(help, /Repeated init preserves menus, passwords, grants and custom configuration/);
});
test("fixed project runtime enables real AI composition while export/live paths stay disabled", () => {
  const runtime = validateValues(values());
  assert.equal(runtime.profile, "project"); assert.equal(runtime.namespace, "aij-ai-local:development");
  assert.deepEqual(runtime.capabilities, { auth: true, clientAuth: true, database: true, storage: true });
  assert.equal(runtime.asyncRuntimeEnabled, true); assert.equal(runtime.documentExport.enabled, false);
  assert.deepEqual(runtime.enabledPlugins, ["aij-ai"]); assert.equal(runtime.storageRoot, profile.storage);
  assert.equal(runtime.databaseTarget.port, 55435); assert.equal(runtime.nodeEnv, "development");
  assert.equal(environment.assertProjectIsolation([runtime]), true);
  assert.throws(() => environment.resolveDatabaseEnvironment("dev", values()));
  assert.throws(() => environment.resolveDatabaseEnvironment("test", values()));
});
test("fixed identities, old Base/host/test/foreign DB, unknown variables reject before any connection", async () => {
  const good = values();
  const changes = [
    { RUNTIME_PROFILE: "host" }, { PROJECT_ID: "aij-base-dev" }, { APP_ENV: "test" }, { NODE_ENV: "test" }, { NODE_ENV: "production" },
    { WEB_PORT: "3855" }, { API_PORT: "3656" }, { WEB_URL: "http://localhost:3955" }, { COOKIE_PREFIX: "aij_base_dev_development" },
    { JWT_ISSUER: "urn:aij:aij-base-dev:development:api" }, { LOCAL_STORAGE_ROOT: ".local-data/aij-ai-local/development/storage" },
    { AUTH_ENABLED: "false" }, { CLIENT_AUTH_ENABLED: "false" }, { STORAGE_ENABLED: "false" }, { ASYNC_RUNTIME_ENABLED: "false" },
    { ENABLED_PLUGINS: "aij-ai,aij-payment" }, { AI_CENTER_LIVE_ENABLED: "true" }, { AI_DEEPSEEK_LIVE_ENABLED: "true" },
    { AI_CENTER_CLIENT_EXECUTION_ENABLED: "true" }, { AIJ_DOCUMENT_EXPORT_ENABLED: "true" }, { AIJ_RUNTIME_ENV_SOURCE: "file" },
    { AIJ_RUNTIME_ENV_SOURCE: undefined }, { AIJ_TEST_API_URL: "/api" }, { TEST_DATABASE_URL: good.DATABASE_URL }, { DEEPSEEK_API_KEY: "unit-forbidden" },
    ...["55432", "55433", "55434", "5432"].map(port => ({ DATABASE_URL: good.DATABASE_URL.replace("55435", port) })),
    { DATABASE_URL: good.DATABASE_URL.replace("127.0.0.1", "localhost") }, { DATABASE_URL: good.DATABASE_URL.replace("127.0.0.1", "other-host") },
    { DATABASE_URL: good.DATABASE_URL.replaceAll(profile.user, "aij_base_dev_development") }, { DATABASE_URL: good.DATABASE_URL + "&sslmode=require" }
  ];
  for (const change of changes) {
    const input = { ...good, ...change }; assert.throws(() => validateValues(input));
    await assert.rejects(withAiLocalDatabase(input, () => assert.fail("must not run")));
  }
  for (const action of ["reset", "drop", "dev", "resolve", "push"]) await assert.rejects(migrateAiLocal(good, action));
});
test("four auth secrets and DB password must all be independent; invalid secret text never leaks", () => {
  const good = values();
  for (const key of secretKeys) {
    assert.throws(() => validateValues({ ...good, [key]: "template-password" }));
    assert.throws(() => validateValues({ ...good, [key]: new URL(good.DATABASE_URL).password }));
    for (const other of secretKeys.filter(other => other !== key)) assert.throws(() => validateValues({ ...good, [key]: good[other] }));
  }
  assert.equal(new Set([...secretKeys.map(key => good[key]), new URL(good.DATABASE_URL).password]).size, 5);
  const output = redact(JSON.stringify(good), good);
  for (const secret of [...secretKeys.map(key => good[key]), new URL(good.DATABASE_URL).password]) assert.ok(!output.includes(secret));
  assert.doesNotThrow(() => redact("arbitrary parser failure", { DATABASE_URL: "not-a-url" }));
});
test("owner matches canonical repository/OS user/hostname/instance and local Docker endpoint", () => {
  assert.equal(validateOwner(owner), owner);
  for (const change of [{ initialized: undefined }, { createdAt: undefined }, { repository: "/foreign" }, { machine: "foreign" }, { uid: -1 }, { project: "aij-base-dev" }, { environment: "test" }, { instanceId: "foreign" }, { dockerContext: "../remote" }, { dockerEndpoint: "tcp://remote" }, { dockerEndpoint: "unix:///tmp/../foreign.sock" }]) assert.throws(() => validateOwner({ ...owner, ...change }));
  for (const endpoint of ["unix://relative", "unix:///tmp/socket?x", "unix:///tmp/socket#x", "unix:///tmp//socket"]) assert.throws(() => assertDockerEndpoint(endpoint));
});
test("private file writes preserve existing data and refuse symlinks/public ownership", () => {
  const parent = join(root, ".artifacts/af-220/unit"); mkdirSync(parent, { recursive: true, mode: 0o700 });
  const directory = mkdtempSync(join(parent, "private-"));
  try {
    const file = join(directory, "record.json"); writePrivate(file, { marker: "original" }, { exclusive: true });
    assert.throws(() => writePrivate(file, "replacement", { exclusive: true })); assert.equal(JSON.parse(readFileSync(file)).marker, "original");
    assert.throws(() => assertLocalStat({ uid: process.getuid(), mode: 0o100644 }, true));
    assert.throws(() => assertLocalStat({ uid: -1, mode: 0o100600 }, true));
    symlinkSync(file, join(directory, "link")); assert.throws(() => assertPath(join(directory, "link")));
    assert.throws(() => assertDockerEndpoint("unix://" + join(directory, "link")));
  } finally { rmSync(directory, { recursive: true }); }
});
test("existing container/volume/project resources are never adopted without an owner", () => {
  assert.doesNotThrow(() => assertNoResources({ docker: () => "" }));
  for (const resource of [profile.container, profile.volume]) assert.throws(() => assertNoResources({ docker: args => args.includes("--filter") ? "" : resource }));
  assert.throws(() => assertNoResources({ docker: args => args.includes("--filter") ? "foreign-member" : "" }));
});
test("container labels/image/loopback/volume/privilege guard retains foreign resources", () => {
  assert.equal(assertContainer(container(), owner).Id, "synthetic-owned-id");
  const normalized = container(); normalized.HostConfig.Binds = [profile.volume + ":/var/lib/postgresql/data:rw"];
  assert.equal(assertContainer(normalized, owner).Id, "synthetic-owned-id");
  normalized.Mounts[0].Type = "bind";
  assert.throws(() => assertContainer(normalized, owner));
  for (const mutate of [c => c.Config.Labels["io.aij.instance"] = randomUUID(), c => c.Config.Labels["io.aij.repository"] = "/foreign", c => c.Config.Labels["io.aij.uid"] = "-1", c => c.Config.Labels["io.aij.machine"] = "foreign", c => c.Config.Image = "postgres:latest", c => c.Config.Cmd = ["sh"], c => c.Config.Entrypoint = ["foreign"], c => c.Name = "/aij-base-dev-postgres", c => c.HostConfig.PortBindings["5432/tcp"][0].HostIp = "0.0.0.0", c => c.HostConfig.PortBindings["5432/tcp"][0].HostPort = "55434", c => c.Mounts[0].Name = "aij-base-dev_postgres_data", c => c.Mounts[0].RW = false, c => c.HostConfig.NetworkMode = "host", c => c.HostConfig.Privileged = true, c => c.HostConfig.Binds = ["/host:/host"], c => c.Config.Labels["com.docker.compose.project.config_files"] = "/foreign.yml"]) {
    const current = container(); mutate(current); assert.throws(() => assertContainer(current, owner));
  }
  assert.throws(() => assertLabels({ ...labels(), "io.aij.environment": "test" }, owner));
  assert.throws(() => inspectResources({ docker: () => "" }, { ...owner, initialized: true }), /persistent volume is missing/);
  let mutations = 0;
  assert.throws(() => stopDatabase({ docker: args => { if (["stop", "rm"].includes(args[0])) mutations++; return args.includes("--filter") ? "foreign-resource" : ""; } }, owner));
  assert.equal(mutations, 0);
});
test("Compose accepts only frozen dedicated PG with exact labels/environment and no extensions", () => {
  assert.equal(validateCompose(compose(), owner, "synthetic-unit-only"), true);
  const normalized = compose(); normalized.services.postgres.command = null; normalized.services.postgres.entrypoint = null;
  assert.equal(validateCompose(normalized, owner, "synthetic-unit-only"), true);
  for (const override of [[], ["postgres"], "", false]) {
    const current = compose(); current.services.postgres.command = override;
    assert.throws(() => validateCompose(current, owner, "synthetic-unit-only"));
  }
  for (const mutate of [c => c.services.postgres.image = "postgres:latest", c => c.networks = { default: {} }, c => c.volumes.postgres_data.external = true, c => c.services.postgres.environment.POSTGRES_USER = "aij_foundation_dev", c => c.services.postgres.environment.PGOPTIONS = "unapproved", c => c.services.postgres.ports[0].published = "55433", c => c.services.postgres.volumes[0].source = "foreign", c => c.services.postgres.entrypoint = ["sh"], c => c.services.postgres.privileged = true, c => c.services.postgres.volumes[0].volume = { subpath: "foreign" }, c => c.services.postgres.labels["io.aij.instance"] = "foreign", c => c.secrets = { external: {} }]) {
    const current = compose(); mutate(current); assert.throws(() => validateCompose(current, owner, "synthetic-unit-only"));
  }
});
test("offline Docker collaborator stops only the twice-inspected owned ID; repeated stop retains volume", () => {
  const current = container(), stopped = [];
  const handle = { docker(args) {
    if (args[0] === "ps") return profile.container;
    if (args[0] === "volume" && args[1] === "ls") return profile.volume;
    if (args[0] === "volume" && args[1] === "inspect") return JSON.stringify([{ Name: profile.volume, Driver: "local", Options: {}, Labels: labels() }]);
    if (args[0] === "inspect") return JSON.stringify(current);
    if (args[0] === "stop") { stopped.push(args); current.State.Running = false; return current.Id; }
    assert.fail("Unapproved offline Docker action");
  } };
  for (let i = 0; i < 2; i++) assert.deepEqual(stopDatabase(handle, owner), { running: false, volumeRetained: profile.volume });
  assert.deepEqual(stopped, [["stop", "--time", "20", current.Id]]);
});
test("PG identity/version and original registered migration ledger guards are reused without SQL", () => {
  const target = validateValues(values()).databaseTarget;
  const identity = { database: target.database, user: target.user, sessionUser: target.user, serverPort: 5432, version: "160006" };
  assert.equal(assertDatabaseIdentity(identity, target), true);
  for (const change of [{ database: "aij_foundation_test" }, { user: "postgres" }, { sessionUser: "postgres" }, { serverPort: 55435 }, { version: "170001" }]) assert.throws(() => assertDatabaseIdentity({ ...identity, ...change }, target));
  const migrations = localMigrations(); assert.ok(migrations.length > 1);
  const ledger = migrations.map(row => ({ migration_name: row.name, checksum: row.checksum, finished_at: new Date(), rolled_back_at: null }));
  assert.equal(assertLocalMigrationLedger(migrations, ledger), true);
  for (const change of [{ checksum: "foreign" }, { finished_at: null }, { rolled_back_at: new Date() }, { migration_name: "unregistered" }]) assert.throws(() => assertLocalMigrationLedger(migrations, [{ ...ledger[0], ...change }]));
});
test("build/start plans isolate outputs; Web has only public allowlist and no inherited secrets", () => {
  const original = process.env.DEEPSEEK_API_KEY; process.env.DEEPSEEK_API_KEY = "synthetic-inherited-provider";
  try {
    const plans = buildPlan(), good = values(), api = launchPlan("api", good), web = launchPlan("web", good);
    assert.equal(plans[0].args[plans[0].args.indexOf("--outDir") + 1], profile.apiOutput);
    assert.equal(plans[0].env.AIJ_RUNTIME_ENV_SOURCE, "explicit");
    assert.equal(api.binary, join(root, "apps/api/.ai-local-dist/main.js")); assert.equal(api.env.NODE_ENV, "development");
    assert.deepEqual(web.args, ["start", "--port", "3955", "--hostname", "127.0.0.1"]);
    for (const env of [plans[1].env, web.env]) {
      for (const key of [...secretKeys, "DATABASE_URL", "TEST_DATABASE_URL", "DEEPSEEK_API_KEY", "NODE_OPTIONS", "NODE_PATH", "AIJ_TEST_API_URL"]) assert.equal(env[key], undefined);
      assert.equal(env.NODE_ENV, "production"); assert.equal(env.APP_ENV, "development"); assert.equal(env.AIJ_RUNTIME_ENV_SOURCE, "explicit");
      assert.equal(env.AIJ_NEXT_DIST_DIR, ".next-ai-local"); assert.equal(env.DATABASE_ENABLED, "false");
    }
    assert.equal(api.env.AIJ_RUNTIME_ENV_SOURCE, "explicit"); assert.equal(api.env.DEEPSEEK_API_KEY, undefined);
    assert.throws(() => launchPlan("api", { ...good, DEEPSEEK_API_KEY: "forbidden" }));
    assert.throws(() => launchPlan("foreign", good));
  } finally { if (original === undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY = original; }
});
test("build records require exact local instance and repository; previous output cannot be adopted", () => {
  const saved = { version: 1, repository: root, instanceId: owner.instanceId, status: "READY" };
  assert.equal(assertBuildRecord(saved, owner), saved);
  for (const change of [{ version: undefined }, { repository: "/foreign" }, { instanceId: randomUUID() }, { status: "foreign" }]) assert.throws(() => assertBuildRecord({ ...saved, ...change }, owner));
});
test("Next automatic env files are rejected before build/start without reading or moving user files", () => {
  const names = [".env", ".env.local", ".env.production", ".env.production.local"];
  const inspected = [];
  assertNoWebEnvironmentFiles(path => { inspected.push(path); return undefined; });
  assert.deepEqual(inspected, names.map(name => join(root, "apps/web", name)));
  for (const name of names) assert.throws(() => assertNoWebEnvironmentFiles(path => path === join(root, "apps/web", name) ? { isFile: () => true } : undefined), /public allowlist/);
});
test("supervisor and child stop guards require PID birth/CWD/command/user/owner; old Base is rejected", () => {
  const actual = { pid: 12345, ppid: 12344, uid: process.getuid(), birth: "synthetic-birth", command: process.execPath + " scripts/ai-local-development/service.mjs api " + owner.instanceId, cwd: root };
  assert.equal(assertProcessIdentity(actual, { ...actual }, owner, "api"), true);
  for (const change of [{ pid: 42 }, { birth: "changed" }, { cwd: "/foreign" }, { uid: -1 }, { command: actual.command.replace("ai-local-development", "base-development") }]) assert.throws(() => assertProcessIdentity(actual, { ...actual, ...change }, owner, "api"));
  assert.throws(() => assertProcessIdentity(actual, actual, { ...owner, instanceId: randomUUID() }, "api"));
  const plan = launchPlan("api", values()); const child = { ...actual, cwd: plan.cwd, command: process.execPath + " " + plan.binary };
  assert.equal(assertChildIdentity(child, { ...child }, plan, "api", 12344), true);
  for (const change of [{ ppid: 42 }, { pid: 42 }, { birth: "different" }, { command: "foreign" }, { cwd: root }, { uid: -1 }]) assert.throws(() => assertChildIdentity({ ...child, ...change }, child, plan, "api", 12344));
  assert.throws(() => assertChildIdentity(child, undefined, plan, "api", 12344));
  const self = snapshot(process.pid); assert.equal(self.pid, process.pid); assert.equal(self.cwd, root);
});
test("init hook is dynamically loaded only on init; missing/bad module rejects with controlled text", async () => {
  let loads = 0;
  const initializeAiLocal = async () => {};
  assert.equal(await loadInitializer(async specifier => { loads++; assert.ok(specifier.endsWith("/scripts/ai-local-development/root-initialization.mjs")); return { initializeAiLocal }; }), initializeAiLocal);
  assert.equal(loads, 1);
  await assert.rejects(loadInitializer(async () => { throw new Error("rawsecret headers body"); }), error => !/rawsecret|headers|body/.test(error.message));
  await assert.rejects(loadInitializer(async () => ({})), /hook export is required/);
  const source = readFileSync(join(root, "scripts/ai-local-development/cli.mjs"), "utf8");
  assert.doesNotMatch(source, /from ["']\.\.\/database\/seed/); assert.match(source, /if \(action === "init"\) initializeAiLocal = await loadInitializer/);
});
test("offline init collaborators run in order and preserve secrets on repeated calls; hook failure never marks initialized", async () => {
  const state = { owner, values: values() }, before = structuredClone(state), calls = [], saved = [];
  const collaborators = { start: async () => calls.push("database"), migrate: async () => calls.push("migrate"),
    initializeAiLocal: async input => { calls.push("root-hook"); assert.equal(input.owner, owner); assert.equal(input.values, state.values); assert.equal(input.runtime.namespace, "aij-ai-local:development"); },
    persist: async record => { calls.push("persist"); saved.push(record); } };
  for (let i = 0; i < 2; i++) assert.equal((await initializeOwnedState(state, collaborators)).status, "INITIALIZED");
  assert.deepEqual(calls, ["database", "migrate", "root-hook", "persist", "database", "migrate", "root-hook", "persist"]);
  assert.deepEqual(state, before); assert.equal(saved.length, 2); assert.ok(saved.every(row => row.initialized));
  await assert.rejects(initializeOwnedState(state, { ...collaborators, initializeAiLocal: async () => { throw new Error("rawsecret"); } }), /initialized marker not written/);
  assert.equal(saved.length, 2); assert.deepEqual(state, before);
  await assert.rejects(initializeOwnedState(state, { ...collaborators, initializeAiLocal: undefined }));
});
test("source-only candidate lacks root env feature safely; no destructive lifecycle/raw service output", () => {
  // This may pass after root integration; on the frozen bootstrap it must explicitly reject the old reader.
  const probe = publicEnvironment();
  if (environment.readRepositoryEnvironment(probe) === probe) assert.doesNotThrow(() => assertExplicitEnvironmentSupport());
  else assert.throws(() => assertExplicitEnvironmentSupport(), /Root explicit environment reader wiring is required/);
  for (const path of Object.values(paths)) execFileSync("git", ["check-ignore", "--quiet", "--", path], { cwd: root });
  assert.equal(profile.image, readFileSync(join(root, "ops/compose.base-development.yml"), "utf8").match(/image:\s*(\S+)/)[1]);
  for (const name of ["cli.mjs", "docker.mjs", "database.mjs", "processes.mjs"]) assert.doesNotMatch(readFileSync(join(root, "scripts/ai-local-development", name), "utf8"), /down.*-v|["']reset["']|DROP DATABASE|killall|pkill|SIGKILL/);
  const service = readFileSync(join(root, "scripts/ai-local-development/service.mjs"), "utf8");
  assert.match(service, /child.stdout.resume\(\); child.stderr.resume\(\)/); assert.doesNotMatch(service, /console\.log|pipeSafe|output\.write/);
  assert.equal(existsSync(profile.directory), initialStateExists, "offline unit does not initialize product state");
});
