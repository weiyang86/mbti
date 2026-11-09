import { spawn } from "node:child_process";
import { isDeepStrictEqual, parseEnv } from "node:util";
import { fileURLToPath } from "node:url";
import {
  existsSync, lstatSync, mkdirSync, readFileSync, realpathSync,
  rmdirSync, unlinkSync, writeFileSync
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import environment from "../runtime-environment.cjs";
import { assertEditionPlugins, projectEditionContract, resolveEdition, validateEditionConfiguration } from "./editions.mjs";

const manifestName = "aij.project.json";
const templateSchema = "aij.project-template/v1";
const baseCapabilities = Object.freeze({ auth: false, clientAuth: false, database: false, storage: false });
const immutableEnv = ["RUNTIME_PROFILE", "AIJ_PROJECT_ROOT", "PROJECT_ID", "APP_ENV", "WEB_PORT", "API_PORT", "WEB_URL", "NEXT_PUBLIC_API_URL", "JWT_ISSUER", "COOKIE_PREFIX", "LOCAL_STORAGE_ROOT"];
const allowedLocalEnv = new Set([...immutableEnv, "AUTH_ENABLED", "CLIENT_AUTH_ENABLED", "DATABASE_ENABLED", "STORAGE_ENABLED", "ASYNC_RUNTIME_ENABLED", "ENABLED_PLUGINS", "JWT_SECRET", "CLIENT_JWT_SECRET", "CLIENT_AUTH_RATE_LIMIT_SECRET", "CLIENT_AUTH_TOKEN_SECRET", "DATABASE_URL", "TEST_DATABASE_URL", "TRUST_PROXY_HOPS"]);
const oldProductSegment = "qingqi-ai-consultant";

function assertOutsideOldProduct(path) {
  if (resolve(path).split(/[\\/]/).includes(oldProductSegment)) throw new Error("Generated project paths cannot enter the old product");
  let ancestor = resolve(path);
  while (!existsSync(ancestor)) {
    const parent = dirname(ancestor);
    if (parent === ancestor) throw new Error("Could not locate a safe existing parent directory");
    ancestor = parent;
  }
  if (realpathSync(ancestor).split(/[\\/]/).includes(oldProductSegment)) {
    throw new Error("Generated project paths cannot resolve into the old product");
  }
}

function parseFlags(args, repeated = new Set()) {
  const values = new Map();
  for (let i = 0; i < args.length; i += 1) {
    const flag = args[i];
    if (!flag.startsWith("--") || flag.length < 3) throw new Error("Unexpected positional argument");
    const key = flag.slice(2);
    if (i + 1 >= args.length || args[i + 1].startsWith("--")) throw new Error("Missing value for --" + key);
    const value = args[++i];
    if (!repeated.has(key) && values.has(key)) throw new Error("Duplicate option --" + key);
    if (repeated.has(key)) values.set(key, [...(values.get(key) || []), value]);
    else values.set(key, value);
  }
  return values;
}

function required(values, key) {
  const value = values.get(key);
  if (typeof value !== "string" || !value.trim()) throw new Error("Missing required option --" + key);
  return value;
}

function projectInput(projectId, appEnv, webPort, apiPort, edition) {
  const cookieId = projectId.replaceAll("-", "_");
  return {
    projectId,
    environment: appEnv,
    webPort,
    apiPort,
    origin: "http://127.0.0.1:" + webPort,
    apiUrl: "http://127.0.0.1:" + apiPort + "/api",
    issuer: "urn:aij:" + projectId + ":" + appEnv + ":api",
    cookiePrefix: cookieId + "_" + appEnv,
    storageRoot: ".local-data/" + projectId + "/" + appEnv + "/storage",
    enabledPlugins: [...edition.enabledPlugins],
    capabilities: { ...baseCapabilities }
  };
}

function publicConfiguration(config) {
  return {
    projectId: config.projectId,
    environment: config.environment,
    webPort: config.webPort,
    apiPort: config.apiPort,
    origin: config.origin,
    apiUrl: config.apiUrl,
    issuer: config.issuer,
    cookiePrefix: config.cookiePrefix,
    storageRoot: config.storageRoot,
    capabilities: { ...config.capabilities },
    enabledPlugins: [...config.enabledPlugins]
  };
}

function projectEnvironment(configuration, projectRoot, contract) {
  return {
    RUNTIME_PROFILE: "project",
    AIJ_PROJECT_ROOT: projectRoot,
    PROJECT_ID: configuration.projectId,
    APP_ENV: configuration.environment,
    WEB_PORT: String(configuration.webPort),
    API_PORT: String(configuration.apiPort),
    WEB_URL: configuration.origin,
    NEXT_PUBLIC_API_URL: configuration.apiUrl,
    JWT_ISSUER: configuration.issuer,
    COOKIE_PREFIX: configuration.cookiePrefix,
    LOCAL_STORAGE_ROOT: configuration.storageRoot,
    AUTH_ENABLED: "false",
    CLIENT_AUTH_ENABLED: "false",
    DATABASE_ENABLED: "false",
    STORAGE_ENABLED: "false",
    ASYNC_RUNTIME_ENABLED: "false",
    ENABLED_PLUGINS: configuration.enabledPlugins.join(","),
    ...contract.forwardedConfiguration
  };
}

function envExample(configuration, contract) {
  const values = projectEnvironment(configuration, ".", contract);
  return Object.entries(values).map(([key, value]) => key + "=" + value).join("\n") + "\n" +
    contract.secretRefVariables.map(key => "# Provision locally for env://" + key + "; no value is generated.\n# " + key + "=\n").join("");
}

function noCredentialKeys(value, file = manifestName) {
  if (Array.isArray(value)) {
    for (const item of value) noCredentialKeys(item, file);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (/(?:secret|password|credential|token|databaseurl|privatekey)/i.test(key)) {
      throw new Error(file + " must contain references and capability flags only");
    }
    noCredentialKeys(child, file);
  }
}

function manifestPathFromPeer(value) {
  const path = resolve(value);
  assertOutsideOldProduct(path);
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) throw new Error("Peer project manifest cannot be a symlink");
  const manifest = stat.isDirectory() ? join(path, manifestName) : path;
  const manifestStat = lstatSync(manifest);
  if (!manifestStat.isFile() || manifestStat.isSymbolicLink()) throw new Error("Peer project manifest must be a regular file");
  const realManifest = realpathSync(manifest);
  assertOutsideOldProduct(realManifest);
  return { path: realManifest, root: realpathSync(dirname(manifest)) };
}

