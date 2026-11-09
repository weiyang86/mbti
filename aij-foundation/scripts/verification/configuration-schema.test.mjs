import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import test from "node:test";
import { assertGeneratedSchema, assertOwnerExtensions, assertRetainedBusinessAbsent } from "./prisma-schema-assertions.mjs";
import { apiRoot, repositoryRoot, schemaInvocation } from "../prisma-schema.mjs";

const require = createRequire(resolve(apiRoot, "package.json"));
const { Prisma } = require("@prisma/client");
const models = Prisma.dmmf.datamodel.models;
const previousNames = ["SysUser", "SysRole", "SysPermission", "SysMenu", "SysUserRole", "SysRolePermission", "SysRoleMenu", "MemberUser", "ClientAuthSession", "ClientAuthOneTimeToken", "ClientConsentRecord", "ClientAuthRateBucket"];
const names = ["OrganizationProfile", "ProjectProfile", "ScopedConfig", "ConfigurationChange", "SecretReference", "AuditLog"];
const schemaPath = resolve(apiRoot, "prisma/schema.prisma");
const schema = readFileSync(schemaPath, "utf8");
const model = (name) => { const m = models.find((m) => m.name === name); assert.ok(m, name); return m; };
const field = (name, key) => { const f = model(name).fields.find((f) => f.name === key); assert.ok(f, name + "." + key); return f; };
const block = (name) => { const b = schema.match(new RegExp("^model " + name + " \\{([\\s\\S]*?)^\\}", "m"))?.[1]; assert.ok(b, name); return b; };

test("real generated schema is current and retains the eighteen configuration/identity/core owner definitions", () => {
  assert.equal(Prisma.prismaVersion.client, "6.19.3");
  assertGeneratedSchema(readFileSync(require.resolve(".prisma/client/schema.prisma"), "utf8"), schema);
  assert.deepEqual(models.filter((m) => [...previousNames, ...names].includes(m.name)).map((m) => m.name), [...previousNames, ...names]);
  assert.deepEqual(names.map((n) => model(n).dbName), ["organization_profile", "project_profile", "scoped_config", "configuration_change", "secret_reference", "audit_log"]);
  assert.deepEqual(Prisma.dmmf.datamodel.enums.filter((e) => ["UserStatus", "ResourceType"].includes(e.name)).map((e) => e.name), ["UserStatus", "ResourceType"]);
});

test("six source models retain their F00 configuration, secret-center and core data owners", () => {
  const rows = readFileSync(resolve(repositoryRoot, "docs/generated/PRISMA_MODEL_OWNERSHIP.csv"), "utf8").split(/\r?\n/);
  for (const name of names) {
    const row = rows.find((line) => line.startsWith(name + ",")); assert.ok(row, name);
    const [sourceOwner, targetOwner] = name === "AuditLog" ? ["platform/core", "AIJ core"] : name === "SecretReference" ? ["foundation/secret-center", "AIJ secret-center"] : ["foundation/configuration", "AIJ configuration"];
    assert.deepEqual(row.split(",").slice(0, 5), [name, sourceOwner, targetOwner, name, "apps/api/prisma/schema.prisma"]);
    assert.equal(row.split(",").at(-1), "cd8d006ffd3f2830dd0bdb4e62d0288e059dd9eb");
  }
});

test("configuration ownership retains its six original links and explicit later project extensions and cannot supply customer membership or permissions", () => {
  const links = names.flatMap((n) => model(n).fields.filter((f) => f.kind === "object" && names.includes(f.type)).map((f) => [n, f.name, f.type]));
  assert.deepEqual(links, [
    ["OrganizationProfile", "projects", "ProjectProfile"], ["ProjectProfile", "organization", "OrganizationProfile"],
    ["ScopedConfig", "changes", "ConfigurationChange"], ["ConfigurationChange", "config", "ScopedConfig"],
    ["ConfigurationChange", "auditLog", "AuditLog"], ["AuditLog", "configurationChanges", "ConfigurationChange"]
  ]);
  assertRetainedBusinessAbsent(models);
  assertOwnerExtensions(models, [...previousNames, ...names]);
  for (const n of ["OrganizationProfile", "ProjectProfile"]) {
    for (const f of model(n).fields) assert.ok(!/member|workspace|permission|roleId|tenantId/i.test(f.name), n + "." + f.name);
  }
  assert.equal(field("AuditLog", "workspaceId").kind, "scalar");
  assert.equal(field("AuditLog", "workspaceId").isRequired, false);
});

