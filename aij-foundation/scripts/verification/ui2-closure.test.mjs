import assert from "node:assert/strict";
import test from "node:test";
import { prepareUi1, stopUi1 } from "./ui1-manual.mjs";
import { browserSession, call, origin } from "./ui2-support.mjs";

test("AF-033 authenticated UI/API closure by effective administrator role", { timeout: 180000 }, async t => {
  let state;
  try {
    state = await prepareUi1("AF-033");
    const root = await browserSession(state), reader = await browserSession(state, "ui2-reader"), userManager = await browserSession(state, "ui2-user-manager"), roleManager = await browserSession(state, "ui2-role-manager"), empty = await browserSession(state, "ui2-empty");
    await t.test("ready API and all delivered production pages respond on the owned hosts", async () => {
      assert.equal((await fetch("http://127.0.0.1:3656/api/ready")).status, 200);
      for (const path of ["/admin", "/auth/admin-users", "/auth/roles"]) assert.equal((await fetch("http://127.0.0.1:3655" + path)).status, 200, path);
    });
    await t.test("anonymous requests fail authentication while invalid login sets no cookie", async () => {
      for (const path of ["/admin/menus/my", "/admin/users", "/admin/roles", "/admin/permissions/manage"]) await call(null, path, 401);
      const response = await fetch("http://127.0.0.1:3656/api/auth/browser-login", { method: "POST", headers: { origin, "x-aij-client": "web", "content-type": "application/json" }, body: JSON.stringify({ username: "missing-ui2-account", password: "not-a-valid-secret" }) });
      assert.equal(response.status, 401); assert.equal(response.headers.get("set-cookie"), null);
    });
    await t.test("server menus and protected APIs agree for root, user manager, role manager, reader and empty role", async () => {
      assert.deepEqual((await call(root, "/admin/menus/my")).map(m => m.path).sort(), ["/admin", "/auth/admin-users", "/auth/roles"].sort());
      assert.deepEqual((await call(userManager, "/admin/menus/my")).map(m => m.path), ["/auth/admin-users"]);
      assert.deepEqual((await call(roleManager, "/admin/menus/my")).map(m => m.path), ["/auth/roles"]);
      assert.deepEqual((await call(reader, "/admin/menus/my")).map(m => m.path), ["/admin"]);
      assert.deepEqual(await call(empty, "/admin/menus/my"), []);
      await call(root, "/admin/users", 200); await call(root, "/admin/roles", 200); await call(root, "/admin/permissions/manage", 200);
      await call(userManager, "/admin/users", 200); await call(userManager, "/admin/roles", 403); await call(userManager, "/admin/permissions/manage", 403);
      await call(roleManager, "/admin/roles", 200); await call(roleManager, "/admin/users", 403); await call(roleManager, "/admin/permissions/manage", 403);
      await call(reader, "/admin/menus/my", 200); await call(reader, "/admin/users", 403); await call(reader, "/admin/roles", 403);
      await call(empty, "/admin/users", 403); await call(empty, "/admin/roles", 403);
    });
    await t.test("workbench permission is granted only to root while other pages remain role-scoped", async () => {
      assert.deepEqual(await call(userManager, "/admin/menus/my").then(items => items.map(m => m.path)), ["/auth/admin-users"]);
      assert.deepEqual(await call(roleManager, "/admin/menus/my").then(items => items.map(m => m.path)), ["/auth/roles"]);
      const limited = await call(userManager, "/admin/permissions/my"); assert.ok(!limited.effectivePermissions.includes("aij.bootstrap.admin"));
      const roleOnly = await call(roleManager, "/admin/permissions/my"); assert.ok(!roleOnly.effectivePermissions.includes("aij.bootstrap.admin"));
      const rootPermissions = await call(root, "/admin/permissions/my"); assert.ok(rootPermissions.effectivePermissions.includes("aij.bootstrap.admin"));
      const catalog = await call(root, "/admin/menus/pages"); assert.ok(catalog.some(item => item.path === "/admin" && item.available));
    });
  } finally { if (state) await stopUi1("AF-033"); }
});
