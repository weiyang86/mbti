import { createHash } from 'node:crypto';
import { types } from 'node:util';
import type { PythonSandboxOutcome } from './python-sandbox-runner';
export const SCRIPT_JOB = 'aij-ai.personal-script-execute';
export const SCRIPT_POLICY = Object.freeze({ version: 'aij-private-python-json-v1', language: 'python', sourceBytes: 65536, inputBytes: 16384, outputBytes: 65536, depth: 16, entries: 2048, timeoutMs: 30000, network: 'none', tools: [], attachments: [] });
export const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export const POLICY_DIGEST = digest(JSON.stringify(SCRIPT_POLICY));
export type ScriptRef = { scriptVersionId: string; skillId: string; skillVersionId: string; revision: number; scriptDigest: string; policyDigest: string };
export type ScriptOutcome = PythonSandboxOutcome | 'DENIED' | 'UNKNOWN' | 'INVALID_OUTPUT';
export type ScriptArtifact = { assetId: string; mimeType: 'application/json'; originalName: string; size: number; checksum: string; createdAt: string };
export type ScriptRun = { id: string; script: ScriptRef; jobId: string; jobStatus: string; outcome: ScriptOutcome | null; attempted: boolean; result: ScriptArtifact | null; createdAt: string; expiresAt: string };
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const unicode = (v: string) => Buffer.from(v).toString('utf8') === v;
const invalid = (): never => { throw new Error('SCRIPT_INVALID_INPUT'); };
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype || Object.getOwnPropertySymbols(value).length) return invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.values(descriptors).some(d => !('value' in d) || !d.enumerable)) return invalid();
  return value as Record<string, unknown>;
}
export function exact(value: unknown, keys: string[]): Record<string, unknown> {
  const v = object(value); if (Object.keys(v).length !== keys.length || keys.some(k => !Object.hasOwn(v, k))) return invalid(); return v;
}
export function identifier(v: unknown): string { if (typeof v !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(v)) return invalid(); return v; }
export function uuid(v: unknown): string { if (typeof v !== 'string' || !UUID.test(v)) return invalid(); return v; }
export function requestKey(v: unknown): string { if (typeof v !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(v)) return invalid(); return v; }
export function scriptRef(value: unknown): ScriptRef {
  const r = exact(value, ['scriptVersionId','skillId','skillVersionId','revision','scriptDigest','policyDigest']);
  uuid(r.scriptVersionId); identifier(r.skillId); identifier(r.skillVersionId);
  if (!Number.isInteger(r.revision) || Number(r.revision) < 1 || Number(r.revision) > 2147483647 || typeof r.scriptDigest !== 'string' || !/^[a-f0-9]{64}$/.test(r.scriptDigest) || r.policyDigest !== POLICY_DIGEST) return invalid();
  return { scriptVersionId: r.scriptVersionId as string, skillId: r.skillId as string, skillVersionId: r.skillVersionId as string, revision: r.revision as number, scriptDigest: r.scriptDigest, policyDigest: POLICY_DIGEST };
}
/** Value validator never invokes getters, toJSON or proxy traps. Object order is canonical. */
export function canonical(value: unknown, maxBytes = 16384): string {
  let entries = 0; const seen = new Set<object>();
  const walk = (v: unknown, depth: number): string => {
    if (depth > 16) return invalid();
    if (v === null || typeof v === 'boolean') return JSON.stringify(v);
    if (typeof v === 'number') { if (!Number.isFinite(v)) return invalid(); return JSON.stringify(v); }
    if (typeof v === 'string') { if (!unicode(v)) return invalid(); return JSON.stringify(v); }
    if (!v || typeof v !== 'object' || types.isProxy(v) || seen.has(v)) return invalid();
    seen.add(v); let result: string;
    if (Array.isArray(v)) {
      if (Object.getPrototypeOf(v) !== Array.prototype || Object.getOwnPropertySymbols(v).length || Object.keys(v).length !== v.length || Object.getOwnPropertyNames(v).length !== v.length + 1) return invalid();
      entries += v.length; if (entries > 2048) return invalid();
      const parts: string[] = [];
      for (let i = 0; i < v.length; i++) { const d = Object.getOwnPropertyDescriptor(v, String(i)); if (!d || !('value' in d) || !d.enumerable) return invalid(); parts.push(walk(d.value, depth + 1)); }
      result = '[' + parts.join(',') + ']';
    } else {
      const record = object(v), keys = Object.keys(record).sort(); entries += keys.length; if (entries > 2048) return invalid();
      result = '{' + keys.map(k => { if (!unicode(k) || ['__proto__','constructor','prototype'].includes(k)) return invalid(); return JSON.stringify(k) + ':' + walk(record[k], depth + 1); }).join(',') + '}';
    }
    seen.delete(v); if (Buffer.byteLength(result) > maxBytes) return invalid(); return result;
  };
  const result = walk(value, 0); if (Buffer.byteLength(result) > maxBytes) return invalid(); return result;
}
export function outputBytes(stdout: string): Buffer {
  if (typeof stdout !== 'string' || !unicode(stdout) || Buffer.byteLength(stdout) > 65536) return invalid();
  const parsed: unknown = JSON.parse(stdout);
  // JSON.parse establishes grammar; token walk rejects duplicate decoded keys at every object depth.
  const stack: { keys: Set<string> | null; key: boolean }[] = [];
  for (const token of stdout.match(/"(?:\\.|[^"\\])*"|[{}[\]:,]/g) ?? []) {
    const top = stack.at(-1);
    if (token === '{' || token === '[') stack.push({ keys: token === '{' ? new Set() : null, key: true });
    else if (token === '}' || token === ']') stack.pop();
    else if (token === ':') { if (top) top.key = false; }
    else if (token === ',') { if (top) top.key = true; }
    else if (top?.keys && top.key) { const k = JSON.parse(token) as string; if (top.keys.has(k)) return invalid(); top.keys.add(k); }
  }
  canonical(parsed, 65536); return Buffer.from(stdout);
}
export function requestHash(ref: ScriptRef, inputCanonical: string): string {
  return digest(JSON.stringify(['personal-script-v1', ref.scriptVersionId, ref.skillId, ref.skillVersionId, ref.revision, ref.scriptDigest, ref.policyDigest, inputCanonical]));
}
