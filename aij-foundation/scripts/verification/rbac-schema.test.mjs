import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import test from "node:test";
import { assertGeneratedSchema, assertOwnerExtensions, assertRetainedBusinessAbsent, ownerExtensions } from "./prisma-schema-assertions.mjs";
import { apiRoot, repositoryRoot, schemaInvocation } from "../prisma-schema.mjs";

const require = createRequire(resolve(apiRoot, "package.json"));
const { Prisma } = require("@prisma/client");
const schemaPath = resolve(apiRoot, "prisma/schema.prisma");
const schema = readFileSync(schemaPath, "utf8");
const names = ["SysUser", "SysRole", "SysPermission", "SysMenu", "SysUserRole", "SysRolePermission", "SysRoleMenu"];
// AF-007 adds a separate identity owner. Keep the seven core assertions intact;
// each owner suite checks its definitions; the latest schema task bounds the full model set.
const models = Prisma.dmmf.datamodel.models.filter((m) => names.includes(m.name));
const model = (name) => { const value = models.find((m) => m.name === name); assert.ok(value, name); return value; };
const field = (name, key) => { const value = model(name).fields.find((f) => f.name === key); assert.ok(value, name + "." + key); return value; };
const tables = ["sys_user", "sys_role", "sys_permission", "sys_menu", "sys_user_role", "sys_role_permission", "sys_role_menu"];
const artifactRoot = resolve(repositoryRoot, ".artifacts/af-006/schema-tests");
mkdirSync(artifactRoot, { recursive: true });
const evidence = mkdtempSync(join(artifactRoot, "run-"));
function record(name, invocation) {
  const result = spawnSync(invocation.command, invocation.args, invocation.options);
  writeFileSync(join(evidence, name + ".json"), JSON.stringify({
    command: [invocation.command, ...invocation.args], cwd: invocation.options.cwd,
    exitCode: result.status, signal: result.signal, error: result.error?.code,
    stdout: result.stdout, stderr: result.stderr
  }, null, 2) + "\n");
  return result;
}

test("generated client is 6.19.3 and was generated from every token of the current schema", () => {
  assert.equal(require("prisma/package.json").version, "6.19.3");
  assert.equal(Prisma.prismaVersion.client, "6.19.3");
  assertGeneratedSchema(readFileSync(require.resolve(".prisma/client/schema.prisma"), "utf8"), schema);
  assert.deepEqual(models.map((m) => m.name), names);
  assert.deepEqual(models.map((m) => m.dbName), tables);
  assert.deepEqual(Prisma.dmmf.datamodel.types, []);
});

test("all seven owners match the accepted F00 core rows and core relations close locally with explicit later generic extensions", () => {
  const rows = readFileSync(resolve(repositoryRoot, "docs/generated/PRISMA_MODEL_OWNERSHIP.csv"), "utf8").split(/\r?\n/);
  for (const name of names) {
    const row = rows.find((line) => line.startsWith(name + ","));
    assert.ok(row, name);
    assert.deepEqual(row.split(",").slice(0, 5), [name, "platform/core", "AIJ core", name, "apps/api/prisma/schema.prisma"]);
    assert.equal(row.split(",").at(-1), "cd8d006ffd3f2830dd0bdb4e62d0288e059dd9eb");
  }
  assertRetainedBusinessAbsent(Prisma.dmmf.datamodel.models);
  assertOwnerExtensions(Prisma.dmmf.datamodel.models, names);
  const relations = models.flatMap((m) => m.fields.filter((f) => f.kind === "object" && names.includes(f.type)));
  assert.equal(relations.length, 12);
  for (const relation of relations) assert.ok(names.includes(relation.type), relation.type);
  assert.deepEqual(model("SysUser").fields.filter((f) => f.kind === "object" && names.includes(f.type)).map((f) => f.name), ["userRoles"]);
});

test("retained business models and enums are absent; admin extensions remain explicit from generated metadata", () => {
  assert.deepEqual(Prisma.dmmf.datamodel.enums.filter((e) => ["UserStatus", "ResourceType"].includes(e.name)).map((e) => [e.name, e.values.map((v) => v.name)]), [
    ["UserStatus", ["active", "disabled"]], ["ResourceType", ["menu", "button", "api", "data"]]
  ]);
  assertRetainedBusinessAbsent(Prisma.dmmf.datamodel.models);
  assert.deepEqual(model("SysUser").fields.map((f) => f.name), [
    "id", "username", "passwordHash", "realName", "phone", "email", "status", "isSuperAdmin", "lastLoginAt", "createdAt", "updatedAt", "deletedAt", "userRoles", "tokenVersion", ...ownerExtensions.SysUser.map(([name]) => name)
  ]);
});

for (const [name, key] of [["SysUser", "username"], ["SysRole", "roleCode"], ["SysPermission", "permissionCode"], ["SysMenu", "path"]]) {
  test(name + "." + key + " is required and uniquely constrained", () => {
    assert.equal(field(name, key).isUnique, true);
    assert.equal(field(name, key).isRequired, true);
  });
}

for (const [name, keys] of [["SysUserRole", ["userId", "roleId"]], ["SysRolePermission", ["roleId", "permissionId"]], ["SysRoleMenu", ["roleId", "menuId"]]]) {
  test(name + " prevents duplicate assignments with a composite unique key", () => {
    assert.deepEqual(model(name).uniqueFields, [keys]);
    for (const key of keys) assert.equal(field(name, key).isRequired, true);
  });
}

