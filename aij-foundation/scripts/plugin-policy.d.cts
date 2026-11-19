declare const policy: Readonly<{
  PLUGIN_MANAGEMENT_PERMISSION: "admin.plugin.manage";
  PLUGIN_MANAGEMENT_DEFINITION: Readonly<{ code: "admin.plugin.manage"; name: string; action: "manage-plugins"; path: "/api/admin/plugins" }>;
}>;
export = policy;
