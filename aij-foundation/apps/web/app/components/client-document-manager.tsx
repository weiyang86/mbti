"use client";

import { ClientRequestFailure, createPersonalDocumentSectionsClient, composePersonalDocumentSectionDraft } from "@aij/sdk";
import type { ClientApi, PersonalDocumentsPort, PersonalDocument, PersonalDocumentSummary, PersonalDocumentVersion, PersonalDocumentVersionSummary } from "@aij/sdk";
import { PageHeading } from "@aij/ui";
import { Alert, Button, ConfigProvider, Empty, Form, Input, Modal, Space, Spin, Typography } from "antd";
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { ClientDocumentExportPanel, type DocumentExportsPort } from "./client-document-export-panel";
import { ClientDocumentVersionRestorePanel } from "./client-document-restore-panel";
import { createDocumentVersionRestore, type DocumentRestoreStore, type DocumentVersionRestoreScope } from "./client-document-restore-state.mjs";
import { ClientDocumentSectionsPanel } from "./client-document-sections-panel";
import { createDocumentSectionsEditor, type DocumentSectionsEditor, type SectionDraftProposal } from "./client-document-sections-state.mjs";
import { adminTheme } from "./admin-api";

export type DocumentScope = Readonly<{ workspaceId: string; memberId: string; sessionKey: string; roleId: string; roleCode?: string; validationKey: string; permissions: readonly string[] }>;
type Recovery = { kind: "create" | "update" | "delete"; id?: string; code?: string; checked: boolean };
type State = Readonly<{ scope: DocumentScope | null; busy: boolean; items: PersonalDocumentSummary[]; next: string | null; detail: PersonalDocument | null;
  editing: boolean; code: string; name: string; body: string; history: PersonalDocumentVersionSummary[]; historyNext: number | null; historical: PersonalDocumentVersion | null;
  issue: string; notice: string; conflict: boolean; recovery: Recovery | null; deletePrompt: boolean }>;
const blank = (): State => ({ scope: null, busy: false, items: [], next: null, detail: null, editing: false, code: "", name: "", body: "", history: [], historyNext: null, historical: null, issue: "", notice: "", conflict: false, recovery: null, deletePrompt: false });
const ownerKey = (s: DocumentScope | null) => s ? JSON.stringify([s.workspaceId, s.memberId, s.sessionKey]) : "";
const read = (s: State) => Boolean(s.scope?.permissions.includes("workspace.documents.read"));
const manage = (s: State) => read(s) && Boolean(s.scope?.permissions.includes("workspace.documents.manage"));
const status = (e: unknown) => typeof e === "object" && e !== null && "status" in e && typeof e.status === "number" ? e.status : 0;

export function savedDocumentRestoreScope(s: State): DocumentVersionRestoreScope | null {
  return read(s) && s.scope && s.detail && !s.editing && !s.busy && !s.recovery && !s.conflict && !s.historical && !s.deletePrompt
    ? { memberId: s.scope.memberId, workspaceId: s.scope.workspaceId, documentId: s.detail.id, revision: s.detail.revision } : null;
}

export function savedDocumentSectionsScope(s: State, restore?: Readonly<{ busy: boolean; confirmation: boolean; locked: boolean }>) {
  return !restore?.busy && !restore?.confirmation && !restore?.locked ? savedDocumentRestoreScope(s) : null;
}

