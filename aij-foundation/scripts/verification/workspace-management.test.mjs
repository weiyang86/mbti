import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { createAcceptance, migrate } from "../database/migration.mjs";
import { readDatabaseEnvironment, repositoryRoot, withDatabase } from "../database/connection.mjs";
import {
  workspaceManagementEnvironment,
  prepareWorkspaceManagementMembers,
  workspaceManagementTask
} from "./workspace-management-fixture.mjs";

const require = createRequire(join(repositoryRoot, "apps/api/package.json"));
const requireApi = file => require(join(repositoryRoot, "apps/api/dist", file));

test("AF-055 provides tenant-scoped Workspace and Membership operations with serialized owner changes", { timeout: 240000 }, async t => {
  const lease = await createAcceptance("test", workspaceManagementTask);
  const deployed = await migrate({ mode: "test", action: "deploy", acceptanceId: lease.id });
  assert.equal(deployed.exitCode, 0);
  const fixture = await prepareWorkspaceManagementMembers(lease.id);
  const values = await workspaceManagementEnvironment(lease.id);
  const credential = JSON.parse(await import("node:fs/promises").then(fs => fs.readFile(fixture.accounts[0].initialPasswordFile, "utf8")));
  const [ownerAccount, secondAccount] = credential.accounts;
  const originalEnvironment = { ...process.env };
  let app;
  let baseUrl;
  let prisma;
  let ownerCookie;
  let secondCookie;
  let alpha;
  let beta;
  let alphaSecondMembership;
  let ownerRole;
  let memberRole;
  const checks = {};

  const replaceEnvironment = next => {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, next);
  };
  const closeApp = async () => {
    if (!app) return;
    await app.close();
    app = undefined;
  };
  const request = async (method, path, { cookie, workspaceId, body, origin = values.WEB_URL, headers = {} } = {}) => {
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
    const result = await request(method, path, options);
    assert.equal(result.response.status, status, method + " " + path + " returned " + JSON.stringify(result.body));
    return result;
  };
  const login = async account => {
    const result = await expect("POST", "client/auth/login", 200, { body: { email: account.email, password: account.password } });
    const header = result.response.headers.get("set-cookie");
    assert.ok(header?.includes("HttpOnly") && header.includes("SameSite=Strict"));
    return header.split(";")[0];
  };

  try {
    replaceEnvironment(values);
    const { createApplication } = requireApi("bootstrap.js");
    const { PrismaService } = requireApi("prisma/prisma.service.js");
    app = await createApplication();
    await app.listen(0, "127.0.0.1");
    const address = app.getHttpServer().address();
    assert.ok(address && typeof address === "object" && address.port > 0);
    baseUrl = "http://127.0.0.1:" + address.port;
    prisma = app.get(PrismaService);

    await t.test("authentication and same-origin writes fail closed", async () => {
      await expect("GET", "client/workspaces", 401);
      await expect("POST", "client/workspaces", 401, { body: { name: "Synthetic Alpha", idempotencyKey: "af055-anonymous" } });
      ownerCookie = await login(ownerAccount);
      secondCookie = await login(secondAccount);
      await expect("POST", "client/workspaces", 403, {
        cookie: ownerCookie,
        origin: "https://outside.example",
        body: { name: "Synthetic Rejected", idempotencyKey: "af055-crossorigin" }
      });
      assert.equal(await prisma.clientWorkspace.count(), 0);
      checks.anonymous401 = true;
      checks.crossOriginWrite403 = true;
    });

    await t.test("creation atomically installs only generic roles, grants, owner membership and audit; retry is idempotent", async () => {
      const createBody = { name: "Synthetic Alpha", idempotencyKey: "af055-alpha-create" };
      const created = await expect("POST", "client/workspaces", 201, { cookie: ownerCookie, body: createBody });
      alpha = created.body.data;
      assert.equal(alpha.idempotent, false);
      assert.equal(alpha.status, "active");
      const retried = await expect("POST", "client/workspaces", 201, { cookie: ownerCookie, body: createBody });
      assert.equal(retried.body.data.id, alpha.id);
      assert.equal(retried.body.data.idempotent, true);
      await expect("POST", "client/workspaces", 409, { cookie: ownerCookie, body: { ...createBody, name: "Different name" } });
      const roles = await prisma.clientWorkspaceRole.findMany({ where: { workspaceId: alpha.id }, orderBy: { code: "asc" } });
      assert.deepEqual(roles.map(role => role.code), ["MEMBER", "OWNER"]);
      ownerRole = roles.find(role => role.code === "OWNER");
      memberRole = roles.find(role => role.code === "MEMBER");
      const ownerPermissions = await prisma.clientWorkspaceRolePermission.count({ where: { roleId: ownerRole.id, deletedAt: null } });
      const memberPermissions = await prisma.clientWorkspaceRolePermission.count({ where: { roleId: memberRole.id, deletedAt: null } });
      assert.equal(ownerPermissions, 13, "workspace owners receive the exact expanded catalog including AI run and own private assets");
      const grants = await prisma.clientWorkspaceRolePermission.findMany({ where: { roleId: ownerRole.id, deletedAt: null }, select: { permission: { select: { code: true } } } });
      assert.deepEqual(grants.map(g => g.permission.code).sort(), [
        "workspace.context.read", "workspace.manage", "workspace.member.read", "workspace.member.manage", "workspace.role.read",
        "workspace.payment.create", "workspace.payment.read", "workspace.knowledge.manage", "workspace.knowledge.query",
        "workspace.ai.execute", "workspace.ai.read", "workspace.ai.assets.read", "workspace.ai.assets.manage"
      ].sort());
      assert.equal(memberPermissions, 1);
      const initialMembership = await prisma.clientWorkspaceMembership.findUniqueOrThrow({ where: { workspaceId_memberId: { workspaceId: alpha.id, memberId: ownerAccount.id } } });
      assert.equal(initialMembership.status, "active");
      assert.equal(initialMembership.roleId, ownerRole.id);
      assert.equal(await prisma.auditLog.count({ where: { module: "client-workspaces", action: "workspace_created", workspaceId: alpha.id } }), 1);
      checks.createRolesPermissionsOwnerAndAudit = true;
      checks.idempotentWorkspaceCreation = true;
    });

    await t.test("workspace/member paging and member management are scoped to active memberships", async () => {
      const added = await expect("POST", "client/workspaces/members", 201, {
        cookie: ownerCookie, workspaceId: alpha.id, body: { memberId: secondAccount.id, roleId: memberRole.id }
      });
      alphaSecondMembership = added.body.data;
      assert.equal(alphaSecondMembership.status, "active");
      assert.equal(alphaSecondMembership.reactivated, false);
      await expect("POST", "client/workspaces/members", 409, {
        cookie: ownerCookie, workspaceId: alpha.id, body: { memberId: secondAccount.id, roleId: memberRole.id }
      });
      const page = await expect("GET", "client/workspaces/members?page=1&pageSize=1", 200, { cookie: ownerCookie, workspaceId: alpha.id });
      assert.equal(page.body.data.total, 2);
      assert.equal(page.body.data.items.length, 1);
      const roles = await expect("GET", "client/workspaces/roles", 200, { cookie: ownerCookie, workspaceId: alpha.id });
      assert.deepEqual(roles.body.data.map(role => role.code), ["OWNER", "MEMBER"]);
      const ownWorkspaces = await expect("GET", "client/workspaces?page=1&pageSize=1", 200, { cookie: ownerCookie });
      assert.equal(ownWorkspaces.body.data.total, 1);
      assert.equal(ownWorkspaces.body.data.items.length, 1);
      const otherWorkspaces = await expect("GET", "client/workspaces", 200, { cookie: secondCookie });
      assert.equal(otherWorkspaces.body.data.total, 1);
      const responseText = JSON.stringify(page.body);
      assert.ok(!responseText.includes(ownerAccount.password) && !responseText.includes(secondAccount.password));
      assert.ok(!/passwordHash|password_hash/.test(responseText));
      checks.memberCRUDPaging = true;
      checks.noCredentialFieldsInMemberResponse = true;
    });

    await t.test("workspace details are versioned by audit and cross-origin edits are denied", async () => {
      await expect("PATCH", "client/workspaces/details", 403, {
        cookie: ownerCookie, workspaceId: alpha.id, origin: "https://outside.example", body: { name: "Bad Origin" }
      });
      const updated = await expect("PATCH", "client/workspaces/details", 200, {
        cookie: ownerCookie, workspaceId: alpha.id, body: { name: "Synthetic Alpha Renamed" }
      });
      assert.equal(updated.body.data.name, "Synthetic Alpha Renamed");
      const context = await expect("GET", "client/workspaces/context", 200, { cookie: ownerCookie, workspaceId: alpha.id });
      assert.equal(context.body.data.workspaceName, "Synthetic Alpha Renamed");
      assert.equal(await prisma.auditLog.count({ where: { module: "client-workspaces", action: "workspace_updated", workspaceId: alpha.id } }), 1);
      checks.workspaceUpdateAndAudit = true;
    });

    await t.test("non-managers cannot mutate memberships and an authorized manager cannot delegate beyond own permissions", async () => {
      const denied = await expect("POST", "client/workspaces/members", 403, {
        cookie: secondCookie, workspaceId: alpha.id, body: { memberId: ownerAccount.id, roleId: memberRole.id }
      });
      assert.equal(denied.body.success, false);
      const memberManage = await prisma.clientWorkspacePermission.findUniqueOrThrow({ where: { code: "workspace.member.manage" } });
      const extraGrant = await prisma.clientWorkspaceRolePermission.create({ data: { roleId: memberRole.id, permissionId: memberManage.id } });
      try {
        await expect("PATCH", "client/workspaces/members/" + alphaSecondMembership.id + "/role", 403, {
          cookie: secondCookie, workspaceId: alpha.id, body: { roleId: ownerRole.id }
        });
      } finally {
        await prisma.clientWorkspaceRolePermission.update({ where: { id: extraGrant.id }, data: { deletedAt: new Date() } });
      }
      checks.nonManagerWrite403 = true;
      checks.roleDelegationSubsetEnforced = true;
    });

    await t.test("membership role and state updates take effect on the next real request", async () => {
      const suspended = await expect("PATCH", "client/workspaces/members/" + alphaSecondMembership.id + "/status", 200, {
        cookie: ownerCookie, workspaceId: alpha.id, body: { status: "suspended", reason: "synthetic test" }
      });
      assert.ok(suspended.body.data.sessionVersion > 0);
      await expect("GET", "client/workspaces/context", 403, { cookie: secondCookie, workspaceId: alpha.id });
      await expect("PATCH", "client/workspaces/members/" + alphaSecondMembership.id + "/status", 200, {
        cookie: ownerCookie, workspaceId: alpha.id, body: { status: "active" }
      });
      await expect("GET", "client/workspaces/context", 200, { cookie: secondCookie, workspaceId: alpha.id });
      const promoted = await expect("PATCH", "client/workspaces/members/" + alphaSecondMembership.id + "/role", 200, {
        cookie: ownerCookie, workspaceId: alpha.id, body: { roleId: ownerRole.id }
      });
      assert.equal(promoted.body.data.roleCode, "OWNER");
      const selfDisable = await expect("PATCH", "client/workspaces/members/" + alphaSecondMembership.id + "/status", 403, {
        cookie: secondCookie, workspaceId: alpha.id, body: { status: "removed" }
      });
      assert.equal(selfDisable.body.success, false);
      const demoted = await expect("PATCH", "client/workspaces/members/" + alphaSecondMembership.id + "/role", 200, {
        cookie: ownerCookie, workspaceId: alpha.id, body: { roleId: memberRole.id }
      });
      assert.equal(demoted.body.data.roleCode, "MEMBER");
      const memberContext = await expect("GET", "client/workspaces/context", 200, { cookie: secondCookie, workspaceId: alpha.id });
      assert.equal(memberContext.body.data.roleCode, "MEMBER");
      await expect("GET", "client/workspaces/members", 403, { cookie: secondCookie, workspaceId: alpha.id });
      checks.statusAndRoleImmediate = true;
      checks.selfStatusMutationDenied = true;
    });

    await t.test("removed membership can be reactivated without creating a duplicate and is audited", async () => {
      const removed = await expect("PATCH", "client/workspaces/members/" + alphaSecondMembership.id + "/status", 200, {
        cookie: ownerCookie, workspaceId: alpha.id, body: { status: "removed", reason: "synthetic removal" }
      });
      const reactivated = await expect("POST", "client/workspaces/members", 201, {
        cookie: ownerCookie, workspaceId: alpha.id, body: { memberId: secondAccount.id, roleId: memberRole.id }
      });
      assert.equal(reactivated.body.data.id, alphaSecondMembership.id);
      assert.equal(reactivated.body.data.status, "active");
      assert.equal(reactivated.body.data.reactivated, true);
      assert.ok(reactivated.body.data.sessionVersion > removed.body.data.sessionVersion);
      assert.equal(await prisma.clientWorkspaceMembership.count({ where: { workspaceId: alpha.id, memberId: secondAccount.id } }), 1);
      assert.equal(await prisma.auditLog.count({ where: { module: "client-workspaces", action: "workspace_member_reactivated", workspaceId: alpha.id } }), 1);
      await expect("GET", "client/workspaces/context", 200, { cookie: secondCookie, workspaceId: alpha.id });
      checks.removalReactivationAndAudit = true;
    });

    await t.test("cross-workspace membership IDs cannot be mutated", async () => {
      const created = await expect("POST", "client/workspaces", 201, {
        cookie: secondCookie, body: { name: "Synthetic Beta", idempotencyKey: "af055-beta-create" }
      });
      beta = created.body.data;
      const betaRoles = await prisma.clientWorkspaceRole.findMany({ where: { workspaceId: beta.id } });
      const betaOwner = betaRoles.find(role => role.code === "OWNER");
      await expect("PATCH", "client/workspaces/members/" + alphaSecondMembership.id + "/role", 404, {
        cookie: secondCookie, workspaceId: beta.id, body: { roleId: betaOwner.id }
      });
      await expect("PATCH", "client/workspaces/members/" + alphaSecondMembership.id + "/status", 404, {
        cookie: secondCookie, workspaceId: beta.id, body: { status: "removed" }
      });
      checks.crossWorkspaceMemberIds404 = true;
    });

    await t.test("owner cannot leave alone; concurrent owner leaves serialize to one remaining owner", async () => {
      await expect("POST", "client/workspaces/leave", 409, { cookie: secondCookie, workspaceId: beta.id });
      const betaOwnerMembership = await prisma.clientWorkspaceMembership.findUniqueOrThrow({
        where: { workspaceId_memberId: { workspaceId: beta.id, memberId: secondAccount.id } }
      });
      assert.equal(betaOwnerMembership.status, "active");
      await expect("PATCH", "client/workspaces/members/" + alphaSecondMembership.id + "/role", 200, {
        cookie: ownerCookie, workspaceId: alpha.id, body: { roleId: ownerRole.id }
      });
      const outcomes = await Promise.all([
        request("POST", "client/workspaces/leave", { cookie: ownerCookie, workspaceId: alpha.id }),
        request("POST", "client/workspaces/leave", { cookie: secondCookie, workspaceId: alpha.id })
      ]);
      const successCount = outcomes.filter(outcome => outcome.response.status === 200 || outcome.response.status === 201).length;
      assert.equal(successCount, 1, "concurrent leave statuses: " + outcomes.map(outcome => outcome.response.status).join(","));
      assert.ok(outcomes.every(outcome => [200, 201, 403, 409].includes(outcome.response.status)));
      const owners = await prisma.clientWorkspaceMembership.findMany({
        where: { workspaceId: alpha.id, status: "active", role: { is: { code: "OWNER", status: "active", deletedAt: null } }, deletedAt: null },
        select: { id: true, memberId: true }
      });
      assert.equal(owners.length, 1);
      assert.equal(await prisma.auditLog.count({ where: { module: "client-workspaces", action: "workspace_member_left", workspaceId: alpha.id } }), 1);
      checks.lastOwnerCannotLeave = true;
      checks.concurrentOwnerLeaveKeepsExactlyOne = true;
    });

    await t.test("persisted audit summaries are credential-free and the isolated API pool closes", async () => {
      const audit = await prisma.auditLog.findMany({ where: { module: "client-workspaces" }, orderBy: { createdAt: "asc" } });
      assert.ok(audit.some(row => row.action === "workspace_member_role_changed"));
      assert.ok(audit.some(row => row.action === "workspace_member_status_changed"));
      const serialized = JSON.stringify(audit);
      assert.ok(!serialized.includes(ownerAccount.password) && !serialized.includes(secondAccount.password));
      assert.ok(!/passwordHash|password_hash|CLIENT_JWT_SECRET/.test(serialized));
      await closeApp();
      const active = await withDatabase("test", readDatabaseEnvironment("test", process.env, lease.id), async client => {
        const { rows } = await client.query("SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND application_name LIKE 'aij-api:%'");
        return rows;
      }, { acceptanceId: lease.id });
      assert.deepEqual(active, []);
      checks.auditCredentialRedaction = true;
      checks.prismaPoolClosed = true;
    });

    const evidenceDir = join(repositoryRoot, ".artifacts/af-055");
    await mkdir(evidenceDir, { recursive: true, mode: 0o700 });
    await writeFile(join(evidenceDir, "workspace-management-" + lease.id + ".json"), JSON.stringify({
      task: workspaceManagementTask,
      acceptanceId: lease.id,
      database: lease.database,
      bind: "127.0.0.1:0",
      endpoints: [
        "GET/POST /api/client/workspaces",
        "GET /api/client/workspaces/roles",
        "GET/POST /api/client/workspaces/members",
        "PATCH /api/client/workspaces/members/:membershipId/role",
        "PATCH /api/client/workspaces/members/:membershipId/status",
        "POST /api/client/workspaces/leave",
        "PATCH /api/client/workspaces/details"
      ],
      checks,
      ownerLock: "transaction-scoped PostgreSQL advisory lock by workspace; only one concurrent final-owner leave commits",
      data: "AIJ synthetic MemberUser and Workspace records only; no source product/customer data"
    }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  } finally {
    await closeApp();
    replaceEnvironment(originalEnvironment);
  }
});
