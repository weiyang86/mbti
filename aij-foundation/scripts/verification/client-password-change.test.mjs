import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";
import { createAcceptance, migrate } from "../database/migration.mjs";
import { repositoryRoot } from "../database/connection.mjs";
import { assertPortAvailable } from "../port-availability.mjs";
import { applicationSessions } from "./readiness-support.mjs";
import { clientEnvironment, clientKeys, prepareClientFixture } from "./client-auth-fixture.mjs";

const task = "AF-040";
test("customer password change requires reauthentication, revokes old sessions, limits attempts and writes redacted audit", { timeout: 180000 }, async t => {
  await assertPortAvailable(3656);
  const lease = await createAcceptance("test", task);
  await migrate({ mode: "test", action: "deploy", acceptanceId: lease.id });
  const fixture = await prepareClientFixture(lease.id, task);
  const accounts = JSON.parse(readFileSync(fixture.accounts[0].initialPasswordFile, "utf8")).accounts;
  const [account, throttledAccount] = accounts;
  const env = clientEnvironment(lease.id, task), keys = clientKeys(lease.id, task);
  const oldPassword = account.password, newPassword = "Changed-" + task.replaceAll("-", "") + "-58xQ";
  const secrets = [oldPassword, newPassword, throttledAccount.password, env.JWT_SECRET, keys.value.CLIENT_JWT_SECRET, keys.value.CLIENT_AUTH_RATE_LIMIT_SECRET];
  const original = { ...process.env };
  const setEnv = value => { for (const key of Object.keys(process.env)) delete process.env[key]; Object.assign(process.env, value); };
  const output = join(repositoryRoot, ".artifacts/verification/AF-040"); mkdirSync(output, { recursive: true, mode: 0o700 });
  const cookieName = "aij_foundation_test_client_session";
  const require = createRequire(join(repositoryRoot, "apps/api/package.json"));
  const { createApplication } = require(join(repositoryRoot, "apps/api/dist/bootstrap.js"));
  const { PrismaService } = require(join(repositoryRoot, "apps/api/dist/prisma/prisma.service.js"));
  let app, prisma, firstCookie, secondCookie, foreignSession;
  const save = (name, value) => writeFileSync(join(output, name + ".json"), JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  async function request(expected, { path = "password", method = "GET", cookie, body, headers = {} } = {}) {
    const response = await fetch("http://127.0.0.1:3656/api/client/auth/" + path, {
      method,
      headers: { connection: "close", "x-correlation-id": "af040-password", ...(method !== "GET" ? { origin: "http://localhost:3655" } : {}), ...(body ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10000)
    });
    assert.equal(response.status, expected, `HTTP ${method} /api/client/auth/password`);
    const payload = await response.json(), text = JSON.stringify(payload);
    for (const secret of secrets) assert.ok(!text.includes(secret), "responses must not reveal password, JWT or secret values");
    assert.ok(!/\$2[aby]\$\d\d\$/.test(text), "responses must not reveal password hashes");
    return { response, body: payload };
  }
  async function login(email, password) {
    const response = await fetch("http://127.0.0.1:3656/api/client/auth/login", { method: "POST", headers: { connection: "close", origin: "http://localhost:3655", "x-correlation-id": "af040-password", "content-type": "application/json" }, body: JSON.stringify({ email, password }), signal: AbortSignal.timeout(10000) });
    const body = await response.json();
    if (response.status === 200) {
      const text = JSON.stringify(body);
      for (const secret of secrets) assert.ok(!text.includes(secret));
      const header = response.headers.get("set-cookie"); assert.ok(header);
      const pair = header.split(";")[0]; secrets.push(pair.slice(cookieName.length + 1));
      return { status: response.status, cookie: pair, body };
    }
    for (const secret of secrets) assert.ok(!JSON.stringify(body).includes(secret));
    return { status: response.status, body };
  }
  try {
    setEnv(env);
    app = await createApplication(); await app.listen(3656, "127.0.0.1"); prisma = app.get(PrismaService);

    await t.test("anonymous, cross-site, malformed and bad-current-password changes are rejected without mutation", async () => {
      const anonymous = await request(401, { method: "PATCH", body: { currentPassword: oldPassword, newPassword } });
      assert.equal(anonymous.response.headers.get("set-cookie"), null);
      const loggedIn = await login(account.email, oldPassword); assert.equal(loggedIn.status, 200); firstCookie = loggedIn.cookie;
      const claims = JSON.parse(Buffer.from(firstCookie.slice(cookieName.length + 1).split(".")[1], "base64url").toString("utf8"));
      const before = await prisma.memberUser.findUniqueOrThrow({ where: { id: account.id }, select: { passwordHash: true, passwordChangedAt: true, tokenVersion: true } });
      const blocked = await request(403, { method: "PATCH", cookie: firstCookie, body: { currentPassword: oldPassword, newPassword }, headers: { "sec-fetch-site": "cross-site" } });
      assert.equal(blocked.response.headers.get("set-cookie"), null);
      const extra = await request(400, { method: "PATCH", cookie: firstCookie, body: { currentPassword: oldPassword, newPassword, email: account.email } });
      assert.equal(extra.response.headers.get("set-cookie"), null);
      const invalid = await request(401, { method: "PATCH", cookie: firstCookie, body: { currentPassword: "Wrong-Reauth-58xQ", newPassword } });
      assert.equal(invalid.response.headers.get("set-cookie"), null);
      const after = await prisma.memberUser.findUniqueOrThrow({ where: { id: account.id }, select: { passwordHash: true, passwordChangedAt: true, tokenVersion: true } });
      assert.deepEqual(after, before);
      assert.equal((await prisma.clientAuthSession.findUniqueOrThrow({ where: { id: claims.sessionId } })).status, "active");
      save("rejected-changes", { anonymous401: true, crossSite403: true, extraField400: true, wrongCurrentPassword401: true, noPasswordOrSessionMutation: true });
    });

    await t.test("successful change requires the current password, clears cookie and invalidates all old sessions", async () => {
      const beforeHash = (await prisma.memberUser.findUniqueOrThrow({ where: { id: account.id }, select: { passwordHash: true } })).passwordHash;
      const loginAgain = await login(account.email, oldPassword); assert.equal(loginAgain.status, 200); secondCookie = loginAgain.cookie;
      const now = new Date();
      foreignSession = await prisma.clientAuthSession.create({ data: { memberId: account.id, namespace: "synthetic-other-project:production", status: "active", deviceHash: "c".repeat(64), deviceSummary: "Synthetic other-project session", ipHash: "d".repeat(64), issuedAt: now, expiresAt: new Date(now.getTime() + 3600000) } });
      const reused = await request(409, { method: "PATCH", cookie: firstCookie, body: { currentPassword: oldPassword, newPassword: oldPassword } });
      assert.equal(reused.response.headers.get("set-cookie"), null);
      const result = await request(200, { method: "PATCH", cookie: firstCookie, body: { currentPassword: oldPassword, newPassword } });
      assert.deepEqual(result.body.data, { changed: true });
      const cleared = result.response.headers.get("set-cookie");
      assert.ok(cleared.startsWith(cookieName + "=;"));
      assert.ok(cleared.includes("Path=/api/client") && cleared.includes("HttpOnly") && cleared.includes("SameSite=Strict") && cleared.includes("Max-Age=0"));
      assert.ok(!cleared.includes(oldPassword) && !cleared.includes(newPassword));
      await request(401, { path: "me", cookie: firstCookie });
      await request(401, { path: "me", cookie: secondCookie });
      assert.equal((await login(account.email, oldPassword)).status, 401);
      const fresh = await login(account.email, newPassword); assert.equal(fresh.status, 200);
      const member = await prisma.memberUser.findUniqueOrThrow({ where: { id: account.id }, select: { passwordHash: true, passwordChangedAt: true, tokenVersion: true } });
      assert.ok(member.passwordChangedAt instanceof Date); assert.equal(member.tokenVersion, 1); assert.notEqual(member.passwordHash, beforeHash);
      const sessions = await prisma.clientAuthSession.findMany({ where: { memberId: account.id }, orderBy: { namespace: "asc" } });
      assert.ok(sessions.filter(row => row.status === "revoked" && row.revokeReason === "password_changed").length >= 3);
      assert.equal((await prisma.clientAuthSession.findUniqueOrThrow({ where: { id: foreignSession.id } })).status, "revoked");
      assert.equal((await request(200, { path: "me", cookie: fresh.cookie })).body.data.id, account.id);
      save("password-changed", { oldPasswordRejected: true, newPasswordAccepted: true, previousSessionsRevoked: sessions.length, crossNamespaceCredentialRotation: true, cookieCleared: true });
    });

    await t.test("repeated bad reauthentication is throttled and rate keys contain only keyed hashes", async () => {
      const loggedIn = await login(throttledAccount.email, throttledAccount.password); assert.equal(loggedIn.status, 200);
      for (let i = 0; i < 5; i++) await request(401, { method: "PATCH", cookie: loggedIn.cookie, body: { currentPassword: "Wrong-AF040-58xQ", newPassword: "Unused-AF040-72uQ" } });
      const limited = await request(429, { method: "PATCH", cookie: loggedIn.cookie, body: { currentPassword: throttledAccount.password, newPassword: "Unused-AF040-72uQ" } });
      assert.equal(limited.response.headers.get("set-cookie"), null);
      const buckets = await prisma.clientAuthRateBucket.findMany({ where: { scope: { in: ["password_change_identity", "password_change_ip"] } } });
      assert.ok(buckets.length >= 2);
      const bucketText = JSON.stringify(buckets);
      for (const value of [account.email, throttledAccount.email, "127.0.0.1", oldPassword, newPassword]) assert.ok(!bucketText.includes(value));
      assert.ok(buckets.every(row => /^[a-f0-9]{64}$/.test(row.keyHash)));
      save("rate-limit", { wrongReauthentication401Count: 5, nextRequest429: true, hashedIdentityAndIpKeysOnly: true });
    });

    await t.test("audit is persisted without raw passwords, email, IP or token", async () => {
      const rows = await prisma.auditLog.findMany({ where: { module: "client-auth", resourceId: { in: [account.id, throttledAccount.id] }, path: "/api/client/auth/password" }, orderBy: { createdAt: "asc" } });
      assert.ok(rows.some(row => row.action === "password_changed" && row.status === "success"));
      assert.ok(rows.some(row => row.action === "password_change_failed" && row.status === "failed"));
      assert.ok(rows.some(row => row.action === "password_change_rate_limited" && row.status === "failed"));
      const auditText = JSON.stringify(rows);
      for (const value of [account.email, throttledAccount.email, "127.0.0.1", oldPassword, newPassword, "Wrong-Reauth-58xQ", "Wrong-AF040-58xQ"]) assert.ok(!auditText.includes(value));
      assert.ok(!/\$2[aby]\$\d\d\$/.test(auditText));
      save("audit", { persistedPasswordAuditActions: rows.map(row => ({ action: row.action, status: row.status, path: row.path })), secretsAbsent: true });
    });
  } finally {
    if (app) await app.close();
    setEnv(original);
  }
  assert.deepEqual(await applicationSessions(lease.id, task), [], "the local HTTP host must release all PostgreSQL pool sessions");
  save("result", { status: "VERIFIED", acceptanceId: lease.id, database: lease.database, passwordChanged: true, oldSessionsRejected: true, rateLimitApplied: true, auditRedacted: true, poolsClosed: true });
});
