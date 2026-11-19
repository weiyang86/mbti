const { existsSync, readFileSync, lstatSync, realpathSync } = require("node:fs");
const { resolve, relative, dirname, isAbsolute, sep, join } = require("node:path");
const { createHash } = require("node:crypto");
const { parseEnv } = require("node:util");

const repositoryRoot = resolve(__dirname, "..");
// Private comparison data: resolved configurations never expose credentials or hashes.
const isolationData = new WeakMap();
const appEnvironments = ["development", "test", "production"];

function fixedPort(environment, key, expected) {
  const value = environment[key] ?? String(expected);
  if (!/^\d+$/.test(value) || Number(value) !== expected) {
    throw new Error(`${key} must be ${expected} for the AIJ workspace`);
  }
  return expected;
}

function loopbackUrl(value, key, port, pathname) {
  let url;
  try { url = new URL(value); } catch { throw new Error(`${key} must be a valid AIJ loopback URL`); }
  if (url.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(url.hostname)
    || url.port !== String(port) || url.pathname !== pathname || url.username || url.password || url.search || url.hash) {
    throw new Error(`${key} must use http://localhost:${port}${pathname === "/" ? "" : pathname} (127.0.0.1 is also allowed)`);
  }
  return url.toString().replace(/\/$/, "");
}

function projectPort(value, key) {
  if (!/^[1-9]\d{3,4}$/.test(String(value)) || Number(value) < 1024 || Number(value) > 65535 ||
      [3101, 3555, 3556, 3655, 3656, 15435, 55432, 55433].includes(Number(value))) {
    throw new Error(key + " must be an explicit unreserved port from 1024 to 65535");
  }
  return Number(value);
}

