import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

// Actual implementations, no API server, database, vendor or GUI. Collaborators
// below are synthetic unit inputs and are never target-acceptance evidence.
const require = createRequire(resolve("apps/api/package.json"));
require("ts-node").register({ project: resolve("apps/api/tsconfig.json"), transpileOnly: true });
require("reflect-metadata");
const helper = require(resolve("apps/api/src/plugins/aij-ai/knowledge-citation.ts"));
const controller = require(resolve("apps/api/src/plugins/aij-ai/ai-knowledge-citations.controller.ts"));
const { retrieveKnowledgeEvidence } = require(resolve("apps/api/src/plugins/aij-ai/ai-knowledge-retrieval.ts"));
const { WorkspaceContextGuard } = require(resolve("apps/api/src/client-workspaces/workspace-context.guard.ts"));
const { CLIENT_WORKSPACE_PERMISSIONS_KEY } = require(resolve("apps/api/src/client-workspaces/client-workspace-permission.decorator.ts"));
const { GUARDS_METADATA, PATH_METADATA, METHOD_METADATA } = require("@nestjs/common/constants");
const { createClientApi, ClientRequestFailure } = await import("../../packages/sdk/dist/index.mjs");
const scratch = mkdtempSync(join(tmpdir(), "aij-af214-"));
process.on("exit", () => rmSync(scratch, { recursive: true, force: true }));
const sdk = [];
for (const [module, suffix] of [[ts.ModuleKind.ES2022, "mjs"], [ts.ModuleKind.CommonJS, "cjs"]]) {
  const file = resolve("packages/sdk/src/knowledge-citations.ts");
  const output = ts.transpileModule(readFileSync(file, "utf8"), { fileName: file, compilerOptions: { module, target: ts.ScriptTarget.ES2022, strict: true }, reportDiagnostics: true });
  assert.equal(output.diagnostics.length, 0);
  const path = join(scratch, "knowledge-citations." + suffix); writeFileSync(path, output.outputText);
  sdk.push([suffix, suffix === "mjs" ? await import(pathToFileURL(path)) : require(path)]);
}
const questionId = "cquestion0000000000000000", documentId = "cdocument0000000000000000", memberId = "member-unit", workspaceId = "workspace-unit";
const hash = value => createHash("sha256").update(value, "utf8").digest("hex");
const status = code => error => error.getStatus?.() === code;
function fixture() {
  const document = { id: documentId, workspaceId, documentCode: "unit-guide", title: "Unit guide", content: "Alpha response. Unrelated sentence. Beta deadline.", status: "active", updatedAt: new Date("2026-11-06T01:00:00.000Z"), deletedAt: null };
  const question = { id: questionId, workspaceId, memberId, status: "answered", query: "alpha beta", citations: retrieveKnowledgeEvidence("alpha beta", [document]).citations,
    createdAt: new Date("2026-11-06T00:00:00.000Z"), updatedAt: new Date("2026-11-06T02:00:00.000Z"), deletedAt: null, contentPurgedAt: null };
  return { memberId, workspaceId, questionId, documentId, question, document, now: new Date("2026-11-07T00:00:00.000Z") };
}
const projection = () => helper.currentKnowledgeCitation(fixture());

test("new SDK module compiles with real declarations under the package's strict NodeNext settings", () => {
  const program = ts.createProgram([resolve("packages/sdk/src/knowledge-citations.ts")], {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext,
    strict: true, skipLibCheck: true, declaration: true, types: [], lib: ["lib.es2022.d.ts", "lib.dom.d.ts"],
    rootDir: resolve("packages/sdk/src"), outDir: join(scratch, "types")
  });
  const errors = ts.getPreEmitDiagnostics(program).filter(d => d.category === ts.DiagnosticCategory.Error);
  assert.equal(errors.length, 0, ts.formatDiagnosticsWithColorAndContext(errors, { getCurrentDirectory: () => process.cwd(), getCanonicalFileName: s => s, getNewLine: () => "\n" }));
  assert.equal(program.emit().emitSkipped, false);
  assert.match(readFileSync(join(scratch, "types/knowledge-citations.d.ts"), "utf8"), /createKnowledgeCitationsClient/);
});

