import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";
import { createAcceptance, migrate } from "../database/migration.mjs";
import { seedDatabase } from "../database/seed.mjs";
import { repositoryRoot } from "../database/connection.mjs";
import { authEnvironment, authKeys } from "./auth-support.mjs";
import { applicationSessions } from "./readiness-support.mjs";
import { assertPortAvailable } from "../port-availability.mjs";

test("AF-027 real HTTP/DB cookie authentication and CSRF boundary", { timeout: 90000 }, async t => {
  await assertPortAvailable(3656);
  const parent = join(repositoryRoot, ".artifacts/ui-1/af-027"); mkdirSync(parent, { recursive: true }); const root = mkdtempSync(join(parent, "run-"));
  const lease = await createAcceptance("test", "AF-027"); await migrate({ mode: "test", action: "deploy", acceptanceId: lease.id });
  const seed = await seedDatabase({ mode: "test", acceptanceId: lease.id, generateCredentials: true, adminUsers: true });
  const initial = JSON.parse(readFileSync(seed.credentials.file)), keys = authKeys(lease.id, "AF-027");
  const original = { ...process.env }; for (const key of Object.keys(process.env)) delete process.env[key]; Object.assign(process.env, authEnvironment(lease.id, keys.secret, "AF-027"));
  const require = createRequire(join(repositoryRoot, "apps/api/package.json")), { ConfigService } = require("@nestjs/config");
  const { createApplication } = require(join(repositoryRoot, "apps/api/dist/bootstrap.js")), { PrismaService } = require(join(repositoryRoot, "apps/api/dist/prisma/prisma.service.js"));
  const secrets = [initial.password, keys.secret]; let app, prisma, cookie, csrf, bearer;
  const origin = "http://localhost:3655", name = "aij_foundation_test_admin_session";
  async function request(path, status, { cookie: value, token, method = "GET", body, headers = {} } = {}) {
    const response = await fetch("http://127.0.0.1:3656/api/" + path, { method, headers: { connection: "close", "x-correlation-id": "ui1-browser-auth-check", ...(value ? { cookie: value } : {}), ...(token ? { authorization: "Bearer " + token } : {}), ...(body ? { "content-type": "application/json" } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(8000) });
    assert.equal(response.status, status, path + " HTTP status"); const json = await response.json();
    if (json.data?.accessToken) secrets.push(json.data.accessToken);
    const setCookie = response.headers.get("set-cookie"); if (setCookie && !setCookie.includes("Max-Age=0")) secrets.push(setCookie.split(";", 1)[0].split("=")[1]);
    const safe = JSON.stringify({ ...json, data: json.data?.accessToken ? { ...json.data, accessToken: "[REDACTED]" } : json.data });
    for (const secret of secrets) assert.ok(!safe.includes(secret), "No auth credentials in browser JSON/errors"); assert.ok(!/\$2[aby]\$/.test(safe));
    return { data: json.data, headers: response.headers };
  }
  const login = (headers = { origin, "x-aij-client": "web" }, status = 200) => request("auth/browser-login", status, { method: "POST", body: { username: initial.username, password: initial.password }, headers });
  try {
    app = await createApplication(); await app.listen(3656, "127.0.0.1"); prisma = app.get(PrismaService);
    await t.test("browser login requires exact Origin and client header; cross-site login is rejected before issue", async () => {
      for (const headers of [{}, { origin }, { origin: "http://evil.test", "x-aij-client": "web" }, { origin: "null", "x-aij-client": "web" }, { origin, "x-aij-client": "web", "sec-fetch-site": "cross-site" }]) await login(headers, 403);
      assert.equal(await prisma.adminAuthSession.count(), 0);
      await request("auth/browser-login", 401, { method: "POST", headers: { origin, "x-aij-client": "web" }, body: { username: initial.username, password: "wrong" } });
    });
    await t.test("HttpOnly host-only scoped cookie, safe profile and per-session CSRF; no JS auth token", async () => {
      const result = await login(), header = result.headers.get("set-cookie"); assert.ok(header);
      for (const attribute of [name + "=", "; Path=/api", "; HttpOnly", "; SameSite=Strict", "; Max-Age=900"]) assert.ok(header.includes(attribute));
      assert.ok(!/Domain=|; Secure/.test(header)); assert.equal(result.headers.get("cache-control"), "no-store"); assert.ok(!("accessToken" in result.data));
      cookie = header.split(";", 1)[0]; const session = await request("auth/session", 200, { cookie }); csrf = session.data.csrfToken; assert.match(csrf, /^[A-Za-z0-9_-]{43}$/);
      assert.equal(session.headers.get("cache-control"), "no-store"); assert.equal((await prisma.adminAuthSession.findFirstOrThrow()).transport, "cookie");
      await request("admin/users", 200, { cookie });
    });
    await t.test("wrong product name, duplicate cookie and transport substitution cannot authenticate", async () => {
      bearer = (await request("auth/login", 200, { method: "POST", body: { username: initial.username, password: initial.password } })).data.accessToken;
      for (const value of [cookie.replace(name, "other_admin_session"), cookie + "; " + cookie, name + "=" + bearer, cookie.replace(name, "aij_foundation_test_client_session")]) await request("auth/session", 401, { cookie: value });
      await request("auth/me", 401, { token: cookie.split("=")[1] }); await request("auth/me", 401, { token: bearer, cookie });
      await request("auth/session", 403, { token: bearer }); await request("auth/me", 200, { token: bearer });
    });
    await t.test("all cookie writes require exact origin plus bound CSRF, including admin controller writes", async () => {
      for (const headers of [{}, { origin }, { origin, "x-aij-csrf": "x".repeat(43) }, { origin: "http://evil.test", "x-aij-csrf": csrf }, { origin, "x-aij-csrf": csrf, "sec-fetch-site": "cross-site" }]) {
        await request("auth/logout", 403, { cookie, method: "POST", headers });
        await request("admin/users", 403, { cookie, method: "POST", headers, body: { username: "ui1-csrf-denied", realName: "Synthetic", password: "Invalid-request-only" } });
      }
      assert.equal(await prisma.sysUser.count({ where: { username: "ui1-csrf-denied" } }), 0); await request("auth/session", 200, { cookie });
      const another = (await login()).headers.get("set-cookie").split(";", 1)[0];
      await request("auth/logout", 403, { cookie: another, method: "POST", headers: { origin, "x-aij-csrf": csrf } });
    });
    await t.test("authorized cookie mutation persists and logout clears cookie and revokes DB session", async () => {
      const password = randomBytes(24).toString("base64url") + "A1!"; secrets.push(password);
      await request("admin/users", 201, { cookie, method: "POST", headers: { origin, "x-aij-csrf": csrf }, body: { username: "ui1-cookie-created", realName: "UI1 synthetic", password } });
      assert.equal(await prisma.sysUser.count({ where: { username: "ui1-cookie-created" } }), 1);
      const response = await request("auth/logout", 200, { cookie, method: "POST", headers: { origin, "x-aij-csrf": csrf } }); assert.ok(response.headers.get("set-cookie").includes("Max-Age=0"));
      await request("auth/session", 401, { cookie }); await request("auth/me", 200, { token: bearer });
    });
    await t.test("production cookie policy emits Secure over actual HTTP response (TLS deployment not claimed)", async () => {
      const config = app.get(ConfigService); config.set("environment", "production");
      try { const response = await login(); assert.ok(response.headers.get("set-cookie").includes("; Secure")); assert.ok(response.headers.get("set-cookie").includes("; HttpOnly")); }
      finally { config.set("environment", "test"); }
    });
    await t.test("audit/log projection never stores cookie, CSRF or password; application closes pools", async () => {
      const text = JSON.stringify(await prisma.auditLog.findMany()); for (const value of [...secrets, csrf]) assert.ok(!text.includes(value));
      await app.close(); app = undefined; assert.deepEqual(await applicationSessions(lease.id, "AF-027"), []);
      writeFileSync(join(root, "result.json"), JSON.stringify({ task: "AF-027", database: lease.database, acceptanceId: lease.id, cookieAttributes: ["HttpOnly", "SameSite=Strict", "Path=/api", "host-only", "Secure in production policy"], noRawCredentialsRetained: true, closedPools: 0 }, null, 2) + "\n");
    });
  } finally { if (app) await app.close(); for (const key of Object.keys(process.env)) delete process.env[key]; Object.assign(process.env, original); }
});