function readManifest(manifestPath) {
  const stat = lstatSync(manifestPath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Project manifest must be a regular file");
  let document;
  try { document = JSON.parse(readFileSync(manifestPath, "utf8")); }
  catch { throw new Error("Project manifest must be valid JSON"); }
  if (!document || typeof document !== "object" || Array.isArray(document)) throw new Error("Unsupported generated project manifest");
  // The only secret-related manifest field is an exact derived list of variable names.
  const { editionContract, ...withoutContract } = document;
  noCredentialKeys(withoutContract);
  const edition = resolveEdition(document.edition);
  if (document.schema !== templateSchema || document.profile !== edition.profile || !document.configuration) {
    throw new Error("Unsupported generated project manifest");
  }
  const allowed = ["schema", "profile", "edition", "configuration", "editionContract", "decisions"];
  if (Object.keys(document).some(key => !allowed.includes(key))) throw new Error("Unsupported project manifest field");
  const fields = ["projectId", "environment", "webPort", "apiPort", "origin", "apiUrl", "issuer", "cookiePrefix", "storageRoot", "capabilities", "enabledPlugins"];
  if (Object.keys(document.configuration).some(key => !fields.includes(key))) throw new Error("Unsupported project configuration field");
  assertEditionPlugins(edition, document.configuration.enabledPlugins);
  const expected = projectEditionContract(edition, document.configuration.projectId, document.configuration.environment);
  // Base v1 stays credential-field-free; AI editions require the exact derived contract.
  if (!(edition.code === "base" && editionContract === undefined) && !isDeepStrictEqual(editionContract, expected)) {
    throw new Error("Project edition contract must match the trusted declaration and project identity");
  }
  return document;
}

function validatePeer(value) {
  const { path, root } = manifestPathFromPeer(value);
  const manifest = readManifest(path);
  const config = environment.resolveProjectConfiguration(manifest.configuration, { projectRoot: root });
  return { config, manifest };
}

function validateNewConfiguration(values, outputRoot) {
  const edition = resolveEdition(values.get("edition"));
  const projectId = required(values, "project-id");
  const appEnv = required(values, "environment");
  const webPort = required(values, "web-port");
  const apiPort = required(values, "api-port");
  const peers = (values.get("peer") || []).map(validatePeer);
  const input = projectInput(projectId, appEnv, webPort, apiPort, edition);
  const config = environment.resolveProjectConfiguration(input, { projectRoot: outputRoot, peers: peers.map(peer => peer.config) });
  return publicConfiguration(config);
}

function writeOwnedFile(root, name, content, mode, created) {
  const path = join(root, name);
  writeFileSync(path, content, { flag: "wx", mode });
  created.push(path);
}

function createProject(values) {
  const destination = resolve(required(values, "dir"));
  if (existsSync(destination)) throw new Error("Destination already exists; existing project files were left untouched");
  assertOutsideOldProduct(destination);
  mkdirSync(dirname(destination), { recursive: true });
  const parent = realpathSync(dirname(destination));
  const root = join(parent, basename(destination));
  assertOutsideOldProduct(root);
  mkdirSync(root, { recursive: false, mode: 0o700 });
  const created = [];
  try {
    const configuration = validateNewConfiguration(values, root);
    const edition = resolveEdition(values.get("edition"));
    const contract = projectEditionContract(edition, configuration.projectId, configuration.environment);
    const document = {
      schema: templateSchema,
      profile: edition.profile,
      edition: edition.code,
      configuration,
      ...(edition.code === "base" ? {} : { editionContract: contract }),
      decisions: { license: "PENDING_OWNER_DECISION", distributionChannel: "PENDING_OWNER_DECISION", supportedPlatforms: "PENDING_OWNER_DECISION" }
    };
    const editionNote = edition.code === "base" ? "No plugin dependencies are declared." : "AI requirements and allowed configuration: see editionContract in aij.project.json; all live gates default off.";
    const readme = `# ${configuration.projectId}\n\nGenerated from the local AIJ Foundation project template. This directory contains project-scoped configuration only; it does not claim that package installation, license, distribution channel, supported platforms, or release authorization are complete.\n\n- Edition: ${edition.code}\n- Profile: ${edition.profile}\n- Declared plugins: ${edition.enabledPlugins.join(", ") || "none"}; this does not install or enable a persistent plugin installation\n- Runtime roots: project-local; see aij.project.json\n- Local secrets: provision this project's ignored .env independently. Never copy a host or another project's credentials.\n- ${editionNote}\n- Independent project Seed and runnable AI consumption remain GEN-02/03 work\n\nFrom the AIJ Foundation checkout, inspect configuration with:\n\n\`\`\`sh\npnpm run aij:project -- show --dir <project-directory>\n\`\`\`\n\nTo run a local API from the checkout, use \`pnpm run aij:project -- run --dir <project-directory> --app api --mode dev\`. The source checkout provides the host code in this development template; a standalone installable distribution remains a separate release gate.\n`;
    writeOwnedFile(root, manifestName, JSON.stringify(document, null, 2) + "\n", 0o644, created);
    writeOwnedFile(root, ".env.example", envExample(configuration, contract), 0o644, created);
    writeOwnedFile(root, ".gitignore", ".env\n.local-data/\n*.log\n", 0o644, created);
    writeOwnedFile(root, "README.md", readme, 0o644, created);
    return { status: "CREATED", edition: edition.code, projectId: configuration.projectId, directory: root, environment: configuration.environment, webPort: configuration.webPort, apiPort: configuration.apiPort };
  } catch (error) {
    for (const path of created.reverse()) {
      try { unlinkSync(path); } catch { /* preserve evidence if an owned file could not be removed */ }
    }
    try { rmdirSync(root); } catch { /* never recursively remove a path that may contain user files */ }
    throw error;
  }
}

function loadProject(directory) {
  const root = realpathSync(resolve(directory));
  const manifestPath = join(root, manifestName);
  const manifest = readManifest(manifestPath);
  const edition = resolveEdition(manifest.edition);
  const contract = projectEditionContract(edition, manifest.configuration.projectId, manifest.configuration.environment);
  const config = environment.resolveProjectConfiguration(manifest.configuration, { projectRoot: root });
  return { root, manifest, edition, contract, configuration: publicConfiguration(config) };
}

function readLocalEnvironment(envFile) {
  const stat = lstatSync(envFile);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Project environment must be a regular local file");
  try { return parseEnv(readFileSync(envFile, "utf8")); }
  catch { throw new Error("Project local environment file could not be parsed"); }
}

function assertLocalIdentity(project, local, defaults) {
  for (const key of immutableEnv) {
    if (key === "AIJ_PROJECT_ROOT" && local[key] !== undefined) {
      let localRoot;
      try { localRoot = realpathSync(resolve(project.root, local[key])); } catch { localRoot = ""; }
      if (localRoot !== project.root) throw new Error("Project identity is immutable; regenerate with the required identity instead of overriding " + key);
    } else if (local[key] !== undefined && local[key] !== defaults[key]) {
      throw new Error("Project identity is immutable; regenerate with the required identity instead of overriding " + key);
    }
  }
  if (local.ENABLED_PLUGINS !== undefined) {
    const plugins = local.ENABLED_PLUGINS.split(",").map(code => code.trim()).filter(Boolean);
    assertEditionPlugins(project.edition, plugins);
  }
}

function validateProjectEnvironment(project) {
  const defaults = projectEnvironment(project.configuration, project.root, project.contract);
  const example = readLocalEnvironment(join(project.root, ".env.example"));
  assertLocalIdentity(project, example, defaults);
  const local = lstatSync(join(project.root, ".env"), { throwIfNoEntry: false }) ? readLocalEnvironment(join(project.root, ".env")) : example;
  assertLocalIdentity(project, local, defaults);
  validateEditionConfiguration(project.contract, local);
  const allowed = new Set([...allowedLocalEnv, ...Object.keys(project.contract.forwardedConfiguration), ...project.contract.secretRefVariables]);
  const localOverrides = Object.fromEntries(Object.entries(local).filter(([key]) => allowed.has(key)));
  const childEnvironment = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TMPDIR: process.env.TMPDIR,
    LANG: process.env.LANG,
    LC_ALL: process.env.LC_ALL,
    ...defaults,
    ...localOverrides,
    ...Object.fromEntries(immutableEnv.map(key => [key, key === "AIJ_PROJECT_ROOT" ? project.root : defaults[key]])),
    AIJ_PROJECT_ROOT: project.root
  };
  const runtime = environment.resolveRuntimeEnvironment(childEnvironment);
  environment.assertRuntimeCapabilities(runtime);
  return { runtime, childEnvironment };
}

