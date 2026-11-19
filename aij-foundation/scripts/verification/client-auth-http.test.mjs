import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";
import { createAcceptance, migrate } from "../database/migration.mjs";
import { readDatabaseEnvironment, repositoryRoot, withDatabase } from "../database/connection.mjs";
import { assertPortAvailable } from "../port-availability.mjs";
import { applicationSessions, setTaskDatabaseConnections } from "./readiness-support.mjs";
import { clientEnvironment, clientKeys, clientTask, prepareClientFixture } from "./client-auth-fixture.mjs";
import environment from "../runtime-environment.cjs";

test("real customer login, persisted sessions, project isolation and fail-closed authentication", { timeout: 55000 }, async t => {
  await assertPortAvailable(3656);
  const directory = join(repositoryRoot, ".artifacts/af-025-a/http"); mkdirSync(directory, { recursive: true }); const output = mkdtempSync(join(directory, "run-"));
  const save = (name, value) => writeFileSync(join(output, name + ".json"), JSON.stringify(value, null, 2) + "\n");
  const protectedFiles = ["apps/api/prisma/schema.prisma", "apps/api/prisma/migrations/20261019000000_initial/migration.sql", "apps/api/src/prisma/prisma.service.ts", "apps/api/src/auth/auth.service.ts"];
  const hash = file => createHash("sha256").update(readFileSync(file)).digest("hex"), hashes = protectedFiles.map(hash);
  const original = { ...process.env }, setEnv = value => { for (const key of Object.keys(process.env)) delete process.env[key]; Object.assign(process.env, value); };
  const lease = await createAcceptance("test", clientTask); await migrate({ mode: "test", action: "deploy", acceptanceId: lease.id });
  const fixture = await prepareClientFixture(lease.id), accounts = JSON.parse(readFileSync(fixture.accounts[0].initialPasswordFile)).accounts, [account, other] = accounts;
  const keys = clientKeys(lease.id), values = clientEnvironment(lease.id), secrets = [account.password, other.password, values.JWT_SECRET, ...Object.values(keys.value).filter(v => typeof v === "string" && v.length === 64)];
  const require = createRequire(join(repositoryRoot, "apps/api/package.json")), { JwtService } = require("@nestjs/jwt"), jwt = new JwtService();
  const { createApplication } = require(join(repositoryRoot, "apps/api/dist/bootstrap.js")), { PrismaService } = require(join(repositoryRoot, "apps/api/dist/prisma/prisma.service.js"));
  const seconds = 604800, cookieName = "aij_foundation_test_client_session";
  let app, prisma, token, cookie, claims, empty;
  async function request(path, expected, { method = "GET", body, headers = {}, raw } = {}) {
    const response = await fetch("http://127.0.0.1:3656/api/" + path, { method, headers: { connection: "close", "x-correlation-id": "af025a-http", ...(body !== undefined || raw !== undefined ? { "content-type": "application/json" } : {}), ...headers }, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)), signal: AbortSignal.timeout(8000) });
    assert.equal(response.status, expected, "HTTP status for " + path.split("?")[0]); assert.equal(response.headers.get("x-correlation-id"), "af025a-http");
    const data = await response.json(), text = JSON.stringify(data);
    for (const value of secrets) assert.ok(!text.includes(value), "No secret/token in response body");
    assert.ok(!/\$2[aby]\$\d\d\$/.test(text));
    if (path.startsWith("client")) assert.equal(response.headers.get("cache-control"), "no-store");
    return { response, data };
  }
  const login = (expected = 200, email = account.email, password = account.password, headers = {}) => request("client/auth/login", expected, { method: "POST", body: { email, password }, headers: { origin: "http://localhost:3655", ...headers } });
  const me = (expected = 200, value = cookie) => request("client/auth/me", expected, { headers: value ? { cookie: value } : {} });
  const query = operation => withDatabase("test", readDatabaseEnvironment("test", process.env, lease.id), operation, { acceptanceId: lease.id });
  const signed = async (payload = {}, options = {}) => {
    const value = await jwt.signAsync({ sub: account.id, sessionId: claims.sessionId, tokenVersion: 0, tokenKind: "client", projectId: "aij-foundation", environment: "test", ...payload },
      { secret: keys.value.CLIENT_JWT_SECRET, issuer: "urn:aij:aij-foundation:test:api:client", audience: "urn:aij:aij-foundation:test:client", algorithm: "HS256", expiresIn: seconds, ...options });
    secrets.push(value); return cookieName + "=" + value;
  };
  const start = async input => { await close(); setEnv(input); app = await createApplication(); await app.listen(3656, "127.0.0.1"); prisma = app.get(PrismaService); };
  const close = async () => { if (app) { await app.close(); app = undefined; } };
  try {
    await start(values);
    await t.test("DTO, bcrypt byte limit and login Origin reject before creating sessions", async () => {
      for (const body of [{}, { email: true, password: account.password }, { email: account.email, password: "密".repeat(25) }, { email: "bad", password: "x" }, { email: account.email, password: account.password, workspaceId: "pretend", permission: "admin" }]) {
        await request("client/auth/login", 400, { method: "POST", body, headers: { origin: "http://localhost:3655" } });
      }
      await request("client/auth/login", 400, { method: "POST", raw: '{"password":"' + account.password + '" invalid', headers: { origin: "http://localhost:3655" } });
      for (const headers of [{ origin: "" }, { origin: "https://outside.example" }, { "sec-fetch-site": "cross-site" }]) await login(403, account.email, account.password, headers);
      assert.equal(await prisma.clientAuthSession.count(), 0);
    });
    await t.test("uniform bad credential responses create no sessions or bearer tokens", async () => {
      const failed = await login(401, account.email, "incorrect"), missing = await login(401, "absent@example.test");
      assert.deepEqual(failed.data, missing.data); assert.equal(failed.response.headers.get("set-cookie"), null); assert.equal(await prisma.clientAuthSession.count(), 0);
    });
    await t.test("real login persists a bound session, signs scoped JWT only into host-only HttpOnly Cookie and returns a safe member", async () => {
      const result = await login(200, "  " + account.email.toUpperCase() + "  ");
      const header = result.response.headers.get("set-cookie"); assert.ok(header);
      cookie = header.split(";")[0]; token = cookie.slice(cookieName.length + 1); secrets.push(token);
      assert.ok(cookie.startsWith(cookieName + "=")); assert.ok(header.includes("HttpOnly") && header.includes("SameSite=Strict") && header.includes("Path=/api/client") && header.includes("Max-Age=" + seconds));
      assert.ok(!/Domain=|; Secure/i.test(header)); assert.deepEqual(Object.keys(result.data.data).sort(), ["email", "id", "nickname"]); assert.equal(result.data.data.id, account.id);
      claims = await jwt.verifyAsync(token, { secret: keys.value.CLIENT_JWT_SECRET, issuer: "urn:aij:aij-foundation:test:api:client", audience: "urn:aij:aij-foundation:test:client", algorithms: ["HS256"] });
      assert.equal(claims.tokenKind, "client"); assert.equal(claims.projectId, "aij-foundation"); assert.equal(claims.environment, "test"); assert.equal(claims.exp - claims.iat, seconds); assert.equal(claims.tokenVersion, 0); assert.ok(claims.sessionId);
      assert.deepEqual((await me()).data.data, result.data.data);
      const session = await prisma.clientAuthSession.findUniqueOrThrow({ where: { id: claims.sessionId } });
      assert.equal(session.memberId, account.id); assert.equal(session.status, "active"); assert.equal(session.revokedAt, null); assert.ok(session.expiresAt > new Date()); assert.match(session.deviceHash, /^[a-f0-9]{64}$/); assert.match(session.ipHash, /^[a-f0-9]{64}$/);
      assert.ok((await prisma.memberUser.findUniqueOrThrow({ where: { id: account.id } })).lastLoginAt);
      save("login", { database: lease.database, memberId: account.id, sessionId: session.id, cookieName, attributes: ["HttpOnly", "SameSite=Strict", "Path=/api/client", "host-only"], expiresIn: seconds, jwtClaimNames: Object.keys(claims).sort() });
    });
    await t.test("missing/foreign/duplicate/encoded Cookie, bearer and query credentials do not authenticate", async () => {
      for (const value of ["", "qingqi_client_session=" + token, "other_test_client_session=" + token, cookie + "; " + cookie, cookieName + "=%" + token, cookieName + "=a.b.c"]) await me(401, value);
      await request("client/auth/me", 401, { headers: { authorization: "Bearer " + token, "x-member-id": account.id, "x-permission": "admin" } });
      await request("client/auth/me?token=" + token + "&memberId=" + account.id, 401);
      assert.equal((await request("client/auth/me?workspaceId=pretend&memberId=" + other.id, 200, { headers: { cookie } })).data.data.id, account.id);
    });
    await t.test("signed wrong audience/issuer/project/environment/kind/algorithm/expiry and incomplete claims fail closed", async () => {
      for (const [payload, options] of [[{}, { audience: "urn:aij:aij-foundation:test:admin" }], [{}, { audience: ["urn:aij:aij-foundation:test:client", "other"] }], [{}, { issuer: "qingqi-api" }], [{ projectId: "other" }, {}], [{ environment: "development" }, {}], [{ tokenKind: "admin" }, {}], [{}, { algorithm: "HS384" }], [{}, { expiresIn: -1 }], [{}, { expiresIn: seconds + 1 }], [{}, { noTimestamp: true }], [{ iat: Math.floor(Date.now() / 1000) + 60 }, {}], [{ sessionId: undefined }, {}], [{ sessionId: "missing" }, {}], [{ sub: other.id }, {}], [{ tokenVersion: -1 }, {}], [{ tokenVersion: 9 }, {}], [{}, { secret: randomBytes(32).toString("hex") }]]) await me(401, await signed(payload, options));
      const pieces = token.split("."); pieces[1] = Buffer.from(JSON.stringify({ ...claims, sub: other.id })).toString("base64url"); await me(401, cookieName + "=" + pieces.join("."));
      await request("auth/me", 401, { headers: { authorization: "Bearer " + token } });
      const admin = await jwt.signAsync({ sub: account.id, tokenKind: "admin", projectId: "aij-foundation", environment: "test" }, { secret: values.JWT_SECRET, issuer: "urn:aij:aij-foundation:test:api", audience: "urn:aij:aij-foundation:test:admin", expiresIn: 900 }); secrets.push(admin);
      await me(401, cookieName + "=" + admin); save("rejections", { signedClaimRejections: 17, tamperingRejected: true, crossIdentityRejected: true });
    });
    await t.test("DB member and session state are revalidated, including expiry, owner, revokedAt and version", async () => {
      for (const data of [{ status: "disabled" }, { deletedAt: new Date() }, { tokenVersion: 1 }]) {
        const before = await prisma.memberUser.findUniqueOrThrow({ where: { id: account.id } });
        await prisma.memberUser.update({ where: { id: account.id }, data });
        try { await me(401); } finally { await prisma.memberUser.update({ where: { id: account.id }, data: Object.fromEntries(Object.keys(data).map(key => [key, before[key]])) }); }
        await me();
      }
      for (const data of [{ status: "revoked" }, { revokedAt: new Date() }, { deletedAt: new Date() }, { expiresAt: new Date(Date.now() - 1000) }, { issuedAt: new Date(Date.now() + 60000) }, { memberId: other.id }]) {
        const before = await prisma.clientAuthSession.findUniqueOrThrow({ where: { id: claims.sessionId } });
        await prisma.clientAuthSession.update({ where: { id: claims.sessionId }, data });
        try { await me(401); } finally { await prisma.clientAuthSession.update({ where: { id: claims.sessionId }, data: Object.fromEntries(Object.keys(data).map(key => [key, before[key]])) }); }
        await me();
      }
      await prisma.memberUser.update({ where: { id: account.id }, data: { nickname: "Current database profile" } });
      assert.equal((await me()).data.data.nickname, "Current database profile");
      save("state", { currentDbChecks: 9, cachedIdentity: false, note: "Direct synthetic state controls verify Guard only; no logout/password-change API claimed" });
    });
    await t.test("disabled/deleted/passwordless member cannot log in", async () => {
      for (const data of [{ status: "disabled" }, { deletedAt: new Date() }, { passwordHash: null }]) {
        const before = await prisma.memberUser.findUniqueOrThrow({ where: { id: other.id } });
        await prisma.memberUser.update({ where: { id: other.id }, data });
        try { await login(401, other.email, other.password); } finally { await prisma.memberUser.update({ where: { id: other.id }, data: Object.fromEntries(Object.keys(data).map(key => [key, before[key]])) }); }
      }
    });
    await t.test("login rechecks status after bcrypt and row-lock wait; no orphan session on concurrent disable", async () => {
      const count = await prisma.clientAuthSession.count();
      await query(async client => {
        await client.query("BEGIN"); await client.query("SELECT id FROM public.member_user WHERE id=$1 FOR UPDATE", [account.id]);
        let pending;
        try {
          pending = login(401);
          let waiting = false;
          for (let i = 0; i < 50; i++) { const rows = (await client.query("SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND application_name LIKE 'aij-api:%'")).rows; if (rows.length) { waiting = true; break; } await new Promise(r => setTimeout(r, 50)); }
          assert.ok(waiting, "Real login must reach locked identity write");
          await client.query("UPDATE public.member_user SET status='disabled' WHERE id=$1", [account.id]); await client.query("COMMIT"); await pending;
        } finally { await client.query("ROLLBACK"); if (pending) await pending; await client.query("UPDATE public.member_user SET status='active' WHERE id=$1", [account.id]); }
      });
      assert.equal(await prisma.clientAuthSession.count(), count); await me();
    });
    await t.test("real audit constraint failure rolls back session and lastLoginAt, without setting a Cookie", async () => {
      const count = await prisma.clientAuthSession.count(), before = await prisma.memberUser.findUniqueOrThrow({ where: { id: account.id } });
      await query(c => c.query("ALTER TABLE public.audit_log ADD CONSTRAINT af025a_reject_login CHECK (module <> 'client-auth' OR action <> 'login') NOT VALID"));
      try { const response = await login(503); assert.equal(response.response.headers.get("set-cookie"), null); }
      finally { await query(c => c.query("ALTER TABLE public.audit_log DROP CONSTRAINT af025a_reject_login")); }
      assert.equal(await prisma.clientAuthSession.count(), count); assert.equal((await prisma.memberUser.findUniqueOrThrow({ where: { id: account.id } })).lastLoginAt.getTime(), before.lastLoginAt.getTime());
      await login(); save("atomicity", { realDatabaseConstraintProbe: true, probeRemoved: true, sessionAndLastLoginRolledBack: true, sourceProbe: false });
    });
    await t.test("atomic rate reservations bound concurrent bad attempts and store only HMAC keys", async () => {
      const statuses = await Promise.all(Array.from({ length: 8 }, async () => { const response = await fetch("http://127.0.0.1:3656/api/client/auth/login", { method: "POST", headers: { connection: "close", origin: "http://localhost:3655", "content-type": "application/json" }, body: JSON.stringify({ email: "rate-probe@example.test", password: "invalid" }) }); await response.json(); return response.status; }));
      assert.equal(statuses.filter(s => s === 401).length, 5); assert.equal(statuses.filter(s => s === 429).length, 3);
      const buckets = await prisma.clientAuthRateBucket.findMany(); assert.ok(buckets.length > 0); assert.ok(buckets.every(b => /^[a-f0-9]{64}$/.test(b.keyHash))); assert.ok(!JSON.stringify(buckets).includes("rate-probe@example.test"));
      save("rate-limit", { attempts: 8, invalidCredentials: 5, rateLimited: 3, rawIdentityStored: false });
    });
    await t.test("audit/session storage omits credentials, full JWT, raw email/IP/UA and unused identity tables stay empty", async () => {
      const rows = await prisma.auditLog.findMany({ where: { module: "client-auth" } }); assert.ok(rows.some(r => r.action === "login")); assert.ok(rows.some(r => r.action === "login_failed")); assert.ok(rows.some(r => r.action === "login_rate_limited"));
      const text = JSON.stringify([rows, await prisma.clientAuthSession.findMany()]); for (const secret of secrets) assert.ok(!text.includes(secret)); assert.ok(!text.includes(account.email) && !text.includes("127.0.0.1")); assert.ok(!/\$2[aby]\$\d\d\$/.test(text));
      assert.equal(await prisma.clientConsentRecord.count(), 0); assert.equal(await prisma.clientAuthOneTimeToken.count(), 0);
      const adminPassword = JSON.parse(readFileSync(fixture.seed.credentials.file)).password; secrets.push(adminPassword);
      const admin = await request("auth/login", 200, { method: "POST", body: { username: "aij-admin", password: adminPassword } }), adminToken = admin.data.data.accessToken; secrets.push(adminToken);
      const listed = await request("admin/logs?module=client-auth&pageSize=100", 200, { headers: { authorization: "Bearer " + adminToken } });
      const items = listed.data.data.items; assert.ok(items.length > 0); assert.ok(items.every(item => item.module === "client-auth" && item.path === "/api/client/auth/login" && item.resourceType === "member_auth"));
      assert.ok(items.some(item => item.action === "login") && items.some(item => item.action === "login_failed"));
      assert.ok(!JSON.stringify(items).includes(account.email)); assert.ok(items.every(item => item.requestSummary.correlationId === "[REDACTED]"));
      save("audit", { actions: [...new Set(rows.map(row => row.action))].sort(), unsafeValuesAbsent: true, consentAndOneTimeTokenRows: 0 });
    });
    await t.test("real owned DB outage returns 503 while liveness survives, then readiness and Cookie recover", async () => {
      await prisma.$disconnect(); assert.deepEqual(await applicationSessions(lease.id, clientTask), []); await setTaskDatabaseConnections(lease.id, false, clientTask);
      try { await login(503); await me(503); await request("ready", 503); await request("health", 200); }
      finally { await setTaskDatabaseConnections(lease.id, true, clientTask); }
      await request("ready", 200); await me(); await close(); assert.deepEqual(await applicationSessions(lease.id, clientTask), []);
    });
    await t.test("changed scoped issuer/Cookie rejects the previous instance token; production serialization sets Secure", async () => {
      await start({ ...values, NODE_ENV: "production", COOKIE_PREFIX: "aij_foundation_test_variant", JWT_ISSUER: "urn:aij:aij-foundation:test:variant" });
      await me(401); await me(401, "aij_foundation_test_variant_client_session=" + token);
      const result = await login(); const header = result.response.headers.get("set-cookie"); assert.ok(header.startsWith("aij_foundation_test_variant_client_session=")); assert.ok(header.includes("; Secure"));
      assert.equal((await me(200, header.split(";")[0])).data.data.id, account.id); await close();
      save("namespace", { oldCookieRejected: true, renamedOldTokenRejected: true, newScopedLogin: 200, productionSecureHeader: true, productionDeploymentOrBrowserTls: false });
    });
    await t.test("client-only host needs no admin key and safely rejects invalid requests", async () => {
      await start({ ...values, AUTH_ENABLED: "false", JWT_SECRET: "" });
      const response = await login(); await me(200, response.response.headers.get("set-cookie").split(";")[0]); await request("auth/me", 404); await login(401, "other-missing@example.test"); await close();
    });
    await t.test("admin-only host needs no client keys, preserves admin login/me and omits client authentication and directory routes", async () => {
      const adminPassword = JSON.parse(readFileSync(fixture.seed.credentials.file)).password; secrets.push(adminPassword);
      for (const secretValue of [undefined, ""]) {
        const adminOnly = { ...values, AUTH_ENABLED: "true", CLIENT_AUTH_ENABLED: "false" };
        const clientSecretNames = ["CLIENT_JWT_SECRET", "CLIENT_AUTH_RATE_LIMIT_SECRET", "CLIENT_AUTH_TOKEN_SECRET"];
        for (const key of clientSecretNames) {
          if (secretValue === undefined) delete adminOnly[key]; else adminOnly[key] = secretValue;
        }
        const effective = environment.readApplicationEnvironment(adminOnly);
        for (const key of clientSecretNames) assert.ok(effective[key] === secretValue, key + " must remain absent/empty without environment-file fallback");
        await start(adminOnly);
        const admin = await request("auth/login", 200, { method: "POST", body: { username: "aij-admin", password: adminPassword } });
        const adminToken = admin.data.data.accessToken; assert.ok(typeof adminToken === "string" && adminToken.length > 0); secrets.push(adminToken);
        const headers = { authorization: "Bearer " + adminToken };
        assert.deepEqual((await request("auth/me", 200, { headers })).data.data, admin.data.data.user);
        await request("client/auth/me", 404); await request("client/auth/login", 404, { method: "POST", body: {} });
        await request("admin/clients", 404, { headers });
        await request("admin/clients/" + account.id + "/sessions", 404, { headers });
        await request("admin/clients/" + account.id + "/consents", 404, { headers });
        await request("admin/clients/" + account.id + "/sessions/" + claims.sessionId + "/revoke", 404, { method: "POST", body: { currentPassword: adminPassword }, headers });
        await request("ready", 200); await request("health", 200); await close();
        assert.deepEqual(await applicationSessions(lease.id, clientTask), []);
      }
      save("admin-only", { clientKeysMissingAndEmpty: true, adminLogin: 200, adminMe: 200, clientLogin: 404, clientMe: 404, adminClientDirectory: 404, poolsClosed: true });
    });
    await t.test("missing migrations fail readiness/login/me without fallback and closing leaves zero pools", async () => {
      empty = await createAcceptance("test", clientTask); await start(clientEnvironment(empty.id));
      const emptyCookie = await signed({}, { secret: clientKeys(empty.id).value.CLIENT_JWT_SECRET });
      assert.equal((await request("ready", 503)).data.data.reason, "MIGRATIONS_MISSING"); await login(503); await me(503, emptyCookie); await request("health", 200); await close();
      assert.deepEqual(await applicationSessions(empty.id, clientTask), []); assert.deepEqual(protectedFiles.map(hash), hashes);
      save("result", { status: "VERIFIED", database: lease.database, emptyDatabase: empty.database, poolsClosed: true, schemaPrismaAndAdminServicePreserved: true, lifecycleBImplemented: false });
    });
  } finally { await close(); await setTaskDatabaseConnections(lease.id, true, clientTask); setEnv(original); }
});
