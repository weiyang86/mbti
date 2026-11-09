"use client";

import { PageHeading } from "@aij/ui";
import { Alert, Button, Form, Input, Select, Space, Table, Tag } from "antd";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { requestMessage } from "./admin-api";
import { useAdmin } from "./admin-shell";

type TraceStatus = "running" | "succeeded" | "failed";
type CostSource = "unreported" | "provider_reported";
type TraceShape = { redacted: true; kind: string; length?: string; fieldCount?: string } | null;
type Trace = {
  id: string; attempt: number; capabilityCode: string | null; providerCode: string | null; modelCode: string | null;
  status: TraceStatus | "unknown"; failureCategory: string | null; inputShape: TraceShape; outputShape: TraceShape;
  promptTokens: number | null; completionTokens: number | null; cachedTokens: number | null;
  costAmountNanos: string | null; costCurrency: string | null; costSource: CostSource;
  startedAt: string; completedAt: string | null;
};
type Result = { items: Trace[]; total: number; page: number; pageSize: number };
type Filters = { status?: TraceStatus; providerCode?: string; modelCode?: string; correlationId?: string; costSource?: CostSource; startAt?: string; endAt?: string };

const statusLabel: Record<string, string> = { running: "运行中", succeeded: "成功", failed: "失败", unknown: "未知" };
const safeDate = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : "—";
const safeShape = (value: TraceShape) => value ? `${value.kind}${value.length ? ` · ${value.length}` : ""}${value.fieldCount ? ` · ${value.fieldCount} 项` : ""}` : "—";
const safeError = (failure: unknown) => requestMessage(failure);

function queryPath(page: number, pageSize: number, filters: Filters) {
  const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  for (const [key, value] of Object.entries(filters)) if (typeof value === "string" && value.trim()) query.set(key, value.trim());
  return "/admin/ai/traces?" + query.toString();
}

