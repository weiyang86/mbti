"use client";

import { createAiClient, createAiRunRecoveryClient, createPersonalAgentRunPreviewsClient, createPersonalAgentRunsClient, createPersonalAgentsClient } from "@aij/sdk";
import { PageHeading } from "@aij/ui";
import { Alert, Button, ConfigProvider, Descriptions, Empty, Form, Input, Modal, Select, Space, Spin, Tag, Typography } from "antd";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { adminTheme } from "./admin-api";
import { clientApi } from "./client-api.mjs";
import { createPersonalAgentRun } from "./client-personal-agent-run-state.mjs";

const bounded = { minWidth: 0, maxWidth: "100%", overflowWrap: "anywhere" } as const;
const pre = { ...bounded, whiteSpace: "pre-wrap", maxHeight: 640, overflow: "auto" } as const;
function budgetUnits(value: string) {
  const nanos = BigInt(value), denominator = BigInt(1000000000), whole = nanos / denominator;
  const fraction = (nanos % denominator).toString().padStart(9, "0").replace(/0+$/, "");
  return whole.toString() + (fraction ? "." + fraction : "");
}
const statusText: Record<string, string> = { queued: "等待处理", running: "正在执行", succeeded: "已完成", failed: "执行失败", unknown: "结果未知", unconfirmed: "提交尚未确认" };

