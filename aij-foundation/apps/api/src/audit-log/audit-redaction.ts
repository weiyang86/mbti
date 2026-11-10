// F00 M03/M06: source redactText patterns, plus fail-closed read projection for historical rows.
import type { AuditLog, Prisma } from "@prisma/client";
import { MBTI_CATEGORIES } from "../plugins/mbti-config/mbti-config.categories";
export const REDACTED = "[REDACTED]";
export function redactText(input: string): string {
  return input.replace(/-----BEGIN [A-Z ]*(?:PRIVATE KEY|CERTIFICATE)-----[\s\S]*?-----END [A-Z ]*(?:PRIVATE KEY|CERTIFICATE)-----/gi, REDACTED)
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, `Bearer ${REDACTED}`)
    .replace(/\bsk-[A-Za-z0-9._-]{8,}/gi, REDACTED)
    .replace(/((?:api[_-]?key|token|secret|password|passwd|authorization|cookie)\s*[:=]\s*)[^\s,;]+/gi, `$1${REDACTED}`);
}
const actions: Readonly<Record<string, readonly string[]>> = {
  auth: ["login", "login_failed", "logout", "password_changed", "password_change_failed", "admin_client_session_reauthenticated", "admin_client_session_reauthentication_failed"], rbac: ["permission_denied"],
  "client-auth": ["login", "login_failed", "login_rate_limited", "logout", "sessions_revoked", "admin_session_revoked", "password_reset_requested", "password_reset_rate_limited", "password_reset_failed", "password_reset_completed"],
  "admin-users": ["created", "updated", "enabled", "disabled", "deleted", "password_reset"],
  "rbac-management": ["role_created", "role_updated", "role_enabled", "role_disabled", "role_deleted", "role_permissions_assigned", "permission_created", "permission_updated", "permission_enabled", "permission_disabled", "permission_deleted"],
  menus: ["menu_created", "menu_updated", "menu_deleted"],
  dictionaries: ["dict_created", "dict_updated", "dict_deleted", "dict_item_created", "dict_item_updated", "dict_item_deleted"],
  configuration: ["scoped_config_updated", "project_status_updated", "mbti_draft_saved", "mbti_published", "mbti_rollback"],
  "secret-center": ["secret_reference_created", "secret_reference_checked", "secret_reference_rotated", "secret_reference_cleared", "secret_reference_rebound"],
  runtime: ["job_retried", "job_cancelled", "outbox_retried"],
  "aij-ai": ["trace_listed"],
  "mbti-orders": ["orders_exported"]
};
const resourceTypes = new Set(["mbti_order_collection", "admin-auth", "member_auth", "client_auth_session", "permission", "administrator", "role", "menu", "system_dict", "system_dict_item", "scoped_config", "project_profile", "secret_reference", "runtime_job", "runtime_outbox", "ai_execution_trace"]);
const fieldNames = new Set([...MBTI_CATEGORIES, "identity", "roles", "realName", "email", "phone", "roleIds", "roleCode", "roleName", "remark", "permissionIds", "permissionCode", "permissionName", "resourceType", "action", "apiPath", "name", "title", "parentId", "path", "icon", "sortOrder", "visible", "permissionCode", "status", "code", "description", "isPublic", "label", "value", "dictId", "configValue", "version", "reference", "sessionId", "page", "pageSize", "providerCode", "modelCode", "correlationId", "costSource", "startAt", "endAt"]);
const permissions = new Set(["aij.bootstrap.admin", "admin.user.manage", "admin.role.manage", "admin.permission.manage", "admin.menu.manage", "admin.dict.manage", "admin.config.manage", "admin.secret.manage", "admin.log.read", "admin.runtime.read", "admin.runtime.manage", "admin.client.read", "admin.client.sessions.revoke"]);
function identifier(value: string | null) { return value === null ? null : /^(?:[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}|c[a-z0-9]{24})$/.test(value) && redactText(value) === value ? value : REDACTED; }
function summary(value: Prisma.JsonValue) {
  if (value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) return REDACTED;
  const result: Record<string, unknown> = { redacted: true };
  // Keys and values are both allowlisted. Unknown nested data and even unlabelled strings are never echoed.
  for (const [key, allowed] of [["fields", fieldNames], ["requiredPermissions", permissions]] as const) {
    if (Array.isArray(value[key])) result[key] = (value[key] as Prisma.JsonArray).slice(0, 100).filter((v): v is string => typeof v === "string" && allowed.has(v));
  }
  for (const key of ["permissionIdsBefore", "permissionIdsAfter"] as const) if (Array.isArray(value[key])) result[key] = (value[key] as Prisma.JsonArray).slice(0, 100).map(v => typeof v === "string" ? identifier(v) : REDACTED);
  // Stored correlation IDs are client-controlled; exact filtering is supported, raw values are hidden.
  if (Object.hasOwn(value, "correlationId")) result.correlationId = REDACTED;
  return result;
}
function orderExportSummary(value: Prisma.JsonValue) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return REDACTED;
  return { redacted: true, count: typeof value.count === "number" && Number.isInteger(value.count) && value.count >= 0 && value.count <= 5000 ? value.count : REDACTED,
    filterCategories: Array.isArray(value.filterCategories) ? value.filterCategories.filter(v => typeof v === "string" && ["q", "status", "product_code", "from", "to", "cursor"].includes(v)) : [] };
}
export function projectAudit(row: AuditLog) {
  const module = Object.hasOwn(actions, row.module) ? row.module : REDACTED;
  const path = row.path?.split(/[?#]/, 1)[0];
const routes = new Set(["/api/auth/login", "/api/auth/me", "/api/auth/logout", "/api/auth/password", "/api/client/auth/login", "/api/client/auth/logout", "/api/client/auth/sessions/revoke-all", "/api/client/auth/password/reset/request", "/api/client/auth/password/reset/confirm", "/api/admin/users", "/api/admin/clients", "/api/admin/clients/sessions/revoke", "/api/admin/roles", "/api/admin/menus", "/api/admin/logs", "/api/admin/scoped-configs", "/api/admin/secret-references", "/api/admin/runtime", "/api/admin/ai/traces"]);
  return { id: identifier(row.id), module, action: module !== REDACTED && actions[module].includes(row.action) ? row.action : REDACTED,
    userId: identifier(row.userId), userName: row.userName === null ? null : REDACTED,
    status: ["success", "failed", "error"].includes(row.status) ? row.status : REDACTED,
    resourceType: resourceTypes.has(row.resourceType) ? row.resourceType : REDACTED, resourceId: identifier(row.resourceId),
    method: row.method && ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].includes(row.method) ? row.method : null,
    path: path && routes.has(path) ? path : row.path === null ? null : REDACTED,
    requestSummary: module === "mbti-orders" && row.action === "orders_exported" ? orderExportSummary(row.requestSummary) : summary(row.requestSummary), beforeData: row.beforeData === null ? null : REDACTED, afterData: row.afterData === null ? null : REDACTED,
    errorMessage: row.errorMessage === null ? null : ["invalid_credentials", "permission_denied"].includes(row.errorMessage) ? row.errorMessage : REDACTED,
    ip: row.ip === null ? null : REDACTED, userAgent: row.userAgent === null ? null : REDACTED, createdAt: row.createdAt, redacted: true };
}
