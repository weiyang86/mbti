import { BadRequestException } from "@nestjs/common";
import { parseSecretRef } from "../../secret-center/secret-ref";
import { redactText } from "../../audit-log/audit-redaction";
import { MBTI_CATEGORIES, type MbtiCategory } from "./mbti-config.categories";
export { MBTI_CATEGORIES, type MbtiCategory } from "./mbti-config.categories";

/** Candidate storage vocabulary copied from B3/B4/B5 presentation models, not the root API contract. */
export const MBTI_UNKNOWN = Object.freeze({ status: "needs_human_review", unknowns: [
  "Remy: approve prototype-to-storage field mapping and C2 consumer adapter; this is a candidate schema",
  "Remy: approve per-category read/edit/publish roles and plugin permission names; none are minted or granted",
  "Remy: approve merchant credential families and public/user projections; no public endpoint is exposed",
  "Business consumers and historical snapshot compatibility require the C2 adapter decision"
] });

type Channel = "wechat" | "mp" | "douyin" | "xhs";
type Style = "editorial" | "illustration" | "game";
type PersonaCode = `${"E" | "I"}${"S" | "N"}${"T" | "F"}${"J" | "P"}`;
type Persona = { title: string; quote: string; recharge: string; communication: string; care: string };
type Question = { id: string; index: number; dimension: "EI" | "SN" | "TF" | "JP"; prompt: string; options: { id: string; label: string }[]; reverse: boolean };
export type MbtiValues = {
  content: { headline: string; accent: string; sub: string; cta: string; moments: string; avatar: string; meet: string; caption: string };
  channels: Record<Channel, { name: string; landing: "home" | "pricing" | "test-intro" | "discover" | "history"; badge: string }>;
  catalog: { shop: { id: string; title: string; cents: number; desc: string; on: boolean }[]; styles: { id: Style; title: string; art: Style; on: boolean; order: number }[] };
  assessment: { question_bank_version: string; questions: Question[] };
  personas: Record<PersonaCode, Persona>;
  imageRecipes: { recipe: "portrait" | "balanced" | "style" };
  retention: { tags: string[]; days: number[] };
  discovery: { order: "same" | "recommend"; daily: number; radar: boolean; radius: number; minimum: number };
  aiRuntime: { mode: "UNCONFIGURED"; size: "960*1280" | "1024*1024" | "720*1280"; timeout: number; credentialRef?: string };
  payments: Record<Channel, { enabled: false; mode: "UNCONFIGURED"; merchantLabel: string }>;
  trade: { ttl: number; redeem: boolean; selfRefund: "self" | "support"; refundDays: number };
};
export type MbtiSnapshot = { [K in MbtiCategory]: MbtiValues[K] | null };
export function emptySnapshot(): MbtiSnapshot { return Object.fromEntries(MBTI_CATEGORIES.map(key => [key, null])) as MbtiSnapshot; }
function invalid(): never { throw new BadRequestException("Invalid MBTI candidate configuration"); }
type Check = (value: unknown) => void;
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const text = (max: number): Check => v => { if (typeof v !== "string" || !v.trim() || v.length > max || redactText(v) !== v || /(?:env|local):\/\//i.test(v) || [...v].some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127) || /[<>"'&]|bearer\s|sk-[a-z0-9]|-----BEGIN|(?:password|api[_-]?key|secret)\s*[:=]/i.test(v)) invalid(); };
const integer = (min: number, max: number): Check => v => { if (!Number.isSafeInteger(v) || Number(v) < min || Number(v) > max) invalid(); };
const oneOf = (values: readonly unknown[]): Check => v => { if (!values.includes(v)) invalid(); };
const boolean: Check = v => { if (typeof v !== "boolean") invalid(); };
const shape = (fields: Record<string, Check>, optional: Record<string, Check> = {}): Check => v => {
  if (!record(v) || Object.keys(v).some(k => !Object.hasOwn(fields, k) && !Object.hasOwn(optional, k)) || Object.keys(fields).some(k => !Object.hasOwn(v, k))) invalid();
  for (const [key, check] of Object.entries({ ...fields, ...optional })) if (Object.hasOwn(v, key)) check(v[key]);
};
const array = (check: Check, min: number, max: number): Check => v => { if (!Array.isArray(v) || v.length < min || v.length > max) invalid(); for (const item of v) check(item); };
const unique = (items: readonly unknown[]) => { if (new Set(items).size !== items.length) invalid(); };
const channels = ["wechat", "mp", "douyin", "xhs"] as const;
const styles = ["editorial", "illustration", "game"] as const;
const personaCodes = ["E", "I"].flatMap(a => ["S", "N"].flatMap(b => ["T", "F"].flatMap(c => ["J", "P"].map(d => a + b + c + d))));
const checks: Record<MbtiCategory, Check> = {
  content: shape({ headline: text(26), accent: text(28), sub: text(80), cta: text(20), moments: text(100), avatar: text(100), meet: text(100), caption: text(100) }),
  channels: shape(Object.fromEntries(channels.map(c => [c, shape({ name: text(30), landing: oneOf(["home", "pricing", "test-intro", "discover", "history"]), badge: text(26) })]))),
  catalog: shape({ shop: array(shape({ id: text(64), title: text(24), cents: integer(1, 999999), desc: text(100), on: boolean }), 2, 2), styles: array(shape({ id: oneOf(styles), title: text(16), art: oneOf(styles), on: boolean, order: integer(1, 3) }), 3, 3) }),
  assessment: shape({ question_bank_version: text(96), questions: array(shape({ id: text(64), index: integer(1, 12), dimension: oneOf(["EI", "SN", "TF", "JP"]), prompt: text(100), options: array(shape({ id: oneOf(["e", "i", "s", "n", "t", "f", "j", "p"]), label: text(70) }), 2, 2), reverse: boolean }), 12, 12) }),
  personas: shape(Object.fromEntries(personaCodes.map(c => [c, shape({ title: text(18), quote: text(48), recharge: text(90), communication: text(90), care: text(90) })]))),
  imageRecipes: shape({ recipe: oneOf(["portrait", "balanced", "style"]) }),
  retention: shape({ tags: array(text(12), 1, 10), days: array(integer(1, 365), 1, 3) }),
  discovery: shape({ order: oneOf(["same", "recommend"]), daily: integer(1, 30), radar: boolean, radius: oneOf([500, 1000, 3000]), minimum: integer(10, 200) }),
  aiRuntime: shape({ mode: oneOf(["UNCONFIGURED"]), size: oneOf(["960*1280", "1024*1024", "720*1280"]), timeout: integer(20, 180) }, { credentialRef: v => { if (typeof v !== "string") invalid(); parseSecretRef(v); } }),
  payments: shape(Object.fromEntries(channels.map(c => [c, shape({ enabled: oneOf([false]), mode: oneOf(["UNCONFIGURED"]), merchantLabel: oneOf(["MBTI搭子体验店", "品牌展示样例"]) })]))),
  trade: shape({ ttl: integer(1, 120), redeem: boolean, selfRefund: oneOf(["self", "support"]), refundDays: integer(1, 30) })
};
export function category(input: string): MbtiCategory { if (!MBTI_CATEGORIES.includes(input as MbtiCategory)) invalid(); return input as MbtiCategory; }
export function validateCategory<K extends MbtiCategory>(key: K, input: unknown): MbtiValues[K] {
  checks[key](input);
  const v = input as MbtiValues[K];
  if (key === "catalog") {
    const c = v as MbtiValues["catalog"]; unique(c.shop.map(p => p.id)); unique(c.styles.map(p => p.id)); unique(c.styles.map(p => p.order));
    if (!c.shop.some(p => p.on) || !c.styles.some(p => p.on) || c.shop[1].cents < c.shop[0].cents) invalid();
  }
  if (key === "assessment") {
    const q = (v as MbtiValues["assessment"]).questions; unique(q.map(q => q.id)); unique(q.map(q => q.index));
    if (["EI", "SN", "TF", "JP"].some(d => q.filter(q => q.dimension === d).length !== 3)) invalid();
    for (const item of q) { unique(item.options.map(o => o.id)); unique(item.options.map(o => o.label.trim())); if (item.options.some(o => !item.dimension.toLowerCase().includes(o.id))) invalid(); }
  }
  if (key === "retention") { const r = v as MbtiValues["retention"]; unique(r.tags); unique(r.days); }
  return structuredClone(v);
}
export function validateSnapshot(input: unknown): MbtiSnapshot {
  if (!record(input) || Object.keys(input).length !== MBTI_CATEGORIES.length || MBTI_CATEGORIES.some(k => !Object.hasOwn(input, k))) invalid();
  for (const k of MBTI_CATEGORIES) if (input[k] !== null) validateCategory(k, input[k]);
  return structuredClone(input) as MbtiSnapshot;
}
export function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v) => record(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);
}
export function revision(value: unknown): number { if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 2147483645) invalid(); return value as number; }
export function exactBody(input: unknown, keys: string[]): Record<string, unknown> {
  if (!record(input) || Object.keys(input).length !== keys.length || keys.some(k => !Object.hasOwn(input, k))) invalid(); return input;
}
/** No credential references or system fields leave the service without their existing platform authorization. */
export function projectSnapshot(snapshot: MbtiSnapshot, system: boolean) {
  const out: Record<string, unknown> = {};
  for (const key of MBTI_CATEGORIES) {
    if (!system && ["aiRuntime", "payments", "trade"].includes(key)) continue;
    const value = structuredClone(snapshot[key]);
    if (key === "aiRuntime" && value) { const ai = value as MbtiValues["aiRuntime"]; delete ai.credentialRef; }
    out[key] = value;
  }
  return out;
}
