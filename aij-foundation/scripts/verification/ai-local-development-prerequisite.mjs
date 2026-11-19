import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assertRepository, assertExplicitEnvironmentSupport } from "../ai-local-development/config.mjs";
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const read = path => JSON.parse(readFileSync(path, "utf8"));
assertRepository(); assertExplicitEnvironmentSupport();
const git = args => execFileSync("git", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }).trim();
assert.equal(git(["branch", "--show-current"]), "dev");
assert.equal(resolve(git(["rev-parse", "--git-dir"])), resolve(git(["rev-parse", "--git-common-dir"])));
assert.equal(git(["remote", "get-url", "origin"]), "git@github.com:weiyang86/aij-foundation.git");
const manifestPath = "docs/planning/auto-ai-program-20261105/W22/SOURCE_BOOTSTRAP.json";
assert.equal(sha(readFileSync(manifestPath)), "1396522f0782f4e9fa5478786ea67d78cde328ec745de2725a85decff978eea3");
const manifest = read(manifestPath); assert.equal(manifest.files.length, 1026);
const tree = new Map(git(["ls-tree", "-rz", manifest.sourceCommit]).split("\0").filter(Boolean).map(row => {
  const [header, path] = row.split("\t"), [mode, , oid] = header.split(" "); return [path, { mode, oid }];
}));
const blobs = execFileSync("git", ["cat-file", "--batch"], { input: manifest.files.map(file => file.oid + "\n").join(""), maxBuffer: 64 * 1024 * 1024 });
let offset = 0;
for (const file of manifest.files) {
  assert.deepEqual(tree.get(file.path), { mode: file.mode, oid: file.oid });
  const end = blobs.indexOf(10, offset), [oid, type, count] = blobs.subarray(offset, end).toString().split(" ");
  assert.equal(oid, file.oid); assert.equal(type, "blob"); assert.equal(Number(count), file.bytes);
  const data = blobs.subarray(end + 1, end + 1 + Number(count)); assert.equal(sha(data), file.sha256);
  offset = end + 2 + Number(count);
}
const receipt = read(".artifacts/auto-ai-program-20261105/W22/AF220-candidate-receipt.json");
assert.equal(receipt.candidateStopped, true); assert.equal(receipt.candidateCommit, "daf075cf5d0f4309cfdfe408af8c7eced82ead79");
for (const file of receipt.paths) assert.equal(sha(execFileSync("git", ["show", receipt.candidateCommit + ":" + file.path])), file.sha256, file.path);
const tasks = JSON.parse(execFileSync("orca", ["orchestration", "task-list", "--run", "run_72ed314cead8", "--json"], { maxBuffer: 8 * 1024 * 1024 })).result.tasks;
for (const id of ["task_180f373a05bc", "task_ca3af94d7c60"]) assert.equal(tasks.find(task => task.id === id)?.status, "completed", id);
const sources = read("docs/planning/auto-ai-program-20261105/W22/AF-220-ROOT_SOURCES.json");
for (const file of sources.files) assert.equal(sha(readFileSync(file.path)), file.sha256, file.path);
// Shared files contain unrelated inherited changes. Freeze the exact functions
// this card owns, so its verified commit does not depend on pending AF191 code.
for (const slice of sources.sharedFunctionSlices) {
  const text = readFileSync(slice.path, "utf8"), start = text.indexOf(slice.begin);
  assert(start >= 0 && text.indexOf(slice.begin, start + 1) === -1);
  const end = slice.end === null ? text.length : text.indexOf(slice.end, start + slice.begin.length);
  assert(end > start); assert.equal(sha(Buffer.from(text.slice(start, end))), slice.sha256, slice.path + ":" + slice.begin);
}
console.log(JSON.stringify({ task: "AF-220", immutableSourceBlobs: 1026, stoppedCandidate: true, codeDependencies: "ACTUAL_COMPLETED", targetAcceptance: "NOT_INFERRED_FROM_HASHES" }));
