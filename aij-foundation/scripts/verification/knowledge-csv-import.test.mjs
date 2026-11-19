import { loadKnowledgeWebImports } from "./knowledge-legacy-source-imports.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { loadSource, nest } from "./optimization-delta/source-loader.mjs";

// Executes actual TypeScript source; storage is synthetic, not HTTP/PostgreSQL evidence.
const parser = loadSource("apps/api/src/plugins/aij-ai/knowledge-csv-parser.ts");
const { parseKnowledgeCsv: parse, KnowledgeCsvError } = parser;
const permissions = loadSource("apps/api/src/client-workspaces/client-workspace-permissions.ts").CLIENT_WORKSPACE_PERMISSION;
const prismaModule = { Prisma: { TransactionIsolationLevel: { ReadCommitted: "ReadCommitted", RepeatableRead: "RepeatableRead" } } };
const { WorkspaceContextService } = loadSource("apps/api/src/client-workspaces/workspace-context.service.ts", { "@nestjs/common": nest });
const { PluginRuntimeAccessService } = loadSource("apps/api/src/plugin-runtime/plugin-runtime-access.service.ts", { "@nestjs/common": nest, "@prisma/client": prismaModule });
const { AiKnowledgeService } = loadSource("apps/api/src/plugins/aij-ai/ai-knowledge.service.ts", {
    ...loadKnowledgeWebImports(),
  "@nestjs/common": nest, "@prisma/client": prismaModule, "node:crypto": { createHash },
  "../../client-workspaces/client-workspace-permissions": { CLIENT_WORKSPACE_PERMISSION: permissions },
  "./ai-knowledge-retrieval": loadSource("apps/api/src/plugins/aij-ai/ai-knowledge-retrieval.ts"),
  "./ai-provider": { AI_PLUGIN_CODE: "aij-ai" }, "./knowledge-csv-parser": parser
}, { TextDecoder });
const MEMBER = "af146-member", WORKSPACE = "af146-workspace", PROJECT = "af146-project";
const csv = '\uFEFF name ,note,formula\r\nAurora,"comma, quote ""ok""\r\nnext",=SUM(A1:A2)\r\n';
const expected = 'Row 1\nname: Aurora\nnote: comma, quote "ok"\n  next\nformula: =SUM(A1:A2)';
const file = (content = csv, originalname = "guide.csv", mimetype = "text/csv") => {
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content);
  return { buffer, size: buffer.length, originalname, mimetype };
};
function fixture({ beforeWrite = () => {}, auditFailure = false } = {}) {
  const state = { entry: true, enabled: true, authorized: true };
  const events = []; let stored = { documents: [], audits: [] }, writeTransactions = 0;
  const prisma = {
    readiness: async () => ({ ready: true }),
    clientWorkspaceMembership: { findFirst: async ({ where }) => state.entry && where.memberId === MEMBER && where.workspaceId === WORKSPACE ? {
      workspace: { id: WORKSPACE, code: "af146", name: "Synthetic" },
      role: { id: "af146-role", code: "OWNER", rolePermissions: [{ permission: { code: permissions.knowledgeManage } }] }
    } : null },
    $transaction: async (operation, options) => {
      const write = options.isolationLevel === "ReadCommitted";
      if (write) { writeTransactions++; events.push("write-start"); beforeWrite(state); }
      const staged = structuredClone(stored);
      const tx = {
        projectProfile: { findFirst: async () => { events.push("project"); return { id: PROJECT }; } },
        pluginInstallation: { findUnique: async () => { events.push("plugin-read"); return { status: state.enabled ? "enabled" : "disabled" }; } },
        $executeRaw: async (_sql, key) => { events.push(key); return 1; },
        $queryRaw: async (sql, member, workspace, permission) => {
          assert.equal(member, MEMBER); assert.equal(workspace, WORKSPACE); assert.equal(permission, permissions.knowledgeManage);
          assert.match(sql.join("?"), /FOR SHARE OF u, w, m, r, g, p/);
          events.push("membership-share"); return state.authorized ? [{ id: "membership" }] : [];
        },
        aiKnowledgeDocument: { create: async ({ data }) => {
          events.push("document"); const document = { id: "af146-document", status: "active", ...data };
          staged.documents.push(document); return document;
        } },
        auditLog: { create: async ({ data }) => { events.push("audit"); if (auditFailure) throw new Error("synthetic storage failure"); staged.audits.push(data); } }
      };
      const result = await operation(tx); stored = staged; return result;
    }
  };
  const workspace = new WorkspaceContextService(prisma);
  const access = new PluginRuntimeAccessService(prisma, { getOrThrow: key => key === "projectId" ? "af146" : "test" });
  const forbiddenCall = () => { throw new Error("Unexpected job or provider call"); };
  const service = new AiKnowledgeService(prisma, workspace, { enqueueInTransaction: forbiddenCall }, {}, access, { execute: forbiddenCall });
  return { state, events, stored: () => stored, writes: () => writeTransactions,
    run: input => service.importDocument(MEMBER, WORKSPACE, { documentCode: "af146-import", title: "Synthetic CSV" }, input, "af146-correlation") };
}