test("pure current-source projection hashes exact UTF8 and uses original joined-sentence extraction", () => {
  const f = fixture(), before = JSON.stringify(f), value = helper.currentKnowledgeCitation(f);
  assert.deepEqual(Object.keys(value).sort(), ["questionId", "documentId", "documentCode", "title", "content", "excerpt", "updatedAt", "checksum", "sourceState"].sort());
  assert.equal(value.excerpt, "Alpha response. Beta deadline."); assert.equal(f.document.content.includes(value.excerpt), false);
  assert.equal(value.sourceState, "CURRENT"); assert.equal(value.checksum, hash(f.document.content)); assert.equal(JSON.stringify(f), before);
});
test("missing/foreign/nonanswered/deleted/purged/ref mismatch all deny without mutating inputs", () => {
  const mutations = [f => f.question = null, f => f.question.memberId = "other", f => f.question.workspaceId = "other", f => f.question.id = documentId,
    f => f.question.deletedAt = f.now, f => f.question.contentPurgedAt = f.now, ...["queued", "running", "failed", "refused"].map(v => f => f.question.status = v),
    f => f.question.citations = null, f => f.question.citations = [], f => f.question.citations[0].documentId = questionId,
    f => f.question.citations.push(f.question.citations[0]), f => f.question.citations[0].excerpt = "", f => f.question.citations[0].title = "\ud800",
    f => f.document = null, f => f.document.workspaceId = "other", f => f.document.id = questionId, f => f.document.status = "inactive",
    f => f.document.deletedAt = f.now, f => f.document.content = "中".repeat(21846), f => f.document.content = "\ud800", f => f.document.updatedAt = new Date(NaN)];
  for (const mutate of mutations) { const f = fixture(); mutate(f); const before = JSON.stringify(f); assert.throws(() => helper.currentKnowledgeCitation(f), status(404)); assert.equal(JSON.stringify(f), before); }
});
test("deadline is createdAt + seven days, including exact edge; foreign ownership remains 404", () => {
  const f = fixture(), deadline = f.question.createdAt.getTime() + helper.KNOWLEDGE_CITATION_RETENTION_MS;
  f.now = new Date(deadline - 1); helper.currentKnowledgeCitation(f);
  f.now = new Date(deadline); assert.throws(() => helper.currentKnowledgeCitation(f), status(410));
  f.question.contentPurgedAt = f.now; assert.throws(() => helper.currentKnowledgeCitation(f), status(410));
  f.question.memberId = "foreign"; assert.throws(() => helper.currentKnowledgeCitation(f), status(404));
});
test("title/code/excerpt and newer source yield exactly SOURCE_CHANGED; inactive source stays 404", () => {
  for (const mutate of [f => f.document.title += "changed", f => f.document.documentCode += "changed", f => f.document.content = "Alpha changed. Beta changed.",
    f => f.document.updatedAt = new Date(f.question.updatedAt.getTime() + 1), f => f.question.citations[0].excerpt += " changed"]) {
    const f = fixture(); mutate(f); assert.throws(() => helper.currentKnowledgeCitation(f), error => error.getStatus?.() === 409 && error.message === "SOURCE_CHANGED");
    f.document.status = "inactive"; assert.throws(() => helper.currentKnowledgeCitation(f), status(404));
  }
});
test("exact 64KiB UTF8 is accepted, above limit refuses, unchanged time is accepted", () => {
  const f = fixture(); f.document.content = "alpha beta " + "x".repeat(65525); f.document.updatedAt = f.question.updatedAt;
  f.question.citations = retrieveKnowledgeEvidence(f.question.query, [f.document]).citations;
  assert.equal(Buffer.byteLength(helper.currentKnowledgeCitation(f).content), 65536);
  f.document.content += "x"; assert.throws(() => helper.currentKnowledgeCitation(f), status(404));
  for (const id of ["a".repeat(19), "a".repeat(33), "A".repeat(24), "../x", null]) assert.throws(() => helper.knowledgeCitationId(id), status(400));
  for (const length of [20, 32]) assert.equal(helper.knowledgeCitationId("a".repeat(length)).length, length);
});

