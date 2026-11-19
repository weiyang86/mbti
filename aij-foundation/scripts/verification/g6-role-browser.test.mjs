import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { createServer, request as httpRequest } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { createAcceptance, migrate } from "../database/migration.mjs";
import { assertLocalPath, readDatabaseEnvironment, repositoryRoot, withDatabase } from "../database/connection.mjs";
import { authEnvironment, authKeys } from "./auth-support.mjs";
import { prepareUi2Fixture } from "./ui2-fixture.mjs";

const webRoot = join(repositoryRoot, "apps/web");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const listen = server => new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address(); assert.ok(address && typeof address === "object");
    resolve(address);
  });
});
const closeServer = server => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));

test("G6-08 real PostgreSQL/API plus the actual Web browser enforce the customer permission matrix and redact sensitive data", { timeout: 840_000 }, async t => {
  const originalEnvironment = { ...process.env };
  const secrets = [];
  let lease, api, nextApp, proxyServer, apiOrigin = "", webOrigin = "", nextHandler, apiPort = 0;
  const ticketSessions = new Map(), visitedTickets = new Set(), tokenRoles = new Map(), proxyTraffic = [];
  try {
    lease = await createAcceptance("test", "AF-090");
    await migrate({ mode: "test", action: "deploy", acceptanceId: lease.id });
    await migrate({ mode: "test", action: "status", acceptanceId: lease.id });
    const fixture = await prepareUi2Fixture(lease.id, "AF-090");
    const saved = JSON.parse(readFileSync(fixture.accounts[0].initialPasswordFile, "utf8"));
    const account = username => {
      const value = saved.accounts.find(item => item.username === username);
      assert.ok(value, "only the task-owned synthetic admin account file is read");
      secrets.push(value.password);
      return { username, password: value.password };
    };
    const manager = account("ui2-client-manager"), reader = account("ui2-reader");
    const keys = authKeys(lease.id, "AF-090");
    const clientAuthSecrets = { CLIENT_JWT_SECRET: randomBytes(32).toString("hex"), CLIENT_AUTH_RATE_LIMIT_SECRET: randomBytes(32).toString("hex"), CLIENT_AUTH_TOKEN_SECRET: randomBytes(32).toString("hex") };
    secrets.push(keys.secret, ...Object.values(clientAuthSecrets));
    const env = authEnvironment(lease.id, keys.secret, "AF-090");
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, env, { APP_ENV: "test", RUNTIME_PROFILE: "host", PROJECT_ID: "aij-foundation",
      AIJ_NEXT_DIST_DIR: ".next-af090", AIJ_TEST_API_URL: "/api", NEXT_TELEMETRY_DISABLED: "1", ...clientAuthSecrets });

    const require = createRequire(join(repositoryRoot, "apps/api/package.json"));
    const bcrypt = require("bcryptjs");
    proxyServer = createServer((incoming, outgoing) => {
      const path = incoming.url || "/";
      const ticketMatch = /^\/_aij_af090\/session\/([a-f0-9]{40})$/.exec(path);
      if (ticketMatch) {
        if (incoming.method !== "GET") { outgoing.writeHead(405, { "cache-control": "no-store" }); outgoing.end(); return; }
        const ticket = ticketSessions.get(ticketMatch[1]);
        if (!ticket || visitedTickets.has(ticketMatch[1])) { outgoing.writeHead(404, { "cache-control": "no-store" }); outgoing.end(); return; }
        visitedTickets.add(ticket.role);
        outgoing.writeHead(302, { location: "/auth/clients?af090Role=" + ticket.role, "set-cookie": ticket.setCookie, "cache-control": "no-store" });
        outgoing.end();
        return;
      }
      if (path === "/api" || path.startsWith("/api/")) {
        const rawCookie = incoming.headers.cookie || "";
        const cookiePair = rawCookie.split(";").map(value => value.trim()).find(value => value.startsWith("aij_foundation_test_admin_session="));
        const token = cookiePair?.slice("aij_foundation_test_admin_session=".length);
        const role = token ? tokenRoles.get(token) || "unknown" : "anonymous";
        const upstream = httpRequest({ hostname: "127.0.0.1", port: apiPort, method: incoming.method, path,
          headers: { ...incoming.headers, host: "127.0.0.1:" + apiPort } }, response => {
          const record = { role, method: incoming.method, path: path.split("?", 1)[0], status: response.statusCode ?? 0 };
          proxyTraffic.push(record);
          outgoing.writeHead(response.statusCode ?? 502, response.headers);
          response.pipe(outgoing);
        });
        upstream.on("error", () => { if (!outgoing.headersSent) outgoing.writeHead(502, { "cache-control": "no-store" }); outgoing.end("Upstream unavailable"); });
        incoming.pipe(upstream);
        return;
      }
      if (nextHandler) { void nextHandler(incoming, outgoing); return; }
      outgoing.writeHead(503, { "cache-control": "no-store" }); outgoing.end("Web application is preparing");
    });
    const webAddress = await listen(proxyServer);
    webOrigin = `http://127.0.0.1:${webAddress.port}`;
    const { createApplication } = require(join(repositoryRoot, "apps/api/dist/bootstrap.js"));
    api = await createApplication({ testBrowserOrigin: webOrigin });
    await api.listen(0, "127.0.0.1");
    const apiAddress = api.getHttpServer().address(); assert.ok(apiAddress && typeof apiAddress === "object");
    apiPort = apiAddress.port;
    apiOrigin = `http://127.0.0.1:${apiPort}`;

    process.env.NODE_ENV = "production";
    const nextRequire = createRequire(join(webRoot, "package.json"));
    nextApp = nextRequire("next")({ dev: false, dir: webRoot, hostname: "127.0.0.1" });
    await nextApp.prepare();
    nextHandler = nextApp.getRequestHandler();

    const query = operation => withDatabase("test", readDatabaseEnvironment("test", process.env, lease.id), operation, { acceptanceId: lease.id });
    const ids = [randomUUID(), randomUUID()];
    const clientSessionIds = [randomUUID(), randomUUID()], consentId = randomUUID();
    const now = new Date();
    const namespace = "aij-foundation:test";
    const email = [`af090-one-${randomUUID()}@example.test`, `af090-two-${randomUUID()}@example.test`];
    const canaries = [
      "AF090_PASSWORD_HASH_CANARY_" + randomBytes(20).toString("hex"),
      "AF090_DEVICE_HASH_CANARY_" + randomBytes(20).toString("hex"),
      "AF090_IP_HASH_CANARY_" + randomBytes(20).toString("hex"),
      "AF090_CONSENT_DIGEST_CANARY_" + randomBytes(20).toString("hex")
    ];
    secrets.push(...clientSessionIds, consentId, ...email, ...canaries);
    await query(async client => {
      await client.query("INSERT INTO public.member_user(id,email,nickname,password_hash,status,email_verified_at,created_at,updated_at) VALUES($1,$2,'合成客户甲',$3,'active',$4,$4,$4),($5,$6,'合成客户乙',$7,'active',$4,$4,$4)",
        [ids[0], email[0], await bcrypt.hash(canaries[0], 12), now, ids[1], email[1], await bcrypt.hash(canaries[0] + "_2", 12)]);
      await client.query("INSERT INTO public.client_auth_session(id,member_id,namespace,status,device_hash,device_summary,ip_hash,issued_at,expires_at,created_at,updated_at) VALUES($1,$2,$3,'active',$4,'synthetic browser',$5,$6,$7,$6,$6),($8,$9,$3,'active',$10,'synthetic browser',$11,$6,$7,$6,$6)",
        [clientSessionIds[0], ids[0], namespace, canaries[1], canaries[2], now, new Date(now.getTime() + 3_600_000), clientSessionIds[1], ids[1], canaries[1] + "_2", canaries[2] + "_2"]);
      await client.query("INSERT INTO public.client_consent_record(id,member_id,namespace,consent_type,granted,text_version,text_digest,source,captured_at,created_at,updated_at) VALUES($1,$2,$3,'privacy',true,'synthetic-v1',$4,'web',$5,$5,$5)",
        [consentId, ids[0], namespace, canaries[3], now]);
    });

    async function browserSession(accountValue, role) {
      const response = await fetch(apiOrigin + "/api/auth/browser-login", { method: "POST", headers: { origin: webOrigin, "content-type": "application/json", "x-aij-client": "web" },
        body: JSON.stringify(accountValue), signal: AbortSignal.timeout(10_000) });
      assert.equal(response.status, 200, `${role} synthetic browser login succeeds`);
      const setCookie = response.headers.get("set-cookie"); assert.ok(setCookie);
      const pair = setCookie.split(";", 1)[0], token = pair.slice(pair.indexOf("=") + 1);
      assert.ok(token); secrets.push(token); tokenRoles.set(token, role);
      const session = await fetch(apiOrigin + "/api/auth/session", { headers: { origin: webOrigin, cookie: pair }, signal: AbortSignal.timeout(10_000) });
      assert.equal(session.status, 200, `${role} browser cookie validates on the real API`);
      const body = await session.json(); assert.ok(body.data.csrfToken);
      return { setCookie, cookie: pair, csrf: body.data.csrfToken };
    }
    const managerSession = await browserSession(manager, "manager");
    const readerSession = await browserSession(reader, "reader");

    const rawReader = await fetch(apiOrigin + "/api/admin/clients", { headers: { origin: webOrigin, cookie: readerSession.cookie }, signal: AbortSignal.timeout(10_000) });
    assert.equal(rawReader.status, 403, "ordinary authenticated role is rejected by the API guard");
    const rawManager = await fetch(apiOrigin + "/api/admin/clients?q=af090&pageSize=20", { headers: { origin: webOrigin, cookie: managerSession.cookie }, signal: AbortSignal.timeout(10_000) });
    assert.equal(rawManager.status, 200, "authorized client manager reads the existing projection");
    const managerBody = await rawManager.json();
    assert.equal(managerBody.data.total, 2);
    assert.deepEqual(managerBody.data.items.map(row => row.emailMasked), ["af***@example.test", "af***@example.test"]);
    const clientWithHistory = managerBody.data.items.find(row => row.nickname === "合成客户甲");
    assert.ok(clientWithHistory);
    assert.equal(clientWithHistory.activeSessionCount, 1);
    assert.deepEqual(clientWithHistory.latestConsent && { type: clientWithHistory.latestConsent.type, granted: clientWithHistory.latestConsent.granted, version: clientWithHistory.latestConsent.version },
      { type: "privacy", granted: true, version: "synthetic-v1" });
    const projectionText = JSON.stringify(managerBody.data);
    for (const secret of secrets) assert.ok(!projectionText.includes(secret), "API projection omits e-mail, password hash, session identifiers and consent digest");
    assert.deepEqual(Object.keys(managerBody.data.items[0]).sort(), ["activeSessionCount", "createdAt", "emailMasked", "emailVerified", "id", "lastLoginAt", "latestConsent", "nickname", "status"].sort());

    async function issueTicket(role) {
      const session = role === "manager" ? managerSession : readerSession;
      const ticketId = randomBytes(20).toString("hex");
      ticketSessions.set(ticketId, { role, setCookie: session.setCookie });
      return webOrigin + "/_aij_af090/session/" + ticketId;
    }
    const managerUrl = await issueTicket("manager"), readerUrl = await issueTicket("reader");
    const runId = randomBytes(12).toString("hex");
    const evidenceDir = join(repositoryRoot, ".artifacts/verification/AF-090"); assertLocalPath(evidenceDir);
    mkdirSync(evidenceDir, { recursive: true, mode: 0o700 });
    const cardEvidenceDir = join(repositoryRoot, ".artifacts/af-090"); assertLocalPath(cardEvidenceDir);
    mkdirSync(cardEvidenceDir, { recursive: true, mode: 0o700 });
    const sessionFile = join(evidenceDir, "browser-session-" + lease.id + ".json");
    const observationFile = join(evidenceDir, "browser-observation-" + lease.id + ".json");
    const evidenceFile = join(repositoryRoot, ".artifacts/af-090", "customer-role-browser-" + lease.id + ".json");
    assertLocalPath(sessionFile); assertLocalPath(observationFile); assertLocalPath(evidenceFile);
    for (const path of [sessionFile, observationFile, evidenceFile]) assert.equal(existsSync(path), false, "new acceptance evidence never overwrites prior runs");
    writeFileSync(sessionFile, JSON.stringify({ task: "AF-090", acceptanceId: lease.id, runId, origin: webOrigin, managerUrl, readerUrl,
      observationFile, expiresWhenTestProcessExits: true, sessionTokensWritten: false }, null, 2) + "\n", { flag: "wx", mode: 0o600 });

    const browserDeadline = Date.now() + 600_000;
    while (!existsSync(observationFile) && Date.now() < browserDeadline) await sleep(250);
    assert.ok(existsSync(observationFile), "actual browser role observations must be captured before the real HTTP host closes");
    const observation = JSON.parse(readFileSync(observationFile, "utf8"));
    assert.equal(observation.task, "AF-090"); assert.equal(observation.acceptanceId, lease.id); assert.equal(observation.runId, runId);
    assert.equal(observation.manager?.customerTitleVisible, true);
    assert.equal(observation.manager?.syntheticCustomerVisible, true);
    assert.equal(observation.manager?.maskedEmailVisible, "af***@example.test");
    assert.equal(observation.manager?.rawEmailAbsent, true);
    assert.equal(observation.manager?.sensitiveCanariesAbsent, true);
    assert.equal(observation.reader?.restrictedPageVisible, true);
    assert.equal(observation.reader?.customerMenuAbsent, true);
    assert.equal(observation.reader?.logoutCompleted, true);
    assert.deepEqual([...visitedTickets].sort(), ["manager", "reader"]);
    assert.ok(proxyTraffic.some(row => row.role === "manager" && row.path === "/api/admin/clients" && row.status === 200), "authorized browser rendered the guarded customer list");
    assert.ok(!proxyTraffic.some(row => row.role === "reader" && row.path === "/api/admin/clients"), "restricted browser never requested the client-list API");
    assert.ok(proxyTraffic.some(row => row.role === "reader" && row.path === "/api/admin/menus/my" && row.status === 200), "ordinary role received its actual server-filtered menu");
    assert.ok(proxyTraffic.some(row => row.role === "reader" && row.path === "/api/auth/logout" && row.status === 200), "restricted session can log out through the real browser API");
    assert.ok(!JSON.stringify(proxyTraffic).includes(secrets[0]), "captured proxy evidence contains paths and status only, no credentials");

    await query(async client => {
      const rows = await client.query("SELECT email,password_hash FROM public.member_user WHERE id=ANY($1::text[])", [ids]);
      assert.equal(rows.rows.length, 2, "synthetic customer identities persist only in the isolated AF-090 database");
      assert.ok(rows.rows.some(row => row.email === email[0]));
      assert.ok(rows.rows.some(row => row.password_hash.startsWith("$2")));
      const history = await client.query("SELECT text_digest FROM public.client_consent_record WHERE member_id=$1 AND namespace=$2", [ids[0], namespace]);
      assert.equal(history.rows.length, 1, "the underlying consent source record remains traceable");
      assert.equal(history.rows[0].text_digest, canaries[3]);
    });
    const safeEvidence = { task: "AF-090", acceptanceId: lease.id, database: lease.database, webOrigin, apiOrigin, syntheticCustomers: 2,
      browserRoles: ["manager", "reader"], readerDirectApiStatus: 403, managerDirectApiStatus: 200,
      browserTraffic: proxyTraffic.map(({ role, method, path, status }) => ({ role, method, path, status })),
      assertions: ["manager browser sees only masked customer contact", "ordinary role browser receives restricted page and no customer menu", "ordinary role direct API receives 403", "ordinary UI does not request protected customer API", "logout clears browser session", "session count and consent summary remain sourced from the existing read projection"],
      sensitiveCanariesReturned: false, credentialsOrCookiesPersisted: false, browserObservationFile: observationFile };
    writeFileSync(evidenceFile, JSON.stringify(safeEvidence, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    await t.test("real API role matrix returns 403/200 and safe, traceable projection", () => {
      assert.equal(rawReader.status, 403); assert.equal(rawManager.status, 200);
      assert.equal(managerBody.data.items.length, 2); assert.ok(managerBody.data.items.every(row => row.emailMasked === "af***@example.test"));
      assert.ok(managerBody.data.items.every(row => row.activeSessionCount === 1)); assert.equal(clientWithHistory.latestConsent.version, "synthetic-v1");
    });
    await t.test("actual browser manager and ordinary roles observe distinct page access", () => {
      assert.deepEqual([...visitedTickets].sort(), ["manager", "reader"]);
      assert.ok(proxyTraffic.some(row => row.role === "manager" && row.path === "/api/admin/clients" && row.status === 200));
      assert.ok(!proxyTraffic.some(row => row.role === "reader" && row.path === "/api/admin/clients"));
      assert.ok(observation.reader.logoutCompleted);
    });
    await t.test("sensitive client fields stay out of API, browser and audit-facing projection", () => {
      const serialized = JSON.stringify({ projection: managerBody.data, browser: observation, traffic: proxyTraffic });
      for (const marker of secrets) assert.ok(!serialized.includes(marker));
      assert.equal(observation.manager.rawEmailAbsent, true);
      assert.equal(observation.manager.sensitiveCanariesAbsent, true);
    });
  } finally {
    if (proxyServer) await closeServer(proxyServer).catch(() => {});
    if (nextApp) await nextApp.close().catch(() => {});
    if (api) await api.close().catch(() => {});
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, originalEnvironment);
  }
});
