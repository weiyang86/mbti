import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { createAcceptance, migrate } from "../database/migration.mjs";
import { assertLocalPath, readDatabaseEnvironment, repositoryRoot, withDatabase } from "../database/connection.mjs";
import { authEnvironment, authKeys } from "./auth-support.mjs";
import { prepareUi2Fixture } from "./ui2-fixture.mjs";

const webRoot = join(repositoryRoot, "apps/web");
const webOrigin = "http://localhost:3655";
const freePort = async () => {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address(); assert.ok(address && typeof address === "object");
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return address.port;
};
const filesBelow = directory => {
  try { return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? filesBelow(join(directory, entry.name)) : [join(directory, entry.name)]); }
  catch { return []; }
};

test("AF-088 real PostgreSQL, admin HTTP and Web consumer present a read-only client detail/status view", { timeout: 720_000 }, async t => {
  const originalEnvironment = { ...process.env };
  let api, nextApp, webServer;
  try {
    const lease = await createAcceptance("test", "AF-088");
    await migrate({ mode: "test", action: "deploy", acceptanceId: lease.id });
    await migrate({ mode: "test", action: "status", acceptanceId: lease.id });
    const fixture = await prepareUi2Fixture(lease.id, "AF-088");
    const keys = authKeys(lease.id, "AF-088");

    const nextRequire = createRequire(join(webRoot, "package.json"));
    process.env.NODE_ENV = "production";
    process.env.APP_ENV = "test";
    process.env.RUNTIME_PROFILE = "host";
    process.env.PROJECT_ID = "aij-foundation";
    process.env.WEB_PORT = "3655";
    process.env.API_PORT = "3656";
    process.env.WEB_URL = webOrigin;
    process.env.NEXT_PUBLIC_API_URL = "http://127.0.0.1:3656/api";
    process.env.AIJ_NEXT_DIST_DIR = ".next-af088";
    nextApp = nextRequire("next")({ dev: false, dir: webRoot, hostname: "127.0.0.1" });
    await nextApp.prepare();
    webServer = createServer((request, response) => { void nextApp.getRequestHandler()(request, response); });
    const webPort = await freePort();
    await new Promise((resolve, reject) => { webServer.once("error", reject); webServer.listen(webPort, "127.0.0.1", resolve); });
    const webHttpOrigin = `http://127.0.0.1:${webPort}`;

    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, authEnvironment(lease.id, keys.secret, "AF-088"), {
      WEB_PORT: "3655", API_PORT: "3656", WEB_URL: webOrigin,
      NEXT_PUBLIC_API_URL: "http://127.0.0.1:3656/api"
    });
    const apiRequire = createRequire(join(repositoryRoot, "apps/api/package.json"));
    const { createApplication } = apiRequire(join(repositoryRoot, "apps/api/dist/bootstrap.js"));
    api = await createApplication();
    await api.listen(0, "127.0.0.1");
    const apiAddress = api.getHttpServer().address(); assert.ok(apiAddress && typeof apiAddress === "object");
    const apiOrigin = `http://127.0.0.1:${apiAddress.port}`;
    const query = operation => withDatabase("test", readDatabaseEnvironment("test", process.env, lease.id), operation, { acceptanceId: lease.id });

    const createdAt = new Date(Date.now() - 86_400_000);
    const now = new Date();
    const ids = { active: randomUUID(), disabled: randomUUID() };
    const emails = { active: `af088-active-${randomUUID()}@example.test`, disabled: `af088-disabled-${randomUUID()}@example.test` };
    const sensitive = `AF088_CREDENTIAL_CANARY_${randomUUID()}`;
    const namespace = "aij-foundation:test";
    await query(async client => {
      await client.query(
        "INSERT INTO public.member_user(id,email,nickname,password_hash,status,email_verified_at,created_at,updated_at) VALUES($1,$2,$3,$4,'active',$5,$6,$6),($7,$8,$9,$10,'disabled',NULL,$11,$11)",
        [ids.active, emails.active, "af088-active", sensitive, now, createdAt, ids.disabled, emails.disabled, "af088-disabled", sensitive + "_2", createdAt]
      );
      const session = (memberId, marker, expiresAt, revokedAt) => client.query(
        "INSERT INTO public.client_auth_session(id,member_id,namespace,status,device_hash,device_summary,ip_hash,issued_at,expires_at,last_seen_at,revoked_at,created_at,updated_at) VALUES($1,$2,$3,'active',$4,'synthetic browser',$5,$6,$7,$6,$8,$6,$6)",
        [randomUUID(), memberId, namespace, marker, marker + "_ip", now, expiresAt, revokedAt]
      );
      await session(ids.active, sensitive + "_active", new Date(now.getTime() + 86_400_000), null);
      await session(ids.disabled, sensitive + "_disabled", new Date(now.getTime() - 86_400_000), now);
      await client.query(
        "INSERT INTO public.client_consent_record(id,member_id,namespace,consent_type,granted,text_version,text_digest,source,captured_at,created_at,updated_at) VALUES($1,$2,$3,'privacy',true,'v1',$4,'web',$5,$5,$5)",
        [randomUUID(), ids.active, namespace, sensitive + "_digest", now]
      );
    });

    const signIn = async username => {
      const passwordFile = fixture.accounts.find(account => account.username === username)?.initialPasswordFile;
      assert.ok(passwordFile);
      const saved = JSON.parse(readFileSync(passwordFile, "utf8"));
      const password = saved.accounts.find(account => account.username === username)?.password;
      assert.ok(password);
      const response = await fetch(apiOrigin + "/api/auth/browser-login", {
        method: "POST", headers: { origin: webOrigin, "content-type": "application/json", "x-aij-client": "web" },
        body: JSON.stringify({ username, password }), signal: AbortSignal.timeout(10_000)
      });
      assert.equal(response.status, 200);
      const cookie = response.headers.get("set-cookie")?.split(";", 1)[0]; assert.ok(cookie);
      const session = await fetch(apiOrigin + "/api/auth/session", { headers: { origin: webOrigin, cookie }, signal: AbortSignal.timeout(10_000) });
      assert.equal(session.status, 200);
      return { cookie, csrf: (await session.json()).data.csrfToken };
    };
    const manager = await signIn("ui2-client-manager");
    const reader = await signIn("ui2-reader");
    const request = async (cookie, status = 200, path = "/api/admin/clients") => {
      const response = await fetch(apiOrigin + path, { headers: { origin: webOrigin, ...(cookie ? { cookie, "x-aij-csrf": manager.csrf } : {}) }, signal: AbortSignal.timeout(10_000) });
      assert.equal(response.status, status, path);
      const text = await response.text();
      assert.ok(!/passwordHash|password_hash|accessToken|tokenHash|token_hash|deviceHash|device_hash|ipHash|ip_hash|textDigest|text_digest|\$2[aby]\$/.test(text));
      assert.ok(!text.includes(sensitive));
      return { response, body: text ? JSON.parse(text) : null };
    };

    await t.test("anonymous and unprivileged users are rejected; status and empty-result filters use the API contract", async () => {
      await request(undefined, 401);
      await request(reader.cookie, 403);
      const disabled = await request(manager.cookie, 200, "/api/admin/clients?status=disabled");
      assert.equal(disabled.body.data.total, 1);
      assert.equal(disabled.body.data.items[0].id, ids.disabled);
      assert.equal(disabled.body.data.items[0].status, "disabled");
      const active = await request(manager.cookie, 200, "/api/admin/clients?status=active");
      assert.equal(active.body.data.total, 1);
      assert.equal(active.body.data.items[0].id, ids.active);
      const absent = await request(manager.cookie, 200, "/api/admin/clients?q=" + encodeURIComponent("does-not-exist-" + randomUUID()));
      assert.deepEqual(absent.body.data.items, []);
      assert.equal(absent.body.data.total, 0, "the existing list API represents no match as an empty authorized page, not a fabricated 404 detail route");
    });

    await t.test("read-only detail payload is the existing masked projection and exposes no write capability", async () => {
      const result = await request(manager.cookie, 200, "/api/admin/clients?q=af088-active");
      assert.equal(result.body.data.total, 1);
      const row = result.body.data.items[0];
      assert.equal(row.id, ids.active);
      assert.equal(row.emailMasked, "af***@example.test");
      assert.equal(row.status, "active");
      assert.equal(row.activeSessionCount, 1);
      assert.deepEqual(row.latestConsent && { type: row.latestConsent.type, granted: row.latestConsent.granted, version: row.latestConsent.version }, { type: "privacy", granted: true, version: "v1" });
      assert.deepEqual(Object.keys(row).sort(), ["activeSessionCount", "createdAt", "emailMasked", "emailVerified", "id", "lastLoginAt", "latestConsent", "nickname", "status"].sort());
      assert.equal(result.response.headers.get("cache-control"), "no-store");
    });

    await t.test("actual Web route and production client bundle include the read-only detail/status consumer", async () => {
      const response = await fetch(webHttpOrigin + "/auth/clients", { signal: AbortSignal.timeout(45_000) });
      assert.equal(response.status, 200);
      assert.match(response.headers.get("content-type") ?? "", /text\/html/);
      const html = await response.text();
      assert.ok(html.includes("正在确认登录与权限"));
      const routeChunks = filesBelow(join(webRoot, ".next-af088/static/chunks"));
      const compiled = routeChunks.filter(file => file.endsWith(".js")).map(file => readFileSync(file, "utf8")).join("\n");
      assert.ok(compiled.includes("客户详情（只读）"), "production bundle contains the actual detail drawer");
      assert.ok(compiled.includes("按账号状态筛选"), "production bundle contains the actual status filter");
      const persisted = await query(client => client.query("SELECT count(*)::int AS n FROM public.member_user WHERE id=ANY($1::text[])", [Object.values(ids)]));
      assert.equal(persisted.rows[0].n, 2, "synthetic client rows persist in the independent AF-088 acceptance database");
      const evidence = join(repositoryRoot, ".artifacts/af-088", `client-details-${lease.id}.json`);
      assertLocalPath(evidence);
      mkdirSync(join(repositoryRoot, ".artifacts/af-088"), { recursive: true, mode: 0o700 });
      writeFileSync(evidence, JSON.stringify({ task: "AF-088", acceptanceId: lease.id, database: lease.database, syntheticClientRows: 2, cases: ["anonymous-401", "unprivileged-403", "status-filter-active", "status-filter-disabled", "authorized-empty-result", "masked-detail-projection", "real-next-route", "production-detail-and-status-bundle"] }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    });
  } finally {
    if (webServer) await new Promise((resolve, reject) => webServer.close(error => error ? reject(error) : resolve()));
    if (nextApp) await nextApp.close();
    if (api) await api.close();
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, originalEnvironment);
  }
});
