import type { DocumentScope } from './client-document-manager';
export type ExportFormat = 'docx' | 'pdf';
export type ExportMeta = Readonly<{ id: string; documentId: string; revision: number; format: ExportFormat; mimeType: string; size: number; checksum: string; rendererVersion: string; pageCount: number | null; createdAt: string }>;
export type ExportCapability = Readonly<{ configured: boolean; canExport: boolean; reason: 'ready' | 'not_configured' | 'not_permitted' }>;
export type ExportDocument = Readonly<{ id: string; revision: number; name: string }>;
export type ExportContext = Readonly<{ scope: DocumentScope | null; document: ExportDocument | null; hasUnsavedChanges: boolean }>;
/** Structural port of createPersonalDocumentExportsClient; root injects the actual guarded SDK. */
export type DocumentExportsPort = Readonly<{
  capability: (workspaceId: string) => Promise<ExportCapability>;
  create: (workspaceId: string, input: { documentId: string; expectedRevision: number; format: ExportFormat }, options?: { signal?: AbortSignal }) => Promise<ExportMeta>;
  list: (workspaceId: string, input: { documentId: string; revision: number }, options?: { signal?: AbortSignal }) => Promise<{ items: ExportMeta[] }>;
  get: (workspaceId: string, id: string, options?: { signal?: AbortSignal }) => Promise<ExportMeta>;
  download: (workspaceId: string, expected: ExportMeta, options?: { signal?: AbortSignal }) => Promise<{ bytes: Uint8Array; filename: string; mimeType: string; checksum: string }>;
}>;
export type ExportDownloadHost = Readonly<{
  createObjectURL: (bytes: Uint8Array, mimeType: string) => string;
  revokeObjectURL: (url: string) => void;
  download: (url: string, filename: string) => void;
}>;
export type ExportState = Readonly<{ capability: ExportCapability | null; items: readonly ExportMeta[]; busy: boolean; unknown: boolean; checked: boolean; conflict: boolean; issue: string; notice: string; suspended: boolean }>;
export function createDocumentExportStore(api: DocumentExportsPort, host: ExportDownloadHost, onAccessFailure?: (error: unknown) => void): {
  setApi: (api: DocumentExportsPort) => void;
  setAccessFailure: (callback?: (error: unknown) => void) => void;
  subscribe: (f: () => void) => () => void;
  getSnapshot: () => ExportState;
  setContext: (context: ExportContext) => void;
  conceal: () => void;
  clear: () => void;
  canRead: () => boolean;
  canCreate: () => boolean;
  capability: () => Promise<void>;
  create: (format: ExportFormat) => Promise<void>;
  list: () => Promise<void>;
  acknowledge: () => Promise<void>;
  download: (id: string) => Promise<void>;
};
