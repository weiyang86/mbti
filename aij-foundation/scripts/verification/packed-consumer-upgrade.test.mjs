import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, realpathSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { delimiter, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertPortAvailable } from "../port-availability.mjs";
import test from "node:test";

const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const af076EndToEnd = process.env.AIJ_AF076_E2E === "1";
const taskId = af076EndToEnd ? "AF-076" : "AF-079";
const taskSlug = taskId.toLowerCase().replaceAll("-", "");
const requestedRunId = af076EndToEnd ? process.env.AIJ_AF076_RUN_ID : undefined;
if (af076EndToEnd && !/^[a-f0-9]{10}$/.test(requestedRunId || "")) throw new Error("AF-076 run ID must be a generated ten-character hex value");
const runId = requestedRunId || randomBytes(5).toString("hex");
const artifactRoot = join(repositoryRoot, ".artifacts", taskId.toLowerCase());
const runRoot = join(artifactRoot, (af076EndToEnd ? "e2e-run-" : "restore-run-") + runId);
const installRoot = join("/private/tmp", "aij-" + taskSlug + "-" + runId);
const consumerRoot = join(installRoot, "private-consumer");
const sourceRoot = join(installRoot, "materialized-aij-foundation");
const configRoot = join(sourceRoot, ".local-data", taskSlug + "-config");
const packageRoot = join(consumerRoot, "node_modules", "@aij", "base");
const projectCli = join(sourceRoot, "scripts", "project", "cli.mjs");
const composeName = "aij-" + taskSlug + "-" + runId;
const sourceService = "prior";
const restoreService = "restore";
const sourceContainer = composeName + "-prior";
const restoreContainer = composeName + "-restore";
const sourceVolume = "aij_" + taskSlug + "_prior_" + runId;
const restoreVolume = "aij_" + taskSlug + "_restore_" + runId;
const sourcePort = 55444;
const restorePort = 55445;
const webPort = 37265;
const apiPort = 37266;
const projectId = "aij-" + taskSlug + "-" + runId;
const databaseName = projectId.replaceAll("-", "_") + "_test";
const databaseUser = databaseName;
const sourcePassword = randomBytes(32).toString("hex");
const restorePassword = randomBytes(32).toString("hex");
const sourceUrl = "postgresql://" + databaseUser + ":" + sourcePassword + "@127.0.0.1:" + sourcePort + "/" + databaseName + "?schema=public";
const restoreUrl = "postgresql://" + databaseUser + ":" + restorePassword + "@127.0.0.1:" + restorePort + "/" + databaseName + "?schema=public";
const composeEnvPath = join(runRoot, "compose.env");
const composePath = join(runRoot, "compose.yml");
const dbBackupPath = join(runRoot, "synthetic-database.sql");
const fileBackupPath = join(runRoot, "synthetic-files.tar");
const manifestPath = join(runRoot, "synthetic-backup-manifest.json");
const sourceStorageRoot = join(sourceRoot, ".local-data", projectId, "test", "storage");
const restoreStorageRoot = af076EndToEnd
  ? join(configRoot, ".local-data", projectId, "test", "restored-" + runId, "storage")
  : join(sourceRoot, ".local-data", projectId, "test", "restored-" + runId, "storage");
const commands = [];
const events = [];
const ownedHosts = new Map();
const redactions = [sourcePassword, restorePassword, sourceUrl, restoreUrl];
const envBase = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(PATH|HOME|TMPDIR|TMP|TEMP|SystemRoot|WINDIR|LANG|LC_ALL|TZ|PNPM_HOME)$/i.test(key)));
const testEnv = { ...envBase, PATH: [dirname(process.execPath), envBase.PATH].filter(Boolean).join(delimiter), CI: "1", CHECKPOINT_DISABLE: "1", PRISMA_HIDE_UPDATE_MESSAGE: "1", NEXT_TELEMETRY_DISABLED: "1", ...(af076EndToEnd ? { AIJ_AF076_E2E: "1", AIJ_AF076_RUN_ID: runId } : {}) };
const sanitized = (text) => redactions.reduce((value, secret) => secret ? value.replaceAll(secret, "[REDACTED]") : value, String(text ?? "")).replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+:[^\s/@]+@/gi, "$1[REDACTED]@");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const appendEvent = (name, details = {}) => events.push({ name, ...details });
let tarball;
let tarballManifest;
let configEnvironment;
let originalError;
let syntheticFixture;
let cleanupFailed = false;

mkdirSync(runRoot, { recursive: false, mode: 0o700 });
mkdirSync(installRoot, { recursive: false, mode: 0o700 });

function command(commandName, args, { cwd = repositoryRoot, env = testEnv, input, timeout = 120000, expect = 0, label = commandName, maxBuffer = 48 * 1024 * 1024 } = {}) {
  const started = Date.now();
  const result = spawnSync(commandName, args, { cwd, env, encoding: "utf8", input, shell: false, timeout, maxBuffer });
  const exitCode = result.status ?? (result.error?.code === "ETIMEDOUT" ? 124 : 127);
  commands.push({ label, command: commandName, args, cwd, exitCode, signal: result.signal ?? null, durationMs: Date.now() - started });
  const output = sanitized((result.stdout || "") + "\n" + (result.stderr || ""));
  if (expect === "nonzero") assert.notEqual(exitCode, 0, label + " must refuse; output=" + output.slice(-4000));
  else assert.equal(exitCode, expect, label + " exit code; output=" + output.slice(-5000));
  return { ...result, status: exitCode };
}

function composeArgs(...args) {
  return ["compose", "--project-name", composeName, "--env-file", composeEnvPath, "--file", composePath, ...args];
}

function ipv4Integer(address) {
  const parts = address.split(".").map(Number);
  assert.equal(parts.length, 4);
  assert.ok(parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255));
  return parts.reduce((value, part) => (value << 8n) | BigInt(part), 0n);
}

function ipv4CidrRange(cidr) {
  const match = /^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/.exec(cidr);
  if (!match) return null;
  const prefix = Number(match[2]);
  if (prefix < 0 || prefix > 32) return null;
  const address = ipv4Integer(match[1]);
  const hostBits = 32n - BigInt(prefix);
  const size = 1n << hostBits;
  const start = (address / size) * size;
  return { start, end: start + size - 1n };
}

function ipv4String(value) {
  return [24n, 16n, 8n, 0n].map((shift) => Number((value >> shift) & 255n)).join(".");
}

