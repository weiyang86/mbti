import { BadRequestException } from "@nestjs/common";

export type PersonalAgentSkillRef = Readonly<{ skillId: string; revision: number }>;
export type PersonalAgentContent = Readonly<{ name: string; instructions: string; enabled: boolean;
  modelCode: string; modelRevision: number; catalogVersion: number; inputFields: string[];
  outputFormat: "text" | "json"; outputFields: string[]; skillBindings: PersonalAgentSkillRef[] }>;
export type CreatePersonalAgentDto = PersonalAgentContent & Readonly<{ code: string }>;
export type UpdatePersonalAgentDto = PersonalAgentContent & Readonly<{ expectedRevision: number }>;
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const CODE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const CONTENT = ["name", "instructions", "enabled", "modelCode", "modelRevision", "catalogVersion", "inputFields", "outputFormat", "outputFields", "skillBindings"];
const REQUIRED = CONTENT.filter(k => k !== "enabled");
function reject(): never { throw new BadRequestException("Invalid personal Agent request"); }
export function personalAgentObject(raw: unknown, allowed: readonly string[], required: readonly string[] = []): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || ![Object.prototype, null].includes(Object.getPrototypeOf(raw)) ||
    Object.keys(raw).some(k => !allowed.includes(k)) || required.some(k => !Object.hasOwn(raw, k))) reject();
  return raw as Record<string, unknown>;
}
export function personalAgentRevision(v: unknown): number {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 1 || v > 2147483647) reject();
  return v;
}
export function personalAgentId(v: unknown): string {
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
    Buffer.byteLength(b.instructions, "utf8") > 32768 || (b.enabled !== undefined && typeof b.enabled !== "boolean")) reject();
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
export function createPersonalAgentDto(raw: unknown): CreatePersonalAgentDto {
  const b = personalAgentObject(raw, [...CONTENT, "code"], [...REQUIRED, "code"]);
  return { ...content(b), code: code(b.code) };
}
export function updatePersonalAgentDto(raw: unknown): UpdatePersonalAgentDto {
  const b = personalAgentObject(raw, [...CONTENT, "expectedRevision"], [...REQUIRED, "expectedRevision"]);
  return { ...content(b), expectedRevision: personalAgentRevision(b.expectedRevision) };
}
export function deletePersonalAgentDto(raw: unknown) {
  const b = personalAgentObject(raw, ["expectedRevision"], ["expectedRevision"]);
  return { expectedRevision: personalAgentRevision(b.expectedRevision) };
}
function queryInt(v: unknown, max: number): number {
  if (typeof v !== "string" || !/^[1-9][0-9]{0,9}$/.test(v) || Number(v) > max) reject();
  return Number(v);
}
export function personalAgentPage(raw: unknown) {
  const b = personalAgentObject(raw, ["limit", "afterId"]);
  return { limit: b.limit === undefined ? 20 : queryInt(b.limit, 50), afterId: b.afterId === undefined ? "" : personalAgentId(b.afterId) };
}
export function personalAgentVersionPage(raw: unknown) {
  const b = personalAgentObject(raw, ["limit", "beforeRevision"]);
  return { limit: b.limit === undefined ? 20 : queryInt(b.limit, 50), beforeRevision: b.beforeRevision === undefined ? 2147483648 : queryInt(b.beforeRevision, 2147483647) };
}
