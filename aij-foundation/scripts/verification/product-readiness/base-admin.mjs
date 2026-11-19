import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isAdminPassword } from "../../admin-policy.cjs";
import { BASE_DEVELOPMENT_MENUS } from "../../base-policy.cjs";
import { DICTIONARY_READ_PERMISSION as readCode, DICTIONARY_PERMISSION as manageCode } from "../../dictionary-policy.cjs";
import { assertPath, assertRepository, paths, profile, readLocalState, root, writePrivate } from "../../base-development/config.mjs";
import { baseApi, baseOrigin, basePreflight, baseSession } from "../base-development-support.mjs";

// Coordinator-only live entry points. Importing this module does no I/O, login or preflight.
export const readerPath = join(profile.directory, "af130-reader.json");
const lockPath = join(profile.directory, "af130-reader.lock");
const equal = (actual, expected, message) => assert.ok(JSON.stringify(actual) === JSON.stringify(expected), message);
const digest = value => createHash("sha256").update(value).digest("hex");
const flatten = nodes => nodes.flatMap(node => [...(node.path ? [node.path] : []), ...flatten(node.children)]);
const id = value => typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const nullableIds = ["adminUserId", "readPermissionId", "userId", "roleId", "dictionaryId", "emptyDictionaryId", "itemId"];
const flags = ["emptyAccessChecked", "permissionsAssigned", "userRoleAssigned", "ready"];

