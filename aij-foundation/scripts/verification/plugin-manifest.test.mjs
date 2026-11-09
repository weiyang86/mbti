import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
require("ts-node").register({ project: "apps/api/tsconfig.json", transpileOnly: true });
const {
  AIJ_PLUGIN_API_VERSION,
  PluginManifestError,
  resolveAllowlistedPluginModules,
  resolvePluginDependencyOrder,
  satisfiesVersion,
  validatePluginCatalog,
  validatePluginManifest
} = require("../../apps/api/src/plugin-runtime/plugin-manifest.ts");
const { PluginRuntimeModule, resolvePluginModules } = require("../../apps/api/src/plugin-runtime/plugin-runtime.module.ts");

const permissionCode = "plugin.aij-notification.notifications.send";

function manifest(overrides = {}) {
  return {
    manifestVersion: 2,
    code: "aij-notification",
    name: "AIJ Notification",
    version: "1.2.3",
    coreVersionRange: "^0.1.0",
    dependencies: {},
    optionalDependencies: {},
    permissions: [{ permissionCode, permissionName: "Send notification", module: "notifications", action: "send" }],
    menus: [{ title: "Notifications", path: "/plugins/aij-notification/settings", parentPath: null, permissionCode, sortOrder: 10, type: "menu", icon: null }],
    frontendRoutes: [{ path: "/plugins/aij-notification/settings", permissionCode }],
    configSchema: { callbackUrl: { type: "string" } },
    migrations: [{ id: "aij-notification.001", checksum: "a".repeat(64) }],
    lifecycle: { install: "aij-notification.install" },
    events: ["aij-notification.message.sent"],
    jobs: ["aij-notification.delivery"],
    featureFlags: [],
    ...overrides
  };
}

class NotificationModule {}

function registrations(value = manifest()) {
  return new Map([[value.code, { manifest: value, module: NotificationModule }]]);
}

test("accepts compatible manifest V2 and returns an isolated frozen copy", () => {
  const input = manifest();
  const normalized = validatePluginManifest(input);
  assert.equal(normalized.manifestVersion, 2);
  assert.equal(normalized.code, "aij-notification");
  assert.notEqual(normalized, input);
  assert.ok(Object.isFrozen(normalized));
  assert.ok(Object.isFrozen(normalized.permissions));
  assert.equal(Object.isFrozen(input), false);
});

test("rejects malformed schema, identifiers, versions and executable manifest fields", () => {
  assert.throws(() => validatePluginManifest({ ...manifest(), manifestVersion: 3 }), PluginManifestError);
  assert.throws(() => validatePluginManifest({ ...manifest(), code: "AIJ_Notification" }), /lowercase kebab-case/);
  assert.throws(() => validatePluginManifest({ ...manifest(), version: "01.2.3" }), /SemVer/);
  assert.throws(() => validatePluginManifest({ ...manifest(), version: "9007199254740992.0.0" }), /SemVer/);
  assert.throws(() => validatePluginManifest({ ...manifest(), version: "1.2.3-alpha..1" }), /SemVer/);
  assert.throws(() => validatePluginManifest({ ...manifest(), version: "1.2.3-01" }), /SemVer/);
  assert.throws(() => validatePluginManifest({ ...manifest(), modulePath: "./untrusted.js" }), /unsupported fields/);
  assert.throws(() => validatePluginManifest({ ...manifest(), featureFlags: undefined }), /featureFlags must be an array/);
  assert.throws(() => validatePluginManifest({ ...manifest(), featureFlags: [{ code: "aij-notification.preview", defaultEnabled: true }] }), /default to disabled/);
});

test("requires unique plugin-namespaced permission declarations without granting them", () => {
  assert.throws(() => validatePluginManifest({ ...manifest(), permissions: [{ permissionCode: "admin.user.manage", permissionName: "Escalate", module: "users", action: "manage" }] }), /namespaced/);
  assert.throws(() => validatePluginManifest({ ...manifest(), permissions: [
    { permissionCode, permissionName: "Send notification", module: "notifications", action: "send" },
    { permissionCode, permissionName: "Send again", module: "notifications", action: "send" }
  ] }), /duplicate permission/);
  assert.throws(() => validatePluginManifest({ ...manifest(), permissions: [{ permissionCode, permissionName: "Send", module: "users", action: "manage" }] }), /namespaced/);
});