/** RAM only. The host supplies the actual public SDK factory and current verified scope. */
export function createDocumentManagerStore(api: PersonalDocumentsPort, restore?: DocumentRestoreStore, sections?: DocumentSectionsEditor) {
  let state = blank(), epoch = 0, controller: AbortController | null = null;
  let suspendedScope: DocumentScope | null = null;
  const listeners = new Set<() => void>();
  const syncSections = () => sections?.setScope(savedDocumentSectionsScope(state, restore?.getSnapshot()));
  const publish = (patch: Partial<State>) => { state = { ...state, ...patch }; restore?.setScope(savedDocumentRestoreScope(state)); syncSections(); for (const f of listeners) f(); };
  const fence = () => { epoch++; controller?.abort(); controller = null; };
  const setScope = (scope: DocumentScope | null) => {
    if (!scope) { suspendedScope = state.scope ?? suspendedScope; const recovery = state.recovery ? { ...state.recovery, checked: false } : null; fence(); state = { ...blank(), recovery }; publish({}); return; }
    const recovery = ownerKey(scope) === ownerKey(state.scope ?? suspendedScope) && state.recovery ? { ...state.recovery, checked: false } : null;
    fence(); suspendedScope = null; state = { ...blank(), scope, recovery }; publish({});
  };
  const begin = () => { fence(); controller = new AbortController(); publish({ busy: true, issue: "", notice: "" }); return { token: epoch, signal: controller.signal, scope: state.scope! }; };
  const current = (token: number) => token === epoch;
  const clear = () => { fence(); suspendedScope = null; state = blank(); publish({}); };
  const denied = (e: unknown) => { if ([401, 403].includes(status(e))) { clear(); publish({ issue: "会话或权限已失效，请重新验证访问。" }); return true; } return false; };
  const fail = (e: unknown, mutation = false, recovery?: Recovery) => {
    if (denied(e)) return;
    if (mutation && ![400, 404, 409].includes(status(e))) publish({ recovery: recovery!, issue: "写入结果未知，已锁定后续变更。请主动读取当前状态并确认结果。" });
    else if (mutation && status(e) === 409) publish({ conflict: true, issue: "保存冲突或已达数量/历史上限。草稿已保留；请主动读取当前文档后合并，再保存。" });
    else publish({ issue: status(e) === 400 ? "输入不符合要求，请检查编号、名称和正文长度。" : "读取或操作失败，请重新验证访问或主动重读。" });
  };
  const restoreOperating = () => Boolean(restore?.getSnapshot().busy || restore?.getSnapshot().confirmation);
  const restoreBlocked = () => restoreOperating() || Boolean(restore?.getSnapshot().locked);
  const canMutate = () => manage(state) && !state.busy && !state.recovery && !state.conflict && !restoreBlocked();
  const canViewSaved = () => read(state) && !!state.detail && state.editing && !state.busy && !state.recovery && !state.conflict && !state.historical && !state.deletePrompt && !restoreBlocked() && state.name === state.detail.name && state.body === state.detail.body;
  const applyDetail = (r: PersonalDocument, editing = true) => publish({ detail: r, editing, code: r.code, name: r.name, body: r.body, history: [], historyNext: null, historical: null, conflict: false });
  return {
    subscribe(f: () => void) { listeners.add(f); return () => { listeners.delete(f); }; },
    getSnapshot: () => state,
    setScope,
    syncSections,
    applySectionDraft(proposal: SectionDraftProposal) {
      const source = sections?.getSnapshot(), scope = state.scope, detail = state.detail;
      if (!canMutate() || !savedDocumentSectionsScope(state, restore?.getSnapshot()) || !scope || !detail || !scope.roleCode ||
        !source?.head || !source.index || !source.selected || !source.comparison || !proposal || !proposal.changed ||
        source.scopeKey !== JSON.stringify([scope.memberId, scope.workspaceId, detail.id, detail.revision]) ||
        source.head.id !== detail.id || source.head.revision !== detail.revision || source.head.body !== detail.body ||
        source.index.documentId !== detail.id || source.index.revision !== detail.revision ||
        proposal.memberId !== scope.memberId || proposal.workspaceId !== scope.workspaceId || proposal.roleId !== scope.roleId || proposal.roleCode !== scope.roleCode ||
        proposal.sessionGeneration !== scope.sessionKey || !Array.isArray(proposal.permissions) ||
        JSON.stringify(proposal.permissions) !== JSON.stringify([...scope.permissions].sort()) ||
        proposal.documentId !== detail.id || proposal.expectedRevision !== detail.revision || proposal.sourceSha256 !== source.index.bodySha256 ||
        proposal.sectionId !== source.selected.id || proposal.body !== source.comparison.body ||
        proposal.sourceSha256 !== source.comparison.sourceSha256 || proposal.body === detail.body ||
        state.body !== detail.body || state.name !== detail.name) return false;
      publish({ body: proposal.body, editing: true, notice: "已应用到全文草稿，尚未保存，请在全文编辑器明确保存。" });
      return true;
    },
    clear,
    setApi(value: PersonalDocumentsPort) { if (api !== value) { this.conceal(); api = value; } },
    canViewSaved,
    viewSaved() { if (canViewSaved()) publish({ editing: false, history: [], historyNext: null, historical: null }); },
    editAgain() { if (canMutate() && state.detail && !state.historical && !state.deletePrompt) publish({ editing: true }); },
    clearHistory() { if (!state.busy && !restoreOperating()) publish({ history: [], historyNext: null, historical: null }); },
    async reloadRestored() {
      if (!read(state) || !state.detail || state.editing || state.busy || state.recovery || state.conflict || state.historical || state.deletePrompt || restoreBlocked()) return;
      const id = state.detail.id, op = begin();
      publish({ detail: null, name: "", body: "", code: "", history: [], historyNext: null, historical: null });
      try { const result = await api.get(op.scope.workspaceId, id, op.signal); if (current(op.token)) applyDetail(result, false); }
      catch (error) { if (current(op.token)) fail(error); } finally { if (current(op.token)) publish({ busy: false }); }
    },
    // Focus/visibility revalidation drops private text synchronously. Unknown outcomes stay locked within the same identity.
    async revalidate(validate: () => Promise<DocumentScope | null>) {
      const previous = state.scope ?? suspendedScope, recovery = state.recovery ? { ...state.recovery, checked: false } : null, key = ownerKey(previous); suspendedScope = previous; fence(); const token = epoch;
      state = { ...blank(), recovery, busy: true }; publish({});
      try { const scope = await validate(); if (!current(token)) return; state = { ...blank(), scope, recovery: ownerKey(scope) === key ? recovery : null }; publish({}); }
      catch { if (current(token)) { state = { ...blank(), recovery }; publish({ issue: "访问验证失败，内容已清除。" }); } }
    },
    conceal() { const recovery = state.recovery ? { ...state.recovery, checked: false } : null; suspendedScope = state.scope ?? suspendedScope; fence(); state = { ...blank(), recovery }; publish({}); },
    async list(next = false) {
      if (!read(state) || state.busy || restoreOperating()) return; const after = next ? state.next : null, op = begin();
      try { const p = await api.list(op.scope.workspaceId, after ? { afterId: after } : {}, op.signal); if (current(op.token)) publish({ items: p.items, next: p.nextCursor }); }
      catch (e) { if (current(op.token)) fail(e); } finally { if (current(op.token)) publish({ busy: false }); }
    },
    create() { if (!canMutate()) return; publish({ detail: null, editing: true, code: "", name: "", body: "", history: [], historyNext: null, historical: null, issue: "", notice: "" }); },
    close() { fence(); publish({ busy: false, deletePrompt: false, detail: null, editing: false, code: "", name: "", body: "", history: [], historyNext: null, historical: null }); },
    draft(field: "code" | "name" | "body", value: string) { if (canMutate() && state.editing && !(field === "code" && state.detail)) publish({ [field]: value }); },
    async open(id: string) {
      if (!read(state) || state.busy || state.recovery || restoreOperating()) return; const op = begin();
      try { const r = await api.get(op.scope.workspaceId, id, op.signal); if (current(op.token)) applyDetail(r, !restore?.getSnapshot().locked); }
      catch (e) { if (current(op.token)) fail(e); } finally { if (current(op.token)) publish({ busy: false }); }
    },
    async save() {
      if (!canMutate() || !state.editing) return;
      const { detail, code, name, body } = state, recovery: Recovery = detail ? { kind: "update", id: detail.id, checked: false } : { kind: "create", code, checked: false };
      const op = begin();
      // Mark before awaiting: focus/unmount/scope fences must not turn an interrupted mutation into an automatic replay.
      publish({ recovery });
      try { const r = detail ? await api.update(op.scope.workspaceId, detail.id, { expectedRevision: detail.revision, name, body }, op.signal) : await api.create(op.scope.workspaceId, { code, name, body }, op.signal);
        if (current(op.token)) { applyDetail(r); publish({ recovery: null, notice: "已保存。每次实际变更保留一条不可变历史。" }); } }
      catch (e) { if (current(op.token)) { publish({ recovery: null }); fail(e, true, recovery); } } finally { if (current(op.token)) publish({ busy: false }); }
    },
    deleteConfirmation() { const token = epoch; return () => this.remove(token); },
    askDelete() { if (canMutate() && state.detail) publish({ deletePrompt: true }); },
    dismissDelete() { publish({ deletePrompt: false }); return epoch; },
    canRestoreFocus(ticket: number) { return ticket === epoch && canMutate() && !!state.detail && !state.deletePrompt; },
    async remove(confirmedEpoch?: number) {
      if (confirmedEpoch !== undefined && confirmedEpoch !== epoch) return;
      if (!canMutate() || !state.detail) return; const d = state.detail, recovery: Recovery = { kind: "delete", id: d.id, checked: false }, op = begin(); publish({ recovery });
      try { await api.delete(op.scope.workspaceId, d.id, d.revision, op.signal); if (current(op.token)) publish({ detail: null, editing: false, code: "", name: "", body: "", history: [], historyNext: null, historical: null, recovery: null, items: state.items.filter(r => r.id !== d.id), notice: "已删除。编号不能复用；本阶段没有恢复入口。" }); }
      catch (e) { if (current(op.token)) { publish({ recovery: null }); fail(e, true, recovery); } } finally { if (current(op.token)) publish({ busy: false }); }
    },
    async history(next = false) {
      if (!read(state) || state.busy || !state.detail || restoreBlocked()) return; const id = state.detail.id, before = next ? state.historyNext : null, op = begin();
      try { const p = await api.versions(op.scope.workspaceId, id, before ? { beforeRevision: before } : {}, op.signal); if (current(op.token)) publish({ history: p.items, historyNext: p.nextCursor, historical: null }); }
      catch (e) { if (current(op.token)) fail(e); } finally { if (current(op.token)) publish({ busy: false }); }
    },
    async version(revision: number) {
      if (!read(state) || state.busy || !state.detail || restoreBlocked()) return; const id = state.detail.id, op = begin(); publish({ historical: null });
      try { const r = await api.getVersion(op.scope.workspaceId, id, revision, op.signal); if (current(op.token)) publish({ historical: r }); }
      catch (e) { if (current(op.token)) fail(e); } finally { if (current(op.token)) publish({ busy: false }); }
    },
    async checkUnknown() {
      if (!read(state) || state.busy || !state.recovery) return; const recovery = state.recovery, op = begin();
      try {
        let id = recovery.id;
        if (!id) { let cursor: string | null = null; for (let page = 0; page < 5; page++) { const p = await api.list(op.scope.workspaceId, cursor ? { afterId: cursor, limit: 50 } : { limit: 50 }, op.signal); if (!current(op.token)) return; id = p.items.find(r => r.code === recovery.code)?.id; cursor = p.nextCursor; if (id || !cursor) break; if (page === 4) throw new Error("Incomplete reconciliation"); } }
        const r = id ? await api.get(op.scope.workspaceId, id, op.signal) : null;
        if (current(op.token)) { if (r) applyDetail(r); else publish({ detail: null, editing: false, name: "", body: "", code: "", history: [], historyNext: null, historical: null }); publish({ recovery: { ...recovery, checked: true }, notice: r ? `当前服务端修订为 v${r.revision}，请核对后明确确认。` : "当前未找到文档。请明确确认读取结果后，才可重新操作。" }); }
      } catch (e) { if (current(op.token)) { if (status(e) === 404) publish({ detail: null, editing: false, code: "", name: "", body: "", history: [], historyNext: null, historical: null, recovery: { ...recovery, checked: true }, notice: "当前文档不存在。请确认读取结果。" }); else fail(e); } }
      finally { if (current(op.token)) publish({ busy: false }); }
    },
    acknowledge() { if (!state.busy && state.recovery?.checked) publish({ recovery: null, conflict: false, issue: "", notice: "已确认当前读取结果。下一次保存将使用当前修订。" }); }
  };
}

