"use client";
import { PageHeading } from "@aij/ui";

import { Alert, Button, ConfigProvider, Form, Input, Select, Spin, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { clientApi, clientRequestMessage, ClientRequestFailure } from "./client-api.mjs";
import { adminTheme } from "./admin-api";

type ClientMember = { id: string; email: string | null; nickname: string };
type ClientPrincipal = { id: string; email: string | null; nickname: string };
type WorkspaceItem = {
  membershipId: string;
  joinedAt: string;
  workspace: { id: string; code: string; name: string; status: string };
  role: { id: string; code: string; name: string };
};
type WorkspacePage = { page: number; pageSize: number; total: number; items: WorkspaceItem[] };
type WorkspaceContext = {
  workspaceId: string;
  workspaceCode: string;
  workspaceName: string;
  roleId: string;
  roleCode: string;
  permissions: string[];
};
type WorkspaceRole = { id: string; code: string; name: string; permissions: string[]; isSystem: boolean; sortOrder: number };
type Membership = {
  id: string;
  memberId: string;
  status: "active" | "suspended";
  member: ClientMember;
  role: { id: string; code: string; name: string };
};
type MemberPage = { page: number; pageSize: number; total: number; items: Membership[] };
const permission = {
  context: "workspace.context.read",
  workspaceManage: "workspace.manage",
  memberRead: "workspace.member.read",
  memberManage: "workspace.member.manage",
  roleRead: "workspace.role.read",
  knowledgeManage: "workspace.knowledge.manage",
  knowledgeQuery: "workspace.knowledge.query"
};
const clientTheme = { token: { ...adminTheme.token, colorPrimary: "#315b3a" } };

function AuthFrame({ children }: { children: React.ReactNode }) {
  return <ConfigProvider theme={clientTheme}><main className="auth-frame client-auth-frame">
    <div className="auth-intro"><Link href="/" className="auth-brand" aria-label="AIJ Foundation 首页">AIJ<span>FOUNDATION</span></Link>
      <div className="auth-intro-copy"><p className="eyebrow">客户 Workspace</p><h1>在你的空间里，<br />继续协作。</h1><p>登录后只会看到你已加入且仍有效的 Workspace。</p></div>
      <p className="auth-footer">AIJ Foundation · 客户入口</p>
    </div><div className="auth-panel">{children}</div>
  </main></ConfigProvider>;
}

export function ClientLogin() {
  const router = useRouter();
  const [form] = Form.useForm();
  const [identityType, setIdentityType] = useState<"email" | "username">("email");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [principal, setPrincipal] = useState<ClientPrincipal | null>(null);
  const [notice, setNotice] = useState("");
  const refresh = useCallback(async () => {
    try {
      const client = await clientApi("/client/auth/me") as ClientPrincipal;
      setPrincipal(client);
    } catch {
      setPrincipal(null);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { queueMicrotask(() => { void refresh(); }); }, [refresh]);

  async function signOut() {
    setBusy(true); setError("");
    try {
      await clientApi("/client/auth/logout", { method: "POST" });
      setPrincipal(null); setNotice("已退出当前账号。可在此登录另一个账号。"); form.resetFields();
    } catch (failure) { setError(clientRequestMessage(failure)); }
    finally { setBusy(false); }
  }
  async function login(values: { identity: string; password: string }) {
    setBusy(true); setError("");
    try {
      const client = await clientApi("/client/auth/login", { method: "POST", body: JSON.stringify({ [identityType]: values.identity.trim(), password: values.password }) }) as ClientPrincipal;
      form.resetFields(["password"]); setPrincipal(client); setNotice(""); router.replace("/client/workspaces");
    } catch (failure) {
      setError(failure instanceof ClientRequestFailure && failure.status === 401 ? "用户名、邮箱或密码不正确，请重新输入。" : clientRequestMessage(failure));
    } finally { setBusy(false); }
  }
  return <AuthFrame><div className="auth-card">
    <p className="auth-kicker">客户账号</p><h2>Workspace 登录</h2><p className="auth-description">使用你的客户账号进入已授权空间。</p>
    {loading ? <div role="status" className="auth-loading"><Spin /><span>正在确认登录状态…</span></div> : principal ? <>
      {error && <Alert role="alert" className="auth-alert" type="error" showIcon title={error} />}
      {notice && <Alert className="auth-alert" type="success" showIcon title={notice} />}
      <div className="client-principal"><strong>{principal.nickname || principal.email || "客户账号"}</strong><span>{principal.email}</span></div>
      <div className="client-login-actions"><Button type="primary" block onClick={() => router.push("/client/workspaces")}>继续进入 Workspace</Button>
        <Button block loading={busy} onClick={() => void signOut()}>退出并切换账号</Button></div>
      <p className="auth-help">切换账号会先在服务端撤销当前会话。</p>
    </> : <>
      {error && <Alert role="alert" className="auth-alert" type="error" showIcon title={error} />}
      {notice && <Alert className="auth-alert" type="success" showIcon title={notice} />}
      <Form form={form} name="client-login" layout="vertical" onFinish={login} requiredMark={false} autoComplete="on">
        <Form.Item label="登录方式"><Select aria-label="登录方式" value={identityType} disabled={busy} options={[{ value: "email", label: "邮箱登录" }, { value: "username", label: "用户名登录" }]}
          onChange={value => { setIdentityType(value); form.resetFields(["identity", "password"]); setError(""); }} /></Form.Item>
        <Form.Item key={identityType} label={identityType === "email" ? "邮箱" : "用户名"} name="identity" rules={identityType === "email"
          ? [{ required: true, whitespace: true, message: "请输入邮箱" }, { type: "email", transform: (value: string) => value.trim(), message: "请输入有效邮箱" }]
          : [{ required: true, whitespace: true, message: "请输入用户名" }]}><Input type={identityType === "email" ? "email" : "text"} autoComplete="username" autoFocus maxLength={254} disabled={busy} /></Form.Item>
        {identityType === "username" && <p className="auth-help">用户名不区分大小写，首尾空格会忽略。请使用已有用户名；注册仍使用邮箱。</p>}
        <Form.Item label="密码" name="password" rules={[{ required: true, message: "请输入密码" }]}><Input.Password autoComplete="current-password" maxLength={72} disabled={busy} /></Form.Item>
        <Button type="primary" htmlType="submit" block loading={busy}>登录</Button>
      </Form>
      <nav className="client-auth-links" aria-label="客户账号操作">
        <Link href="/client/register">创建客户账号</Link>
        <Link href="/client/forgot-password">忘记密码</Link>
      </nav>
      <p className="auth-help">注册后需完成邮箱验证；邮件链接只在本项目中使用。</p>
    </>}
  </div></AuthFrame>;
}

function AuthFormFeedback({ error, notice }: { error: string; notice: string }) {
  return <>{error && <Alert role="alert" className="auth-alert" type="error" showIcon title={error} />}{notice && <Alert role="status" className="auth-alert" type="success" showIcon title={notice} />}</>;
}

export function ClientRegister() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  async function submit(values: { email: string; nickname: string; password: string }) {
    setBusy(true); setError(""); setNotice("");
    try {
      await clientApi("/client/auth/register", { method: "POST", body: JSON.stringify(values) });
      await clientApi("/client/auth/email/verification/request", { method: "POST", body: JSON.stringify({ email: values.email }) });
      setNotice("如果该邮箱可以注册，系统已接受请求。请查看邮箱中的验证链接；也可以在此重新请求验证邮件。");
    } catch (failure) { setError(clientRequestMessage(failure)); }
    finally { setBusy(false); }
  }
  return <AuthFrame><div className="auth-card">
    <p className="auth-kicker">客户账号</p><h2>创建账号</h2><p className="auth-description">验证邮箱后即可登录。注册不会自动加入 Workspace 或获得管理权限。</p>
    <AuthFormFeedback error={error} notice={notice} />
    <Form name="client-register" layout="vertical" onFinish={submit} requiredMark={false} autoComplete="on">
      <Form.Item label="邮箱" name="email" rules={[{ required: true, message: "请输入邮箱" }, { type: "email", message: "请输入有效邮箱" }]}><Input autoComplete="email" maxLength={254} disabled={busy} /></Form.Item>
      <Form.Item label="昵称" name="nickname" rules={[{ required: true, message: "请输入昵称" }, { whitespace: true, message: "昵称不能为空" }, { max: 50, message: "昵称不能超过 50 个字符" }]}><Input autoComplete="nickname" maxLength={50} disabled={busy} /></Form.Item>
      <Form.Item label="密码" name="password" rules={[{ required: true, message: "请输入密码" }, { pattern: /^(?=.*[A-Za-z])(?=.*\d)[^\s]{8,72}$/, message: "密码需为 8–72 位，并同时包含字母和数字" }]}><Input.Password autoComplete="new-password" maxLength={72} disabled={busy} /></Form.Item>
      <Button type="primary" htmlType="submit" block loading={busy}>注册并请求邮箱验证</Button>
    </Form>
    <nav className="client-auth-links" aria-label="返回登录"><Link href="/client/login">已有账号？登录</Link><Link href="/client/verify-email">重新请求验证邮件</Link></nav>
  </div></AuthFrame>;
}

function consumeFragmentToken(): string {
  const token = new URLSearchParams(window.location.hash.slice(1)).get("token") || "";
  if (window.location.hash) window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
  return token;
}

export function ClientEmailVerification() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [form] = Form.useForm();
  useEffect(() => {
    const token = consumeFragmentToken();
    if (!token) return;
    queueMicrotask(() => {
      setBusy(true);
      void clientApi("/client/auth/email/verification/confirm", { method: "POST", body: JSON.stringify({ token }) })
        .then(() => setNotice("邮箱验证完成，现在可以登录。"))
        .catch(failure => setError(clientRequestMessage(failure)))
        .finally(() => setBusy(false));
    });
  }, []);
  async function resend(values: { email: string }) {
    setBusy(true); setError(""); setNotice("");
    try {
      await clientApi("/client/auth/email/verification/request", { method: "POST", body: JSON.stringify(values) });
      setNotice("如果该邮箱需要验证，系统已接受请求。请检查邮箱或稍后重试。"); form.resetFields();
    } catch (failure) { setError(clientRequestMessage(failure)); }
    finally { setBusy(false); }
  }
  return <AuthFrame><div className="auth-card">
    <p className="auth-kicker">邮箱验证</p><h2>验证客户邮箱</h2><p className="auth-description">验证链接仅在当前项目中有效，处理后会从地址栏移除。</p>
    {busy && <div role="status" className="auth-loading"><Spin /><span>正在验证邮箱…</span></div>}
    <AuthFormFeedback error={error} notice={notice} />
    {!busy && !notice && <Form form={form} name="client-verification-request" layout="vertical" onFinish={resend} requiredMark={false}>
      <Form.Item label="邮箱" name="email" rules={[{ required: true, message: "请输入邮箱" }, { type: "email", message: "请输入有效邮箱" }]}><Input autoComplete="email" maxLength={254} /></Form.Item>
      <Button type="primary" htmlType="submit" block loading={busy}>重新请求验证邮件</Button>
    </Form>}
    <nav className="client-auth-links" aria-label="登录导航"><Link href="/client/login">返回登录</Link><Link href="/client/register">创建账号</Link></nav>
  </div></AuthFrame>;
}

export function ClientPasswordResetRequest() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [form] = Form.useForm();
  async function submit(values: { email: string }) {
    setBusy(true); setError(""); setNotice("");
    try {
      await clientApi("/client/auth/password/reset/request", { method: "POST", body: JSON.stringify(values) });
      setNotice("如果该邮箱对应可用账号，系统已接受重设请求。请检查邮箱中的链接。"); form.resetFields();
    } catch (failure) { setError(clientRequestMessage(failure)); }
    finally { setBusy(false); }
  }
  return <AuthFrame><div className="auth-card">
    <p className="auth-kicker">客户账号</p><h2>找回密码</h2><p className="auth-description">无论账号状态如何，系统都会使用相同的公开反馈。</p>
    <AuthFormFeedback error={error} notice={notice} />
    <Form form={form} name="client-password-reset-request" layout="vertical" onFinish={submit} requiredMark={false}>
      <Form.Item label="注册邮箱" name="email" rules={[{ required: true, message: "请输入邮箱" }, { type: "email", message: "请输入有效邮箱" }]}><Input autoComplete="email" maxLength={254} disabled={busy} /></Form.Item>
      <Button type="primary" htmlType="submit" block loading={busy}>请求重设链接</Button>
    </Form>
    <nav className="client-auth-links" aria-label="登录导航"><Link href="/client/login">返回登录</Link><Link href="/client/register">创建账号</Link></nav>
  </div></AuthFrame>;
}

