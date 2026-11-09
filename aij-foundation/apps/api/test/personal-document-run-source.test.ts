import "reflect-metadata";
import * as assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { BadRequestException, ConflictException, HttpException } from "@nestjs/common";
import { buildPersonalDocumentSectionIndex } from "../src/documents/personal-document-sections";
import {
  buildPersonalDocumentRunSource, parseDocumentSectionRef, parseDocumentSectionSelector,
  type DocumentSectionSelector
} from "../src/documents/personal-document-run-source";

const id = "6140daed-c14e-491d-a81b-c0e400085cb3";
const otherId = "7140daed-c14e-491d-a81b-c0e400085cb3";
const hash = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const source = (body: string, revision = 3) => ({ id, revision, body });
const selector = (body: string, sectionId = "section-0", expectedRevision = 3): DocumentSectionSelector =>
  ({ documentId: id, expectedRevision, bodySha256: hash(body), sectionId });
const build = (body: string, sectionId = "section-0") => buildPersonalDocumentRunSource(source(body), selector(body, sectionId));
const selectorKeys = ["documentId", "expectedRevision", "bodySha256", "sectionId"];
const refKeys = ["format", "indexFormat", "documentId", "revision", "bodySha256", "sectionId", "start", "end", "sectionSha256"];

function badShapes(value: Record<string, unknown>): unknown[] {
  return [null, undefined, false, 1, "object", [], new String("object"), {},
    { ...value, extra: true }, { ...value, constructor: "x" }, { ...value, prototype: "x" },
    JSON.parse(JSON.stringify(value).replace(/}$/, ',"__proto__":{}}')),
    { ...value, [Symbol("private")]: true }, Object.assign(Object.create({}), value),
    Object.create(value), Object.defineProperty({ ...value }, "hidden", { value: true }),
    ...Object.keys(value).map(key => Object.defineProperty({ ...value }, key, { enumerable: false }))];
}

test("selector uses exactly four data fields and the original document UUID/revision rules", () => {
  for (const revision of [1, 200]) {
    const input = Object.freeze({ ...selector("body", "section-127", revision), documentId: id.toUpperCase() });
    const result = parseDocumentSectionSelector(input);
    assert.deepEqual(Object.keys(result), selectorKeys);
    assert.deepEqual(result, { ...input, documentId: id });
    assert.notEqual(result, input);
    assert.ok(Object.isFrozen(result));
    assert.equal(input.documentId, id.toUpperCase());
  }
  const nullProto = Object.assign(Object.create(null), selector("body"));
  assert.deepEqual(parseDocumentSectionSelector(nullProto), selector("body"));
});

test("selector rejects noncanonical hashes, section IDs and revisions without coercion", () => {
  for (const bodySha256 of [hash("body").toUpperCase(), "f".repeat(63), "f".repeat(65), "g".repeat(64), hash("body") + "\n", null, 0, new String(hash("body"))]) {
    assert.throws(() => parseDocumentSectionSelector({ ...selector("body"), bodySha256 }), BadRequestException);
  }
  for (const sectionId of ["section-00", "section-01", "section-128", "section-999", "section--1", "section-1.0", "section-1e0", "section-+1", "section-1\n", "section-1\r\n", " section-1", "section-１", "section-١", "section-", 1, new String("section-1")]) {
    assert.throws(() => parseDocumentSectionSelector({ ...selector("body"), sectionId }), BadRequestException);
  }
  for (const expectedRevision of [0, 201, -1, 1.5, NaN, Infinity, "3", new Number(3), null]) {
    assert.throws(() => parseDocumentSectionSelector({ ...selector("body"), expectedRevision }), BadRequestException);
  }
  for (const documentId of ["invalid", " " + id, id + "\n", "00000000-0000-0000-0000-000000000000", null]) {
    assert.throws(() => parseDocumentSectionSelector({ ...selector("body"), documentId }), BadRequestException);
  }
});

