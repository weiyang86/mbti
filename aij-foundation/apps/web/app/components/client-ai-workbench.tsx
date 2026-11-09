"use client";

import { createAiClient, createAiRunRecoveryClient } from "@aij/sdk";
import { PageHeading } from "@aij/ui";
import { Alert, Button, ConfigProvider, Descriptions, Empty, Form, Input, Select, Space, Spin, Tag, Typography } from "antd";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { adminTheme } from "./admin-api";
import { clientApi, ClientRequestFailure } from "./client-api.mjs";
import { ClientDocumentLink } from "./client-document-link";
import { createWorkbench, describeRun } from "./client-ai-workbench-state.mjs";

// SDK's JSON client cannot read binary content. Keep its Cookie, no-store and
// workspace header contract for the existing authenticated image endpoint.
async function requestImage(path: string, { workspaceId, signal }: { workspaceId: string; signal: AbortSignal }) {
  const base = process.env.NEXT_PUBLIC_API_URL;
  if (!base) throw new ClientRequestFailure(503);
  const response = await fetch(base + path, { credentials: "include", cache: "no-store", signal,
    headers: { "x-aij-workspace-id": workspaceId } });
  if (!response.ok) throw new ClientRequestFailure(response.status);
  return response.blob();
}

function ImageResult({ blob }: { blob: Blob }) {
  const image = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const node = image.current;
    const url = URL.createObjectURL(blob);
    if (node) node.src = url;
    return () => { node?.removeAttribute("src"); URL.revokeObjectURL(url); };
  }, [blob]);
  // Private Blob URLs must stay in the browser, outside Next's image optimizer.
  // eslint-disable-next-line @next/next/no-img-element
  return <img ref={image} alt="当前任务生成的图片" style={{ display: "block", maxWidth: "100%", maxHeight: 640, objectFit: "contain" }} />;
}

