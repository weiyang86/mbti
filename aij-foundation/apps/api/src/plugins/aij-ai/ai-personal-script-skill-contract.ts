import type { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { types } from 'node:util';

export type ScriptScope = Readonly<{ memberId: string; workspaceId: string }>;
export type SessionGate = (tx: Prisma.TransactionClient) => Promise<void>;
export type ScriptSkillCurrent = Readonly<{ projectId: string; skillId: string; skillVersionId: string;
  revision: number; name: string; instructions: string }>;
/** Implemented by the original Skill owner. All methods fence lifecycle, membership, permissions,
 * original Skill advisory/head/version locks, then authorize; never construct a second owner. */
export abstract class PersonalScriptSkillAccess {
  abstract withCurrent<T>(scope: ScriptScope, skillId: string, permissions: readonly string[], authorize: SessionGate | undefined,
    operation: (tx: Prisma.TransactionClient, current: ScriptSkillCurrent) => Promise<T>): Promise<T>;
  abstract currentInTransaction(tx: Prisma.TransactionClient, scope: ScriptScope, skillId: string,
    permissions: readonly string[], authorize?: SessionGate): Promise<ScriptSkillCurrent>;
  /** Always append a real version, including unchanged prompt content. Must CAS and audit in tx. */
  abstract appendVersionInTransaction(tx: Prisma.TransactionClient, current: ScriptSkillCurrent,
    content: { name: string; instructions: string; expectedRevision: number }): Promise<ScriptSkillCurrent>;
}
export type ScriptRef = Readonly<{ scriptVersionId: string; skillId: string; skillVersionId: string;
  revision: number; scriptDigest: string; policyDigest: string }>;
export const SCRIPT_POLICY_BYTES = JSON.stringify({ version: 'aij-private-python-json-v1', language: 'python',
  sourceBytes: 65536, inputBytes: 16384, outputBytes: 65536, depth: 16, entries: 2048, timeoutMs: 30000,
  network: 'none', tools: [], attachments: [] });
export const scriptSha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export const SCRIPT_POLICY_DIGEST = scriptSha256(SCRIPT_POLICY_BYTES);
export class ScriptValidationError extends Error { constructor() { super('Invalid personal script data'); } }
function invalid(): never { throw new ScriptValidationError(); }
const dangerous = new Set(['__proto__', 'constructor', 'prototype']);
export function scriptText(raw: unknown): string {
  if (typeof raw !== 'string' || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(raw)) invalid();
  return raw;
}
export function scriptObject(raw: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || types.isProxy(raw) || Array.isArray(raw) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(raw))) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(raw);
  if (Reflect.ownKeys(raw).length !== keys.length || Reflect.ownKeys(raw).some(k => typeof k !== 'string' ||
    !keys.includes(k) || dangerous.has(k) || !descriptors[k].enumerable || !('value' in descriptors[k])) ||
    keys.some(k => !Object.hasOwn(raw, k))) invalid();
  return raw as Record<string, unknown>;
}
export function scriptOpaqueId(raw: unknown): string {
  if (typeof raw !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(raw)) invalid();
  return raw;
}
export function scriptVersionId(raw: unknown): string {
  if (typeof raw !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(raw)) invalid();
  return raw;
}
export function scriptRevision(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1 || raw > 2147483647) invalid();
  return raw;
}
export function scriptSource(raw: unknown): string {
  const source = scriptText(raw);
  if (!source.length || source.includes('\0') || Buffer.byteLength(source, 'utf8') > 65536) invalid();
  return source;
}
export function scriptRef(raw: unknown): ScriptRef {
  const r = scriptObject(raw, ['scriptVersionId', 'skillId', 'skillVersionId', 'revision', 'scriptDigest', 'policyDigest']);
  if (typeof r.scriptDigest !== 'string' || !/^[0-9a-f]{64}$/.test(r.scriptDigest) || r.policyDigest !== SCRIPT_POLICY_DIGEST) invalid();
  return { scriptVersionId: scriptVersionId(r.scriptVersionId), skillId: scriptOpaqueId(r.skillId),
    skillVersionId: scriptOpaqueId(r.skillVersionId), revision: scriptRevision(r.revision),
    scriptDigest: r.scriptDigest, policyDigest: r.policyDigest };
}
/** Canonical JSON never invokes getters/toJSON and rejects proxies and sparse/decorated arrays. */
export function scriptInputCanonical(raw: unknown, maxBytes = 16384): string {
  let entries = 0;
  const ancestors = new Set<object>();
  function visit(v: unknown, depth: number): string {
    if (depth > 16) invalid();
    if (v === null) return 'null';
    if (typeof v === 'string') return JSON.stringify(scriptText(v));
    if (typeof v === 'boolean') return String(v);
    if (typeof v === 'number') { if (!Number.isFinite(v)) invalid(); return JSON.stringify(v); }
    if (!v || typeof v !== 'object' || types.isProxy(v) || ancestors.has(v)) invalid();
    ancestors.add(v);
    const d = Object.getOwnPropertyDescriptors(v);
    let result: string;
    if (Array.isArray(v)) {
      if (Object.getPrototypeOf(v) !== Array.prototype || Reflect.ownKeys(v).length !== v.length + 1 || (entries += v.length) > 2048) invalid();
      const items: string[] = [];
      for (let i = 0; i < v.length; i++) {
        if (!d[String(i)]?.enumerable || !('value' in d[String(i)])) invalid();
        items.push(visit(d[String(i)].value, depth + 1));
      }
      result = '[' + items.join(',') + ']';
    } else {
      if (![Object.prototype, null].includes(Object.getPrototypeOf(v))) invalid();
      const keys = Reflect.ownKeys(v);
      if ((entries += keys.length) > 2048 || keys.some(k => typeof k !== 'string' || dangerous.has(k) || !d[k].enumerable || !('value' in d[k]))) invalid();
      result = '{' + (keys as string[]).sort().map(k => JSON.stringify(scriptText(k)) + ':' + visit(d[k].value, depth + 1)).join(',') + '}';
    }
    ancestors.delete(v);
    if (Buffer.byteLength(result, 'utf8') > maxBytes) invalid();
    return result;
  }
  const canonical = visit(raw, 0);
  if (Buffer.byteLength(canonical, 'utf8') > maxBytes) invalid();
  return canonical;
}
export function scriptRequestHash(ref: ScriptRef, input: unknown): string {
  const r = scriptRef(ref);
  return scriptSha256(JSON.stringify(['personal-script-v1', r.scriptVersionId, r.skillId, r.skillVersionId,
    r.revision, r.scriptDigest, r.policyDigest, scriptInputCanonical(input)]));
}
/** Strict raw JSON scanner: duplicate keys must be rejected before JSON.parse loses evidence.
 * Output callers retain the original bytes; canonical serialization is only validation. */
