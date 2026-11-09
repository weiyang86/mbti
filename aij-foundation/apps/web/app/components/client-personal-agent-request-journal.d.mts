import type { DocumentGenerationRef, DocumentGenerationRunEnvelope, DocumentGenerationRecovery } from "@aij/sdk";

export type Owner = Readonly<{ memberId: string; workspaceId: string }>;
export type RequestStatus = "unconfirmed" | "queued" | "running" | "succeeded" | "failed" | "unknown";
export type PersonalAgentEntry = Readonly<{
  memberId: string; workspaceId: string; agentId: string; revision: number; key: string; digest: string; runId: string | null; status: RequestStatus;
}>;
export type GenerationEntry = PersonalAgentEntry & Readonly<{ family: "document-generation"; origin: DocumentGenerationRef; attempted: true }>;
export type PersonalJournalEntry = PersonalAgentEntry | GenerationEntry;
export type PersonalJournalSelector = Readonly<{ family: "personal-agent"; workspaceId: string; agentId: string }> | Readonly<{ family: "document-generation"; workspaceId: string }>;
export type StorageLike = Pick<Storage, "getItem" | "setItem">;
export type JournalGuard = () => boolean;
export type RecoveryLock = (name: string, fn: () => unknown) => Promise<unknown>;
export type GenerationMetadata = Readonly<{ runId: string; status: GenerationEntry["status"]; origin: DocumentGenerationRef }>;
export type JournalPort = Readonly<{
  getSnapshot(owner: Owner): GenerationEntry | null;
  subscribe(notify: () => void): () => void;
  load(owner: Owner, signal: AbortSignal): Promise<GenerationEntry | null>;
  submitOnce(intent: Readonly<{ owner: Owner; origin: DocumentGenerationRef; digest: string }>, send: (key: string) => Promise<DocumentGenerationRunEnvelope>, signal: AbortSignal): Promise<DocumentGenerationRunEnvelope | null>;
  bind(expected: GenerationEntry, metadata: GenerationMetadata, signal: AbortSignal): Promise<GenerationEntry>;
  acknowledgeTerminal(expected: GenerationEntry, verify: () => Promise<DocumentGenerationRecovery>, signal: AbortSignal): Promise<boolean>;
  suspend(): void;
}>;
export type PersonalRequestJournalStorage = Readonly<{
  read(memberId: string, guard: JournalGuard): PersonalJournalEntry[];
  locked<T>(memberId: string, guard: JournalGuard, fn: () => T | Promise<T>): Promise<T>;
  compareExchange(memberId: string, selector: PersonalJournalSelector, expected: PersonalJournalEntry | null, replacement: PersonalJournalEntry | null, guard: JournalGuard): boolean;
}>;
export class PersonalRequestJournalError extends Error { constructor(); }
export function personalJournalKey(memberId: string): string;
export function parsePersonalJournal(raw: string | null, memberId: string): PersonalJournalEntry[];
export function samePersonalJournalEntry(a: unknown, b: unknown): boolean;
export function findPersonalJournalEntry(entries: readonly PersonalJournalEntry[], selector: Readonly<{ family: "document-generation"; workspaceId: string }>): GenerationEntry | null;
export function findPersonalJournalEntry(entries: readonly PersonalJournalEntry[], selector: Readonly<{ family: "personal-agent"; workspaceId: string; agentId: string }>): PersonalAgentEntry | null;
export function findPersonalJournalEntry(entries: readonly PersonalJournalEntry[], selector: PersonalJournalSelector): PersonalJournalEntry | null;
export function createPersonalRequestJournalStorage(options: Readonly<{ journalStorage: () => StorageLike; withRecoveryLock?: RecoveryLock }>): PersonalRequestJournalStorage;
export function createDocumentGenerationJournal(options: Readonly<{ journalStorage: () => StorageLike; withRecoveryLock?: RecoveryLock; makeKey?: () => string }>): JournalPort;
