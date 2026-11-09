import type { ClientApi } from "./index.js";
import type { PersonalDocument } from "./personal-documents.js";

export type PersonalDocumentSection = Readonly<{
  id: string; index: number; title: string; level: number; start: number; end: number;
}>;
export type PersonalDocumentSectionIndex = Readonly<{
  format: "aij-plain-sections-v1"; documentId: string; revision: number;
  bodySha256: string; bodyLength: number; bodyByteLength: number;
  sections: readonly PersonalDocumentSection[];
}>;
export type PersonalDocumentSectionDraft = Readonly<{
  documentId: string; expectedRevision: number; sourceSha256: string;
  sectionId: string; body: string; changed: boolean;
}>;
export type ComposePersonalDocumentSectionDraftInput = Readonly<{
  document: PersonalDocument; index: PersonalDocumentSectionIndex; sectionId: string; replacement: string;
}>;

// Never include private input or invent an HTTP business status on local decode failure.
function reject(): never { throw new TypeError("Invalid personal document sections data"); }
function inspect(raw: object): { proto: object | null; descriptors: PropertyDescriptorMap } {
  try { return { proto: Object.getPrototypeOf(raw), descriptors: Object.getOwnPropertyDescriptors(raw) }; }
  catch { return reject(); }
}
function object(raw: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) reject();
  const { proto, descriptors } = inspect(raw);
  if (proto !== Object.prototype && proto !== null) reject();
  const ownKeys = Reflect.ownKeys(descriptors);
  if (ownKeys.length !== keys.length || ownKeys.some(k => typeof k !== "string" || !keys.includes(k))) reject();
  const copy: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    const d = descriptors[key];
    if (!d || !d.enumerable || !Object.hasOwn(d, "value")) reject();
    copy[key] = d.value;
  }
  return copy;
}
function array(raw: unknown): unknown[] {
  if (!Array.isArray(raw)) reject();
  const { proto, descriptors } = inspect(raw);
  if (proto !== Array.prototype) reject();
  const length = descriptors.length.value;
  if (!Number.isInteger(length) || length < 1 || length > 128 || Reflect.ownKeys(descriptors).length !== length + 1) reject();
  const copy: unknown[] = [];
  for (let i = 0; i < length; i++) {
    const d = descriptors[String(i)];
    if (!d || !d.enumerable || !Object.hasOwn(d, "value")) reject();
    copy.push(d.value);
  }
  return copy;
}
function integer(raw: unknown, min: number, max: number): number {
  if (typeof raw !== "number" || !Number.isInteger(raw) || Object.is(raw, -0) || raw < min || raw > max) reject();
  return raw;
}
function id(raw: unknown): string {
  if (typeof raw !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raw)) reject();
  return raw.toLowerCase();
}
function workspace(raw: unknown): string {
  if (typeof raw !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(raw)) reject();
  return raw;
}
function text(raw: unknown, multiline: boolean): string {
  if (typeof raw !== "string" || raw.length > 65536) reject();
  for (let i = 0; i < raw.length; i++) {
    const n = raw.charCodeAt(i);
    if (n < 32 && !(n === 9 || multiline && (n === 10 || n === 13)) || n >= 127 && n <= 159) reject();
    if (n >= 0xd800 && n <= 0xdbff) {
      const next = raw.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) reject();
    } else if (n >= 0xdc00 && n <= 0xdfff) reject();
  }
  if (new TextEncoder().encode(raw).length > 65536) reject();
  return raw;
}
function title(raw: unknown): string {
  const value = text(raw, false);
  if (value !== value.replace(/^[ \t]+|[ \t]+$/g, "") || [...value].length < 1 || [...value].length > 256) reject();
  return value;
}
function decode(raw: unknown): PersonalDocumentSectionIndex {
  const b = object(raw, ["format", "documentId", "revision", "bodySha256", "bodyLength", "bodyByteLength", "sections"]);
  if (b.format !== "aij-plain-sections-v1" || typeof b.bodySha256 !== "string" || !/^[0-9a-f]{64}$/.test(b.bodySha256)) reject();
  const documentId = id(b.documentId), revision = integer(b.revision, 1, 200);
  const bodyLength = integer(b.bodyLength, 0, 65536), bodyByteLength = integer(b.bodyByteLength, bodyLength, 65536);
  if (bodyByteLength > bodyLength * 3) reject();
  let cursor = 0;
  const sections = array(b.sections).map((rawSection, i) => {
    const s = object(rawSection, ["id", "index", "title", "level", "start", "end"]);
    const index = integer(s.index, 0, 127), level = integer(s.level, 0, 6);
    const start = integer(s.start, 0, bodyLength), end = integer(s.end, 0, bodyLength);
    const name = title(s.title);
    if (s.id !== `section-${i}` || index !== i || start !== cursor || end < start || (bodyLength > 0 && start === end) ||
      (level === 0 && (i !== 0 || name !== "正文"))) reject();
    cursor = end;
    return Object.freeze({ id: s.id, index, title: name, level, start, end });
  });
  if (cursor !== bodyLength || bodyLength === 0 && (sections.length !== 1 || sections[0].level !== 0)) reject();
  return Object.freeze({ format: "aij-plain-sections-v1", documentId, revision, bodySha256: b.bodySha256,
    bodyLength, bodyByteLength, sections: Object.freeze(sections) });
}
function document(raw: unknown): Readonly<{ id: string; revision: number; body: string }> {
  const b = object(raw, ["id", "code", "name", "revision", "createdAt", "updatedAt", "body"]);
  if (typeof b.code !== "string" || b.code.length < 2 || b.code.length > 63 || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(b.code) ||
    typeof b.name !== "string" || b.name !== b.name.trim() || [...b.name].length < 1 || [...b.name].length > 160 ||
    !/[^\p{White_Space}\p{Cf}\p{M}]/u.test(b.name) || /[\p{Cc}\p{Cf}\p{Cs}]/u.test(b.name)) reject();
  for (const value of [b.createdAt, b.updatedAt]) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
      !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) reject();
  }
  if ((b.createdAt as string) > (b.updatedAt as string)) reject();
  return { id: id(b.id), revision: integer(b.revision, 1, 200), body: text(b.body, true) };
}
function boundary(body: string, offset: number): void {
  if (offset === 0 || offset === body.length) return;
  const before = body.charCodeAt(offset - 1), after = body.charCodeAt(offset);
  if (before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff || before === 13 && after === 10 ||
    before !== 10 && before !== 13) reject();
}