test("selector and ref reject missing, extra, symbol, hidden, inherited and polluted keys", () => {
  const ref = build("body").ref;
  for (const [parse, input] of [[parseDocumentSectionSelector, selector("body")], [parseDocumentSectionRef, ref]] as const) {
    for (const raw of badShapes(input)) assert.throws(() => parse(raw), BadRequestException);
    for (const key of Object.keys(input)) {
      const missing: Record<string, unknown> = { ...input };
      delete missing[key];
      assert.throws(() => parse(missing), BadRequestException);
    }
  }
});

test("data parsers reject accessors before evaluating them, including unused properties", () => {
  let reads = 0, writes = 0;
  const sample = source("body");
  for (const [parse, input] of [[parseDocumentSectionSelector, selector("body")], [parseDocumentSectionRef, build("body").ref],
    [(raw: unknown) => buildPersonalDocumentRunSource(raw, selector("body")), sample]] as const) {
    for (const key of [...Object.keys(input), "extra"]) {
      for (const accessor of [{ get() { reads++; throw Error("getter must not run"); } }, { set(_value: unknown) { writes++; } }]) {
        const raw = Object.defineProperty({ ...input }, key, { ...accessor, enumerable: true });
        assert.throws(() => parse(raw), BadRequestException);
      }
    }
  }
  assert.equal(reads, 0);
  assert.equal(writes, 0);
});

test("ref parser canonicalizes field order, detaches and freezes without trusting its hashes", () => {
  const ref = build("# First\nbody").ref;
  const raw = Object.fromEntries(Object.entries(ref).reverse());
  const parsed = parseDocumentSectionRef(raw);
  assert.deepEqual(Object.keys(parsed), refKeys);
  assert.deepEqual(parsed, ref);
  assert.notEqual(parsed, ref);
  assert.notEqual(parsed, raw);
  assert.ok(Object.isFrozen(parsed));
  raw.sectionSha256 = "0".repeat(64);
  assert.equal(parsed.sectionSha256, hash("# First\nbody"));
  // A valid structure is accepted without body evidence, even with a deliberately false hash.
  assert.equal(parseDocumentSectionRef({ ...ref, sectionSha256: "0".repeat(64), end: 65536 }).end, 65536);
  assert.deepEqual(parseDocumentSectionRef(Object.assign(Object.create(null), ref)), ref);
});

test("ref parser checks formats, integers and nonempty UTF16 offset bounds", () => {
  const ref = build("body").ref;
  for (const delta of [
    { format: "v2" }, { indexFormat: "v2" }, { start: -1 }, { start: 1.5 }, { start: NaN },
    { start: "0" }, { end: "4" }, { end: 0 }, { start: 4, end: 4 }, { start: 5, end: 4 },
    { end: 65537 }, { end: Infinity }, { end: 2.5 }, { sectionSha256: "F".repeat(64) },
    { sectionSha256: hash("body") + "\n" }, { sectionId: "section-128" }, { revision: 201 },
    { documentId: "invalid" }, { bodySha256: "bad" }
  ]) assert.throws(() => parseDocumentSectionRef({ ...ref, ...delta }), BadRequestException);
});

test("builder returns the exact whole source and independently hashed frozen ref", () => {
  const body = "intro\r\n# First 😀\r\ne\u0301\r\n## Second\nend", input = Object.freeze(source(body));
  const selection = Object.freeze(selector(body, "section-1"));
  const before = JSON.stringify([input, selection]);
  const actual = buildPersonalDocumentRunSource(input, selection);
  const index = buildPersonalDocumentSectionIndex(input), section = index.sections[1];
  const expectedText = body.slice(body.indexOf("# First"), body.indexOf("## Second"));
  assert.equal(actual.text, expectedText);
  assert.deepEqual(actual.ref, {
    format: "aij-document-section-source-v1", indexFormat: index.format, documentId: id,
    revision: 3, bodySha256: hash(body), sectionId: "section-1", start: section.start,
    end: section.end, sectionSha256: hash(expectedText)
  });
  assert.deepEqual(Object.keys(actual), ["ref", "text"]);
  assert.ok(Object.isFrozen(actual) && Object.isFrozen(actual.ref));
  assert.throws(() => { (actual.ref as { start: number }).start = 123; }, TypeError);
  assert.equal(JSON.stringify([input, selection]), before);
  const again = buildPersonalDocumentRunSource(input, selection);
  assert.deepEqual(actual, again);
  assert.notEqual(actual.ref, again.ref);
});

