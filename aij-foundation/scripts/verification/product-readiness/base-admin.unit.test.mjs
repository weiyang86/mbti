import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { assertLocalStat, profile, root, writePrivate } from "../../base-development/config.mjs";
import { argumentsFor, assertOwnedRole, assertOwnedUser, createReaderRecord, loadReaderRecord, validateReaderRecord } from "./base-admin.mjs";

const owner = { instanceId: randomUUID() };
function readyRecord() {
  return { ...createReaderRecord(owner), adminUserId: randomUUID(), readPermissionId: randomUUID(), userId: randomUUID(), roleId: randomUUID(),
    dictionaryId: randomUUID(), emptyDictionaryId: randomUUID(), itemId: randomUUID(), emptyAccessChecked: true, permissionsAssigned: true, userRoleAssigned: true, ready: true };
}
function user(record) {
  return { id: record.userId, username: record.username, realName: "AF-130 字典只读验收", isSuperAdmin: false, status: "active", roleIds: [record.roleId] };
}
function role(record) {
  return { id: record.roleId, roleCode: record.roleCode, roleName: "AF-130 字典只读", remark: "AF-130:" + record.ownerId + ":" + record.nonce, status: "active", permissionIds: [record.readPermissionId] };
}

test("AF-130 CLI has no alternate instance/credentials/reset options and help performs no live preflight", () => {
  for (const action of ["prepare", "verify", "--help"]) assert.equal(argumentsFor([action]), action);
  for (const args of [[], ["prepare", "--force"], ["reset"], ["verify", "--url", "http://127.0.0.1:3656"], ["prepare", "--password", "secret"]]) assert.throws(() => argumentsFor(args));
  const result = spawnSync(process.execPath, ["scripts/verification/product-readiness/base-admin.mjs", "--help"], { cwd: root, env: { PATH: "/nonexistent" }, encoding: "utf8" });
  assert.equal(result.status, 0); assert.match(result.stdout, /Coordinator only/); assert.match(result.stdout, /No password reset/);
});

test("AF-130 journal binds owner/project/identity, rejects foreign or incomplete resource stages, and exposes no rejected credential", () => {
  const record = readyRecord();
  assert.equal(validateReaderRecord(record, owner), record);
  assert.equal(validateReaderRecord(createReaderRecord(owner), owner).ready, false);
  const secret = "AF130_PRIVATE_CREDENTIAL_CANARY";
  for (const change of [
    { ownerId: randomUUID() }, { ownerId: "foreign" }, { project: "aij-foundation" }, { environment: "test" }, { task: "AF-135" },
    { username: "aij-admin" }, { roleCode: "super_admin" }, { correlationId: "foreign" }, { password: secret + "\n" },
    { userId: "../foreign" }, { roleId: null }, { readPermissionId: null }, { adminUserId: null }, { itemId: null }, { dictionaryId: null },
    { userRoleAssigned: false }, { emptyAccessChecked: false }, { extra: secret }
  ]) {
    assert.throws(() => validateReaderRecord({ ...record, ...change }, owner), error => !error.message.includes(secret));
  }
  for (const change of [
    { emptyAccessChecked: true }, { permissionsAssigned: true }, { userRoleAssigned: true }, { itemId: randomUUID() }, { ready: true }
  ]) assert.throws(() => validateReaderRecord({ ...createReaderRecord(owner), ...change }, owner));
});

test("AF-130 private record is read without rewriting and refuses malformed files, symlinks and foreign OS permissions", () => {
  const parent = join(root, ".artifacts/orca-b02/AF-130/unit"); mkdirSync(parent, { recursive: true });
  const directory = mkdtempSync(join(parent, "private-")); chmodSync(directory, 0o700);
  try {
    const file = join(directory, "reader.json"), record = readyRecord();
    assert.equal(loadReaderRecord(owner, file), null);
    writePrivate(file, record, { exclusive: true });
    const bytes = readFileSync(file);
    assert.equal(loadReaderRecord(owner, file).userId, record.userId);
    assert.ok(readFileSync(file).equals(bytes), "Loading must preserve credential bytes");
    assert.throws(() => loadReaderRecord({ instanceId: randomUUID() }, file));
    symlinkSync(file, join(directory, "symlink.json")); assert.throws(() => loadReaderRecord(owner, join(directory, "symlink.json")));
    assert.throws(() => loadReaderRecord(owner, directory));
    const secret = "AF130_PRIVATE_CREDENTIAL_CANARY";
    writeFileSync(file, secret, { mode: 0o600 });
    assert.throws(() => loadReaderRecord(owner, file), error => !error.message.includes(secret));
    assert.throws(() => assertLocalStat({ uid: -1, mode: 0o100600 }, true));
    assert.throws(() => assertLocalStat({ uid: process.getuid(), mode: 0o100644 }, true));
    assert.equal(profile.project, "aij-base-dev");
  } finally { rmSync(directory, { recursive: true }); }
});

test("AF-130 reuse refuses foreign IDs, super users, extra roles and any authorization drift instead of replacing grants", () => {
  const record = readyRecord();
  assert.doesNotThrow(() => assertOwnedUser(user(record), record));
  assert.doesNotThrow(() => assertOwnedRole(role(record), record));
  for (const change of [{ id: randomUUID() }, { username: "aij-admin" }, { isSuperAdmin: true }, { realName: "foreign" }, { status: "disabled" }, { roleIds: [] }, { roleIds: [record.roleId, randomUUID()] }]) assert.throws(() => assertOwnedUser({ ...user(record), ...change }, record));
  for (const change of [{ id: randomUUID() }, { roleCode: "super_admin" }, { roleName: "foreign" }, { remark: "foreign" }, { status: "disabled" }, { permissionIds: [] }, { permissionIds: [record.readPermissionId, randomUUID()] }]) assert.throws(() => assertOwnedRole({ ...role(record), ...change }, record));
  // An interrupted grant/bind with an unrecorded successful mutation refuses automatic adoption.
  assert.throws(() => assertOwnedRole(role(record), record, false));
  assert.throws(() => assertOwnedUser(user(record), record, false));
  assert.doesNotThrow(() => assertOwnedRole({ ...role(record), permissionIds: [] }, record, false));
  assert.doesNotThrow(() => assertOwnedUser({ ...user(record), roleIds: [] }, record, false));
});