function request() { return { headers: {}, client: { id: memberId }, workspaceContext: { workspaceId }, clientClaims: { sub: memberId, sessionId: "session-unit", tokenVersion: 1 } }; }
test("real controller metadata exposes only GET with original knowledgeQuery/Workspace guard and forwards original claims", async () => {
  const C = controller.AiKnowledgeCitationsController, calls = [], r = request();
  const c = new C({ readCitation: async (...args) => { calls.push(args); return projection(); } });
  assert.equal(Reflect.getMetadata(PATH_METADATA, C), "client/ai/knowledge");
  assert.equal(Reflect.getMetadata(PATH_METADATA, C.prototype.read), "questions/:questionId/citations/:documentId");
  assert.equal(Reflect.getMetadata(METHOD_METADATA, C.prototype.read), 0);
  assert.deepEqual(Reflect.getMetadata(CLIENT_WORKSPACE_PERMISSIONS_KEY, C.prototype.read), ["workspace.knowledge.query"]);
  assert.deepEqual(Reflect.getMetadata(GUARDS_METADATA, C), [WorkspaceContextGuard]);
  assert.equal(Reflect.getMetadata("design:paramtypes", C.prototype, "read")[3], Object);
  await c.read(r, questionId, documentId, {});
  assert.deepEqual(calls, [[memberId, workspaceId, questionId, documentId, r.clientClaims]]);
  const cases = [r => r.clientClaims = undefined, r => r.clientClaims.sub = "other", r => r.client = undefined];
  for (const mutate of cases) { const bad = request(); mutate(bad); assert.throws(() => c.read(bad, questionId, documentId, {}), status(401)); }
  const noWorkspace = request(); noWorkspace.workspaceContext = undefined; assert.throws(() => c.read(noWorkspace, questionId, documentId, {}), status(403));
  for (const q of [{ extra: "private" }, { workspaceId: "spoof" }, [], null]) assert.throws(() => c.read(r, questionId, documentId, q), status(400));
  for (const body of [{ extra: true }, [], null, "", false]) assert.throws(() => c.read(r, questionId, documentId, {}, body), status(400));
  for (const headers of [{ "content-length": "2" }, { "content-length": "bad" }, { "transfer-encoding": "chunked" }]) assert.throws(() => c.read({ ...r, headers }, questionId, documentId, {}), status(400));
  assert.throws(() => c.read({ ...r, url: "/ignored?__proto__[extra]=secret" }, questionId, documentId, {}), status(400));
  assert.throws(() => c.read(r, "invalid", documentId, {}), status(400)); assert.equal(calls.length, 1);
});
function response() { return { headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(body) { this.body = body; } }; }
test("early middleware and error filter protect successes, body/parser errors and guard refusals without leaking content", () => {
  const url = `/api/client/ai/knowledge/questions/${questionId}/citations/${documentId}?private=secret`;
  for (const method of ["GET", "OPTIONS"]) {
    const res = response(); let next = false;
    controller.knowledgeCitationPrivateMiddleware({ url, method, headers: {} }, res, error => { assert.equal(error, undefined); next = true; });
    assert.equal(next, true); assert.equal(res.headers["cache-control"], "private, no-store"); assert.equal(res.headers["x-content-type-options"], "nosniff");
  }
  let error; const r = response(); controller.knowledgeCitationPrivateMiddleware({ url, method: "GET", headers: { "content-length": "2" } }, r, e => { error = e; }); assert.equal(error.getStatus(), 400);
  controller.knowledgeCitationParserErrorMiddleware({ body: "private secret", status: 413 }, { url }, r, () => assert.fail());
  assert.equal(r.statusCode, 400); assert.equal(r.body.includes("secret"), false);
  const { HttpException } = require("@nestjs/common");
  for (const status of [400, 401, 403, 404, 409, 410, 503]) {
    const res = response(); new controller.KnowledgeCitationExceptionFilter().catch(new HttpException("private secret", status), { switchToHttp: () => ({ getResponse: () => res }) });
    assert.equal(res.statusCode, status); assert.equal(res.headers["cache-control"], "private, no-store"); assert.equal(res.headers["x-content-type-options"], "nosniff"); assert.equal(res.body.includes("private secret"), false);
    assert.equal(JSON.parse(res.body).success, false); assert.equal(JSON.parse(res.body).data, null);
    if (status === 409) assert.equal(JSON.parse(res.body).message, "SOURCE_CHANGED");
  }
  const unrelated = response(); let forwarded;
  controller.knowledgeCitationParserErrorMiddleware(error, { url: "/elsewhere" }, unrelated, e => { forwarded = e; }); assert.equal(forwarded, error); assert.deepEqual(unrelated.headers, {});
});

