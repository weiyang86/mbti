import assert from "node:assert/strict";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { delimiter, dirname, join, resolve, sep } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { assertPortAvailable } from "../port-availability.mjs";
import test from "node:test";

const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const artifactsRoot = join(repositoryRoot, ".artifacts", "af-078");
const runId = randomBytes(5).toString("hex");
const runRoot = join(artifactsRoot, "host-run-" + runId);
const installRoot = join("/private/tmp", "aij-af078-" + runId);
const consumerRoot = join(installRoot, "package-consumer");
const sourceRoot = join(installRoot, "materialized-aij-foundation");
const configRoot = join(sourceRoot, ".local-data", "af078-config");
const packageDir = join(consumerRoot, "node_modules", "@aij", "base");
const cliPath = join(packageDir, "bin", "aij-base.cjs");
const projectCli = join(sourceRoot, "scripts", "project", "cli.mjs");
const runApp = join(sourceRoot, "scripts", "run-app.mjs");
const webPort = 37255;
const apiPort = 37256;
const dbPort = 55443;
const projectId = "aij-af078-" + runId;
const databaseName = projectId.replaceAll("-", "_") + "_test";
const databaseUser = databaseName;
const databasePassword = randomBytes(32).toString("hex");
const composeProject = "aij-af078-" + runId;
const containerName = "aij-af078-postgres-" + runId;
const volumeName = "aij_af078_data_" + runId;
const composePath = join(runRoot, "compose.yml");
const composeEnvPath = join(runRoot, "compose.env");
const databaseUrl = "postgresql://" + databaseUser + ":" + databasePassword + "@127.0.0.1:" + dbPort + "/" + databaseName + "?schema=public";
const commands = [];
const events = [];
const processes = new Map();
let containerStarted = false;
let packedTarball;
let packManifest;
let runtimeEnv;

mkdirSync(runRoot, { recursive: false, mode: 0o700 });
mkdirSync(installRoot, { recursive: false, mode: 0o700 });

const baseEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  /^(PATH|HOME|TMPDIR|TMP|TEMP|SystemRoot|WINDIR|LANG|LC_ALL|TZ|PNPM_HOME)$/i.test(key)));
const testEnv = { ...baseEnv, PATH: [dirname(process.execPath), baseEnv.PATH].filter(Boolean).join(delimiter), CI: "1", CHECKPOINT_DISABLE: "1", PRISMA_HIDE_UPDATE_MESSAGE: "1", NEXT_TELEMETRY_DISABLED: "1" };
const sanitize = (text) => String(text ?? "").replaceAll(databasePassword, "[REDACTED]").replaceAll(databaseUrl, "[REDACTED_DATABASE_URL]");

function command(commandName, args, { cwd = repositoryRoot, env = testEnv, timeout = 120000, expect = 0, label = commandName } = {}) {
  const started = Date.now();
  const result = spawnSync(commandName, args, { cwd, env, encoding: "utf8", shell: false, timeout, maxBuffer: 12 * 1024 * 1024 });
  const exitCode = result.status ?? (result.error?.code === "ETIMEDOUT" ? 124 : 127);
  const record = { label, command: commandName, args, cwd, exitCode, signal: result.signal ?? null, durationMs: Date.now() - started };
  commands.push(record);
  if (expect === "nonzero") assert.notEqual(exitCode, 0, label + " should fail closed");
  else assert.equal(exitCode, expect, label + " exit code; output=" + sanitize((result.stdout || "") + "\n" + (result.stderr || "")).slice(-5000));
  return { ...result, status: exitCode, record };
}

function projectEnvironment(database = databaseUrl) {
  return {
    ...testEnv,
    RUNTIME_PROFILE: "project",
    AIJ_PROJECT_ROOT: configRoot,
    PROJECT_ID: projectId,
    APP_ENV: "test",
    WEB_PORT: String(webPort),
    API_PORT: String(apiPort),
    WEB_URL: "http://127.0.0.1:" + webPort,
    NEXT_PUBLIC_API_URL: "http://127.0.0.1:" + apiPort + "/api",
    JWT_ISSUER: "urn:aij:" + projectId + ":test:api",
    COOKIE_PREFIX: projectId.replaceAll("-", "_") + "_test",
    LOCAL_STORAGE_ROOT: ".local-data/" + projectId + "/test/storage",
    AUTH_ENABLED: "false",
    CLIENT_AUTH_ENABLED: "false",
    DATABASE_ENABLED: "true",
    STORAGE_ENABLED: "false",
    ASYNC_RUNTIME_ENABLED: "false",
    ENABLED_PLUGINS: "",
    TEST_DATABASE_URL: database
  };
}

