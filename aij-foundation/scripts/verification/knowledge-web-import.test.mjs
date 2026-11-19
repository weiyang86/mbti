import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createRequire, registerHooks } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";

// No DB or API startup. Scratch client is generated from the exact additive proposal only.
const scratch = resolve(".artifacts/af179");
const apiRequire = createRequire(resolve("apps/api/package.json"));
mkdirSync(scratch, { recursive: true });
let schema = readFileSync("apps/api/prisma/schema.prisma", "utf8");
const fragment = readFileSync("docs/execution/AF-179-schema.prisma", "utf8").split("\n").filter(line => !line.startsWith("//")).join("\n");
if (!schema.includes('@map("source_final_url")')) schema = schema.replace("model AiKnowledgeDocument {", "model AiKnowledgeDocument {\n" + fragment);
schema = schema.replace('provider = "prisma-client-js"', 'provider = "prisma-client-js"\n  output = "./client"');
writeFileSync(scratch + "/schema.prisma", schema);
writeFileSync(scratch + "/prisma.config.mjs", `export default { schema: ${JSON.stringify(scratch + "/schema.prisma")} };\n`);
const generationEnvironment = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(PATH|HOME|TMPDIR|TMP|TEMP|SystemRoot|WINDIR|LANG|LC_ALL|TZ)$/i.test(key)));
Object.assign(generationEnvironment, { DATABASE_URL: "postgresql://af179_compile@127.0.0.1:1/af179_compile", CHECKPOINT_DISABLE: "1", PRISMA_HIDE_UPDATE_MESSAGE: "1" });
execFileSync(process.execPath, [apiRequire.resolve("prisma/build/index.js"), "generate", "--config", scratch + "/prisma.config.mjs"],
  { cwd: scratch, env: generationEnvironment, stdio: "pipe", timeout: 60000 });
registerHooks({ resolve(specifier, context, next) {
  return next(specifier === "@prisma/client" ? scratch + "/client/index.js" : specifier, context);
} });
apiRequire("ts-node").register({ transpileOnly: true, compilerOptions: {
  module: "commonjs", moduleResolution: "node", target: "ES2022", experimentalDecorators: true, emitDecoratorMetadata: true
} });
const source = path => apiRequire(resolve("apps/api/src/plugins/aij-ai", path));
const { AiKnowledgeService } = source("ai-knowledge.service.ts");
const { KnowledgeWebImportTransport, knowledgeWebTextChecksum, KNOWLEDGE_WEB_IMPORT_TRANSPORT } = source("knowledge-web-import.ts");
const { KnowledgeWebReader, knowledgeWebReader } = source("knowledge-web-reader.ts");
const { KnowledgeWebImportBodyPipe, KnowledgeWebEmptyPipe, knowledgeWebImportPrivateMiddleware,
  knowledgeWebImportParserErrorMiddleware, KnowledgeWebImportExceptionFilter } = source("ai-knowledge-web-import.dto.ts");
const { KnowledgeWebExtractorError } = source("knowledge-web-extractor.ts");
const { ForbiddenException, ValidationPipe } = apiRequire("@nestjs/common");
const { ClientAuthService } = apiRequire(resolve("apps/api/src/client-auth/client-auth.service.ts"));
const { KnowledgeWebImportModule } = source("knowledge-web-import.module.ts");
test("web transport override is rejected outside isolated test composition", () => {
  const transport = new KnowledgeWebImportTransport();
  for (const runtime of [{ nodeEnv: "production", environment: "production" }, { nodeEnv: "test", environment: "development" }, { nodeEnv: "development", environment: "test" }]) {
    assert.throws(() => KnowledgeWebImportModule.forRoot(runtime, transport));
    assert.doesNotThrow(() => KnowledgeWebImportModule.forRoot(runtime));
  }
  assert.equal(KnowledgeWebImportModule.forRoot({ nodeEnv: "test", environment: "test" }, transport).providers[0].useValue, transport);
});
const digest = value => createHash("sha256").update(value).digest("hex");
const member = "cmember00000000000000000", workspace = "cworkspace00000000000000";
const claims = { sub: member, sessionId: "csession0000000000000000", tokenVersion: 0 };
const url = "https://fixture.aij.tools/source?private=synthetic";
const dto = { documentCode: "web-guide", title: "Synthetic guide", url };
function fetched(text = "<article><table><tr><td></td><td>Aurora guide</td></tr></table></article>", finalUrl = url, contentType = "text/html") {
  const bytes = Buffer.from(text);
  return { state: "fetched", text, bytes, byteLength: bytes.length, checksum: digest(bytes), sourceUrl: finalUrl, contentType, redirectCount: 0 };
}

