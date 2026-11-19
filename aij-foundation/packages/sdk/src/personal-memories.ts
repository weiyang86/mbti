import type { ClientApi } from "./index.js";

export type PersonalMemoryKind = "preference" | "confirmed_fact" | "task_summary";
export type PersonalMemoryContent = Readonly<{ title: string; content: string; kind: PersonalMemoryKind; enabled: boolean; agentIds: string[] }>;
const CONTENT = ["title", "content", "kind", "enabled", "agentIds"];
function reject(): never { throw new TypeError("Invalid personal memory request"); }
function personalMemoryObject(raw: unknown, allowed: readonly string[], required: readonly string[] = []): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || ![Object.prototype, null].includes(Object.getPrototypeOf(raw)) ||
    Reflect.ownKeys(raw).some(k => typeof k !== "string" || !allowed.includes(k)) || required.some(k => !Object.hasOwn(raw, k))) reject();
  return raw as Record<string, unknown>;
}
function personalMemoryId(v: unknown): string {
  if (typeof v !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(v)) reject();
  return v;
}
function personalMemoryRevision(v: unknown): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 2147483647) reject();
  return v;
}
function text(v: unknown, max: number, bytes: number): string {
  if (typeof v !== "string" || !v.trim() || v.length > max || v.includes("\0") || new TextEncoder().encode(v).length > bytes || new TextDecoder("utf-8", { ignoreBOM: true }).decode(new TextEncoder().encode(v)) !== v) reject();
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
function createPersonalMemoryDto(raw: unknown) {
  const b = personalMemoryObject(raw, [...CONTENT, "code"], ["title", "content", "kind", "code"]);
  if (typeof b.code !== "string" || b.code.length < 2 || b.code.length > 63 || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(b.code)) reject();
  return { ...content(b), code: b.code };
}
/** Full replacement of mutable fields; omission explicitly resets opt-in and grants. */
function updatePersonalMemoryDto(raw: unknown) {
  const b = personalMemoryObject(raw, [...CONTENT, "expectedRevision"], ["title", "content", "kind", "expectedRevision"]);
  return { ...content(b), expectedRevision: personalMemoryRevision(b.expectedRevision) };
}
function deletePersonalMemoryDto(raw: unknown) {
  const b = personalMemoryObject(raw, ["expectedRevision"], ["expectedRevision"]);
  return { expectedRevision: personalMemoryRevision(b.expectedRevision) };
}

export type CreatePersonalMemory = Omit<PersonalMemoryContent, "enabled" | "agentIds"> & Readonly<{ code: string; enabled?: boolean; agentIds?: string[] }>;
export type UpdatePersonalMemory = Omit<CreatePersonalMemory, "code"> & Readonly<{ expectedRevision: number }>;
export type PersonalMemorySummary = Readonly<{ id: string; code: string; title: string; kind: PersonalMemoryKind; enabled: boolean; revision: number; createdAt: string; updatedAt: string }>;
export type PersonalMemory = PersonalMemorySummary & PersonalMemoryContent;
export type PersonalMemoryPage = Readonly<{ items: PersonalMemorySummary[]; nextCursor: string | null }>;
export type DeletePersonalMemoryResult = Readonly<{ id: string; revision: number; deleted: true }>;
/** Stateless narrow factory. Empty agentIds authorizes NONE; no consume/restore API exists. */
export function createPersonalMemoriesClient(api: ClientApi) {
  const base = "/client/ai/personal-memories";
  const id = (v: string) => encodeURIComponent(personalMemoryId(v));
  const request = <T>(workspaceId: string, path: string, method = "GET", body?: unknown) => {
    personalMemoryId(workspaceId);
    return api<T>(path, { method, workspaceId, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  };
  return {
    create: (workspaceId: string, input: CreatePersonalMemory) => request<PersonalMemory>(workspaceId, base, "POST", createPersonalMemoryDto(input)),
    get: (workspaceId: string, memoryId: string) => request<PersonalMemory>(workspaceId, base + "/" + id(memoryId)),
    update: (workspaceId: string, memoryId: string, input: UpdatePersonalMemory) => request<PersonalMemory>(workspaceId, base + "/" + id(memoryId), "PATCH", updatePersonalMemoryDto(input)),
    delete: (workspaceId: string, memoryId: string, expectedRevision: number) => request<DeletePersonalMemoryResult>(workspaceId, base + "/" + id(memoryId), "DELETE", deletePersonalMemoryDto({ expectedRevision })),
    list(workspaceId: string, options: Readonly<{ limit?: number; afterId?: string }> = {}) {
      personalMemoryObject(options, ["limit", "afterId"]);
      const q = new URLSearchParams();
      if (options.limit !== undefined) {
        if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 50) reject();
        q.set("limit", String(options.limit));
      }
      if (options.afterId !== undefined) q.set("afterId", personalMemoryId(options.afterId));
      return request<PersonalMemoryPage>(workspaceId, base + (q.size ? "?" + q : ""));
    }
  };
}
