import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createAcceptance, migrate } from "../database/migration.mjs";
import { acceptanceRecord } from "../database/connection.mjs";
import { clientEnvironment, prepareClientFixture } from "./client-auth-fixture.mjs";

const require = createRequire(join(process.cwd(), "apps/api/package.json"));
const apiFile = file => require(join(process.cwd(), "apps/api/dist", file));

test("AF-109 serves only authenticated workspace evidence over real HTTP and PostgreSQL", { timeout: 240000 }, async t => {
  const lease = await createAcceptance("test", "AF-109");
  assert.equal((await migrate({ mode: "test", action: "deploy", acceptanceId: lease.id })).exitCode, 0);
  assert.equal((await migrate({ mode: "test", action: "status", acceptanceId: lease.id })).exitCode, 0);
  const fixture = await prepareClientFixture(lease.id, "AF-109");
  assert.equal(acceptanceRecord("test", lease.id).task, "AF-109");
  const credentialFile = JSON.parse(await readFile(fixture.accounts[0].initialPasswordFile, "utf8"));
  const accounts = fixture.accounts.map(account => ({
    ...account,
    password: credentialFile.accounts.find(value => value.id === account.id)?.password
  }));
  assert.ok(accounts.every(account => typeof account.password === "string" && account.password.length > 0));

  const values = { ...clientEnvironment(lease.id, "AF-109"), ASYNC_RUNTIME_ENABLED: "false", ENABLED_PLUGINS: "aij-ai" };
  const previousEnvironment = { ...process.env };
  let app;
  let prisma;
  let baseUrl;
  let alphaCookie;
  let betaCookie;
  let alpha;
  let beta;
  let alphaDocument;
  let betaDocument;
  const checks = {};
  const replaceEnvironment = next => {
    for (const name of Object.keys(process.env)) delete process.env[name];
    Object.assign(process.env, next);
  };
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
      signal: AbortSignal.timeout(15000)
    });
    const text = await response.text();
    return { response, body: text ? JSON.parse(text) : null };
  };
  const expect = async (method, path, statusCode, options) => {
    const result = await request(method, path, options);
    assert.equal(result.response.status, statusCode, method + " " + path + " returned " + JSON.stringify(result.body));
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
    const { createApplication } = apiFile("bootstrap.js");
    const { PrismaService } = apiFile("prisma/prisma.service.js");
    app = await createApplication();
    await app.listen(0, "127.0.0.1");
    const address = app.getHttpServer().address();
    assert.ok(address && typeof address === "object" && address.port > 0);
    baseUrl = "http://127.0.0.1:" + address.port;
    prisma = app.get(PrismaService);
    alphaCookie = await login(accounts[0]);
    betaCookie = await login(accounts[1]);
    alpha = await createWorkspace(alphaCookie, "g19-02-alpha-workspace", "G19 Synthetic Retrieval Alpha");
    beta = await createWorkspace(betaCookie, "g19-02-beta-workspace", "G19 Synthetic Retrieval Beta");

    await t.test("anonymous, cross-workspace and caller-supplied workspace are rejected", async () => {
      await expect("POST", "client/ai/knowledge/query", 401, { workspaceId: alpha.id, body: { query: "退款期限是多少" } });
      await expect("POST", "client/ai/knowledge/query", 403, { cookie: alphaCookie, workspaceId: beta.id, body: { query: "退款期限是多少" } });
      await expect("POST", "client/ai/knowledge/query", 400, { cookie: alphaCookie, workspaceId: alpha.id, body: { query: "退款期限是多少", workspaceId: beta.id } });
      checks.authenticationAndTenantRejection = true;
    });

    await t.test("query cites only active documents from the authenticated workspace", async () => {
      const alphaCreated = await expect("POST", "client/ai/knowledge/documents", 201, {
        cookie: alphaCookie, workspaceId: alpha.id,
        body: { documentCode: "alpha-refund", title: "Synthetic Alpha Refund", content: "AIJ 合成甲工作区退款期限为30天。申请时提供合成订单编号。" }
      });
      const betaCreated = await expect("POST", "client/ai/knowledge/documents", 201, {
        cookie: betaCookie, workspaceId: beta.id,
        body: { documentCode: "beta-refund", title: "Synthetic Beta Refund", content: "AIJ 合成乙工作区退款期限为60天。申请时提供乙区合成编号。" }
      });
      alphaDocument = alphaCreated.body.data;
      betaDocument = betaCreated.body.data;
      await prisma.aiKnowledgeDocument.create({ data: {
        workspaceId: alpha.id,
        documentCode: "inactive-quantum",
        title: "Synthetic inactive quantum fact",
        content: "量子计算蓝宝石知识只在停用材料中。",
        status: "inactive",
        createdByMemberId: accounts[0].id
      } });

      const result = await expect("POST", "client/ai/knowledge/query", 200, {
        cookie: alphaCookie, workspaceId: alpha.id, body: { query: "退款期限是多少" }
      });
      assert.equal(result.body.data.result, "EVIDENCE_FOUND");
      assert.equal(result.body.data.refusalCode, null);
      assert.ok(result.body.data.evidenceCoverage >= 0.5);
      assert.deepEqual(result.body.data.citations.map(item => item.documentId), [alphaDocument.id]);
      assert.match(result.body.data.citations[0].excerpt, /退款期限为30天/);
      assert.equal(JSON.stringify(result.body).includes(betaDocument.id), false);
      assert.equal(JSON.stringify(result.body).includes("60天"), false);
      assert.equal(result.response.headers.get("cache-control"), "private, no-store");
      checks.workspaceFilteredCitations = true;
      checks.thresholdedEvidenceAndSourceExcerpt = true;
    });

    await t.test("unsupported, weak and inactive-only questions fail closed with no citations", async () => {
      for (const query of ["量子传送原理", "退款", "量子计算蓝宝石知识"]) {
        const result = await expect("POST", "client/ai/knowledge/query", 200, { cookie: alphaCookie, workspaceId: alpha.id, body: { query } });
        assert.equal(result.body.data.result, "REFUSED", query);
        assert.equal(result.body.data.refusalCode, "INSUFFICIENT_EVIDENCE", query);
        assert.deepEqual(result.body.data.citations, [], query);
        assert.equal(JSON.stringify(result.body).includes("停用材料"), false);
      }
      const overwideQuery = Array.from({ length: 132 }, (_, index) => String.fromCodePoint(0x4e00 + index)).join("");
      await expect("POST", "client/ai/knowledge/query", 400, {
        cookie: alphaCookie, workspaceId: alpha.id, body: { query: overwideQuery }
      });
      checks.noEvidenceRefusalAndInactiveExclusion = true;
      checks.unboundedQueryRejected = true;
    });

    await t.test("workspace member without knowledge query permission receives 403", async () => {
      const memberRole = await prisma.clientWorkspaceRole.findUniqueOrThrow({ where: { workspaceId_code: { workspaceId: alpha.id, code: "MEMBER" } } });
      await prisma.clientWorkspaceMembership.create({ data: { workspaceId: alpha.id, memberId: accounts[1].id, roleId: memberRole.id } });
      await expect("POST", "client/ai/knowledge/query", 403, { cookie: betaCookie, workspaceId: alpha.id, body: { query: "退款期限是多少" } });
      checks.rolePermissionDeny = true;
    });

    await t.test("queries are read-only and evidence never crosses stored workspace ownership", async () => {
      const alphaRows = await prisma.aiKnowledgeDocument.findMany({ where: { workspaceId: alpha.id }, select: { id: true, status: true } });
      const betaRows = await prisma.aiKnowledgeDocument.findMany({ where: { workspaceId: beta.id }, select: { id: true, status: true } });
      assert.equal(alphaRows.length, 2);
      assert.ok(alphaRows.some(row => row.id === alphaDocument.id && row.status === "active"));
      assert.deepEqual(betaRows.map(row => row.id), [betaDocument.id]);
      assert.equal(await prisma.auditLog.count({ where: { module: "aij-ai", action: { contains: "knowledge_query" }, workspaceId: alpha.id } }), 0);
      checks.readOnlyNoQuestionAuditPayload = true;
    });
  } finally {
    if (app) await app.close();
    for (const name of Object.keys(process.env)) delete process.env[name];
    Object.assign(process.env, previousEnvironment);
  }
  for (const check of ["authenticationAndTenantRejection", "workspaceFilteredCitations", "thresholdedEvidenceAndSourceExcerpt", "noEvidenceRefusalAndInactiveExclusion", "unboundedQueryRejected", "rolePermissionDeny", "readOnlyNoQuestionAuditPayload"]) {
    assert.equal(checks[check], true, `missing assertion group ${check}`);
  }
});