/** Stable composition: one restore store, also consulted by the original manager. */
export function createDocumentComposition({ api, request, onAccessFailure, isActive }: {
  api: PersonalDocumentsPort; request: ClientApi; onAccessFailure?: (error: unknown) => void; isActive?: () => boolean;
}) {
  const restore = createDocumentVersionRestore({ request, onDocumentChanged: () => {}, isActive });
  let sectionsApi = createPersonalDocumentSectionsClient(request);
  const sections = createDocumentSectionsEditor({ request, sectionsApi, composeDraft: composePersonalDocumentSectionDraft,
    onDraftReady: proposal => manager.applySectionDraft(proposal), isActive });
  const manager = createDocumentManagerStore(api, restore, sections);
  const conceal = () => { sections.suspend(); restore.suspend(); manager.conceal(); };
  const onScopeRejected = () => { conceal(); onAccessFailure?.(new ClientRequestFailure(403)); };
  const onDocumentChanged = () => { void manager.reloadRestored(); };
  const onDraftReady = (proposal: SectionDraftProposal) => manager.applySectionDraft(proposal);
  const bind = () => {
    restore.setCallbacks({ request, onDocumentChanged, onScopeRejected });
    sections.setCallbacks({ request, sectionsApi, composeDraft: composePersonalDocumentSectionDraft, onDraftReady, onScopeRejected });
  };
  const stopRestoreSubscription = restore.subscribe(manager.syncSections);
  bind();
  return { manager, restore, sections, conceal, onScopeRejected, onDocumentChanged, onDraftReady,
    get sectionsApi() { return sectionsApi; },
    dispose() { stopRestoreSubscription(); sections.dispose(); restore.dispose(); manager.conceal(); },
    setBindings(next: { api: PersonalDocumentsPort; request: ClientApi; onAccessFailure?: (error: unknown) => void }) {
      manager.setApi(next.api); if (request !== next.request) sectionsApi = createPersonalDocumentSectionsClient(next.request);
      request = next.request; onAccessFailure = next.onAccessFailure; bind();
    } };
}

