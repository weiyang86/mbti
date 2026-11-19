import type { Type } from "@nestjs/common";
import { validPermissionCodes } from "../common/decorators/permissions.decorator";

// Adapted for AF-067 from the read-only source plugin-sdk manifest contract at
// cd8d006ffd3f2830dd0bdb4e62d0288e059dd9eb. Its All Rights Reserved notice is
// preserved in PLUGIN_SDK_LICENSE.txt; this adaptation grants no release rights.

export type PluginDependencyMap = Readonly<Record<string, string>>;
export type PluginPermission = readonly [string, string, string, string, string?] | {
  permissionCode: string;
  permissionName: string;
  module: string;
  action: string;
  apiPath?: string;
};
export type PluginMenu = {
  title: string;
  path: string;
  parentPath: string | null;
  permissionCode: string | null;
  sortOrder: number;
  type: "directory" | "menu";
  icon: string | null;
};
export type PluginConfigField = {
  type: "string" | "number" | "boolean" | "secretRef";
  sensitive?: boolean;
  default?: unknown;
};
export type PluginManifestV2 = {
  manifestVersion: 2;
  code: string;
  name: string;
  version: string;
  coreVersionRange: string;
  description?: string;
  dependencies: PluginDependencyMap;
  optionalDependencies: PluginDependencyMap;
  permissions: readonly PluginPermission[];
  menus: readonly PluginMenu[];
  frontendRoutes: readonly { path: string; permissionCode?: string | null }[];
  configSchema: Readonly<Record<string, PluginConfigField>>;
  migrations: readonly { id: string; checksum: string }[];
  lifecycle: Partial<Record<"install" | "enable" | "disable" | "uninstall", string>>;
  events: readonly string[];
  jobs: readonly string[];
  transferTemplates?: readonly { code: string; direction: "import" | "export"; format: "csv" | "xlsx"; handlerCode: string }[];
  openApiRoutes?: readonly { method: "GET" | "POST" | "PATCH" | "DELETE"; path: string; scope: string }[];
  webhookEvents?: readonly string[];
  featureFlags: readonly { code: string; defaultEnabled: false }[];
};

// This version is the current AIJ core plugin API, independent from package release numbers.
export const AIJ_PLUGIN_API_VERSION = "0.1.0";

const CODE_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/;
const RANGE_COMPARATOR_PATTERN = /^(>=|>|<=|<)(.+)$/;
const ROOT_KEYS = new Set([
  "manifestVersion", "code", "name", "version", "coreVersionRange", "description", "dependencies", "optionalDependencies",
  "permissions", "menus", "frontendRoutes", "configSchema", "migrations", "lifecycle", "events", "jobs",
  "transferTemplates", "openApiRoutes", "webhookEvents", "featureFlags"
]);

export class PluginManifestError extends Error {
  readonly pluginCode: string;
  readonly issues: readonly string[];

  constructor(pluginCode: string, issues: readonly string[]) {
    const safeCode = CODE_PATTERN.test(pluginCode) ? pluginCode : "unknown";
    super(`Plugin manifest rejected (${safeCode}): ${issues.join("; ")}`);
    this.name = "PluginManifestError";
    this.pluginCode = safeCode;
    this.issues = Object.freeze([...issues]);
  }
}

export function definePluginManifest<T extends PluginManifestV2>(manifest: T): T {
  return validatePluginManifest(manifest) as T;
}

