"use strict";

const RUNTIME_READ_PERMISSION = "admin.runtime.read";
const RUNTIME_MANAGE_PERMISSION = "admin.runtime.manage";
const RUNTIME_DEFINITIONS = Object.freeze([
  Object.freeze({ code: RUNTIME_READ_PERMISSION, name: "AIJ 异步运行时监控", action: "read-runtime", path: "/api/admin/runtime" }),
  Object.freeze({ code: RUNTIME_MANAGE_PERMISSION, name: "AIJ 异步运行时管理", action: "manage-runtime", path: "/api/admin/runtime" })
]);

module.exports = { RUNTIME_READ_PERMISSION, RUNTIME_MANAGE_PERMISSION, RUNTIME_DEFINITIONS };