export function AdminAiTraces() {
  const { request } = useAdmin();
  const [form] = Form.useForm<Filters>();
  const [filters, setFilters] = useState<Filters>({});
  const [page, setPage] = useState(1), [pageSize, setPageSize] = useState(25), [revision, setRevision] = useState(0);
  const [data, setData] = useState<Result>({ items: [], total: 0, page: 1, pageSize: 25 });
  const [loading, setLoading] = useState(false), [error, setError] = useState("");
  const sequence = useRef({ value: 0 });

  const load = useEffectEvent(async () => {
    const current = ++sequence.current.value;
    setLoading(true); setError("");
    try {
      const result = await request<Result>(queryPath(page, pageSize, filters));
      if (current === sequence.current.value) {
        setData(result);
        if (result.items.length === 0 && page > 1 && result.total > 0) setPage(Math.ceil(result.total / pageSize));
      }
    } catch (failure) {
      if (current === sequence.current.value) { setError(safeError(failure)); setData({ items: [], total: 0, page, pageSize }); }
    } finally { if (current === sequence.current.value) setLoading(false); }
  });
  useEffect(() => { const requestSequence = sequence.current; const timer = setTimeout(() => void load(), 0); return () => { requestSequence.value++; clearTimeout(timer); }; }, [page, pageSize, filters, revision]);

  function apply(values: Filters) {
    const next = Object.fromEntries(Object.entries(values).filter(([, value]) => typeof value === "string" && value.trim()).map(([key, value]) => [key, (value as string).trim()])) as Filters;
    setPage(1); setFilters(next);
  }
  function clearFilters() { form.resetFields(); setPage(1); setFilters({}); }

  const columns = [
    { title: "开始时间", dataIndex: "startedAt", key: "startedAt", render: safeDate },
    { title: "状态", dataIndex: "status", key: "status", render: (value: string) => <Tag color={value === "succeeded" ? "green" : value === "failed" ? "red" : "default"}>{statusLabel[value] ?? "未知"}</Tag> },
    { title: "能力", dataIndex: "capabilityCode", key: "capabilityCode", render: (value: string | null) => value ?? "—" },
    { title: "Provider / 模型", key: "provider", render: (_: unknown, row: Trace) => <>{row.providerCode ?? "未记录"}<div className="admin-cell-secondary">{row.modelCode ?? "未记录"}</div></> },
    { title: "Tokens", key: "tokens", render: (_: unknown, row: Trace) => <span>输入 {row.promptTokens ?? "—"} / 输出 {row.completionTokens ?? "—"} / 缓存 {row.cachedTokens ?? "—"}</span> },
    { title: "成本", key: "cost", render: (_: unknown, row: Trace) => <><span>{row.costAmountNanos === null ? "未报告" : `${row.costAmountNanos} 纳单位 ${row.costCurrency ?? ""}`}</span><div className="admin-cell-secondary">{row.costSource === "provider_reported" ? "Provider 报告" : "未报告"}</div></> },
    { title: "输入/输出形状", key: "shape", render: (_: unknown, row: Trace) => <><span>输入：{safeShape(row.inputShape)}</span><div className="admin-cell-secondary">输出：{safeShape(row.outputShape)}</div></> },
    { title: "失败分类", dataIndex: "failureCategory", key: "failureCategory", render: (value: string | null) => value ?? "—" }
  ];

  return <>
    <PageHeading eyebrow="AI 管理 · 运行记录" title="Trace / Cost 查询" description="按项目查看已持久化执行摘要和 Provider 报告成本。页面和接口均不返回提示词、模型输出、关联标识或凭据。" actions={<Button onClick={() => setRevision(value => value + 1)}>刷新</Button>} />
    {error && <div role="alert" className="admin-feedback"><Alert type="error" showIcon title={error} /></div>}
    <section className="admin-table-panel" aria-label="AI 执行记录筛选"><Form form={form} layout="vertical" onFinish={apply} preserve={false} style={{ padding: 20 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(175px, 1fr))", gap: "0 16px" }}>
        <Form.Item name="status" label="状态"><Select allowClear placeholder="全部状态" options={[{ value: "running", label: "运行中" }, { value: "succeeded", label: "成功" }, { value: "failed", label: "失败" }]} /></Form.Item>
        <Form.Item name="providerCode" label="Provider"><Input maxLength={64} /></Form.Item>
        <Form.Item name="modelCode" label="模型"><Input maxLength={64} /></Form.Item>
        <Form.Item name="correlationId" label="关联 ID（精确匹配，不显示）"><Input maxLength={128} /></Form.Item>
        <Form.Item name="costSource" label="成本来源"><Select allowClear placeholder="全部来源" options={[{ value: "provider_reported", label: "Provider 报告" }, { value: "unreported", label: "未报告" }]} /></Form.Item>
        <Form.Item name="startAt" label="开始时间（ISO 8601 含时区）"><Input maxLength={40} placeholder="2026-11-01T00:00:00Z" /></Form.Item>
        <Form.Item name="endAt" label="结束时间（ISO 8601 含时区）"><Input maxLength={40} placeholder="2026-11-01T23:59:59Z" /></Form.Item>
      </div>
      <Space wrap><Button type="primary" htmlType="submit">筛选</Button><Button onClick={clearFilters}>清除筛选</Button><span className="admin-help">时间倒序；关联 ID 仅参与精确过滤，不进入响应或查询审计。</span></Space>
    </Form></section>
    <section className="admin-table-panel" aria-label="Trace 和 Cost 记录"><Table<Trace> rowKey="id" dataSource={data.items} columns={columns} loading={loading} scroll={{ x: 1250 }} pagination={false} locale={{ emptyText: error ? "无法读取记录，请检查权限或服务状态。" : "没有匹配的执行记录。" }} />
      <Space style={{ padding: "16px 20px", justifyContent: "space-between", width: "100%" }} wrap><span>共 {data.total} 条；输入和输出仅显示脱敏形状。</span><Space><span>每页</span><Select aria-label="每页条数" value={pageSize} onChange={size => { setPage(1); setPageSize(size); }} options={[10, 25, 50, 100].map(value => ({ value, label: String(value) }))} /><Button disabled={page <= 1 || loading} onClick={() => setPage(value => value - 1)}>上一页</Button><span>第 {page} 页</span><Button disabled={page * pageSize >= data.total || loading} onClick={() => setPage(value => value + 1)}>下一页</Button></Space></Space>
    </section>
    <p className="admin-help">只读 API 由服务端强制执行 admin.runtime.read、当前项目范围和 aij-ai 插件启用状态；本页面权限只用于导航体验。</p>
  </>;
}
