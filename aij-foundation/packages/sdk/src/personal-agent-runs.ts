import type { ClientApi } from './index.js';
import type { AiAgentRunResult } from '@aij/contracts';

export type PersonalAgentRunRequest = Readonly<{ input: Record<string, string>; idempotencyKey: string; expectedRevision: number }>;
/** Submission only. Use createAiClient.read and createAiRunRecoveryClient.recoverRequest for shared owner-scoped reads. */
export function createPersonalAgentRunsClient(api: ClientApi) {
  const id = (v: string) => {
    if (typeof v !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(v)) throw new TypeError('Invalid personal Agent identity');
    return encodeURIComponent(v);
  };
  return {
    submit(workspaceId: string, agentId: string, body: PersonalAgentRunRequest): Promise<AiAgentRunResult> {
      id(workspaceId); const agent = id(agentId);
      if (!body || Object.getPrototypeOf(body) !== Object.prototype || Object.keys(body).sort().join() !== 'expectedRevision,idempotencyKey,input' ||
        !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 1 || body.expectedRevision > 2147483647 ||
        typeof body.idempotencyKey !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(body.idempotencyKey) ||
        !body.input || ![Object.prototype, null].includes(Object.getPrototypeOf(body.input)) || Array.isArray(body.input) ||
        Object.keys(body.input).length > 20 || Object.entries(body.input).some(([k, v]) => !/^[A-Za-z][A-Za-z0-9_]{0,47}$/.test(k) ||
          ['__proto__', 'constructor', 'prototype'].includes(k) || typeof v !== 'string' || !v.trim() || v.length > 2000)) throw new TypeError('Invalid personal Agent run request');
      return api<AiAgentRunResult>('/client/ai/personal-agents/' + agent + '/runs', { method: 'POST', workspaceId,
        body: JSON.stringify({ input: body.input, idempotencyKey: body.idempotencyKey, expectedRevision: body.expectedRevision }) });
    }
  };
}
