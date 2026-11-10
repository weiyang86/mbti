"use client";
import { PageHeading } from "@aij/ui";

import { Alert, Button, ConfigProvider, Empty, Spin, Tag } from "antd";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { adminApi, adminTheme, AdminSessionData, RequestFailure, requestMessage } from "./admin-api";

type MenuNode = { id: string; title: string; path: string | null; children: MenuNode[] };
type Permissions = { effectivePermissions: string[]; isSuperAdmin: boolean; roles: string[] };
type Access = { session: AdminSessionData; permissions: Permissions; menus: MenuNode[]; can: (code: string) => boolean; refresh: () => Promise<void>; request: <T>(path: string, method?: string, body?: unknown) => Promise<T> };
const AdminContext = createContext<Access | null>(null);
export function useAdmin() { const value = useContext(AdminContext); if (!value) throw new Error("Administrator context required"); return value; }
function Navigation({ nodes, path }: { nodes: MenuNode[]; path: string }) {
  return <ul>{nodes.map(node => <li key={node.id}>{node.path ? <Link aria-current={path === node.path ? "page" : undefined} href={node.path}>{node.title}</Link> : <span className="admin-nav-group">{node.title}</span>}{node.children.length > 0 && <Navigation nodes={node.children} path={path} />}</li>)}</ul>;
}
export function AdminShell({ children, permission }: { children: React.ReactNode; permission?: string }) {
  const router = useRouter(), pathname = usePathname();
  const [snapshot, setSnapshot] = useState<{ session: AdminSessionData; permissions: Permissions; menus: MenuNode[] } | null>(null);
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [navOpen, setNavOpen] = useState(false);
  const generation = useRef({ value: 0 }), alive = useRef(true);
  const refresh = useCallback(async () => {
    const version = ++generation.current.value;
    try {
      const [session, permissions, menus] = await Promise.all([adminApi<AdminSessionData>("/auth/session"), adminApi<Permissions>("/admin/permissions/my"), adminApi<MenuNode[]>("/admin/menus/my")]);
      if (!alive.current || version !== generation.current.value) return;
      setSnapshot({ session, permissions, menus }); setError("");
    } catch (failure) {
      if (!alive.current || version !== generation.current.value) return;
      setSnapshot(null);
      if (failure instanceof RequestFailure && failure.status === 401) router.replace("/login");
      else setError(requestMessage(failure));
    }
  }, [router]);
  useEffect(() => {
    alive.current = true; const control = generation.current; const initial = setTimeout(() => void refresh(), 0);
    const timer = setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 15000);
    const focused = () => { void refresh(); }; window.addEventListener("focus", focused);
    return () => { alive.current = false; control.value++; clearTimeout(initial); clearInterval(timer); window.removeEventListener("focus", focused); };
  }, [refresh]);
  async function request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
    try { return await adminApi<T>(path, { method, headers: { "Content-Type": "application/json", ...(snapshot ? { "X-AIJ-CSRF": snapshot.session.csrfToken } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }); }
    catch (failure) {
      if (failure instanceof RequestFailure && failure.status === 401) { setSnapshot(null); router.replace("/login"); }
      if (failure instanceof RequestFailure && failure.status === 403) void refresh();
      throw failure;
    }
  }
  async function logout() {
    setBusy(true);
    try { await request("/auth/logout", "POST"); generation.current.value++; setSnapshot(null); router.replace("/login"); }
    catch (failure) { setError(requestMessage(failure)); }
    finally { setBusy(false); }
  }
  const can = (code: string) => snapshot?.permissions.effectivePermissions.includes(code) === true;
  return <ConfigProvider theme={adminTheme}><div className="admin-frame">
    <aside className={"admin-sidebar" + (navOpen ? " is-open" : "")}><Link href="/admin" className="auth-brand" aria-label="AIJ 管理工作台">AIJ<span>FOUNDATION</span></Link>
      <p className="admin-nav-caption">管理工作台</p><nav aria-label="管理导航" onClick={() => setNavOpen(false)}>{snapshot ? snapshot.menus.length ? <Navigation nodes={snapshot.menus} path={pathname} /> : <p className="admin-empty-nav">暂无获准菜单</p> : <p className="admin-empty-nav">正在获取菜单</p>}</nav>
      <div className="admin-sidebar-footer">独立项目 · AIJ Foundation</div>
    </aside>
    <div className="admin-workspace"><header className="admin-topbar"><div className="admin-topbar-title"><Button className="admin-nav-toggle" aria-expanded={navOpen} onClick={() => setNavOpen(!navOpen)}>导航</Button><Link href="/admin">工作台</Link><span className="admin-divider">/</span><span>系统管理</span></div><div className="admin-identity">{snapshot && <span>{snapshot.session.user.realName}</span>}<Button onClick={logout} disabled={!snapshot} loading={busy}>退出登录</Button></div></header>
      <main className="admin-main">
        {error && <div role="alert" className="admin-error"><Alert type="error" title={error} showIcon /><Button onClick={() => void refresh()}>重新检查</Button></div>}
        {snapshot ? <AdminContext.Provider value={{ session: snapshot.session, permissions: snapshot.permissions, menus: snapshot.menus, can, refresh, request }}>{permission && !can(permission) ? <div className="admin-denied"><Tag color="orange">访问受限</Tag><h1>你没有访问此页面的权限</h1><p>请联系管理员调整授权，或返回工作台。</p><Link href="/admin">返回工作台</Link></div> : children}</AdminContext.Provider> : !error && <div role="status" className="auth-loading"><Spin /><span>正在确认登录与权限…</span></div>}
      </main>
    </div>
  </div></ConfigProvider>;
}
export function AdminOverview() {
  const { session, permissions, menus } = useAdmin();
  const flatten = (nodes: MenuNode[]): MenuNode[] => nodes.flatMap(node => [...(node.path ? [node] : []), ...flatten(node.children)]);
  const available = flatten(menus);
  return <><PageHeading eyebrow="工作台 · 当前授权" title={<>你好，{session.user.realName}</>} description="这里仅汇总当前账号从服务端获得的管理入口。" />
    <div className="admin-overview"><div><span className="admin-field-label">当前账号</span><strong>{session.user.username}</strong></div><div><span className="admin-field-label">账号身份</span><strong>{permissions.isSuperAdmin ? "系统管理员" : "管理员"}</strong></div></div>
    <section className="admin-overview-section" aria-label="当前授权的管理入口"><div className="admin-overview-section-heading"><h2>可用管理入口</h2><span>{available.length} 项</span></div>
      {available.length ? <nav className="admin-overview-links" aria-label="可用管理入口">{available.map(item => <Link key={item.id} href={item.path!}><strong>{item.title}</strong><span>{item.path}</span></Link>)}</nav> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="此账号暂无可访问的管理页面。" />}
      {permissions.isSuperAdmin && permissions.effectivePermissions.includes("admin.plugin.manage") && <p><Link href="/plugins/mbti-config/settings">MBTI 插件配置</Link></p>}
      <p className="admin-help">此列表来自服务端菜单授权；实际 API 仍会独立执行权限检查。</p>
    </section>
  </>;
}
