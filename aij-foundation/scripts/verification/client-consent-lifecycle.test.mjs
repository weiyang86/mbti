import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import test from "node:test";
import { acceptanceRecord, repositoryRoot } from "../database/connection.mjs";
import { createAcceptance, migrate } from "../database/migration.mjs";
import { assertPortAvailable } from "../port-availability.mjs";
import { applicationSessions } from "./readiness-support.mjs";
import { clientEnvironment, clientKeys, prepareClientFixture } from "./client-auth-fixture.mjs";

const task = "AF-041";
const namespace = "aij-foundation:test";
const cookieName = "aij_foundation_test_client_session";
const output = join(repositoryRoot, ".artifacts/verification/AF-041");
const require = createRequire(join(repositoryRoot, "apps/api/package.json"));

test("client consent is namespace-scoped, versioned, auditable, and idempotent over real HTTP/PostgreSQL", { timeout: 90000 }, async t => {
  await assertPortAvailable(3656);
  const lease = await createAcceptance("test", task);
  await migrate({ mode: "test", action: "deploy", acceptanceId: lease.id });
  assert.equal(acceptanceRecord("test", lease.id).task, task);
  const fixture = await prepareClientFixture(lease.id, task);
  const account = fixture.accounts[0];
  const accountCredentials = JSON.parse(readFileSync(account.initialPasswordFile, "utf8")).accounts.find(value => value.id === account.id);
  assert.ok(accountCredentials, "the account must come from this AF-041 ignored synthetic credential file");
  const env = clientEnvironment(lease.id, task);
  const keyFile = clientKeys(lease.id, task);
  const original = { ...process.env };
  const setEnv = value => { for (const key of Object.keys(process.env)) delete process.env[key]; Object.assign(process.env, value); };
  const { createApplication } = require(join(repositoryRoot, "apps/api/dist/bootstrap.js"));
  const { PrismaService } = require(join(repositoryRoot, "apps/api/dist/prisma/prisma.service.js"));
  const { JwtService } = require("@nestjs/jwt");
  let app, prisma, sessionCookie, clientToken;
  mkdirSync(output, { recursive: true, mode: 0o700 });
  const save = (name, value) => writeFileSync(join(output, name + ".json"), JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  const request = async (path, expected, { method = "GET", cookie, body, origin } = {}) => {
    const headers = { connection: "close", "x-correlation-id": "af041-consent", ...(cookie ? { cookie } : {}) };
    if (method !== "GET") {
      headers.origin = origin || "http://localhost:3655";
      headers["content-type"] = "application/json";
    }
    const response = await fetch("http://127.0.0.1:3656/api/" + path, {
      method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(8000)
    });
    assert.equal(response.status, expected, `HTTP ${method} ${path}`);
    const responseText = await response.text();
    for (const secret of [account.email, accountCredentials.password, env.JWT_SECRET, keyFile.value.CLIENT_JWT_SECRET, clientToken].filter(Boolean)) {
      assert.ok(!responseText.includes(secret), "response must not reveal identity or credentials");
    }
    assert.ok(!/\$2[aby]\$\d\d\$/.test(responseText), "response must not reveal password hashes");
    return { response, body: responseText ? JSON.parse(responseText) : null };
  };
  const consentBody = { consentType: "ai_assistance", granted: true, textVersion: "aij-ai-consent-v1", textDigest: "a".repeat(64) };

  try {
    setEnv(env);
    app = await createApplication();
    await app.listen(3656, "127.0.0.1");
    prisma = app.get(PrismaService);

    await t.test("anonymous reads and writes are rejected", async () => {
      const read = await request("client/auth/consents", 401);
      assert.equal(read.response.headers.get("cache-control"), "no-store");
      await request("client/auth/consents", 401, { method: "PATCH", body: consentBody });
      assert.equal(await prisma.clientConsentRecord.count({ where: { memberId: account.id } }), 0);
    });

    const login = await fetch("http://127.0.0.1:3656/api/client/auth/login", {
      method: "POST", headers: { connection: "close", origin: "http://localhost:3655", "content-type": "application/json", "x-correlation-id": "af041-login" },
      body: JSON.stringify({ email: account.email, password: accountCredentials.password }), signal: AbortSignal.timeout(8000)
    });
    assert.equal(login.status, 200);
    const setCookie = login.headers.get("set-cookie"); assert.ok(setCookie);
    sessionCookie = setCookie.split(";")[0]; clientToken = sessionCookie.slice(cookieName.length + 1);

    await t.test("cross-origin writes and unregistered or malformed consent metadata are rejected", async () => {
      const crossOrigin = await request("client/auth/consents", 403, { method: "PATCH", cookie: sessionCookie, origin: "https://outside.example", body: consentBody });
      assert.equal(crossOrigin.response.headers.get("set-cookie"), null);
      for (const body of [
        { ...consentBody, consentType: "privacy_policy" },
        { ...consentBody, textVersion: "../foreign-version" },
        { ...consentBody, textDigest: "not-a-sha256" },
        { ...consentBody, source: "client-controlled-source" }
      ]) await request("client/auth/consents", 400, { method: "PATCH", cookie: sessionCookie, body });
      assert.equal(await prisma.clientConsentRecord.count({ where: { memberId: account.id } }), 0);
    });

    await t.test("same consent payload is idempotent and captures a server-owned source", async () => {
      const first = await request("client/auth/consents", 200, { method: "PATCH", cookie: sessionCookie, body: consentBody });
      assert.equal(first.body.data.consentType, consentBody.consentType);
      assert.equal(first.body.data.granted, true);
      assert.equal(first.body.data.textVersion, consentBody.textVersion);
      assert.equal(first.body.data.textDigest, consentBody.textDigest);
      assert.equal(first.body.data.source, "client_settings_api");
      assert.equal(first.body.data.unchanged, false);
      const stored = await prisma.clientConsentRecord.findMany({ where: { memberId: account.id, namespace } });
      assert.equal(stored.length, 1);
      assert.ok(stored[0].capturedAt instanceof Date);
      const repeat = await request("client/auth/consents", 200, { method: "PATCH", cookie: sessionCookie, body: consentBody });
      assert.equal(repeat.body.data.unchanged, true);
      assert.equal(await prisma.clientConsentRecord.count({ where: { memberId: account.id, namespace } }), 1);
      assert.equal(await prisma.auditLog.count({ where: { module: "client-auth", action: "consent_changed", resourceId: account.id } }), 1);
      const list = await request("client/auth/consents", 200, { cookie: sessionCookie });
      assert.equal(list.body.data.length, 1);
      assert.equal(list.body.data[0].granted, true);
      save("idempotent", { status: "VERIFIED", namespace, source: first.body.data.source, oneRecordAfterRepeat: true, oneAuditAfterRepeat: true });
    });

    await t.test("version change and withdrawal append history; foreign namespace history stays hidden", async () => {
      const versioned = { ...consentBody, textVersion: "aij-ai-consent-v2", textDigest: "b".repeat(64) };
      const changed = await request("client/auth/consents", 200, { method: "PATCH", cookie: sessionCookie, body: versioned });
      assert.equal(changed.body.data.unchanged, false);
      const foreign = await prisma.clientConsentRecord.create({ data: {
        memberId: account.id, namespace: "other-product:production", consentType: "ai_assistance", granted: true,
        textVersion: "foreign-v1", textDigest: "c".repeat(64), source: "synthetic-foreign-namespace"
      } });
      const withdrawn = await request("client/auth/consents", 200, { method: "PATCH", cookie: sessionCookie, body: { ...versioned, granted: false } });
      assert.equal(withdrawn.body.data.granted, false);
      assert.equal(withdrawn.body.data.unchanged, false);
      assert.ok(new Date(withdrawn.body.data.capturedAt) > new Date(changed.body.data.capturedAt));
      const rows = await prisma.clientConsentRecord.findMany({ where: { memberId: account.id, namespace }, orderBy: [{ capturedAt: "asc" }, { id: "asc" }] });
      assert.equal(rows.length, 3);
      assert.deepEqual(rows.map(row => row.granted), [true, true, false]);
      const list = await request("client/auth/consents", 200, { cookie: sessionCookie });
      assert.deepEqual(list.body.data.map(row => ({ consentType: row.consentType, granted: row.granted, source: row.source })), [
        { consentType: "ai_assistance", granted: false, source: "client_settings_api" }
      ]);
      assert.equal((await prisma.clientConsentRecord.findUniqueOrThrow({ where: { id: foreign.id } })).namespace, "other-product:production");
      assert.equal(await prisma.auditLog.count({ where: { module: "client-auth", action: "consent_changed", resourceId: account.id } }), 2);
      assert.equal(await prisma.auditLog.count({ where: { module: "client-auth", action: "consent_withdrawn", resourceId: account.id } }), 1);
      save("history", { status: "VERIFIED", currentNamespaceHistory: rows.map(row => ({ consentType: row.consentType, granted: row.granted, textVersion: row.textVersion, source: row.source })), foreignNamespaceHidden: true });
    });

    await t.test("a valid signature with another project audience is rejected", async () => {
      const claims = JSON.parse(Buffer.from(clientToken.split(".")[1], "base64url").toString("utf8"));
      const foreignToken = await new JwtService().signAsync({ sub: claims.sub, sessionId: claims.sessionId, tokenVersion: claims.tokenVersion, tokenKind: "client", projectId: "aij-foundation", environment: "test" }, {
        secret: keyFile.value.CLIENT_JWT_SECRET, algorithm: "HS256", issuer: env.JWT_ISSUER + ":client",
        audience: "urn:aij:other-product:production:client", expiresIn: 600
      });
      await request("client/auth/consents", 401, { cookie: cookieName + "=" + foreignToken });
      save("cross-project", { status: 401, wrongAudienceRejected: true, foreignTokenNotReturned: true });
    });

    await t.test("audit persists only the correlation reference and safe event metadata", async () => {
      const rows = await prisma.auditLog.findMany({ where: { module: "client-auth", resourceId: account.id, action: { in: ["consent_changed", "consent_withdrawn"] } } });
      assert.equal(rows.length, 3);
      assert.ok(rows.every(row => row.status === "success" && row.path === "/api/client/auth/consents" && row.method === "PATCH"));
      const auditText = JSON.stringify(rows);
      for (const value of [account.email, account.password, "127.0.0.1", clientToken, consentBody.textDigest]) assert.ok(!auditText.includes(value));
      assert.ok(!/\$2[aby]\$\d\d\$/.test(auditText));
      save("audit", { actions: rows.map(row => row.action), path: "/api/client/auth/consents", secretsAbsent: true });
    });

    const status = await migrate({ mode: "test", action: "status", acceptanceId: lease.id });
    assert.equal(status.status, "UP_TO_DATE");
    save("migration", { status: status.status, database: lease.database, acceptanceId: lease.id });
  } finally {
    if (app) await app.close();
    setEnv(original);
  }

  assert.deepEqual(await applicationSessions(lease.id, task), [], "the local HTTP host must release its PostgreSQL pool sessions");
  save("result", { status: "VERIFIED", acceptanceId: lease.id, database: lease.database, namespace, historyAppendOnly: true, repeatedWriteIdempotent: true, foreignNamespaceHidden: true, auditRedacted: true, poolsClosed: true });
});
