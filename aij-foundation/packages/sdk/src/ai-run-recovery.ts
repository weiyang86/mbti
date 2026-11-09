import type { ClientApi } from './index.js';

/** Stored metadata only. Unknown/reserved does not authorize retry or a refund. */
export type AiRunRecoveryReference = Readonly<{
  id: string;
  agentCode: string;
  status: string;
  budgetStatus: string;
  createdAt: string;
  expiresAt: string;
  /** The normal run content is within retention and has not been purged; no promise of completed output. */
  contentAvailable: boolean;
}>;

export function createAiRunRecoveryClient(api: ClientApi) {
  return {
    recoverRequest: (workspaceId: string, key: string): Promise<AiRunRecoveryReference> =>
      api<AiRunRecoveryReference>('/client/ai/run-requests/' + encodeURIComponent(key), { method: 'GET', workspaceId })
  };
}
