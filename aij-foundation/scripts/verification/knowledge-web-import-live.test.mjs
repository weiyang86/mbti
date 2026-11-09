// ROOT ONLY: requires a fresh registered AF-179 isolated PG fixture, actual compiled API,
// real module provider injection and early parser middleware. Worker must NOT execute.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:https";
import { createRequire } from "node:module";
import { resolve, sep } from "node:path";
import { connect } from "node:tls";
import { pathToFileURL } from "node:url";
import test from "node:test";

const requireApi = createRequire(resolve("apps/api/package.json"));
const compiled = name => requireApi(resolve("apps/api/dist", name));
const hash = value => createHash("sha256").update(value).digest("hex");
const host = "knowledge.fixture.aij.tools";
const body = "<article><table><tr><td></td><td>aurora guide policy</td></tr></table></article>";

async function ownedHttps(Reader) {
  const directory = mkdtempSync(resolve(".artifacts/af179-tls-"));
  const config = directory + "/openssl.cnf";
  writeFileSync(config, `[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=${host}\n[ext]\nsubjectAltName=DNS:${host}\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,digitalSignature,keyEncipherment,keyCertSign\nextendedKeyUsage=serverAuth\n`);
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "2", "-config", config,
    "-keyout", directory + "/key.pem", "-out", directory + "/cert.pem"], { stdio: "ignore" });
  const cert = readFileSync(directory + "/cert.pem");
  const sockets = new Set(); let requests = 0, failTls = false;
  let holdResolve, releaseResolve;
  const held = new Set();
  const server = createServer({ key: readFileSync(directory + "/key.pem"), cert }, async (request, response) => {
    requests++;
    const path = request.url.split("?")[0];
    if (path === "/held") {
      held.add(response); holdResolve?.(); await new Promise(resolve => { releaseResolve = resolve; }); held.delete(response);
    }
    if (path === "/redirect") { response.writeHead(302, { location: "/article?final=synthetic" }); response.end(); return; }
    if (path === "/private-redirect") { response.writeHead(302, { location: "https://127.0.0.1/private" }); response.end(); return; }
    if (path === "/loop") { response.writeHead(302, { location: "/loop" }); response.end(); return; }
    response.setHeader("content-type", path === "/oversize" || path === "/too-big" ? "text/plain" : "text/html");
    if (path === "/oversize") response.end("x".repeat(65537));
    else if (path === "/too-big") response.end("x".repeat(1024 * 1024 + 1));
    else if (path === "/utf8") response.end(Buffer.from([255, 254]));
    else if (path === "/empty") response.end("<script>discarded</script>");
    else response.end(body);
  });
  server.on("connection", socket => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)); });
  server.on("tlsClientError", () => {});
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const reader = new Reader({ resolve: async hostname => {
    assert.equal(hostname, host); return [{ address: "93.184.216.34", family: 4 }];
  }, connect: options => {
    assert.equal(options.host, host); assert.equal(options.servername, host); assert.equal(options.rejectUnauthorized, true);
    assert.equal(options.port, 443); assert.equal(options.autoSelectFamily, false);
    // The trusted test seam relocates the socket ONLY to this owned TLS listener.
    // Actual HTTPS framing, certificate/hostname verification, parsing and limits remain active.
    return connect({ ...options, host: "127.0.0.1", port, lookup: undefined, ca: failTls ? undefined : cert });
  } });
  return { reader, get requests() { return requests; }, failTls(value) { failTls = value; },
    waitHeld: () => new Promise(resolve => { holdResolve = resolve; }), release: () => releaseResolve?.(),
    async close() {
      releaseResolve?.(); for (const response of held) response.destroy();
      for (const socket of sockets) socket.destroy();
      await new Promise(resolve => server.close(resolve));
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(sockets.size, 0, "owned HTTPS sockets must be zero"); rmSync(directory, { recursive: true });
    }
  };
}

