import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";

const require = createRequire(new URL("../../apps/api/package.json", import.meta.url));
require("reflect-metadata");
require("ts-node").register({ project: fileURLToPath(new URL("../../apps/api/tsconfig.json", import.meta.url)), transpileOnly: true });
const { ValidationPipe } = require("@nestjs/common");
const { JwtService } = require("@nestjs/jwt");
const bcrypt = require("bcryptjs");
const { ClientLoginDto } = require("../../apps/api/src/client-auth/dto.ts");
const { ClientAuthService } = require("../../apps/api/src/client-auth/client-auth.service.ts");
const { ClientAuthController } = require("../../apps/api/src/client-auth/client-auth.controller.ts");
const { ClientAuthGuard } = require("../../apps/api/src/client-auth/client-auth.guard.ts");
const { CLIENT_SESSION_SECONDS, clientAudience, clientIssuer, hashClientContext } = require("../../apps/api/src/client-auth/client-auth.security.ts");
const password = "Synthetic141.Password9";
const passwordHash = await bcrypt.hash(password, 4);
const pipe = new ValidationPipe({ expectedType: ClientLoginDto, whitelist: true, forbidNonWhitelisted: true, transform: true });
const parse = body => pipe.transform(body, { type: "body" });
const context = { ip: "192.0.2.141", userAgent: "AF141 pure test", correlationId: "af141-pure" };

