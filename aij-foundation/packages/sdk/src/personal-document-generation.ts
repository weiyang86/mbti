import type { ClientApi } from './index.js';

// Wire types only; admission and execution remain with the original server owners.
export type DocumentSectionSelector = Readonly<{
  documentId: string; expectedRevision: number; bodySha256: string; sectionId: string;
}>;
export type DocumentSectionRef = Readonly<{
  format: 'aij-document-section-source-v1'; indexFormat: 'aij-plain-sections-v1'; documentId: string;
  revision: number; bodySha256: string; sectionId: string; start: number; end: number; sectionSha256: string;
}>;
export type DocumentGenerationRef = Readonly<{
  format: 'aij-document-generation-v1'; document: DocumentSectionRef; agentId: string; agentVersionId: string;
  agentRevision: number; agentPublicationEpoch: number; catalogVersion: number; modelCode: string;
  modelRevision: number; instructionSha256: string; inputSha256: string; maximumEstimatedCostNanos: string;
}>;
export type DocumentGenerationPreviewBody = DocumentSectionSelector & Readonly<{ agentId: string; agentRevision: number; instruction: string }>;
export type DocumentGenerationSubmitBody = Readonly<{ origin: DocumentGenerationRef; instruction: string; idempotencyKey: string }>;

function invalid(): never { throw new TypeError('Invalid document generation data'); }
/** Snapshot descriptors without evaluating getters, including on nested objects. */
function documentGenerationObject(raw: unknown, keys: readonly string[]): Record<string, unknown> {
  try {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) invalid();
    const proto = Object.getPrototypeOf(raw), descriptors = Object.getOwnPropertyDescriptors(raw);
    const own = Reflect.ownKeys(descriptors);
    if (proto !== Object.prototype && proto !== null || own.length !== keys.length ||
      own.some(k => typeof k !== 'string' || !keys.includes(k))) invalid();
    const copy: Record<string, unknown> = Object.create(null);
    for (const key of keys) {
      const d = descriptors[key];
      if (!d?.enumerable || !Object.hasOwn(d, 'value')) invalid();
      copy[key] = d.value;
    }
    return copy;
  } catch { return invalid(); }
}
function documentGenerationInteger(raw: unknown, min = 1, max = 2147483647): number {
  if (typeof raw !== 'number' || !Number.isInteger(raw) || Object.is(raw, -0) || raw < min || raw > max) invalid();
  return raw;
}
function documentGenerationOpaque(raw: unknown, min = 1): string {
  if (typeof raw !== 'string' || !(min === 8 ? /^[A-Za-z0-9_-]{8,128}$/ : /^[A-Za-z0-9_-]{1,128}$/).test(raw)) invalid();
  return raw;
}
function documentId(raw: unknown): string {
  if (typeof raw !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raw)) invalid();
  return raw.toLowerCase();
}
function agentId(raw: unknown): string {
  if (typeof raw !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(raw)) invalid();
  return raw;
}
function hash(raw: unknown): string {
  if (typeof raw !== 'string' || !/^[0-9a-f]{64}$/.test(raw)) invalid();
  return raw;
}
function sectionId(raw: unknown): string {
  if (typeof raw !== 'string' || !/^section-(?:0|[1-9][0-9]{0,2})$/.test(raw) || Number(raw.slice(8)) > 127) invalid();
  return raw;
}
function documentGenerationCost(raw: unknown): string {
  if (typeof raw !== 'string' || !/^(?:0|[1-9][0-9]{0,18})$/.test(raw) || BigInt(raw) > BigInt('9223372036854775807')) invalid();
  return raw;
}
function instruction(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > 2000) invalid();
  return raw;
}
function parseDocumentGenerationSectionRef(raw: unknown): DocumentSectionRef {
  const b = documentGenerationObject(raw, ['format', 'indexFormat', 'documentId', 'revision', 'bodySha256', 'sectionId', 'start', 'end', 'sectionSha256']);
  if (b.format !== 'aij-document-section-source-v1' || b.indexFormat !== 'aij-plain-sections-v1') invalid();
  const start = documentGenerationInteger(b.start, 0, 65536), end = documentGenerationInteger(b.end, 1, 65536);
  if (start >= end || end - start > 2000) invalid();
  return Object.freeze({ format: b.format, indexFormat: b.indexFormat, documentId: documentId(b.documentId),
    revision: documentGenerationInteger(b.revision, 1, 200), bodySha256: hash(b.bodySha256), sectionId: sectionId(b.sectionId), start, end, sectionSha256: hash(b.sectionSha256) });
}
function parseDocumentGenerationRef(raw: unknown): DocumentGenerationRef {
  const b = documentGenerationObject(raw, ['format', 'document', 'agentId', 'agentVersionId', 'agentRevision', 'agentPublicationEpoch',
    'catalogVersion', 'modelCode', 'modelRevision', 'instructionSha256', 'inputSha256', 'maximumEstimatedCostNanos']);
  if (b.format !== 'aij-document-generation-v1' || typeof b.modelCode !== 'string' || !/^[a-z][a-z0-9-]{1,62}$/.test(b.modelCode)) invalid();
  return Object.freeze({ format: b.format, document: parseDocumentGenerationSectionRef(b.document), agentId: agentId(b.agentId),
    agentVersionId: documentGenerationOpaque(b.agentVersionId), agentRevision: documentGenerationInteger(b.agentRevision),
    agentPublicationEpoch: documentGenerationInteger(b.agentPublicationEpoch), catalogVersion: documentGenerationInteger(b.catalogVersion),
    modelCode: b.modelCode, modelRevision: documentGenerationInteger(b.modelRevision), instructionSha256: hash(b.instructionSha256),
    inputSha256: hash(b.inputSha256), maximumEstimatedCostNanos: documentGenerationCost(b.maximumEstimatedCostNanos) });
}
function parseDocumentGenerationPreview(raw: unknown): DocumentGenerationPreviewBody {
  const b = documentGenerationObject(raw, ['documentId', 'expectedRevision', 'bodySha256', 'sectionId', 'agentId', 'agentRevision', 'instruction']);
  return Object.freeze({ documentId: documentId(b.documentId), expectedRevision: documentGenerationInteger(b.expectedRevision, 1, 200),
    bodySha256: hash(b.bodySha256), sectionId: sectionId(b.sectionId), agentId: agentId(b.agentId),
    agentRevision: documentGenerationInteger(b.agentRevision), instruction: instruction(b.instruction) });
}
function parseDocumentGenerationSubmit(raw: unknown): DocumentGenerationSubmitBody {
  const b = documentGenerationObject(raw, ['origin', 'instruction', 'idempotencyKey']);
  return Object.freeze({ origin: parseDocumentGenerationRef(b.origin), instruction: instruction(b.instruction), idempotencyKey: documentGenerationOpaque(b.idempotencyKey, 8) });
}