function selectPrivateDockerSubnet() {
  const ids = command("docker", ["network", "ls", "--quiet"], { label: "list existing Docker networks before choosing a private " + taskId + " subnet" }).stdout.trim().split(/\s+/).filter(Boolean);
  assert.ok(ids.length > 0, "Docker must report its existing networks before a new subnet is allocated");
  const inspected = command("docker", ["network", "inspect", ...ids], { label: "inspect existing Docker IPAM ranges before choosing a private " + taskId + " subnet", maxBuffer: 16 * 1024 * 1024 });
  const networks = JSON.parse(inspected.stdout);
  const usedRanges = networks.flatMap((network) => (network.IPAM?.Config || []).map((config) => ipv4CidrRange(config.Subnet)).filter(Boolean));
  const rangeStart = ipv4Integer("100.127.0.0");
  const preferredIndex = Number.parseInt(runId, 16) % 4096;
  for (let offset = 0; offset < 4096; offset++) {
    const index = (preferredIndex + offset) % 4096;
    const start = rangeStart + BigInt(index * 16);
    const candidate = { start, end: start + 15n };
    if (usedRanges.some((range) => candidate.start <= range.end && range.start <= candidate.end)) continue;
    return ipv4String(start) + "/28";
  }
  throw new Error("No unused /28 subnet remains in the task-reserved 100.127.0.0/16 Docker range");
}

function writeCompose(networkSubnet) {
  const env = [
    "RUN_ID=" + runId,
    "SOURCE_CONTAINER=" + sourceContainer,
    "RESTORE_CONTAINER=" + restoreContainer,
    "SOURCE_VOLUME=" + sourceVolume,
    "RESTORE_VOLUME=" + restoreVolume,
    "SOURCE_PORT=" + sourcePort,
    "RESTORE_PORT=" + restorePort,
    "SOURCE_DB=" + databaseName,
    "RESTORE_DB=" + databaseName,
    "SOURCE_USER=" + databaseUser,
    "RESTORE_USER=" + databaseUser,
    "SOURCE_PASSWORD=" + sourcePassword,
    "RESTORE_PASSWORD=" + restorePassword
  ].join("\n") + "\n";
  writeFileSync(composeEnvPath, env, { mode: 0o600, flag: "wx" });
  chmodSync(composeEnvPath, 0o600);
  const lines = [
    "services:",
    "  prior:",
    "    image: postgres:16-alpine@sha256:e013e867e712fec275706a6c51c966f0bb0c93cfa8f51000f85a15f9865a28cb",
    "    container_name: \"${SOURCE_CONTAINER}\"",
    "    restart: \"no\"",
    "    environment:",
    "      POSTGRES_DB: \"${SOURCE_DB}\"",
    "      POSTGRES_USER: \"${SOURCE_USER}\"",
    "      POSTGRES_PASSWORD: \"${SOURCE_PASSWORD}\"",
    "      POSTGRES_HOST_AUTH_METHOD: scram-sha-256",
    "      POSTGRES_INITDB_ARGS: --auth-host=scram-sha-256 --auth-local=trust",
    "    ports:",
    "      - \"127.0.0.1:${SOURCE_PORT}:5432\"",
    "    volumes:",
    "      - " + taskSlug + "_prior_data:/var/lib/postgresql/data",
    "    labels:",
    "      io.aij.owner: aij-foundation",
    "      io.aij.task: " + taskId,
    "      io.aij.instance: \"${RUN_ID}\"",
    "      io.aij.role: prior-schema-source",
    "    healthcheck:",
    "      test: [\"CMD\", \"pg_isready\", \"-U\", \"${SOURCE_USER}\", \"-d\", \"${SOURCE_DB}\"]",
    "      interval: 1s",
    "      timeout: 3s",
    "      retries: 45",
    "      start_period: 3s",
    "  restore:",
    "    image: postgres:16-alpine@sha256:e013e867e712fec275706a6c51c966f0bb0c93cfa8f51000f85a15f9865a28cb",
    "    container_name: \"${RESTORE_CONTAINER}\"",
    "    restart: \"no\"",
    "    environment:",
    "      POSTGRES_DB: \"${RESTORE_DB}\"",
    "      POSTGRES_USER: \"${RESTORE_USER}\"",
    "      POSTGRES_PASSWORD: \"${RESTORE_PASSWORD}\"",
    "      POSTGRES_HOST_AUTH_METHOD: scram-sha-256",
    "      POSTGRES_INITDB_ARGS: --auth-host=scram-sha-256 --auth-local=trust",
    "    ports:",
    "      - \"127.0.0.1:${RESTORE_PORT}:5432\"",
    "    volumes:",
    "      - " + taskSlug + "_restore_data:/var/lib/postgresql/data",
    "    labels:",
    "      io.aij.owner: aij-foundation",
    "      io.aij.task: " + taskId,
    "      io.aij.instance: \"${RUN_ID}\"",
    "      io.aij.role: restored-target",
    "    healthcheck:",
    "      test: [\"CMD\", \"pg_isready\", \"-U\", \"${RESTORE_USER}\", \"-d\", \"${RESTORE_DB}\"]",
    "      interval: 1s",
    "      timeout: 3s",
    "      retries: 45",
    "      start_period: 3s",
    "volumes:",
    "  " + taskSlug + "_prior_data:",
    "    name: \"${SOURCE_VOLUME}\"",
    "    labels:",
    "      io.aij.owner: aij-foundation",
    "      io.aij.task: " + taskId,
    "      io.aij.instance: \"${RUN_ID}\"",
    "  " + taskSlug + "_restore_data:",
    "    name: \"${RESTORE_VOLUME}\"",
    "    labels:",
    "      io.aij.owner: aij-foundation",
    "      io.aij.task: " + taskId,
    "      io.aij.instance: \"${RUN_ID}\"",
    "networks:",
    "  default:",
    "    driver: bridge",
    "    ipam:",
    "      config:",
    "        - subnet: \"" + networkSubnet + "\"",
    "    labels:",
    "      io.aij.owner: aij-foundation",
    "      io.aij.task: " + taskId,
    "      io.aij.instance: \"${RUN_ID}\""
  ];
  writeFileSync(composePath, lines.join("\n") + "\n", { mode: 0o600, flag: "wx" });
  chmodSync(composePath, 0o600);
}

