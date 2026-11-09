"use client";

import { Alert, Button, ConfigProvider, Form, Input, Spin } from "antd";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";

import { adminApi as api, adminTheme as theme, AdminSessionData as Session, RequestFailure } from "./admin-api";
function Frame({ children }: { children: React.ReactNode }) {
  return <ConfigProvider theme={theme}><main className="auth-frame">
    <div className="auth-intro"><Link href="/" className="auth-brand" aria-label="AIJ Foundation 首页">AIJ<span>FOUNDATION</span></Link>
      <div className="auth-intro-copy"><p className="eyebrow">管理工作，从这里开始</p><h1>一个独立的<br />工作起点。</h1><p>使用管理员账号登录，<br />安全地继续你的工作。</p></div>
      <p className="auth-footer">AIJ Foundation · 管理员入口</p>
    </div>
    <div className="auth-panel">{children}</div>
  </main></ConfigProvider>;
}

// Directed source Form/Input/Button adaptation; no default password or browser token storage.
export function AdminLogin() {
  const router = useRouter(), [form] = Form.useForm();
  const [checking, setChecking] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    api<Session>("/auth/session").then(() => { if (active) router.replace("/admin"); }).catch(() => {
      if (active) setChecking(false);
    });
    return () => { active = false; };
  }, [router]);
  async function login(values: { username: string; password: string }) {
    setBusy(true); setError("");
    try {
      await api("/auth/browser-login", { method: "POST", headers: { "Content-Type": "application/json", "X-AIJ-Client": "web" }, body: JSON.stringify(values) });
      form.resetFields(["password"]); router.replace("/admin");
    } catch (failure) {
      setError(failure instanceof RequestFailure && failure.status === 401 ? "用户名或密码不正确，请重新输入。" : failure instanceof RequestFailure && failure.status === 403 ? "当前访问地址未获允许，请从本项目的登录地址进入。" : "暂时无法连接服务，请稍后重试。");
    } finally { setBusy(false); }
  }
  return <Frame><div className="auth-card"><p className="auth-kicker">管理员登录</p><h2>欢迎回来</h2><p className="auth-description">请输入你的管理员账号和密码。</p>
    {checking ? <div role="status" className="auth-loading"><Spin /><span>正在确认登录状态…</span></div> : <>
      {error && <div role="alert" className="auth-alert"><Alert type="error" showIcon title={error} /></div>}
      <Form form={form} name="admin-login" layout="vertical" onFinish={login} requiredMark={false} autoComplete="on">
        <Form.Item label="用户名" name="username" rules={[{ required: true, message: "请输入用户名" }, { max: 64, message: "用户名过长" }]}><Input autoComplete="username" autoFocus maxLength={64} disabled={busy} /></Form.Item>
        <Form.Item label="密码" name="password" rules={[{ required: true, message: "请输入密码" }]}><Input.Password autoComplete="current-password" maxLength={72} disabled={busy} /></Form.Item>
        <Button type="primary" htmlType="submit" block loading={busy}>登录</Button>
      </Form>
      <p className="auth-help">没有管理员账号？请联系项目负责人。</p>
    </>}
  </div></Frame>;
}
