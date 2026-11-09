import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";
import { createAcceptance, migrate } from "../database/migration.mjs";
import { seedDatabase } from "../database/seed.mjs";
import { repositoryRoot, profile, readDatabaseEnvironment, withDatabase } from "../database/connection.mjs";
import { assertPortAvailable } from "../port-availability.mjs";
import { applicationSessions, setTaskDatabaseConnections } from "./readiness-support.mjs";
import { authEnvironment, authKeys } from "./auth-support.mjs";
import { prepareRbacFixture } from "./rbac-fixture.mjs";

test("real role and permission management preserves authorization ownership and atomic changes", { timeout: 55000 }, async t => {
  await assertPortAvailable(3656); const parent = join(repositoryRoot, ".artifacts/af-016/http"); mkdirSync(parent, { recursive: true }); const dir = mkdtempSync(join(parent, "run-"));
  const save = (name, value) => writeFileSync(join(dir, name + ".json"), JSON.stringify(value, null, 2) + "\n");
  const paths = ["apps/api/prisma/schema.prisma", "apps/api/prisma/migrations/20261019000000_initial/migration.sql", "apps/api/src/admin/admin-users.service.ts", "apps/api/src/rbac/permissions.service.ts", "apps/api/src/rbac/management.service.ts", "apps/api/src/rbac/management-access.service.ts", ...["dev", "test"].flatMap(mode => [profile(mode).secretFile, profile(mode).stateFile])];
  const hash = path => createHash("sha256").update(readFileSync(path)).digest("hex"), before = paths.map(hash), original = { ...process.env };
  const lease = await createAcceptance("test", "AF-016"); await migrate({ mode: "test", action: "deploy", acceptanceId: lease.id });
  const seeded = await seedDatabase({ mode: "test", acceptanceId: lease.id, generateCredentials: true }), initial = JSON.parse(readFileSync(seeded.credentials.file)), keys = authKeys(lease.id, "AF-016");
  const secrets = [initial.password, keys.secret, ...["dev", "test"].map(mode => readFileSync(profile(mode).secretFile, "utf8").trim())];
  const environment = authEnvironment(lease.id, keys.secret, "AF-016"); for (const key of Object.keys(process.env)) delete process.env[key]; Object.assign(process.env, environment);
  const require = createRequire(join(repositoryRoot, "apps/api/package.json")), { JwtService } = require("@nestjs/jwt"), { Prisma } = require("@prisma/client");
  const { createApplication } = require(join(repositoryRoot, "apps/api/dist/bootstrap.js")), { PrismaService } = require(join(repositoryRoot, "apps/api/dist/prisma/prisma.service.js"));
  let app, prisma, fixture, accounts, manager, role, permission, user, userToken, collision; const tokens = {};
  async function request(path, expected, { method = "GET", token, body, raw } = {}) {
    const r = await fetch("http://127.0.0.1:3656/api/" + path, { method, headers: { "x-correlation-id": "af016-real-http", ...(token ? { authorization: "Bearer " + token } : {}), ...(body !== undefined || raw !== undefined ? { "content-type": "application/json" } : {}) }, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)), signal: AbortSignal.timeout(8000) });
    assert.ok((Array.isArray(expected) ? expected : [expected]).includes(r.status), `${method} ${path.split("?")[0]} expected ${expected}, got ${r.status}`); assert.equal(r.headers.get("x-correlation-id"), "af016-real-http");
    const result = await r.json(); if (result.data?.accessToken) secrets.push(result.data.accessToken);
    for (const secret of secrets.filter(v => v !== result.data?.accessToken)) assert.ok(!JSON.stringify(result).includes(secret), "No credential in response"); assert.ok(!/\$2[aby]\$\d\d\$/.test(JSON.stringify(result)));
    if (path.startsWith("admin/") && r.status !== 404) assert.equal(r.headers.get("cache-control"), "no-store"); return { status: r.status, data: result.data };
  }
  const login = async a => (await request("auth/login", 200, { method: "POST", body: { username: a.username, password: a.password } })).data.accessToken;
  const write = (path, body, status = 200, token = tokens.root, method = "PATCH") => request(path, status, { method, token, body });
  const bind = ids => write("admin/roles/" + role + "/permissions", { permissionIds: ids }, 200, tokens.root, "PUT");
  function seedCommand(id, flags, expected = 0) {
    const command = ["pnpm", "run", "db:seed", "--", "test", "--acceptance", id, ...flags], r = spawnSync(command[0], command.slice(1), { cwd: repositoryRoot, encoding: "utf8", timeout: 15000, env: { PATH: original.PATH, HOME: original.HOME, NODE_ENV: "test" } });
    assert.equal(r.status, expected); for (const secret of secrets) assert.ok(!(r.stdout + r.stderr).includes(secret)); save("seed-" + id + "-" + Date.now(), { command, exitCode: r.status, stdout: r.stdout, stderr: r.stderr }); return JSON.parse((expected ? r.stderr : r.stdout).split("\n").find(line => line.startsWith("{")));
  }
  try {
    app = await createApplication(); await app.listen(3656, "127.0.0.1"); prisma = app.get(PrismaService);
    await t.test("new management routes fail closed until definitions are explicitly registered", async () => {
      tokens.root = await login(initial); await request("admin/roles", 403, { token: tokens.root }); await request("admin/permissions/manage", 403, { token: tokens.root });
      assert.equal(await prisma.sysPermission.count(), 1); const registered = seedCommand(lease.id, ["--admin-users", "--rbac-management"]); assert.equal(registered.rbacManagement.length, 2); assert.ok(registered.rbacManagement.every(p => p.created && !p.grantsReconciled)); assert.equal(await prisma.sysPermission.count(), 4);
      fixture = await prepareRbacFixture(lease.id, "AF-016"); accounts = JSON.parse(readFileSync(fixture.accounts[0].initialPasswordFile)).accounts; secrets.push(...accounts.map(a => a.password));
      tokens.manager = await login(accounts[0]); tokens.reader = await login(accounts[1]); manager = await prisma.sysUser.findUniqueOrThrow({ where: { username: accounts[0].username } });
      await request("admin/permissions/my", 200, { token: tokens.manager }); await request("admin/permissions", 403, { token: tokens.manager }); await request("admin/permissions", 200, { token: tokens.reader });
      save("fixture", { acceptanceId: lease.id, database: lease.database, initialPasswordFile: seeded.credentials.file, accountsFile: fixture.accounts[0].initialPasswordFile, definitions: 4, legacyCatalogPreserved: true });
    });
    await t.test("all thirteen management routes reject missing identity and a bootstrap-only reader", async () => {
      const routes = [["roles", "GET"], ["roles/missing", "GET"], ["roles", "POST", { roleCode: "af016_denied", roleName: "AF016" }], ["roles/missing", "PATCH", { roleName: "AF016" }], ["roles/missing/status", "PATCH", { enabled: false }], ["roles/missing/permissions", "PUT", { permissionIds: [] }], ["roles/missing", "DELETE"], ["permissions/manage", "GET"], ["permissions/missing", "GET"], ["permissions", "POST", { permissionCode: "custom.denied", permissionName: "AF016", resourceType: "api", action: "read" }], ["permissions/missing", "PATCH", { permissionName: "AF016" }], ["permissions/missing/status", "PATCH", { enabled: false }], ["permissions/missing", "DELETE"]];
      for (const [path, method, body] of routes) { await request("admin/" + path, 401, { method, body }); await request("admin/" + path, 403, { method, body, token: tokens.reader }); }
      assert.equal(await prisma.sysRole.count({ where: { roleCode: "af016_denied" } }), 0); assert.equal(await prisma.sysPermission.count({ where: { permissionCode: "custom.denied" } }), 0); save("guards", { routes: routes.length, noIdentity: 401, noPermission: 403, deniedWrites: 0 });
    });
    await t.test("delegated manager creates reads updates and disables an empty unassigned role", async () => {
      role = (await write("admin/roles", { roleCode: "af016_synthetic", roleName: "AF016 合成角色", remark: "synthetic" }, 201, tokens.manager, "POST")).data.id;
      await write("admin/roles/" + role, { roleName: "AF016 updated", remark: null }, 200, tokens.manager); const detail = (await request("admin/roles/" + role, 200, { token: tokens.manager })).data; assert.equal(detail.roleName, "AF016 updated"); assert.equal(detail.remark, null); assert.deepEqual(detail.permissionIds, []);
      await write("admin/roles/" + role + "/status", { enabled: false }, 200, tokens.manager); assert.equal((await prisma.sysRole.findUniqueOrThrow({ where: { id: role } })).status, "disabled"); await write("admin/roles/" + role + "/status", { enabled: true }, 200, tokens.manager); save("role-crud", { id: role, detail, statuses: [201, 200, 200] });
    });
    await t.test("delegated permission CRUD stays in custom namespace and never creates an implicit HTTP grant", async () => {
      permission = (await write("admin/permissions", { permissionCode: "custom.af016.read", permissionName: "AF016 permission", resourceType: "api", action: "read", apiPath: "/api/admin/users" }, 201, tokens.manager, "POST")).data.id;
      await write("admin/permissions/" + permission, { permissionName: "AF016 renamed", apiPath: null }, 200, tokens.manager); const detail = (await request("admin/permissions/" + permission, 200, { token: tokens.manager })).data; assert.equal(detail.module, "custom"); assert.equal(detail.apiPath, null); assert.equal(detail.permissionName, "AF016 renamed");
      await request("admin/users", 403, { token: tokens.manager }); save("permission-crud", { id: permission, detail, implicitRouteGrant: false });
    });
    await t.test("pagination filters and strict DTOs reject unknown immutable namespace status and malformed fields", async () => {
      assert.equal((await request("admin/roles?q=af016_synthetic&pageSize=1", 200, { token: tokens.manager })).data.total, 1); assert.equal((await request("admin/permissions/manage?q=custom.af016&pageSize=1", 200, { token: tokens.manager })).data.total, 1);
      for (const path of ["roles", "permissions/manage"]) for (const query of ["page=0", "pageSize=101", "status=enabled", "unknown=1", "page=bad"]) await request("admin/" + path + "?" + query, 400, { token: tokens.root });
      for (const body of [{}, { roleName: null }, { roleCode: "rename" }, { dataScope: "all" }, { permissionIds: [] }, { status: "active" }]) await write("admin/roles/" + role, body, 400);
      for (const roleCode of ["super_admin", "aij_bootstrap_admin", "bad.code", ""]) await write("admin/roles", { roleCode, roleName: "AF016" }, 400, tokens.root, "POST");
      for (const body of [{}, { permissionName: null }, { module: "core" }, { permissionCode: "admin.user.manage" }, { action: "write" }, { resourceType: "data" }, { apiPath: "https://example.invalid" }]) await write("admin/permissions/" + permission, body, 400);
      for (const extra of [{ permissionCode: "admin.role.manage" }, { module: "core" }, { resourceType: "other" }, { status: "active" }, { apiPath: "/api/users?password=not-a-secret" }]) await write("admin/permissions", { permissionCode: "custom.invalid", permissionName: "AF016", action: "read", resourceType: "api", ...extra }, 400, tokens.root, "POST");
      await write("admin/roles/" + role + "/status", { enabled: "false" }, 400); await write("admin/permissions/" + permission + "/status", { enabled: "false" }, 400);
      await request("admin/roles", 400, { method: "POST", token: tokens.root, raw: '{"password":"' + initial.password + '" invalid-json' }); await request("admin/roles/bad.id", 400, { token: tokens.root }); await request("admin/roles/missing", 404, { token: tokens.root }); await request("admin/permissions/missing", 404, { token: tokens.root }); save("dto", { strict: true, malformedInputEchoed: false, invalidStatus: 400 });
    });
    await t.test("only current DB super administrator can grant permissions, never a forged JWT privilege claim", async () => {
      await write("admin/roles/" + role + "/permissions", { permissionIds: [permission] }, 403, tokens.manager, "PUT");
      const forged = await new JwtService().signAsync({ sub: manager.id, tokenKind: "admin", projectId: "aij-foundation", environment: "test", isSuperAdmin: true, permissions: ["*"] }, { secret: keys.secret, issuer: "urn:aij:aij-foundation:test:api", audience: "urn:aij:aij-foundation:test:admin", algorithm: "HS256", expiresIn: 900 }); secrets.push(forged);
      await write("admin/roles/" + role + "/permissions", { permissionIds: [permission] }, 403, forged, "PUT");
      const wrong = await new JwtService().signAsync({ sub: manager.id }, { secret: keys.secret, issuer: "qingqi-api", expiresIn: 900 }); secrets.push(wrong); await request("admin/roles", 401, { token: wrong }); assert.equal(await prisma.sysRolePermission.count({ where: { roleId: role } }), 0); save("non-escalation", { ordinaryGrant: 403, forgedSuper: 403, wrongIssuer: 401 });
    });
    await t.test("permission assignment replaces links atomically and invalid selections preserve old links", async () => {
      await bind([permission]); const before = await prisma.sysRolePermission.findMany({ where: { roleId: role } });
      for (const ids of [null, [permission, permission], [123], ["unknown"], Array.from({ length: 101 }, (_, i) => "id" + i)]) await write("admin/roles/" + role + "/permissions", { permissionIds: ids }, 400, tokens.root, "PUT");
      await write("admin/permissions/" + permission + "/status", { enabled: false }); await write("admin/roles/" + role + "/permissions", { permissionIds: [permission] }, 400, tokens.root, "PUT"); await write("admin/permissions/" + permission + "/status", { enabled: true });
      assert.deepEqual(await prisma.sysRolePermission.findMany({ where: { roleId: role } }), before); await write("admin/roles/missing/permissions", { permissionIds: [] }, 404, tokens.root, "PUT"); save("atomic-selection", { previousLinksRetained: true, invalid: 400 });
    });
    await t.test("actual role binding revocation and status changes take effect for the same user JWT", async () => {
      const adminPermission = await prisma.sysPermission.findUniqueOrThrow({ where: { permissionCode: "admin.user.manage" } }); await bind([permission, adminPermission.id]);
      user = (await write("admin/users", { username: "af016-subject", realName: "AF016 subject", password: accounts[0].password, roleIds: [role] }, 201, tokens.root, "POST")).data.id; userToken = await login({ username: "af016-subject", password: accounts[0].password }); await request("admin/users", 200, { token: userToken });
      await write("admin/roles/" + role + "/status", { enabled: false }); await request("admin/users", 403, { token: userToken }); await write("admin/roles/" + role + "/status", { enabled: true }); await request("admin/users", 200, { token: userToken });
      await write("admin/permissions/" + permission + "/status", { enabled: false }); assert.ok(!(await request("admin/permissions/my", 200, { token: userToken })).data.permissions.includes("custom.af016.read")); await write("admin/permissions/" + permission + "/status", { enabled: true }); assert.ok((await request("admin/permissions/my", 200, { token: userToken })).data.permissions.includes("custom.af016.read"));
      await bind([]); await request("admin/users", 403, { token: userToken }); await bind([permission, adminPermission.id]); save("same-jwt", { user, granted: 200, roleDisabled: 403, reenabled: 200, removedGrants: 403, permissionStatusEffective: true });
    });
    await t.test("delegated managers cannot mutate assigned or privileged roles; code-owned roles and permissions are immutable", async () => {
      for (const [path, body, method] of [["roles/" + role, { roleName: "denied" }, "PATCH"], ["roles/" + role + "/status", { enabled: false }, "PATCH"], ["roles/" + role, undefined, "DELETE"]]) await write("admin/" + path, body, 403, tokens.manager, method);
      const bootstrap = await prisma.sysRole.findUniqueOrThrow({ where: { roleCode: "aij_bootstrap_admin" } }); for (const [method, suffix, body] of [["PATCH", "", { roleName: "denied" }], ["PATCH", "/status", { enabled: false }], ["PUT", "/permissions", { permissionIds: [] }], ["DELETE", "", undefined]]) await write("admin/roles/" + bootstrap.id + suffix, body, 409, tokens.root, method);
      const core = await prisma.sysPermission.findMany({ where: { module: "core" } }); assert.equal(core.length, 4); for (const p of core) { await write("admin/permissions/" + p.id, { permissionName: "denied" }, 409); await write("admin/permissions/" + p.id + "/status", { enabled: false }, 409); await write("admin/permissions/" + p.id, undefined, 409, tokens.root, "DELETE"); } save("protected-core", { immutableCoreDefinitions: core.length, codeOwnedRole: 409, assignedRoleOrdinaryMutation: 403 });
    });
    await t.test("referenced permissions cannot be hard deleted including string menu references", async () => {
      await write("admin/permissions/" + permission, undefined, 409, tokens.root, "DELETE");
      const p = (await write("admin/permissions", { permissionCode: "custom.af016.menu", permissionName: "AF016 menu probe", resourceType: "menu", action: "view" }, 201, tokens.manager, "POST")).data.id;
      const menu = await prisma.sysMenu.create({ data: { title: "AF016 synthetic reference", path: "/af016-synthetic-reference", permissionCode: "custom.af016.menu" } });
      try { await write("admin/permissions/" + p, undefined, 409, tokens.root, "DELETE"); } finally { await prisma.sysMenu.delete({ where: { id: menu.id } }); }
      await write("admin/permissions/" + p, undefined, 200, tokens.manager, "DELETE"); await request("admin/permissions/" + p, 404, { token: tokens.root }); save("references", { roleLink: 409, stringMenuReference: 409, unreferencedDelete: 200 });
    });
    await t.test("concurrent duplicate codes create one row and one success audit, never a partial duplicate", async () => {
      for (const [path, body, model, key] of [["roles", { roleCode: "af016_race", roleName: "AF016 race" }, "sysRole", "roleCode"], ["permissions", { permissionCode: "custom.af016.race", permissionName: "AF016 race", resourceType: "data", action: "read" }, "sysPermission", "permissionCode"]]) {
        const responses = await Promise.all([1, 2].map(() => write("admin/" + path, body, [201, 409], tokens.manager, "POST"))); assert.deepEqual(responses.map(r => r.status).sort(), [201, 409]); const rows = await prisma[model].findMany({ where: { [key]: body[key] } }); assert.equal(rows.length, 1); assert.equal(await prisma.auditLog.count({ where: { module: "rbac-management", resourceId: rows[0].id, action: path === "roles" ? "role_created" : "permission_created" } }), 1);
      } save("duplicates", { role: [201, 409], permission: [201, 409], rowsAndSuccessAudits: 1 });
    });
    await t.test("explicit management Seed repeat preserves disabled definitions revoked grants and credentials", async () => {
      const p = await prisma.sysPermission.findUniqueOrThrow({ where: { permissionCode: "admin.role.manage" } }), link = await prisma.sysRolePermission.findFirstOrThrow({ where: { permissionId: p.id, role: { roleCode: "af016_manager" } } });
      await prisma.sysPermission.update({ where: { id: p.id }, data: { status: "disabled" } }); await prisma.sysRolePermission.delete({ where: { id: link.id } }); const hashes = [seeded.credentials.file, fixture.accounts[0].initialPasswordFile].map(hash), users = JSON.stringify(await prisma.sysUser.findMany({ orderBy: { id: "asc" } }));
      try { const result = seedCommand(lease.id, ["--rbac-management"]); assert.ok(result.rbacManagement.every(p => !p.created && !p.grantsReconciled)); assert.equal((await prisma.sysPermission.findUniqueOrThrow({ where: { id: p.id } })).status, "disabled"); assert.equal(await prisma.sysRolePermission.count({ where: { id: link.id } }), 0); assert.ok(JSON.stringify(await prisma.sysUser.findMany({ orderBy: { id: "asc" } })) === users, "Existing identities/hashes preserved without printing snapshots"); assert.deepEqual([seeded.credentials.file, fixture.accounts[0].initialPasswordFile].map(hash), hashes); await request("admin/roles", 403, { token: tokens.root }); }
      finally { await prisma.sysPermission.update({ where: { id: p.id }, data: { status: "active" } }); await prisma.sysRolePermission.create({ data: link }); } save("seed-preserved", { disabled: true, revokedGrant: true, passwordsAndFiles: true });
    });
    await t.test("foreign second permission namespace rolls back the first definition and all initial data", async () => {
      collision = await createAcceptance("test", "AF-016"); await migrate({ mode: "test", action: "deploy", acceptanceId: collision.id }); const query = op => withDatabase("test", readDatabaseEnvironment("test", process.env, collision.id), op, { acceptanceId: collision.id });
      await query(c => c.query("INSERT INTO public.sys_permission (id,permission_code,permission_name,resource_type,module,action,updated_at) VALUES ('af016-foreign','admin.permission.manage','AF016 collision','data','foreign','read',CURRENT_TIMESTAMP)"));
      assert.equal(seedCommand(collision.id, ["--rbac-management", "--generate-credentials"], 2).code, "PERMISSION_NAMESPACE_OCCUPIED"); await query(async c => { for (const table of ["sys_user", "sys_role", "project_profile", "organization_profile"]) assert.equal((await c.query('SELECT count(*)::int AS n FROM public."' + table + '"')).rows[0].n, 0); assert.equal((await c.query("SELECT count(*)::int AS n FROM public.sys_permission")).rows[0].n, 1); }); assert.ok(!existsSync(join(repositoryRoot, ".local-data/seed/test", collision.database, "initial-admin.json"))); save("seed-rollback", { database: collision.database, firstDefinitionRolledBack: true, onlyForeignDefinition: 1, initialPasswordFile: false });
    });
    await t.test("current actor disabled through the accepted user API cannot continue RBAC writes", async () => {
      await write("admin/users/" + manager.id + "/status", { enabled: false }); try { await write("admin/roles", { roleCode: "af016_disabled_actor", roleName: "denied" }, 401, tokens.manager, "POST"); } finally { await write("admin/users/" + manager.id + "/status", { enabled: true }); } assert.equal(await prisma.sysRole.count({ where: { roleCode: "af016_disabled_actor" } }), 0); save("actor-state", { disabledOldJwt: 401, deniedRows: 0 });
    });
    await t.test("real own database outage rejects reads and writes while liveness survives then recovers", async () => {
      await prisma.$disconnect(); assert.deepEqual(await applicationSessions(lease.id, "AF-016"), []); await setTaskDatabaseConnections(lease.id, false, "AF-016");
      try { await request("admin/roles", 503, { token: tokens.root }); await write("admin/permissions/" + permission, { permissionName: "must-not-persist" }, 503); await request("health", 200); } finally { await setTaskDatabaseConnections(lease.id, true, "AF-016"); }
      await request("ready", 200); await request("admin/roles", 200, { token: tokens.root }); assert.equal((await prisma.sysPermission.findUniqueOrThrow({ where: { id: permission } })).permissionName, "AF016 renamed"); save("outage", { read: 503, write: 503, live: 200, recovered: 200 });
    });
    await t.test("role soft deletion revokes JWT grants clears permission links and preserves code and user links", async () => {
      await write("admin/roles/" + role, undefined, 200, tokens.root, "DELETE"); const row = await prisma.sysRole.findUniqueOrThrow({ where: { id: role } }); assert.equal(row.status, "disabled"); assert.ok(row.deletedAt); assert.equal(await prisma.sysRolePermission.count({ where: { roleId: role } }), 0); assert.equal(await prisma.sysUserRole.count({ where: { roleId: role, userId: user } }), 1);
      await request("admin/roles/" + role, 404, { token: tokens.root }); await request("admin/users", 403, { token: userToken }); await write("admin/roles", { roleCode: "af016_synthetic", roleName: "reused" }, 409, tokens.root, "POST"); await write("admin/permissions/" + permission, undefined, 200, tokens.manager, "DELETE"); await request("admin/permissions/" + permission, 404, { token: tokens.root }); save("deletion", { roleTombstone: true, codeReserved: 409, userLinksRetained: true, permissionLinksCleared: true, oldJwt: 403, unreferencedPermissionDeleted: true });
    });
    await t.test("all successful operations have minimal correlated audits without credentials or submitted values", async () => {
      const rows = await prisma.auditLog.findMany({ where: { module: "rbac-management" } }), actions = new Set(rows.map(r => r.action)); for (const a of ["role_created", "role_updated", "role_enabled", "role_disabled", "role_permissions_assigned", "role_deleted", "permission_created", "permission_updated", "permission_enabled", "permission_disabled", "permission_deleted"]) assert.ok(actions.has(a)); assert.ok(rows.every(r => r.status === "success" && r.requestSummary.correlationId === "af016-real-http"));
      for (const secret of secrets) assert.ok(!JSON.stringify(rows).includes(secret)); assert.ok(!JSON.stringify(rows).includes("AF016 renamed")); assert.ok(!/\$2[aby]\$\d\d\$/.test(JSON.stringify(rows)));
      for (const m of Prisma.dmmf.datamodel.models) if (!["SysUser", "SysRole", "SysPermission", "SysUserRole", "SysRolePermission", "OrganizationProfile", "ProjectProfile", "AuditLog"].includes(m.name)) assert.equal((await prisma.$queryRawUnsafe('SELECT count(*)::int AS n FROM public."' + m.dbName + '"'))[0].n, 0); save("audit", { count: rows.length, actions: [...actions].sort(), noValuesOrCredentials: true, unrelatedTablesEmpty: true });
    });
    await t.test("shutdown leaves zero pool and disabled Auth has no role or permission management", async () => {
      await app.close(); app = undefined; assert.deepEqual(await applicationSessions(lease.id, "AF-016"), []); process.env.AUTH_ENABLED = "false"; process.env.DATABASE_ENABLED = "false"; process.env.JWT_SECRET = "template"; app = await createApplication(); await app.listen(3656, "127.0.0.1"); await request("admin/roles", 404); await request("admin/permissions/manage", 404); await app.close(); app = undefined; assert.deepEqual(paths.map(hash), before);
      save("result", { task: "AF-016", database: lease.database, acceptanceId: lease.id, collisionDatabase: collision.database, poolAfterClose: 0, sourceAndProtectedFilesUnchanged: true });
    });
  } finally { if (app) await app.close(); await setTaskDatabaseConnections(lease.id, true, "AF-016"); for (const k of Object.keys(process.env)) delete process.env[k]; Object.assign(process.env, original); }
});
