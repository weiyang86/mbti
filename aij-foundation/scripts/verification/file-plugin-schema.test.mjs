import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import test from "node:test";
import { assertGeneratedSchema, assertRetainedBusinessAbsent } from "./prisma-schema-assertions.mjs";
import { apiRoot, repositoryRoot, schemaInvocation } from "../prisma-schema.mjs";

const require = createRequire(resolve(apiRoot, "package.json"));
const { Prisma } = require("@prisma/client");
const models = Prisma.dmmf.datamodel.models;
const previousNames = ["SysUser", "AdminAuthSession", "SysRole", "SysPermission", "SysMenu", "SysUserRole", "SysRolePermission", "SysRoleMenu", "MemberUser", "ClientAuthSession", "ClientAuthOneTimeToken", "ClientConsentRecord", "ClientAuthRateBucket", "OrganizationProfile", "ProjectProfile", "ScopedConfig", "ConfigurationChange", "SecretReference", "AuditLog"];
const names = ["FileAsset", "PluginInstallation", "PluginOperation"];
const laterCoreNames = ["SysDict", "SysDictItem"];
const currentNames = [...previousNames, ...names, ...laterCoreNames];
const schemaPath = resolve(apiRoot, "prisma/schema.prisma");
const schema = readFileSync(schemaPath, "utf8");
const model = (name) => { const m = models.find((m) => m.name === name); assert.ok(m, name); return m; };
const field = (name, key) => { const f = model(name).fields.find((f) => f.name === key); assert.ok(f, name + "." + key); return f; };
const block = (name) => { const b = schema.match(new RegExp("^model " + name + " \\{([\\s\\S]*?)^\\}", "m"))?.[1]; assert.ok(b, name); return b; };

test("current generated client has the accepted core models plus three file/plugin models and four enums", () => {
  assert.equal(Prisma.prismaVersion.client, "6.19.3");
  assertGeneratedSchema(readFileSync(require.resolve(".prisma/client/schema.prisma"), "utf8"), schema);
  assert.deepEqual(models.filter((m) => currentNames.includes(m.name)).map((m) => m.name), currentNames);
  assert.deepEqual(names.map((n) => model(n).dbName), ["file_asset", "plugin_installation", "plugin_operation"]);
  assert.deepEqual(Prisma.dmmf.datamodel.enums.filter((e) => ["UserStatus", "ResourceType", "PluginInstallationStatus", "PluginOperationStatus"].includes(e.name)).map((e) => [e.name, e.values.map((v) => v.name)]), [
    ["UserStatus", ["active", "disabled"]], ["ResourceType", ["menu", "button", "api", "data"]],
    ["PluginInstallationStatus", ["uninstalled", "installed", "enabled", "failed"]],
    ["PluginOperationStatus", ["pending", "running", "succeeded", "failed"]]
  ]);
});

test("F00 core owners are reused through explicit FileAsset/Plugin/PluginInstallLog mappings", () => {
  const rows = readFileSync(resolve(repositoryRoot, "docs/generated/PRISMA_MODEL_OWNERSHIP.csv"), "utf8").split(/\r?\n/);
  for (const [source, target] of [["FileAsset", "FileAsset"], ["Plugin", "PluginInstallation"], ["PluginInstallLog", "PluginOperation"]]) {
    const row = rows.find((line) => line.startsWith(source + ",")); assert.ok(row, source);
    assert.deepEqual(row.split(",").slice(0, 5), [source, "platform/core", "AIJ core", source, "apps/api/prisma/schema.prisma"]);
    assert.equal(row.split(",").at(-1), "cd8d006ffd3f2830dd0bdb4e62d0288e059dd9eb");
    assert.ok(names.includes(target));
  }
});

test("all relations have a local owner and the two original history links plus explicit plugin retry links are retained", () => {
  assertRetainedBusinessAbsent(models);
  assert.deepEqual(names.flatMap((n) => model(n).fields.filter((f) => f.kind === "object").map((f) => [n, f.name, f.type])), [
    ["FileAsset", "aiAgentRuns", "AiAgentRun"],
    ["PluginInstallation", "operations", "PluginOperation"], ["PluginOperation", "installation", "PluginInstallation"],
    ["PluginOperation", "retryOfOperation", "PluginOperation"], ["PluginOperation", "retryAttempt", "PluginOperation"]
  ]);
});

