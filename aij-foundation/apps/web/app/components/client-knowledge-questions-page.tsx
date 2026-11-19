"use client";

import { ClientKnowledgeCitation } from "./client-knowledge-citation";

import { PageHeading } from "@aij/ui";
import { Alert, Button, ConfigProvider, Empty, Form, Input, Select, Spin, Tag } from "antd";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { clientApi, ClientRequestFailure } from "./client-api.mjs";
import {
  createKnowledgeQuestionsApi,
  knowledgeQuestionDisplay,
  knowledgeQuestionPageMode,
  knowledgeQuestionRequestMessage,
  type KnowledgeQuestion
} from "./client-knowledge-questions";
import { adminTheme } from "./admin-api";

type ClientPrincipal = { id: string; email: string | null; nickname: string };
type WorkspaceItem = { workspace: { id: string; name: string }; role: { name: string } };
type WorkspacePage = { items: WorkspaceItem[] };
type WorkspaceContext = { workspaceId: string; workspaceName: string; permissions: string[] };
const api = createKnowledgeQuestionsApi();
const queryPermission = "workspace.knowledge.query";
const theme = { token: { ...adminTheme.token, colorPrimary: "#315b3a" } };
const terminalStatuses = new Set<KnowledgeQuestion["status"]>(["answered", "refused", "failed"]);
const maxPolls = 120;

