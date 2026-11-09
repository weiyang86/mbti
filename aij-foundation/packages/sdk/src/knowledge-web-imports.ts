import type { ClientApi } from "./index.js";

export type ImportKnowledgeWeb = Readonly<{ documentCode: string; title: string; url: string }>;
export type KnowledgeWebImportResult = Readonly<{
  id: string; workspaceId: string; documentCode: string; title: string; status: "inactive"; createdAt: string; updatedAt: string;
}>;
export type KnowledgeWebSource = Readonly<{
  documentId: string; sourceFilename: string; sourceChecksum: string;
  sourceUrl: string; sourceFinalUrl: string; sourceTextChecksum: string; sourceExtractionVersion: string;
  contentMatchesSource: boolean;
}>;
const invalid = (): never => { throw new Error("Invalid knowledge web request"); };
function identity(value: string): string {
  if (typeof value !== "string" || !/^[a-z0-9]{20,32}$/.test(value)) return invalid();
  return value;
}
function workspaceIdentity(value: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(value)
    || ["__proto__", "constructor", "prototype"].includes(value)) return invalid();
  return value;
}
function input(raw: ImportKnowledgeWeb): ImportKnowledgeWeb {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || Object.keys(raw).length !== 3
    || Object.keys(raw).some(key => !["documentCode", "title", "url"].includes(key))
    || typeof raw.documentCode !== "string" || !/^[a-z0-9][a-z0-9._-]{1,79}$/.test(raw.documentCode)
    || typeof raw.title !== "string" || !raw.title.trim() || raw.title.length > 160
    || Array.from(raw.title).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
    || typeof raw.url !== "string" || !raw.url || raw.url.length > 2048) return invalid();
  // Server performs the authoritative AF171 DNS/TLS/URL policy; SDK supplies no connection options.
  return { documentCode: raw.documentCode, title: raw.title, url: raw.url };
}
/** Reuses real ClientApi authentication/Workspace headers; one call, no implicit retry. */
export function createKnowledgeWebImportsClient(api: ClientApi) {
  const base = "/client/ai/knowledge/documents";
  return {
    importWeb(workspaceId: string, value: ImportKnowledgeWeb) {
      return api<KnowledgeWebImportResult>(base + "/import-web", {
        method: "POST", workspaceId: workspaceIdentity(workspaceId), body: JSON.stringify(input(value))
      });
    },
    getWebSource(workspaceId: string, documentId: string) {
      return api<KnowledgeWebSource>(base + "/" + identity(documentId) + "/web-source", { workspaceId: workspaceIdentity(workspaceId) });
    }
  };
}
