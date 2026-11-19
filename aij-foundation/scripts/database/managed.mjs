import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseEnv } from "node:util";
import { assertPortAvailable } from "../port-availability.mjs";
import environment from "../runtime-environment.cjs";
import { repositoryRoot, profile, assertLocalPath, readDatabaseEnvironment, withDatabase, checkDatabase, DatabaseOperationError } from "./connection.mjs";

const image = "postgres:16-alpine@sha256:e013e867e712fec275706a6c51c966f0bb0c93cfa8f51000f85a15f9865a28cb";
const redactions = new Set();
const artifactRoot = join(repositoryRoot, ".artifacts/af-005/operations");
let evidenceFile, context;
function safeText(value) {
  let text = String(value);
  for (const secret of redactions) text = text.split(secret).join("[REDACTED]");
  return text.replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+:[^\s/@]+@/gi, "$1[REDACTED]@");
}
function record(value) {
  assertLocalPath(artifactRoot);
  if (!evidenceFile) {
    mkdirSync(artifactRoot, { recursive: true, mode: 0o700 });
    evidenceFile = join(artifactRoot, randomUUID() + ".jsonl");
  }
  writeFileSync(evidenceFile, safeText(JSON.stringify({ at: new Date().toISOString(), ...value })) + "\n", { flag: "a", mode: 0o600 });
}
function processEnvironment(extra = {}) {
  return { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(PATH|HOME|TMPDIR|LANG|LC_ALL)$/i.test(key))), ...extra };
}
function command(binary, args, extra = {}) {
  try {
    const stdout = execFileSync(binary, args, { cwd: repositoryRoot, env: processEnvironment(extra), encoding: "utf8", timeout: 50000, maxBuffer: 4 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
    record({ command: [binary, ...args], exitCode: 0, stdout });
    return stdout.trim();
  } catch (error) {
    record({ command: [binary, ...args], exitCode: error.status ?? 127, stdout: error.stdout?.toString() || "", stderr: error.stderr?.toString() || "" });
    throw new DatabaseOperationError("Local command failed; inspect sanitized evidence", error.status || 3, { command: [binary, ...args], evidenceFile });
  }
}
function docker(args, extra = {}) { return command("docker", context ? ["--context", context, ...args] : args, extra); }
function localDocker() {
  context = undefined;
  const selected = docker(["context", "show"]);
  if (!/^[a-zA-Z0-9_.-]+$/.test(selected)) throw new DatabaseOperationError("Invalid Docker context", 2);
  const endpoint = JSON.parse(docker(["context", "inspect", selected, "--format", "{{json .Endpoints.docker}}"]));
  if (!endpoint.Host?.startsWith("unix://") || endpoint.SkipTLSVerify) throw new DatabaseOperationError("Only a local Unix-socket Docker context is permitted", 2);
  context = selected;
  if (docker(["version", "--format", "{{.Server.Os}}"]) !== "linux") throw new DatabaseOperationError("A local Linux Docker engine is required", 2);
  docker(["compose", "version", "--short"]);
}
function ids(p) { return docker(["ps", "-a", "--filter", "label=com.docker.compose.project=" + p.project, "--format", "{{.ID}}"]).split("\n").filter(Boolean); }
function volumeExists(p) { return docker(["volume", "ls", "--format", "{{.Name}}"]).split("\n").includes(p.volume); }
function networkExists(p) { return docker(["network", "ls", "--format", "{{.Name}}"]).split("\n").includes(p.project + "_default"); }
function labelsMatch(labels, p, state) {
  return labels?.["io.aij.owner"] === "aij-foundation" && labels["io.aij.mode"] === p.mode &&
    labels["io.aij.instance"] === state.instanceId && labels["com.docker.compose.project"] === p.project;
}
export function assertContainerOwnership(container, p, state) {
  if (!labelsMatch(container.Config?.Labels, p, state) ||
      container.Config.Labels["com.docker.compose.service"] !== "postgres" ||
      container.Config.Labels["com.docker.compose.project.working_dir"] !== repositoryRoot ||
      container.Config.Labels["com.docker.compose.project.config_files"] !== p.composeFile ||
      container.Config.Image !== image) throw new DatabaseOperationError("Container ownership/configuration mismatch; left untouched", 2);
  const bindings = container.HostConfig?.PortBindings?.["5432/tcp"];
  if (Object.keys(container.HostConfig?.PortBindings || {}).length !== 1 || bindings?.length !== 1 ||
      bindings[0].HostIp !== "127.0.0.1" || bindings[0].HostPort !== String(p.port)) {
    throw new DatabaseOperationError("Container is not bound exclusively to the declared loopback port", 2);
  }
  const mounts = container.Mounts || [];
  const data = mounts.find((mount) => mount.Destination === "/var/lib/postgresql/data");
  if (mounts.length !== 1 || data?.Type !== "volume" || data.Name !== p.volume) {
    throw new DatabaseOperationError("Container data mount does not belong to this project", 2);
  }
  return true;
}
function inspectOwned(p, state) {
  const containers = ids(p);
  if (containers.length > 1) throw new DatabaseOperationError("Unexpected containers in database project; left untouched", 2);
  // Never retrieve Config.Env: PostgreSQL receives the local password through the Compose process environment.
  const format = '{"Id":{{json .Id}},"Config":{"Image":{{json .Config.Image}},"Labels":{{json .Config.Labels}}},"HostConfig":{"PortBindings":{{json .HostConfig.PortBindings}}},"Mounts":{{json .Mounts}},"State":{"Running":{{json .State.Running}},"Pid":{{json .State.Pid}}}}';
  const container = containers.length ? JSON.parse(docker(["inspect", "--type", "container", "--format", format, containers[0]])) : null;
  if (container) assertContainerOwnership(container, p, state);
  if (volumeExists(p)) {
    const [volume] = JSON.parse(docker(["volume", "inspect", p.volume]));
    if (!labelsMatch(volume.Labels, p, state) || volume.Driver !== "local") throw new DatabaseOperationError("Database volume ownership mismatch; left untouched", 2);
  } else if (container) throw new DatabaseOperationError("Owned data volume is missing", 2);
  if (networkExists(p)) {
    const [network] = JSON.parse(docker(["network", "inspect", p.project + "_default"]));
    if (!labelsMatch(network.Labels, p, state)) throw new DatabaseOperationError("Database network ownership mismatch; left untouched", 2);
  }
  return container;
}
function ignored(path) {
  assertLocalPath(path);
  command("git", ["--no-optional-locks", "check-ignore", "--quiet", "--", path]);
}
function credentials(p) {
  for (const file of [p.stateFile, p.environmentFile, p.secretFile]) assertLocalPath(file);
  const state = JSON.parse(readFileSync(p.stateFile, "utf8"));
  if (state.mode !== p.mode || state.project !== p.project || state.repository !== repositoryRoot ||
      !/^[a-f0-9-]{36}$/.test(state.instanceId)) throw new DatabaseOperationError("Local database ownership record does not match this repository", 2);
  const values = parseEnv(readFileSync(p.environmentFile, "utf8"));
  const target = environment.resolveDatabaseEnvironment(p.mode, values);
  const password = decodeURIComponent(new URL(values[target.variable]).password);
  redactions.add(password); redactions.add(encodeURIComponent(password));
  if (readFileSync(p.secretFile, "utf8") !== password) throw new DatabaseOperationError("Local database credential files disagree; no password reset performed", 2);
  // Explicit/root overrides may not silently change credentials for an existing managed instance.
  const effective = readDatabaseEnvironment(p.mode);
  environment.resolveDatabaseEnvironment(p.mode, effective);
  if (effective[target.variable] !== values[target.variable]) throw new DatabaseOperationError("Explicit/root database URL differs from owned credentials; left untouched", 2);
  return { state, values };
}
export function portOwners(port) {
  let pids = [];
  try { pids = execFileSync("lsof", ["-nP", "-t", "-iTCP:" + port, "-sTCP:LISTEN"], { encoding: "utf8" }).trim().split("\n").filter(Boolean); } catch { /* lsof exit1 means no visible listener. */ }
  return [...new Set(pids)].map((pid) => {
    try {
      const text = command("ps", ["-p", pid, "-o", "pid=,ppid=,comm="]);
      const match = text.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/);
      const escapedCwd = command("lsof", ["-a", "-p", pid, "-d", "cwd", "-Fn"]).split("\n").find((line) => line.startsWith("n"))?.slice(1);
      const cwd = escapedCwd?.replace(/(?:\\x[0-9a-f]{2})+/gi, (bytes) =>
        Buffer.from([...bytes.matchAll(/\\x([0-9a-f]{2})/gi)].map((match) => Number.parseInt(match[1], 16))).toString("utf8"));
      return { pid: Number(pid), ppid: Number(match?.[2]), command: match?.[3], cwd };
    } catch { return { pid: Number(pid), status: "process exited during inspection" }; }
  });
}
async function available(p) {
  try { await assertPortAvailable(p.port); }
  catch { throw new DatabaseOperationError("Database port " + p.port + " is occupied/unavailable; existing listener left untouched", 4, { port: p.port, owners: portOwners(p.port), evidenceFile }); }
}
function compose(p, state, args) {
  const password = readFileSync(p.secretFile, "utf8");
  redactions.add(password); redactions.add(encodeURIComponent(password));
  return docker(["compose", "--project-name", p.project, "--project-directory", repositoryRoot, "-f", p.composeFile, ...args], { AIJ_DB_INSTANCE_ID: state.instanceId, AIJ_DB_PASSWORD: password });
}
function validateCompose(p, state) {
  const config = JSON.parse(compose(p, state, ["config", "--format", "json"]));
  const service = config.services.postgres;
  if (config.name !== p.project || Object.keys(config.services).length !== 1 || service.image !== image ||
      service.ports?.length !== 1 || service.ports[0].host_ip !== "127.0.0.1" || Number(service.ports[0].published) !== p.port ||
      service.ports[0].target !== 5432 || service.environment.POSTGRES_DB !== p.database ||
      service.environment.POSTGRES_USER !== p.user || service.environment.POSTGRES_PASSWORD !== readFileSync(p.secretFile, "utf8") ||
      config.volumes.postgres_data.external ||
      config.volumes.postgres_data.name !== p.volume) throw new DatabaseOperationError("Compose configuration does not match the owned database profile", 2);
}
async function ensure(p) {
  assertLocalPath(p.directory);
  if (!existsSync(p.directory)) {
    if (ids(p).length || volumeExists(p) || networkExists(p)) throw new DatabaseOperationError("Existing database resources have no local ownership record; refusing adoption or password reset", 2);
    await available(p);
    ignored(p.environmentFile); ignored(p.secretFile); ignored(p.stateFile);
    const parent = join(repositoryRoot, ".local-data/postgres");
    mkdirSync(parent, { recursive: true, mode: 0o700 });
    const temporary = mkdtempSync(join(parent, ".prepare-" + p.mode + "-"));
    const password = randomBytes(32).toString("hex");
    redactions.add(password);
    const variable = p.mode === "dev" ? "DATABASE_URL" : "TEST_DATABASE_URL";
    const url = "postgresql://" + p.user + ":" + password + "@127.0.0.1:" + p.port + "/" + p.database + "?schema=public";
    writeFileSync(join(temporary, ".env"), "RUNTIME_PROFILE=host\nPROJECT_ID=aij-foundation\n" + variable + "=" + url + "\n", { flag: "wx", mode: 0o600 });
    writeFileSync(join(temporary, "postgres-password"), password, { flag: "wx", mode: 0o600 });
    writeFileSync(join(temporary, "owner.json"), JSON.stringify({ mode: p.mode, project: p.project, instanceId: randomUUID(), repository: repositoryRoot, createdAt: new Date().toISOString() }) + "\n", { flag: "wx", mode: 0o600 });
    renameSync(temporary, p.directory);
  }
  if (![p.stateFile, p.environmentFile, p.secretFile].every(existsSync)) throw new DatabaseOperationError("Partial database credential state; no files overwritten or password reset", 2);
  const { state, values } = credentials(p);
  const container = inspectOwned(p, state);
  if (!container?.State.Running) await available(p);
  validateCompose(p, state);
  return { state, values, container };
}
async function locked(operation) {
  const directory = join(repositoryRoot, ".local-data/postgres");
  assertLocalPath(directory);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, ".operation-lock");
  ignored(path);
  try { writeFileSync(path, JSON.stringify({ pid: process.pid, ppid: process.ppid, cwd: process.cwd(), command: process.argv.slice(0, 3) }), { flag: "wx", mode: 0o600 }); }
  catch { throw new DatabaseOperationError("Another database operation/lock exists; inspect its owner, no automatic removal", 2); }
  try { localDocker(); return await operation(); } finally { unlinkSync(path); }
}
export async function preflight(modes = ["dev", "test"]) {
  if (!Array.isArray(modes) || !modes.length || new Set(modes).size !== modes.length || modes.some((mode) => !["dev", "test"].includes(mode))) throw new DatabaseOperationError("Preflight requires explicit local modes", 2);
  return locked(async () => {
    for (const mode of modes) await ensure(profile(mode));
    return { status: "TARGETS_VALID", modes, evidenceFile };
  });
}
export async function upDatabases(modes) {
  return locked(async () => {
    const checked = [];
    // Check every requested target before starting any container.
    for (const mode of modes) checked.push({ p: profile(mode), ...await ensure(profile(mode)) });
    const results = [];
    for (const { p, state, values } of checked) {
      compose(p, state, ["up", "--detach", "--wait", "--wait-timeout", "40", "--no-recreate", "--pull", "never"]);
      const container = inspectOwned(p, state);
      if (!container?.State.Running) throw new DatabaseOperationError("Database container did not start", 3);
      results.push({ ...await checkDatabase(p.mode, values), containerId: container.Id, project: p.project, volume: p.volume, instanceId: state.instanceId });
    }
    return { status: "RUNNING", databases: results, evidenceFile };
  });
}
function stopEvidence(p, container) {
  const pid = container.State.Pid;
  if (!Number.isInteger(pid) || pid < 1) throw new DatabaseOperationError("Cannot establish owned container PID", 2);
  const processes = docker(["top", container.Id, "-eo", "pid,ppid,args"]);
  const cwd = docker(["exec", "--user", "postgres", container.Id, "readlink", "/proc/1/cwd"]);
  const argv = docker(["exec", "--user", "postgres", container.Id, "cat", "/proc/1/cmdline"]).replaceAll("\0", " ").trim();
  if (!/\bpostgres\b/.test(argv) || cwd !== "/var/lib/postgresql/data") throw new DatabaseOperationError("Container PID/CWD/command is not the owned PostgreSQL process", 2);
  const result = { mode: p.mode, containerId: container.Id, pid, processes, cwd, command: argv };
  record({ assertion: "PID/PPID/CWD/command and ownership checked before lifecycle operation", ...result });
  return result;
}
export async function lifecycle(action, modes) {
  if (!["stop", "restart"].includes(action)) throw new DatabaseOperationError("Unsupported database lifecycle action", 2);
  return locked(async () => {
    const results = [];
    for (const mode of modes) {
      const p = profile(mode); const { state, values } = credentials(p);
      const container = inspectOwned(p, state);
      if (!container) throw new DatabaseOperationError("Owned container is missing; no lifecycle operation performed", 2);
      if (!container.State.Running) {
        if (action === "restart") throw new DatabaseOperationError("Use db:up to start a stopped owned instance", 2);
        results.push({ mode, status: "ALREADY_STOPPED" }); continue;
      }
      const before = stopEvidence(p, container);
      inspectOwned(p, state); // Recheck immediately before operating on the exact ID.
      docker([action, "--time", "20", container.Id]);
      if (action === "restart") {
        let connected;
        for (let attempt = 0; attempt < 30; attempt++) {
          try { connected = await checkDatabase(mode, values); break; }
          catch { await new Promise((accept) => setTimeout(accept, 250)); }
        }
        if (!connected) throw new DatabaseOperationError("Restarted database did not become ready", 3);
        results.push({ ...connected, before, volume: p.volume });
      } else results.push({ mode, status: "STOPPED", before, volumeRetained: p.volume });
    }
    return { status: action === "stop" ? "STOPPED" : "RESTARTED", databases: results, evidenceFile };
  });
}
export async function cleanup(modes) {
  return locked(async () => {
    const results = [];
    // Cleanup never stops processes implicitly and never removes data/credentials.
    for (const mode of modes) {
      const p = profile(mode); const { state } = credentials(p);
      const container = inspectOwned(p, state);
      if (container?.State.Running) throw new DatabaseOperationError("Stop the owned instance with db:stop before cleanup; left running", 2);
      if (container) docker(["rm", container.Id]);
      if (networkExists(p)) {
        const [network] = JSON.parse(docker(["network", "inspect", p.project + "_default"]));
        if (!labelsMatch(network.Labels, p, state) || Object.keys(network.Containers || {}).length) {
          throw new DatabaseOperationError("Network ownership/endpoints changed; left untouched", 2);
        }
        docker(["network", "rm", p.project + "_default"]);
      }
      results.push({ mode, status: "CONTAINER_AND_NETWORK_REMOVED", retainedVolume: p.volume, retainedCredentials: p.environmentFile });
    }
    return { status: "CLEANED_WITH_DATA_RETAINED", databases: results, evidenceFile };
  });
}
export async function sentinel(mode) {
  return locked(async () => {
    const p = profile(mode); const { state, values } = credentials(p);
    const container = inspectOwned(p, state);
    if (!container?.State.Running) throw new DatabaseOperationError("Owned instance must be running before synthetic data preparation", 2);
    return withDatabase(mode, values, async (client, target, identity) => {
      await client.query("CREATE SCHEMA IF NOT EXISTS af005_verification");
      await client.query("CREATE TABLE IF NOT EXISTS af005_verification.sentinel (id text PRIMARY KEY, mode text NOT NULL, instance_id text NOT NULL, marker uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now())");
      await client.query("INSERT INTO af005_verification.sentinel(id,mode,instance_id,marker) VALUES ('AF-005',$1,$2,$3) ON CONFLICT(id) DO NOTHING", [mode, state.instanceId, randomUUID()]);
      const { rows: [row] } = await client.query("SELECT id,mode,instance_id AS \"instanceId\",marker,created_at AS \"createdAt\" FROM af005_verification.sentinel WHERE id='AF-005'");
      if (row.mode !== mode || row.instanceId !== state.instanceId) throw new DatabaseOperationError("Existing sentinel belongs to another instance; no reset performed", 2);
      return { target, identity, sentinel: row, evidenceFile };
    });
  });
}
export async function prepareManual() {
  await upDatabases(["dev", "test"]);
  const databases = [];
  for (const mode of ["dev", "test"]) {
    const p = profile(mode); const result = await sentinel(mode);
    databases.push({ ...result, url: "postgresql://" + p.user + "@127.0.0.1:" + p.port + "/" + p.database,
      role: "local bootstrap database superuser; not a product administrator",
      environmentFile: p.environmentFile, initialPasswordFile: p.secretFile, project: p.project, volume: p.volume });
  }
  const note = { task: "AF-005", status: "PREPARED", databases,
    stopCommands: ["pnpm run db:stop -- dev", "pnpm run db:stop -- test"],
    cleanupCommands: ["pnpm run db:cleanup -- dev", "pnpm run db:cleanup -- test"],
    cleanup: "Stop only the owned instances. Data/credential removal is not automated; no down -v/reset/drop.",
    verification: "pnpm run verify:task -- AF-005", passwordsPrinted: false };
  const path = join(repositoryRoot, ".artifacts/af-005/manual.json");
  assertLocalPath(path); ignored(path);
  writeFileSync(path, JSON.stringify(note, null, 2) + "\n", { mode: 0o600 });
  return { ...note, manualFile: path, evidenceFile };
}