export function ClientPasswordResetConfirm() {
  const [form] = Form.useForm();
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => { queueMicrotask(() => setToken(consumeFragmentToken())); }, []);
  async function submit(values: { password: string }) {
    if (!token) { setError("重设链接缺失或已失效，请重新请求。"); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      await clientApi("/client/auth/password/reset/confirm", { method: "POST", body: JSON.stringify({ token, newPassword: values.password }) });
      setToken(""); form.resetFields(); setNotice("密码已更新。请使用新密码重新登录；其他现有会话已撤销。");
    } catch (failure) { setError(clientRequestMessage(failure)); }
    finally { setBusy(false); }
  }
  return <AuthFrame><div className="auth-card">
    <p className="auth-kicker">客户账号</p><h2>设置新密码</h2><p className="auth-description">重设链接只会从地址片段读取，提交后会立即从地址栏移除。</p>
    <AuthFormFeedback error={error} notice={notice} />
    {token && !notice ? <Form form={form} name="client-password-reset-confirm" layout="vertical" onFinish={submit} requiredMark={false}>
      <Form.Item label="新密码" name="password" rules={[{ required: true, message: "请输入新密码" }, { pattern: /^(?=.*[A-Za-z])(?=.*\d)[^\s]{8,72}$/, message: "密码需为 8–72 位，并同时包含字母和数字" }]}><Input.Password autoComplete="new-password" maxLength={72} disabled={busy} /></Form.Item>
      <Form.Item label="确认新密码" name="confirmation" dependencies={["password"]} rules={[{ required: true, message: "请再次输入新密码" }, ({ getFieldValue }) => ({ validator(_, value) { return !value || getFieldValue("password") === value ? Promise.resolve() : Promise.reject(new Error("两次密码输入不一致")); } })]}><Input.Password autoComplete="new-password" maxLength={72} disabled={busy} /></Form.Item>
      <Button type="primary" htmlType="submit" block loading={busy}>更新密码</Button>
    </Form> : !notice && <p role="status">重设链接不可用，请重新请求。</p>}
    <nav className="client-auth-links" aria-label="登录导航"><Link href="/client/login">返回登录</Link><Link href="/client/forgot-password">重新请求链接</Link></nav>
  </div></AuthFrame>;
}