export type ClientDocumentManagerProps = Readonly<{ api: PersonalDocumentsPort; request: ClientApi; subscribeInvalidation: (notify: () => void) => () => void; exportsApi: DocumentExportsPort; scope: DocumentScope | null; revalidate: () => Promise<DocumentScope | null>; onAccessFailure?: (error: unknown) => void }>;
export function ClientDocumentManager({ api, request, subscribeInvalidation, exportsApi, scope, revalidate, onAccessFailure }: ClientDocumentManagerProps) {
  const [composition] = useState(() => createDocumentComposition({ api, request, onAccessFailure, isActive: () => !document.hidden && document.hasFocus() }));
  const store = composition.manager;
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const restoreState = useSyncExternalStore(composition.restore.subscribe, composition.restore.getSnapshot, composition.restore.getSnapshot);
  // Mask old private state in render, before layout effects process a new parent identity.
  const state = scope && JSON.stringify(scope) === JSON.stringify(snapshot.scope) ? snapshot : blank();
  useLayoutEffect(() => composition.setBindings({ api, request, onAccessFailure }), [composition, api, request, onAccessFailure]);
  useLayoutEffect(() => subscribeInvalidation(composition.conceal), [composition, subscribeInvalidation]);
  const validate = useRef(revalidate);
  const deleteTrigger = useRef<HTMLButtonElement>(null);
  const [focusRequest, setFocusRequest] = useState<{ ticket: number } | null>(null);
  const handledFocus = useRef<typeof focusRequest>(null);
  useLayoutEffect(() => { validate.current = revalidate; }, [revalidate]);
  useLayoutEffect(() => { store.setScope(scope); }, [store, scope]); // identity includes session, role, permissions and validation generation
  useEffect(() => {
    if (!focusRequest || handledFocus.current === focusRequest || !store.canRestoreFocus(focusRequest.ticket)) return;
    handledFocus.current = focusRequest;
    deleteTrigger.current?.focus({ preventScroll: true });
  }, [focusRequest, state.deletePrompt, store]);
  useEffect(() => {
    const resume = () => { if (document.visibilityState === "hidden") store.conceal(); else void store.revalidate(() => validate.current()); };
    const hide = () => composition.conceal();
    window.addEventListener("blur", hide); window.addEventListener("focus", resume); window.addEventListener("pagehide", hide); document.addEventListener("visibilitychange", resume);
    return () => { window.removeEventListener("blur", hide); window.removeEventListener("focus", resume); window.removeEventListener("pagehide", hide); document.removeEventListener("visibilitychange", resume); composition.dispose(); };
  }, [store, composition]);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (state.editing || state.detail?.id) heading.current?.focus(); }, [state.editing, state.detail?.id]);
  const restoreOperating = restoreState.busy || restoreState.confirmation;
  const canRead = read(state), canManage = manage(state), locked = !canManage || state.busy || !!state.recovery || state.conflict || restoreOperating || restoreState.locked;
  const confirmDelete = state.deletePrompt ? store.deleteConfirmation() : null;
  const bound = { minWidth: 0, maxWidth: "100%", overflowWrap: "anywhere" } as const;
  return <ConfigProvider theme={adminTheme}><main className="client-workspace-main" style={bound}>
    <PageHeading eyebrow="个人文档" title="我的文档" description="纯文本编辑与不可变保存历史。手动编辑无需配置模型或密钥，不调用 AI。支持 Word、PDF 导出、历史恢复，以及章节导航和局部草稿比较。AI 分段生成将在后续提供。" actions={<Button disabled={state.busy} onClick={() => void store.revalidate(revalidate)}>重新验证访问</Button>} />
    {state.issue && <Alert role="alert" showIcon type="warning" title={state.issue} />}
    {state.notice && <Alert role="status" type="info" title={state.notice} />}
    {state.busy && <Spin aria-label="正在处理文档" />}
    {!canRead && <Alert type="info" title="请验证会话与空间文档读取权限" />}
    {canRead && <>
      {!canManage && <Alert type="info" title="当前角色只读，可以查看自己的文档与历史。" />}
      {state.recovery && <Alert type="warning" title="后续变更已锁定" description="读取只核对当前结果，不会重发写入。请核对服务端内容后再明确确认。" action={<Space wrap><Button disabled={state.busy} onClick={() => void store.checkUnknown()}>主动读取当前结果</Button><Button disabled={state.busy || !state.recovery.checked} onClick={() => store.acknowledge()}>已核对，确认结果</Button></Space>} />}
      <section className="admin-overview-section" aria-label="个人文档库" style={bound}>
        <Space wrap><h2>文档库</h2><Button disabled={state.busy || restoreOperating} onClick={() => void store.list()}>读取文档列表</Button><Button type="primary" disabled={locked} onClick={() => store.create()}>新建文档</Button></Space>
        <p>仅当前空间与当前成员可见。最多 100 份文档，每份最多 200 个保存版本。</p>
        {!state.items.length && <Empty description="当前页没有文档，点击读取列表查看" />}
        <ul style={{ paddingInlineStart: 20 }}>{state.items.map(r => <li key={r.id} style={bound}><Space wrap><span>{r.name} · v{r.revision}</span><Typography.Text type="secondary">{r.code}</Typography.Text><Button disabled={state.busy || !!state.recovery || restoreOperating} onClick={() => void store.open(r.id)}>打开</Button></Space></li>)}</ul>
        <Button disabled={state.busy || restoreOperating || !state.next} onClick={() => void store.list(true)}>下一页文档</Button>
      </section>
      {state.editing && <section className="admin-overview-section" aria-label="文档编辑器" style={bound}>
        <h2 tabIndex={-1} ref={heading}>{state.detail ? `编辑文档 · v${state.detail.revision}` : "新建纯文本文档"}</h2>
        <Form layout="vertical" autoComplete="off" onFinish={() => void store.save()}>
          <Form.Item label="编号" extra="2–63 位小写字母、数字和短横线，以字母开头。创建后不能修改，删除后不能复用。"><Input aria-label="文档编号" value={state.code} disabled={locked || !!state.detail} maxLength={63} onChange={e => store.draft("code", e.target.value)} /></Form.Item>
          <Form.Item label="名称" extra="1–160 个可见字符，首尾不能含空白。"><Input aria-label="文档名称" value={state.name} disabled={locked} onChange={e => store.draft("name", e.target.value)} /></Form.Item>
          <Form.Item label="正文" extra={`${new TextEncoder().encode(state.body).length} / 65,536 UTF-8 字节；支持空正文、换行与制表符。`}><Input.TextArea aria-label="文档正文" autoComplete="off" spellCheck={false} rows={14} value={state.body} readOnly={locked} onChange={e => store.draft("body", e.target.value)} /></Form.Item>
          {state.detail && <><p>比较恢复仅使用已保存版本。有未保存修改时，请先明确保存，或点击“丢弃草稿，读取当前版本”。</p><Button disabled={!store.canViewSaved()} onClick={() => store.viewSaved()}>退出编辑，比较历史</Button></>}
          <Space wrap><Button type="primary" htmlType="submit" disabled={locked}>明确保存</Button>{state.detail && <Button disabled={state.busy || !!state.recovery || restoreOperating} onClick={() => void store.open(state.detail!.id)}>丢弃草稿，读取当前版本</Button>}<Button disabled={state.busy} onClick={() => store.close()}>关闭并清除正文</Button></Space>
        </Form>
        {state.detail && <Space wrap><Button disabled={state.busy} onClick={() => void store.history()}>读取历史目录</Button><Button ref={deleteTrigger} danger disabled={locked} onClick={() => store.askDelete()}>删除文档</Button></Space>}
        <ul style={{ paddingInlineStart: 20 }}>{state.history.map(r => <li key={r.revision}><Space wrap><span>v{r.revision} · {r.name} · {r.createdAt}</span><Button disabled={state.busy} onClick={() => void store.version(r.revision)}>读取此版本</Button></Space></li>)}</ul>
        {!!state.historyNext && <Button disabled={state.busy} onClick={() => void store.history(true)}>更早的历史</Button>}
        {(state.historical || state.history.length > 0) && <Button disabled={state.busy} onClick={() => store.clearHistory()}>关闭历史预览</Button>}
        {state.historical && <div><h3>历史 v{state.historical.revision} · 只读</h3><Input.TextArea aria-label="历史正文（只读）" readOnly rows={10} value={state.historical.body} /></div>}
      </section>}
      {state.detail && !state.editing && <section className="admin-overview-section" aria-label="已保存文档" style={bound}>
        <h2 tabIndex={-1} ref={heading}>已保存文档 · v{state.detail.revision}</h2><h3>{state.detail.name}</h3>
        <pre tabIndex={0} aria-label="已保存正文" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxHeight: 320, overflow: "auto" }}>{state.detail.body || "（空正文）"}</pre>
        <Space wrap><Button disabled={locked} onClick={() => store.editAgain()}>继续编辑</Button><Button disabled={state.busy || restoreOperating} onClick={() => store.close()}>关闭并清除正文</Button></Space>
      </section>}
    </>}
    <ClientDocumentVersionRestorePanel controller={composition.restore} request={request} scope={savedDocumentRestoreScope(state)} onDocumentChanged={composition.onDocumentChanged} onScopeRejected={composition.onScopeRejected} />
    <ClientDocumentSectionsPanel controller={composition.sections} request={request} sectionsApi={composition.sectionsApi} composeDraft={composePersonalDocumentSectionDraft}
      scope={savedDocumentSectionsScope(state, restoreState)} onDraftReady={composition.onDraftReady} onScopeRejected={composition.onScopeRejected} />
    <ClientDocumentExportPanel api={exportsApi} scope={state.busy || restoreOperating || restoreState.locked ? null : state.scope}
      document={state.busy || restoreOperating || restoreState.locked || !state.detail ? null : { id: state.detail.id, revision: state.detail.revision, name: state.detail.name }}
      hasUnsavedChanges={!!state.detail && (state.name !== state.detail.name || state.body !== state.detail.body)}
      onAccessFailure={error => { store.conceal(); onAccessFailure?.(error); }} />
    {confirmDelete && <Modal title="删除此文档？" open okText="确认删除" cancelText="取消" destroyOnHidden focusTriggerAfterClose={false}
      onCancel={() => setFocusRequest({ ticket: store.dismissDelete() })}
      onOk={() => { store.dismissDelete(); if (confirmDelete) void confirmDelete(); }}>
      此操作隐藏文档及全部历史，编号永久保留；当前没有恢复入口。
    </Modal>}
  </main></ConfigProvider>;
}
