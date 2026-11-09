import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import runtimeEnvironment from "../runtime-environment.cjs";

const repositoryRoot = runtimeEnvironment.repositoryRoot;
const requireApi = createRequire(join(repositoryRoot, "apps/api/package.json"));
const { Client } = requireApi("pg");
const bcrypt = requireApi("bcryptjs");
const { LocalStorageAdapter, LocalStorageError } = requireApi(join(repositoryRoot, "apps/api/dist/files/local-storage.adapter.js"));
const cli = join(repositoryRoot, "scripts/project/cli.mjs");
const runId = randomBytes(6).toString("hex");
const evidenceRoot = join(repositoryRoot, ".artifacts/next-11a/project-isolation", runId);
const image = "postgres:16-alpine@sha256:e013e867e712fec275706a6c51c966f0bb0c93cfa8f51000f85a15f9865a28cb";
const forbiddenPorts = new Set([3655, 3656, 55432, 55433]);
const secrets = [];
const processes = [];
let composeProject;
let composeFile;
let summary = { task: "AF-074", runId, status: "IN_PROGRESS", sourceRepositoryTouched: false };

mkdirSync(evidenceRoot, { recursive: true, mode: 0o700 });

function sanitized(value) {
  let result = String(value ?? "");
  for (const secret of secrets) if (secret) result = result.split(secret).join("[REDACTED]");
  return result;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || repositoryRoot,
    env: options.env || process.env,
    encoding: "utf8",
    timeout: options.timeout || 180_000,
    maxBuffer: 8 * 1024 * 1024
  });
  if (result.error || result.status !== 0) {
    const detail = sanitized((result.stderr || result.stdout || result.error?.message || "").trim()).slice(-1600);
    throw new Error(`${options.label || command} failed safely (exit ${result.status ?? "unavailable"})${detail ? `: ${detail}` : ""}`);
  }
  return result.stdout;
}

async function unusedLoopbackPort(used) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const server = createServer();
    const port = await new Promise((resolvePort, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolvePort(server.address().port));
    });
    await new Promise((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()));
    if (!used.has(port) && !forbiddenPorts.has(port)) { used.add(port); return port; }
  }
  throw new Error("Could not allocate distinct unused loopback ports");
}

function writeEnv(path, values) {
  const body = Object.entries(values).map(([key, value]) => `${key}=${String(value)}`).join("\n") + "\n";
  writeFileSync(path, body, { mode: 0o600 });
  chmodSync(path, 0o600);
}

function composeArgs(...args) {
  return ["compose", "--project-name", composeProject, "--file", composeFile, ...args];
}

function processRows() {
  const output = execFileSync("ps", ["-axo", "pid=,ppid=,pgid=,command="], { encoding: "utf8" });
  return output.split(/\r?\n/).map(line => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/);
    return match ? { pid: Number(match[1]), ppid: Number(match[2]), pgid: Number(match[3]), command: match[4] } : undefined;
  }).filter(Boolean);
}

function descendants(rootPid) {
  const rows = processRows();
  const found = new Map([[rootPid, rows.find(row => row.pid === rootPid)]]);
  if (!found.get(rootPid)) return [];
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      if (!found.has(row.pid) && found.has(row.ppid)) { found.set(row.pid, row); changed = true; }
    }
  }
  return [...found.values()].filter(Boolean);
}

function processCwd(pid) {
  const output = execFileSync("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"], { encoding: "utf8" });
  return output.split(/\r?\n/).find(line => line.startsWith("n"))?.slice(1);
}

function assertOwnedApiTree(rootPid, projectRoot) {
  const rows = descendants(rootPid);
  assert.ok(rows.length >= 1, "owned API launcher is still present for identity verification");
  for (const row of rows) {
    const cwd = processCwd(row.pid);
    assert.ok(cwd === repositoryRoot || cwd === join(repositoryRoot, "apps/api"), "only the project CLI and this checkout API may run in the owned process tree");
    const expected = row.pid === rootPid
      ? row.command.includes("scripts/project/cli.mjs") && row.command.includes(" run ") && row.command.includes(projectRoot)
      : row.command.includes("scripts/run-app.mjs api start") || row.command.includes("apps/api/dist/main.js");
    assert.ok(expected, "owned API process PID/PPID/CWD/command must match the project CLI launch");
  }
  return rows.map(({ pid, ppid, pgid, command }) => ({ pid, ppid, pgid, command: sanitized(command) }));
}

