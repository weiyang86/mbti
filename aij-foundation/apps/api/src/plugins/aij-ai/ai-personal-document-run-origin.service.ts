import { BadRequestException, ConflictException, Injectable, NotFoundException, Optional, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { ClientClaims } from '../../client-auth/client-auth.security';
import { documentId, documentRevision } from '../../documents/personal-documents.dto';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { redactAiExternalText } from './deepseek-provider';

export type DocumentSectionSelector = Readonly<{ documentId: string; expectedRevision: number; bodySha256: string; sectionId: string }>;
export type DocumentSectionRef = Readonly<{ format: 'aij-document-section-source-v1'; indexFormat: 'aij-plain-sections-v1';
  documentId: string; revision: number; bodySha256: string; sectionId: string; start: number; end: number; sectionSha256: string }>;
export type DocumentGenerationRef = Readonly<{ format: 'aij-document-generation-v1'; document: DocumentSectionRef;
  agentId: string; agentVersionId: string; agentRevision: number; agentPublicationEpoch: number; catalogVersion: number;
  modelCode: string; modelRevision: number; instructionSha256: string; inputSha256: string; maximumEstimatedCostNanos: string }>;
export type DocumentGenerationScope = Readonly<{ projectId: string; workspaceId: string; memberId: string }>;
export type DocumentGenerationRun = DocumentGenerationScope & Readonly<{ id: string; snapshot: unknown; input: unknown;
  contentPurgedAt?: Date | null; agentCode?: string; agentRevision?: number; catalogVersion?: number }>;
export type SessionGate = (tx: Prisma.TransactionClient) => Promise<void>;
export type OriginRow = Readonly<{ run_id: string; project_id: string; workspace_id: string; member_id: string;
  document_id: string; document_revision: number; agent_id: string; agent_version_id: string; agent_revision: number;
  ref: DocumentGenerationRef; session_id: string; token_version: number }>;
export abstract class DocumentSourceRuntimePort {
  abstract resolveInTransaction(tx: Prisma.TransactionClient, scope: DocumentGenerationScope, selector: DocumentSectionSelector,
    purpose: 'read' | 'execute', authorize: SessionGate): Promise<{ projectId: string; ref: DocumentSectionRef; text: string }>;
  abstract inspectInTransaction(tx: Prisma.TransactionClient, scope: DocumentGenerationScope, selector: DocumentSectionSelector,
    authorize: SessionGate): Promise<{ projectId: string; documentCurrent: boolean }>;
}
export abstract class DocumentGenerationSessionPort {
  abstract assertSessionInTransaction(tx: Prisma.TransactionClient, claims: ClientClaims): Promise<void>;
}
export abstract class PersonalDocumentRunOriginPort {
  abstract resolveSource(tx: Prisma.TransactionClient, scope: DocumentGenerationScope, selector: DocumentSectionSelector,
    claims: ClientClaims, purpose: 'read' | 'execute'): Promise<{ ref: DocumentSectionRef; text: string }>;
  abstract recordOrigin(tx: Prisma.TransactionClient, run: DocumentGenerationRun, ref: DocumentGenerationRef, claims: ClientClaims): Promise<void>;
  abstract relation(tx: Prisma.TransactionClient, run: DocumentGenerationRun): Promise<OriginRow | undefined>;
  abstract assertOriginCurrent(tx: Prisma.TransactionClient, run: DocumentGenerationRun, readClaims?: ClientClaims): Promise<void>;
  abstract inspectOrigin(tx: Prisma.TransactionClient, run: DocumentGenerationRun, claims: ClientClaims): Promise<{ origin: DocumentGenerationRef; documentCurrent: boolean }>;
}
const unavailable = () => new ServiceUnavailableException('Document generation unavailable');
const mismatch = () => new ConflictException('Document generation origin changed');
const invalid = () => new BadRequestException('Invalid document generation source');
const sectionKeys = ['format', 'indexFormat', 'documentId', 'revision', 'bodySha256', 'sectionId', 'start', 'end', 'sectionSha256'] as const;
const refKeys = ['format', 'document', 'agentId', 'agentVersionId', 'agentRevision', 'agentPublicationEpoch', 'catalogVersion',
  'modelCode', 'modelRevision', 'instructionSha256', 'inputSha256', 'maximumEstimatedCostNanos'] as const;
const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const hex = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f]{64}$/.test(s);
const opaque = (s: unknown): s is string => typeof s === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(s);
const positive = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 2147483647;

