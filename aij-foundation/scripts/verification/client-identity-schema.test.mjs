import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import test from "node:test";
import { assertGeneratedSchema, assertOwnerExtensions, assertRetainedBusinessAbsent, ownerExtensions } from "./prisma-schema-assertions.mjs";
import { apiRoot, repositoryRoot, schemaInvocation } from "../prisma-schema.mjs";

const require = createRequire(resolve(apiRoot, "package.json"));
const { Prisma } = require("@prisma/client");
const models = Prisma.dmmf.datamodel.models;
const coreNames = ["SysUser", "SysRole", "SysPermission", "SysMenu", "SysUserRole", "SysRolePermission", "SysRoleMenu"];
const identityNames = ["MemberUser", "ClientAuthSession", "ClientAuthOneTimeToken", "ClientConsentRecord", "ClientAuthRateBucket"];
// Later owners have their own bounded schema suite; retain this identity/core projection.
const identityAndCoreModels = models.filter((m) => [...coreNames, ...identityNames].includes(m.name));
const tables = ["member_user", "client_auth_session", "client_auth_one_time_token", "client_consent_record", "client_auth_rate_bucket"];
const schemaPath = resolve(apiRoot, "prisma/schema.prisma");
const schema = readFileSync(schemaPath, "utf8");
const model = (name) => { const m = models.find((m) => m.name === name); assert.ok(m, name); return m; };
const field = (name, key) => { const f = model(name).fields.find((f) => f.name === key); assert.ok(f, name + "." + key); return f; };
const block = (name) => { const b = schema.match(new RegExp("^model " + name + " \\{([\\s\\S]*?)^\\}", "m"))?.[1]; assert.ok(b, name); return b; };

test("actual generated client matches current schema and its seven core plus five identity definitions", () => {
  assert.equal(Prisma.prismaVersion.client, "6.19.3");
  assertGeneratedSchema(readFileSync(require.resolve(".prisma/client/schema.prisma"), "utf8"), schema);
  assert.deepEqual(identityAndCoreModels.map((m) => m.name), [...coreNames, ...identityNames]);
  assert.deepEqual(identityNames.map((name) => model(name).dbName), tables);
  assert.deepEqual(Prisma.dmmf.datamodel.enums.filter((e) => ["UserStatus", "ResourceType"].includes(e.name)).map((e) => e.name), ["UserStatus", "ResourceType"]);
});

test("five identity owners match F00, with explicit later generic reverse links and separate admin identity", () => {
  const rows = readFileSync(resolve(repositoryRoot, "docs/generated/PRISMA_MODEL_OWNERSHIP.csv"), "utf8").split(/\r?\n/);
  for (const name of identityNames) {
    const row = rows.find((line) => line.startsWith(name + ",")); assert.ok(row, name);
    assert.deepEqual(row.split(",").slice(0, 5), [name, "qingqi-app/client-auth", "AIJ identity", name, "apps/api/prisma/schema.prisma"]);
    assert.equal(row.split(",").at(-1), "cd8d006ffd3f2830dd0bdb4e62d0288e059dd9eb");
  }
  assertRetainedBusinessAbsent(models);
  assertOwnerExtensions(models, [...coreNames, ...identityNames]);
  for (const m of identityAndCoreModels) {
    for (const f of m.fields.filter((f) => f.kind === "object" && [...coreNames, ...identityNames].includes(f.type))) {
      assert.ok([...coreNames, ...identityNames].includes(f.type), m.name + "." + f.name);
      assert.ok((coreNames.includes(m.name) ? coreNames : identityNames).includes(f.type), "admin/client relation crosses identity owners");
    }
  }
  assert.deepEqual(model("MemberUser").fields.filter((f) => f.kind === "object" && identityNames.includes(f.type)).map((f) => f.name), ["authSessions", "authTokens", "consentRecords"]);
  assert.deepEqual(model("ClientAuthRateBucket").fields.filter((f) => f.kind === "object"), []);
});