// Synthetic transaction double proves call ordering and values, never PostgreSQL locking behavior.
function fixture(read = async () => fetched()) {
  const state = { documents: [], audits: [], allowed: true, plugin: true, project: true, session: true, auditFail: false, inside: false, reads: 0, checks: 0 };
  const projectAccess = {
    projectId: async () => "synthetic-project",
    assertEnabled: async () => { if (!state.plugin) throw new ForbiddenException("Plugin unavailable"); },
    assertEnabledInTransaction: async () => { if (!state.plugin) throw new ForbiddenException("Plugin unavailable"); }
  };
  const context = { resolve: async () => { if (!state.allowed) throw new ForbiddenException(); },
    assertWritePermissionInTransaction: async () => { state.checks++; if (!state.allowed) throw new ForbiddenException(); } };
  const prisma = { $transaction: async fn => {
    assert.equal(state.inside, false); state.inside = true;
    const documents = structuredClone(state.documents), audits = structuredClone(state.audits);
    const select = (row, fields) => row && Object.fromEntries(Object.keys(fields).map(key => [key, row[key] ?? null]));
    const tx = {
      $queryRaw: async (sql, ...params) => {
        const text = sql.join("?");
        if (text.includes("client_auth_session")) return state.session ? [{ id: claims.sessionId }] : [];
        if (text.includes("project_profile")) return state.project ? [{ id: "synthetic-project" }] : [];
        if (text.includes("ai_knowledge_document")) return documents.filter(row => row.id === params[0] && row.workspaceId === params[1] && !row.deletedAt).map(row => ({ id: row.id }));
        throw new Error("Unexpected query");
      },
      aiKnowledgeDocument: {
        create: async ({ data, select: fields }) => {
          if (documents.some(row => row.workspaceId === data.workspaceId && row.documentCode === data.documentCode)) throw Object.assign(new Error("duplicate"), { code: "P2002" });
          const row = { id: "cdocument000000000000000" + documents.length, status: "active", createdAt: new Date(), updatedAt: new Date(), deletedAt: null, ...data };
          documents.push(row); return select(row, fields);
        },
        findFirst: async ({ where, select: fields }) => select(documents.find(row => row.id === where.id && row.workspaceId === where.workspaceId && !row.deletedAt), fields)
      },
      auditLog: { create: async ({ data }) => { if (state.auditFail) throw new Error("private database exception " + url); audits.push(data); return data; } }
    };
    try { const result = await fn(tx); state.documents = documents; state.audits = audits; return result; }
    finally { state.inside = false; }
  } };
  const transport = new KnowledgeWebImportTransport({ read: async value => {
    assert.equal(state.inside, false, "network must run outside all transactions"); state.reads++; return read(value, state);
  } });
  const auth = Object.assign(Object.create(ClientAuthService.prototype), { config: { getOrThrow: () => "synthetic-namespace" } });
  const service = new AiKnowledgeService(prisma, context, {}, {}, projectAccess, {}, transport, auth);
  return { state, service, create: (value = dto) => service.importWebDocument(member, workspace, value, "synthetic-correlation", claims) };
}

test("AF179 target source types use ONLY the scratch proposed-schema client", () => {
  const program = ts.createProgram([resolve("apps/api/src/plugins/aij-ai/ai-knowledge.controller.ts"), resolve("apps/api/src/plugins/aij-ai/knowledge-web-import.ts")], {
    module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.Node10, target: ts.ScriptTarget.ES2022,
    experimentalDecorators: true, emitDecoratorMetadata: true, esModuleInterop: true, resolveJsonModule: true,
    strict: true, skipLibCheck: true, types: ["node"], noEmit: true, rootDir: resolve("apps/api/src"),
    baseUrl: process.cwd(), paths: { "@prisma/client": [scratch + "/client"] }
  });
  const errors = ts.getPreEmitDiagnostics(program).filter(d => d.category === ts.DiagnosticCategory.Error);
  assert.equal(errors.length, 0, ts.formatDiagnosticsWithColorAndContext(errors, { getCurrentDirectory: () => process.cwd(), getCanonicalFileName: s => s, getNewLine: () => "\n" }));
});