/** Inspect descriptors before reading values; never evaluate a caller's accessor. */
export function documentGenerationObject(raw: unknown, keys?: readonly string[]): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || ![Object.prototype, null].includes(Object.getPrototypeOf(raw))) throw invalid();
  const names = Reflect.ownKeys(raw);
  if (names.some(k => typeof k !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(k) ||
    !Object.getOwnPropertyDescriptor(raw, k)?.enumerable || !Object.hasOwn(Object.getOwnPropertyDescriptor(raw, k)!, 'value')) ||
    (keys && (names.length !== keys.length || keys.some(k => !Object.hasOwn(raw, k))))) throw invalid();
  return raw as Record<string, unknown>;
}
/** Snapshot extensions survive comparison, but polluted nested data never reaches spread/JSON. */
function safeData(raw: unknown, seen = new Set<object>(), depth = 0): void {
  if (raw === null || ['string', 'boolean'].includes(typeof raw) || (typeof raw === 'number' && Number.isFinite(raw))) return;
  if (typeof raw !== 'object' || depth > 32 || seen.has(raw)) throw invalid();
  seen.add(raw);
  if (Array.isArray(raw)) {
    if (Object.getPrototypeOf(raw) !== Array.prototype || Reflect.ownKeys(raw).length !== raw.length + 1) throw invalid();
    for (let i = 0; i < raw.length; i++) {
      const d = Object.getOwnPropertyDescriptor(raw, String(i));
      if (!d || !d.enumerable || !('value' in d)) throw invalid();
      safeData(d.value, seen, depth + 1);
    }
  } else for (const v of Object.values(documentGenerationObject(raw))) safeData(v, seen, depth + 1);
  seen.delete(raw);
}
export function parseDocumentSectionSelector(raw: unknown): DocumentSectionSelector {
  const b = documentGenerationObject(raw, ['documentId', 'expectedRevision', 'bodySha256', 'sectionId']);
  if (!hex(b.bodySha256) || typeof b.sectionId !== 'string' || !/^section-(?:0|[1-9][0-9]{0,2})$/.test(b.sectionId) || Number(b.sectionId.slice(8)) > 127) throw invalid();
  return Object.freeze({ documentId: documentId(b.documentId), expectedRevision: documentRevision(b.expectedRevision), bodySha256: b.bodySha256, sectionId: b.sectionId });
}
export function parseDocumentSectionRef(raw: unknown): DocumentSectionRef {
  const b = documentGenerationObject(raw, sectionKeys);
  const selector = parseDocumentSectionSelector({ documentId: b.documentId, expectedRevision: b.revision, bodySha256: b.bodySha256, sectionId: b.sectionId });
  if (b.format !== 'aij-document-section-source-v1' || b.indexFormat !== 'aij-plain-sections-v1' || !hex(b.sectionSha256) ||
    typeof b.start !== 'number' || typeof b.end !== 'number' || !Number.isInteger(b.start) || !Number.isInteger(b.end) || b.start < 0 || b.end <= b.start || b.end > 65536) throw invalid();
  return Object.freeze({ format: b.format, indexFormat: b.indexFormat, documentId: selector.documentId, revision: selector.expectedRevision,
    bodySha256: selector.bodySha256, sectionId: selector.sectionId, start: b.start, end: b.end, sectionSha256: b.sectionSha256 });
}
export function parseDocumentGenerationRef(raw: unknown): DocumentGenerationRef {
  const b = documentGenerationObject(raw, refKeys), document = parseDocumentSectionRef(b.document);
  if (b.format !== 'aij-document-generation-v1' || typeof b.agentId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(b.agentId) || !opaque(b.agentVersionId) ||
    !positive(b.agentRevision) || !positive(b.agentPublicationEpoch) || !positive(b.catalogVersion) || !positive(b.modelRevision) ||
    typeof b.modelCode !== 'string' || !/^[a-z][a-z0-9-]{1,62}$/.test(b.modelCode) || !hex(b.instructionSha256) || !hex(b.inputSha256) ||
    typeof b.maximumEstimatedCostNanos !== 'string' || !/^(?:0|[1-9][0-9]{0,18})$/.test(b.maximumEstimatedCostNanos) || BigInt(b.maximumEstimatedCostNanos) > 9223372036854775807n) throw invalid();
  return Object.freeze({ format: b.format, document, agentId: b.agentId, agentVersionId: b.agentVersionId, agentRevision: b.agentRevision,
    agentPublicationEpoch: b.agentPublicationEpoch, catalogVersion: b.catalogVersion, modelCode: b.modelCode, modelRevision: b.modelRevision,
    instructionSha256: b.instructionSha256, inputSha256: b.inputSha256, maximumEstimatedCostNanos: b.maximumEstimatedCostNanos });
}
function instructionText(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > 2000) throw invalid();
  return raw;
}
function resolvedSource(raw: unknown): { ref: DocumentSectionRef; text: string } {
  const b = documentGenerationObject(raw, ['ref', 'text']), ref = parseDocumentSectionRef(b.ref);
  if (typeof b.text !== 'string' || !b.text.trim() || b.text.length > 2000 || b.text.length !== ref.end - ref.start || sha(b.text) !== ref.sectionSha256) throw invalid();
  return { ref, text: b.text };
}
function snapshotIdentity(raw: unknown) {
  safeData(raw);
  const s = documentGenerationObject(raw), source = documentGenerationObject(s.source), agent = documentGenerationObject(s.agent), model = documentGenerationObject(s.model);
  if (source.type !== 'personal' || Object.hasOwn(source, 'workflowOrigin') ||
    typeof source.agentId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(source.agentId) ||
    !opaque(source.versionId) || !positive(source.revision) || !positive(source.publicationVersion) ||
    agent.code !== 'personal:' + source.agentId || agent.revision !== source.revision || agent.enabled !== true || agent.published !== true ||
    agent.outputFormat !== 'text' || model.capability !== 'text' || model.enabled !== true || agent.modelCode !== model.code ||
    typeof model.code !== 'string' || !/^[a-z][a-z0-9-]{1,62}$/.test(model.code) || !positive(model.revision) ||
    !Array.isArray(agent.inputFields) || agent.inputFields.length !== 2 || !agent.inputFields.includes('source') || !agent.inputFields.includes('instruction')) throw mismatch();
  return { s, source, agent, model };
}
/** Digest the ORIGINAL owner's already-redacted exact two-field input; no second policy. */
export function documentGenerationInputDigest(raw: unknown): string {
  const b = documentGenerationObject(raw, ['source', 'instruction']);
  if (typeof b.source !== 'string' || typeof b.instruction !== 'string') throw mismatch();
  return sha(JSON.stringify([['instruction', b.instruction], ['source', b.source]]));
}
export function makeDocumentGenerationOrigin(resolved: { ref: DocumentSectionRef; text: string }, snapshot: unknown,
  instruction: string, maximumEstimatedCostNanos: string, catalogVersion: number): { ref: DocumentGenerationRef; input: { source: string; instruction: string } } {
  const current = resolvedSource(resolved), raw = instructionText(instruction), { source, model } = snapshotIdentity(snapshot);
  const input = { source: current.text, instruction: raw };
  const ref = parseDocumentGenerationRef({ format: 'aij-document-generation-v1', document: current.ref, agentId: source.agentId,
    agentVersionId: source.versionId, agentRevision: source.revision, agentPublicationEpoch: source.publicationVersion, catalogVersion,
    modelCode: model.code, modelRevision: model.revision, instructionSha256: sha(raw),
    inputSha256: documentGenerationInputDigest({ source: redactAiExternalText(current.text), instruction: redactAiExternalText(raw) }), maximumEstimatedCostNanos });
  return { ref, input };
}
export function documentGenerationRequestHash(raw: DocumentGenerationRef, rawInstruction: string): string {
  const ref = parseDocumentGenerationRef(raw), instruction = instructionText(rawInstruction);
  if (sha(instruction) !== ref.instructionSha256) throw mismatch();
  return sha(JSON.stringify(['personal-document-generation-v1', ref, instruction]));
}
export function documentGenerationClaims(member: string, raw: ClientClaims): ClientClaims {
  const b = documentGenerationObject(raw, ['sub', 'sessionId', 'tokenVersion']);
  if (b.sub !== member || !opaque(b.sub) || !opaque(b.sessionId) || !Number.isSafeInteger(b.tokenVersion) || (b.tokenVersion as number) < 0 || (b.tokenVersion as number) > 2147483647) throw new UnauthorizedException('Invalid client session');
  return Object.freeze({ sub: b.sub, sessionId: b.sessionId, tokenVersion: b.tokenVersion as number });
}
export function documentGenerationMarker(snapshot: unknown): DocumentGenerationRef | undefined {
  if (snapshot === null || snapshot === undefined) return undefined;
  safeData(snapshot);
  const s = documentGenerationObject(snapshot);
  if (!Object.hasOwn(s, 'source')) return undefined;
  const source = documentGenerationObject(s.source);
  return Object.hasOwn(source, 'documentOrigin') ? parseDocumentGenerationRef(source.documentOrigin) : undefined;
}
export function assertDocumentGenerationSnapshot(snapshot: unknown, raw: DocumentGenerationRef): void {
  const ref = parseDocumentGenerationRef(raw), { source, model } = snapshotIdentity(snapshot);
  if (!isDeepStrictEqual(documentGenerationMarker(snapshot), ref) || source.agentId !== ref.agentId || source.versionId !== ref.agentVersionId ||
    source.revision !== ref.agentRevision || source.publicationVersion !== ref.agentPublicationEpoch || model.code !== ref.modelCode || model.revision !== ref.modelRevision) throw mismatch();
}
/** Invoke ONLY after current-origin checks; leave every unknown extension for the owner's deep comparison. */
export function withoutDocumentGenerationMarker(snapshot: unknown, verified: DocumentGenerationRef): unknown {
  assertDocumentGenerationSnapshot(snapshot, verified);
  const s = documentGenerationObject(snapshot), source = { ...documentGenerationObject(s.source) };
  delete source.documentOrigin;
  return { ...s, source };
}
function selectorOf(ref: DocumentSectionRef): DocumentSectionSelector {
  return parseDocumentSectionSelector({ documentId: ref.documentId, expectedRevision: ref.revision, bodySha256: ref.bodySha256, sectionId: ref.sectionId });
}
function scopeOf(raw: DocumentGenerationScope): DocumentGenerationScope {
  const b = documentGenerationObject(raw, ['projectId', 'workspaceId', 'memberId']);
  if (!opaque(b.projectId) || !opaque(b.workspaceId) || !opaque(b.memberId)) throw mismatch();
  return Object.freeze({ projectId: b.projectId, workspaceId: b.workspaceId, memberId: b.memberId });
}
function runScope(r: DocumentGenerationRun): DocumentGenerationScope {
  documentGenerationObject(r);
  return scopeOf({ projectId: r.projectId, workspaceId: r.workspaceId, memberId: r.memberId });
}
type AdmissionProof = { scope: DocumentGenerationScope; ref: DocumentSectionRef; claims: ClientClaims; purpose: 'read' | 'execute'; sourceDigest: string };