test("rejects external, traversal and undeclared-permission menu/routes", () => {
  assert.throws(() => validatePluginManifest({ ...manifest(), menus: [{ title: "External", path: "https://evil.invalid", parentPath: null, permissionCode, sortOrder: 0, type: "menu", icon: null }] }), /plugin namespace/);
  assert.throws(() => validatePluginManifest({ ...manifest(), frontendRoutes: [{ path: "/admin/secrets", permissionCode }] }), /plugin namespace/);
  assert.throws(() => validatePluginManifest({ ...manifest(), frontendRoutes: [{ path: "/plugins/aij-notification/%2e%2e/admin", permissionCode }] }), /plugin namespace/);
  assert.throws(() => validatePluginManifest({ ...manifest(), menus: [{ title: "Unknown permission", path: "/plugins/aij-notification/settings", parentPath: null, permissionCode: "admin.user.manage", sortOrder: 0, type: "menu", icon: null }] }), /not declared/);
});

test("rejects plaintext secret configuration and typed-default mismatches without echoing values", () => {
  const secret = "synthetic-secret-must-not-appear-in-validation-errors";
  assert.throws(() => validatePluginManifest({ ...manifest(), configSchema: { apiToken: { type: "string", default: secret } } }), error => {
    assert.ok(error instanceof PluginManifestError);
    assert.match(error.message, /secretRef/);
    assert.doesNotMatch(error.message, new RegExp(secret));
    return true;
  });
  assert.throws(() => validatePluginManifest({ ...manifest(), configSchema: { token: { type: "secretRef", default: "secret://aij/notification" } } }), /cannot have a default/);
  assert.throws(() => validatePluginManifest({ ...manifest(), configSchema: { retries: { type: "number", default: "many" } } }), /default value/);
  assert.throws(() => validatePluginManifest({ ...manifest(), configSchema: { active: { type: "boolean", default: "true" } } }), /default value/);
  assert.equal(validatePluginManifest({ ...manifest(), configSchema: { retries: { type: "number", default: 3 }, enabled: { type: "boolean", default: false } } }).code, "aij-notification");
});

test("rejects lifecycle paths, shell commands, unsafe migration checksums and duplicate IDs", () => {
  assert.throws(() => validatePluginManifest({ ...manifest(), lifecycle: { install: "../../run.sh" } }), /identifiers, not paths or scripts/);
  assert.throws(() => validatePluginManifest({ ...manifest(), migrations: [{ id: "migration-1", checksum: "not-a-checksum" }] }), /SHA-256/);
  const migration = { id: "aij-notification.001", checksum: "a".repeat(64) };
  assert.throws(() => validatePluginManifest({ ...manifest(), migrations: [migration, migration] }), /duplicate migration id/);
});

test("checks SemVer compatibility boundaries including zero-major caret semantics", () => {
  assert.equal(satisfiesVersion("0.1.9", "^0.1.0"), true);
  assert.equal(satisfiesVersion("0.2.0", "^0.1.0"), false);
  assert.equal(satisfiesVersion("0.1.8", "~0.1.0"), true);
  assert.equal(satisfiesVersion("0.2.0", "~0.1.0"), false);
  assert.equal(satisfiesVersion("1.5.0", ">=1.0.0 <2.0.0"), true);
  assert.equal(satisfiesVersion("2.0.0", ">=1.0.0 <2.0.0"), false);
  assert.equal(satisfiesVersion("not-semver", "^0.1.0"), false);
});

test("rejects core API incompatibility and duplicate catalog codes", () => {
  assert.equal(validatePluginCatalog([manifest()], "0.1.8").size, 1);
  assert.throws(() => validatePluginCatalog([manifest()], "1.0.0"), /incompatible/);
  assert.throws(() => validatePluginCatalog([manifest(), manifest()], "0.1.0"), /duplicate plugin code/);
  assert.equal(AIJ_PLUGIN_API_VERSION, "0.1.0");
});

