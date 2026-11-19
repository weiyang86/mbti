import type { ClientApi } from './index.js';

/** Model execution budget ceiling only; no admission, user price, payment or refund promise. */
export type PersonalAgentRunPreview = Readonly<{
  personalAgentId: string; code: string; name: string; revision: number;
  inputFields: string[]; outputFormat: 'text' | 'json'; outputFields: string[]; capability: 'text';
  modelCode: string; modelRevision: number; catalogVersion: number;
  maximumEstimatedCostNanos: string; modelExecutionConfigured: boolean;
}>;

/** Stateless advisory GET; submission must revalidate current permissions/configuration/input/budget. */
export function createPersonalAgentRunPreviewsClient(api: ClientApi) {
  return {
    preview(workspaceId: string, personalAgentId: string, expectedRevision: number): Promise<PersonalAgentRunPreview> {
      if (typeof workspaceId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(workspaceId) ||
        typeof personalAgentId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(personalAgentId) ||
        !Number.isSafeInteger(expectedRevision) || expectedRevision < 1 || expectedRevision > 2147483647)
        throw new TypeError('Invalid personal Agent preview request');
      return api<PersonalAgentRunPreview>('/client/ai/personal-agents/' + encodeURIComponent(personalAgentId) +
        '/run-preview?expectedRevision=' + expectedRevision, { method: 'GET', workspaceId });
    }
  };
}
