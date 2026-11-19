"use client";
import { PageHeading } from "@aij/ui";

import { Alert, Button, Descriptions, Form, Input, Modal, Select, Space, Table, Tag } from "antd";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { requestMessage } from "./admin-api";
import { useAdmin } from "./admin-shell";

type Status = "success" | "failed" | "error";
type AuditSummary = { redacted?: boolean; fields?: unknown[]; requiredPermissions?: unknown[]; permissionIdsBefore?: unknown[]; permissionIdsAfter?: unknown[]; correlationId?: unknown };
type AuditRecord = {
  id: string; module: string; action: string; userId: string | null; userName: string | null; status: string;
  resourceType: string; resourceId: string | null; method: string | null; path: string | null; requestSummary: AuditSummary | null;
  beforeData: unknown; afterData: unknown; errorMessage: string | null; ip: string | null; userAgent: string | null;
  createdAt: string; redacted: boolean;
};
type PageResult<T> = { items: T[]; total: number; page: number; pageSize: number };
type Filters = { module?: string; action?: string; status?: Status; resourceType?: string; userId?: string; resourceId?: string; correlationId?: string; startAt?: string; endAt?: string };

const redacted = "[REDACTED]";
const modules = new Set(["auth", "rbac", "client-auth", "admin-users", "rbac-management", "menus", "dictionaries", "configuration", "secret-center"]);
const actions = new Set(["login", "login_failed", "logout", "password_changed", "password_change_failed", "permission_denied", "created", "updated", "enabled", "disabled", "deleted", "password_reset", "role_created", "role_updated", "role_enabled", "role_disabled", "role_deleted", "role_permissions_assigned", "permission_created", "permission_updated", "permission_enabled", "permission_disabled", "permission_deleted", "menu_created", "menu_updated", "menu_deleted", "dict_created", "dict_updated", "dict_deleted", "dict_item_created", "dict_item_updated", "dict_item_deleted", "scoped_config_updated", "project_status_updated", "secret_reference_created", "secret_reference_checked", "secret_reference_rotated", "secret_reference_cleared", "secret_reference_rebound", "login_rate_limited"]);
const statuses = new Set(["success", "failed", "error"]);
const methods = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
const resourceTypes = new Set(["admin-auth", "member_auth", "permission", "administrator", "role", "menu", "system_dict", "system_dict_item", "scoped_config", "project_profile", "secret_reference"]);
const routes = new Set(["/api/auth/login", "/api/auth/me", "/api/auth/logout", "/api/auth/password", "/api/client/auth/login", "/api/admin/users", "/api/admin/roles", "/api/admin/menus", "/api/admin/logs", "/api/admin/scoped-configs", "/api/admin/secret-references"]);
const fieldNames = new Set(["identity", "roles", "realName", "email", "phone", "roleIds", "roleCode", "roleName", "remark", "permissionIds", "permissionCode", "permissionName", "resourceType", "action", "apiPath", "name", "title", "parentId", "path", "icon", "sortOrder", "visible", "status", "code", "description", "isPublic", "label", "value", "dictId", "configValue", "version", "reference"]);
const permissionCodes = new Set(["aij.bootstrap.admin", "admin.user.manage", "admin.role.manage", "admin.permission.manage", "admin.menu.manage", "admin.dict.manage", "admin.dict.read", "admin.config.manage", "admin.secret.manage", "admin.log.read"]);
const label = (value: unknown, accepted: Set<string>) => typeof value === "string" && accepted.has(value) ? value : redacted;
const safeId = (value: unknown) => typeof value === "string" && /^(?:[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}|c[a-z0-9]{24})$/.test(value) ? value : redacted;
function safePath(value: unknown) { return typeof value === "string" && routes.has(value.split(/[?#]/, 1)[0]) ? value.split(/[?#]/, 1)[0] : value == null ? "—" : redacted; }
function safeStrings(value: unknown, accepted: Set<string>) { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && accepted.has(item)).slice(0, 100) : []; }
function safeDate(value: unknown) { return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : redacted; }
function safeError(error: unknown) { return requestMessage(error); }
function queryPath(page: number, pageSize: number, filters: Filters) {
  const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  for (const [key, value] of Object.entries(filters)) if (typeof value === "string" && value.trim()) query.set(key, value.trim());
  return "/admin/logs?" + query.toString();
}

export function AdminAuditLogs() {
  const { request } = useAdmin();
  const [form] = Form.useForm<Filters>();
  const [filters, setFilters] = useState<Filters>({});
  const [page, setPage] = useState(1), [pageSize, setPageSize] = useState(20), [revision, setRevision] = useState(0);
  const [data, setData] = useState<PageResult<AuditRecord>>({ items: [], total: 0, page: 1, pageSize: 20 });
  const [loading, setLoading] = useState(false), [error, setError] = useState(""), [detailError, setDetailError] = useState("");
  const [detail, setDetail] = useState<AuditRecord | null>(null), [detailLoading, setDetailLoading] = useState(false);
  const sequence = useRef({ value: 0 });

  const load = useEffectEvent(async () => {
    const current = ++sequence.current.value;
    setLoading(true); setError("");
    try {
      const result = await request<PageResult<AuditRecord>>(queryPath(page, pageSize, filters));
      if (current === sequence.current.value) {
        setData(result);
        if (result.items.length === 0 && page > 1 && result.total > 0) setPage(Math.ceil(result.total / pageSize));
      }
    } catch (failure) {
      if (current === sequence.current.value) { setError(safeError(failure)); setData({ items: [], total: 0, page, pageSize }); }
    } finally { if (current === sequence.current.value) setLoading(false); }
  });
  useEffect(() => { const requestSequence = sequence.current; const timer = setTimeout(() => void load(), 0); return () => { requestSequence.value++; clearTimeout(timer); }; }, [page, pageSize, filters, revision]);

  async function showDetail(row: AuditRecord) {
    const id = safeId(row.id);
    if (id === redacted) return;
    setDetail(null); setDetailError(""); setDetailLoading(true);
    try { setDetail(await request<AuditRecord>("/admin/logs/" + encodeURIComponent(id))); }
    catch (failure) { setDetailError(safeError(failure)); }
    finally { setDetailLoading(false); }
  }
  function apply(values: Filters) {
    const next = Object.fromEntries(Object.entries(values).filter(([, value]) => typeof value === "string" && value.trim()).map(([key, value]) => [key, (value as string).trim()])) as Filters;
    setPage(1); setFilters(next);
  }
  function clearFilters() { form.resetFields(); setPage(1); setFilters({}); }

  const columns = [
    { title: "时间", dataIndex: "createdAt", key: "createdAt", render: (value: unknown) => safeDate(value) },
    { title: "模块 / 动作", key: "operation", render: (_: unknown, row: AuditRecord) => <><Tag>{label(row.module, modules)}</Tag><div className="admin-cell-secondary">{label(row.action, actions)}</div></> },
    { title: "结果", dataIndex: "status", key: "status", render: (value: unknown) => { const current = label(value, statuses); return <Tag color={current === "success" ? "green" : current === "failed" ? "orange" : "default"}>{current}</Tag>; } },
    { title: "资源", key: "resource", render: (_: unknown, row: AuditRecord) => <><span>{label(row.resourceType, resourceTypes)}</span><div className="admin-cell-secondary"><code>{safeId(row.resourceId)}</code></div></> },
    { title: "接口", key: "endpoint", render: (_: unknown, row: AuditRecord) => <><span>{label(row.method, methods)}</span><div className="admin-cell-secondary"><code>{safePath(row.path)}</code></div></> },
    { title: "操作者 ID", dataIndex: "userId", key: "userId", render: (value: unknown) => <code>{safeId(value)}</code> },
    { title: "详情", key: "detail", render: (_: unknown, row: AuditRecord) => <Button size="small" disabled={safeId(row.id) === redacted} onClick={() => void showDetail(row)}>安全详情</Button> }
  ];

  return <>
    <PageHeading eyebrow="系统管理 · 审计" title="审计日志" description="仅查询本项目核心审计记录。姓名、网络地址、自由文本和原始快照在页面中始终隐藏。" actions={<Button onClick={() => setRevision(value => value + 1)}>刷新</Button>} />
    {error && <div role="alert" className="admin-feedback"><Alert type="error" showIcon title={error} /></div>}
    <section className="admin-table-panel" aria-label="审计筛选"><Form form={form} layout="vertical" onFinish={apply} preserve={false} style={{ padding: 20 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(175px, 1fr))", gap: "0 16px" }}>
        <Form.Item name="module" label="模块"><Input maxLength={64} placeholder="例如 auth" /></Form.Item>
        <Form.Item name="action" label="动作"><Input maxLength={64} placeholder="例如 login_failed" /></Form.Item>
        <Form.Item name="status" label="结果"><Select allowClear placeholder="全部结果" options={[{ value: "success", label: "成功" }, { value: "failed", label: "失败" }, { value: "error", label: "错误" }]} /></Form.Item>
        <Form.Item name="resourceType" label="资源类型"><Input maxLength={64} /></Form.Item>
        <Form.Item name="userId" label="操作者 ID"><Input maxLength={128} /></Form.Item>
        <Form.Item name="resourceId" label="资源 ID"><Input maxLength={128} /></Form.Item>
        <Form.Item name="correlationId" label="关联 ID（精确过滤）"><Input maxLength={128} /></Form.Item>
        <Form.Item name="startAt" label="开始时间（ISO 8601 含时区）"><Input maxLength={40} placeholder="2026-10-28T00:00:00Z" /></Form.Item>
        <Form.Item name="endAt" label="结束时间（ISO 8601 含时区）"><Input maxLength={40} placeholder="2026-10-28T23:59:59Z" /></Form.Item>
      </div>
      <Space wrap><Button type="primary" htmlType="submit">筛选</Button><Button onClick={clearFilters}>清除筛选</Button><span className="admin-help">排序固定为时间倒序；服务端校验所有过滤参数。</span></Space>
    </Form></section>
    <section className="admin-table-panel" aria-label="审计记录"><Table<AuditRecord> rowKey="id" dataSource={data.items} columns={columns} loading={loading} scroll={{ x: 1100 }} pagination={false} locale={{ emptyText: error ? "无法读取记录，请检查权限或服务状态。" : "没有匹配的审计记录。" }} />
      <Space style={{ padding: "16px 20px", justifyContent: "space-between", width: "100%" }} wrap><span>共 {data.total} 条；列表与详情由服务端脱敏。</span><Space><span>每页</span><Select aria-label="每页条数" value={pageSize} onChange={size => { setPage(1); setPageSize(size); }} options={[10, 20, 50, 100].map(value => ({ value, label: String(value) }))} /><Button disabled={page <= 1 || loading} onClick={() => setPage(value => value - 1)}>上一页</Button><span>第 {page} 页</span><Button disabled={page * pageSize >= data.total || loading} onClick={() => setPage(value => value + 1)}>下一页</Button></Space></Space>
    </section>
    <p className="admin-help">菜单只改善导航体验，`/api/admin/logs` 的 JWT/RBAC 与项目核心范围检查仍独立强制。页面没有原始日志导出或修改入口；关联 ID 只用于精确过滤，不在响应详情中显示原值。</p>
    <Modal title="审计安全详情" open={!!detail || detailLoading} onCancel={() => { setDetail(null); setDetailError(""); }} footer={<Button onClick={() => { setDetail(null); setDetailError(""); }}>关闭</Button>} destroyOnHidden>
      {detailLoading && <p role="status">正在读取脱敏详情…</p>}
      {detailError && <Alert type="error" showIcon title={detailError} />}
      {detail && <><Descriptions bordered size="small" column={1}>
        <Descriptions.Item label="记录 ID"><code>{safeId(detail.id)}</code></Descriptions.Item>
        <Descriptions.Item label="时间">{safeDate(detail.createdAt)}</Descriptions.Item>
        <Descriptions.Item label="模块 / 动作">{label(detail.module, modules)} / {label(detail.action, actions)}</Descriptions.Item>
        <Descriptions.Item label="结果">{label(detail.status, statuses)}</Descriptions.Item>
        <Descriptions.Item label="资源">{label(detail.resourceType, resourceTypes)} · <code>{safeId(detail.resourceId)}</code></Descriptions.Item>
        <Descriptions.Item label="操作者 ID"><code>{safeId(detail.userId)}</code></Descriptions.Item>
        <Descriptions.Item label="姓名 / IP / User-Agent">{[detail.userName, detail.ip, detail.userAgent].some(value => value != null) ? "已隐藏" : "—"}</Descriptions.Item>
        <Descriptions.Item label="接口">{label(detail.method, methods)} {safePath(detail.path)}</Descriptions.Item>
        <Descriptions.Item label="错误信息">{detail.errorMessage === null ? "—" : ["invalid_credentials", "permission_denied"].includes(detail.errorMessage) ? detail.errorMessage : "已隐藏"}</Descriptions.Item>
        <Descriptions.Item label="操作字段">{safeStrings(detail.requestSummary?.fields, fieldNames).join("、") || "—"}</Descriptions.Item>
        <Descriptions.Item label="所需权限">{safeStrings(detail.requestSummary?.requiredPermissions, permissionCodes).join("、") || "—"}</Descriptions.Item>
        <Descriptions.Item label="关联 ID">{detail.requestSummary && Object.hasOwn(detail.requestSummary, "correlationId") ? redacted : "—"}</Descriptions.Item>
        <Descriptions.Item label="前后快照">{[detail.beforeData, detail.afterData].some(value => value != null) ? "已隐藏" : "—"}</Descriptions.Item>
        <Descriptions.Item label="脱敏标记">{detail.redacted === true ? "已应用服务端安全投影" : redacted}</Descriptions.Item>
      </Descriptions><p className="admin-help">此页不显示姓名、网络地址、原始输入、未识别元数据、关联 ID 原值或前后快照。需要更改脱敏契约时必须先更新审计查询 API owner。</p></>}
    </Modal>
  </>;
}
