import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";
import { createAcceptance, migrate } from "../database/migration.mjs";
import { seedDatabase } from "../database/seed.mjs";
import { profile, repositoryRoot } from "../database/connection.mjs";
import { assertPortAvailable } from "../port-availability.mjs";
import { applicationSessions, setTaskDatabaseConnections } from "./readiness-support.mjs";
import { authEnvironment, authKeys } from "./auth-support.mjs";
import { prepareRbacFixture } from "./rbac-fixture.mjs";
import { assertClientWorkspacePermissionBaseline, clientWorkspacePermissionBaselineSql } from "./client-workspace-permission-baseline.mjs";

test("real RBAC host uses current database grants and safely denies unauthorized access", { timeout: 55000 }, async t => {
  await assertPortAvailable(3656);
  const parent = join(repositoryRoot, ".artifacts/af-014/http"); mkdirSync(parent, { recursive: true }); const root = mkdtempSync(join(parent, "run-"));
  const save = (name, value) => writeFileSync(join(root, name + ".json"), JSON.stringify(value, null, 2) + "\n");
  const protectedPaths = ["apps/api/src/rbac/permissions.service.ts", "apps/api/src/common/guards/permissions.guard.ts", "apps/api/src/common/guards/jwt-auth.guard.ts", "apps/api/src/auth/auth.service.ts", "apps/api/src/prisma/prisma.service.ts", "apps/api/prisma/schema.prisma", "apps/api/prisma/migrations/20261019000000_initial/migration.sql", ...["dev", "test"].flatMap(mode => [profile(mode).secretFile, profile(mode).stateFile])];
  const hash = path => createHash("sha256").update(readFileSync(path)).digest("hex"), before = protectedPaths.map(hash), original = { ...process.env };
  const lease = await createAcceptance("test", "AF-014"); await migrate({ mode: "test", action: "deploy", acceptanceId: lease.id });
  const fixture = await prepareRbacFixture(lease.id), initial = JSON.parse(readFileSync(fixture.initialPasswordFile));
  const accounts = JSON.parse(readFileSync(fixture.accounts[0].initialPasswordFile)).accounts;
  const keys = authKeys(lease.id, "AF-014"), secrets = [initial.password, keys.secret, ...accounts.map(a => a.password), ...["dev", "test"].map(mode => readFileSync(profile(mode).secretFile, "utf8").trim())];
  const childEnvironment = authEnvironment(lease.id, keys.secret, "AF-014");
  for (const key of Object.keys(process.env)) delete process.env[key]; Object.assign(process.env, childEnvironment);
  const require = createRequire(join(repositoryRoot, "apps/api/package.json")), { JwtService } = require("@nestjs/jwt"), { Prisma } = require("@prisma/client"), jwt = new JwtService();
  const { createApplication } = require(join(repositoryRoot, "apps/api/dist/bootstrap.js")), { PrismaService } = require(join(repositoryRoot, "apps/api/dist/prisma/prisma.service.js")), { PermissionsService } = require(join(repositoryRoot, "apps/api/dist/rbac/permissions.service.js"));
  let app, prisma, permissions, reader, denied, admin, readRole, bootstrapPermission;
  const tokens = {};
  async function request(path, expected, { token, method = "GET", body, headers = {} } = {}) {
    const response = await fetch("http://127.0.0.1:3656/api/" + path, { method, headers: { "x-correlation-id": "af014-real-http-check", ...(token ? { authorization: "Bearer " + token } : {}), ...(body ? { "content-type": "application/json" } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(8000) });
    assert.ok(response.status === expected, "Expected " + expected + " from " + path.split("?")[0] + ", got " + response.status);
    assert.equal(response.headers.get("x-correlation-id"), "af014-real-http-check");
    const result = await response.json(); if (result.data?.accessToken) secrets.push(result.data.accessToken);
    const text = JSON.stringify(result); for (const secret of secrets.filter(s => s !== result.data?.accessToken)) assert.ok(!text.includes(secret), "No credentials/JWT in response");
    assert.ok(!/\$2[aby]\$\d\d\$/.test(text));
    if (path.startsWith("admin/permissions") && expected !== 404) assert.equal(response.headers.get("cache-control"), "no-store");
    return result;
  }
  async function login(username, password) { return (await request("auth/login", 200, { method: "POST", body: { username, password } })).data.accessToken; }
  async function signed(id, payload = {}, options = {}) {
    const session = await prisma.adminAuthSession.findFirstOrThrow({ where: { userId: id, revokedAt: null } });
    const token = await jwt.signAsync({ sessionId: session.id, tokenVersion: 0, transport: "bearer", sub: id, tokenKind: "admin", projectId: "aij-foundation", environment: "test", ...payload }, { secret: keys.secret, algorithm: "HS256", issuer: "urn:aij:aij-foundation:test:api", audience: "urn:aij:aij-foundation:test:admin", expiresIn: 900, ...options }); secrets.push(token); return token;
  }
  try {
    app = await createApplication(); await app.listen(3656, "127.0.0.1"); prisma = app.get(PrismaService); permissions = app.get(PermissionsService);
    await t.test("real Seed, singleton Prisma and auth login supply an active bootstrap permission context", async () => {
      assert.equal((await request("ready", 200)).data.reason, "READY"); assert.equal((await request("health", 200)).data.database, "configured");
      tokens.admin = await login(initial.username, initial.password);
      [admin, reader, denied] = await Promise.all([initial.username, ...accounts.map(a => a.username)].map(username => prisma.sysUser.findUniqueOrThrow({ where: { username } })));
      readRole = await prisma.sysRole.findUniqueOrThrow({ where: { roleCode: "af014_reader" } });
      bootstrapPermission = await prisma.sysPermission.findUniqueOrThrow({ where: { permissionCode: "aij.bootstrap.admin" } });
      const current = await request("admin/permissions/my", 200, { token: tokens.admin }); assert.equal(current.data.isSuperAdmin, true); assert.ok(current.data.permissions.includes("aij.bootstrap.admin"));
      assert.equal((await request("admin/permissions", 200, { token: tokens.admin })).data[0].permissionCode, "aij.bootstrap.admin");
      save("baseline", { database: lease.database, acceptanceId: lease.id, fixture, owner: "one PrismaService / one PermissionsService", bootstrap: current.data });
    });
    await t.test("missing, tampered, wrong product/environment/issuer/kind JWTs fail before authorization", async () => {
      for (const path of ["admin/permissions", "admin/permissions/my"]) {
        await request(path, 401); await request(path, 401, { token: "a.b.c" });
        for (const [payload, options] of [[{ projectId: "other" }, {}], [{ environment: "development" }, {}], [{ tokenKind: "client" }, {}], [{}, { issuer: "qingqi-api" }], [{}, { secret: randomBytes(32).toString("hex") }]]) await request(path, 401, { token: await signed(admin.id, payload, options) });
      }
      save("authentication-required", { endpoints: 2, casesEach: 7, status: 401 });
    });
    await t.test("granted ordinary reader succeeds; active role named super_admin alone never grants privilege", async () => {
      tokens.reader = await login(accounts[0].username, accounts[0].password); tokens.denied = await login(accounts[1].username, accounts[1].password);
      assert.equal((await request("admin/permissions/my", 200, { token: tokens.reader })).data.isSuperAdmin, false);
      await request("admin/permissions", 200, { token: tokens.reader });
      const own = await request("admin/permissions/my", 200, { token: tokens.denied }); assert.deepEqual(own.data.roles, ["super_admin"]); assert.deepEqual(own.data.permissions, []); assert.equal(own.data.isSuperAdmin, false);
      const rejection = await request("admin/permissions", 403, { token: tokens.denied }); assert.equal(rejection.success, false); assert.equal(rejection.data, null);
      save("reader-and-denied", { reader: 200, namedSuperRoleOnly: 403, own: own.data, rejection });
    });
    await t.test("same real service requires all active codes, including grants combined across roles", async () => {
      const second = await prisma.sysPermission.create({ data: { permissionCode: "af014.report.read", permissionName: "AF-014 合成权限", resourceType: "data", module: "af014", action: "read" } });
      const role = await prisma.sysRole.create({ data: { roleCode: "af014_second", roleName: "AF-014 合成第二角色" } });
      await prisma.sysRolePermission.create({ data: { roleId: role.id, permissionId: second.id } }); await prisma.sysUserRole.create({ data: { userId: reader.id, roleId: role.id } });
      const both = ["aij.bootstrap.admin", "af014.report.read"];
      await permissions.requirePermissions(reader.id, both, "af014-real-http-check");
      const link = await prisma.sysRolePermission.findUniqueOrThrow({ where: { roleId_permissionId: { roleId: role.id, permissionId: second.id } } });
      await prisma.sysRolePermission.delete({ where: { id: link.id } });
      await assert.rejects(permissions.requirePermissions(reader.id, both, "af014-real-http-check"), error => error.getStatus?.() === 403);
      await prisma.sysRolePermission.create({ data: link });
      await permissions.requirePermissions(reader.id, both, "af014-real-http-check");
      save("all-required", { allCodes: both, splitRolesSucceeded: true, oneMissingRejected: true });
    });
    await t.test("role-permission revocation takes effect on existing JWT and restores without re-login", async () => {
      const link = await prisma.sysRolePermission.findUniqueOrThrow({ where: { roleId_permissionId: { roleId: readRole.id, permissionId: bootstrapPermission.id } } });
      await prisma.sysRolePermission.delete({ where: { id: link.id } });
      try { await request("admin/permissions", 403, { token: tokens.reader }); } finally { await prisma.sysRolePermission.create({ data: link }); }
      await request("admin/permissions", 200, { token: tokens.reader }); save("grant-revoked", { denied: 403, restored: 200, sameJwt: true });
    });
    await t.test("user-role removal immediately rejects access from the same JWT", async () => {
      const link = await prisma.sysUserRole.findUniqueOrThrow({ where: { userId_roleId: { userId: reader.id, roleId: readRole.id } } });
      await prisma.sysUserRole.delete({ where: { id: link.id } });
      try { await request("admin/permissions", 403, { token: tokens.reader }); } finally { await prisma.sysUserRole.create({ data: link }); }
      await request("admin/permissions", 200, { token: tokens.reader }); save("membership-revoked", { denied: 403, restored: 200 });
    });
    await t.test("disabled, unknown-status and soft-deleted roles do not contribute permissions", async () => {
      for (const data of [{ status: "disabled" }, { status: "enabled" }, { deletedAt: new Date() }]) {
        await prisma.sysRole.update({ where: { id: readRole.id }, data });
        try { await request("admin/permissions", 403, { token: tokens.reader }); assert.ok(!(await request("admin/permissions/my", 200, { token: tokens.reader })).data.roles.includes("af014_reader")); }
        finally { await prisma.sysRole.update({ where: { id: readRole.id }, data: { status: "active", deletedAt: null } }); }
      }
      save("role-status", { cases: 3, rejected: 403 });
    });
    await t.test("inactive or missing permission definitions reject ordinary and real super administrators", async () => {
      for (const status of ["disabled", "enabled"]) {
        await prisma.sysPermission.update({ where: { id: bootstrapPermission.id }, data: { status } });
        try { for (const token of [tokens.reader, tokens.admin]) await request("admin/permissions", 403, { token }); }
        finally { await prisma.sysPermission.update({ where: { id: bootstrapPermission.id }, data: { status: "active" } }); }
      }
      await assert.rejects(permissions.requirePermissions(admin.id, ["af014.missing.read"], "af014-real-http-check"), error => error.getStatus?.() === 403);
      save("permission-status", { ordinaryAndSuperChecked: true, unknownDefinitionRejected: true });
    });
    await t.test("only current DB super-admin flag bypasses grants; JWT claims/headers/query never escalate", async () => {
      const forged = await signed(denied.id, { isSuperAdmin: true, roles: ["super_admin"], permissions: ["*"] });
      await request("admin/permissions?isSuperAdmin=true&workspaceId=other", 403, { token: forged, headers: { "x-role": "super_admin", "x-permissions": "aij.bootstrap.admin", "x-workspace-id": "other" } });
      await prisma.sysUser.update({ where: { id: denied.id }, data: { isSuperAdmin: true } });
      try { await request("admin/permissions", 200, { token: tokens.denied }); } finally { await prisma.sysUser.update({ where: { id: denied.id }, data: { isSuperAdmin: false } }); }
      await request("admin/permissions", 403, { token: tokens.denied }); await request("admin/permissions", 403, { token: forged });
      save("server-truth", { flagPromoteAndRevokeImmediate: true, tokenRoleAndSuperClaimsIgnored: true, clientWorkspaceIsNotAuthorization: true });
    });
    await t.test("disabled and soft-deleted administrator is unauthenticated even with granted roles", async () => {
      for (const data of [{ status: "disabled" }, { deletedAt: new Date() }]) {
        await prisma.sysUser.update({ where: { id: reader.id }, data });
        try { await request("admin/permissions", 401, { token: tokens.reader }); await request("admin/permissions/my", 401, { token: tokens.reader }); }
        finally { await prisma.sysUser.update({ where: { id: reader.id }, data: { status: "active", deletedAt: null } }); }
      }
      save("identity-status", { cases: 2, status: 401 });
    });
    await t.test("Seed and fixture reruns preserve existing credentials, custom roles, revocations and account state", async () => {
      const snapshot = async () => JSON.stringify({ users: await prisma.sysUser.findMany({ orderBy: { id: "asc" } }), roles: await prisma.sysRole.findMany({ orderBy: { id: "asc" } }), assignments: await prisma.sysUserRole.findMany({ orderBy: { id: "asc" } }), grants: await prisma.sysRolePermission.findMany({ orderBy: { id: "asc" } }) });
      const link = await prisma.sysRolePermission.findUniqueOrThrow({ where: { roleId_permissionId: { roleId: readRole.id, permissionId: bootstrapPermission.id } } });
      await prisma.sysRolePermission.delete({ where: { id: link.id } }); await prisma.sysRole.update({ where: { id: readRole.id }, data: { status: "disabled" } });
      try {
        const state = await snapshot(), initialHash = hash(fixture.initialPasswordFile), accountHash = hash(fixture.accounts[0].initialPasswordFile);
        await seedDatabase({ mode: "test", acceptanceId: lease.id }); await prepareRbacFixture(lease.id);
        assert.ok(await snapshot() === state, "Existing identities/roles/revoked grants unchanged without printing hashes"); assert.equal(hash(fixture.initialPasswordFile), initialHash); assert.equal(hash(fixture.accounts[0].initialPasswordFile), accountHash);
        await request("admin/permissions", 403, { token: tokens.reader });
      } finally {
        await prisma.sysRole.update({ where: { id: readRole.id }, data: { status: "active" } }); await prisma.sysRolePermission.create({ data: link });
      }
      save("no-reset", { seedAndFixtureIdempotent: true, passwordAndRoleRowsStable: true, actualRevocationAndDisabledRolePreserved: true });
    });
    await t.test("real own DB outage returns authorization 503/live 200; restore succeeds without synthetic grants", async () => {
      await prisma.$disconnect(); assert.deepEqual(await applicationSessions(lease.id, "AF-014"), []); await setTaskDatabaseConnections(lease.id, false, "AF-014");
      try { await request("admin/permissions", 503, { token: tokens.reader }); await request("admin/permissions/my", 503, { token: tokens.reader }); await request("health", 200); }
      finally { await setTaskDatabaseConnections(lease.id, true, "AF-014"); }
      await request("ready", 200); await request("admin/permissions", 200, { token: tokens.reader }); save("outage", { unavailable: 503, live: 200, recovered: 200, containerStopped: false });
    });
    await t.test("denial audit and evidence are sanitized; only core synthetic identity/permissions rows exist", async () => {
      const rows = await prisma.auditLog.findMany({ where: { module: "rbac" } }); assert.ok(rows.length >= 10);
      assert.ok(rows.every(row => row.action === "permission_denied" && row.status === "failed" && row.requestSummary.correlationId === "af014-real-http-check"));
      const text = JSON.stringify(rows); for (const secret of secrets) assert.ok(!text.includes(secret)); assert.ok(!/\$2[aby]\$\d\d\$/.test(text));
      assertClientWorkspacePermissionBaseline(await prisma.$queryRawUnsafe(clientWorkspacePermissionBaselineSql));
      for (const model of Prisma.dmmf.datamodel.models) {
        if (model.name === "ClientWorkspacePermission") continue; // Exact catalog assertion above; all other business tables stay empty.
        if (!["SysUser", "SysRole", "SysPermission", "SysUserRole", "SysRolePermission", "ProjectProfile", "OrganizationProfile", "AuditLog", "AdminAuthSession"].includes(model.name)) assert.equal((await prisma.$queryRawUnsafe('SELECT count(*)::int AS count FROM public."' + model.dbName + '"'))[0].count, 0, model.name + " must remain empty");
      }
      assert.deepEqual(protectedPaths.map(hash), before); save("audit", { denials: rows.length, sensitiveValuesAbsent: true, correlationChecked: true, unrelatedTablesEmpty: true });
    });
    await t.test("app.close releases the actual pool; disabled auth does not accidentally expose RBAC routes", async () => {
      await app.close(); app = undefined; assert.deepEqual(await applicationSessions(lease.id, "AF-014"), []);
      process.env.AUTH_ENABLED = "false"; process.env.DATABASE_ENABLED = "false"; process.env.JWT_SECRET = "template";
      app = await createApplication(); await app.listen(3656, "127.0.0.1");
      for (const path of ["admin/permissions", "admin/permissions/my"]) await request(path, 404);
      await request("health", 200); await app.close(); app = undefined; assert.deepEqual(await applicationSessions(lease.id, "AF-014"), []);
      for (const name of readdirSync(root).filter(n => n.endsWith(".json") && !n.startsWith("._"))) { const text = readFileSync(join(root, name), "utf8"); for (const secret of secrets) assert.ok(!text.includes(secret), "Evidence must not contain credentials or JWTs"); }
      save("result", { database: lease.database, acceptanceId: lease.id, pools: 0, noSourceProbe: true, noSharedDatabaseReset: true, effectiveDbAuthorization: true });
    });
  } finally {
    if (app) await app.close(); await setTaskDatabaseConnections(lease.id, true, "AF-014");
    for (const key of Object.keys(process.env)) delete process.env[key]; Object.assign(process.env, original);
  }
});
