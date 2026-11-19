import { BadRequestException } from '@nestjs/common';
import { parseWorkflowJson, workflowAssetId, workflowObject, workflowRevision } from './ai-personal-workflows-graph';

export const WORKFLOW_PUBLICATION_MAX = 2147483647;
const invalid = (): never => { throw new BadRequestException('Invalid workflow publication request'); };
export function publicationRequest<T>(parse: () => T): T {
  try { return parse(); } catch { return invalid(); }
}
export const workflowPublicationAssetId = (raw: unknown) => publicationRequest(() => workflowAssetId(raw));
export function workflowPublicationId(raw: unknown): string {
  if (typeof raw !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(raw)) return invalid();
  return raw;
}
export function workflowPublicationEpoch(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isInteger(raw) || Object.is(raw, -0) || raw < 0 || raw > WORKFLOW_PUBLICATION_MAX) return invalid();
  return raw;
}
export function publishPersonalWorkflowDto(raw: unknown) {
  return publicationRequest(() => {
    const b = workflowObject(raw, ['workflowId', 'expectedRevision', 'expectedPublicationEpoch']);
    return { workflowId: workflowAssetId(b.workflowId), expectedRevision: workflowRevision(b.expectedRevision),
      expectedPublicationEpoch: workflowPublicationEpoch(b.expectedPublicationEpoch) };
  });
}
export function unpublishPersonalWorkflowDto(raw: unknown) {
  return publicationRequest(() => {
    const b = workflowObject(raw, ['expectedRevision', 'expectedPublicationEpoch']);
    return { expectedRevision: workflowRevision(b.expectedRevision), expectedPublicationEpoch: workflowPublicationEpoch(b.expectedPublicationEpoch) };
  });
}
/** HTTP bootstrap must call before ordinary JSON parsing; duplicates cannot be recovered from objects. */
export const parseWorkflowPublicationJson = (raw: string): unknown => publicationRequest(() => parseWorkflowJson(raw));