// An in-memory Prisma boundary, not a database or a second auth implementation.
// Only generic query predicates/storage/transaction rollback live here. Every
// decision, bcrypt comparison, query, bucket reservation and session write comes
// from the imported production service. PostgreSQL locks remain an integration gate.
function matches(row, where = {}) {
  return Object.entries(where).every(([key, expected]) => {
    if (key === "OR") return expected.some(part => matches(row, part));
    if (expected === null || typeof expected !== "object" || expected instanceof Date) return row[key] === expected;
    if ("equals" in expected) return expected.mode === "insensitive"
      ? typeof row[key] === "string" && row[key].toLowerCase() === expected.equals.toLowerCase()
      : row[key] === expected.equals;
    if ("gt" in expected) return row[key] > expected.gt;
    if ("lte" in expected) return row[key] <= expected.lte;
    throw new Error("Unsupported test boundary predicate: " + key);
  });
}
function project(row, select) { return row && (select ? Object.fromEntries(Object.keys(select).map(key => [key, row[key]])) : { ...row }); }
async function fixture(overrides = {}, extraMembers = []) {
  const member = { id: "member-141", username: "Case.Member", email: "Member141@Example.test", nickname: "Synthetic member", passwordHash,
    tokenVersion: 3, status: "active", deletedAt: null, emailVerifiedAt: new Date(), ...overrides };
  let state = { members: [member, ...extraMembers], buckets: [], sessions: [], audits: [] };
  const calls = { queries: [], locks: [], events: [], sessionWrites: 0, memberWrites: 0 };
  const faults = { point: null, ready: true, beforeMemberWrite: null };
  const fail = point => { if (faults.point === point) throw new Error("Synthetic boundary failure"); };
  const prisma = {
    readiness: async () => ({ ready: faults.ready }),
    $executeRaw: async (_sql, key) => { calls.locks.push(key); return 1; },
    $queryRaw: async (query, ...values) => {
      if (query && !Array.isArray(query) && Array.isArray(query.values)) {
        fail("query");
        assert.equal(query.values.length, 1, "identity stays a bound scalar parameter");
        const field = query.text.includes("lower(email)") ? "email" : "username";
        const identity = query.values[0];
        calls.queries.push({ field, values: [...query.values], text: query.text });
        return state.members.filter(row => typeof row[field] === "string" && row[field].toLowerCase() === identity.toLowerCase()).slice(0, 2).map(row => ({ ...row }));
      }
      fail("member-lock");
      calls.events.push({ type: "member-lock", mode: query.join("").includes("FOR UPDATE") ? "update" : "share", memberId: values[0] });
      return [];
    },
    memberUser: {
      findMany: async args => {
        fail("query"); calls.queries.push(structuredClone(args));
        return state.members.filter(row => matches(row, args.where)).slice(0, args.take).map(row => project(row, args.select));
      },
      findFirst: async args => project(state.members.find(row => matches(row, args.where)), args.select),
      updateMany: async ({ where, data }) => {
        calls.memberWrites++; faults.beforeMemberWrite?.(state);
        const rows = state.members.filter(row => matches(row, where)); rows.forEach(row => Object.assign(row, data)); return { count: rows.length };
      }
    },
    clientAuthRateBucket: {
      findUnique: async ({ where: { scope_keyHash: key } }) => { fail("reserve"); return project(state.buckets.find(row => matches(row, key))); },
      upsert: async ({ where: { scope_keyHash: key }, create, update }) => {
        const row = state.buckets.find(row => matches(row, key)); if (row) Object.assign(row, update); else state.buckets.push({ ...create });
      },
      updateMany: async ({ where, data }) => {
        fail("rate-reset");
        const rows = state.buckets.filter(row => matches(row, where)); rows.forEach(row => Object.assign(row, data)); return { count: rows.length };
      }
    },
    clientAuthSession: {
      create: async ({ data, select }) => {
        calls.sessionWrites++; fail("session");
        const row = { id: "session-" + (state.sessions.length + 1), revokedAt: null, deletedAt: null, ...data };
        state.sessions.push(row); return project(row, select);
      },
      updateMany: async ({ where, data }) => {
        calls.events.push({ type: "session-write", where: structuredClone(where) });
        const rows = state.sessions.filter(row => matches(row, where)); rows.forEach(row => Object.assign(row, data)); return { count: rows.length };
      }
    },
    auditLog: { create: async ({ data }) => { fail("audit"); state.audits.push(data); return data; } },
    $transaction: async fn => {
      const before = structuredClone(state);
      try { return await fn(prisma); } catch (error) { state = before; throw error; }
    }
  };
  const settings = { namespace: "af141:test", projectId: "af141", environment: "test", issuer: "urn:aij:af141:test:api", webUrl: "http://localhost:3655",
    clientSessionCookie: "aij_af141_test_client_session", nodeEnv: "test" };
  const config = { getOrThrow: key => { assert.ok(key in settings); return settings[key]; } };
  const jwt = new JwtService({ secret: randomBytes(32).toString("hex"),
    signOptions: { algorithm: "HS256", issuer: clientIssuer(settings.issuer), audience: clientAudience(settings.namespace), expiresIn: CLIENT_SESSION_SECONDS },
    verifyOptions: { algorithms: ["HS256"], issuer: clientIssuer(settings.issuer), audience: clientAudience(settings.namespace) } });
  const sign = jwt.signAsync.bind(jwt); jwt.signAsync = (...args) => { fail("sign"); return sign(...args); };
  const rateSecret = randomBytes(32).toString("hex");
  const environment = { DATABASE_ENABLED: "false", CLIENT_AUTH_RATE_LIMIT_SECRET: rateSecret, CLIENT_AUTH_TOKEN_SECRET: randomBytes(32).toString("hex") };
  const original = Object.fromEntries(Object.keys(environment).map(key => [key, process.env[key]]));
  let service;
  try { Object.assign(process.env, environment); service = new ClientAuthService(prisma, jwt, config, { available: false }); }
  finally { for (const [key, value] of Object.entries(original)) if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  await service.dummyHash;
  const guard = new ClientAuthGuard(jwt, service, config), controller = new ClientAuthController(service, config);
  const login = async (identity = { username: "case.member" }, candidatePassword = password, loginContext = context) => service.login(await parse({ ...identity, password: candidatePassword }), loginContext);
  const authorize = async token => {
    const request = { headers: { cookie: settings.clientSessionCookie + "=" + token } };
    await guard.canActivate({ switchToHttp: () => ({ getRequest: () => request }) }); return request;
  };
  const bucket = (scope, value) => state.buckets.find(row => row.scope === scope && row.keyHash === hashClientContext(rateSecret, settings.namespace, scope, value));
  return { service, controller, guard, jwt, config, settings, calls, faults, login, authorize, bucket, get state() { return state; } };
}
const rejects = (promise, status, message) => assert.rejects(promise, error => {
  assert.equal(error.getStatus?.(), status); if (message) assert.equal(error.message, message); return true;
});

test("actual login DTO transforms one explicit identity and leaves passwords unchanged", async () => {
  const email = await parse({ email: "  Member141@Example.TEST  ", password: " Password9 " });
  assert.ok(email instanceof ClientLoginDto); assert.equal(email.email, "member141@example.test"); assert.equal(email.username, undefined); assert.equal(email.password, " Password9 ");
  const username = await parse({ username: "  Case.Member  ", password });
  assert.equal(username.username, "case.member"); assert.equal(username.email, undefined);
  const explicitUsername = await parse({ username: "Member141@Example.test", password });
  assert.equal(explicitUsername.email, undefined, "a username containing @ is not reinterpreted as email");
});

test("actual login DTO rejects missing, mixed, null, blank, malformed and extra fields", async t => {
  const inputs = [
    {}, { email: "member141@example.test", username: "case.member" }, { email: "member141@example.test", username: "" },
    { email: "member141@example.test", username: null }, { email: "", username: "case.member" }, { email: null, username: "case.member" },
    { email: "" }, { email: "  " }, { email: null }, { email: "invalid" }, { email: 7 }, { email: [] },
    { username: "" }, { username: "  " }, { username: null }, { username: 7 }, { username: {} }, { username: "x".repeat(255) },
    { email: "member141@example.test", namespace: "other:test" }, { username: "case.member", workspaceId: "forged" }
  ];
  for (const [index, input] of inputs.entries()) await t.test("identity rejection " + index, () => rejects(parse({ password, ...input }), 400));
  for (const value of [undefined, null, "", 7, "x".repeat(73)]) await t.test("password rejection " + String(value), () => rejects(parse({ username: "case.member", password: value }), 400));
});

test("actual service resolves username/email with bounded ambiguity checks and existing safe session payload", async () => {
  const f = await fixture();
  for (const identity of [{ username: " CASE.MEMBER " }, { email: " MEMBER141@EXAMPLE.TEST " }]) {
    const result = await f.login(identity), claims = await f.jwt.verifyAsync(result.token);
    assert.deepEqual(result.member, { id: "member-141", email: "Member141@Example.test", nickname: "Synthetic member" });
    assert.equal(claims.sub, "member-141"); assert.equal(claims.tokenVersion, 3); assert.equal(claims.tokenKind, "client");
    assert.equal(claims.projectId, "af141"); assert.equal(claims.environment, "test"); assert.equal(claims.aud, clientAudience(f.settings.namespace));
    assert.equal(claims.exp - claims.iat, CLIENT_SESSION_SECONDS); assert.ok(claims.jti);
    const request = await f.authorize(result.token); assert.equal(request.client.id, "member-141");
    const session = f.state.sessions.find(row => row.id === claims.sessionId);
    assert.equal(session.namespace, "af141:test"); assert.equal(session.status, "active"); assert.equal(session.deviceSummary, "Browser session");
    assert.equal(session.deviceHash.length, 64); assert.equal(session.ipHash.length, 64);
    assert.equal(f.bucket("login_account", "member-141").attemptCount, 0);
  }
  assert.deepEqual(f.calls.queries.map(q => [q.field, ...q.values]), [
    ["username", "case.member"], ["email", "member141@example.test"]
  ]);
  assert.ok(f.calls.queries.every(q => q.text.includes("LIMIT 2") && !q.text.includes("ILIKE") && !q.text.includes(q.values[0])));
  const stored = JSON.stringify({ buckets: f.state.buckets, audits: f.state.audits, sessions: f.state.sessions });
  for (const raw of [password, passwordHash, "Case.Member", "Member141@Example.test", context.ip, context.userAgent]) assert.ok(!stored.includes(raw));
  assert.ok(f.state.audits.every(row => Object.keys(row.requestSummary).join() === "correlationId"));
  assert.ok(f.calls.locks.every(key => !key.includes("case.member") && !key.includes("member141@example.test") && !key.includes(context.ip)));
});

test("active legacy username-only and email accounts remain compatible without retroactive verification requirements", async () => {
  const f = await fixture({ email: null, emailVerifiedAt: null });
  assert.equal((await f.login()).member.email, null);
  f.state.members[0].email = "legacy@example.test";
  assert.equal((await f.login({ email: "legacy@example.test" })).member.id, "member-141");
});

test("literal username and email identities keep underscore, percent and backslash as data", async t => {
  const f = await fixture();
  for (const field of ["username", "email"]) for (const [literal, neighbor] of [["user_one", "userXone"], ["user%one", "userAnythingone"], ["user\\\\one", "user\\one"]]) {
    const value = field === "email" ? (literal.includes("\\") ? '"' + literal + '"@example.test' : literal + "@example.test") : literal;
    const other = field === "email" ? (neighbor.includes("\\") ? '"' + neighbor + '"@example.test' : neighbor + "@example.test") : neighbor;
    await t.test(field + " literal case", async () => {
      f.state.buckets = []; f.state.members[0][field] = value;
      f.state.members.push({ ...f.state.members[0], id: "neighbor", [field]: other });
      try {
        assert.equal((await f.login({ [field]: "  " + value.toUpperCase() + "  " })).member.id, "member-141");
        f.state.members[0][field] = "unrelated";
        await rejects(f.login({ [field]: value }), 401, "Invalid credentials");
      } finally { f.state.members.pop(); }
    });
  }
});

test("revokeAll takes the member update lock before namespace session writes and leaves foreign sessions active", async () => {
  const f = await fixture();
  await f.login();
  f.state.sessions.push({ ...f.state.sessions[0], id: "foreign-session", namespace: "foreign:test" });
  f.calls.events.length = 0;
  const version = f.state.members[0].tokenVersion;
  f.faults.point = "member-lock";
  await rejects(f.service.revokeAll("member-141"), 503, "Client authentication unavailable");
  assert.ok(f.state.sessions.every(row => row.status === "active"));
  f.faults.point = null;
  await f.service.revokeAll("member-141");
  assert.deepEqual(f.calls.events[0], { type: "member-lock", mode: "update", memberId: "member-141" });
  assert.equal(f.calls.events[1].type, "session-write"); assert.equal(f.calls.events[1].where.namespace, "af141:test");
  assert.equal(f.state.sessions[0].status, "revoked"); assert.equal(f.state.sessions[1].status, "active");
  assert.equal(f.state.members[0].tokenVersion, version);
  await f.login();
});

test("unknown, wrong-password, inactive, pending verification, deleted, missing-hash and duplicate identities share 401", async t => {
  const f = await fixture();
  for (const identity of [{ username: "unknown" }, { email: "unknown@example.test" }, { username: "Member141@Example.test" }]) await rejects(f.login(identity), 401, "Invalid credentials");
  await rejects(f.login({}, password), 400);
  await rejects(f.login({ username: "case.member" }, "Incorrect9"), 401, "Invalid credentials");
  for (const status of ["suspended", "disabled", "pending_verification"]) {
    f.state.members[0].status = status;
    await rejects(f.login(), 401, "Invalid credentials");
  }
  // Fresh bucket windows avoid conflating account rate rejection with status rejection.
  f.state.buckets = []; f.state.members[0].status = "active"; f.state.members[0].deletedAt = new Date();
  await rejects(f.login(), 401, "Invalid credentials");
  f.state.members[0].deletedAt = null; f.state.members[0].passwordHash = null;
  await rejects(f.login({ email: "member141@example.test" }), 401, "Invalid credentials");
  f.state.members[0].passwordHash = passwordHash;
  for (const field of ["username", "email"]) await t.test("ambiguous case variants for " + field, async () => {
    f.state.buckets = [];
    f.state.members.push({ ...f.state.members[0], id: "case-variant", [field]: f.state.members[0][field].toLowerCase(), status: "disabled", deletedAt: new Date() });
    await rejects(f.login({ [field]: f.state.members[0][field] }), 401, "Invalid credentials");
    f.state.members.pop();
  });
  assert.equal(f.calls.sessionWrites, 0); assert.equal(f.calls.memberWrites, 0);
});

test("direct service calls reject mixed/empty identities and overlong bcrypt bytes before any storage write", async () => {
  const f = await fixture();
  for (const input of [{}, { email: null }, { username: " " }, { username: 1 }, { username: "x".repeat(255) },
    { email: "member141@example.test", username: "case.member" }, { email: "member141@example.test", username: null }]) {
    await rejects(f.service.login({ ...input, password }, context), 400);
  }
  await rejects(f.login({ username: "case.member" }, "界".repeat(25)), 400);
  assert.equal(f.state.buckets.length, 0); assert.equal(f.calls.queries.length, 0); assert.equal(f.calls.sessionWrites, 0);
});

test("email/username switches and IP rotation cannot bypass the member attempt budget; window recovery works", async () => {
  const f = await fixture();
  for (let index = 0; index < 5; index++) await rejects(f.login(index % 2 ? { email: "member141@example.test" } : { username: "case.member" }, "Wrong9", { ...context, ip: "192.0.2." + index }), 401);
  assert.equal(f.bucket("login_account", "member-141").attemptCount, 5);
  await rejects(f.login({ email: "member141@example.test" }, password, { ...context, ip: "192.0.2.77" }), 429, "Too many login attempts");
  assert.equal(f.state.sessions.length, 0);
  for (const row of f.state.buckets) { row.windowStartedAt = new Date(Date.now() - 900001); row.blockedUntil = new Date(Date.now() - 1); }
  await f.login(); assert.equal(f.bucket("login_account", "member-141").attemptCount, 0);
  assert.equal(f.bucket("login_identity", "case.member").attemptCount, 0);
  assert.equal(f.bucket("login_ip", context.ip).attemptCount, 1, "success must not reset IP abuse history");
});

test("unknown identity retains five-attempt protection and global IP budget remains thirty", async () => {
  const f = await fixture();
  for (let index = 0; index < 5; index++) await rejects(f.login({ username: "unknown" }), 401);
  await rejects(f.login({ username: "UNKNOWN" }), 429);
  assert.equal(f.bucket("login_identity", "unknown").attemptCount, 5);
  assert.equal(f.bucket("login_ip", context.ip).attemptCount, 5);
  f.state.buckets = [];
  for (let index = 0; index < 30; index++) await f.login(index % 2 ? { email: "member141@example.test" } : { username: "case.member" });
  assert.equal(f.bucket("login_ip", context.ip).attemptCount, 30);
  await rejects(f.login(), 429); assert.equal(f.state.sessions.length, 30);
});

test("service detects credential/status races before creating a usable session", async () => {
  const f = await fixture();
  for (const mutation of [row => { row.tokenVersion++; }, row => { row.status = "disabled"; }, row => { row.passwordHash = "changed"; }, row => { row.deletedAt = new Date(); }]) {
    f.faults.beforeMemberWrite = state => mutation(state.members[0]);
    await rejects(f.login(), 401, "Invalid credentials");
    assert.equal(f.state.sessions.length, 0);
  }
  f.faults.beforeMemberWrite = null; await f.login(); assert.equal(f.state.sessions.length, 1);
});

test("readiness, lookup, rate storage, signing, session and audit failures fail closed then recover", async t => {
  const f = await fixture();
  f.faults.ready = false; await rejects(f.login(), 503); assert.equal(f.state.sessions.length, 0); assert.equal(f.state.buckets.length, 0);
  f.faults.ready = true;
  for (const point of ["query", "reserve", "sign", "session", "audit", "rate-reset"]) await t.test(point + " failure and recovery", async () => {
    f.state.buckets = []; const before = f.state.sessions.length; f.faults.point = point;
    await rejects(f.login(), 503, "Client authentication unavailable"); assert.equal(f.state.sessions.length, before);
    f.faults.point = null; const result = await f.login(); await f.authorize(result.token); assert.equal(f.state.sessions.length, before + 1);
  });
});

test("actual controller keeps cookie-only issuance and origin rejection for both identities (direct call, no HTTP)", async () => {
  const f = await fixture();
  for (const identity of [{ username: "case.member" }, { email: "member141@example.test" }]) {
    const headers = {}, request = { headers: { origin: f.settings.webUrl, "user-agent": context.userAgent }, socket: { remoteAddress: context.ip }, correlationId: context.correlationId };
    const dto = await parse({ ...identity, password });
    const principal = await f.controller.login(dto, request, { setHeader: (key, value) => { headers[key] = value; } });
    assert.deepEqual(Object.keys(principal).sort(), ["email", "id", "nickname"]);
    const cookie = headers["Set-Cookie"]; assert.ok(cookie.startsWith(f.settings.clientSessionCookie + "="));
    assert.ok(cookie.includes("; Path=/api/client; HttpOnly; SameSite=Strict; Max-Age=" + CLIENT_SESSION_SECONDS));
    assert.ok(!cookie.includes("Domain=")); await f.authorize(cookie.split(";")[0].split("=")[1]);
    for (const badHeaders of [{}, { origin: "https://outside.example" }, { origin: f.settings.webUrl, "sec-fetch-site": "cross-site" }]) {
      const count = f.state.sessions.length;
      await rejects(f.controller.login(dto, { ...request, headers: badHeaders }, { setHeader: () => assert.fail("must not set cookie") }), 403);
      assert.equal(f.state.sessions.length, count);
    }
  }
});

test("actual Guard preserves namespace/admin rejection, logout, revoke-all, tokenVersion and expiry checks", async () => {
  const f = await fixture(), first = await f.login(), second = await f.login({ email: "member141@example.test" });
  const claims = await f.jwt.verifyAsync(first.token);
  for (const payload of [{ ...claims, tokenKind: "admin" }, { ...claims, projectId: "foreign" }, { ...claims, environment: "production" },
    { ...claims, aud: clientAudience("foreign:test") }, { ...claims, iss: "foreign" }]) {
    const options = { audience: payload.aud, issuer: payload.iss };
    delete payload.exp; delete payload.aud; delete payload.iss;
    const foreign = await f.jwt.signAsync(payload, options); await rejects(f.authorize(foreign), 401);
  }
  f.state.sessions[0].namespace = "foreign:test"; await rejects(f.authorize(first.token), 401); f.state.sessions[0].namespace = f.settings.namespace;
  f.state.sessions[0].expiresAt = new Date(0); await rejects(f.authorize(first.token), 401); f.state.sessions[0].expiresAt = new Date(Date.now() + 100000);
  f.state.members[0].tokenVersion++; await rejects(f.authorize(first.token), 401); f.state.members[0].tokenVersion--;
  f.state.members[0].status = "pending_verification"; await rejects(f.authorize(first.token), 401); f.state.members[0].status = "active";
  await f.service.logoutCurrent("member-141", claims.sessionId); await rejects(f.authorize(first.token), 401); await f.authorize(second.token);
  const third = await f.login(); await f.service.revokeAll("member-141"); await rejects(f.authorize(second.token), 401); await rejects(f.authorize(third.token), 401);
});
