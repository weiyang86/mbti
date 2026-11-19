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
const { Module, Global, Injectable, Inject } = requireApi("@nestjs/common");
const { MODULE_METADATA, SELF_DECLARED_DEPS_METADATA } = requireApi("@nestjs/common/constants");
const { NestFactory } = requireApi("@nestjs/core");
const { ConfigService } = requireApi("@nestjs/config");

// Execute the real, small source graph in memory with real Nest decorators and
// metadata. No dist build, package descriptor substitute, env, DB or app bootstrap.
const sources = new Map([
  ["@aij/runtime-contracts", "packages/runtime-contracts/src/index.ts"],
  ["./storage-reader-router", "apps/api/src/files/storage-reader-router.ts"],
  ["./storage-reader.port", "apps/api/src/files/storage-reader.port.ts"],
  ["./local-storage.adapter", "apps/api/src/files/local-storage.adapter.ts"],
  ["./file-content.service", "apps/api/src/files/file-content.service.ts"]
]);
const loaded = new Map();
function loadSource(path) {
  if (loaded.has(path)) return loaded.get(path).exports;
  const filename = resolve(root, path);
  const compiled = ts.transpileModule(readFileSync(filename, "utf8"), {
    fileName: filename, reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
      experimentalDecorators: true, emitDecoratorMetadata: true
    }
  });
  assert.deepEqual(compiled.diagnostics?.filter(d => d.category === ts.DiagnosticCategory.Error), []);
  const module = { exports: {} };
  loaded.set(path, module);
  const requireFile = createRequire(filename);
  const requireSource = specifier => {
    if (sources.has(specifier)) return loadSource(sources.get(specifier));
    const sourcePath = resolve(dirname(filename), specifier + ".ts");
    if (specifier.startsWith(".") && existsSync(sourcePath)) return loadSource(sourcePath);
    return requireFile(specifier);
  };
  const execute = new Script(`(function(require, module, exports, __filename, __dirname) {\n${compiled.outputText}\n})`, { filename }).runInThisContext();
  execute(requireSource, module, module.exports, filename, dirname(filename));
  return module.exports;
}

const { StorageReaderRouter } = loadSource("apps/api/src/files/storage-reader-router.ts");
const contentFor = reader => new FileContentService(new StorageReaderRouter([["local", reader]]));
const { STORAGE_READER } = loadSource("apps/api/src/files/storage-reader.port.ts");
const { FileContentService, FileContentError } = loadSource("apps/api/src/files/file-content.service.ts");
const { LocalStorageAdapter, LocalStorageError } = loadSource("apps/api/src/files/local-storage.adapter.ts");
const { FilesModule } = loadSource("apps/api/src/files/files.module.ts");
const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, FilesModule);
const exports = Reflect.getMetadata(MODULE_METADATA.EXPORTS, FilesModule);
const objectKey = "f307c1f1-437b-4b5f-a5b4-e1085c068f49";
const fixture = Buffer.from("AF-143 附件\u0000\u00ff", "utf8");
const assetFor = bytes => ({ storageType: "local", objectKey, size: bytes.byteLength, checksum: createHash("sha256").update(bytes).digest("hex") });
const asset = assetFor(fixture);

function safeError(expected, original) {
  return error => {
    assert.ok(error instanceof FileContentError);
    assert.equal(error.code, expected);
    assert.equal(error.name, "FileContentError");
    assert.equal(error.message, expected);
    assert.equal(error.cause, undefined);
    assert.notEqual(error, original);
    for (const visible of [JSON.stringify(error), error.stack]) {
      assert.equal(visible.includes(objectKey), false);
      assert.equal(visible.includes("provider-private-detail"), false);
    }
    return true;
  };
}

function configModule() {
  const values = {
    projectId: "aij-af143", environment: "test", namespace: "aij_af143_test", repositoryRoot: root, AIJ_STORAGE_READ_PROFILES: "[]",
    storageRoot: resolve(root, ".artifacts/af-143/aij-af143/test/storage")
  };
  class ConfigFixtureModule {}
  Global()(ConfigFixtureModule);
  Module({ providers: [{ provide: ConfigService, useValue: { getOrThrow: key => values[key], get: key => values[key] } }], exports: [ConfigService] })(ConfigFixtureModule);
  return ConfigFixtureModule;
}

