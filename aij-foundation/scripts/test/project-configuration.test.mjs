import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import environment from "../runtime-environment.cjs";
import { resolveGeneratedProjectEnvironment } from "../project/cli.mjs";

const { resolveProjectConfiguration: configure, assertProjectIsolation: isolate, resolveRuntimeEnvironment: runtime } = environment;
const parent = join(environment.repositoryRoot, ".artifacts/af-003/config-tests");
mkdirSync(parent, { recursive: true });
const root = mkdtempSync(join(parent, "run-"));
const input = (id = "alpha", base = 4655, appEnv = "development") => ({
  projectId: id, environment: appEnv, webPort: base, apiPort: base + 1,
  origin: "http://localhost:" + base, apiUrl: "http://127.0.0.1:" + (base + 1) + "/api",
  issuer: "urn:aij:" + id + ":" + appEnv + ":api", cookiePrefix: id.replaceAll("-", "_") + "_" + appEnv,
  storageRoot: ".artifacts/af-003/storage/" + id + "/" + appEnv + "/files"
});
const options = { projectRoot: root };
const authSecrets = () => Object.fromEntries(["JWT_SECRET", "CLIENT_JWT_SECRET", "CLIENT_AUTH_RATE_LIMIT_SECRET", "CLIENT_AUTH_TOKEN_SECRET"].map((key) => [key, randomBytes(32).toString("hex")]));
const databaseUrl = (id, appEnv, port = 56432) => {
  const name = id.replaceAll("-", "_") + "_" + appEnv;
  return "postgresql://" + name + ":" + randomBytes(32).toString("hex") + "@127.0.0.1:" + port + "/" + name + "?schema=public";
};

