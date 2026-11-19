import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";
import { createAcceptance, migrate } from "../database/migration.mjs";
import { repositoryRoot } from "../database/connection.mjs";
import { prepareWorkspaceIsolationMembers, workspaceIsolationEnvironment, workspaceIsolationTask } from "./workspace-isolation-fixture.mjs";

const require = createRequire(join(repositoryRoot, "apps/api/package.json"));
const requireApi = file => require(join(repositoryRoot, "apps/api/dist", file));

test("AF-056 rejects cross-Workspace selectors and admin/customer credential confusion over real HTTP and PostgreSQL", { timeout: 240000 }, async t => {
  const lease = await createAcceptance("test", workspaceIsolationTask);
  const deployed = await migrate({ mode: "test", action: "deploy", acceptanceId: lease.id });
  assert.equal(deployed.exitCode, 0);
  const fixture = await prepareWorkspaceIsolationMembers(lease.id);
  const values = await workspaceIsolationEnvironment(lease.id);
  const accounts = JSON.parse(await import("node:fs/promises").then(fs => fs.readFile(fixture.accounts[0].initialPasswordFile, "utf8"))).accounts;
  const adminPassword = JSON.parse(await import("node:fs/promises").then(fs => fs.readFile(fixture.seed.credentials.file, "utf8"))).password;
  const [alphaOwner, betaOwner] = accounts;
  const previousEnvironment = { ...process.env };
  let app;
  let baseUrl;
  let prisma;
  let alpha;
  let beta;
  let alphaOwnerCookie;
  let betaOwnerCookie;
  let adminCookie;
  const checks = {};

  const setEnvironment = environment => {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, environment);
  };
  const closeApp = async () => {
    if (!app) return;
    await app.close();
    app = undefined;
  };
  const send = async (method, path, { cookie, workspaceId, body, headers = {}, origin } = {}) => {
    const response = await fetch(baseUrl + "/api/" + path, {
      method,
      headers: {
        connection: "close",
        ...(cookie ? { cookie } : {}),
        ...(workspaceId === undefined ? {} : { "x-aij-workspace-id": workspaceId }),
        ...(origin === undefined ? {} : { origin }),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...headers
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15000)
    });
    const responseBody = await response.json();
    return { response, body: responseBody };
  };
  const expect = async (method, path, status, options) => {
    const result = await send(method, path, options);
    assert.equal(result.response.status, status, method + " " + path + " returned " + JSON.stringify(result.body));
    return result;
  };
  const customerLogin = async account => {
    const result = await expect("POST", "client/auth/login", 200, {
      origin: values.WEB_URL,
      body: { email: account.email, password: account.password }
    });
    const header = result.response.headers.get("set-cookie");
    assert.ok(header?.includes("HttpOnly") && header.includes("SameSite=Strict") && header.includes("Path=/api/client"));
    return header.split(";")[0];
  };

  try {
    setEnvironment(values);
    const { createApplication } = requireApi("bootstrap.js");
    const { PrismaService } = requireApi("prisma/prisma.service.js");
    app = await createApplication();
    await app.listen(0, "127.0.0.1");
    const address = app.getHttpServer().address();
    assert.ok(address && typeof address === "object" && address.port > 0);
    baseUrl = "http://127.0.0.1:" + address.port;
    prisma = app.get(PrismaService);
    alphaOwnerCookie = await customerLogin(alphaOwner);
    betaOwnerCookie = await customerLogin(betaOwner);

    await t.test("active customer identity can create/select its own Workspace; anonymous and forged foreign selectors reject", async () => {
      const createdAlpha = await expect("POST", "client/workspaces", 201, {
        cookie: alphaOwnerCookie,
        origin: values.WEB_URL,
        body: { name: "Synthetic Alpha", idempotencyKey: "af056-alpha-create" }
      });
      alpha = createdAlpha.body.data;
      const alphaRoles = await expect("GET", "client/workspaces/roles", 200, { cookie: alphaOwnerCookie, workspaceId: alpha.id });
      const alphaMember = alphaRoles.body.data.find(role => role.code === "MEMBER");
      assert.ok(alphaMember);
      await expect("POST", "client/workspaces/members", 201, {
        cookie: alphaOwnerCookie,
        workspaceId: alpha.id,
        origin: values.WEB_URL,
        body: { memberId: betaOwner.id, roleId: alphaMember.id }
      });
      const createdBeta = await expect("POST", "client/workspaces", 201, {
        cookie: betaOwnerCookie,
        origin: values.WEB_URL,
        body: { name: "Synthetic Beta", idempotencyKey: "af056-beta-create" }
      });
      beta = createdBeta.body.data;

      await expect("GET", "client/workspaces/context", 401, { workspaceId: alpha.id });
      const alphaContext = await expect("GET", "client/workspaces/context", 200, { cookie: alphaOwnerCookie, workspaceId: alpha.id });
      assert.equal(alphaContext.body.data.workspaceId, alpha.id);
      await expect("GET", "client/workspaces/context", 403, { cookie: alphaOwnerCookie, workspaceId: beta.id });
      const betaContext = await expect("GET", "client/workspaces/context", 200, { cookie: betaOwnerCookie, workspaceId: beta.id });
      assert.equal(betaContext.body.data.workspaceId, beta.id);
      checks.activeMembersAndForeignSelectorDenial = true;
    });

    await t.test("client cannot forge another role or permission; tenant rows stay scoped", async () => {
      const memberContext = await expect("GET", "client/workspaces/context?workspaceId=" + beta.id, 200, {
        cookie: betaOwnerCookie,
        workspaceId: alpha.id,
        headers: { "x-aij-workspace-role": "OWNER", "x-aij-workspace-permissions": "*", "x-member-id": alphaOwner.id }
      });
      assert.equal(memberContext.body.data.workspaceId, alpha.id);
      assert.equal(memberContext.body.data.roleCode, "MEMBER");
      assert.deepEqual(memberContext.body.data.permissions, ["workspace.context.read"]);
      const betaMembers = await expect("GET", "client/workspaces/members", 200, { cookie: betaOwnerCookie, workspaceId: beta.id });
      assert.deepEqual(betaMembers.body.data.items.map(item => item.memberId), [betaOwner.id]);
      const alphaMembership = await prisma.clientWorkspaceMembership.findUniqueOrThrow({
        where: { workspaceId_memberId: { workspaceId: alpha.id, memberId: betaOwner.id } }
      });
      const betaOwnerRole = (await prisma.clientWorkspaceRole.findFirstOrThrow({ where: { workspaceId: beta.id, code: "OWNER" } }));
      await expect("PATCH", "client/workspaces/members/" + alphaMembership.id + "/role", 404, {
        cookie: betaOwnerCookie,
        workspaceId: beta.id,
        origin: values.WEB_URL,
        body: { roleId: betaOwnerRole.id }
      });
      await expect("GET", "client/workspaces/context", 403, { cookie: betaOwnerCookie, workspaceId: "forged-" + beta.id });
      checks.requestHintsDoNotGrantAndManagementIsTenantScoped = true;
    });

    await t.test("administrator and customer sessions cannot cross-authenticate", async () => {
      const adminLogin = await expect("POST", "auth/browser-login", 200, {
        origin: values.WEB_URL,
        headers: { "x-aij-client": "web" },
        body: { username: "aij-admin", password: adminPassword }
      });
      const rawAdminCookie = adminLogin.response.headers.get("set-cookie");
      assert.ok(rawAdminCookie?.includes("HttpOnly") && rawAdminCookie.includes("Path=/api"));
      adminCookie = rawAdminCookie.split(";")[0];
      const rawCustomerToken = alphaOwnerCookie.slice(alphaOwnerCookie.indexOf("=") + 1);
      const rawAdminToken = adminCookie.slice(adminCookie.indexOf("=") + 1);
      await expect("GET", "auth/me", 200, { cookie: adminCookie });
      await expect("GET", "auth/me", 401, { cookie: values.COOKIE_PREFIX + "_admin_session=" + rawCustomerToken });
      await expect("GET", "auth/me", 401, { headers: { authorization: "Bearer " + rawCustomerToken } });
      await expect("GET", "client/workspaces", 401, { cookie: values.COOKIE_PREFIX + "_client_session=" + rawAdminToken });
      await expect("GET", "client/workspaces/context", 401, { cookie: adminCookie, workspaceId: alpha.id });
      checks.adminCustomerCookieAndTokenSeparation = true;
    });

    await t.test("audit evidence is persisted without credential material and Prisma pool closes", async () => {
      const auditRows = await prisma.auditLog.findMany({ where: { module: "client-workspaces" }, select: { requestSummary: true, beforeData: true, afterData: true } });
      const serialized = JSON.stringify(auditRows);
      assert.ok(auditRows.length > 0);
      assert.ok(!serialized.includes(alphaOwner.password) && !serialized.includes(betaOwner.password) && !serialized.includes(adminPassword));
      assert.ok(!/passwordHash|password_hash|JWT_SECRET|CLIENT_JWT_SECRET|accessToken/.test(serialized));
      await closeApp();
      checks.auditCredentialRedaction = true;
      checks.prismaPoolClosed = true;
    });

    const evidence = await import("node:fs/promises");
    const evidencePath = join(repositoryRoot, ".artifacts/af-056/workspace-isolation-" + lease.id + ".json");
    await evidence.mkdir(join(repositoryRoot, ".artifacts/af-056"), { recursive: true, mode: 0o700 });
    await evidence.writeFile(evidencePath, JSON.stringify({
      task: workspaceIsolationTask,
      acceptanceId: lease.id,
      database: lease.database,
      bind: "127.0.0.1:0",
      routes: ["GET /api/client/workspaces/context", "GET /api/client/workspaces/members", "PATCH /api/client/workspaces/members/:membershipId/role", "GET /api/auth/me"],
      checks,
      data: "Synthetic MemberUser, Workspace, roles, permissions, memberships and audit rows only; no source product data or credentials in report"
    }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  } finally {
    await closeApp();
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, previousEnvironment);
  }
});