test("AF179 strict DTO rejects unknown fields, arrays, empty/bounded inputs and query/body", () => {
  const pipe = new KnowledgeWebImportBodyPipe();
  assert.deepEqual(pipe.transform(dto), dto);
  for (const extra of ["workspaceId", "headers", "resolver", "connector", "ca", "provider", "credentials", "snapshot", "content", "status"]) {
    assert.throws(() => pipe.transform({ ...dto, [extra]: "private" }), /WEB_IMPORT_INVALID/);
  }
  for (const input of [null, [], {}, { ...dto, documentCode: "X" }, { ...dto, title: " " }, { ...dto, title: "x".repeat(161) }, { ...dto, title: "bad\nline" }, { ...dto, url: "x".repeat(2049) }]) assert.throws(() => pipe.transform(input));
  const empty = new KnowledgeWebEmptyPipe();
  assert.throws(() => empty.transform({ url })); assert.throws(() => empty.transform([url])); assert.deepEqual(empty.transform({}), {});
});

test("AF179 real global ValidationPipe retains unknown body keys for the Object-typed strict route pipe", async () => {
  const { AiKnowledgeController } = source("ai-knowledge.controller.ts");
  const types = Reflect.getMetadata("design:paramtypes", AiKnowledgeController.prototype, "importWebDocument");
  assert.equal(types[0], Object);
  const raw = { ...dto, headers: { authorization: "untrusted" } };
  const value = await new ValidationPipe({ whitelist: true, transform: true }).transform(raw, { type: "body", metatype: types[0] });
  assert.throws(() => new KnowledgeWebImportBodyPipe().transform(value), /WEB_IMPORT_INVALID/);
});

test("AF179 transport keeps canonical original URI separate from actual final URI and accepts exact 64KiB", async () => {
  const original = "https://FIXTURE.AIJ.TOOLS:443/a/../article?x=a%40b";
  const destination = "https://fixture.aij.tools/final?redirect=1";
  let called;
  const transport = new KnowledgeWebImportTransport({ read: async uri => { called = uri; return fetched("x".repeat(65536), destination, "text/plain"); } });
  const result = await transport.extract(original);
  assert.equal(called, "https://fixture.aij.tools/article?x=a%40b");
  assert.equal(result.source.sourceUrl, called); assert.equal(result.source.sourceFinalUrl, destination);
  assert.equal(Buffer.byteLength(result.content), 65536); assert.equal(result.source.sourceTextChecksum, digest(result.content));
});

test("AF179 default compiled production reader rejects invalid/private URI without replacement transport", async () => {
  const defaultTransport = new KnowledgeWebImportTransport();
  for (const value of ["http://fixture.aij.tools", "https://127.0.0.1/", "https://localhost/", "https://10.0.0.1/", "https://fixture.aij.tools/#secret", "https://user:pass@fixture.aij.tools/"]) {
    await assert.rejects(knowledgeWebReader.read(value), error => error.code === "URL_REJECTED" && !error.message.includes(value));
    await assert.rejects(defaultTransport.extract(value), error => error.message === "WEB_IMPORT_REJECTED");
  }
  let connected = false;
  const reader = new KnowledgeWebReader({ resolve: async () => [{ address: "127.0.0.1", family: 4 }], connect: () => { connected = true; throw new Error(); } });
  await assert.rejects(reader.read(url), error => error.code === "ADDRESS_REJECTED"); assert.equal(connected, false);
});

test("AF179 actual parser persists exact leading table TAB, raw/text hashes, complete source, inactive and ID-only audit", async () => {
  const f = fixture(); const document = await f.create(); const [row] = f.state.documents;
  assert.equal(document.status, "inactive"); assert.equal(row.content, "\tAurora guide");
  assert.equal(row.sourceTextChecksum, digest(row.content)); assert.equal(row.sourceChecksum, digest(fetched().bytes));
  assert.equal(row.sourceUrl, url); assert.equal(row.sourceFinalUrl, url); assert.equal(row.sourceExtractionVersion, "aij-knowledge-web-text/1");
  assert.equal(row.sourceFilename, "web-import"); assert.equal(f.state.audits.length, 1); assert.equal(f.state.checks, 2);
  assert.deepEqual(f.state.audits[0].afterData, { documentId: row.id, status: "inactive" });
  assert.equal(JSON.stringify(document).includes(url), false); assert.equal(JSON.stringify(f.state.audits).includes(url), false);
  assert.equal(JSON.stringify(f.state.audits).includes("Aurora guide"), false);
  assert.equal("bytes" in row || "html" in row || "text" in row, false);
  const metadata = await f.service.getWebSource(member, workspace, row.id, claims);
  assert.equal(metadata.contentMatchesSource, true); assert.equal(metadata.sourceUrl, url); assert.equal("content" in metadata, false);
  f.state.documents[0].content = "Explicit manual revision";
  assert.equal((await f.service.getWebSource(member, workspace, row.id, claims)).contentMatchesSource, false);
  assert.equal(f.state.documents[0].content, "Explicit manual revision");
  await assert.rejects(f.service.getWebSource(member, "foreign-workspace", row.id, claims));
  f.state.documents[0].deletedAt = new Date(); await assert.rejects(f.service.getWebSource(member, workspace, row.id, claims));
});