test("two synthetic projects have different public identities, ports and actual isolated file paths", () => {
  const alpha = configure(input(), options);
  const beta = configure(input("beta", 4755), { ...options, peers: [alpha] });
  assert.equal(isolate([alpha, beta]), true);
  for (const key of ["projectId", "namespace", "serviceId", "webPort", "apiPort", "origin", "issuer", "cookiePrefix", "clientSessionCookie", "workspaceSessionCookie", "adminTokenStorageKey", "storageRoot"]) {
    assert.notEqual(alpha[key], beta[key], key);
  }
  for (const config of [alpha, beta]) {
    mkdirSync(config.storageRoot, { recursive: true });
    writeFileSync(join(config.storageRoot, "synthetic.txt"), config.projectId);
  }
  assert.equal(readFileSync(join(alpha.storageRoot, "synthetic.txt"), "utf8"), "alpha");
  assert.equal(readFileSync(join(beta.storageRoot, "synthetic.txt"), "utf8"), "beta");
  assert.ok(Object.isFrozen(alpha) && Object.isFrozen(alpha.capabilities));
});
test("host defaults still use 3655/3656 and do not require inactive credentials", () => {
  const config = runtime({});
  assert.equal(config.webPort, 3655);
  assert.equal(config.apiPort, 3656);
  assert.equal(config.serviceId, "aij-foundation-api");
  assert.equal(config.namespace, "aij-foundation:development");
  assert.equal(config.databaseTarget, null);
  assert.equal(isolate([config]), true);
  assert.doesNotThrow(() => environment.assertRuntimeCapabilities(config));
});
for (const key of ["projectId", "environment", "webPort", "apiPort", "origin", "apiUrl", "issuer", "cookiePrefix", "storageRoot"]) {
  test("generated project rejects missing explicit " + key, () => {
    const value = input(); delete value[key];
    assert.throws(() => configure(value, options));
  });
}
test("project mode never silently falls back to host identity or ports", () => {
  assert.throws(() => runtime({ RUNTIME_PROFILE: "project" }), /PROJECT_ID/);
  assert.throws(() => runtime({ PROJECT_ID: "alpha" }), /RUNTIME_PROFILE/);
  assert.throws(() => configure(input("aij-foundation"), options), /PROJECT_ID/);
  for (const id of ["qingqi", "qingqi-app", "../alpha", "Alpha", "alpha_beta"]) assert.throws(() => configure({ ...input(), projectId: id }, options), /PROJECT_ID/);
});
test("invalid, same, host-reserved and old-product ports fail", () => {
  for (const port of ["", "4655junk", "-1", "0", "80", "65536", "3555", "3556", "3101", "3655", "55432", "15435"]) {
    assert.throws(() => configure({ ...input(), webPort: port }, options), /WEB_PORT/);
  }
  assert.throws(() => configure({ ...input(), apiPort: 4655 }, options), /differ/);
});
test("malformed/non-loopback/credential/query/fragment/path URLs fail without echoing values", () => {
  for (const url of ["garbage", "https://example.com", "http://0.0.0.0:4655", "http://user:sentinel@localhost:4655", "http://localhost:3555", "http://localhost:4655/path", "http://localhost:4655?key=sentinel", "http://localhost:4655#sentinel"]) {
    assert.throws(() => configure({ ...input(), origin: url }, options), (error) => /WEB_URL/.test(error.message) && !error.message.includes("sentinel"));
  }
  assert.throws(() => configure({ ...input(), apiUrl: "http://localhost:4656/other" }, options), /NEXT_PUBLIC_API_URL/);
});
test("issuer and Cookie prefixes must identify both project and environment", () => {
  for (const issuer of ["qingqi-api", "aij-foundation-api", "urn:aij:beta:development:api", "urn:aij:alpha:test:api"]) assert.throws(() => configure({ ...input(), issuer }, options), /JWT_ISSUER/);
  for (const cookiePrefix of ["accessToken", "qingqi_client", "alpha", "alpha_test", "beta_development", "alpha_development;bad"]) assert.throws(() => configure({ ...input(), cookiePrefix }, options), /COOKIE_PREFIX/);
});
test("storage paths reject old-project/outside roots, wrong environment and dangling symlinks", () => {
  for (const storageRoot of ["/Users/lei/Documents/余总合作/轻启AI/qingqi-ai-consultant/uploads", "../alpha/development/files", ".data/beta/development/files", ".data/alpha/test/files", ".data/alpha/development"]) {
    assert.throws(() => configure({ ...input(), storageRoot }, options), /LOCAL_STORAGE_ROOT/);
  }
  symlinkSync(join(root, "nonexistent"), join(root, "link"));
  assert.throws(() => configure({ ...input(), storageRoot: "link/alpha/development/files" }, options), /symlink/);
});
test("duplicate namespace, cross-project port reuse and overlapping storage are rejected", () => {
  const alpha = configure(input(), options);
  assert.throws(() => configure(input("alpha", 4855), { ...options, peers: [alpha] }), /Duplicate/);
  assert.throws(() => configure(input("beta", 4655), { ...options, peers: [alpha] }), /Duplicate/);
  assert.throws(() => configure({ ...input("beta", 4755), storageRoot: input().storageRoot + "/beta/development/files" }, { ...options, peers: [alpha] }), /overlap/);
  assert.throws(() => isolate([JSON.parse(JSON.stringify(alpha))]), /resolved/);
});
test("disabled auth/database/plugins do not demand irrelevant or template credentials", () => {
  const config = configure({ ...input(), secrets: { JWT_SECRET: "REPLACE_LOCAL_ONLY" }, databaseUrl: "not configured" }, {
    ...options, pluginSecretRequirements: { "fixture-mail": ["FIXTURE_MAIL_KEY"] }
  });
  assert.equal(config.capabilities.auth, false);
  assert.equal(config.databaseTarget, null);
});
test("enabled auth rejects missing, template, weak and role-reused secrets", () => {
  const valid = authSecrets();
  for (const value of ["", "REPLACE_LOCAL_ONLY", "change-me-before-using-this-default-key", "a".repeat(64)]) {
    assert.throws(() => configure({ ...input(), capabilities: { auth: true }, secrets: { ...valid, JWT_SECRET: value } }, options), /JWT_SECRET/);
  }
  assert.throws(() => configure({ ...input(), capabilities: { auth: true }, secrets: { ...valid, JWT_SECRET: valid.CLIENT_JWT_SECRET } }, options), /reuse secrets/);
});
test("cross-environment and cross-project reuse of active secrets fails without serializing them", () => {
  const secrets = authSecrets();
  const alpha = configure({ ...input(), capabilities: { auth: true }, secrets }, options);
  for (const value of [input("alpha", 4855, "test"), input("beta", 4755)]) {
    assert.throws(() => configure({ ...value, capabilities: { auth: true }, secrets }, { ...options, peers: [alpha] }), /Duplicate/);
  }
  for (const value of Object.values(secrets)) assert.ok(!JSON.stringify(alpha).includes(value));
});
test("only enabled plugins validate their explicitly declared credentials", () => {
  const opts = { ...options, pluginSecretRequirements: { "fixture-mail": ["FIXTURE_MAIL_KEY"] } };
  assert.throws(() => configure({ ...input(), enabledPlugins: ["fixture-mail"] }, opts), /FIXTURE_MAIL_KEY/);
  assert.throws(() => configure({ ...input(), enabledPlugins: ["fixture-mail"], secrets: { FIXTURE_MAIL_KEY: "REPLACE_LOCAL_ONLY" } }, opts), /FIXTURE_MAIL_KEY/);
  assert.equal(configure({ ...input(), enabledPlugins: ["fixture-mail"], secrets: { FIXTURE_MAIL_KEY: randomBytes(32).toString("hex") } }, opts).enabledPlugins[0], "fixture-mail");
});
test("database contract accepts different explicit synthetic targets without connecting", () => {
  const alpha = configure({ ...input(), capabilities: { database: true }, databaseUrl: databaseUrl("alpha", "development") }, options);
  const beta = configure({ ...input("beta", 4755), capabilities: { database: true }, databaseUrl: databaseUrl("beta", "development", 57432) }, { ...options, peers: [alpha] });
  assert.notEqual(alpha.databaseTarget.database, beta.databaseTarget.database);
  assert.notEqual(alpha.databaseTarget.port, beta.databaseTarget.port);
  assert.ok(!("password" in alpha.databaseTarget));
});
test("enabled database rejects old/development-as-test and placeholder targets", () => {
  const base = { ...input("alpha", 4855, "test"), capabilities: { database: true } };
  for (const databaseUrl of ["", "postgresql://qingqi_ai:REPLACE_LOCAL_ONLY@127.0.0.1:15435/qingqi_ai", databaseUrlForWrongEnvironment(), "postgresql://alpha_test:REPLACE_TEST_ONLY@127.0.0.1:56433/alpha_test"]) {
    assert.throws(() => configure({ ...base, databaseUrl }, options), /database|Database/);
  }
  function databaseUrlForWrongEnvironment() { return databaseUrl("alpha", "development"); }
});
test("test runtime never falls back to DATABASE_URL", () => {
  assert.throws(() => runtime({
    RUNTIME_PROFILE: "project", PROJECT_ID: "alpha", APP_ENV: "test", WEB_PORT: "4855", API_PORT: "4856",
    WEB_URL: "http://localhost:4855", NEXT_PUBLIC_API_URL: "http://localhost:4856/api",
    JWT_ISSUER: "urn:aij:alpha:test:api", COOKIE_PREFIX: "alpha_test",
    LOCAL_STORAGE_ROOT: ".artifacts/af-003/alpha/test/files", DATABASE_ENABLED: "true",
    DATABASE_URL: databaseUrl("alpha", "development")
  }), /Database capability/);
});
test("administrator auth requires its database and local storage adapter capability is available", () => {
  const config = configure({ ...input(), capabilities: { auth: true }, secrets: authSecrets() }, options);
  assert.throws(() => environment.assertRuntimeCapabilities(config), /requires the database/);
  assert.doesNotThrow(() => environment.assertRuntimeCapabilities({ ...config, capabilities: { storage: true } }));
});
test("APP_ENV namespace is independent of framework production build mode and stays loopback", () => {
  assert.equal(runtime({ NODE_ENV: "production" }).namespace, "aij-foundation:development");
  assert.equal(configure(input("alpha", 4655, "production"), options).listenHost, "127.0.0.1");
  assert.throws(() => configure({ ...input("alpha", 4655, "production"), origin: "https://public.example" }, options), /WEB_URL/);
});
test("resolving contract alone never creates its storage directories", () => {
  const config = configure(input("no-write", 4955), options);
  assert.equal(existsSync(config.storageRoot), false);
});
test("a generated-project root cannot point at a directory identified as the old product", () => {
  const oldRoot = join(root, "qingqi-ai-consultant");
  mkdirSync(oldRoot);
  assert.throws(() => configure(input(), { projectRoot: oldRoot }), /old product/);
});
test("host database names and ports retain the reviewed dev/test convention without connecting", () => {
  const password = randomBytes(32).toString("hex");
  const dev = runtime({ DATABASE_ENABLED: "true", DATABASE_URL: "postgresql://aij_foundation_dev:" + password + "@127.0.0.1:55432/aij_foundation_dev" });
  const testing = runtime({ APP_ENV: "test", DATABASE_ENABLED: "true", TEST_DATABASE_URL: "postgresql://aij_foundation_test:" + randomBytes(32).toString("hex") + "@127.0.0.1:55433/aij_foundation_test" });
  assert.equal(dev.databaseTarget.database, "aij_foundation_dev");
  assert.equal(dev.databaseTarget.port, 55432);
  assert.equal(testing.databaseTarget.database, "aij_foundation_test");
  assert.equal(testing.databaseTarget.port, 55433);
});
test("NODE_ENV=test selects test identity and refuses an explicit development mismatch before reading DB targets", () => {
  assert.equal(runtime({ NODE_ENV: "test" }).environment, "test");
  assert.throws(() => runtime({ NODE_ENV: "test", APP_ENV: "development", DATABASE_ENABLED: "true", DATABASE_URL: databaseUrl("alpha", "development") }), /APP_ENV=test/);
  assert.throws(() => runtime({ NODE_ENV: "test", DATABASE_ENABLED: "true", DATABASE_URL: databaseUrl("alpha", "development") }), /Database capability/);
});
test("database contracts reject host dev/test port swaps and generated projects borrowing host DB ports", () => {
  const password = randomBytes(32).toString("hex");
  assert.throws(() => runtime({
    APP_ENV: "test", DATABASE_ENABLED: "true",
    TEST_DATABASE_URL: "postgresql://aij_foundation_test:" + password + "@127.0.0.1:55432/aij_foundation_test"
  }), /Database target/);
  for (const port of [55432, 55433]) {
    assert.throws(() => configure({ ...input(), capabilities: { database: true }, databaseUrl: databaseUrl("alpha", "development", port) }, options), /Database target/);
  }
});

