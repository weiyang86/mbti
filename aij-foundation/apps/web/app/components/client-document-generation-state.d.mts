import type { PersonalDocument, PersonalDocumentSectionIndex, DocumentGenerationRef, DocumentGenerationPreview,
  DocumentGenerationRunEnvelope, DocumentGenerationRecovery, createPersonalDocumentGenerationClient } from '@aij/sdk';

export type Owner = Readonly<{ memberId: string; workspaceId: string }>;
export type AuthPin = Owner & Readonly<{ roleId: string; roleCode: string; sessionGeneration: string; permissions: readonly string[]; validationKey: string }>;
export type SourcePin = AuthPin & Readonly<{ documentId: string; revision: number; bodySha256: string; sectionId: string; start: number; end: number; sectionSha256: string }>;
export type VerifiedSource = Readonly<{ pin: SourcePin; document: PersonalDocument; index: PersonalDocumentSectionIndex }>;
export type GenerationEntry = Readonly<{ memberId: string; workspaceId: string; agentId: string; revision: number; key: string; digest: string;
  runId: string | null; status: 'unconfirmed' | 'queued' | 'running' | 'succeeded' | 'failed' | 'unknown'; family: 'document-generation'; origin: DocumentGenerationRef; attempted: true }>;
export type JournalPort = Readonly<{
  getSnapshot: (owner: Owner) => GenerationEntry | null;
  subscribe: (notify: () => void) => () => void;
  load: (owner: Owner, signal: AbortSignal) => Promise<GenerationEntry | null>;
  submitOnce: (intent: Readonly<{ owner: Owner; origin: DocumentGenerationRef; digest: string }>, send: (key: string) => Promise<DocumentGenerationRunEnvelope>, signal: AbortSignal) => Promise<DocumentGenerationRunEnvelope | null>;
  bind: (expected: GenerationEntry, metadata: Readonly<{ runId: string; status: GenerationEntry['status']; origin: DocumentGenerationRef }>, signal: AbortSignal) => Promise<GenerationEntry>;
  acknowledgeTerminal: (expected: GenerationEntry, verify: () => Promise<DocumentGenerationRecovery>, signal: AbortSignal) => Promise<boolean>;
  suspend: () => void;
}>;
export type ScopePort = Readonly<{
  active: () => boolean;
  peekAuth: () => AuthPin | null;
  peekSaved: () => VerifiedSource | null;
  verifySource: (expected: SourcePin, mode: 'preview' | 'execute' | 'read', signal: AbortSignal) => Promise<VerifiedSource>;
  verifyRecovery: (owner: Owner, signal: AbortSignal) => Promise<AuthPin>;
  onScopeRejected: (status: 401 | 403 | 404) => void;
}>;
export type AgentChoice = Readonly<{ id: string; revision: number; name: string }>;
export type Availability = 'unchecked' | 'ready' | 'unpublished' | 'incompatible' | 'not_configured' | 'unavailable';
export type AssetsPort = Readonly<{
  list: (owner: Owner, afterId: string | null, signal: AbortSignal) => Promise<Readonly<{ items: readonly AgentChoice[]; nextCursor: string | null }>>;
  inspect: (owner: Owner, id: string, signal: AbortSignal) => Promise<Readonly<{ agent: AgentChoice; availability: Availability }>>;
}>;
export type GenerationApi = ReturnType<typeof createPersonalDocumentGenerationClient>;
export type GenerationAction = 'agents' | 'nextAgents' | 'agent' | 'instruction' | 'preview' | 'confirm' | 'submit' | 'recover' | 'acknowledge' | 'read';
export type GenerationPanelState = Readonly<{
  contextKey: string | null; busy: boolean; allowed: readonly GenerationAction[];
  source: Readonly<{ documentId: string; revision: number; bodySha256: string; sectionId: string; sectionTitle: string; start: number; end: number; text: string }> | null;
  agents: readonly AgentChoice[]; hasNextAgents: boolean; agentId: string; instruction: string; availability: Availability;
  preview: DocumentGenerationPreview | null; confirmation: boolean; acknowledged: boolean;
  run: DocumentGenerationRunEnvelope | null; recovery: DocumentGenerationRecovery | null; recoveryPending: boolean; issue: string; notice: string;
}>;
export type GenerationPanelView = Readonly<{
  getSnapshot: () => GenerationPanelState;
  subscribe: (notify: () => void) => () => void;
  loadAgents: (next: boolean) => Promise<void>;
  selectAgent: (id: string) => Promise<void>;
  setInstruction: (value: string) => void;
  preview: () => Promise<void>;
  requestConfirmation: () => Promise<void>;
  setAcknowledged: (value: boolean) => void;
  cancelConfirmation: () => void;
  confirmSubmit: () => Promise<void>;
  recover: () => Promise<void>;
  acknowledgeRecovery: () => Promise<void>;
  readResult: () => Promise<void>;
  suspend: () => void;
}>;
export type GenerationBindings = Readonly<{ scope: ScopePort; assets: AssetsPort; api: GenerationApi; journal: JournalPort }>;
export type DocumentGenerationController = GenerationPanelView & Readonly<{
  setContext: (contextKey: string | null) => void;
  setBindings: (bindings: GenerationBindings) => void;
  dispose: () => void;
}>;
export function createDocumentGenerationController(options: GenerationBindings & Readonly<{ timeoutMs?: number; now?: () => number }>): DocumentGenerationController;
