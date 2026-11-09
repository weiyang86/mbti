"use strict";
const AUDIT_PERMISSION = "admin.log.read";
const AUDIT_DEFINITION = Object.freeze({ code: AUDIT_PERMISSION, name: "AIJ 审计日志查询", action: "read-audit-logs", path: "/api/admin/logs" });
module.exports = { AUDIT_PERMISSION, AUDIT_DEFINITION };