// AF-127: real CLI filesystem round trips; all credentials below are synthetic.
const editionRoot = join(environment.repositoryRoot, ".artifacts/af-127/config-tests");
mkdirSync(editionRoot, { recursive: true });
const editionRun = mkdtempSync(join(editionRoot, "run-"));
const cli = (...args) => spawnSync(process.execPath, [join(environment.repositoryRoot, "scripts/project/cli.mjs"), ...args], {
  cwd: environment.repositoryRoot, encoding: "utf8", env: { ...process.env, AI_CENTER_LIVE_ENABLED: "true", AIJ_SECRET_HOST_DEVELOPMENT_AI_PROVIDER: "synthetic-host-value-never-copy" }
});
function generated(name, edition, extras = []) {
  const dir = join(editionRun, name);
  const result = cli("create", "--project-id", name, "--environment", "development", "--dir", dir,
    "--web-port", "14655", "--api-port", "14656", ...(edition === undefined ? [] : ["--edition", edition]), ...extras);
  assert.equal(result.status, 0, result.stderr);
  return dir;
}
const manifestFile = dir => join(dir, "aij.project.json");
const manifest = dir => JSON.parse(readFileSync(manifestFile(dir), "utf8"));
function mutateManifest(dir, mutate) {
  const value = manifest(dir); mutate(value);
  writeFileSync(manifestFile(dir), JSON.stringify(value));
}
function rejected(result, pattern) {
  assert.equal(result.status, 2, result.stdout + result.stderr);
  assert.match(JSON.parse(result.stderr).message, pattern);
  assert.equal(result.stdout, "");
}

