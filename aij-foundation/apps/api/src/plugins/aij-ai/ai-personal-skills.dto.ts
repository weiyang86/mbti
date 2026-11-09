import { BadRequestException } from "@nestjs/common";

export type PersonalSkillContent = Readonly<{ name: string; instructions: string }>;
export type CreatePersonalSkillDto = PersonalSkillContent & Readonly<{ code: string }>;
export type UpdatePersonalSkillDto = PersonalSkillContent & Readonly<{ expectedRevision: number }>;
export type DeletePersonalSkillDto = Readonly<{ expectedRevision: number }>;
export type PersonalSkillPage = Readonly<{ limit: number; afterId?: string }>;
export type PersonalSkillVersionPage = Readonly<{ limit: number; beforeRevision?: number }>;
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const CODE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

function object(raw: unknown, allowed: readonly string[], required: readonly string[] = []): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(raw)) ||
      Object.keys(raw).some(key => !allowed.includes(key)) || required.some(key => !Object.hasOwn(raw, key))) {
    throw new BadRequestException("Invalid personal Skill request");
  }
  return raw as Record<string, unknown>;
}
function content(body: Record<string, unknown>): PersonalSkillContent {
  const { name, instructions } = body;
  if (typeof name !== "string" || !name.trim() || name !== name.trim() || name.length > 100 ||
      typeof instructions !== "string" || !instructions.trim() || instructions.length > 8000 ||
      Buffer.byteLength(instructions, "utf8") > 32768 || name.includes("\0") || instructions.includes("\0")) {
    throw new BadRequestException("Invalid prompt Skill content");
  }
  return { name, instructions };
}
function revision(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > 2147483647) {
    throw new BadRequestException("Invalid expectedRevision");
  }
  return value;
}
export function personalSkillId(value: unknown): string {
  if (typeof value !== "string" || !ID.test(value)) throw new BadRequestException("Invalid personal Skill ID");
  return value;
}
export function createPersonalSkillDto(raw: unknown): CreatePersonalSkillDto {
  const body = object(raw, ["name", "code", "instructions"], ["name", "code", "instructions"]);
  if (typeof body.code !== "string" || body.code.length < 2 || body.code.length > 63 || !CODE.test(body.code)) {
    throw new BadRequestException("Invalid personal Skill code");
  }
  return { ...content(body), code: body.code };
}
export function updatePersonalSkillDto(raw: unknown): UpdatePersonalSkillDto {
  const body = object(raw, ["name", "instructions", "expectedRevision"], ["name", "instructions", "expectedRevision"]);
  return { ...content(body), expectedRevision: revision(body.expectedRevision) };
}
export function deletePersonalSkillDto(raw: unknown): DeletePersonalSkillDto {
  const body = object(raw, ["expectedRevision"], ["expectedRevision"]);
  return { expectedRevision: revision(body.expectedRevision) };
}
function queryInteger(value: unknown, max: number): number {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,9}$/.test(value) || Number(value) > max) {
    throw new BadRequestException("Invalid personal Skill pagination");
  }
  return Number(value);
}
export function personalSkillPage(raw: unknown): PersonalSkillPage {
  const body = object(raw, ["limit", "afterId"]);
  return { limit: body.limit === undefined ? 20 : queryInteger(body.limit, 50),
    ...(body.afterId === undefined ? {} : { afterId: personalSkillId(body.afterId) }) };
}
export function personalSkillVersionPage(raw: unknown): PersonalSkillVersionPage {
  const body = object(raw, ["limit", "beforeRevision"]);
  return { limit: body.limit === undefined ? 20 : queryInteger(body.limit, 50),
    ...(body.beforeRevision === undefined ? {} : { beforeRevision: queryInteger(body.beforeRevision, 2147483647) }) };
}