const expectedTask = process.env.AIJ_KNOWLEDGE_WEB_LIVE_TASK ?? "AF-179";
assert.ok(["AF-179", "AF-181", "AF-182"].includes(expectedTask));
test(expectedTask + " fresh real HTTP/PluginLifecycle/PG and compiled reader/parser/SDK", { timeout: 300000 }, async t => {
  const adapterPath = process.env.AIJ_AF179_LIVE_ADAPTER;
  assert.ok(adapterPath, "ROOT ONLY: set AIJ_AF179_LIVE_ADAPTER to the registered fresh AF179 fixture adapter; absence is failure, never skip/pass");
  const adapter = realpathSync(resolve(adapterPath));
  assert.ok(adapter.startsWith(realpathSync(resolve(".artifacts")) + sep), "adapter must be root-owned ignored local artifact");
  const { createFixture } = await import(pathToFileURL(adapter).href);
  const { KnowledgeWebReader, knowledgeWebReader } = compiled("plugins/aij-ai/knowledge-web-reader.js");
  const { KnowledgeWebImportTransport, KNOWLEDGE_WEB_IMPORT_TRANSPORT } = compiled("plugins/aij-ai/knowledge-web-import.js");
  const { PluginLifecycleService } = compiled("plugin-runtime/plugin-lifecycle.service.js");
  const tls = await ownedHttps(KnowledgeWebReader);
  const transport = new KnowledgeWebImportTransport(tls.reader);
  let f;
  try {
    // Adapter must register AF179 with fixture/DB guards, build a fresh isolated database,
    // and inject this token BEFORE creating the actual application (no service monkey patch).
    f = await createFixture({ transport, transportToken: KNOWLEDGE_WEB_IMPORT_TRANSPORT });
    assert.equal(f.lease.task, expectedTask); assert.equal(f.app.get(KNOWLEDGE_WEB_IMPORT_TRANSPORT), transport);
    assert.equal(new URL(f.baseUrl).hostname, "127.0.0.1");
    const lifecycle = f.app.get(PluginLifecycleService);
    assert.ok(lifecycle instanceof PluginLifecycleService); assert.ok(f.operatorId);
    assert.equal(typeof f.withAuditFailure, "function", "adapter must use a real temporary PG audit failure trigger with cleanup");
    assert.equal(typeof f.assertClosed, "function", "adapter must prove API sockets and database pools zero after close");
    const [alpha, beta] = f.workspaces; const [cookie, other] = f.cookies;
    const base = "/client/ai/knowledge/documents";
    const dto = (code, path = "/article") => ({ documentCode: code, title: "Synthetic import", url: `https://${host}${path}?private=synthetic` });
    const request = async (method, path, value, options = {}) => {
      const response = await fetch(f.baseUrl + path, { method, headers: { connection: "close", origin: process.env.WEB_URL,
        cookie, "x-aij-workspace-id": alpha.id, ...(value === undefined ? {} : { "content-type": "application/json" }), ...options.headers },
        ...(value === undefined ? {} : { body: options.raw ? value : JSON.stringify(value) }), signal: AbortSignal.timeout(25000) });
      const text = await response.text();
      if (path.includes("import-web") || path.includes("web-source")) assert.equal(response.headers.get("cache-control"), "private, no-store");
      if (response.status >= 400) {
        assert.equal(text.includes("private=synthetic"), false); assert.equal(text.includes(host), false); assert.equal(text.includes(body), false);
      }
      return { response, text, data: text ? JSON.parse(text).data : null };
    };
    const expect = async (status, method, path, value, options) => {
      const result = await request(method, path, value, options); assert.equal(result.response.status, status, result.text); return result.data;
    };
    const counts = async () => ({ documents: await f.prisma.aiKnowledgeDocument.count(),
      audits: await f.prisma.auditLog.count({ where: { module: "aij-ai", resourceType: "ai_knowledge_document" } }) });
    const noWrites = async action => { const before = await counts(); await action(); assert.deepEqual(await counts(), before); };

    await t.test("compiled production defaults refuse invalid/private URLs before connecting", async () => {
      const defaultTransport = new KnowledgeWebImportTransport();
      for (const url of ["http://127.0.0.1/", "https://127.0.0.1/", "https://10.0.0.1/", "https://localhost/"]) {
        await assert.rejects(knowledgeWebReader.read(url), error => error.code === "URL_REJECTED");
        await assert.rejects(defaultTransport.extract(url), error => error.message === "WEB_IMPORT_REJECTED");
      }
    });
    let document;
    await t.test("one inactive document + ID-only audit; exact original/final URIs and raw/text hashes", async () => {
      const value = dto("af179-initial", "/redirect"); const before = await counts();
      document = await expect(201, "POST", base + "/import-web", value);
      assert.equal(document.status, "inactive"); assert.equal(JSON.stringify(document).includes(host), false);
      const row = await f.prisma.aiKnowledgeDocument.findUniqueOrThrow({ where: { id: document.id } });
      assert.equal(row.content, "\taurora guide policy"); assert.equal(row.sourceUrl, value.url);
      assert.equal(row.sourceFinalUrl, `https://${host}/article?final=synthetic`);
      assert.equal(row.sourceChecksum, hash(body)); assert.equal(row.sourceTextChecksum, hash(row.content));
      assert.equal(row.sourceExtractionVersion, "aij-knowledge-web-text/1"); assert.equal(row.sourceFilename, "web-import");
      assert.deepEqual(await counts(), { documents: before.documents + 1, audits: before.audits + 1 });
      const audit = await f.prisma.auditLog.findFirstOrThrow({ where: { resourceId: document.id } });
      assert.deepEqual(audit.afterData, { documentId: document.id, status: "inactive" }); assert.equal(JSON.stringify(audit).includes(host), false);
      const source = await expect(200, "GET", base + "/" + document.id + "/web-source");
      assert.equal(source.contentMatchesSource, true); assert.equal(source.sourceUrl, value.url);
      const list = await expect(200, "GET", base + "?status=all"); assert.equal(JSON.stringify(list).includes(host), false);
    });
    await t.test("inactive excluded from retrieval, existing explicit PATCH activation enables it, manual edit differs", async () => {
      const query = () => expect(200, "POST", "/client/ai/knowledge/query", { query: "aurora guide" });
      assert.equal((await query()).citations.some(x => x.documentId === document.id), false);
      const active = await expect(200, "PATCH", base + "/" + document.id, { status: "active", expectedUpdatedAt: document.updatedAt });
      assert.equal((await query()).citations.some(x => x.documentId === document.id), true);
      await expect(200, "PATCH", base + "/" + document.id, { content: "Explicit manual revision", expectedUpdatedAt: active.updatedAt });
      const metadata = await expect(200, "GET", base + "/" + document.id + "/web-source"); assert.equal(metadata.contentMatchesSource, false);
      await noWrites(() => expect(409, "POST", base + "/import-web", dto("af179-initial")));
      assert.equal((await f.prisma.aiKnowledgeDocument.findUniqueOrThrow({ where: { id: document.id } })).content, "Explicit manual revision");
    });
    await t.test("anonymous, foreign, readonly, unknown/query fields, malformed JSON and 413 have safe no-store refusals", async () => {
      const beforeNetwork = tls.requests;
      await noWrites(async () => {
        await expect(401, "POST", base + "/import-web", dto("af179-anonymous"), { headers: { cookie: "" } });
        await expect(403, "POST", base + "/import-web", dto("af179-nonmember"), { headers: { cookie: other } });
        await expect(403, "POST", base + "/import-web", dto("af179-origin"), { headers: { origin: "https://foreign.invalid" } });
        await expect(404, "GET", base + "/" + document.id + "/web-source", undefined, { headers: { cookie: other, "x-aij-workspace-id": beta.id } });
        for (const extra of ["workspaceId", "headers", "ca", "connector", "snapshot", "status", "content"]) await expect(400, "POST", base + "/import-web", { ...dto("af179-extra"), [extra]: "untrusted" });
        await expect(400, "POST", base + "/import-web?url=untrusted", dto("af179-query"));
        await expect(400, "GET", base + "/" + document.id + "/web-source?url=untrusted");
        await expect(400, "POST", base + "/import-web", '{"url":', { raw: true });
        await expect(413, "POST", base + "/import-web", "x".repeat(1024 * 1024), { raw: true });
      });
      assert.equal(tls.requests, beforeNetwork);
      const membership = await f.prisma.clientWorkspaceMembership.findFirstOrThrow({ where: { memberId: f.accounts[0].id, workspaceId: alpha.id } });
      const role = await f.prisma.clientWorkspaceRole.create({ data: { workspaceId: alpha.id, code: "af179-readonly", name: "Synthetic no manage grant" } });
      try {
        await f.prisma.clientWorkspaceMembership.update({ where: { id: membership.id }, data: { roleId: role.id } });
        await noWrites(async () => {
          await expect(403, "GET", base + "/" + document.id + "/web-source");
          await expect(403, "POST", base + "/import-web", dto("af179-readonly"));
        });
      } finally { await f.prisma.clientWorkspaceMembership.update({ where: { id: membership.id }, data: { roleId: membership.roleId } }); }
      assert.equal(tls.requests, beforeNetwork);
    });
    await t.test("real owned HTTPS redirect/byte/UTF8/parse/TLS failures create zero rows", async () => {
      for (const path of ["/private-redirect", "/loop", "/oversize", "/too-big", "/utf8", "/empty"]) {
        await noWrites(async () => { const result = await request("POST", base + "/import-web", dto("af179-refusal", path)); assert.ok([400, 413].includes(result.response.status)); });
      }
      tls.failTls(true);
      try { await noWrites(() => expect(400, "POST", base + "/import-web", dto("af179-tls"))); }
      finally { tls.failTls(false); }
    });
    await t.test("held actual HTTPS response then member/session/role/grant/workspace/project/organization/plugin withdrawal prevents commit", async () => {
      const membership = await f.prisma.clientWorkspaceMembership.findFirstOrThrow({ where: { memberId: f.accounts[0].id, workspaceId: alpha.id } });
      const project = await f.prisma.projectProfile.findFirstOrThrow({ where: { id: f.project.id } });
      const grant = await f.prisma.clientWorkspaceRolePermission.findFirstOrThrow({ where: { roleId: membership.roleId, deletedAt: null, permission: { code: "workspace.knowledge.manage" } } });
      for (const mode of ["membership", "session", "member", "role", "grant", "workspace", "project", "organization", "plugin", "session-expiry", "session-issued", "session-namespace", "token-version"]) {
        const before = await counts(); const reached = tls.waitHeld();
        const pending = request("POST", base + "/import-web", dto("af179-held-" + mode, "/held"));
        let holdTimer;
        try { await Promise.race([reached, new Promise((_, reject) => { holdTimer = setTimeout(() => reject(new Error("HTTPS hold not reached")), 10000); })]); }
        finally { clearTimeout(holdTimer); }
        let restore;
        try {
          if (mode === "membership") {
            await f.prisma.clientWorkspaceMembership.update({ where: { id: membership.id }, data: { status: "inactive" } });
            restore = () => f.prisma.clientWorkspaceMembership.update({ where: { id: membership.id }, data: { status: "active" } });
          } else if (mode === "member") {
            await f.prisma.memberUser.update({ where: { id: membership.memberId }, data: { deletedAt: new Date() } });
            restore = () => f.prisma.memberUser.update({ where: { id: membership.memberId }, data: { deletedAt: null } });
          } else if (mode === "role") {
            await f.prisma.clientWorkspaceRole.update({ where: { id: membership.roleId }, data: { status: "inactive" } });
            restore = () => f.prisma.clientWorkspaceRole.update({ where: { id: membership.roleId }, data: { status: "active" } });
          } else if (mode === "grant") {
            await f.prisma.clientWorkspaceRolePermission.update({ where: { id: grant.id }, data: { deletedAt: new Date() } });
            restore = () => f.prisma.clientWorkspaceRolePermission.update({ where: { id: grant.id }, data: { deletedAt: null } });
          } else if (mode === "workspace") {
            await f.prisma.clientWorkspace.update({ where: { id: alpha.id }, data: { status: "inactive" } });
            restore = () => f.prisma.clientWorkspace.update({ where: { id: alpha.id }, data: { status: "active" } });
          } else if (mode === "project") {
            await f.prisma.projectProfile.update({ where: { id: project.id }, data: { status: "inactive" } });
            restore = () => f.prisma.projectProfile.update({ where: { id: project.id }, data: { status: "active" } });
          } else if (mode === "organization") {
            await f.prisma.organizationProfile.update({ where: { id: project.organizationId }, data: { status: "inactive" } });
            restore = () => f.prisma.organizationProfile.update({ where: { id: project.organizationId }, data: { status: "active" } });
          } else if (mode.startsWith("session-")) {
            const sessions = await f.prisma.clientAuthSession.findMany({ where: { memberId: f.accounts[0].id, status: "active" }, select: { id: true, expiresAt: true, issuedAt: true, namespace: true } });
            const data = mode === "session-expiry" ? { expiresAt: new Date(0) } : mode === "session-issued" ? { issuedAt: new Date(Date.now() + 60000) } : { namespace: "af179-other-namespace" };
            await f.prisma.clientAuthSession.updateMany({ where: { id: { in: sessions.map(s => s.id) } }, data });
            restore = () => Promise.all(sessions.map(s => f.prisma.clientAuthSession.update({ where: { id: s.id }, data: { expiresAt: s.expiresAt, issuedAt: s.issuedAt, namespace: s.namespace } })));
          } else if (mode === "token-version") {
            const member = await f.prisma.memberUser.findUniqueOrThrow({ where: { id: membership.memberId }, select: { tokenVersion: true } });
            await f.prisma.memberUser.update({ where: { id: membership.memberId }, data: { tokenVersion: { increment: 1 } } });
            restore = () => f.prisma.memberUser.update({ where: { id: membership.memberId }, data: { tokenVersion: member.tokenVersion } });
          } else if (mode === "session") {
            const sessions = await f.prisma.clientAuthSession.findMany({ where: { memberId: f.accounts[0].id, status: "active" }, select: { id: true } });
            const ids = sessions.map(row => row.id);
            await f.prisma.clientAuthSession.updateMany({ where: { id: { in: ids } }, data: { status: "revoked", revokedAt: new Date() } });
            restore = () => f.prisma.clientAuthSession.updateMany({ where: { id: { in: ids } }, data: { status: "active", revokedAt: null } });
          } else {
            await lifecycle.disable("aij-ai", f.operatorId, "af179-held-disable");
            restore = () => lifecycle.enable("aij-ai", f.operatorId, "af179-held-enable");
          }
          tls.release(); const result = await pending; assert.ok([401, 403, 404, 503].includes(result.response.status)); assert.deepEqual(await counts(), before);
        } finally { tls.release(); await pending.catch(() => {}); if (restore) await restore(); }
      }
    });
    await t.test("real audit failure rolls back atomic document and source", async () => {
      await noWrites(() => f.withAuditFailure(() => expect(503, "POST", base + "/import-web", dto("af179-audit-fail"))));
    });
    await t.test("actual built public SDK ESM+CJS exports use authenticated Workspace request", async () => {
      const esm = await import("../../packages/sdk/dist/index.mjs");
      const cjs = requireApi(resolve("packages/sdk/dist/index.cjs"));
      assert.equal(typeof esm.createKnowledgeWebImportsClient, "function"); assert.equal(typeof cjs.createKnowledgeWebImportsClient, "function");
      const previous = globalThis.fetch;
      globalThis.fetch = (url, init = {}) => { const headers = new Headers(init.headers); headers.set("cookie", cookie); headers.set("origin", process.env.WEB_URL); return previous(url, { ...init, headers }); };
      try {
        for (const [i, sdk] of [esm, cjs].entries()) {
          const api = sdk.createKnowledgeWebImportsClient(sdk.createClientApi(() => f.baseUrl));
          const row = await api.importWeb(alpha.id, dto("af179-sdk-" + i)); assert.equal(row.status, "inactive");
          assert.equal((await api.getWebSource(alpha.id, row.id)).contentMatchesSource, true);
        }
      } finally { globalThis.fetch = previous; }
      for (const ext of ["d.mts", "d.cts"]) assert.match(readFileSync(resolve("packages/sdk/dist/index." + ext), "utf8"), /knowledge-web-imports/);
    });
  } finally {
    try { if (f) { await f.close(); await f.assertClosed(); } }
    finally { await tls.close(); }
  }
});
