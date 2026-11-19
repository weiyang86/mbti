import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { createAcceptance, migrate } from "../database/migration.mjs";
import { readDatabaseEnvironment, repositoryRoot, withDatabase } from "../database/connection.mjs";
import { workspaceContextEnvironment, prepareWorkspaceContextMembers, workspaceContextTask } from "./workspace-context-fixture.mjs";

const require = createRequire(join(repositoryRoot, "apps/api/package.json"));
const requireApi = file => require(join(repositoryRoot, "apps/api/dist", file));

test("AF-054 resolves customer Workspace context and permission from live identity/membership state", { timeout: 180000 }, async t => {
  const lease = await createAcceptance("test", workspaceContextTask);
  const deployed = await migrate({ mode: "test", action: "deploy", acceptanceId: lease.id });
  assert.equal(deployed.exitCode, 0);
  const fixture = await prepareWorkspaceContextMembers(lease.id);
  const values = await workspaceContextEnvironment(lease.id);
  const accounts = JSON.parse(await import("node:fs/promises").then(fs => fs.readFile(fixture.accounts[0].initialPasswordFile, "utf8"))).accounts;
  const [member, secondMember] = accounts;
  const { JwtService } = require("@nestjs/jwt");
  const { Reflector } = require("@nestjs/core");
  const { WorkspaceContextGuard } = requireApi("client-workspaces/workspace-context.guard.js");
  const { PrismaService } = requireApi("prisma/prisma.service.js");
  const jwt = new JwtService();
  const originalEnv = { ...process.env };
  let app;
  let baseUrl;
  let prisma;
  let clientCookie;
  let secondCookie;
  let sessionId;
  let fixtures;

  const replaceEnvironment = next => {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, next);
  };
  const closeApp = async () => {
    if (!app) return;
    await app.close();
    app = undefined;
  };
  const send = async (path, expected, { cookie, workspaceId, headers = {} } = {}) => {
    const response = await fetch(baseUrl + "/api/" + path, {
      headers: {
        connection: "close",
        ...(cookie ? { cookie } : {}),
        ...(workspaceId === undefined ? {} : { "x-aij-workspace-id": workspaceId }),
        ...headers
      },
      signal: AbortSignal.timeout(8000)
    });
    assert.equal(response.status, expected, "HTTP status for " + path.split("?")[0]);
    const body = await response.json();
    return { response, body };
  };
  const login = async account => {
    const response = await fetch(baseUrl + "/api/client/auth/login", {
      method: "POST",
      headers: { connection: "close", origin: values.WEB_URL, "content-type": "application/json" },
      body: JSON.stringify({ email: account.email, password: account.password }),
      signal: AbortSignal.timeout(12000)
    });
    assert.equal(response.status, 200);
    const header = response.headers.get("set-cookie");
    assert.ok(header?.includes("HttpOnly") && header.includes("SameSite=Strict"));
    return header.split(";")[0];
  };

  try {
    replaceEnvironment(values);
    const { createApplication } = requireApi("bootstrap.js");
    app = await createApplication();
    await app.listen(0, "127.0.0.1");
    const address = app.getHttpServer().address();
    assert.ok(address && typeof address === "object" && address.port > 0);
    baseUrl = "http://127.0.0.1:" + address.port;
    prisma = app.get(PrismaService);

    await t.test("anonymous and incomplete selectors default to denial", async () => {
      await send("client/workspaces/context", 401, { workspaceId: "ignored" });
      clientCookie = await login(member);
      await send("client/workspaces/context", 400, { cookie: clientCookie });
      await send("client/workspaces/context", 403, { cookie: clientCookie, workspaceId: "../not-a-workspace" });
    });

    await t.test("an authenticated client receives only a database-verified workspace context", async () => {
      const permission = await prisma.clientWorkspacePermission.create({ data: {
        code: "workspace.context.read", name: "Read Workspace context"
      } });
      const createWorkspace = async (name, code) => prisma.clientWorkspace.create({ data: {
        code: "af054-" + code + "-" + randomUUID().slice(0, 8),
        name,
        createdByMemberId: member.id,
        creationIdempotencyKey: randomUUID()
      } });
      const createRole = (workspaceId, code, status = "active") => prisma.clientWorkspaceRole.create({ data: {
        workspaceId, code, name: "Synthetic " + code, status
      } });
      const grant = (roleId, permissionId = permission.id) => prisma.clientWorkspaceRolePermission.create({ data: { roleId, permissionId } });
      const addMembership = (workspaceId, roleId, memberId, status = "active", disabledAt = null) => prisma.clientWorkspaceMembership.create({ data: {
        workspaceId, roleId, memberId, status, disabledAt
      } });

      const alpha = await createWorkspace("Synthetic Alpha", "alpha");
      const alphaRole = await createRole(alpha.id, "owner");
      const alphaGrant = await grant(alphaRole.id);
      const alphaMembership = await addMembership(alpha.id, alphaRole.id, member.id);

      const beta = await createWorkspace("Synthetic Beta", "beta");
      const betaRole = await createRole(beta.id, "member");
      await grant(betaRole.id);
      await addMembership(beta.id, betaRole.id, secondMember.id);

      const noGrant = await createWorkspace("Synthetic No Grant", "no-grant");
      const noGrantRole = await createRole(noGrant.id, "limited");
      await addMembership(noGrant.id, noGrantRole.id, member.id);

      const disabledMembershipWorkspace = await createWorkspace("Synthetic Disabled Membership", "disabled-membership");
      const disabledMembershipRole = await createRole(disabledMembershipWorkspace.id, "member");
      await addMembership(disabledMembershipWorkspace.id, disabledMembershipRole.id, member.id, "disabled", new Date());

      const disabledWorkspace = await createWorkspace("Synthetic Disabled Workspace", "disabled-workspace");
      await prisma.clientWorkspace.update({ where: { id: disabledWorkspace.id }, data: { status: "disabled" } });
      const disabledWorkspaceRole = await createRole(disabledWorkspace.id, "member");
      await addMembership(disabledWorkspace.id, disabledWorkspaceRole.id, member.id);

      const disabledRoleWorkspace = await createWorkspace("Synthetic Disabled Role", "disabled-role");
      const disabledRole = await createRole(disabledRoleWorkspace.id, "disabled", "disabled");
      await addMembership(disabledRoleWorkspace.id, disabledRole.id, member.id);

      fixtures = { permission, alpha, alphaRole, alphaGrant, alphaMembership, beta, betaRole, noGrant, noGrantRole,
        disabledMembershipWorkspace, disabledWorkspace, disabledRoleWorkspace, disabledRole };
      secondCookie = await login(secondMember);
      const valid = await send("client/workspaces/context", 200, { cookie: clientCookie, workspaceId: alpha.id });
      assert.deepEqual(valid.body.data, {
        workspaceId: alpha.id,
        workspaceCode: alpha.code,
        workspaceName: alpha.name,
        roleId: alphaRole.id,
        roleCode: alphaRole.code,
        permissions: ["workspace.context.read"]
      });
      assert.equal(valid.response.headers.get("cache-control"), "private, no-store");
      const second = await send("client/workspaces/context", 200, { cookie: secondCookie, workspaceId: beta.id });
      assert.equal(second.body.data.workspaceId, beta.id);
      assert.equal(second.body.data.roleCode, betaRole.code);
    });

    await t.test("request-supplied tenant/role/permission hints never grant another Workspace", async () => {
      await send("client/workspaces/context?workspaceId=" + fixtures.beta.id, 200, { cookie: clientCookie, workspaceId: fixtures.alpha.id,
        headers: { "x-aij-workspace-role": "owner", "x-aij-workspace-permissions": "*", "x-member-id": secondMember.id } });
      await send("client/workspaces/context", 403, { cookie: clientCookie, workspaceId: fixtures.beta.id,
        headers: { "x-aij-workspace-role": "owner", "x-aij-workspace-permissions": "workspace.context.read", "x-member-id": secondMember.id } });
      await send("client/workspaces/context", 403, { cookie: secondCookie, workspaceId: fixtures.alpha.id });
      await send("client/workspaces/context", 403, { cookie: clientCookie, workspaceId: "missing-" + randomUUID() });
      await send("client/workspaces/context", 403, { cookie: clientCookie, workspaceId: fixtures.noGrant.id,
        headers: { "x-aij-workspace-permissions": "workspace.context.read" } });
    });

    await t.test("inactive membership, Workspace and role fail closed", async () => {
      await send("client/workspaces/context", 403, { cookie: clientCookie, workspaceId: fixtures.disabledMembershipWorkspace.id });
      await send("client/workspaces/context", 403, { cookie: clientCookie, workspaceId: fixtures.disabledWorkspace.id });
      await send("client/workspaces/context", 403, { cookie: clientCookie, workspaceId: fixtures.disabledRoleWorkspace.id });
      const before = await prisma.clientWorkspaceMembership.findUniqueOrThrow({ where: { id: fixtures.alphaMembership.id } });
      await prisma.clientWorkspaceMembership.update({ where: { id: before.id }, data: { status: "disabled", disabledAt: new Date() } });
      try { await send("client/workspaces/context", 403, { cookie: clientCookie, workspaceId: fixtures.alpha.id }); }
      finally { await prisma.clientWorkspaceMembership.update({ where: { id: before.id }, data: { status: before.status, disabledAt: before.disabledAt } }); }
      await send("client/workspaces/context", 200, { cookie: clientCookie, workspaceId: fixtures.alpha.id });
    });

    await t.test("role grants and permission state are re-read on each request, without stale authorization cache", async () => {
      await prisma.clientWorkspaceRolePermission.update({ where: { id: fixtures.alphaGrant.id }, data: { deletedAt: new Date() } });
      try { await send("client/workspaces/context", 403, { cookie: clientCookie, workspaceId: fixtures.alpha.id }); }
      finally { await prisma.clientWorkspaceRolePermission.update({ where: { id: fixtures.alphaGrant.id }, data: { deletedAt: null } }); }
      await send("client/workspaces/context", 200, { cookie: clientCookie, workspaceId: fixtures.alpha.id });
      await prisma.clientWorkspacePermission.update({ where: { id: fixtures.permission.id }, data: { status: "disabled" } });
      try { await send("client/workspaces/context", 403, { cookie: clientCookie, workspaceId: fixtures.alpha.id }); }
      finally { await prisma.clientWorkspacePermission.update({ where: { id: fixtures.permission.id }, data: { status: "active" } }); }
      await send("client/workspaces/context", 200, { cookie: clientCookie, workspaceId: fixtures.alpha.id });
      await prisma.clientWorkspace.update({ where: { id: fixtures.alpha.id }, data: { status: "disabled" } });
      try { await send("client/workspaces/context", 403, { cookie: clientCookie, workspaceId: fixtures.alpha.id }); }
      finally { await prisma.clientWorkspace.update({ where: { id: fixtures.alpha.id }, data: { status: "active" } }); }
    });

    await t.test("a revoked customer session and administrator token cannot resolve Workspace context", async () => {
      const payload = await jwt.verifyAsync(clientCookie.slice(clientCookie.indexOf("=") + 1), {
        secret: values.CLIENT_JWT_SECRET,
        issuer: "urn:aij:aij-foundation:test:api:client",
        audience: "urn:aij:aij-foundation:test:client",
        algorithms: ["HS256"]
      });
      sessionId = payload.sessionId;
      const session = await prisma.clientAuthSession.findUniqueOrThrow({ where: { id: sessionId } });
      await prisma.clientAuthSession.update({ where: { id: sessionId }, data: { status: "revoked", revokedAt: new Date() } });
      try { await send("client/workspaces/context", 401, { cookie: clientCookie, workspaceId: fixtures.alpha.id }); }
      finally { await prisma.clientAuthSession.update({ where: { id: sessionId }, data: { status: session.status, revokedAt: session.revokedAt } }); }
      await send("client/workspaces/context", 200, { cookie: clientCookie, workspaceId: fixtures.alpha.id });

      const adminPassword = JSON.parse(await import("node:fs/promises").then(fs => fs.readFile(fixture.seed.credentials.file, "utf8"))).password;
      const adminResponse = await fetch(baseUrl + "/api/auth/login", {
        method: "POST", headers: { connection: "close", "content-type": "application/json" },
        body: JSON.stringify({ username: "aij-admin", password: adminPassword }), signal: AbortSignal.timeout(12000)
      });
      assert.equal(adminResponse.status, 200);
      const adminToken = (await adminResponse.json()).data.accessToken;
      await send("client/workspaces/context", 401, { cookie: "aij_foundation_test_client_session=" + adminToken, workspaceId: fixtures.alpha.id });
      await send("auth/me", 401, { cookie: clientCookie });
    });

    await t.test("Workspace routes without permission metadata deny by default", async () => {
      const request = { headers: {}, client: undefined };
      const fakeAuth = { canActivate: async () => { request.client = { id: member.id }; return true; } };
      const guard = new WorkspaceContextGuard(new Reflector(), fakeAuth, { resolve: async () => { throw new Error("resolver must not run without route policy"); } });
      const handler = function handler() {};
      const controller = function controller() {};
      const context = { switchToHttp: () => ({ getRequest: () => request }), getHandler: () => handler, getClass: () => controller };
      await assert.rejects(guard.canActivate(context), error => error.getStatus?.() === 403);
    });

    await t.test("the real API closes its Prisma pool after the ephemeral HTTP host shuts down", async () => {
      await closeApp();
      const active = await withDatabase("test", readDatabaseEnvironment("test", process.env, lease.id), async client => {
        const { rows } = await client.query("SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND application_name LIKE 'aij-api:%'");
        return rows;
      }, { acceptanceId: lease.id });
      assert.deepEqual(active, []);
    });

    const evidenceDir = join(repositoryRoot, ".artifacts/af-054");
    await mkdir(evidenceDir, { recursive: true, mode: 0o700 });
    await writeFile(join(evidenceDir, "workspace-context-" + lease.id + ".json"), JSON.stringify({
      task: workspaceContextTask,
      acceptanceId: lease.id,
      database: lease.database,
      bind: "127.0.0.1:0",
      route: "GET /api/client/workspaces/context",
      selector: "x-aij-workspace-id; verified against authenticated membership in PostgreSQL",
      checks: {
        anonymous401: true,
        validMemberAndPermission200: true,
        nonmember403: true,
        forgedWorkspaceAndRoleHeaders403: true,
        missingSelector400: true,
        disabledMembershipWorkspaceRole403: true,
        grantAndPermissionChangeImmediate: true,
        revokedSession401: true,
        adminTokenRejectedAsClient401: true,
        permissionMetadataMissingDefaultDeny: true,
        prismaPoolClosed: true
      },
      records: "synthetic members, workspaces, memberships, roles and permissions only"
    }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  } finally {
    await closeApp();
    replaceEnvironment(originalEnv);
  }
});