/** Validates only declarative metadata. It never imports code or executes a lifecycle handler. */
export function validatePluginManifest(input: unknown): PluginManifestV2 {
  const candidate = isRecord(input) ? input : {};
  const code = typeof candidate.code === "string" ? candidate.code : "unknown";
  const issues: string[] = [];
  checkKeys(candidate, ROOT_KEYS, "manifest", issues);
  if (candidate.manifestVersion !== 2) issues.push("manifestVersion must be 2");
  if (!CODE_PATTERN.test(code)) issues.push("code must use lowercase kebab-case");
  if (!validText(candidate.name, 120)) issues.push("name is required");
  if (candidate.description !== undefined && !validText(candidate.description, 2000)) issues.push("description is invalid");
  if (!isSemVer(candidate.version)) issues.push("version must be SemVer");
  if (typeof candidate.coreVersionRange !== "string" || !isVersionRange(candidate.coreVersionRange)) issues.push("coreVersionRange is invalid");

  validateDependencyMap(candidate.dependencies, "dependencies", issues);
  validateDependencyMap(candidate.optionalDependencies, "optionalDependencies", issues);
  const permissionCodes = validatePermissions(candidate.permissions, code, issues);
  const permissionSet = new Set(permissionCodes);
  validateMenus(candidate.menus, code, permissionSet, issues);
  validateRoutes(candidate.frontendRoutes, code, permissionSet, issues);
  validateConfigSchema(candidate.configSchema, issues);
  validateMigrations(candidate.migrations, issues);
  validateLifecycle(candidate.lifecycle, code, issues);
  validateNamespacedList(candidate.events, code, "events", issues);
  validateNamespacedList(candidate.jobs, code, "jobs", issues);
  if (candidate.transferTemplates !== undefined) validateTransferTemplates(candidate.transferTemplates, code, issues);
  if (candidate.openApiRoutes !== undefined) validateOpenApiRoutes(candidate.openApiRoutes, issues);
  if (candidate.webhookEvents !== undefined) validateNamespacedList(candidate.webhookEvents, code, "webhookEvents", issues);
  validateFeatureFlags(candidate.featureFlags, code, issues);

  if (issues.length) throw new PluginManifestError(code, issues);
  return deepFreeze(structuredClone(candidate)) as PluginManifestV2;
}

/** Checks core API compatibility, unique plugin codes and the complete static dependency graph. */
export function validatePluginCatalog(manifests: readonly unknown[], coreVersion = AIJ_PLUGIN_API_VERSION): ReadonlyMap<string, PluginManifestV2> {
  if (!Array.isArray(manifests) || !isSemVer(coreVersion)) throw new PluginManifestError("unknown", ["plugin catalog or core version is invalid"]);
  const catalog = new Map<string, PluginManifestV2>();
  for (const raw of manifests) {
    const manifest = validatePluginManifest(raw);
    if (catalog.has(manifest.code)) throw new PluginManifestError(manifest.code, ["duplicate plugin code"]);
    if (!satisfiesVersion(coreVersion, manifest.coreVersionRange)) throw new PluginManifestError(manifest.code, ["core plugin API version is incompatible"]);
    catalog.set(manifest.code, manifest);
  }
  resolvePluginDependencyOrder(catalog);
  return catalog;
}

/** Returns a deterministic dependency-first plan without installing or executing plugin code. */
export function resolvePluginDependencyOrder(catalog: ReadonlyMap<string, PluginManifestV2>): string[] {
  const state = new Map<string, "visiting" | "visited">();
  const order: string[] = [];
  const visit = (code: string, path: readonly string[]) => {
    const manifest = catalog.get(code);
    if (!manifest) throw new PluginManifestError(path.at(-1) ?? code, [`required dependency ${code} is missing from the trusted catalog`]);
    if (state.get(code) === "visited") return;
    if (state.get(code) === "visiting") {
      const start = path.indexOf(code);
      const cycle = [...path.slice(start < 0 ? 0 : start), code];
      throw new PluginManifestError(code, [`dependency cycle detected: ${cycle.join(" -> ")}`]);
    }
    state.set(code, "visiting");
    const dependencies = Object.entries(manifest.dependencies).map(([dependencyCode, range]) => ({ dependencyCode, range, required: true }));
    const optional = Object.entries(manifest.optionalDependencies).map(([dependencyCode, range]) => ({ dependencyCode, range, required: false }));
    for (const dependency of [...dependencies, ...optional].sort((left, right) => left.dependencyCode.localeCompare(right.dependencyCode))) {
      const registered = catalog.get(dependency.dependencyCode);
      if (!registered) {
        if (dependency.required) throw new PluginManifestError(code, [`required dependency ${dependency.dependencyCode} is missing from the trusted catalog`]);
        continue;
      }
      if (!satisfiesVersion(registered.version, dependency.range)) {
        throw new PluginManifestError(code, [`dependency ${dependency.dependencyCode} version is incompatible with the declared range`]);
      }
      visit(dependency.dependencyCode, [...path, dependency.dependencyCode]);
    }
    state.set(code, "visited");
    order.push(code);
  };
  for (const code of [...catalog.keys()].sort()) visit(code, [code]);
  return order;
}

export type PluginRegistration = Readonly<{ manifest: PluginManifestV2; module: Type<unknown> }>;