test("file metadata preserves only twenty source scalars without business association columns or file bytes", () => {
  assert.deepEqual(model("FileAsset").fields.filter((f) => f.kind !== "object").map((f) => f.name), ["id", "originalName", "filename", "mimeType", "size", "path", "url", "storageType", "objectKey", "checksum", "projectId", "workspaceId", "pluginCode", "ownerType", "ownerId", "uploaderId", "status", "createdAt", "updatedAt", "deletedAt"]);
  for (const key of ["originalName", "filename", "mimeType", "size", "path", "url"]) {
    assert.equal(field("FileAsset", key).isRequired, true); assert.equal(field("FileAsset", key).hasDefaultValue, false);
  }
  assert.equal(field("FileAsset", "size").type, "Int");
  assert.equal(field("FileAsset", "storageType").default, "local");
  assert.equal(field("FileAsset", "ownerType").default, "user");
  assert.equal(field("FileAsset", "status").default, "active");
  assert.equal(field("FileAsset", "deletedAt").isRequired, false);
  assert.equal(field("FileAsset", "updatedAt").isUpdatedAt, true);
});

test("file lookup keys preserve unique object key and workspace composite key without a workspace FK", () => {
  assert.equal(field("FileAsset", "objectKey").isUnique, true); assert.equal(field("FileAsset", "objectKey").isRequired, false);
  assert.deepEqual(model("FileAsset").uniqueFields, [["id", "workspaceId"]]);
  for (const key of ["projectId", "workspaceId", "pluginCode", "ownerId", "uploaderId", "checksum"]) {
    assert.equal(field("FileAsset", key).kind, "scalar"); assert.equal(field("FileAsset", key).isRequired, false);
    assert.equal(field("FileAsset", key).hasDefaultValue, false);
  }
});

test("plugin namespace is unique per required project and code, not globally shared by code", () => {
  assert.deepEqual(model("PluginInstallation").uniqueFields, [["projectId", "pluginCode"]]);
  for (const key of ["projectId", "pluginCode", "version", "owner"]) {
    assert.equal(field("PluginInstallation", key).type, "String"); assert.equal(field("PluginInstallation", key).isRequired, true);
    assert.equal(field("PluginInstallation", key).hasDefaultValue, false); assert.equal(field("PluginInstallation", key).isUnique, false);
  }
  assert.equal(field("PluginInstallation", "status").type, "PluginInstallationStatus");
  assert.equal(field("PluginInstallation", "status").default, "uninstalled");
  assert.equal(field("PluginInstallation", "updatedAt").isUpdatedAt, true);
});

test("installation lifecycle timestamps are optional snapshots with no automatic enablement", () => {
  for (const key of ["installedAt", "enabledAt", "disabledAt", "uninstalledAt"]) {
    assert.equal(field("PluginInstallation", key).type, "DateTime"); assert.equal(field("PluginInstallation", key).isRequired, false);
    assert.equal(field("PluginInstallation", key).hasDefaultValue, false);
  }
  assert.ok(!model("PluginInstallation").fields.some((f) => f.name === "enabled"));
});

test("operation captures required action/version/owner and defaults pending without running a plugin", () => {
  assert.deepEqual(model("PluginOperation").fields.map((f) => f.name), ["id", "installationId", "action", "version", "previousVersion", "owner", "status", "failureReason", "operatorId", "retryOfOperationId", "startedAt", "finishedAt", "createdAt", "installation", "retryOfOperation", "retryAttempt"]);
  assert.equal(field("PluginOperation", "previousVersion").type, "String");
  assert.equal(field("PluginOperation", "previousVersion").isRequired, false);
  assert.equal(field("PluginOperation", "previousVersion").hasDefaultValue, false);
  for (const key of ["action", "version", "owner"]) {
    assert.equal(field("PluginOperation", key).type, "String"); assert.equal(field("PluginOperation", key).isRequired, true);
    assert.equal(field("PluginOperation", key).hasDefaultValue, false);
  }
  assert.equal(field("PluginOperation", "status").type, "PluginOperationStatus");
  assert.equal(field("PluginOperation", "status").default, "pending");
  for (const key of ["startedAt", "finishedAt"]) {
    assert.equal(field("PluginOperation", key).type, "DateTime"); assert.equal(field("PluginOperation", key).isRequired, false);
    assert.equal(field("PluginOperation", key).hasDefaultValue, false);
  }
});

