// Directed adaptation from source cd8d006; provenance section 14.
import { SetMetadata } from "@nestjs/common";

export const PERMISSIONS_KEY = "permissions";
export const validPermissionCodes = (value: unknown): value is string[] => Array.isArray(value) && value.length > 0 &&
  value.every(code => typeof code === "string" && code.length <= 128 && /^[a-z][a-z0-9-]*(?:[.:][a-z0-9-]+)+$/.test(code));

export function Permissions(...permissions: string[]) {
  if (!validPermissionCodes(permissions)) throw new Error("Permissions requires nonempty explicit permission codes");
  return SetMetadata(PERMISSIONS_KEY, Object.freeze([...new Set(permissions)]));
}