export function ClientWorkspaceHome() {
  const router = useRouter();
  const [principal, setPrincipal] = useState<ClientPrincipal | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceItem[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [context, setContext] = useState<WorkspaceContext | null>(null);
  const [roles, setRoles] = useState<WorkspaceRole[]>([]);
  const [members, setMembers] = useState<Membership[]>([]);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [memberForm] = Form.useForm();
  const [workspaceForm] = Form.useForm();
  const contextRequest = useRef(0);
  const permissions = useMemo(() => new Set(context?.permissions ?? []), [context]);
  const can = useCallback((code: string) => permissions.has(code), [permissions]);
  const assignableRoles = useMemo(() => roles.filter(role => role.permissions.every(code => permissions.has(code))), [roles, permissions]);

  const requireSession = useCallback(async () => {
    try {
      const session = await clientApi("/client/auth/me") as ClientPrincipal;
      setPrincipal(session);
      return true;
    } catch (failure) {
      if (failure instanceof ClientRequestFailure && failure.status === 401) router.replace("/client/login");
      else setError(clientRequestMessage(failure));
      return false;
    } finally { setChecking(false); }
  }, [router]);

  const loadWorkspaces = useCallback(async (preferredId?: string) => {
    const result = await clientApi("/client/workspaces?page=1&pageSize=100") as WorkspacePage;
    setWorkspaces(result.items);
    const selected = result.items.some(item => item.workspace.id === preferredId) ? preferredId! : result.items[0]?.workspace.id ?? "";
    setSelectedId(selected);
    return selected;
  }, []);

  const loadContext = useCallback(async (workspaceId: string) => {
    if (!workspaceId) { setContext(null); setRoles([]); setMembers([]); return; }
    const requestId = ++contextRequest.current;
    setContext(null); setRoles([]); setMembers([]);
    setBusy(true); setError(""); setMessage("");
    try {
      // The ID is a selector only. The API rechecks the session, active membership and permissions on every request.
      const next = await clientApi("/client/workspaces/context", { workspaceId }) as WorkspaceContext;
      if (requestId !== contextRequest.current) return;
      setContext(next);
      workspaceForm.setFieldsValue({ name: next.workspaceName });
      const [nextRoles, nextMembers] = await Promise.all([
        next.permissions.includes(permission.roleRead) ? clientApi("/client/workspaces/roles", { workspaceId }) as Promise<WorkspaceRole[]> : Promise.resolve([]),
        next.permissions.includes(permission.memberRead) ? clientApi("/client/workspaces/members?page=1&pageSize=100", { workspaceId }) as Promise<MemberPage> : Promise.resolve({ page: 1, pageSize: 100, total: 0, items: [] } as MemberPage)
      ]);
      if (requestId !== contextRequest.current) return;
      setRoles(nextRoles); setMembers(nextMembers.items);
    } catch (failure) {
      if (requestId !== contextRequest.current) return;
      setContext(null); setRoles([]); setMembers([]);
      if (failure instanceof ClientRequestFailure && failure.status === 401) router.replace("/client/login");
      else setError(clientRequestMessage(failure));
    } finally { if (requestId === contextRequest.current) setBusy(false); }
  }, [router, workspaceForm]);

  useEffect(() => {
    void (async () => {
      if (!await requireSession()) return;
      try {
        const selected = await loadWorkspaces();
        if (selected) await loadContext(selected);
      } catch (failure) {
        if (failure instanceof ClientRequestFailure && failure.status === 401) router.replace("/client/login");
        else setError(clientRequestMessage(failure));
      }
    })();
  }, [loadContext, loadWorkspaces, requireSession, router]);
  useEffect(() => {
    if (checking || !principal) return;
    const timer = window.setInterval(() => {
      void clientApi("/client/auth/me").catch(failure => {
        if (failure instanceof ClientRequestFailure && failure.status === 401) router.replace("/client/login");
      });
    }, 15000);
    const onFocus = () => { void clientApi("/client/auth/me").catch(failure => {
      if (failure instanceof ClientRequestFailure && failure.status === 401) router.replace("/client/login");
    }); };
    window.addEventListener("focus", onFocus);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", onFocus); };
  }, [checking, principal, router]);

  async function refresh() {
    setBusy(true); setError("");
    try { if (await requireSession()) { const selected = await loadWorkspaces(selectedId); if (selected) await loadContext(selected); } }
    catch (failure) { setError(clientRequestMessage(failure)); }
    finally { setBusy(false); }
  }
  async function signOut() {
    setBusy(true); setError("");
    try { await clientApi("/client/auth/logout", { method: "POST" }); setPrincipal(null); router.replace("/client/login"); }
    catch (failure) {
      if (failure instanceof ClientRequestFailure && failure.status === 401) router.replace("/client/login");
      else setError(clientRequestMessage(failure));
    } finally { setBusy(false); }
  }
  async function addMember(values: { memberId: string; roleId: string }) {
    if (!selectedId) return;
    setBusy(true); setError(""); setMessage("");
    try {
      await clientApi("/client/workspaces/members", { method: "POST", workspaceId: selectedId, body: JSON.stringify(values) });
      memberForm.resetFields(); setMessage("成员已添加。"); await loadContext(selectedId);
    } catch (failure) { setError(clientRequestMessage(failure)); }
    finally { setBusy(false); }
  }
  async function changeMembership(membershipId: string, path: "role" | "status", value: string) {
    if (!selectedId) return;
    setBusy(true); setError(""); setMessage("");
    try {
      await clientApi(`/client/workspaces/members/${encodeURIComponent(membershipId)}/${path}`, {
        method: "PATCH", workspaceId: selectedId,
        body: JSON.stringify(path === "role" ? { roleId: value } : { status: value })
      });
      setMessage("成员设置已更新。"); await loadContext(selectedId);
    } catch (failure) { setError(clientRequestMessage(failure)); }
    finally { setBusy(false); }
  }
  async function updateWorkspace(values: { name: string }) {
    if (!selectedId) return;
    setBusy(true); setError(""); setMessage("");
    try {
      await clientApi("/client/workspaces/details", { method: "PATCH", workspaceId: selectedId, body: JSON.stringify(values) });
      setMessage("Workspace 名称已更新。"); await loadWorkspaces(); await loadContext(selectedId);
    } catch (failure) { setError(clientRequestMessage(failure)); }
    finally { setBusy(false); }
  }
  async function leaveWorkspace() {
    if (!selectedId || !window.confirm("确认退出当前 Workspace？此操作会使当前成员关系立即失效。")) return;
    setBusy(true); setError(""); setMessage("");
    try {
      await clientApi("/client/workspaces/leave", { method: "POST", workspaceId: selectedId });
      setContext(null); setMessage("已退出 Workspace。"); await loadWorkspaces();
    } catch (failure) { setError(clientRequestMessage(failure)); }
    finally { setBusy(false); }
  }

  const columns: ColumnsType<Membership> = [
    { title: "成员", key: "member", render: (_, row) => <div><strong>{row.member.nickname || row.member.email || "客户成员"}</strong><div className="workspace-secondary">{row.member.email || "未设置邮箱"}</div><code className="workspace-id">{row.memberId}</code></div> },
    { title: "角色", key: "role", render: (_, row) => can(permission.memberManage) ? <Select aria-label={`调整 ${row.member.email || row.memberId} 的角色`} value={row.role.id} disabled={busy || assignableRoles.length === 0} options={assignableRoles.map(role => ({ value: role.id, label: role.name }))} onChange={value => void changeMembership(row.id, "role", value)} /> : <Tag>{row.role.name}</Tag> },
    { title: "状态", dataIndex: "status", render: status => <Tag color={status === "active" ? "green" : "default"}>{status === "active" ? "有效" : "已暂停"}</Tag> },
    { title: "操作", key: "action", render: (_, row) => can(permission.memberManage) && row.memberId !== principal?.id ? <Select aria-label={`调整 ${row.member.email || row.memberId} 的成员状态`} value={row.status} disabled={busy} options={[{ value: "active", label: "恢复有效" }, { value: "suspended", label: "暂停成员" }, { value: "removed", label: "移除成员" }]} onChange={value => void changeMembership(row.id, "status", value)} /> : <span className="workspace-secondary">—</span> }
  ];

  return <ConfigProvider theme={clientTheme}><div className="client-workspace-frame">
    <header className="client-workspace-topbar"><Link href="/" className="auth-brand">AIJ<span>FOUNDATION</span></Link>
      <div className="client-topbar-identity"><span>{principal?.nickname || principal?.email || "客户账号"}</span><Button onClick={() => void signOut()} loading={busy}>退出登录</Button></div>
    </header>
    <main className="client-workspace-main">
      <PageHeading eyebrow="客户工作区" title="Workspace" description="空间和操作由服务端会话、成员关系及当前角色权限决定。" />
      {error && <Alert role="alert" className="admin-error" type="error" showIcon title={error} action={<Button onClick={() => void refresh()}>重试</Button>} />}
      {message && <Alert className="admin-feedback" type="success" showIcon title={message} />}
      {checking ? <div role="status" className="auth-loading"><Spin /><span>正在确认客户会话…</span></div> : <>
        <section className="client-workspace-picker" aria-labelledby="workspace-selector-title">
          <div><label id="workspace-selector-title" htmlFor="workspace-select">切换 Workspace</label><p>仅显示当前账号有效的成员空间。</p></div>
          <Select id="workspace-select" aria-label="切换 Workspace" value={workspaces.some(item => item.workspace.id === selectedId) ? selectedId : undefined} placeholder="选择 Workspace" loading={busy && workspaces.length === 0} options={workspaces.map(item => ({ value: item.workspace.id, label: `${item.workspace.name} · ${item.role.name}` }))} onChange={id => { setSelectedId(id); void loadContext(id); }} />
        </section>
        {!workspaces.length && <section className="client-empty-state"><h2>还没有可访问的 Workspace</h2><p>当前账号尚未加入有效空间。请联系 Workspace 管理员获得邀请。</p></section>}
        {!!workspaces.length && !context && !error && <div role="status" className="auth-loading"><Spin /><span>正在验证所选 Workspace 权限…</span></div>}
        {context && <>
          <section className="client-context-card"><div><p className="auth-kicker">当前空间</p><h2>{context.workspaceName}</h2><p>{principal?.email} · {context.roleCode}</p></div><div className="client-context-actions"><Tag color="green">服务端已确认</Tag>{can(permission.knowledgeManage) && <Button onClick={() => router.push(`/client/knowledge?workspaceId=${encodeURIComponent(selectedId)}`)}>管理知识库</Button>}{can(permission.knowledgeQuery) && <Button onClick={() => router.push(`/client/knowledge/questions?workspaceId=${encodeURIComponent(selectedId)}`)}>知识问答</Button>}</div></section>
          {can(permission.workspaceManage) && <section className="admin-overview-section"><div className="overview-section-heading"><h2>Workspace 设置</h2><span>需要 workspace.manage</span></div>
            <Form form={workspaceForm} layout="inline" onFinish={updateWorkspace}><Form.Item name="name" rules={[{ required: true, min: 2, max: 120 }]}><Input aria-label="Workspace 名称" maxLength={120} /></Form.Item><Button type="primary" htmlType="submit" loading={busy}>保存名称</Button></Form>
          </section>}
          {can(permission.roleRead) && <section className="admin-overview-section"><div className="overview-section-heading"><h2>可用角色</h2><span>由当前 Workspace 返回</span></div><div className="client-role-list">{roles.map(role => <div className="client-role-card" key={role.id}><strong>{role.name}</strong><span>{role.code}</span><small>{role.permissions.length ? role.permissions.join(" · ") : "无分配权限"}</small></div>)}</div></section>}
          {can(permission.memberRead) ? <section className="admin-overview-section"><div className="overview-section-heading"><h2>成员管理</h2><span>{members.length} 位成员 · 当前授权决定可用操作</span></div>
            {can(permission.memberManage) && <Form form={memberForm} layout="inline" onFinish={addMember} className="client-add-member-form"><Form.Item label="客户成员 ID" name="memberId" rules={[{ required: true, message: "请输入成员 ID" }]}><Input aria-label="客户成员 ID" maxLength={128} /></Form.Item><Form.Item label="角色" name="roleId" rules={[{ required: true, message: "请选择角色" }]}><Select aria-label="新成员角色" options={assignableRoles.map(role => ({ value: role.id, label: role.name }))} style={{ minWidth: 180 }} /></Form.Item><Button type="primary" htmlType="submit" loading={busy} disabled={!assignableRoles.length}>添加成员</Button></Form>}
            <Table<Membership> rowKey="id" columns={columns} dataSource={members} pagination={false} loading={busy} scroll={{ x: 760 }} locale={{ emptyText: "当前 Workspace 没有可显示的成员" }} />
          </section> : <section className="client-empty-state"><h2>成员信息不可用</h2><p>此角色没有 workspace.member.read 权限，因此不会请求或展示成员列表。</p></section>}
          <div className="client-workspace-footer">{can(permission.context) && <Button danger onClick={() => void leaveWorkspace()} loading={busy}>退出此 Workspace</Button>}<Button onClick={() => void refresh()} loading={busy}>重新验证访问</Button></div>
        </>}
      </>}
    </main>
  </div></ConfigProvider>;
}
