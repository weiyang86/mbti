"use client";

import { Alert, Button, ConfigProvider, Input, Modal, Space, Tag } from "antd";
import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { adminTheme } from "./admin-api";
import { createDocumentSectionsEditor } from "./client-document-sections-state.mjs";
import type { DocumentSectionsCallbacks, DocumentSectionsEditor, DocumentSectionsScope } from "./client-document-sections-state.mjs";

export type ClientDocumentSectionsPanelProps = DocumentSectionsCallbacks & Readonly<{ controller?: DocumentSectionsEditor; scope: DocumentSectionsScope | null }>;
const bounded = { minWidth: 0, maxWidth: "100%", overflowWrap: "anywhere" } as const;
function Value({ label, value }: { label: string; value: string }) {
  return <div style={bounded}><strong>{label}</strong><pre tabIndex={0} aria-label={label} style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxHeight: 240, overflow: "auto", marginBlock: 8 }}>{value || "（空正文）"}</pre></div>;
}

/** Permanently mount one controller. Scope=null fences content; never use a document key reset. */
export function ClientDocumentSectionsPanel({ controller, request, sectionsApi, composeDraft, scope, onDraftReady, onScopeRejected }: ClientDocumentSectionsPanelProps) {
  const titleId = useId(), draftId = useId();
  const trigger = useRef<React.ComponentRef<typeof Button>>(null);
  const pendingFocus = useRef<string | null>(null);
  const [store] = useState(() => controller ?? createDocumentSectionsEditor({ request, sectionsApi, composeDraft, onDraftReady, onScopeRejected,
    isActive: () => !document.hidden && document.hasFocus() }));
  useLayoutEffect(() => { store.setCallbacks({ request, sectionsApi, composeDraft, onDraftReady, onScopeRejected }); }, [store, request, sectionsApi, composeDraft, onDraftReady, onScopeRejected]);
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
  // Hide private values in the render before layout effects fence a changed/null scope.
  const readable = Boolean(scope && key === state.scopeKey);
  const head = readable ? state.head : null, index = readable ? state.index : null, selected = readable ? state.selected : null, comparison = readable ? state.comparison : null;
  useLayoutEffect(() => {
    const target = pendingFocus.current; pendingFocus.current = null;
    if (target === key && readable && !state.confirmation && !state.busy && !document.hidden && document.hasFocus()) trigger.current?.focus();
  }, [key, readable, state.confirmation, state.busy]);
  if (!scope) return null;
  return <ConfigProvider theme={adminTheme}><section className="admin-overview-section" aria-labelledby={titleId} aria-busy={state.busy} style={bounded}>
    <h3 id={titleId}>章节导航与局部草稿</h3>
    <p>读取已保存文档，选择一个完整章节（含标题）编辑并比较。应用只进入全文草稿，尚未保存，请在全文编辑器明确保存。</p>
    {state.issue && <Alert role="alert" showIcon type="warning" title={state.issue.message} />}
    {state.notice && <Alert role="status" showIcon type="info" title={state.notice} />}
    <Button disabled={state.busy} loading={state.busy} onClick={() => void store.load()}>验证并读取章节目录</Button>
    {head && index && <>
      <p>当前已保存版本 v{head.revision} · {index.sections.length} 个章节</p>
      {!state.canManage && <Alert showIcon type="info" title="当前角色只读" description="可以查看和比较章节，应用到全文草稿需要文档读取与管理权限。" />}
      <nav aria-label="文档章节目录" style={bounded}><ol style={{ paddingInlineStart: 20 }}>{index.sections.map(section => <li key={section.id} style={bounded}>
        <Button type="link" style={{ height: "auto", whiteSpace: "normal", textAlign: "start", maxWidth: "100%" }} disabled={state.busy}
          aria-current={selected?.id === section.id ? "true" : undefined} onClick={() => void store.select(section.id)}>{section.index + 1}. {section.title}</Button>
      </li>)}</ol></nav>
      {selected && <section aria-label="选中章节局部编辑" style={bounded}>
        <h4>{selected.title} <Tag>完整章节，含标题</Tag></h4>
        <Value label="选中原章节" value={head.body.slice(selected.start, selected.end)} />
        <label htmlFor={draftId}>局部草稿（替换完整章节，含标题）</label>
        <p>其余章节保持原样。若后面还有章节，非空替换须保留末尾换行；不会自动补换行。</p>
        <Input.TextArea id={draftId} value={readable ? state.replacement : ""} disabled={state.busy} autoSize={{ minRows: 5, maxRows: 14 }}
          onChange={event => store.draft(event.target.value)} />
        <Space wrap style={{ marginBlock: 12 }}>
          <Button disabled={state.busy} onClick={() => void store.preview()}>验证并预览局部替换</Button>
        </Space>
        {comparison && <section aria-label="局部替换前后预览" style={bounded}>
          <h4>章节比较 <Tag color={comparison.changed ? "processing" : "default"}>{comparison.changed ? "将改变" : "相同，无需应用"}</Tag></h4>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 18rem), 1fr))", gap: 16, minWidth: 0 }}>
            <Value label="替换前章节" value={head.body.slice(selected.start, selected.end)} /><Value label="替换后章节" value={state.replacement} />
          </div>
          <p>仅替换此完整章节；尚未保存。</p>
          <Button ref={trigger} type="primary" disabled={state.busy || !state.canManage || !comparison.changed} onClick={() => void store.requestConfirmation()}>检查应用到全文草稿（尚未保存）</Button>
        </section>}
      </section>}
    </>}
    {head && selected && comparison && state.confirmation && <Modal open title="确认应用到全文草稿（尚未保存）" okText="应用到全文草稿" cancelText="取消，返回比较" destroyOnHidden focusTriggerAfterClose={false}
      confirmLoading={state.busy} okButtonProps={{ disabled: state.busy }} maskClosable={false}
      onCancel={() => { pendingFocus.current = key; store.cancelConfirmation(); }} onOk={() => void store.confirmDraft()}>
      <p>替换已保存版本 v{head.revision} 中的完整章节“{selected.title}”（含标题），其余章节保持原样。</p>
      <p>尚未保存，请在全文编辑器明确保存。若全文编辑器已有未保存草稿或当前修订、权限变化，将拒绝应用。</p>
    </Modal>}
  </section></ConfigProvider>;
}