for (const [kind, { createKnowledgeCitationsClient }] of sdk) {
  test(kind + ": actual ClientApi sends one private GET with Cookie/Workspace header, signal, no body or retry", async () => {
    const old = globalThis.fetch, calls = [], abort = new AbortController(); let fail = false;
    globalThis.fetch = async (url, options) => { calls.push({ url, options }); if (fail) return new Response(null, { status: 409 }); return new Response(JSON.stringify({ success: true, message: "ok", data: projection() })); };
    try {
      const client = createKnowledgeCitationsClient(createClientApi(() => "https://unit.invalid/api"));
      assert.deepEqual(Object.keys(client), ["read"]); assert.deepEqual(await client.read(workspaceId, questionId, documentId, { signal: abort.signal }), projection());
      assert.equal(calls.length, 1); const { url, options } = calls[0];
      assert.equal(url, `https://unit.invalid/api/client/ai/knowledge/questions/${questionId}/citations/${documentId}`);
      assert.equal(options.method, "GET"); assert.equal(options.body, undefined); assert.equal(options.signal, abort.signal);
      assert.equal(options.credentials, "include"); assert.equal(options.cache, "no-store"); assert.equal(options.headers.get("x-aij-workspace-id"), workspaceId);
      fail = true; await assert.rejects(client.read(workspaceId, questionId, documentId), error => error instanceof ClientRequestFailure && error.status === 409); assert.equal(calls.length, 2);
    } finally { globalThis.fetch = old; }
  });
  test(kind + ": strict request ids/options reject before GET and aborted reads never start", async () => {
    let calls = 0; const client = createKnowledgeCitationsClient(async () => { calls++; return projection(); });
    for (const id of ["a".repeat(19), "a".repeat(33), "A".repeat(24), "x/y", "x?secret=1", "c".repeat(20) + "\ud800"]) await assert.rejects(client.read(workspaceId, id, documentId), TypeError);
    for (const w of ["", "a b", "../foreign", "__proto__"]) await assert.rejects(client.read(w, questionId, documentId), TypeError);
    for (const o of [null, [], { body: "private" }, { signal: {} }, { signal: undefined, headers: {} }]) await assert.rejects(client.read(workspaceId, questionId, documentId, o), TypeError);
    const getter = {}; Object.defineProperty(getter, "signal", { enumerable: true, get: () => assert.fail("getter invoked") }); await assert.rejects(client.read(workspaceId, questionId, documentId, getter), TypeError);
    const abort = new AbortController(); abort.abort(); await assert.rejects(client.read(workspaceId, questionId, documentId, { signal: abort.signal })); assert.equal(calls, 0);
  });
  test(kind + ": strict exact response, matching ids, valid UTF8 bytes/date and actual checksum", async () => {
    let value; const client = createKnowledgeCitationsClient(async () => value);
    const bad = [v => v.extra = "secret", v => delete v.checksum, v => v.sourceState = "HISTORICAL", v => v.documentId = questionId,
      v => v.questionId = documentId, v => v.content += "changed", v => v.checksum = "A".repeat(64), v => v.content = "\ud800", v => v.title = "\udfff",
      v => v.content = "中".repeat(21846), v => v.excerpt = "x".repeat(401), v => v.updatedAt = "2026-02-30T00:00:00.000Z", v => v.content = " "];
    for (const mutate of bad) { value = projection(); mutate(value); await assert.rejects(client.read(workspaceId, questionId, documentId), TypeError); }
    value = projection(); Object.defineProperty(value, "content", { enumerable: true, get: () => assert.fail("response getter invoked") }); await assert.rejects(client.read(workspaceId, questionId, documentId), TypeError);
    value = { ...projection(), content: "中".repeat(21845) + "a" }; value.checksum = hash(value.content); assert.equal(Buffer.byteLength((await client.read(workspaceId, questionId, documentId)).content), 65536);
    const abort = new AbortController(); const held = createKnowledgeCitationsClient(async () => { abort.abort(); return projection(); }); await assert.rejects(held.read(workspaceId, questionId, documentId, { signal: abort.signal }));
  });
}

