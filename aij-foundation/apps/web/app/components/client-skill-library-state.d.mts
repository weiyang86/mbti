// Validate declaration signatures with the TypeScript parser as well as noEmit.
/* eslint @typescript-eslint/no-unused-vars: "off" */
import type { ClientApi, createPersonalSkillsClient, PersonalSkill, PersonalSkillSummary, PersonalSkillVersion, CreatePersonalSkill } from "@aij/sdk";

export type SkillLibraryIssue = { kind: string; status: number; message: string };
export type SkillLibraryState = {
  phase: "loading" | "ready";
  principal: { id: string; nickname: string; email: string | null } | null;
  workspaces: { workspace: { id: string; name: string }; role: { name: string } }[];
  workspaceId: string;
  context: { workspaceId: string; workspaceName: string; permissions: string[] } | null;
  busy: boolean;
  items: PersonalSkillSummary[];
  nextCursor: string | null;
  detail: PersonalSkill | null;
  versions: PersonalSkillVersion[];
  versionCursor: number | null;
  historical: PersonalSkillVersion | null;
  editor: "create" | "edit" | null;
  draft: CreatePersonalSkill;
  confirmation: "create" | "update" | "delete" | null;
  issue: SkillLibraryIssue | null;
  notice: string;
};
export declare function validSkillDraft(draft: CreatePersonalSkill, creating?: boolean): boolean;
export declare function skillIssue(error: unknown, operation?: string): SkillLibraryIssue;
export declare function createSkillLibrary(options: { request: ClientApi; skillsClientFactory: typeof createPersonalSkillsClient; configured?: () => boolean; onUnauthorized?: () => void }): {
  getSnapshot(): SkillLibraryState;
  subscribe(listener: () => void): () => void;
  start(preferredId?: string): Promise<void>;
  selectWorkspace(workspaceId: string): Promise<void>;
  refresh(): Promise<void>;
  nextPage(): Promise<void>;
  openDetail(skillId: string): Promise<void>;
  openCreate(): void;
  openEdit(): void;
  setDraft(field: "code" | "name" | "instructions", value: string): void;
  requestSave(): void;
  requestDelete(): void;
  confirmMutation(): Promise<void>;
  cancelConfirmation(): void;
  loadVersions(next?: boolean): Promise<void>;
  previewVersion(versionId: string): void;
  closeDetail(): void;
  signOut(): Promise<void>;
  dispose(): void;
};
