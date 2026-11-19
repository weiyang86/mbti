import type { ClientApi } from "./index.js";

export type PersonalAgentSkillRef = Readonly<{ skillId: string; revision: number }>;
export type PersonalAgentBinding = PersonalAgentSkillRef & Readonly<{ skillVersionId: string }>;
export type PersonalAgentContent = Readonly<{ name: string; instructions: string; enabled?: boolean;
  modelCode: string; modelRevision: number; catalogVersion: number; inputFields: string[];
  outputFormat: "text" | "json"; outputFields: string[]; skillBindings: PersonalAgentSkillRef[] }>;
export type CreatePersonalAgent = PersonalAgentContent & Readonly<{ code: string }>;
export type UpdatePersonalAgent = PersonalAgentContent & Readonly<{ expectedRevision: number }>;
type CreatePersonalAgentDto = CreatePersonalAgent;
type UpdatePersonalAgentDto = UpdatePersonalAgent;
export type PersonalAgentSummary = Readonly<{ id: string; code: string; name: string; enabled: boolean; revision: number; createdAt: string; updatedAt: string }>;
export type PersonalAgent = PersonalAgentSummary & Omit<PersonalAgentContent, "skillBindings" | "enabled"> & Readonly<{ skillBindings: PersonalAgentBinding[] }>;
export type PersonalAgentVersion = Omit<PersonalAgent, "updatedAt"> & Readonly<{ agentId: string }>;
export type PersonalAgentModelOptions = Readonly<{ catalogVersion: number; items: Readonly<{ code: string; name: string; revision: number; capability: "text" }>[] }>;
export type PersonalAgentPage<T, C = string> = Readonly<{ items: T[]; nextCursor: C | null }>;
export type PersonalAgentListOptions = Readonly<{ limit?: number; afterId?: string }>;
export type PersonalAgentVersionOptions = Readonly<{ limit?: number; beforeRevision?: number }>;
export type DeletePersonalAgentResult = Readonly<{ id: string; revision: number; deleted: true }>;
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const CODE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const CONTENT = ["name", "instructions", "enabled", "modelCode", "modelRevision", "catalogVersion", "inputFields", "outputFormat", "outputFields", "skillBindings"];
const REQUIRED = CONTENT.filter(k => k !== "enabled");
function reject(): never { throw new TypeError("Invalid personal Agent request"); }
function personalAgentObject(raw: unknown, allowed: readonly string[], required: readonly string[] = []): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || ![Object.prototype, null].includes(Object.getPrototypeOf(raw)) ||
    Object.keys(raw).some(k => !allowed.includes(k)) || required.some(k => !Object.hasOwn(raw, k))) reject();
  return raw as Record<string, unknown>;
}
function personalAgentRevision(v: unknown): number {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 1 || v > 2147483647) reject();
  return v;
}
function personalAgentId(v: unknown): string {
  if (typeof v !== "string" || !ID.test(v)) reject();
  return v;
}
function code(v: unknown): string {
  if (typeof v !== "string" || v.length < 2 || v.length > 63 || !CODE.test(v)) reject();
  return v;
}
function modelCode(v: unknown): string {
  if (typeof v !== "string" || !/^[a-z][a-z0-9-]{1,62}$/.test(v)) reject();
  return v;
}
function names(v: unknown): string[] {
  if (!Array.isArray(v) || v.length > 20 || new Set(v).size !== v.length ||
    v.some(x => typeof x !== "string" || !/^[a-zA-Z][a-zA-Z0-9_]{0,47}$/.test(x) || ["__proto__", "constructor", "prototype"].includes(x))) reject();
  return [...v] as string[];
}
function content(b: Record<string, unknown>): PersonalAgentContent {
  if (typeof b.name !== "string" || !b.name.trim() || b.name !== b.name.trim() || b.name.length > 100 || b.name.includes("\0") ||
    typeof b.instructions !== "string" || !b.instructions.trim() || b.instructions.length > 8000 || b.instructions.includes("\0") ||
    new TextEncoder().encode(b.instructions).length > 32768 || (b.enabled !== undefined && typeof b.enabled !== "boolean")) reject();
  const inputFields = names(b.inputFields), outputFields = names(b.outputFields);
  if (!inputFields.length || !["text", "json"].includes(b.outputFormat as string) || (b.outputFormat === "json" && !outputFields.length) ||
    !Array.isArray(b.skillBindings) || b.skillBindings.length > 8) reject();
  const skillBindings = b.skillBindings.map(raw => {
    const r = personalAgentObject(raw, ["skillId", "revision"], ["skillId", "revision"]);
    return { skillId: personalAgentId(r.skillId), revision: personalAgentRevision(r.revision) };
  });
  if (new Set(skillBindings.map(r => r.skillId)).size !== skillBindings.length) reject();
  return { name: b.name, instructions: b.instructions, enabled: b.enabled === true, modelCode: modelCode(b.modelCode),
    modelRevision: personalAgentRevision(b.modelRevision), catalogVersion: personalAgentRevision(b.catalogVersion),
    inputFields, outputFormat: b.outputFormat as "text" | "json", outputFields, skillBindings };
}
function createPersonalAgentDto(raw: unknown): CreatePersonalAgentDto {
  const b = personalAgentObject(raw, [...CONTENT, "code"], [...REQUIRED, "code"]);
  return { ...content(b), code: code(b.code) };
}
function updatePersonalAgentDto(raw: unknown): UpdatePersonalAgentDto {
  const b = personalAgentObject(raw, [...CONTENT, "expectedRevision"], [...REQUIRED, "expectedRevision"]);
  return { ...content(b), expectedRevision: personalAgentRevision(b.expectedRevision) };
}

