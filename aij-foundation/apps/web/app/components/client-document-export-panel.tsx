"use client";

import { Alert, Button, ConfigProvider, Empty, Space, Typography } from "antd";
import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from "react";
import type { DocumentScope } from "./client-document-manager";
import { adminTheme } from "./admin-api";
import { createDocumentExportStore, type DocumentExportsPort, type ExportDocument, type ExportDownloadHost } from "./client-document-export-state.mjs";

export type { DocumentExportsPort, ExportDocument, ExportMeta, ExportCapability, ExportFormat } from "./client-document-export-state.mjs";
export type ClientDocumentExportPanelProps = Readonly<{
  scope: DocumentScope | null;
  document: ExportDocument | null;
  hasUnsavedChanges: boolean;
  api: DocumentExportsPort;
  onAccessFailure?: (error: unknown) => void;
}>;

const browserDownloads: ExportDownloadHost = {
  createObjectURL(bytes, mimeType) { return URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: mimeType })); },
  revokeObjectURL(url) { URL.revokeObjectURL(url); },
  download(url, filename) {
    const link = window.document.createElement("a");
    link.href = url; link.download = filename; link.hidden = true;
    window.document.body.append(link);
    try { link.click(); } finally { link.remove(); }
  }
};

/** No POST on mount/focus. The parent supplies freshly validated DocumentScope after concealment. */
export function ClientDocumentExportPanel({ scope, document: savedDocument, hasUnsavedChanges, api, onAccessFailure }: ClientDocumentExportPanelProps) {
  const [store] = useState(() => createDocumentExportStore(api, browserDownloads));
  useLayoutEffect(() => { store.setAccessFailure(onAccessFailure); }, [store, onAccessFailure]);
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  // Includes every scope field: session, role, permission set and server validation generation.
  const contextKey = JSON.stringify([scope, savedDocument?.id, savedDocument?.revision, hasUnsavedChanges]);
  useLayoutEffect(() => {
    store.setApi(api);
    store.setContext({ scope, document: savedDocument, hasUnsavedChanges });
    void store.capability();
  }, [store, contextKey, scope, savedDocument, hasUnsavedChanges, api]);
  useEffect(() => {
    const hide = () => store.conceal();
    const visibility = () => { if (window.document.visibilityState === "hidden") hide(); };
    window.addEventListener("blur", hide); window.addEventListener("pagehide", hide);
    window.document.addEventListener("visibilitychange", visibility);
    return () => { window.removeEventListener("blur", hide); window.removeEventListener("pagehide", hide); window.document.removeEventListener("visibilitychange", visibility); store.clear(); };
  }, [store]);
  const permission = !!scope?.permissions.includes("workspace.documents.read") && !!scope.permissions.includes("workspace.documents.export");
  const readable = store.canRead(), creatable = store.canCreate();
  return <ConfigProvider theme={adminTheme}><section aria-label="当前文档导出" style={{ minWidth: 0, maxWidth: "100%", overflowWrap: "anywhere" }}>
    <h3>Word 与 PDF 导出</h3>
    <p>{savedDocument ? `已保存版本 v${savedDocument.revision}` : "请先保存文档。"}</p>
    {!permission && <Alert type="info" showIcon title="当前会话需要文档读取与独立导出权限。" />}
    {hasUnsavedChanges && <Alert type="warning" showIcon title="有未保存修改，请先保存后再导出。" />}
    {state.suspended && <Alert type="info" title="导出数据已清除，请通过文档编辑器重新验证访问。" />}
    {state.capability?.reason === "not_configured" && <Alert type="info" showIcon title="待配置" description="文档导出服务尚未配置，生成暂不可用。" />}
    {state.capability?.reason === "not_permitted" && <Alert type="info" title="当前角色无导出权限。" />}
    {!state.capability && permission && savedDocument && !state.suspended && <Button disabled={state.busy} onClick={() => void store.capability()}>检查导出可用性</Button>}
    {state.issue && <Alert type="warning" role="alert" showIcon title={state.issue} />}
    {state.notice && <Alert type="info" role="status" title={state.notice} />}
    {state.unknown && <Alert type="warning" title="生成结果待核对" description="请回到原账号、空间与文档，读取原生成版本已有导出，再单独确认。确认时会重新验证访问和读取结果，不会重新生成。" action={<Button disabled={!readable || !state.checked} onClick={() => void store.acknowledge()}>已核对，确认结果</Button>} />}
    <Space wrap style={{ marginBlock: 12 }}>
      <Button disabled={!creatable} loading={state.busy} onClick={() => void store.create("docx")}>生成 Word</Button>
      <Button disabled={!creatable} onClick={() => void store.create("pdf")}>生成 PDF</Button>
      <Button disabled={!readable} onClick={() => void store.list()}>读取已有导出</Button>
    </Space>
    {!state.items.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚未读取或生成当前版本的导出" />}
    <ul style={{ paddingInlineStart: 20 }}>{state.items.map(item => <li key={item.id}>
      <Space wrap><Typography.Text>{item.format === "docx" ? "Word" : "PDF"} · v{item.revision}{item.format === "pdf" ? ` · ${item.pageCount} 页` : ""} · {item.size} 字节</Typography.Text>
        <Button disabled={!readable} onClick={() => void store.download(item.id)}>下载</Button></Space>
    </li>)}</ul>
    <Typography.Paragraph type="secondary">仅导出当前保存版本。下载需明确点击，不会自动生成或自动重试。</Typography.Paragraph>
  </section></ConfigProvider>;
}
