import type { ClientApi } from "./index.js";

export type KnowledgeCitationSource = Readonly<{
  questionId: string; documentId: string; documentCode: string; title: string; content: string;
  excerpt: string; updatedAt: string; checksum: string; sourceState: "CURRENT";
}>;
const invalid = (): never => { throw new TypeError("Invalid knowledge citation data"); };
const forbidden = ["__proto__", "prototype", "constructor"];
function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return invalid();
  const own = Reflect.ownKeys(value), descriptors = Object.getOwnPropertyDescriptors(value);
  if (own.length !== keys.length || keys.some(key => !Object.hasOwn(value, key)) || own.some(key => typeof key !== "string"
    || !keys.includes(key) || !descriptors[key]?.enumerable || !("value" in descriptors[key]!))) return invalid();
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (typeof value !== "string" || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) return invalid();
  return value;
}
function id(value: unknown): string { const v = text(value); if (!/^[a-z0-9]{20,32}$/.test(v)) return invalid(); return v; }
function workspace(value: unknown): string {
  const v = text(value); if (!/^[A-Za-z0-9_-]{1,128}$/.test(v) || forbidden.includes(v)) return invalid(); return v;
}
function options(raw: unknown): { signal?: AbortSignal } {
  if (raw === undefined) return {};
  if (!raw || typeof raw !== "object") return invalid();
  const own = Reflect.ownKeys(raw);
  const value = object(raw, own.length ? ["signal"] : []);
  if (value.signal !== undefined && !(value.signal instanceof AbortSignal)) return invalid();
  return { signal: value.signal as AbortSignal | undefined };
}
function aborted(signal?: AbortSignal) { signal?.throwIfAborted(); }
async function result(raw: unknown, questionId: string, documentId: string, signal?: AbortSignal): Promise<KnowledgeCitationSource> {
  aborted(signal);
  const r = object(raw, ["questionId", "documentId", "documentCode", "title", "content", "excerpt", "updatedAt", "checksum", "sourceState"]);
  if (id(r.questionId) !== questionId || id(r.documentId) !== documentId || r.sourceState !== "CURRENT") return invalid();
  const documentCode = text(r.documentCode), title = text(r.title), content = text(r.content), excerpt = text(r.excerpt);
  const bytes = new TextEncoder().encode(content);
  if (!documentCode.trim() || documentCode.length > 80 || !title.trim() || title.length > 160
    || !content.trim() || bytes.byteLength > 65536 || !excerpt.trim() || Array.from(excerpt).length > 400) return invalid();
  const updatedAt = text(r.updatedAt), checksum = text(r.checksum);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(updatedAt)
    || !Number.isFinite(Date.parse(updatedAt)) || new Date(updatedAt).toISOString() !== updatedAt || !/^[a-f0-9]{64}$/.test(checksum)) return invalid();
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  aborted(signal);
  if (Array.from(new Uint8Array(digest), v => v.toString(16).padStart(2, "0")).join("") !== checksum) return invalid();
  return { questionId, documentId, documentCode, title, content, excerpt, updatedAt, checksum, sourceState: "CURRENT" };
}
/** One bounded-source GET through the original Cookie/Workspace ClientApi; no retry. */
export function createKnowledgeCitationsClient(api: ClientApi) {
  return {
    async read(workspaceId: string, questionId: string, documentId: string, readOptions?: { signal?: AbortSignal }): Promise<KnowledgeCitationSource> {
      const w = workspace(workspaceId), q = id(questionId), d = id(documentId), { signal } = options(readOptions);
      aborted(signal);
      return result(await api<unknown>(`/client/ai/knowledge/questions/${q}/citations/${d}`, {
        method: "GET", workspaceId: w, signal, cache: "no-store"
      }), q, d, signal);
    }
  };
}
