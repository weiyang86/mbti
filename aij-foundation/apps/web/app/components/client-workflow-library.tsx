"use client";

import { PageHeading } from "@aij/ui";
import { Alert, Button, ConfigProvider, Empty, Form, Input, Modal, Select, Space, Spin, Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import type { PersonalWorkflowSummary, PersonalWorkflowVersionSummary } from "@aij/sdk";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { adminTheme } from "./admin-api";
import { clientApi } from "./client-api.mjs";
import { createWorkflowLibrary, classifyLinearWorkflow } from "./client-workflow-library-state.mjs";
import { ClientWorkflowExecutionPanel } from "./client-workflow-execution-panel";
import { ClientWorkflowGraphPreview } from "./client-workflow-graph-preview";

import { ClientWorkflowLinearEditor } from "./client-workflow-linear-editor";

const bounded = { minWidth: 0, maxWidth: "100%", overflowWrap: "anywhere" } as const;
export function ClientWorkflowLibrary() {
  const router = useRouter(), trigger = useRef<HTMLElement | null>(null);
  const [store] = useState(() => createWorkflowLibrary({ request: clientApi, configured: () => Boolean(process.env.NEXT_PUBLIC_API_URL), onUnauthorized: () => router.replace("/client/login") }));
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  useEffect(() => {
    void store.start(new URL(window.location.href).searchParams.get("workspaceId") ?? "");
    const leave = () => { trigger.current = null; store.dispose(); };
    const resume = () => { trigger.current = null; if (document.visibilityState === "visible") void store.refresh(); else store.dispose(); };
    const restore = (e: PageTransitionEvent) => { if (e.persisted) resume(); };
    window.addEventListener("blur", leave); window.addEventListener("pagehide", leave); window.addEventListener("pageshow", restore); window.addEventListener("focus", resume); document.addEventListener("visibilitychange", resume);
    return () => { window.removeEventListener("blur", leave); window.removeEventListener("pagehide", leave); window.removeEventListener("pageshow", restore); window.removeEventListener("focus", resume); document.removeEventListener("visibilitychange", resume); store.dispose(); };
  }, [store]);
  const canRead = Boolean(state.context?.permissions.includes("workspace.ai.assets.read"));
  const canManage = canRead && Boolean(state.context?.permissions.includes("workspace.ai.assets.manage"));
  const locked = state.busy || state.blocked || Boolean(state.confirmation) || !canManage || state.replay;
  const confirm = (action: VoidFunction) => { trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; action(); };
  const cancel = () => { store.cancelConfirmation(state.confirmation?.token); const element = trigger.current; trigger.current = null; queueMicrotask(() => { if (element?.isConnected) element.focus(); }); };
  const token = state.editorToken;
  const query = state.workspaceId ? `?workspaceId=${encodeURIComponent(state.workspaceId)}` : "";
  const columns: ColumnsType<PersonalWorkflowSummary> = [
    { title: "名称 / 编号", key: "name", render: (_,v) => <span style={bounded}>{v.name}<br /><Typography.Text type="secondary">{v.code}</Typography.Text></span> },
    { title: "版本", dataIndex: "revision", render: v => <span>v{v}<br /><Tag>DRAFT</Tag></span> },
    { title: "操作", key: "view", render: (_,v) => <Button type="link" disabled={state.busy} onClick={() => void store.openDetail(v.id)}>查看草稿</Button> }
  ];
  const historyColumns: ColumnsType<PersonalWorkflowVersionSummary> = [
    { title: "不可变版本", dataIndex: "revision", render: v => `v${v}` },
    { title: "保存时间", dataIndex: "createdAt", render: v => new Date(v).toLocaleString("zh-CN") },
    { title: "操作", key: "view", render: (_,v) => <Button type="link" disabled={state.busy} onClick={() => void store.previewVersion(v.revision)}>查看此版本</Button> }
  ];
  const executionScope = useMemo(() => state.phase === "ready" && !state.busy && !state.blocked && !state.editor && !state.confirmation && !state.replay && !state.historical && canRead && state.principal && state.context && state.detail && state.workspaceId === state.context.workspaceId
    ? { memberId: state.principal.id, workspaceId: state.workspaceId, workflowId: state.detail.id, revision: state.detail.revision, graphDigest: state.detail.graphDigest } : null,
    [state.phase, state.busy, state.blocked, state.editor, state.confirmation, state.replay, state.historical, state.principal, state.context, state.detail, state.workspaceId, canRead]);
  const onWorkflowChanged = useCallback(() => { const current = store.getSnapshot(); if (current.detail) void store.openDetail(current.detail.id); }, [store]);
  const reload = state.detail && <Button disabled={state.busy} onClick={() => void store.openDetail(state.detail!.id)}>重新读取当前草稿</Button>;
  return <ConfigProvider theme={adminTheme}><div className="client-workspace-frame" style={bounded}>
    <header className="client-workspace-topbar" style={{ flexWrap: "wrap" }}><Link href="/client" className="auth-brand">AIJ<span>FOUNDATION</span></Link><div className="client-topbar-identity" style={bounded}><span>{state.principal?.nickname || "客户账号"}</span><Button onClick={() => void store.signOut()}>退出登录</Button></div></header>
    <main className="client-workspace-main" style={bounded}>
      <PageHeading eyebrow="客户工作台 · 私有配置" title="我的工作流草稿" description="保存有明确 Agent 固定版本的流程结构，查看当前草稿与不可变历史。" actions={<Button loading={state.phase === "loading"} onClick={() => void store.refresh()}>重新验证访问</Button>} />
      <nav aria-label="工作流导航"><Space wrap><Link href={`/client/agents${query}`}>我的 Agent</Link><Link href="/client/workspaces">管理空间</Link></Space></nav>
      <section className="client-workspace-picker" aria-labelledby="workflow-space-title" style={bounded}><div><label id="workflow-space-title" htmlFor="workflow-space">当前空间</label><p>只显示当前账号自己的草稿。请选择明确的空间；未选择时不加载私有流程。</p></div><Select id="workflow-space" aria-label="选择工作流空间" placeholder="请选择空间" style={{ minWidth: 0, maxWidth: "100%" }} value={state.workspaceId || undefined} loading={state.phase === "loading"} options={state.workspaces.map(w => ({ value: w.workspace.id, label: `${w.workspace.name} · ${w.role.name}` }))} onChange={v => void store.selectWorkspace(v)} /></section>
      {state.issue && <Alert role="alert" className="admin-error" showIcon type="warning" title={state.issue.message} action={<Space wrap><Button onClick={() => void store.refresh()}>重新读取列表（清除编辑）</Button>{reload}</Space>} />}
      {state.replay && <Alert role="alert" type="warning" showIcon title="创建结果未知，原请求只保留在此页内存" description="可以先刷新核对；若明确确认相同创建请求，可原样提交一次。编号、名称、图与固定版本均不会改变；服务端可能返回当前草稿，删除过的编号不能复用。" action={<Button disabled={state.busy} onClick={() => void store.replayCreate()}>原样确认创建请求</Button>} />}
      {state.notice && <Alert role="status" type="success" showIcon title={state.notice} />}
      {state.phase === "loading" && <div className="auth-loading" role="status"><Spin /><span>正在验证会话、空间与读取权限…</span></div>}
      {state.phase === "ready" && !state.workspaceId && !state.issue && <Empty description={state.workspaces.length ? "请选择空间以查看自己的工作流草稿" : "没有可访问的空间"} />}
      {state.context && !canRead && <Alert type="info" showIcon title="当前角色没有读取草稿的权限" />}
      {state.phase === "ready" && canRead && <section className="admin-overview-section" style={bounded} aria-labelledby="workflow-list-title">
        <div className="overview-section-heading" style={{ flexWrap: "wrap", gap: 12 }}><div><h2 id="workflow-list-title">私有草稿</h2><span>{state.context?.workspaceName} · 每页最多 20 条</span></div>{canManage && <Button type="primary" disabled={locked} onClick={() => void store.openCreate()}>新建线性草稿</Button>}</div>
        {!canManage && <Alert type="info" showIcon title="当前角色只读" description="可以查看自己的草稿与历史；没有创建、改名或删除权限。" />}
        <Table<PersonalWorkflowSummary> rowKey="id" columns={columns} dataSource={state.items} pagination={false} loading={state.busy} scroll={{ x: 480 }} locale={{ emptyText: <Empty description="当前页没有草稿" /> }} />
        <Space wrap><Button disabled={state.busy} onClick={() => void store.refresh()}>返回第一页</Button><Button disabled={state.busy || !state.nextCursor} onClick={() => void store.nextPage()}>下一页</Button></Space>
      </section>}
      {(state.detail || state.editor === "create") && <section className="admin-overview-section" style={bounded} aria-labelledby="workflow-detail-title" aria-busy={state.busy}>
        <div className="overview-section-heading" style={{ flexWrap: "wrap", gap: 12 }}><h2 id="workflow-detail-title">{state.editor === "create" ? "新建线性草稿" : `当前草稿 · v${state.detail?.revision}`}</h2><Button onClick={() => store.closeDetail()}>关闭并清除编辑</Button></div>
        {state.detail && <><p>{state.detail.name} · {state.detail.code} · 当前 v{state.detail.revision}</p><Space wrap>{canManage && <><Button disabled={locked} onClick={() => store.openEdit(token)}>仅修改名称</Button>{classifyLinearWorkflow(state.detail.graph) && <Button type="primary" disabled={locked} onClick={() => store.openLinearEdit(token)}>编辑线性流程</Button>}</>}<Button disabled={state.busy} onClick={() => void store.loadVersions()}>读取历史列表</Button>{canManage && <Button danger disabled={locked} onClick={() => confirm(() => store.requestDelete(token))}>删除草稿</Button>}{reload}</Space></>}
        {state.editor && canManage && <Form layout="vertical" autoComplete="off" onFinish={() => confirm(() => store.requestSave(token))} style={{ marginBlock: 24 }}>
          {state.editor === "create" && <Form.Item label="草稿编号" required extra="2–63 位小写字母、数字与短横线，以字母开头。保存后不可改；删除后不可复用。"><Input aria-label="工作流编号" autoComplete="off" maxLength={63} value={state.draft.code} disabled={locked} onChange={e => store.setDraft("code", e.target.value, token)} /></Form.Item>}
          <Form.Item label="名称" required extra="最多 100 字，首尾不留空格。"><Input aria-label="工作流名称" autoComplete="off" maxLength={100} value={state.draft.name} disabled={locked} onChange={e => store.setDraft("name", e.target.value, token)} /></Form.Item>
          {state.editor === "rename" ? <Alert type="info" showIcon title="只修改名称，保留完整图和所有固定绑定" description="条件、并行、汇合、循环、审批、标签或自定义结构保留只读。符合简单构建器的线性图可从“编辑线性流程”入口编辑。" /> : <>
            <Form.Item label="输入键" extra="英文逗号分隔，最多 20 个，不重复；字母开头，可含字母、数字、下划线、短横线，每个最多 48 位。"><Input aria-label="工作流输入键" autoComplete="off" maxLength={1000} value={state.draft.inputKeys} disabled={locked} onChange={e => store.setDraft("inputKeys", e.target.value, token)} /></Form.Item>
            <h3>按顺序添加自己的 Agent 步骤</h3><p>至少一个步骤，最多 62 个。每次都须明确选择一个当前或历史版本；不会自动选择最新版本。</p>
            <Form.Item label="自己的 Agent"><Select aria-label="选择自己的 Agent" placeholder="选择 Agent 并读取版本" value={state.selectedAgent?.id} disabled={locked} style={{ width: "100%" }} options={state.agents.map(a => ({ value: a.id, disabled: !a.enabled, label: `${a.name} · ${a.code} · 当前 v${a.revision}${a.enabled ? "" : " · 已停用"}` }))} onChange={v => void store.selectAgent(v, false, token)} /></Form.Item>
            {!state.agents.some(a => a.enabled) && !state.busy && <Alert type="info" title="没有可用的自有 Agent" description="请先在“我的 Agent”创建并启用配置，再重新创建草稿。" />}
            {state.selectedAgent && <section aria-label="可选 Agent 固定版本"><h4>{state.selectedAgent.name} · 显式选择版本</h4><ul>{state.agentVersions.map(v => <li key={v.id} style={{ marginBlock: 12 }}><Space wrap><span>{v.name} · v{v.revision} · {v.revision === state.selectedAgent?.revision ? "当前版本" : "拥有的历史版本"}</span><Button disabled={locked || !state.selectedAgent?.enabled || state.draft.steps.length >= 62} onClick={() => store.addStep(v.revision, token)}>添加 v{v.revision} 为下一步</Button></Space></li>)}</ul><Button disabled={locked || !state.agentVersionCursor} onClick={() => void store.selectAgent(state.selectedAgent!.id, true, token)}>更早 Agent 版本</Button></section>}
            <div aria-label="草稿步骤顺序"><ClientWorkflowLinearEditor key={token} state={state} store={store} locked={locked} /></div>
            <p>保存结构：开始 → 上述步骤（按顺序）→ 结束。保存为 DRAFT；更改图或名称生成新版本，内容相同保持原版本。</p>
          </>}
          <Space wrap style={{ marginTop: 16 }}><Button type="primary" htmlType="submit" disabled={locked || !store.readyToSave()}>检查并确认保存</Button><Button disabled={state.busy} onClick={() => store.cancelEdit(token)}>取消并清除编辑</Button></Space>
        </Form>}
        {state.detail && <ClientWorkflowGraphPreview graph={state.detail.graph} bindings={state.detail.agentBindings} agents={state.agents} />}
        {state.versions.length > 0 && <section style={bounded} aria-label="不可变历史版本列表"><h3>不可变历史 · 只读</h3><Table<PersonalWorkflowVersionSummary> rowKey="id" columns={historyColumns} dataSource={state.versions} pagination={false} scroll={{ x: 440 }} /><Button disabled={state.busy || !state.versionCursor} onClick={() => void store.loadVersions(true)}>更早工作流版本</Button></section>}
        {state.historical && <section style={{ ...bounded, marginTop: 32 }} aria-label="历史图只读预览"><h3>历史 v{state.historical.revision} · {state.historical.name}</h3><p>这是保存时的只读版本。与上方当前 v{state.detail?.revision} 分开展示；不会恢复或提升此版本。</p><ClientWorkflowGraphPreview key={state.historical.id} graph={state.historical.graph} bindings={state.historical.agentBindings} agents={state.agents} /></section>}
      </section>}
      <ClientWorkflowExecutionPanel request={clientApi} scope={executionScope} onWorkflowChanged={onWorkflowChanged} onScopeRejected={store.dispose} />
      <Typography.Paragraph type="secondary">切换空间、账号、重新验证、切回页面或离开时清除编辑、对话框、详情与历史。私有数据不写入浏览器存储。已发送请求的最终结果由服务端决定，未知结果请主动重新读取核对。</Typography.Paragraph>
    </main>
    {state.confirmation && <Modal title={state.confirmation.kind === "delete" ? "确认删除工作流草稿" : "确认保存工作流草稿"} open keyboard cancelText="返回检查" okText={state.confirmation.kind === "delete" ? "确认删除" : "确认保存"} okButtonProps={{ danger: state.confirmation.kind === "delete" }} onCancel={cancel} onOk={() => { trigger.current = null; void store.confirmMutation(state.confirmation?.token); }} destroyOnHidden>
      <p>当前空间：{state.context?.workspaceName}</p><p>编号：{state.confirmation.kind === "create" ? state.draft.code : state.detail?.code}</p>
      {state.confirmation.kind === "delete" ? <p>仅删除当前空间中自己的草稿；确认使用当前 v{state.confirmation.revision} 校验，编号将保留墓碑，不能复用。</p> : <p>{state.confirmation.kind === "update" ? `使用当前 v${state.confirmation.revision} 校验，${state.editor === "linear" ? "保存名称、输入键、步骤顺序和明确选择的固定版本；有变化时生成不可变新版本" : "只改名称，完整图与固定版本保持原样"}。` : "保存开始、按顺序固定的 Agent 步骤与结束节点；结构有效不代表可以执行。"}</p>}
    </Modal>}
  </div></ConfigProvider>;
}