test("CSV BOM/CRLF/quoted commas/doubled quotes/newlines produce stable header/value text", () => {
  assert.equal(parse(csv), expected); assert.equal(parse(csv), parse(csv));
  assert.equal(parse('name,note\nAurora,"line\nnext"'), "Row 1\nname: Aurora\nnote: line\n  next");
});
test("CSV formula prefixes remain inert text, including quoted =,+,-,@ values", () => {
  assert.equal(parse('a,b,c,d\n"=1+1",+cmd,-1,@ref'), "Row 1\na: =1+1\nb: +cmd\nc: -1\nd: @ref");
});
test("CSV permits empty individual cells and CRLF final newline without a phantom row", () => {
  assert.equal(parse('a,b,c\r\nx,,\r\n'), "Row 1\na: x\nb: \nc: ");
});
test("CSV Unicode counts code points rather than UTF-16 units", () => {
  assert.ok(parse('😀'.repeat(100) + '\n' + '😀'.repeat(2000)).includes('😀'.repeat(2000)));
  assert.throws(() => parse('a\n' + '😀'.repeat(2001)), KnowledgeCsvError);
});
test("CSV accepts the exact row, column and cell bounds", () => {
  const headers = Array.from({ length: 32 }, (_, i) => `h${i}`).join(',');
  const content = parse(headers + '\n' + Array.from({ length: 200 }, () => Array(32).fill('x').join(',')).join('\n'));
  assert.match(content, /Row 200/);
  assert.ok(parse('h'.repeat(100) + '\n' + 'x'.repeat(2000)).endsWith('x'.repeat(2000)));
});
test("generated text accepts exactly 50000 Unicode characters and rejects 50001", () => {
  const make = last => 'h'.repeat(100) + '\n' + Array.from({ length: 25 }, (_, i) => 'x'.repeat(i < 24 ? 1888 : last)).join('\n');
  // Row markers, separators and repeated headers are included in the output cap.
  const base = parse(make(1)); const last = 50000 - [...base].length + 1;
  assert.ok(last > 0 && last <= 2000);
  assert.equal([...parse(make(last))].length, 50000);
  assert.throws(() => parse(make(last + 1)), KnowledgeCsvError);
});
const invalidCsv = [
  ['empty', ''], ['whitespace', '  '], ['BOM only', '\uFEFF'], ['header only', 'name,note\n'],
  ['empty header', ',note\nx,y'], ['trimmed duplicate header', ' a ,a\nx,y'],
  ['too many fields', 'a\nx,y'], ['too few fields', 'a,b\nx'], ['empty data row', 'a,b\n,'],
  ['extra blank row', 'a\nx\n\n'], ['unclosed quote', 'a\n"x'], ['bare quote', 'a\nx"y'],
  ['text after quote', 'a\n"x"y'], ['space after quote', 'a\n"x" '], ['bare CR', 'a\rx'],
  ['NUL', 'a\nx\0'], ['C0 tab', 'a\nx\t'], ['C1 control', 'a\nx\u0085'], ['DEL', 'a\nx\u007f'],
  ['unpaired surrogate', 'a\nx\ud800'], ['201 rows', 'a\n' + Array(201).fill('x').join('\n')],
  ['33 columns', Array.from({ length: 33 }, (_, i) => `h${i}`).join(',') + '\n' + Array(33).fill('x').join(',')],
  ['101 header characters', 'h'.repeat(101) + '\nx'], ['2001 cell characters', 'a\n' + 'x'.repeat(2001)],
  ['over 50KiB', 'a\n' + 'x'.repeat(51200)]
];
for (const [name, input] of invalidCsv) test(`CSV rejects ${name}`, () => assert.throws(() => parse(input), KnowledgeCsvError));