test("MemberUser preserves credential/version fields and remains separate from required admin hash and privileges", () => {
  assert.deepEqual(model("MemberUser").fields.filter((f) => !ownerExtensions.MemberUser.some(([name]) => name === f.name)).map((f) => f.name), [
    "id", "username", "mobile", "email", "nickname", "avatar", "passwordHash", "tokenVersion", "lastLoginAt", "passwordChangedAt", "emailVerifiedAt", "status", "remark", "createdAt", "updatedAt", "deletedAt", "authSessions", "authTokens", "consentRecords"
  ]);
  assert.equal(field("MemberUser", "passwordHash").dbName, "password_hash");
  assert.equal(field("MemberUser", "passwordHash").isRequired, false);
  assert.equal(field("MemberUser", "passwordHash").hasDefaultValue, false);
  assert.equal(field("MemberUser", "tokenVersion").type, "Int");
  assert.equal(field("MemberUser", "tokenVersion").default, 0);
  for (const key of ["passwordChangedAt", "emailVerifiedAt", "lastLoginAt"]) {
    assert.equal(field("MemberUser", key).type, "DateTime");
    assert.equal(field("MemberUser", key).isRequired, false);
  }
  assert.equal(field("SysUser", "passwordHash").isRequired, true);
  assert.equal(field("SysUser", "isSuperAdmin").default, false);
});

for (const key of ["username", "mobile", "email"]) {
  test("optional member " + key + " keeps its unique constraint without inventing registration validation", () => {
    assert.equal(field("MemberUser", key).isUnique, true);
    assert.equal(field("MemberUser", key).isRequired, false);
    assert.equal(field("MemberUser", key).type, "String");
  });
}

test("one-time token stores a unique hash, purpose, expiration and nullable consumption/revocation timestamps", () => {
  for (const [key, type] of [["memberId", "String"], ["purpose", "String"], ["tokenHash", "String"], ["expiresAt", "DateTime"]]) {
    assert.equal(field("ClientAuthOneTimeToken", key).type, type);
    assert.equal(field("ClientAuthOneTimeToken", key).isRequired, true);
    assert.equal(field("ClientAuthOneTimeToken", key).hasDefaultValue, false);
  }
  assert.equal(field("ClientAuthOneTimeToken", "tokenHash").isUnique, true);
  for (const key of ["consumedAt", "revokedAt"]) {
    assert.equal(field("ClientAuthOneTimeToken", key).type, "DateTime");
    assert.equal(field("ClientAuthOneTimeToken", key).isRequired, false);
    assert.equal(field("ClientAuthOneTimeToken", key).hasDefaultValue, false);
  }
  assert.ok(!model("ClientAuthOneTimeToken").fields.some((f) => ["token", "rawToken", "plaintextToken"].includes(f.name)));
});

test("session stores expiry, revocation state/reason and hashed device/IP metadata", () => {
  for (const [key, type] of [["memberId", "String"], ["status", "String"], ["deviceHash", "String"], ["deviceSummary", "String"], ["ipHash", "String"], ["expiresAt", "DateTime"]]) {
    assert.equal(field("ClientAuthSession", key).type, type);
    assert.equal(field("ClientAuthSession", key).isRequired, true);
  }
  assert.equal(field("ClientAuthSession", "status").default, "active");
  assert.equal(field("ClientAuthSession", "revokedAt").type, "DateTime");
  assert.equal(field("ClientAuthSession", "revokedAt").isRequired, false);
  assert.equal(field("ClientAuthSession", "revokeReason").isRequired, false);
  for (const key of ["issuedAt", "lastSeenAt"]) assert.equal(field("ClientAuthSession", key).default.name, "now");
});

test("consent has explicit grant/deny, version/digest/source and capture time without a default grant", () => {
  for (const key of ["memberId", "consentType", "textVersion", "textDigest", "source"]) {
    assert.equal(field("ClientConsentRecord", key).type, "String");
    assert.equal(field("ClientConsentRecord", key).isRequired, true);
    assert.equal(field("ClientConsentRecord", key).hasDefaultValue, false);
  }
  assert.equal(field("ClientConsentRecord", "granted").type, "Boolean");
  assert.equal(field("ClientConsentRecord", "granted").isRequired, true);
  assert.equal(field("ClientConsentRecord", "granted").hasDefaultValue, false);
  assert.equal(field("ClientConsentRecord", "capturedAt").default.name, "now");
});

