import assert from "node:assert/strict";
import test from "node:test";
import { prepareUi1, stopUi1 } from "./ui1-manual.mjs";
import { browserSession, call, origin } from "./ui2-support.mjs";

test("G7-02 production Web and real HTTP authorization for administrator and limited roles", { timeout: 180000 }, async t => {
  let state;
  try {
    state = await prepareUi1("AF-043");
    const root = await browserSession(state);
    const reader = await browserSession(state, "ui2-reader");
    const userManager = await browserSession(state, "ui2-user-manager");
    const roleManager = await browserSession(state, "ui2-role-manager");
    const empty = await browserSession(state, "ui2-empty");

    await t.test("real production Next pages for login, shell, users and roles respond", async () => {
      for (const path of ["/login", "/admin", "/auth/admin-users", "/auth/roles"]) {
        const response = await fetch("http://127.0.0.1:3655" + path, { signal: AbortSignal.timeout(8000) });
        assert.equal(response.status, 200, path);
        const body = await response.text();
        assert.match(body, /__next|_next\/static/);
      }
    });

    await t.test("anonymous direct API requests return 401 and failed login sets no session cookie", async () => {
      for (const path of ["/admin/menus/my", "/admin/users", "/admin/roles"]) await call(null, path, 401);
      const failed = await fetch("http://127.0.0.1:3656/api/auth/browser-login", {
        method: "POST", headers: { origin, "x-aij-client": "web", "content-type": "application/json" },
        body: JSON.stringify({ username: "g7-02-absent-account", password: "synthetic-invalid-password" }),
        signal: AbortSignal.timeout(8000)
      });
      assert.equal(failed.status, 401);
      assert.equal(failed.headers.get("set-cookie"), null);
    });

    await t.test("a valid administrator logs in and receives the whole delivered admin menu", async () => {
      const menus = await call(root, "/admin/menus/my");
      assert.deepEqual(menus.map(menu => menu.path).sort(), ["/admin", "/auth/admin-users", "/auth/roles"].sort());
      await call(root, "/admin/users", 200);
      await call(root, "/admin/roles", 200);
    });

    await t.test("limited roles receive only authorized menus and direct API calls enforce the same boundary", async () => {
      assert.deepEqual((await call(reader, "/admin/menus/my")).map(menu => menu.path), ["/admin"]);
      assert.deepEqual((await call(userManager, "/admin/menus/my")).map(menu => menu.path), ["/auth/admin-users"]);
      assert.deepEqual((await call(roleManager, "/admin/menus/my")).map(menu => menu.path), ["/auth/roles"]);
      assert.deepEqual(await call(empty, "/admin/menus/my"), []);
      await call(userManager, "/admin/users", 200); await call(userManager, "/admin/roles", 403);
      await call(roleManager, "/admin/roles", 200); await call(roleManager, "/admin/users", 403);
      await call(reader, "/admin/users", 403); await call(reader, "/admin/roles", 403);
      await call(empty, "/admin/users", 403); await call(empty, "/admin/roles", 403);
    });

    await t.test("client-supplied privilege claims do not change server permissions", async () => {
      const response = await fetch("http://127.0.0.1:3656/api/admin/users?permission=admin.user.manage&workspaceId=forged-workspace", {
        headers: { origin, cookie: reader.cookie, "x-aij-csrf": reader.csrf, "x-permission": "admin.user.manage", "x-workspace-id": "forged-workspace" },
        signal: AbortSignal.timeout(8000)
      });
      assert.equal(response.status, 403);
      assert.doesNotMatch(await response.text(), /passwordHash|password_hash|\$2[aby]\$/);
    });
  } finally {
    if (state) await stopUi1("AF-043");
  }
});
