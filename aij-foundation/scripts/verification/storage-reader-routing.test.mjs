import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Script } from "node:vm";
import ts from "typescript";

const root = fileURLToPath(new URL("../../", import.meta.url));
const requireApi = createRequire(resolve(root, "apps/api/package.json"));
requireApi("reflect-metadata");
const { Module } = requireApi("@nestjs/common");
const { NestFactory } = requireApi("@nestjs/core");
// Compile actual classes and their source imports, including real decorators.
// No app bootstrap, DB client construction, disk storage I/O or vendor call.
const loaded = new Map();
function loadSource(path) {
  const filename = resolve(root, path);
  if (loaded.has(filename)) return loaded.get(filename).exports;
  const compiled = ts.transpileModule(readFileSync(filename, "utf8"), {
    fileName: filename, reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
      experimentalDecorators: true, emitDecoratorMetadata: true }
  });
  assert.deepEqual(compiled.diagnostics?.filter(d => d.category === ts.DiagnosticCategory.Error), []);
  const module = { exports: {} };
  loaded.set(filename, module);
  const requireFile = createRequire(filename);
  const requireSource = name => {
    if (name === "@aij/runtime-contracts") return loadSource("packages/runtime-contracts/src/index.ts");
    if (name.startsWith(".") && existsSync(resolve(dirname(filename), name + ".ts"))) return loadSource(resolve(dirname(filename), name + ".ts"));
    return requireFile(name);
  };
  new Script(`(function(require, module, exports, __filename, __dirname) {\n${compiled.outputText}\n})`, { filename })
    .runInThisContext()(requireSource, module, module.exports, filename, dirname(filename));
  return module.exports;
}
const { StorageReaderRouter } = loadSource("apps/api/src/files/storage-reader-router.ts");
const { FileContentService, FileContentError } = loadSource("apps/api/src/files/file-content.service.ts");
const { STORAGE_READER } = loadSource("apps/api/src/files/storage-reader.port.ts");
const { QiniuStorageAdapter, qiniuHash } = loadSource("apps/api/src/files/qiniu-storage.adapter.ts");
const { ClientFilesService } = loadSource("apps/api/src/files/client-files.service.ts");
const { AdminFilesService } = loadSource("apps/api/src/files/admin-files.service.ts");
const key = "d8b72f9e-8f70-44bb-9e9d-43dd0d6b1c23";
const bytes = Buffer.from("AF151 trusted routing bytes");
const assetFor = (storageType = "local", content = bytes) => ({
  id: key, storageType, objectKey: key, size: content.length, checksum: createHash("sha256").update(content).digest("hex"),
  mimeType: "text/plain", originalName: "synthetic.txt", status: "active", deletedAt: null
});
const unavailable = e => e instanceof FileContentError && e.code === "unavailable" && e.message === "unavailable" && e.cause === undefined;
const invalidTypes = [undefined, null, "", " ", "LOCAL", "local ", "local/", "qiniu", "qiniu:main", "qiniu:main:v0",
  "qiniu:main:v01", "qiniu:main:v-1", "qiniu:main:v1.0", "qiniu:main:v1\n", "qiniu:Main:v1", "qiniu:-main:v1",
  "qiniu:main-:v1", "qiniu:main--two:v1", "qiniu:a_b:v1", "qiniu:../main:v1", "qiniu:" + "a".repeat(65) + ":v1",
  "qiniu:main:v9007199254740992", "https://files.example.com", {}, 1, "qiniu:unregistered:v1"];

for (const storageType of invalidTypes) {
  test(`unknown/malformed type fails unavailable with zero I/O: ${JSON.stringify(storageType)}`, async () => {
    let reads = 0;
    const router = new StorageReaderRouter([["local", { read: async () => { reads++; return bytes; } }]]);
    const content = new FileContentService(router);
    await assert.rejects(content.read({ ...assetFor(), storageType }), unavailable);
    await assert.rejects(content.read({ ...assetFor(), storageType, objectKey: null, checksum: null }), unavailable);
    assert.equal(reads, 0, "never fall back to a local object even when its key matches");
  });
}

