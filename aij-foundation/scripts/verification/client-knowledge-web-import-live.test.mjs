/** Owned synthetic loopback HTTP transport only: no application, DB, HTTPS reader or public web fetch. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import test from "node:test";
import { createClientApi, createKnowledgeWebImportsClient } from "../../packages/sdk/dist/index.mjs";
import { createKnowledgeDocumentsApi } from "../../apps/web/app/components/client-knowledge-api.ts";
import { createKnowledgeWebImportState } from "../../apps/web/app/components/client-knowledge-web-import-state.mjs";

const workspaceId = "synthetic-alpha";
const scope = { workspaceId, principalId: "synthetic-member", canManage: true };
const id = "c123456789012345678901234";
const input = code => ({ documentCode: code, title: "Synthetic web import", url: "https://example.invalid/owned-contract-fixture?private=synthetic" });
const result = code => ({ id, workspaceId, documentCode: code, title: "Synthetic web import", status: "inactive", createdAt: "2026-11-06T00:00:00.000Z", updatedAt: "2026-11-06T00:00:00.000Z" });
const row = { id, workspaceId, sourceFilename: "web-import" };

test("AF182 actual compiled SDK + page controller over owned loopback HTTP: no replay, scoped reads and stale fences", { timeout: 15000 }, async t => {
  const rows = new Map();
  const requests = [];
  const pendingObserved = Promise.withResolvers();
  const pendingReply = Promise.withResolvers();
  let deferSource = false;
  let sourceObserved = Promise.withResolvers();
  let sourceReply = Promise.withResolvers();
  const respond = (res, data) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ success: true, data, message: "ok" })); };
  const server = createServer(async (req, res) => {
    const workspace = req.headers["x-aij-workspace-id"];
    requests.push({ method: req.method, path: req.url, workspace });
    if (workspace !== workspaceId) { res.writeHead(403); res.end(); return; }
    if (req.method === "POST" && req.url === "/client/ai/knowledge/documents/import-web") {
      let body = "";
      for await (const chunk of req) body += chunk;
      const value = JSON.parse(body);
      assert.deepEqual(Object.keys(value).sort(), ["documentCode", "title", "url"]);
      if (rows.has(value.documentCode)) { res.writeHead(409); res.end(); return; }
      rows.set(value.documentCode, { ...result(value.documentCode), sourceFilename: "web-import", content: "Synthetic import text" });
      if (value.documentCode === "lost-reply") { res.destroy(); return; }
      if (value.documentCode === "pending-old") { pendingObserved.resolve(); await pendingReply.promise; }
      respond(res, result(value.documentCode)); return;
    }
    if (req.method === "GET" && req.url.startsWith("/client/ai/knowledge/documents?")) {
      respond(res, { page: 1, pageSize: 20, total: rows.size, items: [...rows.values()] }); return;
    }
    if (req.method === "GET" && req.url === `/client/ai/knowledge/documents/${id}/web-source`) {
      if (deferSource) { sourceObserved.resolve(); await sourceReply.promise; }
      respond(res, { documentId: id, sourceFilename: "web-import", sourceChecksum: "a".repeat(64), sourceTextChecksum: "b".repeat(64), sourceUrl: input("x").url, sourceFinalUrl: "https://example.invalid/final", sourceExtractionVersion: "aij-knowledge-web-text/1", contentMatchesSource: false }); return;
    }
    res.writeHead(404); res.end();
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(async () => { pendingReply.resolve(); sourceReply.resolve(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const client = createClientApi(() => `http://127.0.0.1:${server.address().port}`);
  const documents = createKnowledgeDocumentsApi(client);
  const controller = createKnowledgeWebImportState(createKnowledgeWebImportsClient(client));
  const revision = () => controller.getSnapshot().revision;
  const prepare = code => { controller.open(revision()); controller.prepare(input(code), revision()); };
  controller.setScope(scope);

  await t.test("committed synthetic response lost: exactly one POST, ordinary code re-read before deliberate unlock", async () => {
    prepare("lost-reply"); const token = revision();
    await Promise.all([controller.confirm(token), controller.confirm(token)]);
    assert.equal(controller.getSnapshot().locked, true);
    assert.equal(controller.open(revision()), false);
    assert.equal(controller.acknowledgeRead(revision()), false);
    assert.equal(requests.filter(item => item.method === "POST").length, 1);
    const page = await documents.list(workspaceId, { status: "all" });
    assert.equal(page.items.find(item => item.documentCode === "lost-reply").status, "inactive");
    controller.markListRead(); assert.equal(controller.acknowledgeRead(revision()), true);
    assert.equal(requests.filter(item => item.method === "POST").length, 1);
  });
  await t.test("only explicit source GET, manual mismatch stays visible and private until invalidation", async () => {
    const before = requests.length;
    assert.equal(await controller.readSource({ ...row, workspaceId: "foreign" }, revision()), false);
    assert.equal(await controller.readSource({ ...row, sourceFilename: null }, revision()), false);
    assert.equal(requests.length, before);
    assert.equal(await controller.readSource(row, revision()), true);
    assert.equal(controller.getSnapshot().source.contentMatchesSource, false);
    controller.invalidate(); controller.setScope(scope);
    assert.equal(controller.getSnapshot().source, null);
  });
  await t.test("duplicate refusal is one POST, no replacement or implicit activation", async () => {
    prepare("lost-reply"); await controller.confirm(revision());
    assert.equal(controller.getSnapshot().stage, "error");
    assert.match(controller.getSnapshot().message, /未覆盖/);
    assert.equal(rows.size, 1); assert.equal(rows.get("lost-reply").status, "inactive");
    assert.equal(requests.some(item => item.method === "PATCH" || item.path.includes("query")), false);
  });
  await t.test("pending real HTTP POST from old scope cannot repopulate or submit in new scope", async () => {
    prepare("pending-old"); const token = revision(); const pending = controller.confirm(token);
    await pendingObserved.promise;
    controller.invalidate(); controller.setScope({ ...scope, workspaceId: "synthetic-beta" });
    assert.equal(await controller.confirm(token), false);
    pendingReply.resolve(); await pending;
    assert.equal(controller.getSnapshot().stage, "idle");
    assert.equal(controller.getSnapshot().source, null);
    assert.equal(requests.filter(item => item.workspace === "synthetic-beta").length, 0);
    controller.setScope(scope); assert.equal(controller.getSnapshot().locked, true);
  });
  await t.test("pending real HTTP source GET clears on same-scope revalidation, role/account changes issue zero calls", async () => {
    deferSource = true;
    const pending = controller.readSource(row, revision()); await sourceObserved.promise;
    controller.invalidate(); controller.setScope(scope);
    sourceReply.resolve(); await pending;
    assert.equal(controller.getSnapshot().source, null);
    const before = requests.length;
    controller.setScope({ ...scope, principalId: "readonly-member", canManage: false });
    assert.equal(controller.open(revision()), false);
    assert.equal(await controller.readSource(row, revision()), false);
    assert.equal(requests.length, before);
  });
  assert.equal(requests.filter(item => item.method === "POST").length, 3);
  assert.equal(requests.filter(item => item.method === "PATCH").length, 0);
  assert.equal([...rows.values()].every(item => item.status === "inactive"), true);
});
