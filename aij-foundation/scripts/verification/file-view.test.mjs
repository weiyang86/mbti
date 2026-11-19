import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative } from "node:path";
import test from "node:test";
import { createAcceptance, migrate } from "../database/migration.mjs";
import { acceptanceRecord, readDatabaseEnvironment, repositoryRoot, withDatabase } from "../database/connection.mjs";
import { applicationSessions } from "./readiness-support.mjs";
import { clientEnvironment, prepareClientFixture } from "./client-auth-fixture.mjs";

const task = "AF-048";
const require = createRequire(join(repositoryRoot, "apps/api/package.json"));
const output = join(repositoryRoot, ".artifacts/verification/AF-048");
const pdf = Buffer.from("%PDF-1.7\nAIJ synthetic file view\n%%EOF\n");
mkdirSync(output, { recursive: true, mode: 0o700 });

test("customer and administrator file views enforce project ownership and verify actual local bytes", { timeout: 300000 }, async t => {
  const lease = await createAcceptance("test", task);
  assert.equal(acceptanceRecord("test", lease.id).task, task);
  await migrate({ mode: "test", action: "deploy", acceptanceId: lease.id });
  const fixture = await prepareClientFixture(lease.id, task, { fileManagement: true, menuManagement: true });
  const accounts = JSON.parse(readFileSync(fixture.accounts[0].initialPasswordFile, "utf8")).accounts;
  const member = accounts.find(row => row.id === fixture.accounts[0].id);
  const other = accounts.find(row => row.id === fixture.accounts[1].id);
  const adminFile = fixture.seed.credentials.file;
  const admin = JSON.parse(readFileSync(adminFile, "utf8"));
  assert.ok(member && other && admin.password, "client and admin synthetic credentials must be scoped to this ignored AF-048 lease");

  const environment = clientEnvironment(lease.id, task);
  const storageRelative = join(".artifacts", "af-048", lease.database, "aij-foundation", "test", "storage");
  const storageRoot = join(repositoryRoot, storageRelative), objectsRoot = join(storageRoot, "objects");
  environment.STORAGE_ENABLED = "true";
  environment.LOCAL_STORAGE_ROOT = storageRelative;
  const previousEnvironment = { ...process.env };
  const setEnvironment = values => { for (const key of Object.keys(process.env)) delete process.env[key]; Object.assign(process.env, values); };
  const { createApplication } = require(join(repositoryRoot, "apps/api/dist/bootstrap.js"));
  const { PrismaService } = require(join(repositoryRoot, "apps/api/dist/prisma/prisma.service.js"));
  const { LocalStorageAdapter } = require(join(repositoryRoot, "apps/api/dist/files/local-storage.adapter.js"));
  let app, prisma, storage, apiUrl, memberCookie, otherCookie, adminToken, readerToken;
  const createdIds = [], objectKeys = [];
  const evidence = {};
  const save = (name, value) => {
    const path = join(output, lease.id + "-" + name + ".json");
    writeFileSync(path, JSON.stringify(value, null, 2) + "\n", { flag: "w", mode: 0o600 });
    evidence[name] = relative(repositoryRoot, path);
  };
  const secrets = [member.password, other.password, admin.password, environment.JWT_SECRET, environment.CLIENT_JWT_SECRET, environment.CLIENT_AUTH_RATE_LIMIT_SECRET].filter(Boolean);
  const send = async (path, { method = "GET", cookie, bearer, body, form, origin, fetchSite } = {}) => {
    const headers = { connection: "close", "x-correlation-id": "af048-file-view", ...(cookie ? { cookie } : {}), ...(bearer ? { authorization: "Bearer " + bearer } : {}),
      ...(method === "GET" ? {} : { origin: origin || "http://localhost:3655" }), ...(fetchSite ? { "sec-fetch-site": fetchSite } : {}) };
    let requestBody = body;
    if (form) requestBody = form;
    else if (body !== undefined) { headers["content-type"] = "application/json"; requestBody = JSON.stringify(body); }
    const response = await fetch(apiUrl + "/" + path, { method, headers, ...(requestBody === undefined ? {} : { body: requestBody }), signal: AbortSignal.timeout(15000) });
    const bytes = Buffer.from(await response.arrayBuffer()), text = bytes.toString("utf8");
    for (const secret of secrets) assert.ok(!text.includes(secret), "HTTP response must not echo credential or token material");
    assert.ok(!text.includes(repositoryRoot), "HTTP response must not expose an absolute local path");
    assert.ok(!/\$2[aby]\$\d\d\$/.test(text), "HTTP response must not expose a password hash");
    const json = response.headers.get("content-type")?.includes("application/json");
    return { response, bytes, text, body: json && bytes.length ? JSON.parse(text) : null };
  };
  const loginClient = async account => {
    const result = await send("client/auth/login", { method: "POST", body: { email: account.email, password: account.password } });
    assert.equal(result.response.status, 200);
    const cookie = result.response.headers.get("set-cookie"); assert.ok(cookie);
    return cookie.split(";")[0];
  };
  const upload = async (cookie, name, bytes = pdf) => {
    const form = new FormData(); form.append("file", new Blob([bytes], { type: "application/pdf" }), name);
    const result = await send("client/files", { method: "POST", cookie, form });
    assert.equal(result.response.status, 201, "file upload must use the actual customer HTTP route");
    createdIds.push(result.body.data.id);
    const asset = await prisma.fileAsset.findUniqueOrThrow({ where: { id: result.body.data.id } });
    objectKeys.push(asset.objectKey);
    return { result, asset };
  };

  try {
    setEnvironment(environment);
    app = await createApplication();
    await app.listen(0, "127.0.0.1");
    const address = app.getHttpServer().address();
    assert.ok(address && typeof address === "object" && address.port > 0, "owned API must bind a task-selected ephemeral loopback port");
    apiUrl = `http://127.0.0.1:${address.port}/api`;
    prisma = app.get(PrismaService); storage = app.get(LocalStorageAdapter);

    const anonymousClient = await send("client/files?page=1&pageSize=20");
    const anonymousAdmin = await send("admin/files?page=1&pageSize=20");
    assert.equal(anonymousClient.response.status, 401); assert.equal(anonymousAdmin.response.status, 401);
    save("anonymous-denied", { customerList: 401, administratorList: 401 });

    memberCookie = await loginClient(member); otherCookie = await loginClient(other);
    const adminLogin = await send("auth/login", { method: "POST", body: { username: admin.username, password: admin.password } });
    assert.equal(adminLogin.response.status, 200, "synthetic administrator must sign in through the real HTTP API");
    adminToken = adminLogin.body.data.accessToken;
    assert.ok(typeof adminToken === "string" && adminToken.length > 20);

    const readerPassword = "Q8-" + randomBytes(24).toString("hex");
    const bcrypt = require("bcryptjs");
    await prisma.sysUser.create({ data: { username: "af048-reader-" + lease.id.slice(0, 8), passwordHash: await bcrypt.hash(readerPassword, 12), realName: "AF-048 reader" } });
    const readerLogin = await send("auth/login", { method: "POST", body: { username: "af048-reader-" + lease.id.slice(0, 8), password: readerPassword } });
    assert.equal(readerLogin.response.status, 200, "ordinary administrator fixture must authenticate");
    readerToken = readerLogin.body.data.accessToken; secrets.push(readerPassword, readerToken);
    const forbidden = await send("admin/files", { bearer: readerToken });
    assert.equal(forbidden.response.status, 403, "RBAC must deny a direct API call without the registered files permission");
    save("rbac-denied", { authenticatedWithoutFilePermission: 403 });

    const first = await upload(memberCookie, "customer-one.pdf", pdf);
    const second = await upload(memberCookie, "customer-two.pdf", Buffer.from("%PDF-1.7\nsecond synthetic pdf\n%%EOF\n"));
    const third = await upload(memberCookie, "customer-three.pdf", Buffer.from("%PDF-1.7\nthird synthetic pdf\n%%EOF\n"));

    await t.test("customer list is owner-scoped, paginated and excludes storage internals", async () => {
      const page1 = await send("client/files?page=1&pageSize=2", { cookie: memberCookie });
      const page2 = await send("client/files?page=2&pageSize=2", { cookie: memberCookie });
      const empty = await send("client/files?page=1&pageSize=20", { cookie: otherCookie });
      assert.equal(page1.response.status, 200); assert.equal(page1.body.data.total, 3); assert.equal(page1.body.data.items.length, 2);
      assert.equal(page2.body.data.items.length, 1); assert.equal(empty.body.data.total, 0); assert.equal(empty.body.data.items.length, 0);
      const ids = [...page1.body.data.items, ...page2.body.data.items].map(row => row.id);
      assert.deepEqual(new Set(ids), new Set([first.asset.id, second.asset.id, third.asset.id]));
      for (const item of page1.body.data.items) for (const hidden of ["path", "objectKey", "checksum"]) assert.equal(Object.hasOwn(item, hidden), false);
      save("customer-list", { status: 200, total: 3, pages: [2, 1], otherOwnerTotal: 0, storageInternalsExcluded: true });
    });

    await t.test("admin list is permission-guarded and returns safe current-project metadata", async () => {
      const list = await send("admin/files?page=1&pageSize=2", { bearer: adminToken });
      assert.equal(list.response.status, 200); assert.equal(list.body.data.total, 3); assert.equal(list.body.data.items.length, 2);
      for (const row of list.body.data.items) {
        assert.equal(row.projectId, undefined); assert.equal(row.path, undefined); assert.equal(row.objectKey, undefined); assert.equal(row.checksum, undefined);
        assert.equal(row.ownerId, member.id);
      }
      save("admin-list", { status: 200, total: 3, pageSize: 2, storageInternalsExcluded: true, currentProjectOnly: true });
    });

    await t.test("the registered admin page can be added to the authorized menu catalog", async () => {
      const pageCatalog = await send("admin/menus/pages", { bearer: adminToken });
      assert.equal(pageCatalog.response.status, 200);
      assert.ok(pageCatalog.body.data.some(page => page.path === "/auth/files" && page.available === true));
      const created = await send("admin/menus", { method: "POST", bearer: adminToken, body: { title: "客户文件", path: "/auth/files", permissionCode: "admin.file.read", sortOrder: 950 } });
      assert.equal(created.response.status, 201);
      const visible = await send("admin/menus/my", { bearer: adminToken });
      const flatten = nodes => nodes.flatMap(node => [...(node.path ? [node.path] : []), ...flatten(node.children)]);
      assert.ok(flatten(visible.body.data).includes("/auth/files"));
      save("admin-page-menu", { pageAvailable: true, menuCreated: 201, permission: "admin.file.read", visibleToAuthorizedAdmin: true });
    });

    await t.test("customer and administrator download the same verified bytes through separate auth", async () => {
      const customer = await send("client/files/" + first.asset.id, { cookie: memberCookie });
      const administrator = await send("admin/files/" + first.asset.id, { bearer: adminToken });
      assert.equal(customer.response.status, 200); assert.equal(administrator.response.status, 200);
      assert.deepEqual(customer.bytes, pdf); assert.deepEqual(administrator.bytes, pdf);
      for (const response of [customer.response, administrator.response]) {
        assert.equal(response.headers.get("cache-control"), "private, no-store");
        assert.equal(response.headers.get("x-content-type-options"), "nosniff");
        assert.equal(response.headers.get("content-type"), "application/pdf");
        assert.match(response.headers.get("content-disposition") || "", /attachment; filename=/);
      }
      save("authorized-downloads", { customerStatus: 200, adminStatus: 200, exactBytes: true, checksum: first.asset.checksum, safeHeaders: true });
    });

    await t.test("cross-project rows remain invisible even with a valid owner and guessed ID", async () => {
      const foreignId = randomUUID(), objectKey = randomUUID(); createdIds.push(foreignId);
      await prisma.fileAsset.create({ data: { id: foreignId, originalName: "foreign-synthetic.pdf", filename: "foreign.pdf", mimeType: "application/pdf", size: pdf.length,
        path: "objects/" + objectKey, url: "/api/admin/files/" + foreignId, objectKey, checksum: createHash("sha256").update(pdf).digest("hex"),
        projectId: "af048-synthetic-other-project", workspaceId: null, pluginCode: null, ownerType: "user", ownerId: member.id, uploaderId: member.id, status: "active" } });
      const customerList = await send("client/files?page=1&pageSize=100", { cookie: memberCookie });
      const adminList = await send("admin/files?page=1&pageSize=100", { bearer: adminToken });
      assert.equal(customerList.body.data.items.some(row => row.id === foreignId), false);
      assert.equal(adminList.body.data.items.some(row => row.id === foreignId), false);
      assert.equal((await send("client/files/" + foreignId, { cookie: memberCookie })).response.status, 404);
      assert.equal((await send("admin/files/" + foreignId, { bearer: adminToken })).response.status, 404);
      assert.equal((await prisma.fileAsset.findUniqueOrThrow({ where: { id: foreignId } })).status, "active");
      save("cross-project-denied", { customerListExcluded: true, adminListExcluded: true, customerDownload: 404, adminDownload: 404, foreignMetadataUnchanged: true });
    });

    await t.test("invalid pagination is rejected by both endpoints", async () => {
      assert.equal((await send("client/files?page=0", { cookie: memberCookie })).response.status, 400);
      assert.equal((await send("admin/files?pageSize=101", { bearer: adminToken })).response.status, 400);
      save("invalid-pagination", { customerPageZero: 400, adminPageSizeOverLimit: 400 });
    });

    await t.test("missing objects fail closed and are marked missing", async () => {
      const { asset } = await upload(memberCookie, "missing.pdf");
      await storage.remove(asset.objectKey);
      const response = await send("client/files/" + asset.id, { cookie: memberCookie });
      assert.equal(response.response.status, 404); assert.equal(response.response.headers.get("content-type")?.includes("application/json"), true);
      assert.notDeepEqual(response.bytes, pdf, "missing file must never return document bytes");
      assert.equal((await prisma.fileAsset.findUniqueOrThrow({ where: { id: asset.id } })).status, "missing");
      assert.equal((await send("admin/files/" + asset.id, { bearer: adminToken })).response.status, 404);
      save("missing-object", { customerStatus: 404, adminStatus: 404, metadataStatus: "missing", noBytesServed: true });
    });

    await t.test("corrupt objects are refused, marked corrupt and never streamed", async () => {
      const { asset } = await upload(memberCookie, "corrupt.pdf");
      await storage.remove(asset.objectKey);
      await storage.write(asset.objectKey, Buffer.from("%PDF-1.7\ncorrupt replacement bytes\n%%EOF\n"));
      const response = await send("client/files/" + asset.id, { cookie: memberCookie });
      assert.equal(response.response.status, 503); assert.equal(response.response.headers.get("content-type")?.includes("application/json"), true);
      assert.notDeepEqual(response.bytes, Buffer.from("%PDF-1.7\ncorrupt replacement bytes\n%%EOF\n"), "corrupt file must never return stored bytes");
      assert.equal((await prisma.fileAsset.findUniqueOrThrow({ where: { id: asset.id } })).status, "corrupt");
      assert.doesNotMatch(response.text, /checksum|hash|objectKey|storage|file_asset|postgres|stack/i);
      await storage.remove(asset.objectKey);
      save("corrupt-object", { status: 503, metadataStatus: "corrupt", noBytesServed: true, errorRedacted: true, corruptedBytesRemoved: true });
    });

    await t.test("administrator independently detects a corrupt object and hides it from later download", async () => {
      const { asset } = await upload(memberCookie, "admin-corrupt.pdf");
      await storage.remove(asset.objectKey);
      await storage.write(asset.objectKey, Buffer.from("%PDF-1.7\nadmin-side corrupt bytes\n%%EOF\n"));
      const response = await send("admin/files/" + asset.id, { bearer: adminToken });
      assert.equal(response.response.status, 503); assert.equal(response.response.headers.get("content-type")?.includes("application/json"), true);
      assert.notDeepEqual(response.bytes, Buffer.from("%PDF-1.7\nadmin-side corrupt bytes\n%%EOF\n"), "admin corrupt-file response must not stream bytes");
      assert.equal((await prisma.fileAsset.findUniqueOrThrow({ where: { id: asset.id } })).status, "corrupt");
      assert.equal((await send("admin/files/" + asset.id, { bearer: adminToken })).response.status, 404);
      await storage.remove(asset.objectKey);
      save("admin-corrupt-object", { status: 503, subsequentStatus: 404, metadataStatus: "corrupt", noBytesServed: true, objectRemoved: true });
    });

    await t.test("authorized customer cleanup soft-deletes metadata and removes each owned object", async () => {
      const active = [first.asset, second.asset, third.asset];
      for (const asset of active) {
        const deleted = await send("client/files/" + asset.id, { method: "DELETE", cookie: memberCookie });
        assert.equal(deleted.response.status, 200);
        assert.equal((await prisma.fileAsset.findUniqueOrThrow({ where: { id: asset.id } })).status, "deleted");
        assert.equal(await storage.exists(asset.objectKey), false);
      }
      const remaining = await send("client/files?page=1&pageSize=100", { cookie: memberCookie });
      assert.equal(remaining.body.data.items.some(row => active.some(asset => asset.id === row.id)), false);
      save("cleanup", { activeRecordsSoftDeleted: 3, objectBytesRemoved: 3, deletedFilesHidden: true, noSharedDataTouched: true });
    });

    const status = await migrate({ mode: "test", action: "status", acceptanceId: lease.id });
    assert.equal(status.status, "UP_TO_DATE");
    save("migration", { status: status.status, database: lease.database, acceptanceId: lease.id });
  } finally {
    if (app && prisma) {
      await prisma.fileAsset.updateMany({ where: { id: { in: createdIds }, projectId: { in: ["aij-foundation", "af048-synthetic-other-project"] }, workspaceId: null, pluginCode: null }, data: { status: "deleted", deletedAt: new Date() } }).catch(() => undefined);
      if (storage) for (const key of objectKeys) {
        try { if (await storage.exists(key)) await storage.remove(key); } catch { /* Only task-created object keys are eligible for cleanup. */ }
      }
    }
    if (app) await app.close();
    setEnvironment(previousEnvironment);
  }

  assert.ok(existsSync(storageRoot), "AF-048 must exercise an isolated local storage root");
  assert.deepEqual(readdirSync(objectsRoot), [], "all task-created synthetic object bytes must be cleaned after assertions");
  assert.deepEqual(await applicationSessions(lease.id, task), [], "AF-048 Nest API must close its test-database pool");
  await withDatabase("test", readDatabaseEnvironment("test", process.env, lease.id), async client => {
    const { rows } = await client.query("SELECT status, count(*)::int AS count FROM public.file_asset WHERE id = ANY($1::text[]) GROUP BY status", [createdIds]);
    assert.ok(rows.every(row => row.status === "deleted"), "isolated AF-048 synthetic metadata is soft-deleted during test cleanup");
  }, { acceptanceId: lease.id });
  save("result", { status: "VERIFIED", acceptanceId: lease.id, database: lease.database, ephemeralApi: true, customerAndAdminViews: true,
    projectAndOwnerScope: true, permissionDenied: true, exactByteDownloads: true, missingAndCorruptFailClosed: true,
    taskObjectsCleaned: true, taskMetadataSoftDeleted: true, applicationPoolClosed: true, evidence });
});
