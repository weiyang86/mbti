import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";
import { createAcceptance, migrate } from "../database/migration.mjs";
import { readDatabaseEnvironment, repositoryRoot, withDatabase } from "../database/connection.mjs";
import { assertPortAvailable } from "../port-availability.mjs";
import { applicationSessions } from "./readiness-support.mjs";
import { authEnvironment, authKeys } from "./auth-support.mjs";
import { prepareRbacFixture } from "./rbac-fixture.mjs";
import { seedArguments, seedDatabase } from "../database/seed.mjs";

test("AF-020 actual menu HTTP/DB hierarchy, permissions, page/plugin availability and atomic audit", { timeout: 55000 }, async t => {
  await assertPortAvailable(3656);
  const parent = join(repositoryRoot, ".artifacts/af-020/http"); mkdirSync(parent, { recursive: true }); const directory = mkdtempSync(join(parent, "run-"));
  const lease = await createAcceptance("test", "AF-020"); await migrate({ mode: "test", action: "deploy", acceptanceId: lease.id });
  const fixture = await prepareRbacFixture(lease.id, "AF-020"), initial = JSON.parse(readFileSync(fixture.initialPasswordFile));
  const accounts = JSON.parse(readFileSync(fixture.accounts[0].initialPasswordFile)).accounts, keys = authKeys(lease.id, "AF-020"), original = { ...process.env };
  const secrets = [initial.password, ...accounts.map(a => a.password), keys.secret], tokens = {}, events = [];
  const files = ["apps/api/src/menus/menus.service.ts", "apps/api/src/menus/menus.controller.ts", "apps/api/src/menus/menu.dto.ts", "apps/api/src/rbac/permissions.service.ts", "apps/api/prisma/schema.prisma", "apps/api/prisma/migrations/20261019000000_initial/migration.sql"];
  const hash = p => createHash("sha256").update(readFileSync(p)).digest("hex"), hashes = files.map(hash);
  const environment = authEnvironment(lease.id, keys.secret, "AF-020");
  for (const key of Object.keys(process.env)) delete process.env[key]; Object.assign(process.env, environment);
  const require = createRequire(join(repositoryRoot, "apps/api/package.json"));
  const { createApplication } = require(join(repositoryRoot, "apps/api/dist/bootstrap.js")), { PrismaService } = require(join(repositoryRoot, "apps/api/dist/prisma/prisma.service.js"));
  const { MenuAvailabilityService } = require(join(repositoryRoot, "apps/api/dist/menus/menu-availability.service.js"));
  let app, prisma, folder, page, readerRole, root, userPermission, bootstrap;
  const save = (name, value) => writeFileSync(join(directory, name + ".json"), JSON.stringify(value, null, 2) + "\n");
  const query = operation => withDatabase("test", readDatabaseEnvironment("test", process.env, lease.id), operation, { acceptanceId: lease.id });
  async function request(path, expected, { token = tokens.root, method = "GET", body } = {}) {
    const response = await fetch("http://127.0.0.1:3656/api/" + path, { method, headers: { "x-correlation-id": "af020-http", ...(token ? { authorization: "Bearer " + token } : {}), ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10000) });
    assert.equal(response.status, expected, method + " " + path); const value = await response.json();
    if (value.data?.accessToken) secrets.push(value.data.accessToken);
    for (const secret of secrets.filter(s => s !== value.data?.accessToken)) assert.ok(!JSON.stringify(value).includes(secret));
    assert.ok(!/passwordHash|password_hash|\$2[aby]\$\d\d\$/.test(JSON.stringify(value)));
    if (path.startsWith("admin/")) assert.equal(response.headers.get("cache-control"), "no-store");
    events.push({ path, method, status: response.status }); return value.data;
  }
  const login = async a => (await request("auth/login", 200, { method: "POST", body: { username: a.username, password: a.password } })).accessToken;
  const create = (body, status = 201, token = tokens.root) => request("admin/menus", status, { method: "POST", body, token });
  const patch = (id, body, status = 200, token = tokens.root) => request("admin/menus/" + id, status, { method: "PATCH", body, token });
  const mine = token => request("admin/menus/my", 200, { token });
  const audits = () => prisma.auditLog.findMany({ where: { module: "menus" } });
  const grant = ids => request("admin/roles/" + readerRole.id + "/permissions", 200, { method: "PUT", body: { permissionIds: ids } });
  try {
    app = await createApplication(); await app.listen(3656, "127.0.0.1"); prisma = app.get(PrismaService);
    await t.test("explicit menu Seed only registers immutable backend definition, never reconciles grants or menus", async () => {
      assert.deepEqual(seedArguments(["test", "--menus"]), { mode: "test", acceptanceId: undefined, generateCredentials: false, menuManagement: true });
      assert.throws(() => seedArguments(["test", "--menus", "--menus"]));
      tokens.root = await login(initial); tokens.manager = await login(accounts[0]); tokens.reader = await login(accounts[1]);
      root = await prisma.sysUser.findUniqueOrThrow({ where: { username: initial.username } });
      readerRole = await prisma.sysRole.findUniqueOrThrow({ where: { roleCode: "af020_reader" } });
      userPermission = await prisma.sysPermission.findUniqueOrThrow({ where: { permissionCode: "admin.user.manage" } }); bootstrap = await prisma.sysPermission.findUniqueOrThrow({ where: { permissionCode: "aij.bootstrap.admin" } });
      const definition = await prisma.sysPermission.findUniqueOrThrow({ where: { permissionCode: "admin.menu.manage" } });
      const before = await prisma.sysRolePermission.count(); await prisma.sysPermission.update({ where: { id: definition.id }, data: { status: "disabled" } });
      try { const result = await seedDatabase({ mode: "test", acceptanceId: lease.id, generateCredentials: true, menuManagement: true }); assert.equal(result.menuManagement.grantsReconciled, false); assert.equal((await prisma.sysPermission.findUniqueOrThrow({ where: { id: definition.id } })).status, "disabled"); }
      finally { await prisma.sysPermission.update({ where: { id: definition.id }, data: { status: "active" } }); }
      assert.equal(await prisma.sysRolePermission.count(), before); assert.equal(await prisma.sysMenu.count(), 0);
    });
    await t.test("real pages catalog, strict hierarchy CRUD and stable sibling sort are served by exported module", async () => {
      assert.deepEqual(await request("admin/menus/pages", 200), [{ path: "/", pluginCode: null, available: true }]);
      folder = (await create({ title: "AF020 group", path: "/system", type: "directory", sortOrder: 5 })).id;
      page = (await create({ title: "AF020 foundation", path: "/", parentId: folder, permissionCode: "admin.user.manage", sortOrder: 3 }, 201, tokens.manager)).id;
      const early = (await create({ title: "AF020 early", path: "/early", type: "directory", sortOrder: -1 })).id;
      const tree = await request("admin/menus", 200); assert.deepEqual(tree.map(r => r.id), [early, folder]); assert.equal(tree[1].children[0].id, page);
      await patch(early, { sortOrder: 10, title: "AF020 reordered" }); assert.deepEqual((await request("admin/menus", 200)).map(r => r.id), [folder, early]);
      await request("admin/menus/" + early, 200, { method: "DELETE" }); assert.ok((await prisma.sysMenu.findUniqueOrThrow({ where: { id: early } })).deletedAt);
      await create({ title: "reserved", path: "/early", type: "directory" }, 409);
      save("hierarchy", { group: folder, page, catalog: ["/"], sortAndSoftDelete: true });
    });
    await t.test("every management entry rejects 401/403, own tree authenticates and ignores client claims", async () => {
      for (const [path, method, body] of [["admin/menus", "GET"], ["admin/menus/pages", "GET"], ["admin/menus", "POST", { title: "no", path: "/no", type: "directory" }], ["admin/menus/" + page, "PATCH", { title: "no" }], ["admin/menus/" + page, "DELETE"]]) {
        await request(path, 401, { method, body, token: null }); await request(path, 403, { method, body, token: tokens.reader });
      }
      await request("admin/menus/my", 401, { token: null }); assert.deepEqual(await mine(tokens.reader), []);
      assert.deepEqual(await request("admin/menus/my?permission=*&workspaceId=owner&isSuperAdmin=true", 200, { token: tokens.reader }), []);
      assert.equal((await prisma.sysMenu.findUniqueOrThrow({ where: { id: page } })).title, "AF020 foundation");
    });
    await t.test("same JWT grant/revoke and role status immediately filter menu and API guard independently", async () => {
      await grant([bootstrap.id, userPermission.id]); const visible = await mine(tokens.reader); assert.equal(visible[0].path, null); assert.equal(visible[0].children[0].id, page); await request("admin/users", 200, { token: tokens.reader });
      await grant([bootstrap.id]); assert.deepEqual(await mine(tokens.reader), []); await request("admin/users", 403, { token: tokens.reader });
      await patch(page, { permissionCode: "aij.bootstrap.admin" }); assert.equal((await mine(tokens.reader))[0].children[0].id, page); await request("admin/users", 403, { token: tokens.reader });
      await request("admin/roles/" + readerRole.id + "/status", 200, { method: "PATCH", body: { enabled: false } }); assert.deepEqual(await mine(tokens.reader), []);
      await request("admin/roles/" + readerRole.id + "/status", 200, { method: "PATCH", body: { enabled: true } }); assert.equal((await mine(tokens.reader))[0].children[0].id, page);
      await grant([]); assert.deepEqual(await mine(tokens.reader), []); await grant([bootstrap.id]);
      save("permissions", { ungranted: [], sameJwtGrant: 200, revokedApi: 403, menuIsNotApiGrant: true, noPermissionTree: [], disabledRoleTree: [] });
    });
    await t.test("strict DTO, illegal/external/encoded routes and unknown permissions fail without mutation", async () => {
      const count = await prisma.sysMenu.count(), before = (await audits()).length;
      for (const path of ["https://example.invalid", "//example.invalid", "javascript:alert(1)", "/../admin", "/%2e%2e", "/a?x=1", "/a#b", "/a\\b", "/a//b", "/a/"]) await create({ title: "bad", path, type: "directory" }, 400);
      for (const body of [{}, { title: "bad" }, { title: "bad", path: "/bad", permissionCode: "unknown.permission" }, { title: "bad", path: "/bad", type: "directory", permissionCode: "aij.bootstrap.admin" }, { title: "bad", path: "/bad", type: "directory", sortOrder: "2" }, { title: "bad", path: "/bad", type: "directory", workspaceId: "owner" }]) await create(body, 400);
      await patch(page, {}, 400); await patch(page, { path: null }, 400); await patch(page, { permissionCode: null }, 400);
      assert.equal(await prisma.sysMenu.count(), count); assert.equal((await audits()).length, before);
    });
    await t.test("unimplemented active pages are refused; disabled drafts can be stored but cannot be enabled", async () => {
      for (const path of ["/auth/admin-users", "/auth/roles", "/auth/menus", "/login", "/plugins/aij-ai"]) await create({ title: "future", path, permissionCode: "aij.bootstrap.admin" }, 400);
      const draft = (await create({ title: "future", path: "/auth/admin-users", permissionCode: "aij.bootstrap.admin", status: "disabled" })).id;
      await patch(draft, { status: "active" }, 400); assert.equal((await prisma.sysMenu.findUniqueOrThrow({ where: { id: draft } })).status, "disabled");
      assert.ok(!JSON.stringify(await mine(tokens.root)).includes(draft));
      save("available-pages", { actual: ["/"], absentEnabledPaths: 400, draftPersistedDisabled: true });
    });
    await t.test("self/ancestor cycles and invalid parents are rejected and concurrent cycles cannot commit", async () => {
      const child = (await create({ title: "nested", path: "/system/nested", type: "directory", parentId: folder })).id;
      await patch(folder, { parentId: folder }, 400); await patch(folder, { parentId: child }, 400);
      await patch(folder, { parentId: page }, 400); await patch(folder, { parentId: "nonexistent" }, 404);
      const a = (await create({ title: "a", path: "/a", type: "directory" })).id, b = (await create({ title: "b", path: "/b", type: "directory" })).id;
      const attempts = await Promise.all([[a, b], [b, a]].map(async ([id, parentId]) => {
        const r = await fetch("http://127.0.0.1:3656/api/admin/menus/" + id, { method: "PATCH", headers: { authorization: "Bearer " + tokens.root, "content-type": "application/json" }, body: JSON.stringify({ parentId }) }); return r.status;
      })); assert.deepEqual(attempts.sort(), [200, 400]);
      const rows = await prisma.sysMenu.findMany({ where: { id: { in: [a, b] } } }); assert.equal(rows.filter(r => r.parentId === null).length, 1);
      await request("admin/menus/" + folder, 409, { method: "DELETE" });
      save("cycles", { self: 400, ancestor: 400, leafParent: 400, missingParent: 404, concurrent: attempts, parentDelete: 409 });
    });
    await t.test("visibility/status ancestors suppress descendants; unavailable plugin contract fails closed", async () => {
      await patch(folder, { visible: false }); assert.deepEqual(await mine(tokens.reader), []); await patch(folder, { visible: true });
      await patch(folder, { status: "disabled" }); assert.deepEqual(await mine(tokens.reader), []); await patch(folder, { status: "active" });
      await prisma.sysPermission.update({ where: { id: bootstrap.id }, data: { status: "disabled" } });
      try { assert.deepEqual(await mine(tokens.reader), []); } finally { await prisma.sysPermission.update({ where: { id: bootstrap.id }, data: { status: "active" } }); }
      const availability = app.get(MenuAvailabilityService); assert.equal(availability.pluginEnabled("aij-ai"), false); assert.equal(availability.pageAvailable("/plugins/aij-ai", "aij-ai"), false);
      await patch(page, { pluginCode: "aij-ai" }, 400);
      await prisma.sysMenu.update({ where: { id: page }, data: { pluginCode: "aij-ai" } });
      try { assert.deepEqual(await mine(tokens.root), []); assert.deepEqual(await mine(tokens.reader), []); } finally { await prisma.sysMenu.update({ where: { id: page }, data: { pluginCode: null } }); }
      const { ConfigService } = require("@nestjs/config"); const contract = new MenuAvailabilityService(new ConfigService({ enabledPlugins: ["synthetic-plugin"] }));
      assert.equal(contract.pluginEnabled("synthetic-plugin"), true); assert.equal(contract.pageAvailable("/unregistered", "synthetic-plugin"), false);
      save("plugin-contract", { actualInstalledPlugins: [], missingOrDisabledPluginHidden: true, pluginEnabledAloneInsufficientWithoutRegisteredPage: true, lifecycleNotImplemented: true });
    });
    await t.test("menu writes recheck authorization after the actual advisory lock wait", async () => {
      const manager = await prisma.sysUser.findUniqueOrThrow({ where: { username: accounts[0].username } }); const managerRole = await prisma.sysRole.findUniqueOrThrow({ where: { roleCode: "af020_manager" } });
      const permission = await prisma.sysPermission.findUniqueOrThrow({ where: { permissionCode: "admin.menu.manage" } });
      let pending, removed = false;
      try {
        await query(async c => {
          await c.query("BEGIN"); let committed = false;
          try {
            await c.query("SELECT pg_advisory_xact_lock(hashtext('aij-admin-users-write'))"); pending = patch(page, { title: "must not write" }, 403, tokens.manager).catch(e => e);
            let blocked = false; const end = Date.now() + 2000;
            while (Date.now() < end) { blocked = (await c.query("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND application_name LIKE 'aij-api:%' AND wait_event_type='Lock' AND wait_event='advisory') AS blocked")).rows[0].blocked; if (blocked) break; await new Promise(r => setTimeout(r, 25)); }
            assert.ok(blocked); await c.query("DELETE FROM public.sys_role_permission WHERE role_id=$1 AND permission_id=$2", [managerRole.id, permission.id]); removed = true;
            await c.query("COMMIT"); committed = true;
          } finally { if (!committed) await c.query("ROLLBACK"); }
        });
        assert.ok(!(await pending instanceof Error)); assert.equal((await prisma.sysMenu.findUniqueOrThrow({ where: { id: page } })).title, "AF020 foundation"); assert.ok(manager.id);
      } finally { if (pending) await pending; if (removed) await prisma.sysRolePermission.create({ data: { roleId: managerRole.id, permissionId: permission.id } }); }
    });
    await t.test("real audit failure rolls back menu create, edit and soft delete atomically", async () => {
      const previous = await prisma.sysMenu.findUniqueOrThrow({ where: { id: page } }), count = await prisma.sysMenu.count(), before = (await audits()).length;
      await query(async c => { await c.query("CREATE FUNCTION public.af020_reject_menu_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.module='menus' THEN RAISE EXCEPTION 'synthetic audit unavailable'; END IF; RETURN NEW; END $$"); await c.query("CREATE TRIGGER af020_reject_menu_audit BEFORE INSERT ON public.audit_log FOR EACH ROW EXECUTE FUNCTION public.af020_reject_menu_audit()"); });
      try { await create({ title: "rollback", path: "/rollback", type: "directory" }, 503); await patch(page, { visible: false }, 503); await request("admin/menus/" + page, 503, { method: "DELETE" }); assert.deepEqual(await prisma.sysMenu.findUniqueOrThrow({ where: { id: page } }), previous); assert.equal(await prisma.sysMenu.count(), count); assert.equal((await audits()).length, before); }
      finally { await query(async c => { await c.query("DROP TRIGGER af020_reject_menu_audit ON public.audit_log"); await c.query("DROP FUNCTION public.af020_reject_menu_audit()"); }); }
      save("audit-rollback", { createEditDelete: 503, previousRowsAndAuditsPreserved: true, ownTriggerRemoved: true });
    });
    await t.test("soft delete hides menu without deleting users/role-menu history and safe audits are traceable", async () => {
      await prisma.sysRoleMenu.create({ data: { roleId: readerRole.id, menuId: page } }); const users = await prisma.sysUser.count();
      await request("admin/menus/" + page, 200, { method: "DELETE" }); assert.deepEqual(await mine(tokens.reader), []);
      assert.equal(await prisma.sysRoleMenu.count({ where: { menuId: page } }), 1); assert.equal(await prisma.sysUser.count(), users);
      const rows = await audits(); assert.ok(rows.length >= 10); assert.ok(rows.some(a => a.action === "menu_created") && rows.some(a => a.action === "menu_updated") && rows.some(a => a.action === "menu_deleted"));
      assert.ok(rows.filter(a => a.requestSummary.correlationId === "af020-http").length >= 10); const manager = await prisma.sysUser.findUniqueOrThrow({ where: { username: accounts[0].username } }); assert.ok(rows.every(a => [root.id, manager.id].includes(a.userId)));
      for (const secret of secrets) assert.ok(!JSON.stringify(rows).includes(secret)); assert.ok(!/AF020 foundation|must not write|passwordHash|\$2[aby]\$/.test(JSON.stringify(rows)));
      save("audits", { rows: rows.map(a => ({ id: a.id, action: a.action, operatorId: a.userId, resourceId: a.resourceId, summary: a.requestSummary })), usersPreserved: true, historicalRoleMenuLinkPreserved: true });
    });
    await t.test("all source hashes remain unchanged and real application shutdown closes the pool", async () => {
      assert.deepEqual(files.map(hash), hashes); await app.close(); app = undefined; assert.deepEqual(await applicationSessions(lease.id, "AF-020"), []);
      save("result", { task: "AF-020", database: lease.database, acceptanceId: lease.id, events, sourceFilesUnchanged: true, pool: 0, noAiModule: true });
    });
  } finally { if (app) await app.close(); for (const key of Object.keys(process.env)) delete process.env[key]; Object.assign(process.env, original); }
});