@Injectable()
export class AiPersonalDocumentRunOriginService extends PersonalDocumentRunOriginPort {
  // Same-TX source-gate evidence only; weak keys cannot outlive their caller transaction.
  private readonly admissions = new WeakMap<Prisma.TransactionClient, AdmissionProof[]>();
  constructor(@Optional() private readonly documents?: DocumentSourceRuntimePort,
    @Optional() private readonly sessions?: DocumentGenerationSessionPort) { super(); }

  private async authorized<T>(tx: Prisma.TransactionClient, claims: ClientClaims, call: (gate: SessionGate) => Promise<T>): Promise<T> {
    if (!this.documents || !this.sessions || typeof this.sessions.assertSessionInTransaction !== 'function') throw unavailable();
    let calls = 0, completed = 0, open = true, failure: unknown;
    const gate: SessionGate = async t => {
      if (!open || t !== tx || ++calls !== 1) { failure = unavailable(); throw failure; }
      try { await this.sessions!.assertSessionInTransaction(t, claims); completed++; }
      catch (error) { failure = error; throw error; }
    };
    try {
      const result = await call(gate);
      if (failure) throw failure;
      if (calls !== 1 || completed !== 1) throw unavailable();
      return result;
    } finally { open = false; }
  }

  async resolveSource(tx: Prisma.TransactionClient, rawScope: DocumentGenerationScope, rawSelector: DocumentSectionSelector,
    claims: ClientClaims, purpose: 'read' | 'execute'): Promise<{ ref: DocumentSectionRef; text: string }> {
    const scope = scopeOf(rawScope), selector = parseDocumentSectionSelector(rawSelector), identity = documentGenerationClaims(scope.memberId, claims);
    if (!['read', 'execute'].includes(purpose)) throw invalid();
    if (!this.documents || typeof this.documents.resolveInTransaction !== 'function') throw unavailable();
    const current = documentGenerationObject(await this.authorized(tx, identity, gate => this.documents!.resolveInTransaction(tx, scope, selector, purpose, gate)), ['projectId', 'ref', 'text']);
    const result = resolvedSource({ ref: current.ref, text: current.text });
    if (current.projectId !== scope.projectId || !isDeepStrictEqual(selectorOf(result.ref), selector)) throw mismatch();
    const proofs = this.admissions.get(tx) ?? [];
    proofs.push({ scope, ref: result.ref, claims: identity, purpose, sourceDigest: sha(redactAiExternalText(result.text)) });
    this.admissions.set(tx, proofs);
    return result;
  }