// Pure configuration boundary for offline verification; this never starts an application.
export function resolveGeneratedProjectEnvironment(directory) {
  const project = loadProject(directory);
  return { ...project, ...validateProjectEnvironment(project) };
}

function showProject(values) {
  const { runtime, edition, contract } = resolveGeneratedProjectEnvironment(required(values, "dir"));
  return {
    status: "VALID",
    edition: edition.code,
    editionContract: contract,
    projectId: runtime.projectId,
    namespace: runtime.namespace,
    environment: runtime.environment,
    webPort: runtime.webPort,
    apiPort: runtime.apiPort,
    origin: runtime.origin,
    issuer: runtime.issuer,
    cookiePrefix: runtime.cookiePrefix,
    storageRoot: runtime.storageRoot,
    capabilities: runtime.capabilities,
    enabledPlugins: runtime.enabledPlugins
  };
}

function runProject(values) {
  const application = required(values, "app");
  const mode = required(values, "mode");
  if (!["api", "web"].includes(application) || !["dev", "start", "build"].includes(mode)) {
    throw new Error("Application must be api/web and mode must be dev/start/build");
  }
  const { childEnvironment } = resolveGeneratedProjectEnvironment(required(values, "dir"));
  const runApp = resolve(environment.repositoryRoot, "scripts/run-app.mjs");
  const child = spawn(process.execPath, [runApp, application, mode], { cwd: environment.repositoryRoot, env: childEnvironment, stdio: "inherit" });
  let stopping = false;
  const forward = signal => {
    if (stopping) return;
    stopping = true;
    if (child.pid) child.kill(signal);
  };
  const onInterrupt = () => forward("SIGINT");
  const onTerminate = () => forward("SIGTERM");
  process.once("SIGINT", onInterrupt);
  process.once("SIGTERM", onTerminate);
  child.once("error", () => { console.error("Project host process failed to start"); process.exitCode = 1; });
  child.once("exit", (code, signal) => {
    process.off("SIGINT", onInterrupt);
    process.off("SIGTERM", onTerminate);
    process.exitCode = code ?? (signal ? 1 : 0);
  });
}