/** Resolves only statically registered Nest modules; manifest values cannot name import paths. */
export function resolveAllowlistedPluginModules(
  enabledCodes: readonly string[],
  registrations: ReadonlyMap<string, PluginRegistration>,
  coreVersion = AIJ_PLUGIN_API_VERSION
): Type<unknown>[] {
  if (!Array.isArray(enabledCodes) || !(registrations instanceof Map)) throw new PluginManifestError("unknown", ["plugin allowlist input is invalid"]);
  const entries = [...registrations.entries()];
  const manifests: PluginManifestV2[] = [];
  const modules = new Set<Type<unknown>>();
  for (const [key, registration] of entries) {
    if (!CODE_PATTERN.test(key) || !registration || !isRecord(registration) || !isRecord(registration.manifest)
      || registration.manifest.code !== key || typeof registration.module !== "function" || !registration.module.prototype) {
      throw new PluginManifestError(key, ["registered plugin does not match the static module allowlist"]);
    }
    const module = registration.module as Type<unknown>;
    const manifest = registration.manifest as PluginManifestV2;
    if (modules.has(module)) throw new PluginManifestError(key, ["module is registered more than once"]);
    modules.add(module);
    manifests.push(manifest);
  }
  const catalog = validatePluginCatalog(manifests, coreVersion);
  const seen = new Set<string>();
  return enabledCodes.map(code => {
    if (!CODE_PATTERN.test(code) || seen.has(code)) throw new PluginManifestError(code, ["enabled plugin code is invalid or duplicated"]);
    seen.add(code);
    if (!catalog.has(code)) throw new PluginManifestError(code, ["plugin is not in the registered backend allowlist"]);
    return registrations.get(code)!.module;
  });
}

export function satisfiesVersion(version: string, range: string): boolean {
  const current = parseVersion(version);
  if (!current || !isVersionRange(range)) return false;
  if (parseVersion(range) !== undefined) return compareVersions(current, parseVersion(range)!) === 0;
  if (range.startsWith("^") || range.startsWith("~")) {
    const minimum = parseVersion(range.slice(1));
    if (!minimum || compareVersions(current, minimum) < 0) return false;
    const upper = range.startsWith("^")
      ? minimum.major > 0 ? [minimum.major + 1, 0, 0] : minimum.minor > 0 ? [0, minimum.minor + 1, 0] : [0, 0, minimum.patch + 1]
      : [minimum.major, minimum.minor + 1, 0];
    return compareVersions(current, { major: upper[0], minor: upper[1], patch: upper[2], prerelease: [] }) < 0;
  }
  return range.split(" ").every(clause => {
    const match = clause.match(RANGE_COMPARATOR_PATTERN);
    if (!match) return false;
    const bound = parseVersion(match[2]);
    if (!bound) return false;
    const order = compareVersions(current, bound);
    return match[1] === ">=" ? order >= 0 : match[1] === ">" ? order > 0 : match[1] === "<=" ? order <= 0 : order < 0;
  });
}

/** Compares two strict SemVer values using the same ordering as the manifest validator. */
export function comparePluginVersions(left: string, right: string): number {
  const a = parseVersion(left), b = parseVersion(right);
  if (!a || !b) throw new PluginManifestError("unknown", ["plugin version comparison requires strict SemVer"]);
  return compareVersions(a, b);
}

type ParsedVersion = { major: number; minor: number; patch: number; prerelease: readonly (string | number)[] };

function parseVersion(value: string): ParsedVersion | undefined {
  if (typeof value !== "string") return undefined;
  const match = value.match(VERSION_PATTERN);
  if (!match) return undefined;
  const prereleaseParts = match[4]?.split(".") ?? [];
  const buildParts = match[5]?.split(".") ?? [];
  if (prereleaseParts.some(part => !part || !/^[0-9A-Za-z-]+$/.test(part)) ||
      buildParts.some(part => !part || !/^[0-9A-Za-z-]+$/.test(part))) return undefined;
  const prerelease = prereleaseParts.map(part => /^\d+$/.test(part) ? Number(part) : part);
  const [major, minor, patch] = match.slice(1, 4).map(Number);
  if (![major, minor, patch].every(Number.isSafeInteger)) return undefined;
  if (prerelease.some((part, index) => typeof part === "number" &&
      (!Number.isSafeInteger(part) || String(part) !== prereleaseParts[index]))) return undefined;
  return { major, minor, patch, prerelease };
}

function isSemVer(value: unknown): value is string { return typeof value === "string" && parseVersion(value) !== undefined; }