function verifyOwnedContainer(containerName, role, volumeName, port, { requirePublished = true } = {}) {
  const format = "{{index .Config.Labels \"io.aij.task\"}}|{{index .Config.Labels \"io.aij.instance\"}}|{{index .Config.Labels \"io.aij.role\"}}|{{range .Mounts}}{{.Name}}:{{.Destination}}{{end}}|{{json (index .NetworkSettings.Ports \"5432/tcp\")}}";
  const result = command("docker", ["inspect", "--format", format, containerName], { label: "verify " + taskId + "-owned " + role + " container/volume identity" });
  const [task, instance, actualRole, mounts, mappings] = result.stdout.trim().split("|");
  assert.equal(task, taskId);
  assert.equal(instance, runId);
  assert.equal(actualRole, role);
  assert.ok(mounts.includes(volumeName + ":/var/lib/postgresql/data"));
  if (requirePublished) assert.ok(mappings.includes("127.0.0.1") && mappings.includes(String(port)));
  return { task, instance, role: actualRole, volume: volumeName, port };
}

function connection(url) {
  const require = createRequire(join(sourceRoot, "package.json"));
  const { Client } = require("pg");
  return new Client({ connectionString: url, connectionTimeoutMillis: 5000, application_name: "aij-" + taskSlug + "-synthetic-restore" });
}

function projectEnvironment(url = sourceUrl, storageRoot = ".local-data/" + projectId + "/test/storage") {
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
    LOCAL_STORAGE_ROOT: storageRoot,
    AUTH_ENABLED: "false",
    CLIENT_AUTH_ENABLED: "false",
    DATABASE_ENABLED: "true",
    STORAGE_ENABLED: "true",
    ASYNC_RUNTIME_ENABLED: "false",
    ENABLED_PLUGINS: "",
    TEST_DATABASE_URL: url,
    DATABASE_URL: url
  };
}

function localMigrations() {
  const dir = join(sourceRoot, "apps/api/prisma/migrations");
  return readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory() && !entry.name.startsWith("._")).map((entry) => {
    const sql = readFileSync(join(dir, entry.name, "migration.sql"));
    return { name: entry.name, checksum: sha256(sql) };
  });
}

async function withClient(url, operation) {
  const client = connection(url);
  await client.connect();
  try { return await operation(client); }
  finally { await client.end(); }
}

function listenerPids(port) {
  const result = spawnSync("lsof", ["-nP", "-t", "-iTCP:" + port, "-sTCP:LISTEN"], { cwd: repositoryRoot, env: testEnv, encoding: "utf8", shell: false, timeout: 10000 });
  if (result.status === 1 && !result.stdout.trim()) return [];
  assert.equal(result.status, 0, "lsof must resolve listener identity on " + taskId + " port " + port);
  return result.stdout.trim().split(/\s+/).filter(Boolean).map(Number);
}

function processIdentity(pid) {
  const ps = spawnSync("ps", ["-o", "pid=,ppid=,command=", "-p", String(pid)], { cwd: repositoryRoot, env: testEnv, encoding: "utf8", shell: false, timeout: 10000 });
  assert.equal(ps.status, 0, "ps must resolve owned process " + pid);
  const cwdRaw = spawnSync("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"], { cwd: repositoryRoot, env: testEnv, encoding: "utf8", shell: false, timeout: 10000 });
  assert.equal(cwdRaw.status, 0, "lsof must resolve CWD for owned process " + pid);
  const cwd = cwdRaw.stdout.split("\n").find((line) => line.startsWith("n"))?.slice(1) ?? "";
  return { ps: ps.stdout.trim(), cwd };
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
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 400));
  }
  throw new Error("HTTP probe did not reach status " + expectedStatus + " at " + url + "; last=" + JSON.stringify(last));
}

function startPackedHost(app, url = restoreUrl) {
  const port = app === "api" ? apiPort : webPort;
  const runtimeEnv = projectEnvironment(url, ".local-data/" + projectId + "/test/restored-" + runId + "/storage");
  const args = [join(sourceRoot, "scripts/run-app.mjs"), app, "start"];
  const child = spawn(process.execPath, args, { cwd: sourceRoot, env: runtimeEnv, stdio: ["ignore", "pipe", "pipe"], shell: false });
  let output = "";
  child.stdout.on("data", (chunk) => { output = (output + chunk.toString()).slice(-12000); });
  child.stderr.on("data", (chunk) => { output = (output + chunk.toString()).slice(-12000); });
  const entry = { child, app, port, args, output: () => sanitized(output) };
  ownedHosts.set(app, entry);
  commands.push({ label: taskId + " packed " + app + " host start", command: process.execPath, args, cwd: sourceRoot, pid: child.pid, parentPid: process.pid, mode: "owned-long-running" });
  return entry;
}

async function stopPackedHost(app) {
  const entry = ownedHosts.get(app);
  if (!entry) return;
  const { child, port } = entry;
  const pid = child.pid;
  if (child.exitCode !== null || child.signalCode !== null) {
    assert.deepEqual(listenerPids(port), [], app + " must release its listener after exit");
    ownedHosts.delete(app);
    return;
  }
  const identity = processIdentity(pid);
  assert.match(identity.ps, new RegExp("^" + pid + "\\s+" + process.pid + "\\s+"));
  assert.ok(identity.ps.includes("scripts/run-app.mjs") && identity.ps.includes(app + " start"), "only the exact packed host wrapper may be signaled");
  assert.equal(realpathSync(identity.cwd), realpathSync(sourceRoot), "owned wrapper CWD must be the external packed consumer root");
  const listenerDetails = listenerPids(port).map((listenerPid) => {
    const listener = processIdentity(listenerPid);
    assert.ok(realpathSync(listener.cwd) === realpathSync(sourceRoot) || realpathSync(listener.cwd).startsWith(realpathSync(sourceRoot) + sep), "listener must belong to the external packed consumer");
    return { pid: listenerPid, identity: listener };
  });
  const closePromise = once(child, "close");
  child.kill("SIGTERM");
  const closed = await Promise.race([closePromise.then(() => true), new Promise((resolveDelay) => setTimeout(() => resolveDelay(false), 12000))]);
  if (!closed) {
    const still = processIdentity(pid);
    assert.match(still.ps, new RegExp("^" + pid + "\\s+" + process.pid + "\\s+"));
    assert.ok(still.ps.includes("scripts/run-app.mjs") && still.ps.includes(app + " start"));
    assert.equal(realpathSync(still.cwd), realpathSync(sourceRoot));
    child.kill("SIGKILL");
    await Promise.race([once(child, "close"), new Promise((resolveDelay) => setTimeout(() => resolveDelay(false), 3000))]);
  }
  for (let attempt = 0; attempt < 20 && listenerPids(port).length; attempt++) await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  assert.deepEqual(listenerPids(port), [], app + " listener must release after stopping the verified owned wrapper");
  commands.push({ label: taskId + " owned process shutdown", pid, ppid: process.pid, cwd: identity.cwd, command: identity.ps, signal: closed ? "SIGTERM" : "SIGKILL after identity recheck", listenerIdentities: listenerDetails.map((item) => ({ pid: item.pid, command: item.identity.ps, cwd: item.identity.cwd })) });
  ownedHosts.delete(app);
}