export function ClientPersonalAgentRun({ agentId, workspaceId }: { agentId: string; workspaceId: string }) {
  const router = useRouter();
  const reviewButton = useRef<HTMLButtonElement>(null), resultHeading = useRef<HTMLHeadingElement>(null);
  const [store] = useState(() => createPersonalAgentRun({ agentId, request: clientApi, previewsClientFactory: createPersonalAgentRunPreviewsClient,
    runsClientFactory: createPersonalAgentRunsClient, aiClientFactory: createAiClient, recoveryClientFactory: createAiRunRecoveryClient, agentsClientFactory: createPersonalAgentsClient,
    configured: () => Boolean(process.env.NEXT_PUBLIC_API_URL), journalStorage: () => window.localStorage,
    withRecoveryLock: async (name, fn) => {
      if (!navigator.locks) return Promise.reject(new Error("Recovery lock unavailable"));
      return await navigator.locks.request(name, fn);
    }, onUnauthorized: () => router.replace("/client/login") }));
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  useEffect(() => {
    void store.start(workspaceId);
    const leave = () => store.dispose();
    const resume = () => { if (document.visibilityState === "visible") void store.refresh(); else store.dispose(); };
    const restore = (event: PageTransitionEvent) => { if (event.persisted) void store.refresh(); };
    // A journal change in another tab invalidates input, confirmations and in-flight callbacks immediately.
    const synchronize = () => { store.dispose(); if (document.visibilityState === "visible") void store.refresh(); };
    window.addEventListener("pagehide", leave); window.addEventListener("pageshow", restore); window.addEventListener("focus", resume);
    document.addEventListener("visibilitychange", resume); window.addEventListener("storage", synchronize);
    return () => { window.removeEventListener("pagehide", leave); window.removeEventListener("pageshow", restore); window.removeEventListener("focus", resume);
      document.removeEventListener("visibilitychange", resume); window.removeEventListener("storage", synchronize); store.dispose(); };
  }, [store, workspaceId]);
  const p = state.preview, currentRun = state.run ?? state.reference;
  const canExecute = state.context?.permissions.includes("workspace.ai.execute") && state.context.permissions.includes("workspace.ai.assets.read");
  const canRead = state.context?.permissions.includes("workspace.ai.read");
  const safeTerminal = currentRun?.status === "succeeded" && currentRun.budgetStatus === "settled" || currentRun?.status === "failed" && currentRun.budgetStatus === "released";
  const advisory = p && <Descriptions column={1} size="small" items={[
    { key: "name", label: "Agent", children: `${p.name} · v${p.revision}` },
    { key: "model", label: "模型 / 目录", children: `${p.modelCode} · v${p.modelRevision} / 目录 v${p.catalogVersion}` },
    { key: "output", label: "输出格式", children: `${p.outputFormat === "json" ? "JSON" : "文本"}${p.outputFields.length ? ` · ${p.outputFields.join("、")}` : ""}` },
    { key: "cost", label: "模型预算估计上限", children: `${budgetUnits(p.maximumEstimatedCostNanos)} 模型预算单位` },
    { key: "configured", label: "模型执行配置", children: p.modelExecutionConfigured ? "预览时已配置（提交时服务端重新校验）" : "当前未配置，无法提交新任务" }
  ]} />;
  return <ConfigProvider theme={adminTheme}><div className="client-workspace-frame" style={bounded}>
    <header className="client-workspace-topbar" style={{ flexWrap: "wrap" }}><Link href="/client" className="auth-brand">AIJ<span>FOUNDATION</span></Link><Link href="/client/workspaces">管理空间</Link></header>
    <main className="client-workspace-main" style={bounded}>
      <PageHeading eyebrow="客户工作台 · 个人 Agent" title="运行与结果" description="核对当前版本，填写声明的字段，再确认执行。" actions={<Button loading={state.phase === "loading"} onClick={() => void store.refresh()}>重新验证访问</Button>} />
      <nav aria-label="运行导航"><Link href={`/client/agents${state.workspaceId ? `?workspaceId=${encodeURIComponent(state.workspaceId)}` : ""}`}>返回我的 Agent</Link></nav>
      <section className="client-workspace-picker" style={bounded} aria-labelledby="run-space-title"><div><label id="run-space-title" htmlFor="personal-run-space">当前空间</label><p>空间和 Agent 编号仅用于选择；访问权由服务端会话确认。</p></div>
        <Select id="personal-run-space" aria-label="选择运行空间" style={{ minWidth: 0, maxWidth: "100%" }} value={state.workspaceId || undefined} placeholder="选择已加入的空间" loading={state.phase === "loading"}
          options={state.workspaces.map(w => ({ value: w.workspace.id, label: `${w.workspace.name} · ${w.role.name}` }))} onChange={v => { store.dispose(); router.replace(`/client/agents/${encodeURIComponent(agentId)}/run?workspaceId=${encodeURIComponent(v)}`); }} /></section>
      {state.issue && <Alert role="alert" className="admin-error" showIcon type="error" title={state.issue.message} action={<Button onClick={() => void store.refresh()}>重新验证并查回</Button>} />}
      {state.phase === "loading" && <div role="status" className="auth-loading"><Spin /><span>正在确认会话、空间权限与原任务…</span></div>}
      {state.phase === "ready" && !state.workspaces.length && !state.issue && <Empty description="没有可访问的空间" />}
      {state.context && !canExecute && <Alert showIcon type="info" title="当前角色不能发起个人 Agent 任务" description="请联系空间管理员开通执行与个人 AI 资产读取权限。查看原任务还需要任务读取权限。" />}
      {state.context && <section className="admin-overview-section" style={bounded} aria-labelledby="original-run-title">
        <h2 id="original-run-title" tabIndex={-1} ref={resultHeading}>原任务与结果</h2>
        {state.journal ? <>
          <Tag>{statusText[state.journal.status] ?? "状态不可识别"}</Tag><p>原 Agent v{state.journal.revision}。恢复只读取原请求，不重新提交。</p>
          <Space wrap><Button disabled={state.busy || !canRead} loading={state.busy} onClick={() => void store.recover()}>按原标识查回结果</Button>
            {state.run && ["queued", "running"].includes(state.run.status) && (state.pollPaused ? <Button disabled={!canRead || state.busy} onClick={() => store.resumePolling()}>继续自动读取</Button> : <Button onClick={() => store.pausePolling()}>暂停自动读取</Button>)}</Space>
          {!canRead && <p>当前没有结果读取权限，请联系空间管理员。</p>}
          {state.polling && <p role="status">正在定时读取原任务，最多 40 次；可随时暂停。</p>}
          {state.journal.status === "unconfirmed" && <Alert showIcon type="warning" title="提交结果尚未确认" description="原请求可能仍在处理中。即使未查到记录，也不会换标识或自动重新提交，请稍后继续查回。" />}
          {currentRun?.status === "unknown" && <Alert showIcon type="warning" title="结果未知" description="上游可能已经执行，预算按服务端状态仍为预留。仅可核对原任务，不能发起重复任务；页面不承诺退款。" />}
          {currentRun?.status === "failed" && <Alert showIcon type="error" title="执行失败" description="服务端报告任务未完成。请检查配置和权限后，明确选择新任务。" />}
          {state.contentState === "expired" && <Alert showIcon type="warning" title="内容已过保留期" description="内容不能继续读取，原任务状态仍按服务端记录保留。" />}
          {state.contentState === "purged" && <Alert showIcon type="warning" title="内容已清理" description="服务端报告内容不可用，此页不会生成或补写结果。" />}
          {state.contentState === "unavailable" && <Alert type="info" title="当前没有可读取结果" description="请重新验证访问并继续按原标识查回。" />}
          {state.run?.status === "succeeded" && state.contentState === "available" && <section aria-label="Agent 原始结果"><h3>已完成 · 原始结果</h3><p>AI 生成内容，请核实后使用。</p><pre tabIndex={0} style={pre}>{typeof state.run.output === "string" ? state.run.output : JSON.stringify(state.run.output, null, 2)}</pre></section>}
          {safeTerminal && <><p>服务端已确认原任务终态。新任务会使用新的预览与请求标识，需要重新填写并确认。</p><Button disabled={state.busy || state.storageBlocked} onClick={() => void store.newTask()}>明确开始一个新任务</Button></>}
        </> : <p>尚无本 Agent 的恢复记录。填写下方参数以发起任务。</p>}
        <Typography.Paragraph type="secondary">暂停、切换空间或离开页面只停止本页读取，不会取消服务端执行，也不表示退款。恢复记录仅保存不透明标识与状态，输入和结果不写入浏览器存储。</Typography.Paragraph>
      </section>}
      {state.context && canExecute && <section className="admin-overview-section" style={bounded} aria-labelledby="run-preview-title">
        <div className="overview-section-heading" style={{ flexWrap: "wrap", gap: 12 }}><h2 id="run-preview-title">当前安全预览</h2><Button disabled={state.busy} onClick={() => void store.refreshPreview()}>重新读取预览并核对</Button></div>
        {state.previewIssue && <Alert role="alert" type="warning" showIcon title={state.previewIssue.message} />}
        {advisory}
        <p>模型预算上限仅供参考，不是用户价格、付款或退款承诺，也不保证任务准入。模型、目录、固定依赖和预算会在提交时重新校验；版本变化后需重新读取预览并核对。</p>
        <p>只有此 Agent 已明确获授且当前启用的记忆才可能由服务端应用；此页不读取全部记忆正文，也不保证自动学习。</p>
        {p && !p.modelExecutionConfigured && <Alert showIcon type="warning" title="模型执行当前未配置" description="不能发起新任务，已有授权结果仍可从原任务读取。" />}
        {p && <Form layout="vertical" autoComplete="off" onFinish={() => store.requestConfirmation()}>
          {p.inputFields.map(field => <Form.Item key={field} label={field} htmlFor={`run-field-${field}`} required extra="手动填写，最多 2,000 字符。"><Input.TextArea id={`run-field-${field}`} aria-label={field} autoComplete="off" rows={3} maxLength={2000} showCount disabled={!store.ready()} value={state.input[field] ?? ""} onChange={e => store.setInput(field, e.target.value)} /></Form.Item>)}
          <Button ref={reviewButton} type="primary" htmlType="submit" disabled={!store.ready()}>检查并确认执行</Button>
        </Form>}
      </section>}
    </main>
    {state.confirmation && p && <Modal open title="确认运行此版本 Agent" okText="确认提交一次" cancelText="返回检查" onCancel={() => { store.cancelConfirmation(); requestAnimationFrame(() => { if (store.getSnapshot().context === state.context) reviewButton.current?.focus(); }); }} onOk={() => { void store.confirmSubmit().then(() => { if (store.getSnapshot().context === state.context) resultHeading.current?.focus(); }); }} destroyOnHidden>
      <p>当前空间：{state.context?.workspaceName}</p>{advisory}<p>将发送已填写的 {p.inputFields.length} 个声明字段。预算估计仅是模型执行参考；服务端会重新校验权限、配置和预算。</p><p>只使用 Agent 当前明确获授且启用的记忆，不保证自动学习。提交后仅按原标识查回，不会自动重试提交。</p>
    </Modal>}
  </div></ConfigProvider>;
}