export function createReaderRecord(owner) {
  const nonce = randomBytes(6).toString("hex");
  return { version: 1, task: "AF-130", ownerId: owner.instanceId, project: profile.project, environment: profile.environment,
    nonce, username: "af130-reader-" + nonce, password: "AF130-Az7!" + randomBytes(24).toString("hex"),
    roleCode: "af130_reader_" + nonce, correlationId: "af130-prepare-" + nonce,
    ...Object.fromEntries(nullableIds.map(key => [key, null])), ...Object.fromEntries(flags.map(key => [key, false])) };
}
export function validateReaderRecord(record, owner) {
  const keys = ["version", "task", "ownerId", "project", "environment", "nonce", "username", "password", "roleCode", "correlationId", ...nullableIds, ...flags];
  assert.ok(record && typeof record === "object" && Object.keys(record).length === keys.length && keys.every(key => Object.hasOwn(record, key)), "Incomplete or unknown AF-130 credential record; no adoption");
  assert.ok(record.version === 1 && record.task === "AF-130" && record.ownerId === owner.instanceId && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(record.ownerId) &&
    record.project === profile.project && record.environment === profile.environment, "AF-130 credentials belong to another Base owner/project");
  assert.ok(/^[a-f0-9]{12}$/.test(record.nonce) && record.username === "af130-reader-" + record.nonce && record.roleCode === "af130_reader_" + record.nonce && record.correlationId === "af130-prepare-" + record.nonce && isAdminPassword(record.password), "Invalid AF-130 identity/credential binding");
  assert.ok(nullableIds.every(key => record[key] === null || id(record[key])) && flags.every(key => typeof record[key] === "boolean"), "Invalid AF-130 resource identifiers or stages");
  assert.ok(!record.emptyAccessChecked || record.userId, "Empty access observation requires a recorded user");
  assert.ok(!record.permissionsAssigned || record.roleId && record.readPermissionId, "Grant stage requires recorded role/permission");
  assert.ok(!record.userRoleAssigned || record.userId && record.permissionsAssigned && record.emptyAccessChecked, "User assignment requires verified empty identity and read-only role");
  assert.ok(!record.itemId || record.dictionaryId, "Item requires its recorded dictionary");
  assert.ok(!record.ready || nullableIds.every(key => record[key]) && flags.filter(key => key !== "ready").every(key => record[key]), "Ready state is incomplete");
  return record;
}
export function loadReaderRecord(owner, file = readerPath) {
  const stat = assertPath(file, { restricted: true });
  if (!stat) return null;
  assert.ok(stat.isFile(), "AF-130 credential record must be a private regular file");
  let record;
  try { record = JSON.parse(readFileSync(file, "utf8")); }
  catch { throw new Error("Malformed AF-130 credential record; left untouched"); }
  return validateReaderRecord(record, owner);
}
const marker = record => "AF-130:" + record.ownerId + ":" + record.nonce;
const dictionaryCode = record => "custom.af130." + record.nonce;
export function assertOwnedUser(user, record, assigned = record.userRoleAssigned) {
  assert.ok(user.id === record.userId && user.username === record.username && user.realName === "AF-130 字典只读验收" && user.isSuperAdmin === false && user.status === "active", "AF-130 user identity/status drift; no reset or adoption");
  equal(user.roleIds, assigned ? [record.roleId] : [], "AF-130 user roles drifted; no overwrite");
}
export function assertOwnedRole(role, record, assigned = record.permissionsAssigned) {
  assert.ok(role.id === record.roleId && role.roleCode === record.roleCode && role.roleName === "AF-130 字典只读" && role.remark === marker(record) && role.status === "active", "AF-130 role identity/status drift; no adoption");
  equal(role.permissionIds, assigned ? [record.readPermissionId] : [], "AF-130 role grants drifted; no overwrite");
}
function checkedState() {
  assertRepository();
  const state = readLocalState();
  assert.ok(state.owner.initialized && state.values.ENABLED_PLUGINS === "" && state.values.CLIENT_AUTH_ENABLED === "false", "An initialized plugin-free Base is required");
  assert.ok(assertPath(paths.credentials, { restricted: true })?.isFile(), "Initial Base administrator credential must be private");
  return state;
}
async function withReaderLock(operation) {
  const token = randomUUID();
  // No stale-lock deletion: coordinator must inspect an interrupted writer before recovery.
  writePrivate(lockPath, token, { exclusive: true });
  try { return await operation(); }
  finally {
    assertPath(lockPath, { restricted: true });
    assert.ok(readFileSync(lockPath, "utf8") === token, "AF-130 lock ownership changed; left untouched");
    unlinkSync(lockPath);
  }
}
function api(correlationId, observations = []) {
  return async (session, path, status = 200, method = "GET", body) => {
    const response = await fetch(baseApi + path, { method, redirect: "error", signal: AbortSignal.timeout(10000),
      headers: { "content-type": "application/json", origin: baseOrigin, "x-correlation-id": correlationId,
        ...(session ? { cookie: session.cookie, "x-aij-csrf": session.csrf } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body) });
    observations.push({ actorId: session?.user.id ?? null, path, method, status: response.status });
    assert.equal(response.status, status, method + " " + path + " unexpected HTTP status");
    const text = await response.text();
    assert.ok(!/passwordHash|password_hash|\$2[aby]\$|accessToken/.test(text), "Unexpected secret-bearing management response");
    return JSON.parse(text).data;
  };
}
async function loggedOut(call, session) {
  await call(session, "/auth/logout", 200, "POST");
  await call(session, "/auth/session", 401);
}
async function readAccess(call, session, record, empty = false) {
  assert.equal(session.user.id, record.userId, "Credential belongs to the recorded reader");
  const permissions = await call(session, "/admin/permissions/my");
  assert.equal(permissions.isSuperAdmin, false);
  equal(permissions.permissions, empty ? [] : [readCode], "Raw role grants must be exactly read-only");
  equal(permissions.effectivePermissions, empty ? [] : [readCode], "Effective grants must not expand the reader");
  equal(permissions.roles, empty ? [] : [record.roleCode], "Only the recorded read-only role is effective");
  equal(flatten(await call(session, "/admin/menus/my")), empty ? [] : ["/auth/dictionaries"], "Backend menus must follow exact grants");
  return permissions;
}
async function dictionaryRows(call, root, record) {
  const rows = await call(root, "/admin/dicts?q=" + dictionaryCode(record) + "&pageSize=100");
  return rows.items;
}
function assertDictionary(row, record, empty = false) {
  assert.ok(row && row.id === record[empty ? "emptyDictionaryId" : "dictionaryId"] && row.dictCode === dictionaryCode(record) + (empty ? ".empty" : ".catalog") && row.dictName === (empty ? "AF-130 空分类拒写验收" : "AF-130 只读验收分类") && row.description === marker(record) && row.pluginCode === null && row.status === "active" && row.isPublic === false && row.deletedAt === null, "AF-130 dictionary ownership/content drift; no overwrite");
}
function assertItem(row, record) {
  assert.ok(row && row.id === record.itemId && row.dictId === record.dictionaryId && row.itemValue === "ready" && row.itemLabel === "AF-130 只读可见条目" && row.description === marker(record) && row.status === "active" && row.deletedAt === null, "AF-130 dictionary item ownership/content drift; no overwrite");
}

// Persist each returned ID before proceeding. An ambiguous HTTP success without a saved
// ID becomes a named conflict next time; no account/role is adopted by matching a name.
async function prepareLocked(state, observations) {
  let record = loadReaderRecord(state.owner);
  if (!record) { record = createReaderRecord(state.owner); writePrivate(readerPath, record, { exclusive: true }); }
  const call = api(record.correlationId, observations);
  const save = () => { validateReaderRecord(record, state.owner); writePrivate(readerPath, record); };
  const root = await baseSession();
  try {
    assert.equal(root.user.isSuperAdmin, true, "Prepare requires the existing Base administrator");
    if (record.adminUserId) assert.equal(root.user.id, record.adminUserId, "Preparing administrator changed");
    else { record.adminUserId = root.user.id; save(); }
    const definitions = await call(root, "/admin/permissions/manage?q=admin.dict&pageSize=100");
    const read = definitions.items.find(row => row.permissionCode === readCode && row.status === "active");
    assert.ok(read, "Formal Base dictionary read definition is required");
    if (record.readPermissionId) assert.equal(read.id, record.readPermissionId, "Read definition changed");
    else { record.readPermissionId = read.id; save(); }
    // Validate every already-recorded identity before making any further writes.
    if (record.userId) assertOwnedUser(await call(root, "/admin/users/" + record.userId), record);
    if (record.roleId) assertOwnedRole(await call(root, "/admin/roles/" + record.roleId), record);
    if (!record.userId) {
      const existing = await call(root, "/admin/users?q=" + record.username + "&pageSize=100");
      assert.ok(!existing.items.some(user => user.username.toLowerCase() === record.username.toLowerCase()), "Unrecorded AF-130 username exists; refusing adoption");
      record.userId = (await call(root, "/admin/users", 201, "POST", { username: record.username, password: record.password, realName: "AF-130 字典只读验收" })).id;
      save();
    }
    if (!record.emptyAccessChecked) {
      assertOwnedUser(await call(root, "/admin/users/" + record.userId), record, false);
      const empty = await baseSession(record);
      try { await readAccess(call, empty, record, true); await call(empty, "/admin/dicts", 403); }
      finally { await loggedOut(call, empty); }
      record.emptyAccessChecked = true; save();
    }
    if (!record.roleId) {
      const existing = await call(root, "/admin/roles?q=" + record.roleCode + "&pageSize=100");
      assert.ok(!existing.items.some(role => role.roleCode === record.roleCode), "Unrecorded AF-130 role exists; refusing adoption");
      record.roleId = (await call(root, "/admin/roles", 201, "POST", { roleCode: record.roleCode, roleName: "AF-130 字典只读", remark: marker(record) })).id;
      save();
    }
    if (!record.permissionsAssigned) {
      assertOwnedRole(await call(root, "/admin/roles/" + record.roleId), record, false);
      await call(root, "/admin/roles/" + record.roleId + "/permissions", 200, "PUT", { permissionIds: [read.id] });
      record.permissionsAssigned = true; save();
    }
    if (!record.userRoleAssigned) {
      assertOwnedUser(await call(root, "/admin/users/" + record.userId), record, false);
      await call(root, "/admin/users/" + record.userId, 200, "PATCH", { roleIds: [record.roleId] });
      record.userRoleAssigned = true; save();
    }
    let rows = await dictionaryRows(call, root, record);
    for (const empty of [false, true]) {
      const key = empty ? "emptyDictionaryId" : "dictionaryId";
      const code = dictionaryCode(record) + (empty ? ".empty" : ".catalog");
      if (!record[key]) {
        assert.ok(!rows.some(row => row.dictCode === code), "Unrecorded AF-130 dictionary exists; refusing adoption");
        record[key] = (await call(root, "/admin/dicts", 201, "POST", { dictCode: code, dictName: empty ? "AF-130 空分类拒写验收" : "AF-130 只读验收分类", description: marker(record), isPublic: false })).id;
        save(); rows = await dictionaryRows(call, root, record);
      }
      assertDictionary(rows.find(row => row.id === record[key]), record, empty);
    }
    let items = await call(root, "/admin/dicts/" + record.dictionaryId + "/items?pageSize=100");
    if (!record.itemId) {
      assert.equal(items.total, 0, "Unrecorded AF-130 dictionary items exist; refusing adoption");
      record.itemId = (await call(root, "/admin/dicts/" + record.dictionaryId + "/items", 201, "POST", { itemValue: "ready", itemLabel: "AF-130 只读可见条目", description: marker(record) })).id;
      save(); items = await call(root, "/admin/dicts/" + record.dictionaryId + "/items?pageSize=100");
    }
    assert.equal(rows.length, 2); assert.equal(items.total, 1); assertItem(items.items[0], record);
    assert.equal((await call(root, "/admin/dicts/" + record.emptyDictionaryId + "/items")).total, 0);
    assertOwnedUser(await call(root, "/admin/users/" + record.userId), record, true);
    assertOwnedRole(await call(root, "/admin/roles/" + record.roleId), record, true);
    const reader = await baseSession(record);
    try { await readAccess(call, reader, record); } finally { await loggedOut(call, reader); }
    if (!record.ready) { record.ready = true; save(); }
    return { username: record.username, userId: record.userId, roleId: record.roleId, roleCode: record.roleCode,
      dictionaryId: record.dictionaryId, emptyDictionaryId: record.emptyDictionaryId, itemId: record.itemId, credentialFile: readerPath, ready: true };
  } finally { await loggedOut(call, root); }
}
export async function prepareBaseAdmin() {
  await basePreflight();
  const state = checkedState();
  return withReaderLock(() => prepareLocked(state, []));
}

async function stableSnapshot(call, root, record) {
  const user = await call(root, "/admin/users/" + record.userId);
  // Formal login updates lastLoginAt (and Prisma updatedAt); all other account fields remain compared.
  const stableUser = { ...user }; delete stableUser.lastLoginAt; delete stableUser.updatedAt;
  return { user: stableUser, role: await call(root, "/admin/roles/" + record.roleId),
    menus: await call(root, "/admin/menus/my"), dictionaries: await dictionaryRows(call, root, record),
    items: await call(root, "/admin/dicts/" + record.dictionaryId + "/items?pageSize=100"),
    emptyItems: await call(root, "/admin/dicts/" + record.emptyDictionaryId + "/items?pageSize=100") };
}
export async function verifyBaseAdmin() {
  await basePreflight();
  const state = checkedState(), observations = [];
  const evidence = { task: "AF-130", project: profile.project, environment: profile.environment, baseOrigin, baseApi,
    completed: false, startedAt: new Date().toISOString(), browserObservation: "PENDING_COORDINATOR", observations };
  try {
    return await withReaderLock(async () => {
      evidence.reader = await prepareLocked(state, observations);
      const record = loadReaderRecord(state.owner), correlationId = "af130-verify-" + randomBytes(8).toString("hex");
      const call = api(correlationId, observations);
      const root = await baseSession();
      let reader;
      try {
        const credentialDigest = digest(readFileSync(readerPath));
        const before = await stableSnapshot(call, root, record);
        await prepareLocked(state, observations);
        equal(await stableSnapshot(call, root, record), before, "Second prepare changes no menus, account, role grants or task dictionary data");
        assert.ok(digest(readFileSync(readerPath)) === credentialDigest, "Second prepare must preserve credential bytes");
        evidence.repeatPrepare = { sameCredentials: true, sameUserAndRole: true, sameMenusAndDictionary: true, loginTimestampsExcluded: true };
        for (const path of ["/admin/users", "/admin/roles", "/admin/dicts", "/admin/logs"]) assert.ok(Array.isArray((await call(root, path)).items));
        equal(flatten(await call(root, "/admin/menus/my")), BASE_DEVELOPMENT_MENUS.map(menu => menu.path), "Administrator retains the four initialized backend menus");
        reader = await baseSession(record);
        await readAccess(call, reader, record);
        const current = await call(reader, "/auth/session");
        assert.ok(current.csrfToken === reader.csrf && current.user.id === record.userId, "Direct writes must use this valid Cookie session's actual CSRF");
        const categories = await call(reader, "/admin/dicts?q=" + dictionaryCode(record) + "&pageSize=100");
        assert.equal(categories.total, 2);
        const items = await call(reader, "/admin/dicts/" + record.dictionaryId + "/items");
        assert.equal(items.total, 1); assertItem(items.items[0], record);
        for (const path of ["/admin/users", "/admin/roles", "/admin/logs", "/admin/permissions/manage"]) await call(reader, path, 403);
        const manage = (await call(root, "/admin/permissions/manage?q=" + manageCode)).items.find(row => row.permissionCode === manageCode && row.status === "active");
        assert.ok(manage, "Formal dictionary manage definition is required for valid escalation attempt");
        const writes = [
          ["/admin/dicts", "POST", { dictCode: dictionaryCode(record) + ".denied", dictName: "AF-130 禁止创建" }],
          ["/admin/dicts/" + record.dictionaryId, "PATCH", { dictName: "AF-130 禁止修改" }],
          ["/admin/dicts/" + record.emptyDictionaryId, "DELETE"],
          ["/admin/dicts/" + record.dictionaryId + "/items", "POST", { itemValue: "denied", itemLabel: "AF-130 禁止创建" }],
          ["/admin/dict-items/" + record.itemId, "PATCH", { itemLabel: "AF-130 禁止修改" }],
          ["/admin/dict-items/" + record.itemId, "DELETE"],
          ["/admin/users/" + record.userId, "PATCH", { roleIds: [] }],
          ["/admin/roles/" + record.roleId + "/permissions", "PUT", { permissionIds: [record.readPermissionId, manage.id] }]
        ];
        const unchanged = await stableSnapshot(call, root, record);
        for (const [path, method, body] of writes) {
          await call(reader, path, 403, method, body);
          equal(await stableSnapshot(call, root, record), unchanged, "Every rejected write preserves account, role and dictionaries");
        }
        evidence.denials = { dictionaryWrites: 6, selfRoleAndPermissionWrites: 2, correctSessionOriginCsrf: true, unchangedAfterEach: true };
        await readAccess(call, reader, record);
        await loggedOut(call, reader); reader = undefined;
        reader = await baseSession(record);
        await readAccess(call, reader, record);
        assertItem((await call(reader, "/admin/dicts/" + record.dictionaryId + "/items")).items[0], record);
        evidence.relogin = { logoutRevokedPriorSession: true, sameReadOnlyAccess: true };
        const audit = async (module, action, resourceId) => (await call(root, "/admin/logs?" + new URLSearchParams({ userId: root.user.id, resourceId, module, action, correlationId: record.correlationId, pageSize: "100" }))).items;
        const created = (await audit("admin-users", "created", record.userId)).find(row => row.status === "success" && row.resourceType === "administrator" && row.requestSummary?.fields?.includes("identity") && !row.requestSummary.fields.includes("roles"));
        const assigned = (await audit("admin-users", "updated", record.userId)).find(row => row.status === "success" && row.resourceType === "administrator" && row.requestSummary?.fields?.includes("roleIds"));
        const granted = (await audit("rbac-management", "role_permissions_assigned", record.roleId)).find(row => row.status === "success" && row.resourceType === "role" && row.requestSummary?.fields?.includes("permissionIds") && JSON.stringify(row.requestSummary.permissionIdsBefore) === "[]" && JSON.stringify(row.requestSummary.permissionIdsAfter) === JSON.stringify([record.readPermissionId]));
        assert.ok(created && assigned && granted, "Targeted user creation, separate role assignment and role permission change audits are all required");
        const denied = (await call(root, "/admin/logs?" + new URLSearchParams({ userId: record.userId, module: "rbac", action: "permission_denied", correlationId, pageSize: "100" }))).items;
        assert.ok(denied.filter(row => row.status === "failed" && row.requestSummary?.requiredPermissions?.includes(manageCode)).length >= 6, "Existing RBAC audit must include dictionary write denials");
        for (const required of ["admin.user.manage", "admin.role.manage"]) assert.ok(denied.some(row => row.requestSummary?.requiredPermissions?.includes(required)), "Privilege write denial is audited");
        evidence.audit = { createdId: created.id, assignedId: assigned.id, grantedId: granted.id, operatorId: root.user.id, userId: record.userId, roleId: record.roleId,
          creationFields: ["identity"], assignmentFields: ["roleIds"], permissionIdsAfter: [record.readPermissionId], dictionaryDenials: 6, allDtoRejectionsAudited: false };
        evidence.emptyAccess = { checkedBeforeFirstAssignment: record.emptyAccessChecked, backendMenusEmpty: true, effectivePermissionsEmpty: true };
        evidence.completed = true; evidence.completedAt = new Date().toISOString();
        return evidence;
      } finally {
        if (reader) await loggedOut(call, reader);
        await loggedOut(call, root);
      }
    });
  } catch (error) {
    evidence.completed = false;
    throw error;
  } finally {
    // Only allowlisted observations/IDs; no session, CSRF, password, hash or response bodies.
    const directory = join(root, ".artifacts/orca-b02/AF-130");
    assertPath(directory); mkdirSync(directory, { recursive: true });
    const file = join(directory, "base-admin-" + randomUUID() + ".json");
    writeFileSync(file, JSON.stringify(evidence, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  }
}

export function argumentsFor(args) {
  assert.ok(args.length === 1 && ["prepare", "verify", "--help"].includes(args[0]), "Use base-admin.mjs prepare|verify|--help; no target or credential overrides");
  return args[0];
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const action = argumentsFor(process.argv.slice(2));
    if (action === "--help") console.log("Coordinator only: node scripts/verification/product-readiness/base-admin.mjs prepare|verify\nPrivate reusable reader: .local-data/base-development/af130-reader.json\nNo password reset, grant replacement, DB initialization or cleanup.");
    else {
      const result = action === "prepare" ? await prepareBaseAdmin() : await verifyBaseAdmin();
      console.log(JSON.stringify({ task: "AF-130", status: action === "prepare" ? "PREPARED" : "PASS", reader: action === "prepare" ? result : result.reader, evidenceDirectory: action === "verify" ? ".artifacts/orca-b02/AF-130" : undefined }));
    }
  } catch {
    console.error("AF-130 refused or failed; preserve private journal and inspect sanitized test evidence before recovery. No account/password/grant reset attempted.");
    process.exitCode = 1;
  }
}