async function stopApi(child, projectRoot) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const identity = assertOwnedApiTree(child.pid, projectRoot);
  child.kill("SIGTERM");
  await Promise.race([new Promise(resolveExit => child.once("exit", resolveExit)), delay(12_000)]);
  const survivors = descendants(child.pid);
  if (survivors.length) {
    // Revalidate every remaining descendant before forwarding SIGTERM directly.
    const checked = assertOwnedApiTree(child.pid, projectRoot);
    for (const row of checked) {
      if (row.pid !== child.pid) {
        try { process.kill(row.pid, "SIGTERM"); } catch (error) { if (error.code !== "ESRCH") throw error; }
      }
    }
    await Promise.race([new Promise(resolveExit => child.once("exit", resolveExit)), delay(5_000)]);
  }
  assert.equal(descendants(child.pid).length, 0, "all verified API descendants must exit after SIGTERM");
  summary.apiStops ||= [];
  summary.apiStops.push({ projectRoot, processes: identity, signal: "SIGTERM", stopped: true });
}

async function waitForHttp(url, expectedStatus, child, logState) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) break;
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
      const text = await response.text();
      if (response.status === expectedStatus) return { response, text };
    } catch { /* API startup is polled without logging connection errors */ }
    await delay(200);
  }
  const safeTail = sanitized(logState.output).slice(-1200);
  throw new Error(`HTTP startup did not reach ${expectedStatus} (${new URL(url).pathname}); ${safeTail || "no service output"}`);
}

function waitForDatabase(project) {
  return (async () => {
    const { databaseTarget } = project.runtime;
    const databaseUrl = new URL(project.values.TEST_DATABASE_URL);
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const client = new Client({
        host: databaseTarget.host, port: databaseTarget.port, database: databaseTarget.database,
        user: databaseTarget.user, password: decodeURIComponent(databaseUrl.password), connectionTimeoutMillis: 1500
      });
      try { await client.connect(); await client.end(); return; }
      catch { await client.end().catch(() => undefined); await delay(500); }
    }
    throw new Error("Owned project TEST PostgreSQL did not become reachable");
  })();
}

