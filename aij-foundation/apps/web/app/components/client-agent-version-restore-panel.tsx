"use client";

import { createPersonalAgentsClient, createPersonalAgentPublicationsClient } from "@aij/sdk";
import type { ClientApi, PersonalAgentVersion } from "@aij/sdk";
import { Alert, Button, ConfigProvider, Descriptions, Empty, Modal, Space, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { adminTheme } from "./admin-api";
import { agentRestoreDifferences, createAgentVersionRestore } from "./client-agent-version-restore-state.mjs";
import type { AgentVersionRestoreScope } from "./client-agent-version-restore-state.mjs";

export type ClientAgentVersionRestorePanelProps = { request: ClientApi; scope: AgentVersionRestoreScope | null; onAgentChanged: () => void; onScopeRejected?: () => void };
const boundedStyle = { minWidth: 0, maxWidth: "100%", overflowWrap: "anywhere" } as const;
const labels: Record<string, string> = { name: "名称", instructions: "指令", enabled: "配置启用", modelCode: "模型编号", modelRevision: "模型固定版本", catalogVersion: "模型目录版本", inputFields: "输入字段", outputFormat: "输出格式", outputFields: "输出字段", skillBindings: "按顺序固定的 Skill" };
function display(value: unknown) {
  if (typeof value === "boolean") return value ? "是" : "否";
  if (typeof value === "string" || typeof value === "number") return String(value);
  return JSON.stringify(value, null, 2);
}
function ComparisonValue({ label, value }: { label: string; value: unknown }) {
  return <div style={boundedStyle}><strong>{label}</strong><pre tabIndex={0} aria-label={label} style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxHeight: 240, overflow: "auto", marginBlock: 8 }}>{display(value)}</pre></div>;
}