test("AF179 denied preflight never reads; revocation while network is held produces zero document/audit", async () => {
  for (const flag of ["allowed", "plugin", "project", "session"]) {
    const before = fixture(); before.state[flag] = false; await assert.rejects(before.create()); assert.equal(before.state.reads, 0);
    let release; const held = new Promise(resolve => { release = resolve; }); let seen;
    const started = new Promise(resolve => { seen = resolve; });
    const after = fixture(async () => { seen(); await held; return fetched(); });
    const pending = after.create(); await started; after.state[flag] = false; release(); await assert.rejects(pending);
    assert.equal(after.state.documents.length, 0); assert.equal(after.state.audits.length, 0);
  }
});

test("AF179 whole extracted oversize/parser/UTF8/checksum/transport failures refuse safely and write nothing", async () => {
  const cases = [async () => fetched("a".repeat(65537), url, "text/plain"), async () => fetched("<article> </article>"),
    async () => ({ ...fetched(), bytes: Buffer.from([255]) }), async () => ({ ...fetched(), checksum: "0".repeat(64) }),
    async () => { throw new Error("TLS failure contains " + url); }, async () => { throw new KnowledgeWebExtractorError("PARSE_FAILED"); }];
  for (const read of cases) {
    const f = fixture(read); await assert.rejects(f.create(), error => /^WEB_IMPORT_/.test(error.message) && !error.message.includes(url));
    assert.equal(f.state.documents.length, 0); assert.equal(f.state.audits.length, 0);
  }
});

test("AF179 duplicate conflict and audit error cannot leave another document or partial source", async () => {
  const f = fixture(); await f.create(); await assert.rejects(f.create(), error => error.getStatus() === 409);
  assert.equal(f.state.documents.length, 1); assert.equal(f.state.audits.length, 1); assert.equal(f.state.reads, 2);
  const failed = fixture(); failed.state.auditFail = true;
  await assert.rejects(failed.create(), error => error.getStatus() === 503 && !error.message.includes(url));
  assert.equal(failed.state.documents.length, 0); assert.equal(failed.state.audits.length, 0);
});

test("AF179 legacy manual/file/CSV content, active default and raw checksum behavior remain", async () => {
  const f = fixture();
  await f.service.createDocument(member, workspace, { documentCode: "manual", title: " Manual ", content: "  Manual guide  " });
  assert.equal(f.state.documents[0].content, "Manual guide"); assert.equal(f.state.documents[0].status, "active");
  const bytes = Buffer.from("  File guide  ");
  await f.service.importDocument(member, workspace, { documentCode: "file", title: "File" }, { originalname: "file.txt", mimetype: "text/plain", buffer: bytes, size: bytes.length });
  assert.equal(f.state.documents[1].content, "File guide"); assert.equal(f.state.documents[1].sourceChecksum, digest(bytes));
  const csv = Buffer.from('name,guide\nAurora,"Read, review"');
  await f.service.importDocument(member, workspace, { documentCode: "csv", title: "CSV" }, { originalname: "file.csv", mimetype: "text/csv", buffer: csv, size: csv.length });
  assert.equal(f.state.documents[2].status, "active"); assert.equal(f.state.documents[2].sourceChecksum, digest(csv));
  assert.ok(f.state.documents[2].content.includes("Read, review")); assert.equal("sourceUrl" in f.state.documents[2], false);
});

