"use client";
import { PageHeading } from "@aij/ui";

import { Button, Checkbox, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Table, Tag } from "antd";
import { useState } from "react";
import { useAdmin } from "./admin-shell";
import { requestMessage } from "./admin-api";
import { ListTools, ManagementAlert, useAdminList } from "./admin-list";

type Status = "active" | "disabled";
type Dictionary = { id: string; dictCode: string; dictName: string; description: string | null; sortOrder: number; status: Status; isPublic: boolean; pluginCode: string | null };
type DictionaryItem = { id: string; dictId: string; itemValue: string; itemLabel: string; description: string | null; sortOrder: number; status: Status };
type Editor = { kind: "create" | "edit"; row?: Dictionary };

const statusTag = (status: Status) => <Tag color={status === "active" ? "green" : "default"}>{status === "active" ? "启用" : "停用"}</Tag>;

export function AdminDictionaries() {
  const { request, can } = useAdmin();
  const list = useAdminList<Dictionary>("/admin/dicts");
  const [editor, setEditor] = useState<Editor | null>(null), [selected, setSelected] = useState<Dictionary | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [success, setSuccess] = useState("");
  const [form] = Form.useForm();

  function closeEditor() { setEditor(null); form.resetFields(); }
  function openEditor(kind: Editor["kind"], row?: Dictionary) {
    setError(""); setSuccess(""); form.resetFields();
    if (row) form.setFieldsValue({ dictName: row.dictName, description: row.description ?? "", sortOrder: row.sortOrder, status: row.status, isPublic: row.isPublic });
    setEditor({ kind, row });
  }
  async function saveCategory() {
    if (!editor) return;
    let values: Record<string, unknown>;
    try { values = await form.validateFields(); } catch { return; }
    setBusy(true); setError(""); setSuccess("");
    try {
      if (editor.kind === "create") {
        const body = { dictCode: String(values.dictCode).trim(), dictName: String(values.dictName).trim(), description: String(values.description ?? "").trim() || null, sortOrder: values.sortOrder ?? 0, isPublic: values.isPublic === true };
        await request("/admin/dicts", "POST", body);
        setSuccess("字典分类已创建。分类编码创建后不可修改；重复编码会被服务端拒绝。");
      } else {
        const body = { dictName: String(values.dictName).trim(), description: String(values.description ?? "").trim() || null, sortOrder: values.sortOrder ?? 0, status: values.status, isPublic: values.isPublic === true };
        await request("/admin/dicts/" + editor.row!.id, "PATCH", body);
        setSuccess("字典分类已更新。");
      }
      closeEditor(); list.reload();
    } catch (failure) { setError(requestMessage(failure)); }
    finally { setBusy(false); }
  }
  async function toggle(row: Dictionary) {
    setBusy(true); setError(""); setSuccess("");
    try {
      await request("/admin/dicts/" + row.id, "PATCH", { status: row.status === "active" ? "disabled" : "active" });
      setSuccess(row.status === "active" ? "分类已停用，公开读取将隐藏该分类及条目。" : "分类已启用。"); list.reload();
    } catch (failure) { setError(requestMessage(failure)); }
    finally { setBusy(false); }
  }
  async function remove(row: Dictionary) {
    setBusy(true); setError(""); setSuccess("");
    try { await request("/admin/dicts/" + row.id, "DELETE"); setSuccess("分类已软删除，历史编码仍保留。 "); list.reload(); if (selected?.id === row.id) setSelected(null); }
    catch (failure) { setError(requestMessage(failure)); }
    finally { setBusy(false); }
  }

  const writable = (row: Dictionary) => can("admin.dict.manage") && row.pluginCode === null;
  const columns = [
    { title: "分类编码", dataIndex: "dictCode", key: "dictCode", sorter: (a: Dictionary, b: Dictionary) => a.dictCode.localeCompare(b.dictCode), render: (value: string) => <code>{value}</code> },
    { title: "分类名称", dataIndex: "dictName", key: "dictName", sorter: (a: Dictionary, b: Dictionary) => a.dictName.localeCompare(b.dictName) },
    { title: "顺序", dataIndex: "sortOrder", key: "sortOrder", sorter: (a: Dictionary, b: Dictionary) => a.sortOrder - b.sortOrder },
    { title: "状态", dataIndex: "status", key: "status", render: (value: Status) => statusTag(value) },
    { title: "公开读取", dataIndex: "isPublic", key: "isPublic", render: (value: boolean) => value ? "是" : "否" },
    { title: "归属", key: "owner", render: (_: unknown, row: Dictionary) => row.pluginCode ? <Tag>{row.pluginCode}</Tag> : <Tag color="blue">底座自定义</Tag> },
    { title: "操作", key: "actions", render: (_: unknown, row: Dictionary) => <Space wrap>
      <Button size="small" onClick={() => setSelected(row)}>{can("admin.dict.manage") ? "管理条目" : "查看条目"}</Button>
      <Button size="small" disabled={!writable(row)} onClick={() => openEditor("edit", row)}>编辑</Button>
      <Popconfirm title={row.status === "active" ? "停用后公开读取会隐藏此分类和条目。" : "重新启用此分类？"} onConfirm={() => void toggle(row)}><Button size="small" disabled={!writable(row)} loading={busy}>{row.status === "active" ? "停用" : "启用"}</Button></Popconfirm>
      <Popconfirm title="分类仍有未删除条目时不能删除。" onConfirm={() => void remove(row)}><Button size="small" danger disabled={!writable(row)} loading={busy}>删除</Button></Popconfirm>
    </Space> }
  ];

  if (selected) return <DictionaryItems dictionary={selected} onBack={() => setSelected(null)} />;
  return <>
    <PageHeading eyebrow="系统管理 · 通用字典" title="字典分类" description={can("admin.dict.manage") ? "管理底座自定义分类与条目。业务分类由对应插件注册。" : "当前为只读权限，可查看分类与条目。"} actions={<Button type="primary" disabled={!can("admin.dict.manage")} onClick={() => openEditor("create")}>新建分类</Button>} />
    <ManagementAlert error={error || list.error} success={success} />
    <div className="admin-table-panel"><ListTools placeholder="搜索分类编码或名称" onSearch={list.search} status={list.status} onStatus={list.filter} reload={list.reload} />
      <Table<Dictionary> rowKey="id" dataSource={list.data.items} columns={columns} loading={list.loading} pagination={{ current: list.page, pageSize: list.pageSize, total: list.data.total, showSizeChanger: true, onChange: list.paginate }} scroll={{ x: 1000 }} />
    </div>
    <p className="admin-help">列表分页由服务端执行；表格排序作用于当前页。分类删除为软删除；编码唯一占位保留。页面权限不替代每个管理 API 的服务端授权。</p>
    <Modal title={editor?.kind === "create" ? "新建字典分类" : "编辑字典分类"} open={!!editor} onCancel={closeEditor} onOk={() => void saveCategory()} okText="保存" cancelText="取消" confirmLoading={busy} closable={!busy} maskClosable={!busy} cancelButtonProps={{ disabled: busy }} destroyOnHidden>
      <ManagementAlert error={error} />
      <Form form={form} layout="vertical" preserve={false} requiredMark={false}>
        {editor?.kind === "create" && <Form.Item name="dictCode" label="分类编码" rules={[{ required: true, min: 8, max: 96 }, { pattern: /^custom\.[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/, message: "自定义编码须以 custom. 开始，只能使用小写字母、数字、点、下划线或短横线。" }]}><Input maxLength={96} autoComplete="off" placeholder="custom.example.status" /></Form.Item>}
        <Form.Item name="dictName" label="分类名称" rules={[{ required: true, whitespace: true, max: 64 }]}><Input maxLength={64} /></Form.Item>
        <Form.Item name="description" label="说明"><Input.TextArea maxLength={256} showCount /></Form.Item>
        <Form.Item name="sortOrder" label="排序值"><InputNumber min={-10000} max={10000} precision={0} style={{ width: "100%" }} /></Form.Item>
        {editor?.kind === "edit" && <Form.Item name="status" label="状态" rules={[{ required: true }]}><Select options={[{ value: "active", label: "启用" }, { value: "disabled", label: "停用" }]} /></Form.Item>}
        <Form.Item name="isPublic" valuePropName="checked"><Checkbox>允许匿名公开读取有效条目</Checkbox></Form.Item>
      </Form>
    </Modal>
  </>;
}

function DictionaryItems({ dictionary, onBack }: { dictionary: Dictionary; onBack: () => void }) {
  const { request, can } = useAdmin();
  const list = useAdminList<DictionaryItem>("/admin/dicts/" + dictionary.id + "/items");
  const [editing, setEditing] = useState<DictionaryItem | null | undefined>(undefined), [busy, setBusy] = useState(false), [error, setError] = useState(""), [success, setSuccess] = useState("");
  const [form] = Form.useForm();
  const mutable = can("admin.dict.manage") && dictionary.pluginCode === null;
  function close() { setEditing(undefined); form.resetFields(); }
  function open(row?: DictionaryItem) { setError(""); setSuccess(""); form.resetFields(); if (row) form.setFieldsValue({ itemLabel: row.itemLabel, description: row.description ?? "", sortOrder: row.sortOrder, status: row.status }); setEditing(row ?? null); }
  async function save() {
    if (editing === undefined) return;
    let values: Record<string, unknown>; try { values = await form.validateFields(); } catch { return; }
    setBusy(true); setError(""); setSuccess("");
    try {
      if (editing) await request("/admin/dict-items/" + editing.id, "PATCH", { itemLabel: String(values.itemLabel).trim(), description: String(values.description ?? "").trim() || null, sortOrder: values.sortOrder ?? 0, ...(dictionary.status === "active" ? { status: values.status } : {}) });
      else await request("/admin/dicts/" + dictionary.id + "/items", "POST", { itemValue: String(values.itemValue).trim(), itemLabel: String(values.itemLabel).trim(), description: String(values.description ?? "").trim() || null, sortOrder: values.sortOrder ?? 0 });
      setSuccess(editing ? "条目已更新。" : "条目已创建。条目值在分类内唯一且创建后不可修改。"); close(); list.reload();
    } catch (failure) { setError(requestMessage(failure)); }
    finally { setBusy(false); }
  }
  async function remove(row: DictionaryItem) {
    setBusy(true); setError(""); setSuccess("");
    try { await request("/admin/dict-items/" + row.id, "DELETE"); setSuccess("条目已软删除，历史值仍保留。"); list.reload(); }
    catch (failure) { setError(requestMessage(failure)); }
    finally { setBusy(false); }
  }
  async function toggle(row: DictionaryItem) {
    setBusy(true); setError(""); setSuccess("");
    try { await request("/admin/dict-items/" + row.id, "PATCH", { status: row.status === "active" ? "disabled" : "active" }); setSuccess("条目状态已更新。"); list.reload(); }
    catch (failure) { setError(requestMessage(failure)); }
    finally { setBusy(false); }
  }
  const columns = [
    { title: "条目值", dataIndex: "itemValue", key: "itemValue", sorter: (a: DictionaryItem, b: DictionaryItem) => a.itemValue.localeCompare(b.itemValue), render: (value: string) => <code>{value}</code> },
    { title: "显示名称", dataIndex: "itemLabel", key: "itemLabel", sorter: (a: DictionaryItem, b: DictionaryItem) => a.itemLabel.localeCompare(b.itemLabel) },
    { title: "排序值", dataIndex: "sortOrder", key: "sortOrder", sorter: (a: DictionaryItem, b: DictionaryItem) => a.sortOrder - b.sortOrder },
    { title: "状态", dataIndex: "status", key: "status", render: (value: Status) => statusTag(value) },
    { title: "操作", key: "actions", render: (_: unknown, row: DictionaryItem) => <Space wrap>
      <Button size="small" disabled={!mutable} onClick={() => open(row)}>编辑</Button>
      <Popconfirm title={row.status === "active" ? "停用后公开读取会隐藏此条目。" : "重新启用此条目？"} onConfirm={() => void toggle(row)}><Button size="small" disabled={!mutable || dictionary.status !== "active" && row.status === "disabled"} loading={busy}>{row.status === "active" ? "停用" : "启用"}</Button></Popconfirm>
      <Popconfirm title="软删除后历史编码仍会占用。" onConfirm={() => void remove(row)}><Button size="small" danger disabled={!mutable} loading={busy}>删除</Button></Popconfirm>
    </Space> }
  ];
  const canCreate = mutable && dictionary.status === "active";
  return <>
    <PageHeading eyebrow="系统管理 · 字典条目" title={dictionary.dictName} description={<><code>{dictionary.dictCode}</code> · 分类状态：{statusTag(dictionary.status)} · {dictionary.pluginCode ? `插件归属：${dictionary.pluginCode}` : "底座自定义"}</>} actions={<Space><Button onClick={onBack}>返回分类</Button><Button type="primary" disabled={!canCreate} onClick={() => open()}>新建条目</Button></Space>} />
    {dictionary.status !== "active" && <ManagementAlert error="该分类已停用，不能新增或重新启用条目；公开读取会隐藏全部条目。" />}
    <ManagementAlert error={error || list.error} success={success} />
    <div className="admin-table-panel"><ListTools placeholder="搜索条目值或显示名称" onSearch={list.search} status={list.status} onStatus={list.filter} reload={list.reload} />
      <Table<DictionaryItem> rowKey="id" dataSource={list.data.items} columns={columns} loading={list.loading} pagination={{ current: list.page, pageSize: list.pageSize, total: list.data.total, showSizeChanger: true, onChange: list.paginate }} scroll={{ x: 740 }} />
    </div>
    <p className="admin-help">条目值创建后不可修改；停用或软删除的条目不会出现在公开读取中。分类/条目变更使用服务端审计。</p>
    <Modal title={editing ? "编辑字典条目" : "新建字典条目"} open={editing !== undefined} onCancel={close} onOk={() => void save()} okText="保存" cancelText="取消" confirmLoading={busy} closable={!busy} maskClosable={!busy} cancelButtonProps={{ disabled: busy }} destroyOnHidden>
      <ManagementAlert error={error} />
      <Form form={form} layout="vertical" preserve={false} requiredMark={false}>
        {!editing && <Form.Item name="itemValue" label="条目值" rules={[{ required: true, min: 1, max: 64 }, { pattern: /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/, message: "使用以小写字母开头的稳定标识。" }]}><Input maxLength={64} autoComplete="off" /></Form.Item>}
        <Form.Item name="itemLabel" label="显示名称" rules={[{ required: true, whitespace: true, max: 64 }]}><Input maxLength={64} /></Form.Item>
        <Form.Item name="description" label="说明"><Input.TextArea maxLength={256} showCount /></Form.Item>
        <Form.Item name="sortOrder" label="排序值"><InputNumber min={-10000} max={10000} precision={0} style={{ width: "100%" }} /></Form.Item>
        {editing && <Form.Item name="status" label="状态" rules={[{ required: true }]}><Select disabled={dictionary.status !== "active"} options={[{ value: "active", label: "启用" }, { value: "disabled", label: "停用" }]} /></Form.Item>}
      </Form>
    </Modal>
  </>;
}
