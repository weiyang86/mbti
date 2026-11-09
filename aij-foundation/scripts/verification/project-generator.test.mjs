import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import environment from "../runtime-environment.cjs";

const repository = environment.repositoryRoot;
const cli = join(repository, "scripts/project/cli.mjs");
const parent = join(repository, ".artifacts/next-11a/project-generator-tests");
mkdirSync(parent, { recursive: true });
const testRoot = mkdtempSync(join(parent, randomUUID() + "-"));

function createArgs(projectId, directory, webPort, apiPort, peers = []) {
  return ["create", "--project-id", projectId, "--environment", "development", "--dir", directory,
    "--web-port", String(webPort), "--api-port", String(apiPort), ...peers.flatMap(peer => ["--peer", peer])];
}

function run(args) {
  return spawnSync(process.execPath, [cli, ...args], { cwd: repository, encoding: "utf8", env: process.env });
}

function lastJsonLine(stdout) {
  const line = stdout.trim().split(/\r?\n/).at(-1);
  return JSON.parse(line);
}

test("aij project CLI is available through the root package script", () => {
  const output = execFileSync("pnpm", ["run", "aij:project", "--", "--help"], { cwd: repository, encoding: "utf8" });
  assert.match(output, /create --project-id <id>/);
  assert.match(output, /show --dir <directory>/);
  assert.match(output, /run --dir <directory>/);
});

test("generated projects derive separate identities, storage roots and safe base defaults", () => {
  const alphaRoot = join(testRoot, "alpha");
  const alphaResult = execFileSync("pnpm", ["run", "aij:project", "--", ...createArgs("alpha", alphaRoot, 46111, 46112)], { cwd: repository, encoding: "utf8" });
  const alpha = lastJsonLine(alphaResult);
  assert.equal(alpha.status, "CREATED");
  assert.equal(alpha.projectId, "alpha");
  const alphaManifestPath = join(alphaRoot, "aij.project.json");
  const alphaManifest = JSON.parse(readFileSync(alphaManifestPath, "utf8"));
  assert.equal(alphaManifest.schema, "aij.project-template/v1");
  assert.equal(alphaManifest.profile, "aij-base");
  assert.equal(alphaManifest.configuration.capabilities.database, false);
  assert.deepEqual(alphaManifest.configuration.enabledPlugins, []);
  assert.deepEqual(alphaManifest.decisions, {
    license: "PENDING_OWNER_DECISION",
    distributionChannel: "PENDING_OWNER_DECISION",
    supportedPlatforms: "PENDING_OWNER_DECISION"
  });

  const alphaConfig = environment.resolveProjectConfiguration(alphaManifest.configuration, { projectRoot: alphaRoot });
  const alphaRuntime = environment.resolveRuntimeEnvironment({
    RUNTIME_PROFILE: "project", AIJ_PROJECT_ROOT: alphaRoot,
    PROJECT_ID: "alpha", APP_ENV: "development", WEB_PORT: "46111", API_PORT: "46112",
    WEB_URL: "http://127.0.0.1:46111", NEXT_PUBLIC_API_URL: "http://127.0.0.1:46112/api",
    JWT_ISSUER: "urn:aij:alpha:development:api", COOKIE_PREFIX: "alpha_development",
    LOCAL_STORAGE_ROOT: ".local-data/alpha/development/storage", AUTH_ENABLED: "false", DATABASE_ENABLED: "false"
  });
  assert.equal(alphaRuntime.repositoryRoot, resolve(alphaRoot));
  assert.equal(alphaRuntime.storageRoot, join(alphaRoot, ".local-data/alpha/development/storage"));
  assert.equal(existsSync(alphaRuntime.storageRoot), false, "configuration generation must not create storage data");

  const betaRoot = join(testRoot, "beta");
  const betaResult = run(createArgs("beta", betaRoot, 46121, 46122, [alphaManifestPath]));
  assert.equal(betaResult.status, 0, betaResult.stderr);
  const beta = lastJsonLine(betaResult.stdout);
  const betaManifest = JSON.parse(readFileSync(join(betaRoot, "aij.project.json"), "utf8"));
  const betaConfig = environment.resolveProjectConfiguration(betaManifest.configuration, { projectRoot: betaRoot, peers: [alphaConfig] });
  for (const key of ["projectId", "webPort", "apiPort", "origin", "apiUrl", "issuer", "cookiePrefix", "storageRoot"]) {
    assert.notEqual(alphaConfig[key], betaConfig[key], key);
  }
  assert.equal(beta.status, "CREATED");

  const template = readFileSync(join(alphaRoot, ".env.example"), "utf8");
  assert.match(template, /RUNTIME_PROFILE=project/);
  assert.match(template, /AIJ_PROJECT_ROOT=\./);
  assert.match(template, /AUTH_ENABLED=false/);
  assert.match(template, /DATABASE_ENABLED=false/);
  assert.match(template, /ENABLED_PLUGINS=$/m);
  assert.doesNotMatch(template, /(?:JWT_SECRET|DATABASE_URL|CLIENT_JWT_SECRET|AIJ_SECRET_STORE_KEY|REPLACE_|change-me)/i);
  assert.equal(readFileSync(join(alphaRoot, ".gitignore"), "utf8"), ".env\n.local-data/\n*.log\n");
  assert.doesNotMatch(readFileSync(alphaManifestPath, "utf8"), /(?:secret|password|credential|databaseUrl|privateKey)/i);

  const show = run(["show", "--dir", alphaRoot]);
  assert.equal(show.status, 0, show.stderr);
  const shown = lastJsonLine(show.stdout);
  assert.equal(shown.namespace, "alpha:development");
  assert.equal(shown.origin, "http://127.0.0.1:46111");
  assert.deepEqual(shown.enabledPlugins, []);
  assert.doesNotMatch(show.stdout + show.stderr, /(?:JWT_SECRET|DATABASE_URL|password|token)/i);
});

