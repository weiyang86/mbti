"use client";

import { createPersonalWorkflowExecutionClient, createPersonalWorkflowsClient } from "@aij/sdk";
import type { ClientApi, WorkflowRef } from "@aij/sdk";
import { PageHeading } from "@aij/ui";
import { Alert, Button, ConfigProvider, Descriptions, Form, Input, Modal, Space, Tag, Typography } from "antd";
import { useEffect, useId, useLayoutEffect, useState, useSyncExternalStore } from "react";
import { adminTheme } from "./admin-api";
import { createWorkflowExecutionState, sameWorkflowExecutionScope } from "./client-workflow-execution-state.mjs";
import type { WorkflowExecutionScope } from "./client-workflow-execution-state.mjs";

const bounded = { minWidth: 0, maxWidth: "100%", overflowWrap: "anywhere" } as const;
const pre = { ...bounded, whiteSpace: "pre-wrap", maxHeight: 400, overflow: "auto" } as const;
const allows = (permissions: string[] | undefined, required: string[]) => required.every(p => permissions?.includes(p));
const reasons = { ready: "依赖已就绪", not_published: "尚未发布", revision_changed: "草稿已有新版本", dependencies_unavailable: "固定依赖当前不可用", validator_unavailable: "依赖校验暂不可用" };
// Same exact decimal presentation as the existing personal Agent execution page.
function budgetUnits(value: string) {
  const nanos = BigInt(value), denominator = BigInt(1000000000), whole = nanos / denominator;
  const fraction = (nanos % denominator).toString().padStart(9, "0").replace(/0+$/, "");
  return whole.toString() + (fraction ? "." + fraction : "");
}
function PublicationReference({ value }: { value: WorkflowRef }) {
  return <Descriptions column={1} size="small" items={[
    { key: "id", label: "原发布引用", children: <code style={bounded}>{value.id}</code> },
    { key: "workflow", label: "工作流固定版本", children: <span>v{value.revision} · {value.workflowVersionId} · 发布纪元 {value.publicationEpoch}</span> },
    { key: "digest", label: "图 SHA256", children: <code style={bounded}>{value.graphDigest}</code> },
    { key: "agent", label: "原 Agent 固定引用", children: <span>{value.nodeId} · {value.agentId} · v{value.agentRevision} · {value.agentVersionId} · 发布纪元 {value.agentPublicationEpoch}</span> }
  ]} />;
}