test("AF179 middleware and exception filter set private no-store and redact parser/guard errors", () => {
  const response = () => ({ headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(value) { this.body = value; } });
  for (const path of ["/api/client/ai/knowledge/documents/import-web?secret=x", "/api/client/ai/knowledge/documents/import-web/", "/API/client/AI/knowledge/documents/import-web", "/api/client/ai/knowledge/documents/cdocument000000000000000/web-source"]) {
    const res = response(); let next = false;
    knowledgeWebImportPrivateMiddleware({ url: path }, res, () => { next = true; });
    assert.equal(next, true); assert.equal(res.headers["Cache-Control"], "private, no-store");
    knowledgeWebImportParserErrorMiddleware({ status: 413, body: url }, { url: path }, res, () => assert.fail());
    assert.equal(res.statusCode, 413); assert.equal(res.body.includes(url), false);
    new KnowledgeWebImportExceptionFilter().catch(new Error(url), { switchToHttp: () => ({ getResponse: () => res }) });
    assert.equal(res.statusCode, 503); assert.equal(res.body.includes(url), false);
  }
});

test("AF179 compiled SDK ESM/CJS/types use actual ClientApi Workspace header, strict body and one request", async () => {
  const directory = scratch + "/sdk"; mkdirSync(directory, { recursive: true }); writeFileSync(directory + "/package.json", '{"type":"module"}');
  const file = resolve("packages/sdk/src/knowledge-web-imports.ts");
  const program = ts.createProgram([file], { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext,
    strict: true, skipLibCheck: true, declaration: true, types: [], lib: ["lib.es2022.d.ts", "lib.dom.d.ts"], rootDir: resolve("packages/sdk/src"), outDir: directory });
  const errors = ts.getPreEmitDiagnostics(program).filter(d => d.category === ts.DiagnosticCategory.Error);
  assert.equal(errors.length, 0, ts.formatDiagnosticsWithColorAndContext(errors, { getCurrentDirectory: () => process.cwd(), getCanonicalFileName: s => s, getNewLine: () => "\n" }));
  assert.equal(program.emit().emitSkipped, false);
  writeFileSync(directory + "/knowledge-web-imports.cjs", ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText);
  const esm = await import(pathToFileURL(directory + "/knowledge-web-imports.js").href);
  const cjs = createRequire(import.meta.url)(directory + "/knowledge-web-imports.cjs");
  const { createClientApi } = await import("../../packages/sdk/dist/index.mjs");
  for (const factory of [esm.createKnowledgeWebImportsClient, cjs.createKnowledgeWebImportsClient]) {
    const original = globalThis.fetch; const calls = [];
    globalThis.fetch = async (path, options) => { calls.push({ path, options }); return new Response(JSON.stringify({ success: true, message: "ok", data: { id: "synthetic" } }), { headers: { "content-type": "application/json" } }); };
    try {
      const client = factory(createClientApi(() => "https://api.fixture.aij.tools"));
      await client.importWeb(workspace, dto); assert.equal(calls.length, 1);
      assert.equal(calls[0].options.headers.get("x-aij-workspace-id"), workspace); assert.deepEqual(JSON.parse(calls[0].options.body), dto);
      assert.equal(calls[0].options.credentials, "include"); assert.equal(calls[0].options.cache, "no-store");
      assert.throws(() => client.importWeb(workspace, { ...dto, headers: {} })); assert.equal(calls.length, 1);
      await client.getWebSource(workspace, "cdocument000000000000000"); assert.equal(calls.length, 2); assert.ok(calls[1].path.endsWith("/web-source"));
      globalThis.fetch = async () => { calls.push({}); return new Response("", { status: 503 }); };
      await assert.rejects(client.importWeb(workspace, dto)); assert.equal(calls.length, 3, "failed import never retries implicitly");
      globalThis.fetch = async (path, options) => { calls.push({ path, options }); return new Response(JSON.stringify({ success: true, message: "ok", data: {} }), { headers: { "content-type": "application/json" } }); };
      const migratedWorkspace = "3dc09638-bf36-4de6-bc4b-88482f6d3c5e";
      await client.getWebSource(migratedWorkspace, "cdocument000000000000000");
      assert.equal(calls[3].options.headers.get("x-aij-workspace-id"), migratedWorkspace, "Preserve the shared Workspace identifier contract");
      for (const id of ["../foreign", "a b", "__proto__", "x".repeat(129)]) assert.throws(() => client.importWeb(id, dto));
      assert.equal(calls.length, 4);
    } finally { globalThis.fetch = original; }
  }
  assert.match(readFileSync(directory + "/knowledge-web-imports.d.ts", "utf8"), /contentMatchesSource/);
  assert.equal(typeof KNOWLEDGE_WEB_IMPORT_TRANSPORT, "symbol"); assert.equal(knowledgeWebTextChecksum("\tAurora guide"), digest("\tAurora guide"));
});