  private assertRunIdentity(run: DocumentGenerationRun, ref: DocumentGenerationRef): void {
    if ((run.agentCode !== undefined && run.agentCode !== 'personal:' + ref.agentId) ||
      (run.agentRevision !== undefined && run.agentRevision !== ref.agentRevision) ||
      (run.catalogVersion !== undefined && run.catalogVersion !== ref.catalogVersion)) throw mismatch();
  }

  private assertInput(run: DocumentGenerationRun, ref: DocumentGenerationRef): Record<string, unknown> {
    assertDocumentGenerationSnapshot(run.snapshot, ref);
    this.assertRunIdentity(run, ref);
    const input = documentGenerationObject(run.input, ['source', 'instruction']);
    if (typeof input.source !== 'string' || typeof input.instruction !== 'string' || !input.source.trim() || !input.instruction.trim() ||
      documentGenerationInputDigest(input) !== ref.inputSha256 || redactAiExternalText(input.source) !== input.source || redactAiExternalText(input.instruction) !== input.instruction) throw mismatch();
    return input;
  }

  async recordOrigin(tx: Prisma.TransactionClient, run: DocumentGenerationRun, raw: DocumentGenerationRef, claims: ClientClaims): Promise<void> {
    if (!this.documents || !this.sessions) throw unavailable();
    const ref = parseDocumentGenerationRef(raw), scope = runScope(run), identity = documentGenerationClaims(run.memberId, claims), input = this.assertInput(run, ref);
    if (!opaque(run.id) || !this.admissions.get(tx)?.some(p => p.purpose === 'execute' && isDeepStrictEqual(p.scope, scope) &&
      isDeepStrictEqual(p.ref, ref.document) && isDeepStrictEqual(p.claims, identity) && p.sourceDigest === sha(input.source as string))) throw mismatch();
    // Admission already locked document -> session -> Memory/Agent; never reacquire those locks here.
    await tx.$executeRaw`INSERT INTO public.ai_personal_document_run_origin
      (run_id,project_id,workspace_id,member_id,document_id,document_revision,agent_id,agent_version_id,agent_revision,ref,session_id,token_version)
      VALUES (${run.id},${run.projectId},${run.workspaceId},${run.memberId},${ref.document.documentId}::uuid,${ref.document.revision},
        ${ref.agentId},${ref.agentVersionId},${ref.agentRevision},${JSON.stringify(ref)}::jsonb,${identity.sessionId},${identity.tokenVersion})`;
    await tx.auditLog.create({ data: { module: 'aij-ai', action: 'personal_document_run_admitted', userId: run.memberId,
      workspaceId: run.workspaceId, status: 'success', resourceType: 'ai-agent-run', resourceId: run.id,
      afterData: { documentId: ref.document.documentId, revision: ref.document.revision, sectionId: ref.document.sectionId, agentId: ref.agentId } } });
  }

