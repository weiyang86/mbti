import type { ClientApi, createPersonalAgentsClient, createPersonalSkillsClient, PersonalAgent, PersonalAgentSummary, PersonalAgentVersion, PersonalAgentModelOptions, CreatePersonalAgent, PersonalSkillVersion } from "@aij/sdk";
export type AgentDraft = CreatePersonalAgent;
export type PinStatus = { available: boolean; name?: string; code?: string; versionId?: string };
export type SkillChoice = { id: string; code: string; name: string; revision: number };
export type AgentLibraryState = {
  phase: "loading" | "ready"; principal: { id: string; nickname: string; email: string | null } | null;
  workspaces: { workspace: { id: string; name: string }; role: { name: string } }[];
  workspaceId: string; context: { workspaceId: string; workspaceName: string; permissions: string[] } | null;
  busy: boolean; items: PersonalAgentSummary[]; nextCursor: string | null; detail: PersonalAgent | null;
  versions: PersonalAgentVersion[]; versionCursor: number | null; historical: PersonalAgentVersion | null;
  editor: "create" | "edit" | null; draft: AgentDraft; confirmation: "create" | "update" | "delete" | null;
  issue: { kind: string; status: number; message: string } | null; notice: string;
  models: PersonalAgentModelOptions | null; skills: SkillChoice[]; skillCursor: string | null;
  selectedSkill: SkillChoice | null; skillVersions: PersonalSkillVersion[]; skillVersionCursor: number | null;
  verifiedPins: Record<string, PinStatus>;
};
export declare function validAgentDraft(draft: AgentDraft, creating?: boolean): boolean;
export declare function agentIssue(error: unknown, operation?: string): { kind: string; status: number; message: string };
// Use ambient function declarations instead of Babel TSFunctionType nodes so
// both the repository lint parser and TypeScript validate the same signatures.
declare function libraryConfigured(): boolean;
declare function librarySnapshot(): AgentLibraryState;
declare function librarySubscribe(listener: VoidFunction): VoidFunction;
declare function libraryStart(preferredId?: string): Promise<void>;
declare function libraryScope(workspaceId: string): Promise<void>;
declare function libraryAsync(): Promise<void>;
declare function libraryDetail(agentId: string): Promise<void>;
declare function libraryPage(next?: boolean): Promise<void>;
declare function librarySkill(skillId: string): Promise<void>;
declare function librarySetDraft<K extends "code" | "name" | "instructions" | "enabled" | "inputFields" | "outputFormat" | "outputFields">(field: K, value: AgentDraft[K]): void;
declare function librarySelect(code: string): void;
declare function libraryMove(index: number, delta: number): void;
declare function libraryRemove(index: number): void;
type AgentLibraryStore = {
  getSnapshot: typeof librarySnapshot; subscribe: typeof librarySubscribe;
  start: typeof libraryStart; selectWorkspace: typeof libraryScope; refresh: typeof libraryAsync;
  nextPage: typeof libraryAsync; openDetail: typeof libraryDetail; loadVersions: typeof libraryPage;
  openCreate: typeof libraryAsync; openEdit: typeof libraryAsync; refreshModels: typeof libraryAsync; loadSkills: typeof libraryPage;
  selectSkill: typeof librarySkill; loadSkillVersions: typeof libraryAsync; recheckPins: typeof libraryAsync;
  setDraft: typeof librarySetDraft; selectModel: typeof librarySelect; addPin: typeof librarySelect; movePin: typeof libraryMove; removePin: typeof libraryRemove;
  readyToSave: typeof libraryConfigured; requestSave: VoidFunction; requestDelete: VoidFunction; confirmMutation: typeof libraryAsync; cancelConfirmation: VoidFunction;
  previewVersion: typeof librarySelect; closeDetail: VoidFunction; signOut: typeof libraryAsync; dispose: VoidFunction;
};
export declare function createAgentLibrary(options: { request: ClientApi; agentsClientFactory: typeof createPersonalAgentsClient; skillsClientFactory: typeof createPersonalSkillsClient; configured?: typeof libraryConfigured; onUnauthorized?: VoidFunction; timeoutMs?: number }): AgentLibraryStore;