for (const name of ["OrganizationProfile", "ProjectProfile"]) {
  test(name + " preserves required unique code and has no business brand default", () => {
    assert.equal(field(name, "code").isUnique, true);
    assert.equal(field(name, "code").isRequired, true);
    assert.equal(field(name, "name").hasDefaultValue, false);
    assert.equal(field(name, "legalEntity").isRequired, false);
  });
}

test("ProjectProfile has a required Restrict/Cascade ownership FK solely to OrganizationProfile", () => {
  const relation = field("ProjectProfile", "organization");
  assert.equal(relation.type, "OrganizationProfile"); assert.equal(relation.isRequired, true);
  assert.deepEqual(relation.relationFromFields, ["organizationId"]); assert.deepEqual(relation.relationToFields, ["id"]);
  assert.equal(relation.relationOnDelete, "Restrict"); assert.equal(relation.relationOnUpdate, "Cascade");
});

test("scope/scopeId/plugin/configKey form one required layered namespace unique key", () => {
  assert.deepEqual(model("ScopedConfig").uniqueFields, [["scope", "scopeId", "pluginCode", "configKey"]]);
  for (const key of ["scope", "scopeId", "pluginCode", "configKey"]) assert.equal(field("ScopedConfig", key).isRequired, true);
  assert.equal(field("ScopedConfig", "pluginCode").default, "");
  assert.equal(field("ScopedConfig", "configValue").hasDefaultValue, false);
});

test("current config version starts at one while public access is false by default", () => {
  const version = field("ScopedConfig", "version");
  assert.equal(version.type, "Int"); assert.equal(version.isRequired, true); assert.equal(version.default, 1);
  assert.equal(field("ScopedConfig", "isPublic").default, false);
  assert.equal(field("ScopedConfig", "sensitive").default, false);
  assert.equal(field("ScopedConfig", "updatedAt").isUpdatedAt, true);
});

test("change captures historical config/version with unique pairing and still permits non-scoped events", () => {
  assert.deepEqual(model("ConfigurationChange").uniqueFields, [["configId", "configVersion"]]);
  for (const key of ["configId", "configVersion", "auditLogId"]) {
    assert.equal(field("ConfigurationChange", key).isRequired, false);
    assert.equal(field("ConfigurationChange", key).hasDefaultValue, false);
  }
  assert.equal(field("ConfigurationChange", "configVersion").type, "Int");
  assert.equal(field("ConfigurationChange", "eventType").default, "configuration.changed");
  assert.equal(field("ConfigurationChange", "changeMetadata").type, "Json");
});

for (const [key, fk, target] of [["config", "configId", "ScopedConfig"], ["auditLog", "auditLogId", "AuditLog"]]) {
  test("change " + key + " link preserves history with an optional Restrict/Cascade FK to stable id", () => {
    const relation = field("ConfigurationChange", key);
    assert.equal(relation.type, target); assert.equal(relation.isRequired, false);
    assert.deepEqual(relation.relationFromFields, [fk]); assert.deepEqual(relation.relationToFields, ["id"]);
    assert.equal(relation.relationOnDelete, "Restrict"); assert.equal(relation.relationOnUpdate, "Cascade");
  });
}

test("audit retains actor/resource/snapshot fields and the configuration reverse link without authorization relations", () => {
  for (const key of ["module", "action", "resourceType"]) assert.equal(field("AuditLog", key).isRequired, true);
  for (const key of ["userId", "userName", "resourceId", "workspaceId"]) {
    assert.equal(field("AuditLog", key).kind, "scalar"); assert.equal(field("AuditLog", key).isRequired, false);
  }
  for (const key of ["beforeData", "afterData", "requestSummary"]) {
    assert.equal(field("AuditLog", key).type, "Json"); assert.equal(field("AuditLog", key).hasDefaultValue, false);
  }
  assert.equal(field("AuditLog", "configurationChanges").type, "ConfigurationChange");
});