// Compile the actual TSX file and load its real public SDK/React/AntD exports.
const webRequire = createRequire(resolve("apps/web/package.json"));
const UiFailure = webRequire("@aij/sdk").ClientRequestFailure;
const uiFile = resolve("apps/web/app/components/client-knowledge-citation.tsx");
const uiOutput = ts.transpileModule(readFileSync(uiFile, "utf8"), { fileName: uiFile, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } });
const ui = { exports: {} };
new Function("require", "module", "exports", uiOutput.outputText)(webRequire, ui, ui.exports);
function accessFixture({ source, context: changeContext, me: changeMe } = {}) {
  const calls = [], state = { memberId, roleId: "role-unit", roleCode: "reader", session: "a".repeat(64), permissions: ["workspace.knowledge.query", "workspace.context.read"] };
  const api = async (path, options) => {
    calls.push({ path, options });
    if (path === "/client/auth/me") return changeMe ? changeMe(state) : { id: state.memberId };
    if (path === "/client/workspaces/context") return changeContext ? changeContext(state) : { workspaceId, roleId: state.roleId, roleCode: state.roleCode, sessionGeneration: state.session, permissions: state.permissions };
    return source ? source(state) : projection();
  };
  return { calls, state, store: ui.exports.createKnowledgeCitationController(api, { workspaceId, questionId, documentId }) };
}
test("actual UI controller reads me/context before and after source; only explicit open reads source", async () => {
  const f = accessFixture(); assert.equal(f.calls.length, 0); await f.store.open(); assert.equal(f.store.getSnapshot().stage, "source");
  assert.deepEqual(f.calls.map(c => c.path), ["/client/auth/me", "/client/workspaces/context", `/client/ai/knowledge/questions/${questionId}/citations/${documentId}`, "/client/auth/me", "/client/workspaces/context"]);
  await f.store.revalidate(); assert.equal(f.calls.length, 7); await f.store.open(); assert.equal(f.calls.length, 7);
  const signal = f.calls[0].options.signal; f.store.clear(); assert.equal(signal.aborted, true); assert.equal(f.store.getSnapshot().source, null);
  await f.store.revalidate(); assert.equal(f.calls.length, 7);
});
test("actual UI fences after-read account/session/role/permission changes and never displays late source", async () => {
  for (const mutate of [s => s.memberId = "other", s => s.session = "b".repeat(64), s => s.roleId = "other", s => s.roleCode = "other", s => s.permissions = ["workspace.context.read"], s => s.permissions.push("workspace.knowledge.manage")]) {
    const f = accessFixture({ source: state => { mutate(state); return projection(); } }); await f.store.open();
    assert.equal(f.store.getSnapshot().stage, "error"); assert.equal(f.store.getSnapshot().source, null); assert.equal(f.calls.length, 5);
  }
  let release, started; const held = new Promise(resolve => { release = resolve; }), seen = new Promise(resolve => { started = resolve; });
  const f = accessFixture({ source: () => { started(); return held; } }); const read = f.store.open(); await seen;
  f.store.clear(); release(projection()); await read; assert.equal(f.store.getSnapshot().stage, "closed"); assert.equal(f.store.getSnapshot().source, null); assert.equal(f.calls.length, 3);
});
test("actual open-source revocation checks clear text, refuse missing current query permission and preserve safe status messages", async () => {
  for (const mutate of [s => s.memberId = "other", s => s.session = "b".repeat(64), s => s.roleId = "other", s => s.permissions = []]) {
    const f = accessFixture(); await f.store.open(); mutate(f.state); await f.store.revalidate(); assert.equal(f.store.getSnapshot().stage, "error"); assert.equal(f.store.getSnapshot().source, null);
  }
  const f = accessFixture(); f.state.permissions = []; await f.store.open(); assert.equal(f.calls.length, 2); assert.equal(f.store.getSnapshot().source, null);
  for (const code of [400, 401, 403, 404, 409, 410, 503]) {
    const f = accessFixture({ source: () => { throw new UiFailure(code); } }); await f.store.open();
    assert.equal(f.store.getSnapshot().stage, "error"); assert.equal(f.store.getSnapshot().source, null); assert.ok(f.store.getSnapshot().message);
    assert.equal(f.calls.length, 3); assert.equal(JSON.stringify(f.store.getSnapshot()).includes("Alpha response"), false);
    if (code === 409) assert.match(f.store.getSnapshot().message, /来源已变化/);
    if (code === 410) assert.match(f.store.getSnapshot().message, /七天保留期/);
  }
});
test("real React markup uses explicit trigger/current-state notice and escapes stored text without links or HTML execution", () => {
  const React = webRequire("react"), { renderToStaticMarkup } = webRequire("react-dom/server");
  const trigger = renderToStaticMarkup(React.createElement(ui.exports.ClientKnowledgeCitation, { request: async () => assert.fail("SSR must not read"), workspaceId, questionId, documentId }));
  assert.ok(trigger.includes("查看当前来源"));
  const source = { ...projection(), content: '<script>alert("private")</script><a href="https://external.invalid">text</a>', title: "<img src=x>" };
  const markup = renderToStaticMarkup(React.createElement(ui.exports.KnowledgeCitationDetails, { source }));
  assert.ok(markup.includes("不是历史原文快照")); assert.ok(markup.includes("&lt;script&gt;")); assert.ok(markup.includes("&lt;img src=x&gt;")); assert.equal(markup.includes("<script>"), false); assert.equal(markup.includes('<a href="https://external.invalid"'), false);
});
