import type { ClientApi, PersonalDocument } from "@aij/sdk";
export type DocumentSectionsScope = Readonly<{ memberId: string; workspaceId: string; documentId: string; revision: number }>;
/** Structural injection contracts matching frozen AF224; no unpublished SDK imports. */
export type DocumentSection = Readonly<{ id: string; index: number; title: string; level: number; start: number; end: number }>;
export type DocumentSectionsIndex = Readonly<{ format: "aij-plain-sections-v1"; documentId: string; revision: number; bodySha256: string;
  bodyLength: number; bodyByteLength: number; sections: readonly DocumentSection[] }>;
export type SectionDraft = Readonly<{ documentId: string; expectedRevision: number; sourceSha256: string; sectionId: string; body: string; changed: boolean }>;
export type SectionDraftProposal = SectionDraft & Readonly<{ memberId: string; workspaceId: string; roleId: string; roleCode: string;
  sessionGeneration: string; permissions: readonly string[] }>;
export type SectionsApi = Readonly<{ get(workspaceId: string, documentId: string, expectedRevision: number, signal?: AbortSignal): Promise<DocumentSectionsIndex> }>;
export type ComposeSectionDraft = (input: Readonly<{ document: PersonalDocument; index: DocumentSectionsIndex; sectionId: string; replacement: string }>) => Promise<SectionDraft>;
export type DocumentSectionsCallbacks = Readonly<{ request: ClientApi; sectionsApi: SectionsApi; composeDraft: ComposeSectionDraft;
  onDraftReady: (proposal: SectionDraftProposal) => boolean; onScopeRejected?: () => void }>;
export type DocumentSectionsState = Readonly<{ scopeKey: string | null; busy: boolean; canManage: boolean; head: PersonalDocument | null;
  index: DocumentSectionsIndex | null; selected: DocumentSection | null; replacement: string; comparison: SectionDraft | null;
  confirmation: boolean; issue: Readonly<{ status: number; message: string }> | null; notice: string }>;
export type DocumentSectionsEditor = {
  getSnapshot(): DocumentSectionsState; subscribe(fn: () => void): () => void; setScope(scope: DocumentSectionsScope | null): void;
  setCallbacks(callbacks: DocumentSectionsCallbacks): void; load(): Promise<void>; select(sectionId: string): Promise<void>; draft(replacement: string): void;
  preview(): Promise<void>; requestConfirmation(): Promise<void>; cancelConfirmation(): void; confirmDraft(): Promise<void>; suspend(): void; dispose(): void;
};
export declare function createDocumentSectionsEditor(options: DocumentSectionsCallbacks & { isActive?: () => boolean }): DocumentSectionsEditor;