function composeArgs(...args) {
  return ["compose", "--project-name", composeProject, "--env-file", composeEnvPath, "--file", composePath, ...args];
}

function writeComposeFiles() {
  const env = [
    "INSTANCE_ID=" + runId,
    "CONTAINER_NAME=" + containerName,
    "VOLUME_NAME=" + volumeName,
    "DB_PORT=" + dbPort,
    "DB_NAME=" + databaseName,
    "DB_USER=" + databaseUser,
    "DB_PASSWORD=" + databasePassword
  ].join("\n") + "\n";
  writeFileSync(composeEnvPath, env, { mode: 0o600, flag: "wx" });
  chmodSync(composeEnvPath, 0o600);
  const compose = [
    "services:",
    "  postgres:",
    "    image: postgres:16-alpine@sha256:e013e867e712fec275706a6c51c966f0bb0c93cfa8f51000f85a15f9865a28cb",
    "    container_name: \"${CONTAINER_NAME}\"",
    "    restart: \"no\"",
    "    environment:",
    "      POSTGRES_DB: \"${DB_NAME}\"",
    "      POSTGRES_USER: \"${DB_USER}\"",
    "      POSTGRES_PASSWORD: \"${DB_PASSWORD}\"",
    "      POSTGRES_HOST_AUTH_METHOD: scram-sha-256",
    "      POSTGRES_INITDB_ARGS: --auth-host=scram-sha-256 --auth-local=trust",
    "    ports:",
    "      - \"127.0.0.1:${DB_PORT}:5432\"",
    "    volumes:",
    "      - af078_data:/var/lib/postgresql/data",
    "    labels:",
    "      io.aij.owner: aij-foundation",
    "      io.aij.task: AF-078",
    "      io.aij.instance: \"${INSTANCE_ID}\"",
    "    healthcheck:",
    "      test: [\"CMD\", \"pg_isready\", \"-U\", \"${DB_USER}\", \"-d\", \"${DB_NAME}\"]",
    "      interval: 1s",
    "      timeout: 3s",
    "      retries: 45",
    "      start_period: 3s",
    "volumes:",
    "  af078_data:",
    "    name: \"${VOLUME_NAME}\"",
    "    labels:",
    "      io.aij.owner: aij-foundation",
    "      io.aij.task: AF-078",
    "      io.aij.instance: \"${INSTANCE_ID}\"",
    "networks:",
    "  default:",
    "    labels:",
    "      io.aij.owner: aij-foundation",
    "      io.aij.task: AF-078",
    "      io.aij.instance: \"${INSTANCE_ID}\""
  ].join("\n") + "\n";
  writeFileSync(composePath, compose, { mode: 0o600, flag: "wx" });
  chmodSync(composePath, 0o600);
}

function appendEvent(name, details = {}) { events.push({ name, ...details }); }

function listenerPids(port) {
  const result = spawnSync("lsof", ["-nP", "-t", "-iTCP:" + port, "-sTCP:LISTEN"], { cwd: repositoryRoot, env: testEnv, encoding: "utf8", shell: false, timeout: 10000 });
  if (result.status === 1 && !result.stdout.trim()) return [];
  assert.equal(result.status, 0, "lsof must resolve listener identity on AF-078 port " + port);
  return result.stdout.trim().split(/\s+/).filter(Boolean).map(Number);
}

function processIdentity(pid) {
  const ps = execFileSync("ps", ["-o", "pid=,ppid=,command=", "-p", String(pid)], { encoding: "utf8" }).trim();
  const cwdRaw = execFileSync("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"], { encoding: "utf8" });
  const cwd = cwdRaw.split("\n").find((line) => line.startsWith("n"))?.slice(1) ?? "";
  return { ps, cwd };
}

async function waitForHttp(url, expectedStatus, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(2500) });
      const body = await response.text();
      last = { status: response.status, body: body.slice(0, 6000) };
      if (response.status === expectedStatus) return last;
    } catch (error) { last = { error: error.name + ":" + error.cause?.code }; }
    await delay(400);
  }
  throw new Error("HTTP probe did not reach status " + expectedStatus + " at " + url + "; last=" + JSON.stringify(last));
}

