import { Injectable, Optional, ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { ClientClaims } from '../../client-auth/client-auth.security';
import { documentGenerationCost, documentGenerationObject as object, documentGenerationOpaque as opaque,
  parseDocumentGenerationPreview, parseDocumentGenerationRef, parseDocumentGenerationSubmit } from './ai-personal-document-generation.dto';
import type { DocumentGenerationRef } from './ai-personal-document-generation.dto';

/** Root binds useExisting: AiCenterRunService. This port never creates another execution owner. */
export abstract class DocumentGenerationRunDriver {
  abstract previewDocumentGeneration(memberId: string, workspaceId: string, bodyOrId: unknown, claims: ClientClaims, correlationId?: string): Promise<unknown>;
  abstract submitDocumentGeneration(memberId: string, workspaceId: string, bodyOrId: unknown, claims: ClientClaims, correlationId?: string): Promise<unknown>;
  abstract readDocumentGeneration(memberId: string, workspaceId: string, bodyOrId: unknown, claims: ClientClaims, correlationId?: string): Promise<unknown>;
  abstract recoverDocumentGeneration(memberId: string, workspaceId: string, bodyOrId: unknown, claims: ClientClaims, correlationId?: string): Promise<unknown>;
}
function unavailable(): never { throw new ServiceUnavailableException('Document generation unavailable'); }
function project<T>(parse: () => T): T { try { return parse(); } catch { return unavailable(); } }
function iso(raw: unknown): string {
  // Explicitly convert the original owner's Date fields; never call a caller-supplied toJSON/toISOString.
  if (raw instanceof Date) {
    try { raw = Date.prototype.toISOString.call(raw); } catch { unavailable(); }
  }
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(raw) ||
    !Number.isFinite(Date.parse(raw)) || new Date(raw).toISOString() !== raw) unavailable();
  return raw;
}
function identity(b: Record<string, unknown>, ref: DocumentGenerationRef, expectedId?: string) {
  const id = opaque(b.id), status = b.status, budgetStatus = b.budgetStatus;
  if (expectedId !== undefined && id !== expectedId || b.agentCode !== 'personal:' + ref.agentId ||
    typeof status !== 'string' || !['queued', 'running', 'succeeded', 'failed', 'unknown'].includes(status) ||
    budgetStatus !== (status === 'succeeded' ? 'settled' : status === 'failed' ? 'released' : 'reserved')) unavailable();
  const createdAt = iso(b.createdAt), expiresAt = iso(b.expiresAt);
  if (createdAt >= expiresAt) unavailable();
  return { id, agentCode: b.agentCode as string, status, budgetStatus, createdAt, expiresAt };
}
function runEnvelope(raw: unknown, expectedId?: string, expectedOrigin?: DocumentGenerationRef) {
  const b = object(raw, ['run', 'origin']), origin = parseDocumentGenerationRef(b.origin);
  if (expectedOrigin && JSON.stringify(origin) !== JSON.stringify(expectedOrigin)) unavailable();
  const r = object(b.run, ['id', 'agentCode', 'status', 'output', 'failureCode', 'estimatedCostNanos', 'budgetStatus', 'imageAssetId', 'createdAt', 'expiresAt']);
  const i = identity(r, origin, expectedId);
  if (r.imageAssetId !== null || (i.status === 'succeeded' ? typeof r.output !== 'string' || r.output.length > 64000 : r.output !== null) ||
    (i.status === 'failed' || i.status === 'unknown' ? typeof r.failureCode !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(r.failureCode) : r.failureCode !== null)) unavailable();
  const estimatedCostNanos = documentGenerationCost(r.estimatedCostNanos);
  if (i.status === 'failed' && estimatedCostNanos !== '0') unavailable();
  return Object.freeze({ run: Object.freeze({ id: i.id, agentCode: i.agentCode, status: i.status, output: r.output as string | null,
    failureCode: r.failureCode as string | null, estimatedCostNanos, budgetStatus: i.budgetStatus, imageAssetId: null,
    createdAt: i.createdAt, expiresAt: i.expiresAt }), origin });
}

/** Validate at the boundary, invoke the original owner exactly once, project only the frozen wire contract. */
@Injectable()
export class AiPersonalDocumentGenerationService {
  constructor(@Optional() private readonly driver?: DocumentGenerationRunDriver) {}
  private owner(): DocumentGenerationRunDriver { return this.driver ?? unavailable(); }
  async preview(memberId: string, workspaceId: string, raw: unknown, claims: ClientClaims, correlationId?: string) {
    const body = parseDocumentGenerationPreview(raw);
    const result = await this.owner().previewDocumentGeneration(memberId, workspaceId, body, claims, correlationId);
    return project(() => {
      const b = object(result, ['origin', 'inputFields', 'modelExecutionConfigured']), origin = parseDocumentGenerationRef(b.origin);
      const d = origin.document;
      // Descriptor-check the fixed tuple as an object without reading array elements first.
      const f = b.inputFields;
      if (!Array.isArray(f) || Object.getPrototypeOf(f) !== Array.prototype) unavailable();
      const descriptors = Object.getOwnPropertyDescriptors(f as object);
      if (Reflect.ownKeys(descriptors).length !== 3 || descriptors.length.value !== 2 ||
        !descriptors['0']?.enumerable || !Object.hasOwn(descriptors['0'], 'value') || descriptors['0'].value !== 'source' ||
        !descriptors['1']?.enumerable || !Object.hasOwn(descriptors['1'], 'value') || descriptors['1'].value !== 'instruction' ||
        typeof b.modelExecutionConfigured !== 'boolean' || d.documentId !== body.documentId || d.revision !== body.expectedRevision ||
        d.bodySha256 !== body.bodySha256 || d.sectionId !== body.sectionId || origin.agentId !== body.agentId || origin.agentRevision !== body.agentRevision ||
        origin.instructionSha256 !== createHash('sha256').update(body.instruction, 'utf8').digest('hex')) unavailable();
      return Object.freeze({ origin, inputFields: Object.freeze(['source', 'instruction'] as const), modelExecutionConfigured: b.modelExecutionConfigured });
    });
  }
  async submit(memberId: string, workspaceId: string, raw: unknown, claims: ClientClaims, correlationId?: string) {
    const body = parseDocumentGenerationSubmit(raw);
    const result = await this.owner().submitDocumentGeneration(memberId, workspaceId, body, claims, correlationId);
    return project(() => runEnvelope(result, undefined, body.origin));
  }
  async read(memberId: string, workspaceId: string, raw: unknown, claims: ClientClaims, correlationId?: string) {
    const id = opaque(raw);
    const result = await this.owner().readDocumentGeneration(memberId, workspaceId, id, claims, correlationId);
    return project(() => runEnvelope(result, id));
  }
  async recover(memberId: string, workspaceId: string, raw: unknown, claims: ClientClaims, correlationId?: string) {
    const key = opaque(raw, 8);
    const result = await this.owner().recoverDocumentGeneration(memberId, workspaceId, key, claims, correlationId);
    return project(() => {
      const b = object(result, ['request', 'origin', 'documentCurrent']), origin = parseDocumentGenerationRef(b.origin);
      const r = object(b.request, ['id', 'agentCode', 'status', 'budgetStatus', 'createdAt', 'expiresAt', 'contentAvailable']);
      const i = identity(r, origin);
      if (typeof b.documentCurrent !== 'boolean' || typeof r.contentAvailable !== 'boolean') unavailable();
      return Object.freeze({ request: Object.freeze({ ...i, contentAvailable: r.contentAvailable }), origin, documentCurrent: b.documentCurrent });
    });
  }
}
