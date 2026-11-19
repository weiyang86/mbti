import type { ClientApi } from "./index.js";

function reject(): never { throw new TypeError("Invalid personal document data"); }
function documentObject(raw: unknown, allowed: readonly string[], required: readonly string[] = []): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || ![Object.prototype, null].includes(Object.getPrototypeOf(raw)) ||
    Reflect.ownKeys(raw).some(k => typeof k !== "string" || !allowed.includes(k) || !Object.getOwnPropertyDescriptor(raw, k)?.enumerable || !Object.hasOwn(Object.getOwnPropertyDescriptor(raw, k)!, "value")) ||
    required.some(k => !Object.hasOwn(raw, k))) reject();
  return raw as Record<string, unknown>;
}
function documentId(v: unknown): string {
  if (typeof v !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)) reject();
  return v.toLowerCase();
}
function documentRevision(v: unknown): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 200) reject();
  return v;
}
function documentBody(v: unknown): string {
  if (typeof v !== "string" || new TextEncoder().encode(v).length > 65536 || [...v].some(c => { const n = c.codePointAt(0)!; return n < 32 && ![9, 10, 13].includes(n) || n >= 127 && n <= 159; }) || new TextDecoder("utf-8", { ignoreBOM: true }).decode(new TextEncoder().encode(v)) !== v) reject();
  return v;
}
function documentName(v: unknown): string {
  if (typeof v !== "string" || v !== v.trim() || [...v].length < 1 || [...v].length > 160 || !/[^\p{White_Space}\p{Cf}\p{M}]/u.test(v) || /[\p{Cc}\p{Cf}\p{Cs}]/u.test(v)) reject();
  return v;
}
function createDocumentDto(raw: unknown) {
  const b = documentObject(raw, ["code", "name", "body"], ["code", "name", "body"]);
  if (typeof b.code !== "string" || b.code.length < 2 || b.code.length > 63 || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(b.code)) reject();
  return { code: b.code, name: documentName(b.name), body: documentBody(b.body) };
}
function updateDocumentDto(raw: unknown) {
  const b = documentObject(raw, ["expectedRevision", "name", "body"], ["expectedRevision", "name", "body"]);
  return { expectedRevision: documentRevision(b.expectedRevision), name: documentName(b.name), body: documentBody(b.body) };
}
function deleteDocumentDto(raw: unknown) {
  const b = documentObject(raw, ["expectedRevision"], ["expectedRevision"]);
  return { expectedRevision: documentRevision(b.expectedRevision) };
}
export type CreatePersonalDocument = Readonly<{ code: string; name: string; body: string }>;
export type UpdatePersonalDocument = Readonly<{ expectedRevision: number; name: string; body: string }>;
export type PersonalDocumentSummary = Readonly<{ id: string; code: string; name: string; revision: number; createdAt: string; updatedAt: string }>;
export type PersonalDocument = PersonalDocumentSummary & Readonly<{ body: string }>;
export type PersonalDocumentVersionSummary = Readonly<{ documentId: string; revision: number; name: string; createdAt: string }>;
export type PersonalDocumentVersion = PersonalDocumentVersionSummary & Readonly<{ body: string }>;
export type PersonalDocumentPage = Readonly<{ items: PersonalDocumentSummary[]; nextCursor: string | null }>;
export type PersonalDocumentHistory = Readonly<{ items: PersonalDocumentVersionSummary[]; nextCursor: number | null }>;
export type DeletePersonalDocumentResult = Readonly<{ id: string; revision: number; deleted: true }>;
function scopeId(v: unknown): string {
  if (typeof v !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(v)) reject();
  return v;
}
function date(v: unknown): string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v) || !Number.isFinite(Date.parse(v)) || new Date(v).toISOString() !== v) reject();
  return v;
}
function parseHead(raw: unknown, full: boolean): PersonalDocumentSummary | PersonalDocument {
  const keys = ["id", "code", "name", "revision", "createdAt", "updatedAt", ...(full ? ["body"] : [])];
  const b = documentObject(raw, keys, keys);
  const c = createDocumentDto({ code: b.code, name: b.name, body: full ? b.body : "" });
  const r = { id: documentId(b.id), code: c.code, name: c.name, revision: documentRevision(b.revision), createdAt: date(b.createdAt), updatedAt: date(b.updatedAt) };
  if (r.createdAt > r.updatedAt) reject();
  return full ? { ...r, body: c.body } : r;
}
function parseVersion(raw: unknown, full: boolean): PersonalDocumentVersionSummary | PersonalDocumentVersion {
  const keys = ["documentId", "revision", "name", "createdAt", ...(full ? ["body"] : [])];
  const b = documentObject(raw, keys, keys);
  const r = { documentId: documentId(b.documentId), revision: documentRevision(b.revision), name: documentName(b.name), createdAt: date(b.createdAt) };
  return full ? { ...r, body: documentBody(b.body) } : r;
}
const requireSameId = (actual: string, expected: string) => { if (actual !== expected) reject(); };
// Request validation is a definite local refusal; malformed success responses remain unknown write outcomes.
class DocumentInputFailure extends TypeError {
  readonly status = 400;
  constructor() { super("Invalid personal document request"); }
}
function validateInput<T>(parse: () => T): T {
  try { return parse(); } catch (error) { if (error instanceof TypeError) throw new DocumentInputFailure(); throw error; }
}
/** One request per explicit call; no retry, replay, background read, cache or storage. */
export function createPersonalDocumentsClient(api: ClientApi) {
  const base = "/client/documents";
  const request = (workspace: string, path: string, method: string, body?: unknown, signal?: AbortSignal) => api<unknown>(path, {
    workspaceId: validateInput(() => scopeId(workspace)), method, signal, cache: "no-store", ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const path = (id: string) => base + "/" + validateInput(() => documentId(id));
  const full = (raw: unknown) => parseHead(raw, true) as PersonalDocument;
  return {
    async create(workspace: string, input: CreatePersonalDocument, signal?: AbortSignal): Promise<PersonalDocument> {
      const dto = validateInput(() => createDocumentDto(input)), r = full(await request(workspace, base, "POST", dto, signal));
      if (r.code !== dto.code) reject();
      return r;
    },
    async get(workspace: string, id: string, signal?: AbortSignal): Promise<PersonalDocument> {
      const p = path(id), r = full(await request(workspace, p, "GET", undefined, signal)); requireSameId(r.id, documentId(id)); return r;
    },
    async update(workspace: string, id: string, input: UpdatePersonalDocument, signal?: AbortSignal): Promise<PersonalDocument> {
      const dto = validateInput(() => updateDocumentDto(input)), p = path(id), r = full(await request(workspace, p, "PATCH", dto, signal));
      requireSameId(r.id, documentId(id));
      if (![dto.expectedRevision, dto.expectedRevision + 1].includes(r.revision) || r.name !== dto.name || r.body !== dto.body) reject();
      return r;
    },
    async delete(workspace: string, id: string, expectedRevision: number, signal?: AbortSignal): Promise<DeletePersonalDocumentResult> {
      const dto = validateInput(() => deleteDocumentDto({ expectedRevision })), p = path(id), b = documentObject(await request(workspace, p, "DELETE", dto, signal), ["id", "revision", "deleted"], ["id", "revision", "deleted"]);
      requireSameId(documentId(b.id), documentId(id)); if (b.deleted !== true || documentRevision(b.revision) !== expectedRevision) reject();
      return { id: documentId(b.id), revision: expectedRevision, deleted: true };
    },
    async list(workspace: string, options: Readonly<{ limit?: number; afterId?: string }> = {}, signal?: AbortSignal): Promise<PersonalDocumentPage> {
      documentObject(options, ["limit", "afterId"]);
      const limit = options.limit ?? 20; if (!Number.isInteger(limit) || limit < 1 || limit > 50) reject();
      const after = options.afterId === undefined ? null : documentId(options.afterId), q = new URLSearchParams({ limit: String(limit) });
      if (after) q.set("afterId", after);
      const b = documentObject(await request(workspace, base + "?" + q, "GET", undefined, signal), ["items", "nextCursor"], ["items", "nextCursor"]);
      if (!Array.isArray(b.items) || b.items.length > limit) reject();
      const items = b.items.map(v => parseHead(v, false) as PersonalDocumentSummary);
      for (let i = 0; i < items.length; i++) if ((i ? items[i - 1].id : after ?? "") >= items[i].id) reject();
      const cursor = b.nextCursor === null ? null : documentId(b.nextCursor);
      if (cursor && (items.length !== limit || cursor !== items[items.length - 1]?.id)) reject();
      return { items, nextCursor: cursor };
    },
    async versions(workspace: string, id: string, options: Readonly<{ limit?: number; beforeRevision?: number }> = {}, signal?: AbortSignal): Promise<PersonalDocumentHistory> {
      documentObject(options, ["limit", "beforeRevision"]);
      const limit = options.limit ?? 20; if (!Number.isInteger(limit) || limit < 1 || limit > 50) reject();
      const before = options.beforeRevision === undefined ? 201 : documentRevision(options.beforeRevision), q = new URLSearchParams({ limit: String(limit) });
      if (before !== 201) q.set("beforeRevision", String(before));
      const b = documentObject(await request(workspace, path(id) + "/versions?" + q, "GET", undefined, signal), ["items", "nextCursor"], ["items", "nextCursor"]);
      if (!Array.isArray(b.items) || b.items.length > limit) reject();
      const items = b.items.map(v => parseVersion(v, false) as PersonalDocumentVersionSummary);
      for (let i = 0; i < items.length; i++) { requireSameId(items[i].documentId, documentId(id)); if ((i ? items[i - 1].revision : before) <= items[i].revision) reject(); }
      const cursor = b.nextCursor === null ? null : documentRevision(b.nextCursor);
      if (cursor !== null && (items.length !== limit || cursor !== items[items.length - 1]?.revision)) reject();
      return { items, nextCursor: cursor };
    },
    async getVersion(workspace: string, id: string, revision: number, signal?: AbortSignal): Promise<PersonalDocumentVersion> {
      validateInput(() => documentRevision(revision));
      const r = parseVersion(await request(workspace, path(id) + "/versions/" + revision, "GET", undefined, signal), true) as PersonalDocumentVersion;
      requireSameId(r.documentId, documentId(id)); if (r.revision !== revision) reject(); return r;
    }
  };
}
export type PersonalDocumentsPort = ReturnType<typeof createPersonalDocumentsClient>;
