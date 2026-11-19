"use client";
import { PageHeading } from "@aij/ui";

import { Alert, Button, Descriptions, Form, Input, Modal, Popconfirm, Space, Table, Tag } from "antd";
import { useState } from "react";
import { RequestFailure, requestMessage } from "./admin-api";
import { ListTools, ManagementAlert, useAdminList } from "./admin-list";
import { useAdmin } from "./admin-shell";

type Status = "active" | "disabled";
type SecretReference = { id: string; ref: string; provider: "env" | "local"; status: Status; configured: boolean; updatedAt: string };
type Editor = { kind: "create" } | { kind: "rotate"; row: SecretReference };

const stateTag = (value: Status) => <Tag color={value === "active" ? "green" : "default"}>{value === "active" ? "启用" : "已清除/停用"}</Tag>;
const configuredTag = (value: boolean) => <Tag color={value ? "green" : "orange"}>{value ? "已配置" : "未配置"}</Tag>;
function safeError(error: unknown) {
  if (error instanceof RequestFailure && error.status === 409) return "引用状态已被其他操作更新（409）。页面已刷新，请确认当前版本后重试。";
  return requestMessage(error);
}

export function AdminSecretReferences() {
  const { request, can } = useAdmin();
  const list = useAdminList<SecretReference>("/admin/secret-references");
  const [editor, setEditor] = useState<Editor | null>(null), [detail, setDetail] = useState<SecretReference | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [success, setSuccess] = useState("");
  const [form] = Form.useForm<{ ref: string }>();
  const writable = can("admin.secret.manage");

  function closeEditor() { if (busy) return; setEditor(null); form.resetFields(); }
  function openCreate() { form.resetFields(); setError(""); setSuccess(""); setEditor({ kind: "create" }); }
  function openRotate(row: SecretReference) { form.resetFields(); form.setFieldsValue({ ref: "" }); setError(""); setSuccess(""); setEditor({ kind: "rotate", row }); }

  async function saveReference() {
    if (!editor) return;
    let values: { ref: string };
    try { values = await form.validateFields(); } catch { return; }
    setBusy(true); setError(""); setSuccess("");
    try {
      const ref = values.ref.trim();
      const result = editor.kind === "create"
        ? await request<SecretReference>("/admin/secret-references", "POST", { ref })
        : await request<SecretReference>("/admin/secret-references/" + editor.row.id + "/rotate", "POST", { ref, expectedUpdatedAt: editor.row.updatedAt });
      setEditor(null); form.resetFields();
      setSuccess(`${editor.kind === "create" ? "引用已登记" : "引用已轮换"}；服务端状态为${result.configured ? "已配置" : "未配置"}。实际密钥值从不经此页面传输。`);
      list.reload();
    } catch (failure) { setError(safeError(failure)); if (failure instanceof RequestFailure && failure.status === 409) list.reload(); }
    finally { setBusy(false); }
  }

  async function checkReference(row: SecretReference) {
    setBusy(true); setError(""); setSuccess("");
    try {
      const result = await request<SecretReference>(`/admin/secret-references/${row.id}/check`, "POST", { expectedUpdatedAt: row.updatedAt });
      setSuccess(`本机引用状态检查完成：${result.configured ? "已配置" : "未配置"}。此结果不代表外部服务已连通。`); list.reload();
    } catch (failure) { setError(safeError(failure)); if (failure instanceof RequestFailure && failure.status === 409) list.reload(); }
    finally { setBusy(false); }
  }

  async function clearReference(row: SecretReference) {
    setBusy(true); setError(""); setSuccess("");
    try {
      await request<SecretReference>(`/admin/secret-references/${row.id}/clear`, "POST", { expectedUpdatedAt: row.updatedAt });
      setSuccess("引用已停用；服务端后续消费将拒绝该引用，来源环境变量或本机文件不会被删除。"); list.reload();
    } catch (failure) { setError(safeError(failure)); if (failure instanceof RequestFailure && failure.status === 409) list.reload(); }
    finally { setBusy(false); }
  }

  async function showDetail(row: SecretReference) {
    setBusy(true); setError(""); setSuccess("");
    try { setDetail(await request<SecretReference>(`/admin/secret-references/${row.id}`)); }
    catch (failure) { setError(safeError(failure)); }
    finally { setBusy(false); }
  }

  const columns = [
    { title: "引用", dataIndex: "ref", key: "ref", render: (value: string) => <code>{value}</code> },
    { title: "适配器", dataIndex: "provider", key: "provider", render: (value: SecretReference["provider"]) => value === "env" ? "环境变量" : "本机加密存储" },
    { title: "配置状态", dataIndex: "configured", key: "configured", render: configuredTag },
    { title: "引用状态", dataIndex: "status", key: "status", render: stateTag },
    { title: "最后更新", dataIndex: "updatedAt", key: "updatedAt" },
    { title: "操作", key: "actions", render: (_: unknown, row: SecretReference) => <Space wrap>
      <Button size="small" loading={busy} onClick={() => void showDetail(row)}>详情</Button>
      <Button size="small" disabled={!writable || busy} onClick={() => void checkReference(row)}>检查</Button>
      <Button size="small" disabled={!writable || busy} onClick={() => openRotate(row)}>轮换引用</Button>
      {row.status === "active" && <Popconfirm title="停用后服务端将拒绝后续消费；来源密钥值不会被删除。" onConfirm={() => void clearReference(row)}><Button size="small" danger disabled={!writable || busy}>清除</Button></Popconfirm>}
    </Space> }
  ];

  return <>
    <PageHeading eyebrow="系统管理 · SecretRef" title="密钥引用" description="管理服务端引用元数据。密钥值由本机环境或受保护的 SecretStore 维护。" actions={<Button type="primary" disabled={!writable || busy} onClick={openCreate}>登记引用</Button>} />
    <ManagementAlert error={error || list.error} success={success} />
    <Alert className="admin-feedback" type="info" showIcon message="本页不接收、不显示或复制密钥值。configured 仅表示当前项目环境中的本机适配器可解析该引用，不代表外部 Provider 已连通。清除会停用引用，不会删除环境变量或本机存储文件。" />
    <div className="admin-table-panel"><ListTools placeholder="搜索引用名称" onSearch={list.search} status={list.status} onStatus={list.filter} reload={list.reload} />
      <Table<SecretReference> rowKey="id" dataSource={list.data.items} columns={columns} loading={list.loading} pagination={{ current: list.page, pageSize: list.pageSize, total: list.data.total, showSizeChanger: true, onChange: list.paginate }} scroll={{ x: 950 }} />
    </div>
    <p className="admin-help">仅支持由后端命名空间校验的 env:// 和 local:// 引用。页面权限来自服务端菜单；创建、检查、轮换和清除仍由 SecretCenter API 独立执行 RBAC、范围检查、版本冲突和审计。</p>
    <Modal title={editor?.kind === "create" ? "登记 SecretRef" : "轮换到新 SecretRef"} open={!!editor} onCancel={closeEditor} onOk={() => void saveReference()} okText={editor?.kind === "create" ? "登记引用" : "轮换引用"} cancelText="取消" confirmLoading={busy} closable={!busy} maskClosable={!busy} cancelButtonProps={{ disabled: busy }} destroyOnHidden>
      {editor?.kind === "rotate" && <p className="admin-help">更新按当前记录时间戳提交。旧版本或并发修改会被服务端拒绝。</p>}
      <Alert className="admin-feedback" type="warning" showIcon message="只输入 SecretRef 标识，例如服务端认可的 env:// 或 local:// 路径；不要在此粘贴密码、Token、Key 或证书内容。对应值必须预先由服务器安全配置。" />
      <Form form={form} layout="vertical" preserve={false} requiredMark={false}>
        <Form.Item name="ref" label="SecretRef 引用" rules={[{ required: true, whitespace: true, max: 256 }]}><Input maxLength={256} autoComplete="off" spellCheck={false} placeholder="env://AIJ_SECRET_<项目>_<环境>_<名称>" /></Form.Item>
      </Form>
    </Modal>
    <Modal title="SecretRef 安全详情" open={!!detail} onCancel={() => setDetail(null)} footer={<Button onClick={() => setDetail(null)}>关闭</Button>} destroyOnHidden>
      {detail && <Descriptions column={1} bordered size="small"><Descriptions.Item label="引用"><code>{detail.ref}</code></Descriptions.Item><Descriptions.Item label="适配器">{detail.provider}</Descriptions.Item><Descriptions.Item label="引用状态">{stateTag(detail.status)}</Descriptions.Item><Descriptions.Item label="configured">{configuredTag(detail.configured)}</Descriptions.Item><Descriptions.Item label="更新时间">{detail.updatedAt}</Descriptions.Item></Descriptions>}
      <p className="admin-help">安全详情不包含 SecretStore 值、环境变量值、自由文本说明或解密材料。</p>
    </Modal>
  </>;
}