test("actual module metadata binds and exports one existing local adapter through explicit Nest injection", () => {
  assert.equal(typeof STORAGE_READER, "symbol");
  assert.deepEqual(providers.filter(provider => provider?.provide === STORAGE_READER), [{ provide: STORAGE_READER, useExisting: LocalStorageAdapter }]);
  assert.equal(providers.filter(provider => provider === LocalStorageAdapter).length, 1);
  assert.equal(providers.filter(provider => provider === FileContentService).length, 1);
  for (const token of [LocalStorageAdapter, STORAGE_READER, StorageReaderRouter, FileContentService]) assert.ok(exports.includes(token));
  assert.deepEqual(Reflect.getMetadata(SELF_DECLARED_DEPS_METADATA, FileContentService), [{ index: 0, param: StorageReaderRouter }]);
  assert.equal(LocalStorageError, loadSource("packages/runtime-contracts/src/index.ts").LocalStorageError);
});

test("real Nest DI resolves the FilesModule default alias and exports it to a consuming module", async () => {
  class Consumer {
    constructor(reader) { this.reader = reader; }
  }
  Injectable()(Consumer);
  Inject(STORAGE_READER)(Consumer, undefined, 0);
  class FixtureModule {}
  Module({ imports: [configModule(), FilesModule], providers: [Consumer] })(FixtureModule);
  const context = await NestFactory.createApplicationContext(FixtureModule, { logger: false, abortOnError: false });
  try {
    const local = context.get(LocalStorageAdapter);
    assert.ok(local instanceof LocalStorageAdapter);
    assert.equal(context.get(STORAGE_READER), local);
    assert.equal(context.get(StorageReaderRouter).resolve("local"), local);
    assert.equal(context.get(StorageReaderRouter).resolve("qiniu:unregistered:v1"), undefined);
    assert.equal(context.get(Consumer).reader, local);
    // Substitute only I/O on this local instance: this is a pure DI test, not a disk round trip.
    const calls = [];
    local.read = async key => { calls.push(key); return fixture; };
    const bytes = await context.get(FileContentService).read(asset);
    assert.deepEqual(bytes, fixture);
    assert.deepEqual(calls, [objectKey]);
  } finally { await context.close(); }
});

test("the Nest provider token accepts a read-only replacement returning a Uint8Array view", async () => {
  const backing = Buffer.concat([Buffer.from("prefix"), fixture, Buffer.from("suffix")]);
  const view = new Uint8Array(backing.buffer, backing.byteOffset + 6, fixture.byteLength);
  const calls = [];
  const replacement = { read: async key => { calls.push(key); return view; } };
  class ReplacementModule {}
  // Apply a test replacement to actual module provider metadata, as an overrideProvider would.
  Module({
    imports: [configModule()], exports,
    providers: providers.map(provider => provider?.provide === STORAGE_READER ? { provide: STORAGE_READER, useValue: replacement } : provider)
  })(ReplacementModule);
  const context = await NestFactory.createApplicationContext(ReplacementModule, { logger: false, abortOnError: false });
  try {
    assert.equal(context.get(STORAGE_READER), replacement);
    assert.notEqual(context.get(STORAGE_READER), context.get(LocalStorageAdapter));
    const bytes = await context.get(FileContentService).read(asset);
    assert.ok(Buffer.isBuffer(bytes));
    assert.deepEqual(bytes, fixture);
    assert.deepEqual(calls, [objectKey]);
    view.fill(0);
    assert.deepEqual(bytes, fixture, "provider mutations cannot alter verified output");
  } finally { await context.close(); }
});

test("Buffer output also snapshots the verified bytes and accepts an empty object", async () => {
  for (const original of [fixture, Buffer.alloc(0)]) {
    const stored = Buffer.from(original);
    const service = contentFor({ read: async () => stored });
    const bytes = await service.read(assetFor(original));
    assert.ok(Buffer.isBuffer(bytes));
    assert.notEqual(bytes, stored);
    stored.fill(0);
    assert.deepEqual(bytes, original);
  }
});

