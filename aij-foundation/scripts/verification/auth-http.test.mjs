import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";
import { createAcceptance, migrate } from "../database/migration.mjs";
import { seedDatabase } from "../database/seed.mjs";
import { profile, readDatabaseEnvironment, repositoryRoot, withDatabase } from "../database/connection.mjs";
import { assertPortAvailable } from "../port-availability.mjs";
import { applicationSessions, setTaskDatabaseConnections } from "./readiness-support.mjs";
import { authEnvironment, authKeys } from "./auth-support.mjs";
import { assertClientWorkspacePermissionBaseline, clientWorkspacePermissionBaselineSql } from "./client-workspace-permission-baseline.mjs";

test("real seeded administrator login, scoped JWT guard, safe audit and shutdown", { timeout: 55000 }, async t => {
  await assertPortAvailable(3656);
  const parent = join(repositoryRoot, ".artifacts/af-013/http"); mkdirSync(parent, { recursive: true }); const root = mkdtempSync(join(parent, "run-"));
  const save = (name, data) => writeFileSync(join(root, name + ".json"), JSON.stringify(data, null, 2) + "\n");
  const protectedPaths = ["apps/api/src/auth/auth.service.ts", "apps/api/src/common/guards/jwt-auth.guard.ts", "apps/api/src/prisma/prisma.service.ts", "apps/api/prisma/schema.prisma", "apps/api/prisma/migrations/20261019000000_initial/migration.sql", ...["dev", "test"].flatMap(m => [profile(m).secretFile, profile(m).stateFile])];
  const hash = p => createHash("sha256").update(readFileSync(p)).digest("hex"), beforeHashes = protectedPaths.map(hash);
  const original = { ...process.env }, secrets = ["dev", "test"].map(m => readFileSync(profile(m).secretFile, "utf8").trim());
  const lease = await createAcceptance("test", "AF-013"); await migrate({ mode: "test", action: "deploy", acceptanceId: lease.id });
  const seed = await seedDatabase({ mode: "test", acceptanceId: lease.id, generateCredentials: true }); const password = JSON.parse(readFileSync(seed.credentials.file)).password;
  const keys = authKeys(lease.id); secrets.push(password, keys.secret);
  const setEnvironment = value => { for (const key of Object.keys(process.env)) delete process.env[key]; Object.assign(process.env, value); };
  setEnvironment(authEnvironment(lease.id, keys.secret));
  const require = createRequire(join(repositoryRoot, "apps/api/package.json")), { JwtService } = require("@nestjs/jwt"), jwt = new JwtService();
  const { createApplication } = require(join(repositoryRoot, "apps/api/dist/bootstrap.js")), { PrismaService } = require(join(repositoryRoot, "apps/api/dist/prisma/prisma.service.js"));
  let app, prisma, token, userId, empty;
  const query = operation => withDatabase("test", readDatabaseEnvironment("test", process.env, lease.id), operation, { acceptanceId: lease.id });
  async function request(path, status, { method = "GET", body, authorization, cookie, raw } = {}) {
    const response = await fetch("http://127.0.0.1:3656/api/" + path, { method, headers: { "x-correlation-id": "af013-real-http-check", ...(body !== undefined || raw !== undefined ? { "content-type": "application/json" } : {}), ...(authorization ? { authorization } : {}), ...(cookie ? { cookie } : {}) }, body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined), signal: AbortSignal.timeout(8000) });
    assert.ok(response.status === status, "Expected HTTP " + status + " from " + path.split("?")[0] + "; got " + response.status);
    assert.equal(response.headers.get("x-correlation-id"), "af013-real-http-check");
    const result = await response.json();
    if (result.data?.accessToken) secrets.push(result.data.accessToken);
    if (path.startsWith("auth")) {
      for (const value of [password, keys.secret]) assert.ok(!JSON.stringify(result).includes(value), "No credential in auth response");
      assert.ok(!/\$2[aby]\$\d\d\$/.test(JSON.stringify(result)), "No password hash in response");
    }
    return { result, headers: response.headers };
  }
  const login = (username = "aij-admin", value = password, expected = 200) => request("auth/login", expected, { method: "POST", body: { username, password: value } });
  const signed = async (payload = {}, options = {}) => {
    const value = await jwt.signAsync({ sessionId: token ? jwt.decode(token).sessionId : undefined, tokenVersion: 0, transport: "bearer", sub: userId, tokenKind: "admin", projectId: "aij-foundation", environment: "test", ...payload }, { secret: keys.secret, algorithm: "HS256", issuer: "urn:aij:aij-foundation:test:api", audience: "urn:aij:aij-foundation:test:admin", expiresIn: 900, ...options });
    secrets.push(value); return "Bearer " + value;
  };
  try {
    app = await createApplication(); await app.listen(3656, "127.0.0.1"); prisma = app.get(PrismaService);
    await t.test("real Seed and singleton Prisma provide process health and database readiness", async () => {
      assert.equal((await request("health", 200)).result.data.database, "configured"); assert.equal((await request("ready", 200)).result.data.reason, "READY");
      assert.equal(app.get(PrismaService), prisma); save("seed", { database: lease.database, id: lease.id, username: "aij-admin", initialPasswordFile: seed.credentials.file, jwtKeyFile: keys.path });
    });
    await t.test("bounded DTO and malformed JSON return sanitized 400 including multibyte bcrypt overflow", async () => {
      for (const body of [{}, { username: true, password }, { username: "aij-admin", password: [] }, { username: "x".repeat(65), password }, { username: "aij-admin", password: "x".repeat(73) }, { username: "aij-admin", password: "密".repeat(25) }]) await request("auth/login", 400, { method: "POST", body });
      const malformed = await request("auth/login", 400, { method: "POST", raw: '{"password":"' + password + '" invalid-json' }); save("invalid-input", { malformed: malformed.result, cases: 7 });
    });
    await t.test("wrong password and unknown administrator return indistinguishable 401 without an access token", async () => {
      const bad = await login("aij-admin", "bad-password", 401), missing = await login("af013-missing", password, 401);
      assert.ok(JSON.stringify(bad.result) === JSON.stringify(missing.result), "Credential failures are uniform"); assert.equal(bad.result.success, false); save("bad-credentials", bad.result);
    });
    await t.test("successful login signs scoped HS256/15-minute JWT, updates last login and authenticates me", async () => {
      const response = await login(); const data = response.result.data; token = data.accessToken; userId = data.user.id;
      assert.equal(response.headers.get("cache-control"), "no-store"); assert.equal(data.tokenType, "Bearer"); assert.equal(data.expiresIn, 900);
      const payload = await jwt.verifyAsync(token, { secret: keys.secret, issuer: "urn:aij:aij-foundation:test:api", audience: "urn:aij:aij-foundation:test:admin", algorithms: ["HS256"] });
      assert.equal(payload.sub, userId); assert.equal(payload.tokenKind, "admin"); assert.equal(payload.projectId, "aij-foundation"); assert.equal(payload.environment, "test"); assert.equal(payload.exp - payload.iat, 900); assert.ok(!("roles" in payload) && !("passwordHash" in payload));
      const me = await request("auth/me", 200, { authorization: "Bearer " + token }); assert.deepEqual(me.result.data, data.user); assert.equal(me.headers.get("cache-control"), "no-store");
      assert.deepEqual(Object.keys(data.user).sort(), ["id", "isSuperAdmin", "realName", "username"]);
      await query(async client => assert.ok((await client.query("SELECT last_login_at FROM public.sys_user WHERE id=$1", [userId])).rows[0].last_login_at));
      save("login", { accessToken: "[REDACTED]", jwtVerified: true, claimNames: Object.keys(payload).sort(), expiresIn: data.expiresIn, user: data.user, me: me.result });
    });
    await t.test("missing/malformed, cookie and URL tokens do not authenticate and errors keep correlation", async () => {
      await request("auth/me", 401); for (const authorization of ["Basic abc", "Bearer a.b.c", "Bearer " + token + ", Bearer " + token, "Bearer " + token + " extra"]) await request("auth/me", 401, { authorization });
      await request("auth/me?accessToken=" + encodeURIComponent(token), 401); await request("auth/me", 401, { cookie: "admin_access_token=" + token }); save("bearer-required", { cases: 7, status: 401, correlation: true });
    });
    await t.test("cryptographically signed wrong product/environment/issuer/audience/kind/algorithm and expired tokens all fail", async () => {
      for (const [payload, options] of [[{}, { issuer: "qingqi-api" }], [{ projectId: "other" }, {}], [{ environment: "development" }, {}], [{ tokenKind: "client" }, {}], [{}, { audience: "client" }], [{}, { algorithm: "HS384" }], [{}, { expiresIn: -1 }], [{}, { expiresIn: 3600 }], [{ sub: "missing-identity" }, {}]]) await request("auth/me", 401, { authorization: await signed(payload, options) });
      await request("auth/me", 401, { authorization: await signed({}, { secret: randomBytes(32).toString("hex") }) });
      await request("auth/me", 401, { authorization: await signed({}, { noTimestamp: true }) });
      const parts = token.split("."); parts[1] = Buffer.from(JSON.stringify({ sub: "forged-admin" })).toString("base64url"); const forged = parts.join("."); secrets.push(forged); await request("auth/me", 401, { authorization: "Bearer " + forged });
      save("jwt-rejection", { cases: 12, status: 401, fixtures: "locally signed synthetic JWTs; no client or source product auth integration claimed" });
    });
    await t.test("disabled/soft-deleted administrator rejects both existing JWT and fresh login; current DB profile wins", async () => {
      await prisma.sysUser.update({ where: { id: userId }, data: { status: "disabled" } });
      try { await request("auth/me", 401, { authorization: "Bearer " + token }); await login("aij-admin", password, 401); } finally { await prisma.sysUser.update({ where: { id: userId }, data: { status: "active" } }); }
      await prisma.sysUser.update({ where: { id: userId }, data: { deletedAt: new Date() } });
      try { await request("auth/me", 401, { authorization: "Bearer " + token }); await login("aij-admin", password, 401); } finally { await prisma.sysUser.update({ where: { id: userId }, data: { deletedAt: null } }); }
      await prisma.sysUser.update({ where: { id: userId }, data: { realName: "AF013 current profile", isSuperAdmin: false } });
      try { const me = await request("auth/me", 200, { authorization: await signed({ isSuperAdmin: true, roles: ["super_admin"] }) }); assert.equal(me.result.data.isSuperAdmin, false); assert.equal(me.result.data.realName, "AF013 current profile"); } finally { await prisma.sysUser.update({ where: { id: userId }, data: { realName: "AIJ 初始管理员", isSuperAdmin: true } }); }
      save("current-identity", { statusAndDeletionChecked: true, clientClaimsDoNotGrantRole: true });
    });
    await t.test("Seed rerun preserves password/roles/last-login and existing audit rows", async () => {
      const before = await prisma.sysUser.findUniqueOrThrow({ where: { id: userId } }); const auditCount = await prisma.auditLog.count(); const roles = await prisma.sysUserRole.findMany();
      await seedDatabase({ mode: "test", acceptanceId: lease.id });
      const after = await prisma.sysUser.findUniqueOrThrow({ where: { id: userId } }); assert.ok(JSON.stringify(before) === JSON.stringify(after), "Seed preserves complete administrator record without printing its hash"); assert.deepEqual(await prisma.sysUserRole.findMany(), roles); assert.equal(await prisma.auditLog.count(), auditCount);
      save("seed-preserved", { passwordAndLastLoginStable: true, rolesAndAuditStable: true });
    });
    await t.test("real own logical DB outage returns 503 for auth, health stays 200, restore recovers", async () => {
      await prisma.$disconnect(); assert.deepEqual(await applicationSessions(lease.id, "AF-013"), []); await setTaskDatabaseConnections(lease.id, false, "AF-013");
      try { await login("aij-admin", password, 503); await request("auth/me", 503, { authorization: "Bearer " + token }); await request("health", 200); }
      finally { await setTaskDatabaseConnections(lease.id, true, "AF-013"); }
      await request("ready", 200); await request("auth/me", 200, { authorization: "Bearer " + token }); save("outage", { authUnavailable: 503, liveness: 200, recovered: 200, containerStopped: false });
    });
    await t.test("real audit records contain correlation/status only, no passwords/hash/full JWT; unrelated tables remain empty", async () => {
      const rows = await prisma.auditLog.findMany(); assert.ok(rows.some(r => r.action === "login" && r.status === "success")); assert.ok(rows.some(r => r.action === "login_failed" && r.status === "failed"));
      const text = JSON.stringify(rows); for (const value of secrets) assert.ok(!text.includes(value), "No credential/JWT in audit records"); assert.ok(!/\$2[aby]\$\d\d\$/.test(text));
      assert.ok(rows.every(r => r.requestSummary.correlationId === "af013-real-http-check"));
      const { Prisma } = require("@prisma/client"); await query(async client => {
        assertClientWorkspacePermissionBaseline((await client.query(clientWorkspacePermissionBaselineSql)).rows);
        for (const m of Prisma.dmmf.datamodel.models) {
          if (m.name === "ClientWorkspacePermission") continue; // Exact catalog assertion above; all other business tables stay empty.
          if (!["SysUser", "SysRole", "SysPermission", "SysUserRole", "SysRolePermission", "ProjectProfile", "OrganizationProfile", "AuditLog", "AdminAuthSession"].includes(m.name)) assert.equal((await client.query('SELECT count(*)::int AS count FROM public."' + m.dbName + '"')).rows[0].count, 0, m.name + " must remain empty");
        }
      });
      save("audit", { rows: rows.length, successAndFailure: true, correlationChecked: true, sensitiveValuesAbsent: true });
    });
    await t.test("app.close disconnects pool; new empty DB cannot authenticate without migrations", async () => {
      await app.close(); app = undefined; assert.deepEqual(await applicationSessions(lease.id, "AF-013"), []);
      empty = await createAcceptance("test", "AF-013"); setEnvironment(authEnvironment(empty.id, keys.secret)); app = await createApplication(); await app.listen(3656, "127.0.0.1");
      assert.equal((await request("ready", 503)).result.data.reason, "MIGRATIONS_MISSING"); await login("aij-admin", password, 503); await request("health", 200); await app.close(); app = undefined;
      assert.deepEqual(await applicationSessions(empty.id, "AF-013"), []); save("missing-migration", { database: empty.database, ready: 503, login: 503, pools: 0 });
    });
    await t.test("auth disabled removes routes in the same process and does not require active secrets", async () => {
      setEnvironment({ ...authEnvironment(lease.id, "template"), AUTH_ENABLED: "false", DATABASE_ENABLED: "false" }); app = await createApplication(); await app.listen(3656, "127.0.0.1");
      await request("auth/login", 404, { method: "POST", body: {} }); await request("auth/me", 404); await request("health", 200); await app.close(); app = undefined;
      assert.deepEqual(protectedPaths.map(hash), beforeHashes); assert.deepEqual(await applicationSessions(lease.id, "AF-013"), []);
      for (const name of readdirSync(root).filter(n => n.endsWith(".json") && !n.startsWith("._"))) { const text = readFileSync(join(root, name), "utf8"); for (const secret of secrets) assert.ok(!text.includes(secret), "No credential/JWT in retained evidence"); }
      save("result", { database: lease.database, emptyDatabase: empty.database, poolsClosed: true, sourceAndManagedCredentialsUnchanged: true, tokenOrPasswordLogged: false, activeAccount: "aij-admin" });
    });
  } finally {
    if (app) await app.close(); await setTaskDatabaseConnections(lease.id, true, "AF-013"); setEnvironment(original);
  }
});
