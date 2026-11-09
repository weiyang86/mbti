import { BadRequestException } from "@nestjs/common";

export type PersonalMemoryKind = "preference" | "confirmed_fact" | "task_summary";
export type PersonalMemoryContent = Readonly<{ title: string; content: string; kind: PersonalMemoryKind; enabled: boolean; agentIds: string[] }>;
const CONTENT = ["title", "content", "kind", "enabled", "agentIds"];
function reject(): never { throw new BadRequestException("Invalid personal memory request"); }
export function personalMemoryObject(raw: unknown, allowed: readonly string[], required: readonly string[] = []): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || ![Object.prototype, null].includes(Object.getPrototypeOf(raw)) ||
    Reflect.ownKeys(raw).some(k => typeof k !== "string" || !allowed.includes(k)) || required.some(k => !Object.hasOwn(raw, k))) reject();
  return raw as Record<string, unknown>;
}
export function personalMemoryId(v: unknown): string {
  if (typeof v !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(v)) reject();
  return v;
}
export function personalMemoryRevision(v: unknown): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 2147483647) reject();
  return v;
}
function text(v: unknown, max: number, bytes: number): string {
  if (typeof v !== "string" || !v.trim() || v.length > max || v.includes("\0") || Buffer.byteLength(v, "utf8") > bytes || Buffer.from(v, "utf8").toString("utf8") !== v) reject();
  return v;
}
function content(b: Record<string, unknown>): PersonalMemoryContent {
  if (!["preference", "confirmed_fact", "task_summary"].includes(b.kind as string) ||
    (Object.hasOwn(b, "enabled") && typeof b.enabled !== "boolean")) reject();
  const refs = Object.hasOwn(b, "agentIds") ? b.agentIds : [];
  if (!Array.isArray(refs) || refs.length > 16 || new Set(refs).size !== refs.length) reject();
  return { title: text(b.title, 100, 400), content: text(b.content, 4000, 16384), kind: b.kind as PersonalMemoryKind,
    enabled: b.enabled === true, agentIds: Array.from(refs, personalMemoryId).sort() };
}
export function createPersonalMemoryDto(raw: unknown) {
  const b = personalMemoryObject(raw, [...CONTENT, "code"], ["title", "content", "kind", "code"]);
  if (typeof b.code !== "string" || b.code.length < 2 || b.code.length > 63 || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(b.code)) reject();
  return { ...content(b), code: b.code };
}
/** Full replacement of mutable fields; omission explicitly resets opt-in and grants. */
export function updatePersonalMemoryDto(raw: unknown) {
  const b = personalMemoryObject(raw, [...CONTENT, "expectedRevision"], ["title", "content", "kind", "expectedRevision"]);
  return { ...content(b), expectedRevision: personalMemoryRevision(b.expectedRevision) };
}
export function deletePersonalMemoryDto(raw: unknown) {
  const b = personalMemoryObject(raw, ["expectedRevision"], ["expectedRevision"]);
  return { expectedRevision: personalMemoryRevision(b.expectedRevision) };
}
export function personalMemoryPage(raw: unknown) {
  const b = personalMemoryObject(raw, ["limit", "afterId"]);
  if (b.limit !== undefined && (typeof b.limit !== "string" || !/^[1-9][0-9]?$/.test(b.limit) || Number(b.limit) > 50)) reject();
  return { limit: b.limit === undefined ? 20 : Number(b.limit), afterId: b.afterId === undefined ? "" : personalMemoryId(b.afterId) };
}