test("registry copies its input, rejects duplicates and freezes only explicit safe identifiers", async () => {
  const first = { read: async () => bytes }, other = { read: async () => Buffer.from("wrong") };
  const entries = [["local", first], ["qiniu:profile-one:v1", first]];
  const router = new StorageReaderRouter(entries);
  entries[0][1] = other; entries[1][0] = "qiniu:changed:v2"; entries.push(["qiniu:late:v1", other]);
  assert.ok(Object.isFrozen(router));
  assert.equal(router.resolve("local"), first);
  assert.equal(router.resolve("qiniu:profile-one:v1"), first);
  assert.equal(router.resolve("qiniu:late:v1"), undefined);
  assert.throws(() => { router.resolve = () => other; }, TypeError);
  assert.throws(() => new StorageReaderRouter([["local", first], ["local", other]]), TypeError);
  assert.throws(() => new StorageReaderRouter([["local", {}]]), TypeError);
  for (const type of invalidTypes.filter(type => type !== "qiniu:unregistered:v1")) {
    assert.throws(() => new StorageReaderRouter([[type, first]]), TypeError);
  }
  for (const type of ["qiniu:a:v1", "qiniu:" + "a".repeat(64) + ":v9007199254740991"]) {
    assert.equal(new StorageReaderRouter([[type, first]]).resolve(type), first);
  }
  assert.equal(new StorageReaderRouter([]).resolve("local"), undefined);
});

function qiniuFixture(profile, content = bytes) {
  const requests = [], scopes = [];
  const state = { status: 200, body: content, fail: false };
  const host = profile + ".example.com", bucket = profile + "-synthetic";
  const adapter = new QiniuStorageAdapter({ productId: "aij-foundation", environment: "test", bucket,
    privateBucket: true, region: "z0", uploadOrigin: "https://up-z0.qiniup.com", managementOrigin: "https://rs-z0.qiniuapi.com",
    downloadOrigin: "https://" + host, allowedHosts: ["up-z0.qiniup.com", "rs-z0.qiniuapi.com", host]
  }, async scope => { scopes.push(scope); return { accessKey: "SyntheticAccessKey151", secretKey: "SyntheticSecretKey151" }; }, {
    now: () => 1800000000000,
    transport: { send: async input => {
      requests.push(input);
      assert.equal(input.method, "GET");
      const url = new URL(input.url);
      if (state.fail) throw new Error("private vendor detail");
      if (url.hostname === "rs-z0.qiniuapi.com") return { status: state.status, headers: { "content-type": "application/json" },
        body: Buffer.from(JSON.stringify({ fsize: content.length, hash: qiniuHash(content) })) };
      assert.equal(url.hostname, host);
      assert.equal(url.pathname, "/aij-foundation/test/objects/" + key);
      assert.ok(url.searchParams.has("token"));
      return { status: 200, headers: {}, body: state.body };
    } }
  });
  return { adapter, requests, scopes, state, bucket };
}

test("real Nest composes two Qiniu profiles/versions with no cross-profile or local fallback", async () => {
  const one = qiniuFixture("one"), twoBytes = Buffer.from("separate profile version bytes"), two = qiniuFixture("two", twoBytes);
  let localReads = 0;
  const local = { read: async () => { localReads++; return bytes; } };
  class TrustedHost {}
  Module({ providers: [
    { provide: STORAGE_READER, useValue: local },
    { provide: "profile-one", useValue: one.adapter }, { provide: "profile-two", useValue: two.adapter },
    { provide: StorageReaderRouter, inject: [STORAGE_READER, "profile-one", "profile-two"],
      useFactory: (reader, a, b) => new StorageReaderRouter([["local", reader], ["qiniu:archive:v1", a], ["qiniu:archive:v2", b]]) },
    FileContentService
  ] })(TrustedHost);
  const app = await NestFactory.createApplicationContext(TrustedHost, { logger: false, abortOnError: false });
  try {
    const content = app.get(FileContentService);
    assert.equal(app.get(STORAGE_READER), local);
    assert.deepEqual(await content.read({ ...assetFor("qiniu:archive:v1"), path: "objects/" + key, provider: "local" }), bytes);
    assert.equal(one.requests.length, 2); assert.equal(two.requests.length, 0); assert.equal(localReads, 0);
    assert.deepEqual(await content.read(assetFor("qiniu:archive:v2", twoBytes)), twoBytes);
    assert.equal(one.requests.length, 2); assert.equal(two.requests.length, 2); assert.equal(localReads, 0);
    for (const fixture of [one, two]) assert.ok(fixture.scopes.every(s => s.bucket === fixture.bucket && Object.isFrozen(s)));
    for (const type of ["qiniu:archive:v3", "qiniu:other:v1", "qiniu:archive:v0", ""]) {
      await assert.rejects(content.read(assetFor(type)), unavailable);
    }
    assert.equal(one.requests.length, 2); assert.equal(two.requests.length, 2); assert.equal(localReads, 0);
    await assert.rejects(content.read(assetFor("qiniu:archive:v2")), e => e.code === "corrupt");
    one.state.status = 612;
    await assert.rejects(content.read(assetFor("qiniu:archive:v1")), e => e instanceof FileContentError && e.code === "missing");
    one.state.status = 500;
    await assert.rejects(content.read(assetFor("qiniu:archive:v1")), unavailable);
    one.state.status = 200; one.state.fail = true;
    await assert.rejects(content.read(assetFor("qiniu:archive:v1")), unavailable);
    one.state.fail = false; one.state.body = Buffer.alloc(bytes.length);
    await assert.rejects(content.read(assetFor("qiniu:archive:v1")), unavailable);
    one.state.body = bytes;
    await assert.rejects(content.read({ ...assetFor("qiniu:archive:v1"), checksum: "0".repeat(64) }), e => e.code === "corrupt");
    assert.equal(localReads, 0);
    assert.deepEqual(await content.read(assetFor()), bytes); assert.equal(localReads, 1);
  } finally { await app.close(); }
});