test("SecretReference can store reference metadata but has no secret-value or merchant-credential column", () => {
  assert.deepEqual(model("SecretReference").fields.map((f) => f.name), ["id", "ref", "provider", "description", "status", "lastCheckedAt", "lastCheckStatus", "createdAt", "updatedAt", "deletedAt", "connectorInstallations"]);
  assert.equal(field("SecretReference", "ref").isUnique, true);
  assert.equal(field("SecretReference", "ref").hasDefaultValue, false);
  assert.equal(field("SecretReference", "provider").hasDefaultValue, false);
  for (const n of names) for (const f of model(n).fields) assert.doesNotMatch(f.name, /^(secretValue|apiKey|privateKey|merchantId|merchantSecret|password|defaultPrompt)$/i);
});

test("generic brand/JSON/config containers have no payload defaults, real users or business prompts", () => {
  for (const [n, key] of [["ProjectProfile", "brand"], ["OrganizationProfile", "meta"], ["ScopedConfig", "configValue"], ["ConfigurationChange", "operatorId"], ["ConfigurationChange", "operatorName"], ["ConfigurationChange", "changeMetadata"]]) {
    assert.equal(field(n, key).hasDefaultValue, false);
  }
  const safeStrings = new Set(["active", "Asia/Shanghai", "CNY", "zh-CN", "development", "", "string", "configuration.changed", "recorded", "success"]);
  for (const n of names) for (const f of model(n).fields) if (typeof f.default === "string") assert.ok(safeStrings.has(f.default), n + "." + f.name);
});

const indexes = {
  OrganizationProfile: ['@@index([status])'], ProjectProfile: ['@@index([organizationId,status])'],
  ScopedConfig: ['@@index([scope,scopeId,status])', '@@index([pluginCode,configKey])'],
  ConfigurationChange: ['@@index([auditLogId])', '@@index([scope,scopeId,createdAt])', '@@index([configKey])'],
  SecretReference: ['@@index([provider,status])'],
  AuditLog: ['@@index([userId])', '@@index([userName])', '@@index([module])', '@@index([action])', '@@index([createdAt])', '@@index([workspaceId,createdAt],map:"audit_log_workspace_created_idx")']
};
for (const [name, declarations] of Object.entries(indexes)) {
  test(name + " keeps its actual mapped indexes, cuid identity and creation timestamp", () => {
    assert.deepEqual(block(name).split("\n").map((l) => l.replace(/\s+/g, "")).filter((l) => l.startsWith("@@index")), declarations);
    assert.equal(field(name, "id").isId, true); assert.equal(field(name, "id").default.name, "cuid");
    assert.equal(field(name, "createdAt").default.name, "now");
    assert.equal(field(name, "createdAt").dbName, "created_at");
  });
}

for (const [name, mutate] of [
  ["project-as-customer-membership", (s) => s.replace("organization OrganizationProfile @relation", "organization MemberUser @relation")],
  ["invalid-version-default", (s) => s.replace(/(\n\s+version\s+Int\s+)@default\(1\)/, '$1@default("invalid")')],
  ["wrong-audit-key-type", (s) => s.replace(/auditLogId(\s+)String\?/, "auditLogId$1Int?")],
  ["invalid-layered-unique-key", (s) => s.replace("@@unique([scope, scopeId, pluginCode, configKey])", "@@unique([scope, scopeId, pluginCode, unknownKey])")]
]) {
  test("real Prisma rejects " + name + " with P1012/exit1, leaving source schema unchanged", () => {
    const invalid = mutate(schema); assert.notEqual(invalid, schema);
    const root = resolve(repositoryRoot, ".artifacts/af-008/schema-tests"); mkdirSync(root, { recursive: true });
    const directory = mkdtempSync(join(root, name + "-")); const path = join(directory, "invalid.prisma"); writeFileSync(path, invalid);
    const invocation = schemaInvocation(["validate"]); invocation.args.push("--schema", path);
    const result = spawnSync(invocation.command, invocation.args, invocation.options);
    writeFileSync(join(directory, "result.json"), JSON.stringify({command: [invocation.command, ...invocation.args], cwd: invocation.options.cwd, exitCode: result.status, signal: result.signal, stdout: result.stdout, stderr: result.stderr, error: result.error?.code}, null, 2) + "\n");
    assert.equal(result.status, 1); assert.match(result.stdout + result.stderr, /P1012/);
    assert.equal(readFileSync(schemaPath, "utf8"), schema);
  });
}