test("whole slice length includes heading and newline: exactly 2000 passes, 2001 refuses", () => {
  for (const eol of ["\n", "\r\n", "\r"]) {
    const prefix = "# Title 😀" + eol, good = prefix + "a".repeat(2000 - prefix.length);
    assert.equal(build(good).text, good);
    assert.equal(build(good).text.length, 2000);
    const tooLong = good + "z", input = Object.freeze(source(tooLong));
    assert.throws(() => buildPersonalDocumentRunSource(input, selector(tooLong)), BadRequestException);
    assert.equal(input.body, tooLong);
  }
});

test("source limit is UTF16 units, while hashes and original body cap use exact UTF8 bytes", () => {
  for (const body of ["字".repeat(2000), "😀".repeat(1000), "e\u0301".repeat(1000)]) {
    const result = build(body);
    assert.equal(result.text.length, 2000);
    assert.equal(result.text, body);
    assert.equal(result.ref.sectionSha256, hash(body));
  }
  for (const body of ["😀".repeat(1000) + "x", "字".repeat(2001)]) assert.throws(() => build(body), BadRequestException);
  const suffix = "# Last\r\n尾😀";
  const bodyAtCap = "x".repeat(65536 - Buffer.byteLength(suffix) - 1) + "\n" + suffix;
  assert.equal(Buffer.byteLength(bodyAtCap), 65536);
  assert.equal(build(bodyAtCap, "section-1").text, suffix);
  assert.throws(() => build(bodyAtCap + "x", "section-1"), BadRequestException);
});

test("empty and whitespace-only selected sources refuse without trimming nonblank sources", () => {
  for (const body of ["", " ", "\r\n\t ", "\u00A0\uFEFF\u2028\u2029", " \r\n# Later\nbody"]) {
    assert.throws(() => build(body), BadRequestException);
  }
  for (const body of ["  literal \r\n", "\u00A0x\uFEFF", "# Title\r\n"]) assert.equal(build(body).text, body);
});

test("normalization and line-ending changes never share a source reference", () => {
  const variants = ["# é\n😀", "# e\u0301\n😀", "# é\r\n😀", "# é\r😀"];
  const results = variants.map(body => build(body));
  assert.equal(new Set(results.map(r => r.ref.bodySha256)).size, variants.length);
  assert.equal(new Set(results.map(r => r.ref.sectionSha256)).size, variants.length);
  for (const [i, result] of results.entries()) assert.equal(result.text, variants[i]);
  assert.equal(build("😀\r\n# A\r\nlast", "section-1").ref.start, 4);
});

test("valid selector changes of document, revision, whole body or section produce safe 409", () => {
  const body = "# A\nfirst\n# B\nsecond", valid = selector(body);
  for (const change of [{ documentId: otherId }, { expectedRevision: 4 }, { bodySha256: hash(body + "x") }, { sectionId: "section-2" }]) {
    assert.throws(() => buildPersonalDocumentRunSource(source(body), { ...valid, ...change }), ConflictException);
  }
  assert.throws(() => buildPersonalDocumentRunSource(source(body, 4), valid), ConflictException);
  const changedOutsideSelection = body.replace("second", "changed");
  assert.throws(() => buildPersonalDocumentRunSource(source(changedOutsideSelection), valid), ConflictException);
  const a = build(body), b = build(changedOutsideSelection);
  assert.equal(a.text, b.text);
  assert.equal(a.ref.sectionSha256, b.ref.sectionSha256);
  assert.notEqual(a.ref.bodySha256, b.ref.bodySha256);
});

