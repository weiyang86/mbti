import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";
import { repositoryRoot } from "./registry.mjs";

const requireApi = createRequire(join(repositoryRoot, "apps/api/package.json"));
const { LocalStorageAdapter, LocalStorageError } = requireApi(join(repositoryRoot, "apps/api/dist/files/local-storage.adapter.js"));
const evidenceRoot = join(repositoryRoot, ".artifacts/af-063");
await mkdir(evidenceRoot, { recursive: true, mode: 0o700 });
const fixture = await mkdtemp(join(evidenceRoot, "filesystem-"));

function adapter(projectId, environment, storageRoot) {
  const values = { projectId, environment, storageRoot, repositoryRoot };
  return new LocalStorageAdapter({ getOrThrow: key => values[key] });
}

function rejectsCode(error, expected) {
  assert.ok(error instanceof LocalStorageError);
  assert.equal(error.code, expected);
  assert.equal(error.message.includes(repositoryRoot), false, "storage errors do not disclose absolute paths");
  return true;
}

test("G12-05 API host uses the public StorageAdapter contract against the real filesystem", async () => {
  const packageSource = await readFile(join(repositoryRoot, "packages/runtime-contracts/src/index.ts"), "utf8");
  const hostSource = await readFile(join(repositoryRoot, "apps/api/src/files/local-storage.adapter.ts"), "utf8");
  assert.match(packageSource, /export interface StorageAdapter/);
  assert.match(hostSource, /class LocalStorageAdapter implements StorageAdapter/);

  const storageRoot = join(fixture, "aij-af063", "development", "storage");
  const storage = adapter("aij-af063", "development", storageRoot);
  const key = randomUUID();
  const bytes = Buffer.from("synthetic AF-063 storage-contract probe");
  const result = await storage.write(key, bytes);
  assert.deepEqual(result, { path: "objects/" + key, size: bytes.length });
  assert.deepEqual(await storage.read(key), bytes);
  assert.equal(await storage.exists(key), true);
  const objectStat = await lstat(join(storageRoot, result.path));
  assert.equal(objectStat.mode & 0o077, 0, "stored synthetic object has no group/other permissions");
  await assert.rejects(storage.write(key, Buffer.from("replacement")), error => rejectsCode(error, "OBJECT_EXISTS"));
  assert.deepEqual(await storage.read(key), bytes, "exclusive creation does not replace an existing object");
  await storage.remove(key);
  assert.equal(await storage.exists(key), false);
  await assert.rejects(storage.read(key), error => rejectsCode(error, "OBJECT_MISSING"));
});

test("G12-05 storage rejects invalid keys and a project-root symlink before outside writes", async () => {
  const plainRoot = join(fixture, "aij-af063", "development", "storage");
  const storage = adapter("aij-af063", "development", plainRoot);
  assert.throws(() => storage.relativePath("../escape"), error => rejectsCode(error, "OBJECT_KEY_INVALID"));

  const outside = join(fixture, "outside");
  const linkRoot = join(fixture, "linked-project");
  await mkdir(outside, { recursive: true, mode: 0o700 });
  await symlink(outside, linkRoot);
  const linkedStorage = adapter("linked-project", "development", join(linkRoot, "development", "storage"));
  await assert.rejects(linkedStorage.write(randomUUID(), Buffer.from("must not escape")), error => rejectsCode(error, "STORAGE_PATH_UNSAFE"));
  assert.deepEqual(await (await import("node:fs/promises")).readdir(outside), [], "symlink refusal creates no outside file");
});

test.after(async () => {
  await rm(fixture, { recursive: true, force: true });
});
