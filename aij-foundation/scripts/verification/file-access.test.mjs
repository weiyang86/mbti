import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative } from "node:path";
import test from "node:test";
import { createAcceptance, migrate } from "../database/migration.mjs";
import { acceptanceRecord, repositoryRoot, withDatabase, readDatabaseEnvironment } from "../database/connection.mjs";
import { applicationSessions } from "./readiness-support.mjs";
import { clientEnvironment, prepareClientFixture } from "./client-auth-fixture.mjs";

const task = "AF-047";
const require = createRequire(join(repositoryRoot, "apps/api/package.json"));
const output = join(repositoryRoot, ".artifacts/verification/AF-047");
const webOrigin = "http://localhost:3655";
const pdf = Buffer.from("%PDF-1.7\nAIJ synthetic file access\n%%EOF\n");
mkdirSync(output, { recursive: true, mode: 0o700 });

test("customer file download/delete enforce database ownership and compensate failed deletion", { timeout: 240000 }, async t => {
  const lease = await createAcceptance("test", task);
  assert.equal(acceptanceRecord("test", lease.id).task, task);
  await migrate({ mode: "test", action: "deploy", acceptanceId: lease.id });
  const fixture = await prepareClientFixture(lease.id, task);
  const accountsFile = readFileSync(fixture.accounts[0].initialPasswordFile, "utf8");
  const credentials = JSON.parse(accountsFile).accounts;
  const account = credentials.find(row => row.id === fixture.accounts[0].id);
  const other = credentials.find(row => row.id === fixture.accounts[1].id);
  assert.ok(account && other, "both customer identities must come from the ignored AF-047 synthetic credential file");

  const env = clientEnvironment(lease.id, task);
  const rootRelative = join(".artifacts", "af-047", lease.database, "aij-foundation", "test", "storage");
  env.STORAGE_ENABLED = "true";
  env.LOCAL_STORAGE_ROOT = rootRelative;
  const originalEnv = { ...process.env };
  const setEnv = values => { for (const key of Object.keys(process.env)) delete process.env[key]; Object.assign(process.env, values); };
  const { createApplication } = require(join(repositoryRoot, "apps/api/dist/bootstrap.js"));
  const { PrismaService } = require(join(repositoryRoot, "apps/api/dist/prisma/prisma.service.js"));
  const { LocalStorageAdapter } = require(join(repositoryRoot, "apps/api/dist/files/local-storage.adapter.js"));
  let app, prisma, storage, apiUrl, memberCookie, otherCookie, customConstraint = false;
  const evidence = {};
  const save = (name, value) => {
    const path = join(output, name + ".json");
    writeFileSync(path, JSON.stringify(value, null, 2) + "\n", { flag: "w", mode: 0o600 });
    evidence[name] = relative(repositoryRoot, path);
  };
  const secrets = [account.password, other.password, env.JWT_SECRET, env.CLIENT_JWT_SECRET, env.CLIENT_AUTH_RATE_LIMIT_SECRET].filter(Boolean);
  const request = async (path, { method = "GET", cookie, body, origin, fetchSite } = {}) => {
    const headers = {
      connection: "close", "x-correlation-id": "af047-file-access",
      ...(cookie ? { cookie } : {}),
      ...(method === "GET" ? {} : { origin: origin || webOrigin }),
      ...(fetchSite ? { "sec-fetch-site": fetchSite } : {})
    };
    let requestBody = body;
    if (body !== undefined && !(body instanceof FormData)) {
      headers["content-type"] = "application/json";
      requestBody = JSON.stringify(body);
    }
    const response = await fetch(apiUrl + "/" + path, {
      method, headers, ...(requestBody === undefined ? {} : { body: requestBody }), signal: AbortSignal.timeout(15000)
    });
    const bytes = Buffer.from(await response.arrayBuffer());
    const text = bytes.toString("utf8");
    for (const secret of secrets) assert.ok(!text.includes(secret), "HTTP response must not echo credentials or tokens");
    assert.ok(!text.includes(repositoryRoot), "HTTP response must not reveal an absolute local path");
    assert.ok(!/\$2[aby]\$\d\d\$/.test(text), "HTTP response must not reveal password hashes");
    const isJson = response.headers.get("content-type")?.includes("application/json");
    return { response, bytes, text, body: isJson && bytes.length ? JSON.parse(text) : null };
  };
  const login = async identity => {
    const result = await request("client/auth/login", { method: "POST", body: { email: identity.email, password: identity.password } });
    assert.equal(result.response.status, 200, "synthetic customer login must use the actual HTTP API");
    const setCookie = result.response.headers.get("set-cookie"); assert.ok(setCookie);
    return setCookie.split(";")[0];
  };
  const upload = async (cookie, name) => {
    const form = new FormData();
    form.append("file", new Blob([pdf], { type: "application/pdf" }), name);
    return request("client/files", { method: "POST", cookie, body: form });
  };

  try {
    setEnv(env);
    app = await createApplication();
    await app.listen(0, "127.0.0.1");
    const address = app.getHttpServer().address();
    assert.ok(address && typeof address === "object" && address.port > 0, "API must bind an OS-selected ephemeral loopback port");
    apiUrl = `http://127.0.0.1:${address.port}/api`;
    prisma = app.get(PrismaService);
    storage = app.get(LocalStorageAdapter);
    memberCookie = await login(account);
    otherCookie = await login(other);

    const uploaded = await upload(memberCookie, "report.pdf");
    assert.equal(uploaded.response.status, 201);
    const primaryId = uploaded.body.data.id;
    const asset = await prisma.fileAsset.findUniqueOrThrow({ where: { id: primaryId } });
    assert.equal(asset.ownerId, account.id);
    assert.equal(asset.projectId, "aij-foundation");
    assert.deepEqual(await storage.read(asset.objectKey), pdf);

    await t.test("anonymous and cross-origin delete attempts cannot read or mutate an owned file", async () => {
      const anonymousGet = await request("client/files/" + primaryId);
      const anonymousDelete = await request("client/files/" + primaryId, { method: "DELETE" });
      assert.equal(anonymousGet.response.status, 401);
      assert.equal(anonymousDelete.response.status, 401);
      const crossOrigin = await request("client/files/" + primaryId, { method: "DELETE", cookie: memberCookie, origin: "https://outside.example" });
      const crossSite = await request("client/files/" + primaryId, { method: "DELETE", cookie: memberCookie, fetchSite: "cross-site" });
      assert.equal(crossOrigin.response.status, 403);
      assert.equal(crossSite.response.status, 403);
      assert.equal((await prisma.fileAsset.findUniqueOrThrow({ where: { id: primaryId } })).status, "active");
      assert.deepEqual(await storage.read(asset.objectKey), pdf);
      save("anonymous-and-csrf-denied", { anonymousGet: 401, anonymousDelete: 401, crossOriginDelete: 403, crossSiteDelete: 403, metadataAndBytesUnchanged: true });
    });

    await t.test("another authenticated customer cannot download or delete a guessed file identifier", async () => {
      const get = await request("client/files/" + primaryId, { cookie: otherCookie });
      const remove = await request("client/files/" + primaryId, { method: "DELETE", cookie: otherCookie });
      assert.equal(get.response.status, 404);
      assert.equal(remove.response.status, 404);
      assert.equal((await prisma.fileAsset.findUniqueOrThrow({ where: { id: primaryId } })).status, "active");
      assert.deepEqual(await storage.read(asset.objectKey), pdf);
      save("wrong-owner-denied", { download: 404, delete: 404, metadataAndBytesUnchanged: true });
    });

    await t.test("project scope rejects a same-owner FileAsset assigned to another project", async () => {
      const foreignId = randomUUID();
      await prisma.fileAsset.create({ data: {
        id: foreignId, originalName: "synthetic-foreign.pdf", filename: "foreign.pdf", mimeType: "application/pdf",
        size: pdf.length, path: "objects/" + randomUUID(), url: "/api/client/files/" + foreignId,
        objectKey: randomUUID(), checksum: createHash("sha256").update(pdf).digest("hex"), projectId: "synthetic-other-project",
        ownerType: "user", ownerId: account.id, uploaderId: account.id, status: "active"
      } });
      const denied = await request("client/files/" + foreignId, { cookie: memberCookie });
      assert.equal(denied.response.status, 404);
      assert.equal((await prisma.fileAsset.findUniqueOrThrow({ where: { id: foreignId } })).status, "active");
      save("cross-project-denied", { status: 404, sameOwnerOtherProjectNotReachable: true, noStorageRead: true });
    });

    await t.test("authorized download streams exact bytes with private safe headers", async () => {
      const result = await request("client/files/" + primaryId, { cookie: memberCookie });
      assert.equal(result.response.status, 200);
      assert.deepEqual(result.bytes, pdf);
      assert.equal(result.response.headers.get("content-type"), "application/pdf");
      assert.equal(result.response.headers.get("content-length"), String(pdf.length));
      assert.match(result.response.headers.get("content-disposition") || "", /attachment; filename="report\.pdf"/);
      assert.equal(result.response.headers.get("cache-control"), "private, no-store");
      assert.equal(result.response.headers.get("x-content-type-options"), "nosniff");
      save("download-success", { status: 200, bytesMatchMetadata: true, privateNoStore: true, contentType: "application/pdf", attachment: true, nosniff: true });
    });

    await t.test("authorized delete soft-deletes metadata and removes only its object", async () => {
      const result = await request("client/files/" + primaryId, { method: "DELETE", cookie: memberCookie });
      assert.equal(result.response.status, 200);
      assert.equal(result.body.data.deleted, true);
      const deleted = await prisma.fileAsset.findUniqueOrThrow({ where: { id: primaryId } });
      assert.equal(deleted.status, "deleted");
      assert.ok(deleted.deletedAt instanceof Date);
      assert.equal(await storage.exists(asset.objectKey), false);
      assert.equal((await request("client/files/" + primaryId, { cookie: memberCookie })).response.status, 404);
      assert.equal((await request("client/files/" + primaryId, { method: "DELETE", cookie: memberCookie })).response.status, 404);
      save("delete-success", { status: 200, metadataSoftDeleted: true, objectRemoved: true, repeatDownloadAndDelete: 404 });
    });

    await t.test("a real PostgreSQL delete constraint failure restores file bytes and active metadata", async () => {
      const second = await upload(memberCookie, "rollback.pdf");
      assert.equal(second.response.status, 201);
      const rollbackId = second.body.data.id;
      const rollbackAsset = await prisma.fileAsset.findUniqueOrThrow({ where: { id: rollbackId } });
      await withDatabase("test", readDatabaseEnvironment("test", process.env, lease.id), async client => {
        await client.query("ALTER TABLE public.file_asset ADD CONSTRAINT af047_block_delete CHECK (status <> 'deleted' OR original_name <> 'rollback.pdf')");
      }, { acceptanceId: lease.id });
      customConstraint = true;
      const failed = await request("client/files/" + rollbackId, { method: "DELETE", cookie: memberCookie });
      assert.equal(failed.response.status, 503);
      assert.equal(failed.body.success, false);
      assert.doesNotMatch(failed.text, /af047_block_delete|constraint|Prisma|postgres|file_asset|stack/i);
      const restored = await prisma.fileAsset.findUniqueOrThrow({ where: { id: rollbackId } });
      assert.equal(restored.status, "active");
      assert.equal(restored.deletedAt, null);
      assert.deepEqual(await storage.read(rollbackAsset.objectKey), pdf);
      assert.equal(restored.size, pdf.length);
      assert.equal(restored.checksum, createHash("sha256").update(pdf).digest("hex"));
      save("database-failure-rollback", { status: 503, actualPostgreSQLConstraintFailure: true, metadataActive: true, deletedAtNull: true, exactFileBytesRestored: true, errorRedacted: true, isolatedConstraintRetained: true });
    });

    await t.test("a missing object fails closed and marks only its owned metadata missing", async () => {
      const missingUpload = await upload(memberCookie, "missing.pdf");
      assert.equal(missingUpload.response.status, 201);
      const missingId = missingUpload.body.data.id;
      const missing = await prisma.fileAsset.findUniqueOrThrow({ where: { id: missingId } });
      await storage.remove(missing.objectKey);
      const denied = await request("client/files/" + missingId, { cookie: memberCookie });
      assert.equal(denied.response.status, 404);
      assert.equal((await prisma.fileAsset.findUniqueOrThrow({ where: { id: missingId } })).status, "missing");
      save("missing-object", { status: 404, metadataMarkedMissing: true, noBytesServed: true });
    });

    const status = await migrate({ mode: "test", action: "status", acceptanceId: lease.id });
    assert.equal(status.status, "UP_TO_DATE");
    save("migration", { status: status.status, database: lease.database, acceptanceId: lease.id });
  } finally {
    if (app) await app.close();
    setEnv(originalEnv);
  }

  assert.deepEqual(await applicationSessions(lease.id, task), [], "the AF-047 Nest application must close its PostgreSQL pool");
  save("result", {
    status: "VERIFIED", acceptanceId: lease.id, database: lease.database, ephemeralApi: true,
    accessScopedByProjectAndOwner: true, anonymousAndCrossSiteWritesDenied: true, exactDownloadBytes: true,
    successfulDelete: true, databaseFailureRestoredBytesAndMetadata: true, missingFileFailsClosed: true,
    isolatedConstraintRetained: customConstraint, applicationPoolClosed: true, evidence
  });
});
