import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import test from "node:test";
import pg from "pg";
import environment from "../runtime-environment.cjs";
import dictionary from "../dictionary-policy.cjs";
import basePolicy from "../base-policy.cjs";
import { argumentsFor, help } from "../base-development/cli.mjs";
import { assertLocalStat, assertPath, paths, profile, publicEnvironment, redact, root, validateOwner, validateValues, writePrivate } from "../base-development/config.mjs";
import { assertContainer, assertLabels, assertNoResources, inspectResources, validateCompose } from "../base-development/docker.mjs";
import { withBaseDatabase } from "../base-development/database.mjs";
import { buildPlan, launchPlan } from "../base-development/build.mjs";
import { assertProcessIdentity, snapshot } from "../base-development/processes.mjs";
import { registerBaseMenus, seedArguments, seedDatabase } from "../database/seed.mjs";

const owner = { version: 1, initialized: false, repository: root, machine: hostname(), uid: process.getuid(), project: "aij-base-dev", environment: "development", instanceId: randomUUID(), dockerContext: "desktop-linux", dockerEndpoint: "unix:///test/docker.sock" };
function values() {
  return { ...publicEnvironment(), NODE_ENV: "development", AUTH_ENABLED: "true", DATABASE_ENABLED: "true", JWT_SECRET: randomBytes(48).toString("hex"), DATABASE_URL: `postgresql://${profile.user}:${randomBytes(32).toString("hex")}@127.0.0.1:55434/${profile.database}?schema=public` };
}
const labels = () => ({ "io.aij.owner": "aij-foundation", "io.aij.project": profile.project, "io.aij.environment": "development", "io.aij.instance": owner.instanceId, "com.docker.compose.project": profile.project });
function container() {
  return { Id: "owned-test-container", Name: "/" + profile.container, Config: { Image: profile.image, Labels: { ...labels(), "com.docker.compose.service": "postgres", "com.docker.compose.project.working_dir": root, "com.docker.compose.project.config_files": profile.composeFile } }, HostConfig: { NetworkMode: "bridge", PortBindings: { "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "55434" }] } }, Mounts: [{ Type: "volume", Name: profile.volume, Destination: "/var/lib/postgresql/data" }], State: { Running: true } };
}
function composeConfig() {
  return { name: profile.project, services: { postgres: { container_name: profile.container, image: profile.image, network_mode: "bridge", ports: [{ host_ip: "127.0.0.1", published: "55434", target: 5432 }], volumes: [{ type: "volume", source: "postgres_data", target: "/var/lib/postgresql/data" }], environment: { POSTGRES_DB: profile.database, POSTGRES_USER: profile.user, POSTGRES_PASSWORD: "synthetic-in-memory", POSTGRES_HOST_AUTH_METHOD: "scram-sha-256" }, labels: labels() } }, volumes: { postgres_data: { name: profile.volume, labels: labels() } } };
}
test("CLI help and strict four-action contract run without Docker or resource creation", () => {
  assert.deepEqual(argumentsFor([]), { action: "help", build: false });
  for (const action of ["init", "start", "status", "stop"]) assert.deepEqual(argumentsFor([action]), { action, build: false });
  assert.deepEqual(argumentsFor(["start", "--build"]), { action: "start", build: true });
  for (const args of [["reset"], ["init", "--build"], ["stop", "--force"], ["start", "--build", "--build"], ["init", "--password", "value"], ["start", "--port", "3655"]]) assert.throws(() => argumentsFor(args));
  const result = spawnSync(process.execPath, ["scripts/base-development/cli.mjs", "--help"], { cwd: root, env: { PATH: "/nonexistent" }, encoding: "utf8" });
  assert.equal(result.status, 0); assert.equal(result.stdout, help);
  assert.match(help, /Repeated init preserves menus, passwords, grants and custom configuration/);
});
test("project runtime and exact dedicated target; no loosening of host dev/test policy", async () => {
  const valid = values(); const runtime = validateValues(valid);
  assert.equal(runtime.profile, "project"); assert.equal(runtime.namespace, "aij-base-dev:development");
  assert.equal(runtime.databaseTarget.port, 55434); assert.equal(runtime.nodeEnv, "development");
  assert.throws(() => environment.resolveDatabaseEnvironment("dev", valid));
  const mutations = [v => v.RUNTIME_PROFILE = "host", v => v.PROJECT_ID = "aij-foundation", v => v.APP_ENV = "test", v => v.NODE_ENV = "production", v => v.WEB_PORT = "3655", v => v.API_PORT = "3656", v => v.DATABASE_URL = v.DATABASE_URL.replace("55434", "55432"), v => v.DATABASE_URL = v.DATABASE_URL.replace("127.0.0.1", "localhost"), v => v.DATABASE_URL = v.DATABASE_URL.replaceAll(profile.user, "aij_foundation_dev"), v => v.AIJ_TEST_API_URL = "/api", v => v.TEST_DATABASE_URL = v.DATABASE_URL, v => v.JWT_SECRET = new URL(v.DATABASE_URL).password];
  const connect = pg.Client.prototype.connect; let attempts = 0;
  pg.Client.prototype.connect = () => { attempts++; throw new Error("No candidate test may connect"); };
  try {
    for (const mutate of mutations) { const input = { ...valid }; mutate(input); assert.throws(() => validateValues(input)); await assert.rejects(withBaseDatabase(input, () => {})); }
    await assert.rejects(seedDatabase({ mode: "dev" }, valid));
  } finally { pg.Client.prototype.connect = connect; }
  assert.equal(attempts, 0);
});
test("local owner is machine/user/repository/project scoped and rejects adoption", () => {
  assert.equal(validateOwner(owner), owner);
  for (const change of [{ initialized: undefined }, { instanceId: "foreign" }, { repository: "/tmp" }, { machine: "foreign-machine" }, { uid: -1 }, { project: "aij-foundation" }, { environment: "test" }, { dockerContext: "../remote" }, { dockerEndpoint: "tcp://remote" }]) assert.throws(() => validateOwner({ ...owner, ...change }));
});
test("private file writing preserves unrelated bytes and refuses symlinks and public state", () => {
  const parent = join(root, ".artifacts/af-134/unit"); mkdirSync(parent, { recursive: true });
  const directory = mkdtempSync(join(parent, "private-")); chmodSync(directory, 0o700);
  try {
    const path = join(directory, "state.json"); writePrivate(path, { marker: "first" }, { exclusive: true });
    assert.throws(() => writePrivate(path, { marker: "replacement" }, { exclusive: true }));
    assert.equal(JSON.parse(readFileSync(path)).marker, "first");
    writePrivate(path, { marker: "second" }); assert.equal(JSON.parse(readFileSync(path)).marker, "second");
    assertPath(path, { restricted: true });
    assert.throws(() => assertLocalStat({ uid: process.getuid(), mode: 0o100644 }, true));
    assert.throws(() => assertLocalStat({ uid: -1, mode: 0o100600 }, true));
    symlinkSync(path, join(directory, "link")); assert.throws(() => assertPath(join(directory, "link")));
  } finally { rmSync(directory, { recursive: true }); }
});
test("Docker names may never be adopted without local state; unrelated resources are ignored", () => {
  assert.doesNotThrow(() => assertNoResources({ docker: () => "" }));
  for (const resource of [profile.container, profile.volume]) assert.throws(() => assertNoResources({ docker: args => args.includes("--filter") ? "" : resource }));
  assert.throws(() => assertNoResources({ docker: args => args.includes("--filter") ? "foreign-project-member" : "" }));
});
test("container/volume labels, image, loopback, bridge and mount ownership fail closed", () => {
  assert.equal(assertContainer(container(), owner).Id, "owned-test-container");
  for (const mutate of [c => c.Config.Labels["io.aij.instance"] = randomUUID(), c => c.Config.Image = "postgres:latest", c => c.Name = "/foreign", c => c.HostConfig.PortBindings["5432/tcp"][0].HostIp = "0.0.0.0", c => c.HostConfig.PortBindings["5432/tcp"][0].HostPort = "55432", c => c.Mounts[0].Name = "host-volume", c => c.HostConfig.NetworkMode = "foreign_default", c => c.Config.Labels["com.docker.compose.project.working_dir"] = "/tmp"]) { const current = container(); mutate(current); assert.throws(() => assertContainer(current, owner)); }
  assert.throws(() => assertLabels({ ...labels(), "io.aij.environment": "test" }, owner));
  const config = composeConfig(); assert.equal(validateCompose(config, owner, "synthetic-in-memory"), true);
  for (const mutate of [c => c.services.postgres.image = "postgres:latest", c => c.networks = { default: {} }, c => c.volumes.postgres_data.external = true, c => c.services.postgres.environment.POSTGRES_USER = "aij_foundation_dev", c => c.services.postgres.ports[0].published = "55433", c => c.services.postgres.volumes[0].source = "foreign"]) { const current = composeConfig(); mutate(current); assert.throws(() => validateCompose(current, owner, "synthetic-in-memory")); }
  assert.throws(() => inspectResources({ docker: () => "" }, { ...owner, initialized: true }), /persistent volume is missing/);
});
test("isolated build/start plans keep API development, web secrets absent and host output untouched", () => {
  const plans = buildPlan(); assert.equal(plans.length, 2);
  assert.equal(plans[0].args[plans[0].args.indexOf("--outDir") + 1], profile.apiOutput);
  const input = values(); const api = launchPlan("api", input), web = launchPlan("web", input);
  assert.equal(api.binary, join(root, "apps/api/.base-dev-dist/main.js")); assert.equal(api.env.NODE_ENV, "development");
  assert.equal(web.env.AIJ_NEXT_DIST_DIR, ".next-base-dev"); assert.deepEqual(web.args, ["start", "--port", "3855", "--hostname", "127.0.0.1"]);
  for (const env of [plans[1].env, web.env]) {
    for (const key of ["DATABASE_URL", "JWT_SECRET", "TEST_DATABASE_URL", "AIJ_TEST_API_URL"]) assert.equal(env[key], undefined);
    assert.equal(env.NEXT_PUBLIC_API_URL, "http://127.0.0.1:3856/api"); assert.equal(env.DATABASE_ENABLED, "false");
  }
  const buildSource = readFileSync(join(root, "scripts/base-development/build.mjs"), "utf8");
  assert.match(buildSource, /finally\s*\{/); assert.match(buildSource, /writeFileSync\(saved.path, saved.bytes\)/);
});
test("process identity requires recorded PID/birth/CWD/command and exact owner marker", () => {
  const actual = { pid: 12345, ppid: 1, uid: process.getuid(), birth: "synthetic-birth", command: process.execPath + " scripts/base-development/service.mjs api " + owner.instanceId, cwd: root };
  assert.equal(assertProcessIdentity(actual, { ...actual }, owner, "api"), true);
  for (const change of [{ pid: 42 }, { birth: "changed" }, { cwd: "/tmp" }, { uid: -1 }, { command: "unrelated" }]) assert.throws(() => assertProcessIdentity(actual, { ...actual, ...change }, owner, "api"));
  const self = snapshot(process.pid); assert.equal(self.pid, process.pid); assert.equal(self.cwd, root); assert.ok(self.birth); assert.ok(self.command);
  assert.throws(() => snapshot(1));
});
test("four stable Base menus are idempotent; matching customization preserved and namespace occupancy rejected", async () => {
  const rows = new Map();
  const client = { async query(sql, args) {
    if (sql.startsWith("SELECT")) return { rows: rows.has(args[0]) ? [rows.get(args[0])] : [] };
    assert.match(sql, /ON CONFLICT \(path\) DO NOTHING/); assert.ok(!/UPDATE|DELETE/.test(sql));
    const [id, title, path, permission, order] = args;
    if (rows.has(path)) return { rowCount: 0, rows: [] };
    rows.set(path, { id, title, path, permission_code: permission, order, type: "menu", plugin_code: null });
    return { rowCount: 1, rows: [{ id }] };
  } };
  const first = await registerBaseMenus(client); assert.equal(first.filter(row => row.created).length, 4);
  assert.deepEqual([...rows.keys()], ["/auth/admin-users", "/auth/roles", "/auth/dictionaries", "/auth/audit-logs"]);
  const customized = rows.get("/auth/dictionaries"); customized.title = "自定义"; customized.status = "disabled"; customized.order = 222;
  const before = structuredClone([...rows]); assert.equal((await registerBaseMenus(client)).filter(row => row.created).length, 0); assert.deepEqual([...rows], before);
  customized.permission_code = "foreign.permission";
  await assert.rejects(registerBaseMenus(client), error => error.code === "MENU_NAMESPACE_OCCUPIED"); assert.equal(customized.permission_code, "foreign.permission");
  assert.equal(basePolicy.BASE_DEVELOPMENT_MENUS[2].permission, dictionary.DICTIONARY_READ_PERMISSION);
  assert.equal(dictionary.DICTIONARY_READ_DEFINITION.code, "admin.dict.read"); assert.equal(dictionary.DICTIONARY_DEFINITION.code, "admin.dict.manage");
  assert.deepEqual(seedArguments(["dev", "--dictionaries"]), { mode: "dev", acceptanceId: undefined, generateCredentials: false, dictionaries: true });
});
test("Compose digest matches accepted PostgreSQL16 and runtime files stay ignored; no destructive CLI operations", () => {
  const compose = readFileSync(profile.composeFile, "utf8"), accepted = readFileSync(join(root, "ops/compose.test.yml"), "utf8");
  const image = accepted.match(/image:\s*(\S+)/)[1]; assert.equal(profile.image, image); assert.ok(compose.includes(image)); assert.match(compose, /network_mode: bridge/);
  for (const path of Object.values(paths)) execFileSync("git", ["check-ignore", "--quiet", "--", path], { cwd: root });
  for (const name of ["cli.mjs", "docker.mjs", "database.mjs"]) assert.doesNotMatch(readFileSync(join(root, "scripts/base-development", name), "utf8"), /down.*-v|["']reset["']|DROP DATABASE|docker.*network.*rm/);
  const input = values(), output = redact(JSON.stringify(input), input); assert.ok(!output.includes(input.JWT_SECRET)); assert.ok(!output.includes(new URL(input.DATABASE_URL).password));
});
