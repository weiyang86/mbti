"use strict";

const INTEGRATION_MANAGEMENT_PERMISSION = "admin.integration.manage";
const INTEGRATION_MANAGEMENT_DEFINITION = Object.freeze({
  code: INTEGRATION_MANAGEMENT_PERMISSION,
  name: "AIJ 外部连接器配置管理",
  action: "manage-connectors",
  path: "/api/admin/integrations"
});

module.exports = Object.freeze({ INTEGRATION_MANAGEMENT_PERMISSION, INTEGRATION_MANAGEMENT_DEFINITION });