function pageLimit(v: number | undefined) {
  if (v !== undefined && (!Number.isSafeInteger(v) || v < 1 || v > 50)) reject();
}
/** Uses the existing ClientApi transport; no retained tenant/token and no execution API. */
export function createPersonalAgentsClient(api: ClientApi) {
  const base = "/client/ai/personal-agents";
  const id = (v: string) => encodeURIComponent(personalAgentId(v));
  const request = <T>(workspaceId: string, path: string, method = "GET", body?: unknown) => {
    personalAgentId(workspaceId);
    return api<T>(path, { method, workspaceId, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  };
  return {
    modelOptions: (workspaceId: string) => request<PersonalAgentModelOptions>(workspaceId, base + "/model-options"),
    create: (workspaceId: string, input: CreatePersonalAgent) => request<PersonalAgent>(workspaceId, base, "POST", createPersonalAgentDto(input)),
    get: (workspaceId: string, agentId: string) => request<PersonalAgent>(workspaceId, base + "/" + id(agentId)),
    update: (workspaceId: string, agentId: string, input: UpdatePersonalAgent) => request<PersonalAgent>(workspaceId, base + "/" + id(agentId), "PATCH", updatePersonalAgentDto(input)),
    delete: (workspaceId: string, agentId: string, expectedRevision: number) => request<DeletePersonalAgentResult>(workspaceId, base + "/" + id(agentId), "DELETE", { expectedRevision: personalAgentRevision(expectedRevision) }),
    list(workspaceId: string, options: PersonalAgentListOptions = {}) {
      personalAgentObject(options, ["limit", "afterId"]); pageLimit(options.limit);
      const q = new URLSearchParams();
      if (options.limit !== undefined) q.set("limit", String(options.limit));
      if (options.afterId !== undefined) { personalAgentId(options.afterId); q.set("afterId", options.afterId); }
      return request<PersonalAgentPage<PersonalAgentSummary>>(workspaceId, base + (q.size ? "?" + q : ""));
    },
    versions(workspaceId: string, agentId: string, options: PersonalAgentVersionOptions = {}) {
      personalAgentObject(options, ["limit", "beforeRevision"]); pageLimit(options.limit);
      const q = new URLSearchParams();
      if (options.limit !== undefined) q.set("limit", String(options.limit));
      if (options.beforeRevision !== undefined) q.set("beforeRevision", String(personalAgentRevision(options.beforeRevision)));
      return request<PersonalAgentPage<PersonalAgentVersion, number>>(workspaceId, base + "/" + id(agentId) + "/versions" + (q.size ? "?" + q : ""));
    }
  };
}