export function ClientKnowledgeQuestionsPage() {
  const router = useRouter();
  const [principal, setPrincipal] = useState<ClientPrincipal | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceItem[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [context, setContext] = useState<WorkspaceContext | null>(null);
  const [question, setQuestion] = useState<KnowledgeQuestion | null>(null);
  const [query, setQuery] = useState("");
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pollError, setPollError] = useState("");
  const [pollCount, setPollCount] = useState(0);
  const requestVersion = useRef(0);

  const loadWorkspace = useCallback(async (id: string) => {
    const version = ++requestVersion.current;
    setWorkspaceId(id);
    setContext(null);
    setQuestion(null);
    setPollError("");
    setPollCount(0);
    setError("");
    if (!id) return;
    try {
      const next = await clientApi("/client/workspaces/context", { workspaceId: id }) as WorkspaceContext;
      if (version === requestVersion.current) setContext(next);
    } catch (failure) {
      if (version !== requestVersion.current) return;
      if (failure instanceof ClientRequestFailure && failure.status === 401) router.replace("/client/login");
      else setError(knowledgeQuestionRequestMessage(failure));
    }
  }, [router]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const session = await clientApi("/client/auth/me") as ClientPrincipal;
        if (!active) return;
        setPrincipal(session);
        const result = await clientApi("/client/workspaces?page=1&pageSize=100") as WorkspacePage;
        if (!active) return;
        setWorkspaces(result.items);
        const requested = new URL(window.location.href).searchParams.get("workspaceId");
        const selected = result.items.find(item => item.workspace.id === requested)?.workspace.id ?? result.items[0]?.workspace.id ?? "";
        await loadWorkspace(selected);
      } catch (failure) {
        if (!active) return;
        if (failure instanceof ClientRequestFailure && failure.status === 401) router.replace("/client/login");
        else setError(knowledgeQuestionRequestMessage(failure));
      } finally { if (active) setChecking(false); }
    })();
    return () => { active = false; requestVersion.current += 1; };
  }, [loadWorkspace, router]);

  useEffect(() => {
    if (!workspaceId || !question || terminalStatuses.has(question.status) || pollError || pollCount >= maxPolls) return;
    let active = true;
    const timer = window.setTimeout(() => {
      void api.get(workspaceId, question.id).then(next => {
        if (active) { setQuestion(next); setPollCount(count => count + 1); }
      }).catch(failure => {
        if (!active) return;
        if (failure instanceof ClientRequestFailure && failure.status === 401) router.replace("/client/login");
        setPollError(knowledgeQuestionRequestMessage(failure));
      });
    }, 750);
    return () => { active = false; window.clearTimeout(timer); };
  }, [pollCount, pollError, question, router, workspaceId]);

  async function signOut() {
    setBusy(true);
    try { await clientApi("/client/auth/logout", { method: "POST" }); router.replace("/client/login"); }
    catch (failure) {
      if (failure instanceof ClientRequestFailure && failure.status === 401) router.replace("/client/login");
      else setError(knowledgeQuestionRequestMessage(failure));
    } finally { setBusy(false); }
  }

  async function submit() {
    if (!workspaceId || !context?.permissions.includes(queryPermission) || !query.trim()) return;
    setBusy(true); setError(""); setPollError(""); setQuestion(null); setPollCount(0);
    try {
      const submitted = await api.submit(workspaceId, query.trim(), crypto.randomUUID());
      setQuestion(submitted);
    } catch (failure) {
      if (failure instanceof ClientRequestFailure && failure.status === 401) router.replace("/client/login");
      else setError(knowledgeQuestionRequestMessage(failure));
    } finally { setBusy(false); }
  }

  async function refreshQuestion() {
    if (!question || !workspaceId) return;
    setPollError("");
    if (pollCount >= maxPolls) setPollCount(0);
    try { setQuestion(await api.get(workspaceId, question.id)); }
    catch (failure) {
      if (failure instanceof ClientRequestFailure && failure.status === 401) router.replace("/client/login");
      setPollError(knowledgeQuestionRequestMessage(failure));
    }
  }

  const canQuery = Boolean(context?.permissions.includes(queryPermission));
  const mode = knowledgeQuestionPageMode({ loading: checking, error, hasWorkspace: workspaces.length > 0 && Boolean(workspaceId), canQuery });
  const display = question ? knowledgeQuestionDisplay(question) : null;
  const timedOut = Boolean(question && !terminalStatuses.has(question.status) && pollCount >= maxPolls && !pollError);

  return <ConfigProvider theme={theme}><div className="client-workspace-frame">
    <header className="client-workspace-topbar"><Link href="/client/workspaces" className="auth-brand">AIJ<span>FOUNDATION</span></Link>
      <div className="client-topbar-identity"><span>{principal?.nickname || principal?.email || "客户账号"}</span><Button onClick={() => void signOut()} loading={busy}>退出登录</Button></div>
    </header>
    <main className="client-workspace-main">
      <PageHeading eyebrow="客户 Workspace" title="知识问答" description="问题由当前 Workspace 的有效知识提供依据；答案和引用来自服务端异步任务。" actions={<Button onClick={() => router.push("/client/workspaces")}>返回 Workspace</Button>} />
      {error && <Alert role="alert" className="admin-error" type="error" showIcon title={error} />}
      {mode === "loading" ? <div role="status" className="auth-loading"><Spin /><span>正在确认会话与 Workspace 权限…</span></div> : mode === "no-workspace" ? <section className="client-empty-state"><Empty description="当前账号没有可访问的 Workspace" /><Link href="/client/workspaces">返回 Workspace</Link></section> : mode === "error" ? <section role="status" className="client-empty-state"><Empty description="知识问答暂时无法加载" /></section> : mode === "forbidden" ? <section className="client-empty-state"><Empty description="当前角色没有查询此 Workspace 知识的权限" /><Button onClick={() => router.push("/client/workspaces")}>返回 Workspace</Button></section> : <>
        <section className="client-workspace-picker" aria-labelledby="question-workspace-title">
          <div><label id="question-workspace-title" htmlFor="question-workspace-select">当前 Workspace</label><p>仅能选择当前账号已加入的空间；服务端仍会验证成员关系和查询权限。</p></div>
          <Select id="question-workspace-select" aria-label="选择 Workspace" value={workspaces.some(item => item.workspace.id === workspaceId) ? workspaceId : undefined} placeholder="选择 Workspace" options={workspaces.map(item => ({ value: item.workspace.id, label: `${item.workspace.name} · ${item.role.name}` }))} onChange={id => void loadWorkspace(id)} />
        </section>
        {context && <>
          <section className="admin-overview-section">
            <Form layout="vertical" onFinish={() => void submit()}>
              <Form.Item label="你的问题" required>
                <Input.TextArea aria-label="你的问题" value={query} onChange={event => setQuery(event.target.value)} maxLength={500} showCount rows={4} placeholder="例如：合成知识文档中规定的响应时限是多少？" />
              </Form.Item>
              <Button type="primary" htmlType="submit" loading={busy} disabled={!query.trim() || !canQuery}>提交问题</Button>
            </Form>
          </section>
          {question && display && <section className="admin-overview-section" aria-live="polite" aria-busy={display.state === "queued" || display.state === "running"}>
            <div className="overview-section-heading"><h2>本次结果</h2><Tag color={display.state === "answered" ? "green" : display.state === "failed" ? "red" : "blue"}>{display.label}</Tag></div>
            {(display.state === "queued" || display.state === "running") && <div role="status" className="auth-loading"><Spin /><span>{display.message}</span></div>}
            {(display.state === "refused" || display.state === "failed") && <Alert role="status" type={display.state === "failed" ? "error" : "warning"} showIcon title={display.message} />}
            {display.state === "answered" && <><p className="knowledge-answer">{display.answer}</p><div className="knowledge-citations"><h3>依据来源</h3>{display.citations.map(citation => <article className="knowledge-citation" key={citation.documentId}><strong>{citation.title}</strong><code>{citation.documentCode}</code><p>{citation.excerpt}</p><ClientKnowledgeCitation request={clientApi} workspaceId={workspaceId} questionId={question.id} documentId={citation.documentId} /></article>)}</div></>}
            {pollError && <Alert role="alert" type="error" showIcon title={pollError} action={<Button onClick={() => void refreshQuestion()}>恢复轮询</Button>} />}
            {timedOut && <Alert role="status" type="info" showIcon title="任务仍在处理中。你可以稍后继续查询。" action={<Button onClick={() => void refreshQuestion()}>继续查询</Button>} />}
          </section>}
        </>}
      </>}
    </main>
  </div></ConfigProvider>;
}