async function mustPassSubtest(context, name, callback) {
  let failure;
  await context.test(name, async () => {
    try { await callback(); } catch (error) { failure = error; throw error; }
  });
  if (failure) throw failure;
}

async function stopOwnedService(service, containerName, role, volumeName, port) {
  const probe = spawnSync("docker", ["inspect", "--type", "container", containerName], { cwd: repositoryRoot, env: testEnv, encoding: "utf8", shell: false, timeout: 10000 });
  if (probe.status !== 0) return;
  verifyOwnedContainer(containerName, role, volumeName, port, { requirePublished: false });
  command("docker", composeArgs("stop", service), { timeout: 30000, label: "stop only " + taskId + "-owned " + role + " container and retain its volume" });
}

test(taskId + " packed consumer restores, upgrades and runs against an earlier synthetic database/file snapshot", { timeout: 900000 }, async (t) => {
  try {
    assert.equal(process.versions.node.split(".")[0], "24");
    assert.ok(!resolve(installRoot).startsWith(repositoryRoot + sep));
    await assertPortAvailable(sourcePort); await assertPortAvailable(restorePort);
    await assertPortAvailable(webPort); await assertPortAvailable(apiPort);

    await mustPassSubtest(t, "private tarball installation materializes a separate synthetic consumer", () => {
      const packed = command(process.execPath, ["scripts/distribution/pack-aij-base.mjs"], { cwd: repositoryRoot, label: "pack current local private aij-base tarball" });
      const packedJson = JSON.parse(packed.stdout.trim().split("\n").at(-1));
      assert.equal(packedJson.status, "PACKED_LOCAL_PRIVATE_CONSUMER");
      tarball = join(repositoryRoot, packedJson.tarball);
      tarballManifest = JSON.parse(readFileSync(join(repositoryRoot, packedJson.manifest), "utf8"));
      assert.equal(tarballManifest.private, true);
      assert.equal(tarballManifest.publication, "NOT_AUTHORIZED");
      assert.ok(existsSync(tarball));
      mkdirSync(consumerRoot, { recursive: false, mode: 0o700 });
      writeFileSync(join(consumerRoot, "package.json"), JSON.stringify({ name: "aij-" + taskSlug + "-private-consumer", version: "0.0.0", private: true, type: "module", dependencies: { "@aij/base": "file:" + tarball } }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
      command("pnpm", ["install", "--offline", "--ignore-workspace", "--ignore-scripts", "--lockfile=false"], { cwd: consumerRoot, label: "offline install local aij-base tarball into " + taskId + " consumer" });
      command(process.execPath, [join(packageRoot, "bin/aij-base.cjs"), "install", "--dir", sourceRoot], { cwd: consumerRoot, label: "materialize " + taskId + " project source from installed tarball" });
      mkdirSync(join(sourceRoot, ".local-data"), { recursive: true, mode: 0o700 });
      command("pnpm", ["install", "--offline", "--frozen-lockfile", "--ignore-scripts"], { cwd: sourceRoot, timeout: 240000, label: "offline frozen install packed consumer workspaces" });
      const runtime = createRequire(join(sourceRoot, "package.json"))("./scripts/runtime-environment.cjs");
      const sampleUrl = (port) => "postgresql://" + databaseUser + ":" + randomBytes(32).toString("hex") + "@127.0.0.1:" + port + "/" + databaseName + "?schema=public";
      for (const [port, url] of [[sourcePort, sampleUrl(sourcePort)], [restorePort, sampleUrl(restorePort)]]) {
        const resolved = runtime.resolveProjectConfiguration({ projectId, environment: "test", webPort, apiPort, origin: "http://127.0.0.1:" + webPort, apiUrl: "http://127.0.0.1:" + apiPort + "/api", issuer: "urn:aij:" + projectId + ":test:api", cookiePrefix: projectId.replaceAll("-", "_") + "_test", storageRoot: ".local-data/" + projectId + "/test/storage", enabledPlugins: [], capabilities: { auth: false, clientAuth: false, database: true, storage: true }, databaseUrl: url }, { projectRoot: sourceRoot });
        assert.equal(resolved.projectId, projectId);
        assert.equal(resolved.databaseTarget.host, "127.0.0.1");
        assert.equal(resolved.databaseTarget.port, port);
        assert.equal(resolved.databaseTarget.database, databaseName);
      }
      appendEvent("packed-consumer", { package: "@aij/base@" + tarballManifest.version, tarballSha256: tarballManifest.tarballSha256, sourceRoot, separateFromCheckout: !realpathSync(sourceRoot).startsWith(realpathSync(repositoryRoot) + sep), projectId, sourcePort, restorePort });
    });

    await mustPassSubtest(t, "two fresh " + taskId + " PostgreSQL instances have unique labels and non-shared named volumes", async () => {
      const image = "postgres:16-alpine@sha256:e013e867e712fec275706a6c51c966f0bb0c93cfa8f51000f85a15f9865a28cb";
      const imageProbe = spawnSync("docker", ["image", "inspect", image, "--format", "{{.Id}}"], { cwd: repositoryRoot, env: testEnv, encoding: "utf8", shell: false, timeout: 10000 });
      assert.equal(imageProbe.status, 0);
      for (const [name, volume] of [[sourceContainer, sourceVolume], [restoreContainer, restoreVolume]]) {
        command("docker", ["inspect", name], { expect: "nonzero", label: "confirm no existing " + taskId + " container will be adopted" });
        command("docker", ["volume", "inspect", volume], { expect: "nonzero", label: "confirm no existing " + taskId + " volume will be adopted" });
      }
      const networkSubnet = selectPrivateDockerSubnet();
      writeCompose(networkSubnet);
      command("docker", composeArgs("up", "--detach", "--wait", "--wait-timeout", "60", sourceService, restoreService), { timeout: 90000, label: "create only the two fresh " + taskId + " synthetic PostgreSQL targets" });
      const network = command("docker", ["network", "inspect", composeName + "_default", "--format", "{{json .IPAM.Config}}|{{json .Labels}}"], { label: "verify the new " + taskId + "-owned Docker network uses the selected isolated subnet" });
      const [actualIpam, actualLabels] = network.stdout.trim().split("|");
      assert.equal(JSON.parse(actualIpam)[0].Subnet, networkSubnet);
      const labels = JSON.parse(actualLabels);
      assert.equal(labels["io.aij.owner"], "aij-foundation");
      assert.equal(labels["io.aij.task"], taskId);
      assert.equal(labels["io.aij.instance"], runId);
      appendEvent("isolated-docker-network", { name: composeName + "_default", subnet: networkSubnet, owner: "aij-foundation", taskId, runId });
      const sourceIdentity = verifyOwnedContainer(sourceContainer, "prior-schema-source", sourceVolume, sourcePort);
      const restoreIdentity = verifyOwnedContainer(restoreContainer, "restored-target", restoreVolume, restorePort);
      assert.notEqual(sourceIdentity.volume, restoreIdentity.volume);
      const actualSource = await withClient(sourceUrl, async (client) => (await client.query("SELECT current_database() AS database,current_user AS \"user\",inet_server_port() AS port")).rows[0]);
      const actualRestore = await withClient(restoreUrl, async (client) => (await client.query("SELECT current_database() AS database,current_user AS \"user\",inet_server_port() AS port")).rows[0]);
      assert.deepEqual(actualSource, { database: databaseName, user: databaseUser, port: 5432 });
      assert.deepEqual(actualRestore, { database: databaseName, user: databaseUser, port: 5432 });
      appendEvent("isolated-databases", { source: sourceIdentity, restore: restoreIdentity, bothLoopbackOnly: true, logicalDatabase: databaseName, databaseUser });
    });

    await mustPassSubtest(t, "the packed consumer builds the existing storage/migration owners and validates the current Prisma schema", () => {
      mkdirSync(join(sourceRoot, ".local-data"), { recursive: true, mode: 0o700 });
      command(process.execPath, [projectCli, "create", "--project-id", projectId, "--environment", "test", "--dir", configRoot, "--web-port", String(webPort), "--api-port", String(apiPort)], { cwd: sourceRoot, label: "generate " + taskId + " private project configuration" });
      const example = readFileSync(join(configRoot, ".env.example"), "utf8");
      assert.ok(example.includes("DATABASE_ENABLED=false"));
      const contents = example.replace("DATABASE_ENABLED=false", "DATABASE_ENABLED=true").replace("STORAGE_ENABLED=false", "STORAGE_ENABLED=true") + "TEST_DATABASE_URL=" + sourceUrl + "\n";
      writeFileSync(join(configRoot, ".env"), contents, { flag: "wx", mode: 0o600 }); chmodSync(join(configRoot, ".env"), 0o600);
      configEnvironment = projectEnvironment();
      const show = command(process.execPath, [projectCli, "show", "--dir", configRoot], { cwd: sourceRoot, env: configEnvironment, label: "check generated " + taskId + " configuration" });
      const publicConfig = JSON.parse(show.stdout.trim());
      assert.equal(publicConfig.status, "VALID"); assert.equal(publicConfig.projectId, projectId); assert.equal(publicConfig.capabilities.database, true);
      assert.deepEqual(publicConfig.enabledPlugins, []);
      command("pnpm", ["--filter", "@aij/api", "run", "prisma:generate"], { cwd: sourceRoot, env: projectEnvironment(), label: "generate Prisma client in packed " + taskId + " consumer" });
      command("pnpm", ["--filter", "@aij/api", "run", "prisma:validate"], { cwd: sourceRoot, env: projectEnvironment(), label: "validate current packed consumer schema" });
      command("pnpm", ["--recursive", "--filter", "./packages/**", "run", "build"], { cwd: sourceRoot, env: projectEnvironment(), label: "build packed workspace owner packages" });
      command("pnpm", ["--filter", "@aij/api", "build"], { cwd: sourceRoot, env: configEnvironment, timeout: 180000, label: "build packed API file/migration owners" });
      assert.ok(existsSync(join(sourceRoot, "apps/api/dist/files/local-storage.adapter.js")));
      assert.ok(existsSync(join(sourceRoot, "apps/api/dist/files/file-content.service.js")));
      appendEvent("schema-and-build", { prismaGenerate: 0, prismaValidate: 0, packageBuild: 0, apiBuild: 0, generatedProjectConfig: "VALID", enabledPlugins: [] });
    });

    await mustPassSubtest(t, "the prior database is genuinely at seven migrations before synthetic rows and files are added", async () => {
      const migrationDir = join(sourceRoot, "apps/api/prisma/migrations");
      const finalMigration = join(migrationDir, "20261030140000_plugin_operation_rollback_retry");
      const heldMigration = join(sourceRoot, ".local-data", taskSlug + "-held-migrations", "20261030140000_plugin_operation_rollback_retry");
      mkdirSync(dirname(heldMigration), { recursive: true, mode: 0o700 });
      renameSync(finalMigration, heldMigration);
      try {
        command("pnpm", ["--filter", "@aij/api", "exec", "prisma", "migrate", "deploy", "--schema", "prisma/schema.prisma"], { cwd: sourceRoot, env: { ...projectEnvironment(sourceUrl), DATABASE_URL: sourceUrl }, timeout: 120000, label: "apply only the seven-migration prior schema to fresh source database" });
      } finally { renameSync(heldMigration, finalMigration); }
      const pending = command("pnpm", ["--filter", "@aij/api", "exec", "prisma", "migrate", "status", "--schema", "prisma/schema.prisma"], { cwd: sourceRoot, env: { ...projectEnvironment(sourceUrl), DATABASE_URL: sourceUrl }, timeout: 60000, expect: "nonzero", label: "confirm the current migration chain reports one unapplied final migration" });
      assert.match(sanitized(pending.stdout + pending.stderr), /20261030140000_plugin_operation_rollback_retry|not yet been applied|not yet applied/i);

      const ledger = await withClient(sourceUrl, async (client) => (await client.query("SELECT migration_name,checksum,finished_at,rolled_back_at FROM public._prisma_migrations ORDER BY migration_name")).rows);
      assert.equal(ledger.length, 7); assert.ok(ledger.every((row) => row.finished_at && !row.rolled_back_at));
      const require = createRequire(join(sourceRoot, "apps/api/package.json"));
      const { ConfigService } = require("@nestjs/config");
      const { LocalStorageAdapter } = require("./dist/files/local-storage.adapter.js");
      const storage = new LocalStorageAdapter(new ConfigService({ projectId, environment: "test", repositoryRoot: sourceRoot, storageRoot: sourceStorageRoot }));
      const bytes = Buffer.from("synthetic " + taskId + " restored file " + runId + "\n", "utf8");
      const objectKey = randomUUID(); const assetId = randomUUID();
      const stored = await storage.write(objectKey, bytes); const checksum = sha256(bytes);
      await withClient(sourceUrl, async (client) => {
        await client.query("INSERT INTO public.plugin_installation (id,project_id,plugin_code,version,owner,status,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,now(),now())", [taskSlug + "-install-" + runId, projectId, "aij-synthetic-fixture", "0.1.0", taskId + " synthetic fixture", "enabled"]);
        await client.query("INSERT INTO public.plugin_operation (id,installation_id,action,version,owner,status,operator_id,started_at,finished_at,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,now(),now(),now())", [taskSlug + "-op-" + runId, taskSlug + "-install-" + runId, "install", "0.1.0", taskId + " synthetic fixture", "succeeded", "synthetic-operator"]);
        await client.query("INSERT INTO public.file_asset (id,original_name,filename,mime_type,size,path,url,storage_type,object_key,checksum,project_id,workspace_id,plugin_code,owner_type,owner_id,uploader_id,status,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,'local',$8,$9,$10,NULL,NULL,'user',$11,$11,'active',now(),now())", [assetId, "synthetic-note.txt", objectKey + ".txt", "text/plain", stored.size, stored.path, "/api/client/files/" + assetId, objectKey, checksum, projectId, taskSlug + "-owner-" + runId]);
      });
      const { FileContentService } = require("./dist/files/file-content.service.js");
      const { StorageReaderRouter } = require("./dist/files/storage-reader-router.js");
      assert.deepEqual(await new FileContentService(new StorageReaderRouter([["local", storage]])).read({ storageType: "local", objectKey, size: bytes.length, checksum }), bytes);
      appendEvent("prior-schema-fixture", { appliedMigrations: 7, pendingMigration: "20261030140000_plugin_operation_rollback_retry", syntheticPluginOperationId: taskSlug + "-op-" + runId, syntheticFileAssetId: assetId, objectKey, fileBytes: bytes.length, fileSha256: checksum, storagePath: stored.path });
      syntheticFixture = { bytes, objectKey, assetId, checksum, storagePath: stored.path, fileBytes: bytes.length };
    });

    await mustPassSubtest(t, "synthetic SQL and file backups restore into fresh isolated targets without losing records or content", async () => {
      const synthetic = syntheticFixture;
      assert.ok(synthetic);
      const dump = command("docker", ["exec", sourceContainer, "pg_dump", "--no-owner", "--no-privileges", "-U", databaseUser, "-d", databaseName], { timeout: 90000, label: "create actual pg_dump of " + taskId + " synthetic prior-schema database", maxBuffer: 48 * 1024 * 1024 });
      writeFileSync(dbBackupPath, dump.stdout, { flag: "wx", mode: 0o600 }); chmodSync(dbBackupPath, 0o600);
      const sourceStorageStat = readFileSync(join(sourceStorageRoot, synthetic.storagePath));
      assert.deepEqual(sourceStorageStat, synthetic.bytes);
      command("tar", ["-cf", fileBackupPath, "-C", sourceStorageRoot, "."], { timeout: 30000, label: "archive actual " + taskId + " project file storage" });
      chmodSync(fileBackupPath, 0o600);
      const archiveListing = command("tar", ["-tf", fileBackupPath], { timeout: 15000, label: "inspect file archive paths before restore" }).stdout.trim().split("\n").filter(Boolean);
      assert.ok(archiveListing.every((entry) => entry === "./" || entry === "./objects/" || entry === "./objects/" + synthetic.objectKey));
      const priorMigrations = await withClient(sourceUrl, async (client) => (await client.query("SELECT migration_name,checksum FROM public._prisma_migrations ORDER BY migration_name")).rows);
      const manifest = { format: "aij-foundation-synthetic-backup-v1", projectId, environment: "test", sourceDatabase: databaseName, sourceSchemaMigrations: priorMigrations, databaseDump: { file: "synthetic-database.sql", sha256: sha256(readFileSync(dbBackupPath)) }, fileArchive: { file: "synthetic-files.tar", sha256: sha256(readFileSync(fileBackupPath)), objectKeys: [synthetic.objectKey] }, syntheticOnly: true };
      writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", { flag: "wx", mode: 0o600 }); chmodSync(manifestPath, 0o600);
      assert.equal(JSON.parse(readFileSync(manifestPath, "utf8")).syntheticOnly, true);

      const empty = await withClient(restoreUrl, async (client) => (await client.query("SELECT count(*)::int AS count FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'")).rows[0].count);
      assert.equal(empty, 0, "restore DB must be a new empty target before the dump is applied");
      command("docker", ["exec", "-i", restoreContainer, "psql", "-v", "ON_ERROR_STOP=1", "-U", databaseUser, "-d", databaseName], { cwd: repositoryRoot, input: readFileSync(dbBackupPath), timeout: 90000, label: "restore actual synthetic SQL backup into the fresh " + taskId + " PostgreSQL target", maxBuffer: 48 * 1024 * 1024 });
      const restoredPriorLedger = await withClient(restoreUrl, async (client) => (await client.query("SELECT migration_name,checksum,finished_at,rolled_back_at FROM public._prisma_migrations ORDER BY migration_name")).rows);
      assert.equal(restoredPriorLedger.length, 7); assert.ok(restoredPriorLedger.every((row) => row.finished_at && !row.rolled_back_at));
      const restoredOldOperation = await withClient(restoreUrl, async (client) => (await client.query("SELECT id,version,status FROM public.plugin_operation WHERE id=$1", [taskSlug + "-op-" + runId])).rows[0]);
      assert.deepEqual(restoredOldOperation, { id: taskSlug + "-op-" + runId, version: "0.1.0", status: "succeeded" });
      const restoredAsset = await withClient(restoreUrl, async (client) => (await client.query("SELECT storage_type,id,project_id,object_key,size,checksum,path,status FROM public.file_asset WHERE id=$1", [synthetic.assetId])).rows[0]);
      assert.deepEqual(restoredAsset, { storage_type: "local", id: synthetic.assetId, project_id: projectId, object_key: synthetic.objectKey, size: synthetic.fileBytes, checksum: synthetic.checksum, path: synthetic.storagePath, status: "active" });

      mkdirSync(restoreStorageRoot, { recursive: true, mode: 0o700 });
      command("tar", ["-xf", fileBackupPath, "-C", restoreStorageRoot], { timeout: 30000, label: "restore actual file archive to a new " + taskId + " project storage root" });
      const require = createRequire(join(sourceRoot, "apps/api/package.json"));
      const { ConfigService } = require("@nestjs/config");
      const { LocalStorageAdapter } = require("./dist/files/local-storage.adapter.js");
      const { FileContentService } = require("./dist/files/file-content.service.js");
      const { StorageReaderRouter } = require("./dist/files/storage-reader-router.js");
      const restoredStorage = new LocalStorageAdapter(new ConfigService({ projectId, environment: "test", repositoryRoot: sourceRoot, storageRoot: restoreStorageRoot }));
      const content = await new FileContentService(new StorageReaderRouter([["local", restoredStorage]])).read({ storageType: restoredAsset.storage_type, objectKey: restoredAsset.object_key, size: restoredAsset.size, checksum: restoredAsset.checksum });
      assert.deepEqual(content, synthetic.bytes);
      assert.equal(await restoredStorage.exists(synthetic.objectKey), true);
      appendEvent("backup-restored", { databaseBackupBytes: readFileSync(dbBackupPath).length, databaseBackupSha256: manifest.databaseDump.sha256, fileArchiveBytes: readFileSync(fileBackupPath).length, fileArchiveSha256: manifest.fileArchive.sha256, restoredDatabasePort: restorePort, restoredFileRoot: restoreStorageRoot, priorMigrationCount: restoredPriorLedger.length, syntheticFileSha256: sha256(content), rowChecks: ["PluginOperation", "FileAsset"] });
    });

    await mustPassSubtest(t, "restored old schema upgrades in place to the current migration chain and rejects an incompatible ledger", async () => {
      const migrations = localMigrations();
      assert.equal(migrations.length, 8);
      const before = await withClient(restoreUrl, async (client) => (await client.query("SELECT count(*)::int AS count FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL")).rows[0].count);
      assert.equal(before, 7);
      command("pnpm", ["--filter", "@aij/api", "exec", "prisma", "migrate", "deploy", "--schema", "prisma/schema.prisma"], { cwd: sourceRoot, env: { ...projectEnvironment(restoreUrl), DATABASE_URL: restoreUrl }, timeout: 120000, label: "upgrade the restored prior-schema target using real current Prisma migrations" });
      command("pnpm", ["--filter", "@aij/api", "exec", "prisma", "migrate", "status", "--schema", "prisma/schema.prisma"], { cwd: sourceRoot, env: { ...projectEnvironment(restoreUrl), DATABASE_URL: restoreUrl }, timeout: 60000, label: "verify restored database is up to date" });
      const ledger = await withClient(restoreUrl, async (client) => (await client.query("SELECT migration_name,checksum,finished_at,rolled_back_at FROM public._prisma_migrations ORDER BY migration_name")).rows);
      assert.equal(ledger.length, migrations.length); assert.ok(ledger.every((row) => row.finished_at && !row.rolled_back_at));
      const schemaRows = await withClient(restoreUrl, async (client) => (await client.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='plugin_operation' ORDER BY column_name")).rows.map((row) => row.column_name));
      assert.ok(schemaRows.includes("previous_version") && schemaRows.includes("retry_of_operation_id"));
      const pluginRows = await withClient(restoreUrl, async (client) => (await client.query("SELECT operation.id,operation.version,operation.previous_version,operation.retry_of_operation_id,installation.status FROM public.plugin_operation operation JOIN public.plugin_installation installation ON installation.id=operation.installation_id WHERE operation.id=$1", [taskSlug + "-op-" + runId])).rows[0]);
      assert.deepEqual(pluginRows, { id: taskSlug + "-op-" + runId, version: "0.1.0", previous_version: null, retry_of_operation_id: null, status: "enabled" });
      const fileRow = await withClient(restoreUrl, async (client) => (await client.query("SELECT id,object_key,size,checksum,path,status FROM public.file_asset WHERE id=$1", [syntheticFixture.assetId])).rows[0]);
      assert.equal(fileRow.status, "active");
      const sourceModule = await import(pathToFileURL(join(sourceRoot, "scripts/database/migration.mjs")).href);
      assert.equal(sourceModule.assertLocalMigrationLedger(migrations, ledger), true);
      const rejectTemporaryLedgerMutation = async (mutation) => withClient(restoreUrl, async (client) => {
        await client.query("BEGIN");
        try {
          await mutation(client);
          const { rows } = await client.query("SELECT migration_name,checksum,finished_at,rolled_back_at FROM public._prisma_migrations ORDER BY migration_name");
          assert.throws(() => sourceModule.assertLocalMigrationLedger(migrations, rows), /Migration history\/checksum is not the local applied chain/);
        } finally { await client.query("ROLLBACK"); }
      });
      await rejectTemporaryLedgerMutation((client) => client.query("UPDATE public._prisma_migrations SET checksum=$1 WHERE migration_name=$2", ["0".repeat(64), migrations[0].name]));
      await rejectTemporaryLedgerMutation((client) => client.query("UPDATE public._prisma_migrations SET finished_at=NULL WHERE migration_name=$1", [migrations[0].name]));
      const restoredLedger = await withClient(restoreUrl, async (client) => (await client.query("SELECT migration_name,checksum,finished_at,rolled_back_at FROM public._prisma_migrations ORDER BY migration_name")).rows);
      assert.equal(sourceModule.assertLocalMigrationLedger(migrations, restoredLedger), true);
      appendEvent("upgrade-and-incompatibility-guard", { priorApplied: before, finalApplied: ledger.length, newColumns: ["previous_version", "retry_of_operation_id"], existingPluginOperationPreserved: true, fileAssetPreserved: fileRow.id === syntheticFixture.assetId, validLedgerAccepted: true, mismatchedChecksumRejected: true, unfinishedMigrationRejected: true });
    });

    if (af076EndToEnd) await mustPassSubtest(t, "the same packed consumer starts after database and file recovery and proves real health/readiness/outage recovery and Web delivery", async () => {
      assert.equal(af076EndToEnd, true);
      assert.ok(syntheticFixture, "synthetic PluginOperation/FileAsset and file were created before backup");
      const identity = verifyOwnedContainer(restoreContainer, "restored-target", restoreVolume, restorePort);
      assert.equal(identity.volume, restoreVolume);
      command("pnpm", ["--filter", "@aij/web", "build"], { cwd: sourceRoot, env: projectEnvironment(restoreUrl), timeout: 300000, label: "build packed Web only after restored database upgrade" });
      assert.ok(existsSync(join(sourceRoot, "apps/web/.next/BUILD_ID")));
      await assertPortAvailable(apiPort);
      await assertPortAvailable(webPort);

      startPackedHost("api", restoreUrl);
      const health = await waitForHttp("http://127.0.0.1:" + apiPort + "/api/health", 200);
      const healthJson = JSON.parse(health.body);
      assert.equal(healthJson.data.status, "ok");
      assert.equal(healthJson.data.projectId, projectId);
      assert.equal(healthJson.data.namespace, projectId + ":test");
      const ready = await waitForHttp("http://127.0.0.1:" + apiPort + "/api/ready", 200);
      assert.equal(JSON.parse(ready.body).data.reason, "READY");

      await stopOwnedService(restoreService, restoreContainer, "restored-target", restoreVolume, restorePort);
      const liveWhileDbDown = await waitForHttp("http://127.0.0.1:" + apiPort + "/api/health", 200);
      assert.equal(JSON.parse(liveWhileDbDown.body).data.projectId, projectId);
      const notReady = await waitForHttp("http://127.0.0.1:" + apiPort + "/api/ready", 503, 20000);
      assert.equal(JSON.parse(notReady.body).data.status, "not-ready");
      verifyOwnedContainer(restoreContainer, "restored-target", restoreVolume, restorePort, { requirePublished: false });
      command("docker", composeArgs("start", restoreService), { timeout: 60000, label: "restart the same " + taskId + " restored database without resetting its volume" });
      verifyOwnedContainer(restoreContainer, "restored-target", restoreVolume, restorePort);
      const recovered = await waitForHttp("http://127.0.0.1:" + apiPort + "/api/ready", 200, 30000);
      assert.equal(JSON.parse(recovered.body).data.reason, "READY");

      startPackedHost("web", restoreUrl);
      const page = await waitForHttp("http://127.0.0.1:" + webPort + "/", 200, 45000);
      assert.ok(page.body.includes(projectId), "packed Web SSR must render the same generated project identity");
      await stopPackedHost("web");
      await stopPackedHost("api");

      const restoredRows = await withClient(restoreUrl, async (client) => {
        const operation = (await client.query("SELECT id,status FROM public.plugin_operation WHERE id=$1", [taskSlug + "-op-" + runId])).rows[0];
        const asset = (await client.query("SELECT id,checksum FROM public.file_asset WHERE id=$1", [syntheticFixture.assetId])).rows[0];
        return { operation, asset };
      });
      assert.equal(restoredRows.operation.status, "succeeded");
      assert.equal(restoredRows.asset.checksum, syntheticFixture.checksum);
      appendEvent("end-to-end-host-readiness", {
        sourceRootIsExternalConsumer: !realpathSync(sourceRoot).startsWith(realpathSync(repositoryRoot) + sep),
        apiHealth: health.status,
        apiReadyBeforeOutage: ready.status,
        apiHealthDuringDatabaseOutage: liveWhileDbDown.status,
        apiReadyDuringDatabaseOutage: notReady.status,
        apiReadyAfterSameVolumeRecovery: recovered.status,
        webStatus: page.status,
        webProjectIdentityRendered: page.body.includes(projectId),
        restoredDatabase: { host: "127.0.0.1", port: restorePort, migrations: 8, syntheticOperationPreserved: true, syntheticFileAssetPreserved: true },
        restoredFile: { bytes: syntheticFixture.fileBytes, sha256: syntheticFixture.checksum, verifiedByFileContentService: true, packedRuntimeStorageRootConfigured: true },
        listenerPortsReleased: listenerPids(apiPort).length === 0 && listenerPids(webPort).length === 0
      });
    });

    verifyOwnedContainer(sourceContainer, "prior-schema-source", sourceVolume, sourcePort);
    verifyOwnedContainer(restoreContainer, "restored-target", restoreVolume, restorePort);
  } catch (error) { originalError = error; throw error; }
  finally {
    const cleanupErrors = [];
    for (const app of ["web", "api"]) {
      try { await stopPackedHost(app); }
      catch (error) { cleanupErrors.push(app + " host: " + sanitized(error.message)); }
    }
    for (const item of [[sourceService, sourceContainer, "prior-schema-source", sourceVolume, sourcePort], [restoreService, restoreContainer, "restored-target", restoreVolume, restorePort]]) {
      try { await stopOwnedService(...item); }
      catch (error) { cleanupErrors.push(item[2] + ": " + sanitized(error.message)); }
    }
    const containerState = (container) => {
      const probe = spawnSync("docker", ["inspect", "--format", "{{.State.Status}}", container], { cwd: repositoryRoot, env: testEnv, encoding: "utf8", shell: false, timeout: 10000 });
      return probe.status === 0 ? probe.stdout.trim() : "UNAVAILABLE";
    };
    const report = {
      task: taskId, runId, projectId, sourceRoot, installRoot,
      tarball: tarballManifest?.tarball, tarballSha256: tarballManifest?.tarballSha256,
      targets: {
        prior: { host: "127.0.0.1", port: sourcePort, database: databaseName, container: sourceContainer, volume: sourceVolume, stateAfterTest: containerState(sourceContainer), volumeRemoved: false },
        restore: { host: "127.0.0.1", port: restorePort, database: databaseName, container: restoreContainer, volume: restoreVolume, stateAfterTest: containerState(restoreContainer), volumeRemoved: false }
      },
      backups: { database: dbBackupPath, fileArchive: fileBackupPath, manifest: manifestPath, permissions: "0600" },
      commands, events, cleanupErrors, testError: originalError ? sanitized(originalError.stack || originalError.message) : null,
      recordedAt: new Date().toISOString()
    };
    writeFileSync(join(runRoot, "report.json"), JSON.stringify(report, null, 2) + "\n", { mode: 0o600, flag: "wx" });
    cleanupFailed = cleanupErrors.length > 0;
  }
  if (cleanupFailed) throw new Error(taskId + " cleanup could not safely stop every owned service; inspect sanitized report " + join(runRoot, "report.json"));
});
