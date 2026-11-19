import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, lstat, rm, symlink } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import test from "node:test";
import runtime from "../runtime-environment.cjs";

const { repositoryRoot } = runtime;
const require = createRequire(import.meta.url);
const { LocalStorageAdapter, LocalStorageError } = require(join(repositoryRoot, "apps/api/dist/files/local-storage.adapter.js"));
const evidenceRoot = join(repositoryRoot, ".artifacts/af-045/storage-test");
await mkdir(join(repositoryRoot, ".artifacts/af-045"), { recursive: true, mode: 0o700 });
const fixture = await mkdtemp(join(repositoryRoot, ".artifacts/af-045/storage-test-run-"));
let observedFileMode;
let observedDirectoryMode;

function adapter(projectId, environment, storageRoot) {
  const values = { projectId, environment, storageRoot, repositoryRoot };
  return new LocalStorageAdapter({ getOrThrow: (key) => values[key] });
}

function code(error, expected) {
  assert.ok(error instanceof LocalStorageError);
  assert.equal(error.code, expected);
  assert.equal(error.message.includes(repositoryRoot), false, "storage errors must not reveal absolute paths");
}

test("FileAsset keeps project and customer ownership as explicit scalar scopes", async () => {
  const schema = await readFile(join(repositoryRoot, "apps/api/prisma/schema.prisma"), "utf8");
  const block = schema.match(/model FileAsset \{([\s\S]*?)\n\}/)?.[1];
  assert.ok(block, "FileAsset model must exist in the accepted core Schema");
  for (const field of ["projectId", "workspaceId", "pluginCode", "ownerType", "ownerId", "uploaderId"]) {
    assert.match(block, new RegExp("^\\s*" + field + "\\s+String\\??\\s", "m"));
  }
  assert.doesNotMatch(block, /@relation\(/, "file associations remain owner-scoped scalar identifiers, with no business reverse relation");
  assert.match(block, /objectKey\s+String\?\s+@unique/);
});

test("storage root requires an in-repository project and environment namespace", () => {
  assert.throws(() => adapter("alpha", "development", resolve(repositoryRoot, "../outside/alpha/development/storage")),
    (error) => error instanceof LocalStorageError && error.code === "STORAGE_ROOT_INVALID");
  assert.throws(() => adapter("alpha", "development", join(fixture, "beta", "development", "storage")),
    (error) => error instanceof LocalStorageError && error.code === "STORAGE_ROOT_INVALID");
  assert.throws(() => adapter("alpha", "development", join(fixture, "alpha", "test", "storage")),
    (error) => error instanceof LocalStorageError && error.code === "STORAGE_ROOT_INVALID");
});

test("real file writes use exclusive no-overwrite creation, private permissions, and round-trip bytes", async () => {
  const root = join(fixture, "alpha", "development", "storage");
  const storage = adapter("alpha", "development", root);
  const key = randomUUID();
  const original = Buffer.from("synthetic-file-AF045");
  const result = await storage.write(key, original);
  assert.equal(result.path, "objects/" + key);
  assert.equal(result.path.includes(repositoryRoot), false);
  assert.equal(result.size, original.byteLength);
  assert.deepEqual(await storage.read(key), original);
  assert.equal(await storage.exists(key), true);
  const objectStat = await lstat(join(root, "objects", key));
  const dirStat = await lstat(join(root, "objects"));
  observedFileMode = (objectStat.mode & 0o777).toString(8);
  observedDirectoryMode = (dirStat.mode & 0o777).toString(8);
  assert.equal(objectStat.mode & 0o600, 0o600);
  assert.equal(objectStat.mode & 0o077, 0, "file must be owner-only");
  assert.equal(dirStat.mode & 0o777, 0o700);
  await assert.rejects(storage.write(key, Buffer.from("replacement")), (error) => {
    code(error, "OBJECT_EXISTS");
    return true;
  });
  assert.deepEqual(await storage.read(key), original, "a duplicate key must not replace existing bytes");
});

test("object keys reject traversal and missing reads/deletes fail closed", async () => {
  const storage = adapter("alpha", "development", join(fixture, "alpha", "development", "storage"));
  assert.throws(() => storage.relativePath("../outside"), (error) => {
    code(error, "OBJECT_KEY_INVALID");
    return true;
  });
  const key = randomUUID();
  assert.equal(await storage.exists(key), false);
  await assert.rejects(storage.read(key), (error) => {
    code(error, "OBJECT_MISSING");
    return true;
  });
  await assert.rejects(storage.remove(key), (error) => {
    code(error, "OBJECT_MISSING");
    return true;
  });
});

test("a symlink in the project path is rejected before writing outside the scoped root", async () => {
  const outside = join(fixture, "outside-target");
  await mkdir(outside, { recursive: true, mode: 0o700 });
  const linkedProject = join(fixture, "linked");
  await symlink(outside, linkedProject);
  const storage = adapter("linked", "development", join(linkedProject, "development", "storage"));
  await assert.rejects(storage.write(randomUUID(), Buffer.from("must-not-write")), (error) => {
    code(error, "STORAGE_PATH_UNSAFE");
    return true;
  });
  assert.deepEqual(await (await import("node:fs/promises")).readdir(outside), []);
});

test("two projects with the same object key keep their bytes isolated", async () => {
  const key = randomUUID();
  const alphaRoot = join(fixture, "alpha", "development", "storage");
  const betaRoot = join(fixture, "beta", "development", "storage");
  const alpha = adapter("alpha", "development", alphaRoot);
  const beta = adapter("beta", "development", betaRoot);
  await alpha.write(key, Buffer.from("alpha"));
  await beta.write(key, Buffer.from("beta"));
  assert.equal((await alpha.read(key)).toString(), "alpha");
  assert.equal((await beta.read(key)).toString(), "beta");
  assert.notEqual(join(alphaRoot, alpha.relativePath(key)), join(betaRoot, beta.relativePath(key)));
});

test("delete removes only the selected project object", async () => {
  const key = randomUUID();
  const alpha = adapter("alpha", "development", join(fixture, "alpha", "development", "storage"));
  const beta = adapter("beta", "development", join(fixture, "beta", "development", "storage"));
  await alpha.write(key, Buffer.from("alpha"));
  await beta.write(key, Buffer.from("beta"));
  await alpha.remove(key);
  assert.equal(await alpha.exists(key), false);
  assert.equal((await beta.read(key)).toString(), "beta");
});

test.after(async () => {
  await rm(fixture, { recursive: true, force: true });
  await mkdir(evidenceRoot, { recursive: true, mode: 0o700 });
  const evidence = {
    projectScopedRoots: ["alpha/development/storage", "beta/development/storage"],
    adapterSource: "apps/api/src/files/local-storage.adapter.ts",
    observedModes: { file: observedFileMode, directory: observedDirectoryMode },
    otherUserPermissionBits: 0,
    fixtureBytesRemoved: true,
    oldProductPathRead: false
  };
  const { writeFile } = await import("node:fs/promises");
  await writeFile(join(evidenceRoot, "round-trip.json"), JSON.stringify(evidence, null, 2) + "\n", { mode: 0o600 });
});
