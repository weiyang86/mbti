"use client";

import { ClientRequestFailure, createKnowledgeCitationsClient, type ClientApi, type KnowledgeCitationSource } from "@aij/sdk";
import { Alert, Button, Modal, Spin } from "antd";
import { useEffect, useMemo, useSyncExternalStore } from "react";

type Scope = Readonly<{ workspaceId: string; questionId: string; documentId: string }>;
type Props = Scope & { request: ClientApi };
type Access = Readonly<{ memberId: string; session: string; key: string }>;
export type KnowledgeCitationView = Readonly<{
  stage: "closed" | "loading" | "source" | "error"; source: KnowledgeCitationSource | null; message: string;
}>;
const permission = "workspace.knowledge.query";
function message(error: unknown): string {
  const status = error instanceof ClientRequestFailure ? error.status : 503;
  if (status === 400) return "来源请求无效，请重新读取问答。";
  if (status === 401) return "登录已失效或会话已变化，请重新登录后查看。";
  if (status === 403) return "当前 Workspace、成员或角色权限已变化，请重新确认访问。";
  if (status === 404) return "当前来源已不可用，可能已停用或删除。";
  if (status === 409) return "来源已变化，无法将当前文本作为这次回答的依据。请重新提问。";
  if (status === 410) return "问答已超过七天保留期，无法查看来源。";
  return "暂时无法读取来源，请稍后手动重试。";
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ClientRequestFailure(403);
  return value as Record<string, unknown>;
}
const identity = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value)
  && !["__proto__", "constructor", "prototype"].includes(value);

/** In-memory read state used by the actual component. Unit collaborators only
 * prove these fences; real Cookie/RBAC/transaction acceptance belongs to root.
 */
export function createKnowledgeCitationController(request: ClientApi, scope: Scope) {
  const client = createKnowledgeCitationsClient(request), listeners = new Set<VoidFunction>();
  let view: KnowledgeCitationView = { stage: "closed", source: null, message: "" };
  let generation = 0, pending: AbortController | null = null, access: Access | null = null, checking = false;
  const valid = identity(scope.workspaceId) && [scope.questionId, scope.documentId].every(id => typeof id === "string" && /^[a-z0-9]{20,32}$/.test(id));
  const publish = (next: KnowledgeCitationView) => { view = next; listeners.forEach(listener => listener()); };
  const clear = () => {
    generation += 1; pending?.abort(); pending = null; access = null; checking = false;
    publish({ stage: "closed", source: null, message: "" });
  };
  async function authorize(signal: AbortSignal): Promise<Access> {
    signal.throwIfAborted();
    const me = record(await request<unknown>("/client/auth/me", { method: "GET", signal, cache: "no-store" }));
    signal.throwIfAborted();
    const context = record(await request<unknown>("/client/workspaces/context", { method: "GET", workspaceId: scope.workspaceId, signal, cache: "no-store" }));
    signal.throwIfAborted();
    if (!identity(me.id) || context.workspaceId !== scope.workspaceId || !identity(context.roleId) || !identity(context.roleCode)
      || typeof context.sessionGeneration !== "string" || !/^[a-f0-9]{64}$/.test(context.sessionGeneration)
      || !Array.isArray(context.permissions) || context.permissions.length > 512
      || context.permissions.some(value => typeof value !== "string") || !context.permissions.includes(permission)) throw new ClientRequestFailure(403);
    return { memberId: me.id, session: context.sessionGeneration,
      key: JSON.stringify([me.id, scope.workspaceId, context.roleId, context.roleCode, context.sessionGeneration, [...new Set(context.permissions)].sort()]) };
  }
  function same(before: Access, after: Access) {
    if (before.memberId !== after.memberId || before.session !== after.session) throw new ClientRequestFailure(401);
    if (before.key !== after.key) throw new ClientRequestFailure(403);
  }
  function failed(error: unknown, ticket: number) {
    if (ticket !== generation) return;
    clear(); publish({ stage: "error", source: null, message: message(error) });
  }
  return {
    getSnapshot: () => view,
    subscribe(listener: VoidFunction) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    clear,
    async open() {
      if (view.stage === "loading" || view.stage === "source") return;
      clear(); const ticket = generation;
      if (!valid) { failed(new ClientRequestFailure(400), ticket); return; }
      const controller = new AbortController(); pending = controller;
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]);
      publish({ stage: "loading", source: null, message: "" });
      let source: KnowledgeCitationSource | null = null;
      try {
        const before = await authorize(signal);
        if (ticket !== generation) return;
        source = await client.read(scope.workspaceId, scope.questionId, scope.documentId, { signal });
        if (ticket !== generation) return;
        const after = await authorize(signal);
        if (ticket !== generation) return;
        same(before, after); access = after;
        publish({ stage: "source", source, message: "" });
      } catch (error) { failed(error, ticket); }
      finally { source = null; }
    },
    async revalidate() {
      if (view.stage !== "source" || !access || !pending || checking) return;
      const ticket = generation, before = access, signal = AbortSignal.any([pending.signal, AbortSignal.timeout(8000)]);
      checking = true;
      try {
        const after = await authorize(signal);
        if (ticket !== generation) return;
        same(before, after);
      } catch (error) { failed(error, ticket); }
      finally { if (ticket === generation) checking = false; }
    }
  };
}