function startHost(app) {
  const args = [runApp, app, "start"];
  const child = spawn(process.execPath, args, { cwd: sourceRoot, env: runtimeEnv, stdio: ["ignore", "pipe", "pipe"], shell: false });
  let output = "";
  child.stdout.on("data", (chunk) => { output = (output + chunk.toString()).slice(-12000); });
  child.stderr.on("data", (chunk) => { output = (output + chunk.toString()).slice(-12000); });
  const entry = { child, app, args, output: () => sanitize(output) };
  processes.set(app, entry);
  commands.push({ label: app + " packed host start", command: process.execPath, args, cwd: sourceRoot, pid: child.pid, parentPid: process.pid, mode: "owned-long-running" });
  return entry;
}

async function stopHost(app) {
  const entry = processes.get(app);
  if (!entry) return;
  const pid = entry.child.pid;
  const port = app === "api" ? apiPort : webPort;
  if (entry.child.exitCode !== null || entry.child.signalCode !== null) {
    assert.deepEqual(listenerPids(port), [], app + " must not leave a listener after its owned wrapper exits");
    return;
  }
  const identity = processIdentity(pid);
  assert.match(identity.ps, new RegExp("^" + pid + "\\s+" + process.pid + "\\s+"));
  assert.ok(identity.ps.includes(runApp) && identity.ps.includes(app + " start"), "owned wrapper command must be the expected packed host launcher");
  assert.equal(realpathSync(identity.cwd), realpathSync(sourceRoot), "owned wrapper CWD must be the external packed consumer source root");
  const pids = listenerPids(port);
  const listeners = pids.map((listenerPid) => {
    const details = processIdentity(listenerPid);
    assert.ok(details.cwd && (realpathSync(details.cwd) === realpathSync(sourceRoot) || realpathSync(details.cwd).startsWith(realpathSync(sourceRoot) + sep)), "listener must be owned by the external packed consumer tree");
    return { pid: listenerPid, identity: details };
  });
  const closePromise = once(entry.child, "close");
  entry.child.kill("SIGTERM");
  const closed = await Promise.race([closePromise.then(() => true), delay(12000).then(() => false)]);
  if (!closed) {
    const still = processIdentity(pid);
    assert.ok(still.ps.includes(runApp) && still.ps.includes(app + " start") && realpathSync(still.cwd) === realpathSync(sourceRoot), "refuse to force-stop a process whose identity changed");
    entry.child.kill("SIGKILL");
    await Promise.race([once(entry.child, "close"), delay(3000)]);
  }
  await delay(250);
  assert.deepEqual(listenerPids(port), [], app + " owned listener must release its AF-078 port");
  commands.push({ label: app + " owned process shutdown", pid, ppid: process.pid, cwd: identity.cwd, command: identity.ps, signal: closed ? "SIGTERM" : "SIGKILL after revalidation", listenerIdentities: listeners.map((x) => ({ pid: x.pid, command: x.identity.ps, cwd: x.identity.cwd })) });
}

function verifyOwnedDatabaseContainer({ requirePublishedPort = true } = {}) {
  const result = command("docker", ["inspect", "--format", "{{index .Config.Labels \"io.aij.task\"}}|{{index .Config.Labels \"io.aij.instance\"}}|{{range .Mounts}}{{.Name}}:{{.Destination}}{{end}}|{{json (index .NetworkSettings.Ports \"5432/tcp\")}}", containerName], { expect: 0, label: "verify AF-078 container identity and unique volume" });
  const fields = result.stdout.trim().split("|");
  assert.equal(fields[0], "AF-078");
  assert.equal(fields[1], runId);
  assert.ok(fields[2].includes(volumeName + ":/var/lib/postgresql/data"));
  if (requirePublishedPort) assert.ok(fields[3].includes("127.0.0.1") && fields[3].includes(String(dbPort)));
  return fields;
}

async function mustPassSubtest(context, name, callback) {
  let failure;
  await context.test(name, async () => {
    try { await callback(); }
    catch (error) { failure = error; throw error; }
  });
  if (failure) throw failure;
}

