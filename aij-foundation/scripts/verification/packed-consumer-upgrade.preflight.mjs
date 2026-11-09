import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { assertPortAvailable } from "../port-availability.mjs";

const root = process.cwd();
const baseline = JSON.parse(readFileSync(".artifacts/af-079/baseline.json", "utf8"));
const queue = JSON.parse(readFileSync("docs/planning/CODING_QUEUE.json", "utf8"));
const snapshotBytes = readFileSync(".artifacts/continuous/CODING_QUEUE.snapshot.2026-10-31.json");
const task = (id) => queue.taskExecutions.find((entry) => entry.formalTaskId === id);
const git = (args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();

assert.equal(git(["branch", "--show-current"]), "dev");
assert.equal(git(["rev-parse", "HEAD"]), baseline.head);
assert.equal(createHash("sha256").update(snapshotBytes).digest("hex"), baseline.queueSnapshot.sha256);
assert.equal(baseline.queueSnapshot.sha256, baseline.queueSnapshot.expected);
assert.equal(task("AF-076")?.status, "IN_PROGRESS_DECOMPOSED");
assert.equal(task("AF-076")?.ownerAcceptance, "PENDING_UNIFIED_OWNER_CHECK");
for (const id of ["AF-077", "AF-078"]) {
  assert.equal(task(id)?.status, "CODE_VERIFIED_COMMITTED_PUSHED");
  assert.equal(task(id)?.ownerAcceptance, "PENDING_UNIFIED_OWNER_CHECK");
}
assert.ok(["AUTHORIZED_READY", "IN_PROGRESS"].includes(task("AF-079")?.status));
assert.equal(task("AF-079")?.ownerAcceptance, "PENDING_UNIFIED_OWNER_CHECK");
assert.equal(queue.taskExecutions.filter((entry) => entry.formalTaskId === "AF-079").length, 1);
assert.equal(queue.formalTaskIdAssignmentsHistory.filter((entry) => entry.ids?.["G13-04C"] === "AF-079").length, 1);
assert.equal(queue.formalTaskIdAssignments?.ids?.["G13-04C"], undefined);

const migrationRoot = resolve(root, "apps/api/prisma/migrations");
const migrations = readdirSync(migrationRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory() && !entry.name.startsWith("._"));
assert.equal(migrations.length, 8);
assert.equal(migrations.at(-1).name, "20261030140000_plugin_operation_rollback_retry");
assert.match(readFileSync(resolve(migrationRoot, migrations.at(-1).name, "migration.sql"), "utf8"), /retry_of_operation_id/);
const schema = readFileSync("apps/api/prisma/schema.prisma", "utf8");
assert.match(schema, /model FileAsset\s*\{/);
assert.match(schema, /model PluginOperation\s*\{/);
assert.match(readFileSync("apps/api/src/files/local-storage.adapter.ts", "utf8"), /class LocalStorageAdapter/);
assert.match(readFileSync("apps/api/src/files/file-content.service.ts", "utf8"), /class FileContentService/);

for (const port of [37265, 37266, 55444, 55445]) await assertPortAvailable(port);
const image = "postgres:16-alpine@sha256:e013e867e712fec275706a6c51c966f0bb0c93cfa8f51000f85a15f9865a28cb";
const inspected = spawnSync("docker", ["image", "inspect", image, "--format", "{{.Id}}"], { cwd: root, encoding: "utf8", shell: false, timeout: 10000 });
assert.equal(inspected.error, undefined, "pinned PostgreSQL image is inspectable");
assert.equal(inspected.status, 0, "pinned image must already be local; no implicit pull");
assert.match(inspected.stdout.trim(), /^sha256:/);

console.log("AF-079 preflight PASS: snapshot, AF-077/078 dependency, unique AF-079 assignment, migration/file owner, isolated loopback ports, and cached PostgreSQL image");
