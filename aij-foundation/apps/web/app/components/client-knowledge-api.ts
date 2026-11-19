import { ClientRequestFailure, createKnowledgeWebImportsClient } from "@aij/sdk";
import type { ClientApi } from "@aij/sdk";
import { clientApi } from "./client-api.mjs";

const DOCUMENTS_PATH = "/client/ai/knowledge/documents";

export type KnowledgeDocument = {
  id: string;
  workspaceId: string;
  documentCode: string;
  title: string;
  content: string;
  status: "active" | "inactive";
  sourceFilename?: string | null;
  sourceChecksum?: string | null;
  createdAt: string;
  updatedAt: string;
};
export type KnowledgeDocumentInput = Pick<KnowledgeDocument, "documentCode" | "title" | "content">;
export type KnowledgeDocumentPatch = Partial<Pick<KnowledgeDocument, "title" | "content" | "status">>;
export type KnowledgeDocumentPage = { page: number; pageSize: number; total: number; items: KnowledgeDocument[] };
type KnowledgeDocumentMetadata = Omit<KnowledgeDocument, "content">;

export function createKnowledgeDocumentsApi(request: ClientApi = clientApi) {
  return {
    list(workspaceId: string, { page = 1, pageSize = 20, status = "all" }: { page?: number; pageSize?: number; status?: "active" | "inactive" | "all" } = {}) {
      const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize), status });
      return request<KnowledgeDocumentPage>(`${DOCUMENTS_PATH}?${query}`, { workspaceId });
    },
    create(workspaceId: string, values: KnowledgeDocumentInput) {
      return request<KnowledgeDocumentMetadata>(DOCUMENTS_PATH, {
        method: "POST", workspaceId, body: JSON.stringify(values)
      });
    },
    importFile(workspaceId: string, file: File) {
      const form = new FormData();
      form.append("documentCode", "import-" + crypto.randomUUID());
      form.append("title", file.name.slice(0, 160));
      form.append("file", file, file.name);
      return request<KnowledgeDocumentMetadata>(DOCUMENTS_PATH + "/import", { method: "POST", workspaceId, body: form });
    },
    update(workspaceId: string, documentId: string, expectedUpdatedAt: string, values: KnowledgeDocumentPatch) {
      return request<KnowledgeDocument>(`${DOCUMENTS_PATH}/${encodeURIComponent(documentId)}`, {
        method: "PATCH", workspaceId,
        body: JSON.stringify({ ...values, expectedUpdatedAt })
      });
    }
  };
}

export function knowledgePageMode({ loading = false, error = "", hasWorkspace = true, canManage = true, total = 0 }: { loading?: boolean; error?: string; hasWorkspace?: boolean; canManage?: boolean; total?: number } = {}): "loading" | "error" | "no-workspace" | "forbidden" | "empty" | "ready" {
  if (loading) return "loading";
  if (error) return "error";
  if (!hasWorkspace) return "no-workspace";
  if (!canManage) return "forbidden";
  return total === 0 ? "empty" : "ready";
}

export function knowledgeRequestMessage(error: unknown): string {
  const status = error instanceof ClientRequestFailure ? error.status : 503;
  if (status === 413) return "文件超过 50KB，请缩小后重试。";
  if (status === 400) return "请检查文档标题、编号和正文后重试。";
  if (status === 401) return "登录已失效，请重新登录。";
  if (status === 403) return "当前账号没有管理此 Workspace 知识库的权限。";
  if (status === 404) return "文档已不存在；请刷新列表后重试。";
  if (status === 409) return "文档已被更新；请刷新后重新编辑，未提交内容不会覆盖新版本。";
  return "知识库暂时不可用，请稍后重试。";
}

/** Actual public AF179 SDK; authentication and Workspace headers share the existing client. */
export function createKnowledgeWebImportApi(request: ClientApi = clientApi) {
  return createKnowledgeWebImportsClient(request);
}
