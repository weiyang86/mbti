import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { createAcceptance, migrate } from "../database/migration.mjs";
import { repositoryRoot } from "../database/connection.mjs";
import { clientEnvironment, clientKeys, prepareClientFixture } from "./client-auth-fixture.mjs";
import { writeRuntimeEvidence } from "./runtime-fixture.mjs";

const task = "AF-084";
const require = createRequire(join(repositoryRoot, "apps/api/package.json"));

test("AF-084 email verification uses namespaced one-time tokens and real PostgreSQL/Nest HTTP", { timeout: 420_000 }, async t => {
  const lease = await createAcceptance("test", task);
  const deployed = await migrate({ mode: "test", action: "deploy", acceptanceId: lease.id });
  assert.equal(deployed.exitCode, 0, "only the new AF-084 logical test database deploys the local migration chain");
  const migrationStatus = await migrate({ mode: "test", action: "status", acceptanceId: lease.id });
  assert.equal(migrationStatus.exitCode, 0, "AF-084 test database is current before fixture writes");
  const fixture = await prepareClientFixture(lease.id, task);
  const baseEnvironment = clientEnvironment(lease.id, task), keys = clientKeys(lease.id, task);
  const accounts = JSON.parse(readFileSync(fixture.accounts[0].initialPasswordFile, "utf8")).accounts;
  const member = accounts.find(account => account.id === fixture.accounts[0].id);
  const other = accounts.find(account => account.id === fixture.accounts[1].id);
  assert.ok(member?.password && other?.password, "synthetic passwords are read from this ignored AF-084 credential file");
  const originalEnvironment = { ...process.env };
  const setEnvironment = values => { for (const key of Object.keys(process.env)) delete process.env[key]; Object.assign(process.env, values); };
  const { createApplication } = require(join(repositoryRoot, "apps/api/dist/bootstrap.js"));
  const { PrismaService } = require(join(repositoryRoot, "apps/api/dist/prisma/prisma.service.js"));
  const { ClientAuthNotificationAdapter } = require(join(repositoryRoot, "apps/api/dist/client-auth/client-auth-notification.adapter.js"));
  const { createClientOneTimeToken, hashClientOneTimeToken } = require(join(repositoryRoot, "apps/api/dist/client-auth/client-auth.security.js"));
  const secrets = [baseEnvironment.JWT_SECRET, keys.value.CLIENT_JWT_SECRET, keys.value.CLIENT_AUTH_RATE_LIMIT_SECRET,
    keys.value.CLIENT_AUTH_TOKEN_SECRET, member.password, other.password];
  let disabledApp, enabledApp;
  const listen = async (environment) => {
    setEnvironment(environment);
    const app = await createApplication();
    await app.listen(0, "127.0.0.1");
    const address = app.getHttpServer().address();
    assert.ok(address && typeof address === "object" && address.port > 0, "client auth listens on an OS-selected loopback port");
    return { app, prisma: app.get(PrismaService), url: `http://127.0.0.1:${address.port}/api/client/auth` };
  };
  const post = async (url, path, body, headers = {}) => {
    const response = await fetch(url + path, { method: "POST", headers: {
      connection: "close", "content-type": "application/json", "x-correlation-id": "af084-email-verification",
      "user-agent": "AF084-Synthetic-Agent", ...headers
    }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000) });
    const text = await response.text();
    const parsed = JSON.parse(text);
    assert.equal(response.headers.get("cache-control"), "no-store", "verification responses are not cacheable");
    for (const secret of secrets) assert.ok(!text.includes(secret), "response does not echo a credential or key");
    return { response, parsed, text };
  };

  try {
    disabledApp = await listen({ ...baseEnvironment, CLIENT_AUTH_NOTIFICATION_ADAPTER: "disabled" });
    enabledApp = await listen({ ...baseEnvironment, CLIENT_AUTH_NOTIFICATION_ADAPTER: "test" });
    const db = enabledApp.prisma;
    const adapter = enabledApp.app.get(ClientAuthNotificationAdapter);
    const purpose = "client-email-verification:aij-foundation:test";
    const requestPath = "/email/verification/request";
    const confirmPath = "/email/verification/confirm";
    let observedTokens = [];

    await t.test("unconfigured delivery fails closed without token creation or a distinct response", async () => {
      const before = await db.clientAuthOneTimeToken.count();
      const result = await post(disabledApp.url, requestPath, { email: member.email });
      assert.equal(result.response.status, 202);
      assert.equal(result.parsed.data.accepted, true);
      assert.equal(await db.clientAuthOneTimeToken.count(), before);
      assert.equal(result.response.headers.get("set-cookie"), null);
    });

    let initialDelivery;
    await t.test("known and unknown accounts receive the same generic result; only an explicit test adapter receives raw token", async () => {
      const known = await post(enabledApp.url, requestPath, { email: member.email });
      const unknown = await post(enabledApp.url, requestPath, { email: "not-present-af084@example.test" });
      assert.equal(known.response.status, 202);
      assert.equal(unknown.response.status, known.response.status);
      assert.deepEqual(known.parsed.data, { accepted: true });
      assert.deepEqual(unknown.parsed.data, known.parsed.data);
      assert.equal(Object.keys(known.parsed.data).length, 1);
      assert.equal(known.response.headers.get("set-cookie"), null);
      assert.equal(adapter.testDeliveries.length, 1, "the test-only in-memory adapter receives the known-account token only");
      initialDelivery = adapter.testDeliveries[0];
      observedTokens.push(initialDelivery.token);
      const row = await db.clientAuthOneTimeToken.findUniqueOrThrow({ where: { tokenHash: hashClientOneTimeToken(keys.value.CLIENT_AUTH_TOKEN_SECRET, purpose, initialDelivery.token) } });
      assert.equal(row.memberId, member.id);
      assert.equal(row.purpose, purpose, "token purpose is bound to this project/environment namespace");
      assert.ok(row.tokenHash !== initialDelivery.token, "only a one-way digest is persisted");
      assert.match(row.tokenHash, /^[a-f0-9]{64}$/);
      assert.ok(row.expiresAt.getTime() - Date.now() <= 30 * 60_000 && row.expiresAt.getTime() - Date.now() >= 29 * 60_000, "token expires within the declared 30-minute window");
      assert.ok(!JSON.stringify(row).includes(initialDelivery.token), "database token row contains no raw token");
      const audits = await db.auditLog.findMany({ where: { module: "client-auth", action: "verification_requested" } });
      const auditText = JSON.stringify(audits);
      assert.ok(audits.some(item => item.resourceId === member.id));
      for (const value of [member.email, initialDelivery.token, "127.0.0.1", "AF084-Synthetic-Agent", keys.value.CLIENT_AUTH_TOKEN_SECRET]) {
        assert.ok(!auditText.includes(value), "audit omits email, token, IP, user-agent and key material");
      }
      assert.ok(auditText.includes("af084-email-verification"), "audit retains the non-secret correlation ID");
    });

    let currentDelivery;
    await t.test("reissuing revokes the previous token; confirmation atomically consumes one token once", async () => {
      const reissued = await post(enabledApp.url, requestPath, { email: member.email });
      assert.equal(reissued.response.status, 202);
      currentDelivery = adapter.testDeliveries.at(-1);
      observedTokens.push(currentDelivery.token);
      assert.ok(currentDelivery.token !== initialDelivery.token, "each issuance uses a fresh random token");
      const oldHash = hashClientOneTimeToken(keys.value.CLIENT_AUTH_TOKEN_SECRET, purpose, initialDelivery.token);
      const oldRow = await db.clientAuthOneTimeToken.findUniqueOrThrow({ where: { tokenHash: oldHash } });
      assert.ok(oldRow.revokedAt instanceof Date, "reissue revokes the prior active token");
      const oldAttempt = await post(enabledApp.url, confirmPath, { token: initialDelivery.token });
      assert.equal(oldAttempt.response.status, 400, "revoked token is rejected");
      const concurrent = await Promise.all([
        post(enabledApp.url, confirmPath, { token: currentDelivery.token }),
        post(enabledApp.url, confirmPath, { token: currentDelivery.token })
      ]);
      const statuses = concurrent.map(item => item.response.status).sort((a, b) => a - b);
      assert.deepEqual(statuses, [200, 400], "concurrent confirmations can consume the token only once");
      const verified = await db.memberUser.findUniqueOrThrow({ where: { id: member.id } });
      assert.ok(verified.emailVerifiedAt instanceof Date);
      assert.equal(verified.status, "active");
      const used = await db.clientAuthOneTimeToken.findUniqueOrThrow({ where: { tokenHash: hashClientOneTimeToken(keys.value.CLIENT_AUTH_TOKEN_SECRET, purpose, currentDelivery.token) } });
      assert.ok(used.consumedAt instanceof Date);
      for (const response of concurrent) assert.ok(!response.text.includes(currentDelivery.token), "confirm response never echoes the token");
      const login = await post(enabledApp.url, "/login", { email: member.email, password: member.password }, { origin: "http://localhost:3655" });
      assert.equal(login.response.status, 200, "verified member can use the existing customer login");
      assert.equal(login.response.headers.get("set-cookie") !== null, true);
    });

    await t.test("wrong-project purpose and expired token are rejected without activating another account", async () => {
      const foreign = createClientOneTimeToken();
      observedTokens.push(foreign);
      const foreignPurpose = "client-email-verification:unrelated-project:test";
      await db.clientAuthOneTimeToken.create({ data: { memberId: other.id, purpose: foreignPurpose,
        tokenHash: hashClientOneTimeToken(keys.value.CLIENT_AUTH_TOKEN_SECRET, foreignPurpose, foreign), expiresAt: new Date(Date.now() + 60_000) } });
      const foreignResult = await post(enabledApp.url, confirmPath, { token: foreign });
      assert.equal(foreignResult.response.status, 400, "another project's purpose cannot be confirmed here");
      const expired = createClientOneTimeToken();
      observedTokens.push(expired);
      await db.clientAuthOneTimeToken.create({ data: { memberId: other.id, purpose,
        tokenHash: hashClientOneTimeToken(keys.value.CLIENT_AUTH_TOKEN_SECRET, purpose, expired), expiresAt: new Date(Date.now() - 1000) } });
      const expiredResult = await post(enabledApp.url, confirmPath, { token: expired });
      assert.equal(expiredResult.response.status, 400, "expired token is rejected");
      const unchanged = await db.memberUser.findUniqueOrThrow({ where: { id: other.id } });
      assert.equal(unchanged.emailVerifiedAt, null);
    });

    await t.test("request identity is rate limited and repeated issuance leaves one active token", async () => {
      const responses = [];
      for (let attempt = 0; attempt < 5; attempt++) responses.push(await post(enabledApp.url, requestPath, { email: other.email }));
      assert.ok(responses.every(item => item.response.status === 202), "first five identity requests are accepted generically");
      const limited = await post(enabledApp.url, requestPath, { email: other.email });
      assert.equal(limited.response.status, 429, "sixth identity request is rate limited");
      const rows = await db.clientAuthOneTimeToken.findMany({ where: { memberId: other.id, purpose }, orderBy: { createdAt: "asc" } });
      const issued = rows.filter(item => item.expiresAt > new Date());
      assert.equal(issued.length, 5, "five issued tokens remain recorded; old tokens are revoked, not deleted");
      assert.equal(issued.filter(item => item.revokedAt === null && item.consumedAt === null).length, 1);
      assert.equal(adapter.testDeliveries.filter(item => item.memberId === other.id).length, 5);
      const rateRows = await db.clientAuthRateBucket.findMany({ where: { scope: { in: ["verification_request_identity", "verification_request_ip"] } } });
      assert.ok(rateRows.length >= 2);
      assert.ok(rateRows.every(item => /^[a-f0-9]{64}$/.test(item.keyHash)));
      const serialized = JSON.stringify(rateRows);
      assert.ok(!serialized.includes(other.email));
      assert.ok(!serialized.includes("127.0.0.1"));
    });

    await t.test("confirmation guesses are rate limited and malformed DTOs fail before persistence", async () => {
      const guess = createClientOneTimeToken();
      observedTokens.push(guess);
      for (let attempt = 0; attempt < 5; attempt++) {
        const invalid = await post(enabledApp.url, confirmPath, { token: guess });
        assert.equal(invalid.response.status, 400);
      }
      const limited = await post(enabledApp.url, confirmPath, { token: guess });
      assert.equal(limited.response.status, 429);
      const before = await db.clientAuthOneTimeToken.count();
      const malformed = await post(enabledApp.url, confirmPath, { token: "short", purpose: "admin" });
      assert.equal(malformed.response.status, 400, "DTO rejects malformed tokens and undeclared fields");
      assert.equal(await db.clientAuthOneTimeToken.count(), before);
      const failureAudit = await db.auditLog.findMany({ where: { module: "client-auth", action: { in: ["verification_failed", "verification_rate_limited"] } } });
      const auditText = JSON.stringify(failureAudit);
      for (const raw of observedTokens) assert.ok(!auditText.includes(raw), "audit never stores submitted or issued plaintext tokens");
      for (const value of [other.email, member.email, "127.0.0.1", "AF084-Synthetic-Agent", keys.value.CLIENT_AUTH_TOKEN_SECRET]) {
        assert.ok(!auditText.includes(value), "failure audit is redacted");
      }
      assert.ok(failureAudit.some(item => item.action === "verification_rate_limited"));
    });

    await writeRuntimeEvidence(task, lease.id, "client-verification-http.json", {
      database: lease.database, apiAddress: enabledApp.url, portBinding: "127.0.0.1:OS-selected",
      testCases: 6, tokenTtlSeconds: 1800, requestRateLimit: "5 per namespaced identity per 15 minutes",
      confirmationRateLimit: "5 per HMACed token and 30 per HMACed IP per 15 minutes",
      validUseActivatesMember: true, concurrentConsumeOnce: true, wrongProjectRejected: true,
      expiredReplayAndRateLimitRejected: true, rawTokenPersisted: false, auditRedacted: true,
      externalProviderCalls: 0, realMessagesSent: 0
    });
  } finally {
    if (enabledApp) await enabledApp.app.close();
    if (disabledApp) await disabledApp.app.close();
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, originalEnvironment);
  }
});

test("AF-084 notification test adapter is forbidden in production", () => {
  const previous = { ...process.env };
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, { RUNTIME_PROFILE: "host", PROJECT_ID: "aij-foundation", APP_ENV: "production", NODE_ENV: "production",
    AUTH_ENABLED: "false", CLIENT_AUTH_ENABLED: "false", DATABASE_ENABLED: "false", STORAGE_ENABLED: "false",
    CLIENT_AUTH_NOTIFICATION_ADAPTER: "test" });
  try {
    const { ClientAuthNotificationAdapter } = require(join(repositoryRoot, "apps/api/dist/client-auth/client-auth-notification.adapter.js"));
    assert.throws(() => new ClientAuthNotificationAdapter(), /forbidden in production/);
  } finally {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, previous);
  }
});