test("resolves required dependency graphs in deterministic dependency-first order", () => {
  const base = manifest({ code: "af071-base", name: "AF-071 base", permissions: [], menus: [], frontendRoutes: [], lifecycle: {}, events: [], jobs: [] });
  const app = manifest({ code: "af071-app", name: "AF-071 app", permissions: [], menus: [], frontendRoutes: [], lifecycle: {}, events: [], jobs: [], dependencies: { "af071-base": "^1.0.0" } });
  const catalog = validatePluginCatalog([app, base]);
  assert.deepEqual(resolvePluginDependencyOrder(catalog), ["af071-base", "af071-app"]);
  assert.deepEqual(resolvePluginDependencyOrder(new Map([...catalog].reverse())), ["af071-base", "af071-app"]);
});

test("rejects missing required dependencies and statically incompatible dependency versions", () => {
  const app = manifest({ code: "af071-app", name: "AF-071 app", permissions: [], menus: [], frontendRoutes: [], lifecycle: {}, events: [], jobs: [], dependencies: { "af071-missing": "^1.0.0" } });
  assert.throws(() => validatePluginCatalog([app]), /required dependency af071-missing is missing/);
  const base = manifest({ code: "af071-base", name: "AF-071 base", version: "0.9.0", permissions: [], menus: [], frontendRoutes: [], lifecycle: {}, events: [], jobs: [] });
  const incompatible = manifest({ code: "af071-app", name: "AF-071 app", permissions: [], menus: [], frontendRoutes: [], lifecycle: {}, events: [], jobs: [], dependencies: { "af071-base": "^1.0.0" } });
  assert.throws(() => validatePluginCatalog([base, incompatible]), /dependency af071-base version is incompatible/);
});

test("rejects dependency cycles while allowing absent optional dependencies", () => {
  const a = manifest({ code: "af071-a", name: "AF-071 A", permissions: [], menus: [], frontendRoutes: [], lifecycle: {}, events: [], jobs: [], dependencies: { "af071-b": "^1.0.0" } });
  const b = manifest({ code: "af071-b", name: "AF-071 B", permissions: [], menus: [], frontendRoutes: [], lifecycle: {}, events: [], jobs: [], dependencies: { "af071-a": "^1.0.0" } });
  assert.throws(() => validatePluginCatalog([a, b]), /dependency cycle detected/);
  const optionalOnly = manifest({ code: "af071-optional", name: "AF-071 optional", permissions: [], menus: [], frontendRoutes: [], lifecycle: {}, events: [], jobs: [], optionalDependencies: { "af071-absent": "^1.0.0" } });
  assert.deepEqual(resolvePluginDependencyOrder(validatePluginCatalog([optionalOnly])), ["af071-optional"]);
});

test("resolves only statically allowlisted Nest module references", () => {
  assert.deepEqual(resolveAllowlistedPluginModules(["aij-notification"], registrations()), [NotificationModule]);
  assert.deepEqual(resolveAllowlistedPluginModules([], registrations()), []);
});

test("rejects unregistered, malformed and duplicate enabled plugin codes", () => {
  assert.throws(() => resolveAllowlistedPluginModules(["aij-ai"], registrations()), /not in the registered backend allowlist/);
  assert.throws(() => resolveAllowlistedPluginModules(["AIJ_AI"], registrations()), /invalid or duplicated/);
  assert.throws(() => resolveAllowlistedPluginModules(["aij-notification", "aij-notification"], registrations()), /invalid or duplicated/);
});

test("rejects mismatched registration keys and duplicate module owners", () => {
  assert.throws(() => resolveAllowlistedPluginModules(["other-plugin"], new Map([["other-plugin", { manifest: manifest(), module: NotificationModule }]])), /does not match/);
  const second = { ...manifest(), code: "aij-payment" };
  assert.throws(() => resolveAllowlistedPluginModules([], new Map([
    ["aij-notification", { manifest: manifest(), module: NotificationModule }],
    ["aij-payment", { manifest: second, module: NotificationModule }]
  ])), /registered more than once/);
});

test("production API runtime defaults to no plugins and rejects unknown configured codes", () => {
  assert.deepEqual(resolvePluginModules([]), []);
  assert.deepEqual(PluginRuntimeModule.forRoot([]).imports, []);
  assert.equal(resolvePluginModules(["aij-ai"]).length, 1);
  assert.throws(() => resolvePluginModules(["unknown-plugin"]), /not in the registered backend allowlist/);
  assert.equal(PluginRuntimeModule.forRoot(["aij-ai"]).imports.length, 1);
  assert.throws(() => PluginRuntimeModule.forRoot(["unknown-plugin"]), /not in the registered backend allowlist/);
});
