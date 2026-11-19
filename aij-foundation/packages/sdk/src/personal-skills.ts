import type { ClientApi } from "./index.js";

export type PersonalSkillSummary = Readonly<{ id: string; code: string; name: string; revision: number; createdAt: string; updatedAt: string }>;
export type PersonalSkill = PersonalSkillSummary & Readonly<{ instructions: string }>;
export type PersonalSkillVersion = Readonly<{ id: string; skillId: string; code: string; name: string; instructions: string; revision: number; createdAt: string }>;
export type CreatePersonalSkill = Readonly<{ code: string; name: string; instructions: string }>;
export type UpdatePersonalSkill = Readonly<{ name: string; instructions: string; expectedRevision: number }>;
export type DeletePersonalSkillResult = Readonly<{ id: string; revision: number; deleted: true }>;
export type PersonalSkillPage<T, C = string> = Readonly<{ items: T[]; nextCursor: C | null }>;
export type PersonalSkillListOptions = Readonly<{ limit?: number; afterId?: string }>;
export type PersonalSkillVersionOptions = Readonly<{ limit?: number; beforeRevision?: number }>;
const ID = /^[A-Za-z0-9_-]{1,128}$/;
function id(value: string) {
  if (typeof value !== "string" || !ID.test(value)) throw new TypeError("Invalid personal Skill selector");
  return encodeURIComponent(value);
}
function fields(value: unknown, keys: string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) throw new TypeError("Invalid personal Skill payload");
}
function content(value: { name: string; instructions: string }) {
  if (typeof value.name !== "string" || !value.name.trim() || value.name !== value.name.trim() || value.name.length > 100 || value.name.includes("\0") ||
    typeof value.instructions !== "string" || !value.instructions.trim() || value.instructions.length > 8000 || value.instructions.includes("\0") ||
    new TextEncoder().encode(value.instructions).length > 32768) throw new TypeError("Invalid personal Skill content");
}
function revision(value: number) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 2147483647) throw new TypeError("Invalid personal Skill revision");
  return value;
}
function page(limit?: number) {
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 50)) throw new TypeError("Invalid personal Skill page limit");
}
/** Uses the actual ClientApi cookie/workspace transport. No token or tenant state is retained. */
export function createPersonalSkillsClient(api: ClientApi) {
  const base = "/client/ai/skills";
  const request = <T>(workspaceId: string, path: string, method: string, body?: unknown) => {
    id(workspaceId);
    return api<T>(path, { method, workspaceId, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  };
  return {
    list(workspaceId: string, options: PersonalSkillListOptions = {}) {
      fields(options, ["limit", "afterId"]); page(options.limit);
      const q = new URLSearchParams();
      if (options.limit !== undefined) q.set("limit", String(options.limit));
      if (options.afterId !== undefined) { id(options.afterId); q.set("afterId", options.afterId); }
      return request<PersonalSkillPage<PersonalSkillSummary>>(workspaceId, base + (q.size ? "?" + q : ""), "GET");
    },
    create(workspaceId: string, input: CreatePersonalSkill) {
      fields(input, ["code", "name", "instructions"]); content(input);
      if (typeof input.code !== "string" || input.code.length < 2 || input.code.length > 63 || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(input.code)) throw new TypeError("Invalid personal Skill code");
      return request<PersonalSkill>(workspaceId, base, "POST", { code: input.code, name: input.name, instructions: input.instructions });
    },
    get: (workspaceId: string, skillId: string) => request<PersonalSkill>(workspaceId, base + "/" + id(skillId), "GET"),
    update(workspaceId: string, skillId: string, input: UpdatePersonalSkill) {
      fields(input, ["name", "instructions", "expectedRevision"]); content(input); revision(input.expectedRevision);
      return request<PersonalSkill>(workspaceId, base + "/" + id(skillId), "PATCH", { name: input.name, instructions: input.instructions, expectedRevision: input.expectedRevision });
    },
    delete: (workspaceId: string, skillId: string, expectedRevision: number) => request<DeletePersonalSkillResult>(workspaceId, base + "/" + id(skillId), "DELETE", { expectedRevision: revision(expectedRevision) }),
    versions(workspaceId: string, skillId: string, options: PersonalSkillVersionOptions = {}) {
      fields(options, ["limit", "beforeRevision"]); page(options.limit);
      const q = new URLSearchParams();
      if (options.limit !== undefined) q.set("limit", String(options.limit));
      if (options.beforeRevision !== undefined) q.set("beforeRevision", String(revision(options.beforeRevision)));
      return request<PersonalSkillPage<PersonalSkillVersion, number>>(workspaceId, base + "/" + id(skillId) + "/versions" + (q.size ? "?" + q : ""), "GET");
    }
  };
}
