import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
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

test("AF-018 reuses the real administrator API and persists only authorized atomic mutations", { timeout: 55000 }, async t => {
  await assertPortAvailable(3656);
  const parent = join(repositoryRoot, ".artifacts/af-018/http"); mkdirSync(parent, { recursive: true }); const directory = mkdtempSync(join(parent, "run-"));
  const lease = await createAcceptance("test", "AF-018"); await migrate({ mode: "test", action: "deploy", acceptanceId: lease.id });
  const fixture = await prepareRbacFixture(lease.id, "AF-018"), initial = JSON.parse(readFileSync(fixture.initialPasswordFile));
  const accounts = JSON.parse(readFileSync(fixture.accounts[0].initialPasswordFile)).accounts, keys = authKeys(lease.id, "AF-018");
  const inputs = { password: "C9-" + randomBytes(24).toString("hex"), reset: "N8-" + randomBytes(24).toString("hex") };
  const inputPath = join(repositoryRoot, ".local-data/seed/test", lease.database, "crud-inputs.json"); writeFileSync(inputPath, JSON.stringify(inputs) + "\n", { flag: "wx", mode: 0o600 });
  const secrets = [initial.password, ...accounts.map(a => a.password), keys.secret, ...Object.values(inputs)], original = { ...process.env };
  const protectedPaths = ["apps/api/src/admin/admin-users.service.ts", "apps/api/src/admin/admin-users.controller.ts", "apps/api/src/admin/dto.ts", "apps/api/src/prisma/prisma.service.ts", "apps/api/src/rbac/management-access.service.ts", "apps/api/prisma/schema.prisma", "apps/api/prisma/migrations/20261019000000_initial/migration.sql"];
  const hash = p => createHash("sha256").update(readFileSync(p)).digest("hex"), hashes = protectedPaths.map(hash);
  for (const key of Object.keys(process.env)) delete process.env[key]; Object.assign(process.env, authEnvironment(lease.id, keys.secret, "AF-018"));
  const require = createRequire(join(repositoryRoot, "apps/api/package.json")), bcrypt = require("bcryptjs");
  const { createApplication } = require(join(repositoryRoot, "apps/api/dist/bootstrap.js")), { PrismaService } = require(join(repositoryRoot, "apps/api/dist/prisma/prisma.service.js"));
  let app, prisma, root, manager, role, target, targetToken;
  const tokens = {}, events = [], save = (name, value) => writeFileSync(join(directory, name + ".json"), JSON.stringify(value, null, 2) + "\n");
  const query = operation => withDatabase("test", readDatabaseEnvironment("test", process.env, lease.id), operation, { acceptanceId: lease.id });
  async function request(path, expected, { token, method = "GET", body } = {}) {
    const r = await fetch("http://127.0.0.1:3656/api/" + path, { method, headers: { "x-correlation-id": "af018-http", ...(token ? { authorization: "Bearer " + token } : {}), ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10000) });
    assert.equal(r.status, expected, method + " " + path); const value = await r.json(); if (value.data?.accessToken) secrets.push(value.data.accessToken);
    const text = JSON.stringify(value); for (const s of secrets.filter(s => s !== value.data?.accessToken)) assert.ok(!text.includes(s), "No credential or JWT echoes");
    assert.ok(!/passwordHash|password_hash|\$2[aby]\$\d\d\$/.test(text));
    if (path.startsWith("admin/")) assert.equal(r.headers.get("cache-control"), "no-store");
    events.push({ path, method, status: r.status }); return value.data;
  }
  const login = async (a, expected = 200) => (await request("auth/login", expected, { method: "POST", body: { username: a.username, password: a.password } }))?.accessToken;
  const create = (username, token = tokens.root) => request("admin/users", 201, { method: "POST", token, body: { username, realName: "AF018 synthetic", password: inputs.password } });
  try {
    app = await createApplication(); await app.listen(3656, "127.0.0.1"); prisma = app.get(PrismaService);
    await t.test("fresh protected Seed and production JWT/RBAC host serve real multi-page safe administrator results", async () => {
      tokens.root = await login(initial); tokens.manager = await login(accounts[0]); tokens.reader = await login(accounts[1]);
      [root, manager] = await Promise.all([initial.username, accounts[0].username].map(username => prisma.sysUser.findUniqueOrThrow({ where: { username } })));
      role = await prisma.sysRole.findUniqueOrThrow({ where: { roleCode: "af018_manager" } });
      const ids = new Set(); for (let i = 0; i < 3; i++) ids.add((await create("af018-paging-" + i)).id);
      const seen = new Set(); for (let page = 1; page <= 4; page++) {
        const result = await request("admin/users?q=af018-paging-&page=" + page + "&pageSize=1&status=active", 200, { token: tokens.manager });
        assert.equal(result.total, 3); assert.equal(result.page, page); assert.equal(result.pageSize, 1); assert.equal(result.items.length, page <= 3 ? 1 : 0);
        for (const item of result.items) { assert.ok(ids.has(item.id)); assert.ok(!seen.has(item.id)); seen.add(item.id); }
      }
      assert.equal(seen.size, 3); target = (await create("af018-target")).id; targetToken = await login({ username: "af018-target", password: inputs.password });
      save("pagination", { database: lease.database, pages: 4, total: 3, disjointRows: seen.size, inputPath });
    });
    await t.test("all write routes reject unauthenticated and ordinary ungranted direct requests without mutation", async () => {
      const before = await prisma.sysUser.count(), audit = await prisma.auditLog.count({ where: { module: "admin-users" } });
      for (const [path, method, body] of [["admin/users", "POST", { username: "af018-forbidden", realName: "AF018", password: inputs.password }], ["admin/users/" + target, "PATCH", { realName: "forbidden" }], ["admin/users/" + target + "/status", "PATCH", { enabled: false }], ["admin/users/" + target + "/reset-password", "PATCH", { password: inputs.reset }], ["admin/users/" + target, "DELETE"]]) {
        await request(path, 401, { method, body }); await request(path, 403, { token: tokens.reader, method, body });
      }
      assert.equal(await prisma.sysUser.count(), before); assert.equal(await prisma.auditLog.count({ where: { module: "admin-users" } }), audit);
      assert.equal((await prisma.sysUser.findUniqueOrThrow({ where: { id: target } })).realName, "AF018 synthetic"); save("direct-denials", { unauthenticated: 401, ungranted: 403, writes: 0 });
    });
    await t.test("authorized edit/reset/disable persist real rows; disable invalidates old JWT and login", async () => {
      await request("admin/users/" + target, 200, { token: tokens.manager, method: "PATCH", body: { realName: "AF018 changed", email: "af018@example.invalid" } });
      await request("admin/users/" + target + "/reset-password", 200, { token: tokens.manager, method: "PATCH", body: { password: inputs.reset } });
      const row = await prisma.sysUser.findUniqueOrThrow({ where: { id: target } }); assert.equal(row.realName, "AF018 changed"); assert.equal(bcrypt.getRounds(row.passwordHash), 12); assert.ok(await bcrypt.compare(inputs.reset, row.passwordHash));
      await login({ username: "af018-target", password: inputs.password }, 401); await login({ username: "af018-target", password: inputs.reset });
      await request("admin/users/" + target + "/status", 200, { token: tokens.manager, method: "PATCH", body: { enabled: false } });
      await request("auth/me", 401, { token: targetToken }); await request("admin/permissions/my", 401, { token: targetToken }); await login({ username: "af018-target", password: inputs.reset }, 401);
      await request("admin/users/" + target + "/status", 200, { token: tokens.manager, method: "PATCH", body: { enabled: true } });
      await request("auth/me", 200, { token: targetToken }); save("credentials-status", { oldPassword: 401, newPassword: 200, disabledOldJwt: 401, disabledLogin: 401, reenabledSameJwt: 200, bcryptRounds: 12 });
    });
    await t.test("an actual audit insert failure rolls back each user mutation including password/status", async () => {
      const state = async () => JSON.stringify({ row: await prisma.sysUser.findUniqueOrThrow({ where: { id: target } }), users: await prisma.sysUser.count(), audit: await prisma.auditLog.count({ where: { module: "admin-users" } }) });
      const before = await state();
      // Installed only in this newly created/identity-checked acceptance database, never shared/dev.
      await query(async c => {
        await c.query("CREATE FUNCTION public.af018_reject_admin_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.module='admin-users' AND NEW.request_summary->>'correlationId'='af018-http' THEN RAISE EXCEPTION 'synthetic audit unavailable'; END IF; RETURN NEW; END $$");
        await c.query("CREATE TRIGGER af018_reject_admin_audit BEFORE INSERT ON public.audit_log FOR EACH ROW EXECUTE FUNCTION public.af018_reject_admin_audit()");
      });
      try {
        for (const [path, method, body] of [["admin/users", "POST", { username: "af018-audit-failed", realName: "AF018", password: inputs.password }], ["admin/users/" + target, "PATCH", { realName: "must-not-persist" }], ["admin/users/" + target + "/reset-password", "PATCH", { password: inputs.password }], ["admin/users/" + target + "/status", "PATCH", { enabled: false }], ["admin/users/" + target, "DELETE"]]) {
          await request(path, 503, { token: tokens.root, method, body }); assert.ok(await state() === before, "No partial account/credential/status or success audit survives");
        }
      } finally {
        await query(async c => { await c.query("DROP TRIGGER af018_reject_admin_audit ON public.audit_log"); await c.query("DROP FUNCTION public.af018_reject_admin_audit()"); });
      }
      await request("admin/users/" + target, 200, { token: tokens.manager, method: "PATCH", body: { realName: "AF018 recovered" } });
      save("audit-rollback", { actualTriggerFailures: 5, status: 503, partialMutations: 0, ownTriggerAndFunctionRemoved: true, recovery: 200 });
    });
    await t.test("permission revoked while the real write waits for its DB lock is rechecked before mutation", async () => {
      const grant = await prisma.sysRolePermission.findFirstOrThrow({ where: { roleId: role.id, permission: { permissionCode: "admin.user.manage" } } });
      const before = await prisma.sysUser.findUniqueOrThrow({ where: { id: target } }), audits = await prisma.auditLog.count({ where: { module: "admin-users" } });
      let pending, committed = false;
      try {
        await query(async c => {
          await c.query("BEGIN");
          try {
            await c.query("SELECT pg_advisory_xact_lock(hashtext('aij-admin-users-write'))");
            pending = request("admin/users/" + target, 403, { token: tokens.manager, method: "PATCH", body: { realName: "stale-permission-must-not-write" } }).catch(error => error);
            let blocked = false; const deadline = Date.now() + 2000;
            while (Date.now() < deadline) {
              blocked = (await c.query("SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND application_name LIKE 'aij-api:%' AND wait_event_type='Lock' AND wait_event='advisory') AS blocked")).rows[0].blocked;
              if (blocked) break; await new Promise(r => setTimeout(r, 25));
            }
            assert.ok(blocked, "Observed the actual API transaction waiting for its advisory lock");
            await c.query("DELETE FROM public.sys_role_permission WHERE id=$1", [grant.id]); await c.query("COMMIT"); committed = true;
          } finally { if (!committed) await c.query("ROLLBACK"); }
        });
        const result = await pending; assert.ok(!(result instanceof Error), "Queued write must reject as 403");
        assert.equal((await prisma.sysUser.findUniqueOrThrow({ where: { id: target } })).realName, before.realName);
        assert.equal(await prisma.auditLog.count({ where: { module: "admin-users" } }), audits);
      } finally { if (pending) await pending; if (committed) await prisma.sysRolePermission.create({ data: grant }); }
      await request("admin/users", 200, { token: tokens.manager }); save("queued-revocation", { actualLockWaitObserved: true, permissionRevokedBeforeLockRelease: true, queuedWrite: 403, writesAndSuccessAudits: 0, grantRestored: true });
    });
    await t.test("self-disable protection applies to super and ordinary managers; last super stays usable", async () => {
      const before = await prisma.auditLog.count({ where: { module: "admin-users" } });
      for (const [id, token] of [[root.id, tokens.root], [manager.id, tokens.manager]]) await request("admin/users/" + id + "/status", 409, { method: "PATCH", token, body: { enabled: false } });
      await request("admin/users/" + root.id + "/status", 403, { method: "PATCH", token: tokens.manager, body: { enabled: false } });
      assert.equal(await prisma.sysUser.count({ where: { isSuperAdmin: true, status: "active", deletedAt: null } }), 1);
      assert.equal(await prisma.auditLog.count({ where: { module: "admin-users" } }), before); await request("admin/users", 200, { token: tokens.root });
      save("lockout-protection", { selfSuper: 409, selfManager: 409, managerDisablingLastSuper: 403, activeSupers: 1, successAuditForRejectedMutation: 0 });
    });
    await t.test("success audit is persistent and sanitized; no AI runtime or source probe, actual shutdown leaves zero pool", async () => {
      const rows = await prisma.auditLog.findMany({ where: { module: "admin-users" } });
      for (const action of ["created", "updated", "password_reset", "disabled", "enabled"]) assert.ok(rows.some(r => r.action === action));
      assert.ok(rows.every(r => r.status === "success" && r.requestSummary.correlationId === "af018-http"));
      const text = JSON.stringify(rows); for (const s of secrets) assert.ok(!text.includes(s)); assert.ok(!/af018@example.invalid|passwordHash|\$2[aby]\$/.test(text));
      assert.ok(Object.keys(require.cache).every(p => !p.includes("/apps/api/dist/ai/"))); assert.deepEqual((await request("health", 200)).enabledPlugins, []);
      assert.deepEqual(protectedPaths.map(hash), hashes); await app.close(); app = undefined; assert.deepEqual(await applicationSessions(lease.id, "AF-018"), []);
      save("result", { task: "AF-018", database: lease.database, acceptanceId: lease.id, events, auditRows: rows.length, passwordsOrTokensLogged: false, sourceFilesUnchanged: true, aiRuntimeLoaded: false, pool: 0 });
    });
  } finally { if (app) await app.close(); for (const key of Object.keys(process.env)) delete process.env[key]; Object.assign(process.env, original); }
});
