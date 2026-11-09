import type { ClientApi, ClientApiOptions } from './index.js';
import { CLIENT_BINARY_LIMIT, type ClientBinaryResponse } from './client-binary-response.js';
export type ExportMeta = Readonly<{ id: string; documentId: string; revision: number; format: 'docx' | 'pdf'; mimeType: string; size: number; checksum: string; rendererVersion: string; pageCount: number | null; createdAt: string }>;
export type ExportOptions = Readonly<{ signal?: AbortSignal }>;
export type CreateDocumentExport = Readonly<{ documentId: string; expectedRevision: number; format: 'docx' | 'pdf' }>;
const MIME = { docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', pdf: 'application/pdf' };
function reject(): never { throw new TypeError('Invalid document export response'); }
function object(v: unknown, keys: string[]): Record<string, unknown> {
  if (!v || typeof v !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(v)) || Reflect.ownKeys(v).length !== keys.length || keys.some(k => !Object.hasOwn(v, k)) ||
    Reflect.ownKeys(v).some(k => typeof k !== 'string' || !keys.includes(k) || !Object.hasOwn(Object.getOwnPropertyDescriptor(v, k)!, 'value'))) reject();
  return v as Record<string, unknown>;
}
function uuid(v: unknown): string { if (typeof v !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)) reject(); return v.toLowerCase(); }
function revision(v: unknown): number { if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 200) reject(); return v; }
function format(v: unknown): 'docx' | 'pdf' { if (v !== 'docx' && v !== 'pdf') reject(); return v; }
export function parseDocumentExportMeta(raw: unknown): ExportMeta {
  const b = object(raw, ['id','documentId','revision','format','mimeType','size','checksum','rendererVersion','pageCount','createdAt']);
  const f = format(b.format);
  if (b.mimeType !== MIME[f] || typeof b.size !== 'number' || !Number.isInteger(b.size) || b.size < 1 || b.size > CLIENT_BINARY_LIMIT ||
    typeof b.checksum !== 'string' || !/^[a-f0-9]{64}$/.test(b.checksum) || b.rendererVersion !== 'aij-plain-document-v1' ||
    (f === 'pdf' ? typeof b.pageCount !== 'number' || !Number.isInteger(b.pageCount) || b.pageCount < 1 || b.pageCount > 100 : b.pageCount !== null) ||
    typeof b.createdAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(b.createdAt) || !Number.isFinite(Date.parse(b.createdAt)) || new Date(b.createdAt).toISOString() !== b.createdAt) reject();
  return { ...b, id: uuid(b.id), documentId: uuid(b.documentId), revision: revision(b.revision), format: f } as ExportMeta;
}
function input<T>(fn: () => T): T { try { return fn(); } catch { throw Object.assign(new TypeError('Invalid document export request'), { status: 400 }); } }
function same(m: ExportMeta, id: string, r?: number, f?: string) { if (m.documentId !== id || r !== undefined && m.revision !== r || f !== undefined && m.format !== f) reject(); }
/** Unknown success/network/5xx is deliberately not retried. One explicit call means one transport call. */
export function createPersonalDocumentExportsClient(api: ClientApi) {
  const base = '/client/document-exports';
  async function request(workspace: string, path: string, options: ClientApiOptions & { responseKind?: 'binary'; maxResponseBytes?: number }, user?: ExportOptions) {
    input(() => { if (typeof workspace !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(workspace)) reject(); });
    const abort = new AbortController(), cancel = () => abort.abort();
    const timer = setTimeout(cancel, 120000);
    user?.signal?.addEventListener('abort', cancel, { once: true }); if (user?.signal?.aborted) cancel();
    try { return await api<unknown>(path, { ...options, workspaceId: workspace, cache: 'no-store', signal: abort.signal }); }
    finally { clearTimeout(timer); user?.signal?.removeEventListener('abort', cancel); }
  }
  return {
    async capability(workspace: string) {
      const b = object(await request(workspace, base + '/capability', {}), ['configured','canExport','reason']);
      if (typeof b.configured !== 'boolean' || typeof b.canExport !== 'boolean' || !['ready','not_configured','not_permitted'].includes(b.reason as string) ||
        b.canExport !== (b.reason === 'ready') || b.reason === 'ready' && !b.configured || b.reason === 'not_configured' && b.configured) reject();
      return b as { configured: boolean; canExport: boolean; reason: 'ready' | 'not_configured' | 'not_permitted' };
    },
    async create(workspace: string, raw: CreateDocumentExport, options?: ExportOptions): Promise<ExportMeta> {
      const dto = input(() => { const b = object(raw, ['documentId','expectedRevision','format']); return { documentId: uuid(b.documentId), expectedRevision: revision(b.expectedRevision), format: format(b.format) }; });
      const m = parseDocumentExportMeta(await request(workspace, base, { method: 'POST', body: JSON.stringify(dto) }, options)); same(m, dto.documentId, dto.expectedRevision, dto.format); return m;
    },
    async list(workspace: string, raw: { documentId: string; revision: number }, options?: ExportOptions) {
      const dto = input(() => { const b = object(raw, ['documentId','revision']); return { documentId: uuid(b.documentId), revision: revision(b.revision) }; });
      const b = object(await request(workspace, base + '?' + new URLSearchParams({ documentId: dto.documentId, revision: String(dto.revision) }), {}, options), ['items']);
      if (!Array.isArray(b.items) || b.items.length > 2) reject();
      const items = b.items.map(parseDocumentExportMeta); for (const m of items) same(m, dto.documentId, dto.revision);
      if (new Set(items.map(m => m.format)).size !== items.length || new Set(items.map(m => m.id)).size !== items.length) reject();
      return { items };
    },
    async get(workspace: string, rawId: string, options?: ExportOptions): Promise<ExportMeta> {
      const id = input(() => uuid(rawId)), m = parseDocumentExportMeta(await request(workspace, base + '/' + id, {}, options)); if (m.id !== id) reject(); return m;
    },
    async download(workspace: string, expected: ExportMeta, options?: ExportOptions) {
      const m = input(() => parseDocumentExportMeta(expected));
      const result = await request(workspace, base + '/' + m.id + '/content', { responseKind: 'binary', maxResponseBytes: CLIENT_BINARY_LIMIT }, options) as ClientBinaryResponse;
      let success = false;
      try {
        if (!result || !(result.bytes instanceof Uint8Array) || !(result.headers instanceof Headers) || result.bytes.length !== m.size) reject();
        const h = result.headers;
        for (const [k,v] of Object.entries({ 'content-length': String(m.size), 'content-type': m.mimeType, 'x-aij-document-id': m.documentId, 'x-aij-document-revision': String(m.revision), 'x-aij-export-id': m.id, 'x-aij-checksum-sha256': m.checksum, 'x-aij-renderer-version': m.rendererVersion, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' })) if (h.get(k) !== v) reject();
        const filename = `document-${m.documentId}-r${m.revision}.${m.format}`;
        if (h.get('content-disposition') !== `attachment; filename="${filename}"`) reject();
        const hash = [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', new Uint8Array(result.bytes)))].map(v => v.toString(16).padStart(2,'0')).join('');
        if (hash !== m.checksum || options?.signal?.aborted) reject();
        success = true; return { bytes: result.bytes, filename, mimeType: m.mimeType, checksum: hash };
      } finally { if (!success && result?.bytes instanceof Uint8Array) result.bytes.fill(0); }
    }
  };
}
export type PersonalDocumentExportsPort = ReturnType<typeof createPersonalDocumentExportsClient>;