/** One explicit read. The injected ClientApi owns transport, authentication and HTTP errors. */
export function createPersonalDocumentSectionsClient(api: ClientApi) {
  if (typeof api !== "function") reject();
  return Object.freeze({
    async get(workspaceId: string, documentId: string, expectedRevision: number, signal?: AbortSignal): Promise<PersonalDocumentSectionIndex> {
      const scope = workspace(workspaceId), target = id(documentId), revision = integer(expectedRevision, 1, 200);
      if (signal !== undefined) {
        const getAborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted")?.get;
        try { if (!getAborted) reject(); getAborted.call(signal); } catch { reject(); }
      }
      const result = decode(await api<unknown>(`/client/documents/${target}/sections?expectedRevision=${revision}`, {
        workspaceId: scope, method: "GET", signal, cache: "no-store"
      }));
      if (result.documentId !== target || result.revision !== revision) reject();
      return result;
    }
  });
}

/** Pure local composition: never fetches, saves, retries, normalizes or mutates its inputs. */
export async function composePersonalDocumentSectionDraft(input: ComposePersonalDocumentSectionDraftInput): Promise<PersonalDocumentSectionDraft> {
  // Snapshot all descriptor-checked values before WebCrypto yields to the caller.
  const b = object(input, ["document", "index", "sectionId", "replacement"]);
  const source = document(b.document), index = decode(b.index), replacement = text(b.replacement, true);
  if (typeof b.sectionId !== "string" || !/^section-(?:0|[1-9][0-9]{0,2})$/.test(b.sectionId) ||
    source.id !== index.documentId || source.revision !== index.revision || source.body.length !== index.bodyLength ||
    new TextEncoder().encode(source.body).length !== index.bodyByteLength) reject();
  const section = index.sections.find(s => s.id === b.sectionId);
  if (!section) reject();
  for (const s of index.sections) { boundary(source.body, s.start); boundary(source.body, s.end); }
  if (section.end < source.body.length && replacement !== "" && !/[\r\n]$/.test(replacement)) reject();
  const body = text(source.body.slice(0, section.start) + replacement + source.body.slice(section.end), true);
  if (!globalThis.crypto?.subtle) reject();
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(source.body));
  const hash = Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, "0")).join("");
  if (hash !== index.bodySha256) reject();
  return Object.freeze({ documentId: source.id, expectedRevision: source.revision, sourceSha256: hash,
    sectionId: section.id, body, changed: body !== source.body });
}
