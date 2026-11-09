import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { isDeepStrictEqual } from "node:util";
import { validateRemediationTargets } from "./production-dependency-remediation.mjs";

const require = createRequire(import.meta.url), yaml = require("js-yaml"), baseline = "4e4f2638bf09a69be63c61dba8cac387e655c422";
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
assert.equal(git("branch", "--show-current"), "dev");
assert.equal(git("remote", "get-url", "origin"), "git@github.com:weiyang86/aij-foundation.git");
git("merge-base", "--is-ancestor", baseline, "HEAD");
const queue = JSON.parse(readFileSync("docs/planning/CODING_QUEUE.json")), card = queue.taskExecutions.find(c => c.formalTaskId === "AF-181");
assert.equal(card.candidateStopped, true); assert.equal(card.candidateCommit, "2e719c38f2c822ac78d5e00d2e19b77a4862e852");
assert.match(readFileSync(card.spec, "utf8"), /ROOT COORDINATION AMENDMENT msg_76d615d44101/);
const directory = ".artifacts/auto-ai-program-20261105/AF-181/", plan = JSON.parse(readFileSync("docs/execution/AF-181-package-updates.json"));
const registryMetadata = Object.fromEntries(Object.keys(plan.registryEvidence).map(name => [name, JSON.parse(readFileSync(directory + "registry/" + name.replaceAll("/", "+") + ".json"))]));
validateRemediationTargets(plan, { manifests: Object.fromEntries(["package.json", "apps/api/package.json", "apps/web/package.json"].map(f => [f, JSON.parse(readFileSync(f))])), lockfile: readFileSync("pnpm-lock.yaml", "utf8"), registryMetadata, nodeVersion: process.versions.node, pnpmVersion: execFileSync("pnpm", ["--version"], { encoding: "utf8" }).trim() });
const before = yaml.load(execFileSync("git", ["show", baseline + ":pnpm-lock.yaml"], { encoding: "utf8" })), after = yaml.load(readFileSync("pnpm-lock.yaml", "utf8"));
const expectedImporters = structuredClone(before.importers);
for (const [section, name] of [["dependencies", "@prisma/client"], ["devDependencies", "prisma"]]) expectedImporters["apps/api"][section][name] = after.importers["apps/api"][section][name];
assert.deepEqual(after.importers, expectedImporters, "Unrelated importer changed");
function closure(lock) {
  const api = lock.importers["apps/api"], roots = [["@prisma/client", api.dependencies["@prisma/client"].version], ["prisma", api.devDependencies.prisma.version], ["@nestjs/platform-express", api.dependencies["@nestjs/platform-express"].version]];
  const queue = roots.map(([name, version]) => name + "@" + version), visited = new Set();
  for (let i = 0; i < queue.length; i++) {
    const key = queue[i]; if (visited.has(key)) continue; visited.add(key);
    const snapshot = lock.snapshots[key]; assert.ok(snapshot, "Missing dependency snapshot " + key);
    for (const [name, version] of Object.entries({ ...snapshot.dependencies, ...snapshot.optionalDependencies })) if (!version.startsWith("link:")) queue.push(name + "@" + version);
  }
  return new Set([...visited].map(key => key.split("(")[0]));
}
const oldClosure = closure(before), newClosure = closure(after), newPackages = [], removedPackages = [], normalizedPeers = [];
for (const [key, value] of Object.entries(after.packages)) {
  if (before.packages[key]) assert.deepEqual(value, before.packages[key], "Existing integrity/metadata drift " + key);
  else { assert.ok(newClosure.has(key), "New package outside security closure " + key); newPackages.push(key); }
}
for (const key of Object.keys(before.packages)) if (!after.packages[key]) { assert.ok(oldClosure.has(key), "Unrelated package removed " + key); removedPackages.push(key); }
const canonical = snapshot => {
  const result = structuredClone(snapshot);
  for (const field of ["dependencies", "optionalDependencies"]) if (result[field]) for (const name of Object.keys(result[field])) result[field][name] = result[field][name].split("(")[0];
  return result;
};
function equivalent(lock, key, value) {
  const base = key.split("(")[0];
  return Object.entries(lock.snapshots).some(([other, snapshot]) => other.split("(")[0] === base && isDeepStrictEqual(canonical(snapshot), canonical(value)));
}
for (const [key, snapshot] of Object.entries(after.snapshots)) {
  const base = key.split("(")[0];
  if (base === "express@5.2.1" || base === "@nestjs/platform-express@11.1.19") {
    const expected = structuredClone(before.snapshots[key]);
    if (base.startsWith("express")) { expected.dependencies["body-parser"] = "2.4.0"; expected.dependencies.qs = "6.16.1"; }
    else expected.dependencies.multer = "2.5.0";
    assert.deepEqual(snapshot, expected); continue;
  }
  if (newPackages.includes(base)) continue;
  assert.ok(equivalent(before, key, snapshot), "Unrelated dependency version or semantics changed " + key);
  if (before.snapshots[key] && !isDeepStrictEqual(before.snapshots[key], snapshot)) normalizedPeers.push(key);
}
for (const [key, snapshot] of Object.entries(before.snapshots)) if (!after.snapshots[key] && !removedPackages.includes(key.split("(")[0])) assert.ok(equivalent(after, key, snapshot), "Unrelated snapshot removed " + key);
writeFileSync(directory + "lock-closure-review.json", JSON.stringify({ status: "PASS", directChanges: 2, permanentScopedOverrides: 2, newPackages, removedPackages, sameVersionPeerContextNormalization: normalizedPeers, unchangedExistingIntegrityAndMetadata: true, note: "Internal engines-version package follows official Prisma6.19.3 dependency; API/CLI/client stay6.19.3, actual engine/config/PG tests remain required" }, null, 2) + "\n");
console.log("Stopped candidate, exact proposal and security-only closure verified; existing peer normalization retains identical package versions");
