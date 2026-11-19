"use client";

import { PageHeading } from "@aij/ui";
import { Alert, Button, Input, Space, Table, Tag } from "antd";
import { useCallback, useEffect, useState } from "react";
import { adminApi, RequestFailure, requestMessage } from "./admin-api";
import { useAdmin } from "./admin-shell";

type Attempt = { attempt: number; status: "succeeded" | "failed"; failureCode: string | null; startedAt: string; completedAt: string };
type Operation = { id: string; connectorCode: string; type: "secret_reference_check"; status: "succeeded" | "failed";
  attemptCount: number; lastFailureCode: string | null; installationVersion: number; startedAt: string; completedAt: string; attempts: Attempt[] };
type PageResult = { items: Operation[]; total: number; page: number; pageSize: number };

const projectCodePattern = /^[a-z][a-z0-9-]{1,62}$/;

export function AdminIntegrationOperations() {
  const { request, can } = useAdmin();
  const [projectCode, setProjectCode] = useState("aij-foundation-test");
  const [activeProjectCode, setActiveProjectCode] = useState("aij-foundation-test");
  const [items, setItems] = useState<Operation[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const writable = can("admin.integration.manage");

  const load = useCallback(async (nextPage: number) => {
    const project = activeProjectCode;
    setLoading(true); setError("");
    try {
      const result = await adminApi<PageResult>(`/admin/integrations/projects/${encodeURIComponent(project)}/operations?page=${nextPage}&pageSize=20`);
      setItems(result.items); setTotal(result.total); setPage(result.page);
    } catch (failure) { setError(requestMessage(failure)); setItems([]); setTotal(0); }
    finally { setLoading(false); }
  }, [activeProjectCode]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(1); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function startReadinessCheck() {
    const project = activeProjectCode;
    setBusy(true); setError(""); setSuccess("");
    try {
      const result = await request<Operation>(`/admin/integrations/projects/${encodeURIComponent(project)}/connectors/aij-generic-webhook/operations`, "POST", { type: "secret_reference_check" });
      setSuccess(result.status === "succeeded" ? "本地 SecretRef 就绪检查成功。没有请求外部服务。" : "检查失败已保存，可在次数限制内重试。");
      await load(1);
    } catch (failure) { setError(requestMessage(failure)); }
    finally { setBusy(false); }
  }

  async function retry(operation: Operation) {
    setBusy(true); setError(""); setSuccess("");
    try {
      const result = await request<Operation>(`/admin/integrations/projects/${encodeURIComponent(activeProjectCode)}/operations/${encodeURIComponent(operation.id)}/retry`, "POST");
      setSuccess(result.status === "succeeded" ? "重试成功；操作记录已更新。" : "重试仍未成功；最近一次失败已记录。");
      await load(page);
    } catch (failure) {
      setError(failure instanceof RequestFailure && failure.status === 409 ? "该操作当前不可重试，或已达到重试次数上限。" : requestMessage(failure));
      if (failure instanceof RequestFailure && failure.status === 409) await load(page);
    } finally { setBusy(false); }
  }

  const columns = [
    { title: "操作编号", dataIndex: "id", key: "id", render: (value: string) => <code>{value}</code> },
    { title: "连接器", dataIndex: "connectorCode", key: "connectorCode" },
    { title: "结果", dataIndex: "status", key: "status", render: (value: Operation["status"]) => <Tag color={value === "succeeded" ? "green" : "red"}>{value === "succeeded" ? "成功" : "失败"}</Tag> },
    { title: "最近失败码", dataIndex: "lastFailureCode", key: "lastFailureCode", render: (value: string | null) => value ?? "—" },
    { title: "尝试次数", dataIndex: "attemptCount", key: "attemptCount" },
    { title: "安装版本", dataIndex: "installationVersion", key: "installationVersion" },
    { title: "重试", key: "retry", render: (_: unknown, row: Operation) => <Button size="small" disabled={!writable || busy || row.status !== "failed" || row.attemptCount >= 5} loading={busy} onClick={() => void retry(row)}>重试</Button> }
  ];

  return <>
    <PageHeading eyebrow="系统管理 · IntegrationCenter" title="连接器操作" description="查询本地 SecretRef 就绪检查并对失败记录执行受控重试。" />
    {error && <div role="alert" className="admin-feedback"><Alert type="error" showIcon message={error} /></div>}
    {success && <div role="status" className="admin-feedback"><Alert type="success" showIcon message={success} /></div>}
    <Alert className="admin-feedback" type="info" showIcon message="此页面只检查当前 SecretRef 是否可配置，不重放 webhook、不保存或回显密钥，也不请求第三方服务。连接器管理权限仍由 API 单独检查。" />
    <div className="admin-list-tools">
      <Input aria-label="项目代码" value={projectCode} onChange={event => setProjectCode(event.target.value)} maxLength={64} spellCheck={false} />
      <Space><Button onClick={() => { const project = projectCode.trim(); if (!projectCodePattern.test(project)) { setError("请输入有效项目代码。"); return; } setPage(1); setActiveProjectCode(project); }} loading={loading}>查询</Button><Button type="primary" disabled={!writable || busy} loading={busy} onClick={() => void startReadinessCheck()}>开始本地就绪检查</Button></Space>
    </div>
    <div className="admin-table-panel">
      <Table<Operation>
        rowKey="id"
        dataSource={items}
        columns={columns}
        loading={loading}
        pagination={{ current: page, pageSize: 20, total, showSizeChanger: false, onChange: next => void load(next) }}
        scroll={{ x: 980 }}
        expandable={{
          expandedRowRender: row => (
            <Table<Attempt>
              rowKey="attempt"
              dataSource={row.attempts}
              pagination={false}
              size="small"
              columns={[
                { title: "尝试", dataIndex: "attempt", key: "attempt" },
                { title: "状态", dataIndex: "status", key: "status" },
                { title: "失败码", dataIndex: "failureCode", key: "failureCode", render: (value: string | null) => value ?? "—" },
                { title: "开始", dataIndex: "startedAt", key: "startedAt" },
                { title: "结束", dataIndex: "completedAt", key: "completedAt" }
              ]}
            />
          )
        }}
      />
    </div>
    <p className="admin-help">操作状态和失败码只描述本地配置检查结果，不表示外部连接器已连通或 webhook 已投递。</p>
  </>;
}