test("rate bucket keeps per-scope hashed identity, counters, time window and block state", () => {
  assert.deepEqual(model("ClientAuthRateBucket").uniqueFields, [["scope", "keyHash"]]);
  for (const key of ["scope", "keyHash"]) {
    assert.equal(field("ClientAuthRateBucket", key).isRequired, true);
    assert.equal(field("ClientAuthRateBucket", key).type, "String");
  }
  assert.equal(field("ClientAuthRateBucket", "attemptCount").default, 0);
  assert.equal(field("ClientAuthRateBucket", "blockedUntil").type, "DateTime");
  assert.equal(field("ClientAuthRateBucket", "blockedUntil").isRequired, false);
  for (const key of ["windowStartedAt", "lastAttemptAt"]) assert.equal(field("ClientAuthRateBucket", key).default.name, "now");
});

for (const name of ["ClientAuthSession", "ClientAuthOneTimeToken", "ClientConsentRecord"]) {
  test(name + " references only MemberUser with explicit required Restrict/Cascade FK", () => {
    const relation = field(name, "member");
    assert.equal(relation.type, "MemberUser");
    assert.equal(relation.isRequired, true);
    assert.deepEqual(relation.relationFromFields, ["memberId"]);
    assert.deepEqual(relation.relationToFields, ["id"]);
    assert.equal(relation.relationOnDelete, "Restrict");
    assert.equal(relation.relationOnUpdate, "Cascade");
  });
}

const indexDeclarations = {
  MemberUser: ['@@index([status])'],
  ClientAuthSession: ['@@index([namespace,memberId,status,lastSeenAt],map:"client_auth_session_namespace_member_status_seen_idx")', '@@index([expiresAt],map:"client_auth_session_expires_idx")'],
  ClientAuthOneTimeToken: ['@@index([memberId,purpose,createdAt],map:"client_auth_token_member_purpose_created_idx")', '@@index([purpose,expiresAt],map:"client_auth_token_purpose_expires_idx")'],
  ClientConsentRecord: ['@@index([namespace,memberId,consentType,capturedAt],map:"client_consent_namespace_member_type_captured_idx")'],
  ClientAuthRateBucket: ['@@index([scope,blockedUntil])', '@@index([windowStartedAt])']
};
for (const [name, declarations] of Object.entries(indexDeclarations)) {
  test(name + " preserves its actual source indexes and cuid/timestamp mapping", () => {
    assert.deepEqual(block(name).split("\n").map((line) => line.replace(/\s+/g, "")).filter((line) => line.startsWith("@@index")), declarations);
    assert.equal(field(name, "id").isId, true);
    assert.equal(field(name, "id").default.name, "cuid");
    assert.equal(field(name, "createdAt").dbName, "created_at");
    assert.equal(field(name, "createdAt").default.name, "now");
    assert.equal(field(name, "updatedAt").isUpdatedAt, true);
    assert.equal(field(name, "deletedAt").isRequired, false);
  });
}

for (const [name, mutate] of [
  ["business-member-target", (s) => s.replace("member MemberUser @relation", "member CompanyProfile @relation")],
  ["wrong-member-key-type", (s) => s.replace("memberId      String    @map", "memberId      Int       @map")],
  ["missing-session-reverse-relation", (s) => s.replace(/^\s+authSessions\s+ClientAuthSession\[\]\s*$/m, "")]
]) {
  test("actual Prisma rejects " + name + " with nonzero P1012 before any database connection", () => {
    const invalid = mutate(schema); assert.notEqual(invalid, schema);
    const root = resolve(repositoryRoot, ".artifacts/af-007/schema-tests"); mkdirSync(root, { recursive: true });
    const directory = mkdtempSync(join(root, name + "-"));
    const path = join(directory, "invalid.prisma"); writeFileSync(path, invalid);
    const invocation = schemaInvocation(["validate"]); invocation.args.push("--schema", path);
    const result = spawnSync(invocation.command, invocation.args, invocation.options);
    writeFileSync(join(directory, "result.json"), JSON.stringify({ command: [invocation.command, ...invocation.args], cwd: invocation.options.cwd,
      exitCode: result.status, signal: result.signal, stdout: result.stdout, stderr: result.stderr, error: result.error?.code }, null, 2) + "\n");
    assert.equal(result.status, 1);
    assert.match(result.stderr + result.stdout, /P1012/);
    assert.equal(readFileSync(schemaPath, "utf8"), schema);
  });
}