function isVersionRange(value: string): boolean {
  if (parseVersion(value) !== undefined) return true;
  if ((value.startsWith("^") || value.startsWith("~")) && isSemVer(value.slice(1))) return true;
  const clauses = value.split(" ");
  return clauses.length > 0 && clauses.every(clause => {
    const match = clause.match(RANGE_COMPARATOR_PATTERN);
    return !!match && isSemVer(match[2]);
  });
}

function compareVersions(left: ParsedVersion, right: ParsedVersion): number {
  for (const key of ["major", "minor", "patch"] as const) if (left[key] !== right[key]) return left[key] - right[key];
  if (!left.prerelease.length || !right.prerelease.length) return left.prerelease.length === right.prerelease.length ? 0 : left.prerelease.length ? -1 : 1;
  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < length; index++) {
    const a = left.prerelease[index], b = right.prerelease[index];
    if (a === undefined || b === undefined) return a === b ? 0 : a === undefined ? -1 : 1;
    if (a === b) continue;
    if (typeof a === "number" && typeof b === "number") return a - b;
    if (typeof a === "number") return -1;
    if (typeof b === "number") return 1;
    return a < b ? -1 : 1;
  }
  return 0;
}

function validateDependencyMap(value: unknown, label: string, issues: string[]) {
  if (!isRecord(value)) { issues.push(`${label} must be an object`); return; }
  for (const [code, range] of Object.entries(value)) {
    if (!CODE_PATTERN.test(code)) issues.push(`${label} contains an invalid plugin code`);
    if (typeof range !== "string" || !isVersionRange(range)) issues.push(`${label} contains an invalid version range`);
  }
}

function validatePermissions(value: unknown, pluginCode: string, issues: string[]): string[] {
  if (!Array.isArray(value)) { issues.push("permissions must be an array"); return []; }
  const codes: string[] = [];
  for (const raw of value) {
    let code: unknown, name: unknown, module: unknown, action: unknown, apiPath: unknown;
    if (Array.isArray(raw)) {
      if (raw.length < 4 || raw.length > 5) { issues.push("permission tuple is invalid"); continue; }
      [code, name, module, action, apiPath] = raw;
    } else if (isRecord(raw)) {
      checkKeys(raw, new Set(["permissionCode", "permissionName", "module", "action", "apiPath"]), "permission", issues);
      ({ permissionCode: code, permissionName: name, module, action, apiPath } = raw);
    } else { issues.push("permission declaration is invalid"); continue; }
    const expectedCode = `plugin.${pluginCode}.${String(module ?? "")}.${String(action ?? "")}`;
    if (typeof code !== "string" || !validPermissionCodes([code]) || code !== expectedCode) issues.push("permission code must be namespaced to its plugin module and action");
    if (!validText(name, 120)) issues.push("permission name is invalid");
    if (!isCodePart(module) || !isCodePart(action)) issues.push("permission module/action is invalid");
    if (apiPath !== undefined && (typeof apiPath !== "string" || !safeApiPath(apiPath, `/api/plugins/${pluginCode}/`))) issues.push("permission API path is outside its plugin namespace");
    if (typeof code === "string") codes.push(code);
  }
  addDuplicates("permission", codes, issues);
  return codes;
}

function validateMenus(value: unknown, pluginCode: string, permissions: ReadonlySet<string>, issues: string[]) {
  if (!Array.isArray(value)) { issues.push("menus must be an array"); return; }
  const paths: string[] = [];
  for (const raw of value) {
    if (!isRecord(raw)) { issues.push("menu declaration is invalid"); continue; }
    checkKeys(raw, new Set(["title", "path", "parentPath", "permissionCode", "sortOrder", "type", "icon"]), "menu", issues);
    if (!validText(raw.title, 120)) issues.push("menu title is invalid");
    if (typeof raw.path !== "string" || !safePluginRoute(raw.path, pluginCode)) issues.push("menu route is outside its plugin namespace");
    if (raw.parentPath !== null && (typeof raw.parentPath !== "string" || !safePluginRoute(raw.parentPath, pluginCode))) issues.push("menu parent route is invalid");
    if (raw.permissionCode !== null && (typeof raw.permissionCode !== "string" || !permissions.has(raw.permissionCode))) issues.push("menu permission is not declared by this plugin");
    if (!Number.isSafeInteger(raw.sortOrder) || Number(raw.sortOrder) < 0 || Number(raw.sortOrder) > 100000) issues.push("menu sort order is invalid");
    if (raw.type !== "directory" && raw.type !== "menu") issues.push("menu type is invalid");
    if (raw.icon !== null && (typeof raw.icon !== "string" || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(raw.icon))) issues.push("menu icon is invalid");
    if (typeof raw.path === "string") paths.push(raw.path);
  }
  addDuplicates("menu path", paths, issues);
}

