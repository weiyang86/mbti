import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative } from "node:path";
import test from "node:test";
import { createAcceptance, migrate } from "../database/migration.mjs";
import { acceptanceRecord, readDatabaseEnvironment, repositoryRoot, withDatabase } from "../database/connection.mjs";
import { applicationSessions } from "./readiness-support.mjs";
import { clientEnvironment, clientKeys, prepareClientFixture } from "./client-auth-fixture.mjs";

const task = "AF-046";
const maxBytes = 5 * 1024 * 1024;
const require = createRequire(join(repositoryRoot, "apps/api/package.json"));
const output = join(repositoryRoot, ".artifacts/verification/AF-046");
mkdirSync(output, { recursive: true, mode: 0o700 });

test("customer file upload enforces type, size, origin, path and FileAsset consistency over real HTTP/PostgreSQL", { timeout: 180000 }, async t => {
  const lease = await createAcceptance("test", task);
  assert.equal(acceptanceRecord("test", lease.id).task, task);
  await migrate({ mode: "test", action: "deploy", acceptanceId: lease.id });
  const fixture = await prepareClientFixture(lease.id, task);
  const account = JSON.parse(readFileSync(fixture.accounts[0].initialPasswordFile, "utf8")).accounts.find(row => row.id === fixture.accounts[0].id);
  assert.ok(account, "customer credential must belong to this ignored AF-046 fixture file");

  const env = clientEnvironment(lease.id, task);
  const keys = clientKeys(lease.id, task);
  const rootRelative = join(".artifacts", "af-046", lease.database, "aij-foundation", "test", "storage");
  env.STORAGE_ENABLED = "true";
  env.LOCAL_STORAGE_ROOT = rootRelative;
  const storageRoot = join(repositoryRoot, rootRelative);
  const objectsRoot = join(storageRoot, "objects");
  const originalEnv = { ...process.env };
  const setEnv = values => { for (const key of Object.keys(process.env)) delete process.env[key]; Object.assign(process.env, values); };
  const { createApplication } = require(join(repositoryRoot, "apps/api/dist/bootstrap.js"));
  const { PrismaService } = require(join(repositoryRoot, "apps/api/dist/prisma/prisma.service.js"));
  let app, prisma, baseUrl, sessionCookie, constraintInstalled = false;
  const saved = {};
  const save = (name, value) => {
    const path = join(output, name + ".json");
    writeFileSync(path, JSON.stringify(value, null, 2) + "\n", { flag: "w", mode: 0o600 });
    saved[name] = relative(repositoryRoot, path);
  };
  const secrets = [account.password, env.JWT_SECRET, keys.value.CLIENT_JWT_SECRET, keys.value.CLIENT_AUTH_RATE_LIMIT_SECRET];
  const objectNames = () => {
    try { return new Set(readdirSync(objectsRoot)); }
    catch (error) { if (error.code === "ENOENT") return new Set(); throw error; }
  };
  const send = async (path, expected, options = {}) => {
    const response = await fetch(baseUrl + path, { method: options.method || "GET", headers: {
      connection: "close", "x-correlation-id": "af046-file-upload",
      ...(options.cookie ? { cookie: options.cookie } : {}),
      ...(options.origin ? { origin: options.origin } : options.method && options.method !== "GET" ? { origin: "http://localhost:3655" } : {}),
      ...(options.fetchSite ? { "sec-fetch-site": options.fetchSite } : {}),
      ...(options.form ? {} : options.body === undefined ? {} : { "content-type": "application/json" })
    }, ...(options.body === undefined ? {} : { body: options.body }), signal: AbortSignal.timeout(15000) });
    if (expected !== null) assert.equal(response.status, expected, `${options.method || "GET"} ${path}`);
    const text = await response.text();
    for (const secret of secrets) assert.ok(!text.includes(secret), "HTTP response must not echo credentials or tokens");
    assert.ok(!text.includes(repositoryRoot), "HTTP response must not reveal an absolute local path");
    assert.ok(!/\$2[aby]\$\d\d\$/.test(text), "HTTP response must not reveal password hashes");
    return { response, body: text ? JSON.parse(text) : null, text };
  };
  const upload = async (cookie, bytes, mimeType, name, fields = {}, options = {}) => {
    const form = new FormData();
    form.append("file", new Blob([bytes], { type: mimeType }), name);
    for (const [key, value] of Object.entries(fields)) form.append(key, value);
    return send("", options.expected, { method: "POST", cookie, form: true, body: form, origin: options.origin, fetchSite: options.fetchSite });
  };

  try {
    setEnv(env);
    app = await createApplication();
    await app.listen(0, "127.0.0.1");
    const address = app.getHttpServer().address();
    assert.ok(address && typeof address === "object" && address.port > 0, "test API must bind an OS-selected ephemeral loopback port");
    baseUrl = `http://127.0.0.1:${address.port}/api/client/files`;
    prisma = app.get(PrismaService);

    await t.test("anonymous upload is rejected before storage or metadata writes", async () => {
      const before = await prisma.fileAsset.count();
      const filesBefore = await objectNames();
      const out = await upload(undefined, Buffer.from("%PDF-1.7\nsynthetic"), "application/pdf", "anonymous.pdf", {}, { expected: 401 });
      assert.equal(out.response.headers.get("cache-control"), "no-store");
      assert.equal(await prisma.fileAsset.count(), before);
      assert.deepEqual(await objectNames(), filesBefore);
      save("anonymous-rejected", { status: out.response.status, noMetadataWrite: true, noObjectWrite: true });
    });

    const login = await fetch(baseUrl.replace("/client/files", "/client/auth/login"), {
      method: "POST", headers: { connection: "close", origin: "http://localhost:3655", "content-type": "application/json", "x-correlation-id": "af046-login" },
      body: JSON.stringify({ email: account.email, password: account.password }), signal: AbortSignal.timeout(15000)
    });
    assert.equal(login.status, 200, "synthetic customer login must succeed through the real API");
    const loginText = await login.text();
    for (const secret of secrets) assert.ok(!loginText.includes(secret));
    const setCookie = login.headers.get("set-cookie"); assert.ok(setCookie);
    sessionCookie = setCookie.split(";")[0];

    await t.test("allowed PDF stores exact bytes and server-owned metadata; client cannot choose scope", async () => {
      const bytes = Buffer.from("%PDF-1.7\nAIJ synthetic upload\n%%EOF\n");
      const out = await upload(sessionCookie, bytes, "application/pdf", "../../outside/../private-note.pdf", { projectId: "foreign-project", ownerId: "forged-owner", workspaceId: "forged-workspace" }, { expected: 201 });
      assert.equal(out.body.success, true);
      const receipt = out.body.data;
      assert.equal(receipt.originalName, "private-note.pdf");
      assert.equal(receipt.mimeType, "application/pdf");
      assert.equal(receipt.size, bytes.length);
      assert.equal(receipt.checksum, createHash("sha256").update(bytes).digest("hex"));
      assert.equal("path" in receipt, false);
      assert.equal("objectKey" in receipt, false);
      const asset = await prisma.fileAsset.findUniqueOrThrow({ where: { id: receipt.id } });
      assert.equal(asset.projectId, "aij-foundation");
      assert.equal(asset.ownerType, "user");
      assert.equal(asset.ownerId, account.id);
      assert.equal(asset.uploaderId, account.id);
      assert.equal(asset.workspaceId, null);
      assert.equal(asset.pluginCode, null);
      assert.equal(asset.originalName, "private-note.pdf");
      assert.equal(asset.filename.includes("/"), false);
      assert.equal(asset.size, bytes.length);
      assert.equal(asset.checksum, createHash("sha256").update(bytes).digest("hex"));
      assert.match(asset.objectKey, /^[0-9a-f-]{36}$/);
      assert.equal(asset.path, "objects/" + asset.objectKey);
      const { LocalStorageAdapter } = require(join(repositoryRoot, "apps/api/dist/files/local-storage.adapter.js"));
      const storage = app.get(LocalStorageAdapter);
      assert.deepEqual(await storage.read(asset.objectKey), bytes, "persisted file bytes must match FileAsset size/checksum");
      assert.equal(asset.status, "active");
      save("upload-success", { status: out.response.status, fileAssetId: asset.id, projectId: asset.projectId, ownerType: asset.ownerType,
        ownerIdMatchesSyntheticMember: asset.ownerId === account.id, uploaderMatchesOwner: asset.uploaderId === asset.ownerId,
        workspaceId: asset.workspaceId, pluginCode: asset.pluginCode, mimeType: asset.mimeType, size: asset.size,
        checksumMatchesBytes: asset.checksum === createHash("sha256").update(bytes).digest("hex"), relativeStoragePath: asset.path,
        returnedPathFields: false, storageRootRelative: true });
    });

    await t.test("cross-origin and cross-site uploads are rejected without state changes", async () => {
      const before = await prisma.fileAsset.count(); const filesBefore = await objectNames();
      const crossOrigin = await upload(sessionCookie, Buffer.from("plain"), "text/plain", "cross.txt", {}, { expected: 403, origin: "https://outside.example" });
      assert.equal(crossOrigin.response.headers.get("set-cookie"), null);
      const crossSite = await upload(sessionCookie, Buffer.from("plain"), "text/plain", "cross-site.txt", {}, { expected: 403, fetchSite: "cross-site" });
      assert.equal(crossSite.response.headers.get("set-cookie"), null);
      assert.equal(await prisma.fileAsset.count(), before);
      assert.deepEqual(await objectNames(), filesBefore);
      save("origin-rejected", { crossOrigin: crossOrigin.response.status, crossSite: crossSite.response.status, noStateChange: true });
    });

    await t.test("unsupported claimed media and mismatched content signatures fail before writing", async () => {
      const before = await prisma.fileAsset.count(); const filesBefore = await objectNames();
      await upload(sessionCookie, Buffer.from("<html>unsafe</html>"), "text/html", "unsafe.html", {}, { expected: 400 });
      await upload(sessionCookie, Buffer.from("not png"), "image/png", "fake.png", {}, { expected: 400 });
      await upload(sessionCookie, Buffer.from([0xff, 0xd8, 0xff, 0x00]), "image/jpeg", "short.jpg", {}, { expected: 400 });
      assert.equal(await prisma.fileAsset.count(), before);
      assert.deepEqual(await objectNames(), filesBefore);
      save("type-rejected", { unsupportedHtml: true, signatureMismatch: true, noStateChange: true });
    });

    await t.test("file size limit rejects oversized input without partial writes", async () => {
      const before = await prisma.fileAsset.count(); const filesBefore = await objectNames();
      const bytes = Buffer.alloc(maxBytes + 1, 0x61);
      const response = await upload(sessionCookie, bytes, "text/plain", "oversized.txt", {}, { expected: null });
      assert.ok([400, 413].includes(response.response.status), `expected 400/413, got ${response.response.status}`);
      assert.equal(await prisma.fileAsset.count(), before);
      assert.deepEqual(await objectNames(), filesBefore);
      save("size-rejected", { status: response.response.status, maxBytes, attemptedBytes: bytes.length, noStateChange: true });
    });

    await t.test("PostgreSQL constraint failure removes the just-written file and returns a safe error", async () => {
      const before = await prisma.fileAsset.count(); const filesBefore = await objectNames();
      await withDatabase("test", readDatabaseEnvironment("test", process.env, lease.id), async client => {
        await client.query("ALTER TABLE public.file_asset ADD CONSTRAINT af046_force_metadata_reject CHECK (original_name <> 'af046-db-reject.txt')");
      }, { acceptanceId: lease.id });
      constraintInstalled = true;
      const out = await upload(sessionCookie, Buffer.from("synthetic database rollback probe\n"), "text/plain", "af046-db-reject.txt", {}, { expected: 503 });
      assert.equal(out.body.success, false);
      assert.doesNotMatch(out.text, /postgres|constraint|Prisma|af046_force|stack|file_asset/i);
      assert.equal(await prisma.fileAsset.count(), before);
      assert.deepEqual(await objectNames(), filesBefore, "the object written before the failed DB insert must be removed");
      save("database-failure-rollback", { status: out.response.status, forcedRealDatabaseConstraintFailure: true, metadataUnchanged: true, objectRemoved: true, errorRedacted: true });
    });

    const status = await migrate({ mode: "test", action: "status", acceptanceId: lease.id });
    assert.equal(status.status, "UP_TO_DATE");
    save("migration", { status: status.status, database: lease.database, acceptanceId: lease.id, apiAddress: baseUrl });
  } finally {
    if (constraintInstalled) {
      await withDatabase("test", readDatabaseEnvironment("test", process.env, lease.id), async client => {
        await client.query("ALTER TABLE public.file_asset DROP CONSTRAINT IF EXISTS af046_force_metadata_reject");
      }, { acceptanceId: lease.id });
    }
    if (app) await app.close();
    setEnv(originalEnv);
  }

  assert.deepEqual(await applicationSessions(lease.id, task), [], "the AF-046 Nest application must release all test PostgreSQL sessions");
  save("result", { status: "VERIFIED", acceptanceId: lease.id, database: lease.database, apiAddress: baseUrl,
    successfulFileMetadataAndBytesMatch: true, deniedWritesHaveNoStateChange: true, databaseFailureObjectRollback: true,
    poolsClosed: true, credentialValuesNotRecorded: true });
});
