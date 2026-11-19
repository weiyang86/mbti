import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";
import { createAcceptance, migrate } from "../database/migration.mjs";
import { repositoryRoot } from "../database/connection.mjs";
import { seedArguments, seedDatabase } from "../database/seed.mjs";
import { assertPortAvailable } from "../port-availability.mjs";
import { applicationSessions, setTaskDatabaseConnections, waitReady } from "./readiness-support.mjs";
import { authEnvironment, authKeys } from "./auth-support.mjs";
import { prepareRbacFixture } from "./rbac-fixture.mjs";

test("AF-024 real persisted audit queries, authorization, safe projection and unchanged history", { timeout: 55000 }, async t => {
  await assertPortAvailable(3656); const parent = join(repositoryRoot, ".artifacts/af-024/http"); mkdirSync(parent, { recursive: true }); const directory = mkdtempSync(join(parent, "run-"));
  const lease = await createAcceptance("test", "AF-024"); await migrate({ mode: "test", action: "deploy", acceptanceId: lease.id }); const fixture = await prepareRbacFixture(lease.id, "AF-024");
  const initial = JSON.parse(readFileSync(fixture.initialPasswordFile)), accounts = JSON.parse(readFileSync(fixture.accounts[0].initialPasswordFile)).accounts, keys = authKeys(lease.id, "AF-024"), original = { ...process.env }, environment = authEnvironment(lease.id, keys.secret, "AF-024");
  const canary = randomBytes(32).toString("hex"), password = "A7-" + randomBytes(24).toString("hex"), opaque = "AF024_UNLABELLED_" + randomBytes(16).toString("hex"), canaries = [canary, opaque, password, keys.secret, initial.password, ...accounts.map(a => a.password)], tokens = {}, events = [], ids = [];
  const group = randomUUID(), time = new Date("2026-10-20T00:00:00.000Z"), R = "[REDACTED]", hashes = {}, protectedPaths = ["apps/api/src/audit-log/audit-query.service.ts", "apps/api/src/audit-log/audit-redaction.ts", "apps/api/src/auth/auth.service.ts", "apps/api/src/rbac/management-access.service.ts", "apps/api/prisma/schema.prisma"];
  const hash = p => createHash("sha256").update(readFileSync(p)).digest("hex"); for (const p of protectedPaths) hashes[p] = hash(p);
  const safe = value => { const text = JSON.stringify(value); for (const secret of canaries) assert.ok(!text.includes(secret), "No raw credential or canary in response"); assert.ok(!/\$2[aby]\$\d\d\$|passwordHash|password_hash/.test(text)); };
  const save = (name, value) => { safe(value); writeFileSync(join(directory, name + ".json"), JSON.stringify(value, null, 2) + "\n"); };
  for (const key of Object.keys(process.env)) delete process.env[key]; Object.assign(process.env, environment);
  const require = createRequire(join(repositoryRoot, "apps/api/package.json")), { createApplication } = require(join(repositoryRoot, "apps/api/dist/bootstrap.js")), { PrismaService } = require(join(repositoryRoot, "apps/api/dist/prisma/prisma.service.js")), { AuditQueryService } = require(join(repositoryRoot, "apps/api/dist/audit-log/audit-query.service.js")), { redactText } = require(join(repositoryRoot, "apps/api/dist/audit-log/audit-redaction.js")), { JwtService } = require("@nestjs/jwt");
  let app, prisma, queryService, rootUser, auditor, role, permission, hidden, poisoned, originals, created;
  async function request(path, expected, { token = tokens.root, method = "GET", body, correlationId = "af024-http" } = {}) {
    const r = await fetch("http://127.0.0.1:3656/api/" + path, { method, headers: { "x-correlation-id": correlationId, ...(token ? { authorization: "Bearer " + token } : {}), ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10000) });
    assert.equal(r.status, expected, method + " " + path.split("?")[0]); const result = await r.json(); if (result.data?.accessToken) canaries.push(result.data.accessToken); else safe(result);
    assert.equal(r.headers.get("cache-control"), "no-store"); events.push({ method, path: path.split("?")[0], queryKeys: [...new URL("http://local/" + path).searchParams.keys()], status: r.status }); return result.data;
  }
  const login = async account => (await request("auth/login", 200, { method: "POST", body: { username: account.username, password: account.password } })).accessToken;
  const list = (suffix = "", token = tokens.root) => request("admin/logs?resourceId=" + group + suffix, 200, { token });
  const detail = row => request("admin/logs/" + row.id, 200);
  try {
    app = await createApplication(); await app.listen(3656, "127.0.0.1"); prisma = app.get(PrismaService); queryService = app.get(AuditQueryService);
    await t.test("explicit non-reconciling Seed definition and only audit-read fixture grant exist", async () => {
      assert.deepEqual(seedArguments(["test", "--audit-logs"]), { mode: "test", acceptanceId: undefined, generateCredentials: false, auditLogs: true }); assert.throws(() => seedArguments(["test", "--audit-logs", "--audit-logs"]));
      tokens.root = await login(initial); tokens.auditor = await login(accounts[0]); tokens.reader = await login(accounts[1]);
      rootUser = await prisma.sysUser.findUniqueOrThrow({ where: { username: "aij-admin" } }); auditor = await prisma.sysUser.findUniqueOrThrow({ where: { username: "af024-auditor" } }); role = await prisma.sysRole.findUniqueOrThrow({ where: { roleCode: "af024_auditor" } }); permission = await prisma.sysPermission.findUniqueOrThrow({ where: { permissionCode: "admin.log.read" } });
      const grants = await prisma.sysRolePermission.count(); await prisma.sysPermission.update({ where: { id: permission.id }, data: { status: "disabled" } });
      try { await seedDatabase({ mode: "test", acceptanceId: lease.id, generateCredentials: true, auditLogs: true }); assert.equal((await prisma.sysPermission.findUniqueOrThrow({ where: { id: permission.id } })).status, "disabled"); } finally { await prisma.sysPermission.update({ where: { id: permission.id }, data: { status: "active" } }); }
      assert.equal(await prisma.sysRolePermission.count(), grants); const grantsForRole = await prisma.sysRolePermission.findMany({ where: { roleId: role.id } }); assert.deepEqual(grantsForRole.map(g => g.permissionId), [permission.id]); assert.equal(await prisma.scopedConfig.count(), 0); assert.equal(await prisma.secretReference.count(), 0);
    });
    await t.test("anonymous, ordinary role, foreign issuer and forged token reject both query entrances", async () => {
      const foreign = new JwtService().sign({ sub: rootUser.id, tokenKind: "admin", projectId: "foreign", environment: "test", permission: "admin.log.read" }, { secret: keys.secret, issuer: "urn:aij:foreign:test:api", audience: "urn:aij:foreign:test:admin", expiresIn: 60 }); canaries.push(foreign);
      for (const path of ["admin/logs", "admin/logs/unknown"]) { await request(path, 401, { token: null }); await request(path + "?permission=admin.log.read&workspaceId=owner", 403, { token: tokens.reader }); await request(path, 401, { token: foreign }); await request(path, 401, { token: "forged-token" }); }
      await request("admin/users", 403, { token: tokens.auditor, method: "POST", body: { username: "cannot-write", realName: "No grant", password } });
    });
    await t.test("real current login failure and management writes are queried from the sole persisted AuditLog", async () => {
      await request("auth/login", 401, { method: "POST", correlationId: "af024-actual-denial", body: { username: initial.username, password } });
      const failures = await request("admin/logs?module=auth&action=login_failed&status=failed&correlationId=af024-actual-denial", 200, { token: tokens.auditor }); assert.equal(failures.total, 1); assert.equal(failures.items[0].errorMessage, "invalid_credentials"); assert.equal(failures.items[0].requestSummary.correlationId, R);
      created = await request("admin/users", 201, { method: "POST", body: { username: "af024-created", realName: "AF024 Synthetic", password } }); await request("admin/users/" + created.id, 200, { method: "PATCH", body: { realName: "AF024 Changed" } });
      const history = await request("admin/logs?module=admin-users&resourceType=administrator&resourceId=" + created.id, 200, { token: tokens.auditor }); assert.equal(history.total, 2); assert.deepEqual(history.items.map(x => x.action).sort(), ["created", "updated"]); assert.ok(history.items.every(x => x.userId === rootUser.id)); assert.ok(history.items.some(x => x.requestSummary.fields.includes("realName"))); assert.equal(await prisma.auditLog.count({ where: { resourceId: created.id } }), 2);
      save("actual-writers", { failedLogin: failures.items, management: history.items, onlyExistingOwner: true });
    });
    await t.test("actual persisted hostile legacy snapshots and a foreign workspace row are isolated test data", async () => {
      for (let i = 0; i < 4; i++) { const id = randomUUID(); ids.push(id); await prisma.auditLog.create({ data: { id, module: i === 3 ? "menus" : "auth", action: i === 3 ? "menu_updated" : "login_failed", status: ["failed", "success", "error", "failed"][i], userId: i === 3 ? auditor.id : rootUser.id, resourceType: "admin-auth", resourceId: group, createdAt: new Date(time.getTime() + (i === 0 ? -1000 : i === 3 ? 1000 : 0)),
        userName: opaque, ip: canary, userAgent: "Bearer " + canary, path: "/api/auth/login?password=" + canary + "#" + opaque, method: "POST", errorMessage: "password=" + canary,
        requestSummary: { fields: ["status", opaque], requiredPermissions: ["admin.log.read", opaque], permissionIdsBefore: [rootUser.id, canary, 123], correlationId: "af024-fixture", authorization: "Bearer " + canary, [opaque]: canary, nested: { api_key: canary, cookies: [canary] } },
        beforeData: { status: "active", password: canary, nested: { values: [opaque, { otp: 123456, certificate: "-----BEGIN PRIVATE KEY-----" + canary + "-----END PRIVATE KEY-----" }] } }, afterData: [opaque, { token: canary, plain: opaque, key: canary }] } }); }
      hidden = await prisma.auditLog.create({ data: { module: "auth", action: "login", resourceType: "admin-auth", resourceId: group, workspaceId: "foreign-workspace", requestSummary: { password: canary } } });
      poisoned = await prisma.auditLog.create({ data: { module: opaque, action: canary, status: canary, userId: canary, userName: canary, resourceType: canary, resourceId: canary, method: canary, path: "https://user:" + canary + "@example.invalid/" + opaque, requestSummary: opaque, beforeData: { [opaque]: canary }, errorMessage: canary, ip: opaque, userAgent: opaque } });
      originals = await prisma.auditLog.findMany({ where: { id: { in: [...ids, hidden.id, poisoned.id] } }, orderBy: { id: "asc" } }); assert.ok(originals.some(row => JSON.stringify(row).includes(canary)), "Fixture is truly persisted before projection");
    });
    await t.test("stable time/id pagination, totals, boundary pages and exact filters query real rows", async () => {
      const expected = [...originals].filter(x => ids.includes(x.id)).sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id)).map(x => x.id), first = await list("&pageSize=2", tokens.auditor), second = await list("&pageSize=2&page=2", tokens.auditor);
      assert.equal(first.total, 4); assert.deepEqual([...first.items, ...second.items].map(x => x.id), expected); assert.deepEqual((await list("&pageSize=2")).items, first.items); assert.deepEqual((await list("&page=10000")).items, []);
      assert.equal((await list("&module=auth")).total, 3); assert.equal((await list("&action=menu_updated")).total, 1); assert.equal((await list("&status=error")).total, 1); assert.equal((await list("&userId=" + auditor.id)).total, 1); assert.equal((await list("&resourceType=admin-auth")).total, 4); assert.equal((await list("&correlationId=af024-fixture")).total, 4); assert.equal((await list("&module=none")).total, 0);
      save("pagination", { expectedIds: expected, first, second, boundaryPageEmpty: true });
    });
    await t.test("inclusive UTC/offset time bounds and reversed or invalid intervals are explicit", async () => {
      const range = "&startAt=" + encodeURIComponent(time.toISOString()) + "&endAt=" + encodeURIComponent(time.toISOString()); assert.equal((await list(range)).total, 2);
      const offset = "2026-10-20T08:00:00+08:00"; assert.equal((await list("&startAt=" + encodeURIComponent(offset) + "&endAt=" + encodeURIComponent(offset))).total, 2);
      for (const q of ["startAt=tomorrow", "startAt=2026-02-30T00:00:00Z", "startAt=2026-10-20", "startAt=2026-10-20T00:00:00", "startAt=2026-10-21T00:00:00Z&endAt=2026-10-20T00:00:00Z"]) await request("admin/logs?" + q, 400);
    });
    await t.test("list AND detail hide nested/array/unlabelled credential values and unsafe metadata while preserving safe context", async () => {
      for (const row of (await list()).items) { assert.ok(row.beforeData === R && row.afterData === R); assert.ok(row.userName === R && row.ip === R && row.userAgent === R && row.errorMessage === R); assert.equal(row.path, "/api/auth/login"); assert.deepEqual(row.requestSummary.fields, ["status"]); assert.deepEqual(row.requestSummary.requiredPermissions, ["admin.log.read"]); assert.deepEqual(row.requestSummary.permissionIdsBefore, [rootUser.id, R, R]); assert.equal(row.requestSummary.correlationId, R); const one = await detail(row); assert.deepEqual(one, row); }
      const unknown = await detail(poisoned); for (const key of ["module", "action", "status", "userId", "userName", "resourceType", "resourceId", "path", "requestSummary", "beforeData", "errorMessage", "ip", "userAgent"]) assert.ok(unknown[key] === R, "Unknown/free metadata is hidden"); assert.equal(unknown.method, null); assert.equal(unknown.redacted, true);
      save("redaction", { detail: await detail({ id: ids[0] }), unknown: await detail(poisoned), secretAndFreeSnapshotsHidden: true });
    });
    await t.test("source text redaction handles bearer/key, assignments and multiline PEM without affecting harmless metadata", () => {
      for (const input of ["Bearer " + canary, "sk-" + canary, "password=" + canary, "cookie=" + canary, "-----BEGIN PRIVATE KEY-----\n" + canary + "\n-----END PRIVATE KEY-----"]) assert.ok(!redactText(input).includes(canary)); assert.equal(redactText("login_failed"), "login_failed");
    });
    await t.test("unimplemented workspace/raw/export controls and malformed paging/filters never broaden the read surface", async () => {
      for (const q of ["page=0", "page=-1", "page=10001", "pageSize=0", "pageSize=101", "pageSize=NaN", "status=active", "workspaceId=foreign-workspace", "raw=true", "includeSensitive=true", "export=true", "operatorName=any", "orderBy=password", "correlationId=x", "module=" + encodeURIComponent("Bearer " + canary)]) await request("admin/logs?" + q, 400);
      await request("admin/logs/" + hidden.id, 404); await request("admin/logs/unknown", 404); assert.equal((await list()).total, 4);
    });
    await t.test("successful list/detail operations preserve raw history and do not append recursive query audits or offer write endpoints", async () => {
      const count = await prisma.auditLog.count(); for (const token of [tokens.root, tokens.auditor]) { await list("", token); await request("admin/logs/" + ids[0], 200, { token }); }
      for (const [path, method] of [["admin/logs", "POST"], ["admin/logs/" + ids[0], "PATCH"], ["admin/logs/" + ids[0], "DELETE"]]) await request(path, 404, { method, body: { status: "success", password } });
      assert.equal(await prisma.auditLog.count(), count); assert.deepEqual(await prisma.auditLog.findMany({ where: { id: { in: originals.map(x => x.id) } }, orderBy: { id: "asc" } }), originals);
    });
    await t.test("same JWT revocation/role disable/permission disable reject immediately and the exported service rechecks authorization", async () => {
      await prisma.sysRolePermission.deleteMany({ where: { roleId: role.id, permissionId: permission.id } });
      try { await request("admin/logs", 403, { token: tokens.auditor }); let denied = false; try { await queryService.list({ page: 1, pageSize: 20 }, auditor.id); } catch (e) { denied = e.getStatus?.() === 403; } assert.ok(denied); }
      finally { await prisma.sysRolePermission.create({ data: { roleId: role.id, permissionId: permission.id } }); }
      await prisma.sysRole.update({ where: { id: role.id }, data: { status: "disabled" } }); try { await request("admin/logs", 403, { token: tokens.auditor }); } finally { await prisma.sysRole.update({ where: { id: role.id }, data: { status: "active" } }); }
      await prisma.sysPermission.update({ where: { id: permission.id }, data: { status: "disabled" } }); try { await request("admin/logs", 403); } finally { await prisma.sysPermission.update({ where: { id: permission.id }, data: { status: "active" } }); } await list("", tokens.auditor);
      const denials = await request("admin/logs?module=rbac&action=permission_denied&status=failed", 200); assert.ok(denials.items.some(x => x.requestSummary.requiredPermissions.includes("admin.log.read"))); safe(denials);
    });
    await t.test("real database outage returns safe 503 and recovery restores query/readiness while liveness stays 200", async () => {
      await prisma.$disconnect(); await setTaskDatabaseConnections(lease.id, false, "AF-024");
      try { await request("admin/logs", 503); assert.equal((await fetch("http://127.0.0.1:3656/api/health")).status, 200); assert.equal((await fetch("http://127.0.0.1:3656/api/ready")).status, 503); }
      finally { await setTaskDatabaseConnections(lease.id, true, "AF-024"); } await waitReady(); await list();
    });
    await t.test("no schema/source probe or history rewrite; actual app shutdown closes its one real pool", async () => {
      assert.deepEqual(await prisma.auditLog.findMany({ where: { id: { in: originals.map(x => x.id) } }, orderBy: { id: "asc" } }), originals); for (const [p, before] of Object.entries(hashes)) assert.equal(hash(p), before);
      await app.close(); app = undefined; assert.deepEqual(await applicationSessions(lease.id, "AF-024"), []); save("result", { task: "AF-024", acceptanceId: lease.id, database: lease.database, events, rawHistoryPreserved: true, noSourceProbe: true, pool: 0 });
    });
  } finally { if (app) await app.close(); for (const key of Object.keys(process.env)) delete process.env[key]; Object.assign(process.env, original); }
});
