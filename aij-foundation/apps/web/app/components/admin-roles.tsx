"use client";
import { PageHeading } from "@aij/ui";

import { Alert, Button, Checkbox, Form, Input, Modal, Popconfirm, Select, Space, Table, Tag } from "antd";
import { useState } from "react";
import { useAdmin } from "./admin-shell";
import { requestMessage } from "./admin-api";
import { allPages, ListTools, ManagementAlert, useAdminList } from "./admin-list";

type Role = { id: string; roleCode: string; roleName: string; status: "active" | "disabled"; remark: string | null; permissionIds: string[] };
type Permission = { id: string; permissionCode: string; permissionName: string; resourceType: "menu" | "button" | "api" | "data"; module: string; action: string; apiPath: string | null; status: "active" | "disabled" };
type RoleValues = { roleCode?: string; roleName: string; remark?: string | null };
type PermissionValues = { permissionCode: string; permissionName: string; resourceType: Permission["resourceType"]; action: string; apiPath?: string | null };

export function AdminRoles() {
  const { request, permissions } = useAdmin();
  const roles = useAdminList<Role>("/admin/roles");
  const [roleForm] = Form.useForm<RoleValues>();
  const [editingRole, setEditingRole] = useState<Role | null>(null), [roleOpen, setRoleOpen] = useState(false), [roleSaving, setRoleSaving] = useState(false);
  const [assignmentRole, setAssignmentRole] = useState<Role | null>(null), [assignmentCatalog, setAssignmentCatalog] = useState<Permission[]>([]), [selectedPermissions, setSelectedPermissions] = useState<string[]>([]), [assignmentLoading, setAssignmentLoading] = useState(false);
  const [feedback, setFeedback] = useState({ error: "", success: "" });
  const canManageDefinitions = permissions.effectivePermissions.includes("admin.permission.manage");

  function openRole(role?: Role) {
    setEditingRole(role ?? null); roleForm.setFieldsValue(role ? { roleName: role.roleName, remark: role.remark } : { roleCode: "", roleName: "", remark: "" }); setRoleOpen(true);
  }
  async function saveRole(values: RoleValues) {
    setRoleSaving(true); setFeedback({ error: "", success: "" });
    try {
      if (editingRole) await request(`/admin/roles/${editingRole.id}`, "PATCH", { roleName: values.roleName, remark: values.remark ?? null });
      else await request("/admin/roles", "POST", { roleCode: values.roleCode, roleName: values.roleName, remark: values.remark ?? null });
      setRoleOpen(false); roleForm.resetFields(); roles.reload(); setFeedback({ error: "", success: editingRole ? "角色已更新。" : "角色已创建。" });
    } catch (error) { setFeedback({ error: requestMessage(error), success: "" }); }
    finally { setRoleSaving(false); }
  }
  async function changeRoleStatus(role: Role) {
    try { await request(`/admin/roles/${role.id}/status`, "PATCH", { enabled: role.status !== "active" }); roles.reload(); setFeedback({ error: "", success: role.status === "active" ? "角色已停用。" : "角色已启用。" }); }
    catch (error) { setFeedback({ error: requestMessage(error), success: "" }); }
  }
  async function removeRole(role: Role) {
    try { await request(`/admin/roles/${role.id}`, "DELETE"); roles.reload(); setFeedback({ error: "", success: "角色已停用并归档。" }); }
    catch (error) { setFeedback({ error: requestMessage(error), success: "" }); }
  }
  async function openAssignment(role: Role) {
    if (!permissions.isSuperAdmin || !canManageDefinitions || role.status !== "active") return;
    setAssignmentLoading(true); setFeedback({ error: "", success: "" });
    try { const catalog = await allPages<Permission>(request, "/admin/permissions/manage?status=active"); setAssignmentCatalog(catalog); setSelectedPermissions(role.permissionIds); setAssignmentRole(role); }
    catch (error) { setFeedback({ error: requestMessage(error), success: "" }); }
    finally { setAssignmentLoading(false); }
  }
  async function saveAssignment() {
    if (!assignmentRole) return;
    setAssignmentLoading(true);
    try { await request(`/admin/roles/${assignmentRole.id}/permissions`, "PUT", { permissionIds: selectedPermissions }); setAssignmentRole(null); roles.reload(); await request("/admin/permissions/my"); setFeedback({ error: "", success: "角色权限已原子替换；新授权立即生效。" }); }
    catch (error) { setFeedback({ error: requestMessage(error), success: "" }); }
    finally { setAssignmentLoading(false); }
  }

  const roleColumns = [
    { title: "角色", key: "role", render: (_: unknown, row: Role) => <><strong>{row.roleName}</strong><div className="admin-cell-secondary">{row.roleCode}</div></> },
    { title: "状态", dataIndex: "status", key: "status", render: (value: Role["status"]) => <Tag color={value === "active" ? "green" : "default"}>{value === "active" ? "启用" : "停用"}</Tag> },
    { title: "授权", key: "permissions", render: (_: unknown, row: Role) => <span>{row.permissionIds.length} 项{row.remark ? <div className="admin-cell-secondary">{row.remark}</div> : null}</span> },
    { title: "操作", key: "actions", render: (_: unknown, row: Role) => {
      const codeOwned = row.roleCode.startsWith("aij_") || row.roleCode === "super_admin";
      return <Space wrap>
      <Button size="small" disabled={codeOwned} onClick={() => openRole(row)}>编辑</Button>
      <Button size="small" disabled={codeOwned || !permissions.isSuperAdmin || !canManageDefinitions || row.status !== "active"} loading={assignmentLoading} onClick={() => void openAssignment(row)}>配置权限</Button>
      <Popconfirm title={row.status === "active" ? "停用后该角色权限立即失效。" : "重新启用此角色？"} onConfirm={() => void changeRoleStatus(row)}><Button size="small" disabled={codeOwned}>{row.status === "active" ? "停用" : "启用"}</Button></Popconfirm>
      <Popconfirm title="归档会停用角色并清除权限绑定，用户关联保留。" onConfirm={() => void removeRole(row)}><Button size="small" danger disabled={codeOwned}>归档</Button></Popconfirm>
    </Space>;
    }
    },
  ];

  return <>
    <PageHeading eyebrow="身份与权限" title="角色与权限" description="角色授权由服务端即时解析；页面控件不替代 API 守卫。" actions={<Button type="primary" onClick={() => openRole()}>新建角色</Button>} />
    <ManagementAlert error={feedback.error || roles.error} success={feedback.success} />
    <section className="admin-table-panel" aria-label="角色列表">
      <ListTools placeholder="搜索角色编码或名称" onSearch={roles.search} status={roles.status} onStatus={roles.filter} reload={roles.reload} />
      <Table<Role> rowKey="id" dataSource={roles.data.items} columns={roleColumns} loading={roles.loading} pagination={{ current: roles.page, pageSize: roles.pageSize, total: roles.data.total, showSizeChanger: true, onChange: roles.paginate }} scroll={{ x: 760 }} />
    </section>
    <p className="admin-help">停用会立即撤销该角色的 API 权限。归档保留用户关联与角色编码，不会级联删除管理员。</p>
    {canManageDefinitions ? <PermissionPanel /> : <Alert type="info" showIcon title="权限目录仅对拥有 admin.permission.manage 的系统管理员开放。" />}

    <Modal title={editingRole ? "编辑角色" : "新建角色"} open={roleOpen} onCancel={() => setRoleOpen(false)} onOk={() => void roleForm.submit()} confirmLoading={roleSaving} okText="保存" cancelText="取消" destroyOnHidden>
      <Form form={roleForm} layout="vertical" onFinish={saveRole}>
        {!editingRole && <Form.Item name="roleCode" label="角色编码" rules={[{ required: true, min: 3, max: 64 }, { pattern: /^(?!aij_|super_admin$)[a-z][a-z0-9_]*$/, message: "使用小写字母、数字和下划线；系统编码不可创建。" }]}><Input maxLength={64} autoComplete="off" /></Form.Item>}
        <Form.Item name="roleName" label="角色名称" rules={[{ required: true, whitespace: true, max: 64 }]}><Input maxLength={64} /></Form.Item>
        <Form.Item name="remark" label="备注"><Input.TextArea maxLength={256} showCount /></Form.Item>
      </Form>
    </Modal>
    <Modal title={assignmentRole ? `配置权限 · ${assignmentRole.roleName}` : "配置权限"} open={!!assignmentRole} onCancel={() => setAssignmentRole(null)} footer={<Space><Button onClick={() => setAssignmentRole(null)}>取消</Button><Popconfirm title="将用当前选择完整替换角色权限；撤销或新增会立即影响 API。" onConfirm={() => void saveAssignment()}><Button type="primary" loading={assignmentLoading}>保存并替换</Button></Popconfirm></Space>} destroyOnHidden>
      <Alert className="admin-feedback" type="warning" showIcon title="只有系统管理员可以分配权限。保存会完整替换绑定；不选任何项表示撤销全部权限。" />
      {assignmentCatalog.length ? <Checkbox.Group value={selectedPermissions} onChange={value => setSelectedPermissions(value as string[])} options={assignmentCatalog.map(p => ({ value: p.id, label: `${p.permissionName} · ${p.permissionCode}` }))} /> : <Alert type="info" title="当前没有可分配的启用权限。" />}
    </Modal>
  </>;
}

