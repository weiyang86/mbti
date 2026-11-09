import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";
import { createAcceptance, migrate } from "../database/migration.mjs";
import { repositoryRoot } from "../database/connection.mjs";
import { assertPortAvailable } from "../port-availability.mjs";
import { applicationSessions, setTaskDatabaseConnections } from "./readiness-support.mjs";
import { authEnvironment, authKeys } from "./auth-support.mjs";
import { prepareRbacFixture } from "./rbac-fixture.mjs";

test("AF-017 real host enforces server RBAC and the global admin namespace defaults to deny", { timeout: 55000 }, async t => {
  await assertPortAvailable(3656);
  const parent = join(repositoryRoot, ".artifacts/af-017/http"); mkdirSync(parent, { recursive: true }); const root = mkdtempSync(join(parent, "run-"));
  const lease = await createAcceptance("test", "AF-017"); await migrate({ mode: "test", action: "deploy", acceptanceId: lease.id });
  const fixture = await prepareRbacFixture(lease.id, "AF-017"), adminAccount = JSON.parse(readFileSync(fixture.initialPasswordFile));
  const accounts = JSON.parse(readFileSync(fixture.accounts[0].initialPasswordFile)).accounts, keys = authKeys(lease.id, "AF-017");
  const secrets = [keys.secret, adminAccount.password, ...accounts.map(a => a.password)], original = { ...process.env }, evidence = [];
  const paths = ["apps/api/src/common/guards/admin-authorization.guard.ts", "apps/api/src/rbac/permissions.service.ts", "apps/api/prisma/schema.prisma", "apps/api/prisma/migrations/20261019000000_initial/migration.sql"];
  const hash = p => createHash("sha256").update(readFileSync(p)).digest("hex"), before = paths.map(hash);
  for (const key of Object.keys(process.env)) delete process.env[key]; Object.assign(process.env, authEnvironment(lease.id, keys.secret, "AF-017"));
  const require = createRequire(join(repositoryRoot, "apps/api/package.json")); require("reflect-metadata");
  const { Controller, Get, Header, Module, SetMetadata } = require("@nestjs/common"), { NestFactory } = require("@nestjs/core");
  const { createApplication } = require(join(repositoryRoot, "apps/api/dist/bootstrap.js"));
  const { PrismaService } = require(join(repositoryRoot, "apps/api/dist/prisma/prisma.service.js"));
  const { Permissions, PERMISSIONS_KEY } = require(join(repositoryRoot, "apps/api/dist/common/decorators/permissions.decorator.js"));
  const { AuthenticatedAdmin } = require(join(repositoryRoot, "apps/api/dist/common/decorators/authenticated-admin.decorator.js"));
  let app, prisma, reader, denied, admin, role, grant, secondRole, secondPermission;
  const tokens = {};
  async function request(path, expected, { token, method = "GET", body, headers = {} } = {}) {
    const r = await fetch("http://127.0.0.1:3656/api/" + path, { method, headers: { "x-correlation-id": "af017-http", ...(token ? { authorization: "Bearer " + token } : {}), ...(body ? { "content-type": "application/json" } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(8000) });
    assert.equal(r.status, expected, path.split("?")[0]); const result = await r.json();
    if (result.data?.accessToken) secrets.push(result.data.accessToken);
    for (const secret of secrets.filter(s => s !== result.data?.accessToken)) assert.ok(!JSON.stringify(result).includes(secret));
    assert.ok(!/\$2[aby]\$\d\d\$/.test(JSON.stringify(result)));
    if (path.startsWith("admin/") && expected !== 404) assert.equal(r.headers.get("cache-control"), "no-store");
    evidence.push({ path: path.split("?")[0], method, status: r.status }); return result.data ?? result;
  }
  const tokenFor = async a => (await request("auth/login", 200, { method: "POST", body: { username: a.username, password: a.password } })).accessToken;
  const catalog = (token, status) => request("admin/permissions", status, { token });
  try {
    app = await createApplication(); await app.listen(3656, "127.0.0.1"); prisma = app.get(PrismaService);
    await t.test("accepted Seed/Prisma/JWT supply real 401, 403 and ordinary/super 200", async () => {
      for (const [name, a] of [["admin", adminAccount], ["reader", accounts[0]], ["denied", accounts[1]]]) tokens[name] = await tokenFor(a);
      [admin, reader, denied] = await Promise.all([adminAccount, ...accounts].map(a => prisma.sysUser.findUniqueOrThrow({ where: { username: a.username } })));
      role = await prisma.sysRole.findUniqueOrThrow({ where: { roleCode: "af017_reader" } });
      grant = await prisma.sysRolePermission.findFirstOrThrow({ where: { roleId: role.id } });
      await request("admin/permissions/my", 401); await catalog(undefined, 401); await catalog(tokens.denied, 403); await catalog(tokens.reader, 200); await catalog(tokens.admin, 200);
      const own = await request("admin/permissions/my", 200, { token: tokens.denied }); assert.deepEqual(own.roles, ["super_admin"]); assert.deepEqual(own.permissions, []); assert.equal(own.isSuperAdmin, false);
    });
    await t.test("client permission/workspace headers, query and body cannot promote identity or alter DB", async () => {
      const state = async () => JSON.stringify(await prisma.sysUser.findMany({ select: { id: true, isSuperAdmin: true, userRoles: true }, orderBy: { id: "asc" } })), beforeState = await state();
      await request("admin/roles?permission=admin.role.manage&workspaceId=other&isSuperAdmin=true", 403, { token: tokens.denied, headers: { "x-permissions": "admin.role.manage", "x-workspace-id": "other", "x-is-super-admin": "true" } });
      await request("admin/roles", 403, { token: tokens.reader, method: "POST", body: { roleCode: "af017_escalation", roleName: "Synthetic", permissions: ["*"], workspaceId: "other", isSuperAdmin: true } });
      assert.ok(await state() === beforeState); assert.equal(await prisma.sysRole.count({ where: { roleCode: "af017_escalation" } }), 0);
    });
    await t.test("server result and existing JWT lose/recover revoked permission without cache delay", async () => {
      await prisma.sysRolePermission.delete({ where: { id: grant.id } });
      try { await catalog(tokens.reader, 403); assert.deepEqual((await request("admin/permissions/my", 200, { token: tokens.reader })).permissions, []); }
      finally { await prisma.sysRolePermission.create({ data: grant }); }
      await catalog(tokens.reader, 200);
    });
    await t.test("role disable/delete and user-role removal take effect on next request with same JWT", async () => {
      for (const data of [{ status: "disabled" }, { deletedAt: new Date() }]) {
        await prisma.sysRole.update({ where: { id: role.id }, data });
        try { await catalog(tokens.reader, 403); assert.deepEqual((await request("admin/permissions/my", 200, { token: tokens.reader })).roles, []); }
        finally { await prisma.sysRole.update({ where: { id: role.id }, data: { status: "active", deletedAt: null } }); }
        await catalog(tokens.reader, 200);
      }
      const link = await prisma.sysUserRole.findFirstOrThrow({ where: { userId: reader.id, roleId: role.id } }); await prisma.sysUserRole.delete({ where: { id: link.id } });
      try { await catalog(tokens.reader, 403); } finally { await prisma.sysUserRole.create({ data: link }); }
      await catalog(tokens.reader, 200);
    });
    await t.test("only live DB super flag bypasses grants; disabled definitions still reject super", async () => {
      await prisma.sysUser.update({ where: { id: denied.id }, data: { isSuperAdmin: true } });
      try { await catalog(tokens.denied, 200); } finally { await prisma.sysUser.update({ where: { id: denied.id }, data: { isSuperAdmin: false } }); }
      await catalog(tokens.denied, 403);
      await prisma.sysPermission.update({ where: { id: grant.permissionId }, data: { status: "disabled" } });
      try { for (const token of [tokens.admin, tokens.reader]) await catalog(token, 403); }
      finally { await prisma.sysPermission.update({ where: { id: grant.permissionId }, data: { status: "active" } }); }
      await catalog(tokens.reader, 200);
    });
    await t.test("current DB identity disable rejects even valid JWT and real outage cannot synthesize grants", async () => {
      await prisma.sysUser.update({ where: { id: reader.id }, data: { status: "disabled" } });
      try { await catalog(tokens.reader, 401); } finally { await prisma.sysUser.update({ where: { id: reader.id }, data: { status: "active" } }); }
      await prisma.$disconnect(); await setTaskDatabaseConnections(lease.id, false, "AF-017");
      try { await catalog(tokens.reader, 503); await request("admin/permissions/my", 503, { token: tokens.reader }); await request("health", 200); }
      finally { await setTaskDatabaseConnections(lease.id, true, "AF-017"); }
      await catalog(tokens.reader, 200);
    });
    await t.test("accepted production app releases its only pool before isolated test-only route composition", async () => {
      await app.close(); app = undefined; assert.deepEqual(await applicationSessions(lease.id, "AF-017"), []);
    });

    // Test-only controllers compose the actual module/APP_GUARD; no production source probes/routes.
    let reached = 0;
    class Probe { missing() { reached++; return { ok: true }; } and() { reached++; return { ok: true }; } corrupt() { reached++; } conflict() { reached++; } unknown() { reached++; } }
    Controller("admin/af017-probe")(Probe); Permissions("aij.bootstrap.admin")(Probe);
    for (const name of ["missing", "and", "corrupt", "conflict", "unknown"]) {
      Get(name)(Probe.prototype, name, Object.getOwnPropertyDescriptor(Probe.prototype, name));
      Header("Cache-Control", "no-store")(Probe.prototype, name, Object.getOwnPropertyDescriptor(Probe.prototype, name));
    }
    Permissions("af017.second.read")(Probe.prototype, "and", Object.getOwnPropertyDescriptor(Probe.prototype, "and"));
    SetMetadata(PERMISSIONS_KEY, [])(Probe.prototype, "corrupt", Object.getOwnPropertyDescriptor(Probe.prototype, "corrupt"));
    AuthenticatedAdmin()(Probe.prototype, "conflict", Object.getOwnPropertyDescriptor(Probe.prototype, "conflict"));
    Permissions("af017.unknown.read")(Probe.prototype, "unknown", Object.getOwnPropertyDescriptor(Probe.prototype, "unknown"));
    class Missing { unannotated() { reached++; } classException() { reached++; } }
    Controller(["", "ADMIN/af017-array"])(Missing); AuthenticatedAdmin()(Missing);
    Get("admin/af017-missing")(Missing.prototype, "unannotated", Object.getOwnPropertyDescriptor(Missing.prototype, "unannotated"));
    Get("class-exception")(Missing.prototype, "classException", Object.getOwnPropertyDescriptor(Missing.prototype, "classException"));
    class FixtureModule {} const { AppModule } = require(join(repositoryRoot, "apps/api/dist/app.module.js"));
    Module({ imports: [AppModule.forRoot()], controllers: [Probe, Missing] })(FixtureModule);
    app = await NestFactory.create(FixtureModule); app.setGlobalPrefix("api");
    const { correlateRequest } = require(join(repositoryRoot, "apps/api/dist/common/interceptors/correlation.interceptor.js"));
    app.use((req, res, next) => { correlateRequest(req, res); next(); });
    await app.listen(3656, "127.0.0.1"); prisma = app.get(PrismaService);
    await t.test("unannotated admin routes without local Guards reject 401/403 even for super; callbacks never run", async () => {
      const beforeReached = reached;
      for (const path of ["admin/af017-missing", "ADMIN/af017-array/class-exception"]) { await request(path, 401); for (const token of Object.values(tokens)) await request(path, 403, { token }); }
      assert.equal(reached, beforeReached);
    });
    await t.test("global adapter invokes existing Guard and merges class/handler permissions with AND over HTTP", async () => {
      await request("admin/af017-probe/missing", 200, { token: tokens.reader }); await request("admin/af017-probe/missing", 403, { token: tokens.denied });
      secondPermission = await prisma.sysPermission.create({ data: { permissionCode: "af017.second.read", permissionName: "AF017 synthetic", resourceType: "data", module: "af017", action: "read" } });
      await request("admin/af017-probe/and", 403, { token: tokens.reader });
      secondRole = await prisma.sysRole.create({ data: { roleCode: "af017_second", roleName: "AF017 synthetic" } });
      await prisma.sysUserRole.create({ data: { userId: reader.id, roleId: secondRole.id } }); await prisma.sysRolePermission.create({ data: { roleId: secondRole.id, permissionId: secondPermission.id } });
      await request("admin/af017-probe/and", 200, { token: tokens.reader });
      await prisma.sysRolePermission.deleteMany({ where: { roleId: secondRole.id } });
      await request("admin/af017-probe/and", 403, { token: tokens.reader });
    });
    await t.test("corrupt/unknown requirements and auth-only exceptions cannot bypass class constraints", async () => {
      const beforeReached = reached;
      for (const path of ["corrupt", "conflict", "unknown"]) for (const token of [tokens.admin, tokens.reader]) await request("admin/af017-probe/" + path, 403, { token });
      assert.equal(reached, beforeReached);
    });
    await t.test("super cannot bypass absent definitions; active known AND definitions can bypass role joins", async () => {
      await request("admin/af017-probe/and", 200, { token: tokens.admin });
      await prisma.sysUser.update({ where: { id: admin.id }, data: { isSuperAdmin: false } });
      try { await request("admin/af017-probe/and", 403, { token: tokens.admin }); }
      finally { await prisma.sysUser.update({ where: { id: admin.id }, data: { isSuperAdmin: true } }); }
    });
    await t.test("denial evidence is sanitized; no source edits and actual app.close leaves zero pool", async () => {
      const rows = await prisma.auditLog.findMany({ where: { module: "rbac" } }); assert.ok(rows.length >= 10);
      assert.ok(rows.every(row => row.action === "permission_denied" && row.requestSummary.correlationId === "af017-http"));
      for (const secret of secrets) assert.ok(!JSON.stringify(rows).includes(secret));
      assert.ok(!/\$2[aby]\$\d\d\$/.test(JSON.stringify(rows))); assert.deepEqual(paths.map(hash), before);
      await app.close(); app = undefined; assert.deepEqual(await applicationSessions(lease.id, "AF-017"), []);
      writeFileSync(join(root, "result.json"), JSON.stringify({ task: "AF-017", database: lease.database, acceptanceId: lease.id, evidence, denials: rows.length, passwordsAndTokensAbsent: true, sourceFilesUnchanged: true, productionProbeEndpoints: false, pools: 0 }, null, 2) + "\n");
    });
  } finally {
    if (app) await app.close(); await setTaskDatabaseConnections(lease.id, true, "AF-017");
    for (const key of Object.keys(process.env)) delete process.env[key]; Object.assign(process.env, original);
  }
});
