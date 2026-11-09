import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";
import { createAcceptance, migrate } from "../database/migration.mjs";
import { seedDatabase } from "../database/seed.mjs";
import { repositoryRoot, readDatabaseEnvironment, withDatabase } from "../database/connection.mjs";
import { authEnvironment, authKeys } from "./auth-support.mjs";
import { applicationSessions, setTaskDatabaseConnections } from "./readiness-support.mjs";
import { assertPortAvailable } from "../port-availability.mjs";

test("AF-026 real administrator sessions, revocation and atomic credential changes", { timeout: 90000 }, async t => {
  await assertPortAvailable(3656);
  const parent = join(repositoryRoot, ".artifacts/ui-1/af-026"); mkdirSync(parent, { recursive: true });
  const root = mkdtempSync(join(parent, "run-"));
  const original = { ...process.env }, secrets = [];
  const lease = await createAcceptance("test", "AF-026");
  await migrate({ mode: "test", action: "deploy", acceptanceId: lease.id });
  await migrate({ mode: "test", action: "deploy", acceptanceId: lease.id });
  await migrate({ mode: "test", action: "status", acceptanceId: lease.id });
  const seed = await seedDatabase({ mode: "test", acceptanceId: lease.id, generateCredentials: true, adminUsers: true });
  const initial = JSON.parse(readFileSync(seed.credentials.file)), keys = authKeys(lease.id, "AF-026");
  secrets.push(initial.password, keys.secret);
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, authEnvironment(lease.id, keys.secret, "AF-026"));
  const require = createRequire(join(repositoryRoot, "apps/api/package.json"));
  const { createApplication } = require(join(repositoryRoot, "apps/api/dist/bootstrap.js"));
  const { PrismaService } = require(join(repositoryRoot, "apps/api/dist/prisma/prisma.service.js"));
  const { JwtService } = require("@nestjs/jwt"), jwt = new JwtService();
  const password = randomBytes(24).toString("base64url") + "aA1!", newPassword = randomBytes(24).toString("base64url") + "bB2!";
  secrets.push(password, newPassword);
  let app, prisma, admin, memberId, first, second;
  const query = fn => withDatabase("test", readDatabaseEnvironment("test", process.env, lease.id), fn, { acceptanceId: lease.id });
  async function request(path, status, { token, method = "GET", body } = {}) {
    const response = await fetch("http://127.0.0.1:3656/api/" + path, { method, headers: { connection: "close", "x-correlation-id": "ui1-admin-session-check", ...(token ? { authorization: "Bearer " + token } : {}), ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(8000) });
    assert.equal(response.status, status, path + " HTTP status");
    const json = await response.json();
    if (json.data?.accessToken) secrets.push(json.data.accessToken);
    const safe = { ...json, data: json.data?.accessToken ? { ...json.data, accessToken: "[REDACTED]" } : json.data };
    for (const secret of secrets) assert.ok(!JSON.stringify(safe).includes(secret), "No credentials in safe responses");
    assert.ok(!/\$2[aby]\$\d\d\$/.test(JSON.stringify(safe)), "No password hash exposed");
    return json.data;
  }
  const login = async (username = initial.username, value = initial.password) => (await request("auth/login", 200, { method: "POST", body: { username, password: value } })).accessToken;
  const me = (token, status = 200) => request("auth/me", status, { token });
  const sign = async (token, changes = {}, options = {}) => {
    const { iat: _iat, exp: _exp, iss: _iss, aud: _aud, ...claims } = jwt.decode(token);
    void _iat; void _exp; void _iss; void _aud;
    const result = await jwt.signAsync({ ...claims, ...changes }, { secret: keys.secret, algorithm: "HS256", issuer: "urn:aij:aij-foundation:test:api", audience: "urn:aij:aij-foundation:test:admin", expiresIn: 900, ...options }); secrets.push(result); return result;
  };
  try {
    app = await createApplication(); await app.listen(3656, "127.0.0.1"); prisma = app.get(PrismaService);
    await t.test("additive migration deploy twice/status; real persisted sessions and safe profile", async () => {
      admin = await login(); await me(admin);
      assert.equal((await request("ready", 200)).reason, "READY");
      memberId = (await request("admin/users", 201, { token: admin, method: "POST", body: { username: "ui1-session-member", realName: "UI1 synthetic", password } })).id;
      first = await login("ui1-session-member", password); second = await login("ui1-session-member", password);
      assert.equal(await prisma.adminAuthSession.count({ where: { userId: memberId } }), 2);
      assert.notEqual(jwt.decode(first).sessionId, jwt.decode(second).sessionId);
      await query(async c => { const rows = (await c.query("SELECT migration_name FROM public._prisma_migrations WHERE finished_at IS NOT NULL")).rows; assert.ok(rows.some(r => r.migration_name === "20261027000000_admin_sessions")); });
    });
    await t.test("401 without session, wrong scope/claims/transport and database session binding; ordinary role 403", async () => {
      await me(undefined, 401);
      for (const [claims, options] of [[{ sessionId: undefined }, {}], [{ tokenVersion: undefined }, {}], [{ tokenVersion: 9 }, {}], [{ transport: "cookie" }, {}], [{ sessionId: jwt.decode(admin).sessionId }, {}], [{ projectId: "other" }, {}], [{}, { audience: "other" }], [{}, { issuer: "other" }], [{}, { expiresIn: -1 }]]) await me(await sign(first, claims, options), 401);
      await request("admin/users", 403, { token: first });
      await request("auth/password", 400, { token: first, method: "POST", body: { currentPassword: password, newPassword, workspaceId: "self-reported" } });
    });
    await t.test("logout revokes only the authenticated session; other session and administrator survive", async () => {
      await request("auth/logout", 200, { token: first, method: "POST" }); await me(first, 401); await me(second); await me(admin);
      assert.equal((await prisma.adminAuthSession.findUniqueOrThrow({ where: { id: jwt.decode(first).sessionId } })).revokeReason, "logout");
      await request("auth/logout", 401, { token: first, method: "POST" });
    });
    await t.test("wrong current credential, weak password and password reuse do not mutate identity", async () => {
      const before = await prisma.sysUser.findUniqueOrThrow({ where: { id: memberId } });
      await request("auth/password", 401, { token: second, method: "POST", body: { currentPassword: "invalid", newPassword } });
      await request("auth/password", 400, { token: second, method: "POST", body: { currentPassword: password, newPassword: "password" } });
      await request("auth/password", 409, { token: second, method: "POST", body: { currentPassword: password, newPassword: password } });
      const after = await prisma.sysUser.findUniqueOrThrow({ where: { id: memberId } });
      assert.ok(before.passwordHash === after.passwordHash && before.tokenVersion === after.tokenVersion); await me(second);
    });
    await t.test("audit failure rolls back logout and password/version/session mutation", async () => {
      await query(c => c.query("ALTER TABLE public.audit_log ADD CONSTRAINT ui1_reject_session_audit CHECK (action NOT IN ('logout','password_changed')) NOT VALID"));
      try {
        const before = await prisma.sysUser.findUniqueOrThrow({ where: { id: memberId } });
        await request("auth/logout", 503, { token: second, method: "POST" }); await me(second);
        await request("auth/password", 503, { token: second, method: "POST", body: { currentPassword: password, newPassword } }); await me(second);
        const after = await prisma.sysUser.findUniqueOrThrow({ where: { id: memberId } }); assert.ok(before.passwordHash === after.passwordHash && before.tokenVersion === after.tokenVersion);
      } finally { await query(c => c.query("ALTER TABLE public.audit_log DROP CONSTRAINT ui1_reject_session_audit")); }
    });
    await t.test("password change commits secure hash and invalidates all old sessions, including current", async () => {
      const extra = await login("ui1-session-member", password);
      await request("auth/password", 200, { token: second, method: "POST", body: { currentPassword: password, newPassword } });
      for (const token of [first, second, extra]) await me(token, 401);
      await request("auth/login", 401, { method: "POST", body: { username: "ui1-session-member", password } });
      second = await login("ui1-session-member", newPassword); await me(second); await me(admin);
      const bcrypt = require("bcryptjs"), user = await prisma.sysUser.findUniqueOrThrow({ where: { id: memberId } });
      assert.equal(bcrypt.getRounds(user.passwordHash), 12); assert.ok(await bcrypt.compare(newPassword, user.passwordHash));
    });
    await t.test("controlled reset and disable/enable cannot revive old sessions; self-disable still rejected", async () => {
      await request("admin/users/" + memberId + "/reset-password", 200, { token: admin, method: "PATCH", body: { password } }); await me(second, 401);
      first = await login("ui1-session-member", password);
      await request("admin/users/" + memberId + "/status", 200, { token: admin, method: "PATCH", body: { enabled: false } }); await me(first, 401);
      await request("admin/users/" + memberId + "/status", 200, { token: admin, method: "PATCH", body: { enabled: true } }); await me(first, 401);
      second = await login("ui1-session-member", password); await me(second);
      await request("admin/users/" + jwt.decode(admin).sub + "/status", 409, { token: admin, method: "PATCH", body: { enabled: false } });
    });
    await t.test("DB expiry and namespace are authoritative; no plaintext token in persistence/audit", async () => {
      const id = jwt.decode(second).sessionId, before = await prisma.adminAuthSession.findUniqueOrThrow({ where: { id } });
      await prisma.adminAuthSession.update({ where: { id }, data: { namespace: "other-project:test" } }); await me(second, 401);
      await prisma.adminAuthSession.update({ where: { id }, data: { namespace: before.namespace, expiresAt: new Date(0) } }); await me(second, 401);
      await prisma.adminAuthSession.update({ where: { id }, data: { expiresAt: before.expiresAt } }); await me(second);
      const audits = await prisma.auditLog.findMany();
      for (const action of ["login", "logout", "password_changed", "password_change_failed", "password_reset", "disabled"]) assert.ok(audits.some(row => row.action === action));
      const text = JSON.stringify({ audits, sessions: await prisma.adminAuthSession.findMany() }); for (const secret of secrets) assert.ok(!text.includes(secret)); assert.ok(!/\$2[aby]\$/.test(text));
    });
    await t.test("real database outage returns 503, liveness 200, recovery authenticates current session", async () => {
      await prisma.$disconnect(); await setTaskDatabaseConnections(lease.id, false, "AF-026");
      try { await me(second, 503); await request("health", 200); }
      finally { await setTaskDatabaseConnections(lease.id, true, "AF-026"); }
      await me(second); await request("ready", 200);
    });
    await t.test("application close leaves zero owned pools and retains redacted evidence", async () => {
      await app.close(); app = undefined; assert.deepEqual(await applicationSessions(lease.id, "AF-026"), []);
      writeFileSync(join(root, "result.json"), JSON.stringify({ task: "AF-026", database: lease.database, acceptanceId: lease.id, migration: "20261027000000_admin_sessions", assertions: "HTTP/DB session issue/check/logout/password/reset/disable/scope/expiry/audit atomicity/outage/recovery/zero pools", rawTokensRetained: false, credentialsFile: seed.credentials.file, status: "CLOSED_ZERO_POOLS_SEE_TEST_REPORT_FOR_OVERALL_RESULT" }, null, 2) + "\n");
    });
  } finally {
    if (app) await app.close();
    await setTaskDatabaseConnections(lease.id, true, "AF-026");
    for (const key of Object.keys(process.env)) delete process.env[key]; Object.assign(process.env, original);
  }
});