export function parseScriptJson(bytes: Buffer, maxBytes = 65536): unknown {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > maxBytes) invalid();
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); } catch { return invalid(); }
  let p = 0, entries = 0;
  const ws = () => { while (/[\x20\t\r\n]/.test(text[p] ?? '') && p < text.length) p++; };
  function string(): string {
    const start = p++;
    while (p < text.length) {
      const c = text[p++];
      if (c === '"') { try { return scriptText(JSON.parse(text.slice(start, p))); } catch { return invalid(); } }
      if (c === '\\') p++;
    }
    return invalid();
  }
  function value(depth: number): void {
    if (depth > 16) invalid(); ws();
    if (text[p] === '"') { string(); return; }
    if (text[p] === '{' || text[p] === '[') {
      const object = text[p++] === '{', close = object ? '}' : ']'; const keys = new Set<string>(); ws();
      if (text[p] === close) { p++; return; }
      for (;;) {
        if (++entries > 2048) invalid(); ws();
        if (object) {
          if (text[p] !== '"') invalid(); const key = string();
          if (keys.has(key) || dangerous.has(key)) invalid(); keys.add(key); ws(); if (text[p++] !== ':') invalid();
        }
        value(depth + 1); ws(); if (text[p] === close) { p++; return; }
        if (text[p++] !== ',') invalid();
      }
    }
    const token = /^(?:null|true|false|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/.exec(text.slice(p));
    if (!token) invalid(); p += token[0].length;
  }
  value(0); ws(); if (p !== text.length) invalid();
  let result: unknown; try { result = JSON.parse(text); } catch { return invalid(); }
  scriptInputCanonical(result, maxBytes); return result;
}