test("base create/show defaults to no plugins and copies no host secrets or live gates", () => {
  const dir = generated("edition-base");
  const value = manifest(dir);
  assert.equal(value.edition, "base");
  assert.equal(value.profile, "aij-base");
  assert.deepEqual(value.configuration.enabledPlugins, []);
  assert.equal(value.editionContract, undefined, "base v1 manifest stays credential-field-free");
  // External macOS volumes may add AppleDouble metadata beside these files.
  const projectFiles = readdirSync(dir).filter(file => !file.startsWith("._")).sort();
  assert.deepEqual(projectFiles, [".env.example", ".gitignore", "README.md", "aij.project.json"]);
  assert.equal(existsSync(join(dir, ".env")), false);
  const result = cli("show", "--dir", dir);
  assert.equal(result.status, 0, result.stderr);
  const shown = JSON.parse(result.stdout);
  assert.deepEqual(shown.enabledPlugins, []);
  assert.deepEqual(shown.editionContract.trustedDependencies, []);
  assert.deepEqual(shown.editionContract.secretRefVariables, []);
  for (const file of projectFiles) assert.ok(!readFileSync(join(dir, file), "utf8").includes("synthetic-host-value"));
});

test("ai-standard declares its trusted AI owner, provisioning requirements and scoped SecretRef names only", () => {
  const dir = generated("edition-ai", "ai-standard");
  const value = manifest(dir);
  assert.equal(value.profile, "aij-ai-standard");
  assert.deepEqual(value.configuration.enabledPlugins, ["aij-ai"]);
  assert.deepEqual(value.editionContract.trustedDependencies.map(d => [d.pluginCode, d.owner]), [["aij-ai", "@aij/api"]]);
  assert.deepEqual(value.editionContract.requiredCapabilities, ["auth", "clientAuth", "database"]);
  assert.deepEqual(value.editionContract.requiredRuntime, ["ASYNC_RUNTIME_ENABLED"]);
  assert.deepEqual(value.editionContract.secretRefVariables, ["AIJ_SECRET_EDITION_AI_DEVELOPMENT_AI_PROVIDER"]);
  assert.ok(Object.values(value.configuration.capabilities).every(flag => flag === false));
  const result = cli("show", "--dir", dir);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).enabledPlugins, ["aij-ai"]);
  const { childEnvironment } = resolveGeneratedProjectEnvironment(dir);
  assert.equal(childEnvironment.AI_CENTER_LIVE_ENABLED, "false");
  assert.equal(childEnvironment.AI_DEEPSEEK_LIVE_ENABLED, "false");
  assert.equal(childEnvironment.AI_DEEPSEEK_UPSTREAM_CONFIRMED, "false");
  assert.equal(childEnvironment.AI_DEEPSEEK_DATA_CLASS, "");
  assert.equal(childEnvironment.ASYNC_RUNTIME_ENABLED, "false");
  assert.equal(childEnvironment.AIJ_SECRET_HOST_DEVELOPMENT_AI_PROVIDER, undefined);
  assert.equal(existsSync(join(dir, ".env")), false);
  assert.match(readFileSync(join(dir, "README.md"), "utf8"), /GEN-02\/03/);
});

