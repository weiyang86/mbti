import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";

const require = createRequire(resolve("apps/api/package.json"));
require("reflect-metadata");
const source = process.env.AIJ_AF153_TEST_SOURCE === "true";
if (source) require("ts-node").register({ project: resolve("apps/api/tsconfig.json"), transpileOnly: true });
const load = path => require(resolve(`apps/api/${source ? "src" : "dist"}/${path}.${source ? "ts" : "js"}`));
const { parseStorageReadProfiles } = load("files/storage-read-profiles");
const { FilesModule } = load("files/files.module");
const { StorageReaderRouter } = load("files/storage-reader-router");
const { LocalStorageAdapter } = load("files/local-storage.adapter");
const { STORAGE_READER } = load("files/storage-reader.port");
const { FileContentService, FileContentError } = load("files/file-content.service");
const { SecretRefPort } = load("secret-center/secret-ref");
const { qiniuHash } = load("files/qiniu-storage.adapter");
const { Module, Global } = require("@nestjs/common");
const { ConfigModule, ConfigService } = require("@nestjs/config");
const { NestFactory } = require("@nestjs/core");
const identity = { projectId: "aij-foundation", environment: "test", namespace: "aij_foundation_test", repositoryRoot: resolve(".") };
const profile = { id: "qiniu:private-docs:v1", bucket: "synthetic-bucket", privateBucket: true, region: "z0",
  uploadOrigin: "https://up-z0.qiniup.com", managementOrigin: "https://rs-z0.qiniuapi.com", downloadOrigin: "https://files.example.com",
  allowedHosts: ["up-z0.qiniup.com", "rs-z0.qiniuapi.com", "files.example.com"],
  accessKeyRef: "env://AIJ_SECRET_AIJ_FOUNDATION_TEST_QINIU_AK", secretKeyRef: "env://AIJ_SECRET_AIJ_FOUNDATION_TEST_QINIU_SK" };
const parse = value => parseStorageReadProfiles(JSON.stringify(value), identity);
const invalid = action => assert.throws(action, error => error.constructor === Error && error.message === "Invalid storage read profiles configuration" && !error.cause && !JSON.stringify(error).includes("AIJ_SECRET"));
const unavailable = error => error instanceof FileContentError && error.code === "unavailable";

test("actual parser defaults to local-only and deep-freezes versioned reference-only profiles", () => {
  assert.deepEqual(parseStorageReadProfiles(undefined, identity), []);
  assert.deepEqual(parse([]), []);
  const value = parse([profile]);
  assert.deepEqual(value[0], profile);
  assert.ok(Object.isFrozen(value) && Object.isFrozen(value[0]) && Object.isFrozen(value[0].allowedHosts));
  assert.throws(() => value[0].allowedHosts.push("attacker.example.com"), TypeError);
  assert.throws(() => { value[0].id = "local"; }, TypeError);
});

test("strict JSON rejects malformed, duplicate/escaped keys, unknown fields, literal keys and identity overrides with one redacted error", () => {
  for (const raw of ["", "null", "{}", "[", "\ufeff[]", 3, null, { profiles: [] },
    JSON.stringify([profile]).replace('"bucket":', '"accessKey":"SENSITIVE_LITERAL","bucket":'),
    JSON.stringify([profile]).replace('"bucket":', '"bucket":"SENSITIVE_LITERAL","bucket":'),
    JSON.stringify([profile]).replace('"bucket":', '"bu\\u0063ket":"SENSITIVE_LITERAL","bucket":')]) invalid(() => parseStorageReadProfiles(raw, identity));
  for (const field of ["accessKey", "secretKey", "productId", "projectId", "environment", "transport", "maxObjectBytes", "timeoutMs", "url", "__proto__"]) {
    invalid(() => parse([{ ...profile, [field]: "SENSITIVE_LITERAL" }]));
  }
  for (const field of Object.keys(profile)) { const value = { ...profile }; delete value[field]; invalid(() => parse([value])); }
});

test("actual parser enforces count, UTF-8 byte bound, exact IDs, versions and duplicates", () => {
  const eight = Array.from({ length: 8 }, (_, i) => ({ ...profile, id: `qiniu:docs:v${i + 1}` }));
  assert.equal(parse(eight).length, 8); invalid(() => parse([...eight, { ...profile, id: "qiniu:docs:v9" }]));
  invalid(() => parse([profile, profile]));
  for (const id of ["local", "qiniu:docs:v0", "qiniu:docs:v01", "qiniu:docs:v-1", "qiniu:docs:v1\n", "qiniu:Docs:v1", "qiniu:docs:v9007199254740992", "qiniu:" + "x".repeat(65) + ":v1", "https://files.example.com"]) invalid(() => parse([{ ...profile, id }]));
  assert.equal(parse([{ ...profile, id: "qiniu:docs:v9007199254740991" }]).length, 1);
  const raw = JSON.stringify([profile]);
  assert.equal(parseStorageReadProfiles(raw + " ".repeat(16384 - Buffer.byteLength(raw)), identity).length, 1);
  invalid(() => parseStorageReadProfiles(raw + " ".repeat(16385 - Buffer.byteLength(raw)), identity));
  invalid(() => parseStorageReadProfiles('[' + '"界"'.repeat(6000) + ']', identity));
});

