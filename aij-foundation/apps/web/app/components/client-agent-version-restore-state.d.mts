import type { ClientApi, createPersonalAgentsClient, createPersonalAgentPublicationsClient, PersonalAgent, PersonalAgentVersion, PersonalAgentModelOptions, UpdatePersonalAgent } from "@aij/sdk";

export type AgentVersionRestoreScope = Readonly<{ memberId: string; workspaceId: string; agentId: string; revision: number }>;
export type AgentRestoreIssue = { status: number; message: string };
export type AgentRestoreRecovery = { revision: number; enabled: boolean; published: boolean; publicationVersion: number };
export type AgentRestoreState = {
  busy: boolean; canManage: boolean; head: PersonalAgent | null; versions: PersonalAgentVersion[]; nextCursor: number | null;
  selected: PersonalAgentVersion | null; models: PersonalAgentModelOptions | null; confirmation: boolean; recovery: AgentRestoreRecovery | null;
  issue: AgentRestoreIssue | null; notice: string; locked: boolean;
};
export declare function historicalAgentConfiguration(value: unknown): Omit<UpdatePersonalAgent, "expectedRevision">;
export declare function agentRestoreDifferences(head: PersonalAgent, selected: PersonalAgentVersion): { field: string; current: unknown; selected: unknown; target: unknown; changed: boolean }[];
export declare function agentRestoreIssue(error: unknown, attempted?: boolean): AgentRestoreIssue;
export type AgentVersionRestoreStore = {
  getSnapshot(): AgentRestoreState;
  subscribe(listener: VoidFunction): VoidFunction;
  setScope(scope: AgentVersionRestoreScope | null): void;
  setCallbacks(callbacks: { request: ClientApi; onAgentChanged: VoidFunction; onScopeRejected?: VoidFunction }): void;
  loadHistory(next?: boolean): Promise<void>;
  selectVersion(versionId: string): Promise<void>;
  requestConfirmation(): Promise<void>;
  confirmRestore(): Promise<void>;
  cancelConfirmation(): void;
  canRestore(): boolean;
  noChange(): boolean;
  readRecovery(): Promise<void>;
  acknowledgeRecovery(): Promise<void>;
  suspend(): void;
  dispose(): void;
};
export declare function createAgentVersionRestore(options: {
  request: ClientApi; agentsClientFactory: typeof createPersonalAgentsClient; publicationsClientFactory: typeof createPersonalAgentPublicationsClient;
  onAgentChanged?: VoidFunction; onScopeRejected?: VoidFunction; timeoutMs?: number; isActive?: () => boolean;
}): AgentVersionRestoreStore;