test("unknown editions/options reject without leaving a partial project", () => {
  for (const args of [["--edition", "unknown"], ["--edition", ""], ["--plugin", "aij-payment"], ["--plugins", "aij-ai"]]) {
    const dir = join(editionRun, "invalid-" + randomBytes(4).toString("hex"));
    rejected(cli("create", "--project-id", "invalid-edition", "--environment", "test", "--dir", dir,
      "--web-port", "14655", "--api-port", "14656", ...args), /edition|Unsupported option/);
    assert.equal(existsSync(dir), false);
  }
});

test("manifest plugin/edition/forwarding tampering is rejected, including declared foreign secrets", () => {
  const mutations = [
    value => { value.edition = "unknown"; },
    value => { value.configuration.enabledPlugins = ["aij-payment"]; },
    value => { value.configuration.enabledPlugins.push("aij-ai"); },
    value => { value.configuration.enabledPlugins = []; },
    value => { value.editionContract.trustedDependencies[0].owner = "untrusted"; },
    value => { value.editionContract.forwardedConfiguration.NODE_OPTIONS = "--inspect"; },
    value => { value.editionContract.secretRefVariables = ["JWT_SECRET"]; },
    value => { value.configuration.projectId = "foreign-project"; },
    value => { value.configuration.secrets = { JWT_SECRET: "synthetic-never-echo" }; },
    value => { value.extra = "synthetic-never-echo"; }
  ];
  for (const [index, mutate] of mutations.entries()) {
    const dir = generated("tamper-ai-" + index, "ai-standard");
    mutateManifest(dir, mutate);
    const result = cli("show", "--dir", dir);
    rejected(result, /edition|plugins|references|manifest field/i);
    assert.ok(!result.stderr.includes("synthetic-never-echo"));
  }
});