  async relation(tx: Prisma.TransactionClient, run: DocumentGenerationRun): Promise<OriginRow | undefined> {
    const scope = runScope(run);
    if (!opaque(run.id)) throw mismatch();
    // Query by run ID FIRST: cross-scope/orphan rows must never fall through to legacy.
    const rows = await tx.$queryRaw<OriginRow[]>`SELECT run_id,project_id,workspace_id,member_id,document_id,document_revision,
      agent_id,agent_version_id,agent_revision,ref,session_id,token_version FROM public.ai_personal_document_run_origin WHERE run_id=${run.id}`;
    if (rows.length > 1) throw mismatch();
    if (!rows.length) return undefined;
    const r = documentGenerationObject(rows[0], ['run_id', 'project_id', 'workspace_id', 'member_id', 'document_id', 'document_revision',
      'agent_id', 'agent_version_id', 'agent_revision', 'ref', 'session_id', 'token_version']);
    const ref = parseDocumentGenerationRef(r.ref);
    if (r.run_id !== run.id || r.project_id !== scope.projectId || r.workspace_id !== scope.workspaceId || r.member_id !== scope.memberId ||
      r.document_id !== ref.document.documentId || r.document_revision !== ref.document.revision || r.agent_id !== ref.agentId ||
      r.agent_version_id !== ref.agentVersionId || r.agent_revision !== ref.agentRevision) throw mismatch();
    const claims = documentGenerationClaims(scope.memberId, { sub: scope.memberId, sessionId: r.session_id as string, tokenVersion: r.token_version as number });
    return Object.freeze({ run_id: run.id, project_id: scope.projectId, workspace_id: scope.workspaceId, member_id: scope.memberId,
      document_id: ref.document.documentId, document_revision: ref.document.revision, agent_id: ref.agentId, agent_version_id: ref.agentVersionId,
      agent_revision: ref.agentRevision, ref, session_id: claims.sessionId, token_version: claims.tokenVersion });
  }

