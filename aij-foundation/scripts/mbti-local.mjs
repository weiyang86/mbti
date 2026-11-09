// Project-only provisioning. Never delegates to the upstream host db:* tools.
import { spawnSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync, realpathSync, lstatSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { createRequire } from "node:module";
import pg from "pg";
import runtimeEnvironment from "./runtime-environment.cjs";

const sourceRoot = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), ".."));
const root = realpathSync(process.env.MBTI_LOCAL_OWNER_ROOT || sourceRoot);
if (root !== sourceRoot) {
  const commonDirectory = directory => {
    const result = spawnSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: directory, encoding: "utf8" });
    if (result.status !== 0) throw new Error("Cannot verify project worktree ownership");
    return realpathSync(result.stdout.trim());
  };
  if (commonDirectory(root) !== commonDirectory(sourceRoot) || JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")).name !== "mbti-foundation") throw new Error("Local owner must be another worktree of this same MBTI repository");
}
const [action, mode = "dev"] = process.argv.slice(2);
if (!["init", "check", "migrate", "seed", "start", "stop", "status"].includes(action) || !["dev", "test"].includes(mode) || process.argv.length > 4) throw new Error("Usage: node scripts/mbti-local.mjs <init|check|migrate|seed|start|stop|status> <dev|test>");
const appEnv = mode === "dev" ? "development" : "test";
const scope = `mbti_foundation_${appEnv}`;
const name = `mbti-foundation-${appEnv}-postgres`;
const port = mode === "dev" ? 55436 : 55437;
const directory = resolve(root, ".local-data/mbti-foundation", appEnv);
for (const path of [resolve(root, ".local-data"), resolve(root, ".local-data/mbti-foundation"), directory]) {
  if (lstatSync(path, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error("Project local data cannot traverse symlinks");
}
mkdirSync(directory, { recursive: true, mode: 0o700 });
const file = resolve(directory, ".env");
const require = createRequire(resolve(sourceRoot, "apps/api/package.json"));
function docker(args, allowMissing = false) {
  const result = spawnSync("docker", args, { encoding: "utf8", timeout: 60000 });
  if (result.status && !allowMissing) throw new Error("Project Docker operation failed");
  return result;
}
function configuration() {
  if (!existsSync(file)) throw new Error("Run project init first");
  const env = parseEnv(readFileSync(file, "utf8"));
  if (env.AIJ_PROJECT_ROOT !== root || env.PROJECT_ID !== "mbti-foundation" || env.RUNTIME_PROFILE !== "project" || env.APP_ENV !== appEnv) throw new Error("Local configuration ownership mismatch");
  const runtime = runtimeEnvironment.resolveRuntimeEnvironment(env);
  if (runtime.databaseTarget?.database !== scope || runtime.databaseTarget.user !== scope || runtime.databaseTarget.port !== port) throw new Error("Unexpected project database target");
  return env;
}
function ownedContainer() {
  const result = docker(["inspect", name], true);
  if (result.status) return null;
  const record = JSON.parse(result.stdout)[0];
  if (record.Config.Labels?.["mbti.project"] !== "mbti-foundation" || record.Config.Labels?.["mbti.environment"] !== appEnv || record.Config.Labels?.["mbti.root"] !== root ||
      record.HostConfig.PortBindings?.["5432/tcp"]?.[0]?.HostPort !== String(port) || record.HostConfig.PortBindings?.["5432/tcp"]?.[0]?.HostIp !== "127.0.0.1") throw new Error("Existing container does not belong to this project/tree/environment");
  if (!record.Mounts?.some(m => m.Type === "volume" && m.Name === `${name}-data` && m.Destination === "/var/lib/postgresql/data")) throw new Error("Unexpected project database volume");
  return record;
}
async function connect(env) {
  if (!ownedContainer()?.State.Running) throw new Error("Owned project PostgreSQL is not running");
  const client = new pg.Client({ connectionString: env[mode === "dev" ? "DATABASE_URL" : "TEST_DATABASE_URL"], application_name: `mbti-local-${mode}`, connectionTimeoutMillis: 3000 });
  await client.connect();
  try {
    const identity = (await client.query('SELECT current_database() AS db, current_user AS role, session_user AS session, inet_server_port() AS port')).rows[0];
    if (identity.db !== scope || identity.role !== scope || identity.session !== scope || identity.port !== 5432) throw new Error("Live database identity mismatch");
    return client;
  } catch (error) { await client.end(); throw error; }
}
async function verifyMarker(client) {
  const row = (await client.query('SELECT project, environment, root FROM mbti_local_control."_mbti_project_identity" WHERE singleton = true')).rows[0];
  if (row?.project !== "mbti-foundation" || row.environment !== appEnv || row.root !== root) throw new Error("Database ownership marker mismatch");
}
async function main() {
  if (action === "init") {
    if (!existsSync(file)) {
      if (ownedContainer()) throw new Error("Container exists without its local credentials; refuse to replace");
      const password = randomBytes(36).toString("hex");
      const base = parseEnv(readFileSync(resolve(root, ".env.example"), "utf8"));
      const env = { ...base, NODE_ENV: mode === "test" ? "test" : "development", APP_ENV: appEnv, AIJ_PROJECT_ROOT: root,
        PROJECT_ID: "mbti-foundation", RUNTIME_PROFILE: "project", DATABASE_ENABLED: "true", AUTH_ENABLED: "false", CLIENT_AUTH_ENABLED: "false",
        WEB_PORT: mode === "dev" ? "5173" : "4155", API_PORT: mode === "dev" ? "4056" : "4156",
        WEB_URL: mode === "dev" ? "http://127.0.0.1:5173" : "http://127.0.0.1:4155",
        NEXT_PUBLIC_API_URL: mode === "dev" ? "http://127.0.0.1:4056/api" : "http://127.0.0.1:4156/api",
        JWT_ISSUER: `urn:aij:mbti-foundation:${appEnv}:api`, COOKIE_PREFIX: scope,
        LOCAL_STORAGE_ROOT: `.local-data/mbti-foundation/${appEnv}/storage`,
        MBTI_H5_ORIGINS: mode === "dev" ? '["http://127.0.0.1:5173","http://192.168.0.200:5173"]' : '["http://127.0.0.1:4155"]' };
      delete env.DATABASE_URL; delete env.TEST_DATABASE_URL; delete env.POSTGRES_PASSWORD; delete env.TEST_POSTGRES_PASSWORD;
      env[mode === "dev" ? "DATABASE_URL" : "TEST_DATABASE_URL"] = `postgresql://${scope}:${password}@127.0.0.1:${port}/${scope}?schema=public`;
      writeFileSync(file, Object.entries(env).map(([k, v]) => `${k}=${v}`).join("\n") + "\n", { mode: 0o600 });
      writeFileSync(resolve(directory, "postgres.env"), `POSTGRES_USER=${scope}\nPOSTGRES_DB=${scope}\nPOSTGRES_PASSWORD=${password}\n`, { mode: 0o600 });
    }
    const env = configuration();
    const existing = ownedContainer();
    if (!existing) {
      const volume = docker(["volume", "inspect", `${name}-data`], true);
      if (volume.status === 0) throw new Error("Unattached database volume already exists; refuse to adopt unknown persisted data");
      docker(["volume", "create", "--label", "mbti.project=mbti-foundation", "--label", `mbti.root=${root}`, "--label", `mbti.environment=${appEnv}`, `${name}-data`]);
      docker(["run", "--detach", "--name", name, "--restart", "unless-stopped", "--label", "mbti.project=mbti-foundation", "--label", `mbti.environment=${appEnv}`, "--label", `mbti.root=${root}`,
      "--publish", `127.0.0.1:${port}:5432`, "--env-file", resolve(directory, "postgres.env"), "--mount", `type=volume,source=${name}-data,target=/var/lib/postgresql/data`, "postgres:16-alpine"]);
    } else if (!existing.State.Running) docker(["start", name]);
    let client;
    for (let i = 0; i < 30; i++) {
      try { client = await connect(env); break; } catch { await new Promise(done => setTimeout(done, 500)); }
    }
    if (!client) throw new Error("Project PostgreSQL did not become ready");
    try {
      await client.query('CREATE SCHEMA IF NOT EXISTS mbti_local_control');
      await client.query('CREATE TABLE IF NOT EXISTS mbti_local_control."_mbti_project_identity" (singleton BOOLEAN PRIMARY KEY CHECK(singleton), project TEXT NOT NULL, environment TEXT NOT NULL, root TEXT NOT NULL)');
      await client.query('INSERT INTO mbti_local_control."_mbti_project_identity" VALUES (true,$1,$2,$3) ON CONFLICT DO NOTHING', ["mbti-foundation", appEnv, root]);
      await verifyMarker(client);
    } finally { await client.end(); }
    console.log(`Owned ${appEnv} PostgreSQL ready: 127.0.0.1:${port}/${scope}; credentials remain in ignored local files`);
    return;
  }
  const env = configuration();
  const client = await connect(env);
  try { await verifyMarker(client); } finally { await client.end(); }
  if (action === "check") { console.log(`PASS projectId=mbti-foundation environment=${appEnv} database=${scope} user=${scope} port=${port} owner=verified`); return; }
  if (action === "migrate") {
    const result = spawnSync(process.execPath, [require.resolve("prisma/build/index.js"), "migrate", "deploy", "--config", resolve(sourceRoot, "apps/api/prisma.config.mjs")], {
      cwd: resolve(sourceRoot, "apps/api"), env: { ...process.env, ...env, DATABASE_URL: env[mode === "dev" ? "DATABASE_URL" : "TEST_DATABASE_URL"] }, stdio: "inherit", timeout: 120000
    });
    if (result.status !== 0) throw new Error("Project migration failed");
    return;
  }
  if (action === "seed") {
    const db = await connect(env);
    try {
      await db.query("BEGIN");
      for (const filename of ["quiz-teach-1.json", "quiz-prototype-1.json"]) {
        const payload = JSON.parse(readFileSync(resolve(sourceRoot, "scripts/mbti", filename), "utf8"));
        const scoring = Object.fromEntries(payload.questions.map(q => [q.id, Object.fromEntries(q.options.map((o, i) => [o.id, q.dimension[i]]))]));
        await db.query('INSERT INTO "MbtiQuestionBank" ("version","payload","scoring") VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [payload.question_bank_version, JSON.stringify(payload), JSON.stringify(scoring)]);
        const record = (await db.query('SELECT payload,scoring FROM "MbtiQuestionBank" WHERE version=$1', [payload.question_bank_version])).rows[0];
        // PostgreSQL JSONB key order differs; compare structurally via JSONB equality.
        const match = (await db.query('SELECT payload=$2::jsonb AND scoring=$3::jsonb AS same FROM "MbtiQuestionBank" WHERE version=$1', [payload.question_bank_version, JSON.stringify(payload), JSON.stringify(scoring)])).rows[0];
        if (!record || !match.same) throw new Error("Frozen bank differs; publish a new version instead");
      }
      await db.query("COMMIT");
    } catch (error) { await db.query("ROLLBACK"); throw error; } finally { await db.end(); }
    console.log(`PASS ${appEnv} repeat-safe seed: preserved qb-v0.4-teach-1; current qb-v0.4-prototype-1`);
    return;
  }
  const pidFile = resolve(directory, "api.json");
  const record = existsSync(pidFile) ? JSON.parse(readFileSync(pidFile, "utf8")) : null;
  const alive = record && (() => { try { process.kill(record.pid, 0); return true; } catch { return false; } })();
  if (action === "status") { console.log(JSON.stringify({ running: !!alive, port: Number(env.API_PORT), environment: appEnv })); return; }
  if (action === "stop") {
    if (alive) {
      const ps = spawnSync("ps", ["-p", String(record.pid), "-o", "command="], { encoding: "utf8" });
      if (!ps.stdout.includes(record.entry || resolve(root, "apps/api/dist/main.js"))) throw new Error("PID was reused; refusing to signal another process");
      process.kill(record.pid, "SIGTERM");
    }
    console.log("Owned API stop requested"); return;
  }
  if (alive) throw new Error("Owned API already running");
  const { assertPortAvailable } = await import("./port-availability.mjs");
  await assertPortAvailable(Number(env.API_PORT));
  const { openSync, closeSync } = await import("node:fs");
  const log = openSync(resolve(directory, "api.log"), "a", 0o600);
  const entry = resolve(sourceRoot, "apps/api/dist/main.js");
  // Explicit non-secret deployment overrides; owner credentials/configuration stay untouched.
  const publicOrigin = process.env.MBTI_PUBLIC_ORIGIN || new URL(env.NEXT_PUBLIC_API_URL).origin;
  const publicUrl = new URL(publicOrigin);
  if (publicUrl.origin !== publicOrigin || !["http:", "https:"].includes(publicUrl.protocol) || publicUrl.username || publicUrl.password) throw new Error("MBTI_PUBLIC_ORIGIN must be an exact HTTP origin");
  const child = spawn(process.execPath, [entry], { cwd: resolve(sourceRoot, "apps/api"), env: { ...process.env, ...env,
    MBTI_PUBLIC_ORIGIN: publicOrigin, MBTI_H5_ORIGINS: process.env.MBTI_H5_ORIGINS || env.MBTI_H5_ORIGINS
  }, detached: true, stdio: ["ignore", log, log] });
  writeFileSync(pidFile, JSON.stringify({ pid: child.pid, root, entry }), { mode: 0o600 });
  child.unref(); closeSync(log);
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const ready = await fetch(`${env.NEXT_PUBLIC_API_URL}/ready`, { signal: AbortSignal.timeout(300) });
      if (ready.status === 200 && (await ready.json()).data?.reason === "READY") {
        console.log(`Owned API READY on 0.0.0.0:${env.API_PORT}; local logs remain ignored`);
        return;
      }
    } catch { /* The just-launched process may still be binding its listener. */ }
    await new Promise(done => setTimeout(done, 100));
  }
  throw new Error("Owned API did not become ready; inspect its ignored local log");
}
main().catch(() => { console.error(`MBTI ${action} ${mode} failed; inspect project configuration and local database state (credentials suppressed)`); process.exitCode = 1; });
