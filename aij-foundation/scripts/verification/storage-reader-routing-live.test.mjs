// ROOT ONLY: requires a newly protected AF-151 acceptance lease and built API.
// Worker status: NOT_RUN. Never substitute AF-047/048 or an existing database.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";
import { createAcceptance, migrate } from "../database/migration.mjs";
import { acceptanceRecord, repositoryRoot } from "../database/connection.mjs";
import { applicationSessions } from "./readiness-support.mjs";
import { clientEnvironment, prepareClientFixture } from "./client-auth-fixture.mjs";

const task = "AF-151";
const require = createRequire(join(repositoryRoot, "apps/api/package.json"));
const bytes = Buffer.from("%PDF-1.7\nAF151 synthetic local routing regression\n%%EOF\n");

test("AF151 real local upload/download, unregistered storage refusal and safe restoration", { timeout: 300000 }, async () => {
  assert.equal(process.env.AIJ_AF151_ROOT_LIVE, "1");
  assert.equal(process.cwd(), "/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation");
  const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
  assert.equal(git("branch", "--show-current"), "dev");
  assert.equal(git("rev-parse", "--git-dir"), git("rev-parse", "--git-common-dir"));
  // Existing protected helpers must explicitly register AF-151 at root integration.
  // No ad-hoc connection string or reused lease can bypass their target checks.
  const lease = await createAcceptance("test", task);
  assert.equal(acceptanceRecord("test", lease.id).task, task);
  assert.equal(lease.repository, repositoryRoot);
  assert.equal((await migrate({ mode: "test", action: "deploy", acceptanceId: lease.id })).exitCode, 0);
  assert.equal((await migrate({ mode: "test", action: "status", acceptanceId: lease.id })).exitCode, 0);
  const fixture = await prepareClientFixture(lease.id, task, { fileManagement: true });
  const accounts = JSON.parse(readFileSync(fixture.accounts[0].initialPasswordFile, "utf8")).accounts;
  const member = accounts.find(a => a.id === fixture.accounts[0].id), other = accounts.find(a => a.id === fixture.accounts[1].id);
  const admin = JSON.parse(readFileSync(fixture.seed.credentials.file, "utf8"));
  assert.ok(member && other && admin.password);
  const environment = clientEnvironment(lease.id, task);
  environment.STORAGE_ENABLED = "true";
  environment.LOCAL_STORAGE_ROOT = join(".artifacts", "af-151", lease.database, "aij-foundation", "test", "storage");
  const output = join(repositoryRoot, ".artifacts/verification/AF-151", lease.id);
  mkdirSync(output, { recursive: true, mode: 0o700 });
  const prior = { ...process.env };
  const setEnvironment = values => { for (const k of Object.keys(process.env)) delete process.env[k]; Object.assign(process.env, values); };
  const { createApplication } = require(join(repositoryRoot, "apps/api/dist/bootstrap.js"));
  const { PrismaService } = require(join(repositoryRoot, "apps/api/dist/prisma/prisma.service.js"));
  const { LocalStorageAdapter } = require(join(repositoryRoot, "apps/api/dist/files/local-storage.adapter.js"));
  const { StorageReaderRouter } = require(join(repositoryRoot, "apps/api/dist/files/storage-reader-router.js"));
  const secrets = [member.password, other.password, admin.password, environment.JWT_SECRET, environment.CLIENT_JWT_SECRET,
    environment.CLIENT_AUTH_RATE_LIMIT_SECRET, environment.CLIENT_AUTH_TOKEN_SECRET].filter(Boolean);
  let app, prisma, storage, url, asset, memberCookie, adminToken;
  const originals = new Map(), io = [], writes = [];
  let restoreObservedWrites;
  const request = async (path, { method = "GET", cookie, bearer, body } = {}) => {
    const headers = { connection: "close", "x-correlation-id": "af151-storage-routing", ...(cookie ? { cookie } : {}),
      ...(bearer ? { authorization: "Bearer " + bearer } : {}), ...(method === "GET" ? {} : { origin: "http://localhost:3655" }) };
    if (body && !(body instanceof FormData)) { headers["content-type"] = "application/json"; body = JSON.stringify(body); }
    const response = await fetch(url + "/" + path, { method, headers, ...(body === undefined ? {} : { body }), signal: AbortSignal.timeout(15000) });
    const data = Buffer.from(await response.arrayBuffer()), text = data.toString("utf8");
    for (const secret of secrets) assert.ok(!text.includes(secret), "no credential material in response");
    assert.ok(!text.includes(repositoryRoot), "no absolute path in response");
    return { status: response.status, bytes: data, headers: response.headers,
      body: response.headers.get("content-type")?.includes("application/json") ? JSON.parse(text) : null };
  };
  const clientLogin = async account => {
    const result = await request("client/auth/login", { method: "POST", body: { email: account.email, password: account.password } });
    assert.equal(result.status, 200);
    const cookie = result.headers.get("set-cookie")?.split(";")[0]; assert.ok(cookie);
    secrets.push(cookie); return cookie;
  };
  const ownedWhere = () => ({ id: asset.id, projectId: "aij-foundation", workspaceId: null, pluginCode: null, ownerType: "user", ownerId: member.id, uploaderId: member.id });
  const restoreStorage = () => { if (storage) for (const [method, original] of originals) storage[method] = original; originals.clear(); };

  try {
    setEnvironment(environment);
    app = await createApplication(); await app.listen(0, "127.0.0.1");
    const address = app.getHttpServer().address(); assert.ok(address && typeof address === "object" && address.port > 0);
    url = `http://127.0.0.1:${address.port}/api`;
    prisma = app.get(PrismaService); storage = app.get(LocalStorageAdapter);
    assert.equal(app.get(StorageReaderRouter).resolve("local"), storage);
    assert.equal(app.get(StorageReaderRouter).resolve("qiniu:af151-unregistered:v1"), undefined);
    memberCookie = await clientLogin(member); const otherCookie = await clientLogin(other);
    const login = await request("auth/login", { method: "POST", body: { username: admin.username, password: admin.password } });
    assert.equal(login.status, 200); adminToken = login.body.data.accessToken; secrets.push(adminToken);
    const form = new FormData(); form.append("file", new Blob([bytes], { type: "application/pdf" }), "af151-synthetic.pdf");
    const uploaded = await request("client/files", { method: "POST", cookie: memberCookie, body: form });
    assert.equal(uploaded.status, 201);
    asset = await prisma.fileAsset.findUniqueOrThrow({ where: { id: uploaded.body.data.id } });
    assert.equal(asset.storageType, "local"); assert.equal(asset.ownerId, member.id); assert.equal(asset.projectId, "aij-foundation");
    const path = "client/files/" + asset.id, adminPath = "admin/files/" + asset.id;
    for (const [endpoint, auth] of [[path, { cookie: memberCookie }], [adminPath, { bearer: adminToken }]]) {
      const downloaded = await request(endpoint, auth); assert.equal(downloaded.status, 200); assert.deepEqual(downloaded.bytes, bytes);
    }
    assert.equal((await request(path, { cookie: otherCookie })).status, 404);
    assert.equal((await request(path, { method: "DELETE", cookie: otherCookie })).status, 404);
    assert.deepEqual(await storage.read(asset.objectKey), bytes);

    // Change ONLY the task-owned row's storageType; keep path/key/integrity/state.
    const changed = await prisma.fileAsset.updateMany({ where: { ...ownedWhere(), storageType: "local", status: "active", deletedAt: null }, data: { storageType: "qiniu:af151-unregistered:v1" } });
    assert.equal(changed.count, 1);
    const before = await prisma.fileAsset.findUniqueOrThrow({ where: { id: asset.id } });
    // Observe every FileAsset mutator after the controlled type update, including
    // writes that would otherwise be hidden by later state compensation.
    const delegate = prisma.fileAsset;
    const mutators = ["create", "createMany", "createManyAndReturn", "update", "updateMany", "updateManyAndReturn", "upsert", "delete", "deleteMany"];
    const savedMutators = new Map();
    for (const method of mutators) if (typeof delegate[method] === "function") {
      const original = delegate[method]; savedMutators.set(method, original);
      delegate[method] = (...args) => { writes.push(method); return original.apply(delegate, args); };
    }
    restoreObservedWrites = () => { for (const [method, original] of savedMutators) delegate[method] = original; };
    for (const method of ["read", "write", "remove", "exists"]) {
      originals.set(method, storage[method]);
      storage[method] = async () => { io.push(method); throw new Error("AF151 unexpected local I/O"); };
    }
    for (const [endpoint, auth] of [[path, { cookie: memberCookie }], [adminPath, { bearer: adminToken }]]) {
      const result = await request(endpoint, auth); assert.equal(result.status, 503); assert.notDeepEqual(result.bytes, bytes);
      assert.equal(result.body.success, false);
    }
    const deniedDelete = await request(path, { method: "DELETE", cookie: memberCookie });
    assert.equal(deniedDelete.status, 503); assert.equal(deniedDelete.body.success, false);
    assert.equal((await request(path, { cookie: otherCookie })).status, 404);
    assert.equal((await request(path, { method: "DELETE", cookie: otherCookie })).status, 404);
    assert.deepEqual(io, []); assert.deepEqual(writes, []);
    const after = await prisma.fileAsset.findUniqueOrThrow({ where: { id: asset.id } });
    assert.deepEqual(after, before, "no missing/corrupt/deleting/deleted claim or compensation metadata write");
    restoreObservedWrites(); restoreObservedWrites = undefined; restoreStorage();
    assert.deepEqual(await storage.read(asset.objectKey), bytes, "the original local object was never removed or replaced");
    const restored = await prisma.fileAsset.updateMany({ where: { ...ownedWhere(), storageType: "qiniu:af151-unregistered:v1", status: "active", deletedAt: null }, data: { storageType: "local" } });
    assert.equal(restored.count, 1);
    for (const [endpoint, auth] of [[path, { cookie: memberCookie }], [adminPath, { bearer: adminToken }]]) {
      const result = await request(endpoint, auth); assert.equal(result.status, 200); assert.deepEqual(result.bytes, bytes);
    }
    const cleanup = await request(path, { method: "DELETE", cookie: memberCookie });
    assert.equal(cleanup.status, 200); assert.equal(cleanup.body.data.deleted, true);
    const deleted = await prisma.fileAsset.findUniqueOrThrow({ where: { id: asset.id } });
    assert.equal(deleted.status, "deleted"); assert.ok(deleted.deletedAt); assert.equal(await storage.exists(asset.objectKey), false);
    assert.deepEqual(readdirSync(join(repositoryRoot, environment.LOCAL_STORAGE_ROOT, "objects")), []);
  } finally {
    restoreObservedWrites?.(); restoreStorage();
    try {
      if (asset && prisma && storage) {
        // Only this lease's uploaded synthetic row/key may be restored or cleaned.
        const current = await prisma.fileAsset.findFirst({ where: ownedWhere() });
        if (current && current.status === "active") {
          if (current.storageType === "qiniu:af151-unregistered:v1") await prisma.fileAsset.updateMany({ where: { ...ownedWhere(), storageType: current.storageType, status: "active" }, data: { storageType: "local" } });
          if (memberCookie) assert.equal((await request("client/files/" + asset.id, { method: "DELETE", cookie: memberCookie })).status, 200);
        }
      }
    } finally { try { await app?.close(); } finally { setEnvironment(prior); } }
  }
  assert.deepEqual(await applicationSessions(lease.id, task), []);
  writeFileSync(join(output, "result.json"), JSON.stringify({ task, status: "VERIFIED", acceptanceId: lease.id, database: lease.database,
    localUploadAndDownloads: true, unknownStorageClientAdmin503: true, nonlocalDelete503: true, crossUser404: true,
    localIO: io, fileAssetWritesDuringRefusal: writes, refusedStateUnchanged: true, restoredLocalBytes200: true, normalCleanup: true, poolClosed: true }, null, 2) + "\n", { mode: 0o600 });
});
