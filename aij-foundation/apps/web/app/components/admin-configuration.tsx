"use client";
import { PageHeading } from "@aij/ui";

import { Alert, Button, Checkbox, Form, Input, InputNumber, Modal, Select, Space, Table, Tag } from "antd";
import { useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createExternalServicesApi, type ClientApi, type ExternalServicesApi } from "@aij/sdk";
import { RequestFailure, requestMessage } from "./admin-api";
import { useAdmin } from "./admin-shell";
import { AdminExternalServices } from "./admin-external-services";

type Scope = "global" | "organization" | "project";
type Status = "active" | "disabled";
type ConfigRow = { id: string; scope: Scope; scopeId: string; configKey: string; valueType: "string" | "boolean" | "number" | "secretRef"; isPublic: boolean; sensitive: boolean; status: Status; version: number; configValue?: string | boolean | number; referenceConfigured?: boolean };
type Profile = { id: string; code: string; status: Status; updatedAt: string; organization: { id: string; status: Status } };
type Change = { id: string; scope: Scope; scopeId: string; configKey: string; configId: string | null; configVersion: number | null; auditLogId: string; operatorId: string; createdAt: string };
type Resolved = { configKey: string; source: Scope | "default"; version?: number; configValue?: string | number | boolean; value?: string | number | boolean; sensitive: boolean };
type ConfigSpec = { key: string; label: string; valueType: "string" | "boolean" | "number" | "secretRef"; public: boolean; defaultValue: string | boolean | number; projectOnly?: boolean };
type PublicContext = { projectCode: string; brand: Record<string, string>; capabilities: Record<string, boolean>; enabledPlugins: string[] };
type Editor = { scope: Scope; spec: ConfigSpec; row?: ConfigRow };

// This picker intentionally contains only the current non-secret schema entries. The API remains authoritative.
const CONFIG_SPECS: ConfigSpec[] = [
  { key: "brand.displayName", label: "公开品牌名称", valueType: "string", public: true, defaultValue: "AIJ" },
  { key: "brand.primaryColor", label: "公开主色", valueType: "string", public: true, defaultValue: "#2563EB" },
  { key: "brand.logoPath", label: "公开 Logo 路径", valueType: "string", public: true, defaultValue: "/" },
  { key: "capabilities.publicContextEnabled", label: "公开上下文开关", valueType: "boolean", public: true, defaultValue: true },
  { key: "internal.retentionDays", label: "内部保留天数", valueType: "number", public: false, defaultValue: 30 },
  { key: "ai.providerCode", label: "AI Provider 代码", valueType: "string", public: false, defaultValue: "", projectOnly: true },
  { key: "ai.modelCode", label: "AI 模型代码", valueType: "string", public: false, defaultValue: "", projectOnly: true },
  { key: "ai.credentialRef", label: "AI 凭据 SecretRef", valueType: "secretRef", public: false, defaultValue: "", projectOnly: true },
  { key: "capabilities.ai.text.generate", label: "AI 文本生成能力", valueType: "boolean", public: false, defaultValue: false, projectOnly: true }
];
const SCOPE_LABEL: Record<Scope, string> = { global: "全局", organization: "项目组织", project: "项目" };
const status = (value: Status) => <Tag color={value === "active" ? "green" : "default"}>{value === "active" ? "启用" : "停用"}</Tag>;

function safePublicContext(value: unknown): PublicContext {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const brandInput = record.brand && typeof record.brand === "object" ? record.brand as Record<string, unknown> : {};
  const capabilitiesInput = record.capabilities && typeof record.capabilities === "object" ? record.capabilities as Record<string, unknown> : {};
  const brand: Record<string, string> = {};
  for (const key of ["displayName", "primaryColor", "logoPath"]) if (typeof brandInput[key] === "string") brand[key] = brandInput[key] as string;
  const capabilities: Record<string, boolean> = {};
  for (const key of ["auth", "database", "storage", "publicContext"]) if (typeof capabilitiesInput[key] === "boolean") capabilities[key] = capabilitiesInput[key] as boolean;
  return { projectCode: typeof record.projectCode === "string" ? record.projectCode : "", brand, capabilities, enabledPlugins: Array.isArray(record.enabledPlugins) ? record.enabledPlugins.filter((item): item is string => typeof item === "string") : [] };
}

function formatError(error: unknown) {
  if (error instanceof RequestFailure && error.status === 409) return "配置版本冲突（409）：该配置已被其他操作更新。页面已重新读取最新版本，请检查后再保存。";
  return requestMessage(error);
}

