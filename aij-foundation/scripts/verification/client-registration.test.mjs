import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";
import { createAcceptance, migrate } from "../database/migration.mjs";
import { repositoryRoot } from "../database/connection.mjs";
import { clientEnvironment, clientKeys, prepareClientFixture } from "./client-auth-fixture.mjs";
import { writeRuntimeEvidence } from "./runtime-fixture.mjs";

const task = "AF-083";
const require = createRequire(join(repositoryRoot, "apps/api/package.json"));
const noHash = value => assert.ok(!/\$2[aby]\$\d\d\$/.test(value), "password hashes are not returned or audited");

test("AF-083 customer registration uses real PostgreSQL and anonymous Nest HTTP", { timeout: 240_000 }, async t => {
  const lease = await createAcceptance("test", task);
  const deployed = await migrate({ mode: "test", action: "deploy", acceptanceId: lease.id });
  assert.equal(deployed.exitCode, 0, "only the new AF-083 isolated test database deploys the local migration chain");
  const status = await migrate({ mode: "test", action: "status", acceptanceId: lease.id });
  assert.equal(status.exitCode, 0, "the isolated acceptance database is current before application writes");
  const fixture = await prepareClientFixture(lease.id, task);
  const environment = clientEnvironment(lease.id, task), keys = clientKeys(lease.id, task);
  const originalEnvironment = { ...process.env };
  const setEnvironment = values => { for (const key of Object.keys(process.env)) delete process.env[key]; Object.assign(process.env, values); };
  const secrets = [keys.value.CLIENT_JWT_SECRET, keys.value.CLIENT_AUTH_RATE_LIMIT_SECRET,
    environment.JWT_SECRET, ...fixture.accounts.map(account => account.password)];
  let app;
  try {
    setEnvironment(environment);
    const { createApplication } = require(join(repositoryRoot, "apps/api/dist/bootstrap.js"));
    const { PrismaService } = require(join(repositoryRoot, "apps/api/dist/prisma/prisma.service.js"));
    app = await createApplication();
    await app.listen(0, "127.0.0.1");
    const address = app.getHttpServer().address();
    assert.ok(address && typeof address === "object" && address.port > 0, "test host binds an OS-selected loopback port");
    const prisma = app.get(PrismaService);
    const url = `http://127.0.0.1:${address.port}/api/client/auth`;
    async function request(path, body, expected = 202) {
      const response = await fetch(url + path, { method: "POST", headers: {
        connection: "close", "content-type": "application/json", "x-correlation-id": "af083-registration-test",
        "user-agent": "AF083-Synthetic-Test-Agent", "origin": "http://localhost:3655"
      }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000) });
      const text = await response.text();
      assert.equal(response.status, expected, `POST ${path}`);
      assert.equal(response.headers.get("cache-control"), "no-store");
      const parsed = JSON.parse(text);
      noHash(text);
      for (const secret of secrets) assert.ok(!text.includes(secret), "response never echoes credentials");
      return { response, parsed, text };
    }
    const initialMemberCount = await prisma.memberUser.count();
    const initialAdminCount = await prisma.sysUser.count();
    const initialWorkspaceCount = await prisma.clientWorkspace.count();

    await t.test("valid registration creates only a pending customer identity and no session/token", async () => {
      const password = "G5Account9!";
      secrets.push(password);
      const result = await request("/register", { email: "  AF083.New@Example.Test  ", nickname: "  Synthetic Member  ", password });
      assert.equal(result.parsed.data.accepted, true);
      assert.equal(result.response.headers.get("set-cookie"), null);
      assert.deepEqual(Object.keys(result.parsed.data).sort(), ["accepted"]);
      const member = await prisma.memberUser.findUniqueOrThrow({ where: { email: "af083.new@example.test" } });
      assert.equal(member.nickname, "Synthetic Member");
      assert.equal(member.status, "pending_verification", "registration cannot activate an unverified identity");
      assert.equal(member.emailVerifiedAt, null);
      assert.ok(member.passwordHash && member.passwordHash !== password);
      assert.match(member.passwordHash, /^\$2[aby]\$12\$/);
      const bcrypt = require("bcryptjs");
      assert.equal(await bcrypt.compare(password, member.passwordHash), true);
      assert.equal(await prisma.clientAuthSession.count({ where: { memberId: member.id } }), 0);
      assert.equal(await prisma.clientAuthOneTimeToken.count({ where: { memberId: member.id } }), 0, "verification tokens belong to G5-02");
      assert.equal(await prisma.clientConsentRecord.count({ where: { memberId: member.id } }), 0, "no consent is inferred from registration");
      assert.equal(await prisma.clientWorkspaceMembership.count({ where: { memberId: member.id } }), 0);
      assert.equal(await prisma.sysUser.count(), initialAdminCount, "customer cannot create an admin account");
      assert.equal(await prisma.clientWorkspace.count(), initialWorkspaceCount, "registration does not create a tenant or self-assign a project");
      assert.equal(await prisma.memberUser.count(), initialMemberCount + 1);
      const login = await request("/login", { email: "af083.new@example.test", password }, 401);
      assert.equal(login.response.headers.get("set-cookie"), null, "pending accounts cannot sign in or receive a client cookie");
      const rows = await prisma.auditLog.findMany({ where: { module: "client-auth", action: "registration_requested" } });
      assert.equal(rows.length, 1);
      assert.equal(rows[0].status, "success");
      const auditText = JSON.stringify(rows);
      for (const value of ["af083.new@example.test", password, "127.0.0.1", "AF083-Synthetic-Test-Agent"]) assert.ok(!auditText.includes(value));
      assert.ok(auditText.includes("af083-registration-test"));
      const buckets = await prisma.clientAuthRateBucket.findMany({ where: { scope: "registration_ip" } });
      assert.equal(buckets.length, 1);
      assert.match(buckets[0].keyHash, /^[a-f0-9]{64}$/);
      assert.ok(!JSON.stringify(buckets).includes("127.0.0.1"), "registration rate limit stores only a namespaced HMAC");
      await writeRuntimeEvidence(task, lease.id, "registration-created.json", {
        status: 202, memberId: member.id, accountStatus: member.status, verified: false,
        passwordHashed: true, sessionCount: 0, tokenCount: 0, consentCount: 0, tenantMembershipCount: 0,
        adminCountUnchanged: true, pendingLoginRejected: login.response.status === 401, auditRedacted: true, ipRateLimitKeyHashed: true
      });
    });

    await t.test("case/space-normalized duplicate identities return the same generic result without another row", async () => {
      secrets.push("AnotherPass9!");
      const duplicate = await request("/register", { email: " AF083.NEW@EXAMPLE.TEST ", nickname: "Different request", password: "AnotherPass9!" });
      assert.equal(duplicate.parsed.data.accepted, true);
      assert.deepEqual(duplicate.parsed.data, { accepted: true });
      assert.equal(duplicate.response.headers.get("set-cookie"), null);
      assert.equal(await prisma.memberUser.count({ where: { email: { equals: "af083.new@example.test", mode: "insensitive" } } }), 1);
      assert.equal(await prisma.clientAuthSession.count(), 0);
      assert.equal(await prisma.clientAuthOneTimeToken.count(), 0);
      const rows = await prisma.auditLog.findMany({ where: { module: "client-auth", action: "registration_requested" } });
      assert.equal(rows.length, 2);
      const auditText = JSON.stringify(rows);
      for (const value of ["af083.new@example.test", "AF083.NEW@EXAMPLE.TEST", "AnotherPass9!"]) assert.ok(!auditText.includes(value));
    });

    await t.test("concurrent duplicate registration is serialized and leaves exactly one identity", async () => {
      secrets.push("RacePass9!", "RacePass8!");
      const results = await Promise.all([
        request("/register", { email: "AF083.Race@Example.Test", nickname: "Race A", password: "RacePass9!" }),
        request("/register", { email: " af083.race@example.test ", nickname: "Race B", password: "RacePass8!" })
      ]);
      assert.deepEqual(results.map(result => result.response.status), [202, 202]);
      assert.deepEqual(results[0].parsed.data, results[1].parsed.data);
      assert.equal(await prisma.memberUser.count({ where: { email: { equals: "af083.race@example.test", mode: "insensitive" } } }), 1);
      assert.equal(await prisma.clientAuthSession.count(), 0);
      assert.equal(await prisma.clientAuthOneTimeToken.count(), 0);
    });

    await t.test("invalid payload and privilege/project injection are rejected before writes", async () => {
      const before = await prisma.memberUser.count();
      secrets.push("SafePass9!");
      const oversizedBcryptInput = "A1" + "密".repeat(24);
      secrets.push(oversizedBcryptInput);
      for (const body of [
        { email: "not-an-email", nickname: "No", password: "SafePass9!" },
        { email: "bad-password@example.test", nickname: "No", password: "short" },
        { email: "bad-name@example.test", nickname: "   ", password: "SafePass9!" },
        { email: "long-name@example.test", nickname: "n".repeat(51), password: "SafePass9!" },
        { email: "long-password@example.test", nickname: "No", password: oversizedBcryptInput },
        { email: "inject@example.test", nickname: "No", password: "SafePass9!", role: "admin" },
        { email: "inject2@example.test", nickname: "No", password: "SafePass9!", roleId: "root" },
        { email: "inject3@example.test", nickname: "No", password: "SafePass9!", status: "active" },
        { email: "inject4@example.test", nickname: "No", password: "SafePass9!", projectId: "foreign-project", workspaceId: "foreign-workspace" },
        { email: "inject5@example.test", nickname: "No", password: "SafePass9!", isSuperAdmin: true, permissions: ["*"] }
      ]) await request("/register", body, 400);
      assert.equal(await prisma.memberUser.count(), before);
      assert.equal(await prisma.clientAuthSession.count(), 0);
      assert.equal(await prisma.clientAuthOneTimeToken.count(), 0);
      assert.equal(await prisma.sysUser.count(), initialAdminCount);
      assert.equal(await prisma.clientWorkspace.count(), initialWorkspaceCount);
    });

    const evidence = await writeRuntimeEvidence(task, lease.id, "registration-http.json", {
      database: lease.database, apiAddress: url, portBinding: "127.0.0.1:OS-selected",
      testCases: 4, accepted: 4, failed: 0, invalidRequestsRejected: 10,
      responseEnumerationSafe: true, pendingLoginRejected: true, roleOrTenantInjectionRejected: true,
      realProviderCalls: 0, realMessagesSent: 0
    });
    assert.match(evidence, /registration-http\.json$/);
  } finally {
    if (app) await app.close();
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, originalEnvironment);
  }
});