test("profiles reject unsafe origins, nonexact/duplicate/extra hosts, bucket and ref ownership mistakes", () => {
  for (const downloadOrigin of ["http://files.example.com", "https://files.example.com/", "https://files.example.com:443", "https://user@files.example.com", "https://files.example.com?token=SECRET", "https://files.example.com/#hash", "https://127.0.0.1", "https://localhost", "https://FILES.example.com", "https://files.example.com.evil.org"]) invalid(() => parse([{ ...profile, downloadOrigin }]));
  for (const change of [{ privateBucket: false }, { bucket: "Bad Bucket" }, { bucket: "synthetic-bucket\n" }, { region: "auto" }, { uploadOrigin: profile.downloadOrigin }, { managementOrigin: profile.downloadOrigin },
    { allowedHosts: [...profile.allowedHosts, profile.allowedHosts[0]] }, { allowedHosts: [...profile.allowedHosts, "spare.example.com"] }, { allowedHosts: [...profile.allowedHosts.slice(0, 2), "files.example.com\n"], downloadOrigin: "https://files.example.com\n" }, { allowedHosts: ["*.example.com"] },
    { accessKeyRef: "SyntheticLiteralAccessKey" }, { accessKeyRef: profile.accessKeyRef + "\n" }, { accessKeyRef: "env://AIJ_SECRET_FOREIGN_TEST_QINIU_AK" },
    { secretKeyRef: "env://AIJ_SECRET_AIJ_FOUNDATION_PRODUCTION_QINIU_SK" }, { secretKeyRef: profile.accessKeyRef }]) invalid(() => parse([{ ...profile, ...change }]));
  const local = { ...profile, accessKeyRef: "local://aij-foundation/test/QINIU_AK", secretKeyRef: "local://aij-foundation/test/QINIU_SK" };
  assert.equal(parse([local]).length, 1);
  invalid(() => parse([{ ...local, secretKeyRef: "local://foreign/test/QINIU_SK" }]));
  invalid(() => parseStorageReadProfiles(undefined, { ...identity, projectId: "Unvalidated" }));
});

async function context({ raw, factory, secrets, environment = "test", nodeEnv = "test" } = {}) {
  const repositoryRoot = resolve(`.artifacts/af153/unit-${randomUUID()}`);
  mkdirSync(repositoryRoot, { recursive: true, mode: 0o700 });
  const values = { ...identity, repositoryRoot, environment, nodeEnv, storageRoot: resolve(repositoryRoot, `aij-foundation/${environment}/storage`), AIJ_STORAGE_READ_PROFILES: raw };
  class TrustedSecrets {}
  Global()(TrustedSecrets);
  Module({ providers: secrets ? [{ provide: SecretRefPort, useValue: secrets }] : [], exports: secrets ? [SecretRefPort] : [] })(TrustedSecrets);
  class Host {}
  Module({ imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: [() => values] }), TrustedSecrets,
    factory ? FilesModule.withTestTransport(factory) : FilesModule] })(Host);
  return NestFactory.createApplicationContext(Host, { logger: false, abortOnError: false });
}

test("actual FilesModule preserves single local binding without SecretCenter, credentials or transport creation", async () => {
  let transportCalls = 0;
  const app = await context({ factory: () => { transportCalls++; throw new Error("must stay idle"); } });
  try {
    assert.equal(app.get(STORAGE_READER), app.get(LocalStorageAdapter));
    assert.equal(app.get(StorageReaderRouter).resolve("local"), app.get(LocalStorageAdapter));
    assert.equal(transportCalls, 0);
    const key = randomUUID(), bytes = Buffer.from("AF153 original local");
    await app.get(LocalStorageAdapter).write(key, bytes);
    assert.deepEqual(await app.get(FileContentService).read({ storageType: "local", objectKey: key, size: bytes.length, checksum: createHash("sha256").update(bytes).digest("hex") }), bytes);
    await assert.rejects(app.get(FileContentService).read({ storageType: profile.id, objectKey: key }), unavailable);
  } finally { await app.close(); }
});

