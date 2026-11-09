// Core permission for the plugin lifecycle API. Permission presence does not grant it to any role.
module.exports = Object.freeze({
  PLUGIN_MANAGEMENT_PERMISSION: "admin.plugin.manage",
  PLUGIN_MANAGEMENT_DEFINITION: Object.freeze({
    code: "admin.plugin.manage",
    name: "AIJ 插件生命周期管理",
    action: "manage-plugins",
    path: "/api/admin/plugins"
  })
});