function validateRoutes(value: unknown, pluginCode: string, permissions: ReadonlySet<string>, issues: string[]) {
  if (!Array.isArray(value)) { issues.push("frontendRoutes must be an array"); return; }
  const paths: string[] = [];
  for (const raw of value) {
    if (!isRecord(raw)) { issues.push("frontend route declaration is invalid"); continue; }
    checkKeys(raw, new Set(["path", "permissionCode"]), "frontend route", issues);
    if (typeof raw.path !== "string" || !safePluginRoute(raw.path, pluginCode)) issues.push("frontend route is outside its plugin namespace");
    if (raw.permissionCode !== undefined && raw.permissionCode !== null && (typeof raw.permissionCode !== "string" || !permissions.has(raw.permissionCode))) issues.push("frontend route permission is not declared by this plugin");
    if (typeof raw.path === "string") paths.push(raw.path);
  }
  addDuplicates("frontend route", paths, issues);
}

function validateConfigSchema(value: unknown, issues: string[]) {
  if (!isRecord(value)) { issues.push("configSchema must be an object"); return; }
  for (const [key, raw] of Object.entries(value)) {
    if (!/^[A-Za-z][A-Za-z0-9._-]{0,63}$/.test(key) || !isRecord(raw)) { issues.push("configSchema field is invalid"); continue; }
    checkKeys(raw, new Set(["type", "sensitive", "default"]), "config field", issues);
    if (!["string", "number", "boolean", "secretRef"].includes(String(raw.type))) issues.push("config field type is invalid");
    if (raw.sensitive !== undefined && typeof raw.sensitive !== "boolean") issues.push("config sensitive flag is invalid");
    if (raw.sensitive === true && raw.type !== "secretRef") issues.push("sensitive config fields must use secretRef");
    if (raw.type === "secretRef" && raw.default !== undefined) issues.push("secretRef config fields cannot have a default value");
    if (/(secret|password|token|api.?key)/i.test(key) && raw.type !== "secretRef") issues.push("secret-like config fields must use secretRef");
    if (raw.default !== undefined && raw.type !== "secretRef") {
      const defaultMatchesType = raw.type === "string" ? typeof raw.default === "string"
        : raw.type === "number" ? typeof raw.default === "number" && Number.isFinite(raw.default)
        : raw.type === "boolean" ? typeof raw.default === "boolean"
        : false;
      if (!defaultMatchesType) issues.push("config default value does not match its declared type");
    }
  }
}

function validateMigrations(value: unknown, issues: string[]) {
  if (!Array.isArray(value)) { issues.push("migrations must be an array"); return; }
  const ids: string[] = [];
  for (const raw of value) {
    if (!isRecord(raw)) { issues.push("migration declaration is invalid"); continue; }
    checkKeys(raw, new Set(["id", "checksum"]), "migration", issues);
    if (typeof raw.id !== "string" || !/^[a-z][a-z0-9._-]{0,100}$/.test(raw.id)) issues.push("migration id is invalid");
    if (typeof raw.checksum !== "string" || !/^[a-f0-9]{64}$/.test(raw.checksum)) issues.push("migration checksum must be SHA-256");
    if (typeof raw.id === "string") ids.push(raw.id);
  }
  addDuplicates("migration id", ids, issues);
}

function validateLifecycle(value: unknown, pluginCode: string, issues: string[]) {
  if (!isRecord(value)) { issues.push("lifecycle must be an object"); return; }
  checkKeys(value, new Set(["install", "enable", "disable", "uninstall"]), "lifecycle", issues);
  for (const handler of Object.values(value)) {
    if (typeof handler !== "string" || !/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/.test(handler) || !handler.startsWith(`${pluginCode}.`)) {
      issues.push("lifecycle handlers must be plugin-namespaced identifiers, not paths or scripts");
    }
  }
}

function validateNamespacedList(value: unknown, pluginCode: string, label: string, issues: string[]) {
  if (!Array.isArray(value) || value.some(item => typeof item !== "string" || !item.startsWith(`${pluginCode}.`) || !/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/.test(item))) {
    issues.push(`${label} must contain plugin-namespaced identifiers`);
    return;
  }
  addDuplicates(label, value as string[], issues);
}