test("actual FilesModule snapshot routes only metadata with fresh refs for stat/sign, rotation/revocation and no local fallback", async () => {
  let active = true, credentialVersion = 1, requests = 0, factoryCalls = 0;
  const resolved = [], authorizations = [];
  const bytes = Buffer.from("AF153 profile bytes"), key = randomUUID();
  const secrets = { resolveTrusted: async ref => { resolved.push(ref); if (!active) throw new Error("SENSITIVE_SECRET_ERROR"); return ref === profile.accessKeyRef ? `SyntheticAccessKey${credentialVersion}` : `SyntheticSecretKey${credentialVersion}`; } };
  const factory = hosts => { factoryCalls++; assert.deepEqual(hosts, profile.allowedHosts); assert.ok(Object.isFrozen(hosts)); return { send: async input => {
    requests++; assert.equal(input.method, "GET");
    const url = new URL(input.url); authorizations.push(input.headers.Authorization ?? url.searchParams.get("token"));
    if (url.hostname === "rs-z0.qiniuapi.com") return { status: 200, headers: { "content-type": "application/json" }, body: Buffer.from(JSON.stringify({ fsize: bytes.length, hash: qiniuHash(bytes) })) };
    assert.equal(url.hostname, "files.example.com"); assert.equal(url.pathname, `/aij-foundation/test/objects/${key}`);
    return { status: 200, headers: {}, body: bytes };
  } }; };
  const app = await context({ raw: JSON.stringify([profile]), factory, secrets });
  const asset = { storageType: profile.id, objectKey: key, size: bytes.length, checksum: createHash("sha256").update(bytes).digest("hex") };
  try {
    const content = app.get(FileContentService), router = app.get(StorageReaderRouter);
    assert.equal(app.get(STORAGE_READER), app.get(LocalStorageAdapter));
    assert.deepEqual(Object.keys(router.resolve(profile.id)), ["read"]);
    assert.deepEqual(await content.read(asset), bytes);
    assert.deepEqual(resolved, [profile.accessKeyRef, profile.secretKeyRef, profile.accessKeyRef, profile.secretKeyRef]);
    credentialVersion = 2; assert.deepEqual(await content.read(asset), bytes);
    assert.ok(authorizations.slice(-2).every(value => value.includes("SyntheticAccessKey2")));
    app.get(ConfigService).set("AIJ_STORAGE_READ_PROFILES", "[]");
    assert.deepEqual(await content.read(asset), bytes);
    const before = requests;
    for (const storageType of ["qiniu:private-docs:v2", "local-override", "https://files.example.com"]) await assert.rejects(content.read({ ...asset, storageType }), unavailable);
    assert.equal(requests, before);
    active = false; await assert.rejects(content.read(asset), error => unavailable(error) && !JSON.stringify(error).includes("SENSITIVE"));
    assert.equal(requests, before);
    active = true;
    await assert.rejects(content.read({ ...asset, checksum: "0".repeat(64) }), error => error.code === "corrupt");
    assert.equal(factoryCalls, 1); assert.ok(Object.isFrozen(router));
  } finally { await app.close(); }
});

test("valid declared profile starts without secret owner and fails unavailable before network", async () => {
  let requests = 0;
  const app = await context({ raw: JSON.stringify([profile]), factory: () => ({ send: async () => { requests++; throw new Error("unexpected"); } }) });
  try { await assert.rejects(app.get(FileContentService).read({ storageType: profile.id, objectKey: randomUUID(), size: 1, checksum: "0".repeat(64) }), unavailable); assert.equal(requests, 0); }
  finally { await app.close(); }
});

test("fixture DI refuses non-test applications and malformed profiles fail bootstrap generically", async () => {
  for (const values of [{ nodeEnv: "production" }, { environment: "production" }]) {
    await assert.rejects(context({ ...values, factory: () => ({ send: async () => {} }) }), /Storage fixture transport requires an isolated test application/);
  }
  await assert.rejects(context({ raw: '[{"secretKey":"SENSITIVE_LITERAL"}]' }), error => error.message === "Invalid storage read profiles configuration");
});


test("production transport assembly needs no vendor contact when the secret owner is absent", async () => {
  const app = await context({ raw: JSON.stringify([profile]) });
  try {
    await assert.rejects(app.get(FileContentService).read({ storageType: profile.id, objectKey: randomUUID(), size: 1, checksum: "0".repeat(64) }), unavailable);
  } finally { await app.close(); }
});

test("actual factory transport errors cannot expose URLs, resolved keys or native causes", async () => {
  const secret = "SensitiveResolvedKey153", key = randomUUID();
  const app = await context({ raw: JSON.stringify([profile]), secrets: { resolveTrusted: async () => secret },
    factory: () => ({ send: async () => { throw new Error("https://files.example.com?token=" + secret); } }) });
  try {
    await assert.rejects(app.get(FileContentService).read({ storageType: profile.id, objectKey: key, size: 1, checksum: "0".repeat(64) }), error => {
      assert.ok(unavailable(error)); assert.equal(error.message, "unavailable"); assert.equal(error.cause, undefined);
      assert.doesNotMatch(JSON.stringify(error), /Sensitive|https|token|AIJ_SECRET/); return true;
    });
  } finally { await app.close(); }
});
