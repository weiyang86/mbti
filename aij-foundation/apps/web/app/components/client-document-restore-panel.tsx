"use client";

import type { ClientApi } from "@aij/sdk";
import { Alert, Button, ConfigProvider, Empty, Modal, Space, Tag, Typography } from "antd";
import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { adminTheme } from "./admin-api";
import { createDocumentVersionRestore, documentRestoreDifferences } from "./client-document-restore-state.mjs";
import type { DocumentVersionRestoreScope, DocumentRestoreStore } from "./client-document-restore-state.mjs";

export type ClientDocumentVersionRestorePanelProps = Readonly<{
  controller?: DocumentRestoreStore; request: ClientApi; scope: DocumentVersionRestoreScope | null; onDocumentChanged: () => void; onScopeRejected?: () => void;
}>;
const bounded = { minWidth: 0, maxWidth: "100%", overflowWrap: "anywhere" } as const;
function Value({ label, value }: { label: string; value: string }) {
  return <div style={bounded}><strong>{label}</strong><pre tabIndex={0} aria-label={label} style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxHeight: 240, overflow: "auto", marginBlock: 8 }}>{value || "（空正文）"}</pre></div>;
}

/** Keep one instance permanently mounted even when scope=null; do not key it by document/owner. */
export function ClientDocumentVersionRestorePanel({ controller, request, scope, onDocumentChanged, onScopeRejected }: ClientDocumentVersionRestorePanelProps) {
  const trigger = useRef<React.ComponentRef<typeof Button>>(null);
  const pendingFocus = useRef<string | null>(null);
  const titleId = useId();
  const [store] = useState(() => controller ?? createDocumentVersionRestore({ request, onDocumentChanged, onScopeRejected,
    isActive: () => !document.hidden && document.hasFocus() }));
  useLayoutEffect(() => { store.setCallbacks({ request, onDocumentChanged, onScopeRejected }); }, [store, request, onDocumentChanged, onScopeRejected]);
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const memberId = scope?.memberId, workspaceId = scope?.workspaceId, documentId = scope?.documentId, revision = scope?.revision;
  const key = scope ? JSON.stringify([memberId, workspaceId, documentId, revision]) : null;
  useLayoutEffect(() => { store.setScope(memberId && workspaceId && documentId && revision ? { memberId, workspaceId, documentId, revision } : null); }, [store, memberId, workspaceId, documentId, revision]);
  useEffect(() => {
    const clear = () => { pendingFocus.current = null; store.suspend(); };
    const visibility = () => { if (document.hidden) clear(); };
    window.addEventListener("blur", clear); window.addEventListener("pagehide", clear); document.addEventListener("visibilitychange", visibility);
    return () => { window.removeEventListener("blur", clear); window.removeEventListener("pagehide", clear); document.removeEventListener("visibilitychange", visibility); pendingFocus.current = null; store.dispose(); };
  }, [store]);
  // Mask private values during render, before layout effects fence a new/null scope.
  const readable = Boolean(scope && key === state.scopeKey);
  const head = readable ? state.head : null, selected = readable ? state.selected : null, recovery = readable ? state.recovery : null;
  useLayoutEffect(() => {
    const target = pendingFocus.current; pendingFocus.current = null;
    if (target === key && readable && !state.confirmation && !state.busy && !state.locked && !document.hidden && document.hasFocus()) trigger.current?.focus();
  }, [key, readable, state.confirmation, state.busy, state.locked]);
  if (!scope && !state.locked) return null;
  return <ConfigProvider theme={adminTheme}><section className="admin-overview-section" aria-labelledby={titleId} aria-busy={state.busy} style={bounded}>
    <h3 id={titleId}>历史恢复为新版本</h3>
    <p>比较已保存文档与较旧历史的名称、正文，单独确认后创建新版本。旧版本与已有导出引用保留。</p>
    {state.issue && <Alert role="alert" showIcon type="warning" title={state.issue.message} />}
    {state.notice && <Alert role="status" showIcon type="info" title={state.notice} />}
    {state.locked && <Alert showIcon type="warning" title="前次恢复结果尚未确认，后续恢复已锁定" description="请回到原账号、原会话、原角色、原空间和原文档，主动读取当前结果，再单独确认。不会自动重试写入。" />}
    {scope && <Space wrap>
      <Button disabled={state.busy || state.locked} loading={state.busy && !state.locked} onClick={() => void store.loadHistory()}>验证并读取文档历史</Button>
      {state.locked && <Button disabled={state.busy} onClick={() => void store.readRecovery()}>读取前次恢复的当前结果</Button>}
    </Space>}
    {recovery && <section aria-label="前次恢复当前结果" style={bounded}>
      <h4>当前保存版本 v{recovery.revision}</h4><Value label="当前文档名称" value={recovery.name} /><Value label="当前文档正文" value={recovery.body} />
      <p>此读取不能单独证明前次请求是否提交成功。确认只解除恢复锁，不重发写入。</p>
      <Button disabled={state.busy || !state.canManage} onClick={() => void store.acknowledgeRecovery()}>已核对，重新验证并解除恢复锁</Button>
    </section>}
    {head && !state.locked && <>
      {!state.canManage && <Alert showIcon type="info" title="当前角色只读" description="可以查看和比较历史，恢复需要文档读取与管理权限。" />}
      {!state.versions.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前页没有历史版本" />}
      <ul style={{ paddingInlineStart: 20 }}>{state.versions.map(v => <li key={v.revision} style={bounded}><Space wrap>
        <span>v{v.revision} · {v.name}</span><Typography.Text type="secondary">{new Date(v.createdAt).toLocaleString("zh-CN")}</Typography.Text>
        <Button disabled={state.busy || v.revision >= head.revision} aria-label={`比较文档历史 v${v.revision}`} onClick={() => void store.selectVersion(v.revision)}>比较此版本</Button>
      </Space></li>)}</ul>
      <Button disabled={state.busy || !state.nextCursor} onClick={() => void store.loadHistory(true)}>读取更早版本</Button>
      {selected && <section aria-label="当前与历史文档比较" style={bounded}>
        <h4>当前 v{head.revision} 与历史 v{selected.revision}</h4>
        {documentRestoreDifferences(head, selected).map(item => { const label = item.field === "name" ? "名称" : "正文"; return <section key={item.field} aria-label={`${label}差异`} style={bounded}>
          <h4>{label} <Tag color={item.changed ? "processing" : "default"}>{item.changed ? "将改变" : "相同"}</Tag></h4>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 18rem), 1fr))", gap: 16, minWidth: 0 }}>
            <Value label={`当前${label}`} value={item.current} /><Value label={`历史${label}`} value={item.historical} />
          </div>
        </section>; })}
        {store.noChange() && <Alert role="status" showIcon type="info" title="名称和正文相同，无需创建新版本" />}
        <Button ref={trigger} type="primary" disabled={!store.canRestore()} onClick={() => void store.requestConfirmation()}>{store.noChange() ? "核对无需更改" : "检查恢复为新版本"}</Button>
      </section>}
    </>}
    {head && selected && state.confirmation && <Modal open title="确认文档历史恢复为新版本" okText="确认创建新版本" cancelText="取消，返回比较" destroyOnHidden focusTriggerAfterClose={false}
      confirmLoading={state.busy} okButtonProps={{ disabled: state.busy }} cancelButtonProps={{ disabled: state.busy }} closable={!state.busy} maskClosable={false}
      onCancel={() => { pendingFocus.current = key; store.cancelConfirmation(); }} onOk={() => void store.confirmRestore()}>
      <p>将历史 v{selected.revision} 的名称和正文保存为当前 v{head.revision} 之后的新版本，并检查当前修订。</p>
      <p>原编号、身份和引用保持不变。已有历史与导出不改写；若当前修订或权限发生变化，请重新读取并比较。</p>
    </Modal>}
  </section></ConfigProvider>;
}
