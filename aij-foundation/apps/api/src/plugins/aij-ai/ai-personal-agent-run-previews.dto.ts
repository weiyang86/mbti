import { BadRequestException } from '@nestjs/common';
import { personalAgentObject } from './ai-personal-agents.dto';

/** Private identity is the actual generated UUID, never the legacy catalog p-UUID code. */
export function personalAgentPreviewId(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value))
    throw new BadRequestException('Invalid personal Agent preview request');
  return value;
}

export function personalAgentRunPreviewQuery(raw: unknown): { expectedRevision: number } {
  const q = personalAgentObject(raw, ['expectedRevision'], ['expectedRevision']);
  if (typeof q.expectedRevision !== 'string' || !/^[1-9][0-9]{0,9}$/.test(q.expectedRevision) || Number(q.expectedRevision) > 2147483647)
    throw new BadRequestException('Invalid personal Agent preview request');
  return { expectedRevision: Number(q.expectedRevision) };
}

export function assertPersonalAgentPreviewNoBody(body: unknown, headers: { 'content-length'?: unknown; 'transfer-encoding'?: unknown }): void {
  if (body !== undefined || headers['transfer-encoding'] !== undefined ||
    (headers['content-length'] !== undefined && headers['content-length'] !== '0'))
    throw new BadRequestException('Personal Agent preview does not accept a body');
}
