"use strict";
const CONFIGURATION_PERMISSION = "admin.config.manage";
const CONFIGURATION_DEFINITION = Object.freeze({ code: CONFIGURATION_PERMISSION, name: "AIJ 项目配置管理", action: "manage-configuration", path: "/api/admin/scoped-configs" });
module.exports = { CONFIGURATION_PERMISSION, CONFIGURATION_DEFINITION };
