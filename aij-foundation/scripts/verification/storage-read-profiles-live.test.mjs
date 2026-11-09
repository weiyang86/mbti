// ROOT ONLY: fresh protected AF-153 acceptance DB + API build required. The worker
// must not execute this file. Root registers AF-153 in shared acceptance guards.
import assert from "node:assert/strict";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { createAcceptance, migrate } from "../database/migration.mjs";
import { acceptanceRecord, repositoryRoot, checkDatabase, readDatabaseEnvironment, withDatabase } from "../database/connection.mjs";
import runtime from "../runtime-environment.cjs";

const require = createRequire(join(repositoryRoot, "apps/api/package.json"));
const task = "AF-153";
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const b64 = value => Buffer.from(value).toString("base64").replace(/\+/g, "-").replace(/\//g, "_");
const profile = { id: "qiniu:private-docs:v1", bucket: "synthetic-bucket", privateBucket: true, region: "z0",
  uploadOrigin: "https://up-z0.qiniup.com", managementOrigin: "https://rs-z0.qiniuapi.com", downloadOrigin: "https://files.example.com",
  allowedHosts: ["up-z0.qiniup.com", "rs-z0.qiniuapi.com", "files.example.com"],
  accessKeyRef: "env://AIJ_SECRET_AIJ_FOUNDATION_TEST_QINIU_AK", secretKeyRef: "env://AIJ_SECRET_AIJ_FOUNDATION_TEST_QINIU_SK" };

test("AF153 actual FilesModule/SecretCenter private attachment HTTP and fresh DB acceptance", { timeout: 240000 }, async t => {
  assert.equal(process.env.AIJ_AF153_ROOT_ACCEPTANCE, "true", "Root must explicitly enable this fresh DB acceptance; workers must not run it");
  assert.equal(resolve(process.cwd()), "/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation");
  const git = flag => resolve(repositoryRoot, execFileSync("git", ["rev-parse", flag], { encoding: "utf8" }).trim());
  assert.equal(git("--git-dir"), git("--git-common-dir"));
  assert.equal(execFileSync("git", ["branch", "--show-current"], { encoding: "utf8" }).trim(), "dev");
  await checkDatabase("test");
  const lease = await createAcceptance("test", task);
  assert.equal(acceptanceRecord("test", lease.id).task, task);
  assert.equal((await migrate({ mode: "test", action: "deploy", acceptanceId: lease.id })).exitCode, 0);
  assert.equal((await migrate({ mode: "test", action: "status", acceptanceId: lease.id })).exitCode, 0);
  const directory = join(repositoryRoot, ".artifacts/af153/live", lease.id);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const original = { ...process.env };
  const setEnvironment = values => { for (const key of Object.keys(process.env)) delete process.env[key]; Object.assign(process.env, values); };
  const environment = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR,
    RUNTIME_PROFILE: "host", PROJECT_ID: "aij-foundation", APP_ENV: "test", NODE_ENV: "test", DATABASE_ACCEPTANCE_ID: lease.id,
    AUTH_ENABLED: "true", CLIENT_AUTH_ENABLED: "true", DATABASE_ENABLED: "true", STORAGE_ENABLED: "true", ASYNC_RUNTIME_ENABLED: "false", ENABLED_PLUGINS: "",
    JWT_SECRET: randomBytes(32).toString("hex"), CLIENT_JWT_SECRET: randomBytes(32).toString("hex"),
    CLIENT_AUTH_RATE_LIMIT_SECRET: randomBytes(32).toString("hex"), CLIENT_AUTH_TOKEN_SECRET: randomBytes(32).toString("hex"),
    WEB_PORT: "3655", API_PORT: "3656", WEB_URL: "http://localhost:3655", NEXT_PUBLIC_API_URL: "http://localhost:3656/api",
    JWT_ISSUER: "urn:aij:aij-foundation:test:api", COOKIE_PREFIX: "aij_foundation_test",
    LOCAL_STORAGE_ROOT: `.artifacts/af153/live/${lease.id}/aij-foundation/test/storage`, AIJ_STORAGE_READ_PROFILES: JSON.stringify([profile]),
    AIJ_SECRET_AIJ_FOUNDATION_TEST_QINIU_AK: randomBytes(24).toString("hex"), AIJ_SECRET_AIJ_FOUNDATION_TEST_QINIU_SK: randomBytes(24).toString("hex") };
  const sensitive = Object.entries(environment).filter(([key]) => /SECRET|QINIU_[AS]K$/.test(key)).map(([, value]) => value);
  const bytes = Buffer.from("AF153 owned synthetic private attachment\n");
  const received = [], fixtureErrors = [];
  let app, defaultApp, fixture, prisma, api, cookie, otherCookie;
  const evidence = [];
  let succeeded = false;
  // No credentials are persisted in the evidence or source. Everything is new
  // for this lease, with no upserts, adoption, reset, seed or existing user data.
  const sign = value => environment.AIJ_SECRET_AIJ_FOUNDATION_TEST_QINIU_AK + ":" + b64(createHmac("sha1", environment.AIJ_SECRET_AIJ_FOUNDATION_TEST_QINIU_SK).update(value).digest());
  try {
    setEnvironment(environment);
    require("reflect-metadata");
    const { Module, ValidationPipe } = require("@nestjs/common");
    const { NestFactory } = require("@nestjs/core");
    const { ConfigModule } = require("@nestjs/config");
    const load = path => require(join(repositoryRoot, "apps/api/dist", path + ".js"));
    const { FilesModule } = load("files/files.module");
    const { FileContentService } = load("files/file-content.service");
    const { StorageReaderRouter } = load("files/storage-reader-router");
    const { STORAGE_READER } = load("files/storage-reader.port");
    const { LocalStorageAdapter } = load("files/local-storage.adapter");
    const { SecretCenterModule } = load("secret-center/secret-center.module");
    const { SecretCenterService } = load("secret-center/secret-center.service");
    const { SecretRefPort } = load("secret-center/secret-ref");
    const { PrismaModule } = load("prisma/prisma.module");
    const { PrismaService } = load("prisma/prisma.service");
    const { ClientAuthModule } = load("client-auth/client-auth.module");
    const { ClientFilesController } = load("files/client-files.controller");
    const { ClientFilesService } = load("files/client-files.service");
    const { TransformInterceptor } = load("common/interceptors/transform.interceptor");
    const { qiniuHash } = load("files/qiniu-storage.adapter");
    const runtimeConfig = runtime.loadRuntimeEnvironment();
    fixture = createServer((request, response) => {
      try {
        assert.equal(request.method, "GET");
        const origin = request.headers["x-af153-official-origin"];
        assert.ok([profile.managementOrigin, profile.downloadOrigin].includes(origin));
        const url = new URL(request.url, origin);
        received.push({ method: request.method, host: url.hostname });
        if (origin === profile.managementOrigin) {
          assert.match(url.pathname, /^\/stat\/[A-Za-z0-9_=-]+$/);
          const path = url.pathname;
          const canonical = `GET ${path}\nHost: rs-z0.qiniuapi.com\nContent-Type: application/x-www-form-urlencoded\nX-Qiniu-Date: ${request.headers["x-qiniu-date"]}\n\n`;
          assert.ok(request.headers.authorization === "Qiniu " + sign(canonical), "Synthetic stat signature must verify");
          response.setHeader("content-type", "application/json"); response.end(JSON.stringify({ fsize: bytes.length, hash: qiniuHash(bytes) }));
        } else {
          assert.match(url.pathname, /^\/aij-foundation\/test\/objects\/[0-9a-f-]{36}$/);
          const unsigned = `${origin}${url.pathname}?e=${url.searchParams.get("e")}`;
          assert.ok(url.searchParams.get("token") === sign(unsigned), "Synthetic private download signature must verify");
          response.setHeader("content-type", "application/octet-stream"); response.end(bytes);
        }
      } catch { fixtureErrors.push("Synthetic fixture verification failed"); response.statusCode = 500; response.end("Synthetic fixture rejected request"); }
    });
    await new Promise(resolve => fixture.listen(0, "127.0.0.1", resolve));
    const fixtureOrigin = "http://127.0.0.1:" + fixture.address().port;
    const transportFactory = hosts => {
      assert.deepEqual(hosts, profile.allowedHosts);
      return { send: async input => {
        const official = new URL(input.url);
        assert.equal(input.method, "GET"); assert.ok([profile.managementOrigin, profile.downloadOrigin].includes(official.origin));
        const response = await fetch(fixtureOrigin + official.pathname + official.search, { method: input.method,
          headers: { ...input.headers, "x-af153-official-origin": official.origin }, redirect: "error", signal: AbortSignal.timeout(3000) });
        return { status: response.status, headers: { "content-type": response.headers.get("content-type") }, body: Buffer.from(await response.arrayBuffer()) };
      } };
    };
    class AcceptanceHost {}
    Module({ imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: [() => runtimeConfig] }), PrismaModule,
      SecretCenterModule, ClientAuthModule, FilesModule.withTestTransport(transportFactory)], controllers: [ClientFilesController], providers: [ClientFilesService] })(AcceptanceHost);
    app = await NestFactory.create(AcceptanceHost, { logger: false, abortOnError: false });
    app.setGlobalPrefix("api"); app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true })); app.useGlobalInterceptors(new TransformInterceptor());
    await app.listen(0, "127.0.0.1"); api = `http://127.0.0.1:${app.getHttpServer().address().port}/api`;
    prisma = app.get(PrismaService);
    assert.equal((await prisma.readiness()).ready, true);
    assert.equal(app.get(SecretRefPort), app.get(SecretCenterService));
    assert.equal(app.get(STORAGE_READER), app.get(LocalStorageAdapter));
    assert.equal(app.get(StorageReaderRouter).resolve("local"), app.get(LocalStorageAdapter));
    assert.ok(app.get(FileContentService));
    const organization = await prisma.organizationProfile.create({ data: { code: "af153-" + lease.id, name: "AF153 synthetic organization" } });
    const project = await prisma.projectProfile.create({ data: { organizationId: organization.id, code: "aij-foundation-test", name: "AF153 synthetic project", environment: "test" } });
    const ak = await prisma.secretReference.create({ data: { ref: profile.accessKeyRef, provider: "env" } });
    const sk = await prisma.secretReference.create({ data: { ref: profile.secretKeyRef, provider: "env" } });
    const password = "C9-" + randomBytes(24).toString("hex"); sensitive.push(password);
    const bcrypt = require("bcryptjs");
    const member = await prisma.memberUser.create({ data: { email: "af153-member-" + lease.id + "@example.test", nickname: "AF153 synthetic member", passwordHash: await bcrypt.hash(password, 12), emailVerifiedAt: new Date() } });
    const other = await prisma.memberUser.create({ data: { email: "af153-other-" + lease.id + "@example.test", nickname: "AF153 synthetic other", passwordHash: await bcrypt.hash(password, 12), emailVerifiedAt: new Date() } });
    const send = async (path, { method = "GET", cookie: session, body } = {}) => {
      const response = await fetch(api + "/" + path, { method, headers: { connection: "close", "x-correlation-id": "af153-live", ...(session ? { cookie: session } : {}),
        ...(method !== "GET" ? { origin: "http://localhost:3655" } : {}), ...(body ? { "content-type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000) });
      const data = Buffer.from(await response.arrayBuffer()), text = data.toString("utf8");
      for (const secret of sensitive) assert.ok(!text.includes(secret), "response must redact all synthetic secrets");
      assert.ok(!text.includes(repositoryRoot));
      assert.doesNotMatch(text, /https:\/\/files\.example\.com|Qiniu |token=|secretKeyRef|accessKeyRef/);
      return { response, bytes: data, body: response.headers.get("content-type")?.includes("application/json") ? JSON.parse(text) : undefined };
    };
    const login = async account => { const result = await send("client/auth/login", { method: "POST", body: { email: account.email, password } }); assert.equal(result.response.status, 200); return result.response.headers.get("set-cookie").split(";")[0]; };
    cookie = await login(member); otherCookie = await login(other);
    const makeAsset = async (changes = {}) => {
      const id = randomUUID(), objectKey = randomUUID();
      return prisma.fileAsset.create({ data: { id, objectKey, storageType: profile.id, originalName: "synthetic.txt", filename: objectKey + ".txt", mimeType: "text/plain", size: bytes.length,
        checksum: hash(bytes), path: `aij-foundation/test/objects/${objectKey}`, url: "/api/client/files/" + id, projectId: "aij-foundation", ownerType: "user", ownerId: member.id, uploaderId: member.id, ...changes } });
    };
    const asset = await makeAsset();
    const unavailable = async () => { const before = received.length, result = await send("client/files/" + asset.id, { cookie }); assert.equal(result.response.status, 503); assert.equal(received.length, before); assert.equal((await prisma.fileAsset.findUniqueOrThrow({ where: { id: asset.id } })).status, "active"); };

    await t.test("registered private attachment uses actual owner, valid signatures, bytes and SHA256", async () => {
      const result = await send("client/files/" + asset.id, { cookie }); assert.equal(result.response.status, 200); assert.deepEqual(result.bytes, bytes); assert.equal(hash(result.bytes), asset.checksum);
      assert.equal(result.response.headers.get("content-length"), String(bytes.length)); assert.equal(result.response.headers.get("cache-control"), "private, no-store"); assert.equal(received.length, 2);
      evidence.push("actual-owner-private-read-sha256");
    });
    await t.test("anonymous and other member cannot cause provider IO", async () => {
      const before = received.length; assert.equal((await send("client/files/" + asset.id)).response.status, 401);
      assert.equal((await send("client/files/" + asset.id, { cookie: otherCookie })).response.status, 404); assert.equal(received.length, before); evidence.push("member-denial-0io");
    });
    await t.test("bad SHA256 is refused by the one real FileContentService", async () => {
      const bad = await makeAsset({ checksum: "0".repeat(64) }); assert.equal((await send("client/files/" + bad.id, { cookie })).response.status, 503);
      assert.equal((await prisma.fileAsset.findUniqueOrThrow({ where: { id: bad.id } })).status, "corrupt"); evidence.push("corrupt-sha256");
    });
    await t.test("revocation, missing registration and changed ref prevent subsequent IO", async () => {
      await prisma.secretReference.update({ where: { id: ak.id }, data: { status: "disabled" } }); await unavailable();
      await prisma.secretReference.update({ where: { id: ak.id }, data: { status: "active", ref: "env://AIJ_SECRET_AIJ_FOUNDATION_TEST_ROTATED_AK" } }); await unavailable();
      await prisma.secretReference.update({ where: { id: ak.id }, data: { ref: profile.accessKeyRef } });
      await prisma.secretReference.update({ where: { id: sk.id }, data: { provider: "foreign" } }); await unavailable();
      await prisma.secretReference.update({ where: { id: sk.id }, data: { provider: "env", deletedAt: new Date() } }); await unavailable();
      await prisma.secretReference.update({ where: { id: sk.id }, data: { deletedAt: null } });
      const value = process.env.AIJ_SECRET_AIJ_FOUNDATION_TEST_QINIU_SK; delete process.env.AIJ_SECRET_AIJ_FOUNDATION_TEST_QINIU_SK; await unavailable(); process.env.AIJ_SECRET_AIJ_FOUNDATION_TEST_QINIU_SK = value;
      environment.AIJ_SECRET_AIJ_FOUNDATION_TEST_QINIU_AK = randomBytes(24).toString("hex"); process.env.AIJ_SECRET_AIJ_FOUNDATION_TEST_QINIU_AK = environment.AIJ_SECRET_AIJ_FOUNDATION_TEST_QINIU_AK; sensitive.push(environment.AIJ_SECRET_AIJ_FOUNDATION_TEST_QINIU_AK);
      assert.equal((await send("client/files/" + asset.id, { cookie })).response.status, 200); evidence.push("fresh-references-no-cache-0io-denials");
    });
    await t.test("foreign owned refs are rejected generically by the actual parser", async () => {
      const { parseStorageReadProfiles } = load("files/storage-read-profiles");
      assert.throws(() => parseStorageReadProfiles(JSON.stringify([{ ...profile, accessKeyRef: "env://AIJ_SECRET_FOREIGN_TEST_QINIU_AK" }]), runtimeConfig), /^Error: Invalid storage read profiles configuration$/);
      await assert.rejects(async () => app.get(SecretRefPort).resolveTrusted("env://AIJ_SECRET_FOREIGN_TEST_QINIU_AK")); evidence.push("foreign-ref-denied");
    });
    await t.test("project and organization disable remain effective on next read", async () => {
      await prisma.projectProfile.update({ where: { id: project.id }, data: { status: "disabled" } }); await unavailable();
      await prisma.projectProfile.update({ where: { id: project.id }, data: { status: "active" } });
      await prisma.organizationProfile.update({ where: { id: organization.id }, data: { status: "disabled" } }); await unavailable();
      await prisma.organizationProfile.update({ where: { id: organization.id }, data: { status: "active" } }); evidence.push("project-org-status-enforced");
    });
    await t.test("unknown version and cloud deletion cause zero IO and zero local compensation", async () => {
      const unknown = await makeAsset({ storageType: "qiniu:private-docs:v2" }), before = received.length;
      const local = app.get(LocalStorageAdapter); const sentinel = Buffer.from("AF153 local sentinel"); await local.write(asset.objectKey, sentinel);
      const beforeRows = await prisma.fileAsset.findMany({ orderBy: { id: "asc" } });
      const io = [], descriptors = new Map();
      for (const name of ["read", "write", "remove", "exists"]) {
        descriptors.set(name, Object.getOwnPropertyDescriptor(local, name));
        local[name] = async () => { io.push(name); throw new Error("AF153_NONLOCAL_LOCAL_IO_FORBIDDEN"); };
      }
      try {
        assert.equal((await send("client/files/" + unknown.id, { cookie })).response.status, 503);
        assert.equal((await send("client/files/" + asset.id, { method: "DELETE", cookie })).response.status, 503);
        assert.equal(received.length, before); assert.deepEqual(io, []);
        assert.deepEqual(await prisma.fileAsset.findMany({ orderBy: { id: "asc" } }), beforeRows);
      } finally {
        for (const [name, descriptor] of descriptors) { if (descriptor) Object.defineProperty(local, name, descriptor); else delete local[name]; }
      }
      assert.deepEqual(await local.read(asset.objectKey), sentinel);
      assert.equal((await prisma.fileAsset.findUniqueOrThrow({ where: { id: asset.id } })).status, "active"); evidence.push("unknown-version-delete-0io-0compensation");
    });
    await t.test("running registry ignores env changes and original local read stays intact", async () => {
      process.env.AIJ_STORAGE_READ_PROFILES = "[]";
      assert.equal((await send("client/files/" + asset.id, { cookie })).response.status, 200);
      const local = await makeAsset({ storageType: "local" }); await app.get(LocalStorageAdapter).write(local.objectKey, bytes);
      const before = received.length; const result = await send("client/files/" + local.id, { cookie }); assert.equal(result.response.status, 200); assert.deepEqual(result.bytes, bytes); assert.equal(received.length, before);
      evidence.push("immutable-snapshot-local-unaffected");
    });
    await app.close(); app = undefined;
    await t.test("actual default host starts local-only without any new Qiniu credentials", async () => {
      process.env.AIJ_STORAGE_READ_PROFILES = "[]"; delete process.env.AIJ_SECRET_AIJ_FOUNDATION_TEST_QINIU_AK; delete process.env.AIJ_SECRET_AIJ_FOUNDATION_TEST_QINIU_SK;
      const { createApplication } = load("bootstrap"); defaultApp = await createApplication(); await defaultApp.init();
      assert.equal(defaultApp.get(STORAGE_READER), defaultApp.get(LocalStorageAdapter)); assert.equal(defaultApp.get(StorageReaderRouter).resolve(profile.id), undefined);
      await defaultApp.close(); defaultApp = undefined; evidence.push("default-actual-app-local-only");
    });
    assert.deepEqual(fixtureErrors, []); assert.ok(received.every(row => row.method === "GET"));
    succeeded = true;
  } finally {
    try {
      await app?.close(); await defaultApp?.close();
      if (fixture) { fixture.closeAllConnections(); await new Promise(resolve => fixture.close(resolve)); }
      const pools = await withDatabase("test", readDatabaseEnvironment("test", process.env, lease.id), async client =>
        (await client.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND application_name LIKE 'aij-api:%'")).rows[0].n,
        { acceptanceId: lease.id });
      assert.equal(pools, 0);
      if (succeeded) writeFileSync(join(directory, "result.json"), JSON.stringify({ task, status: "VERIFIED", acceptanceId: lease.id, database: lease.database,
        tests: evidence, requests: received, realFilesModule: true, realSecretCenter: true, realHttpAndDb: true, externalNetworkCalls: 0,
        appClosed: true, fixtureClosed: true, applicationPools: pools, unknownAndDeleteLocalIO: 0, unknownAndDeleteFileAssetRowsUnchanged: true }, null, 2) + "\n", { mode: 0o600 });
    } finally { setEnvironment(original); }
  }
});
