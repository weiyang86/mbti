import { BadRequestException, ConflictException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { buildPersonalDocumentSectionIndex } from "./personal-document-sections";
import { documentBody, documentId, documentObject, documentRevision } from "./personal-documents.dto";

export type DocumentSectionSelector = Readonly<{
  documentId: string;
  expectedRevision: number;
  bodySha256: string;
  sectionId: string;
}>;

export type DocumentSectionRef = Readonly<{
  format: "aij-document-section-source-v1";
  indexFormat: "aij-plain-sections-v1";
  documentId: string;
  revision: number;
  bodySha256: string;
  sectionId: string;
  start: number;
  end: number;
  sectionSha256: string;
}>;

function reject(): never { throw new BadRequestException("Invalid personal document source"); }

function sha256(value: unknown): string {
  if (typeof value !== "string" || value.length !== 64 || !/^[0-9a-f]{64}$/.test(value)) reject();
  return value;
}

function sectionId(value: unknown): string {
  if (typeof value !== "string" || !/^section-(0|[1-9][0-9]{0,2})$/.test(value)) reject();
  const index = Number(value.slice("section-".length));
  if (index > 127 || value !== `section-${index}`) reject();
  return value;
}

/** Parse only the four selector fields; authorization remains with the document owner. */
export function parseDocumentSectionSelector(raw: unknown): DocumentSectionSelector {
  const keys = ["documentId", "expectedRevision", "bodySha256", "sectionId"];
  const value = documentObject(raw, keys, keys);
  return Object.freeze({
    documentId: documentId(value.documentId),
    expectedRevision: documentRevision(value.expectedRevision),
    bodySha256: sha256(value.bodySha256),
    sectionId: sectionId(value.sectionId)
  });
}

/** Structural parsing is not proof that a client supplied ref matches a current document. */
export function parseDocumentSectionRef(raw: unknown): DocumentSectionRef {
  const keys = ["format", "indexFormat", "documentId", "revision", "bodySha256", "sectionId", "start", "end", "sectionSha256"];
  const value = documentObject(raw, keys, keys);
  if (value.format !== "aij-document-section-source-v1" || value.indexFormat !== "aij-plain-sections-v1" ||
    typeof value.start !== "number" || !Number.isInteger(value.start) || value.start < 0 ||
    typeof value.end !== "number" || !Number.isInteger(value.end) || value.end <= value.start || value.end > 65536) reject();
  return Object.freeze({
    format: "aij-document-section-source-v1",
    indexFormat: "aij-plain-sections-v1",
    documentId: documentId(value.documentId),
    revision: documentRevision(value.revision),
    bodySha256: sha256(value.bodySha256),
    sectionId: sectionId(value.sectionId),
    start: value.start,
    end: value.end,
    sectionSha256: sha256(value.sectionSha256)
  });
}

/** Call only with an authorized, locked current snapshot in the caller's transaction. */
export function buildPersonalDocumentRunSource(raw: unknown, rawSelector: unknown): Readonly<{ ref: DocumentSectionRef; text: string }> {
  const selector = parseDocumentSectionSelector(rawSelector);
  const keys = ["id", "revision", "body"];
  const source = documentObject(raw, keys, keys);
  const id = documentId(source.id), revision = documentRevision(source.revision), body = documentBody(source.body);
  if (id !== selector.documentId || revision !== selector.expectedRevision ||
    createHash("sha256").update(body, "utf8").digest("hex") !== selector.bodySha256) {
    throw new ConflictException("Personal document source conflict");
  }
  // This is the existing W23 parser, including full-body/title/count validation.
  const index = buildPersonalDocumentSectionIndex({ id, revision, body });
  const section = index.sections.find(section => section.id === selector.sectionId);
  if (!section) throw new ConflictException("Personal document source conflict");
  const text = body.slice(section.start, section.end);
  if (text.length === 0 || text.trim().length === 0 || text.length > 2000) reject();
  const ref = parseDocumentSectionRef({
    format: "aij-document-section-source-v1",
    indexFormat: index.format,
    documentId: index.documentId,
    revision: index.revision,
    bodySha256: index.bodySha256,
    sectionId: section.id,
    start: section.start,
    end: section.end,
    sectionSha256: createHash("sha256").update(text, "utf8").digest("hex")
  });
  return Object.freeze({ ref, text });
}
