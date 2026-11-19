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

test("AF-019 real role assignment consumes server catalog, denies escalation and preserves users", { timeout: 55000 }, async t => {
  await assertPortAvailable(3656);
  const parent = join(repositoryRoot, ".artifacts/af-019/http"); mkdirSync(parent, { recursive: true }); const directory = mkdtempSync(join(parent, "run-"));
  const lease = await createAcceptance("test", "AF-019"); await migrate({ mode: "test", action: "deploy", acceptanceId: lease.id });
  const fixture = await prepareRbacFixture(lease.id, "AF-019"), initial = JSON.parse(readFileSync(fixture.initialPasswordFile));
  const accounts = JSON.parse(readFileSync(fixture.accounts[0].initialPasswordFile)).accounts, keys = authKeys(lease.id, "AF-019"), original = { ...process.env };
  const secrets = [initial.password, ...accounts.map(a => a.password), keys.secret];
  const protectedPaths = ["apps/api/src/rbac/management.service.ts", "apps/api/src/rbac/management-access.service.ts", "apps/api/src/common/guards/admin-authorization.guard.ts", "apps/api/src/prisma/prisma.service.ts", "apps/api/prisma/schema.prisma", "apps/api/prisma/migrations/20261019000000_initial/migration.sql"];
  const hash = p => createHash("sha256").update(readFileSync(p)).digest("hex"), hashes = protectedPaths.map(hash);
  for (const key of Object.keys(process.env)) delete process.env[key]; Object.assign(process.env, authEnvironment(lease.id, keys.secret, "AF-019"));
  const require = createRequire(join(repositoryRoot, "apps/api/package.json"));
  const { createApplication } = require(join(repositoryRoot, "apps/api/dist/bootstrap.js")), { PrismaService } = require(join(repositoryRoot, "apps/api/dist/prisma/prisma.service.js"));
  const { JwtService } = require("@nestjs/jwt");
  let app, prisma, root, viewer, manager, role, userPermission, rolePermission;
  const tokens = {}, events = [], save = (name, value) => writeFileSync(join(directory, name + ".json"), JSON.stringify(value, null, 2) + "\n");
  const query = operation => withDatabase("test", readDatabaseEnvironment("test", process.env, lease.id), operation, { acceptanceId: lease.id });
  async function request(path, expected, { token = tokens.root, method = "GET", body } = {}) {
    const r = await fetch("http://127.0.0.1:3656/api/" + path, { method, headers: { "x-correlation-id": "af019-http", ...(token ? { authorization: "Bearer " + token } : {}), ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10000) });
    assert.equal(r.status, expected, method + " " + path); const value = await r.json(); if (value.data?.accessToken) secrets.push(value.data.accessToken);
    for (const secret of secrets.filter(s => s !== value.data?.accessToken)) assert.ok(!JSON.stringify(value).includes(secret), "No credential or JWT echo");
    assert.ok(!/passwordHash|password_hash|\$2[aby]\$\d\d\$/.test(JSON.stringify(value)));
    if (path.startsWith("admin/")) assert.equal(r.headers.get("cache-control"), "no-store");
    events.push({ path, method, status: r.status }); return value.data;
  }
  const login = async a => (await request("auth/login", 200, { method: "POST", body: { username: a.username, password: a.password } })).accessToken;
  const bind = (ids, status = 200, token = tokens.root) => request("admin/roles/" + role + "/permissions", status, { method: "PUT", token, body: { permissionIds: ids } });
  const assignments = () => prisma.auditLog.findMany({ where: { module: "rbac-management", action: "role_permissions_assigned", resourceId: role } });
  const links = async () => (await prisma.sysRolePermission.findMany({ where: { roleId: role } })).map(r => r.permissionId).sort();
  try {
    app = await createApplication(); await app.listen(3656, "127.0.0.1"); prisma = app.get(PrismaService);
    await t.test("server catalog supplies IDs and status; real role pages and edits use the accepted API", async () => {
      tokens.root = await login(initial); tokens.manager = await login(accounts[0]); tokens.viewer = await login(accounts[1]);
      [root, manager, viewer] = await Promise.all([initial, ...accounts].map(a => prisma.sysUser.findUniqueOrThrow({ where: { username: a.username } })));
      const catalog = await request("admin/permissions/manage?pageSize=100", 200); userPermission = catalog.items.find(p => p.permissionCode === "admin.user.manage"); rolePermission = catalog.items.find(p => p.permissionCode === "admin.role.manage");
      assert.ok(userPermission?.id && rolePermission?.id); assert.equal(userPermission.status, "active");
      await request("admin/permissions/manage", 200, { token: tokens.manager }); await request("admin/permissions/manage", 403, { token: tokens.viewer });
      const ids = new Set(); for (let i = 0; i < 3; i++) ids.add((await request("admin/roles", 201, { method: "POST", body: { roleCode: "af019_paging_" + i, roleName: "AF019 paging" } })).id);
      const seen = new Set(); for (let page = 1; page <= 4; page++) {
        const data = await request("admin/roles?q=af019_paging_&page=" + page + "&pageSize=1", 200); assert.equal(data.total, 3); assert.equal(data.items.length, page <= 3 ? 1 : 0);
        for (const row of data.items) { assert.ok(ids.has(row.id) && !seen.has(row.id)); seen.add(row.id); }
      }
      assert.equal(seen.size, 3); role = [...ids][0];
      await request("admin/roles/" + role, 200, { method: "PATCH", token: tokens.manager, body: { roleName: "AF019 edited", remark: "synthetic" } });
      assert.equal((await request("admin/roles/" + role, 200)).roleName, "AF019 edited");
      save("catalog-pagination", { database: lease.database, serverSelectedPermission: { id: userPermission.id, code: userPermission.permissionCode, status: userPermission.status }, pages: 4, disjointRows: 3 });
    });
    await t.test("unauthenticated, ungranted and normal managers cannot grant themselves or others privilege", async () => {
      await request("admin/roles/" + role + "/permissions", 401, { method: "PUT", token: null, body: { permissionIds: [userPermission.id] } });
      await bind([userPermission.id], 403, tokens.viewer); await bind([userPermission.id], 403, tokens.manager);
      const ownRole = await prisma.sysRole.findUniqueOrThrow({ where: { roleCode: "af019_manager" } });
      await request("admin/roles/" + ownRole.id + "/permissions", 403, { method: "PUT", token: tokens.manager, body: { permissionIds: [userPermission.id] } });
      const forged = await new JwtService().signAsync({ sub: manager.id, tokenKind: "admin", projectId: "aij-foundation", environment: "test", isSuperAdmin: true, permissions: ["*"] }, { secret: keys.secret, issuer: "urn:aij:aij-foundation:test:api", audience: "urn:aij:aij-foundation:test:admin", algorithm: "HS256", expiresIn: 900 }); secrets.push(forged);
      await bind([userPermission.id], 403, forged); assert.deepEqual(await links(), []); assert.equal((await assignments()).length, 0);
      save("no-escalation", { anonymous: 401, ungranted: 403, managerSelfAndOthers: 403, forgedClaims: 403, assignmentRows: 0 });
    });
    await t.test("grant and revoke change the same JWT Guard result and audit stores exact ID transitions", async () => {
      const oldRoles = await prisma.sysUserRole.findMany({ where: { userId: viewer.id } });
      await request("admin/users/" + viewer.id, 200, { method: "PATCH", body: { roleIds: [...oldRoles.map(r => r.roleId), role] } });
      await request("admin/users", 403, { token: tokens.viewer }); await bind([userPermission.id]); await request("admin/users", 200, { token: tokens.viewer });
      await bind([]); await request("admin/users", 403, { token: tokens.viewer });
      const audits = await assignments(); assert.equal(audits.length, 2);
      for (const [before, after] of [[[], [userPermission.id]], [[userPermission.id], []]]) assert.ok(audits.some(a => JSON.stringify(a.requestSummary.permissionIdsBefore) === JSON.stringify(before) && JSON.stringify(a.requestSummary.permissionIdsAfter) === JSON.stringify(after)));
      assert.ok(audits.every(a => a.userId === root.id && a.resourceType === "role" && a.requestSummary.correlationId === "af019-http"));
      await bind([userPermission.id]); save("guard-and-audit", { sameJwtGranted: 200, sameJwtRevoked: 403, grantAndRevokeAudits: 2, actualTransitionsRecorded: true });
    });
    await t.test("permission codes, wildcard, unknown/duplicate IDs and inactive definitions cannot replace valid links", async () => {
      const before = await links(), count = (await assignments()).length;
      for (const body of [{ permissionCodes: ["admin.user.manage"] }, { permissionIds: ["admin.user.manage"] }, { permissionIds: ["*"] }, { permissionIds: [userPermission.id, "unknown"] }, { permissionIds: [userPermission.id, userPermission.id] }, { permissionIds: null }]) {
        await request("admin/roles/" + role + "/permissions", 400, { method: "PUT", body }); assert.deepEqual(await links(), before);
      }
      await prisma.sysPermission.update({ where: { id: userPermission.id }, data: { status: "disabled" } });
      try { await bind([userPermission.id], 400); assert.deepEqual(await links(), before); }
      finally { await prisma.sysPermission.update({ where: { id: userPermission.id }, data: { status: "active" } }); }
      assert.equal((await assignments()).length, count); save("invalid-selections", { malformedCodeOrIds: 400, inactiveDefinition: 400, previousLinksAndAuditsUnchanged: true });
    });
    await t.test("disabled role rejects both assign/revoke and user binding; enable restores existing grants", async () => {
      await request("admin/roles/" + role + "/status", 200, { method: "PATCH", body: { enabled: false } }); await request("admin/users", 403, { token: tokens.viewer });
      const before = await links(), count = (await assignments()).length;
      await bind([rolePermission.id], 409); await bind([], 409); assert.deepEqual(await links(), before); assert.equal((await assignments()).length, count);
      await request("admin/users/" + viewer.id, 400, { method: "PATCH", body: { roleIds: [role] } });
      await request("admin/roles/" + role + "/status", 200, { method: "PATCH", body: { enabled: true } }); await request("admin/users", 200, { token: tokens.viewer });
      save("disabled-role", { guardDisabled: 403, assignAndRevoke: 409, attachDisabledRole: 400, restoredSameJwt: 200 });
    });
    await t.test("role disabled while an assignment waits on the real DB write lock is rejected transactionally", async () => {
      const before = await links(), count = (await assignments()).length; let pending, committed = false;
      try {
        await query(async c => {
          await c.query("BEGIN");
          try {
            await c.query("SELECT pg_advisory_xact_lock(hashtext('aij-admin-users-write'))"); pending = bind([], 409).catch(e => e);
            let blocked = false; const deadline = Date.now() + 2000;
            while (Date.now() < deadline) {
              blocked = (await c.query("SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND application_name LIKE 'aij-api:%' AND wait_event_type='Lock' AND wait_event='advisory') AS blocked")).rows[0].blocked;
              if (blocked) break; await new Promise(r => setTimeout(r, 25));
            }
            assert.ok(blocked, "Observed the actual API transaction waiting for its write lock");
            await c.query("UPDATE public.sys_role SET status='disabled' WHERE id=$1", [role]); await c.query("COMMIT"); committed = true;
          } finally { if (!committed) await c.query("ROLLBACK"); }
        });
        assert.ok(!(await pending instanceof Error), "Queued assignment must reject as 409"); assert.deepEqual(await links(), before); assert.equal((await assignments()).length, count);
      } finally { if (pending) await pending; if (committed) await prisma.sysRole.update({ where: { id: role }, data: { status: "active" } }); }
      await request("admin/users", 200, { token: tokens.viewer }); save("queued-role-state", { lockWaitObserved: true, targetDisabledBeforeLockRelease: true, assignment: 409, previousLinksAndAuditsUnchanged: true });
    });
    await t.test("actual audit failure rolls back grant replacement/revocation and preserves trace history", async () => {
      const before = await links(), count = (await assignments()).length;
      await query(async c => {
        await c.query("CREATE FUNCTION public.af019_reject_assignment_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.module='rbac-management' AND NEW.action='role_permissions_assigned' AND NEW.request_summary->>'correlationId'='af019-http' THEN RAISE EXCEPTION 'synthetic audit unavailable'; END IF; RETURN NEW; END $$");
        await c.query("CREATE TRIGGER af019_reject_assignment_audit BEFORE INSERT ON public.audit_log FOR EACH ROW EXECUTE FUNCTION public.af019_reject_assignment_audit()");
      });
      try { for (const ids of [[], [rolePermission.id]]) { await bind(ids, 503); assert.deepEqual(await links(), before); assert.equal((await assignments()).length, count); await request("admin/users", 200, { token: tokens.viewer }); } }
      finally { await query(async c => { await c.query("DROP TRIGGER af019_reject_assignment_audit ON public.audit_log"); await c.query("DROP FUNCTION public.af019_reject_assignment_audit()"); }); }
      save("audit-rollback", { failure: 503, cases: 2, previousLinksAndAuditsUnchanged: true, ownTriggerAndFunctionRemoved: true });
    });
    await t.test("referenced role soft deletion clears grants and preserves the user and historical user-role link", async () => {
      const userCount = await prisma.sysUser.count(); const result = await request("admin/roles/" + role, 200, { method: "DELETE" }); assert.equal(result.deleted, true);
      const row = await prisma.sysRole.findUniqueOrThrow({ where: { id: role } }); assert.equal(row.status, "disabled"); assert.ok(row.deletedAt); assert.deepEqual(await links(), []);
      assert.equal(await prisma.sysUserRole.count({ where: { roleId: role, userId: viewer.id } }), 1); assert.equal(await prisma.sysUser.count(), userCount);
      assert.equal((await prisma.sysUser.findUniqueOrThrow({ where: { id: viewer.id } })).status, "active"); await request("auth/me", 200, { token: tokens.viewer }); await request("admin/users", 403, { token: tokens.viewer });
      await request("admin/roles/" + role, 404); await request("admin/roles", 409, { method: "POST", body: { roleCode: row.roleCode, roleName: "reserved code" } });
      save("reference-policy", { roleTombstone: true, permissionLinks: 0, userLinkRetained: true, userRowsPreserved: true, identity: 200, protectedApi: 403, codeReuse: 409 });
    });
    await t.test("audit is safe and correlated; unchanged source probes and real app shutdown leave zero pool", async () => {
      const audits = await assignments(); assert.ok(audits.length >= 3);
      assert.ok(audits.every(a => a.userId === root.id && a.requestSummary.correlationId === "af019-http" && Array.isArray(a.requestSummary.permissionIdsBefore) && Array.isArray(a.requestSummary.permissionIdsAfter)));
      for (const secret of secrets) assert.ok(!JSON.stringify(audits).includes(secret)); assert.ok(!/AF019 edited|passwordHash|\$2[aby]\$/.test(JSON.stringify(audits)));
      assert.deepEqual(protectedPaths.map(hash), hashes); await app.close(); app = undefined; assert.deepEqual(await applicationSessions(lease.id, "AF-019"), []);
      save("result", { task: "AF-019", database: lease.database, acceptanceId: lease.id, events, grantAudits: audits.length, safePermissionIdsOnly: true, sourceFilesUnchanged: true, pool: 0 });
    });
  } finally { if (app) await app.close(); for (const key of Object.keys(process.env)) delete process.env[key]; Object.assign(process.env, original); }
});
