import "reflect-metadata";
import * as assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { IncomingMessage } from "node:http";
import { Socket } from "node:net";
import { parse as parseQuery } from "node:querystring";
import { test } from "node:test";
import { BadRequestException, ConflictException, ForbiddenException, HttpException, NotFoundException, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { GUARDS_METADATA, HEADERS_METADATA, METHOD_METADATA, PATH_METADATA, SELF_DECLARED_DEPS_METADATA } from "@nestjs/common/constants";
import { RequestMethod } from "@nestjs/common/enums";
import type { ClientRequest } from "../src/client-auth/client-auth.security";
import { CLIENT_WORKSPACE_PERMISSIONS_KEY } from "../src/client-workspaces/client-workspace-permission.decorator";
import { WorkspaceContextGuard } from "../src/client-workspaces/workspace-context.guard";
import { PersonalDocumentNoStoreGuard } from "../src/documents/personal-documents.controller";
import { PersonalDocumentsService, DOCUMENT_PERMISSION } from "../src/documents/personal-documents.service";
import { buildPersonalDocumentSectionIndex, type PersonalDocumentSectionIndex } from "../src/documents/personal-document-sections";
import { PersonalDocumentSectionsService } from "../src/documents/personal-document-sections.service";
import { PersonalDocumentSectionsController } from "../src/documents/personal-document-sections.controller";

const id = "6140daed-c14e-491d-a81b-c0e400085cb3";
const source = (body: string, revision = 3) => ({ id, revision, body });
const build = (body: string) => buildPersonalDocumentSectionIndex(source(body));

function assertCoverage(body: string, result: PersonalDocumentSectionIndex): void {
  assert.deepEqual(Object.keys(result), ["format", "documentId", "revision", "bodySha256", "bodyLength", "bodyByteLength", "sections"]);
  assert.equal(result.format, "aij-plain-sections-v1");
  assert.equal(result.documentId, id);
  assert.equal(result.bodySha256, createHash("sha256").update(body, "utf8").digest("hex"));
  assert.match(result.bodySha256, /^[0-9a-f]{64}$/);
  assert.equal(result.bodyLength, body.length);
  assert.equal(result.bodyByteLength, Buffer.byteLength(body, "utf8"));
  assert.ok(result.sections.length >= 1 && result.sections.length <= 128);
  let cursor = 0;
  for (const [index, section] of result.sections.entries()) {
    assert.deepEqual(Object.keys(section), ["id", "index", "title", "level", "start", "end"]);
    assert.equal(section.id, `section-${index}`);
    assert.equal(section.index, index);
    assert.equal(section.start, cursor);
    assert.ok(Number.isInteger(section.end) && section.end >= section.start && section.end <= body.length);
    // A boundary must never split an emoji's surrogate pair or a CRLF pair.
    if (section.end > 0 && section.end < body.length) {
      assert.ok(!(/[\uD800-\uDBFF]/.test(body[section.end - 1]) && /[\uDC00-\uDFFF]/.test(body[section.end])));
      assert.notEqual(body.slice(section.end - 1, section.end + 1), "\r\n");
    }
    cursor = section.end;
  }
  assert.equal(cursor, body.length);
  assert.equal(result.sections.map(s => body.slice(s.start, s.end)).join(""), body);
}

test("empty and heading-free bodies are one exact level-zero block", () => {
  for (const body of ["", "plain 😀 text", "\r\n\n\r", "  # indented\n> # quoted\n####### seven\n#missing-space", "\uFEFF# BOM remains\nno heading", "<h1>HTML remains text</h1>"]) {
    const result = build(body);
    assert.deepEqual(result.sections, [{ id: "section-0", index: 0, title: "正文", level: 0, start: 0, end: body.length }]);
    assertCoverage(body, result);
  }
  assert.equal(build("").bodySha256, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
});

test("UTF16 offsets and UTF8 sizes are exact for LF, CRLF, lone CR and mixed endings", () => {
  for (const eol of ["\n", "\r\n", "\r"]) {
    const prelude = `😀前言${eol}`, first = `# 一 😀${eol}e\u0301${eol}`, last = `##\t 二\t ${eol}尾😀`;
    const body = prelude + first + last, result = build(body);
    assert.deepEqual(result.sections, [
      { id: "section-0", index: 0, title: "正文", level: 0, start: 0, end: prelude.length },
      { id: "section-1", index: 1, title: "一 😀", level: 1, start: prelude.length, end: prelude.length + first.length },
      { id: "section-2", index: 2, title: "二", level: 2, start: prelude.length + first.length, end: body.length }
    ]);
    assertCoverage(body, result);
  }
  const mixed = "# A\r\n😀\r## B\n结尾\r";
  assert.deepEqual(build(mixed).sections.map(s => [s.start, s.end]), [[0, 8], [8, mixed.length]]);
  assertCoverage(mixed, build(mixed));
});

test("headings start their own blocks without an artificial leading or trailing block", () => {
  const body = "# A\n## B\n### C\r\n#### D\r##### E\n######\tF\n";
  const result = build(body);
  assert.deepEqual(result.sections.map(s => [s.title, s.level]), [["A", 1], ["B", 2], ["C", 3], ["D", 4], ["E", 5], ["F", 6]]);
  assert.equal(result.sections[0].start, 0);
  assertCoverage(body, result);
});

test("only horizontal title whitespace is trimmed; BOM, hashes and Unicode stay literal", () => {
  const body = "# \t A ###\t \r\n## \u00A0\uFEFFe\u0301\u2028\u2029\u00A0\n";
  const result = build(body);
  assert.deepEqual(result.sections.map(s => s.title), ["A ###", "\u00A0\uFEFFe\u0301\u2028\u2029\u00A0"]);
  assertCoverage(body, result);
  assert.notEqual(build("# é\n").bodySha256, build("# e\u0301\n").bodySha256);
  assert.notEqual(build("# A\n").bodySha256, build("# A\r\n").bodySha256);
  assert.equal(build("# A \u2028").sections[0].title, "A \u2028");
});

test("backtick and tilde fences suppress headings until a matching long-enough column-zero close", () => {
  for (const marker of ["`", "~"]) {
    const other = marker === "`" ? "~" : "`";
    const lines = ["# Before", `${marker.repeat(4)}language`, "# hidden", marker.repeat(3), "## still hidden", other.repeat(5), "### hidden too", ` ${marker.repeat(4)}`, "#### hidden", `${marker.repeat(4)} suffix`, "##### hidden", `${marker.repeat(5)}\t `, "## After"];
    for (const eol of ["\n", "\r\n", "\r"]) {
      const body = lines.join(eol), result = build(body);
      assert.deepEqual(result.sections.map(s => s.title), ["Before", "After"]);
      assert.equal(result.sections[1].start, body.indexOf("## After"));
      assertCoverage(body, result);
    }
  }
});

test("unclosed fences consume the rest; indented fences do not open", () => {
  for (const body of ["```\n# hidden\n~~~~\n## hidden", "~~~~text\r# hidden\r~~~\r## hidden"]) {
    assert.deepEqual(build(body).sections.map(s => [s.title, s.level]), [["正文", 0]]);
    assertCoverage(body, build(body));
  }
  const body = "  ```\n# visible\n> ~~~\n## visible too\n``\n### visible three";
  assert.deepEqual(build(body).sections.map(s => s.title), ["正文", "visible", "visible too", "visible three"]);
  assertCoverage(body, build(body));
  const unicodeSuffix = "```\n# hidden\n```\u2028\n## still hidden\n```\n# visible";
  assert.deepEqual(build(unicodeSuffix).sections.map(s => s.title), ["正文", "visible"]);
});

test("the complete 128-block limit includes a prelude; 129 blocks refuse without truncation", () => {
  const headings = (count: number) => Array.from({ length: count }, (_, i) => `# Heading ${i}\n`).join("");
  for (const body of [headings(128), "prelude\n" + headings(127)]) {
    const frozen = Object.freeze(source(body));
    const result = buildPersonalDocumentSectionIndex(frozen);
    assert.equal(result.sections.length, 128);
    assert.equal(result.sections.at(-1)!.id, "section-127");
    assertCoverage(body, result);
    assert.equal(frozen.body, body);
  }
  for (const body of [headings(129), "prelude\n" + headings(128)]) {
    const frozen = Object.freeze(source(body));
    assert.throws(() => buildPersonalDocumentSectionIndex(frozen), BadRequestException);
    assert.equal(frozen.body, body);
  }
});

test("title limits count Unicode codepoints, refuse empty and 257, and never shorten 256", () => {
  for (const title of ["a".repeat(256), "😀".repeat(256), "e\u0301".repeat(128)]) {
    const body = `# \t${title}\t \n`, result = build(body);
    assert.equal(result.sections[0].title, title);
    assertCoverage(body, result);
  }
  for (const title of ["", "\t ", "a".repeat(257), "😀".repeat(257), "e\u0301".repeat(129)]) {
    assert.throws(() => build(`# ${title}\n`), BadRequestException);
  }
  assert.equal(build("```\n# " + "😀".repeat(257)).sections[0].title, "正文");
});

test("body byte and Unicode constraints inherit the document owner without normalization", () => {
  for (const body of ["a".repeat(65536), "😀".repeat(16384)]) assertCoverage(body, build(body));
  for (const body of ["a".repeat(65537), "😀".repeat(16384) + "a", "\uD800", "\uDC00", "bad\0", "bad\u0085"]) {
    assert.throws(() => build(body), BadRequestException);
  }
});

test("parser validates primitive types and complete data-only source shape without reading getters", () => {
  for (const raw of [null, undefined, [], "body", 1, new String("body"), {}, { ...source("x"), extra: true }, { ...source("x"), body: 1 }, { ...source("x"), body: new String("x") }, { ...source("x"), id: "invalid" }, { ...source("x"), revision: "3" }, { ...source("x"), revision: 0 }, { ...source("x"), revision: 201 }, { ...source("x"), revision: NaN }, { ...source("x"), revision: 1.2 }]) {
    assert.throws(() => buildPersonalDocumentSectionIndex(raw), BadRequestException);
  }
  let reads = 0;
  for (const key of ["id", "revision", "body"]) {
    const raw = Object.defineProperty(source("x"), key, { enumerable: true, get() { reads++; throw Error("must not read"); } });
    assert.throws(() => buildPersonalDocumentSectionIndex(raw), BadRequestException);
  }
  const inherited = Object.create({ get body() { reads++; throw Error("must not read"); } });
  Object.assign(inherited, { id, revision: 3 });
  assert.throws(() => buildPersonalDocumentSectionIndex(inherited), BadRequestException);
  assert.equal(reads, 0);
  for (const raw of [Object.assign(Object.create({}), source("x")), Object.defineProperty(source("x"), "body", { enumerable: false }), { ...source("x"), [Symbol("extra")]: 1 }]) {
    assert.throws(() => buildPersonalDocumentSectionIndex(raw), BadRequestException);
  }
  const nullPrototype = Object.assign(Object.create(null), source("# valid"));
  assertCoverage(nullPrototype.body, buildPersonalDocumentSectionIndex(nullPrototype));
  for (const revision of [1, 200]) assert.equal(buildPersonalDocumentSectionIndex(source("", revision)).revision, revision);
});

test("repeated parsing is deterministic and never mutates source or shares result objects", () => {
  const input = Object.freeze(source("prelude\r\n# 😀\nbody\r## two"));
  const before = JSON.stringify(input), a = buildPersonalDocumentSectionIndex(input), b = buildPersonalDocumentSectionIndex(input);
  assert.deepEqual(a, b);
  a.sections[0].end = 1234;
  assert.notDeepEqual(a, b);
  assert.equal(JSON.stringify(input), before);
  assertCoverage(input.body, b);
});

// This collaborator is checked against the real owner's get signature; no DB or auth is faked as live evidence.
const document = Object.freeze({ ...source("intro\r\n# First 😀\nbody"), code: "document-one", name: "Document", createdAt: "2026-11-08T00:00:00.000Z", updatedAt: "2026-11-08T00:00:00.000Z" });
type DocumentReadPort = Pick<PersonalDocumentsService, "get">;

test("service delegates exactly one current-document read with scope and projects only index fields", async () => {
  const calls: string[][] = [];
  const port: DocumentReadPort = { async get(member, workspace, requestedId) { calls.push([member, workspace, requestedId]); return document; } };
  const before = JSON.stringify(document);
  const result = await new PersonalDocumentSectionsService(port).get("member", "workspace", id, Object.freeze({ expectedRevision: "3" }));
  assert.deepEqual(calls, [["member", "workspace", id]]);
  assert.deepEqual(result, build(document.body));
  assert.equal(JSON.stringify(document), before);
  assert.ok(!("body" in result) && !("code" in result) && !("name" in result));
});

test("service compares the exact current revision and never reads history or returns a stale index", async () => {
  let calls = 0;
  const port: DocumentReadPort = { async get() { calls++; return document; } };
  const service = new PersonalDocumentSectionsService(port);
  for (const expectedRevision of ["1", "2", "4", "200"]) await assert.rejects(service.get("member", "workspace", id, { expectedRevision }), ConflictException);
  assert.equal(calls, 4);
});

test("service rejects missing, extra, duplicate, array, noncanonical and prototype query shapes before reading", async () => {
  let calls = 0, reads = 0;
  const service = new PersonalDocumentSectionsService({ async get() { calls++; return document; } } satisfies DocumentReadPort);
  const bad: unknown[] = [null, undefined, [], "expectedRevision=3", {}, { expectedRevision: "3", extra: "x" }, { expectedRevision: ["3", "3"] }, { expectedRevision: { value: "3" } }, Object.create({ expectedRevision: "3" }), Object.assign(Object.create({}), { expectedRevision: "3" }), JSON.parse('{"expectedRevision":"3","__proto__":{}}'), { expectedRevision: "3", constructor: "x" }, { expectedRevision: "3", prototype: "x" }, { expectedRevision: "3", [Symbol("extra")]: true }, Object.defineProperty({}, "expectedRevision", { enumerable: true, get() { reads++; return "3"; } }), Object.defineProperty({}, "expectedRevision", { value: "3", enumerable: false })];
  for (const v of [3, NaN, true, null, undefined, new String("3"), "", "0", "00", "03", "201", "1000", "-3", "+3", "3.0", "3e0", " 3", "3 ", "3\n", "3\r", "3\r\n", "3\u2028", "3\u2029", "٣", "３"]) bad.push({ expectedRevision: v });
  for (const raw of ["expectedRevision=3&expectedRevision=3", "expectedRevision=3&%65xpectedRevision=3", "expectedRevision[]=3", "expectedRevision=3&__proto__=x", "expectedRevision=3&constructor=x", "expectedRevision=3&prototype=x"]) bad.push(parseQuery(raw));
  for (const query of bad) await assert.rejects(service.get("member", "workspace", id, query), BadRequestException);
  assert.equal(calls, 0);
  assert.equal(reads, 0);
  const query = Object.assign(Object.create(null), { expectedRevision: "3" });
  assertCoverage(document.body, await service.get("member", "workspace", id, query));
  assert.equal(calls, 1);
});

test("canonical query revision boundaries 1 and 200 work with the owner's matching snapshot", async () => {
  for (const revision of [1, 200]) {
    const service = new PersonalDocumentSectionsService({ async get() { return { ...document, revision }; } } satisfies DocumentReadPort);
    assert.equal((await service.get("member", "workspace", id, { expectedRevision: String(revision) })).revision, revision);
  }
});

test("service preserves owner rejections unchanged and never evaluates a denied snapshot", async () => {
  for (const error of [new UnauthorizedException("denied"), new ForbiddenException("denied"), new NotFoundException("unavailable"), new ServiceUnavailableException("unavailable")]) {
    const service = new PersonalDocumentSectionsService({ async get() { throw error; } } satisfies DocumentReadPort);
    await assert.rejects(service.get("member", "workspace", id, { expectedRevision: "3" }), (actual: unknown) => actual === error);
  }
});

test("validation and conflict errors do not echo private body or arbitrary query input", async () => {
  const secret = "PRIVATE_BODY_SENTINEL_223";
  const service = new PersonalDocumentSectionsService({ async get() { return { ...document, body: secret + "\n# " + "a".repeat(257) }; } } satisfies DocumentReadPort);
  for (const query of [{ expectedRevision: "3" }, { expectedRevision: "2" }, { expectedRevision: secret }]) {
    await assert.rejects(service.get("member", "workspace", id, query), (error: unknown) => {
      assert.ok(error instanceof HttpException);
      assert.ok(!JSON.stringify(error.getResponse()).includes(secret));
      return true;
    });
  }
});

test("controller keeps the existing guards, read permission, GET path, private no-store and owner DI token", () => {
  assert.equal(Reflect.getMetadata(PATH_METADATA, PersonalDocumentSectionsController), "client/documents/:id/sections");
  assert.deepEqual(Reflect.getMetadata(GUARDS_METADATA, PersonalDocumentSectionsController), [PersonalDocumentNoStoreGuard, WorkspaceContextGuard]);
  const get = PersonalDocumentSectionsController.prototype.get;
  assert.equal(Reflect.getMetadata(METHOD_METADATA, get), RequestMethod.GET);
  assert.deepEqual(Reflect.getMetadata(CLIENT_WORKSPACE_PERMISSIONS_KEY, get), [DOCUMENT_PERMISSION.read]);
  assert.deepEqual(Reflect.getMetadata(HEADERS_METADATA, get), [{ name: "Cache-Control", value: "private, no-store" }]);
  assert.deepEqual(Reflect.getMetadata(SELF_DECLARED_DEPS_METADATA, PersonalDocumentSectionsService), [{ index: 0, param: PersonalDocumentsService }]);
});

test("controller forwards only server-resolved scope and refuses incomplete context", async () => {
  const calls: unknown[][] = [];
  const sections = new PersonalDocumentSectionsService({ async get(member, workspace, requestedId) { calls.push([member, workspace, requestedId]); return document; } } satisfies DocumentReadPort);
  const controller = new PersonalDocumentSectionsController(sections);
  const request: ClientRequest = Object.assign(new IncomingMessage(new Socket()), { client: { id: "server-member", email: null, nickname: "Member" }, workspaceContext: { workspaceId: "server-workspace", workspaceCode: "workspace", workspaceName: "Workspace", roleId: "role", roleCode: "OWNER", permissions: [DOCUMENT_PERMISSION.read] } });
  assertCoverage(document.body, await controller.get(request, id, { expectedRevision: "3" }));
  assert.deepEqual(calls, [["server-member", "server-workspace", id]]);
  for (const missing of [{}, { client: request.client }, { workspaceContext: request.workspaceContext }]) {
    assert.throws(() => controller.get(Object.assign(new IncomingMessage(new Socket()), missing), id, { expectedRevision: "3" }), ForbiddenException);
  }
  assert.equal(calls.length, 1);
});
