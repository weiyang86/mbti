export const INTEGRATION_MANAGEMENT_PERMISSION: "admin.integration.manage";
export const INTEGRATION_MANAGEMENT_DEFINITION: Readonly<{
  code: "admin.integration.manage";
  name: string;
  action: "manage-connectors";
  path: "/api/admin/integrations";
}>;
