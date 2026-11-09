// Next's Babel parser uses an incompatible function-signature AST in .d.mts.
// Also lint this declaration with @typescript-eslint/parser --no-inline-config;
// the source import-graph noEmit check validates every signature and its usage.
/* eslint @typescript-eslint/no-unused-vars: "off" */
import type { AiAgentSummary, ClientApi, createAiClient, createAiRunRecoveryClient, AiRunRecoveryReference } from "@aij/sdk";
import type { AiAgentRunResult } from "@aij/contracts";

export type WorkbenchIssue = { kind: string; status: number; message: string };
export type WorkspaceItem = { workspace: { id: string; name: string }; role: { name: string } };
export type WorkbenchState = {
  phase: "loading" | "ready";
  principal: { id: string; nickname?: string; email?: string | null } | null;
  workspaces: WorkspaceItem[];
  workspaceId: string;
  context: { workspaceId: string; workspaceName: string; permissions: string[] } | null;
  agents: AiAgentSummary[];
  agentCode: string;
  input: Record<string, string>;
  run: AiAgentRunResult | null;
  issue: WorkbenchIssue | null;
  submitting: boolean;
  reading: boolean;
  submissionUnconfirmed: boolean;
  polling: boolean;
  pollPaused: boolean;
  imageBlob: Blob | null;
  imageLoading: boolean;
  recovery: { memberId: string; workspaceId: string; agentCode: string; key: string | null; digest: string | null; runId: string | null; status: string } | null;
  recoveryNeedsInput: boolean;
  recoveryReference: AiRunRecoveryReference | null;
  recoveryBlocked: boolean;
  contentUnavailable: boolean;
};
export declare function parseAgents(value: unknown): AiAgentSummary[];
export declare function parseRun(value: unknown, expected?: { id?: string; agentCode?: string }): AiAgentRunResult;
export declare function parseRecoveryReference(value: unknown, expected?: { runId?: string | null; agentCode?: string }): AiRunRecoveryReference;
export declare function describeRun(run: Pick<AiRunRecoveryReference, "status">): { label: string; message: string; tone: "info" | "success" | "error" | "warning"; active: boolean };
export declare function requestIssue(error: unknown, operation?: string): WorkbenchIssue;
export declare function createWorkbench(options: {
  request: ClientApi;
  aiClientFactory: typeof createAiClient;
  aiRecoveryClientFactory?: typeof createAiRunRecoveryClient;
  requestImage?: (path: string, options: { workspaceId: string; signal: AbortSignal }) => Promise<Blob>;
  onUnauthorized?: () => void;
  journalStorage?: () => Pick<Storage, "getItem" | "setItem">;
  withRecoveryLock?: <T>(name: string, fn: () => T) => T | Promise<T>;
  makeKey?: () => string;
  schedule?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  unschedule?: (timer: ReturnType<typeof setTimeout>) => void;
  pollInterval?: number;
  maxPolls?: number;
}): {
  getSnapshot(): WorkbenchState;
  subscribe(listener: () => void): () => void;
  start(preferredId?: string): Promise<void>;
  selectWorkspace(workspaceId: string): Promise<void>;
  selectAgent(agentCode: string): void;
  setInput(field: string, value: string): void;
  submit(): Promise<void>;
  recoverRequest(): Promise<void>;
  readRun(runId?: string, automatic?: boolean): Promise<void>;
  readImage(): Promise<void>;
  newTask(): void;
  dispose(): void;
};
