import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { assertPortAvailable } from "../port-availability.mjs";

const root = process.cwd();
const baseline = JSON.parse(readFileSync(".artifacts/af-078/baseline.json", "utf8"));
const queue = JSON.parse(readFileSync("docs/planning/CODING_QUEUE.json", "utf8"));
const snapshotPath = ".artifacts/continuous/CODING_QUEUE.snapshot.2026-10-31.json";
const snapshot = readFileSync(snapshotPath);
const task = (id) => queue.taskExecutions.find((entry) => entry.formalTaskId === id);
const git = (args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();

assert.equal(git(["branch", "--show-current"]), "dev");
assert.equal(git(["rev-parse", "HEAD"]), baseline.head);
assert.equal(baseline.originDev, baseline.head);
assert.equal(createHash("sha256").update(snapshot).digest("hex"), baseline.snapshot.sha256);
assert.equal(baseline.snapshot.sha256, baseline.snapshot.expectedSha256);
assert.equal(task("AF-076")?.status, "IN_PROGRESS_DECOMPOSED");
assert.equal(task("AF-076")?.ownerAcceptance, "PENDING_UNIFIED_OWNER_CHECK");
assert.equal(task("AF-077")?.status, "CODE_VERIFIED_COMMITTED_PUSHED");
assert.equal(task("AF-077")?.ownerAcceptance, "PENDING_UNIFIED_OWNER_CHECK");
assert.equal(task("AF-078")?.status, "IN_PROGRESS");
assert.equal(task("AF-078")?.ownerAcceptance, "PENDING_UNIFIED_OWNER_CHECK");
assert.equal(task("AF-079")?.status, "AUTHORIZED_WAITING_AF078_CODE_VERIFIED");
assert.equal(task("AF-079")?.ownerAcceptance, "PENDING_UNIFIED_OWNER_CHECK");

for (const [alias, id] of Object.entries({ "G13-04A": "AF-077", "G13-04B": "AF-078", "G13-04C": "AF-079" })) {
  assert.equal(queue.formalTaskIdAssignmentsHistory.filter((entry) => entry.ids?.[alias] === id).length, 1);
  assert.equal(queue.taskExecutions.filter((entry) => entry.formalTaskId === id).length, 1);
}

const runtime = createRequire(resolve(root, "package.json"))("./scripts/runtime-environment.cjs");
const projectId = "aij-af078-consumer";
const dbName = "aij_af078_consumer_test";
const dbUser = dbName;
const dbPassword = randomBytes(32).toString("hex");
const projectRoot = resolve(root, ".artifacts/af-078");
const validInput = {
  projectId,
  environment: "test",
  webPort: 37255,
  apiPort: 37256,
  origin: "http://127.0.0.1:37255",
  apiUrl: "http://127.0.0.1:37256/api",
  issuer: "urn:aij:" + projectId + ":test:api",
  cookiePrefix: "aij_af078_consumer_test",
  storageRoot: ".local-data/" + projectId + "/test/storage",
  enabledPlugins: [],
  capabilities: { auth: false, clientAuth: false, database: true, storage: false },
  secrets: {},
  databaseUrl: "postgresql://" + dbUser + ":" + dbPassword + "@127.0.0.1:55443/" + dbName + "?schema=public"
};
const resolved = runtime.resolveProjectConfiguration(validInput, { projectRoot });
assert.deepEqual(
  { host: resolved.databaseTarget.host, port: resolved.databaseTarget.port, database: resolved.databaseTarget.database, user: resolved.databaseTarget.user },
  { host: "127.0.0.1", port: 55443, database: dbName, user: dbUser }
);
assert.throws(() => runtime.resolveProjectConfiguration({ ...validInput, databaseUrl: validInput.databaseUrl.replace("55443", "55433") }, { projectRoot }), /loopback and scoped/);
assert.throws(() => runtime.resolveProjectConfiguration({ ...validInput, databaseUrl: validInput.databaseUrl.replace("/" + dbName, "/aij_foundation_dev") }, { projectRoot }), /loopback and scoped/);
assert.throws(() => runtime.resolveProjectConfiguration({ ...validInput, databaseUrl: validInput.databaseUrl.replace("127.0.0.1", "192.0.2.10") }, { projectRoot }), /loopback and scoped/);

for (const port of [37255, 37256, 55443]) await assertPortAvailable(port);
const dockerImage = spawnSync("docker", ["image", "inspect", "postgres:16-alpine@sha256:e013e867e712fec275706a6c51c966f0bb0c93cfa8f51000f85a15f9865a28cb", "--format", "{{.Id}}"], { cwd: root, encoding: "utf8", shell: false, timeout: 10000 });
assert.equal(dockerImage.error, undefined, "pinned PostgreSQL image is inspectable");
assert.equal(dockerImage.status, 0, "pinned PostgreSQL image must already be present; no unreviewed image pull");
assert.match(dockerImage.stdout.trim(), /^sha256:/);
console.log("AF-078 preflight PASS: frozen queue, AF-077 dependency, unique AF-078 assignment, generated-project DB target allowlist, free loopback ports, and pinned local PostgreSQL image");
