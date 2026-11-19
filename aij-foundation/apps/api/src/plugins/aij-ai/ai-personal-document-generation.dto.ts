import { BadRequestException } from '@nestjs/common';

// Transport structures only. The document/runtime owners revalidate the current source in their transaction.
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

function invalid(): never { throw new BadRequestException('Invalid document generation request'); }
/** Snapshot descriptors without evaluating getters, including on nested objects. */
export function documentGenerationObject(raw: unknown, keys: readonly string[]): Record<string, unknown> {
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
export function documentGenerationInteger(raw: unknown, min = 1, max = 2147483647): number {
  if (typeof raw !== 'number' || !Number.isInteger(raw) || Object.is(raw, -0) || raw < min || raw > max) invalid();
  return raw;
}
export function documentGenerationOpaque(raw: unknown, min = 1): string {
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
export function documentGenerationCost(raw: unknown): string {
  if (typeof raw !== 'string' || !/^(?:0|[1-9][0-9]{0,18})$/.test(raw) || BigInt(raw) > 9223372036854775807n) invalid();
  return raw;
}
function instruction(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > 2000) invalid();
  return raw;
}
export function parseDocumentGenerationSectionRef(raw: unknown): DocumentSectionRef {
  const b = documentGenerationObject(raw, ['format', 'indexFormat', 'documentId', 'revision', 'bodySha256', 'sectionId', 'start', 'end', 'sectionSha256']);
  if (b.format !== 'aij-document-section-source-v1' || b.indexFormat !== 'aij-plain-sections-v1') invalid();
  const start = documentGenerationInteger(b.start, 0, 65536), end = documentGenerationInteger(b.end, 1, 65536);
  if (start >= end || end - start > 2000) invalid();
  return Object.freeze({ format: b.format, indexFormat: b.indexFormat, documentId: documentId(b.documentId),
    revision: documentGenerationInteger(b.revision, 1, 200), bodySha256: hash(b.bodySha256), sectionId: sectionId(b.sectionId), start, end, sectionSha256: hash(b.sectionSha256) });
}
export function parseDocumentGenerationRef(raw: unknown): DocumentGenerationRef {
  const b = documentGenerationObject(raw, ['format', 'document', 'agentId', 'agentVersionId', 'agentRevision', 'agentPublicationEpoch',
    'catalogVersion', 'modelCode', 'modelRevision', 'instructionSha256', 'inputSha256', 'maximumEstimatedCostNanos']);
  if (b.format !== 'aij-document-generation-v1' || typeof b.modelCode !== 'string' || !/^[a-z][a-z0-9-]{1,62}$/.test(b.modelCode)) invalid();
  return Object.freeze({ format: b.format, document: parseDocumentGenerationSectionRef(b.document), agentId: agentId(b.agentId),
    agentVersionId: documentGenerationOpaque(b.agentVersionId), agentRevision: documentGenerationInteger(b.agentRevision),
    agentPublicationEpoch: documentGenerationInteger(b.agentPublicationEpoch), catalogVersion: documentGenerationInteger(b.catalogVersion),
    modelCode: b.modelCode, modelRevision: documentGenerationInteger(b.modelRevision), instructionSha256: hash(b.instructionSha256),
    inputSha256: hash(b.inputSha256), maximumEstimatedCostNanos: documentGenerationCost(b.maximumEstimatedCostNanos) });
}
export function parseDocumentGenerationPreview(raw: unknown): DocumentGenerationPreviewBody {
  const b = documentGenerationObject(raw, ['documentId', 'expectedRevision', 'bodySha256', 'sectionId', 'agentId', 'agentRevision', 'instruction']);
  return Object.freeze({ documentId: documentId(b.documentId), expectedRevision: documentGenerationInteger(b.expectedRevision, 1, 200),
    bodySha256: hash(b.bodySha256), sectionId: sectionId(b.sectionId), agentId: agentId(b.agentId),
    agentRevision: documentGenerationInteger(b.agentRevision), instruction: instruction(b.instruction) });
}
export function parseDocumentGenerationSubmit(raw: unknown): DocumentGenerationSubmitBody {
  const b = documentGenerationObject(raw, ['origin', 'instruction', 'idempotencyKey']);
  return Object.freeze({ origin: parseDocumentGenerationRef(b.origin), instruction: instruction(b.instruction), idempotencyKey: documentGenerationOpaque(b.idempotencyKey, 8) });
}
export function documentGenerationNoBody(body: unknown, headers: { 'content-length'?: unknown; 'transfer-encoding'?: unknown }): void {
  if (body !== undefined || headers['transfer-encoding'] !== undefined ||
    headers['content-length'] !== undefined && headers['content-length'] !== '0') invalid();
}
