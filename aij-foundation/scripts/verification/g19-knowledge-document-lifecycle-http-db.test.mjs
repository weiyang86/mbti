import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";
import { createAcceptance, migrate } from "../database/migration.mjs";
import { acceptanceRecord } from "../database/connection.mjs";
import { clientEnvironment, prepareClientFixture } from "./client-auth-fixture.mjs";

const require = createRequire(join(process.cwd(), "apps/api/package.json"));

test("AF-112 manages synthetic knowledge documents over real loopback HTTP and isolated PostgreSQL", { timeout: 300_000 }, async t => {
  const lease = await createAcceptance("test", "AF-112");
  assert.equal((await migrate({ mode: "test", action: "deploy", acceptanceId: lease.id })).exitCode, 0);
  assert.equal((await migrate({ mode: "test", action: "status", acceptanceId: lease.id })).exitCode, 0);
  const fixture = await prepareClientFixture(lease.id, "AF-112", { pluginManagement: true });
  assert.equal(acceptanceRecord("test", lease.id).task, "AF-112");
  const credentialRecord = JSON.parse(await readFile(fixture.accounts[0].initialPasswordFile, "utf8"));
  const accounts = fixture.accounts.map(account => ({
    ...account,
    password: credentialRecord.accounts.find(value => value.id === account.id)?.password
  }));
  assert.ok(accounts.every(account => typeof account.password === "string" && account.password.length > 0));

  const values = {
    ...clientEnvironment(lease.id, "AF-112"),
    ASYNC_RUNTIME_ENABLED: "true",
    ENABLED_PLUGINS: "aij-ai",
    AIJ_TEST_AI_PROVIDER_MODE: "offline-knowledge"
  };
  const previousEnvironment = { ...process.env };
  const replaceEnvironment = next => {
    for (const name of Object.keys(process.env)) delete process.env[name];
    Object.assign(process.env, next);
  };
  const requireApi = file => require(join(process.cwd(), "apps/api/dist", file));
  let app;
  let prisma;
  let baseUrl;

  const request = async (method, path, { cookie, workspaceId, body, origin = values.WEB_URL } = {}) => {
    const response = await fetch(baseUrl + "/api/" + path, {
      method,
      headers: {
        connection: "close",
        ...(cookie ? { cookie } : {}),
        ...(workspaceId ? { "x-aij-workspace-id": workspaceId } : {}),
        ...(origin ? { origin } : {}),
        ...(body === undefined ? {} : { "content-type": "application/json" })
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15_000)
    });
    const text = await response.text();
    return { response, text, body: text ? JSON.parse(text) : null };
  };
  const expect = async (method, path, status, options) => {
    const result = await request(method, path, options);
    assert.equal(result.response.status, status, `${method} ${path}: ${result.text}`);
    return result;
  };
  const login = async account => {
    const result = await expect("POST", "client/auth/login", 200, { body: { email: account.email, password: account.password } });
    const setCookie = result.response.headers.get("set-cookie");
    assert.ok(setCookie?.includes("HttpOnly") && setCookie.includes("SameSite=Strict"));
    return setCookie.split(";")[0];
  };
  const createWorkspace = async (cookie, idempotencyKey, name) => {
    const result = await expect("POST", "client/workspaces", 201, { cookie, body: { name, idempotencyKey } });
    return result.body.data;
  };

  try {
    replaceEnvironment(values);
    const { createApplication } = requireApi("bootstrap.js");
    const { PrismaService } = requireApi("prisma/prisma.service.js");
    app = await createApplication();
    await app.listen(0, "127.0.0.1");
    const address = app.getHttpServer().address();
    assert.ok(address && typeof address === "object" && address.port > 0, "test API binds only an OS-selected loopback port");
    baseUrl = `http://127.0.0.1:${address.port}`;
    prisma = app.get(PrismaService);
    assert.equal(acceptanceRecord("test", lease.id).task, "AF-112");
    // The original lifecycle guard now applies to knowledge CRUD as well. Enable
    // through the actual owner before any protected document request.
    const { PluginCatalog } = requireApi('plugin-runtime/plugin-catalog.js');
    const { PluginLifecycleService } = requireApi('plugin-runtime/plugin-lifecycle.service.js');
    const admin = await prisma.sysUser.findUniqueOrThrow({ where: { username: 'aij-admin' } });
    const catalog = app.get(PluginCatalog), lifecycle = app.get(PluginLifecycleService);
    await lifecycle.install('aij-ai', catalog.manifest('aij-ai').version, admin.id, 'af112-regression-install');
    await lifecycle.enable('aij-ai', admin.id, 'af112-regression-enable');

    const alphaCookie = await login(accounts[0]);
    const betaCookie = await login(accounts[1]);
    const alpha = await createWorkspace(alphaCookie, "af112-alpha-workspace", "AF-112 Synthetic Alpha");
    const beta = await createWorkspace(betaCookie, "af112-beta-workspace", "AF-112 Synthetic Beta");
    const documentContent = "AF112 synthetic qg19alpha01 ig19alpha01 tg19alpha01 refund period is twenty days.";
    const created = await expect("POST", "client/ai/knowledge/documents", 201, {
      cookie: alphaCookie,
      workspaceId: alpha.id,
      body: { documentCode: "af112-alpha-policy", title: "AF112 synthetic title redaction marker", content: documentContent }
    });
    const documentId = created.body.data.id;
    const initialVersion = created.body.data.updatedAt;
    assert.equal("content" in created.body.data, false, "create response remains metadata-only");

    await t.test("management reads active content, status filters and pagination only within the authenticated workspace", async () => {
      const active = await expect("GET", "client/ai/knowledge/documents?page=1&pageSize=10&status=active", 200, { cookie: alphaCookie, workspaceId: alpha.id });
      assert.equal(active.body.data.total, 1);
      assert.equal(active.body.data.items[0].id, documentId);
      assert.equal(active.body.data.items[0].content, documentContent);
      const invalidStatus = await expect("GET", "client/ai/knowledge/documents?status=deleted", 400, { cookie: alphaCookie, workspaceId: alpha.id });
      assert.ok(invalidStatus.text.length > 0);
      await expect("GET", "client/ai/knowledge/documents", 401);
    });

    await t.test("anonymous, missing permission and foreign-workspace updates are rejected without enumeration", async () => {
      await expect("PATCH", `client/ai/knowledge/documents/${documentId}`, 401, { body: { title: "Unauthenticated", expectedUpdatedAt: initialVersion } });
      await expect("PATCH", `client/ai/knowledge/documents/${documentId}`, 404, {
        cookie: betaCookie,
        workspaceId: beta.id,
        body: { title: "Foreign update", expectedUpdatedAt: initialVersion }
      });
      const betaMembership = await prisma.clientWorkspaceMembership.findFirstOrThrow({ where: { workspaceId: beta.id, memberId: accounts[1].id } });
      const restrictedRole = await prisma.clientWorkspaceRole.create({ data: {
        workspaceId: beta.id,
        code: "af112-no-knowledge-manage",
        name: "AF-112 synthetic role without knowledge management"
      } });
      await prisma.clientWorkspaceMembership.update({ where: { id: betaMembership.id }, data: { roleId: restrictedRole.id } });
      await expect("PATCH", `client/ai/knowledge/documents/${documentId}`, 403, {
        cookie: betaCookie,
        workspaceId: beta.id,
        body: { title: "Denied", expectedUpdatedAt: initialVersion }
      });
      const stillActive = await expect("GET", "client/ai/knowledge/documents?status=active", 200, { cookie: alphaCookie, workspaceId: alpha.id });
      assert.equal(stillActive.body.data.items[0].title, "AF112 synthetic title redaction marker");
    });

    await t.test("updates use optimistic concurrency and reject malformed or stale versions", async () => {
      await new Promise(resolve => setTimeout(resolve, 5));
      const first = await expect("PATCH", `client/ai/knowledge/documents/${documentId}`, 200, {
        cookie: alphaCookie,
        workspaceId: alpha.id,
        body: { title: "AF112 revised synthetic title", content: documentContent + " Revision one.", expectedUpdatedAt: initialVersion }
      });
      assert.notEqual(first.body.data.updatedAt, initialVersion);
      assert.equal(first.body.data.content, documentContent + " Revision one.");
      const sharedVersion = first.body.data.updatedAt;
      const concurrent = await Promise.all([
        request("PATCH", `client/ai/knowledge/documents/${documentId}`, { cookie: alphaCookie, workspaceId: alpha.id, body: { title: "Concurrent A", expectedUpdatedAt: sharedVersion } }),
        request("PATCH", `client/ai/knowledge/documents/${documentId}`, { cookie: alphaCookie, workspaceId: alpha.id, body: { title: "Concurrent B", expectedUpdatedAt: sharedVersion } })
      ]);
      assert.deepEqual(concurrent.map(item => item.response.status).sort(), [200, 409]);
      const winner = concurrent.find(item => item.response.status === 200);
      const loser = concurrent.find(item => item.response.status === 409);
      assert.equal(loser.body.message, "Management state conflict", "conflict detail is intentionally normalized by the shared error filter");
      assert.ok(["Concurrent A", "Concurrent B"].includes(winner.body.data.title));
      const stale = await expect("PATCH", `client/ai/knowledge/documents/${documentId}`, 409, {
        cookie: alphaCookie,
        workspaceId: alpha.id,
        body: { title: "Stale write", expectedUpdatedAt: initialVersion }
      });
      assert.equal(stale.body.message, "Management state conflict");
      await expect("PATCH", `client/ai/knowledge/documents/${documentId}`, 400, {
        cookie: alphaCookie,
        workspaceId: alpha.id,
        body: { title: "Missing version" }
      });
      await expect("PATCH", `client/ai/knowledge/documents/${documentId}`, 400, {
        cookie: alphaCookie,
        workspaceId: alpha.id,
        body: { expectedUpdatedAt: winner.body.data.updatedAt }
      });
      await expect("PATCH", `client/ai/knowledge/documents/${documentId}`, 400, {
        cookie: alphaCookie,
        workspaceId: alpha.id,
        body: { status: "deleted", expectedUpdatedAt: winner.body.data.updatedAt }
      });
      await expect("PATCH", `client/ai/knowledge/documents/${documentId}`, 400, {
        cookie: alphaCookie,
        workspaceId: alpha.id,
        body: { title: "Spoofed workspace", workspaceId: beta.id, expectedUpdatedAt: winner.body.data.updatedAt }
      });
    });

    await t.test("deactivation removes the document from retrieval and subsequent question citations; restoration is audited without content", async () => {
      const beforeQuery = await expect("POST", "client/ai/knowledge/query", 200, {
        cookie: alphaCookie, workspaceId: alpha.id, body: { query: "qg19alpha01 ig19alpha01" }
      });
      assert.equal(beforeQuery.body.data.result, "EVIDENCE_FOUND");
      assert.deepEqual(beforeQuery.body.data.citations.map(item => item.documentId), [documentId]);
      const current = await prisma.aiKnowledgeDocument.findUniqueOrThrow({ where: { id: documentId } });
      const inactive = await expect("PATCH", `client/ai/knowledge/documents/${documentId}`, 200, {
        cookie: alphaCookie,
        workspaceId: alpha.id,
        body: { status: "inactive", expectedUpdatedAt: current.updatedAt.toISOString() }
      });
      assert.equal(inactive.body.data.status, "inactive");
      const activeList = await expect("GET", "client/ai/knowledge/documents?status=active", 200, { cookie: alphaCookie, workspaceId: alpha.id });
      assert.equal(activeList.body.data.total, 0);
      const inactiveList = await expect("GET", "client/ai/knowledge/documents?status=inactive", 200, { cookie: alphaCookie, workspaceId: alpha.id });
      assert.equal(inactiveList.body.data.items[0].content, documentContent + " Revision one.");
      const afterQuery = await expect("POST", "client/ai/knowledge/query", 200, {
        cookie: alphaCookie, workspaceId: alpha.id, body: { query: "qg19alpha01 ig19alpha01" }
      });
      assert.equal(afterQuery.body.data.result, "REFUSED");
      assert.deepEqual(afterQuery.body.data.citations, []);
      const afterQuestion = await expect("POST", "client/ai/knowledge/questions", 200, {
        cookie: alphaCookie,
        workspaceId: alpha.id,
        body: { query: "qg19alpha01 ig19alpha01", idempotencyKey: "af112-inactive-source" }
      });
      assert.equal(afterQuestion.body.data.status, "refused");
      assert.deepEqual(afterQuestion.body.data.citations, []);
      const restored = await expect("PATCH", `client/ai/knowledge/documents/${documentId}`, 200, {
        cookie: alphaCookie,
        workspaceId: alpha.id,
        body: { status: "active", expectedUpdatedAt: inactive.body.data.updatedAt }
      });
      assert.equal(restored.body.data.status, "active");
      const restoredQuery = await expect("POST", "client/ai/knowledge/query", 200, {
        cookie: alphaCookie, workspaceId: alpha.id, body: { query: "qg19alpha01 ig19alpha01" }
      });
      assert.equal(restoredQuery.body.data.result, "EVIDENCE_FOUND");
      assert.deepEqual(restoredQuery.body.data.citations.map(item => item.documentId), [documentId]);

      const audits = await prisma.auditLog.findMany({ where: {
        module: "aij-ai",
        action: { in: ["ai_knowledge_document_updated", "ai_knowledge_document_status_changed"] },
        resourceType: "ai_knowledge_document",
        resourceId: documentId,
        workspaceId: alpha.id
      }, orderBy: { createdAt: "asc" } });
      assert.ok(audits.length >= 4);
      assert.ok(audits.some(item => item.beforeData?.status === "active" && item.afterData?.status === "inactive"));
      assert.ok(audits.some(item => item.beforeData?.status === "inactive" && item.afterData?.status === "active"));
      const auditText = JSON.stringify(audits);
      assert.equal(auditText.includes("AF112 synthetic title redaction marker"), false);
      assert.equal(auditText.includes("AF112 revised synthetic title"), false);
      assert.equal(auditText.includes("qg19alpha01"), false);
      assert.equal(auditText.includes("Revision one"), false);
      assert.ok(audits.every(item => item.workspaceId === alpha.id && item.userId === accounts[0].id));
    });
    console.log(JSON.stringify({
      task: "AF-112",
      databaseMode: "test",
      database: acceptanceRecord("test", lease.id).database,
      httpBase: baseUrl,
      bindAddress: "127.0.0.1",
      liveDeepSeek: false,
      customerData: false,
      paidRequests: false,
      fileImport: false
    }));
  } finally {
    if (app) await app.close();
    for (const name of Object.keys(process.env)) delete process.env[name];
    Object.assign(process.env, previousEnvironment);
  }
});
