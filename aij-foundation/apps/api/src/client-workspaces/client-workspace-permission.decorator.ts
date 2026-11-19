import { SetMetadata } from "@nestjs/common";

export const CLIENT_WORKSPACE_PERMISSIONS_KEY = "aij:client-workspace-permissions";

export function validClientWorkspacePermissionCodes(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.length <= 32 && value.every(code =>
    typeof code === "string" && code.length <= 128 && /^[a-z][a-z0-9-]*(?:[.:][a-z0-9-]+)+$/.test(code));
}

export function RequireClientWorkspacePermissions(...permissions: string[]) {
  if (!validClientWorkspacePermissionCodes(permissions)) {
    throw new Error("RequireClientWorkspacePermissions requires explicit permission codes");
  }
  return SetMetadata(CLIENT_WORKSPACE_PERMISSIONS_KEY, Object.freeze([...new Set(permissions)]));
}
