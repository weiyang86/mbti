"use client";
import { PageHeading } from "@aij/ui";
import { Alert, Button, Empty, Space, Table, Tag } from "antd";
import { useEffect, useEffectEvent, useState } from "react";
import { requestMessage } from "./admin-api";
import { useAdmin } from "./admin-shell";

type Plugin = { code: string; name: string; version: string };
type Installation = { pluginCode: string; projectId: string; status: string; version: string };
type View = { expectedVersion: number; expectedDraftVersion: number; categories: Record<string, unknown>; diff: string[]; unknowns: string[] };
export function AdminMbtiConfig() {
  const { request, permissions, can } = useAdmin();
  const [plugin, setPlugin] = useState<Plugin | null>(null), [installation, setInstallation] = useState<Installation | null>(null);
  const [view, setView] = useState<View | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  async function load() {
    setBusy(true); setView(null); setError("");
    try {
      const result = await request<{ available: Plugin[]; installations: Installation[] }>("/admin/plugins");
      setPlugin(result.available.find(p => p.code === "mbti-config") ?? null);
      const installed = result.installations.find(p => p.pluginCode === "mbti-config") ?? null;
      setInstallation(installed);
      if (installed?.status === "enabled" && can("admin.config.manage")) setView(await request<View>("/plugins/mbti-config/draft"));
    } catch (failure) { setError(requestMessage(failure)); } finally { setBusy(false); }
  }
  const initialLoad = useEffectEvent(load);
  useEffect(() => { const timer = setTimeout(() => { if (permissions.isSuperAdmin) void initialLoad(); }, 0); return () => clearTimeout(timer); }, [permissions.isSuperAdmin]);
  if (!permissions.isSuperAdmin) return <Alert type="warning" title="此入口限平台超管" />;
  async function act(action: "install" | "enable" | "disable") {
    if (!plugin) return; setBusy(true); setError("");
    try { await request(`/admin/plugins/mbti-config/${action}`, "POST", action === "install" ? { version: plugin.version } : {}); await load(); }
    catch (failure) { setError(requestMessage(failure)); } finally { setBusy(false); }
  }
  return <>
    <PageHeading eyebrow="项目插件" title="MBTI 配置" description="当前项目与运行环境的安装状态、候选草稿和发布版本。" actions={<Button loading={busy} onClick={() => void load()}>刷新</Button>} />
    {error && <Alert type="error" title={error} showIcon />}
    <Space wrap><Tag>{plugin ? `${plugin.code} · ${plugin.version}` : "可信目录未提供"}</Tag><Tag>{installation?.status ?? "未安装"}</Tag><span>{installation?.projectId}</span>
      <Button disabled={busy || !plugin || !!installation} onClick={() => void act("install")}>安装</Button>
      <Button disabled={busy || installation?.status !== "installed"} onClick={() => void act("enable")}>启用</Button>
      <Button disabled={busy || installation?.status !== "enabled"} onClick={() => void act("disable")}>停用</Button>
    </Space>
    <Alert type="info" title="模型与支付 UNCONFIGURED" description="业务字段及角色映射待 Remy 确认；日常编辑与发布由运营后台 C2 接入。此处仅展示受限投影，不提供凭据输入。" />
    {view ? <><p>当前发布版本 {view.expectedVersion} · 草稿修订 {view.expectedDraftVersion}</p>
      <Table rowKey="category" pagination={false} dataSource={Object.entries(view.categories).map(([category, value]) => ({ category, configured: value !== null, changed: view.diff.includes(category) }))}
        columns={[{ title: "配置类别", dataIndex: "category" }, { title: "候选配置", render: (_, row) => row.configured ? "已保存" : "UNCONFIGURED" }, { title: "待发布差异", render: (_, row) => row.changed ? "有" : "无" }]} />
      <ul>{view.unknowns.map(item => <li key={item}>{item}</li>)}</ul></> : <Empty description="启用插件并取得配置管理权限后可读取配置状态。" />}
  </>;
}
