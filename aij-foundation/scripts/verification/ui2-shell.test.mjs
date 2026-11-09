import assert from "node:assert/strict";
import test from "node:test";
import { prepareUi1, stopUi1 } from "./ui1-manual.mjs";
import { browserSession, call, queryFor } from "./ui2-support.mjs";
import { applicationSessions } from "./readiness-support.mjs";

test("AF-030 real shell/menu/effective permissions on owned Web API and database", { timeout: 150000 }, async t => {
  let state;
  try {
    state = await prepareUi1("AF-030"); const root = await browserSession(state), reader = await browserSession(state, "ui2-reader"), empty = await browserSession(state, "ui2-empty"), query = queryFor(state);
    await t.test("production page and JavaScript exist, anonymous HTML contains no account", async () => {
      const r = await fetch("http://127.0.0.1:3655/admin"); assert.equal(r.status, 200); const html = await r.text(); assert.ok(html.includes("AIJ")); assert.ok(!html.includes("aij-admin"));
      const src = [...html.matchAll(/src="([^" ]+\.js[^" ]*)"/g)].map(m => m[1]); assert.ok(src.length);
      for (const path of src) { assert.ok(path.startsWith("/_next/")); assert.equal((await fetch("http://127.0.0.1:3655" + path)).status, 200); }
    });
    await t.test("server catalog exposes only delivered core routes; unavailable plugins stay absent", async () => {
      const pages = await call(root, "/admin/menus/pages"); assert.ok(pages.some(p => p.path === "/admin" && p.available)); assert.ok(pages.every(p => p.pluginCode === null));
      await call(root, "/admin/menus", 400, "POST", { title: "Rejected", path: "/not-delivered", permissionCode: "aij.bootstrap.admin" });
      await call(root, "/admin/menus", 400, "POST", { title: "Rejected", path: "https://example.invalid", permissionCode: "aij.bootstrap.admin" });
    });
    await t.test("401 anonymous, limited menu, empty rights stay empty and cannot forge workspace or permissions", async () => {
      await call(null, "/admin/menus/my", 401); await call(null, "/admin/permissions/my", 401);
      assert.deepEqual((await call(reader, "/admin/menus/my")).map(m => m.path), ["/admin"]);
      assert.deepEqual(await call(empty, "/admin/menus/my?permission=*&workspaceId=owner"), []);
      assert.deepEqual((await call(empty, "/admin/permissions/my")).effectivePermissions, []);
      await call(reader, "/admin/users", 403); await call(empty, "/admin/roles", 403);
    });
    await t.test("same cookie loses menu and effective rights immediately after role revoke; audit records safe ids", async () => {
      const role = (await call(root, "/admin/roles?q=ui2_reader")).items[0]; assert.ok(role); const before = role.permissionIds;
      try { await call(root, "/admin/roles/" + role.id + "/permissions", 200, "PUT", { permissionIds: [] }); assert.deepEqual(await call(reader, "/admin/menus/my"), []); assert.deepEqual((await call(reader, "/admin/permissions/my")).effectivePermissions, []); }
      finally { await call(root, "/admin/roles/" + role.id + "/permissions", 200, "PUT", { permissionIds: before }); }
      const rows = await query(c => c.query("SELECT request_summary FROM public.audit_log WHERE module='rbac-management' AND resource_id=$1", [role.id])); assert.ok(rows.rows.length >= 2); assert.ok(!JSON.stringify(rows.rows).includes(reader.cookie));
    });
    await t.test("super administrator effective rights still exclude inactive definitions", async () => {
      assert.ok((await call(root, "/admin/permissions/my")).effectivePermissions.includes("admin.user.manage"));
      await query(c => c.query("UPDATE public.sys_permission SET status='disabled' WHERE permission_code='admin.user.manage'"));
      try { assert.ok(!(await call(root, "/admin/permissions/my")).effectivePermissions.includes("admin.user.manage")); await call(root, "/admin/users", 403); }
      finally { await query(c => c.query("UPDATE public.sys_permission SET status='active' WHERE permission_code='admin.user.manage'")); }
    });
    await t.test("precise owned shutdown closes API pool and leaves synthetic data intact", async () => { await stopUi1("AF-030"); assert.deepEqual(await applicationSessions(state.acceptanceId, "AF-030"), []); state = null; });
  } finally { if (state) await stopUi1("AF-030"); }
});