test("project generation rejects duplicate namespace, port reuse, host ports and invalid identity without replacing files", () => {
  const alphaRoot = join(testRoot, "alpha");
  const alphaManifest = join(alphaRoot, "aij.project.json");
  const missingIdentityRoot = join(testRoot, "missing-identity");
  const missingIdentity = run(["create", "--environment", "development", "--dir", missingIdentityRoot, "--web-port", "46101", "--api-port", "46102"]);
  assert.equal(missingIdentity.status, 2);
  assert.match(missingIdentity.stderr, /Missing required option --project-id/);
  assert.equal(existsSync(missingIdentityRoot), false);

  const duplicateRoot = join(testRoot, "duplicate");
  const duplicate = run(createArgs("alpha", duplicateRoot, 46131, 46132, [alphaManifest]));
  assert.equal(duplicate.status, 2);
  assert.match(duplicate.stderr, /REJECTED/);
  assert.equal(existsSync(duplicateRoot), false);

  const portRoot = join(testRoot, "port-conflict");
  const portConflict = run(createArgs("gamma", portRoot, 46111, 46142, [alphaManifest]));
  assert.equal(portConflict.status, 2);
  assert.equal(existsSync(portRoot), false);

  const hostPortRoot = join(testRoot, "host-port");
  const hostPort = run(createArgs("delta", hostPortRoot, 3655, 46152));
  assert.equal(hostPort.status, 2);
  assert.equal(existsSync(hostPortRoot), false);

  const invalidPortRoot = join(testRoot, "invalid-port");
  const invalidPort = run(createArgs("delta-two", invalidPortRoot, "not-a-port", 46153));
  assert.equal(invalidPort.status, 2);
  assert.equal(existsSync(invalidPortRoot), false);

  for (const [id, name] of [["qingqi", "old-brand"], ["../escape", "traversal"], ["Upper", "uppercase"], ["aij-foundation", "host-identity"]]) {
    const output = join(testRoot, name);
    const rejected = run(createArgs(id, output, 46161, 46162));
    assert.equal(rejected.status, 2, id);
    assert.equal(existsSync(output), false, id);
  }

  const occupied = join(testRoot, "occupied");
  mkdirSync(occupied);
  const sentinel = join(occupied, "keep.txt");
  writeFileSync(sentinel, "caller-owned");
  const existing = run(createArgs("epsilon", occupied, 46171, 46172));
  assert.equal(existing.status, 2);
  assert.equal(readFileSync(sentinel, "utf8"), "caller-owned");

  const fakeOld = join(testRoot, "qingqi-ai-consultant");
  mkdirSync(fakeOld);
  const oldPathOutput = join(fakeOld, "should-not-be-created");
  const oldPath = run(createArgs("zeta", oldPathOutput, 46181, 46182));
  assert.equal(oldPath.status, 2);
  assert.equal(existsSync(oldPathOutput), false);

  const oldLink = join(testRoot, "old-product-link");
  symlinkSync(fakeOld, oldLink);
  const symlinkOutput = join(oldLink, "also-should-not-exist");
  const symlinkPath = run(createArgs("eta", symlinkOutput, 46191, 46192));
  assert.equal(symlinkPath.status, 2);
  assert.equal(existsSync(symlinkOutput), false);
  const peerOutput = join(testRoot, "old-peer");
  const oldPeer = run(createArgs("theta", peerOutput, 46201, 46202, [fakeOld]));
  assert.equal(oldPeer.status, 2);
  assert.equal(existsSync(peerOutput), false);
});

test("generated identity cannot be overridden from a project's local env before host launch", () => {
  const alphaRoot = join(testRoot, "alpha");
  writeFileSync(join(alphaRoot, ".env"), "PROJECT_ID=other-project\nJWT_SECRET=synthetic-only-not-a-real-secret\n", { mode: 0o600 });
  const rejected = run(["run", "--dir", alphaRoot, "--app", "api", "--mode", "dev"]);
  assert.equal(rejected.status, 2);
  assert.match(rejected.stderr, /immutable/);
  assert.doesNotMatch(rejected.stdout + rejected.stderr, /synthetic-only-not-a-real-secret/);
});

test("host runtime cannot be redirected to a generated project root", () => {
  assert.throws(() => environment.resolveRuntimeEnvironment({ AIJ_PROJECT_ROOT: testRoot }), /only valid for the project runtime profile/);
});