/** Parent must ALWAYS mount one instance, without a key. Pass null while editing/loading/history. */
export function ClientWorkflowExecutionPanel({ request, scope, onWorkflowChanged, onScopeRejected }: {
  request: ClientApi; scope: WorkflowExecutionScope | null; onWorkflowChanged: () => void; onScopeRejected?: () => void;
}) {
  const [store] = useState(() => createWorkflowExecutionState({ request, executionClientFactory: createPersonalWorkflowExecutionClient,
    workflowsClientFactory: createPersonalWorkflowsClient, onWorkflowChanged, onScopeRejected }));
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot), id = useId();
  useEffect(() => { store.setOnWorkflowChanged(onWorkflowChanged); }, [store, onWorkflowChanged]);
  useLayoutEffect(() => { store.setOnScopeRejected(onScopeRejected); }, [store, onScopeRejected]);
  useLayoutEffect(() => {
    store.setRequest(request);
    const resume = () => { if (document.visibilityState === "visible" && document.hasFocus()) store.setScope(scope); };
    const leave = () => store.suspend();
    const visibility = () => { if (document.visibilityState === "hidden") leave(); else resume(); };
    resume();
    window.addEventListener("blur", leave); window.addEventListener("pagehide", leave);
    window.addEventListener("focus", resume); window.addEventListener("pageshow", resume);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("blur", leave); window.removeEventListener("pagehide", leave);
      window.removeEventListener("focus", resume); window.removeEventListener("pageshow", resume);
      document.removeEventListener("visibilitychange", visibility); store.suspend();
    };
  }, [store, request, scope]);
  // The old scope is hidden during render, before the layout-effect cleanup.
  const active = Boolean(scope && sameWorkflowExecutionScope(scope, state.scope));
  const canRead = active && allows(state.auth?.permissions, ["workspace.ai.assets.read", "workspace.ai.read", "workspace.ai.workflows.execute"]);
  const canExecute = active && allows(state.auth?.permissions, ["workspace.ai.assets.read", "workspace.ai.execute", "workspace.ai.workflows.execute"]);
  const canManage = active && allows(state.auth?.permissions, ["workspace.ai.assets.manage", "workspace.ai.workflows.publish"]);
  const readPublication = () => {
    if (document.visibilityState === "visible" && document.hasFocus()) { store.setScope(scope); void store.readPublication(); }
  };
  const verifyResultAccess = () => {
    if (document.visibilityState === "visible" && document.hasFocus()) { store.setScope(scope); void store.verifyAccess(); }
  };
  const run = state.result?.run, recovery = state.recovery?.request;
  return <ConfigProvider theme={adminTheme}><section className="admin-overview-section" aria-label="个人工作流发布与手动执行" aria-busy={active && state.busy} style={bounded}>
    <PageHeading eyebrow="私有工作流" title="发布与手动执行" description="核对当前发布，预览批准的输入，再明确提交一次。"
      actions={<Button disabled={!scope || active && state.busy} loading={active && state.busy} onClick={readPublication}>读取当前发布并验证访问</Button>} />
    <Typography.Paragraph type="secondary">目前仅支持“开始 → 一个 Agent → 结束”的可执行发布。多步骤、条件、并行、循环和审批草稿继续完整保留，结构有效不表示可执行。所有操作以服务端当前权限和固定依赖校验为准。</Typography.Paragraph>
    {state.issue && <Alert role="alert" type="warning" showIcon title={state.issue.message} />}
    {active && state.notice && <Alert role="status" type="info" showIcon title={state.notice} />}
    {state.locked && <Alert role="status" type="warning" showIcon title="原写入仍锁定，不能发起新写入"
      description="恢复原账号、空间和工作流后核对。失焦、隐藏、编辑或切换会清除私有内容并保留原不透明恢复标识；关闭整个页面会丢失内存标识。不会自动重试或换新键重放。" />}
    {!active && <p>请打开已保存的当前工作流；加载、编辑、确认、历史预览或失焦时清除私有内容。</p>}
    <Space wrap style={{ marginBlock: 16 }}><Button disabled={!scope || active && state.busy} onClick={verifyResultAccess}>仅验证已有执行的读取访问</Button><Typography.Text type="secondary">发布或预览服务不可用时，也可单独验证后尝试读取已有结果。</Typography.Text></Space>
    {active && <>
      {!state.auth && <p role="status">请先明确读取当前发布并验证访问。</p>}
      {state.publication && <section aria-label="当前发布状态" style={bounded}>
        <Space wrap><Tag>当前草稿 v{state.publication.revision}</Tag><Tag>{state.publication.publishedRevision === null ? "未发布" : `已发布 v${state.publication.publishedRevision}`}</Tag><Tag>{reasons[state.publication.dependencyReadiness.reason]}</Tag></Space>
        {state.publication.publication && <PublicationReference value={state.publication.publication} />}
        {!state.singleAgent && <Alert type="info" showIcon title="当前草稿不属于单 Agent 执行范围" description="请保留原图；本页不会裁剪、改写或自动发布复杂草稿。已有授权执行仍可手动读取。" />}
        <Space wrap style={{ marginBlock: 16 }}>
          <Button disabled={!store.canPublish()} onClick={() => store.requestConfirmation("publish")}>检查并确认发布当前版本</Button>
          <Button disabled={!store.canUnpublish()} onClick={() => store.requestConfirmation("unpublish")}>检查并确认取消发布</Button>
          <Button disabled={state.busy || state.locked || !canExecute || !state.publication.publication || !state.publication.dependencyReadiness.ready} onClick={() => void store.preview()}>预览当前发布的执行条件</Button>
        </Space>
      </section>}
      {state.pending?.kind === "publication" && <Space orientation="vertical" style={bounded}>
        <p>发布写入结果未确认。先读取实际发布和当前草稿，再分别明确确认结束核对；此操作不会补发 POST。</p>
        <Button disabled={state.busy || !canManage} onClick={() => void store.reviewPublicationWrite()}>核对原工作流实际发布状态</Button>
        {state.review && <><p>已核对当前 v{state.review.revision} · 发布纪元 {state.review.publicationEpoch} · {state.review.publishedRevision === null ? "未发布" : `发布 v${state.review.publishedRevision}`}。这不能证明原写入未生效。</p>
          <Button disabled={state.busy || !canManage} onClick={() => void store.acknowledgePublicationWrite()}>我已核对，明确结束此次发布核对</Button></>}
      </Space>}
      {state.preview && <section aria-label="执行条件预览" style={bounded}>
        <h3>本次执行条件</h3><PublicationReference value={state.preview.publication} />
        <p>批准的输入键：{state.preview.inputFields.length ? state.preview.inputFields.join("、") : "无（请手动输入 {}）"}</p>
        <p>预算估计上限：{budgetUnits(state.preview.maximumEstimatedCostNanos)} 模型预算单位。估计不代表实际费用。</p>
        <Alert showIcon type={state.preview.modelExecutionConfigured ? "info" : "warning"} title={state.preview.modelExecutionConfigured ? "模型执行已配置，仍以提交时校验为准" : "模型执行未配置，不能提交新执行；已有授权结果仍可手动尝试读取"} />
      </section>}
      <Form layout="vertical" autoComplete="off" onFinish={() => store.requestConfirmation("run")} style={bounded}>
        <Form.Item label="手动填写 JSON 输入" htmlFor={`${id}-input`} extra="严格平面字符串对象，必须恰好包含批准的键；最多 20 键、每值 2000 字、总计 64KiB。拒绝重复键、未知键、空值与嵌套对象。">
          <Input.TextArea id={`${id}-input`} aria-label="工作流执行 JSON 输入" autoComplete="off" spellCheck={false} rows={5} maxLength={65536}
            value={state.input} disabled={!store.canSubmit()} onChange={e => store.setField("input", e.target.value)} />
        </Form.Item>
        <Button type="primary" htmlType="submit" disabled={!store.canSubmit() || !state.input.trim()}>检查并确认执行一次</Button>
      </Form>
      {state.pending?.kind === "run" && <Space orientation="vertical" style={bounded}>
        <p>原请求键：<code style={bounded}>{state.pending.key}</code> · 原发布 ID：<code style={bounded}>{state.pending.publicationId}</code></p>
        <Button disabled={state.busy || !canRead} onClick={() => void store.recover()}>GET 查回原请求（同键）</Button>
      </Space>}
      <Form layout="vertical" autoComplete="off" onFinish={() => void store.readRun()} style={{ marginTop: 24 }}>
        <Form.Item label="已有执行 ID" htmlFor={`${id}-run`} extra="单独的结果读取权限；不需要预览、新执行权限或已配置的模型。每次只读取一次，不轮询。">
          <Input id={`${id}-run`} aria-label="已有工作流执行 ID" autoComplete="off" maxLength={128} value={state.runId} disabled={state.busy || !canRead} onChange={e => store.setField("runId", e.target.value)} />
        </Form.Item>
        <Button htmlType="submit" disabled={state.busy || !canRead || !state.runId}>读取原执行状态与结果</Button>
      </Form>
      {state.recovery && recovery && <section aria-label="原键恢复状态" style={bounded}>
        <h3>原键 GET 状态</h3><PublicationReference value={state.recovery.origin} />
        <p>原执行：<code>{recovery.id}</code> · {recovery.status} · 预算 {recovery.budgetStatus} · {recovery.contentAvailable ? "内容当前可读取" : "内容当前不可读取"}</p>
        <p>只有 succeeded、failed、cancelled 且预算 settled 或 released 才能结束；unknown 或 reserved 继续锁定。</p>
        <Button disabled={!store.canResolveRun()} onClick={() => void store.resolveRun()}>核对终态并明确结束原请求</Button>
      </section>}
      {state.result && run && <section aria-label="原执行结果" style={bounded}>
        <h3>原执行结果</h3><PublicationReference value={state.result.origin} />
        <p>执行 ID：<code>{run.id}</code> · 状态 {run.status} · 预算 {run.budgetStatus}</p>
        <p>原执行费用估计：{budgetUnits(run.estimatedCostNanos)} 模型预算单位；实际用量与实际费用未报告，不作推算。</p>
        {run.failureCode && <p>原失败码：{run.failureCode}</p>}
        {run.status === "unknown" && <Alert type="warning" showIcon title="结果未知，请用原键 GET 核对；不能通过新键重放" />}
        <p>AI 生成内容，请核实后使用。结果保留至 {run.expiresAt}，以服务端当前状态为准。</p>
        <pre tabIndex={0} aria-label="AI 原始输出" style={pre}>{JSON.stringify(run.output, null, 2)}</pre>
      </section>}
      {state.auth && !canRead && <p>读取已有结果需要资产读取、AI 读取和工作流执行权限。请联系空间管理员。</p>}
    </>}
    {active && state.confirmation && <Modal open title={state.confirmation === "run" ? "确认手动执行一次" : state.confirmation === "publish" ? "确认发布当前单 Agent 版本" : "确认取消当前发布"}
      okText={state.confirmation === "run" ? "确认提交一次" : "确认此次发布操作"} cancelText="返回检查" keyboard destroyOnHidden
      onCancel={() => store.cancelConfirmation()} onOk={() => void (state.confirmation === "run" ? store.confirmSubmit() : store.confirmPublication())}>
      <p>当前工作流 v{state.scope?.revision} · 发布纪元 {state.publication?.publicationEpoch}。操作前后核对实际会话、角色、权限和当前草稿。</p>
      <p>{state.confirmation === "run" ? "使用刚预览的原发布和手动输入，只提交一次并保留一个原请求键。" : "使用当前版本与发布纪元作并发校验，不修改草稿、不启用其他资源。"}</p>
      <p>取消不会写入；请求中断不会自动重试，必须核对原写入。</p>
    </Modal>}
  </section></ConfigProvider>;
}
