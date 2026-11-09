import { ClientRequestFailure } from "@aij/sdk";
import type { ClientApi } from "@aij/sdk";
import { clientApi } from "./client-api.mjs";

const QUESTIONS_PATH = "/client/ai/knowledge/questions";

export type KnowledgeQuestionStatus = "queued" | "running" | "answered" | "refused" | "failed";
export type KnowledgeCitation = {
  documentId: string;
  documentCode: string;
  title: string;
  excerpt: string;
  evidenceCoverage: number;
};
export type KnowledgeQuestion = {
  id: string;
  status: KnowledgeQuestionStatus;
  answer: string | null;
  citations: KnowledgeCitation[];
  refusalCode: "INSUFFICIENT_EVIDENCE" | null;
  failureCode: string | null;
  idempotentReplay: boolean;
  createdAt: string;
  updatedAt: string;
};
export type KnowledgeQuestionDisplay = {
  state: "queued" | "running" | "answered" | "refused" | "failed";
  label: string;
  message: string;
  answer: string | null;
  citations: KnowledgeCitation[];
};

export function createKnowledgeQuestionsApi(request: ClientApi = clientApi) {
  return {
    submit(workspaceId: string, query: string, idempotencyKey: string) {
      return request<KnowledgeQuestion>(QUESTIONS_PATH, {
        method: "POST",
        workspaceId,
        body: JSON.stringify({ query, idempotencyKey })
      });
    },
    get(workspaceId: string, questionId: string) {
      return request<KnowledgeQuestion>(`${QUESTIONS_PATH}/${encodeURIComponent(questionId)}`, { workspaceId });
    }
  };
}

export function knowledgeQuestionDisplay(question: KnowledgeQuestion): KnowledgeQuestionDisplay {
  if (question.status === "answered" && typeof question.answer === "string" && question.answer.trim()) {
    return { state: "answered", label: "已完成", message: "以下答案和引用由服务端生成。", answer: question.answer, citations: question.citations };
  }
  if (question.status === "refused") {
    return { state: "refused", label: "缺少依据", message: "当前知识库没有足够依据回答这个问题。", answer: null, citations: [] };
  }
  if (question.status === "failed") {
    return { state: "failed", label: "处理失败", message: "本次问答未能完成，请稍后重试。", answer: null, citations: [] };
  }
  if (question.status === "running") {
    return { state: "running", label: "正在生成", message: "正在核对当前 Workspace 的知识并整理答案。", answer: null, citations: [] };
  }
  return { state: "queued", label: "等待处理", message: "问题已提交，正在等待处理。", answer: null, citations: [] };
}

export function knowledgeQuestionPageMode({ loading = false, error = "", hasWorkspace = true, canQuery = true }: {
  loading?: boolean;
  error?: string;
  hasWorkspace?: boolean;
  canQuery?: boolean;
} = {}): "loading" | "error" | "no-workspace" | "forbidden" | "ready" {
  if (loading) return "loading";
  if (error) return "error";
  if (!hasWorkspace) return "no-workspace";
  if (!canQuery) return "forbidden";
  return "ready";
}

export function knowledgeQuestionRequestMessage(error: unknown): string {
  const status = error instanceof ClientRequestFailure ? error.status : 503;
  if (status === 400) return "请检查问题内容后重试。";
  if (status === 401) return "登录已失效，请重新登录。";
  if (status === 403) return "当前账号没有在此 Workspace 查询知识的权限。";
  if (status === 404) return "此问答记录当前不可用。";
  if (status === 409) return "相同请求标识已用于其他问题，请重新提交。";
  return "知识问答暂时不可用，请稍后重试。";
}