test("malformed selectors are 400 before a source is inspected", () => {
  let reads = 0;
  const raw = Object.defineProperty({}, "body", { get() { reads++; throw Error("must not inspect"); } });
  assert.throws(() => buildPersonalDocumentRunSource(raw, { ...selector("body"), sectionId: "section-01" }), BadRequestException);
  assert.equal(reads, 0);
});

test("stale revision/body conflicts precede parsing a changed body's section index", () => {
  const previous = "# Valid\nbody", changed = "# " + "x".repeat(257);
  assert.throws(() => buildPersonalDocumentRunSource(source(changed, 4), selector(previous)), ConflictException);
  assert.throws(() => buildPersonalDocumentRunSource(source(changed), selector(previous)), ConflictException);
  assert.throws(() => build(changed), BadRequestException);
  for (const revision of [1, 200]) {
    const current = Object.freeze(source("source", revision));
    assert.equal(buildPersonalDocumentRunSource(current, selector(current.body, "section-0", revision)).ref.revision, revision);
  }
});

test("the entire current index must pass the original 128 section and title boundaries", () => {
  const headings = (count: number) => Array.from({ length: count }, (_, i) => `# Heading ${i}\n`).join("");
  for (const body of [headings(128), "prelude\n" + headings(127)]) {
    assert.equal(build(body, "section-127").ref.sectionId, "section-127");
    assert.equal(build(body, "section-127").ref.end, body.length);
  }
  for (const body of [headings(129), "prelude\n" + headings(128)]) assert.throws(() => build(body), BadRequestException);
  for (const title of ["a".repeat(256), "😀".repeat(256), "e\u0301".repeat(128)]) {
    const body = "# \t" + title + "\t \r\n";
    assert.equal(build(body).text, body);
  }
  // Even a bad unselected title is rejected by the same parser, without truncation.
  for (const title of ["", "\t ", "a".repeat(257), "😀".repeat(257)]) {
    assert.throws(() => build("# First\nbody\n## " + title), BadRequestException);
  }
});

test("existing fence and column-zero heading semantics determine the whole selected slice", () => {
  const first = "# First\r\n````text\r\n## hidden\r\n```\r\n### hidden too\r\n`````\r\n";
  const last = "## Last\r\n~~~\n# hidden\n~~~\nend", body = first + last;
  assert.equal(build(body).text, first);
  assert.equal(build(body, "section-1").text, last);
  assert.throws(() => buildPersonalDocumentRunSource(source(body), selector(body, "section-2")), ConflictException);
});

test("builder inherits document data-only, control, surrogate and whole-body validation", () => {
  for (const raw of badShapes(source("body"))) assert.throws(() => buildPersonalDocumentRunSource(raw, selector("body")), BadRequestException);
  for (const body of ["bad\0", "bad\u0085", "\uD800", "\uDC00"]) assert.throws(() => build(body), BadRequestException);
  const raw = Object.assign(Object.create(null), source("literal 😀\r\n"));
  assert.equal(buildPersonalDocumentRunSource(raw, selector(raw.body)).text, raw.body);
});

test("errors never echo private source or caller data", () => {
  const secret = "PRIVATE_BODY_SENTINEL_AF227";
  for (const action of [
    () => buildPersonalDocumentRunSource(source(secret), { ...selector(secret), sectionId: secret }),
    () => buildPersonalDocumentRunSource(source(secret), selector(secret + "changed")),
    () => build(secret.repeat(100)),
    () => parseDocumentSectionRef({ ...build(secret).ref, extra: secret })
  ]) assert.throws(action, (error: unknown) => {
    assert.ok(error instanceof HttpException);
    assert.ok(!JSON.stringify(error.getResponse()).includes(secret));
    return true;
  });
});
