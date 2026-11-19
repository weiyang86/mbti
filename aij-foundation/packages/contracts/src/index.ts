export interface SuccessEnvelope<T> {
  success: true;
  data: T;
  message: string;
}

export function createSuccessEnvelope<T>(data: T, message = "ok"): SuccessEnvelope<T> {
  return { success: true, data, message };
}

export function isSuccessEnvelope(value: unknown): value is SuccessEnvelope<unknown> {
  return value !== null && typeof value === "object" &&
    "success" in value && value.success === true &&
    "data" in value && "message" in value && typeof value.message === "string";
}

/** General AI configuration. Credentials are references, never resolved values. Prices are internal CNY estimates. */
export type AiCenterProvider = { code: string; name: string; vendor: 'openai' | 'deepseek' | 'aliyun' | 'compatible'; baseUrl: string; credentialRef: string; enabled: boolean; liveEnabled: boolean; revision: number };
export type AiCenterModel = { code: string; name: string; providerCode: string; upstreamModel: string; capability: 'text' | 'image'; enabled: boolean; contextTokens: number; maxOutputTokens: number; tokenParameter: 'max_tokens' | 'max_completion_tokens'; inputNanosPerMillion: string; outputNanosPerMillion: string; imageNanos: string; imageSize: '1024x1024' | '1024x1536' | '1536x1024'; imageQuality: 'auto' | 'low' | 'medium' | 'high'; imageBase64Format: boolean; revision: number };
export type AiCenterSkill = { code: string; name: string; instructions: string; enabled: boolean; revision: number };
export type AiCenterAgent = { code: string; name: string; modelCode: string; skillCodes: string[]; instructions: string; inputFields: string[]; outputFormat: 'text' | 'json'; outputFields: string[]; enabled: boolean; published: boolean; revision: number };
export type AiCenterCatalog = { providers: AiCenterProvider[]; models: AiCenterModel[]; skills: AiCenterSkill[]; agents: AiCenterAgent[]; monthlyBudgetNanos: string; workspaceMonthlyBudgetNanos: string };
export type AiCenterConfiguration = { version: number; catalog: AiCenterCatalog };
export type AiAgentRunResult = { id: string; agentCode: string; status: string; output: unknown; failureCode: string | null; estimatedCostNanos: string; budgetStatus: string; imageAssetId: string | null; createdAt: string; expiresAt: string };
