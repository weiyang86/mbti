import { readClientBinaryResponse } from "./client-binary-response.js";
import { isSuccessEnvelope } from "@aij/contracts";

export type ClientApiOptions = RequestInit & { workspaceId?: string; responseKind?: "binary"; maxResponseBytes?: number };
export type ClientApi = <T = unknown>(path: string, options?: ClientApiOptions) => Promise<T>;

export class ClientRequestFailure extends Error {
  readonly status: number;

  constructor(status: number) {
    super("Client request failed");
    this.name = "ClientRequestFailure";
    this.status = status;
  }
}

export function createClientApi(resolveBaseUrl: () => string | undefined): ClientApi {
  return async function clientApi<T = unknown>(path: string, options: ClientApiOptions = {}): Promise<T> {
    const base = resolveBaseUrl();
    if (!base) throw new ClientRequestFailure(503);
    const headers = new Headers(options.headers);
    if (options.body !== undefined && !(options.body instanceof FormData) && !headers.has("content-type")) headers.set("content-type", "application/json");
    if (options.workspaceId) headers.set("x-aij-workspace-id", options.workspaceId);
    const { responseKind, maxResponseBytes, ...requestOptions } = options;
    delete requestOptions.workspaceId;
    const response = await fetch(base + path, {
      ...requestOptions,
      headers,
      credentials: "include",
      cache: "no-store",
      signal: options.signal ?? AbortSignal.timeout(8000)
    });
    if (!response.ok) { await response.body?.cancel().catch(() => {}); throw new ClientRequestFailure(response.status); }
    if (responseKind === "binary") {
      try { return await readClientBinaryResponse(response, maxResponseBytes, options.signal ?? undefined) as T; }
      catch { throw new ClientRequestFailure(503); }
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new ClientRequestFailure(503);
    }
    if (!isSuccessEnvelope(body)) throw new ClientRequestFailure(503);
    return body.data as T;
  };
}

export function clientRequestMessage(error: unknown): string {
  const status = error instanceof ClientRequestFailure ? error.status : 503;
  if (status === 400) return "请检查输入内容后重试。";
  if (status === 401) return "登录已失效，请重新登录。";
  if (status === 403) return "当前账号无权访问此 Workspace 或执行该操作。";
  if (status === 404) return "记录已不存在，请刷新页面。";
  if (status === 409) return "操作与当前成员或角色状态冲突，请刷新后重试。";
  return "暂时无法连接服务，请稍后重试。";
}

export type AiAgentSummary = { code: string; name: string; revision: number; inputFields: string[]; outputFormat: 'text' | 'json'; capability: 'text' | 'image'; maximumEstimatedCostNanos: string };
export function createAiClient(api: ClientApi) {
  return {
    listAgents: (workspaceId: string) => api<AiAgentSummary[]>('/client/ai/agents', { workspaceId }),
    submit: (workspaceId: string, agentCode: string, input: Record<string, string>, idempotencyKey: string) => api<import('@aij/contracts').AiAgentRunResult>('/client/ai/agents/' + encodeURIComponent(agentCode) + '/runs', { method: 'POST', workspaceId, body: JSON.stringify({ input, idempotencyKey }) }),
    read: (workspaceId: string, id: string) => api<import('@aij/contracts').AiAgentRunResult>('/client/ai/runs/' + encodeURIComponent(id), { workspaceId }),
    imagePath: (id: string) => '/client/ai/runs/' + encodeURIComponent(id) + '/image'
  };
}

export { createAiRunRecoveryClient, type AiRunRecoveryReference } from "./ai-run-recovery.js";

export { createPersonalSkillsClient, type PersonalSkillSummary, type PersonalSkill, type PersonalSkillVersion, type CreatePersonalSkill, type UpdatePersonalSkill, type DeletePersonalSkillResult, type PersonalSkillPage, type PersonalSkillListOptions, type PersonalSkillVersionOptions } from "./personal-skills.js";

export * from "./personal-agents.js";

export * from "./personal-agent-runs.js";

export * from "./personal-memories.js";

export * from "./personal-agent-run-previews.js";

export * from "./personal-workflows.js";

export * from "./knowledge-web-imports.js";
export * from "./personal-agent-publications.js";

export * from "./personal-documents.js";

export * from "./external-services.js";

export * from "./personal-document-exports.js";
export type { ClientBinaryResponse } from "./client-binary-response.js";
export * from "./personal-workflow-execution.js";
export * from "./personal-script-execution.js";
export * from "./knowledge-citations.js";
export { createPersonalDocumentSectionsClient, composePersonalDocumentSectionDraft,
  type PersonalDocumentSection, type PersonalDocumentSectionIndex, type PersonalDocumentSectionDraft,
  type ComposePersonalDocumentSectionDraftInput } from "./personal-document-sections.js";

export { createPersonalDocumentGenerationClient,
  type DocumentSectionSelector, type DocumentSectionRef, type DocumentGenerationRef,
  type DocumentGenerationPreviewBody, type DocumentGenerationSubmitBody,
  type DocumentGenerationStatus, type DocumentGenerationBudgetStatus,
  type DocumentGenerationPreview, type DocumentGenerationRun,
  type DocumentGenerationRunEnvelope, type DocumentGenerationRequest,
  type DocumentGenerationRecovery } from "./personal-document-generation.js";
