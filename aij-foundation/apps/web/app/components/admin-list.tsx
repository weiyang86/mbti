"use client";
import { Alert, Button, Input, Select, Space } from "antd";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { useAdmin } from "./admin-shell";
import { requestMessage } from "./admin-api";

export type PageResult<T> = { items: T[]; total: number; page: number; pageSize: number };
export function useAdminList<T>(path: string) {
  const { request } = useAdmin();
  const [page, setPage] = useState(1), [pageSize, setPageSize] = useState(20), [q, setQ] = useState(""), [status, setStatus] = useState<string | undefined>(), [revision, setRevision] = useState(0);
  const [data, setData] = useState<PageResult<T>>({ items: [], total: 0, page: 1, pageSize: 20 }), [loading, setLoading] = useState(false), [error, setError] = useState("");
  const sequence = useRef({ value: 0 });
  const load = useEffectEvent(async () => {
    const current = ++sequence.current.value; setLoading(true); setError("");
    const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize), ...(q ? { q } : {}), ...(status ? { status } : {}) });
    try { const result = await request<PageResult<T>>(path + "?" + query); if (current === sequence.current.value) { setData(result); if (!result.items.length && page > 1 && result.total > 0) setPage(Math.ceil(result.total / pageSize)); } }
    catch (failure) { if (current === sequence.current.value) { setError(requestMessage(failure)); setData({ items: [], total: 0, page, pageSize }); } }
    finally { if (current === sequence.current.value) setLoading(false); }
  });
  useEffect(() => { const control = sequence.current; const initial = setTimeout(() => void load(), 0); return () => { control.value++; clearTimeout(initial); }; }, [path, page, pageSize, q, status, revision]);
  return { data, loading, error, page, pageSize, status, reload: () => setRevision(v => v + 1), search: (value: string) => { setPage(1); setQ(value.trim()); }, filter: (value?: string) => { setPage(1); setStatus(value); }, paginate: (next: number, size: number) => { setPage(size === pageSize ? next : 1); setPageSize(size); } };
}
export function ListTools({ onSearch, status, onStatus, reload, placeholder }: { onSearch: (value: string) => void; status?: string; onStatus: (value?: string) => void; reload: () => void; placeholder: string }) {
  return <div className="admin-list-tools"><Input.Search aria-label={placeholder} placeholder={placeholder} maxLength={64} allowClear onSearch={onSearch} enterButton="搜索" /><Space><Select aria-label="状态筛选" value={status} placeholder="全部状态" allowClear onChange={onStatus} style={{ width: 132 }} options={[{ value: "active", label: "启用" }, { value: "disabled", label: "停用" }]} /><Button onClick={reload}>刷新</Button></Space></div>;
}
export function ManagementAlert({ error, success }: { error?: string; success?: string }) { return <>{error && <div role="alert" className="admin-feedback"><Alert title={error} type="error" showIcon /></div>}{success && <div role="status" className="admin-feedback"><Alert title={success} type="success" showIcon /></div>}</>; }
export async function allPages<T>(request: <R>(path: string) => Promise<R>, path: string): Promise<T[]> {
  const items: T[] = [];
  for (let page = 1; page <= 100; page++) { const result = await request<PageResult<T>>(path + (path.includes("?") ? "&" : "?") + "pageSize=100&page=" + page); items.push(...result.items); if (items.length >= result.total) return items; }
  throw new Error("Selection catalog too large");
}
