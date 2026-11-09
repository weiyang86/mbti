"use client";

import { PageHeading } from "@aij/ui";
import { Alert, Button, Descriptions, Drawer, Input, Select, Space, Table, Tag } from "antd";
import { useState } from "react";
import { requestMessage } from "./admin-api";
import { useAdminList } from "./admin-list";
import { useAdmin } from "./admin-shell";

type ConsentSummary = { type: string; granted: boolean; version: string; capturedAt: string } | null;
type ClientRow = { id: string; nickname: string; emailMasked: string | null; status: string; emailVerified: boolean; createdAt: string; lastLoginAt: string | null; activeSessionCount: number; latestConsent: ConsentSummary };

const statusLabel: Record<string, string> = { active: "正常", pending_verification: "待验证", disabled: "停用" };

export function AdminClientDirectory() {
  const { can } = useAdmin();
  const list = useAdminList<ClientRow>("/admin/clients");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<ClientRow | null>(null);

  function search() {
    list.search(q.trim());
  }

  const columns = [
    { title: "客户", key: "identity", render: (_: unknown, row: ClientRow) => <><strong>{row.nickname}</strong><div className="admin-cell-secondary">{row.emailMasked ?? "未提供邮箱"}</div></> },
    { title: "账号状态", dataIndex: "status", key: "status", render: (value: string) => <Tag color={value === "active" ? "green" : "default"}>{statusLabel[value] ?? "未知"}</Tag> },
    { title: "邮箱验证", dataIndex: "emailVerified", key: "emailVerified", render: (value: boolean) => value ? "已验证" : "未验证" },
    { title: "当前会话", dataIndex: "activeSessionCount", key: "activeSessionCount" },
    { title: "最近同意", key: "consent", render: (_: unknown, row: ClientRow) => row.latestConsent ? <><span>{row.latestConsent.type} · {row.latestConsent.granted ? "同意" : "已撤回"}</span><div className="admin-cell-secondary">版本 {row.latestConsent.version}</div></> : "暂无记录" },
    { title: "最近登录", dataIndex: "lastLoginAt", key: "lastLoginAt", render: (value: string | null) => value ? new Date(value).toLocaleString() : "—" },
    { title: "详情", key: "details", render: (_: unknown, row: ClientRow) => <Button aria-label={`查看${row.nickname}详情`} disabled={!can("admin.client.read")} onClick={() => setSelected(row)}>查看</Button> }
  ];

  return <>
    <PageHeading eyebrow="系统管理 · 客户身份" title="客户账号" description="仅展示当前项目已有客户身份；邮箱经过遮蔽，会话和同意信息仅提供只读摘要。" actions={<Button disabled={!can("admin.client.read")} onClick={() => list.reload()}>刷新</Button>} />
    {list.error && <div role="alert" className="admin-feedback"><Alert type="error" showIcon title={requestMessage(list.error)} /></div>}
    <section className="admin-table-panel" aria-label="客户账号筛选">
      <Space wrap style={{ padding: 20 }}>
        <Input aria-label="搜索客户" value={q} maxLength={128} placeholder="搜索昵称或邮箱" onChange={event => setQ(event.target.value)} onPressEnter={() => void search()} />
        <Button type="primary" disabled={!can("admin.client.read")} onClick={() => void search()}>搜索</Button>
        <Select aria-label="按账号状态筛选" allowClear placeholder="全部状态" value={list.status} onChange={value => list.filter(value)} style={{ width: 160 }} options={[{ value: "active", label: "正常" }, { value: "pending_verification", label: "待验证" }, { value: "disabled", label: "停用" }]} />
        <Button onClick={() => { setQ(""); list.search(""); }}>清除</Button>
      </Space>
    </section>
    <section className="admin-table-panel" aria-label="客户账号列表">
      <Table<ClientRow> rowKey="id" dataSource={list.data.items} columns={columns} loading={list.loading} scroll={{ x: 1000 }} pagination={{ current: list.page, pageSize: list.pageSize, total: list.data.total, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100], onChange: list.paginate }} locale={{ emptyText: list.error ? "无法读取客户，请检查权限或服务状态。" : "没有匹配的客户记录。" }} />
    </section>
    <Drawer title="客户详情（只读）" open={selected !== null} onClose={() => setSelected(null)} width={560}>
      {selected && <Descriptions bordered column={1}>
        <Descriptions.Item label="客户">{selected.nickname}</Descriptions.Item>
        <Descriptions.Item label="客户编号">{selected.id.slice(0, 8)}…</Descriptions.Item>
        <Descriptions.Item label="邮箱">{selected.emailMasked ?? "未提供邮箱"}</Descriptions.Item>
        <Descriptions.Item label="账号状态"><Tag color={selected.status === "active" ? "green" : "default"}>{statusLabel[selected.status] ?? "未知"}</Tag></Descriptions.Item>
        <Descriptions.Item label="邮箱验证">{selected.emailVerified ? "已验证" : "未验证"}</Descriptions.Item>
        <Descriptions.Item label="创建时间">{new Date(selected.createdAt).toLocaleString()}</Descriptions.Item>
        <Descriptions.Item label="最近登录">{selected.lastLoginAt ? new Date(selected.lastLoginAt).toLocaleString() : "—"}</Descriptions.Item>
        <Descriptions.Item label="当前会话数">{selected.activeSessionCount}</Descriptions.Item>
        <Descriptions.Item label="最新同意">{selected.latestConsent ? `${selected.latestConsent.type} · ${selected.latestConsent.granted ? "同意" : "已撤回"} · ${selected.latestConsent.version}` : "暂无记录"}</Descriptions.Item>
      </Descriptions>}
      <p className="admin-help">详情字段来自已授权的去敏客户 API。本页支持状态筛选和只读查看，不修改账号状态、会话或同意记录。</p>
    </Drawer>
    <p className="admin-help">分页、状态筛选和访问权限由服务端执行。此页没有注销、会话撤销、账号修改、删除或导出入口；后续敏感操作由独立授权接口完成。</p>
  </>;
}
