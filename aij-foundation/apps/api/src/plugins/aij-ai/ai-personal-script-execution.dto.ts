import { BadRequestException } from '@nestjs/common';

const BAD = ['__proto__', 'constructor', 'prototype'];
function invalid(): never { throw new TypeError('Invalid personal script data'); }
function object(raw: unknown, keys?: readonly string[]): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || ![Object.prototype, null].includes(Object.getPrototypeOf(raw))) invalid();
  const own = Reflect.ownKeys(raw), descriptors = Object.getOwnPropertyDescriptors(raw);
  if ((keys && (own.length !== keys.length || keys.some(k => !Object.hasOwn(raw, k)))) || own.some(k => typeof k !== 'string' || BAD.includes(k) || (keys && !keys.includes(k)) || !descriptors[k]?.enumerable || !('value' in descriptors[k]!))) invalid();
  return raw as Record<string, unknown>;
}
function text(raw: unknown): string {
  if (typeof raw !== 'string' || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(raw)) invalid(); return raw;
}
function id(raw: unknown): string { const v = text(raw); if (!/^[A-Za-z0-9_-]{1,128}$/.test(v) || BAD.includes(v)) invalid(); return v; }
function uuid(raw: unknown): string { const v = text(raw); if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v)) invalid(); return v; }
function counter(raw: unknown, max = 2147483647): number { if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw < 1 || raw > max) invalid(); return raw; }
function key(raw: unknown): string { const v = text(raw); if (!/^[A-Za-z0-9_-]{8,128}$/.test(v)) invalid(); return v; }
function source(raw: unknown): string { const v = text(raw); if (!v.length || v.includes('\0') || new TextEncoder().encode(v).length > 65536) invalid(); return v; }
/** Canonical clone; descriptors are inspected before any value is accessed. */
function strictJson(raw: unknown, limit = 16384, maxDepth = 16, maxEntries = 2048): unknown {
  let entries = 0; const seen = new Set<object>();
  const visit = (v: unknown, depth: number): unknown => {
    if (depth > maxDepth) invalid();
    if (v === null || typeof v === 'boolean') return v;
    if (typeof v === 'string') return text(v);
    if (typeof v === 'number') { if (!Number.isFinite(v)) invalid(); return v; }
    if (!v || typeof v !== 'object' || seen.has(v)) invalid();
    seen.add(v); let result: unknown;
    if (Array.isArray(v)) {
      if (Object.getPrototypeOf(v) !== Array.prototype || Reflect.ownKeys(v).length !== v.length + 1 || (entries += v.length) > maxEntries) invalid();
      const values: unknown[] = [];
      for (let i = 0; i < v.length; i++) { const d = Object.getOwnPropertyDescriptor(v, String(i)); if (!d?.enumerable || !('value' in d)) invalid(); values.push(visit(d.value, depth + 1)); }
      result = values;
    } else {
      const b = object(v), keys = Object.keys(b).sort(); if ((entries += keys.length) > maxEntries) invalid();
      result = Object.fromEntries(keys.map(k => [text(k), visit(b[k], depth + 1)]));
    }
    seen.delete(v); return result;
  };
  const result = visit(raw, 0); if (new TextEncoder().encode(JSON.stringify(result)).length > limit) invalid(); return result;
}
/** Parse exactly one JSON document, rejecting duplicate decoded keys before JSON.parse. */
function parseJsonDocument(value: string, limit: number): unknown {
  text(value); if (new TextEncoder().encode(value).length > limit) invalid();
  const stack: { keys: Set<string> | null; key: boolean }[] = [];
  for (const token of value.match(/"(?:\\[\s\S]|[^"\\])*"|[{}[\]:,]/g) ?? []) {
    const top = stack[stack.length - 1];
    if (token === '{' || token === '[') { if (stack.length > (limit === 102400 ? 17 : 16)) invalid(); stack.push({ keys: token === '{' ? new Set() : null, key: true }); }
    else if (token === '}' || token === ']') stack.pop();
    else if (token === ':') { if (top) top.key = false; }
    else if (token === ',') { if (top) top.key = true; }
    else if (top?.keys && top.key) { const k = JSON.parse(token) as string; if (top.keys.has(k)) invalid(); top.keys.add(k); }
  }
  return strictJson(JSON.parse(value), limit, limit === 102400 ? 17 : 16, limit === 102400 ? 2053 : 2048);
}
function createInput(raw: unknown) {
  const b = object(raw, ['skillId', 'expectedRevision', 'name', 'instructions', 'scriptSource']);
  const name = text(b.name), instructions = text(b.instructions);
  if (!name.trim() || name.trim() !== name || name.length > 100 || !instructions.trim() || instructions.length > 8000 || new TextEncoder().encode(instructions).length > 32768 || name.includes('\0') || instructions.includes('\0')) invalid();
  return { skillId: id(b.skillId), expectedRevision: counter(b.expectedRevision), name, instructions, scriptSource: source(b.scriptSource) };
}
function submitInput(raw: unknown) {
  const b = object(raw, ['scriptVersionId', 'input', 'idempotencyKey']);
  return { scriptVersionId: uuid(b.scriptVersionId), input: strictJson(b.input), idempotencyKey: key(b.idempotencyKey) };
}

export function scriptRequest<T>(parse: () => T): T { try { return parse(); } catch { throw new BadRequestException('Invalid personal script request'); } }
export const scriptObject = (raw: unknown, keys: readonly string[]) => scriptRequest(() => object(raw, keys));
export const scriptId = (raw: unknown) => scriptRequest(() => uuid(raw));
export const scriptKey = (raw: unknown) => scriptRequest(() => key(raw));
export const scriptCreate = (raw: unknown) => scriptRequest(() => createInput(raw));
export const scriptSubmit = (raw: unknown) => scriptRequest(() => submitInput(raw));
export const scriptJson = (raw: string, limit = 102400) => scriptRequest(() => parseJsonDocument(raw, limit));
export function scriptNoBody(body: unknown, headers: { 'content-length'?: unknown; 'transfer-encoding'?: unknown }) {
  if (body !== undefined || headers['transfer-encoding'] !== undefined || (headers['content-length'] !== undefined && headers['content-length'] !== '0')) scriptRequest(invalid);
}
