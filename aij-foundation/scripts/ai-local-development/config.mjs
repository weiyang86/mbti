// AF-220: dedicated orchestration of existing applications, never a second seed/service owner.
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import { hostname } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { parseEnv } from "node:util";
import environment from "../runtime-environment.cjs";
// Reuse Base's canonical, no-symlink/private-file primitives without changing its profile.
export { assertLocalStat, assertPath, writePrivate, systemEnvironment } from "../base-development/config.mjs";
import { assertPath, writePrivate } from "../base-development/config.mjs";

export const root = environment.repositoryRoot;
export const profile = Object.freeze({
  project: "aij-ai-local", environment: "development", webPort: 3955, apiPort: 3956, dbPort: 55435,
  database: "aij_ai_local_development", user: "aij_ai_local_development",
  directory: join(root, ".local-data/ai-local-development"), container: "aij-ai-local-postgres",
  volume: "aij-ai-local_postgres_data", composeFile: join(root, "ops/compose.ai-local-development.yml"),
  image: "postgres:16-alpine@sha256:e013e867e712fec275706a6c51c966f0bb0c93cfa8f51000f85a15f9865a28cb",
  apiOutput: join(root, "apps/api/.ai-local-dist"), webOutput: join(root, "apps/web/.next-ai-local"),
  storage: join(root, ".local-data/ai-local-development/aij-ai-local/development/storage")
});
export const paths = Object.freeze(Object.fromEntries([
  ["owner", "owner.json"], ["environment", "runtime.env"], ["password", "postgres-password"],
  ["credentials", "initial-admin.json"], ["processes", "processes.json"], ["build", "build.json"]
].map(([key, value]) => [key, join(profile.directory, value)])));
export const secretKeys = Object.freeze(["JWT_SECRET", "CLIENT_JWT_SECRET", "CLIENT_AUTH_RATE_LIMIT_SECRET", "CLIENT_AUTH_TOKEN_SECRET"]);
export function refuse(message) { throw new environment.DatabaseOperationError(message, 2); }
export function assertRepository() {
  if (realpathSync(root) !== root || realpathSync(process.cwd()) !== root) refuse("Run AI local commands from the canonical repository root");
  for (const path of [profile.directory, profile.storage, profile.apiOutput, profile.webOutput, profile.composeFile]) assertPath(path);
}
export function assertDockerEndpoint(endpoint) {
  if (typeof endpoint !== "string" || !endpoint.startsWith("unix://")) refuse("AI local requires a canonical local Unix Docker endpoint");
  const path = endpoint.slice(7);
  if (!isAbsolute(path) || resolve(path) !== path || /[\\\s?#\0]/.test(path)) refuse("AI local requires a canonical local Unix Docker endpoint");
  let cursor = "/";
  for (const part of path.slice(1).split("/")) {
    cursor = join(cursor, part);
    if (lstatSync(cursor, { throwIfNoEntry: false })?.isSymbolicLink()) refuse("Docker endpoint cannot traverse symlinks");
  }
  return endpoint;
}
export function validateOwner(owner) {
  if (owner?.version !== 1 || owner.repository !== root || owner.machine !== hostname() || owner.uid !== process.getuid() ||
      owner.project !== profile.project || owner.environment !== profile.environment || typeof owner.initialized !== "boolean" ||
      !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(owner.instanceId || "") ||
      !/^[a-zA-Z0-9_.-]+$/.test(owner.dockerContext || "") || !Number.isFinite(Date.parse(owner.createdAt))) {
    refuse("AI local owner does not match repository/machine/user/project/instance; no adoption");
  }
  assertDockerEndpoint(owner.dockerEndpoint);
  return owner;
}
// Web receives only this public allowlist plus minimal OS variables; never the private values.
export function publicEnvironment() {
  return {
    AIJ_RUNTIME_ENV_SOURCE: "explicit", RUNTIME_PROFILE: "project", AIJ_PROJECT_ROOT: root, PROJECT_ID: profile.project, APP_ENV: "development",
    WEB_PORT: "3955", API_PORT: "3956", WEB_URL: "http://127.0.0.1:3955", NEXT_PUBLIC_API_URL: "http://127.0.0.1:3956/api",
    JWT_ISSUER: "urn:aij:aij-ai-local:development:api", COOKIE_PREFIX: "aij_ai_local_development",
    LOCAL_STORAGE_ROOT: ".local-data/ai-local-development/aij-ai-local/development/storage", TRUST_PROXY_HOPS: "0",
    AUTH_ENABLED: "false", CLIENT_AUTH_ENABLED: "false", DATABASE_ENABLED: "false", STORAGE_ENABLED: "false",
    ASYNC_RUNTIME_ENABLED: "false", ENABLED_PLUGINS: "", AIJ_NEXT_DIST_DIR: ".next-ai-local", NEXT_TELEMETRY_DISABLED: "1",
    AI_DEEPSEEK_LIVE_ENABLED: "false", AI_CENTER_LIVE_ENABLED: "false", AI_CENTER_CLIENT_EXECUTION_ENABLED: "false",
    AIJ_DOCUMENT_EXPORT_ENABLED: "false"
  };
}
export function fixedValues() {
  return { ...publicEnvironment(), AUTH_ENABLED: "true", CLIENT_AUTH_ENABLED: "true", DATABASE_ENABLED: "true",
    STORAGE_ENABLED: "true", ASYNC_RUNTIME_ENABLED: "true", ENABLED_PLUGINS: "aij-ai", NODE_ENV: "development" };
}
export function validateValues(values) {
  const fixed = fixedValues(), keys = [...Object.keys(fixed), ...secretKeys, "DATABASE_URL"];
  if (!values || Object.keys(values).length !== keys.length || keys.some(key => !Object.hasOwn(values, key)) ||
      Object.entries(fixed).some(([key, value]) => values[key] !== value)) refuse("AI local configuration changed fixed identity/capabilities/ports or contains unknown variables");
  let runtime;
  try {
    runtime = environment.resolveRuntimeEnvironment(values);
    environment.assertProjectIsolation([runtime]);
  } catch { refuse("AI local project runtime/secret validation failed"); }
  const target = runtime.databaseTarget;
  if (target.host !== "127.0.0.1" || target.port !== profile.dbPort || target.database !== profile.database || target.user !== profile.user ||
      runtime.storageRoot !== profile.storage) refuse("AI local database/storage must match the exact independent development target");
  return runtime;
}
// Root adds the approved explicit-source branch, returning the exact provided object.
// Refuse an older reader before init/build/start mutations; the old Base reader is unchanged.
export function assertExplicitEnvironmentSupport(values = publicEnvironment()) {
  const probe = Object.freeze({ ...values });
  const result = environment.readRepositoryEnvironment(probe);
  if (result !== probe) refuse("Root explicit environment reader wiring is required before AI local init/build/start");
}
export function readLocalState() {
  if (!assertPath(profile.directory, { restricted: true })?.isDirectory()) refuse("AI local private directory is missing");
  for (const path of [paths.owner, paths.environment, paths.password]) {
    if (!assertPath(path, { restricted: true })?.isFile()) refuse("Partial AI local state; no files overwritten or credentials recovered");
  }
  const owner = validateOwner(JSON.parse(readFileSync(paths.owner, "utf8")));
  const values = parseEnv(readFileSync(paths.environment, "utf8"));
  const runtime = validateValues(values);
  if (decodeURIComponent(new URL(values.DATABASE_URL).password) !== readFileSync(paths.password, "utf8")) refuse("AI local credential files disagree; no password reset");
  return { owner, values, runtime };
}
export function createLocalState(docker) {
  assertRepository();
  if (existsSync(profile.directory)) refuse("Existing AI local directory has no complete owner record; no adoption");
  assertDockerEndpoint(docker.endpoint);
  const parent = dirname(profile.directory); assertPath(parent);
  const password = randomBytes(32).toString("hex");
  const owner = validateOwner({ version: 1, repository: root, machine: hostname(), uid: process.getuid(), project: profile.project,
    environment: profile.environment, instanceId: randomUUID(), dockerContext: docker.context, dockerEndpoint: docker.endpoint,
    createdAt: new Date().toISOString(), initialized: false });
  const values = { ...fixedValues(), ...Object.fromEntries(secretKeys.map(key => [key, randomBytes(48).toString("hex")])),
    DATABASE_URL: `postgresql://${profile.user}:${password}@127.0.0.1:${profile.dbPort}/${profile.database}?schema=public` };
  validateValues(values);
  mkdirSync(parent, { recursive: true, mode: 0o700 }); mkdirSync(profile.directory, { mode: 0o700 });
  // Enforce the real filesystem boundary; never chmod existing user data to bypass it.
  assertPath(profile.directory, { restricted: true });
  writePrivate(paths.password, password, { exclusive: true });
  writePrivate(paths.environment, Object.entries(values).map(([key, value]) => key + "=" + value).join("\n") + "\n", { exclusive: true });
  writePrivate(paths.owner, owner, { exclusive: true });
  return readLocalState();
}
export function redact(value, values = {}) {
  let result = String(value);
  const secrets = secretKeys.map(key => values[key]);
  if (values.DATABASE_URL) {
    secrets.push(values.DATABASE_URL);
    try { const url = new URL(values.DATABASE_URL); secrets.push(url.password, decodeURIComponent(url.password)); } catch { /* no raw parser cause */ }
  }
  for (const secret of secrets.filter(Boolean).sort((a, b) => b.length - a.length)) result = result.split(secret).join("[REDACTED]");
  return result.replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+:[^\s/@]+@/gi, "$1[REDACTED]@");
}
