"use client";
import { PageHeading } from "@aij/ui";
import { Button, Form, Input, Modal, Select, Space, Table, Tag } from "antd";
import { useState } from "react";
import { useAdmin } from "./admin-shell";
import { requestMessage } from "./admin-api";
import { allPages, ListTools, ManagementAlert, useAdminList } from "./admin-list";

type User = { id: string; username: string; realName: string; email: string | null; phone: string | null; status: string; isSuperAdmin: boolean; roleIds: string[]; roleCodes: string[] };
type Role = { id: string; roleName: string; roleCode: string; status: string };
type Edit = { kind: "create" | "edit" | "password" | "roles"; user?: User };
export function AdminUsers() {
  const { session, permissions, request, can } = useAdmin(), list = useAdminList<User>("/admin/users");
  const [edit, setEdit] = useState<Edit | null>(null), [confirm, setConfirm] = useState<{ user: User; kind: "status" | "delete" } | null>(null), [roles, setRoles] = useState<Role[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [success, setSuccess] = useState(""); const [form] = Form.useForm();
  const allowed = (user: User) => can("admin.user.manage") && (!user.isSuperAdmin || permissions.isSuperAdmin);
  function clear() { setEdit(null); form.resetFields(); }
  async function open(kind: Edit["kind"], user?: User) {
    setError(""); setSuccess(""); form.resetFields(); setBusy(true);
    try {
      const target = user ? await request<User>("/admin/users/" + user.id) : undefined;
      if (kind === "roles") {
        const choices = await allPages<Role>(request, "/admin/roles?status=active"); setRoles(choices);
        form.setFieldsValue({ roleIds: target?.roleIds });
      } else if (kind === "edit") form.setFieldsValue({ realName: target?.realName, email: target?.email ?? "", phone: target?.phone ?? "" });
      setEdit({ kind, user: target });
    } catch (failure) { setError(requestMessage(failure)); }
    finally { setBusy(false); }
  }
  async function save() {
    if (!edit) return;
    let values; try { values = await form.validateFields(); } catch { return; }
    setBusy(true); setError(""); setSuccess("");
    try {
      const base = "/admin/users", id = edit.user?.id;
      if (edit.kind === "password") await request(base + "/" + id + "/reset-password", "PATCH", { password: values.password });
      else if (edit.kind === "roles") await request(base + "/" + id, "PATCH", { roleIds: values.roleIds ?? [] });
      else { const body = { ...values, email: values.email?.trim() || null, phone: values.phone?.trim() || null }; await request(edit.kind === "create" ? base : base + "/" + id, edit.kind === "create" ? "POST" : "PATCH", body); }
      setSuccess(edit.kind === "password" ? "凭据已重置，该账号的旧会话已失效。" : "保存成功。"); clear(); list.reload();
    } catch (failure) { setError(requestMessage(failure)); }
    finally { setBusy(false); }
  }
  async function commit() {
    if (!confirm) return; setBusy(true); setError(""); setSuccess("");
    try {
      await request("/admin/users/" + confirm.user.id + (confirm.kind === "status" ? "/status" : ""), confirm.kind === "status" ? "PATCH" : "DELETE", confirm.kind === "status" ? { enabled: confirm.user.status !== "active" } : undefined);
      setSuccess(confirm.kind === "delete" ? "用户已删除。" : "状态已更新。"); setConfirm(null); list.reload();
    } catch (failure) { setError(requestMessage(failure)); }
    finally { setBusy(false); }
  }
  return <><PageHeading eyebrow="身份与权限" title="管理员用户" description="维护管理员资料、角色和账号状态。" actions={<Button type="primary" disabled={busy || !can("admin.user.manage")} onClick={() => void open("create")}>新增管理员</Button>} />
    <ManagementAlert error={error || list.error} success={success} /><div className="admin-table-panel"><ListTools onSearch={list.search} status={list.status} onStatus={list.filter} reload={list.reload} placeholder="搜索账号或姓名" />
      <Table<User> rowKey="id" dataSource={list.data.items} loading={list.loading} scroll={{ x: 900 }} locale={{ emptyText: "没有匹配的管理员，请调整筛选或新增账号。" }} pagination={{ current: list.page, pageSize: list.pageSize, total: list.data.total, onChange: list.paginate, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100], showTotal: total => `共 ${total} 位管理员` }} columns={[
        { title: "账号 / 姓名", key: "identity", render: (_, user) => <div><strong>{user.username}</strong><div className="admin-cell-secondary">{user.realName}</div></div> },
        { title: "角色", key: "roles", render: (_, user) => user.isSuperAdmin ? <Tag color="green">系统管理员</Tag> : user.roleCodes.length ? user.roleCodes.map(code => <Tag key={code}>{code}</Tag>) : <span className="admin-cell-secondary">未分配角色</span> },
        { title: "状态", key: "status", render: (_, user) => <Tag color={user.status === "active" ? "green" : "default"}>{user.status === "active" ? "启用" : "停用"}</Tag> },
        { title: "操作", key: "actions", render: (_, user) => <Space wrap size={4}>
          <Button size="small" disabled={busy || !allowed(user)} onClick={() => void open("edit", user)}>编辑</Button>
          {permissions.isSuperAdmin && can("admin.role.manage") && <Button size="small" disabled={busy} onClick={() => void open("roles", user)}>分配角色</Button>}
          <Button size="small" disabled={busy || !allowed(user) || user.id === session.user.id} onClick={() => setConfirm({ user, kind: "status" })}>{user.status === "active" ? "停用" : "启用"}</Button>
          <Button size="small" disabled={busy || !allowed(user) || user.id === session.user.id} onClick={() => void open("password", user)}>重置凭据</Button>
          <Button size="small" danger disabled={busy || !allowed(user) || user.id === session.user.id} onClick={() => setConfirm({ user, kind: "delete" })}>删除</Button>
        </Space> }
      ]} />
    </div><p className="admin-help">你不能停用或删除自己。重置凭据和停用会使该账号的旧会话失效；系统保留最后一位有效系统管理员。</p>
    <Modal title={edit?.kind === "create" ? "新增管理员" : edit?.kind === "password" ? "重置凭据" : edit?.kind === "roles" ? "分配角色" : "编辑管理员"} open={!!edit} onCancel={clear} onOk={() => void save()} okText="保存" cancelText="取消" confirmLoading={busy} closable={!busy} maskClosable={!busy} cancelButtonProps={{ disabled: busy }} destroyOnHidden>
      <ManagementAlert error={error} /><Form form={form} layout="vertical" preserve={false} requiredMark={false}>
        {edit?.kind === "create" && <Form.Item name="username" label="账号" rules={[{ required: true, message: "请输入账号" }, { pattern: /^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/, message: "3–64位字母、数字、点、下划线或短横线" }]}><Input autoComplete="off" maxLength={64} /></Form.Item>}
        {(edit?.kind === "create" || edit?.kind === "edit") && <><Form.Item name="realName" label="姓名" rules={[{ required: true, whitespace: true, message: "请输入姓名" }, { max: 64 }]}><Input maxLength={64} /></Form.Item><Form.Item name="email" label="邮箱" rules={[{ type: "email", message: "请输入有效邮箱" }, { max: 254 }]}><Input maxLength={254} /></Form.Item><Form.Item name="phone" label="电话"><Input maxLength={32} /></Form.Item></>}
        {(edit?.kind === "create" || edit?.kind === "password") && <><p className="admin-help">使用独立随机凭据，20–72位，至少包含大小写字母、数字、符号中的三类；不要使用模板或默认密码。</p><Form.Item name="password" label="新密码" rules={[{ required: true, message: "请输入新密码" }, { min: 20, max: 72, message: "密码长度须为20–72位" }]}><Input.Password autoComplete="new-password" maxLength={72} /></Form.Item></>}
        {edit?.kind === "roles" && <><p className="admin-help">以此选择完整替换角色。清空会撤销全部角色授权。</p><Form.Item name="roleIds" label="角色" rules={[{ type: "array", max: 20, message: "最多选择20个角色" }]}><Select mode="multiple" allowClear optionFilterProp="label" options={[...roles.map(role => ({ value: role.id, label: `${role.roleName} (${role.roleCode})` })), ...(edit.user?.roleIds ?? []).filter(id => !roles.some(role => role.id === id)).map(id => ({ value: id, label: "已停用或删除的角色，请移除", disabled: true }))]} /></Form.Item></>}
      </Form>
    </Modal><Modal title={confirm?.kind === "delete" ? "删除管理员" : confirm?.user.status === "active" ? "停用管理员" : "启用管理员"} open={!!confirm} onCancel={() => setConfirm(null)} onOk={() => void commit()} okText="确认" cancelText="取消" confirmLoading={busy} cancelButtonProps={{ disabled: busy }} closable={!busy} maskClosable={!busy}><ManagementAlert error={error} /><p>确认操作账号「{confirm?.user.username}」？</p><p>{confirm?.kind === "delete" ? "该账号将被停用并从列表中移除，历史审计保留。" : confirm?.user.status === "active" ? "该账号将无法登录，现有会话立即失效。" : "该账号可以重新登录，旧会话不会恢复。"}</p></Modal>
  </>;
}