function apiLaunch(project) {
  const logState = { output: "" };
  const child = spawn(process.execPath, [cli, "run", "--dir", project.root, "--app", "api", "--mode", "start"], {
    cwd: repositoryRoot,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, LANG: process.env.LANG, LC_ALL: process.env.LC_ALL },
    detached: true,
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stdout.on("data", chunk => { logState.output = (logState.output + chunk.toString()).slice(-20_000); });
  child.stderr.on("data", chunk => { logState.output = (logState.output + chunk.toString()).slice(-20_000); });
  processes.push({ child, project });
  return { child, logState };
}

async function seedSyntheticAdmin(project, client) {
  const username = `admin_${project.runtime.projectId.replaceAll("-", "_")}`;
  const password = randomBytes(30).toString("base64url");
  secrets.push(password);
  const userId = `af074-${randomUUID()}`;
  const passwordHash = await bcrypt.hash(password, 12);
  await client.query(
    `INSERT INTO sys_user (id, username, password_hash, real_name, status, is_super_admin, token_version, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 'active', true, 0, NOW(), NOW())`,
    [userId, username, passwordHash, `Synthetic ${project.runtime.projectId}`]
  );
  return { username, password, userId };
}

function composeDocument(projects) {
  const lines = [
    `name: ${composeProject}`,
    "services:"
  ];
  for (const [index, project] of projects.entries()) {
    const name = index === 0 ? "project_alpha_db" : "project_beta_db";
    const volume = index === 0 ? "project_alpha_data" : "project_beta_data";
    lines.push(
      `  ${name}:`,
      `    image: '${image}'`,
      `    restart: "no"`,
      "    environment:",
      `      POSTGRES_DB: '${project.databaseName}'`,
      `      POSTGRES_USER: '${project.databaseUser}'`,
      `      POSTGRES_PASSWORD: '${project.databasePassword}'`,
      "      POSTGRES_HOST_AUTH_METHOD: scram-sha-256",
      "      POSTGRES_INITDB_ARGS: --auth-host=scram-sha-256 --auth-local=scram-sha-256",
      "    ports:",
      `      - '127.0.0.1:${project.databasePort}:5432'`,
      "    volumes:",
      `      - ${volume}:/var/lib/postgresql/data`,
      "    labels:",
      "      io.aij.owner: aij-foundation",
      "      io.aij.task: AF-074",
      `      io.aij.run: '${runId}'`,
      `      io.aij.project: '${project.runtime.projectId}'`,
      "    healthcheck:",
      `      test: ['CMD-SHELL', 'pg_isready -h 127.0.0.1 -U ${project.databaseUser} -d ${project.databaseName}']`,
      "      interval: 1s",
      "      timeout: 3s",
      "      retries: 40"
    );
  }
  lines.push("volumes:");
  for (const [index, project] of projects.entries()) {
    const volume = index === 0 ? "project_alpha_data" : "project_beta_data";
    lines.push(`  ${volume}:`, "    labels:", "      io.aij.owner: aij-foundation", "      io.aij.task: AF-074", `      io.aij.run: '${runId}'`, `      io.aij.project: '${project.runtime.projectId}'`);
  }
  return lines.join("\n") + "\n";
}

async function stopOwnedDatabases() {
  if (!composeProject) return;
  const output = run("docker", composeArgs("ps", "--all", "--quiet"), { timeout: 30_000, label: "AF-074 docker compose ps" }).trim();
  const ids = output.split(/\s+/).filter(Boolean);
  if (!ids.length) return;
  const inspected = JSON.parse(run("docker", ["inspect", ...ids], { timeout: 30_000, label: "AF-074 owned container inspection" }));
  for (const container of inspected) {
    const labels = container.Config?.Labels || {};
    assert.equal(labels["com.docker.compose.project"], composeProject, "only the unique AF-074 Compose project may be stopped");
    assert.equal(labels["io.aij.owner"], "aij-foundation", "container owner label must match this repository");
    assert.equal(labels["io.aij.task"], "AF-074", "container task label must match the current task");
    assert.equal(labels["io.aij.run"], runId, "container run label must match this run");
  }
  run("docker", composeArgs("stop", "--timeout", "15"), { timeout: 40_000, label: "AF-074 stop only owned database containers" });
  const remaining = run("docker", composeArgs("ps", "--status", "running", "--quiet"), { timeout: 30_000, label: "AF-074 verify owned databases stopped" }).trim();
  assert.equal(remaining, "", "owned PostgreSQL containers must stop while their volumes remain");
  summary.databaseStop = { composeProject, containerIds: ids, ownerVerified: true, stopped: true, volumesDeleted: false };
}

async function migration(project, action) {
  // Validate the exact project runtime/TEST URL in this process before Prisma writes or checks its database.
  const verified = runtimeEnvironment.loadRuntimeEnvironment(project.values);
  assert.equal(verified.profile, "project");
  assert.equal(verified.environment, "test");
  assert.deepEqual(verified.databaseTarget, project.runtime.databaseTarget);
  const env = {
    PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, LANG: process.env.LANG, LC_ALL: process.env.LC_ALL,
    RUNTIME_PROFILE: "project", PROJECT_ID: project.runtime.projectId, APP_ENV: "test",
    DATABASE_ENABLED: "true", TEST_DATABASE_URL: project.values.TEST_DATABASE_URL,
    DATABASE_URL: project.values.TEST_DATABASE_URL, AIJ_PROJECT_ROOT: project.root
  };
  run("pnpm", ["--filter", "@aij/api", "exec", "prisma", "migrate", action, "--schema", "prisma/schema.prisma"], {
    env, cwd: repositoryRoot, timeout: 180_000, label: `Project TEST migration ${action} for ${project.runtime.projectId}`
  });
  summary.migrations ||= [];
  summary.migrations.push({ projectId: project.runtime.projectId, action, target: { host: verified.databaseTarget.host, port: verified.databaseTarget.port, database: verified.databaseTarget.database, user: verified.databaseTarget.user }, passed: true });
}

test("two generated projects run API/DB/storage concurrently with isolated namespaces and credentials", { timeout: 420_000 }, async () => {
  const usedPorts = new Set();
  let apiAlpha;
  let apiBeta;
  const clients = [];
  let failure;
  try {
    const ports = [];
    for (let i = 0; i < 6; i += 1) ports.push(await unusedLoopbackPort(usedPorts));
    const [dbPortAlpha, dbPortBeta, webPortAlpha, apiPortAlpha, webPortBeta, apiPortBeta] = ports;
    const projectIds = [`af074-alpha-${runId}`, `af074-beta-${runId}`];
    const projectRoots = projectIds.map(id => join(evidenceRoot, id));
    const alphaCreate = run("pnpm", ["run", "aij:project", "--", "create", "--project-id", projectIds[0], "--environment", "test", "--dir", projectRoots[0], "--web-port", String(webPortAlpha), "--api-port", String(apiPortAlpha)], { cwd: repositoryRoot, timeout: 30_000, label: "generate AF-074 alpha project" });
    assert.match(alphaCreate, /CREATED/);
    const betaCreate = run("pnpm", ["run", "aij:project", "--", "create", "--project-id", projectIds[1], "--environment", "test", "--dir", projectRoots[1], "--web-port", String(webPortBeta), "--api-port", String(apiPortBeta), "--peer", join(projectRoots[0], "aij.project.json")], { cwd: repositoryRoot, timeout: 30_000, label: "generate AF-074 beta project" });
    assert.match(betaCreate, /CREATED/);

    const projectRows = [];
    for (const [index, projectId] of projectIds.entries()) {
      const root = projectRoots[index];
      const manifest = JSON.parse(readFileSync(join(root, "aij.project.json"), "utf8"));
      const example = Object.fromEntries(readFileSync(join(root, ".env.example"), "utf8").trim().split(/\r?\n/).map(line => {
        const separator = line.indexOf("="); return [line.slice(0, separator), line.slice(separator + 1)];
      }));
      const scope = projectId.replaceAll("-", "_") + "_test";
      const databasePassword = randomBytes(48).toString("base64url");
      const jwtSecret = randomBytes(48).toString("base64url");
      secrets.push(databasePassword, jwtSecret);
      const databaseName = scope;
      const databaseUser = scope;
      const databasePort = index === 0 ? dbPortAlpha : dbPortBeta;
      const databaseUrl = new URL(`postgresql://${databaseUser}:${encodeURIComponent(databasePassword)}@127.0.0.1:${databasePort}/${databaseName}?schema=public`);
      const values = {
        ...example,
        RUNTIME_PROFILE: "project",
        AIJ_PROJECT_ROOT: root,
        PROJECT_ID: projectId,
        APP_ENV: "test",
        AUTH_ENABLED: "true",
        CLIENT_AUTH_ENABLED: "false",
        DATABASE_ENABLED: "true",
        STORAGE_ENABLED: "true",
        ASYNC_RUNTIME_ENABLED: "false",
        ENABLED_PLUGINS: "",
        TEST_DATABASE_URL: databaseUrl.href,
        JWT_SECRET: jwtSecret
      };
      writeEnv(join(root, ".env"), values);
      const runtime = runtimeEnvironment.loadRuntimeEnvironment(values);
      assert.equal(runtime.profile, "project");
      assert.equal(runtime.listenHost, "127.0.0.1");
      assert.equal(runtime.databaseTarget.database, databaseName);
      assert.equal(runtime.databaseTarget.user, databaseUser);
      assert.equal(runtime.storageRoot, join(root, ".local-data", projectId, "test", "storage"));
      assert.equal(JSON.stringify(runtime).includes(databasePassword), false, "runtime projection must not contain DB credentials");
      assert.equal(JSON.stringify(runtime).includes(jwtSecret), false, "runtime projection must not contain JWT credentials");
      assert.ok(manifest.configuration.enabledPlugins.length === 0, "no plugin is enabled by default");
      projectRows.push({ projectId, root, manifest, values, runtime, databaseName, databaseUser, databasePassword, jwtSecret, databasePort, webPort: index === 0 ? webPortAlpha : webPortBeta, apiPort: index === 0 ? apiPortAlpha : apiPortBeta });
    }
    const [alpha, beta] = projectRows;
    for (const key of ["projectId", "webPort", "apiPort", "origin", "issuer", "cookiePrefix", "storageRoot"]) assert.notEqual(alpha.runtime[key], beta.runtime[key], `${key} must differ between projects`);
    for (const key of ["database", "user", "port"]) assert.notEqual(alpha.runtime.databaseTarget[key], beta.runtime.databaseTarget[key], `database ${key} must differ between projects`);
    assert.ok(alpha.jwtSecret !== beta.jwtSecret, "admin JWT secrets must differ");
    assert.ok(alpha.databasePassword !== beta.databasePassword, "database credentials must differ");

    composeProject = `aij-g13-af074-${runId}`;
    composeFile = join(evidenceRoot, "compose.yaml");
    writeFileSync(composeFile, composeDocument(projectRows), { mode: 0o600 });
    chmodSync(composeFile, 0o600);
    run("docker", composeArgs("up", "--detach", "--pull", "never"), { timeout: 180_000, label: "start only fresh AF-074 isolated PostgreSQL services" });
    await Promise.all(projectRows.map(waitForDatabase));
    summary.projects = projectRows.map(project => ({ projectId: project.projectId, environment: "test", webPort: project.webPort, apiPort: project.apiPort, databasePort: project.databasePort, database: project.databaseName, user: project.databaseUser, issuer: project.runtime.issuer, cookiePrefix: project.runtime.cookiePrefix, storageRoot: project.runtime.storageRoot }));

    for (const project of projectRows) await migration(project, "deploy");
    for (const project of projectRows) await migration(project, "status");

    for (const project of projectRows) {
      const client = new Client({
        host: project.runtime.databaseTarget.host, port: project.runtime.databaseTarget.port,
        database: project.runtime.databaseTarget.database, user: project.runtime.databaseTarget.user,
        password: project.databasePassword, connectionTimeoutMillis: 3000
      });
      await client.connect(); clients.push(client);
      const identity = await client.query("SELECT current_database() AS database, current_user AS username, session_user AS session_username, inet_server_port() AS server_port");
      assert.deepEqual(identity.rows[0], { database: project.databaseName, username: project.databaseUser, session_username: project.databaseUser, server_port: 5432 });
      await client.query("CREATE TABLE af074_project_probe (project_id text PRIMARY KEY, marker text NOT NULL)");
      await client.query("INSERT INTO af074_project_probe (project_id, marker) VALUES ($1, $2)", [project.projectId, `synthetic-${project.projectId}`]);
    }
    const alphaProbe = await clients[0].query("SELECT project_id, marker FROM af074_project_probe");
    const betaProbe = await clients[1].query("SELECT project_id, marker FROM af074_project_probe");
    assert.deepEqual(alphaProbe.rows, [{ project_id: alpha.projectId, marker: `synthetic-${alpha.projectId}` }]);
    assert.deepEqual(betaProbe.rows, [{ project_id: beta.projectId, marker: `synthetic-${beta.projectId}` }]);
    assert.ok(!betaProbe.rows.some(row => row.project_id === alpha.projectId), "alpha synthetic DB record must not appear in beta database");
    assert.ok(!alphaProbe.rows.some(row => row.project_id === beta.projectId), "beta synthetic DB record must not appear in alpha database");
    for (const client of clients) await client.end();
    clients.length = 0;

    for (const project of projectRows) {
      const adapter = new LocalStorageAdapter({ getOrThrow: key => ({ projectId: project.projectId, environment: "test", repositoryRoot: project.root, storageRoot: project.runtime.storageRoot })[key] });
      const objectKey = randomUUID();
      const bytes = Buffer.from(`synthetic-file-${project.projectId}`);
      const result = await adapter.write(objectKey, bytes);
      assert.deepEqual(await adapter.read(objectKey), bytes);
      assert.equal(await adapter.exists(objectKey), true);
      summary.fileObjects ||= [];
      summary.fileObjects.push({ projectId: project.projectId, relativePath: result.path, bytes: result.size, storageRoot: project.runtime.storageRoot });
    }
    const alphaAdapter = new LocalStorageAdapter({ getOrThrow: key => ({ projectId: alpha.projectId, environment: "test", repositoryRoot: alpha.root, storageRoot: alpha.runtime.storageRoot })[key] });
    const betaAdapter = new LocalStorageAdapter({ getOrThrow: key => ({ projectId: beta.projectId, environment: "test", repositoryRoot: beta.root, storageRoot: beta.runtime.storageRoot })[key] });
    const sharedObjectKey = randomUUID();
    const alphaBytes = Buffer.from("synthetic-alpha-only");
    const betaBytes = Buffer.from("synthetic-beta-only");
    await alphaAdapter.write(sharedObjectKey, alphaBytes);
    await assert.rejects(betaAdapter.read(sharedObjectKey), error => error instanceof LocalStorageError && error.code === "OBJECT_MISSING");
    await betaAdapter.write(sharedObjectKey, betaBytes);
    assert.deepEqual(await alphaAdapter.read(sharedObjectKey), alphaBytes);
    assert.deepEqual(await betaAdapter.read(sharedObjectKey), betaBytes);

    apiAlpha = apiLaunch(alpha);
    apiBeta = apiLaunch(beta);
    const healthAlpha = await waitForHttp(`http://127.0.0.1:${alpha.apiPort}/api/health`, 200, apiAlpha.child, apiAlpha.logState);
    const healthBeta = await waitForHttp(`http://127.0.0.1:${beta.apiPort}/api/health`, 200, apiBeta.child, apiBeta.logState);
    const alphaHealthEnvelope = JSON.parse(healthAlpha.text);
    const betaHealthEnvelope = JSON.parse(healthBeta.text);
    assert.equal(alphaHealthEnvelope.success, true, "alpha liveness must use the standard API envelope");
    assert.equal(betaHealthEnvelope.success, true, "beta liveness must use the standard API envelope");
    const alphaHealth = alphaHealthEnvelope.data;
    const betaHealth = betaHealthEnvelope.data;
    assert.equal(alphaHealth.projectId, alpha.projectId);
    assert.equal(betaHealth.projectId, beta.projectId);
    assert.notEqual(alphaHealth.namespace, betaHealth.namespace);
    assert.equal(alphaHealth.service, `${alpha.projectId}-api`);
    assert.equal(betaHealth.service, `${beta.projectId}-api`);
    const readyAlpha = await waitForHttp(`http://127.0.0.1:${alpha.apiPort}/api/ready`, 200, apiAlpha.child, apiAlpha.logState);
    const readyBeta = await waitForHttp(`http://127.0.0.1:${beta.apiPort}/api/ready`, 200, apiBeta.child, apiBeta.logState);
    assert.equal(JSON.parse(readyAlpha.text).data.status, "ready");
    assert.equal(JSON.parse(readyBeta.text).data.status, "ready");

    const login = async project => {
      const syntheticAdmin = project.admin;
      const response = await fetch(`http://127.0.0.1:${project.apiPort}/api/auth/login`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: syntheticAdmin.username, password: syntheticAdmin.password })
      });
      const body = await response.json();
      assert.equal(response.status, 200, "synthetic administrator login must work only in its own project");
      assert.equal(body.success, true, "own-project login must use the standard API envelope");
      return body.data.accessToken;
    };
    for (const project of projectRows) {
      const client = new Client({ host: project.runtime.databaseTarget.host, port: project.runtime.databaseTarget.port, database: project.databaseName, user: project.databaseUser, password: project.databasePassword });
      await client.connect(); clients.push(client);
      project.admin = await seedSyntheticAdmin(project, client);
      await client.end(); clients.length -= 1;
    }
    const alphaToken = await login(alpha);
    const betaToken = await login(beta);
    const alphaMe = await fetch(`http://127.0.0.1:${alpha.apiPort}/api/auth/me`, { headers: { authorization: `Bearer ${alphaToken}` } });
    const betaMe = await fetch(`http://127.0.0.1:${beta.apiPort}/api/auth/me`, { headers: { authorization: `Bearer ${betaToken}` } });
    assert.equal(alphaMe.status, 200);
    assert.equal(betaMe.status, 200);
    const crossAlphaToBeta = await fetch(`http://127.0.0.1:${beta.apiPort}/api/auth/me`, { headers: { authorization: `Bearer ${alphaToken}` } });
    const crossBetaToAlpha = await fetch(`http://127.0.0.1:${alpha.apiPort}/api/auth/me`, { headers: { authorization: `Bearer ${betaToken}` } });
    assert.equal(crossAlphaToBeta.status, 401, "alpha bearer must be rejected by beta API");
    assert.equal(crossBetaToAlpha.status, 401, "beta bearer must be rejected by alpha API");

    const browserLogin = async project => fetch(`http://127.0.0.1:${project.apiPort}/api/auth/browser-login`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: `http://127.0.0.1:${project.webPort}`, "x-aij-client": "web" },
      body: JSON.stringify({ username: project.admin.username, password: project.admin.password })
    });
    const alphaBrowser = await browserLogin(alpha);
    const betaBrowser = await browserLogin(beta);
    assert.equal(alphaBrowser.status, 200);
    assert.equal(betaBrowser.status, 200);
    const alphaCookie = alphaBrowser.headers.get("set-cookie");
    const betaCookie = betaBrowser.headers.get("set-cookie");
    assert.ok(alphaCookie && betaCookie, "each project must issue its own browser cookie");
    const alphaCookieName = alphaCookie.split("=", 1)[0];
    const betaCookieName = betaCookie.split("=", 1)[0];
    assert.notEqual(alphaCookieName, betaCookieName);
    const crossCookie = await fetch(`http://127.0.0.1:${beta.apiPort}/api/auth/session`, { headers: { cookie: alphaCookie.split(";")[0] } });
    assert.equal(crossCookie.status, 401, "alpha cookie must not authenticate at beta API");

    const logs = apiAlpha.logState.output + apiBeta.logState.output;
    assert.ok(!secrets.some(secret => logs.includes(secret)), "API logs must not expose project credentials");
    assert.ok(!logs.includes(alpha.values.TEST_DATABASE_URL) && !logs.includes(beta.values.TEST_DATABASE_URL), "API logs must not expose database URLs");
    const loginBodies = await Promise.all([alphaMe.text(), betaMe.text(), crossAlphaToBeta.text(), crossBetaToAlpha.text(), crossCookie.text()]);
    assert.ok(loginBodies.every(body => !secrets.some(secret => body.includes(secret))), "HTTP responses must not expose project credentials");

    summary.status = "PASS";
    summary.assertions = { twoProjectConfigurations: true, twoProjectDatabases: true, distinctCredentials: true, migrationsDeployAndStatus: true, persistentSyntheticDbRecords: true, realFilesystemIsolation: true, parallelApiHealthAndReadiness: true, ownProjectAdminLogin: true, crossProjectBearer401: true, distinctCookieNamesAndCrossProject401: true, noCredentialDisclosure: true };
    writeFileSync(join(evidenceRoot, "summary.json"), JSON.stringify(summary, null, 2) + "\n", { mode: 0o600 });
  } catch (error) {
    failure = error;
    summary.status = "FAILED";
    summary.failure = error instanceof Error ? sanitized(error.message) : "Unknown isolated project test failure";
  } finally {
    for (const client of clients) await client.end().catch(() => undefined);
    for (const owned of [apiBeta, apiAlpha]) {
      if (!owned) continue;
      try { await stopApi(owned.child, processes.find(item => item.child === owned.child).project.root); }
      catch (error) { failure ||= error; summary.stopFailure = sanitized(error.message); }
    }
    try { await stopOwnedDatabases(); }
    catch (error) { failure ||= error; summary.databaseStopFailure = sanitized(error.message); }
    summary.stoppedAt = new Date().toISOString();
    if (failure) summary.status = "FAILED";
    writeFileSync(join(evidenceRoot, "summary.json"), JSON.stringify(summary, null, 2) + "\n", { mode: 0o600 });
  }
  if (failure) throw new Error(sanitized(failure.message || "AF-074 integration test failed safely"));
  assert.equal(summary.status, "PASS");
  console.log(JSON.stringify({
    task: "AF-074", runId, status: "PASS", projects: summary.projects,
    migrations: summary.migrations, fileObjects: summary.fileObjects,
    apiStops: summary.apiStops?.map(stop => ({ projectId: stop.projectRoot.split("/").at(-1), stopped: stop.stopped })),
    databaseStop: summary.databaseStop && { composeProject: summary.databaseStop.composeProject, stopped: summary.databaseStop.stopped, volumesDeleted: false },
    evidence: join(evidenceRoot, "summary.json")
  }));
});