for (const storageType of ["qiniu:archive:v1", "qiniu:unregistered:v1", "", undefined, null, "local "]) {
  test(`nonlocal delete and downloads fail before local I/O or metadata mutation: ${storageType}`, async () => {
    const io = [], mutations = [];
    const storage = Object.fromEntries(["read", "write", "remove", "exists"].map(method => [method, async () => { io.push(method); throw new Error("must not run"); }]));
    const asset = assetFor(storageType); asset.storageType = storageType;
    const prisma = { fileAsset: { findFirst: async () => asset, updateMany: async args => { mutations.push(args); return { count: 1 }; } } };
    const config = { getOrThrow: () => "aij-foundation" };
    const content = new FileContentService(new StorageReaderRouter([["local", storage]]));
    const client = new ClientFilesService(prisma, storage, content, config), admin = new AdminFilesService(prisma, content, config);
    const denied = e => e.getStatus() === 503;
    await assert.rejects(client.delete(key, { id: "member" }), denied);
    await assert.rejects(client.download(key, { id: "member" }), denied);
    await assert.rejects(admin.download(key), denied);
    assert.deepEqual(io, []); assert.deepEqual(mutations, []); assert.equal(asset.status, "active"); assert.equal(asset.deletedAt, null);
    // An ownership miss still returns 404 before provider selection.
    prisma.fileAsset.findFirst = async () => null;
    await assert.rejects(client.delete(key, { id: "other" }), e => e.getStatus() === 404);
    assert.deepEqual(io, []); assert.deepEqual(mutations, []);
  });
}

test("local delete still follows its existing claim, remove and compensation path", async () => {
  const calls = [], asset = assetFor();
  let removed = false, updates = 0;
  const storage = { read: async () => { calls.push("read"); return bytes; }, remove: async () => { removed = true; calls.push("remove"); },
    exists: async () => { calls.push("exists"); return !removed; }, write: async (_key, data) => { calls.push("write"); assert.deepEqual(data, bytes); removed = false; } };
  const prisma = { fileAsset: { findFirst: async () => asset, updateMany: async ({ data }) => {
    calls.push(data.status); updates++;
    if (updates === 2) throw new Error("synthetic metadata failure");
    return { count: 1 };
  } } };
  const service = new ClientFilesService(prisma, storage, new FileContentService(new StorageReaderRouter([["local", storage]])), { getOrThrow: () => "aij-foundation" });
  await assert.rejects(service.delete(key, { id: "member" }), e => e.getStatus() === 503);
  assert.deepEqual(calls, ["read", "deleting", "remove", "deleted", "exists", "write", "active"]);
  assert.equal(removed, false);
});


test("even an explicitly registered Qiniu reader cannot enter the local-only delete flow", async () => {
  const cloud = qiniuFixture("registered");
  const io = [], writes = [];
  const local = Object.fromEntries(["read", "write", "remove", "exists"].map(method => [method, async () => { io.push(method); throw new Error("unexpected local I/O"); }]));
  const router = new StorageReaderRouter([["local", local], ["qiniu:registered:v1", cloud.adapter]]);
  const asset = assetFor("qiniu:registered:v1");
  const prisma = { fileAsset: { findFirst: async () => asset, updateMany: async value => { writes.push(value); return { count: 1 }; } } };
  const service = new ClientFilesService(prisma, local, new FileContentService(router), { getOrThrow: () => "aij-foundation" });
  await assert.rejects(service.delete(key, { id: "member" }), e => e.getStatus() === 503);
  assert.deepEqual(io, []); assert.deepEqual(writes, []); assert.deepEqual(cloud.requests, []); assert.deepEqual(cloud.scopes, []);
});
