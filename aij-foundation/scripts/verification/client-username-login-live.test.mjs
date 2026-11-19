import test from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { acceptanceRecord, assertLocalPath, readDatabaseEnvironment, repositoryRoot, withDatabase } from "../database/connection.mjs";
import { createRemainingClientFixture } from "./remaining-client-fixture.mjs";
import { clientKeys } from "./client-auth-fixture.mjs";

const task = "AF-141";
const authorizedRoot = "/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation";
const names = ["success-and-cookie", "dto-rejections", "origin-rejections", "uniform-credentials",
  "disabled", "pending-verification", "soft-deleted", "duplicate-username", "duplicate-email",
  "literal-identities", "shared-account-budget", "concurrent-budget", "session-boundaries", "revoke-inflight-login", "audit-rollback", "redacted-storage"];
class LiveCheckError extends Error {}
function check(condition, label) { if (!condition) throw new LiveCheckError(label); }
const restoreEnvironment = original => {
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, original);
};

// Root opt-in only. Worker must use node --check / targeted lint, never execute.
test("AF-141 root-only real HTTP/PostgreSQL username and email login", { timeout: 240000 }, async t => {
  check(repositoryRoot === authorizedRoot && process.cwd() === authorizedRoot && process.env.AIJ_AF141_LIVE === "1", "Root-only AF-141 live test requires explicit opt-in");
  const originalEnvironment = { ...process.env };
  const outputDirectory = join(repositoryRoot, ".artifacts/auto-ai-program-20261105/AF-141");
  assertLocalPath(outputDirectory);
  mkdirSync(outputDirectory, { recursive: true, mode: 0o700 });
  const output = join(outputDirectory, "live-" + randomUUID() + ".json");
  const evidence = { task, status: "RUNNING", browser: "NOT_RUN", cases: names.map(name => ({ name, status: "NOT_RUN" })),
    cleanup: { hooksRestored: false, requestsSettled: false, faultRemoved: false, appsClosed: false, apiSessionsZero: false } };
  const sensitive = new Set(), credentialSecrets = new Set();
  const remember = value => { if (typeof value === "string" && value) sensitive.add(value); return value; };
  const rememberSecret = value => { if (typeof value === "string" && value) credentialSecrets.add(remember(value)); return value; };
  function safeText(text) {
    for (const value of sensitive) check(!text.toLowerCase().includes(value.toLowerCase()), "Sensitive value escaped safe boundary");
    check(!/\$2[aby]\$\d\d\$/.test(text), "Password hash escaped safe boundary");
  }
  const save = () => {
    const text = JSON.stringify(evidence, null, 2) + "\n"; safeText(text);
    writeFileSync(output, text, { mode: 0o600 });
  };
  save();
  const require = createRequire(join(repositoryRoot, "apps/api/package.json"));
  const apps = new Set(), inFlight = new Set();
  let fixture, leaseId, prisma, bootstrap, createApplication, faultName, faultRequested = false, failed = false;
  const reason = error => error instanceof LiveCheckError ? error.message : "Unexpected boundary failure (raw error withheld)";
  const database = operation => {
    check(leaseId && acceptanceRecord("test", leaseId).task === task, "Only the new AF-141 lease may be queried");
    return withDatabase("test", readDatabaseEnvironment("test", originalEnvironment, leaseId), operation, { acceptanceId: leaseId });
  };
  const removeFault = async () => {
    if (!faultRequested) return;
    check(/^af141_reject_login_[a-f0-9]{12}$/.test(faultName), "Invalid owned constraint name");
    await database(client => client.query('ALTER TABLE public.audit_log DROP CONSTRAINT IF EXISTS "' + faultName + '"'));
    faultRequested = false;
  };
  async function scenario(name, action, reset) {
    const record = evidence.cases.find(row => row.name === name);
    if (failed) { await t.test(name, { skip: "prior live scenario failed" }, () => {}); return; }
    await t.test(name, async () => {
      try {
        if (reset) await reset();
        const counts = await action();
        Object.assign(record, { status: "PASS", ...(counts ? { counts } : {}) }); save();
      } catch (error) {
        failed = true; Object.assign(record, { status: "FAILED", reason: reason(error) }); save();
        throw new Error("AF-141 " + name + ": " + reason(error));
      }
    });
  }
  try {
    // Capture applications even if the shared helper throws after app creation.
    // This test hook invokes the original bootstrap and is always restored below.
    bootstrap = require(join(repositoryRoot, "apps/api/dist/bootstrap.js"));
    createApplication = bootstrap.createApplication;
    bootstrap.createApplication = async (...args) => {
      const app = await createApplication(...args); apps.add(app); return app;
    };
    fixture = await createRemainingClientFixture(task);
    leaseId = fixture.lease.id; prisma = fixture.prisma;
    check(fixture.lease.task === task && /^aij_foundation_af141_test_[a-f0-9]{16}$/.test(fixture.lease.database), "Fresh AF-141 random lease required");
    evidence.leaseId = leaseId;
    const credentials = JSON.parse(readFileSync(fixture.accounts[0].initialPasswordFile, "utf8")).accounts;
    const account = credentials.find(row => row.id === fixture.accounts[0].id);
    check(account && typeof account.username === "string" && typeof account.password === "string", "Owned fixture credentials required");
    for (const row of credentials) { remember(row.username); remember(row.email); rememberSecret(row.password); }
    for (const cookie of fixture.cookies) { rememberSecret(cookie); rememberSecret(cookie.slice(cookie.indexOf("=") + 1)); }
    const keys = clientKeys(leaseId, task).value;
    for (const key of ["JWT_SECRET", "CLIENT_JWT_SECRET", "CLIENT_AUTH_RATE_LIMIT_SECRET", "CLIENT_AUTH_TOKEN_SECRET", "TEST_DATABASE_URL", "DATABASE_URL"]) rememberSecret(process.env[key]);
    const { ConfigService } = require("@nestjs/config");
    const config = fixture.app.get(ConfigService);
    const namespace = config.getOrThrow("namespace"), cookieName = config.getOrThrow("clientSessionCookie");
    const { hashClientContext, clientAudience, clientIssuer, CLIENT_SESSION_SECONDS } = fixture.requireApi("client-auth/client-auth.security.js");
    const { JwtService } = require("@nestjs/jwt"), jwt = new JwtService();
    const hash = (scope, value, scopeNamespace = namespace) => hashClientContext(keys.CLIENT_AUTH_RATE_LIMIT_SECRET, scopeNamespace, scope, value);
    const userAgent = remember("AF141-Live-Synthetic-Client"), ip = remember("127.0.0.1");
    const unknown = remember("af141-absent-" + randomBytes(6).toString("hex"));
    const absentEmail = remember(unknown + "@example.test");
    const wrongPassword = rememberSecret("Wrong-" + randomBytes(16).toString("hex"));
    const loginScopes = ["login_identity", "login_account", "login_ip"];
    const identityValues = [...credentials.flatMap(row => [row.username, row.email]), unknown, absentEmail].filter(Boolean).map(value => value.trim().toLowerCase());
    const ownedKeys = [
      ...identityValues.map(value => ({ scope: "login_identity", keyHash: hash("login_identity", value) })),
      ...credentials.map(row => ({ scope: "login_account", keyHash: hash("login_account", row.id) })),
      { scope: "login_ip", keyHash: hash("login_ip", ip) }
    ];
    const foreignKeys = [
      ...identityValues.map(value => ({ scope: "login_identity", keyHash: hash("login_identity", value, "foreign:test") })),
      ...credentials.map(row => ({ scope: "login_account", keyHash: hash("login_account", row.id, "foreign:test") })),
      { scope: "login_ip", keyHash: hash("login_ip", ip, "foreign:test") }
    ];
    // Only between scenarios; never invoke this inside either rate-limit scenario.
    const resetLoginBuckets = async () => {
      await prisma.clientAuthRateBucket.deleteMany({ where: { OR: ownedKeys } });
      check(await prisma.clientAuthRateBucket.count({ where: { scope: { in: loginScopes } } }) === 0, "Unexpected bucket owner; no broad cleanup permitted");
    };
    const bucket = async (scope, value) => prisma.clientAuthRateBucket.findUniqueOrThrow({ where: { scope_keyHash: { scope, keyHash: hash(scope, value) } } });
    const countSessions = () => prisma.clientAuthSession.count({ where: { memberId: account.id } });
    const tracked = promise => {
      inFlight.add(promise); promise.finally(() => inFlight.delete(promise)).catch(() => {}); return promise;
    };
    function request(path, { method = "GET", body, cookie, headers = {}, baseUrl = fixture.baseUrl } = {}) {
      return tracked((async () => {
        const response = await fetch(baseUrl + "/client/auth/" + path, { method,
          headers: { connection: "close", "x-correlation-id": "af141-live", "user-agent": userAgent,
            ...(method === "GET" ? {} : { origin: config.getOrThrow("webUrl") }),
            ...(body === undefined ? {} : { "content-type": "application/json" }), ...(cookie ? { cookie } : {}), ...headers },
          body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
        const text = await response.text(), payload = JSON.parse(text);
        check(response.headers.get("cache-control") === "no-store", "Auth response must be no-store");
        check(response.headers.get("x-correlation-id") === "af141-live", "Correlation header must survive HTTP chain");
        // A successful member view legitimately contains email; validate it separately.
        if (response.status >= 400) safeText(text);
        else {
          for (const value of credentialSecrets) check(!text.includes(value), "Credential leaked into successful response");
          check(!/\$2[aby]\$\d\d\$/.test(text), "Password hash leaked into successful response");
        }
        return { response, payload, status: response.status };
      })());
    }
    const login = (identity = { username: account.username }, password = account.password, options = {}) => request("login", { ...options, method: "POST", body: { ...identity, password } });
    const expectFailure = async (responsePromise, status) => {
      const result = await responsePromise;
      check(result.status === status, "Unexpected rejection status (expected " + status + ", received " + result.status + ")");
      check(result.response.headers.get("set-cookie") === null, "Rejected request set a cookie");
      check(result.payload.success === false && result.payload.data === null, "Rejected request exposed principal data");
      return result;
    };
    async function success(identity) {
      const result = await login(identity);
      check(result.status === 200, "Expected successful login");
      check(result.payload.success === true && result.payload.data.id === account.id, "Unexpected successful principal");
      check(result.payload.data.email === account.email, "Unexpected successful email projection");
      check(Object.keys(result.payload.data).sort().join() === "email,id,nickname", "Unsafe principal field projection");
      const header = result.response.headers.get("set-cookie");
      check(typeof header === "string" && header.startsWith(cookieName + "="), "Expected scoped client Cookie");
      check(header.includes("; Path=/api/client") && header.includes("; HttpOnly") && header.includes("; SameSite=Strict") && header.includes("; Max-Age=" + CLIENT_SESSION_SECONDS) && !/Domain=/i.test(header), "Client Cookie attributes changed");
      const cookie = rememberSecret(header.split(";")[0]), token = rememberSecret(cookie.slice(cookieName.length + 1));
      const claims = await jwt.verifyAsync(token, { secret: keys.CLIENT_JWT_SECRET, algorithms: ["HS256"],
        issuer: clientIssuer(config.getOrThrow("issuer")), audience: clientAudience(namespace) });
      check(claims.sub === account.id && claims.tokenKind === "client" && claims.projectId === config.getOrThrow("projectId") && claims.environment === config.getOrThrow("environment"), "JWT identity scope changed");
      check(claims.exp - claims.iat === CLIENT_SESSION_SECONDS, "Client session lifetime changed");
      const session = await prisma.clientAuthSession.findUniqueOrThrow({ where: { id: claims.sessionId } });
      check(session.namespace === namespace && session.memberId === account.id && session.status === "active" && session.revokedAt === null, "Persisted session binding changed");
      check(session.ipHash === hash("session_ip", ip) && session.deviceHash === hash("device", userAgent), "Session context HMAC mismatch");
      const me = await request("me", { cookie });
      check(me.status === 200 && me.payload.data.id === account.id, "Real Cookie /me failed");
      return { cookie, claims };
    }
    const assertNoSessions = async (before, operation) => { await operation(); check(await countSessions() === before, "Rejected request created a session"); };

    await scenario("success-and-cookie", async () => {
      const before = await countSessions();
      for (const identity of [{ username: "  " + account.username.toUpperCase() + "  " }, { email: "  " + account.email.toUpperCase() + "  " }]) await success(identity);
      check(await countSessions() === before + 2, "Two successful aliases must create two sessions");
      const member = await prisma.memberUser.findUniqueOrThrow({ where: { id: account.id } });
      check(member.lastLoginAt instanceof Date, "Successful login did not update lastLoginAt");
      return { successfulAliases: 2, realCookieMe: 2 };
    }, resetLoginBuckets);

    await scenario("dto-rejections", async () => {
      const before = await countSessions();
      const bodies = [{}, { email: account.email, username: account.username }, { email: account.email, username: null },
        { username: account.username, email: "" }, { username: null }, { email: null }, { username: " " },
        { username: account.username, workspaceId: "forged" }, { username: account.username, password: rememberSecret("界".repeat(25)) }];
      for (const body of bodies) await expectFailure(request("login", { method: "POST", body: { password: account.password, ...body } }), 400);
      check(await countSessions() === before, "Invalid DTO created a session");
      check(await prisma.clientAuthRateBucket.count({ where: { scope: { in: loginScopes } } }) === 0, "Invalid DTO reached rate storage");
      return { rejected400: bodies.length };
    }, resetLoginBuckets);

    await scenario("origin-rejections", async () => {
      const before = await countSessions();
      for (const headers of [{ origin: "" }, { origin: "https://outside.invalid" }, { "sec-fetch-site": "cross-site" }]) await expectFailure(login(undefined, undefined, { headers }), 403);
      check(await countSessions() === before, "Cross-site request created a session");
      return { rejected403: 3 };
    }, resetLoginBuckets);

    await scenario("uniform-credentials", async () => {
      const before = await countSessions(), results = [];
      for (const identity of [{ username: account.username }, { email: account.email }, { username: unknown }, { email: absentEmail }]) {
        results.push(await expectFailure(login(identity, wrongPassword), 401));
      }
      check(results.every(row => JSON.stringify(row.payload) === JSON.stringify(results[0].payload)), "Unknown and wrong password responses differ");
      check(await countSessions() === before, "Bad credentials created a session");
      return { rejected401: results.length, identicalPublicBodies: true };
    }, resetLoginBuckets);

    for (const [name, data] of [["disabled", { status: "disabled" }], ["pending-verification", { status: "pending_verification", emailVerifiedAt: null }], ["soft-deleted", { deletedAt: new Date() }]]) {
      await scenario(name, async () => {
        const before = await prisma.memberUser.findUniqueOrThrow({ where: { id: account.id } }), sessions = await countSessions();
        try {
          await prisma.memberUser.update({ where: { id: account.id }, data });
          for (const identity of [{ username: account.username }, { email: account.email }]) await expectFailure(login(identity), 401);
          check(await countSessions() === sessions, "Unavailable identity created a session");
        } finally {
          await prisma.memberUser.update({ where: { id: account.id }, data: Object.fromEntries(Object.keys(data).map(key => [key, before[key]])) });
        }
        return { rejected401: 2 };
      }, resetLoginBuckets);
    }

    for (const field of ["username", "email"]) await scenario("duplicate-" + field, async () => {
      const id = randomUUID(), before = await countSessions();
      const member = await prisma.memberUser.findUniqueOrThrow({ where: { id: account.id } });
      try {
        await prisma.memberUser.create({ data: { id, [field]: account[field].toUpperCase(), nickname: "AF141 synthetic duplicate", passwordHash: member.passwordHash, status: "active" } });
        check(await prisma.memberUser.count({ where: { [field]: { equals: account[field], mode: "insensitive" } } }) === 2, "Real database did not create a case-equivalent duplicate");
        await assertNoSessions(before, () => expectFailure(login({ [field]: account[field] }), 401));
        await prisma.memberUser.update({ where: { id }, data: { status: "disabled" } });
        await assertNoSessions(before, () => expectFailure(login({ [field]: account[field] }), 401));
        await prisma.memberUser.update({ where: { id }, data: { status: "active", deletedAt: new Date() } });
        await assertNoSessions(before, () => expectFailure(login({ [field]: account[field] }), 401));
      } finally { await prisma.memberUser.deleteMany({ where: { id } }); }
      return { ambiguousRows: 2, rejected401: 3 };
    }, resetLoginBuckets);

    await scenario("literal-identities", async () => {
      const before = await countSessions();
      const member = await prisma.memberUser.findUniqueOrThrow({ where: { id: account.id } });
      for (const field of ["username", "email"]) for (const [stem, neighborStem] of [["user_one", "userXone"], ["user%one", "userAnythingone"],
        field === "email" ? ["user\\\\one", "user\\one"] : ["user\\one", "userone"]]) {
        const emailValue = value => (value.includes("\\") ? '"' + value + '"' : value) + "@example.test";
        const value = remember(field === "email" ? emailValue(stem) : stem);
        const neighbor = remember(field === "email" ? emailValue(neighborStem) : neighborStem);
        ownedKeys.push({ scope: "login_identity", keyHash: hash("login_identity", value.toLowerCase()) });
        const original = account[field], id = randomUUID();
        try {
          account[field] = value;
          await prisma.memberUser.update({ where: { id: account.id }, data: { [field]: value } });
          await prisma.memberUser.create({ data: { id, [field]: neighbor, nickname: "AF141 literal neighbor", passwordHash: member.passwordHash, status: "active" } });
          await success({ [field]: "  " + value.toUpperCase() + "  " });
          await prisma.memberUser.update({ where: { id: account.id }, data: { [field]: "af141-unrelated-" + randomUUID() + (field === "email" ? "@example.test" : "") } });
          await expectFailure(login({ [field]: value }), 401);
          check(await prisma.clientAuthSession.count({ where: { memberId: id } }) === 0, "Pattern neighbor was authenticated as literal identity");
        } finally {
          account[field] = original;
          await prisma.memberUser.update({ where: { id: account.id }, data: { [field]: original } });
          await prisma.memberUser.deleteMany({ where: { id } });
        }
      }
      check(await countSessions() === before + 6, "Literal identity matrix produced unexpected sessions");
      return { literal200: 6, patternOnly401: 6, realCookieMe: 6 };
    }, resetLoginBuckets);

    await scenario("shared-account-budget", async () => {
      const before = await countSessions();
      for (let index = 0; index < 5; index++) await expectFailure(login(index % 2 ? { email: account.email } : { username: account.username }, wrongPassword), 401);
      check((await bucket("login_account", account.id)).attemptCount === 5, "Aliases do not share five-attempt account budget");
      await expectFailure(login({ email: account.email }), 429);
      check(await countSessions() === before, "Rate-limited login created a session");
      const current = await prisma.clientAuthRateBucket.findMany({ where: { scope: { in: loginScopes } } });
      check(current.length === 4 && current.every(row => ownedKeys.some(key => key.scope === row.scope && key.keyHash === row.keyHash)), "Unexpected login HMAC bucket set");
      check(current.every(row => /^[a-f0-9]{64}$/.test(row.keyHash)), "Raw rate key stored");
      check(current.every(row => !foreignKeys.some(key => row.scope === key.scope && row.keyHash === key.keyHash)), "Rate bucket namespace collision");
      const accountBucket = await bucket("login_account", account.id);
      check(accountBucket.blockedUntil > new Date(), "Account bucket was not blocked");
      const past = new Date(Date.now() - 900001);
      // Time controls only: preserve attempt counters and all bucket rows.
      await prisma.clientAuthRateBucket.updateMany({ where: { OR: ownedKeys }, data: { windowStartedAt: past, blockedUntil: new Date(Date.now() - 1) } });
      check((await bucket("login_account", account.id)).attemptCount === 5, "Window time control cleared attempt history");
      await success({ username: account.username });
      check((await bucket("login_account", account.id)).attemptCount === 0 && (await bucket("login_identity", account.username)).attemptCount === 0, "Successful recovery did not reset identity/account buckets");
      check((await bucket("login_ip", ip)).attemptCount === 1, "Success incorrectly reset IP budget");
      return { failedCredentials: 5, sixth429: 1, expiredWindowRecovered: true, namespacedHmacBuckets: 4 };
    }, resetLoginBuckets);

    await scenario("concurrent-budget", async () => {
      const before = await countSessions();
      const settled = await Promise.allSettled(Array.from({ length: 8 }, (_, index) => login(index % 2 ? { email: account.email } : { username: account.username }, wrongPassword)));
      check(settled.every(row => row.status === "fulfilled"), "Concurrent HTTP request failed before response");
      const results = settled.map(row => row.value);
      check(results.filter(row => row.status === 401).length === 5 && results.filter(row => row.status === 429).length === 3, "Concurrent account reservation exceeded exact five-attempt budget");
      for (const result of results) await expectFailure(Promise.resolve(result), result.status);
      check((await bucket("login_account", account.id)).attemptCount === 5, "Concurrent account bucket overshot");
      check(await countSessions() === before, "Concurrent bad credentials created a session");
      return { requests: 8, rejected401: 5, rejected429: 3 };
    }, resetLoginBuckets);

    await scenario("session-boundaries", async () => {
      const first = await success({ username: account.username });
      await expectFailure(request("me", { cookie: "foreign_client_session=" + first.cookie.split("=")[1] }), 401);
      const member = await prisma.memberUser.findUniqueOrThrow({ where: { id: account.id } });
      try {
        await prisma.memberUser.update({ where: { id: account.id }, data: { tokenVersion: { increment: 1 } } });
        await expectFailure(request("me", { cookie: first.cookie }), 401);
      } finally { await prisma.memberUser.update({ where: { id: account.id }, data: { tokenVersion: member.tokenVersion } }); }
      const session = await prisma.clientAuthSession.findUniqueOrThrow({ where: { id: first.claims.sessionId } });
      try {
        await prisma.clientAuthSession.update({ where: { id: session.id }, data: { namespace: "foreign:test" } });
        await expectFailure(request("me", { cookie: first.cookie }), 401);
      } finally { await prisma.clientAuthSession.update({ where: { id: session.id }, data: { namespace: session.namespace } }); }
      const foreignToken = rememberSecret(await jwt.signAsync({ sub: account.id, sessionId: first.claims.sessionId, tokenVersion: member.tokenVersion, tokenKind: "client", projectId: config.getOrThrow("projectId"), environment: config.getOrThrow("environment") },
        { secret: keys.CLIENT_JWT_SECRET, algorithm: "HS256", issuer: clientIssuer(config.getOrThrow("issuer")), audience: clientAudience("foreign:test"), expiresIn: 600 }));
      await expectFailure(request("me", { cookie: cookieName + "=" + foreignToken }), 401);
      const logout = await request("logout", { method: "POST", cookie: first.cookie });
      check(logout.status === 200 && logout.payload.data.signedOut === true, "Current session logout failed");
      check(logout.response.headers.get("set-cookie")?.includes("Max-Age=0"), "Logout did not expire Cookie");
      await expectFailure(request("me", { cookie: first.cookie }), 401);
      return { foreignCookieRejected: true, foreignAudienceRejected: true, foreignSessionNamespaceRejected: true, staleVersionRejected: true, loggedOutCookieRejected: true, crossProductDeployment: "NOT_RUN" };
    }, resetLoginBuckets);

    await scenario("revoke-inflight-login", async () => {
      const { ClientAuthService } = fixture.requireApi("client-auth/client-auth.service.js");
      const { PrismaService } = fixture.requireApi("prisma/prisma.service.js");
      const { CLIENT_JWT_SERVICE } = fixture.requireApi("client-auth/client-auth.security.js");
      const appB = await bootstrap.createApplication();
      let prismaB, jwtA, serviceB, sign, revoke, transactionA, transactionB, pendingA, pendingB, foreignId;
      const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
      const bAuthenticated = deferred(), bProceed = deferred(), aInserted = deferred(), aProceed = deferred();
      const wait = async (promise, label) => {
        let timer;
        try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new LiveCheckError(label)), 8000); })]); }
        finally { clearTimeout(timer); }
      };
      let inFlightSessionId;
      try {
        await appB.listen(0, "127.0.0.1");
        const baseB = "http://127.0.0.1:" + appB.getHttpServer().address().port + "/api";
        prismaB = appB.get(PrismaService); serviceB = appB.get(ClientAuthService); jwtA = fixture.app.get(CLIENT_JWT_SERVICE);
        const [aBackend] = await prisma.$queryRaw`SELECT pg_backend_pid() AS pid`;
        const [bBackend] = await prismaB.$queryRaw`SELECT pg_backend_pid() AS pid`;
        check(aBackend.pid !== bBackend.pid && prisma.applicationName !== prismaB.applicationName, "Independent API database pools required");
        // Extend only this controlled test's callback timeout; real DB transactions/locks remain intact.
        transactionA = prisma.$transaction; transactionB = prismaB.$transaction;
        const timed = (owner, original) => (fn, options) => original.call(owner, fn, typeof fn === "function" ? { ...options, maxWait: 10000, timeout: 15000 } : options);
        prisma.$transaction = timed(prisma, transactionA); prismaB.$transaction = timed(prismaB, transactionB);
        const now = new Date(), version = (await prisma.memberUser.findUniqueOrThrow({ where: { id: account.id } })).tokenVersion;
        foreignId = randomUUID();
        await prisma.clientAuthSession.create({ data: { id: foreignId, memberId: account.id, namespace: "foreign:test", status: "active", deviceHash: hash("device", userAgent), deviceSummary: "Browser session", ipHash: hash("session_ip", ip), issuedAt: now, lastSeenAt: now, expiresAt: new Date(now.getTime() + 600000) } });
        revoke = serviceB.revokeAll;
        serviceB.revokeAll = async function (...args) {
          // Controller enters here only AFTER B's real Guard/authenticate completed.
          bAuthenticated.resolve(); await bProceed.promise; return revoke.apply(this, args);
        };
        sign = jwtA.signAsync;
        jwtA.signAsync = async function (...args) {
          // login has already performed the real member UPDATE and session INSERT.
          inFlightSessionId = args[0].sessionId; aInserted.resolve(); await aProceed.promise; return sign.apply(this, args);
        };
        pendingB = request("sessions/revoke-all", { method: "POST", cookie: fixture.cookies[0], baseUrl: baseB });
        await wait(bAuthenticated.promise, "B did not pass real authentication before login A");
        pendingA = login({ username: account.username });
        await wait(aInserted.promise, "Login A did not reach signing after real session INSERT");
        check(await prismaB.clientAuthSession.count({ where: { id: inFlightSessionId } }) === 0, "Login A session must still be uncommitted at barrier");
        bProceed.resolve();
        // Observe B's actual revokeAll FOR UPDATE blocked by A. A Guard FOR SHARE
        // wait cannot satisfy this evidence, and no fixed sleep establishes success.
        const lockObserved = await database(async client => {
          const deadline = Date.now() + 4000;
          while (Date.now() < deadline) {
            const rows = (await client.query("SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND pid=$1 AND wait_event_type='Lock' AND $2::int=ANY(pg_blocking_pids(pid)) AND query LIKE '%member_user%' AND query LIKE '%FOR UPDATE%'", [bBackend.pid, aBackend.pid])).rows;
            if (rows.length === 1) return true;
            await new Promise(resolve => setTimeout(resolve, 25));
          }
          return false;
        });
        check(lockObserved, "B revokeAll did not block on A member UPDATE lock");
        aProceed.resolve();
        const settled = await Promise.allSettled([pendingA, pendingB]);
        check(settled.every(row => row.status === "fulfilled"), "Controlled concurrent requests did not settle normally");
        const [issued, revoked] = settled.map(row => row.value);
        check(issued.status === 200 && revoked.status === 200 && revoked.payload.data.signedOut === true, "Controlled login/revokeAll HTTP result failed");
        check(revoked.response.headers.get("set-cookie")?.includes("Max-Age=0"), "RevokeAll did not expire B Cookie");
        const oldCookie = rememberSecret(issued.response.headers.get("set-cookie")?.split(";")[0]);
        check(oldCookie?.startsWith(cookieName + "="), "In-flight login did not issue original client Cookie");
        rememberSecret(oldCookie.slice(cookieName.length + 1));
        await expectFailure(request("me", { cookie: oldCookie }), 401);
        await expectFailure(request("me", { cookie: fixture.cookies[0] }), 401);
        const oldSession = await prisma.clientAuthSession.findUniqueOrThrow({ where: { id: inFlightSessionId } });
        check(oldSession.status === "revoked" && oldSession.revokedAt !== null, "Old in-flight session survived revokeAll");
        check(await prisma.clientAuthSession.count({ where: { memberId: account.id, namespace, status: "active", revokedAt: null } }) === 0, "Current namespace still has active sessions after revokeAll");
        const foreign = await prisma.clientAuthSession.findUniqueOrThrow({ where: { id: foreignId } });
        check(foreign.namespace === "foreign:test" && foreign.status === "active" && foreign.revokedAt === null && foreign.deletedAt === null && foreign.expiresAt > new Date(), "Project revokeAll changed foreign namespace session");
        check((await prisma.memberUser.findUniqueOrThrow({ where: { id: account.id } })).tokenVersion === version, "Project revokeAll changed global tokenVersion");
      } finally {
        aProceed.resolve(); bProceed.resolve();
        await Promise.allSettled([pendingA, pendingB].filter(Boolean));
        if (sign) jwtA.signAsync = sign;
        if (revoke) serviceB.revokeAll = revoke;
        if (transactionA) prisma.$transaction = transactionA;
        if (transactionB) prismaB.$transaction = transactionB;
        if (foreignId) await prisma.clientAuthSession.deleteMany({ where: { id: foreignId, memberId: account.id, namespace: "foreign:test" } });
        await appB.close(); apps.delete(appB);
      }
      await success({ email: account.email });
      return { authenticatedBeforeBarrier: true, independentBackends: 2, realMemberUpdateWait: true, oldSession401: true, currentNamespaceFullyRevoked: true, foreignSessionPreserved: true, laterLogin200: true };
    }, resetLoginBuckets);

    await scenario("audit-rollback", async () => {
      const before = await prisma.memberUser.findUniqueOrThrow({ where: { id: account.id } });
      const sessions = await countSessions(), auditCount = await prisma.auditLog.count({ where: { module: "client-auth", action: "login" } });
      faultName = "af141_reject_login_" + randomBytes(6).toString("hex"); faultRequested = true;
      try {
        await database(client => client.query('ALTER TABLE public.audit_log ADD CONSTRAINT "' + faultName + '" CHECK (module <> \'client-auth\' OR action <> \'login\') NOT VALID'));
        await expectFailure(login(), 503);
      } finally { await removeFault(); }
      check(await countSessions() === sessions, "Audit INSERT fault left an orphan session");
      const after = await prisma.memberUser.findUniqueOrThrow({ where: { id: account.id } });
      check(after.lastLoginAt?.getTime() === before.lastLoginAt?.getTime(), "Audit INSERT fault did not roll back lastLoginAt");
      check(await prisma.auditLog.count({ where: { module: "client-auth", action: "login" } }) === auditCount, "Faulted login left success audit");
      check((await bucket("login_account", account.id)).attemptCount === 1, "Faulted login reset its attempt budget");
      await success({ email: account.email });
      check(await countSessions() === sessions + 1, "Audit-fault recovery did not create exactly one session");
      return { rejected503: 1, sessionRolledBack: true, lastLoginRolledBack: true, recovered200: 1 };
    }, resetLoginBuckets);

    await scenario("redacted-storage", async () => {
      const audits = await prisma.auditLog.findMany({ where: { module: "client-auth" } });
      for (const action of ["login", "login_failed", "login_rate_limited", "logout"]) check(audits.some(row => row.action === action), "Expected authentication audit missing");
      const sessions = await prisma.clientAuthSession.findMany();
      const buckets = await prisma.clientAuthRateBucket.findMany({ where: { scope: { in: loginScopes } } });
      safeText(JSON.stringify({ audits, sessions, buckets }));
      check(buckets.every(row => /^[a-f0-9]{64}$/.test(row.keyHash)), "Rate bucket key is not a HMAC digest");
      check(audits.every(row => Object.keys(row.requestSummary || {}).every(key => key === "correlationId")), "Unexpected login audit identity fields");
      return { auditRows: audits.length, sessionRows: sessions.length, hashedBuckets: buckets.length, rawIdentityOrCredentialsStored: false };
    });
    evidence.status = failed ? "FAILED" : "PASS";
  } catch (error) {
    failed = true; evidence.status = "FAILED"; evidence.reason = reason(error); evidence.failureType = error?.constructor?.name; evidence.failureFrames = typeof error?.stack === "string" ? error.stack.split("\n").filter(line => /^\s*at\s/.test(line)).slice(0, 3).map(line => line.replaceAll(repositoryRoot, "<repo>")) : [];
  } finally {
    // A helper init failure can leave the new lease ID in process.env before return.
    if (!leaseId && process.env.DATABASE_ACCEPTANCE_ID !== originalEnvironment.DATABASE_ACCEPTANCE_ID) {
      const candidate = process.env.DATABASE_ACCEPTANCE_ID;
      try { if (candidate && acceptanceRecord("test", candidate).task === task) leaseId = candidate; } catch { /* no unowned target fallback */ }
    }
    const cleanup = async (name, operation) => {
      try { await operation(); evidence.cleanup[name] = true; }
      catch { failed = true; evidence.status = "FAILED"; evidence.cleanup[name] = false; }
    };
    await cleanup("hooksRestored", async () => { if (bootstrap && createApplication) bootstrap.createApplication = createApplication; });
    await cleanup("requestsSettled", async () => { const settled = await Promise.allSettled([...inFlight]); check(settled.every(row => row.status === "fulfilled"), "In-flight request cleanup failed"); });
    await cleanup("faultRemoved", removeFault);
    await cleanup("appsClosed", async () => {
      const results = await Promise.allSettled([...apps].map(app => app.close()));
      if (prisma) await prisma.$disconnect();
      check(results.every(row => row.status === "fulfilled"), "Application close failed");
    });
    restoreEnvironment(originalEnvironment);
    await cleanup("apiSessionsZero", async () => {
      check(leaseId, "No owned lease available for final session check");
      const rows = await database(async client => (await client.query("SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND application_name LIKE 'aij-api:%'")).rows);
      check(rows[0].count === 0, "Owned lease still has aij-api sessions");
    });
    save();
  }
  check(!failed && evidence.status === "PASS", "AF-141 live verification failed; inspect safe aggregate live evidence");
});
