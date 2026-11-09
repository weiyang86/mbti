import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { prepareUi1, stopUi1 } from "./ui1-manual.mjs";
import { browserSession, call, origin, queryFor } from "./ui2-support.mjs";

test("AF-031 real administrator UI API contract and persistence", { timeout: 150000 }, async t => {
  let state;
  try {
    state = await prepareUi1("AF-031"); const root = await browserSession(state), reader = await browserSession(state, "ui2-reader"), manager = await browserSession(state, "ui2-user-manager"), query = queryFor(state);
    const username = "ui2-person-" + randomUUID().slice(0, 8), password = "U8-" + randomBytes(24).toString("hex"); let id, cookie;
    const login = async (secret, expected) => { const response = await fetch("http://127.0.0.1:3656/api/auth/browser-login", { method: "POST", headers: { origin, "x-aij-client": "web", "content-type": "application/json" }, body: JSON.stringify({ username, password: secret }) }); assert.equal(response.status, expected); return response.headers.get("set-cookie")?.split(";", 1)[0]; };
    await t.test("real page is registered and user-only manager receives only user menu", async () => {
      assert.equal((await fetch("http://127.0.0.1:3655/auth/admin-users")).status, 200);
      assert.deepEqual((await call(manager, "/admin/menus/my")).map(m => m.path), ["/auth/admin-users"]);
      assert.ok((await call(root, "/admin/menus/pages")).some(p => p.path === "/auth/admin-users" && p.available));
      await call(null, "/admin/users", 401); await call(reader, "/admin/users", 403);
    });
    await t.test("create validates and persists, duplicate and ordinary role direct writes refuse", async () => {
      await call(reader, "/admin/users", 403, "POST", { username, realName: "Synthetic", password });
      await call(root, "/admin/users", 400, "POST", { username, realName: "Synthetic", password: "template" });
      id = (await call(root, "/admin/users", 201, "POST", { username, realName: "UI2 synthetic", password })).id;
      await call(root, "/admin/users", 409, "POST", { username, realName: "Duplicate", password });
      const result = await query(c => c.query("SELECT username,real_name,is_super_admin FROM public.sys_user WHERE id=$1", [id])); assert.equal(result.rows[0].username, username); assert.equal(result.rows[0].is_super_admin, false);
    });
    await t.test("bounded server pagination/search, profile edit and separate role replacement", async () => {
      const page = await call(root, "/admin/users?q=" + username + "&page=1&pageSize=1"); assert.equal(page.total, 1); assert.equal(page.items.length, 1); assert.equal(page.items[0].id, id);
      assert.equal((await call(root, "/admin/users?q=" + username + "&page=2&pageSize=1")).items.length, 0); await call(root, "/admin/users?page=0", 400); await call(root, "/admin/users?pageSize=101", 400);
      await call(root, "/admin/users/" + id, 200, "PATCH", { realName: "UI2 edited", email: "synthetic@example.invalid" });
      assert.equal((await call(root, "/admin/users/" + id)).realName, "UI2 edited");
      const role = (await call(root, "/admin/roles?q=ui2_reader")).items[0]; await call(root, "/admin/users/" + id, 200, "PATCH", { roleIds: [role.id] }); assert.deepEqual((await call(root, "/admin/users/" + id)).roleIds, [role.id]);
      await call(manager, "/admin/users/" + id, 403, "PATCH", { roleIds: [] });
    });
    await t.test("disable invalidates old cookie permanently, protected self and last administrator refuse", async () => {
      cookie = await login(password, 200); await call({ cookie }, "/auth/me");
      await call(root, "/admin/users/" + id + "/status", 200, "PATCH", { enabled: false }); await call({ cookie }, "/auth/me", 401); await login(password, 401);
      await call(root, "/admin/users/" + id + "/status", 200, "PATCH", { enabled: true }); await call({ cookie }, "/auth/me", 401);
      await call(root, "/admin/users/" + root.user.id + "/status", 409, "PATCH", { enabled: false }); await call(root, "/admin/users/" + root.user.id, 409, "DELETE");
      assert.equal((await query(c => c.query("SELECT count(*)::int n FROM public.sys_user WHERE is_super_admin=true AND status='active' AND deleted_at IS NULL"))).rows[0].n, 1);
    });
    await t.test("controlled reset enforces CSRF and invalidates old session without revealing credentials", async () => {
      cookie = await login(password, 200); const next = "V9-" + randomBytes(24).toString("hex");
      const response = await fetch("http://127.0.0.1:3656/api/admin/users/" + id + "/reset-password", { method: "PATCH", headers: { origin, cookie: root.cookie, "content-type": "application/json" }, body: JSON.stringify({ password: next }) }); assert.equal(response.status, 403); assert.ok(!(await response.text()).includes(next));
      await call(root, "/admin/users/" + id + "/reset-password", 200, "PATCH", { password: next }); await call({ cookie }, "/auth/me", 401); await login(password, 401); await login(next, 200);
    });
    await t.test("soft delete retains audit with safe fields and removes list record", async () => {
      await call(root, "/admin/users/" + id, 200, "DELETE"); await call(root, "/admin/users/" + id, 404); assert.equal((await call(root, "/admin/users?q=" + username)).total, 0);
      const result = await query(c => c.query("SELECT action,request_summary FROM public.audit_log WHERE module='admin-users' AND resource_id=$1", [id])); assert.ok(result.rows.some(row => row.action === "created")); assert.ok(result.rows.some(row => row.action === "deleted")); assert.ok(result.rows.some(row => row.action === "password_reset")); assert.ok(!JSON.stringify(result.rows).includes(password));
    });
  } finally { if (state) await stopUi1("AF-031"); }
});