export function ClientAiWorkbench() {
  const router = useRouter();
  const [store] = useState(() => createWorkbench({ request: clientApi, aiClientFactory: createAiClient, aiRecoveryClientFactory: createAiRunRecoveryClient, requestImage,
    journalStorage: () => window.localStorage,
    withRecoveryLock: (name, fn) => {
      if (!navigator.locks) return Promise.reject(new Error("Recovery lock unavailable"));
      return navigator.locks.request(name, fn);
    },
    onUnauthorized: () => router.replace("/client/login") }));
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const [lookupId, setLookupId] = useState("");
  useEffect(() => {
    const preferred = new URL(window.location.href).searchParams.get("workspaceId") ?? "";
    void store.start(preferred);
    const leave = () => store.dispose();
    const resume = (event: PageTransitionEvent) => { if (event.persisted) void store.start(); };
    window.addEventListener("pagehide", leave);
    window.addEventListener("pageshow", resume);
    return () => { window.removeEventListener("pagehide", leave); window.removeEventListener("pageshow", resume); store.dispose(); };
  }, [store]);

  const canExecute = state.context?.permissions.includes("workspace.ai.execute") ?? false;
  const canRead = state.context?.permissions.includes("workspace.ai.read") ?? false;
  const agent = state.agents.find(item => item.code === state.agentCode);
  const display = state.run ? describeRun(state.run) : null;
  const locked = state.submitting || state.reading || (state.submissionUnconfirmed && !state.recoveryNeedsInput) || Boolean(state.run) || Boolean(state.recoveryReference) || Boolean(state.recovery?.runId) || state.recoveryBlocked;
  const reference = state.recoveryReference;
  const referenceDisplay = reference ? describeRun(reference) : null;
  const inputValid = agent && agent.inputFields.every(field => Boolean(state.input[field]?.trim()));
  const workspaceQuery = `workspaceId=${encodeURIComponent(state.workspaceId)}`;

  return <ConfigProvider theme={adminTheme}><div className="client-workspace-frame">
    <header className="client-workspace-topbar">
      <Link href="/client" className="auth-brand">AIJ<span>FOUNDATION</span></Link>
      <div className="client-topbar-identity"><span>{state.principal?.nickname || state.principal?.email || "客户账号"}</span><Link href="/client/workspaces">账号与空间</Link></div>
    </header>
    <main className="client-workspace-main">
      <PageHeading eyebrow="客户工作台" title="AI 任务" description="选择空间与 Agent，填写目标和参数，查看任务进度与结果。"
        actions={<Button onClick={() => void store.start()} disabled={state.submitting || state.submissionUnconfirmed} loading={state.phase === "loading"}>重新验证访问</Button>} />
      <nav aria-label="工作台导航"><Space wrap><Link href="/client/ai">AI 工作台</Link><Link href="/client/workspaces">管理空间</Link>
        {state.context?.permissions.includes("workspace.ai.assets.read") && <><Link href={`/client/skills?${workspaceQuery}`}>我的 Skill</Link><Link href={`/client/agents?${workspaceQuery}`}>我的 Agent</Link><Link href={`/client/memories?${workspaceQuery}`}>我的记忆</Link></>}
        {state.context && state.principal && <ClientDocumentLink workspaceId={state.workspaceId} memberId={state.principal.id} permissions={state.context.permissions} />}
        {state.context?.permissions.includes("workspace.knowledge.manage") && <Link href={`/client/knowledge?${workspaceQuery}`}>知识库</Link>}
        {state.context?.permissions.includes("workspace.knowledge.query") && <Link href={`/client/knowledge/questions?${workspaceQuery}`}>知识问答</Link>}
      </Space></nav>
      {state.issue && <Alert role="alert" className="admin-error" showIcon type={state.issue.kind === "service-unavailable" ? "warning" : "error"} title={state.issue.message} />}
      {state.context && state.recovery && <Alert showIcon type="warning" title={state.recovery.status === "unknown" ? "原任务结果未知，不能重新执行" : "此空间有待核对的原任务"}
        description={<Space orientation="vertical">
          {state.recovery.runId ? <Space wrap><Typography.Text copyable>{state.recovery.runId}</Typography.Text><Button disabled={!canRead || state.reading || state.submitting || reference?.contentAvailable === false} onClick={() => void store.readRun(state.recovery!.runId!)}>读取原任务</Button></Space> :
            <span>{state.recoveryNeedsInput ? "查回任务状态不需要原输入。也可重新填写完全相同的原参数，通过摘要校验后用原请求标识确认提交；不能新建标识。" : "确认提交会沿用原请求标识和参数。切换空间、重新验证或离开页面不会解除原任务的保护。"}</span>}
          {state.recovery.key && <Button disabled={!canRead || state.reading || state.submitting || state.imageLoading} loading={state.reading} onClick={() => void store.recoverRequest()}>查回原提交状态</Button>}
          <span>未查到不代表原提交未受理。结果未知或预算预留中时，即使内容已过期也不能开始新任务。</span>
        </Space>} />}
      <section className="client-workspace-picker" aria-labelledby="ai-workspace-title">
        <div><label id="ai-workspace-title" htmlFor="ai-workspace-select">当前空间</label><p>选择已加入的空间。每次操作仍由服务端验证成员关系和权限。</p></div>
        <Select id="ai-workspace-select" aria-label="选择 AI 任务空间" value={state.workspaceId || undefined} placeholder="选择空间" loading={state.phase === "loading"}
          options={state.workspaces.map(item => ({ value: item.workspace.id, label: `${item.workspace.name} · ${item.role.name}` }))}
          onChange={value => { setLookupId(""); void store.selectWorkspace(value); }} />
      </section>
      {state.phase === "loading" ? <div className="auth-loading" role="status"><Spin /><span>正在确认会话与空间权限…</span></div> : !state.workspaces.length && !state.issue ?
        <section className="client-empty-state"><Empty description="还没有可访问的空间" /><p>请联系空间管理员获得邀请。</p><Link href="/client/workspaces">查看空间</Link></section> : null}
      {state.phase === "ready" && state.context && <>
        <section className="client-context-card"><div><p className="auth-kicker">当前空间</p><h2>{state.context.workspaceName}</h2></div><Tag color="green">服务端已确认权限</Tag></section>
        {!canExecute && <Alert showIcon type="info" title="当前角色没有执行 AI 任务的权限。" description={canRead ? "可以使用任务编号读取自己在此空间的已有任务。" : "当前角色也没有读取 AI 任务的权限，请联系空间管理员。"} />}
        {canExecute && <section className="admin-overview-section" aria-labelledby="ai-compose-title">
          <h2 id="ai-compose-title">创建任务</h2>
          {!state.agents.length ? state.issue ? <p>当前未能读取 Agent 目录，请重新验证访问。</p> : <Empty description="暂无可用 Agent，等待配置" ><p>请管理员确认已发布 Agent 及其模型、厂商和 Skill 依赖。当前接口不提供空目录的具体原因。</p></Empty> :
            <Form layout="vertical" onFinish={() => void store.submit()}>
              <Form.Item label="Agent"><Select aria-label="选择 Agent" value={state.agentCode || undefined} disabled={locked || Boolean(state.recovery)}
                options={state.agents.map(item => ({ value: item.code, label: `${item.name} · ${item.capability === "image" ? "图片生成" : "文本"} · v${item.revision}` }))}
                onChange={value => store.selectAgent(value)} /></Form.Item>
              {agent?.inputFields.map((field, index) => <Form.Item key={`${agent.code}:${field}`} label={`${index === 0 ? "任务目标" : "参数"} · ${field}`} required>
                <Input.TextArea aria-label={`${index === 0 ? "任务目标" : "参数"} ${field}`} value={state.input[field] ?? ""} disabled={locked} maxLength={2000} showCount rows={index === 0 ? 4 : 2}
                  onChange={event => store.setInput(field, event.target.value)} placeholder={index === 0 ? "描述你希望此 Agent 完成的目标" : `请输入 ${field}`} />
              </Form.Item>)}
              {!state.run && !reference && <Button type="primary" htmlType="submit" loading={state.submitting} disabled={!inputValid || state.reading || Boolean(state.recovery?.runId) || state.recoveryBlocked || state.issue?.kind === "conflict"}>
                {state.submissionUnconfirmed ? "用原请求标识确认提交" : "提交任务"}
              </Button>}
              {state.submissionUnconfirmed && <p role="status">提交尚未确认，参数已锁定；确认提交会复用相同请求标识。切换空间或离开页面只会停止本地等待。</p>}
            </Form>}
          {!canRead && <Typography.Paragraph type="secondary">当前角色没有读取权限。提交响应可见，后续进度和结果需要 workspace.ai.read 权限。</Typography.Paragraph>}
        </section>}
        {reference && referenceDisplay && <section className="admin-overview-section" aria-labelledby="ai-reference-title" aria-live="polite">
          <h2 id="ai-reference-title">原任务状态</h2>
          <Alert showIcon type={referenceDisplay.tone} title={referenceDisplay.label} description="这是原任务的状态记录，未包含生成结果。" />
          <Descriptions column={1} size="small" items={[
            { key: "id", label: "任务编号", children: <Typography.Text copyable>{reference.id}</Typography.Text> },
            { key: "agent", label: "Agent", children: reference.agentCode },
            { key: "budget", label: "预算状态", children: ({ reserved: "预留中", settled: "已结算估价", released: "已释放" } as Record<string, string>)[reference.budgetStatus] },
            { key: "expires", label: "内容保留至", children: new Date(reference.expiresAt).toLocaleString("zh-CN") }
          ]} />
          {reference.contentAvailable ? <Button onClick={() => void store.readRun(reference.id)} disabled={!canRead} loading={state.reading}>读取原任务结果</Button> :
            <p role="status">任务内容当前不可读，缓存已清除。状态记录不会恢复已过期或清理的内容。</p>}
          {["succeeded", "failed"].includes(reference.status) && !state.recovery && !state.recoveryBlocked && canExecute &&
            <Button disabled={state.reading} onClick={() => store.newTask()}>开始新任务</Button>}
        </section>}
        {canRead && !state.submissionUnconfirmed && <section className="admin-overview-section" aria-labelledby="ai-lookup-title">
          <h2 id="ai-lookup-title">读取已有任务</h2><p>仅能读取自己在当前空间提交的任务。任务编号可在结果区域复制保存。</p>
          <Form layout="vertical" onFinish={() => void store.readRun(lookupId.trim())}>
            <Form.Item label="任务编号"><Input aria-label="已有任务编号" value={lookupId} onChange={event => setLookupId(event.target.value)} maxLength={128} disabled={state.submitting || state.reading} /></Form.Item>
            <Button htmlType="submit" loading={state.reading} disabled={!/^[A-Za-z0-9_-]{1,128}$/.test(lookupId.trim()) || state.submitting}>读取任务</Button>
          </Form>
        </section>}
        {state.run && display && <section className="admin-overview-section" aria-labelledby="ai-result-title" aria-live="polite" aria-busy={display.active && state.polling}>
          <div className="overview-section-heading"><h2 id="ai-result-title">任务结果</h2><Tag color={display.tone === "success" ? "green" : display.tone === "error" ? "red" : display.tone === "warning" ? "orange" : "blue"}>{display.label}</Tag></div>
          <Alert showIcon type={display.tone} title={display.message} />
          <Descriptions column={1} size="small" items={[
            { key: "id", label: "任务编号", children: <Typography.Text copyable>{state.run.id}</Typography.Text> },
            { key: "agent", label: "Agent", children: state.run.agentCode },
            { key: "budget", label: "预算状态", children: ({ reserved: "预留中", settled: "已结算估价", released: "已释放" } as Record<string, string>)[state.run.budgetStatus] },
            { key: "expires", label: "内容保留至", children: new Date(state.run.expiresAt).toLocaleString("zh-CN") },
            ...(state.run.failureCode ? [{ key: "failure", label: "任务状态码", children: state.run.failureCode }] : [])
          ]} />
          {state.contentUnavailable && <p role="status">此任务内容当前不可读，缓存已清除。只有新的有效读取结果才能恢复展示。</p>}
          {state.run.status === "succeeded" && !state.contentUnavailable && <>
            {state.run.imageAssetId ? <Space direction="vertical"><Button onClick={() => void store.readImage()} loading={state.imageLoading} disabled={!canRead}>读取图片结果</Button>{state.imageBlob && <ImageResult blob={state.imageBlob} />}</Space> :
              <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxHeight: 640, overflow: "auto" }}>{typeof state.run.output === "string" ? state.run.output : JSON.stringify(state.run.output, null, 2)}</pre>}
          </>}
          {state.pollPaused && <p role="status">已暂停自动查询。任务状态以服务端为准，可手动继续读取。</p>}
          {canRead && <Button onClick={() => void store.readRun()} loading={state.reading} disabled={state.imageLoading}>{state.polling ? "刷新进度" : "重新读取任务"}</Button>}
          {["succeeded", "failed"].includes(state.run.status) && canExecute && !state.recovery && !state.recoveryBlocked && <Button onClick={() => store.newTask()}>开始新任务</Button>}
        </section>}
        <Typography.Paragraph type="secondary">空间切换或离开页面会停止本地请求与轮询，已提交的服务端任务会继续处理。</Typography.Paragraph>
      </>}
    </main>
  </div></ConfigProvider>;
}