test("actual import stores transformed CSV, sanitized display leaf and original byte checksum through createDocument", async () => {
  const f = fixture(); const input = file(csv, 'C:\\unsafe\\folder\\guide\u0000.csv');
  await f.run(input);
  const row = f.stored().documents[0]; assert.equal(row.content, expected); assert.equal(row.sourceFilename, "guide.csv");
  assert.equal(row.sourceChecksum, createHash('sha256').update(input.buffer).digest('hex'));
  assert.notEqual(row.sourceChecksum, createHash('sha256').update(expected).digest('hex'));
  assert.equal(row.workspaceId, WORKSPACE); assert.equal(row.createdByMemberId, MEMBER);
  assert.equal(f.stored().audits.length, 1); assert.equal(f.stored().audits[0].action, "ai_knowledge_document_imported");
  assert.equal(JSON.stringify(f.stored().audits).includes("Aurora"), false);
  assert.deepEqual(f.events.slice(f.events.indexOf("write-start")), ["write-start", "project", `plugin-lifecycle:${PROJECT}:aij-ai`, "plugin-read", `aij-client-workspace-membership:${WORKSPACE}`, "membership-share", "document", "audit"]);
});
for (const mime of ['text/csv', 'application/octet-stream', '']) test(`actual CSV import accepts safe MIME ${mime || '(empty)'}`, async () => {
  const f = fixture(); await f.run(file('a\nx', 'guide.CSV', mime)); assert.equal(f.stored().documents.length, 1);
});
for (const extension of ['txt', 'md']) for (const mime of ['text/plain', 'text/markdown', 'application/octet-stream', '']) {
  test(`actual ${extension}/${mime || '(empty)'} retains UTF-8 text import behavior`, async () => {
    const f = fixture(); await f.run(file('\uFEFF  plain\ttext\r\n=1  ', `guide.${extension}`, mime));
    assert.equal(f.stored().documents[0].content, 'plain\ttext\r\n=1');
  });
}
test("actual text import retains the exact 50KiB byte boundary", async () => {
  const f = fixture(); await f.run(file('x'.repeat(51200), 'edge.txt', 'text/plain'));
  assert.equal(f.stored().documents[0].content.length, 51200);
});
const invalidImports = [
  ['missing file', undefined], ['missing buffer', { ...file(), buffer: 'text' }], ['size mismatch', { ...file(), size: 2 }],
  ['empty file', file('')], ['oversize bytes', file('x'.repeat(51201))], ['invalid UTF-8', file(Buffer.from([0xc3, 0x28]))],
  ['UTF-8 encoded surrogate', file(Buffer.from([0xed, 0xa0, 0x80]))], ['UTF-16', file(Buffer.from([0xff, 0xfe, 0x61, 0]))], ['binary controls', file('a\nx\0')],
  ['wrong extension', file('a\nx', 'x.xlsx')], ['long display leaf', file('a\nx', 'x'.repeat(160) + '.csv')],
  ['CSV plain MIME', file('a\nx', 'x.csv', 'text/plain')], ['CSV Excel MIME', file('a\nx', 'x.csv', 'application/vnd.ms-excel')],
  ['text CSV MIME', file('plain', 'x.txt', 'text/csv')], ['text invalid UTF-8', file(Buffer.from([0xff]), 'x.md', 'text/markdown')],
  ['text empty', file('  \n', 'x.txt', 'text/plain')], ['text binary', file('x\0', 'x.md', 'text/markdown')],
  ...invalidCsv.filter(([name]) => name !== 'unpaired surrogate').map(([name, text]) => [`CSV ${name}`, file(text)]),
  ['generated content exceeds 50000 characters', file('h'.repeat(100) + '\n' + Array(25).fill('x'.repeat(1900)).join('\n'))],
  ['generated UTF-8 exceeds existing 64KiB document fence', file('中'.repeat(100) + '\n' + Array(199).fill('文'.repeat(40)).join('\n'))]
];
for (const [name, input] of invalidImports) test(`actual service rejects ${name} before any write`, async () => {
  const f = fixture(); await assert.rejects(f.run(input), nest.BadRequestException);
  assert.equal(f.writes(), 0); assert.deepEqual(f.stored(), { documents: [], audits: [] });
});
test("actual membership rejects before parsing attacker input", async () => {
  const f = fixture(); f.state.entry = false; await assert.rejects(f.run(undefined), nest.ForbiddenException);
  assert.equal(f.writes(), 0);
});
for (const [name, mutate, ErrorType] of [
  ['plugin disabled after entry', s => { s.enabled = false; }, nest.NotFoundException],
  ['membership/grant revoked after entry', s => { s.authorized = false; }, nest.ForbiddenException]
]) test(`actual CSV create transaction fences ${name}`, async () => {
  const f = fixture({ beforeWrite: mutate }); await assert.rejects(f.run(file()), ErrorType);
  assert.equal(f.writes(), 1); assert.deepEqual(f.stored(), { documents: [], audits: [] });
  assert.equal(f.events.includes('document'), false);
});
test("actual service keeps document and import audit atomic on audit failure (synthetic transaction)", async () => {
  const f = fixture({ auditFailure: true }); await assert.rejects(f.run(file()), nest.ServiceUnavailableException);
  assert.deepEqual(f.stored(), { documents: [], audits: [] });
});
test("UI chooser and help cover CSV and fixed limits without new routes", () => {
  const source = readFileSync(new URL('../../apps/web/app/components/client-knowledge-manager.tsx', import.meta.url), 'utf8');
  for (const token of ['.txt,.md,.csv', 'text/csv', '50KiB', '200 条', '32 列', '2000 字符', '100 字符', '50000 字符', '公式仅作为文本']) assert.ok(source.includes(token), token);
});