export type DocumentGenerationStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'unknown';
export type DocumentGenerationBudgetStatus = 'reserved' | 'settled' | 'released';
export type DocumentGenerationPreview = Readonly<{
  origin: DocumentGenerationRef; inputFields: readonly ['source', 'instruction']; modelExecutionConfigured: boolean;
}>;
export type DocumentGenerationRun = Readonly<{
  id: string; agentCode: string; status: DocumentGenerationStatus; output: string | null; failureCode: string | null;
  estimatedCostNanos: string; budgetStatus: DocumentGenerationBudgetStatus; imageAssetId: null; createdAt: string; expiresAt: string;
}>;
export type DocumentGenerationRunEnvelope = Readonly<{ run: DocumentGenerationRun; origin: DocumentGenerationRef }>;
export type DocumentGenerationRequest = Readonly<{
  id: string; agentCode: string; status: DocumentGenerationStatus; budgetStatus: DocumentGenerationBudgetStatus;
  createdAt: string; expiresAt: string; contentAvailable: boolean;
}>;
export type DocumentGenerationRecovery = Readonly<{ request: DocumentGenerationRequest; origin: DocumentGenerationRef; documentCurrent: boolean }>;

function iso(raw: unknown): string {
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(raw) ||
    !Number.isFinite(Date.parse(raw)) || new Date(raw).toISOString() !== raw) invalid();
  return raw;
}
function identity(b: Record<string, unknown>, ref: DocumentGenerationRef, expectedId?: string) {
  const id = documentGenerationOpaque(b.id), status = b.status, budgetStatus = b.budgetStatus;
  if (expectedId !== undefined && id !== expectedId || b.agentCode !== 'personal:' + ref.agentId ||
    typeof status !== 'string' || !['queued', 'running', 'succeeded', 'failed', 'unknown'].includes(status) ||
    budgetStatus !== (status === 'succeeded' ? 'settled' : status === 'failed' ? 'released' : 'reserved')) invalid();
  const createdAt = iso(b.createdAt), expiresAt = iso(b.expiresAt);
  if (createdAt >= expiresAt) invalid();
  return { id, agentCode: b.agentCode as string, status: status as DocumentGenerationStatus,
    budgetStatus: budgetStatus as DocumentGenerationBudgetStatus, createdAt, expiresAt };
}
function previewResult(raw: unknown, body: DocumentGenerationPreviewBody): DocumentGenerationPreview {
  const b = documentGenerationObject(raw, ['origin', 'inputFields', 'modelExecutionConfigured']);
  const origin = parseDocumentGenerationRef(b.origin), d = origin.document, f = b.inputFields;
  // A fixed dense array; never evaluate an accessor while checking the tuple.
  try {
    if (!Array.isArray(f) || Object.getPrototypeOf(f) !== Array.prototype) invalid();
    const descriptors = Object.getOwnPropertyDescriptors(f as object);
    if (Reflect.ownKeys(descriptors).length !== 3 || descriptors.length.value !== 2 ||
      !descriptors['0']?.enumerable || !Object.hasOwn(descriptors['0'], 'value') || descriptors['0'].value !== 'source' ||
      !descriptors['1']?.enumerable || !Object.hasOwn(descriptors['1'], 'value') || descriptors['1'].value !== 'instruction') invalid();
  } catch { invalid(); }
  if (typeof b.modelExecutionConfigured !== 'boolean' || d.documentId !== body.documentId || d.revision !== body.expectedRevision ||
    d.bodySha256 !== body.bodySha256 || d.sectionId !== body.sectionId || origin.agentId !== body.agentId || origin.agentRevision !== body.agentRevision) invalid();
  return Object.freeze({ origin, inputFields: Object.freeze(['source', 'instruction'] as const), modelExecutionConfigured: b.modelExecutionConfigured });
}
function runResult(raw: unknown, expectedId?: string, expectedOrigin?: DocumentGenerationRef): DocumentGenerationRunEnvelope {
  const b = documentGenerationObject(raw, ['run', 'origin']), origin = parseDocumentGenerationRef(b.origin);
  if (expectedOrigin && JSON.stringify(origin) !== JSON.stringify(expectedOrigin)) invalid();
  const r = documentGenerationObject(b.run, ['id', 'agentCode', 'status', 'output', 'failureCode', 'estimatedCostNanos', 'budgetStatus', 'imageAssetId', 'createdAt', 'expiresAt']);
  const i = identity(r, origin, expectedId);
  if (r.imageAssetId !== null || (i.status === 'succeeded' ? typeof r.output !== 'string' || r.output.length > 64000 : r.output !== null) ||
    (i.status === 'failed' || i.status === 'unknown' ? typeof r.failureCode !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(r.failureCode) : r.failureCode !== null)) invalid();
  const estimatedCostNanos = documentGenerationCost(r.estimatedCostNanos);
  if (i.status === 'failed' && estimatedCostNanos !== '0') invalid();
  return Object.freeze({ run: Object.freeze({ id: i.id, agentCode: i.agentCode, status: i.status, output: r.output as string | null,
    failureCode: r.failureCode as string | null, estimatedCostNanos, budgetStatus: i.budgetStatus, imageAssetId: null,
    createdAt: i.createdAt, expiresAt: i.expiresAt }), origin });
}
function recoveryResult(raw: unknown): DocumentGenerationRecovery {
  const b = documentGenerationObject(raw, ['request', 'origin', 'documentCurrent']), origin = parseDocumentGenerationRef(b.origin);
  const r = documentGenerationObject(b.request, ['id', 'agentCode', 'status', 'budgetStatus', 'createdAt', 'expiresAt', 'contentAvailable']);
  const i = identity(r, origin);
  if (typeof b.documentCurrent !== 'boolean' || typeof r.contentAvailable !== 'boolean') invalid();
  return Object.freeze({ request: Object.freeze({ ...i, contentAvailable: r.contentAvailable }), origin, documentCurrent: b.documentCurrent });
}
function scope(raw: unknown): string { return documentGenerationOpaque(raw); }
function signalValue(raw: unknown): AbortSignal | undefined {
  if (raw === undefined) return undefined;
  try {
    const get = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')?.get;
    if (!get) invalid();
    get.call(raw);
  } catch { invalid(); }
  return raw as AbortSignal;
}
async function instructionDigest(raw: string): Promise<string> {
  try {
    const bytes = new TextEncoder().encode(raw);
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('');
  } catch { return invalid(); }
}