test("base rejects plugin injection in both manifest and local environment", () => {
  const dir = generated("base-plugin-rejection", "base");
  writeFileSync(join(dir, ".env"), "ENABLED_PLUGINS=aij-ai\n");
  rejected(cli("show", "--dir", dir), /plugins/);
  unlinkSync(join(dir, ".env"));
  mutateManifest(dir, value => { value.configuration.enabledPlugins = ["unknown-plugin"]; });
  rejected(cli("show", "--dir", dir), /plugins/);
});

test("show and run reject every local identity override before any app starts", () => {
  const dir = generated("identity-rejection", "ai-standard");
  const overrides = {
    RUNTIME_PROFILE: "host", AIJ_PROJECT_ROOT: "..", PROJECT_ID: "foreign-project", APP_ENV: "test",
    WEB_PORT: "14755", API_PORT: "14756", WEB_URL: "http://127.0.0.1:14755",
    NEXT_PUBLIC_API_URL: "http://127.0.0.1:14756/api", JWT_ISSUER: "urn:aij:foreign:development:api",
    COOKIE_PREFIX: "foreign_development", LOCAL_STORAGE_ROOT: ".data/foreign/development/storage"
  };
  for (const [key, value] of Object.entries(overrides)) {
    writeFileSync(join(dir, ".env"), key + "=" + value + "\n");
    rejected(cli("show", "--dir", dir), /identity is immutable/);
    rejected(cli("run", "--dir", dir, "--app", "api", "--mode", "dev"), /identity is immutable/);
  }
});

test("local plugin overrides cannot add unknown plugins or remove edition dependencies", () => {
  const dir = generated("plugins-rejection", "ai-standard");
  for (const plugins of ["unknown-plugin", "aij-ai,aij-payment", "aij-ai,aij-ai", ""]) {
    writeFileSync(join(dir, ".env"), "ENABLED_PLUGINS=" + plugins + "\n");
    rejected(cli("show", "--dir", dir), /plugins/);
  }
});

test("only this project's declared local SecretRef variable and nonsecret AI configuration are forwarded", () => {
  const dir = generated("forward-ai", "ai-standard");
  const key = manifest(dir).editionContract.secretRefVariables[0];
  const synthetic = randomBytes(32).toString("hex");
  writeFileSync(join(dir, ".env"), [key + "=" + synthetic, "AIJ_SECRET_OTHER_TEST_AI_PROVIDER=synthetic-other-project",
    "UNDECLARED_API_KEY=synthetic-unknown-key", "NODE_OPTIONS=--inspect", "AIJ_TEST_AI_PROVIDER_MODE=offline-knowledge",
    "AI_CENTER_LIVE_ENABLED=true", "AI_CENTER_CLIENT_EXECUTION_ENABLED=true", "AI_CENTER_ALLOWED_BASE_URLS='[\"https://api.example.test/v1\"]'",
    "AI_DEEPSEEK_LIVE_ENABLED=true", "AI_DEEPSEEK_UPSTREAM_CONFIRMED=false", "AI_DEEPSEEK_DATA_CLASS=synthetic-or-deidentified"].join("\n"));
  const { childEnvironment } = resolveGeneratedProjectEnvironment(dir);
  assert.equal(childEnvironment[key], synthetic);
  for (const blocked of ["AIJ_SECRET_OTHER_TEST_AI_PROVIDER", "UNDECLARED_API_KEY", "NODE_OPTIONS", "AIJ_TEST_AI_PROVIDER_MODE"]) {
    assert.equal(childEnvironment[blocked], undefined);
  }
  assert.equal(childEnvironment.AI_CENTER_LIVE_ENABLED, "true");
  assert.equal(childEnvironment.AI_DEEPSEEK_LIVE_ENABLED, "true");
  assert.equal(childEnvironment.AI_DEEPSEEK_UPSTREAM_CONFIRMED, "false");
  const result = cli("show", "--dir", dir);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(!result.stdout.includes(synthetic));
  assert.ok(!result.stdout.includes("synthetic-other-project"));
  assert.ok(!readFileSync(manifestFile(dir), "utf8").includes(synthetic));
  assert.ok(!readFileSync(join(dir, ".env.example"), "utf8").includes(synthetic));
});