function validateTransferTemplates(value: unknown, pluginCode: string, issues: string[]) {
  if (!Array.isArray(value)) { issues.push("transferTemplates must be an array"); return; }
  for (const raw of value) {
    if (!isRecord(raw)) { issues.push("transfer template declaration is invalid"); continue; }
    checkKeys(raw, new Set(["code", "direction", "format", "handlerCode"]), "transfer template", issues);
    if (typeof raw.code !== "string" || !raw.code.startsWith(`${pluginCode}.`) || !/^[a-z][a-z0-9.-]{2,100}$/.test(raw.code)) issues.push("transfer template code is invalid");
    if (raw.direction !== "import" && raw.direction !== "export") issues.push("transfer direction is invalid");
    if (raw.format !== "csv" && raw.format !== "xlsx") issues.push("transfer format is invalid");
    if (typeof raw.handlerCode !== "string" || !raw.handlerCode.startsWith(`${pluginCode}.`) || !/^[a-z][a-z0-9.-]{2,100}$/.test(raw.handlerCode)) issues.push("transfer handler must be a plugin-namespaced identifier");
  }
}

function validateOpenApiRoutes(value: unknown, issues: string[]) {
  if (!Array.isArray(value)) { issues.push("openApiRoutes must be an array"); return; }
  const routes: string[] = [];
  for (const raw of value) {
    if (!isRecord(raw)) { issues.push("OpenAPI route declaration is invalid"); continue; }
    checkKeys(raw, new Set(["method", "path", "scope"]), "OpenAPI route", issues);
    if (!["GET", "POST", "PATCH", "DELETE"].includes(String(raw.method))) issues.push("OpenAPI route method is invalid");
    if (typeof raw.path !== "string" || !safeApiPath(raw.path, "/api/openapi/") || /admin|secret|runtime|job/i.test(raw.path)) issues.push("OpenAPI route is not explicitly public-safe");
    if (typeof raw.scope !== "string" || !/^[a-z][a-z0-9:._-]{1,80}$/.test(raw.scope)) issues.push("OpenAPI scope is invalid");
    if (typeof raw.path === "string") routes.push(`${String(raw.method)} ${raw.path}`);
  }
  addDuplicates("OpenAPI route", routes, issues);
}

function validateFeatureFlags(value: unknown, pluginCode: string, issues: string[]) {
  if (!Array.isArray(value)) { issues.push("featureFlags must be an array"); return; }
  const codes: string[] = [];
  for (const raw of value) {
    if (!isRecord(raw)) { issues.push("feature flag declaration is invalid"); continue; }
    checkKeys(raw, new Set(["code", "defaultEnabled"]), "feature flag", issues);
    if (typeof raw.code !== "string" || !raw.code.startsWith(`${pluginCode}.`) || !/^[a-z][a-z0-9.-]{2,100}$/.test(raw.code)) issues.push("feature flag code is invalid");
    if (raw.defaultEnabled !== false) issues.push("feature flags must default to disabled");
    if (typeof raw.code === "string") codes.push(raw.code);
  }
  addDuplicates("feature flag", codes, issues);
}

function safePluginRoute(path: string, pluginCode: string): boolean {
  const prefix = `/plugins/${pluginCode}/`;
  return path.startsWith(prefix) && !path.includes("\\") && !path.includes("%") && !/[?#]/.test(path) &&
    !path.split("/").some(segment => segment === "." || segment === "..") && !path.includes("//") && !hasControlCharacter(path);
}

function safeApiPath(path: string, prefix: string): boolean {
  return path.startsWith(prefix) && !path.includes("\\") && !path.includes("%") && !/[?#]/.test(path) &&
    !path.split("/").some(segment => segment === "." || segment === "..") && !path.includes("//") && !hasControlCharacter(path);
}

function validText(value: unknown, max: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max && !hasControlCharacter(value);
}

function isCodePart(value: unknown): value is string { return typeof value === "string" && /^[a-z][a-z0-9-]{0,63}$/.test(value); }
function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function checkKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>, label: string, issues: string[]) {
  if (Object.keys(value).some(key => !allowed.has(key))) issues.push(`${label} contains unsupported fields`);
}

function addDuplicates(label: string, values: readonly string[], issues: string[]) {
  const seen = new Set<string>();
  for (const value of values) {
    if (!value) issues.push(`${label} is required`);
    else if (seen.has(value)) issues.push(`duplicate ${label}`);
    seen.add(value);
  }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}
