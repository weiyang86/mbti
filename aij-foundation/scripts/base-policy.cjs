"use strict";
const admin = require("./admin-policy.cjs");
const rbac = require("./rbac-policy.cjs");
const dictionary = require("./dictionary-policy.cjs");
const audit = require("./audit-policy.cjs");
// Fixed core route ownership; titles/order/status may be customized after initialization.
const BASE_DEVELOPMENT_MENUS = Object.freeze([
  { path: "/auth/admin-users", title: "管理员用户", permission: admin.ADMIN_USERS_PERMISSION, order: 10 },
  { path: "/auth/roles", title: "角色与权限", permission: rbac.RBAC_ROLE_PERMISSION, order: 20 },
  { path: "/auth/dictionaries", title: "字典", permission: dictionary.DICTIONARY_READ_PERMISSION, order: 30 },
  { path: "/auth/audit-logs", title: "审计日志", permission: audit.AUDIT_PERMISSION, order: 40 }
].map(Object.freeze));
module.exports = { BASE_DEVELOPMENT_MENUS };
