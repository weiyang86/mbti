import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { createAcceptance, migrate } from "../database/migration.mjs";
import { readDatabaseEnvironment, repositoryRoot, assertLocalPath, withDatabase } from "../database/connection.mjs";
import { authEnvironment, authKeys } from "./auth-support.mjs";
import { prepareUi2Fixture } from "./ui2-fixture.mjs";

const webRoot = join(repositoryRoot, "apps/web");
const webOrigin = { value: "" };
let webHttpOrigin = "";
const freePort = async () => {
  const server = createServer();
  await new Promise((resolveListen, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolveListen); });
  const address = server.address(); assert.ok(address && typeof address === "object");
  await new Promise((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()));
  return address.port;
};

test("AF-087 real PostgreSQL, administrator HTTP and Web route expose a project-scoped read-only customer projection", { timeout: 720_000 }, async t => {
  const originalEnvironment = { ...process.env };
  let api, nextApp, webServer;
  try {
    const lease = await createAcceptance("test", "AF-087");
    await migrate({ mode: "test", action: "deploy", acceptanceId: lease.id });
    await migrate({ mode: "test", action: "status", acceptanceId: lease.id });
    const fixture = await prepareUi2Fixture(lease.id, "AF-087");
    const keys = authKeys(lease.id, "AF-087");

    const webPort = await freePort();
    const nextRequire = createRequire(join(webRoot, "package.json"));
    process.env.NODE_ENV = "production";
    process.env.APP_ENV = "test";
    process.env.RUNTIME_PROFILE = "host";
    process.env.PROJECT_ID = "aij-foundation";
    process.env.WEB_PORT = "3655";
    process.env.API_PORT = "3656";
    process.env.WEB_URL = "http://localhost:3655";
    process.env.NEXT_PUBLIC_API_URL = "http://127.0.0.1:3656/api";
    process.env.AIJ_NEXT_DIST_DIR = ".next-af087";
    webOrigin.value = process.env.WEB_URL;
    nextApp = nextRequire("next")({ dev: false, dir: webRoot, hostname: "127.0.0.1" });
    await nextApp.prepare();
    const handler = nextApp.getRequestHandler();
    webServer = createServer((request, response) => { void handler(request, response); });
    await new Promise((resolveListen, reject) => { webServer.once("error", reject); webServer.listen(webPort, "127.0.0.1", resolveListen); });
    webHttpOrigin = `http://127.0.0.1:${webPort}`;

    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, authEnvironment(lease.id, keys.secret, "AF-087"), {
      WEB_PORT: "3655", API_PORT: "3656", WEB_URL: webOrigin.value,
      NEXT_PUBLIC_API_URL: "http://127.0.0.1:3656/api"
    });
    const apiRequire = createRequire(join(repositoryRoot, "apps/api/package.json"));
    const { createApplication } = apiRequire(join(repositoryRoot, "apps/api/dist/bootstrap.js"));
    api = await createApplication();
    await api.listen(0, "127.0.0.1");
    const address = api.getHttpServer().address(); assert.ok(address && typeof address === "object");
    const apiOrigin = `http://127.0.0.1:${address.port}`;
    const query = operation => withDatabase("test", readDatabaseEnvironment("test", process.env, lease.id), operation, { acceptanceId: lease.id });

    const rawRequest = async (path, { method = "GET", cookie, csrf, expectedStatus = 200 } = {}) => {
      const response = await fetch(apiOrigin + "/api" + path, {
        method,
        headers: { origin: webOrigin.value, "content-type": "application/json", "x-correlation-id": "af087-real-http", ...(cookie ? { cookie, "x-aij-csrf": csrf ?? "" } : {}) },
        signal: AbortSignal.timeout(10_000)
      });
      assert.equal(response.status, expectedStatus, `${method} ${path}`);
      const text = await response.text();
      assert.ok(!/passwordHash|password_hash|accessToken|tokenHash|token_hash|deviceHash|device_hash|ipHash|ip_hash|textDigest|text_digest|\$2[aby]\$/.test(text), "HTTP response omits credential/session/consent internals");
      return { response, body: text ? JSON.parse(text) : null };
    };
    const sessionFor = async username => {
      const passwordFile = fixture.accounts.find(account => account.username === username)?.initialPasswordFile;
      assert.ok(passwordFile);
      const saved = JSON.parse(readFileSync(passwordFile, "utf8"));
      const password = saved.accounts.find(account => account.username === username)?.password;
      assert.ok(password);
      const login = await fetch(apiOrigin + "/api/auth/browser-login", {
        method: "POST", headers: { origin: webOrigin.value, "content-type": "application/json", "x-aij-client": "web" },
        body: JSON.stringify({ username, password }), signal: AbortSignal.timeout(10_000)
      });
      assert.equal(login.status, 200, "Synthetic administrator browser login succeeds");
      const setCookie = login.headers.get("set-cookie"); assert.ok(setCookie);
      const cookie = setCookie.split(";", 1)[0];
      const current = await fetch(apiOrigin + "/api/auth/session", { headers: { origin: webOrigin.value, cookie }, signal: AbortSignal.timeout(10_000) });
      assert.equal(current.status, 200);
      const currentBody = await current.json();
      return { cookie, csrf: currentBody.data.csrfToken };
    };
    const call = async (session, path, expectedStatus = 200) => {
      const { response, body } = await rawRequest(path, { cookie: session?.cookie, csrf: session?.csrf, expectedStatus });
      assert.ok(!JSON.stringify(body).includes(keys.secret), "JWT secret never appears in responses");
      return { response, data: body?.data };
    };

    const manager = await sessionFor("ui2-client-manager");
    const reader = await sessionFor("ui2-reader");
    const empty = await sessionFor("ui2-empty");
    const suffix = randomUUID().replaceAll("-", "");
    const names = {
      scoped: "af087-scoped-" + suffix,
      pending: "af087-pending-" + suffix,
      foreign: "af087-foreign-" + suffix,
      unrelated: "af087-unrelated-" + suffix
    };
    const emails = Object.fromEntries(Object.entries(names).map(([key, name]) => [key, name + "@example.test"]));
    const ids = Object.fromEntries(Object.entries(names).map(([key]) => [key, randomUUID()]));
    const canaries = ["AF087_PASSWORD_HASH_" + suffix, "AF087_DEVICE_HASH_" + suffix, "AF087_IP_HASH_" + suffix, "AF087_TOKEN_HASH_" + suffix, "AF087_CONSENT_DIGEST_" + suffix, "AF087_FOREIGN_SECRET_" + suffix];
    const namespace = "aij-foundation:test", foreignNamespace = "another-project:test", now = new Date();
    await query(async client => {
      for (const [index, key] of Object.keys(names).entries()) {
        await client.query(
          "INSERT INTO public.member_user(id,email,nickname,password_hash,status,email_verified_at,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$7)",
          [ids[key], emails[key], names[key], key === "scoped" ? canaries[0] : null, key === "pending" ? "pending_verification" : "active", key === "scoped" ? now : null, new Date(now.getTime() - index * 60_000)]
        );
      }
      const session = (memberId, rowNamespace, status, revokedAt, expiresAt, marker) => client.query(
        "INSERT INTO public.client_auth_session(id,member_id,namespace,status,device_hash,device_summary,ip_hash,issued_at,expires_at,last_seen_at,revoked_at,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$8,$10,$8,$8)",
        [randomUUID(), memberId, rowNamespace, status, marker, "合成测试设备", marker + "_IP", now, expiresAt, revokedAt]
      );
      await session(ids.scoped, namespace, "active", null, new Date(now.getTime() + 86_400_000), canaries[1]);
      await session(ids.scoped, namespace, "active", now, new Date(now.getTime() + 86_400_000), "AF087_REVOKED_" + suffix);
      await session(ids.scoped, namespace, "active", null, new Date(now.getTime() - 86_400_000), "AF087_EXPIRED_" + suffix);
      await session(ids.scoped, foreignNamespace, "active", null, new Date(now.getTime() + 86_400_000), canaries[5]);
      await session(ids.foreign, foreignNamespace, "active", null, new Date(now.getTime() + 86_400_000), canaries[5]);
      await client.query(
        "INSERT INTO public.client_auth_one_time_token(id,member_id,purpose,token_hash,expires_at,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$6)",
        [randomUUID(), ids.pending, "client-email-verification:" + namespace, canaries[3], new Date(now.getTime() + 86_400_000), now]
      );
      await client.query(
        "INSERT INTO public.client_consent_record(id,member_id,namespace,consent_type,granted,text_version,text_digest,source,captured_at,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$9),($10,$2,$3,$4,$11,$12,$13,$8,$14,$14,$14),($15,$16,$17,$4,true,$18,$19,$8,$9,$9,$9)",
        [randomUUID(), ids.scoped, namespace, "privacy", true, "v1", canaries[4], "web", new Date(now.getTime() - 60_000), randomUUID(), false, "v2", canaries[4] + "_LATEST", new Date(now.getTime() + 1_000), randomUUID(), ids.foreign, foreignNamespace, "foreign-v1", canaries[5] + "_CONSENT"]
      );
    });

    await t.test("anonymous, insufficient role and non-allowlisted query parameters are rejected at real HTTP", async () => {
      await rawRequest("/admin/clients", { expectedStatus: 401 });
      await call(reader, "/admin/clients", 403);
      await call(empty, "/admin/clients", 403);
      await call(manager, "/admin/clients?pageSize=101", 400);
      await call(manager, "/admin/clients?status=unknown", 400);
      await call(manager, "/admin/clients?workspaceId=client-controlled", 400);
      const valid = await call(manager, "/admin/clients");
      assert.equal(valid.response.headers.get("cache-control"), "no-store");
    });

    await t.test("authorized list is bounded to current namespace and paginated deterministically", async () => {
      const first = (await call(manager, "/admin/clients?page=1&pageSize=1")).data;
      const second = (await call(manager, "/admin/clients?page=2&pageSize=1")).data;
      assert.equal(first.total, 2); assert.equal(second.total, 2);
      assert.equal(first.page, 1); assert.equal(second.page, 2);
      assert.equal(first.items.length, 1); assert.equal(second.items.length, 1);
      assert.notEqual(first.items[0].id, second.items[0].id);
      assert.deepEqual(new Set([first.items[0].id, second.items[0].id]), new Set([ids.scoped, ids.pending]));
      const pending = (await call(manager, "/admin/clients?status=pending_verification&pageSize=20")).data;
      assert.equal(pending.total, 1); assert.equal(pending.items[0].id, ids.pending);
      const absentForeign = (await call(manager, "/admin/clients?q=" + encodeURIComponent(emails.foreign))).data;
      assert.equal(absentForeign.total, 0); assert.deepEqual(absentForeign.items, []);
    });

    await t.test("projection masks identity and omits hashes, device/IP data, token and consent digest", async () => {
      const result = (await call(manager, "/admin/clients?q=" + encodeURIComponent(names.scoped))).data;
      assert.equal(result.total, 1);
      const row = result.items[0];
      assert.deepEqual(Object.keys(row).sort(), ["activeSessionCount", "createdAt", "emailMasked", "emailVerified", "id", "lastLoginAt", "latestConsent", "nickname", "status"].sort());
      assert.equal(row.emailMasked, names.scoped.slice(0, 2) + "***@example.test");
      const sessionEvidence = await query(client => client.query("SELECT namespace, status, revoked_at, expires_at > now() AS unexpired, deleted_at FROM public.client_auth_session WHERE member_id=$1 ORDER BY created_at", [ids.scoped]));
      assert.equal(row.activeSessionCount, 1, `only unrevoked, unexpired sessions from this namespace count: ${JSON.stringify(sessionEvidence.rows)}`);
      assert.deepEqual({ type: row.latestConsent.type, granted: row.latestConsent.granted, version: row.latestConsent.version }, { type: "privacy", granted: false, version: "v2" });
      const expectedCapture = await query(client => client.query("SELECT captured_at AT TIME ZONE 'UTC' AS captured_at_utc FROM public.client_consent_record WHERE member_id=$1 AND namespace=$2 ORDER BY captured_at DESC, id DESC LIMIT 1", [ids.scoped, namespace]));
      assert.equal(Date.parse(row.latestConsent.capturedAt), expectedCapture.rows[0].captured_at_utc.getTime(), "latest consent timestamp matches the UTC interpretation of the stored database value");
      const text = JSON.stringify(result);
      assert.ok(!text.includes(emails.scoped));
      for (const canary of canaries) assert.ok(!text.includes(canary), "Sensitive persistence canaries are absent from response projection");
      assert.equal((await query(client => client.query("SELECT count(*)::int AS n FROM public.client_auth_session WHERE member_id=$1", [ids.scoped]))).rows[0].n, 4, "synthetic session rows persisted in the isolated acceptance database");
    });

    await t.test("real Web route renders the admin page and menu filtering follows server permission", async () => {
    const response = await fetch(webHttpOrigin + "/auth/clients", { headers: { cookie: manager.cookie }, signal: AbortSignal.timeout(45_000) });
      assert.equal(response.status, 200);
      assert.match(response.headers.get("content-type") ?? "", /text\/html/);
      const html = await response.text();
      assert.ok(html.includes("正在确认登录与权限"), "unauthenticated SSR output must expose only the admin shell loading state before client-side permission resolution");
      assert.ok(html.includes("__next"));
      const menu = async session => (await call(session, "/admin/menus/my")).data;
      assert.ok((await menu(manager)).some(item => item.path === "/auth/clients"));
      assert.ok(!(await menu(reader)).some(item => item.path === "/auth/clients"));
      assert.deepEqual(await menu(empty), []);
      assert.equal((await query(client => client.query("SELECT count(*)::int AS n FROM public.member_user WHERE id=ANY($1::text[])", [Object.values(ids)]))).rows[0].n, 4, "records persist only in the new AF-087 acceptance database");
    });

    const evidence = join(repositoryRoot, ".artifacts/af-087", `customer-directory-${lease.id}.json`);
    assertLocalPath(evidence);
    mkdirSync(join(repositoryRoot, ".artifacts/af-087"), { recursive: true, mode: 0o700 });
    writeFileSync(evidence, JSON.stringify({ task: "AF-087", acceptanceId: lease.id, database: lease.database, syntheticMembers: 4, scopedMembersReturned: 2, cases: ["401", "403", "400 validation", "project namespace isolation", "pagination", "status filter", "masked email", "session count", "latest consent", "real Web route", "RBAC menu filtering"], sensitiveCanaries: "none echoed" }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  } finally {
    if (webServer) await new Promise((resolveClose, reject) => webServer.close(error => error ? reject(error) : resolveClose()));
    if (nextApp) await nextApp.close();
    if (api) await api.close();
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, originalEnvironment);
  }
});