for (const incomplete of [{ objectKey: null }, { objectKey: "" }, { checksum: null }, { checksum: "" }]) {
  test(`missing integrity metadata fails corrupt before storage: ${JSON.stringify(incomplete)}`, async () => {
    let calls = 0;
    const service = contentFor({ read: async () => { calls++; return fixture; } });
    await assert.rejects(service.read({ ...asset, ...incomplete }), safeError("corrupt"));
    assert.equal(calls, 0);
  });
}

for (const size of [fixture.byteLength - 1, fixture.byteLength + 1, -1, 0.5, NaN, Infinity, String(fixture.byteLength)]) {
  test(`exact byte length is enforced independently of a matching checksum: ${size}`, async () => {
    const service = contentFor({ read: async () => fixture });
    await assert.rejects(service.read({ ...asset, size }), safeError("corrupt"));
  });
}

test("SHA256 detects changed content at the same length and rejects invalid digests", async () => {
  const changed = Buffer.from(fixture);
  changed[0] ^= 1;
  const service = contentFor({ read: async () => changed });
  await assert.rejects(service.read(asset), safeError("corrupt"));
  const valid = contentFor({ read: async () => fixture });
  for (const checksum of ["0".repeat(64), asset.checksum.toUpperCase(), "not-a-sha256"]) {
    await assert.rejects(valid.read({ ...asset, checksum }), safeError("corrupt"));
  }
});

for (const code of ["OBJECT_MISSING", "OBJECT_INVALID", "OBJECT_KEY_INVALID", "STORAGE_PATH_UNSAFE", "STORAGE_ROOT_INVALID", "STORAGE_ROOT_PERMISSIONS", "STORAGE_READ_FAILED"]) {
  test(`the shared storage error ${code} retains its safe content error mapping`, async () => {
    const original = new LocalStorageError(code);
    original.message = `provider-private-detail ${objectKey}`;
    const service = contentFor({ read: async () => { throw original; } });
    await assert.rejects(service.read(asset), safeError(code === "OBJECT_MISSING" ? "missing" : "unavailable", original));
  });
}

for (const original of [
  new Error(`provider-private-detail ${objectKey}`),
  Object.assign(new Error(`provider-private-detail ${objectKey}`), { name: "LocalStorageError", code: "OBJECT_MISSING" }),
  { code: "OBJECT_MISSING", objectKey }, `provider-private-detail ${objectKey}`, null
]) {
  test(`unknown provider failure is unavailable without trusting a missing-shaped error: ${typeof original}`, async () => {
    const service = contentFor({ read: () => { throw original; } });
    await assert.rejects(service.read(asset), safeError("unavailable", original));
  });
}

for (const invalid of [null, undefined, "bytes", [...fixture], new Uint16Array(fixture), fixture.buffer, { length: fixture.length, byteLength: fixture.length }]) {
  test(`provider output outside Uint8Array fails safely: ${Object.prototype.toString.call(invalid)}`, async () => {
    const service = contentFor({ read: async () => invalid });
    await assert.rejects(service.read(asset), safeError("unavailable"));
  });
}

test("one injected service recovers from missing, provider fault and corruption without stale state", async () => {
  let read = async () => { throw new LocalStorageError("OBJECT_MISSING"); };
  const service = contentFor({ read: key => { assert.equal(key, objectKey); return read(); } });
  await assert.rejects(service.read(asset), safeError("missing"));
  read = async () => fixture;
  assert.deepEqual(await service.read(asset), fixture);
  read = async () => { throw new Error(`provider-private-detail ${objectKey}`); };
  await assert.rejects(service.read(asset), safeError("unavailable"));
  read = async () => Buffer.alloc(fixture.byteLength);
  await assert.rejects(service.read(asset), safeError("corrupt"));
  read = async () => new Uint8Array(fixture);
  assert.deepEqual(await service.read(asset), fixture);
});
