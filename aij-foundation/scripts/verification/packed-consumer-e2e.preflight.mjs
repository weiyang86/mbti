import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { assertPortAvailable } from "../port-availability.mjs";

const root = process.cwd();
const baseline = JSON.parse(readFileSync(".artifacts/af-076/e2e-baseline.json", "utf8"));
const queue = JSON.parse(readFileSync("docs/planning/CODING_QUEUE.json", "utf8"));
const snapshot = readFileSync(".artifacts/continuous/CODING_QUEUE.snapshot.2026-10-31.json");
const git = (args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const task = (id) => queue.taskExecutions.find((entry) => entry.formalTaskId === id);

assert.equal(git(["branch", "--show-current"]), "dev");
const currentHead = git(["rev-parse", "HEAD"]);
if (currentHead !== baseline.head) {
  const descendant = spawnSync("git", ["merge-base", "--is-ancestor", baseline.head, currentHead], { cwd: root, encoding: "utf8", shell: false });
  assert.equal(descendant.status, 0, "the recorded AF-076 baseline must be an ancestor of the current dev HEAD");
  assert.ok(["CODE_VERIFIED", "CODE_VERIFIED_COMMITTED_PUSHED"].includes(task("AF-076")?.status), "a later HEAD is accepted only after AF-076 code verification");
}
assert.equal(createHash("sha256").update(snapshot).digest("hex"), "c41e1aafb3a765713099ddc6a2f77ad034cb108c2cd7a3e1fd6f10911577bb3b");
assert.equal(createHash("sha256").update(snapshot).digest("hex"), baseline.snapshotSha256);
assert.equal(queue.formalTaskIdAssignments?.ids?.["G13-04"], "AF-076");
assert.equal(queue.taskExecutions.filter((entry) => entry.formalTaskId === "AF-076").length, 1);
assert.equal(task("AF-076")?.ownerAcceptance, "PENDING_UNIFIED_OWNER_CHECK");
assert.ok(["IN_PROGRESS", "IN_PROGRESS_DECOMPOSED", "CODE_VERIFIED", "CODE_VERIFIED_COMMITTED_PUSHED"].includes(task("AF-076")?.status));
for (const id of ["AF-077", "AF-078", "AF-079"]) {
  const child = task(id);
  assert.equal(child?.ownerAcceptance, "PENDING_UNIFIED_OWNER_CHECK");
  assert.ok(["CODE_VERIFIED", "CODE_VERIFIED_COMMITTED_PUSHED"].includes(child?.status), id + " must be code verified");
  assert.equal(child?.git?.status, "COMMITTED_PUSHED", id + " must be pushed before parent end-to-end acceptance");
  assert.equal(child?.git?.push?.readbackSha, child?.git?.commitSha, id + " remote readback must match its committed SHA");
}
assert.equal(queue.formalTaskIdAssignmentsHistory.filter((entry) => entry.ids?.["G13-04A"] === "AF-077").length, 1);
assert.equal(queue.formalTaskIdAssignmentsHistory.filter((entry) => entry.ids?.["G13-04B"] === "AF-078").length, 1);
assert.equal(queue.formalTaskIdAssignmentsHistory.filter((entry) => entry.ids?.["G13-04C"] === "AF-079").length, 1);

const migrationRoot = resolve(root, "apps/api/prisma/migrations");
const migrations = readdirSync(migrationRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory() && !entry.name.startsWith("._"));
assert.equal(migrations.length, 8);
assert.ok(readFileSync(resolve(root, "apps/api/src/files/local-storage.adapter.ts"), "utf8").includes("class LocalStorageAdapter"));
assert.ok(readFileSync(resolve(root, "apps/api/src/files/file-content.service.ts"), "utf8").includes("class FileContentService"));
assert.ok(readFileSync(resolve(root, "scripts/distribution/pack-aij-base.mjs"), "utf8").includes("PACKED_LOCAL_PRIVATE_CONSUMER"));

for (const port of [37265, 37266, 55444, 55445]) await assertPortAvailable(port);
const image = "postgres:16-alpine@sha256:e013e867e712fec275706a6c51c966f0bb0c93cfa8f51000f85a15f9865a28cb";
const inspected = spawnSync("docker", ["image", "inspect", image, "--format", "{{.Id}}"], { cwd: root, encoding: "utf8", shell: false, timeout: 10000 });
assert.equal(inspected.status, 0, "pinned PostgreSQL image must already be cached; preflight must not pull it");
assert.match(inspected.stdout.trim(), /^sha256:/);

console.log("AF-076 preflight PASS: frozen snapshot and AF-077/078/079 pushed dependencies verified; unique AF-076 parent remains pending owner acceptance; private packed-consumer owners, free loopback endpoints and cached PostgreSQL image confirmed");
