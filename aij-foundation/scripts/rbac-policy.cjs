"use strict";
// Explicit code-owned permissions; registering a definition never reconciles grants.
const RBAC_ROLE_PERMISSION = "admin.role.manage";
const RBAC_PERMISSION_PERMISSION = "admin.permission.manage";
const RBAC_DEFINITIONS = Object.freeze([
  Object.freeze({ code: RBAC_ROLE_PERMISSION, name: "AIJ 角色管理", action: "manage-roles", path: "/api/admin/roles" }),
  Object.freeze({ code: RBAC_PERMISSION_PERMISSION, name: "AIJ 权限定义管理", action: "manage-permissions", path: "/api/admin/permissions" })
]);
module.exports = { RBAC_ROLE_PERMISSION, RBAC_PERMISSION_PERMISSION, RBAC_DEFINITIONS };