for (const [name, key, target, fk] of [
  ["SysUserRole", "user", "SysUser", "userId"], ["SysUserRole", "role", "SysRole", "roleId"],
  ["SysRolePermission", "role", "SysRole", "roleId"], ["SysRolePermission", "permission", "SysPermission", "permissionId"],
  ["SysRoleMenu", "role", "SysRole", "roleId"], ["SysRoleMenu", "menu", "SysMenu", "menuId"]
]) {
  test(name + "." + key + " owns a mandatory Restrict/Cascade FK to " + target, () => {
    const relation = field(name, key);
    assert.equal(relation.type, target);
    assert.equal(relation.isRequired, true);
    assert.equal(relation.isList, false);
    assert.deepEqual(relation.relationFromFields, [fk]);
    assert.deepEqual(relation.relationToFields, ["id"]);
    assert.equal(relation.relationOnDelete, "Restrict");
    assert.equal(relation.relationOnUpdate, "Cascade");
  });
}

test("core IDs, hash storage, defaults and source menu scalar references retain their semantics", () => {
  for (const name of names) {
    assert.equal(field(name, "id").isId, true);
    assert.equal(field(name, "id").default.name, "cuid");
  }
  assert.equal(field("SysUser", "tokenVersion").type, "Int");
  assert.equal(field("SysUser", "tokenVersion").default, 0);
  assert.equal(field("SysUser", "passwordHash").dbName, "password_hash");
  assert.equal(field("SysUser", "passwordHash").isRequired, true);
  assert.equal(field("SysUser", "passwordHash").hasDefaultValue, false);
  assert.equal(field("SysUser", "isSuperAdmin").default, false);
  assert.equal(field("SysUser", "status").default, "active");
  assert.equal(field("SysUser", "updatedAt").isUpdatedAt, true);
  for (const key of ["parentId", "permissionCode", "pluginCode"]) {
    assert.equal(field("SysMenu", key).kind, "scalar");
    assert.equal(field("SysMenu", key).isRequired, false);
  }
  // DMMF omits non-unique indexes; check the two actual schema declarations separately.
  const menuBlock = schema.match(/model SysMenu \{([\s\S]*?)\n\}/)?.[1];
  assert.ok(menuBlock);
  assert.match(menuBlock, /@@index\(\[parentId\]\)/);
  assert.match(menuBlock, /@@index\(\[status\]\)/);
});

test("offline invocation strips database credentials, preload and engine overrides", () => {
  const invocation = schemaInvocation(["--", "validate"], {
    PATH: process.env.PATH, DATABASE_URL: "old-database-value", TEST_DATABASE_URL: "another-database-value",
    NODE_OPTIONS: "--require=/invalid-preload.cjs", PRISMA_SCHEMA_ENGINE_BINARY: "/untrusted/engine",
    PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING: "1", PGHOST: "external", SECRET: "private-value"
  });
  assert.deepEqual(Object.keys(invocation.options.env).sort(), ["CHECKPOINT_DISABLE", "DATABASE_URL", "PATH", "PRISMA_HIDE_UPDATE_MESSAGE"].sort());
  assert.equal(invocation.options.env.DATABASE_URL, "postgresql://aij_schema_compile@127.0.0.1:1/aij_schema_compile");
  assert.equal(invocation.options.shell, false);
  assert.equal(invocation.options.cwd, apiRoot);
});

test("actual validate ignores incoming old database URL and leaves schema unchanged", () => {
  const before = createHash("sha256").update(readFileSync(schemaPath)).digest("hex");
  const incoming = "postgresql://synthetic:af006-incoming-only@127.0.0.1:15435/old_project";
  const invocation = schemaInvocation(["validate"]);
  const result = record("validate-ignores-incoming-url", {
    command: process.execPath, args: [resolve(repositoryRoot, "scripts/prisma-schema.mjs"), "validate"],
    options: { ...invocation.options, env: { ...invocation.options.env, DATABASE_URL: incoming, TEST_DATABASE_URL: incoming } }
  });
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout + result.stderr, /af006-incoming-only|15435|old_project/);
  assert.equal(createHash("sha256").update(readFileSync(schemaPath)).digest("hex"), before);
});

test("CLI rejects database commands, extra arguments and repeated separators before execution", () => {
  for (const args of [[], ["migrate"], ["db", "push"], ["generate", "--sql"], ["--", "--", "validate"]]) {
    assert.throws(() => schemaInvocation(args));
  }
  const invocation = schemaInvocation(["validate"]);
  const result = record("reject-migrate", {
    command: process.execPath, args: [resolve(repositoryRoot, "scripts/prisma-schema.mjs"), "migrate"], options: invocation.options
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /no database operations/);
});

for (const [name, replace] of [
  ["missing-relation-owner", (s) => s.replace("user   SysUser @relation", "user   CompanyProfile @relation")],
  ["wrong-foreign-key-type", (s) => s.replace("userId String  @map", "userId Int     @map")],
  ["unknown-enum-default", (s) => s.replace("@default(active)", "@default(unregistered)")]
]) {
  test("real Prisma rejects " + name + " with P1012 and nonzero exit", () => {
    const invalidSchema = replace(schema);
    assert.notEqual(invalidSchema, schema);
    const fixturePath = join(evidence, name + ".prisma");
    writeFileSync(fixturePath, invalidSchema);
    const invocation = schemaInvocation(["validate"]);
    invocation.args.push("--schema", fixturePath);
    const result = record(name, invocation);
    assert.equal(result.status, 1);
    assert.match(result.stderr + result.stdout, /P1012/);
    assert.equal(readFileSync(schemaPath, "utf8"), schema);
  });
}