function scopedStorageRoot(value, root, projectId, appEnv) {
  if (typeof value !== "string" || !value || value.includes("\0") || value.includes("\\")) throw new Error("LOCAL_STORAGE_ROOT is required");
  const path = resolve(root, value);
  const rel = relative(root, path);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw new Error("LOCAL_STORAGE_ROOT must stay inside this project root");
  const parts = rel.split(sep);
  if (!parts.some((part, index) => part === projectId && parts[index + 1] === appEnv && index + 2 < parts.length)) {
    throw new Error("LOCAL_STORAGE_ROOT must include projectId/environment and a storage directory");
  }
  let cursor = path;
  while (cursor !== root) {
    if (lstatSync(cursor, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error("LOCAL_STORAGE_ROOT cannot traverse symlinks");
    cursor = dirname(cursor);
  }
  return path;
}

function secretFingerprint(value, key) {
  if (typeof value !== "string" || value.length < 32 || value.length > 4096 || new Set(value).size < 10 ||
      /replace|change.?me|template|example|default|password|secret|local.only|test.only|qingqi/i.test(value)) {
    throw new Error(key + " requires an independent non-template secret of at least 32 characters");
  }
  return createHash("sha256").update(value).digest("hex");
}

// This error carries only fixed policy text, never URL/parser causes or credentials.
class DatabaseTargetError extends Error {}

function unsafeDatabaseText(value) {
  return /\s/.test(value) || Array.from(value).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
}

function databaseTarget(value, projectId, appEnv, fingerprints, acceptanceId) {
  if (acceptanceId !== undefined) {
    if (projectId !== "aij-foundation" || !["development", "test"].includes(appEnv)) throw new DatabaseTargetError("Acceptance databases are restricted to this local host");
    const mode = appEnv === "test" ? "test" : "dev";
    const variable = mode === "test" ? "TEST_DATABASE_URL" : "DATABASE_URL";
    const target = resolveDatabaseTarget(mode, { [variable]: value }, acceptanceId);
    fingerprints.push(secretFingerprint(decodeURIComponent(new URL(value).password), "Database password"));
    return target;
  }
  if (typeof value !== "string" || !value || unsafeDatabaseText(value) || value.includes("#")) {
    throw new DatabaseTargetError("Database capability requires an explicit project database URL without whitespace or fragments");
  }
  let url;
  try { url = new URL(value); } catch { throw new DatabaseTargetError("Database capability requires an explicit valid project database URL"); }
  // Preserve the already reviewed host dev/test database names; generated projects remain explicitly scoped.
  const databaseEnv = projectId === "aij-foundation" && appEnv === "development" ? "dev" : appEnv;
  const scope = projectId.replaceAll("-", "_") + "_" + databaseEnv;
  const hostPort = projectId === "aij-foundation" ? ({ development: 55432, test: 55433 })[appEnv] : undefined;
  let user, password;
  try { user = decodeURIComponent(url.username); password = decodeURIComponent(url.password); }
  catch { throw new DatabaseTargetError("Invalid database credentials encoding"); }
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !["localhost", "127.0.0.1"].includes(url.hostname) ||
      !/^[1-9]\d{3,4}$/.test(url.port) || Number(url.port) < 1024 || Number(url.port) > 65535 || url.port === "15435" ||
      hostPort !== undefined && Number(url.port) !== hostPort ||
      projectId !== "aij-foundation" && [55432, 55433].includes(Number(url.port)) ||
      url.hash || url.search && url.search !== "?schema=public" ||
      value.endsWith("?") ||
      projectId === "aij-foundation" && (!hostPort || user !== scope || url.pathname !== "/" + scope) ||
      !new RegExp("^" + scope + "(?:_[a-z0-9]+)*$").test(user) ||
      !new RegExp("^/" + scope + "(?:_[a-z0-9]+)*$").test(url.pathname)) {
    throw new DatabaseTargetError("Database target must be loopback and scoped to projectId/environment; host requires exact dev/test port, database and user; old or other-environment targets are forbidden");
  }
  try {
    if (unsafeDatabaseText(password)) throw new Error();
    fingerprints.push(secretFingerprint(password, "Database password"));
  } catch { throw new DatabaseTargetError("Database password requires an independent non-template secret of at least 32 characters without whitespace"); }
  // Keep the validated hostname: do not silently redirect localhost to another host.
  return Object.freeze({ host: url.hostname, port: Number(url.port), database: url.pathname.slice(1), user });
}

// Deliberately independent from application flags, ports and the other URL.
// This is a local host configuration check, not a connector or readiness probe.
function resolveDatabaseEnvironment(mode, environment = process.env) {
  if (!["dev", "test"].includes(mode)) throw new DatabaseTargetError("Database mode must explicitly be dev or test");
  if (environment.NODE_ENV === "test" && mode !== "test") throw new DatabaseTargetError("NODE_ENV=test cannot select the dev database");
  if (environment.RUNTIME_PROFILE !== undefined && environment.RUNTIME_PROFILE !== "host" ||
      environment.PROJECT_ID !== undefined && environment.PROJECT_ID !== "aij-foundation") {
    throw new DatabaseTargetError("db:check dev/test is restricted to the aij-foundation host; generated projects require their own scoped configuration");
  }
  const variable = mode === "test" ? "TEST_DATABASE_URL" : "DATABASE_URL";
  if (typeof environment[variable] !== "string" || !environment[variable]) {
    throw new DatabaseTargetError(variable + " is required; no fallback to another environment is allowed");
  }
  return Object.freeze({
    mode, variable,
    ...databaseTarget(environment[variable], "aij-foundation", mode === "dev" ? "development" : "test", [])
  });
}

class DatabaseOperationError extends Error {
  constructor(message, exitCode = 3, details = {}) {
    super(message);
    this.exitCode = exitCode;
    this.details = details;
  }
}
function profile(mode) {
  if (!["dev", "test"].includes(mode)) throw new DatabaseTargetError("Database mode must explicitly be dev or test");
  const directory = join(repositoryRoot, ".local-data/postgres", mode);
  return Object.freeze({
    mode, project: "aij-foundation-" + mode, port: mode === "dev" ? 55432 : 55433,
    database: "aij_foundation_" + mode, user: "aij_foundation_" + mode,
    directory, environmentFile: join(directory, ".env"), secretFile: join(directory, "postgres-password"),
    stateFile: join(directory, "owner.json"), composeFile: join(repositoryRoot, "ops/compose." + mode + ".yml"),
    volume: "aij-foundation-" + mode + "_postgres_data"
  });
}
function assertLocalPath(path) {
  if (!path.startsWith(repositoryRoot + "/")) throw new DatabaseOperationError("Database files must stay in this repository", 2);
  let cursor = repositoryRoot;
  for (const component of path.slice(repositoryRoot.length + 1).split("/")) {
    if (["", ".", ".."].includes(component)) throw new DatabaseOperationError("Invalid local database file path", 2);
    cursor = join(cursor, component);
    if (lstatSync(cursor, { throwIfNoEntry: false })?.isSymbolicLink()) throw new DatabaseOperationError("Database files cannot traverse symlinks", 2);
  }
}
function acceptanceRecord(mode, id) {
  const p = profile(mode);
  if (typeof id !== "string" || !/^[a-f0-9]{16}$/.test(id)) throw new DatabaseOperationError("Invalid acceptance ID", 2);
  const path = join(repositoryRoot, ".local-data/postgres/acceptance", id + ".json");
  assertLocalPath(path); assertLocalPath(p.stateFile);
  let record, owner;
  try { record = JSON.parse(readFileSync(path, "utf8")); owner = JSON.parse(readFileSync(p.stateFile, "utf8")); }
  catch { throw new DatabaseOperationError("Acceptance ownership record is missing or unreadable", 2); }
  if (!["AF-010", "AF-011", "AF-012", "AF-013", "AF-014", "AF-015", "AF-016", "AF-017", "AF-018", "AF-019", "AF-020", "AF-021", "AF-022", "AF-023", "AF-024", "AF-025-A", "AF-026", "AF-027", "AF-028", "AF-029", "AF-030", "AF-031", "AF-032", "AF-033", "AF-035", "AF-036", "AF-037", "AF-038", "AF-039", "AF-040", "AF-041", "AF-042", "AF-043", "AF-044", "AF-045", "AF-046", "AF-047", "AF-048", "AF-049", "AF-050", "AF-051", "AF-052", "AF-053", "AF-054", "AF-055", "AF-056", "AF-057", "AF-058", "AF-063", "AF-068", "AF-069", "AF-070", "AF-071", "AF-072", "AF-075", "AF-081", "AF-082", "AF-083", "AF-084", "AF-085", "AF-086", "AF-087", "AF-088", "AF-089", "AF-090", "AF-092", "AF-093", "AF-094", "AF-095", "AF-096", "AF-097", "AF-098", "AF-099", "AF-100", "AF-101", "AF-102", "AF-104", "AF-105", "AF-106", "AF-107", "AF-108", "AF-109", "AF-110", "AF-111", "AF-112", "AF-113", "AF-114", "AF-115", "AF-116", "AF-118", "AF-119", "AF-120", "AF-121", "AF-122", "AF-123", "AF-124", "AF-138", "AF-141", "AF-142", "AF-145", "AF-146", "AF-151", "AF-149", "AF-150", "AF-154", "AF-158", "AF-159", "AF-161", "AF-162", "AF-163", "AF-166", "AF-165", "AF-167", "AF-170", "AF-169", "AF-173", "AF-177", "AF-178", "AF-179", "AF-181", "AF-182", "AF-189", "AF-190", "AF-198", "AF-201", "AF-202", "AF-203", "AF-205", "AF-206", "AF-207", "AF-209", "AF-210", "AF-211", "AF-214", "AF-215", "AF-191", "AF-221", "AF-223", "AF-224", "AF-225", "AF-227", "AF-228", "AF-229", "AF-232", "AF-213", "AF-218", "AF-217", "AF-157", "AF-155", "AF-153", "AF-193", "AF-194"].includes(record.task) || record.id !== id || record.mode !== mode || record.ready !== true ||
      record.repository !== repositoryRoot || record.database !== "aij_foundation_" + record.task.toLowerCase().replaceAll("-", "") + "_" + mode + "_" + id ||
      owner.repository !== repositoryRoot || owner.mode !== mode || owner.project !== p.project ||
      !/^[a-f0-9-]{36}$/.test(owner.instanceId) || record.instanceId !== owner.instanceId) {
    throw new DatabaseOperationError("Acceptance database does not belong to this repository/mode/instance", 2);
  }
  return Object.freeze(record);
}
function resolveDatabaseTarget(mode, input, acceptanceId) {
  if (acceptanceId === undefined) return resolveDatabaseEnvironment(mode, input);
  const record = acceptanceRecord(mode, acceptanceId);
  const variable = mode === "test" ? "TEST_DATABASE_URL" : "DATABASE_URL";
  let url;
  try {
    const raw = input[variable];
    if (typeof raw !== "string" || /[\s#]/.test(raw) || raw.endsWith("?")) throw new Error();
    url = new URL(raw);
    if (url.pathname !== "/" + record.database) throw new Error();
  } catch { throw new DatabaseOperationError("Acceptance URL must select its exact owned database", 2); }
  // Reuse the original host/user/port/secret policy; only a recorded database name may differ.
  url.pathname = "/" + profile(mode).database;
  const target = resolveDatabaseEnvironment(mode, { ...input, [variable]: url.href });
  return Object.freeze({ ...target, database: record.database, acceptanceId });
}
function readDatabaseEnvironment(mode, input = process.env, acceptanceId) {
  const p = profile(mode);
  assertLocalPath(p.environmentFile);
  const local = existsSync(p.environmentFile) ? parseEnv(readFileSync(p.environmentFile, "utf8")) : {};
  // Explicit process/root values, including empty strings, win. No credential fallback between modes.
  const values = { ...local, ...readRepositoryEnvironment(input) };
  return selectDatabaseEnvironment(mode, values, acceptanceId);
}
function selectDatabaseEnvironment(mode, values, acceptanceId) {
  if (acceptanceId === undefined) return values;
  const base = resolveDatabaseEnvironment(mode, values);
  const record = acceptanceRecord(mode, acceptanceId);
  const url = new URL(values[base.variable]); url.pathname = "/" + record.database;
  return { ...values, [base.variable]: url.href };
}
function readApplicationEnvironment(input = process.env) {
  const values = readRepositoryEnvironment(input);
  if (values.DATABASE_ENABLED !== "true" || (values.RUNTIME_PROFILE || "host") !== "host") return values;
  const appEnv = values.APP_ENV || (values.NODE_ENV === "test" ? "test" : "development");
  if (!["development", "test"].includes(appEnv)) throw new DatabaseTargetError("Host database requires explicit local development/test configuration");
  return readDatabaseEnvironment(appEnv === "test" ? "test" : "dev", input);
}

function resolveConfiguration(input, options = {}, host = false) {
  const root = realpathSync(options.projectRoot || repositoryRoot);
  if (root.split(sep).some((part) => part === "qingqi-ai-consultant")) throw new Error("Project root must not point at the old product");
  const { projectId, environment: appEnv } = input;
  if (typeof projectId !== "string" || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(projectId) ||
      projectId.length > 48 || /qingqi/i.test(projectId) || !host && projectId === "aij-foundation") {
    throw new Error("PROJECT_ID must be an explicit independent lowercase project identity");
  }
  if (!appEnvironments.includes(appEnv)) throw new Error("APP_ENV must explicitly identify development, test or production");
  const webPort = host ? fixedPort({ WEB_PORT: input.webPort }, "WEB_PORT", 3655) : projectPort(input.webPort, "WEB_PORT");
  const apiPort = host ? fixedPort({ API_PORT: input.apiPort }, "API_PORT", 3656) : projectPort(input.apiPort, "API_PORT");
  if (webPort === apiPort) throw new Error("Web and API ports must differ");
  const webUrl = loopbackUrl(input.origin, "WEB_URL", webPort, "/");
  const apiUrl = loopbackUrl(input.apiUrl, "NEXT_PUBLIC_API_URL", apiPort, "/api");
  const issuerPrefix = "urn:aij:" + projectId + ":" + appEnv + ":";
  if (typeof input.issuer !== "string" || !input.issuer.startsWith(issuerPrefix) ||
      !/^[a-z0-9-]{1,48}$/.test(input.issuer.slice(issuerPrefix.length))) throw new Error("JWT_ISSUER must be scoped to projectId/environment");
  const cookieScope = projectId.replaceAll("-", "_") + "_" + appEnv;
  if (typeof input.cookiePrefix !== "string" || !new RegExp("^" + cookieScope + "(?:_[a-z0-9]+)*$").test(input.cookiePrefix)) {
    throw new Error("COOKIE_PREFIX must be scoped to projectId/environment");
  }
  const storageRoot = scopedStorageRoot(input.storageRoot, root, projectId, appEnv);
  if (input.enabledPlugins !== undefined && !Array.isArray(input.enabledPlugins)) throw new Error("ENABLED_PLUGINS must be an array");
  const enabledPlugins = [...new Set(input.enabledPlugins || [])];
  if (enabledPlugins.some((code) => typeof code !== "string" || !/^[a-z][a-z0-9-]{0,63}$/.test(code))) throw new Error("ENABLED_PLUGINS contains an invalid plugin code");
  const capabilities = { auth: false, clientAuth: false, database: false, storage: false, ...input.capabilities };
  if (Object.entries(capabilities).some(([key, value]) => !["auth", "clientAuth", "database", "storage"].includes(key) || typeof value !== "boolean")) {
    throw new Error("Capabilities must be explicit auth/clientAuth/database/storage booleans");
  }
  const fingerprints = [];
  const secrets = input.secrets || {};
  if (capabilities.auth || capabilities.clientAuth) {
    const keys = new Set(capabilities.auth ? ["JWT_SECRET"] : []);
    if (capabilities.clientAuth) for (const key of ["CLIENT_JWT_SECRET", "CLIENT_AUTH_RATE_LIMIT_SECRET", "CLIENT_AUTH_TOKEN_SECRET"]) keys.add(key);
    for (const key of ["JWT_SECRET", "CLIENT_JWT_SECRET", "CLIENT_AUTH_RATE_LIMIT_SECRET", "CLIENT_AUTH_TOKEN_SECRET"]) {
      if (secrets[key] !== undefined && secrets[key] !== "") keys.add(key);
    }
    for (const key of keys) fingerprints.push(secretFingerprint(secrets[key], key));
  }
  for (const code of enabledPlugins) {
    const keys = options.pluginSecretRequirements?.[code] || [];
    if (!Array.isArray(keys) || keys.some((key) => typeof key !== "string" || !/^[A-Z][A-Z0-9_]+$/.test(key))) {
      throw new Error("Invalid plugin secret requirement declaration");
    }
    for (const key of keys) fingerprints.push(secretFingerprint(secrets[key], key));
  }
  const target = capabilities.database ? databaseTarget(input.databaseUrl, projectId, appEnv, fingerprints, input.databaseAcceptanceId) : null;
  if (new Set(fingerprints).size !== fingerprints.length) throw new Error("Enabled capabilities must not reuse secrets");
  const config = Object.freeze({
    contract: "aij.project-config/v1", profile: host ? "host" : "project", repositoryRoot: root,
    projectId, environment: appEnv, namespace: projectId + ":" + appEnv,
    serviceId: projectId + "-api", webPort, apiPort, webUrl, origin: webUrl, apiUrl, listenHost: "127.0.0.1",
    issuer: input.issuer, cookiePrefix: input.cookiePrefix,
    clientSessionCookie: input.cookiePrefix + "_client_session", workspaceSessionCookie: input.cookiePrefix + "_workspace_context",
    adminTokenStorageKey: input.cookiePrefix + "_admin_access_token",
    storageRoot, enabledPlugins: Object.freeze(enabledPlugins), capabilities: Object.freeze(capabilities), databaseTarget: target
  });
  isolationData.set(config, { fingerprints });
  assertProjectIsolation([...(options.peers || []), config]);
  return config;
}

function resolveProjectConfiguration(input, options = {}) {
  return resolveConfiguration(input, options);
}

function assertProjectIsolation(configs) {
  const used = new Set();
  const roots = [];
  for (const config of configs) {
    if (!isolationData.has(config)) throw new Error("Isolation checks require resolved configuration objects");
    const keys = ["namespace:" + config.namespace, "issuer:" + config.issuer, "cookie:" + config.cookiePrefix,
      "port:" + config.webPort, "port:" + config.apiPort, ...isolationData.get(config).fingerprints.map((hash) => "secret:" + hash)];
    if (config.databaseTarget) keys.push("database:" + JSON.stringify(config.databaseTarget));
    for (const key of keys) {
      if (used.has(key)) throw new Error("Duplicate project namespace, port, identity, database target or secret");
      used.add(key);
    }
    for (const root of roots) {
      const rel = relative(root, config.storageRoot);
      const reverse = relative(config.storageRoot, root);
      if (!rel || !rel.startsWith("..") && !isAbsolute(rel) || !reverse.startsWith("..") && !isAbsolute(reverse)) {
        throw new Error("Project storage roots must not overlap");
      }
    }
    roots.push(config.storageRoot);
  }
  return true;
}

function resolveRuntimeEnvironment(environment = process.env) {
  if (environment.NODE_ENV === "test" && environment.APP_ENV && environment.APP_ENV !== "test") {
    throw new Error("NODE_ENV=test requires APP_ENV=test; development targets cannot be used by tests");
  }
  const profile = environment.RUNTIME_PROFILE || "host";
  if (!["host", "project"].includes(profile)) throw new Error("RUNTIME_PROFILE must be host or project");
  const host = profile === "host";
  if (host && environment.AIJ_PROJECT_ROOT !== undefined) throw new Error("AIJ_PROJECT_ROOT is only valid for the project runtime profile");
  const projectRoot = host ? repositoryRoot : environment.AIJ_PROJECT_ROOT || repositoryRoot;
  const projectId = host ? environment.PROJECT_ID ?? "aij-foundation" : environment.PROJECT_ID;
  if (host && projectId !== "aij-foundation") throw new Error("Custom PROJECT_ID requires RUNTIME_PROFILE=project");
  const appEnv = host ? environment.APP_ENV || (environment.NODE_ENV === "test" ? "test" : "development") : environment.APP_ENV;
  const capabilities = {};
  for (const key of ["AUTH_ENABLED", "DATABASE_ENABLED", "STORAGE_ENABLED"]) {
    const value = environment[key] ?? "false";
    if (!["true", "false"].includes(value)) throw new Error(key + " must be true or false");
    capabilities[key.split("_")[0].toLowerCase()] = value === "true";
  }
  const clientAuth = environment.CLIENT_AUTH_ENABLED ?? "false";
  if (!["true", "false"].includes(clientAuth)) throw new Error("CLIENT_AUTH_ENABLED must be true or false");
  capabilities.clientAuth = clientAuth === "true";
  const asyncRuntime = environment.ASYNC_RUNTIME_ENABLED ?? "false";
  if (!["true", "false"].includes(asyncRuntime)) throw new Error("ASYNC_RUNTIME_ENABLED must be true or false");
  const selected = host && capabilities.database ? selectDatabaseEnvironment(appEnv === "test" ? "test" : "dev", environment, environment.DATABASE_ACCEPTANCE_ID) : environment;
  const config = resolveConfiguration({
    projectId, environment: appEnv, databaseAcceptanceId: environment.DATABASE_ACCEPTANCE_ID,
    webPort: environment.WEB_PORT ?? (host ? 3655 : undefined), apiPort: environment.API_PORT ?? (host ? 3656 : undefined),
    origin: environment.WEB_URL ?? (host ? "http://localhost:3655" : undefined),
    apiUrl: environment.NEXT_PUBLIC_API_URL ?? (host ? "http://localhost:3656/api" : undefined),
    issuer: environment.JWT_ISSUER ?? (host ? "urn:aij:aij-foundation:" + appEnv + ":api" : undefined),
    cookiePrefix: environment.COOKIE_PREFIX ?? (host ? "aij_foundation_" + appEnv : undefined),
    storageRoot: environment.LOCAL_STORAGE_ROOT ?? (host ? ".local-data/aij-foundation/" + appEnv + "/storage" : undefined),
    enabledPlugins: (environment.ENABLED_PLUGINS || "").split(",").map((code) => code.trim()).filter(Boolean),
    capabilities, secrets: environment, databaseUrl: appEnv === "test" ? selected.TEST_DATABASE_URL : selected.DATABASE_URL
  }, { projectRoot }, host);
  const hops = environment.TRUST_PROXY_HOPS ?? "0";
  if (!/^\d+$/.test(hops) || Number(hops) > 10) throw new Error("TRUST_PROXY_HOPS must be an integer from 0 to 10");
  const nodeEnv = environment.NODE_ENV || "development";
  if (!["development", "test", "production"].includes(nodeEnv)) throw new Error("NODE_ENV must be development, test or production");
  const exportEnabled = environment.AIJ_DOCUMENT_EXPORT_ENABLED ?? "false";
  if (!["true", "false"].includes(exportEnabled)) throw new Error("AIJ_DOCUMENT_EXPORT_ENABLED must be true or false");
  const exportImage = environment.AIJ_DOCUMENT_EXPORT_IMAGE_ID ?? "";
  const exportCli = environment.AIJ_DOCUMENT_EXPORT_DOCKER_CLI ?? "";
  if (exportImage && !/^sha256:[a-f0-9]{64}$/.test(exportImage)) throw new Error("Invalid document export image configuration");
  if (exportCli && (!isAbsolute(exportCli) || resolve(exportCli) !== exportCli || [...exportCli].some(character => character === "\\" || character.codePointAt(0) < 32 || character.codePointAt(0) === 127))) throw new Error("Invalid document export CLI configuration");
  if (exportEnabled === "true" && (!exportImage || !exportCli || !capabilities.database || !capabilities.storage || !capabilities.clientAuth || !config.enabledPlugins.includes("aij-ai"))) throw new Error("Document export requires its configured capabilities");
  const documentExport = Object.freeze({ enabled: exportEnabled === "true", approvedImage: exportImage, dockerCliPath: exportCli });
  const runtime = Object.freeze({
    ...config, nodeEnv, trustProxyHops: Number(hops), asyncRuntimeEnabled: asyncRuntime === "true", documentExport
  });
  isolationData.set(runtime, isolationData.get(config));
  assertRuntimeCapabilities(runtime);
  return runtime;
}

function readRepositoryEnvironment(environment = process.env) {
  // The dedicated local AI launcher supplies its whole environment. Refuse an
  // invalid opt-in before probing any repository .env; legacy callers retain
  // their original file/explicit precedence below.
  if (environment.AIJ_RUNTIME_ENV_SOURCE !== undefined) {
    if (environment.AIJ_RUNTIME_ENV_SOURCE !== "explicit" || environment.RUNTIME_PROFILE !== "project" ||
        environment.PROJECT_ID !== "aij-ai-local" || environment.APP_ENV !== "development" ||
        environment.AIJ_PROJECT_ROOT !== repositoryRoot || realpathSync(repositoryRoot) !== repositoryRoot ||
        environment.WEB_PORT !== "3955" || environment.API_PORT !== "3956") {
      throw new Error("Explicit runtime environment requires the fixed independent local AI identity");
    }
    return environment;
  }
  const root = environment.RUNTIME_PROFILE === "project" && environment.AIJ_PROJECT_ROOT
    ? realpathSync(environment.AIJ_PROJECT_ROOT)
    : repositoryRoot;
  const file = resolve(root, ".env");
  const fileValues = existsSync(file) ? parseEnv(readFileSync(file, "utf8")) : {};
  // Parse data rather than sourcing shell commands; process env has explicit precedence.
  return { ...fileValues, ...environment };
}

function loadRuntimeEnvironment(environment = process.env) {
  const config = resolveRuntimeEnvironment(readApplicationEnvironment(environment));
  assertRuntimeCapabilities(config);
  return config;
}

function assertRuntimeCapabilities(config) {
  if (config.enabledPlugins.includes("mbti-config") && (config.projectId !== "mbti-foundation" || !config.capabilities.auth || !config.capabilities.database)) throw new Error("MBTI config requires its trusted project, administrator auth and database capabilities");
  if (config.capabilities.clientAuth && !config.capabilities.database) throw new Error("Client auth requires the database capability");
  if (config.capabilities.auth && !config.capabilities.database) throw new Error("Administrator auth requires the database capability");
  if (config.asyncRuntimeEnabled && (!config.capabilities.auth || !config.capabilities.database)) throw new Error("Async runtime requires administrator auth and the database capability");
}

module.exports = { repositoryRoot, resolveProjectConfiguration, assertProjectIsolation, assertRuntimeCapabilities, resolveRuntimeEnvironment, readRepositoryEnvironment, loadRuntimeEnvironment, DatabaseTargetError, resolveDatabaseEnvironment, DatabaseOperationError, profile, assertLocalPath, acceptanceRecord, resolveDatabaseTarget, readDatabaseEnvironment, readApplicationEnvironment };