  async assertOriginCurrent(tx: Prisma.TransactionClient, run: DocumentGenerationRun, readClaims?: ClientClaims): Promise<void> {
    const row = await this.relation(tx, run), marker = documentGenerationMarker(run.snapshot);
    if (!row && !marker) return;
    if (!row || !marker || !isDeepStrictEqual(row.ref, marker)) throw mismatch();
    const input = this.assertInput(run, row.ref);
    const reading = readClaims !== undefined;
    const current = await this.resolveSource(tx, runScope(run), selectorOf(row.ref.document),
      reading ? readClaims : { sub: run.memberId, sessionId: row.session_id, tokenVersion: row.token_version }, reading ? 'read' : 'execute');
    if (!isDeepStrictEqual(current.ref, row.ref.document) || redactAiExternalText(current.text) !== input.source) throw mismatch();
  }

  async inspectOrigin(tx: Prisma.TransactionClient, run: DocumentGenerationRun, claims: ClientClaims): Promise<{ origin: DocumentGenerationRef; documentCurrent: boolean }> {
    const row = await this.relation(tx, run), marker = documentGenerationMarker(run.snapshot);
    if (!row) throw new NotFoundException('Document generation origin unavailable');
    this.assertRunIdentity(run, row.ref);
    if (marker) {
      if (!isDeepStrictEqual(marker, row.ref)) throw mismatch();
      this.assertInput(run, row.ref);
    } else if (!(run.contentPurgedAt instanceof Date) || !Number.isFinite(run.contentPurgedAt.getTime()) || run.snapshot !== null || run.input !== null) throw mismatch();
    const scope = runScope(run), identity = documentGenerationClaims(run.memberId, claims);
    if (!this.documents || typeof this.documents.inspectInTransaction !== 'function') throw unavailable();
    const current = documentGenerationObject(await this.authorized(tx, identity, gate =>
      this.documents!.inspectInTransaction(tx, scope, selectorOf(row.ref.document), gate)), ['projectId', 'documentCurrent']);
    if (current.projectId !== scope.projectId || typeof current.documentCurrent !== 'boolean') throw mismatch();
    return { origin: parseDocumentGenerationRef(row.ref), documentCurrent: current.documentCurrent };
  }
}
