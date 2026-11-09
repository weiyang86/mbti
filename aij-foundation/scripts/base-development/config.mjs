import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { dirname, join } from "node:path";
import { parseEnv } from "node:util";
import environment from "../runtime-environment.cjs";

export const root = environment.repositoryRoot;
export const profile = Object.freeze({
  project: "aij-base-dev", environment: "development", webPort: 3855, apiPort: 3856, dbPort: 55434,
  database: "aij_base_dev_development", user: "aij_base_dev_development",
  directory: join(root, ".local-data/base-development"), container: "aij-base-dev-postgres",
  volume: "aij-base-dev_postgres_data", composeFile: join(root, "ops/compose.base-development.yml"),
  image: "postgres:16-alpine@sha256:e013e867e712fec275706a6c51c966f0bb0c93cfa8f51000f85a15f9865a28cb",
  apiOutput: join(root, "apps/api/.base-dev-dist"), webOutput: join(root, "apps/web/.next-base-dev")
});
export const paths = Object.freeze(Object.fromEntries([
  ["owner", "owner.json"], ["environment", "runtime.env"], ["password", "postgres-password"],
  ["credentials", "initial-admin.json"], ["processes", "processes.json"], ["build", "build.json"]
].map(([key, value]) => [key, join(profile.directory, value)])));
export function refuse(message) { throw new environment.DatabaseOperationError(message, 2); }
export function assertLocalStat(stat, restricted) {
  if (stat && stat.uid !== process.getuid()) refuse("Local Base path belongs to another OS user; left untouched");
  if (restricted && stat && (stat.mode & 0o077)) refuse("Local Base state must have private permissions (directory 0700/files 0600)");
}
export function assertPath(path, { restricted = false } = {}) {
  environment.assertLocalPath(path);
  const stat = lstatSync(path, { throwIfNoEntry: false });
  assertLocalStat(stat, restricted);
  return stat;
}
export function assertRepository() {
  if (realpathSync(root) !== root || realpathSync(process.cwd()) !== root) refuse("Run Base development commands from the canonical repository root");
  for (const path of [profile.directory, profile.apiOutput, profile.webOutput, profile.composeFile]) assertPath(path);
}
export function writePrivate(path, value, { exclusive = false } = {}) {
  assertPath(path, { restricted: true });
  assertPath(dirname(path), { restricted: true });
  const body = typeof value === "string" ? value : JSON.stringify(value, null, 2) + "\n";
  if (exclusive) writeFileSync(path, body, { flag: "wx", mode: 0o600 });
  else {
    const temporary = path + "." + randomUUID() + ".tmp";
    writeFileSync(temporary, body, { flag: "wx", mode: 0o600 });
    renameSync(temporary, path);
  }
}
export function validateOwner(owner) {
  if (owner?.version !== 1 || owner.repository !== root || owner.machine !== hostname() || owner.uid !== process.getuid() ||
      owner.project !== profile.project || owner.environment !== profile.environment || typeof owner.initialized !== "boolean" ||
      !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(owner.instanceId || "") ||
      !/^[a-zA-Z0-9_.-]+$/.test(owner.dockerContext || "") || !owner.dockerEndpoint?.startsWith("unix://")) {
    refuse("Base local owner record does not match this repository/machine/project; no adoption");
  }
  return owner;
}
export function publicEnvironment() {
  return {
    RUNTIME_PROFILE: "project", AIJ_PROJECT_ROOT: root, PROJECT_ID: profile.project, APP_ENV: "development",
    WEB_PORT: "3855", API_PORT: "3856", WEB_URL: "http://127.0.0.1:3855", NEXT_PUBLIC_API_URL: "http://127.0.0.1:3856/api",
    JWT_ISSUER: "urn:aij:aij-base-dev:development:api", COOKIE_PREFIX: "aij_base_dev_development",
    LOCAL_STORAGE_ROOT: ".local-data/base-development/aij-base-dev/development/storage", TRUST_PROXY_HOPS: "0",
    AUTH_ENABLED: "false", CLIENT_AUTH_ENABLED: "false", DATABASE_ENABLED: "false", STORAGE_ENABLED: "false",
    ASYNC_RUNTIME_ENABLED: "false", ENABLED_PLUGINS: "", AIJ_NEXT_DIST_DIR: ".next-base-dev", NEXT_TELEMETRY_DISABLED: "1"
  };
}
export function validateValues(values) {
  const fixed = { ...publicEnvironment(), AUTH_ENABLED: "true", DATABASE_ENABLED: "true", NODE_ENV: "development" };
  const keys = [...Object.keys(fixed), "JWT_SECRET", "DATABASE_URL"];
  if (Object.keys(values).length !== keys.length || keys.some(key => !(key in values)) ||
      Object.entries(fixed).some(([key, value]) => values[key] !== value)) refuse("Base runtime configuration changed identity/capabilities/ports; refusing override");
  const runtime = environment.resolveRuntimeEnvironment(values);
  const target = runtime.databaseTarget;
  if (target.host !== "127.0.0.1" || target.port !== profile.dbPort || target.database !== profile.database || target.user !== profile.user) refuse("Base database target must be the exact independent development database");
  return runtime;
}
export function readLocalState() {
  assertPath(profile.directory, { restricted: true });
  for (const path of [paths.owner, paths.environment, paths.password]) {
    const stat = assertPath(path, { restricted: true });
    if (!stat?.isFile()) refuse("Partial Base state; no files overwritten or credentials recovered");
  }
  const owner = validateOwner(JSON.parse(readFileSync(paths.owner, "utf8")));
  const values = parseEnv(readFileSync(paths.environment, "utf8"));
  const runtime = validateValues(values);
  if (decodeURIComponent(new URL(values.DATABASE_URL).password) !== readFileSync(paths.password, "utf8")) refuse("Base credential files disagree; no password reset");
  return { owner, values, runtime };
}
export function createLocalState(docker) {
  if (existsSync(profile.directory)) refuse("Existing Base directory has no complete owner record; no adoption");
  const parent = dirname(profile.directory); assertPath(parent);
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  mkdirSync(profile.directory, { mode: 0o700 });
  const password = randomBytes(32).toString("hex");
  const owner = { version: 1, repository: root, machine: hostname(), uid: process.getuid(), project: profile.project,
    environment: profile.environment, instanceId: randomUUID(), dockerContext: docker.context, dockerEndpoint: docker.endpoint, createdAt: new Date().toISOString(), initialized: false };
  const values = { ...publicEnvironment(), AUTH_ENABLED: "true", DATABASE_ENABLED: "true", NODE_ENV: "development",
    JWT_SECRET: randomBytes(48).toString("hex"), DATABASE_URL: `postgresql://${profile.user}:${password}@127.0.0.1:${profile.dbPort}/${profile.database}?schema=public` };
  validateValues(values);
  writePrivate(paths.password, password, { exclusive: true });
  writePrivate(paths.environment, Object.entries(values).map(([key, value]) => key + "=" + value).join("\n") + "\n", { exclusive: true });
  writePrivate(paths.owner, owner, { exclusive: true });
  return readLocalState();
}
export function systemEnvironment() {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(PATH|HOME|TMPDIR|TMP|TEMP|LANG|LC_ALL|TZ)$/i.test(key)));
}
export function redact(value, values = {}) {
  let result = String(value);
  for (const secret of [values.JWT_SECRET, values.DATABASE_URL, values.DATABASE_URL && new URL(values.DATABASE_URL).password].filter(Boolean)) result = result.split(secret).join("[REDACTED]");
  return result.replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+:[^\s/@]+@/gi, "$1[REDACTED]@");
}