test("unprovided declared variables never inherit credentials or gates from the invoking process", () => {
  const dir = generated("no-inheritance", "ai-standard");
  const key = manifest(dir).editionContract.secretRefVariables[0];
  const prior = { credential: process.env[key], gate: process.env.AI_CENTER_LIVE_ENABLED };
  try {
    process.env[key] = "synthetic-inherited-must-not-forward";
    process.env.AI_CENTER_LIVE_ENABLED = "true";
    const { childEnvironment } = resolveGeneratedProjectEnvironment(dir);
    assert.equal(childEnvironment[key], undefined);
    assert.equal(childEnvironment.AI_CENTER_LIVE_ENABLED, "false");
  } finally {
    if (prior.credential === undefined) delete process.env[key]; else process.env[key] = prior.credential;
    if (prior.gate === undefined) delete process.env.AI_CENTER_LIVE_ENABLED; else process.env.AI_CENTER_LIVE_ENABLED = prior.gate;
  }
});

test("AI nonsecret values reject invalid gates and credential-bearing URLs without echoing contents", () => {
  const dir = generated("bad-ai-values", "ai-standard");
  for (const line of ["AI_CENTER_LIVE_ENABLED=yes", "AI_DEEPSEEK_UPSTREAM_CONFIRMED=1", "AI_DEEPSEEK_DATA_CLASS=customer-data",
    "AI_CENTER_ALLOWED_BASE_URLS='[\"https://user:synthetic-never-echo@api.example.test/v1\"]'",
    "AI_CENTER_ALLOWED_BASE_URLS='[\"https://api.example.test/v1?token=synthetic-never-echo\"]'",
    "AI_CENTER_ALLOWED_BASE_URLS='not-json-synthetic-never-echo'"]) {
    writeFileSync(join(dir, ".env"), line + "\n");
    const result = cli("show", "--dir", dir);
    rejected(result, /AI_/);
    assert.ok(!result.stderr.includes("synthetic-never-echo"));
  }
});

test("project-local environment symlinks and hidden edits to example identity are rejected", () => {
  const dir = generated("local-file-safety", "ai-standard");
  symlinkSync(join(dir, ".env.example"), join(dir, ".env"));
  rejected(cli("show", "--dir", dir), /regular local file/);
  unlinkSync(join(dir, ".env"));
  symlinkSync(join(dir, "missing-env"), join(dir, ".env"));
  rejected(cli("show", "--dir", dir), /regular local file/);
  unlinkSync(join(dir, ".env"));
  writeFileSync(join(dir, ".env"), "PROJECT_ID=local-file-safety\n");
  writeFileSync(join(dir, ".env.example"), "PROJECT_ID=foreign\n");
  rejected(cli("show", "--dir", dir), /identity is immutable/);
});

test("mixed edition peers retain distinct identity/SecretRef namespaces and reject reused peer ports", () => {
  const alpha = generated("peer-base", "base");
  const beta = join(editionRun, "peer-ai");
  const args = ["create", "--edition", "ai-standard", "--project-id", "peer-ai", "--environment", "test", "--dir", beta,
    "--web-port", "14755", "--api-port", "14756", "--peer", alpha];
  const result = cli(...args);
  assert.equal(result.status, 0, result.stderr);
  const a = JSON.parse(cli("show", "--dir", alpha).stdout);
  const b = JSON.parse(cli("show", "--dir", beta).stdout);
  for (const key of ["projectId", "namespace", "webPort", "apiPort", "issuer", "cookiePrefix", "storageRoot"]) assert.notEqual(a[key], b[key], key);
  assert.deepEqual(b.editionContract.secretRefVariables, ["AIJ_SECRET_PEER_AI_TEST_AI_PROVIDER"]);
  const conflict = join(editionRun, "peer-conflict");
  rejected(cli("create", "--edition", "ai-standard", "--project-id", "peer-conflict", "--environment", "development", "--dir", conflict,
    "--web-port", "14655", "--api-port", "14856", "--peer", alpha), /Duplicate/);
  assert.equal(existsSync(conflict), false);
});

test("original base v1 manifests remain readable; malformed JSON errors never echo values", () => {
  const dir = generated("legacy-base", "base");
  mutateManifest(dir, value => { delete value.edition; delete value.editionContract; });
  assert.equal(cli("show", "--dir", dir).status, 0);
  writeFileSync(manifestFile(dir), "{broken:synthetic-never-echo}");
  const result = cli("show", "--dir", dir);
  rejected(result, /valid JSON/);
  assert.ok(!result.stderr.includes("synthetic-never-echo"));
});