export function AdminConfiguration() {
  const { request, permissions, can, session } = useAdmin();
  const externalRequest = useRef(request);
  useLayoutEffect(() => { externalRequest.current = request; }, [request]);
  const externalApi = useMemo<ExternalServicesApi>(() => {
    // Construct the SDK client only when a method is called after rendering.
    // The stable wrapper keeps periodic admin refreshes from discarding drafts.
    const current = () => {
      const adapter: ClientApi = (path, options = {}) => externalRequest.current(path, options.method ?? "GET", typeof options.body === "string" ? JSON.parse(options.body) : undefined);
      return createExternalServicesApi(adapter);
    };
    return {
      catalog: signal => current().catalog(signal),
      list: signal => current().list(signal),
      get: (code, signal) => current().get(code, signal),
      save: (code, input, signal) => current().save(code, input, signal)
    };
  }, []);
  const externalIdentity = JSON.stringify([session.user.id, session.csrfToken, permissions.isSuperAdmin, [...permissions.roles].sort(), [...permissions.effectivePermissions].sort()]);
  const [profile, setProfile] = useState<Profile | null>(null), [rows, setRows] = useState<ConfigRow[]>([]), [changes, setChanges] = useState<Change[]>([]), [resolved, setResolved] = useState<Record<string, Resolved>>({}), [publicContext, setPublicContext] = useState<PublicContext | null>(null), [publicContextError, setPublicContextError] = useState("");
  const [scope, setScope] = useState<Scope>("project"), [newKey, setNewKey] = useState(CONFIG_SPECS[0].key), [editor, setEditor] = useState<Editor | null>(null), [loading, setLoading] = useState(true), [saving, setSaving] = useState(false), [revision, setRevision] = useState(0);
  const [error, setError] = useState(""), [success, setSuccess] = useState("");
  const [form] = Form.useForm();

  const load = useEffectEvent(async (preserveError = false) => {
    setLoading(true);
    try {
      const [nextProfile, nextRows, nextChanges, nextResolved] = await Promise.all([
        request<Profile>("/admin/project-profile"), request<ConfigRow[]>("/admin/scoped-configs"), request<Change[]>("/admin/configuration-changes"),
        Promise.all(CONFIG_SPECS.map(spec => request<Resolved>("/admin/scoped-configs/" + spec.key + "/resolved")))
      ]);
      setProfile(nextProfile); setRows(nextRows); setChanges(nextChanges); setResolved(Object.fromEntries(nextResolved.map(value => [value.configKey, value])));
      try { setPublicContext(safePublicContext(await request<unknown>("/project/context"))); setPublicContextError(""); }
      catch (failure) { setPublicContext(null); setPublicContextError(failure instanceof RequestFailure && failure.status === 403 ? "公开上下文当前已由服务端关闭（403）。配置管理仍可用。" : requestMessage(failure)); }
      if (!preserveError) setError("");
    } catch (failure) { setError(formatError(failure)); }
    finally { setLoading(false); }
  });
  useEffect(() => { const timer = setTimeout(() => void load(true), 0); return () => clearTimeout(timer); }, [revision]);

  function openEditor(spec: ConfigSpec, row?: ConfigRow) {
    form.resetFields(); form.setFieldsValue({ configValue: spec.valueType === "secretRef" ? "" : row ? row.configValue : spec.defaultValue, isPublic: row?.isPublic ?? spec.public, status: row?.status ?? "active" });
    setEditor({ scope, spec, row }); setError(""); setSuccess("");
  }
  async function save(values: { configValue: string | number | boolean; isPublic: boolean; status: Status }) {
    if (!editor) return;
    setSaving(true); setError(""); setSuccess("");
    try {
      const configValue = editor.spec.valueType === "boolean" ? String(values.configValue === true || values.configValue === "true") : String(values.configValue).trim();
      const updated = await request<ConfigRow>("/admin/scoped-configs/" + editor.spec.key, "PUT", { scope: editor.scope, configValue, valueType: editor.spec.valueType, isPublic: values.isPublic, status: values.status, expectedVersion: editor.row?.version ?? 0 });
      setSuccess(`${editor.spec.key} 已保存，版本 ${updated.version}。`); setEditor(null); form.resetFields(); setRevision(v => v + 1);
    } catch (failure) {
      setError(formatError(failure));
      if (failure instanceof RequestFailure && failure.status === 409) setRevision(v => v + 1);
    } finally { setSaving(false); }
  }

  const availableSpecs = CONFIG_SPECS.filter(spec => !spec.projectOnly || scope === "project");
  const selectedNewSpec = availableSpecs.find(item => item.key === newKey) ?? availableSpecs[0];
  const selectedRows = rows.filter(row => row.scope === scope);
  const values = availableSpecs.map(spec => {
    const row = selectedRows.find(item => item.configKey === spec.key);
    return { key: spec.key, configKey: spec.key, label: spec.label, valueType: spec.valueType, isPublic: row?.isPublic ?? spec.public, status: row?.status ?? "active" as Status, version: row?.version ?? 0, scopeId: row?.scopeId ?? "由服务端上下文解析", storedValue: row?.configValue, defaultValue: spec.defaultValue, configured: !!row, safe: true, spec, row };
  });
  const extraRows = selectedRows.filter(row => !availableSpecs.some(spec => spec.key === row.configKey)).map(row => ({ key: row.id, configKey: row.configKey, label: row.sensitive ? "敏感配置（仅安全元数据）" : "未列入本页面编辑目录", valueType: row.valueType, isPublic: row.isPublic, status: row.status, version: row.version, scopeId: row.scopeId, storedValue: undefined, defaultValue: undefined, configured: true, safe: false, spec: undefined, row }));
  const columns = [
    { title: "配置项", key: "key", render: (_: unknown, row: typeof values[number] | typeof extraRows[number]) => <><strong>{row.label}</strong><div className="admin-cell-secondary"><code>{row.configKey}</code></div></> },
    { title: "层级", key: "scope", render: () => SCOPE_LABEL[scope] },
    { title: "归属 ID", dataIndex: "scopeId", key: "scopeId", render: (value: string) => <code>{value}</code> },
    { title: "当前值", key: "value", render: (_: unknown, row: typeof values[number] | typeof extraRows[number]) => row.spec?.valueType === "secretRef" ? <Tag color={row.row?.referenceConfigured ? "green" : "orange"}>{row.row?.referenceConfigured ? "SecretRef 可用" : row.configured ? "SecretRef 当前不可用" : "未配置"}</Tag> : row.safe ? <code>{String(row.storedValue ?? row.defaultValue)}</code> : <Tag>敏感值不展示</Tag> },
    { title: "版本", dataIndex: "version", key: "version", render: (value: number) => value ? `v${value}` : "未配置（0）" },
    { title: "状态", dataIndex: "status", key: "status", render: (value: Status) => status(value) },
    { title: "公开", dataIndex: "isPublic", key: "isPublic", render: (value: boolean) => value ? "是" : "否" },
    { title: "操作", key: "action", render: (_: unknown, row: typeof values[number] | typeof extraRows[number]) => row.spec ? row.spec.valueType !== "secretRef" || can("admin.secret.manage") ? <Button size="small" onClick={() => openEditor(row.spec!, row.row)}>配置</Button> : <Tag>需要密钥管理权限</Tag> : <Tag>只读</Tag> }
  ];
  const effective = availableSpecs.map(spec => ({ key: spec.key, spec, resolved: resolved[spec.key] }));

  return <>
    <PageHeading eyebrow="系统管理 · 项目配置" title="项目与组织配置" description="配置范围由后端可信项目上下文解析；每次更新须提交当前版本。" actions={<Button onClick={() => { setError(""); setSuccess(""); setRevision(v => v + 1); }}>刷新</Button>} />
    <AdminExternalServices api={externalApi} identityKey={externalIdentity} canManageSecrets={can("admin.secret.manage")} />
    {error && <div role="alert" className="admin-feedback"><Alert type="error" showIcon title={error} /></div>}
    {success && <div role="status" className="admin-feedback"><Alert type="success" showIcon title={success} /></div>}
    {profile && <section className="admin-table-panel" aria-label="项目归属"><h2>当前项目</h2><div className="admin-overview"><div><span className="admin-field-label">项目编码</span><strong>{profile.code}</strong><div className="admin-cell-secondary">{profile.status}</div></div><div><span className="admin-field-label">项目组织</span><strong>{profile.organization.id}</strong><div className="admin-cell-secondary">{profile.organization.status}</div></div><div><span className="admin-field-label">资料版本</span><strong>{profile.updatedAt}</strong></div></div></section>}
    <section className="admin-table-panel" aria-label="有效公开上下文"><div className="admin-heading-actions"><div><h2>公开上下文预览</h2><p className="admin-help">显示匿名接口的固定安全投影；不展示配置表、组织资料、密钥引用或变更载荷。</p></div><Tag color="blue">匿名 API 投影</Tag></div>
      {publicContext ? <pre className="admin-safe-preview">{JSON.stringify(publicContext, null, 2)}</pre> : <p role="status">{publicContextError || "正在读取公开上下文…"}</p>}
    </section>
    <section className="admin-table-panel" aria-label="分层配置"><div className="admin-heading-actions"><div><h2>配置层级与版本</h2><p className="admin-help">项目优先于组织、组织优先于全局。未配置项使用服务端默认值；并发更新以 409 拒绝。</p></div><Space><Select aria-label="配置范围" value={scope} onChange={(value: Scope) => setScope(value)} options={[{ value: "project", label: "项目" }, { value: "organization", label: "项目组织" }, ...(permissions.isSuperAdmin ? [{ value: "global", label: "全局" }] : [])]} /><Select aria-label="新增配置项" value={selectedNewSpec?.key} onChange={setNewKey} options={availableSpecs.map(spec => ({ value: spec.key, label: spec.label }))} /><Button disabled={!selectedNewSpec || selectedNewSpec.valueType === "secretRef" && !can("admin.secret.manage")} onClick={() => selectedNewSpec && openEditor(selectedNewSpec, selectedRows.find(row => row.configKey === selectedNewSpec.key))}>配置所选项</Button></Space></div>
      {scope === "project" && <Alert className="admin-feedback" type="info" showIcon title="AI Provider 与模型配置" description="Provider、模型和能力开关只保存到当前项目的 aij-ai 配置；SecretRef 仅显示可用状态，密钥值不会回显。保存配置不代表已注册可用 Provider，也不会触发模型调用。" />}
      <Table rowKey="key" dataSource={[...values, ...extraRows]} columns={columns as never} loading={loading} pagination={false} scroll={{ x: 1100 }} />
      <p className="admin-help">系统配置目录由后端固定 schema 校验；SecretRef 仅在其专用页面管理。页面隐藏敏感载荷，API 仍独立执行 RBAC、scope 和版本检查。</p>
    </section>
    <section className="admin-table-panel" aria-label="有效配置解析"><h2>各项解析结果</h2><Table rowKey="key" dataSource={effective} pagination={false} columns={[{ title: "配置项", key: "configKey", render: (_: unknown, row: typeof effective[number]) => <code>{row.spec.key}</code> }, { title: "有效层级", key: "source", render: (_: unknown, row: typeof effective[number]) => row.resolved?.source && row.resolved.source !== "default" ? <Tag color="blue">{SCOPE_LABEL[row.resolved.source]}</Tag> : <Tag>默认值</Tag> }, { title: "有效版本", key: "version", render: (_: unknown, row: typeof effective[number]) => row.resolved?.version ? `v${row.resolved.version}` : "默认" }, { title: "公开值", key: "value", render: (_: unknown, row: typeof effective[number]) => row.spec.public ? <code>{String(row.resolved?.configValue ?? row.resolved?.value ?? row.spec.defaultValue)}</code> : <Tag>非公开</Tag> }]} />
    </section>
    <section className="admin-table-panel" aria-label="配置变更历史"><h2>最近配置变更</h2><Table<Change> rowKey="id" dataSource={changes} loading={loading} pagination={{ pageSize: 10 }} columns={[{ title: "时间", dataIndex: "createdAt", key: "createdAt" }, { title: "层级", dataIndex: "scope", key: "scope", render: (value: Scope) => SCOPE_LABEL[value] }, { title: "配置项", dataIndex: "configKey", key: "configKey" }, { title: "版本", dataIndex: "configVersion", key: "configVersion", render: (value: number | null) => value ? `v${value}` : "资料变更" }, { title: "审计关联", dataIndex: "auditLogId", key: "auditLogId", render: (value: string) => <code>{value}</code> }]} /></section>
    <Modal title={`${SCOPE_LABEL[editor?.scope ?? scope]} · ${editor?.spec.label ?? "配置"}`} open={!!editor} onCancel={() => { if (!saving) setEditor(null); }} onOk={() => void form.submit()} confirmLoading={saving} okText="按当前版本保存" cancelText="取消" destroyOnHidden>
      {editor && <Alert className="admin-feedback" type="info" showIcon title={`expectedVersion=${editor.row?.version ?? 0}。服务端拒绝旧版本；全局写入${permissions.isSuperAdmin ? "可用" : "仅系统管理员可执行"}。`} />}
      <Form form={form} layout="vertical" onFinish={save} preserve={false}>
        {editor?.spec.valueType === "boolean" ? <Form.Item name="configValue" label="配置值" rules={[{ required: true }]}><Select options={[{ value: true, label: "开启" }, { value: false, label: "关闭" }]} /></Form.Item> : editor?.spec.valueType === "number" ? <Form.Item name="configValue" label="配置值" rules={[{ required: true }]}><InputNumber min={1} max={365} precision={0} style={{ width: "100%" }} /></Form.Item> : editor?.spec.valueType === "secretRef" ? <Form.Item name="configValue" label="SecretRef（保存后仅显示状态）" rules={[{ required: true, whitespace: true, max: 256 }]}><Input.Password autoComplete="new-password" maxLength={256} /></Form.Item> : <Form.Item name="configValue" label="配置值" rules={[{ required: true, whitespace: true, max: 128 }]}><Input maxLength={128} /></Form.Item>}
        <Form.Item name="status" label="状态" rules={[{ required: true }]}><Select options={[{ value: "active", label: "启用" }, { value: "disabled", label: "停用" }]} /></Form.Item>
        <Form.Item name="isPublic" valuePropName="checked"><Checkbox disabled={!editor?.spec.public}>允许进入匿名公开上下文</Checkbox></Form.Item>
      </Form>
    </Modal>
  </>;
}