export function KnowledgeCitationDetails({ source }: { source: KnowledgeCitationSource }) {
  return <div style={{ minWidth: 0, overflowWrap: "anywhere" }}>
    <Alert type="info" showIcon title="当前可用来源，不是历史原文快照" />
    <p>以下是知识库当前保存的提取文本；知识库尚无不可变版本，不代表回答生成时的历史原文，也不会重新访问外部网页。</p>
    <dl style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 12 }}>{[["标题", source.title], ["文档编号", source.documentCode], ["当前文本更新时间", source.updatedAt], ["当前文本 SHA-256", source.checksum]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd style={{ marginInlineStart: 0 }}>{value}</dd></div>)}</dl>
    <h3>回答中的引用摘录</h3><p style={{ whiteSpace: "pre-wrap" }}>{source.excerpt}</p>
    <h3>当前保存文本</h3><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxWidth: "100%" }}>{source.content}</pre>
  </div>;
}

/** Inherits the original question page's AntD/adminTheme provider. */
export function ClientKnowledgeCitation({ request, workspaceId, questionId, documentId }: Props) {
  const controller = useMemo(() => createKnowledgeCitationController(request, { workspaceId, questionId, documentId }), [request, workspaceId, questionId, documentId]);
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useEffect(() => {
    const clear = () => controller.clear();
    const visibility = () => { if (document.visibilityState !== "visible") clear(); };
    window.addEventListener("blur", clear); window.addEventListener("pagehide", clear);
    document.addEventListener("visibilitychange", visibility);
    // Only revalidate current authorization; never poll or refetch the source.
    const timer = window.setInterval(() => { void controller.revalidate(); }, 2000);
    return () => {
      window.clearInterval(timer); window.removeEventListener("blur", clear); window.removeEventListener("pagehide", clear);
      document.removeEventListener("visibilitychange", visibility); controller.clear();
    };
  }, [controller]);
  const open = state.stage === "loading" || state.stage === "source";
  return <div>
    <Button onClick={() => { if (document.visibilityState === "visible") void controller.open(); }} disabled={open}>查看当前来源</Button>
    {state.message && <Alert role="status" type="warning" showIcon title={state.message} />}
    {open && <Modal title="当前可用来源" open onCancel={controller.clear} destroyOnHidden width={640}
      footer={<Button onClick={controller.clear}>关闭来源</Button>} styles={{ body: { minWidth: 0, overflowWrap: "anywhere" } }}>
      {state.stage === "loading" && <div role="status" aria-live="polite"><Spin /> 正在核对会话、Workspace 与当前来源…</div>}
      {state.source && <KnowledgeCitationDetails source={state.source} />}
    </Modal>}
  </div>;
}
