import { BadRequestException } from '@nestjs/common';
import { workflowAssetId, workflowObject, workflowRevision } from './ai-personal-workflows-graph';

function invalid(): never { throw new BadRequestException('Invalid workflow execution request'); }
export function executionRequest<T>(parse: () => T): T {
  try { return parse(); } catch { return invalid(); }
}
export function executionObject(raw: unknown, keys: readonly string[]) {
  return executionRequest(() => workflowObject(raw, keys));
}
export const executionAssetId = (raw: unknown) => executionRequest(() => workflowAssetId(raw));
export function executionPublicationId(raw: unknown): string {
  if (typeof raw !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(raw)) invalid();
  return raw;
}
export function executionKey(raw: unknown): string {
  if (typeof raw !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(raw)) invalid();
  return raw;
}
export function executionMutation(raw: unknown) {
  const b = executionObject(raw, ['expectedRevision', 'expectedPublicationEpoch']);
  return executionRequest(() => {
    const revision = workflowRevision(b.expectedRevision), epoch = b.expectedPublicationEpoch;
    if (typeof epoch !== 'number' || !Number.isInteger(epoch) || epoch < 0 || epoch > 2147483647) invalid();
    return { expectedRevision: revision, expectedPublicationEpoch: epoch };
  });
}
export function executionPublish(raw: unknown) {
  const b = executionObject(raw, ['workflowId', 'expectedRevision', 'expectedPublicationEpoch']);
  return { workflowId: executionAssetId(b.workflowId), ...executionMutation({ expectedRevision: b.expectedRevision, expectedPublicationEpoch: b.expectedPublicationEpoch }) };
}
export function executionSubmit(raw: unknown) {
  const b = executionObject(raw, ['publicationId', 'input', 'idempotencyKey']);
  return executionRequest(() => {
    const input = workflowObject(b.input, Object.keys(b.input && typeof b.input === 'object' ? b.input : {}));
    if (Object.keys(input).length > 20 || Object.entries(input).some(([k, v]) => !/^[A-Za-z][A-Za-z0-9_]{0,47}$/.test(k) ||
      ['__proto__', 'constructor', 'prototype'].includes(k) || typeof v !== 'string' || !v.trim() || v.length > 2000)) invalid();
    return { publicationId: executionPublicationId(b.publicationId), input: { ...input } as Record<string, string>, idempotencyKey: executionKey(b.idempotencyKey) };
  });
}
export function executionNoBody(body: unknown, headers: { 'content-length'?: unknown; 'transfer-encoding'?: unknown }) {
  if (body !== undefined || headers['transfer-encoding'] !== undefined || (headers['content-length'] !== undefined && headers['content-length'] !== '0')) invalid();
}
