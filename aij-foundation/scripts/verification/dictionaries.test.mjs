import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";
import { createAcceptance, migrate } from "../database/migration.mjs";
import { readDatabaseEnvironment, repositoryRoot, withDatabase } from "../database/connection.mjs";
import { assertPortAvailable } from "../port-availability.mjs";
import { applicationSessions, setTaskDatabaseConnections, waitReady } from "./readiness-support.mjs";
import { authEnvironment, authKeys } from "./auth-support.mjs";
import { prepareRbacFixture } from "./rbac-fixture.mjs";
import { seedArguments, seedDatabase } from "../database/seed.mjs";

test("AF-021 dictionaries use real migrations, HTTP, constraints, references and protected audit", { timeout: 55000 }, async t => {
  await assertPortAvailable(3656);
  const parent = join(repositoryRoot, ".artifacts/af-021/http"); mkdirSync(parent, { recursive: true }); const directory = mkdtempSync(join(parent, "run-"));
  const lease = await createAcceptance("test", "AF-021");
  await migrate({ mode: "test", action: "deploy", acceptanceId: lease.id });
  const fixture = await prepareRbacFixture(lease.id, "AF-021"), initial = JSON.parse(readFileSync(fixture.initialPasswordFile));
  const accounts = JSON.parse(readFileSync(fixture.accounts[0].initialPasswordFile)).accounts, keys = authKeys(lease.id, "AF-021"), original = { ...process.env };
  const secrets = [initial.password, ...accounts.map(a => a.password), keys.secret], tokens = {}, events = [];
  const files = ["apps/api/src/dictionaries/dictionaries.service.ts", "apps/api/src/dictionaries/dictionaries.controller.ts", "apps/api/src/common/guards/admin-authorization.guard.ts", "apps/api/prisma/schema.prisma", "apps/api/prisma/migrations/20261019000000_initial/migration.sql", "apps/api/prisma/migrations/20261019010000_dictionaries/migration.sql"];
  const hash = p => createHash("sha256").update(readFileSync(p)).digest("hex"), hashes = files.map(hash), environment = authEnvironment(lease.id, keys.secret, "AF-021");
  for (const key of Object.keys(process.env)) delete process.env[key]; Object.assign(process.env, environment);
  const require = createRequire(join(repositoryRoot, "apps/api/package.json"));
  const { createApplication } = require(join(repositoryRoot, "apps/api/dist/bootstrap.js")), { PrismaService } = require(join(repositoryRoot, "apps/api/dist/prisma/prisma.service.js"));
  let app, prisma, dict, first, second, third, managerRole, permission, bootstrap;
  const save = (name, value) => writeFileSync(join(directory, name + ".json"), JSON.stringify(value, null, 2) + "\n");
  const query = operation => withDatabase("test", readDatabaseEnvironment("test", process.env, lease.id), operation, { acceptanceId: lease.id });
  async function request(path, expected, { token = tokens.root, method = "GET", body } = {}) {
    const response = await fetch("http://127.0.0.1:3656/api/" + path, { method, headers: { "x-correlation-id": "af021-http", ...(token ? { authorization: "Bearer " + token } : {}), ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10000) });
    assert.equal(response.status, expected, method + " " + path); const value = await response.json();
    if (value.data?.accessToken) secrets.push(value.data.accessToken);
    for (const secret of secrets.filter(s => s !== value.data?.accessToken)) assert.ok(!JSON.stringify(value).includes(secret));
    assert.ok(!/passwordHash|password_hash|\$2[aby]\$\d\d\$/.test(JSON.stringify(value))); if (path.startsWith("admin/") || path.startsWith("dictionaries/")) assert.equal(response.headers.get("cache-control"), "no-store");
    events.push({ path, method, status: response.status }); return value.data;
  }
  const login = async a => (await request("auth/login", 200, { method: "POST", body: { username: a.username, password: a.password } })).accessToken;
  const create = (body, status = 201, token = tokens.root) => request("admin/dicts", status, { method: "POST", body, token });
  const patch = (id, body, status = 200, token = tokens.root) => request("admin/dicts/" + id, status, { method: "PATCH", body, token });
  const item = (body, status = 201, id = dict, token = tokens.root) => request("admin/dicts/" + id + "/items", status, { method: "POST", body, token });
  const patchItem = (id, body, status = 200) => request("admin/dict-items/" + id, status, { method: "PATCH", body });
  const publicItems = (code = "custom.af021.catalog", suffix = "") => request("dictionaries/" + code + "/items" + suffix, 200, { token: null });
  const audits = () => prisma.auditLog.findMany({ where: { module: "dictionaries" } });
  try {
    app = await createApplication(); await app.listen(3656, "127.0.0.1"); prisma = app.get(PrismaService);
    await t.test("new empty target applies initial plus dictionary migration idempotently; explicit Seed only registers permission", async () => {
      const ledger = await query(async c => (await c.query("SELECT migration_name,checksum FROM public._prisma_migrations ORDER BY migration_name")).rows);
      assert.equal(ledger.length, 2); assert.equal(ledger[1].migration_name, "20261019010000_dictionaries");
      await migrate({ mode: "test", action: "deploy", acceptanceId: lease.id }); await migrate({ mode: "test", action: "status", acceptanceId: lease.id });
      assert.deepEqual(await query(async c => (await c.query("SELECT migration_name,checksum FROM public._prisma_migrations ORDER BY migration_name")).rows), ledger);
      assert.equal(await prisma.sysDict.count(), 0); assert.equal(await prisma.sysDictItem.count(), 0);
      assert.deepEqual(seedArguments(["test", "--dictionaries"]), { mode: "test", acceptanceId: undefined, generateCredentials: false, dictionaries: true }); assert.throws(() => seedArguments(["test", "--dictionaries", "--dictionaries"]));
      permission = await prisma.sysPermission.findUniqueOrThrow({ where: { permissionCode: "admin.dict.manage" } }); bootstrap = await prisma.sysPermission.findUniqueOrThrow({ where: { permissionCode: "aij.bootstrap.admin" } });
      const grants = await prisma.sysRolePermission.count(); await prisma.sysPermission.update({ where: { id: permission.id }, data: { status: "disabled" } });
      try { const seeded = await seedDatabase({ mode: "test", acceptanceId: lease.id, generateCredentials: true, dictionaries: true }); assert.equal(seeded.dictionaries.grantsReconciled, false); assert.equal((await prisma.sysPermission.findUniqueOrThrow({ where: { id: permission.id } })).status, "disabled"); }
      finally { await prisma.sysPermission.update({ where: { id: permission.id }, data: { status: "active" } }); }
      assert.equal(await prisma.sysRolePermission.count(), grants);
      tokens.root = await login(initial); tokens.manager = await login(accounts[0]); tokens.reader = await login(accounts[1]); managerRole = await prisma.sysRole.findUniqueOrThrow({ where: { roleCode: "af021_manager" } });
      save("migrations-seed", { database: lease.database, acceptanceId: lease.id, migrations: ledger, secondDeployUnchanged: true, noDefaultDictionaries: true, noGrantOrStatusReconciliation: true });
    });
    await t.test("category CRUD, duplicate code and boundaries use actual paged database rows", async () => {
      dict = (await create({ dictCode: "custom.af021.catalog", dictName: "AF021 generic synthetic", sortOrder: 0 }, 201, tokens.manager)).id;
      const ids = [dict]; for (let n = 1; n <= 2; n++) ids.push((await create({ dictCode: "custom.af021.other" + n, dictName: "AF021 generic", sortOrder: n })).id);
      await create({ dictCode: "custom.af021.catalog", dictName: "duplicate" }, 409);
      const seen = []; for (let page = 1; page <= 4; page++) { const rows = await request("admin/dicts?q=custom.af021&pageSize=1&page=" + page, 200); assert.equal(rows.total, 3); assert.deepEqual(rows.items.map(r => r.id), page <= 3 ? [ids[page - 1]] : []); seen.push(...rows.items.map(r => r.id)); }
      assert.deepEqual(seen, ids); await patch(dict, { dictName: "AF021 edited", description: "synthetic only", sortOrder: -1 });
      assert.equal((await request("admin/dicts?q=AF021 edited", 200)).items[0].dictName, "AF021 edited");
      for (const tail of ["page=0", "page=10001", "page=1.5", "page=NaN", "pageSize=0", "pageSize=101", "sortOrder=raw", "status=unknown"]) await request("admin/dicts?" + tail, 400);
      assert.equal((await request("admin/dicts?page=10000&pageSize=100", 200)).items.length, 0);
      save("category-pages", { uniqueRows: 3, duplicate: 409, emptyLastPage: true, invalidBounds: 400 });
    });
    await t.test("entries have per-category unique values, actual stable sort and paged edit/disable", async () => {
      first = (await item({ itemValue: "enabled", itemLabel: "AF021 enabled", sortOrder: 3 })).id; second = (await item({ itemValue: "disabled", itemLabel: "AF021 disabled", sortOrder: 1 })).id; third = (await item({ itemValue: "pending", itemLabel: "AF021 pending", sortOrder: 1 })).id;
      await item({ itemValue: "enabled", itemLabel: "duplicate" }, 409);
      const other = (await request("admin/dicts?q=custom.af021.other1", 200)).items[0].id; await item({ itemValue: "enabled", itemLabel: "separate namespace" }, 201, other);
      const tie = [second, third].sort(); const expected = [...tie, first], seen = [];
      for (let page = 1; page <= 4; page++) { const rows = await request("admin/dicts/" + dict + "/items?pageSize=1&page=" + page, 200); assert.equal(rows.total, 3); seen.push(...rows.items.map(r => r.id)); assert.equal(rows.items.length, page <= 3 ? 1 : 0); }
      assert.deepEqual(seen, expected); await patchItem(first, { sortOrder: -5, itemLabel: "AF021 reordered" }); assert.equal((await request("admin/dicts/" + dict + "/items", 200)).items[0].id, first);
      await patchItem(second, { status: "disabled" }); assert.equal((await request("admin/dicts/" + dict + "/items?status=disabled", 200)).total, 1);
      await item({ itemValue: "missing", itemLabel: "missing parent" }, 404, "nonexistent");
      save("entry-pages", { perCategoryUnique: 409, otherCategorySameValue: 201, stableTieById: true, pages: 4, reordered: true });
    });
    await t.test("all eight management routes enforce 401/403 and strict non-privileged DTOs", async () => {
      const count = (await audits()).length;
      for (const [path, method, body] of [["admin/dicts", "GET"], ["admin/dicts/" + dict + "/items", "GET"], ["admin/dicts", "POST", { dictCode: "custom.bad", dictName: "bad" }], ["admin/dicts/" + dict, "PATCH", { dictName: "bad" }], ["admin/dicts/" + dict, "DELETE"], ["admin/dicts/" + dict + "/items", "POST", { itemValue: "bad", itemLabel: "bad" }], ["admin/dict-items/" + first, "PATCH", { itemLabel: "bad" }], ["admin/dict-items/" + first, "DELETE"]]) { await request(path, 401, { method, body, token: null }); await request(path, 403, { method, body, token: tokens.reader }); }
      for (const body of [{}, { dictCode: "business.category", dictName: "bad" }, { dictCode: "custom.bad", dictName: "bad", pluginCode: "aij-ai" }, { dictCode: "custom.bad", dictName: "bad", workspaceId: "owner" }, { dictCode: "custom.bad", dictName: "bad", isPublic: "true" }]) await create(body, 400);
      await patch(dict, { dictCode: "custom.changed" }, 400); await patch(dict, {}, 400); await patchItem(first, { itemValue: "changed" }, 400); await patchItem(first, { dictId: "other" }, 400); await patchItem(first, { itemLabel: null }, 400);
      await item({ itemValue: "../value", itemLabel: "bad" }, 400); await item({ itemValue: "bad", itemLabel: "bad", sortOrder: 10001 }, 400);
      assert.equal((await audits()).length, count); assert.equal((await prisma.sysDict.findUniqueOrThrow({ where: { id: dict } })).dictCode, "custom.af021.catalog");
    });
    await t.test("anonymous public reads expose only explicitly public active categories and active projected items", async () => {
      assert.deepEqual((await publicItems()).items, []); await patch(dict, { isPublic: true });
      let result = await publicItems(); assert.equal(result.total, 2); assert.ok(result.items.every(row => Object.keys(row).sort().join() === "itemLabel,itemValue,sortOrder")); assert.ok(!result.items.some(row => row.itemValue === "disabled"));
      const values = []; for (let page = 1; page <= 3; page++) { result = await publicItems(undefined, "?pageSize=1&page=" + page); assert.equal(result.total, 2); values.push(...result.items.map(r => r.itemValue)); } assert.deepEqual(values, ["enabled", "pending"]);
      for (const code of ["custom.unknown", "custom.af021.other1"]) assert.deepEqual(await publicItems(code), { items: [], total: 0, page: 1, pageSize: 20 });
      await request("dictionaries/custom.af021.catalog/items?status=disabled", 400, { token: null }); await request("dictionaries/custom.af021.catalog/items?pageSize=101", 400, { token: null });
      await patch(dict, { status: "disabled" }); assert.equal((await publicItems()).total, 0); await item({ itemValue: "bad", itemLabel: "bad" }, 409); await patchItem(second, { status: "active" }, 409);
      await patch(dict, { status: "active" }); assert.equal((await publicItems()).total, 2); await patchItem(first, { status: "disabled" }); assert.equal((await publicItems()).total, 1); await patchItem(first, { status: "active" });
      save("public-filter", { anonymous: 200, privateOrUnknown: [], disabledCategory: [], disabledItemsOmitted: true, projectedFields: ["itemLabel", "itemValue", "sortOrder"], invalidQuery: 400 });
    });
    await t.test("grant/revoke changes same JWT writes; backend catalog/RBAC and accepted menus/users remain enforced", async () => {
      const rolePermission = await prisma.sysPermission.findUniqueOrThrow({ where: { permissionCode: "admin.role.manage" } }), definitionPermission = await prisma.sysPermission.findUniqueOrThrow({ where: { permissionCode: "admin.permission.manage" } });
      await request("admin/roles/" + managerRole.id + "/permissions", 200, { method: "PUT", body: { permissionIds: [rolePermission.id, definitionPermission.id] } }); await patch(dict, { dictName: "denied" }, 403, tokens.manager);
      await request("admin/roles/" + managerRole.id + "/permissions", 200, { method: "PUT", body: { permissionIds: [rolePermission.id, definitionPermission.id, permission.id] } }); await patch(dict, { dictName: "AF021 restored" }, 200, tokens.manager);
      assert.deepEqual(await request("admin/menus/my", 200, { token: tokens.reader }), []); await request("admin/users", 403, { token: tokens.reader }); await request("admin/dicts", 401, { token: "not-a-jwt" });
      const my = await request("admin/permissions/my", 200, { token: tokens.reader }); assert.deepEqual(my.permissions, [bootstrap.permissionCode]);
    });
    await t.test("plugin ownership cannot be adopted/edited through core API and disabled plugin is never published", async () => {
      await prisma.sysDict.update({ where: { id: dict }, data: { pluginCode: "aij-ai" } });
      try { await patch(dict, { dictName: "cannot change" }, 409); await item({ itemValue: "bad", itemLabel: "bad" }, 409); await patchItem(first, { itemLabel: "bad" }, 409); await request("admin/dict-items/" + first, 409, { method: "DELETE" }); await request("admin/dicts/" + dict, 409, { method: "DELETE" }); assert.equal((await publicItems()).total, 0); }
      finally { await prisma.sysDict.update({ where: { id: dict }, data: { pluginCode: null } }); }
      save("plugin-owner", { installedPlugins: [], coreCannotAdoptPluginOwner: true, pluginOwnedWrites: 409, unavailablePluginPublicRead: [], noLifecycleClaim: true });
    });
    await t.test("actual foreign key references survive soft deletion; stable values and reserved codes cannot be repurposed", async () => {
      await query(async c => { await c.query("CREATE SCHEMA af021_verification"); await c.query("CREATE TABLE af021_verification.reference (id text PRIMARY KEY,item_id text NOT NULL REFERENCES public.system_dict_item(id) ON DELETE RESTRICT)"); await c.query("INSERT INTO af021_verification.reference (id,item_id) VALUES ('synthetic-reference',$1)", [first]); });
      await request("admin/dicts/" + dict, 409, { method: "DELETE" }); await request("admin/dict-items/" + first, 200, { method: "DELETE" });
      const reference = await query(async c => (await c.query("SELECT i.item_value,i.deleted_at,r.item_id FROM af021_verification.reference r JOIN public.system_dict_item i ON i.id=r.item_id")).rows[0]); assert.equal(reference.item_value, "enabled"); assert.ok(reference.deleted_at); assert.equal(reference.item_id, first);
      await item({ itemValue: "enabled", itemLabel: "cannot reuse" }, 409); assert.ok(!(await publicItems()).items.some(r => r.itemValue === "enabled"));
      await query(async c => { await c.query("BEGIN"); try { for (const statement of ["DELETE FROM public.system_dict_item WHERE id=$1", "DELETE FROM public.system_dict WHERE id=$1"]) { await c.query("SAVEPOINT restriction"); let rejected = false; try { await c.query(statement, [statement.includes('dict_item') ? first : dict]); } catch (e) { rejected = e.code === "23503"; } await c.query("ROLLBACK TO SAVEPOINT restriction"); assert.ok(rejected, "Actual FK RESTRICT prevents breaking references"); } } finally { await c.query("ROLLBACK"); } });
      save("references", { fixtureSchema: "af021_verification", syntheticReferenceRetained: true, sameIdAndValue: true, itemSoftDeleted: true, hardDeletesRestricted: true, codeReuse: 409 });
    });
    await t.test("concurrent duplicate codes rely on unique constraints without partial success audit", async () => {
      const run = async () => { const r = await fetch("http://127.0.0.1:3656/api/admin/dicts", { method: "POST", headers: { authorization: "Bearer " + tokens.root, "content-type": "application/json" }, body: JSON.stringify({ dictCode: "custom.af021.concurrent", dictName: "synthetic concurrent" }) }); return r.status; };
      assert.deepEqual((await Promise.all([run(), run()])).sort(), [201, 409]); assert.equal(await prisma.sysDict.count({ where: { dictCode: "custom.af021.concurrent" } }), 1);
    });
    await t.test("audit insertion failure rolls back all six category/item write kinds", async () => {
      const before = await prisma.sysDict.findUniqueOrThrow({ where: { id: dict } }), entry = await prisma.sysDictItem.findUniqueOrThrow({ where: { id: third } }), count = (await audits()).length, empty = (await create({ dictCode: "custom.af021.empty", dictName: "empty" })).id, afterCreate = (await audits()).length;
      assert.equal(afterCreate, count + 1);
      await query(async c => { await c.query("CREATE FUNCTION public.af021_reject_dictionary_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.module='dictionaries' THEN RAISE EXCEPTION 'synthetic audit unavailable'; END IF; RETURN NEW; END $$"); await c.query("CREATE TRIGGER af021_reject_dictionary_audit BEFORE INSERT ON public.audit_log FOR EACH ROW EXECUTE FUNCTION public.af021_reject_dictionary_audit()"); });
      try { await create({ dictCode: "custom.af021.rollback", dictName: "rollback" }, 503); await patch(dict, { dictName: "rollback" }, 503); await request("admin/dicts/" + empty, 503, { method: "DELETE" }); await item({ itemValue: "rollback", itemLabel: "rollback" }, 503); await patchItem(third, { itemLabel: "rollback" }, 503); await request("admin/dict-items/" + third, 503, { method: "DELETE" }); assert.deepEqual(await prisma.sysDict.findUniqueOrThrow({ where: { id: dict } }), before); assert.deepEqual(await prisma.sysDictItem.findUniqueOrThrow({ where: { id: third } }), entry); assert.equal(await prisma.sysDict.count({ where: { dictCode: "custom.af021.rollback" } }), 0); assert.equal((await audits()).length, afterCreate); }
      finally { await query(async c => { await c.query("DROP TRIGGER af021_reject_dictionary_audit ON public.audit_log"); await c.query("DROP FUNCTION public.af021_reject_dictionary_audit()"); }); }
      save("audit-rollback", { sixKinds: 503, allDataAndAuditsRolledBack: true, ownTriggerAndFunctionRemoved: true });
    });
    await t.test("writes queued on actual database lock recheck revoked permission before mutation", async () => {
      let pending, committed = false;
      try {
        await query(async c => { await c.query("BEGIN"); try { await c.query("SELECT pg_advisory_xact_lock(hashtext('aij-admin-users-write'))"); pending = patch(dict, { dictName: "must not write" }, 403, tokens.manager).catch(e => e); let blocked = false; const end = Date.now() + 2000; while (Date.now() < end) { blocked = (await c.query("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND application_name LIKE 'aij-api:%' AND wait_event_type='Lock' AND wait_event='advisory') AS blocked")).rows[0].blocked; if (blocked) break; await new Promise(r => setTimeout(r, 25)); } assert.ok(blocked); await c.query("DELETE FROM public.sys_role_permission WHERE role_id=$1 AND permission_id=$2", [managerRole.id, permission.id]); await c.query("COMMIT"); committed = true; } finally { if (!committed) await c.query("ROLLBACK"); } });
        assert.ok(!(await pending instanceof Error)); assert.equal((await prisma.sysDict.findUniqueOrThrow({ where: { id: dict } })).dictName, "AF021 restored");
      } finally { if (pending) await pending; if (committed) await prisma.sysRolePermission.create({ data: { roleId: managerRole.id, permissionId: permission.id } }); }
    });
    await t.test("public/admin database outage is safe 503, liveness stays 200 and readiness recovers", async () => {
      await prisma.$disconnect(); await setTaskDatabaseConnections(lease.id, false, "AF-021");
      try { await request("dictionaries/custom.af021.catalog/items", 503, { token: null }); await request("admin/dicts", 503); await request("health", 200, { token: null }); }
      finally { await setTaskDatabaseConnections(lease.id, true, "AF-021"); }
      await waitReady(); assert.equal((await publicItems()).total, 1);
    });
    await t.test("category removal preserves historical entries and audit contains only safe attributable fields", async () => {
      await request("admin/dict-items/" + second, 200, { method: "DELETE" }); await request("admin/dict-items/" + third, 200, { method: "DELETE" }); await request("admin/dicts/" + dict, 200, { method: "DELETE" });
      assert.equal((await publicItems()).total, 0); assert.equal(await prisma.sysDictItem.count({ where: { dictId: dict } }), 3); await create({ dictCode: "custom.af021.catalog", dictName: "cannot reuse" }, 409);
      const rows = await audits(), owners = await prisma.sysUser.findMany({ where: { username: { in: [initial.username, accounts[0].username] } }, select: { id: true } }); assert.ok(rows.length >= 10); assert.ok(rows.every(r => owners.some(o => o.id === r.userId) && Array.isArray(r.requestSummary.fields))); assert.ok(rows.filter(r => r.requestSummary.correlationId === "af021-http").length >= 10);
      for (const secret of secrets) assert.ok(!JSON.stringify(rows).includes(secret)); assert.ok(!/AF021 restored|passwordHash|\$2[aby]\$/.test(JSON.stringify(rows)));
      assert.ok((await prisma.sysDict.findMany()).every(r => r.dictCode.startsWith("custom.af021."))); save("audit-and-content", { actions: [...new Set(rows.map(r => r.action))], count: rows.length, noBusinessCategories: true, historyPreserved: true, safeFieldsOnly: true });
    });
    await t.test("unchanged source and actual pool shutdown are recorded", async () => {
      assert.deepEqual(files.map(hash), hashes); await app.close(); app = undefined; assert.deepEqual(await applicationSessions(lease.id, "AF-021"), []);
      save("result", { task: "AF-021", database: lease.database, acceptanceId: lease.id, events, sourceFilesUnchanged: true, pool: 0 });
    });
  } finally { if (app) await app.close(); for (const key of Object.keys(process.env)) delete process.env[key]; Object.assign(process.env, original); }
});
