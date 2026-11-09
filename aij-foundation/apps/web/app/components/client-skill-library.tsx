"use client";

import { createPersonalSkillsClient } from "@aij/sdk";
import type { PersonalSkillSummary, PersonalSkillVersion } from "@aij/sdk";
import { PageHeading } from "@aij/ui";
import { Alert, Button, ConfigProvider, Descriptions, Empty, Form, Input, Modal, Select, Space, Spin, Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { adminTheme } from "./admin-api";
import { clientApi } from "./client-api.mjs";
import { createSkillLibrary, validSkillDraft } from "./client-skill-library-state.mjs";
import { ClientPersonalScriptPanel } from "./client-personal-script-panel";

const promptStyle = { whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxHeight: 480, overflow: "auto" } as const;

export function ClientSkillLibrary() {
  const router = useRouter();
  const [store] = useState(() => createSkillLibrary({ request: clientApi, skillsClientFactory: createPersonalSkillsClient,
    configured: () => Boolean(process.env.NEXT_PUBLIC_API_URL), onUnauthorized: () => router.replace("/client/login") }));
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  useEffect(() => {
    void store.start(new URL(window.location.href).searchParams.get("workspaceId") ?? "");
    const leave = () => store.dispose();
    const resume = () => { if (document.visibilityState === "visible") void store.refresh(); else store.dispose(); };
    const restore = (event: PageTransitionEvent) => { if (event.persisted) void store.start(); };
    window.addEventListener("pagehide", leave);
    window.addEventListener("pageshow", restore);
    window.addEventListener("focus", resume);
    document.addEventListener("visibilitychange", resume);
    return () => { window.removeEventListener("pagehide", leave); window.removeEventListener("pageshow", restore); window.removeEventListener("focus", resume); document.removeEventListener("visibilitychange", resume); store.dispose(); };
  }, [store]);

  const canRead = state.context?.permissions.includes("workspace.ai.assets.read") ?? false;
  const canManage = canRead && Boolean(state.context?.permissions.includes("workspace.ai.assets.manage"));
  const scriptScope = useMemo(() => state.phase === "ready" && !state.busy && !state.issue && !state.editor && !state.confirmation && !state.historical
    && state.principal && state.context && state.detail && canRead ? {
      memberId: state.principal.id, workspaceId: state.context.workspaceId, skillId: state.detail.id,
      revision: state.detail.revision, name: state.detail.name, instructions: state.detail.instructions
    } : null, [state, canRead]);
  const onScriptSkillChanged = useCallback(() => {
    const current = store.getSnapshot();
    if (current.detail) void store.openDetail(current.detail.id); else void store.refresh();
  }, [store]);
  const capabilityUnavailable = ["unconfigured", "unavailable", "service-unavailable", "invalid-response"].includes(state.issue?.kind ?? "");
  const columns: ColumnsType<PersonalSkillSummary> = [
    { title: "编号", dataIndex: "code", render: value => <code>{value}</code> },
    { title: "名称", dataIndex: "name", render: value => <strong>{value}</strong> },
    { title: "版本", dataIndex: "revision", render: value => `v${value}` },
    { title: "更新时间", dataIndex: "updatedAt", render: value => new Date(value).toLocaleString("zh-CN") },
    { title: "操作", key: "actions", render: (_, skill) => <Button type="link" disabled={state.busy} onClick={() => void store.openDetail(skill.id)}>查看</Button> }
  ];
  const historyColumns: ColumnsType<PersonalSkillVersion> = [
    { title: "历史版本", dataIndex: "revision", render: value => `v${value}` },
    { title: "保存时间", dataIndex: "createdAt", render: value => new Date(value).toLocaleString("zh-CN") },
    { title: "操作", key: "preview", render: (_, version) => <Button type="link" disabled={state.busy} onClick={() => store.previewVersion(version.id)}>只读预览</Button> }
  ];
  const workspaceQuery = `workspaceId=${encodeURIComponent(state.workspaceId)}`;
  const reloadCurrent = state.detail && <Button disabled={state.busy} onClick={() => void store.openDetail(state.detail!.id)}>重新读取当前版本（丢弃草稿）</Button>;

  return <ConfigProvider theme={adminTheme}><div className="client-workspace-frame">
    <header className="client-workspace-topbar"><Link href="/client" className="auth-brand">AIJ<span>FOUNDATION</span></Link>
      <div className="client-topbar-identity"><span>{state.principal?.nickname || state.principal?.email || "客户账号"}</span><Button loading={state.busy && !state.principal} onClick={() => void store.signOut()}>退出登录</Button></div>
    </header>
    <main className="client-workspace-main">
      <PageHeading eyebrow="客户工作台" title="我的 Skill" description="创建私有提示词指令，按空间保存并查看历史版本。"
        actions={<Button loading={state.phase === "loading"} onClick={() => void store.refresh()}>重新验证访问</Button>} />
      <nav aria-label="Skill 导航"><Space wrap><Link href={`/client/ai?${workspaceQuery}`}>AI 工作台</Link>{canRead && <Link href={`/client/agents?${workspaceQuery}`}>我的 Agent</Link>}<Link href="/client/workspaces">管理空间</Link></Space></nav>
      <section className="client-workspace-picker" aria-labelledby="skill-workspace-title">
        <div><label id="skill-workspace-title" htmlFor="skill-workspace-select">当前空间</label><p>只显示当前账号在此空间的 Skill；空间管理员也不能通过本页读取其他人的私有内容。</p></div>
        <Select id="skill-workspace-select" aria-label="选择 Skill 空间" placeholder="选择空间" value={state.workspaceId || undefined} loading={state.phase === "loading"}
          options={state.workspaces.map(item => ({ value: item.workspace.id, label: `${item.workspace.name} · ${item.role.name}` }))} onChange={value => void store.selectWorkspace(value)} />
      </section>
      {state.issue && <Alert role="alert" className="admin-error" showIcon type={capabilityUnavailable ? "warning" : "error"} title={state.issue.message}
        action={<Space wrap><Button onClick={() => void store.refresh()}>刷新列表（丢弃草稿）</Button>{state.issue.kind === "revision-conflict" && reloadCurrent}</Space>} />}
      {state.notice && <Alert className="admin-feedback" role="status" type="success" showIcon title={state.notice} />}
      {state.phase === "loading" ? <div className="auth-loading" role="status"><Spin /><span>正在确认会话、空间权限与 Skill 列表…</span></div> :
        !state.workspaces.length && !state.issue ? <section className="client-empty-state"><Empty description="还没有可访问的空间" /><Link href="/client/workspaces">查看空间</Link></section> :
          state.context && !canRead ? <Alert type="info" showIcon title="当前角色没有读取私有 Skill 的权限" description="请联系空间管理员申请读取权限。" /> : null}
      {state.phase === "ready" && canRead && <section className="admin-overview-section" aria-labelledby="skill-list-title">
        <div className="overview-section-heading"><div><h2 id="skill-list-title">私有提示词库</h2><span>{state.context?.workspaceName} · 当前页最多 20 条</span></div>
          <Space wrap><Button disabled={state.busy} onClick={() => void store.refresh()}>刷新列表</Button><Button type="primary" disabled={state.busy || !canManage || capabilityUnavailable} onClick={() => store.openCreate()}>新建 Skill</Button></Space></div>
        {!canManage && <Alert showIcon type="info" title="当前角色为只读访问" description="可以查看自己的 Skill 与历史版本；创建、修改和删除需管理员授予管理权限。" />}
        {state.issue && !state.items.length ? <Empty description="列表未能加载，请先刷新确认服务与权限" /> :
          <Table<PersonalSkillSummary> rowKey="id" columns={columns} dataSource={state.items} loading={state.busy} pagination={false} scroll={{ x: 640 }} locale={{ emptyText: <Empty description="当前页没有私有 Skill" ><p>可以创建供自己使用的提示词文本。</p></Empty> }} />}
        <Space wrap><Button disabled={state.busy} onClick={() => void store.refresh()}>返回第一页</Button><Button disabled={state.busy || !state.nextCursor} onClick={() => void store.nextPage()}>下一页</Button></Space>
      </section>}
      {(state.detail || state.editor === "create") && <section className="admin-overview-section" aria-labelledby="skill-detail-title" aria-busy={state.busy}>
        <div className="overview-section-heading"><h2 id="skill-detail-title">{state.editor === "create" ? "新建提示词 Skill" : "当前 Skill"}</h2><Button disabled={state.busy} onClick={() => store.closeDetail()}>关闭并清除草稿</Button></div>
        {state.detail && <><Descriptions column={1} size="small" items={[
          { key: "code", label: "编号", children: state.detail.code }, { key: "revision", label: "服务端版本", children: `v${state.detail.revision}` }
        ]} /><Space wrap><Button disabled={state.busy || !canManage || capabilityUnavailable} onClick={() => store.openEdit()}>编辑</Button><Button disabled={state.busy} onClick={() => void store.loadVersions()}>查看历史版本</Button><Button danger disabled={state.busy || !canManage || capabilityUnavailable} onClick={() => store.requestDelete()}>删除</Button>{reloadCurrent}</Space></>}
        {state.editor ? <Form layout="vertical" onFinish={() => store.requestSave()} autoComplete="off">
          <Form.Item label="编号" required extra="2–63 位小写字母、数字与短横线，以字母开头。创建后不可修改，删除后不可复用。"><Input aria-label="Skill 编号" autoComplete="off" value={state.draft.code} maxLength={63} disabled={state.busy || state.editor !== "create" || Boolean(state.confirmation)} onChange={event => store.setDraft("code", event.target.value)} /></Form.Item>
          <Form.Item label="名称" required extra="最多 100 字，首尾不能有空格。"><Input aria-label="Skill 名称" autoComplete="off" value={state.draft.name} maxLength={100} disabled={state.busy || Boolean(state.confirmation)} onChange={event => store.setDraft("name", event.target.value)} /></Form.Item>
          <Form.Item label="提示词指令" required extra="最多 8,000 字符 / 32KB。"><Input.TextArea aria-label="Skill 提示词指令" autoComplete="off" value={state.draft.instructions} maxLength={8000} showCount rows={8} disabled={state.busy || Boolean(state.confirmation)} onChange={event => store.setDraft("instructions", event.target.value)} /></Form.Item>
          <Button type="primary" htmlType="submit" disabled={state.busy || !canManage || !validSkillDraft(state.draft, state.editor === "create")}>检查并确认保存</Button>
          {state.editor === "edit" && <Typography.Paragraph type="secondary">将使用 v{state.detail?.revision} 校验保存；版本冲突时请重新读取，页面不会自动覆盖或重试。</Typography.Paragraph>}
        </Form> : state.detail && <><h3>{state.detail.name}</h3><pre style={promptStyle}>{state.detail.instructions}</pre></>}
        {state.versions.length > 0 && <><h3>版本历史 · 只读</h3><Table<PersonalSkillVersion> rowKey="id" columns={historyColumns} dataSource={state.versions} pagination={false} scroll={{ x: 420 }} /><Button disabled={state.busy || !state.versionCursor} onClick={() => void store.loadVersions(true)}>更早版本</Button></>}
        {state.historical && <section aria-label="历史版本只读预览"><Tag>历史 v{state.historical.revision} · 只读，非当前编辑内容</Tag><h3>{state.historical.name}</h3><pre style={promptStyle}>{state.historical.instructions}</pre><p>此预览不会恢复或覆盖当前 Skill。</p></section>}
      </section>}
      <ClientPersonalScriptPanel request={clientApi} scope={scriptScope} onSkillChanged={onScriptSkillChanged} />
      <Typography.Paragraph type="secondary">切换空间、重新验证或离开页面会清除未保存的编辑。已保存的内容可在对应空间中查看。</Typography.Paragraph>
    </main>
    {state.confirmation && <Modal title={state.confirmation === "delete" ? "确认删除私有 Skill" : state.confirmation === "create" ? "确认创建提示词 Skill" : "确认保存当前版本"} open
      okText={state.confirmation === "delete" ? "确认删除" : "确认保存"} cancelText="返回检查" okButtonProps={{ danger: state.confirmation === "delete" }} onCancel={() => store.cancelConfirmation()} onOk={() => void store.confirmMutation()} destroyOnHidden>
      <p>{state.confirmation === "delete" ? "将删除当前账号在此空间的这条 Skill；页面不提供恢复，原编号不能复用。" : "请确认编号和内容，将保存为当前账号的私有提示词。"}</p>
      <p>编号：{state.confirmation === "create" ? state.draft.code : state.detail?.code}{state.detail ? ` · 期望版本 v${state.detail.revision}` : ""}</p>
    </Modal>}
  </div></ConfigProvider>;
}
