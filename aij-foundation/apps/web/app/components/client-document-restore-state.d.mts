import type { ClientApi, PersonalDocument, PersonalDocumentVersion, PersonalDocumentVersionSummary } from "@aij/sdk";
export type DocumentVersionRestoreScope = Readonly<{ memberId: string; workspaceId: string; documentId: string; revision: number }>;
export type DocumentRestoreState = Readonly<{
  scopeKey: string | null; busy: boolean; canManage: boolean; head: PersonalDocument | null; versions: PersonalDocumentVersionSummary[];
  nextCursor: number | null; selected: PersonalDocumentVersion | null; confirmation: boolean; recovery: PersonalDocument | null;
  issue: { status: number; message: string } | null; notice: string; locked: boolean;
}>;
export type DocumentRestoreCallbacks = { request: ClientApi; onDocumentChanged: () => void; onScopeRejected?: () => void };
export type DocumentRestoreStore = {
  getSnapshot(): DocumentRestoreState; subscribe(fn: () => void): () => void; setScope(scope: DocumentVersionRestoreScope | null): void;
  setCallbacks(callbacks: DocumentRestoreCallbacks): void; loadHistory(next?: boolean): Promise<void>; selectVersion(revision: number): Promise<void>;
  requestConfirmation(): Promise<void>; confirmRestore(): Promise<void>; cancelConfirmation(): void; canRestore(): boolean; noChange(): boolean;
  readRecovery(): Promise<void>; acknowledgeRecovery(): Promise<void>; suspend(): void; dispose(): void;
};
export declare function createDocumentVersionRestore(options: DocumentRestoreCallbacks & { timeoutMs?: number; isActive?: () => boolean }): DocumentRestoreStore;
export declare function documentRestoreIssue(error: unknown, attempted?: boolean): { status: number; message: string };
export declare function documentRestoreDifferences(head: PersonalDocument, selected: PersonalDocumentVersion): { field: string; current: string; historical: string; changed: boolean }[];
