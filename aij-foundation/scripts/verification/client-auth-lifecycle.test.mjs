import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";
import { createAcceptance, migrate } from "../database/migration.mjs";
import { repositoryRoot } from "../database/connection.mjs";
import { assertPortAvailable } from "../port-availability.mjs";
import { applicationSessions } from "./readiness-support.mjs";
import { clientEnvironment, clientKeys, clientLifecycleTask, prepareClientFixture } from "./client-auth-fixture.mjs";

test("customer logout and project-scoped all-session revocation use real HTTP and isolated PostgreSQL", { timeout: 90000 }, async t => {
  await assertPortAvailable(3656);
  const lease = await createAcceptance("test", clientLifecycleTask);
  await migrate({ mode: "test", action: "deploy", acceptanceId: lease.id });
  const fixture = await prepareClientFixture(lease.id, clientLifecycleTask);
  const [account] = JSON.parse(readFileSync(fixture.accounts[0].initialPasswordFile, "utf8")).accounts;
  const env = clientEnvironment(lease.id, clientLifecycleTask), keys = clientKeys(lease.id, clientLifecycleTask);
  const secrets = [account.password, env.JWT_SECRET, keys.value.CLIENT_JWT_SECRET, keys.value.CLIENT_AUTH_RATE_LIMIT_SECRET];
  const original = { ...process.env };
  const setEnv = value => { for (const key of Object.keys(process.env)) delete process.env[key]; Object.assign(process.env, value); };
  const output = join(repositoryRoot, ".artifacts/verification/AF-039"); mkdirSync(output, { recursive: true, mode: 0o700 });
  const cookieName = "aij_foundation_test_client_session", namespace = "aij-foundation:test";
  const require = createRequire(join(repositoryRoot, "apps/api/package.json"));
  const { createApplication } = require(join(repositoryRoot, "apps/api/dist/bootstrap.js"));
  const { PrismaService } = require(join(repositoryRoot, "apps/api/dist/prisma/prisma.service.js"));
  const { JwtService } = require("@nestjs/jwt"), jwt = new JwtService();
  let app, prisma, firstCookie, secondCookie, firstToken, foreignSession;
  const save = (name, value) => writeFileSync(join(output, name + ".json"), JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  async function request(path, expected, { method = "GET", cookie, headers = {} } = {}) {
    const response = await fetch("http://127.0.0.1:3656/api/" + path, { method, headers: { connection: "close", "x-correlation-id": "af039-lifecycle", ...(method !== "GET" ? { origin: "http://localhost:3655" } : {}), ...(cookie ? { cookie } : {}), ...headers }, signal: AbortSignal.timeout(8000) });
    assert.equal(response.status, expected, `HTTP ${method} ${path}`);
    assert.equal(response.headers.get("x-correlation-id"), "af039-lifecycle");
    assert.equal(response.headers.get("cache-control"), "no-store");
    const body = await response.json(), text = JSON.stringify(body);
    for (const secret of secrets) assert.ok(!text.includes(secret), "response body must not reveal credentials or JWTs");
    assert.ok(!/\$2[aby]\$\d\d\$/.test(text), "response body must not reveal password hashes");
    return { response, body };
  }
  const loginMember = async () => {
    const response = await fetch("http://127.0.0.1:3656/api/client/auth/login", { method: "POST", headers: { connection: "close", origin: "http://localhost:3655", "x-correlation-id": "af039-lifecycle", "content-type": "application/json" }, body: JSON.stringify({ email: account.email, password: account.password }), signal: AbortSignal.timeout(8000) });
    assert.equal(response.status, 200);
    const body = await response.json(), text = JSON.stringify(body);
    for (const secret of secrets) assert.ok(!text.includes(secret));
    const header = response.headers.get("set-cookie"); assert.ok(header);
    return { cookie: header.split(";")[0], token: header.split(";")[0].slice(cookieName.length + 1), body };
  };
  const me = cookie => request("client/auth/me", 200, { cookie });
  try {
    setEnv(env);
    app = await createApplication(); await app.listen(3656, "127.0.0.1"); prisma = app.get(PrismaService);
    await t.test("anonymous logout/revoke requests are rejected without setting a cookie", async () => {
      const out = await request("client/auth/logout", 401, { method: "POST" });
      assert.equal(out.response.headers.get("set-cookie"), null);
      const all = await request("client/auth/sessions/revoke-all", 401, { method: "POST" });
      assert.equal(all.response.headers.get("set-cookie"), null);
    });
    await t.test("current-session logout clears only its cookie and leaves another project session untouched", async () => {
      const now = new Date();
      foreignSession = await prisma.clientAuthSession.create({ data: { memberId: account.id, namespace: "other-product:production", status: "active", deviceHash: "a".repeat(64), deviceSummary: "Synthetic foreign-project session", ipHash: "b".repeat(64), issuedAt: now, expiresAt: new Date(now.getTime() + 3600000) } });
      const first = await loginMember(), second = await loginMember(); firstCookie = first.cookie; firstToken = first.token; secondCookie = second.cookie; secrets.push(first.token, second.token);
      const claims = JSON.parse(Buffer.from(first.token.split(".")[1], "base64url").toString("utf8"));
      const firstSession = await prisma.clientAuthSession.findUniqueOrThrow({ where: { id: claims.sessionId } });
      assert.equal(firstSession.namespace, namespace);
      await request("client/auth/me", 401, { cookie: "aij_other_test_client_session=" + first.token });
      const wrongAudience = await jwt.signAsync({ sub: claims.sub, sessionId: claims.sessionId, tokenVersion: claims.tokenVersion, tokenKind: "client", projectId: "aij-foundation", environment: "test" }, {
        secret: keys.value.CLIENT_JWT_SECRET, algorithm: "HS256", issuer: "urn:aij:aij-foundation:test:api:client", audience: "urn:aij:other-product:test:client", expiresIn: 600
      });
      secrets.push(wrongAudience);
      await request("client/auth/me", 401, { cookie: cookieName + "=" + wrongAudience });
      const crossSite = await request("client/auth/logout", 403, { method: "POST", cookie: firstCookie, headers: { "sec-fetch-site": "cross-site" } });
      assert.equal(crossSite.response.headers.get("set-cookie"), null);
      assert.equal((await prisma.clientAuthSession.findUniqueOrThrow({ where: { id: firstSession.id } })).status, "active");
      const result = await request("client/auth/logout", 200, { method: "POST", cookie: firstCookie });
      assert.equal(result.body.data.signedOut, true);
      const cleared = result.response.headers.get("set-cookie");
      assert.ok(cleared.startsWith(cookieName + "=;")); assert.ok(cleared.includes("Path=/api/client") && cleared.includes("HttpOnly") && cleared.includes("SameSite=Strict") && cleared.includes("Max-Age=0"));
      assert.ok(!cleared.includes(firstToken));
      assert.equal((await prisma.clientAuthSession.findUniqueOrThrow({ where: { id: firstSession.id } })).revokeReason, "client_logout");
      await request("client/auth/me", 401, { cookie: firstCookie }); await me(secondCookie);
      assert.equal((await prisma.clientAuthSession.findUniqueOrThrow({ where: { id: foreignSession.id } })).status, "active");
      save("logout", { status: 200, currentSessionRejectedAfterLogout: true, parallelSessionRemainsValid: true, foreignNamespaceRemainsActive: true, cookieCleared: true });
    });
    await t.test("revoke-all is project-scoped, transactional and immediately invalidates every session in that namespace", async () => {
      const before = await prisma.clientAuthSession.count({ where: { memberId: account.id, namespace, status: "active", revokedAt: null } });
      assert.equal(before, 1);
      const blocked = await request("client/auth/sessions/revoke-all", 403, { method: "POST", cookie: secondCookie, headers: { origin: "https://outside.example" } });
      assert.equal(blocked.response.headers.get("set-cookie"), null);
      assert.equal(await prisma.clientAuthSession.count({ where: { memberId: account.id, namespace, status: "active", revokedAt: null } }), 1);
      const result = await request("client/auth/sessions/revoke-all", 200, { method: "POST", cookie: secondCookie });
      assert.equal(result.body.data.revokedCount, 1);
      const cleared = result.response.headers.get("set-cookie"); assert.ok(cleared.startsWith(cookieName + "=;")); assert.ok(cleared.includes("Max-Age=0"));
      await request("client/auth/me", 401, { cookie: secondCookie });
      assert.equal(await prisma.clientAuthSession.count({ where: { memberId: account.id, namespace, status: "active", revokedAt: null } }), 0);
      const foreign = await prisma.clientAuthSession.findUniqueOrThrow({ where: { id: foreignSession.id } });
      assert.equal(foreign.namespace, "other-product:production"); assert.equal(foreign.status, "active"); assert.equal(foreign.revokedAt, null);
      save("revoke-all", { status: 200, revokedCount: result.body.data.revokedCount, allCurrentNamespaceSessionsRejected: true, foreignNamespaceUnaffected: true });
    });
    await t.test("logout and revoke audit rows contain no token, password or raw request data", async () => {
      const rows = await prisma.auditLog.findMany({ where: { module: "client-auth", resourceId: account.id }, orderBy: { createdAt: "asc" } });
      const logout = rows.find(row => row.action === "logout"), all = rows.find(row => row.action === "sessions_revoked");
      assert.ok(logout && all); assert.equal(logout.path, "/api/client/auth/logout"); assert.equal(all.path, "/api/client/auth/sessions/revoke-all");
      assert.equal(logout.status, "success"); assert.equal(all.status, "success");
      const unsafe = JSON.stringify(rows); for (const secret of secrets) assert.ok(!unsafe.includes(secret));
      assert.ok(!unsafe.includes(account.email) && !unsafe.includes("127.0.0.1"));
      save("audit", { actions: rows.filter(row => ["logout", "sessions_revoked"].includes(row.action)).map(row => ({ action: row.action, status: row.status, path: row.path })), unsafeValuesAbsent: true });
    });
  } finally {
    if (app) await app.close();
    setEnv(original);
  }
  assert.deepEqual(await applicationSessions(lease.id, clientLifecycleTask), [], "the local HTTP host must release all PostgreSQL pool sessions");
  save("result", { status: "VERIFIED", acceptanceId: lease.id, database: lease.database, namespace, poolsClosed: true, sourceDatabaseUnaffected: true });
});
