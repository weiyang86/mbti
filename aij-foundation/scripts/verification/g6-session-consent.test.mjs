import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { join } from "node:path";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import test from "node:test";
import { createAcceptance, migrate } from "../database/migration.mjs";
import { assertLocalPath, readDatabaseEnvironment, repositoryRoot, withDatabase } from "../database/connection.mjs";
import { clientEnvironment, clientKeys, prepareClientFixture } from "./client-auth-fixture.mjs";
import { prepareUi2Fixture } from "./ui2-fixture.mjs";

test("G6-07 admin session and consent APIs enforce namespace, RBAC, reauthentication and audit redaction against real PostgreSQL/HTTP", { timeout: 720_000 }, async t => {
  const lease = await createAcceptance("test", "AF-089");
  await migrate({ mode: "test", action: "deploy", acceptanceId: lease.id });
  await migrate({ mode: "test", action: "status", acceptanceId: lease.id });
  const adminFixture = await prepareUi2Fixture(lease.id, "AF-089");
  const clientFixture = await prepareClientFixture(lease.id, "AF-089");
  const adminSaved = JSON.parse(readFileSync(adminFixture.accounts[0].initialPasswordFile, "utf8"));
  const clientSaved = JSON.parse(readFileSync(clientFixture.accounts[0].initialPasswordFile, "utf8"));
  const manager = adminSaved.accounts.find(account => account.username === "ui2-client-session-manager");
  const reader = adminSaved.accounts.find(account => account.username === "ui2-client-manager");
  const empty = adminSaved.accounts.find(account => account.username === "ui2-empty");
  const [member, otherMember] = clientSaved.accounts;
  assert.ok(manager && reader && empty && member && otherMember, "only task-owned synthetic credentials are used");
  const env = clientEnvironment(lease.id, "AF-089"), clientSecretKeys = clientKeys(lease.id, "AF-089");
  const secrets = [manager.password, reader.password, empty.password, member.password, otherMember.password, env.JWT_SECRET,
    ...Object.values(clientSecretKeys.value).filter(value => typeof value === "string"), "AF089-WRONG-REAUTH-" + randomBytes(18).toString("hex")];
  const wrongReauth = secrets.at(-1);
  const originalEnvironment = { ...process.env }, setEnvironment = value => { for (const key of Object.keys(process.env)) delete process.env[key]; Object.assign(process.env, value); };
  const require = createRequire(join(repositoryRoot, "apps/api/package.json"));
  const { createApplication } = require(join(repositoryRoot, "apps/api/dist/bootstrap.js"));
  const { PrismaService } = require(join(repositoryRoot, "apps/api/dist/prisma/prisma.service.js"));
  const evidenceDir = join(repositoryRoot, ".artifacts/verification/AF-089");
  mkdirSync(evidenceDir, { recursive: true, mode: 0o700 });
  let app, prisma, adminToken;
  const memberCookieName = "aij_foundation_test_client_session";
  const namespace = "aij-foundation:test", foreignNamespace = "other-project:test";
  const foreignOnlyMemberId = randomUUID();
  const query = operation => withDatabase("test", readDatabaseEnvironment("test", process.env, lease.id), operation, { acceptanceId: lease.id });

  async function call(path, { method = "GET", token, cookie, body, expected = 200, origin } = {}) {
    const headers = { connection: "close", "x-correlation-id": "af089-session-consent", ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: "Bearer " + token } : {}), ...(cookie ? { cookie } : {}), ...(origin ? { origin } : {}) };
    const response = await fetch(apiOrigin + "/api/" + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
    assert.equal(response.status, expected, `HTTP ${method} ${path}`);
    assert.equal(response.headers.get("x-correlation-id"), "af089-session-consent");
    const text = await response.text();
    for (const secret of secrets) assert.ok(!text.includes(secret), "HTTP responses and errors must not echo passwords, JWT secrets or cookies");
    assert.ok(!/passwordHash|password_hash|deviceHash|device_hash|ipHash|ip_hash|textDigest|text_digest|tokenHash|token_hash|\$2[aby]\$\d\d\$/.test(text), "HTTP response projection excludes stored secrets/hashes");
    return { response, body: text ? JSON.parse(text) : null };
  }
  let apiOrigin, ownedMemberSessionIds = [], foreignSession;
  try {
    await query(async client => {
      await client.query("UPDATE public.member_user SET status='active', email_verified_at=COALESCE(email_verified_at,NOW()) WHERE id=ANY($1::text[])", [[member.id, otherMember.id]]);
      await client.query("INSERT INTO public.member_user(id,email,nickname,password_hash,status,updated_at) VALUES($1,$2,$3,NULL,'active',NOW())",
        [foreignOnlyMemberId, "af089-foreign-only-" + randomBytes(8).toString("hex") + "@example.test", "AF089 foreign-only member"]);
      await client.query("INSERT INTO public.client_consent_record(id,member_id,namespace,consent_type,granted,text_version,text_digest,source,captured_at,created_at,updated_at) VALUES($1,$2,$3,'privacy',true,'af089-v1',$4,'synthetic_fixture',$5,$5,$5),($6,$2,$7,'privacy',false,'foreign-v1',$8,'synthetic_fixture',$5,$5,$5),($9,$10,$7,'privacy',true,'foreign-only',$11,'synthetic_fixture',$5,$5,$5)",
        [randomUUID(), member.id, namespace, "AF089_CONSENT_DIGEST_" + randomBytes(20).toString("hex"), new Date(), randomUUID(), foreignNamespace, "AF089_FOREIGN_CONSENT_" + randomBytes(20).toString("hex"), randomUUID(), foreignOnlyMemberId, "AF089_FOREIGN_ONLY_" + randomBytes(20).toString("hex")]);
    });

    setEnvironment(env);
    app = await createApplication();
    await app.listen(0, "127.0.0.1");
    const address = app.getHttpServer().address(); assert.ok(address && typeof address === "object");
    apiOrigin = `http://127.0.0.1:${address.port}`;
    prisma = app.get(PrismaService);
    const adminLogin = await fetch(apiOrigin + "/api/auth/login", { method: "POST", headers: { connection: "close", "content-type": "application/json", "x-correlation-id": "af089-admin-login" },
      body: JSON.stringify({ username: manager.username, password: manager.password }), signal: AbortSignal.timeout(10_000) });
    assert.equal(adminLogin.status, 200, "synthetic authorized administrator login succeeds");
    const adminLoginBody = await adminLogin.json();
    adminToken = adminLoginBody.data.accessToken; assert.ok(adminToken); secrets.push(adminToken);
    const loginReader = async account => {
      const response = await fetch(apiOrigin + "/api/auth/login", { method: "POST", headers: { connection: "close", "content-type": "application/json" }, body: JSON.stringify({ username: account.username, password: account.password }), signal: AbortSignal.timeout(10_000) });
      assert.equal(response.status, 200); const payload = await response.json(); secrets.push(payload.data.accessToken); return payload.data.accessToken;
    };
    const readerToken = await loginReader(reader), emptyToken = await loginReader(empty);
    const loginMember = async account => {
      const response = await fetch(apiOrigin + "/api/client/auth/login", { method: "POST", headers: { connection: "close", origin: "http://localhost:3655", "content-type": "application/json", "x-correlation-id": "af089-client-login" },
        body: JSON.stringify({ email: account.email, password: account.password }), signal: AbortSignal.timeout(10_000) });
      assert.equal(response.status, 200, "verified synthetic customer can authenticate through the real ClientAuth HTTP route");
      const setCookie = response.headers.get("set-cookie"); assert.ok(setCookie); const cookie = setCookie.split(";", 1)[0];
      const token = cookie.slice(memberCookieName.length + 1); secrets.push(token);
      const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
      const session = await prisma.clientAuthSession.findUniqueOrThrow({ where: { id: claims.sessionId } });
      assert.equal(session.namespace, namespace); assert.equal(session.memberId, account.id);
      return { cookie, session, claims };
    };
    const first = await loginMember(member), second = await loginMember(member), other = await loginMember(otherMember);
    ownedMemberSessionIds = [first.session.id, second.session.id];
    const foreignNow = new Date();
    foreignSession = await prisma.clientAuthSession.create({ data: { memberId: member.id, namespace: foreignNamespace, status: "active", deviceHash: randomBytes(32).toString("hex"),
      deviceSummary: "synthetic foreign project", ipHash: randomBytes(32).toString("hex"), issuedAt: foreignNow, expiresAt: new Date(foreignNow.getTime() + 3_600_000) } });

    await t.test("anonymous and insufficient roles are rejected; reader can query but cannot revoke", async () => {
      await call(`admin/clients/${member.id}/sessions`, { expected: 401 });
      await call(`admin/clients/${member.id}/consents`, { expected: 401 });
      await call(`admin/clients/${member.id}/sessions/${first.session.id}/revoke`, { method: "POST", body: { currentPassword: manager.password }, expected: 401 });
      await call(`admin/clients/${member.id}/sessions`, { token: emptyToken, expected: 403 });
      const listed = await call(`admin/clients/${member.id}/sessions`, { token: readerToken });
      assert.equal(listed.body.data.total, 2); assert.equal(listed.body.data.items.length, 2);
      await call(`admin/clients/${member.id}/sessions/${first.session.id}/revoke`, { method: "POST", token: readerToken, body: { currentPassword: manager.password }, expected: 403 });
      const stillActive = await prisma.clientAuthSession.findUniqueOrThrow({ where: { id: first.session.id } }); assert.equal(stillActive.status, "active");
    });

    await t.test("namespace-scoped session and consent history is paginated and excludes device, IP and consent digest", async () => {
      const sessions = await call(`admin/clients/${member.id}/sessions?page=1&pageSize=1`, { token: adminToken });
      assert.equal(sessions.body.data.total, 2); assert.equal(sessions.body.data.items.length, 1); assert.equal(sessions.body.data.page, 1);
      assert.deepEqual(Object.keys(sessions.body.data.items[0]).sort(), ["id", "status", "issuedAt", "expiresAt", "lastSeenAt", "revokedAt", "revokeReason"].sort());
      const consents = await call(`admin/clients/${member.id}/consents?pageSize=10`, { token: adminToken });
      assert.equal(consents.body.data.total, 1); assert.equal(consents.body.data.items.length, 1);
      assert.deepEqual(Object.keys(consents.body.data.items[0]).sort(), ["id", "consentType", "granted", "textVersion", "source", "capturedAt"].sort());
      assert.equal(consents.body.data.items[0].source, "other");
      await call(`admin/clients/${member.id}/sessions?pageSize=101`, { token: adminToken, expected: 400 });
      await call(`admin/clients/${member.id}/consents?workspaceId=${encodeURIComponent(foreignNamespace)}`, { token: adminToken, expected: 400 });
      await call(`admin/clients/${foreignOnlyMemberId}/consents`, { token: adminToken, expected: 404 });
      const serialized = JSON.stringify([sessions.body, consents.body]);
      assert.ok(!serialized.includes(foreignNamespace), "foreign namespace rows are not returned");
      assert.ok(!serialized.includes(member.email), "client email is not part of session/consent history");
    });

    await t.test("wrong password reauthentication is audited and has no effect; authorized reauthentication revokes only one current-project session", async () => {
      await call(`admin/clients/${member.id}/sessions/${first.session.id}/revoke`, { method: "POST", token: adminToken, body: { currentPassword: wrongReauth }, expected: 401 });
      assert.equal((await prisma.clientAuthSession.findUniqueOrThrow({ where: { id: first.session.id } })).status, "active");
      await call(`admin/clients/${member.id}/sessions/${first.session.id}/revoke`, { method: "POST", token: adminToken, body: { currentPassword: manager.password, extra: true }, expected: 400 });
      const result = await call(`admin/clients/${member.id}/sessions/${first.session.id}/revoke`, { method: "POST", token: adminToken, body: { currentPassword: manager.password } });
      assert.deepEqual(result.body.data, { revoked: true, sessionId: first.session.id });
      const revoked = await prisma.clientAuthSession.findUniqueOrThrow({ where: { id: first.session.id } });
      assert.equal(revoked.status, "revoked"); assert.equal(revoked.revokeReason, "admin_revoked"); assert.ok(revoked.revokedAt);
      const firstMe = await fetch(apiOrigin + "/api/client/auth/me", { headers: { cookie: first.cookie }, signal: AbortSignal.timeout(10_000) }); assert.equal(firstMe.status, 401);
      const secondMe = await fetch(apiOrigin + "/api/client/auth/me", { headers: { cookie: second.cookie }, signal: AbortSignal.timeout(10_000) }); assert.equal(secondMe.status, 200);
      assert.equal((await prisma.clientAuthSession.findUniqueOrThrow({ where: { id: second.session.id } })).status, "active");
      assert.equal((await prisma.clientAuthSession.findUniqueOrThrow({ where: { id: foreignSession.id } })).status, "active");
      assert.equal((await prisma.clientAuthSession.findUniqueOrThrow({ where: { id: other.session.id } })).status, "active");
    });

    await t.test("foreign-project session revoke is not found and both namespaces keep their independent state", async () => {
      await call(`admin/clients/${member.id}/sessions/${foreignSession.id}/revoke`, { method: "POST", token: adminToken, body: { currentPassword: manager.password }, expected: 404 });
      const foreignAfter = await prisma.clientAuthSession.findUniqueOrThrow({ where: { id: foreignSession.id } });
      assert.equal(foreignAfter.namespace, foreignNamespace); assert.equal(foreignAfter.status, "active"); assert.equal(foreignAfter.revokedAt, null);
    });

    await t.test("audit HTTP and persisted records trace both reauthentication outcomes and revoke without retaining credentials", async () => {
      const failed = await call("admin/logs?module=auth&action=admin_client_session_reauthentication_failed&pageSize=100", { token: adminToken });
      const successful = await call("admin/logs?module=auth&action=admin_client_session_reauthenticated&pageSize=100", { token: adminToken });
      const revoked = await call("admin/logs?module=client-auth&action=admin_session_revoked&pageSize=100", { token: adminToken });
      assert.ok(failed.body.data.items.some(row => row.status === "failed" && row.path === "/api/admin/clients/sessions/revoke"));
      assert.ok(successful.body.data.items.some(row => row.status === "success" && row.path === "/api/admin/clients/sessions/revoke"));
      assert.ok(revoked.body.data.items.some(row => row.status === "success" && row.resourceId === first.session.id));
      const persisted = await prisma.auditLog.findMany({ where: { requestSummary: { path: ["correlationId"], equals: "af089-session-consent" } }, orderBy: { createdAt: "asc" } });
      assert.ok(persisted.some(row => row.module === "client-auth" && row.action === "admin_session_revoked"));
      assert.ok(persisted.some(row => row.module === "auth" && row.action === "admin_client_session_reauthentication_failed"));
      for (const row of persisted) {
        const json = JSON.stringify({ summary: row.requestSummary, before: row.beforeData, after: row.afterData, error: row.errorMessage });
        for (const secret of secrets) assert.ok(!json.includes(secret), "stored audit excludes passwords, tokens, hashes and consent digest");
      }
      const logs = JSON.stringify([failed.body, successful.body, revoked.body]);
      for (const secret of secrets) assert.ok(!logs.includes(secret), "audit API remains redacted");
      assert.ok(!logs.includes(foreignNamespace));
    });

    const evidence = join(evidenceDir, `g6-session-consent-${lease.id}.json`); assertLocalPath(evidence);
    writeFileSync(evidence, JSON.stringify({ task: "AF-089", acceptanceId: lease.id, database: lease.database, namespace, apiOrigin, apiListener: "OS-selected 127.0.0.1 listener closed by app.close() in finally", syntheticMembers: 2,
      scopedSessionsCreated: ownedMemberSessionIds.length, foreignSessionPreserved: true, covered: ["anonymous 401", "no role 403", "read-only role cannot revoke", "scoped paged session/consent queries", "DTO rejection", "foreign namespace 404", "reauth 401/200", "instant single-session revoke", "parallel and foreign sessions unaffected", "persisted and HTTP audit redaction"], secretsLogged: false }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  } finally {
    if (app) await app.close();
    for (const key of Object.keys(process.env)) delete process.env[key]; Object.assign(process.env, originalEnvironment);
  }
});
