import { BadRequestException } from '@nestjs/common';
import { personalAgentPreviewId } from './ai-personal-agent-run-previews.dto';

export type PersonalAgentPublicationMutation = Readonly<{ expectedAgentRevision: number; expectedPublicationVersion: number }>;
export const personalAgentPublicationId = personalAgentPreviewId;
export function publicationObject(raw: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(raw)) ||
    Reflect.ownKeys(raw).length !== keys.length || keys.some(k => !Object.hasOwn(raw, k)) ||
    Reflect.ownKeys(raw).some(k => typeof k !== 'string' || !keys.includes(k) || !('value' in Object.getOwnPropertyDescriptor(raw, k)!)))
    throw new BadRequestException('Invalid personal Agent publication request');
  return raw as Record<string, unknown>;
}
export function publicationCounter(value: unknown, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > 2147483647)
    throw new BadRequestException('Invalid personal Agent publication request');
  return value;
}
export function personalAgentPublicationMutation(raw: unknown): PersonalAgentPublicationMutation {
  const b = publicationObject(raw, ['expectedAgentRevision', 'expectedPublicationVersion']);
  return { expectedAgentRevision: publicationCounter(b.expectedAgentRevision, 1), expectedPublicationVersion: publicationCounter(b.expectedPublicationVersion) };
}
