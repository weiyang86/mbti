"use client";

import { ClientRequestFailure } from "@aij/sdk";
import { Alert, Button, ConfigProvider, Select, Space, Spin } from "antd";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { clientApi } from "./client-api.mjs";
import { createDocumentAccess } from "./client-document-access";
import { adminTheme } from "./admin-api";
import { ClientDocumentManager, type DocumentScope } from "./client-document-manager";

type Principal = { id: string; email: string; nickname: string | null };
type Workspace = { workspace: { id: string; name: string }; role: { id: string; name: string } };
type Context = { workspaceId: string; memberId: string; roleId: string; roleCode: string; permissions: string[]; sessionGeneration: string };
const same = (a: DocumentScope | null, b: DocumentScope | null) => !!a && !!b && JSON.stringify(a) === JSON.stringify(b);

/** Public SDK composition. Identity and lifecycle are verified before AND after every document request. */
export function ClientDocumentLibrary() {
  const router = useRouter();
  const [principal, setPrincipal] = useState<Principal | null>(null);
  const [spaces, setSpaces] = useState<Workspace[]>([]);
  const [scope, setScope] = useState<DocumentScope | null>(null);
  const [issue, setIssue] = useState("");
  const [loading, setLoading] = useState(true);
  const access = useMemo(() => createDocumentAccess(clientApi), []);
  const clear = useCallback(() => { access.clear(); setScope(null); }, [access]);
  const readScope = useCallback(async (workspaceId: string, signal?: AbortSignal): Promise<DocumentScope> => {
    const p = await clientApi<Principal>("/client/auth/me", { signal });
    const c = await clientApi<Context>("/client/workspaces/context", { workspaceId, signal });
    if (c.workspaceId !== workspaceId || !/^[a-f0-9]{64}$/.test(c.sessionGeneration) ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(c.roleId) || !/^[A-Za-z0-9_-]{1,128}$/.test(c.roleCode) || !Array.isArray(c.permissions) ||
      c.permissions.some(v => typeof v !== "string") || !c.permissions.includes("workspace.documents.read")) throw new ClientRequestFailure(403);
    // This existing read also checks current project/organization and aij-ai installation in one transaction.
    await clientApi("/client/documents?limit=1", { workspaceId, signal });
    const permissions = [...c.permissions].sort();
    return { workspaceId, memberId: p.id, roleId: c.roleId, roleCode: c.roleCode, sessionKey: c.sessionGeneration,
      validationKey: JSON.stringify([c.roleId, c.roleCode, permissions]), permissions };
  }, []);
  const handleAccessFailure = useCallback((error: unknown) => {
    if (error instanceof ClientRequestFailure && [401, 403, 404].includes(error.status)) {
      clear(); setIssue("会话、空间权限或文档能力已变化，正文已清除，请重新验证访问。");
      if (error.status === 401) { setPrincipal(null); setSpaces([]); router.replace("/client/login"); }
    }
  }, [clear, router]);
  useEffect(() => { access.setHandlers(readScope, handleAccessFailure); }, [access, readScope, handleAccessFailure]);
  const api = access.api;
  const selectSpace = useCallback(async (id: string) => {
    access.select(id);
    clear(); const ticket = access.getGeneration(); setLoading(true); setIssue("");
    try { const fresh = await readScope(id); if (ticket === access.getGeneration()) { access.setScope(fresh); setScope(fresh); } }
    catch (error) { handleAccessFailure(error); setIssue("文档访问验证失败，请确认会话、空间权限与能力配置。"); }
    finally { if (ticket === access.getGeneration() || !access.getScope()) setLoading(false); }
  }, [access, clear, readScope, handleAccessFailure]);
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const p = await clientApi<Principal>("/client/auth/me");
        const page = await clientApi<{ items: Workspace[] }>("/client/workspaces?page=1&pageSize=100");
        if (!active) return; setPrincipal(p); setSpaces(page.items);
        const hint = new URLSearchParams(window.location.search).get("workspaceId");
        const chosen = page.items.find(w => w.workspace.id === hint) ?? page.items[0];
        if (chosen) await selectSpace(chosen.workspace.id); else setLoading(false);
      } catch (error) { if (active) { handleAccessFailure(error); setLoading(false); setIssue("无法读取当前账号与空间。"); } }
    })();
    return () => { active = false; access.clear(); };
  }, [access, selectSpace, handleAccessFailure]);
  const revalidate = useCallback(async () => {
    const expected = access.getScope(), ticket = access.getGeneration();
    if (!expected) return null;
    try {
      const fresh = await readScope(expected.workspaceId);
      if (ticket !== access.getGeneration()) return null;
      if (!same(expected, fresh)) { clear(); setIssue("访问范围已变化，请重新选择空间。"); return null; }
      return expected;
    } catch (error) { handleAccessFailure(error); return null; }
  }, [access, readScope, clear, handleAccessFailure]);
  const signOut = async () => { clear(); setPrincipal(null); setSpaces([]); try { await clientApi("/client/auth/logout", { method: "POST" }); } finally { router.replace("/client/login"); } };
  return <ConfigProvider theme={adminTheme}><div className="client-workspace-frame" style={{ minWidth: 0, maxWidth: "100%" }}>
    <header className="client-workspace-topbar" style={{ flexWrap: "wrap" }}><Link className="auth-brand" href="/client">AIJ<span>FOUNDATION</span></Link><Space wrap><span>{principal?.nickname || principal?.email || "客户账号"}</span><Button onClick={() => void signOut()}>退出登录</Button></Space></header>
    <div className="client-workspace-main" style={{ minWidth: 0, maxWidth: "100%" }}>
      <nav aria-label="文档导航"><Space wrap><Link href="/client/ai">AI 工作台</Link><Link href="/client/workspaces">管理空间</Link></Space></nav>
      <section className="client-workspace-picker"><label htmlFor="document-space-select">当前文档空间</label><Select id="document-space-select" aria-label="选择文档空间" style={{ minWidth: 0, width: "100%" }} value={scope?.workspaceId} options={spaces.map(w => ({ value: w.workspace.id, label: `${w.workspace.name} · ${w.role.name}` }))} onChange={id => void selectSpace(id)} /></section>
      {loading && <Spin aria-label="正在验证文档访问" />}{issue && <Alert role="alert" type="warning" title={issue} />}
      {!scope && !loading && <Button onClick={() => { const id = access.getSelected() || spaces[0]?.workspace.id; if (id) void selectSpace(id); }}>重新读取空间与文档权限</Button>}
    </div>
    <ClientDocumentManager api={api} request={access.request} subscribeInvalidation={access.subscribeInvalidation} exportsApi={access.exportsApi} scope={scope} revalidate={revalidate} onAccessFailure={handleAccessFailure} />
  </div></ConfigProvider>;
}