/** Each explicit operation makes one original ClientApi request. No retry, polling, cache or storage. */
export function createPersonalDocumentGenerationClient(api: ClientApi) {
  if (typeof api !== 'function') invalid();
  return Object.freeze({
    async preview(workspaceId: string, raw: DocumentGenerationPreviewBody, signal?: AbortSignal): Promise<DocumentGenerationPreview> {
      const workspaceIdValue = scope(workspaceId), body = parseDocumentGenerationPreview(raw), abort = signalValue(signal);
      const result = await api<unknown>('/client/ai/document-generations/preview', {
        method: 'POST', workspaceId: workspaceIdValue, body: JSON.stringify(body), signal: abort, cache: 'no-store'
      });
      const decoded = previewResult(result, body);
      if (decoded.origin.instructionSha256 !== await instructionDigest(body.instruction)) invalid();
      return decoded;
    },
    async submit(workspaceId: string, raw: DocumentGenerationSubmitBody, signal?: AbortSignal): Promise<DocumentGenerationRunEnvelope> {
      const workspaceIdValue = scope(workspaceId), body = parseDocumentGenerationSubmit(raw), abort = signalValue(signal);
      const result = await api<unknown>('/client/ai/document-generations', {
        method: 'POST', workspaceId: workspaceIdValue, body: JSON.stringify(body), signal: abort, cache: 'no-store'
      });
      return runResult(result, undefined, body.origin);
    },
    async read(workspaceId: string, id: string, signal?: AbortSignal): Promise<DocumentGenerationRunEnvelope> {
      const workspaceIdValue = scope(workspaceId), target = documentGenerationOpaque(id), abort = signalValue(signal);
      return runResult(await api<unknown>('/client/ai/document-generation-runs/' + encodeURIComponent(target), {
        method: 'GET', workspaceId: workspaceIdValue, signal: abort, cache: 'no-store'
      }), target);
    },
    async recover(workspaceId: string, key: string, signal?: AbortSignal): Promise<DocumentGenerationRecovery> {
      const workspaceIdValue = scope(workspaceId), target = documentGenerationOpaque(key, 8), abort = signalValue(signal);
      return recoveryResult(await api<unknown>('/client/ai/document-generation-requests/' + encodeURIComponent(target), {
        method: 'GET', workspaceId: workspaceIdValue, signal: abort, cache: 'no-store'
      }));
    }
  });
}
