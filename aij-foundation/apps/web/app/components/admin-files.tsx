"use client";
import { PageHeading } from "@aij/ui";

import { Alert, Button, Table, Tag } from "antd";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { RequestFailure, requestMessage } from "./admin-api";
import { useAdmin } from "./admin-shell";

type FileStatus = "active" | "missing" | "corrupt";
type FileRow = { id: string; originalName: string; mimeType: string; size: number; status: FileStatus; ownerId: string; createdAt: string };
type PageResult = { items: FileRow[]; total: number; page: number; pageSize: number };

const statusLabel: Record<FileStatus, string> = { active: "可用", missing: "文件缺失", corrupt: "校验失败" };
const sizeLabel = (size: number) => size < 1024 ? `${size} B` : size < 1024 * 1024 ? `${(size / 1024).toFixed(1)} KB` : `${(size / (1024 * 1024)).toFixed(1)} MB`;

export function AdminFiles() {
  const { request } = useAdmin();
  const [data, setData] = useState<PageResult>({ items: [], total: 0, page: 1, pageSize: 20 });
  const [page, setPage] = useState(1), [pageSize, setPageSize] = useState(20), [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true), [error, setError] = useState(""), [downloading, setDownloading] = useState<string | null>(null);
  const sequence = useRef({ value: 0 });

  const load = useEffectEvent(async () => {
    const current = ++sequence.current.value;
    setLoading(true); setError("");
    try {
      const value = await request<PageResult>(`/admin/files?page=${page}&pageSize=${pageSize}`);
      if (current === sequence.current.value) setData(value);
    } catch (failure) { if (current === sequence.current.value) { setError(requestMessage(failure)); setData({ items: [], total: 0, page, pageSize }); } }
    finally { if (current === sequence.current.value) setLoading(false); }
  });
  useEffect(() => {
    const control = sequence.current;
    const timer = setTimeout(() => void load(), 0);
    return () => { control.value++; clearTimeout(timer); };
  }, [page, pageSize, revision]);

  async function download(row: FileRow) {
    const base = process.env.NEXT_PUBLIC_API_URL;
    if (!base) { setError("暂时无法连接服务，请稍后重试。"); return; }
    setDownloading(row.id); setError("");
    try {
      const response = await fetch(`${base}/admin/files/${encodeURIComponent(row.id)}`, { credentials: "include", cache: "no-store", signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new RequestFailure(response.status);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob), link = document.createElement("a");
      link.href = url; link.download = row.originalName; link.rel = "noreferrer"; link.click();
      URL.revokeObjectURL(url);
    } catch (failure) { setError(requestMessage(failure)); }
    finally { setDownloading(null); }
  }

  const columns = [
    { title: "文件名", dataIndex: "originalName", key: "name" },
    { title: "类型", dataIndex: "mimeType", key: "type" },
    { title: "大小", dataIndex: "size", key: "size", render: (size: number) => sizeLabel(size) },
    { title: "上传者 ID", dataIndex: "ownerId", key: "owner" },
    { title: "状态", dataIndex: "status", key: "status", render: (status: FileStatus) => <Tag color={status === "active" ? "green" : "orange"}>{statusLabel[status] ?? "不可用"}</Tag> },
    { title: "上传时间", dataIndex: "createdAt", key: "createdAt", render: (value: string) => new Date(value).toLocaleString() },
    { title: "操作", key: "action", render: (_: unknown, row: FileRow) => <Button size="small" disabled={row.status !== "active"} loading={downloading === row.id} onClick={() => void download(row)}>查看 / 下载</Button> }
  ];

  return <>
    <PageHeading eyebrow="系统管理 · 文件" title="客户文件" description="仅列出本项目的通用客户文件。文件状态由服务端校验，页面和下载 API 均单独执行授权。" actions={<Button onClick={() => setRevision(value => value + 1)}>刷新</Button>} />
    {error && <div role="alert" className="admin-feedback"><Alert type="error" showIcon title={error} /></div>}
    <section className="admin-table-panel" aria-label="客户文件列表"><Table<FileRow> rowKey="id" dataSource={data.items} columns={columns} loading={loading} scroll={{ x: 900 }} pagination={{ current: page, pageSize, total: data.total, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100], onChange: (nextPage, nextSize) => { if (nextSize !== pageSize) setPage(1); else setPage(nextPage); setPageSize(nextSize); } }} locale={{ emptyText: error ? "无法读取文件，请检查权限或服务状态。" : "暂无客户文件。" }} /></section>
    <p className="admin-help">列表不包含本地路径、对象键或密钥。客户只能看到自己上传的文件；管理员范围限制在当前项目，其他项目的文件 ID 返回未找到。</p>
  </>;
}