/** Root must keep this single instance mounted, including while scope is null. */
export function ClientAgentVersionRestorePanel({ request, scope, onAgentChanged, onScopeRejected }: ClientAgentVersionRestorePanelProps) {
  const trigger = useRef<React.ComponentRef<typeof Button>>(null);
  const pendingFocus = useRef<string | null>(null);
  const titleId = useId();
  const [store] = useState(() => createAgentVersionRestore({
    request, agentsClientFactory: createPersonalAgentsClient,
    publicationsClientFactory: createPersonalAgentPublicationsClient, onAgentChanged, onScopeRejected,
    isActive: () => !document.hidden && document.hasFocus()
  }));
  useLayoutEffect(() => { store.setCallbacks({ request, onAgentChanged, onScopeRejected }); }, [store, request, onAgentChanged, onScopeRejected]);
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const memberId = scope?.memberId, workspaceId = scope?.workspaceId, agentId = scope?.agentId, revision = scope?.revision;
  useLayoutEffect(() => {
    store.setScope(memberId && workspaceId && agentId && revision ? { memberId, workspaceId, agentId, revision } : null);
  }, [store, memberId, workspaceId, agentId, revision]);
  useEffect(() => {
    const clear = () => store.suspend();
    const visibility = () => { if (document.hidden) clear(); };
    window.addEventListener("blur", clear); window.addEventListener("pagehide", clear); document.addEventListener("visibilitychange", visibility);
    return () => { window.removeEventListener("blur", clear); window.removeEventListener("pagehide", clear); document.removeEventListener("visibilitychange", visibility); store.dispose(); };
  }, [store]);
  const columns: ColumnsType<PersonalAgentVersion> = [
    { title: "不可变版本", dataIndex: "revision", render: v => `v${v}` },
    { title: "保存时间", dataIndex: "createdAt", render: v => new Date(v).toLocaleString("zh-CN") },
    { title: "操作", key: "select", render: (_, v) => <Button disabled={state.busy || state.locked || v.revision >= (revision ?? 0)} aria-label={`比较 Agent 历史版本 v${v.revision}`} onClick={() => void store.selectVersion(v.id)}>比较此版本</Button> }
  ];
  // A changed/null prop hides private data immediately; the layout effect fences
  // the controller before paint, even if an older transport ignores its signal.
  const readable = Boolean(scope && state.head?.id === agentId && state.head?.revision === revision);
  const scopeKey = JSON.stringify([memberId, workspaceId, agentId, revision]);
  useLayoutEffect(() => {
    const target = pendingFocus.current;
    pendingFocus.current = null;
    if (target === scopeKey && readable && !state.confirmation && !state.busy && !state.locked && !document.hidden && document.hasFocus()) trigger.current?.focus();
  }, [scopeKey, readable, state.confirmation, state.busy, state.locked]);
  const selected = readable ? state.selected : null;
  const modelCurrent = selected && state.models?.catalogVersion === selected.catalogVersion && state.models.items.some(m => m.code === selected.modelCode && m.revision === selected.modelRevision);
  if (!scope && !state.locked) return null;
  return <ConfigProvider theme={adminTheme}><section className="admin-overview-section" style={boundedStyle} aria-labelledby={titleId} aria-busy={state.busy}>
    <h3 id={titleId}>从历史配置创建新版本</h3>
    <p>历史只读预览不会恢复。确认后将原模型、目录和 Skill 固定版本按原值保存为新版本，配置关闭且未发布；历史版本和已有 Run 引用保留。</p>
    {state.issue && <Alert role="alert" showIcon type="warning" title={state.issue.message} />}
    {state.notice && <Alert role="status" showIcon type="success" title={state.notice} />}
    {state.locked && <Alert showIcon type="warning" title="前次恢复结果尚未确认，恢复操作已锁定" description="请回到原账号、原空间和原 Agent，明确读取当前配置与发布状态，再单独确认已核对。页面不会自动重试 PATCH。" />}
    {scope && <Space wrap>
      <Button disabled={state.busy || state.locked} loading={state.busy && !state.locked} onClick={() => void store.loadHistory()}>验证并读取历史配置</Button>
      {state.locked && <Button disabled={state.busy} onClick={() => void store.readRecovery()}>读取前次恢复的当前状态</Button>}
    </Space>}
    {state.recovery && scope && <><Descriptions column={1} size="small" items={[
      { key: "revision", label: "当前版本", children: `v${state.recovery.revision}` },
      { key: "enabled", label: "当前配置启用", children: state.recovery.enabled ? "是" : "否" },
      { key: "published", label: "当前已发布", children: state.recovery.published ? "是" : "否" },
      { key: "publicationVersion", label: "发布状态版本", children: state.recovery.publicationVersion }
    ]} /><p>当前读取不能单独证明前次请求是否提交成功。核对后只解除恢复锁，不会重发前次写入。</p>
      <Button disabled={state.busy || !state.canManage} onClick={() => void store.acknowledgeRecovery()}>已核对当前状态，解除恢复锁</Button></>}
    {readable && !state.locked && <>
      {!state.canManage && <Alert showIcon type="info" title="当前角色只读" description="可以比较自己的历史配置；恢复需要资产读取和管理权限。" />}
      <Table<PersonalAgentVersion> rowKey="id" columns={columns} dataSource={state.versions} pagination={false} scroll={{ x: 480 }} locale={{ emptyText: <Empty description="当前页没有可读取的历史版本" /> }} />
      <Button disabled={state.busy || !state.nextCursor} onClick={() => void store.loadHistory(true)}>读取更早版本</Button>
      {selected && <section aria-label="当前配置与历史配置比较" style={boundedStyle}>
        <h4>当前 v{state.head?.revision} 与历史 v{selected.revision}</h4>
        <Descriptions column={1} size="small" items={[
          { key: "model", label: "历史模型固定引用", children: `${selected.modelCode} · v${selected.modelRevision} · 目录 v${selected.catalogVersion}` },
          { key: "pins", label: "历史 Skill 不可变引用", children: selected.skillBindings.length ? <ol>{selected.skillBindings.map(pin => <li key={pin.skillId} style={boundedStyle}>{pin.skillId} · 固定 v{pin.revision} · 版本 ID {pin.skillVersionId}</li>)}</ol> : "未绑定 Skill" }
        ]} />
        {!modelCurrent && <Alert showIcon type="warning" title="历史模型或目录与当前可用选项不匹配" description="保留原引用供查看，不自动替换为最新版本。内容需要变化时不能恢复，请联系管理员核对依赖。" />}
        <p>保存时服务端重新验证当前模型目录，以及仍属于自己的、未删除的提示词 Skill 固定版本；可执行 Skill 或不可用依赖会拒绝保存，不会忽略绑定。</p>
        {state.head && agentRestoreDifferences(state.head, selected).map(item => <section key={item.field} style={boundedStyle} aria-label={`${labels[item.field]}差异`}>
          <h4>{labels[item.field]} <Tag color={item.changed ? "processing" : "default"}>{item.changed ? "将改变" : "保持当前值"}</Tag></h4>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 18rem), 1fr))", gap: 16, minWidth: 0 }}>
            <ComparisonValue label={`当前${labels[item.field]}`} value={item.current} /><ComparisonValue label={`历史${labels[item.field]}`} value={item.selected} />
          </div>{item.field === "enabled" && <p>恢复目标始终为：配置关闭。</p>}
        </section>)}
        {store.noChange() && <Alert role="status" showIcon type="info" title="禁用后的历史配置与当前版本相同，无需创建新版本" />}
        <Button ref={trigger} type="primary" disabled={!store.canRestore()} onClick={() => void store.requestConfirmation()}>{store.noChange() ? "核对无需更改" : "检查恢复为新版本"}</Button>
      </section>}
    </>}
    {scope && readable && state.confirmation && selected && <Modal open title="确认恢复历史配置为新版本" okText="确认创建禁用且未发布的新版本" cancelText="取消，返回比较" destroyOnHidden focusTriggerAfterClose={false}
      confirmLoading={state.busy} okButtonProps={{ disabled: state.busy }} cancelButtonProps={{ disabled: state.busy }} closable={!state.busy} maskClosable={false}
      onCancel={() => { pendingFocus.current = scopeKey; store.cancelConfirmation(); }} onOk={() => void store.confirmRestore()}>
      <p>将历史 v{selected.revision} 的配置保存为当前 v{state.head?.revision} 之后的新版本，使用当前版本做并发校验。</p>
      <p>新版本配置关闭且未发布。此操作不会发布、启用或执行 Agent；原历史版本和旧任务引用不会改变。</p>
      <p>模型、目录和 Skill 固定版本按原值提交。若依赖已失效或当前版本已变化，需重新读取后再选择。</p>
    </Modal>}
  </section></ConfigProvider>;
}
