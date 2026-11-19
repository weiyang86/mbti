"use client";

import { PageHeading } from "@aij/ui";
import { Alert, Button, ConfigProvider, Empty, Form, Input, Modal, Select, Spin, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { clientApi, ClientRequestFailure } from "./client-api.mjs";
import { createKnowledgeDocumentsApi, createKnowledgeWebImportApi, knowledgePageMode, knowledgeRequestMessage } from "./client-knowledge-api";
import type { KnowledgeDocument, KnowledgeDocumentInput, KnowledgeDocumentPage, KnowledgeDocumentPatch } from "./client-knowledge-api";
import { ClientKnowledgeWebImport } from "./client-knowledge-web-import";
import { createKnowledgeWebImportState, isKnowledgeWebRow } from "./client-knowledge-web-import-state.mjs";
import { adminTheme } from "./admin-api";

type ClientPrincipal = { id: string; email: string | null; nickname: string };
type Workspace = { workspace: { id: string; name: string }; role: { name: string } };
type WorkspacePage = { items: Workspace[] };
type WorkspaceContext = { workspaceId: string; workspaceName: string; permissions: string[] };
const api = createKnowledgeDocumentsApi();
const theme = { token: { ...adminTheme.token, colorPrimary: "#315b3a" } };
const initialPage: KnowledgeDocumentPage = { page: 1, pageSize: 20, total: 0, items: [] };
const documentStatus = { active: "有效", inactive: "已停用" } as const;

export function ClientKnowledgeManager() {
  const router = useRouter();
  const [principal, setPrincipal] = useState<ClientPrincipal | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [context, setContext] = useState<WorkspaceContext | null>(null);
  const [page, setPage] = useState(initialPage);
  const [status, setStatus] = useState<"active" | "inactive" | "all">("all");
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<KnowledgeDocument | null>(null);
  const [createForm] = Form.useForm<KnowledgeDocumentInput>();
  const [editForm] = Form.useForm<KnowledgeDocumentPatch>();
  const [webImport] = useState(() => createKnowledgeWebImportState(createKnowledgeWebImportApi()));
  const webSnapshot = useSyncExternalStore(webImport.subscribe, webImport.getSnapshot, webImport.getSnapshot);
  const requestVersion = useRef(0);
  const [privacyEpoch, setPrivacyEpoch] = useState(0);
  const sourceFocus = useRef<HTMLElement | null>(null);
  const importInput = useRef<HTMLInputElement>(null);

  const clearPrivate = useCallback(() => {
    requestVersion.current += 1;
    setPrivacyEpoch(value => value + 1);
    webImport.invalidate();
    sourceFocus.current = null;
    setContext(null); setPage(initialPage); setCreateOpen(false); setEditing(null);
    createForm.resetFields(); editForm.resetFields();
    if (importInput.current) importInput.current.value = "";
  }, [webImport, createForm, editForm]);

  const loadWorkspace = useCallback(async (id: string, pageNumber = 1, statusFilter: "active" | "inactive" | "all" = "all", deliberateRead = false) => {
    clearPrivate();
    const version = requestVersion.current;
    setWorkspaceId(id); setContext(null); setPage(initialPage); setBusy(true); setError(""); setNotice("");
    if (!id) { setBusy(false); return; }
    try {
      const session = await clientApi("/client/auth/me") as ClientPrincipal;
      if (version !== requestVersion.current) return;
      setPrincipal(session);
      const memberships = await clientApi("/client/workspaces?page=1&pageSize=100") as WorkspacePage;
      if (version !== requestVersion.current) return;
      setWorkspaces(memberships.items);
      const nextContext = await clientApi("/client/workspaces/context", { workspaceId: id }) as WorkspaceContext;
      if (version !== requestVersion.current) return;
      if (nextContext.workspaceId !== id) throw new Error("Workspace context mismatch");
      setContext(nextContext);
      if (!nextContext.permissions.includes("workspace.knowledge.manage")) {
        setPage(initialPage);
        return;
      }
      const result = await api.list(id, { page: pageNumber, pageSize: 20, status: statusFilter });
      if (version === requestVersion.current) {
        setPage(result);
        webImport.setScope({ principalId: session.id, workspaceId: id, canManage: true });
        if (deliberateRead) webImport.markListRead();
      }
    } catch (failure) {
      if (version !== requestVersion.current) return;
      if (failure instanceof ClientRequestFailure && failure.status === 401) router.replace("/client/login");
      else setError(knowledgeRequestMessage(failure));
      setContext(null); setPage(initialPage);
    } finally { if (version === requestVersion.current) setBusy(false); }
  }, [router, clearPrivate, webImport]);

  const refresh = useCallback(() => loadWorkspace(workspaceId, page.page, status), [loadWorkspace, workspaceId, page.page, status]);

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
        const chosen = result.items.find(item => item.workspace.id === requested)?.workspace.id ?? result.items[0]?.workspace.id ?? "";
        await loadWorkspace(chosen);
      } catch (failure) {
        if (failure instanceof ClientRequestFailure && failure.status === 401) router.replace("/client/login");
        else if (active) setError(knowledgeRequestMessage(failure));
      } finally { if (active) setChecking(false); }
    })();
    return () => { active = false; requestVersion.current += 1; webImport.invalidate(); };
  }, [loadWorkspace, router, webImport]);

  useEffect(() => {
    const hide = () => { clearPrivate(); setBusy(false); setNotice(""); setError(""); };
    const revalidate = () => { if (document.visibilityState !== "hidden") void loadWorkspace(workspaceId, page.page, status); };
    const visibility = () => { if (document.visibilityState === "hidden") hide(); else revalidate(); };
    window.addEventListener("blur", hide);
    window.addEventListener("focus", revalidate);
    window.addEventListener("pagehide", hide);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("blur", hide);
      window.removeEventListener("focus", revalidate);
      window.removeEventListener("pagehide", hide);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [clearPrivate, loadWorkspace, workspaceId, page.page, status]);

  async function signOut() {
    clearPrivate();
    setBusy(true); setError("");
    try { await clientApi("/client/auth/logout", { method: "POST" }); router.replace("/client/login"); }
    catch (failure) { if (failure instanceof ClientRequestFailure && failure.status === 401) router.replace("/client/login"); else setError(knowledgeRequestMessage(failure)); }
    finally { setBusy(false); }
  }

  async function createDocument(values: KnowledgeDocumentInput) {
    const version = requestVersion.current;
    const target = workspaceId;
    if (!context?.permissions.includes("workspace.knowledge.manage")) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await api.create(target, values);
      if (version !== requestVersion.current) return;
      createForm.resetFields(); setCreateOpen(false); setNotice("知识文档已创建。"); await loadWorkspace(workspaceId, 1, status);
    } catch (failure) { if (version === requestVersion.current) setError(knowledgeRequestMessage(failure)); }
    finally { if (version === requestVersion.current) setBusy(false); }
  }

  async function importFile(file: File | undefined) {
    if (!file) return;
    if (file.size === 0 || file.size > 50 * 1024 || !/\.(txt|md|csv)$/i.test(file.name)) {
      setError("请选择不超过 50KiB 的 UTF-8 .txt、.md 或 .csv 文件。"); return;
    }
    const version = requestVersion.current;
    const target = workspaceId;
    setBusy(true); setError(""); setNotice("");
    try {
      await api.importFile(target, file);
      if (version !== requestVersion.current) return;
      await loadWorkspace(target, 1, status);
      setNotice("文件已导入为本空间的知识文档，可编辑、停用或恢复。");
    } catch (failure) { if (version === requestVersion.current) setError(knowledgeRequestMessage(failure)); }
    finally { if (version === requestVersion.current) setBusy(false); if (importInput.current) importInput.current.value = ""; }
  }

  function openEditor(document: KnowledgeDocument) {
    setEditing(document);
    editForm.setFieldsValue({ title: document.title, content: document.content });
    setError(""); setNotice("");
  }

  async function updateDocument(values: KnowledgeDocumentPatch) {
    const version = requestVersion.current;
    const target = workspaceId;
    if (!context?.permissions.includes("workspace.knowledge.manage")) return;
    if (!editing) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await api.update(target, editing.id, editing.updatedAt, values);
      if (version !== requestVersion.current) return;
      setEditing(null); setNotice("知识文档已保存。"); await loadWorkspace(workspaceId, page.page, status);
    } catch (failure) {
      if (version !== requestVersion.current) return;
      setError(knowledgeRequestMessage(failure));
      if (failure instanceof ClientRequestFailure && failure.status === 409) {
        await loadWorkspace(workspaceId, page.page, status);
        setError(knowledgeRequestMessage(failure));
      }
    } finally { if (version === requestVersion.current) setBusy(false); }
  }

  async function toggleStatus(document: KnowledgeDocument) {
    const version = requestVersion.current;
    const target = workspaceId;
    if (!context?.permissions.includes("workspace.knowledge.manage")) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await api.update(target, document.id, document.updatedAt, { status: document.status === "active" ? "inactive" : "active" });
      if (version !== requestVersion.current) return;
      setNotice(document.status === "active" ? "文档已停用，新问题不会再检索它。" : "文档已恢复，可重新参与检索。");
      await loadWorkspace(workspaceId, page.page, status);
    } catch (failure) {
      if (version !== requestVersion.current) return;
      setError(knowledgeRequestMessage(failure));
      if (failure instanceof ClientRequestFailure && failure.status === 409) {
        await loadWorkspace(workspaceId, page.page, status);
        setError(knowledgeRequestMessage(failure));
      }
    } finally { if (version === requestVersion.current) setBusy(false); }
  }

  const columns: ColumnsType<KnowledgeDocument> = [
    { title: "文档编号", dataIndex: "documentCode", width: 190, render: value => <code>{value}</code> },
    { title: "标题", dataIndex: "title", render: value => <strong>{value}</strong> },
    { title: "来源", dataIndex: "sourceFilename", width: 180, render: value => value || "手动创建" },
    { title: "状态", dataIndex: "status", width: 110, render: value => <Tag color={value === "active" ? "green" : "default"}>{documentStatus[value as keyof typeof documentStatus] ?? value}</Tag> },
    { title: "最近更新", dataIndex: "updatedAt", width: 190, render: value => new Date(value).toLocaleString() },
    { title: "操作", key: "actions", width: 190, render: (_, document) => <div className="client-knowledge-actions"><Button type="link" disabled={busy} onClick={() => openEditor(document)}>编辑</Button><Button type="link" disabled={busy} onClick={() => void toggleStatus(document)}>{document.status === "active" ? "停用" : "恢复"}</Button>{isKnowledgeWebRow(document, workspaceId) && <Button type="link" disabled={busy} onClick={event => { sourceFocus.current = event.currentTarget; void webImport.readSource(document, webSnapshot.revision); }} aria-label={`核对来源：${document.title}`}>核对来源</Button>}</div> }
  ];

  const viewMode = knowledgePageMode({ loading: checking || (busy && !context), error, hasWorkspace: workspaces.length > 0 && Boolean(workspaceId), canManage: Boolean(context?.permissions.includes("workspace.knowledge.manage")), total: page.total });

  return <ConfigProvider theme={theme}><div className="client-workspace-frame">
    <header className="client-workspace-topbar"><Link href="/client/workspaces" className="auth-brand">AIJ<span>FOUNDATION</span></Link>
      <div className="client-topbar-identity"><span>{principal?.nickname || principal?.email || "客户账号"}</span><Button onClick={() => void signOut()} loading={busy}>退出登录</Button></div>
    </header>
    <main className="client-workspace-main">
      <PageHeading eyebrow="客户 Workspace" title="知识库" description="管理本空间可用于检索的知识文档。Workspace 由当前客户会话和服务端成员权限再次校验。" actions={<Button onClick={() => router.push("/client/workspaces")}>返回 Workspace</Button>} />
      {error && <Alert role="alert" className="admin-error" type="error" showIcon title={error} action={<Button onClick={() => void refresh()}>刷新并重试</Button>} />}
      {notice && <Alert className="admin-feedback" type="success" showIcon title={notice} />}
      {viewMode === "loading" ? <div role="status" className="auth-loading"><Spin /><span>正在确认会话与 Workspace 权限…</span></div> : viewMode === "no-workspace" ? <section className="client-empty-state"><Empty description="当前账号没有可访问的 Workspace" /><Link href="/client/workspaces">返回 Workspace</Link></section> : viewMode === "error" ? <section role="status" className="client-empty-state"><Empty description="知识库暂时无法加载" /><Button onClick={() => void refresh()}>重试</Button></section> : viewMode === "forbidden" ? <section className="client-empty-state"><Empty description="当前角色没有管理此 Workspace 知识库的权限" /><Button onClick={() => router.push("/client/workspaces")}>返回 Workspace</Button></section> : <>
        <section className="client-workspace-picker" aria-labelledby="knowledge-workspace-title">
          <div><label id="knowledge-workspace-title" htmlFor="knowledge-workspace-select">当前 Workspace</label><p>选择器只用于导航；每次读写仍由服务端验证成员身份和权限。</p></div>
          <Select id="knowledge-workspace-select" aria-label="选择 Workspace" value={workspaces.some(item => item.workspace.id === workspaceId) ? workspaceId : undefined} placeholder="选择 Workspace" options={workspaces.map(item => ({ value: item.workspace.id, label: `${item.workspace.name} · ${item.role.name}` }))} onChange={id => void loadWorkspace(id, 1, status)} />
        </section>
        {context && <section className="admin-overview-section" style={{ minWidth: 0, maxWidth: "100%" }}>
          <div className="overview-section-heading"><div><h2>文档</h2><span>{page.total} 条 · 停用文档不会进入新检索</span></div><div className="client-knowledge-toolbar" style={{ display: "flex", flexWrap: "wrap", gap: 8, minWidth: 0, maxWidth: "100%" }}><Select aria-label="文档状态筛选" value={status} options={[{ value: "all", label: "全部状态" }, { value: "active", label: "仅有效" }, { value: "inactive", label: "仅停用" }]} onChange={value => { setStatus(value); void loadWorkspace(workspaceId, 1, value); }} /><Button onClick={() => void refresh()} loading={busy}>刷新</Button><input ref={importInput} type="file" accept=".txt,.md,.csv,text/plain,text/markdown,text/csv" aria-label="导入知识文件" hidden onChange={event => void importFile(event.target.files?.[0])} /><Button disabled={busy} onClick={() => importInput.current?.click()}>导入文件</Button><ClientKnowledgeWebImport key={privacyEpoch} controller={webImport} sourceTrigger={sourceFocus} disabled={busy} refresh={() => { setStatus("all"); void loadWorkspace(workspaceId, 1, "all", true); }} /><Button type="primary" onClick={() => { createForm.resetFields(); setCreateOpen(true); }} disabled={busy}>新增文档</Button></div></div>
          <p className="workspace-secondary">支持 UTF-8 的 .txt / .md / .csv，最大 50KiB。CSV 使用逗号分隔，首行为去空白后非空且不重复的表头，每行列数须一致；最多 200 条数据、32 列、每格 2000 字符、表头 100 字符，转换后最多 50000 字符，并受知识正文 64KiB 上限约束。支持带引号的逗号、双引号及换行，公式仅作为文本；不支持 XLSX、GBK 或自动识别分隔符。导入后保存为本空间的知识文档，原始文件不落盘。</p>
          <Table<KnowledgeDocument> rowKey="id" columns={columns} dataSource={page.items} loading={busy} pagination={{ current: page.page, pageSize: page.pageSize, total: page.total, showSizeChanger: false, onChange: pageNumber => void loadWorkspace(workspaceId, pageNumber, status) }} scroll={{ x: 760 }} locale={{ emptyText: <Empty description={status === "all" ? "还没有知识文档" : "此状态下没有文档"} /> }} />
        </section>}
      </>}
    </main>
    {createOpen && <Modal title="新增知识文档" open={createOpen} onCancel={() => setCreateOpen(false)} onOk={() => void createForm.submit()} confirmLoading={busy} destroyOnHidden>
      <Form form={createForm} layout="vertical" onFinish={createDocument} requiredMark={false}>
        <Form.Item label="文档编号" name="documentCode" rules={[{ required: true, pattern: /^[a-z0-9][a-z0-9._-]{1,79}$/, message: "使用 2–80 位小写字母、数字、点、短横线或下划线" }]}><Input maxLength={80} autoComplete="off" /></Form.Item>
        <Form.Item label="标题" name="title" rules={[{ required: true, whitespace: true, max: 160 }]}><Input maxLength={160} /></Form.Item>
        <Form.Item label="正文" name="content" rules={[{ required: true, whitespace: true, max: 50000 }]}><Input.TextArea rows={7} maxLength={50000} showCount /></Form.Item>
      </Form>
    </Modal>}
    {editing && <Modal title="编辑知识文档" open={Boolean(editing)} onCancel={() => setEditing(null)} onOk={() => void editForm.submit()} confirmLoading={busy} destroyOnHidden>
      <Form form={editForm} layout="vertical" onFinish={updateDocument} requiredMark={false}>
        <Form.Item label="文档编号"><Input value={editing?.documentCode ?? ""} disabled /></Form.Item>
        <Form.Item label="标题" name="title" rules={[{ required: true, whitespace: true, max: 160 }]}><Input maxLength={160} /></Form.Item>
        <Form.Item label="正文" name="content" rules={[{ required: true, whitespace: true, max: 50000 }]}><Input.TextArea rows={7} maxLength={50000} showCount /></Form.Item>
      </Form>
      {editing && <p className="workspace-secondary">手动编辑正文可能与导入时的网页来源不同。保存会携带当前版本；若另一位成员已修改，系统会拒绝覆盖并刷新列表。</p>}
    </Modal>}
  </div></ConfigProvider>;
}
