import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import test from "node:test";
import { createAcceptance, migrate } from "../database/migration.mjs";
import { repositoryRoot } from "../database/connection.mjs";
import { clientEnvironment, clientKeys, prepareClientFixture } from "./client-auth-fixture.mjs";

const task = "AF-086";
const require = createRequire(join(repositoryRoot, "apps/api/package.json"));

test("AF-086 registration, verification, login and password reset close over real PostgreSQL and Nest HTTP", { timeout: 600_000 }, async t => {
  const lease = await createAcceptance("test", task);
  assert.equal((await migrate({ mode: "test", action: "deploy", acceptanceId: lease.id })).exitCode, 0, "only the new AF-086 logical database deploys");
  assert.equal((await migrate({ mode: "test", action: "status", acceptanceId: lease.id })).exitCode, 0, "AF-086 migration status is current before fixture writes");
  const fixture = await prepareClientFixture(lease.id, task);
  const accounts = JSON.parse(readFileSync(fixture.accounts[0].initialPasswordFile, "utf8")).accounts;
  const baseEnvironment = clientEnvironment(lease.id, task), keys = clientKeys(lease.id, task);
  const email = `af086-${randomBytes(10).toString("hex")}@example.test`;
  const nickname = "AF086 Synthetic Browser Flow";
  const password = "RegisterPass" + randomBytes(8).toString("hex") + "9";
  const resetPassword = "ResetPass" + randomBytes(8).toString("hex") + "7";
  const { createApplication } = require(join(repositoryRoot, "apps/api/dist/bootstrap.js"));
  const { PrismaService } = require(join(repositoryRoot, "apps/api/dist/prisma/prisma.service.js"));
  const { ClientAuthNotificationAdapter } = require(join(repositoryRoot, "apps/api/dist/client-auth/client-auth-notification.adapter.js"));
  const originalEnvironment = { ...process.env };
  const setEnvironment = values => { for (const key of Object.keys(process.env)) delete process.env[key]; Object.assign(process.env, values); };
  let app;
  const credentials = [password, resetPassword, ...accounts.map(account => account.password),
    keys.value.CLIENT_JWT_SECRET, keys.value.CLIENT_AUTH_RATE_LIMIT_SECRET, keys.value.CLIENT_AUTH_TOKEN_SECRET];
  const rawTokens = [];
  try {
    setEnvironment({ ...baseEnvironment, CLIENT_AUTH_NOTIFICATION_ADAPTER: "test" });
    app = await createApplication();
    await app.listen(0, "127.0.0.1");
    const address = app.getHttpServer().address();
    assert.ok(address && typeof address === "object" && address.port > 0);
    const url = `http://127.0.0.1:${address.port}/api/client/auth`;
    const db = app.get(PrismaService);
    const adapter = app.get(ClientAuthNotificationAdapter);
    const post = async (path, body, { cookie, origin = "http://localhost:3655" } = {}) => {
      const response = await fetch(url + path, { method: "POST", headers: {
        connection: "close", origin, "content-type": "application/json", "x-correlation-id": "af086-web-flow",
        "user-agent": "AF086-Synthetic-Web", ...(cookie ? { cookie } : {})
      }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
      const text = await response.text();
      let parsed;
      try { parsed = JSON.parse(text); } catch { assert.fail("API response must be valid JSON"); }
      for (const secret of [...credentials, ...rawTokens]) assert.ok(!text.includes(secret), "HTTP responses do not expose credentials or raw tokens");
      return { response, parsed, text };
    };
    const login = (candidateEmail, candidatePassword) => post("/login", { email: candidateEmail, password: candidatePassword });

    await t.test("registration rejects privilege injection and creates only a pending customer identity", async () => {
      const injected = await post("/register", { email, nickname, password, roleId: "admin", workspaceId: "foreign-workspace" });
      assert.equal(injected.response.status, 400, "registration DTO rejects role/workspace privilege fields");
      const accepted = await post("/register", { email, nickname, password });
      assert.equal(accepted.response.status, 202);
      assert.deepEqual(accepted.parsed.data, { accepted: true });
      const member = await db.memberUser.findUniqueOrThrow({ where: { email } });
      assert.equal(member.status, "pending_verification");
      assert.equal(member.emailVerifiedAt, null);
      assert.equal(member.email, email.toLowerCase());
      assert.equal(await db.clientAuthSession.count({ where: { memberId: member.id, status: "active" } }), 0, "registration grants no session");
      assert.equal(await db.clientWorkspaceMembership.count({ where: { memberId: member.id } }), 0, "registration grants no workspace membership");
      assert.equal((await login(email, password)).response.status, 401, "unverified member cannot log in");
      const duplicate = await post("/register", { email: email.toUpperCase(), nickname, password });
      assert.equal(duplicate.response.status, 202);
      assert.deepEqual(duplicate.parsed.data, accepted.parsed.data, "duplicate response does not reveal account existence");
    });

    let verifiedMember;
    await t.test("email token is consumed once, and verification activates the account", async () => {
      const requested = await post("/email/verification/request", { email });
      assert.equal(requested.response.status, 202);
      assert.deepEqual(requested.parsed.data, { accepted: true });
      const delivery = adapter.testDeliveries.at(-1);
      assert.equal(delivery.purpose, "email_verification");
      rawTokens.push(delivery.token);
      assert.ok(!requested.text.includes(delivery.token));
      const confirmed = await post("/email/verification/confirm", { token: delivery.token });
      assert.equal(confirmed.response.status, 200);
      verifiedMember = await db.memberUser.findUniqueOrThrow({ where: { email } });
      assert.equal(verifiedMember.status, "active");
      assert.ok(verifiedMember.emailVerifiedAt instanceof Date);
      const consumed = await db.clientAuthOneTimeToken.findFirstOrThrow({ where: { memberId: verifiedMember.id, purpose: { startsWith: "client-email-verification:" } } });
      assert.ok(consumed.consumedAt instanceof Date);
      assert.equal((await post("/email/verification/confirm", { token: delivery.token })).response.status, 400, "replayed token is rejected");
      assert.equal((await login(email, password)).response.status, 200, "verified customer can log in");
    });

    let oldCookie;
    await t.test("login sets an HttpOnly session cookie and /me returns only the customer principal", async () => {
      const loggedIn = await login(email, password);
      assert.equal(loggedIn.response.status, 200);
      const setCookie = loggedIn.response.headers.get("set-cookie") || "";
      assert.ok(/\bHttpOnly\b/i.test(setCookie), "session cookie has HttpOnly");
      assert.ok(/\bSameSite=Strict\b/i.test(setCookie), "session cookie has the configured strict SameSite policy");
      assert.ok(/\bPath=\/api\/client\b/i.test(setCookie), "session cookie is scoped to the client authentication API");
      oldCookie = setCookie.split(";")[0];
      assert.ok(oldCookie);
      assert.ok(!loggedIn.text.includes(password));
      const me = await fetch(url + "/me", { headers: { cookie: oldCookie, connection: "close" }, signal: AbortSignal.timeout(10_000) });
      assert.equal(me.status, 200);
      const meText = await me.text();
      for (const secret of [...credentials, ...rawTokens]) assert.ok(!meText.includes(secret));
      assert.ok(meText.includes(email));
      assert.ok(!meText.includes("passwordHash"));
    });

    await t.test("password reset uses the test notification port, revokes old session and password, and accepts the replacement", async () => {
      const requested = await post("/password/reset/request", { email });
      assert.equal(requested.response.status, 202);
      assert.deepEqual(requested.parsed.data, { accepted: true });
      const delivery = adapter.testDeliveries.at(-1);
      assert.equal(delivery.purpose, "password_reset");
      rawTokens.push(delivery.token);
      const completed = await post("/password/reset/confirm", { token: delivery.token, newPassword: resetPassword });
      assert.equal(completed.response.status, 200);
      assert.deepEqual(completed.parsed.data, { reset: true });
      assert.match(completed.response.headers.get("set-cookie") || "", /Max-Age=0/);
      assert.equal((await fetch(url + "/me", { headers: { cookie: oldCookie, connection: "close" } })).status, 401, "old browser cookie no longer authorizes the old session");
      assert.equal((await login(email, password)).response.status, 401, "old password is rejected");
      const replacementLogin = await login(email, resetPassword);
      assert.equal(replacementLogin.response.status, 200, "replacement password authenticates through the real HTTP endpoint");
      assert.equal((await post("/password/reset/confirm", { token: delivery.token, newPassword: "ReplayPass123" })).response.status, 400, "reset token cannot be replayed");
      const activeSessions = await db.clientAuthSession.count({ where: { memberId: verifiedMember.id, status: "active" } });
      assert.equal(activeSessions, 1, "only the new post-reset login session is active");
    });

    await t.test("audit rows retain correlation but exclude email, tokens, passwords and user-agent", async () => {
      const rows = await db.auditLog.findMany({ where: { module: "client-auth", resourceId: verifiedMember.id } });
      const content = JSON.stringify(rows);
      assert.ok(rows.some(row => row.action === "registration_requested"));
      assert.ok(rows.some(row => row.action === "email_verified"));
      assert.ok(rows.some(row => row.action === "password_reset_completed"));
      assert.ok(content.includes("af086-web-flow"));
      for (const secret of [email, nickname, ...credentials, ...rawTokens]) assert.ok(!content.includes(secret), "audit persistence excludes customer identifiers and credentials");
      assert.ok(!content.includes("AF086-Synthetic-Web"));
    });
  } finally {
    if (app) await app.close();
    setEnvironment(originalEnvironment);
  }
});
