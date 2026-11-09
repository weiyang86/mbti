import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { createAcceptance, migrate } from "../database/migration.mjs";
import { repositoryRoot } from "../database/connection.mjs";
import { clientEnvironment, clientKeys, prepareClientFixture } from "./client-auth-fixture.mjs";
import { writeRuntimeEvidence } from "./runtime-fixture.mjs";

const task = "AF-085";
const require = createRequire(join(repositoryRoot, "apps/api/package.json"));

test("AF-085 password reset uses real isolated PostgreSQL/Nest HTTP and revokes old sessions", { timeout: 420_000 }, async t => {
  const lease = await createAcceptance("test", task);
  const deployed = await migrate({ mode: "test", action: "deploy", acceptanceId: lease.id });
  assert.equal(deployed.exitCode, 0, "only the new AF-085 logical test database deploys the local migration chain");
  const status = await migrate({ mode: "test", action: "status", acceptanceId: lease.id });
  assert.equal(status.exitCode, 0, "AF-085 database is current before synthetic fixture writes");
  const fixture = await prepareClientFixture(lease.id, task);
  const baseEnvironment = clientEnvironment(lease.id, task), keys = clientKeys(lease.id, task);
  const accounts = JSON.parse(readFileSync(fixture.accounts[0].initialPasswordFile, "utf8")).accounts;
  const member = accounts.find(account => account.id === fixture.accounts[0].id);
  const other = accounts.find(account => account.id === fixture.accounts[1].id);
  assert.ok(member?.password && other?.password, "synthetic credentials are read from the ignored AF-085 fixture file");
  const originalEnvironment = { ...process.env };
  const replaceEnvironment = values => { for (const key of Object.keys(process.env)) delete process.env[key]; Object.assign(process.env, values); };
  const { createApplication } = require(join(repositoryRoot, "apps/api/dist/bootstrap.js"));
  const { PrismaService } = require(join(repositoryRoot, "apps/api/dist/prisma/prisma.service.js"));
  const { ClientAuthNotificationAdapter } = require(join(repositoryRoot, "apps/api/dist/client-auth/client-auth-notification.adapter.js"));
  const { createClientOneTimeToken, hashClientOneTimeToken } = require(join(repositoryRoot, "apps/api/dist/client-auth/client-auth.security.js"));
  const { projectAudit } = require(join(repositoryRoot, "apps/api/dist/audit-log/audit-redaction.js"));
  const secrets = [baseEnvironment.JWT_SECRET, keys.value.CLIENT_JWT_SECRET, keys.value.CLIENT_AUTH_RATE_LIMIT_SECRET,
    keys.value.CLIENT_AUTH_TOKEN_SECRET, member.password, other.password];
  const observedPasswords = [...secrets];
  let disabledApp, enabledApp;
  const listen = async environment => {
    replaceEnvironment(environment);
    const app = await createApplication();
    await app.listen(0, "127.0.0.1");
    const address = app.getHttpServer().address();
    assert.ok(address && typeof address === "object" && address.port > 0, "API binds an OS-selected loopback port");
    return { app, prisma: app.get(PrismaService), url: `http://127.0.0.1:${address.port}/api/client/auth` };
  };
  const send = async (url, path, body, { cookie, method = "POST" } = {}) => {
    const response = await fetch(url + path, { method, headers: {
      connection: "close", "content-type": "application/json", "x-correlation-id": "af085-reset-correlation",
      "user-agent": "AF085-Synthetic-Agent", origin: "http://localhost:3655", ...(cookie ? { cookie } : {})
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(8000) });
    const text = await response.text();
    let parsed;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
    assert.equal(response.headers.get("cache-control"), "no-store", "customer auth responses are not cacheable");
    for (const secret of secrets) assert.ok(!text.includes(secret), "HTTP response never echoes a credential or key");
    return { response, parsed, text };
  };
  const login = async (url, email, password) => {
    const result = await send(url, "/login", { email, password });
    return result;
  };
  const cookieFrom = response => {
    const setCookie = response.headers.get("set-cookie");
    assert.ok(setCookie, "successful login issues the existing HttpOnly client session cookie");
    return setCookie.split(";", 1)[0];
  };
  const requestPath = "/password/reset/request", confirmPath = "/password/reset/confirm";
  const purpose = "client-password-reset:aij-foundation:test";
  const observedTokens = [];

  try {
    disabledApp = await listen({ ...baseEnvironment, CLIENT_AUTH_NOTIFICATION_ADAPTER: "disabled" });
    enabledApp = await listen({ ...baseEnvironment, CLIENT_AUTH_NOTIFICATION_ADAPTER: "test" });
    const db = enabledApp.prisma;
    const adapter = enabledApp.app.get(ClientAuthNotificationAdapter);
    const now = new Date();
    await db.memberUser.updateMany({ where: { id: { in: [member.id, other.id] } }, data: { status: "active", emailVerifiedAt: now } });

    let resetDelivery;
    await t.test("unknown and known identities share generic accepted responses; disabled delivery creates no token", async () => {
      const before = await db.clientAuthOneTimeToken.count();
      const disabledKnown = await send(disabledApp.url, requestPath, { email: member.email });
      const disabledUnknown = await send(disabledApp.url, requestPath, { email: "missing-af085@example.test" });
      assert.equal(disabledKnown.response.status, 202);
      assert.deepEqual(disabledKnown.parsed.data, { accepted: true });
      assert.deepEqual(disabledUnknown.parsed.data, disabledKnown.parsed.data);
      assert.equal(await db.clientAuthOneTimeToken.count(), before, "disabled adapter fails closed without creating reset token rows");

      const known = await send(enabledApp.url, requestPath, { email: member.email });
      const unknown = await send(enabledApp.url, requestPath, { email: "missing-enabled-af085@example.test" });
      assert.equal(known.response.status, 202);
      assert.deepEqual(known.parsed.data, { accepted: true });
      assert.deepEqual(unknown.parsed.data, known.parsed.data);
      assert.equal(adapter.testDeliveries.length, 1, "only the explicitly enabled in-memory test adapter receives a known-account token");
      resetDelivery = adapter.testDeliveries[0];
      observedTokens.push(resetDelivery.token);
      assert.equal(resetDelivery.purpose, "password_reset");
      const tokenHash = hashClientOneTimeToken(keys.value.CLIENT_AUTH_TOKEN_SECRET, purpose, resetDelivery.token);
      const row = await db.clientAuthOneTimeToken.findUniqueOrThrow({ where: { tokenHash } });
      assert.equal(row.memberId, member.id);
      assert.equal(row.purpose, purpose, "reset token is bound to this project/environment");
      assert.notEqual(row.tokenHash, resetDelivery.token);
      assert.match(row.tokenHash, /^[a-f0-9]{64}$/);
      assert.ok(row.expiresAt.getTime() - Date.now() <= 30 * 60_000 && row.expiresAt.getTime() - Date.now() >= 29 * 60_000);
      assert.ok(!JSON.stringify(row).includes(resetDelivery.token), "only token digest is persisted");
      assert.ok(!known.text.includes(resetDelivery.token), "HTTP request response excludes the token");
    });

    let currentDelivery;
    await t.test("reissue revokes the previous token and reset confirmation rejects malformed, expired, foreign-purpose, and replayed tokens", async () => {
      const reissued = await send(enabledApp.url, requestPath, { email: member.email });
      assert.equal(reissued.response.status, 202);
      currentDelivery = adapter.testDeliveries.at(-1);
      observedTokens.push(currentDelivery.token);
      assert.notEqual(currentDelivery.token, resetDelivery.token);
      const oldRow = await db.clientAuthOneTimeToken.findUniqueOrThrow({ where: { tokenHash: hashClientOneTimeToken(keys.value.CLIENT_AUTH_TOKEN_SECRET, purpose, resetDelivery.token) } });
      assert.ok(oldRow.revokedAt instanceof Date, "reissue revokes the older active reset token");
      assert.equal((await send(enabledApp.url, confirmPath, { token: "short", newPassword: "NewPass123" })).response.status, 400);
      const beforeMalformed = await db.clientAuthOneTimeToken.count();
      assert.equal((await send(enabledApp.url, confirmPath, { token: "short", newPassword: "NewPass123", purpose: "admin" })).response.status, 400,
        "DTO rejects malformed input and caller-supplied purpose");
      assert.equal(await db.clientAuthOneTimeToken.count(), beforeMalformed);

      const foreignToken = createClientOneTimeToken();
      observedTokens.push(foreignToken);
      const foreignPurpose = "client-password-reset:other-project:test";
      await db.clientAuthOneTimeToken.create({ data: { memberId: other.id, purpose: foreignPurpose,
        tokenHash: hashClientOneTimeToken(keys.value.CLIENT_AUTH_TOKEN_SECRET, foreignPurpose, foreignToken), expiresAt: new Date(Date.now() + 60_000) } });
      assert.equal((await send(enabledApp.url, confirmPath, { token: foreignToken, newPassword: "OtherPass456" })).response.status, 400,
        "another project's token purpose cannot reset this namespace");

      const expired = createClientOneTimeToken();
      observedTokens.push(expired);
      await db.clientAuthOneTimeToken.create({ data: { memberId: other.id, purpose,
        tokenHash: hashClientOneTimeToken(keys.value.CLIENT_AUTH_TOKEN_SECRET, purpose, expired), expiresAt: new Date(Date.now() - 1000) } });
      assert.equal((await send(enabledApp.url, confirmPath, { token: expired, newPassword: "OtherPass456" })).response.status, 400,
        "expired reset token is rejected");
    });

    await t.test("valid reset changes the credential atomically and invalidates cookies/sessions across project namespaces", async () => {
      const before = await db.memberUser.findUniqueOrThrow({ where: { id: member.id }, select: { tokenVersion: true, passwordHash: true } });
      const oldLogin = await login(enabledApp.url, member.email, member.password);
      assert.equal(oldLogin.response.status, 200);
      const oldCookie = cookieFrom(oldLogin.response);
      const otherNamespaceSession = await db.clientAuthSession.create({ data: { memberId: member.id, namespace: "urn:aij:foreign-project:prod", status: "active",
        deviceHash: "a".repeat(64), deviceSummary: "synthetic second-project session", ipHash: "b".repeat(64), issuedAt: now, lastSeenAt: now,
        expiresAt: new Date(Date.now() + 60 * 60_000) } });
      const otherNamespaceResetToken = createClientOneTimeToken();
      observedTokens.push(otherNamespaceResetToken);
      const otherPurpose = "client-password-reset:foreign-project:prod";
      const otherNamespaceResetRow = await db.clientAuthOneTimeToken.create({ data: { memberId: member.id, purpose: otherPurpose,
        tokenHash: hashClientOneTimeToken(keys.value.CLIENT_AUTH_TOKEN_SECRET, otherPurpose, otherNamespaceResetToken), expiresAt: new Date(Date.now() + 60 * 60_000) } });
      const newPassword = "ResetPass987";
      observedPasswords.push(newPassword);
      const completed = await send(enabledApp.url, confirmPath, { token: currentDelivery.token, newPassword });
      assert.equal(completed.response.status, 200);
      assert.deepEqual(completed.parsed.data, { reset: true });
      assert.match(completed.response.headers.get("set-cookie") || "", /Max-Age=0/);
      const after = await db.memberUser.findUniqueOrThrow({ where: { id: member.id }, select: { tokenVersion: true, passwordHash: true, passwordChangedAt: true } });
      assert.equal(after.tokenVersion, before.tokenVersion + 1);
      assert.notEqual(after.passwordHash, before.passwordHash);
      assert.ok(after.passwordChangedAt instanceof Date);
      const revoked = await db.clientAuthSession.findMany({ where: { memberId: member.id, status: "active" } });
      assert.equal(revoked.length, 0, "no active client session survives reset");
      const foreignSessionAfter = await db.clientAuthSession.findUniqueOrThrow({ where: { id: otherNamespaceSession.id } });
      assert.equal(foreignSessionAfter.status, "revoked", "a global MemberUser credential revokes sessions in every namespace");
      assert.equal(foreignSessionAfter.revokeReason, "password_reset");
      const foreignResetAfter = await db.clientAuthOneTimeToken.findUniqueOrThrow({ where: { id: otherNamespaceResetRow.id } });
      assert.ok(foreignResetAfter.revokedAt instanceof Date, "a completed reset invalidates outstanding reset tokens issued under another namespace");
      assert.equal((await send(enabledApp.url, "/me", undefined, { method: "GET", cookie: oldCookie })).response.status, 401,
        "the pre-reset session cookie is rejected by the actual HTTP guard");
      assert.equal((await login(enabledApp.url, member.email, member.password)).response.status, 401, "old password no longer authenticates");
      const newLogin = await login(enabledApp.url, member.email, newPassword);
      assert.equal(newLogin.response.status, 200, "new password authenticates through the existing login endpoint");
      assert.equal((await send(enabledApp.url, confirmPath, { token: currentDelivery.token, newPassword: "AnotherPass765" })).response.status, 400,
        "consumed reset token cannot be replayed");
    });

    await t.test("concurrent consume is single-use; authenticated password change still requires the current credential", async () => {
      const otherRequest = await send(enabledApp.url, requestPath, { email: other.email });
      assert.equal(otherRequest.response.status, 202);
      const delivery = adapter.testDeliveries.at(-1);
      observedTokens.push(delivery.token);
      const newPassword = "ConcurrentPass654";
      observedPasswords.push(newPassword, "NextPass987");
      const results = await Promise.all([
        send(enabledApp.url, confirmPath, { token: delivery.token, newPassword }),
        send(enabledApp.url, confirmPath, { token: delivery.token, newPassword })
      ]);
      assert.deepEqual(results.map(result => result.response.status).sort((a, b) => a - b), [200, 400], "one concurrent confirmation consumes the token");
      const loggedIn = await login(enabledApp.url, other.email, newPassword);
      const cookie = cookieFrom(loggedIn.response);
      const wrongCurrent = await send(enabledApp.url, "/password", { currentPassword: "WrongCurrent123", newPassword: "NextPass987" }, { method: "PATCH", cookie });
      assert.equal(wrongCurrent.response.status, 401, "authenticated change refuses missing reauthentication");
      const correctCurrent = await send(enabledApp.url, "/password", { currentPassword: newPassword, newPassword: "NextPass987" }, { method: "PATCH", cookie });
      assert.equal(correctCurrent.response.status, 200, "authenticated change accepts the current password");
      assert.equal((await send(enabledApp.url, "/me", undefined, { method: "GET", cookie })).response.status, 401,
        "reauthenticated password change also revokes the old session");
    });

    await t.test("request and confirmation limits persist hashed identifiers and audit projection omits secrets", async () => {
      const limitedIdentity = `throttle-${Date.now()}@example.test`;
      const requests = [];
      for (let i = 0; i < 6; i++) requests.push(await send(enabledApp.url, requestPath, { email: limitedIdentity }));
      assert.ok(requests.every(result => result.response.status === 202 && JSON.stringify(result.parsed.data) === JSON.stringify({ accepted: true })),
        "rate-limited and allowed reset requests retain the same generic public result");
      const guessed = createClientOneTimeToken();
      observedTokens.push(guessed);
      const guesses = [];
      for (let i = 0; i < 5; i++) guesses.push(await send(enabledApp.url, confirmPath, { token: guessed, newPassword: "GuessPass123" }));
      assert.ok(guesses.every(result => result.response.status === 400));
      assert.equal((await send(enabledApp.url, confirmPath, { token: guessed, newPassword: "GuessPass123" })).response.status, 429,
        "sixth attempt is rate limited by hashed token/IP buckets");
      const rateRows = await db.clientAuthRateBucket.findMany({ where: { scope: { in: ["password_reset_request_identity", "password_reset_request_ip", "password_reset_confirm_token", "password_reset_confirm_ip"] } } });
      assert.ok(rateRows.length >= 4);
      assert.ok(rateRows.every(row => /^[a-f0-9]{64}$/.test(row.keyHash)));
      const auditRows = await db.auditLog.findMany({ where: { module: "client-auth", action: { startsWith: "password_reset_" } }, orderBy: { createdAt: "asc" } });
      const auditText = JSON.stringify(auditRows);
      for (const secret of [...observedPasswords, ...observedTokens, limitedIdentity, "127.0.0.1", "AF085-Synthetic-Agent"]) {
        assert.ok(!auditText.includes(secret), "audit excludes credentials, email, raw token, IP and user-agent");
      }
      assert.ok(auditRows.some(row => row.action === "password_reset_completed"));
      assert.ok(auditRows.some(row => row.action === "password_reset_rate_limited"));
      const projected = auditRows.map(projectAudit);
      assert.ok(projected.every(row => row.module === "client-auth" && row.redacted === true));
      assert.ok(projected.every(row => row.path === "/api/client/auth/password/reset/request" || row.path === "/api/client/auth/password/reset/confirm"));
      assert.ok(projected.every(row => ["password_reset_requested", "password_reset_rate_limited", "password_reset_failed", "password_reset_completed"].includes(row.action)));
      const projectedText = JSON.stringify(projected);
      for (const secret of [...observedPasswords, ...observedTokens, limitedIdentity, "127.0.0.1"]) assert.ok(!projectedText.includes(secret));
      assert.ok((await db.clientAuthOneTimeToken.findMany({ where: { purpose } })).every(row => !observedTokens.includes(row.tokenHash)),
        "database only retains HMAC token digests, never raw bearer tokens");
    });

    await writeRuntimeEvidence(task, lease.id, "client-password-reset-http.json", {
      database: lease.database, apiAddress: enabledApp.url, portBinding: "127.0.0.1:OS-selected",
      testCases: 5, resetTtlSeconds: 1800, genericRequestResponse: true, rawTokenPersisted: false,
      oneTimeAtomicConsume: true, wrongPurposeExpiredReplayRejected: true, identityAndIpBucketsHmacOnly: true,
      passwordChanged: true, tokenVersionIncremented: true, allNamespaceSessionsRevoked: true,
      oldCookieRejected: true, oldPasswordRejected: true, newPasswordAccepted: true,
      auditProjectionRedacted: true, testAdapterOnly: true, externalProviderCalls: 0, realMessagesSent: 0
    });
  } finally {
    if (enabledApp) await enabledApp.app.close();
    if (disabledApp) await disabledApp.app.close();
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, originalEnvironment);
  }
});