function usage() {
  return "Usage: aij:project create --project-id <id> --environment <development|test|production> --dir <new-directory> --web-port <port> --api-port <port> [--edition <base|ai-standard>] [--peer <project-manifest>]... | show --dir <directory> | run --dir <directory> --app <api|web> --mode <dev|start|build>";
}

async function main(argv) {
  if (argv[0] === "--") argv = argv.slice(1);
  const [command, ...args] = argv;
  if (!command || command === "--help" || command === "help") {
    console.log(usage());
    return;
  }
  const values = parseFlags(args, new Set(["peer"]));
  const options = {
    create: ["edition", "project-id", "environment", "dir", "web-port", "api-port", "peer"],
    show: ["dir"], run: ["dir", "app", "mode"]
  }[command];
  if (!options) throw new Error("Unknown project command");
  if ([...values.keys()].some(key => !options.includes(key))) throw new Error("Unsupported option for project command");
  let result;
  if (command === "create") result = createProject(values);
  else if (command === "show") result = showProject(values);
  else if (command === "run") return runProject(values);
  else throw new Error("Unknown project command");
  console.log(JSON.stringify(result));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    console.error(JSON.stringify({ status: "REJECTED", message: error instanceof Error ? error.message : "Project configuration rejected" }));
    process.exitCode = 2;
  }
}
