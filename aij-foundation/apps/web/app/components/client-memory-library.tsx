"use client";

import { createPersonalAgentsClient, createPersonalMemoriesClient } from "@aij/sdk";
import type { PersonalMemorySummary } from "@aij/sdk";
import { PageHeading } from "@aij/ui";
import { Alert, Button, Checkbox, ConfigProvider, Empty, Form, Input, Modal, Select, Space, Spin, Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { adminTheme } from "./admin-api";
import { clientApi } from "./client-api.mjs";
import { createMemoryLibrary } from "./client-memory-library-state.mjs";

const bounded = { minWidth: 0, maxWidth: "100%", overflowWrap: "anywhere" } as const;
const kindLabels = { preference: "偏好", confirmed_fact: "已确认事实", task_summary: "任务摘要" };
export function ClientMemoryLibrary() {
  const router = useRouter();
  const [store] = useState(() => createMemoryLibrary({ request: clientApi, memoriesClientFactory: createPersonalMemoriesClient, agentsClientFactory: createPersonalAgentsClient,
    configured: () => Boolean(process.env.NEXT_PUBLIC_API_URL), onUnauthorized: () => router.replace("/client/login") }));
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  useEffect(() => {
    void store.start(new URL(window.location.href).searchParams.get("workspaceId") ?? "");
    const leave = () => store.dispose();
    const resume = () => { if (document.visibilityState === "visible") void store.refresh(); else store.dispose(); };
    const restore = (event: PageTransitionEvent) => { if (event.persisted) void store.refresh(); };
    window.addEventListener("pagehide", leave); window.addEventListener("pageshow", restore); window.addEventListener("focus", resume); document.addEventListener("visibilitychange", resume);
    return () => { window.removeEventListener("pagehide", leave); window.removeEventListener("pageshow", restore); window.removeEventListener("focus", resume); document.removeEventListener("visibilitychange", resume); store.dispose(); };
  }, [store]);
  const activeDetailKey = state.editor === "create" ? "create" : state.detail?.id ?? "";
  useEffect(() => {
    if (activeDetailKey) document.getElementById("memory-detail-title")?.focus();
  }, [activeDetailKey, state.editor]);
  const canRead = Boolean(state.context?.permissions.includes("workspace.ai.assets.read"));
  const canManage = canRead && Boolean(state.context?.permissions.includes("workspace.ai.assets.manage"));
  const locked = state.busy || Boolean(state.confirmation) || !canManage || Boolean(state.issue);
  const workspaceQuery = `workspaceId=${encodeURIComponent(state.workspaceId)}`;
  const columns: ColumnsType<PersonalMemorySummary> = [
    { title: "标题 / 编号", key: "title", render: (_, m) => <span>{m.title}<br /><Typography.Text type="secondary">{m.code}</Typography.Text></span> },
    { title: "类型", dataIndex: "kind", render: (v: keyof typeof kindLabels) => kindLabels[v] },
    { title: "使用许可", dataIndex: "enabled", render: v => <Tag color={v ? "green" : undefined}>{v ? "已启用" : "未启用"}</Tag> },
    { title: "修订", dataIndex: "revision", render: v => `v${v}` },
    { title: "操作", key: "actions", render: (_, m) => <Button type="link" disabled={state.busy} onClick={() => void store.openDetail(m.id)}>查看</Button> }
  ];
  const reload = state.detail && <Button disabled={state.busy} onClick={() => void store.openDetail(state.detail!.id)}>重新读取当前记忆（丢弃草稿）</Button>;
  const selected = state.editor ? state.draft.agentIds : state.detail?.agentIds ?? [];
  return <ConfigProvider theme={adminTheme}><div className="client-workspace-frame" style={bounded}>
    <header className="client-workspace-topbar" style={{ flexWrap: "wrap" }}><Link href="/client" className="auth-brand">AIJ<span>FOUNDATION</span></Link><div className="client-topbar-identity" style={bounded}><span>{state.principal?.nickname || state.principal?.email || "客户账号"}</span><Button onClick={() => void store.signOut()}>退出登录</Button></div></header>
    <main className="client-workspace-main" style={bounded}>
      <PageHeading eyebrow="客户工作台" title="我的长期记忆" description="手动保存自己的偏好、已确认事实与任务摘要，并明确选择允许使用它们的 Agent。" actions={<Button loading={state.phase === "loading"} onClick={() => void store.refresh()}>重新验证访问</Button>} />
      <nav aria-label="记忆导航"><Space wrap><Link href={`/client/ai?${workspaceQuery}`}>AI 工作台</Link>{canRead && <Link href={`/client/agents?${workspaceQuery}`}>我的 Agent</Link>}<Link href="/client/workspaces">管理空间</Link></Space></nav>
      <section className="client-workspace-picker" aria-labelledby="memory-space-title"><div><label id="memory-space-title" htmlFor="memory-space-select">当前空间</label><p>仅展示当前账号在此空间的私有记忆。请勿填写密码或密钥。</p></div>
        <Select id="memory-space-select" aria-label="选择记忆空间" style={{ minWidth: 0 }} value={state.workspaceId || undefined} placeholder="选择空间" loading={state.phase === "loading"} options={state.workspaces.map(w => ({ value: w.workspace.id, label: `${w.workspace.name} · ${w.role.name}` }))} onChange={v => void store.selectWorkspace(v)} /></section>
      <Alert showIcon type="info" title="记忆由你手动维护，默认不启用" description="启用并选择 Agent 只表达允许使用的意愿，不代表任务已执行或一定使用了记忆。未选择任何 Agent 即不授权任何 Agent。这里不会自动学习、采集内容或向组织共享。" />
      {state.issue && <Alert role="alert" className="admin-error" showIcon type="warning" title={state.issue.message} action={<Space wrap><Button onClick={() => void store.refresh()}>重新验证并读取列表</Button>{reload}</Space>} />}
      {state.notice && <Alert role="status" className="admin-feedback" showIcon type="success" title={state.notice} />}
      {state.phase === "loading" ? <div className="auth-loading" role="status"><Spin /><span>正在确认会话、空间权限与记忆列表…</span></div> : !state.workspaces.length && !state.issue ? <Empty description="还没有可访问的空间" /> : state.context && !canRead ? <Alert showIcon type="info" title="当前角色没有读取私有记忆的权限" description="请联系空间管理员申请读取权限。" /> : null}
      {state.phase === "ready" && canRead && <section className="admin-overview-section" style={bounded} aria-labelledby="memory-list-title">
        <div className="overview-section-heading" style={{ flexWrap: "wrap", gap: 12 }}><div><h2 id="memory-list-title">私有记忆</h2><span>{state.context?.workspaceName} · 当前页最多 20 条，仅加载摘要</span></div><Button type="primary" disabled={locked} onClick={() => void store.openCreate()}>新建记忆</Button></div>
        {!canManage && <Alert showIcon type="info" title="当前角色为只读访问" description="可以查看自己的记忆和授权，创建、修改和删除需要管理权限。" />}
        {state.issue && !state.items.length ? <Empty description="列表未能加载，请重新验证访问" /> : <div style={bounded}><Table<PersonalMemorySummary> rowKey="id" columns={columns} dataSource={state.items} loading={state.busy} pagination={false} scroll={{ x: 640 }} locale={{ emptyText: <Empty description="当前页没有私有记忆" /> }} /></div>}
        <Space wrap><Button disabled={state.busy} onClick={() => void store.refresh()}>返回第一页</Button><Button disabled={state.busy || !state.nextCursor} onClick={() => void store.nextPage()}>下一页</Button></Space>
      </section>}
      {(state.detail || state.editor === "create") && <section className="admin-overview-section" style={bounded} aria-labelledby="memory-detail-title" aria-busy={state.busy}>
        <div className="overview-section-heading" style={{ flexWrap: "wrap", gap: 12 }}><h2 id="memory-detail-title" tabIndex={-1}>{state.editor === "create" ? "新建私有记忆" : `当前记忆 · v${state.detail?.revision}`}</h2><Button onClick={() => store.closeDetail()}>关闭并清除草稿</Button></div>
        {state.detail && <><p>编号：{state.detail.code} · 当前修订 v{state.detail.revision}</p><Space wrap><Button disabled={locked} onClick={() => void store.openEdit()}>编辑记忆与授权</Button><Button danger disabled={locked} onClick={() => store.requestDelete()}>删除记忆</Button>{reload}</Space></>}
        {state.editor ? <Form layout="vertical" onFinish={() => store.requestSave()} autoComplete="off">
          <Form.Item label="编号" required extra="2–63 位小写字母、数字与短横线，以字母开头。创建后不可改；相同编号可能返回已有内容，请核对。删除后的编号不能复用。"><Input aria-label="记忆编号" autoComplete="off" maxLength={63} disabled={locked || state.editor !== "create"} value={state.draft.code} onChange={e => store.setDraft("code", e.target.value)} /></Form.Item>
          <Form.Item label="标题" required extra="最多 100 字符。"><Input aria-label="记忆标题" autoComplete="off" maxLength={100} disabled={locked} value={state.draft.title} onChange={e => store.setDraft("title", e.target.value)} /></Form.Item>
          <Form.Item label="内容" required extra="最多 4,000 字符 / 16KB，请只保存你已确认的内容。"><Input.TextArea aria-label="记忆内容" autoComplete="off" maxLength={4000} rows={7} showCount disabled={locked} value={state.draft.content} onChange={e => store.setDraft("content", e.target.value)} /></Form.Item>
          <Form.Item label="类型" required><Select aria-label="记忆类型" value={state.draft.kind} disabled={locked} options={Object.entries(kindLabels).map(([value,label]) => ({ value, label }))} onChange={v => store.setDraft("kind", v)} /></Form.Item>
          <Form.Item label="使用许可" extra="每次保存都明确提交当前勾选状态和完整的 Agent 授权列表。关闭许可会停止当前记忆的使用授权。"><Checkbox disabled={locked} checked={state.draft.enabled} onChange={e => store.setDraft("enabled", e.target.checked)}>允许所选 Agent 使用这条记忆</Checkbox></Form.Item>
          <h3>允许使用的 Agent · 最多 16 个</h3><p>从当前空间自己的 Agent 中选择。停用的 Agent 可预先授权；授权不会启用它或执行任务。空列表表示不授权任何 Agent。</p>
          <Form.Item label="我的 Agent"><Select<string> aria-label="选择授权 Agent" style={{ width: "100%" }} placeholder="按名称选择 Agent" value={undefined} disabled={locked || !state.optionsLoaded || selected.length >= 16} options={state.agents.map(a => ({ value: a.id, label: `${a.name} · ${a.enabled ? "已启用" : "已停用"}`, disabled: selected.includes(a.id) }))} onChange={v => store.addGrant(v)} /></Form.Item>
          <Space wrap><Button disabled={state.busy} onClick={() => void store.loadAgents()}>重新读取 Agent 首页</Button><Button disabled={state.busy || !state.agentCursor} onClick={() => void store.loadAgents(true)}>下一页 Agent</Button></Space>
          {state.optionsLoaded && !state.agents.length && <Empty description="当前页没有自己的 Agent，可前往我的 Agent 创建" />}
        </Form> : state.detail && <><h3>{state.detail.title}</h3><p>{kindLabels[state.detail.kind]} · {state.detail.enabled ? "允许所选 Agent 使用" : "使用许可已关闭"}</p><h4>当前内容</h4><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxHeight: 480, overflow: "auto" }}>{state.detail.content}</pre></>}
        <h4>当前{state.editor ? "草稿" : "保存的"}授权</h4>
        {selected.length ? <ul style={{ paddingInlineStart: 24 }}>{selected.map((agentId, index) => { const g = state.grants[agentId]; return <li key={agentId} style={{ marginBlock: 12 }}>
          <Space wrap><span>{g?.available ? `${g.name} · ${g.enabled ? "已启用" : "已停用"}` : state.busy ? "正在核对 Agent…" : `第 ${index + 1} 个 Agent 不可用或不可读取`}</span>{state.editor && <Button danger disabled={locked} aria-label={`移除第 ${index + 1} 个 Agent 授权`} onClick={() => store.removeGrant(agentId)}>移除授权</Button>}</Space>
          {!g?.available && !state.busy && <p>无法确认此 Agent 的身份。请移除此授权，再按需要选择自己的 Agent，才能保存。</p>}
        </li>; })}</ul> : <p>未授权任何 Agent。</p>}
        {state.editor && <><Button type="primary" disabled={!store.readyToSave()} onClick={() => store.requestSave()}>检查并确认保存</Button><p>保存将完整替换标题、内容、类型、使用许可和授权列表。{state.editor === "edit" ? `将校验当前修订 v${state.detail?.revision}；冲突后请重新读取。` : "请填写有效内容并检查授权。"}</p></>}
      </section>}
      <Typography.Paragraph type="secondary">删除会清除当前记忆内容和授权，无法恢复；之前生成的结果仍按任务保留策略处理。切换空间、重新验证、切回页面或离开会清除未保存内容。私有内容仅保存在当前页面内存中。</Typography.Paragraph>
    </main>
    {/* Conditional mount is required: clearing private state must remove the portal immediately. */}
    {state.confirmation && <Modal title={state.confirmation === "delete" ? "确认永久删除记忆" : state.confirmation === "create" ? "确认创建记忆" : "确认替换记忆与授权"} open okText={state.confirmation === "delete" ? "永久删除" : "确认保存"} cancelText="返回检查" okButtonProps={{ danger: state.confirmation === "delete" }} onCancel={() => store.cancelConfirmation()} onOk={() => void store.confirmMutation()} destroyOnHidden>
      <p>当前空间：{state.context?.workspaceName}</p><p>记忆：{state.confirmation === "create" ? state.draft.title : state.detail?.title} · 编号 {state.confirmation === "create" ? state.draft.code : state.detail?.code}</p>
      {state.detail && <p>校验当前修订 v{state.detail.revision}</p>}
      {state.confirmation === "delete" ? <p>将清除当前记忆内容与全部授权，无法恢复，编号也不能复用。之前生成的结果仍按任务保留策略处理。</p> : <><p>使用许可：{state.draft.enabled ? "允许所选 Agent 使用" : "关闭"} · 已选 {state.draft.agentIds.length} 个 Agent{!state.draft.agentIds.length ? "（不授权任何 Agent）" : ""}。</p><p>将保存当前完整内容与授权。保存不代表任务已经执行；相同编号可能返回已有内容，请在保存后核对。</p>{state.draft.agentIds.length > 0 && <ul>{state.draft.agentIds.map(agentId => <li key={agentId}>{state.grants[agentId]?.name} · {state.grants[agentId]?.enabled ? "已启用" : "已停用"}</li>)}</ul>}</>}
    </Modal>}
  </div></ConfigProvider>;
}
