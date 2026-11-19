import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createAcceptance, migrate } from "../database/migration.mjs";
import { acceptanceRecord, repositoryRoot, readDatabaseEnvironment, withDatabase } from "../database/connection.mjs";
import { clientEnvironment, prepareClientFixture } from "./client-auth-fixture.mjs";

const require = createRequire(join(repositoryRoot, "apps/api/package.json"));
const apiFile = file => require(join(repositoryRoot, "apps/api/dist", file));

test("AF-108 scopes knowledge document writes, reads, constraints and audit to authenticated workspaces", { timeout: 240000 }, async t => {
  const lease = await createAcceptance("test", "AF-108");
  const deployed = await migrate({ mode: "test", action: "deploy", acceptanceId: lease.id });
  assert.equal(deployed.exitCode, 0, "new AF-108 logical test database deploys the reviewed migration chain");
  const status = await migrate({ mode: "test", action: "status", acceptanceId: lease.id });
  assert.equal(status.exitCode, 0, "AF-108 database migration status is current");
  const fixture = await prepareClientFixture(lease.id, "AF-108");
  assert.equal(acceptanceRecord("test", lease.id).task, "AF-108");
  const accountFile = JSON.parse(await readFile(fixture.accounts[0].initialPasswordFile, "utf8"));
  const accounts = fixture.accounts.map(account => ({ ...account, password: accountFile.accounts.find(value => value.id === account.id)?.password }));
  assert.ok(accounts.every(account => typeof account.password === "string" && account.password.length > 0));
  const values = {
    ...clientEnvironment(lease.id, "AF-108"),
    ASYNC_RUNTIME_ENABLED: "false",
    ENABLED_PLUGINS: "aij-ai"
  };
  const previousEnvironment = { ...process.env };
  let app;
  let prisma;
  let baseUrl;
  let alphaCookie;
  let betaCookie;
  let alpha;
  let beta;
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
    assert.ok(address && typeof address === "object" && address.port > 0, "API uses an OS-selected loopback port");
    baseUrl = "http://127.0.0.1:" + address.port;
    prisma = app.get(PrismaService);
    alphaCookie = await login(accounts[0]);
    betaCookie = await login(accounts[1]);
    alpha = await createWorkspace(alphaCookie, "g19-01-alpha-workspace", "G19 Synthetic Alpha");
    beta = await createWorkspace(betaCookie, "g19-01-beta-workspace", "G19 Synthetic Beta");

    await t.test("anonymous and cross-workspace requests are rejected before reading content", async () => {
      await expect("GET", "client/ai/knowledge/documents", 401, { workspaceId: alpha.id });
      await expect("GET", "client/ai/knowledge/documents", 403, { cookie: alphaCookie, workspaceId: beta.id });
      await expect("POST", "client/ai/knowledge/documents", 403, {
        cookie: betaCookie,
        workspaceId: alpha.id,
        body: { documentCode: "synthetic-a", title: "Synthetic Alpha Fact", content: "Synthetic Alpha only fact." }
      });
      checks.anonymous401AndCrossWorkspace403 = true;
    });

    await t.test("document create/list are workspace-bound, duplicate codes and caller tenant fields are rejected", async () => {
      const doc = { documentCode: "synthetic-a", title: "Synthetic Alpha Fact", content: "Synthetic Alpha only fact for G19 evaluation." };
      const created = await expect("POST", "client/ai/knowledge/documents", 201, { cookie: alphaCookie, workspaceId: alpha.id, body: doc });
      assert.equal(created.body.data.workspaceId, alpha.id);
      assert.equal(created.body.data.documentCode, doc.documentCode);
      assert.equal(Object.hasOwn(created.body.data, "content"), false, "document content is not exposed by the management projection");
      await expect("POST", "client/ai/knowledge/documents", 409, { cookie: alphaCookie, workspaceId: alpha.id, body: doc });
      await expect("POST", "client/ai/knowledge/documents", 400, {
        cookie: alphaCookie,
        workspaceId: alpha.id,
        body: { ...doc, documentCode: "spoofed-workspace", workspaceId: beta.id }
      });
      const betaDoc = await expect("POST", "client/ai/knowledge/documents", 201, {
        cookie: betaCookie,
        workspaceId: beta.id,
        body: { documentCode: "synthetic-a", title: "Synthetic Beta Fact", content: "Synthetic Beta only fact for G19 evaluation." }
      });
      const alphaList = await expect("GET", "client/ai/knowledge/documents?page=1&pageSize=10", 200, { cookie: alphaCookie, workspaceId: alpha.id });
      assert.equal(alphaList.body.data.total, 1);
      assert.deepEqual(alphaList.body.data.items.map(item => item.id), [created.body.data.id]);
      assert.equal(alphaList.body.data.items.some(item => item.id === betaDoc.body.data.id), false);
      const betaList = await expect("GET", "client/ai/knowledge/documents", 200, { cookie: betaCookie, workspaceId: beta.id });
      assert.deepEqual(betaList.body.data.items.map(item => item.id), [betaDoc.body.data.id]);
      const memberRole = await prisma.clientWorkspaceRole.findUniqueOrThrow({ where: { workspaceId_code: { workspaceId: alpha.id, code: "MEMBER" } } });
      await prisma.clientWorkspaceMembership.create({ data: { workspaceId: alpha.id, memberId: fixture.accounts[1].id, roleId: memberRole.id } });
      await expect("GET", "client/ai/knowledge/documents", 403, { cookie: betaCookie, workspaceId: alpha.id });
      await expect("POST", "client/ai/knowledge/documents", 403, {
        cookie: betaCookie, workspaceId: alpha.id,
        body: { documentCode: "member-forbidden", title: "Synthetic denied", content: "No permission." }
      });
      const dbAlpha = await prisma.aiKnowledgeDocument.findMany({ where: { workspaceId: alpha.id }, select: { content: true, createdByMemberId: true } });
      const dbBeta = await prisma.aiKnowledgeDocument.findMany({ where: { workspaceId: beta.id }, select: { content: true, createdByMemberId: true } });
      assert.equal(dbAlpha[0].content, doc.content);
      assert.equal(dbAlpha[0].createdByMemberId, accounts[0].id);
      assert.equal(dbBeta[0].createdByMemberId, accounts[1].id);
      assert.equal(await prisma.auditLog.count({ where: { module: "aij-ai", action: "ai_knowledge_document_created", workspaceId: alpha.id } }), 1);
      checks.databasePersistenceProjectionAndAudit = true;
      checks.workspaceCodeUniqueAndTenantFieldRejected = true;
    });

    await t.test("migration backfill is idempotent and grants only active system OWNER roles", async () => {
      const legacy = await prisma.clientWorkspace.create({ data: {
        code: "ws_g19_legacy_" + randomUUID().replaceAll("-", "").slice(0, 20),
        name: "G19 Synthetic Legacy Workspace",
        createdByMemberId: accounts[0].id,
        creationIdempotencyKey: "g19-legacy-" + randomUUID()
      } });
      const owner = await prisma.clientWorkspaceRole.create({ data: { workspaceId: legacy.id, code: "OWNER", name: "Workspace Owner", isSystem: true } });
      const member = await prisma.clientWorkspaceRole.create({ data: { workspaceId: legacy.id, code: "MEMBER", name: "Workspace Member", isSystem: true } });
      await prisma.clientWorkspaceRolePermission.deleteMany({ where: { roleId: owner.id } });
      const sql = await readFile(join(repositoryRoot, "apps/api/prisma/migrations/20261102000000_ai_knowledge_document/migration.sql"), "utf8");
      const marker = "-- G19: register the knowledge permissions once and grant them only to existing active system OWNER roles.\n";
      const backfill = sql.slice(sql.indexOf(marker) + marker.length);
      assert.ok(backfill.length > 0);
      await withDatabase("test", readDatabaseEnvironment("test", process.env, lease.id), async client => {
        await client.query(backfill);
        await client.query(backfill);
      }, { acceptanceId: lease.id });
      const [manage, query] = await Promise.all([
        prisma.clientWorkspacePermission.findUniqueOrThrow({ where: { code: "workspace.knowledge.manage" } }),
        prisma.clientWorkspacePermission.findUniqueOrThrow({ where: { code: "workspace.knowledge.query" } })
      ]);
      assert.equal(await prisma.clientWorkspaceRolePermission.count({ where: { roleId: owner.id, permissionId: { in: [manage.id, query.id] }, deletedAt: null } }), 2);
      assert.equal(await prisma.clientWorkspaceRolePermission.count({ where: { roleId: member.id, permissionId: { in: [manage.id, query.id] }, deletedAt: null } }), 0);
      checks.permissionBackfillIsIdempotentAndOwnerOnly = true;
    });

    await t.test("PostgreSQL enforces unique workspace code and restricts deletion of referenced workspace/member", async () => {
      const constraints = await prisma.$queryRaw`SELECT c.conname, c.contype, c.confdeltype FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid WHERE t.relname = 'ai_knowledge_document'`;
      const indexes = await prisma.$queryRaw`SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'ai_knowledge_document'`;
      assert.ok(indexes.some(row => row.indexname === "ai_knowledge_document_workspace_code_key" && /UNIQUE INDEX/.test(row.indexdef)));
      const fks = constraints.filter(row => row.contype === "f");
      assert.equal(fks.length, 2);
      assert.ok(fks.every(row => row.confdeltype === "r"), "workspace and author delete references are RESTRICT");
      checks.databaseUniqueAndRestrictConstraints = true;
    });
  } finally {
    if (app) await app.close();
    for (const name of Object.keys(process.env)) delete process.env[name];
    Object.assign(process.env, previousEnvironment);
  }
  assert.equal(checks.anonymous401AndCrossWorkspace403, true);
  assert.equal(checks.databasePersistenceProjectionAndAudit, true);
  assert.equal(checks.databaseUniqueAndRestrictConstraints, true);
  assert.equal(checks.workspaceCodeUniqueAndTenantFieldRejected, true);
  assert.equal(checks.permissionBackfillIsIdempotentAndOwnerOnly, true);
});