function PermissionPanel() {
  const { request } = useAdmin();
  const list = useAdminList<Permission>("/admin/permissions/manage");
  const [form] = Form.useForm<PermissionValues>();
  const [editing, setEditing] = useState<Permission | null>(null), [open, setOpen] = useState(false), [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState({ error: "", success: "" });
  function edit(item?: Permission) { setEditing(item ?? null); form.setFieldsValue(item ? { permissionName: item.permissionName, apiPath: item.apiPath } : { permissionCode: "", permissionName: "", resourceType: "api", action: "read", apiPath: "" }); setOpen(true); }
  async function save(values: PermissionValues) {
    setSaving(true);
    try {
      if (editing) await request(`/admin/permissions/${editing.id}`, "PATCH", { permissionName: values.permissionName, apiPath: values.apiPath || null });
      else await request("/admin/permissions", "POST", { ...values, apiPath: values.apiPath || null });
      setOpen(false); form.resetFields(); list.reload(); setFeedback({ error: "", success: editing ? "权限定义已更新。" : "自定义权限已创建。" });
    } catch (error) { setFeedback({ error: requestMessage(error), success: "" }); }
    finally { setSaving(false); }
  }
  async function toggle(item: Permission) {
    try { await request(`/admin/permissions/${item.id}/status`, "PATCH", { enabled: item.status !== "active" }); list.reload(); setFeedback({ error: "", success: item.status === "active" ? "权限已停用。" : "权限已启用。" }); }
    catch (error) { setFeedback({ error: requestMessage(error), success: "" }); }
  }
  async function remove(item: Permission) {
    try { await request(`/admin/permissions/${item.id}`, "DELETE"); list.reload(); setFeedback({ error: "", success: "未引用权限已删除。" }); }
    catch (error) { setFeedback({ error: requestMessage(error), success: "" }); }
  }
  const columns = [
    { title: "权限定义", key: "definition", render: (_: unknown, row: Permission) => <><strong>{row.permissionName}</strong><div className="admin-cell-secondary">{row.permissionCode}</div></> },
    { title: "资源 / 动作", key: "scope", render: (_: unknown, row: Permission) => `${row.resourceType} / ${row.action}` },
    { title: "状态", dataIndex: "status", key: "status", render: (value: Permission["status"]) => <Tag color={value === "active" ? "green" : "default"}>{value === "active" ? "启用" : "停用"}</Tag> },
    { title: "操作", key: "actions", render: (_: unknown, row: Permission) => <Space wrap><Button size="small" disabled={row.module !== "custom"} onClick={() => edit(row)}>编辑</Button><Popconfirm title={row.status === "active" ? "停用后该权限不会参与授权解析。" : "重新启用此权限？"} onConfirm={() => void toggle(row)}><Button size="small" disabled={row.module !== "custom"}>{row.status === "active" ? "停用" : "启用"}</Button></Popconfirm><Popconfirm title="仅未被角色或菜单引用时可删除。" onConfirm={() => void remove(row)}><Button size="small" danger disabled={row.module !== "custom"}>删除</Button></Popconfirm></Space> }
  ];
  return <section className="admin-permission-section" aria-label="权限目录">
    <div className="admin-heading-actions"><div><h2>权限目录</h2><p className="admin-help">核心定义由代码维护；这里只管理 custom.*，绑定仍以服务端权限检查为准。</p></div><Button onClick={() => edit()}>新增自定义权限</Button></div>
    <ManagementAlert error={feedback.error || list.error} success={feedback.success} />
    <div className="admin-table-panel"><ListTools placeholder="搜索权限编码或名称" onSearch={list.search} status={list.status} onStatus={list.filter} reload={list.reload} /><Table<Permission> rowKey="id" dataSource={list.data.items} columns={columns} loading={list.loading} pagination={{ current: list.page, pageSize: list.pageSize, total: list.data.total, showSizeChanger: true, onChange: list.paginate }} scroll={{ x: 760 }} /></div>
    <Modal title={editing ? "编辑自定义权限" : "新建自定义权限"} open={open} onCancel={() => setOpen(false)} onOk={() => void form.submit()} confirmLoading={saving} okText="保存" cancelText="取消" destroyOnHidden>
      <Form form={form} layout="vertical" onFinish={save}>
        {!editing && <Form.Item name="permissionCode" label="权限编码" rules={[{ required: true, min: 8, max: 128 }, { pattern: /^custom\.[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/, message: "自定义权限必须以 custom. 开始。" }]}><Input maxLength={128} autoComplete="off" /></Form.Item>}
        <Form.Item name="permissionName" label="权限名称" rules={[{ required: true, whitespace: true, max: 64 }]}><Input maxLength={64} /></Form.Item>
        {!editing && <><Form.Item name="resourceType" label="资源类型" rules={[{ required: true }]}><Select options={["menu", "button", "api", "data"].map(value => ({ value, label: value }))} /></Form.Item><Form.Item name="action" label="动作" rules={[{ required: true, pattern: /^[a-z][a-z0-9._-]*$/ }]}><Input maxLength={64} /></Form.Item></>}
        <Form.Item name="apiPath" label="API 路径（可选）" rules={[{ pattern: /^$|^\/api(?:\/[A-Za-z0-9_:-]+)*$/ }]}><Input maxLength={256} placeholder="/api/..." /></Form.Item>
      </Form>
    </Modal>
  </section>;
}
