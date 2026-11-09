"use client";

import { createPersonalScriptExecutionClient, createPersonalSkillsClient } from "@aij/sdk";
import type { ClientApi } from "@aij/sdk";
import { PageHeading } from "@aij/ui";
import { Alert, Button, ConfigProvider, Descriptions, Form, Input, Modal, Space, Tag, Typography } from "antd";
import { useEffect, useId, useLayoutEffect, useState, useSyncExternalStore } from "react";
import { adminTheme } from "./admin-api";
import { createPersonalScriptState, samePersonalScriptScope, validPersonalScriptSource } from "./client-personal-script-state.mjs";
import type { PersonalScriptScope } from "./client-personal-script-state.mjs";

const preStyle = { whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxHeight: 400, overflow: "auto" } as const;
const capabilityText = { ready: "执行已配置 · 当前允许提交", not_configured: "执行未配置 · 不能提交", not_permitted: "当前角色不能执行" };
const allows = (permissions: string[] | undefined, required: string[]) => required.every(p => permissions?.includes(p));
const scriptId = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);

/** Keep this component mounted when the parent is busy, editing or showing
 * history. Pass scope=null; a key/unmount would discard the RAM-only write lock. */
export function ClientPersonalScriptPanel({ request, scope, onSkillChanged }: {
  request: ClientApi; scope: PersonalScriptScope | null; onSkillChanged: () => void;
}) {
  const [store] = useState(() => createPersonalScriptState({ request, scriptsClientFactory: createPersonalScriptExecutionClient,
    skillsClientFactory: createPersonalSkillsClient, onSkillChanged }));
  useEffect(() => { store.setOnSkillChanged(onSkillChanged); }, [store, onSkillChanged]);
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const panelId = useId();
  useLayoutEffect(() => {
    store.setRequest(request);
    const resume = () => { if (document.visibilityState === "visible" && document.hasFocus()) store.setScope(scope); };
    const leave = () => store.suspend();
    const visibility = () => { if (document.visibilityState === "hidden") leave(); else resume(); };
    resume();
    window.addEventListener("blur", leave);
    window.addEventListener("pagehide", leave);
    window.addEventListener("focus", resume);
    window.addEventListener("pageshow", resume);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("blur", leave); window.removeEventListener("pagehide", leave);
      window.removeEventListener("focus", resume); window.removeEventListener("pageshow", resume);
      document.removeEventListener("visibilitychange", visibility); store.suspend();
    };
  }, [store, request, scope]);
  // Hide the previous scope synchronously, before effect cleanup can run.
  const active = Boolean(scope && samePersonalScriptScope(scope, state.scope));
  const canSource = active && allows(state.auth?.permissions, ["workspace.ai.assets.read", "workspace.ai.scripts.manage"]);
  const canExecute = active && allows(state.auth?.permissions, ["workspace.ai.assets.read", "workspace.ai.execute", "workspace.ai.scripts.execute"]);
  const canRead = active && allows(state.auth?.permissions, ["workspace.ai.assets.read", "workspace.ai.read", "workspace.ai.scripts.execute"]);
  const revalidate = () => { if (document.visibilityState === "visible" && document.hasFocus()) { store.setScope(scope); void store.refresh(); } };
  const saveResult = async () => {
    // Each download click performs the original bounded SDK read and current
    // authorization checks. Do not expose an old Blob URL as an unchecked link.
    await store.download();
    const file = store.getSnapshot().download;
    if (!file || document.visibilityState !== "visible" || !document.hasFocus()) return;
    const link = document.createElement("a");
    link.href = file.url; link.download = file.filename;
    document.body.appendChild(link); link.click(); link.remove();
  };

  return <ConfigProvider theme={adminTheme}><section className="admin-overview-section" aria-label="个人 Python Skill 执行" aria-busy={active && state.busy}>
    <PageHeading eyebrow="私有 Skill" title="Python 执行" description="手动保存不可变源码版本，再明确提交一次 JSON 输入。"
      actions={<Button disabled={!scope || active && state.busy} loading={active && state.busy} onClick={revalidate}>重新验证访问</Button>} />
    <Typography.Paragraph type="secondary">仅处理当前账号与空间的当前 Skill。本页的源码草稿、输入草稿和结果预览仅留在内存，失焦或切换后清除；已确认保存的源码版本和已提交执行按服务端策略保留。执行不开放网络、工具、输入文件或额外依赖包。</Typography.Paragraph>
    {state.issue && <Alert role="alert" type="warning" showIcon title={state.issue.message} />}
    {state.notice && <Alert role="status" type="info" showIcon title={state.notice} />}
    {state.locked && <Alert role="status" type="warning" showIcon title="原写入仍锁定，不能创建新版本或重复执行"
      description="只保留不透明原标识。切换、清空或重新验证不会重试 POST 或解除锁定；请回到原账号、空间与 Skill 核对。关闭整个页面将丢失内存中的恢复标识。" />}
    {!active && <Typography.Paragraph>请打开已保存的当前 Skill，并重新验证访问；编辑、历史预览或页面失焦时不显示私有内容。</Typography.Paragraph>}
    {active && <>
      {state.capability ? <Tag color={state.capability.reason === "ready" ? "success" : "warning"}>{capabilityText[state.capability.reason]}</Tag> : <p role="status">尚未确认当前执行能力，请先验证访问。</p>}
      {state.capability?.configured === false && <p>未配置时不能提交执行；当前获授权的已有结果仍可手动读取。</p>}
      {state.pending?.kind === "version" && <Space orientation="vertical">
        <p>版本创建结果未确认。服务没有版本请求键恢复接口，请先读取原 Skill 当前版本。</p>
        <Button disabled={state.busy} onClick={() => void store.reviewVersionWrite()}>读取原 Skill 当前版本</Button>
        {state.versionReview && <><p>刚核对的当前版本为 v{state.versionReview.revision}。这不能证明之前的创建没有生效，也无法取回缺失的源码引用。确认后需重新读取 Skill，自行决定后续操作。</p>
          <Button disabled={state.busy} onClick={() => void store.acknowledgeVersionWrite()}>我已核对当前版本，明确结束此次核对</Button></>}
      </Space>}
      <Form layout="vertical" autoComplete="off" onFinish={() => store.requestConfirmation("version")}>
        <Form.Item label="Python 源码" htmlFor={`${panelId}-source`} extra="手动输入 UTF-8 源码，最多 64KiB；保存会追加一个 Skill 版本，不会执行。">
          <Input.TextArea id={`${panelId}-source`} aria-label="Python 源码" autoComplete="off" spellCheck={false} rows={8} maxLength={65536}
            value={state.source} disabled={!store.canCreate()} onChange={e => store.setField("source", e.target.value)} />
        </Form.Item>
        <Button htmlType="submit" disabled={!store.canCreate() || !validPersonalScriptSource(state.source)}>检查并创建不可变版本</Button>
      </Form>
      <Form layout="vertical" autoComplete="off" onFinish={() => void store.readVersion()}>
        <Form.Item label="已有 Python 版本 ID" htmlFor={`${panelId}-version`} extra="仅当前 Skill 的当前版本可执行。只具执行权限时可填写已知 ID；由服务端核对，不读取源码。">
          <Input id={`${panelId}-version`} aria-label="Python 版本 ID" autoComplete="off" maxLength={36} value={state.versionId} disabled={state.busy || !(canSource || canExecute)} onChange={e => store.setField("versionId", e.target.value)} />
        </Form.Item>
        <Button htmlType="submit" disabled={state.busy || !canSource || !scriptId(state.versionId)}>读取并核对原版本</Button>
      </Form>
      {state.ref && <Descriptions column={1} size="small" items={[
        { key: "version", label: "Python 版本引用", children: <code style={preStyle}>{state.ref.scriptVersionId}</code> },
        { key: "skill", label: "Skill 版本", children: <span>v{state.ref.revision} · {state.ref.skillVersionId}</span> },
        { key: "digest", label: "源码 SHA256", children: <code style={preStyle}>{state.ref.scriptDigest}</code> },
        { key: "policy", label: "策略 SHA256", children: <code style={preStyle}>{state.ref.policyDigest}</code> }
      ]} />}
      <Form layout="vertical" autoComplete="off" onFinish={() => store.requestConfirmation("run")}>
        <Form.Item label="JSON 输入" htmlFor={`${panelId}-input`} extra="严格 JSON，最多 16KiB；拒绝重复键、非有限数、原型键和过深内容。请手动填写。">
          <Input.TextArea id={`${panelId}-input`} aria-label="执行 JSON 输入" autoComplete="off" spellCheck={false} rows={5} maxLength={16384}
            value={state.input} disabled={!store.canSubmit()} onChange={e => store.setField("input", e.target.value)} />
        </Form.Item>
        <Button type="primary" htmlType="submit" disabled={!store.canSubmit() || !state.input.trim()}>检查并确认执行</Button>
      </Form>
      {state.pending?.kind === "run" && <Space orientation="vertical">
        <p>原请求键：<code>{state.pending.key}</code>{state.pending.runId && <> · 原执行 ID：<code>{state.pending.runId}</code></>}</p>
        <Button disabled={state.busy || !canRead} onClick={() => void store.recover()}>GET 查回原请求</Button>
      </Space>}
      <Form layout="vertical" autoComplete="off" onFinish={() => void store.readRun()}>
        <Form.Item label="已有执行 ID" htmlFor={`${panelId}-run`} extra="手动读取一次，不轮询、不重新提交。">
          <Input id={`${panelId}-run`} aria-label="已有执行 ID" autoComplete="off" maxLength={36} value={state.runId} disabled={state.busy || !canRead} onChange={e => store.setField("runId", e.target.value)} />
        </Form.Item>
        <Button htmlType="submit" disabled={state.busy || !canRead || !scriptId(state.runId)}>读取原执行状态</Button>
      </Form>
      {state.run && <section aria-label="原执行结果">
        <p><Tag>{state.run.jobStatus}</Tag><Tag>{state.run.outcome ?? "结果尚未确认"}</Tag>原执行 ID：<code>{state.run.id}</code></p>
        <p>Python v{state.run.script.revision} · 源码 SHA256：<code style={preStyle}>{state.run.script.scriptDigest}</code></p>
        <p>结果保留至 {new Date(state.run.expiresAt).toLocaleString("zh-CN")}；以服务端当前状态为准。</p>
        {["UNKNOWN", "CLEANUP_UNCONFIRMED"].includes(state.run.outcome ?? "") && <Alert type="warning" showIcon title="结果或清理未确认，请继续核对原请求；不能通过新键重放。" />}
        <Space wrap>
          <Button disabled={state.busy || !canRead || state.run.outcome !== "SUCCESS"} onClick={() => void saveResult()}>下载并查看成功结果</Button>
          {store.canResolveRun() && <Button disabled={state.busy || !canRead} onClick={() => void store.resolveRun()}>核对终态并明确结束原请求</Button>}
        </Space>
        {state.output && <><p>脚本原始 JSON 结果，请核实后使用。</p><pre tabIndex={0} style={preStyle}>{state.output}</pre></>}
      </section>}
      {!canSource && <p>读取源码需要资产读取与脚本管理权限；创建版本还需要资产管理权限。</p>}
      {!canRead && <p>读取结果需要资产读取、AI 读取与脚本执行权限；提交还需要 AI 执行权限。请联系空间管理员。</p>}
    </>}
    {active && state.confirmation !== null && <Modal open title={state.confirmation === "version" ? "确认创建一个不可变 Python 版本" : "确认提交一次 Python 执行"}
      okText={state.confirmation === "version" ? "确认创建一次" : "确认提交一次"} cancelText="返回检查" destroyOnHidden
      onCancel={() => store.cancelConfirmation()} onOk={() => void (state.confirmation === "version" ? store.confirmVersion() : store.confirmSubmit())}>
      <p>将使用当前 Skill v{active ? state.scope?.revision : ""}，提交前后都会重新核对会话、空间、角色与当前版本。</p>
      <p>请求中断后不会自动重试。原写入未确认时，必须先核对原请求。</p>
    </Modal>}
  </section></ConfigProvider>;
}
