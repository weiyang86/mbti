import type { ClientApi, ClientApiOptions } from './index.js';
import type { ClientBinaryResponse } from './client-binary-response.js';

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

export type ScriptRef = Readonly<{ scriptVersionId: string; skillId: string; skillVersionId: string; revision: number; scriptDigest: string; policyDigest: string }>;
export type ScriptArtifact = Readonly<{ assetId: string; mimeType: 'application/json'; originalName: string; size: number; checksum: string; createdAt: string }>;
export type ScriptOutcome = 'SUCCESS' | 'DISABLED' | 'INVALID_CONFIGURATION' | 'INVALID_INPUT' | 'BUSY' | 'ABORTED' | 'TIMEOUT' | 'OUTPUT_LIMIT' | 'INVALID_UTF8' | 'IMAGE_UNAVAILABLE' | 'EXECUTION_FAILED' | 'SCRIPT_NONZERO' | 'OOM_KILLED' | 'CLEANUP_UNCONFIRMED' | 'DENIED' | 'UNKNOWN' | 'INVALID_OUTPUT';
export type ScriptRun = Readonly<{ id: string; script: ScriptRef; jobId: string; jobStatus: string; outcome: ScriptOutcome | null; attempted: boolean; result: ScriptArtifact | null; createdAt: string; expiresAt: string }>;
export type ScriptCapability = Readonly<{ configured: boolean; canExecute: boolean; reason: 'ready' | 'not_configured' | 'not_permitted' }>;
export type ScriptCreateInput = Readonly<{ skillId: string; expectedRevision: number; name: string; instructions: string; scriptSource: string }>;
export type ScriptSubmitInput = Readonly<{ scriptVersionId: string; input: unknown; idempotencyKey: string }>;
export type ScriptExecutionOptions = Readonly<{ signal?: AbortSignal }>;
const OUTCOMES: readonly string[] = ['SUCCESS','DISABLED','INVALID_CONFIGURATION','INVALID_INPUT','BUSY','ABORTED','TIMEOUT','OUTPUT_LIMIT','INVALID_UTF8','IMAGE_UNAVAILABLE','EXECUTION_FAILED','SCRIPT_NONZERO','OOM_KILLED','CLEANUP_UNCONFIRMED','DENIED','UNKNOWN','INVALID_OUTPUT'];
function digest(raw: unknown): string { const v = text(raw); if (!/^[0-9a-f]{64}$/.test(v)) invalid(); return v; }
function iso(raw: unknown): string { const v = text(raw); if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v) || !Number.isFinite(Date.parse(v)) || new Date(v).toISOString() !== v) invalid(); return v; }
const POLICY_DIGEST = 'f069cddadeaa30648a61bc2bcc93a817c9f4147c3d3f808936b30db7e12c4aef';
export function parseScriptRef(raw: unknown): ScriptRef {
  const b = object(raw, ['scriptVersionId','skillId','skillVersionId','revision','scriptDigest','policyDigest']);
  if (b.policyDigest !== POLICY_DIGEST) invalid();
  return Object.freeze({ scriptVersionId: uuid(b.scriptVersionId), skillId: id(b.skillId), skillVersionId: id(b.skillVersionId), revision: counter(b.revision), scriptDigest: digest(b.scriptDigest), policyDigest: b.policyDigest });
}
export function parseScriptRun(raw: unknown): ScriptRun {
  const b = object(raw, ['id','script','jobId','jobStatus','outcome','attempted','result','createdAt','expiresAt']);
  const runId = uuid(b.id), script = parseScriptRef(b.script), jobId = uuid(b.jobId), createdAt = iso(b.createdAt), expiresAt = iso(b.expiresAt);
  if (expiresAt <= createdAt || typeof b.attempted !== 'boolean' || !['pending','running','retry','completed','failed','dead','cancelled'].includes(b.jobStatus as string) || (b.outcome !== null && !OUTCOMES.includes(b.outcome as string))) invalid();
  let result: ScriptArtifact | null = null;
  if (b.result !== null) {
    const a = object(b.result, ['assetId','mimeType','originalName','size','checksum','createdAt']);
    if (a.mimeType !== 'application/json' || a.originalName !== 'script-' + runId + '.json') invalid();
    result = Object.freeze({ assetId: uuid(a.assetId), mimeType: a.mimeType, originalName: a.originalName, size: counter(a.size, 65536), checksum: digest(a.checksum), createdAt: iso(a.createdAt) });
    if (result.createdAt < createdAt || result.createdAt >= expiresAt) invalid();
  }
  if ((b.outcome === 'SUCCESS') !== (result !== null) || (b.outcome === 'SUCCESS' && !b.attempted)) invalid();
  return Object.freeze({ id: runId, script, jobId, jobStatus: b.jobStatus as string, outcome: b.outcome as ScriptOutcome | null, attempted: b.attempted, result, createdAt, expiresAt });
}
function capability(raw: unknown): ScriptCapability {
  const b = object(raw, ['configured','canExecute','reason']);
  if (typeof b.configured !== 'boolean' || typeof b.canExecute !== 'boolean' || !['ready','not_configured','not_permitted'].includes(b.reason as string) || b.canExecute !== (b.reason === 'ready') || b.reason === 'not_configured' && b.configured || b.reason === 'ready' && !b.configured) invalid();
  return { configured: b.configured, canExecute: b.canExecute, reason: b.reason as ScriptCapability['reason'] };
}
async function sha256(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes);
  try { return [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', copy))].map(v => v.toString(16).padStart(2, '0')).join(''); }
  finally { copy.fill(0); }
}
/** Private file-content API. No automatic POST retry: recover explicitly by the original key. */
export function createPersonalScriptExecutionClient(api: ClientApi) {
  const base = '/client/script-executions';
  function request(workspace: string, path: string, options?: ScriptExecutionOptions, body?: unknown, binary = false) {
    id(workspace);
    if (options !== undefined) { const o = object(options); if (Object.keys(o).some(k => k !== 'signal') || (o.signal !== undefined && !(o.signal instanceof AbortSignal))) invalid(); }
    const init: ClientApiOptions = { method: body === undefined ? 'GET' : 'POST', workspaceId: workspace, cache: 'no-store',
      ...(options?.signal === undefined ? {} : { signal: options.signal }), ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      ...(binary ? { responseKind: 'binary' as const, maxResponseBytes: 65536 } : {}) };
    return api<unknown>(base + path, init);
  }
  return {
    async createVersion(workspace: string, input: ScriptCreateInput, options?: ScriptExecutionOptions): Promise<ScriptRef> {
      const b = createInput(input), ref = parseScriptRef(await request(workspace, '/versions', options, b));
      if (ref.skillId !== b.skillId || ref.revision !== b.expectedRevision + 1 || ref.scriptDigest !== await sha256(new TextEncoder().encode(b.scriptSource))) invalid(); return ref;
    },
    async version(workspace: string, versionId: string, options?: ScriptExecutionOptions): Promise<{ ref: ScriptRef; scriptSource: string }> {
      uuid(versionId); const b = object(await request(workspace, '/versions/' + versionId, options), ['ref','scriptSource']);
      const ref = parseScriptRef(b.ref), scriptSource = source(b.scriptSource);
      if (ref.scriptVersionId !== versionId || ref.scriptDigest !== await sha256(new TextEncoder().encode(scriptSource))) invalid(); return { ref, scriptSource };
    },
    async capability(workspace: string, options?: ScriptExecutionOptions): Promise<ScriptCapability> { return capability(await request(workspace, '/capability', options)); },
    async submit(workspace: string, input: ScriptSubmitInput, options?: ScriptExecutionOptions): Promise<ScriptRun> {
      const b = submitInput(input), run = parseScriptRun(await request(workspace, '/runs', options, b)); if (run.script.scriptVersionId !== b.scriptVersionId) invalid(); return run;
    },
    async recover(workspace: string, requestKey: string, options?: ScriptExecutionOptions): Promise<ScriptRun> { key(requestKey); return parseScriptRun(await request(workspace, '/requests/' + requestKey, options)); },
    async read(workspace: string, runId: string, options?: ScriptExecutionOptions): Promise<ScriptRun> {
      uuid(runId); const run = parseScriptRun(await request(workspace, '/runs/' + runId, options)); if (run.id !== runId) invalid(); return run;
    },
    async download(workspace: string, expectedRun: ScriptRun, options?: ScriptExecutionOptions) {
      const run = parseScriptRun(expectedRun), meta = run.result; if (run.outcome !== 'SUCCESS' || !run.attempted || !meta) invalid();
      const raw = await request(workspace, '/runs/' + run.id + '/content', options, undefined, true) as ClientBinaryResponse;
      let success = false;
      try {
        if (!raw || !(raw.bytes instanceof Uint8Array) || !(raw.headers instanceof Headers) || raw.bytes.length !== meta.size || raw.headers.has('content-encoding')) invalid();
        for (const [k, v] of Object.entries({ 'content-type': 'application/json', 'content-length': String(meta.size), 'content-disposition': `attachment; filename="${meta.originalName}"`,
          'x-aij-script-run-id': run.id, 'x-aij-script-version-id': run.script.scriptVersionId, 'x-aij-asset-id': meta.assetId, 'x-aij-checksum-sha256': meta.checksum, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' })) if (raw.headers.get(k) !== v) invalid();
        parseJsonDocument(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(raw.bytes), 65536);
        if (options?.signal?.aborted || await sha256(raw.bytes) !== meta.checksum || options?.signal?.aborted) invalid();
        success = true; return { bytes: raw.bytes, filename: meta.originalName, mimeType: meta.mimeType, checksum: meta.checksum };
      } finally { if (!success && raw?.bytes instanceof Uint8Array) raw.bytes.fill(0); }
    }
  };
}
export type PersonalScriptExecutionClient = ReturnType<typeof createPersonalScriptExecutionClient>;
