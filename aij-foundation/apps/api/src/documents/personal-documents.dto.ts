import { BadRequestException } from "@nestjs/common";

function reject(): never { throw new BadRequestException("Invalid personal document request"); }
export function documentObject(raw: unknown, allowed: readonly string[], required: readonly string[] = []): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || ![Object.prototype, null].includes(Object.getPrototypeOf(raw)) ||
    Reflect.ownKeys(raw).some(k => typeof k !== "string" || !allowed.includes(k) || !Object.getOwnPropertyDescriptor(raw, k)?.enumerable || !Object.hasOwn(Object.getOwnPropertyDescriptor(raw, k)!, "value")) ||
    required.some(k => !Object.hasOwn(raw, k))) reject();
  return raw as Record<string, unknown>;
}
export function documentId(v: unknown): string {
  if (typeof v !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)) reject();
  return v.toLowerCase();
}
export function documentRevision(v: unknown): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 200) reject();
  return v;
}
export function documentRevisionParam(v: unknown): number {
  if (typeof v !== "string" || !/^[1-9][0-9]{0,2}$/.test(v)) reject();
  return documentRevision(Number(v));
}
export function documentBody(v: unknown): string {
  if (typeof v !== "string" || Buffer.byteLength(v, "utf8") > 65536 || [...v].some(c => { const n = c.codePointAt(0)!; return n < 32 && ![9, 10, 13].includes(n) || n >= 127 && n <= 159; }) || Buffer.from(v, "utf8").toString("utf8") !== v) reject();
  return v;
}
export function documentName(v: unknown): string {
  if (typeof v !== "string" || v !== v.trim() || [...v].length < 1 || [...v].length > 160 || !/[^\p{White_Space}\p{Cf}\p{M}]/u.test(v) || /[\p{Cc}\p{Cf}\p{Cs}]/u.test(v)) reject();
  return v;
}
export function createDocumentDto(raw: unknown) {
  const b = documentObject(raw, ["code", "name", "body"], ["code", "name", "body"]);
  if (typeof b.code !== "string" || b.code.length < 2 || b.code.length > 63 || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(b.code)) reject();
  return { code: b.code, name: documentName(b.name), body: documentBody(b.body) };
}
export function updateDocumentDto(raw: unknown) {
  const b = documentObject(raw, ["expectedRevision", "name", "body"], ["expectedRevision", "name", "body"]);
  return { expectedRevision: documentRevision(b.expectedRevision), name: documentName(b.name), body: documentBody(b.body) };
}
export function deleteDocumentDto(raw: unknown) {
  const b = documentObject(raw, ["expectedRevision"], ["expectedRevision"]);
  return { expectedRevision: documentRevision(b.expectedRevision) };
}
export function documentPage(raw: unknown, history = false) {
  const b = documentObject(raw, history ? ["limit", "beforeRevision"] : ["limit", "afterId"]);
  if (b.limit !== undefined && (typeof b.limit !== "string" || !/^[1-9][0-9]?$/.test(b.limit) || Number(b.limit) > 50)) reject();
  return { limit: b.limit === undefined ? 20 : Number(b.limit), afterId: !history && b.afterId !== undefined ? documentId(b.afterId) : "00000000-0000-0000-0000-000000000000",
    beforeRevision: history && b.beforeRevision !== undefined ? documentRevisionParam(b.beforeRevision) : 201 };
}
