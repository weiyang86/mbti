import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";
import { createAcceptance, migrate } from "../database/migration.mjs";
import { acceptanceRecord } from "../database/connection.mjs";
import { clientEnvironment, prepareClientFixture } from "./client-auth-fixture.mjs";
import { clientApi, ClientRequestFailure } from "../../apps/web/app/components/client-api.mjs";
import { createKnowledgeDocumentsApi, knowledgePageMode, knowledgeRequestMessage } from "../../apps/web/app/components/client-knowledge-api.ts";

const require = createRequire(join(process.cwd(), "apps/api/package.json"));

test("AF-113 customer Workspace knowledge UI API consumer uses real HTTP and isolated PostgreSQL", { timeout: 300_000 }, async t => {
  const lease = await createAcceptance("test", "AF-113");
  assert.equal((await migrate({ mode: "test", action: "deploy", acceptanceId: lease.id })).exitCode, 0);
  assert.equal((await migrate({ mode: "test", action: "status", acceptanceId: lease.id })).exitCode, 0);
  const fixture = await prepareClientFixture(lease.id, "AF-113");
  const credentialRecord = JSON.parse(await readFile(fixture.accounts[0].initialPasswordFile, "utf8"));
  const accounts = fixture.accounts.map(account => ({
    ...account,
    password: credentialRecord.accounts.find(value => value.id === account.id)?.password
  }));
  assert.ok(accounts.every(account => typeof account.password === "string" && account.password.length > 0));

  const values = {
    ...clientEnvironment(lease.id, "AF-113"),
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
  let memberCookie;
  let otherCookie;
  let alpha;
  let beta;

  const request = async (method, path, { cookie, workspaceId, body } = {}) => {
    const response = await fetch(baseUrl + "/api/" + path, {
      method,
      headers: {
        connection: "close",
        ...(cookie ? { cookie } : {}),
        ...(workspaceId ? { "x-aij-workspace-id": workspaceId } : {}),
        origin: values.WEB_URL,
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

  try {
    replaceEnvironment(values);
    const { createApplication } = requireApi("bootstrap.js");
    const { PrismaService } = requireApi("prisma/prisma.service.js");
    app = await createApplication();
    await app.listen(0, "127.0.0.1");
    const address = app.getHttpServer().address();
    assert.ok(address && typeof address === "object" && address.port > 0);
    baseUrl = `http://127.0.0.1:${address.port}`;
    process.env.NEXT_PUBLIC_API_URL = `${baseUrl}/api`;
    prisma = app.get(PrismaService);
    memberCookie = await login(accounts[0]);
    otherCookie = await login(accounts[1]);

    const webRequest = (cookie) => (path, options = {}) => clientApi(path, {
      ...options,
      headers: { ...options.headers, cookie, origin: values.WEB_URL }
    });
    const memberClient = webRequest(memberCookie);
    const otherClient = webRequest(otherCookie);
    const memberKnowledge = createKnowledgeDocumentsApi(memberClient);
    const otherKnowledge = createKnowledgeDocumentsApi(otherClient);
    const workspace = async (client, idempotencyKey, name) => client("/client/workspaces", {
      method: "POST", body: JSON.stringify({ idempotencyKey, name })
    });
    alpha = await workspace(memberClient, "af113-alpha-workspace", "AF-113 Synthetic Alpha");
    beta = await workspace(otherClient, "af113-beta-workspace", "AF-113 Synthetic Beta");

    const alphaContext = await memberClient("/client/workspaces/context", { workspaceId: alpha.id });
    assert.ok(alphaContext.permissions.includes("workspace.knowledge.manage"));
    const created = await memberKnowledge.create(alpha.id, {
      documentCode: "af113-synthetic-policy",
      title: "AF-113 synthetic policy title",
      content: "AF113 synthetic knowledge specimen: refund window is twenty days."
    });
    assert.equal(created.title, "AF-113 synthetic policy title");
    assert.equal("content" in created, false, "create response does not return the full body");

    await t.test("consumer list/edit/status controls use authenticated workspace headers and server versions", async () => {
      const firstPage = await memberKnowledge.list(alpha.id, { page: 1, pageSize: 10, status: "active" });
      assert.equal(firstPage.total, 1);
      assert.equal(firstPage.items[0].workspaceId, alpha.id);
      assert.equal(firstPage.items[0].content, "AF113 synthetic knowledge specimen: refund window is twenty days.");
      const updated = await memberKnowledge.update(alpha.id, created.id, firstPage.items[0].updatedAt, { title: "AF-113 revised synthetic policy" });
      assert.equal(updated.title, "AF-113 revised synthetic policy");
      await assert.rejects(
        memberKnowledge.update(alpha.id, created.id, firstPage.items[0].updatedAt, { title: "stale overwrite" }),
        error => error instanceof ClientRequestFailure && error.status === 409
      );
      assert.match(knowledgeRequestMessage(new ClientRequestFailure(409)), /未提交内容不会覆盖新版本/);
      const inactive = await memberKnowledge.update(alpha.id, created.id, updated.updatedAt, { status: "inactive" });
      assert.equal(inactive.status, "inactive");
      assert.equal((await memberKnowledge.list(alpha.id, { status: "active" })).total, 0);
      assert.equal((await memberKnowledge.list(alpha.id, { status: "all" })).items[0].status, "inactive");
      const restored = await memberKnowledge.update(alpha.id, created.id, inactive.updatedAt, { status: "active" });
      assert.equal(restored.status, "active");
    });

    await t.test("empty, foreign-workspace, anonymous and missing-permission UI states fail closed", async () => {
      assert.equal((await otherKnowledge.list(beta.id, { status: "all" })).total, 0, "foreign Workspace document is not exposed");
      await assert.rejects(
        createKnowledgeDocumentsApi((path, options = {}) => clientApi(path, { ...options, headers: { ...options.headers, origin: values.WEB_URL } })).list(alpha.id),
        error => error instanceof ClientRequestFailure && error.status === 401
      );
      const betaMembership = await prisma.clientWorkspaceMembership.findFirstOrThrow({ where: { workspaceId: beta.id, memberId: accounts[1].id } });
      const restrictedRole = await prisma.clientWorkspaceRole.create({ data: {
        workspaceId: beta.id,
        code: "af113-no-knowledge-manage",
        name: "AF-113 synthetic role without knowledge management"
      } });
      await prisma.clientWorkspaceMembership.update({ where: { id: betaMembership.id }, data: { roleId: restrictedRole.id } });
      await assert.rejects(otherKnowledge.list(beta.id), error => error instanceof ClientRequestFailure && error.status === 403);
      assert.match(knowledgeRequestMessage(new ClientRequestFailure(403)), /没有管理此 Workspace/);
      assert.equal(knowledgePageMode({ loading: true }), "loading");
      assert.equal(knowledgePageMode({ hasWorkspace: false }), "no-workspace");
      assert.equal(knowledgePageMode({ error: "network" }), "error");
      assert.equal(knowledgePageMode({ canManage: false, total: 4 }), "forbidden");
      assert.equal(knowledgePageMode({ total: 0 }), "empty");
      assert.equal(knowledgePageMode({ total: 1 }), "ready");
      const badInput = await request("POST", "client/ai/knowledge/documents", {
        cookie: memberCookie, workspaceId: alpha.id,
        body: { documentCode: "af113-invalid", title: " ", content: "synthetic" }
      });
      assert.equal(badInput.response.status, 400, "server still rejects invalid input despite client validation");
    });

    console.log(JSON.stringify({
      task: "AF-113",
      databaseMode: "test",
      database: acceptanceRecord("test", lease.id).database,
      apiBase: baseUrl,
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
