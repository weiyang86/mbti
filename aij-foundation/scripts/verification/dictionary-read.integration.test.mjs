import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import test from "node:test";
import { baseOrigin, baseApi, baseCall, basePreflight, baseSession } from "./base-development-support.mjs";

// Coordinator only: preflight validates the persistent Base project/container/database/build.
// Every mutated user, role, category and item is created here through the formal HTTP API.
// Credentials and sessions remain in memory and are never included in persisted evidence.
test("AF-135 persistent Base dictionary read-only HTTP boundaries and legacy manage compatibility", { timeout: 180000 }, async t => {
  await basePreflight();
  const nonce = "r" + randomBytes(6).toString("hex"), prefix = "custom.af135." + nonce;
  const evidence = { task: "AF-135", baseOrigin, baseApi, completed: false, identities: {}, observations: [] };
  const check = async (name, operation) => {
    let passed = false;
    await t.test(name, async () => { await operation(); passed = true; });
    assert.ok(passed, "Required HTTP observation failed: " + name);
  };
  const call = async (session, path, status = 200, method = "GET", body) => {
    const data = await baseCall(session, path, status, method, body);
    evidence.observations.push({ identity: session?.user.id ?? "anonymous", path, method, status });
    return data;
  };
  const root = await baseSession();
  const subjects = {};
  let dictionary, emptyDictionary, item;
  const categoryPath = () => "/admin/dicts/" + dictionary;
  const itemPath = () => "/admin/dict-items/" + item;
  const categoryList = "/admin/dicts?q=" + prefix + "&pageSize=100";
  const flatten = nodes => nodes.flatMap(node => [...(node.path ? [node.path] : []), ...flatten(node.children)]);
  const grant = (role, ids) => call(root, "/admin/roles/" + role + "/permissions", 200, "PUT", { permissionIds: ids });
  const snapshot = async () => ({ categories: await call(root, categoryList), items: await call(root, categoryPath() + "/items?pageSize=100"), emptyItems: await call(root, "/admin/dicts/" + emptyDictionary + "/items?pageSize=100") });
  const writes = () => [
    ["/admin/dicts", "POST", { dictCode: prefix + ".denied", dictName: "AF-135 must not be created" }],
    [categoryPath(), "PATCH", { dictName: "AF-135 must not change", isPublic: true, status: "disabled", sortOrder: 30 }],
    ["/admin/dicts/" + emptyDictionary, "DELETE"],
    [categoryPath() + "/items", "POST", { itemValue: "denied", itemLabel: "AF-135 must not be created" }],
    [itemPath(), "PATCH", { itemLabel: "AF-135 must not change", status: "disabled", sortOrder: 30 }],
    [itemPath(), "DELETE"]
  ];
  try {
    const definitions = await call(root, "/admin/permissions/manage?q=admin.dict&pageSize=100");
    const read = definitions.items.find(row => row.permissionCode === "admin.dict.read");
    const manage = definitions.items.find(row => row.permissionCode === "admin.dict.manage");
    assert.ok(read && manage, "Formal Base initializer must register both dictionary definitions");
    for (const [name, permissionIds] of [["read", [read.id]], ["manage", [manage.id]], ["empty", []]]) {
      const role = await call(root, "/admin/roles", 201, "POST", { roleCode: "af135_" + name + "_" + nonce, roleName: "AF-135 synthetic " + name });
      await grant(role.id, permissionIds);
      const credentials = { username: "af135-" + name + "-" + nonce, password: "AF135-Az7!" + randomBytes(24).toString("hex") };
      const user = await call(root, "/admin/users", 201, "POST", { ...credentials, realName: "AF-135 synthetic " + name, roleIds: [role.id] });
      const session = await baseSession(credentials);
      assert.equal(session.user.id, user.id);
      subjects[name] = { roleId: role.id, userId: user.id, session };
      evidence.identities[name] = { roleId: role.id, userId: user.id, rawPermissions: name === "empty" ? [] : ["admin.dict." + name] };
    }

    await check("non-super manage-only role receives read menu and retains all six category/item CRUD operations", async () => {
      const { session, roleId } = subjects.manage;
      const permissions = await call(session, "/admin/permissions/my");
      assert.equal(permissions.isSuperAdmin, false);
      assert.deepEqual(permissions.permissions, ["admin.dict.manage"]);
      assert.deepEqual(permissions.effectivePermissions, ["admin.dict.manage", "admin.dict.read"]);
      assert.deepEqual((await call(root, "/admin/roles/" + roleId)).permissionIds, [manage.id]);
      assert.deepEqual(flatten(await call(session, "/admin/menus/my")), ["/auth/dictionaries"]);
      dictionary = (await call(session, "/admin/dicts", 201, "POST", { dictCode: prefix + ".catalog", dictName: "AF-135 synthetic catalog" })).id;
      emptyDictionary = (await call(session, "/admin/dicts", 201, "POST", { dictCode: prefix + ".empty", dictName: "AF-135 synthetic empty" })).id;
      item = (await call(session, categoryPath() + "/items", 201, "POST", { itemValue: "ready", itemLabel: "AF-135 synthetic ready" })).id;
      await call(session, categoryPath(), 200, "PATCH", { dictName: "AF-135 managed catalog" });
      await call(session, itemPath(), 200, "PATCH", { itemLabel: "AF-135 managed ready" });
      const disposable = (await call(session, "/admin/dicts", 201, "POST", { dictCode: prefix + ".disposable", dictName: "AF-135 disposable" })).id;
      const disposableItem = (await call(session, "/admin/dicts/" + disposable + "/items", 201, "POST", { itemValue: "temporary", itemLabel: "AF-135 temporary" })).id;
      await call(session, "/admin/dict-items/" + disposableItem, 200, "DELETE");
      await call(session, "/admin/dicts/" + disposable, 200, "DELETE");
      assert.equal((await call(session, categoryList)).total, 2);
      assert.equal((await call(session, categoryPath() + "/items")).items[0].itemLabel, "AF-135 managed ready");
    });

    await check("read-only formal identity gets the backend dictionary menu, page route and actual paged categories/items", async () => {
      const { session } = subjects.read;
      const permissions = await call(session, "/admin/permissions/my");
      assert.equal(permissions.isSuperAdmin, false);
      assert.deepEqual(permissions.permissions, ["admin.dict.read"]);
      assert.deepEqual(permissions.effectivePermissions, ["admin.dict.read"]);
      assert.deepEqual(flatten(await call(session, "/admin/menus/my")), ["/auth/dictionaries"]);
      const page = await fetch(baseOrigin + "/auth/dictionaries", { headers: { cookie: session.cookie }, signal: AbortSignal.timeout(8000) });
      assert.equal(page.status, 200); assert.match(page.headers.get("content-type") ?? "", /text\/html/);
      const categories = await call(session, categoryList);
      assert.equal(categories.total, 2); assert.ok(categories.items.some(row => row.id === dictionary));
      const entries = await call(session, categoryPath() + "/items?pageSize=1");
      assert.equal(entries.total, 1); assert.equal(entries.items[0].id, item);
      evidence.pageRoute = { path: "/auth/dictionaries", status: 200, browserObservation: "PENDING_COORDINATOR" };
    });

    await check("same valid read Cookie with correct Origin/CSRF receives six write 403s and every category/item stays identical after each attempt", async () => {
      const { session } = subjects.read;
      const currentSession = await call(session, "/auth/session");
      assert.equal(currentSession.user.id, subjects.read.userId);
      assert.ok(currentSession.csrfToken === session.csrf, "Write attempts use this valid session's CSRF value");
      const before = await snapshot();
      for (const [path, method, body] of writes()) {
        await call(session, path, 403, method, body);
        assert.deepEqual(await snapshot(), before, method + " " + path + " leaves every task-owned dictionary row unchanged");
      }
      evidence.readWritesDenied = { attempts: 6, unchangedAfterEveryAttempt: true, validSession: true, originAndCsrfSupplied: true };
    });

    await check("empty and anonymous identities cannot read or write, and dictionary roles gain no unrelated management authority", async () => {
      const before = await snapshot();
      assert.deepEqual(flatten(await call(subjects.empty.session, "/admin/menus/my")), []);
      assert.deepEqual((await call(subjects.empty.session, "/admin/permissions/my")).effectivePermissions, []);
      for (const [session, status] of [[null, 401], [subjects.empty.session, 403]]) {
        for (const path of [categoryList, categoryPath() + "/items"]) await call(session, path, status);
        for (const [path, method, body] of writes()) {
          await call(session, path, status, method, body);
          assert.deepEqual(await snapshot(), before);
        }
      }
      for (const { session } of [subjects.read, subjects.manage]) for (const path of ["/admin/users", "/admin/roles", "/admin/permissions/manage", "/admin/logs"]) await call(session, path, 403);
      // A manage grant still cannot create core/plugin dictionaries or set the owner.
      for (const body of [{ dictCode: "core.af135." + nonce, dictName: "Denied" }, { dictCode: "aij-synthetic.af135." + nonce, dictName: "Denied" }, { dictCode: prefix + ".owner", dictName: "Denied", pluginCode: "aij-synthetic" }]) await call(subjects.manage.session, "/admin/dicts", 400, "POST", body);
      assert.deepEqual(await snapshot(), before);
    });

    await check("role disable, user-role unbinding and grant revocation apply to the next request with the original valid session", async () => {
      const { session, roleId, userId } = subjects.read;
      await call(root, "/admin/roles/" + roleId + "/status", 200, "PATCH", { enabled: false });
      await call(session, categoryList, 403); assert.deepEqual(flatten(await call(session, "/admin/menus/my")), []);
      await call(root, "/admin/roles/" + roleId + "/status", 200, "PATCH", { enabled: true });
      await call(session, categoryList);
      await call(root, "/admin/users/" + userId, 200, "PATCH", { roleIds: [] });
      await call(session, categoryList, 403);
      await call(root, "/admin/users/" + userId, 200, "PATCH", { roleIds: [roleId] });
      await call(session, categoryList);
      const before = await snapshot();
      for (const subject of [subjects.read, subjects.manage]) {
        await grant(subject.roleId, []);
        for (const path of [categoryList, categoryPath() + "/items"]) await call(subject.session, path, 403);
        assert.deepEqual((await call(subject.session, "/admin/permissions/my")).effectivePermissions, []);
        assert.deepEqual(flatten(await call(subject.session, "/admin/menus/my")), []);
        await call(subject.session, "/admin/dicts", 403, "POST", { dictCode: prefix + ".revoked", dictName: "Denied after revocation" });
        assert.equal((await call(subject.session, "/auth/session")).user.id, subject.userId);
        assert.deepEqual(await snapshot(), before);
      }
      evidence.revocation = { readAndManage: true, nextRequestDenied: true, existingSessionsRemainValid: true, menusAndEffectivePermissionsEmpty: true };
    });

    await check("write rejections use existing sanitized permission audit owner", async () => {
      const logs = await call(root, "/admin/logs?userId=" + subjects.read.userId + "&action=permission_denied&pageSize=100");
      assert.ok(logs.items.filter(row => row.status === "failed" && row.requestSummary?.requiredPermissions?.includes("admin.dict.manage")).length >= 6);
      evidence.auditedReadWriteRejections = true;
    });
    evidence.completed = true;
  } finally {
    // Node subtest failure also fails the parent; artifacts contain no response bodies or credentials.
    evidence.completed = evidence.completed && !t.signal.aborted;
    const directory = ".artifacts/orca-b02/AF-135";
    mkdirSync(directory, { recursive: true });
    writeFileSync(directory + "/dictionary-read-live-integration-" + nonce + ".json", JSON.stringify(evidence, null, 2) + "\n");
  }
});