test("packed aij-base consumer builds, starts and proves real HTTP/database readiness", { timeout: 900000 }, async (t) => {
  let originalError;
  try {
    assert.equal(process.versions.node.split(".")[0], "24", "verification itself runs on the repository's supported Node major");
    assert.ok(!resolve(installRoot).startsWith(repositoryRoot + sep), "consumer must be outside the source checkout");
    const pack = command(process.execPath, ["scripts/distribution/pack-aij-base.mjs"], { cwd: repositoryRoot, timeout: 120000, label: "pack AF-077 private tarball for AF-078 consumer" });
    const packOutput = JSON.parse(pack.stdout.trim().split("\n").at(-1));
    assert.equal(packOutput.status, "PACKED_LOCAL_PRIVATE_CONSUMER");
    packedTarball = join(repositoryRoot, packOutput.tarball);
    packManifest = JSON.parse(readFileSync(join(repositoryRoot, packOutput.manifest), "utf8"));
    assert.equal(packManifest.private, true);
    assert.equal(packManifest.publication, "NOT_AUTHORIZED");
    assert.equal(packManifest.licenseDecision, "PENDING_OWNER_DECISION");
    assert.equal(packManifest.supportedPlatforms, "PENDING_OWNER_DECISION");
    assert.ok(existsSync(packedTarball));

    await mustPassSubtest(t, "the installed tarball materializes an external source tree and offline dependency install", () => {
      mkdirSync(consumerRoot, { recursive: false, mode: 0o700 });
      writeFileSync(join(consumerRoot, "package.json"), JSON.stringify({ name: "aij-af078-local-consumer", version: "0.0.0", private: true, type: "module", dependencies: { "@aij/base": "file:" + packedTarball } }, null, 2) + "\n", { mode: 0o600, flag: "wx" });
      command("pnpm", ["install", "--offline", "--ignore-workspace", "--ignore-scripts", "--lockfile=false"], { cwd: consumerRoot, timeout: 120000, label: "offline install of the local aij-base tarball" });
      const installed = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
      assert.equal(installed.name, "@aij/base");
      assert.equal(installed.version, "0.1.0");
      assert.equal(installed.private, true);
      command(process.execPath, [cliPath, "install", "--dir", sourceRoot], { cwd: consumerRoot, timeout: 30000, label: "materialize source from the installed private tarball" });
      assert.ok(existsSync(join(sourceRoot, "apps/api/package.json")));
      assert.ok(existsSync(join(sourceRoot, "apps/web/package.json")));
      assert.ok(existsSync(join(sourceRoot, "scripts/run-app.mjs")));
      assert.equal(realpathSync(sourceRoot).startsWith(realpathSync(repositoryRoot) + sep), false);
      assert.equal(realpathSync(join(sourceRoot, "apps/api/package.json")).startsWith(realpathSync(repositoryRoot) + sep), false);
      assert.ok(readFileSync(join(sourceRoot, ".gitignore"), "utf8").includes(".local-data/"));
      command("pnpm", ["install", "--offline", "--frozen-lockfile", "--ignore-scripts"], { cwd: sourceRoot, timeout: 240000, label: "offline frozen install of the packed project workspaces" });
      const workspaceNode = command("pnpm", ["exec", "node", "--version"], { cwd: sourceRoot, timeout: 15000, label: "verify external workspace command runtime is Node 24" }).stdout.trim();
      assert.match(workspaceNode, /^v24\./);
      const coreLink = realpathSync(join(sourceRoot, "apps/api/node_modules/@aij/core"));
      assert.ok(coreLink.startsWith(realpathSync(sourceRoot) + sep), "workspace dependency resolves inside the packed consumer");
      appendEvent("offline-install", { package: "@aij/base@0.1.0", tarball: packManifest.tarball, tarballSha256: packManifest.tarballSha256, sourceRoot, coreLink });
    });

    await mustPassSubtest(t, "generated project identity accepts only its own scoped database target", () => {
      const make = (url = databaseUrl) => ({
        projectId, environment: "test", webPort, apiPort,
        origin: "http://127.0.0.1:" + webPort,
        apiUrl: "http://127.0.0.1:" + apiPort + "/api",
        issuer: "urn:aij:" + projectId + ":test:api",
        cookiePrefix: projectId.replaceAll("-", "_") + "_test",
        storageRoot: ".local-data/" + projectId + "/test/storage",
        enabledPlugins: [], capabilities: { auth: false, clientAuth: false, database: true, storage: false }, databaseUrl: url
      });
      const require = createRequire(join(sourceRoot, "package.json"));
      const runtime = require("./scripts/runtime-environment.cjs");
      const safe = runtime.resolveProjectConfiguration(make(), { projectRoot: sourceRoot });
      assert.equal(safe.projectId, projectId);
      assert.equal(safe.profile, "project");
      assert.deepEqual({ host: safe.databaseTarget.host, port: safe.databaseTarget.port, database: safe.databaseTarget.database, user: safe.databaseTarget.user }, { host: "127.0.0.1", port: dbPort, database: databaseName, user: databaseUser });
      assert.throws(() => runtime.resolveProjectConfiguration(make(databaseUrl.replace("55443", "55433")), { projectRoot: sourceRoot }), /loopback and scoped/);
      assert.throws(() => runtime.resolveProjectConfiguration(make(databaseUrl.replace("/" + databaseName, "/aij_foundation_dev")), { projectRoot: sourceRoot }), /loopback and scoped/);
      assert.throws(() => runtime.resolveProjectConfiguration(make(databaseUrl.replace("127.0.0.1", "192.0.2.10")), { projectRoot: sourceRoot }), /loopback and scoped/);
      appendEvent("identity-target-guard", { projectId, namespace: safe.namespace, webPort, apiPort, dbPort, databaseName, databaseUser, acceptedTarget: true, rejected: ["host test port fallback", "wrong database scope", "non-loopback host"] });
    });

    await mustPassSubtest(t, "an isolated synthetic PostgreSQL volume is created and confirmed before migration", () => {
      writeComposeFiles();
      command("docker", ["inspect", containerName], { expect: "nonzero", label: "prove the random AF-078 container name is unused" });
      command("docker", ["volume", "inspect", volumeName], { expect: "nonzero", label: "prove the random AF-078 volume name is unused" });
      containerStarted = true;
      command("docker", composeArgs("up", "--detach", "--wait", "--wait-timeout", "60", "postgres"), { timeout: 90000, label: "start new AF-078-owned PostgreSQL container" });
      const identity = verifyOwnedDatabaseContainer();
      const probe = "import assert from 'node:assert/strict';import {Client} from 'pg';const client=new Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:5000});try{await client.connect();const result=await client.query('SELECT current_database() AS database,current_user AS \"user\",session_user AS session_user,inet_server_port() AS server_port');console.log(JSON.stringify(result.rows[0]));}finally{await client.end();}";
      const actual = JSON.parse(command("pnpm", ["exec", "node", "--input-type=module", "--eval", probe], { cwd: sourceRoot, env: { ...testEnv, DATABASE_URL: databaseUrl }, timeout: 15000, label: "read PostgreSQL database/user/session identity over the dedicated loopback port" }).stdout.trim());
      assert.deepEqual(actual, { database: databaseName, user: databaseUser, session_user: databaseUser, server_port: 5432 });
      appendEvent("database-created", { containerName, volumeName, host: "127.0.0.1", hostPort: dbPort, databaseName, databaseUser, identity, syntheticOnly: true });
    });

    await mustPassSubtest(t, "Prisma generation, real migration deploy/status and both packed-host builds pass", async () => {
      command(process.execPath, [projectCli, "create", "--project-id", projectId, "--environment", "test", "--dir", configRoot, "--web-port", String(webPort), "--api-port", String(apiPort)], { cwd: sourceRoot, timeout: 30000, label: "create generated project configuration from the packed source tree" });
      const envExample = readFileSync(join(configRoot, ".env.example"), "utf8");
      const localEnv = envExample.replace("DATABASE_ENABLED=false", "DATABASE_ENABLED=true") + "TEST_DATABASE_URL=" + databaseUrl + "\n";
      writeFileSync(join(configRoot, ".env"), localEnv, { mode: 0o600, flag: "wx" });
      chmodSync(join(configRoot, ".env"), 0o600);
      runtimeEnv = projectEnvironment();
      const shown = command(process.execPath, [projectCli, "show", "--dir", configRoot], { cwd: sourceRoot, env: runtimeEnv, timeout: 30000, label: "validate generated project runtime identity" });
      const publicConfig = JSON.parse(shown.stdout.trim());
      assert.equal(publicConfig.status, "VALID");
      assert.equal(publicConfig.projectId, projectId);
      assert.equal(publicConfig.apiPort, apiPort);
      assert.equal(publicConfig.capabilities.database, true);
      assert.deepEqual(publicConfig.enabledPlugins, []);
      const prismaEnv = { ...runtimeEnv, DATABASE_URL: databaseUrl };
      command("pnpm", ["--filter", "@aij/api", "run", "prisma:generate"], { cwd: sourceRoot, env: prismaEnv, timeout: 90000, label: "generate Prisma client in the external packed consumer" });
      command("pnpm", ["--filter", "@aij/api", "run", "prisma:validate"], { cwd: sourceRoot, env: prismaEnv, timeout: 90000, label: "validate the Prisma schema from the external packed consumer" });
      command("pnpm", ["--filter", "@aij/api", "exec", "prisma", "migrate", "deploy", "--schema", "prisma/schema.prisma"], { cwd: sourceRoot, env: prismaEnv, timeout: 120000, label: "apply initial migration to the new AF-078 synthetic database" });
      command("pnpm", ["--filter", "@aij/api", "exec", "prisma", "migrate", "status", "--schema", "prisma/schema.prisma"], { cwd: sourceRoot, env: prismaEnv, timeout: 60000, label: "read Prisma migration status from the new database" });
      command("pnpm", ["--recursive", "--filter", "./packages/**", "run", "build"], { cwd: sourceRoot, env: runtimeEnv, timeout: 180000, label: "build the packed workspace packages before their API/Web consumers" });
      command("pnpm", ["--filter", "@aij/api", "build"], { cwd: sourceRoot, env: runtimeEnv, timeout: 180000, label: "build API from the external packed consumer" });
      command("pnpm", ["--filter", "@aij/web", "build"], { cwd: sourceRoot, env: runtimeEnv, timeout: 300000, label: "build Web from the external packed consumer" });
      assert.ok(existsSync(join(sourceRoot, "apps/api/dist/main.js")), "packed API build output exists");
      assert.ok(existsSync(join(sourceRoot, "apps/web/.next/BUILD_ID")), "packed Web build output exists");
      const count = readFileSync(join(sourceRoot, "apps/api/prisma/migrations/20261019000000_initial/migration.sql"), "utf8");
      const expectedMigrations = (await import("node:fs")).readdirSync(join(sourceRoot, "apps/api/prisma/migrations"), { withFileTypes: true }).filter((entry) => entry.isDirectory()).length;
      assert.ok(expectedMigrations > 0 && count.includes("CREATE TABLE"));
      const sql = "SELECT count(*) FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL";
      const migratedCount = command("docker", ["exec", containerName, "psql", "-U", databaseUser, "-d", databaseName, "-Atc", sql], { timeout: 15000, label: "verify successful migration ledger rows" }).stdout.trim();
      assert.equal(Number(migratedCount), expectedMigrations);
      appendEvent("migration-and-build", { expectedMigrationCount: expectedMigrations, appliedMigrationCount: Number(migratedCount), prismaGenerate: "exit 0", migrateDeploy: "exit 0", migrateStatus: "exit 0", apiBuild: "exit 0", webBuild: "exit 0" });
    });

    await mustPassSubtest(t, "packed API health/readiness and scoped-identity rejection use real HTTP and PostgreSQL", async () => {
      const wrongDatabase = databaseUrl.replace("/" + databaseName, "/aij_foundation_test");
      const rejected = command(process.execPath, [runApp, "api", "start"], { cwd: sourceRoot, env: projectEnvironment(wrongDatabase), timeout: 20000, expect: "nonzero", label: "reject foreign database identity before API listen" });
      assert.ok(sanitize((rejected.stdout || "") + (rejected.stderr || "")).includes("Database target must be loopback and scoped"));
      await assertPortAvailable(apiPort);
      const api = startHost("api");
      const health = await waitForHttp("http://127.0.0.1:" + apiPort + "/api/health", 200);
      const healthJson = JSON.parse(health.body);
      assert.equal(healthJson.data.status, "ok");
      assert.equal(healthJson.data.projectId, projectId);
      assert.equal(healthJson.data.namespace, projectId + ":test");
      const ready = await waitForHttp("http://127.0.0.1:" + apiPort + "/api/ready", 200);
      const readyJson = JSON.parse(ready.body).data;
      assert.equal(readyJson.status, "ready");
      assert.equal(readyJson.reason, "READY");
      assert.deepEqual(listenerPids(apiPort).length > 0, true);
      appendEvent("api-health-readiness", { healthUrl: "http://127.0.0.1:" + apiPort + "/api/health", readinessUrl: "http://127.0.0.1:" + apiPort + "/api/ready", healthStatus: health.status, readinessStatus: ready.status, projectId: healthJson.data.projectId, namespace: healthJson.data.namespace, reason: readyJson.reason, hostCommandPid: api.child.pid });
    });

    await mustPassSubtest(t, "database outage makes readiness fail while liveness stays up, then recovers", async () => {
      command("docker", composeArgs("stop", "postgres"), { timeout: 30000, label: "stop only the verified AF-078-owned PostgreSQL service for outage test" });
      containerStarted = false;
      const live = await waitForHttp("http://127.0.0.1:" + apiPort + "/api/health", 200);
      const down = await waitForHttp("http://127.0.0.1:" + apiPort + "/api/ready", 503, 20000);
      assert.equal(JSON.parse(live.body).data.projectId, projectId);
      assert.equal(JSON.parse(down.body).data.status, "not-ready");
      command("docker", composeArgs("start", "postgres"), { timeout: 60000, label: "restart the same AF-078-owned PostgreSQL container without resetting its volume" });
      containerStarted = true;
      const restored = await waitForHttp("http://127.0.0.1:" + apiPort + "/api/ready", 200, 30000);
      assert.equal(JSON.parse(restored.body).data.reason, "READY");
      appendEvent("readiness-outage-recovery", { healthDuringDatabaseOutage: live.status, readinessDuringDatabaseOutage: down.status, readinessAfterSameContainerRestart: restored.status, volumePreserved: volumeName });
    });

    await mustPassSubtest(t, "packed Web host starts externally, renders the API identity, and owned processes stop cleanly", async () => {
      startHost("web");
      const page = await waitForHttp("http://127.0.0.1:" + webPort + "/", 200, 45000);
      assert.ok(page.body.includes(projectId), "SSR output must identify the generated project");
      assert.ok(listenerPids(webPort).length > 0, "packed Web must own its expected listener before shutdown");
      await stopHost("web");
      await stopHost("api");
      appendEvent("web-and-stop", { webUrl: "http://127.0.0.1:" + webPort, webStatus: page.status, projectIdRendered: page.body.includes(projectId), sourceRoot, bothOwnedHostPortsReleased: true });
    });

    verifyOwnedDatabaseContainer({ requirePublishedPort: false });
    command("docker", composeArgs("stop", "postgres"), { timeout: 30000, label: "stop only AF-078-owned PostgreSQL after readiness test; retain its named volume" });
    containerStarted = false;
  } catch (error) {
    originalError = error;
    throw error;
  } finally {
    const cleanupErrors = [];
    for (const app of ["web", "api"]) {
      try { await stopHost(app); } catch (error) { cleanupErrors.push(app + ": " + sanitize(error.message)); }
    }
    if (containerStarted) {
      try {
        verifyOwnedDatabaseContainer({ requirePublishedPort: false });
        command("docker", composeArgs("stop", "postgres"), { timeout: 30000, label: "stop only AF-078-owned PostgreSQL during safe cleanup; retain named volume" });
        containerStarted = false;
      } catch (error) { cleanupErrors.push("postgres: " + sanitize(error.message)); }
    }
    const report = {
      task: "AF-078",
      runId,
      sourceRoot,
      installRoot,
      tarball: packManifest?.tarball,
      tarballSha256: packManifest?.tarballSha256,
      projectId,
      namespace: projectId + ":test",
      ports: { web: webPort, api: apiPort, database: dbPort },
      database: { host: "127.0.0.1", database: databaseName, user: databaseUser, containerName, volumeName, stoppedAfterTest: !containerStarted, volumeRemoved: false },
      commands,
      events,
      cleanupErrors,
      testError: originalError ? sanitize(originalError.message) : null,
      recordedAt: new Date().toISOString()
    };
    writeFileSync(join(runRoot, "report.json"), JSON.stringify(report, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  }
});