test("operation has a required stable installation FK with Restrict/Cascade to retain history", () => {
  const f = field("PluginOperation", "installation");
  assert.equal(f.type, "PluginInstallation"); assert.equal(f.isRequired, true);
  assert.deepEqual(f.relationFromFields, ["installationId"]); assert.deepEqual(f.relationToFields, ["id"]);
  assert.equal(f.relationOnDelete, "Restrict"); assert.equal(f.relationOnUpdate, "Cascade");
  assert.equal(field("PluginOperation", "installationId").isRequired, true);
  assert.equal(field("PluginOperation", "operatorId").kind, "scalar");
  assert.equal(field("PluginOperation", "retryOfOperationId").isUnique, true);
  assert.equal(field("PluginOperation", "retryOfOperationId").isRequired, false);
  assert.equal(field("PluginOperation", "retryOfOperation").relationOnDelete, "Restrict");
  assert.deepEqual(field("PluginOperation", "retryOfOperation").relationFromFields, ["retryOfOperationId"]);
});

test("both plugin records can capture failure reasons without default payloads or credentials", () => {
  for (const n of ["PluginInstallation", "PluginOperation"]) {
    const f = field(n, "failureReason");
    assert.equal(f.type, "String"); assert.equal(f.dbName, "failure_reason");
    assert.equal(f.isRequired, false); assert.equal(f.hasDefaultValue, false);
  }
  const defaults = new Set(["local", "user", "active", "uninstalled", "pending"]);
  for (const n of names) for (const f of model(n).fields) {
    if (typeof f.default === "string") assert.ok(defaults.has(f.default), n + "." + f.name);
    assert.doesNotMatch(f.name, /password|secretValue|apiKey|merchant|prompt|payload|bizType|bizId/i);
  }
  const newBlocks = names.map(block).join("\n");
  assert.doesNotMatch(newBlocks, /qingqi|CompanyProfile|SiteMedia|\/Users\/|\/Volumes\/|15435|uploads\//i);
});

const indexes = {
  FileAsset: ['@@index([uploaderId])', '@@index([projectId,pluginCode])', '@@index([workspaceId,pluginCode],map:"file_asset_workspace_plugin_idx")', '@@index([ownerType,ownerId])', '@@index([status])'],
  PluginInstallation: ['@@index([status])'],
  PluginOperation: ['@@index([installationId,createdAt])', '@@index([status,createdAt])']
};
for (const [name, declarations] of Object.entries(indexes)) {
  test(name + " has declared query indexes, cuid identity and creation timestamp", () => {
    assert.deepEqual(block(name).split("\n").map((l) => l.replace(/\s+/g, "")).filter((l) => l.startsWith("@@index")), declarations);
    assert.equal(field(name, "id").isId, true); assert.equal(field(name, "id").default.name, "cuid");
    assert.equal(field(name, "createdAt").default.name, "now"); assert.equal(field(name, "createdAt").dbName, "created_at");
  });
}

for (const [name, mutate] of [
  ["operation-cannot-default-enabled", (s) => s.replace(/(status\s+PluginOperationStatus\s+)@default\(pending\)/, "$1@default(enabled)")],
  ["wrong-installation-fk-type", (s) => s.replace(/installationId(\s+)String\s+@map/, "installationId$1Int @map")],
  ["invalid-project-namespace", (s) => s.replace("@@unique([projectId, pluginCode])", "@@unique([projectId, pluginCode, unknownKey])")],
  ["business-file-relation", (s) => s.replace(/(model FileAsset \{)/, "$1\n  siteMediaLinks SiteMediaLink[]")]
]) {
  test("real Prisma rejects " + name + " with P1012/exit1 and does not mutate source", () => {
    const invalid = mutate(schema); assert.notEqual(invalid, schema);
    const root = resolve(repositoryRoot, ".artifacts/af-009/schema-tests"); mkdirSync(root, { recursive: true });
    const directory = mkdtempSync(join(root, name + "-")); const path = join(directory, "invalid.prisma"); writeFileSync(path, invalid);
    const invocation = schemaInvocation(["validate"]); invocation.args.push("--schema", path);
    const result = spawnSync(invocation.command, invocation.args, invocation.options);
    writeFileSync(join(directory, "result.json"), JSON.stringify({command: [invocation.command, ...invocation.args], cwd: invocation.options.cwd, exitCode: result.status, signal: result.signal, stdout: result.stdout, stderr: result.stderr, error: result.error?.code}, null, 2) + "\n");
    assert.equal(result.status, 1); assert.match(result.stdout + result.stderr, /P1012/);
    assert.equal(readFileSync(schemaPath, "utf8"), schema);
  });
}
