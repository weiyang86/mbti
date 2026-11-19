"use client";

import { createPersonalAgentsClient, createPersonalSkillsClient } from "@aij/sdk";
import type { PersonalAgent, PersonalAgentSummary, PersonalAgentVersion, PersonalSkillVersion } from "@aij/sdk";
import { PageHeading } from "@aij/ui";
import { Alert, Button, ConfigProvider, Descriptions, Empty, Form, Input, Modal, Select, Space, Spin, Switch, Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { adminTheme } from "./admin-api";
import { clientApi } from "./client-api.mjs";
import type { PinStatus } from "./client-agent-library-state.mjs";
import { createAgentLibrary } from "./client-agent-library-state.mjs";
import { ClientAgentVersionRestorePanel } from './client-agent-version-restore-panel';
import { ClientAgentPublicationAccess } from './client-agent-publication-access';

const promptStyle = { whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxHeight: 480, overflow: "auto" } as const;
const boundedStyle = { minWidth: 0, maxWidth: "100%", overflowWrap: "anywhere" } as const;
function ConfigurationPreview({ value, pins = {} }: { value: PersonalAgent | PersonalAgentVersion; pins?: Record<string, PinStatus> }) {
  return <div style={boundedStyle}><h3>{value.name}</h3><Descriptions column={1} size="small" items={[
    { key: "model", label: "保存的模型", children: `${value.modelCode} · v${value.modelRevision}（目录 v${value.catalogVersion}）` },
    { key: "enabled", label: "配置启用", children: value.enabled ? "是（不代表已执行任务）" : "否" },
    { key: "input", label: "输入字段", children: value.inputFields.join("、") },
    { key: "output", label: "输出", children: `${value.outputFormat === "json" ? "JSON" : "文本"}${value.outputFields.length ? ` · ${value.outputFields.join("、")}` : ""}` }
  ]} /><h4>指令</h4><pre style={promptStyle}>{value.instructions}</pre><h4>Skill 固定版本 · 按顺序</h4>
    {value.skillBindings.length ? <ol>{value.skillBindings.map(pin => <li key={pin.skillId}>{pins[`${pin.skillId}:${pin.revision}`]?.name ?? `Skill ${pin.skillId}`} · 固定 v{pin.revision}</li>)}</ol> : <p>未绑定 Skill</p>}
    <p>模型与 Skill 的可用性以重新读取的结果为准；历史记录只展示保存时的配置。</p>
  </div>;
}
export function ClientAgentLibrary() {
  const router = useRouter();
  const [store] = useState(() => createAgentLibrary({ request: clientApi, agentsClientFactory: createPersonalAgentsClient, skillsClientFactory: createPersonalSkillsClient,
    configured: () => Boolean(process.env.NEXT_PUBLIC_API_URL), onUnauthorized: () => router.replace("/client/login") }));
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  useEffect(() => {
    void store.start(new URL(window.location.href).searchParams.get("workspaceId") ?? "");
    const leave = () => store.dispose();
    const resume = () => { if (document.visibilityState === "visible") void store.refresh(); else store.dispose(); };
    const restore = (event: PageTransitionEvent) => { if (event.persisted) void store.refresh(); };
    window.addEventListener("blur", leave); window.addEventListener("pagehide", leave); window.addEventListener("pageshow", restore); window.addEventListener("focus", resume); document.addEventListener("visibilitychange", resume);
    return () => { window.removeEventListener("blur", leave); window.removeEventListener("pagehide", leave); window.removeEventListener("pageshow", restore); window.removeEventListener("focus", resume); document.removeEventListener("visibilitychange", resume); store.dispose(); };
  }, [store]);
  const canRead = Boolean(state.context?.permissions.includes("workspace.ai.assets.read"));
  const canManage = canRead && Boolean(state.context?.permissions.includes("workspace.ai.assets.manage"));
  const unavailable = ["unconfigured", "unavailable", "service-unavailable", "invalid-response", "revision-conflict"].includes(state.issue?.kind ?? "");
  const locked = state.busy || Boolean(state.confirmation) || !canManage || unavailable;
  const columns: ColumnsType<PersonalAgentSummary> = [
    { title: "编号", dataIndex: "code" }, { title: "名称", dataIndex: "name" },
    { title: "版本", dataIndex: "revision", render: v => `v${v}` },
    { title: "配置启用", dataIndex: "enabled", render: v => v ? "是" : "否" },
    { title: "操作", key: "actions", render: (_, a) => <Space wrap><Button type="link" disabled={state.busy} onClick={() => void store.openDetail(a.id)}>查看</Button>{canRead && state.context?.permissions.includes("workspace.ai.execute") && a.enabled && <Link href={`/client/agents/${encodeURIComponent(a.id)}/run?workspaceId=${encodeURIComponent(state.workspaceId)}`}>运行</Link>}</Space> }
  ];
  const historyColumns: ColumnsType<PersonalAgentVersion> = [
    { title: "历史版本", dataIndex: "revision", render: v => `v${v}` },
    { title: "保存时间", dataIndex: "createdAt", render: v => new Date(v).toLocaleString("zh-CN") },
    { title: "操作", key: "preview", render: (_, v) => <Button type="link" disabled={state.busy} onClick={() => store.previewVersion(v.id)}>只读预览</Button> }
  ];
  const skillVersionColumns: ColumnsType<PersonalSkillVersion> = [
    { title: "Skill 名称 / 编号", key: "name", render: (_, v) => <span>{v.name}<br />{v.code}</span> },
    { title: "固定版本", dataIndex: "revision", render: v => `v${v}` },
    { title: "操作", key: "choose", render: (_, v) => <Button disabled={locked || state.draft.skillBindings.length >= 8 || state.draft.skillBindings.some(p => p.skillId === v.skillId)} onClick={() => store.addPin(v.id)}>绑定此版本</Button> }
  ];
  const model = state.models?.items.find(m => m.code === state.draft.modelCode && m.revision === state.draft.modelRevision);
  const modelCurrent = Boolean(model && state.models?.catalogVersion === state.draft.catalogVersion);
  const workspaceQuery = `workspaceId=${encodeURIComponent(state.workspaceId)}`;
  const restoreScope = state.phase === "ready" && !state.busy && !state.editor && !state.confirmation && !state.historical && !state.issue && state.principal && state.context && state.detail && canRead
    ? { memberId: state.principal.id, workspaceId: state.workspaceId, agentId: state.detail.id, revision: state.detail.revision } : null;
  const reload = state.detail && <Button disabled={state.busy} onClick={() => void store.openDetail(state.detail!.id)}>重新读取当前 Agent（丢弃草稿）</Button>;
  return <ConfigProvider theme={adminTheme}><div className="client-workspace-frame" style={boundedStyle}>
    <header className="client-workspace-topbar" style={{ flexWrap: "wrap" }}><Link href="/client" className="auth-brand">AIJ<span>FOUNDATION</span></Link><div className="client-topbar-identity" style={{ minWidth: 0, maxWidth: "100%" }}><span>{state.principal?.nickname || state.principal?.email || "客户账号"}</span><Button onClick={() => void store.signOut()}>退出登录</Button></div></header>
    <main className="client-workspace-main" style={boundedStyle}>
      <PageHeading eyebrow="客户工作台" title="我的 Agent" description="配置自己的指令、模型和 Skill 固定版本，按空间保存。" actions={<Button loading={state.phase === "loading"} onClick={() => void store.refresh()}>重新验证访问</Button>} />
      <nav aria-label="Agent 导航"><Space wrap><Link href={`/client/ai?${workspaceQuery}`}>AI 工作台</Link>{canRead && <><Link href={`/client/skills?${workspaceQuery}`}>我的 Skill</Link><Link href={`/client/memories?${workspaceQuery}`}>我的记忆</Link><Link href={`/client/workflows?${workspaceQuery}`}>工作流草稿</Link></>}<Link href="/client/workspaces">管理空间</Link></Space></nav>
      <section className="client-workspace-picker" aria-labelledby="agent-space-title"><div><label id="agent-space-title" htmlFor="agent-space-select">当前空间</label><p>只显示当前账号在此空间的私有 Agent。配置启用不代表任务已经执行。</p></div>
        <Select id="agent-space-select" aria-label="选择 Agent 空间" style={{ minWidth: 0 }} value={state.workspaceId || undefined} placeholder="选择空间" loading={state.phase === "loading"} options={state.workspaces.map(w => ({ value: w.workspace.id, label: `${w.workspace.name} · ${w.role.name}` }))} onChange={v => void store.selectWorkspace(v)} /></section>
      {state.issue && <Alert role="alert" className="admin-error" showIcon type={unavailable ? "warning" : "error"} title={state.issue.message} action={<Space wrap><Button onClick={() => void store.refresh()}>刷新列表（丢弃草稿）</Button>{reload}</Space>} />}
      {state.notice && <Alert className="admin-feedback" role="status" showIcon type="success" title={state.notice} />}
      {state.phase === "loading" ? <div className="auth-loading" role="status"><Spin /><span>正在确认会话、空间权限与 Agent 列表…</span></div> : !state.workspaces.length && !state.issue ? <Empty description="还没有可访问的空间" /> : state.context && !canRead ? <Alert type="info" showIcon title="当前角色没有读取私有 Agent 的权限" description="请联系空间管理员申请读取权限。" /> : null}
      {state.phase === "ready" && canRead && <section className="admin-overview-section" style={boundedStyle} aria-labelledby="agent-list-title">
        <div className="overview-section-heading" style={{ flexWrap: "wrap", gap: 12 }}><div><h2 id="agent-list-title">私有 Agent 配置</h2><span>{state.context?.workspaceName} · 当前页最多 20 条</span></div><Button type="primary" disabled={state.busy || !canManage || unavailable} onClick={() => void store.openCreate()}>新建 Agent</Button></div>
        {!canManage && <Alert showIcon type="info" title="当前角色为只读访问" description="可以查看自己的配置和历史；创建、修改、删除需要管理权限。" />}
        {state.issue && !state.items.length ? <Empty description="列表未能加载，请刷新确认服务与权限" /> : <Table<PersonalAgentSummary> rowKey="id" columns={columns} dataSource={state.items} loading={state.busy} pagination={false} scroll={{ x: 640 }} locale={{ emptyText: <Empty description="当前页没有私有 Agent" /> }} />}
        <Space wrap><Button disabled={state.busy} onClick={() => void store.refresh()}>返回第一页</Button><Button disabled={state.busy || !state.nextCursor} onClick={() => void store.nextPage()}>下一页</Button></Space>
      </section>}
      {(state.detail || state.editor === "create") && <section className="admin-overview-section" style={boundedStyle} aria-labelledby="agent-detail-title" aria-busy={state.busy}>
        <div className="overview-section-heading" style={{ flexWrap: "wrap", gap: 12 }}><h2 id="agent-detail-title">{state.editor === "create" ? "新建私有 Agent" : `当前 Agent · v${state.detail?.revision}`}</h2><Button onClick={() => store.closeDetail()}>关闭并清除草稿</Button></div>
        {state.detail && <><p>编号：{state.detail.code} · 当前版本 v{state.detail.revision}</p><Space wrap><Button disabled={state.busy || !canManage || unavailable} onClick={() => void store.openEdit()}>编辑</Button><Button disabled={state.busy} onClick={() => void store.loadVersions()}>查看历史版本</Button><Button danger disabled={state.busy || !canManage || unavailable} onClick={() => store.requestDelete()}>删除</Button>{reload}</Space></>}
        {state.editor ? <Form layout="vertical" onFinish={() => store.requestSave()} autoComplete="off">
          <Form.Item label="编号" required extra="2–63 位小写字母、数字与短横线，以字母开头。创建后不可改，删除后不可复用；相同编号可能返回已有配置，请核对版本。"><Input aria-label="Agent 编号" autoComplete="off" maxLength={63} value={state.draft.code} disabled={locked || state.editor !== "create"} onChange={e => store.setDraft("code", e.target.value)} /></Form.Item>
          <Form.Item label="名称" required extra="最多 100 字，首尾不留空格。"><Input aria-label="Agent 名称" autoComplete="off" maxLength={100} value={state.draft.name} disabled={locked} onChange={e => store.setDraft("name", e.target.value)} /></Form.Item>
          <Form.Item label="指令" required extra="最多 8,000 字符 / 32KB。"><Input.TextArea aria-label="Agent 指令" autoComplete="off" rows={8} maxLength={8000} showCount value={state.draft.instructions} disabled={locked} onChange={e => store.setDraft("instructions", e.target.value)} /></Form.Item>
          <Form.Item label="配置启用" extra="默认关闭。此开关只保存配置，不会执行任务。"><Switch aria-label="启用 Agent 配置" checked={state.draft.enabled} disabled={locked} onChange={v => store.setDraft("enabled", v)} /></Form.Item>
          <Form.Item label="模型" required extra="选择当前可用模型，刷新后请核对并明确选择。不会自动更换模型。">
            <Select aria-label="选择 Agent 模型" style={{ width: "100%" }} placeholder="选择可用模型" value={modelCurrent ? state.draft.modelCode : undefined} disabled={locked || !state.models} options={state.models?.items.map(m => ({ value: m.code, label: `${m.name} · ${m.code} · v${m.revision}` }))} onChange={v => store.selectModel(v)} />
            <Space wrap><Button disabled={state.busy} onClick={() => void store.refreshModels()}>重新读取模型选项</Button>{state.models && <span>当前目录 v{state.models.catalogVersion}</span>}</Space>
            {state.draft.modelCode && <p>草稿模型：{state.draft.modelCode} · v{state.draft.modelRevision} · 目录 v{state.draft.catalogVersion}</p>}
            {!modelCurrent && state.draft.modelCode && <Alert showIcon type="warning" title="保存的模型或目录与当前选项不一致" description="请重新读取模型选项并选择确认；若原模型不再可用，可保留草稿查看或明确选择其他模型。" />}
            {state.models && !state.models.items.length && <Alert type="info" title="当前没有可用模型选项" description="接口未提供具体原因，请联系管理员确认配置。" />}
          </Form.Item>
          <Form.Item label="输入字段名称" required extra="用英文逗号分隔，1–20 个；每个以字母开头，可含数字和下划线，最多 48 位。"><Input aria-label="Agent 输入字段" autoComplete="off" value={state.draft.inputFields.join(",")} disabled={locked} onChange={e => store.setDraft("inputFields", e.target.value.split(",").map(v => v.trim()))} /></Form.Item>
          <Form.Item label="输出格式" required><Select aria-label="Agent 输出格式" value={state.draft.outputFormat} disabled={locked} options={[{ value: "text", label: "文本" }, { value: "json", label: "JSON" }]} onChange={v => store.setDraft("outputFormat", v)} /></Form.Item>
          <Form.Item label="输出字段名称" required={state.draft.outputFormat === "json"} extra="英文逗号分隔，与输入字段相同命名规则；JSON 至少一个字段。"><Input aria-label="Agent 输出字段" autoComplete="off" value={state.draft.outputFields.join(",")} disabled={locked} onChange={e => store.setDraft("outputFields", e.target.value ? e.target.value.split(",").map(v => v.trim()) : [])} /></Form.Item>
          <h3>Skill 固定版本 · 最多 8 个</h3><p>先选择自己的 Skill，再绑定明确的历史版本。顺序会保存在配置中。</p>
          <Form.Item label="我的 Skill"><Select aria-label="选择绑定的 Skill" style={{ width: "100%" }} placeholder="选择 Skill" value={state.selectedSkill?.id} disabled={locked} options={state.skills.map(s => ({ value: s.id, label: `${s.name} · ${s.code} · 当前 v${s.revision}` }))} onChange={v => void store.selectSkill(v)} /></Form.Item>
          <Space wrap><Button disabled={state.busy} onClick={() => void store.loadSkills()}>重新读取 Skill 首页</Button><Button disabled={state.busy || !state.skillCursor} onClick={() => void store.loadSkills(true)}>下一页 Skill</Button><Button disabled={state.busy} onClick={() => void store.recheckPins()}>重新核对固定版本</Button></Space>
          {!state.skills.length && !state.busy && !state.issue && <Empty description="当前页没有自己的 Skill，可前往我的 Skill 创建" />}
          {state.selectedSkill && <><Table<PersonalSkillVersion> rowKey="id" columns={skillVersionColumns} dataSource={state.skillVersions} pagination={false} scroll={{ x: 480 }} /><Button disabled={state.busy || !state.skillVersionCursor} onClick={() => void store.loadSkillVersions()}>更早 Skill 版本</Button></>}
          <ol>{state.draft.skillBindings.map((pin, index) => { const status = state.verifiedPins[`${pin.skillId}:${pin.revision}`]; return <li key={pin.skillId} style={{ marginBlock: 12 }}>
            <p>{status?.name ?? `Skill ${pin.skillId}`} {status?.code ? `· ${status.code}` : ""} · 固定 v{pin.revision}</p>
            {!status?.available && <Alert showIcon type="warning" title="固定版本尚未确认或已不可用" description="请重新核对；若版本已不可读，请移除并重新选择自己的 Skill 版本。" />}
            <Space wrap><Button aria-label={`上移第 ${index + 1} 个 Skill`} disabled={locked || index === 0} onClick={() => store.movePin(index, -1)}>上移</Button><Button aria-label={`下移第 ${index + 1} 个 Skill`} disabled={locked || index === state.draft.skillBindings.length - 1} onClick={() => store.movePin(index, 1)}>下移</Button><Button danger disabled={locked} onClick={() => store.removePin(index)}>移除绑定</Button></Space>
          </li>; })}</ol>
          <Button type="primary" htmlType="submit" disabled={locked || !store.readyToSave()}>检查并确认保存</Button><p>请填写有效且不重复的字段，确认模型和所有固定版本后保存。{state.editor === "edit" ? `将使用当前 v${state.detail?.revision} 校验；冲突后需重新读取。` : ""}</p>
        </Form> : state.detail && <><ConfigurationPreview value={state.detail} pins={state.verifiedPins} />
          {state.principal && state.context && <ClientAgentPublicationAccess key={`${state.principal.id}:${state.workspaceId}:${state.detail.id}:${state.detail.revision}`}
            memberId={state.principal.id} workspaceId={state.workspaceId} agentId={state.detail.id} onAccessChanged={store.refresh}
            onDebug={() => router.push(`/client/agents/${encodeURIComponent(state.detail!.id)}/run?workspaceId=${encodeURIComponent(state.workspaceId)}`)} />}
          {state.models && !state.models.items.some(m => m.code === state.detail?.modelCode && m.revision === state.detail.modelRevision) && <Alert type="warning" showIcon title="保存的模型版本已不在当前可用选项中" description="请重新读取当前 Agent，或在编辑中读取模型选项后明确选择。" />}
          {state.detail.skillBindings.some(p => !state.verifiedPins[`${p.skillId}:${p.revision}`]?.available) && !state.busy && <Alert type="warning" showIcon title="部分固定 Skill 版本尚未确认或已不可用" description="请重新读取当前 Agent，或在编辑中重新核对并选择可用版本。" />}</>}
        {state.versions.length > 0 && <><h3>不可变历史 · 只读</h3><Table<PersonalAgentVersion> rowKey="id" columns={historyColumns} dataSource={state.versions} pagination={false} scroll={{ x: 440 }} /><Button disabled={state.busy || !state.versionCursor} onClick={() => void store.loadVersions(true)}>更早 Agent 版本</Button></>}
        {state.historical && <section aria-label="Agent 历史版本只读预览"><Tag>历史 v{state.historical.revision} · 只读</Tag><ConfigurationPreview value={state.historical} /><p>此预览不会恢复或覆盖当前配置。</p></section>}
      </section>}
      <ClientAgentVersionRestorePanel request={clientApi} scope={restoreScope} onAgentChanged={store.refresh} onScopeRejected={store.dispose} />
      <Typography.Paragraph type="secondary">切换空间、重新验证、切回页面或离开会清除未保存的编辑。私有配置仅在当前页面内存中展示。</Typography.Paragraph>
    </main>
    {state.confirmation && <Modal title={state.confirmation === "delete" ? "确认删除私有 Agent" : state.confirmation === "create" ? "确认创建私有 Agent" : "确认保存 Agent 配置"} open={Boolean(state.confirmation)} okText={state.confirmation === "delete" ? "确认删除" : "确认保存"} cancelText="返回检查" okButtonProps={{ danger: state.confirmation === "delete" }} onCancel={() => store.cancelConfirmation()} onOk={() => void store.confirmMutation()} destroyOnHidden>
      <p>{state.confirmation === "delete" ? "将删除此空间中自己的 Agent，编号不能复用。" : "请确认指令、模型和 Skill 固定版本。保存仅更新配置。"}</p><p>当前空间：{state.context?.workspaceName}</p><p>编号：{state.confirmation === "create" ? state.draft.code : state.detail?.code}{state.detail ? ` · 期望版本 v${state.detail.revision}` : ""}</p>
    </Modal>}
  </div></ConfigProvider>;
}
