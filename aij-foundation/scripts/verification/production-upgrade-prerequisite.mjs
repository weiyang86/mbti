import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { validateSecurityProposal } from "./production-dependency-security.mjs";

const require = createRequire(import.meta.url), yaml = require("js-yaml");
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
assert.equal(git("branch", "--show-current"), "dev");
assert.equal(git("remote", "get-url", "origin"), "git@github.com:weiyang86/aij-foundation.git");
const baseline = "337d8a642be86fb618a20a056c4a812f462f1720";
git("merge-base", "--is-ancestor", baseline, "HEAD");
const oldText = file => execFileSync("git", ["show", baseline + ":" + file], { encoding: "utf8" });
const old = yaml.load(oldText("pnpm-lock.yaml")), next = yaml.load(readFileSync("pnpm-lock.yaml", "utf8"));
const expected = structuredClone(old.importers);
for (const [importer, type, name] of [[".", "devDependencies", "eslint-config-next"], ["apps/web", "dependencies", "next"]]) {
  expected[importer][type][name] = next.importers[importer][type][name];
  assert.equal(expected[importer][type][name].specifier, "16.4.1");
}
assert.deepEqual(next.importers, expected, "Unrelated importer change");
function closure(lock) {
  const roots = [lock.importers["."].devDependencies["eslint-config-next"], lock.importers["apps/web"].dependencies.next];
  const queue = roots.map((v, i) => ["eslint-config-next", "next"][i] + "@" + v.version), seen = new Set();
  for (let i = 0; i < queue.length; i++) {
    const key = queue[i]; if (seen.has(key)) continue; seen.add(key);
    const snapshot = lock.snapshots[key]; assert.ok(snapshot, "Missing snapshot " + key);
    for (const [name, version] of Object.entries({ ...snapshot.dependencies, ...snapshot.optionalDependencies })) {
      if (version.startsWith("link:")) continue;
      queue.push(name + "@" + version);
    }
  }
  return seen;
}
const a = closure(old), b = closure(next), union = new Set([...a, ...b]);
const packageNames = set => new Set([...set].map(k => k.split("(")[0]));
const ap = packageNames(a), bp = packageNames(b);
for (const [key, value] of Object.entries(next.packages)) {
  if (old.packages[key]) assert.deepEqual(value, old.packages[key], "Existing integrity/metadata mutation " + key);
  else assert.ok(bp.has(key), "New package outside paired dependency closure " + key);
}
for (const key of Object.keys(old.packages)) if (!next.packages[key]) assert.ok(ap.has(key), "Unrelated package removed " + key);
for (const [key, value] of Object.entries(next.snapshots)) if (old.snapshots[key] && JSON.stringify(value) !== JSON.stringify(old.snapshots[key])) assert.ok(union.has(key), "Unrelated snapshot changed " + key);
for (const key of Object.keys(old.snapshots)) if (!next.snapshots[key]) assert.ok(a.has(key), "Unrelated snapshot removed " + key);
const manifests = Object.fromEntries(["package.json", "apps/api/package.json", "apps/web/package.json"].map(file => [file, JSON.parse(oldText(file))]));
for (const [file, original] of Object.entries(manifests)) {
  const wanted = structuredClone(original);
  if (file === "package.json") wanted.devDependencies["eslint-config-next"] = "16.4.1";
  if (file === "apps/web/package.json") wanted.dependencies.next = "16.4.1";
  assert.deepEqual(JSON.parse(readFileSync(file)), wanted);
}
const directory = ".artifacts/auto-ai-program-20261105/AF-177/";
const result = validateSecurityProposal(JSON.parse(readFileSync("docs/execution/AF-177-package-updates.json")), {
  nodeVersion: process.versions.node, pnpmVersion: execFileSync("pnpm", ["--version"], { encoding: "utf8" }).trim(), manifests,
  registryMetadata: Object.fromEntries(["next", "eslint-config-next"].map(name => [name, JSON.parse(readFileSync(directory + "registry-" + name + ".json"))]))
});
const task = JSON.parse(readFileSync("docs/planning/CODING_QUEUE.json")).taskExecutions.find(v => v.formalTaskId === "AF-177");
assert.equal(task.candidateStopped, true);
assert.equal(task.candidateCommit, "13195a5992b9d07fc7f5ddd182353ea544416d73");
mkdirSync(".artifacts/af-177", { recursive: true });
writeFileSync(directory + "lock-closure-review.json", JSON.stringify({ status: "PASS", result, directChanges: 2, newPackages: Object.keys(next.packages).filter(k => !old.packages[k]), removedPackages: Object.keys(old.packages).filter(k => !next.packages[k]), unchangedExistingPackageMetadata: true }, null, 2) + "\n");
console.log("Stopped candidate, official exact proposal, two paired pins and dependency-only closure verified");
