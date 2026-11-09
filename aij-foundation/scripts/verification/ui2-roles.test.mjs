import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { prepareUi1, stopUi1 } from "./ui1-manual.mjs";
import { browserSession, call, origin, queryFor } from "./ui2-support.mjs";

test("AF-032 real role and permission UI/API authorization on the isolated database", { timeout: 180000 }, async t => {
  let state;
  try {
    state = await prepareUi1("AF-032");
    const root = await browserSession(state), manager = await browserSession(state, "ui2-role-manager"), empty = await browserSession(state, "ui2-empty"), query = queryFor(state);
    const runSuffix = randomUUID().replaceAll("-", "").slice(0, 10);
    let roleId, permissionId, subjectId, subjectCookie, subjectCsrf;
    const login = async (username, password, expected = 200) => {
      const response = await fetch("http://127.0.0.1:3656/api/auth/browser-login", { method: "POST", headers: { origin, "x-aij-client": "web", "content-type": "application/json" }, body: JSON.stringify({ username, password }), signal: AbortSignal.timeout(8000) });
      assert.equal(response.status, expected); return response.status === 200 ? response.headers.get("set-cookie").split(";", 1)[0] : null;
    };
    await t.test("role route is a real page and navigation is permission-filtered", async () => {
      assert.equal((await fetch("http://127.0.0.1:3655/auth/roles")).status, 200);
      assert.deepEqual((await call(manager, "/admin/menus/my")).map(item => item.path), ["/auth/roles"]);
      assert.deepEqual(await call(empty, "/admin/menus/my"), []);
      assert.equal((await call(root, "/admin/menus/pages")).find(page => page.path === "/auth/roles")?.available, true);
    });
    await t.test("role management is authenticated and permission directory stays separately guarded", async () => {
      await call(null, "/admin/roles", 401); await call(empty, "/admin/roles", 403);
      assert.ok((await call(manager, "/admin/roles")).items.length >= 1);
      await call(manager, "/admin/permissions/manage", 403); assert.ok((await call(root, "/admin/permissions/manage")).items.length >= 1);
      const builtIn = (await call(root, "/admin/roles?q=aij_bootstrap_admin")).items[0]; assert.ok(builtIn);
      await call(root, "/admin/roles/" + builtIn.id, 409, "PATCH", { roleName: "forbidden mutation" });
      await call(root, "/admin/roles/" + builtIn.id + "/status", 409, "PATCH", { enabled: false });
      await call(root, "/admin/roles/" + builtIn.id, 409, "DELETE");
    });
    await t.test("manager creates a role while root alone can atomically assign validated permissions", async () => {
      const roleCode = `ui2_af032_${runSuffix}`;
      roleId = (await call(manager, "/admin/roles", 201, "POST", { roleCode, roleName: "AF032 合成角色", remark: "synthetic acceptance only" })).id;
      await call(manager, "/admin/roles/" + roleId, 200, "PATCH", { roleName: "AF032 updated", remark: null });
      const row = (await call(manager, "/admin/roles?q=" + roleCode + "&page=1&pageSize=2")).items.find(item => item.id === roleId); assert.equal(row.roleName, "AF032 updated"); assert.deepEqual(row.permissionIds, []);
      await call(manager, "/admin/roles/" + roleId + "/permissions", 403, "PUT", { permissionIds: [] });
      await call(root, "/admin/roles/" + roleId + "/permissions", 400, "PUT", { permissionIds: ["no-such-permission"] });
      permissionId = (await query(client => client.query("SELECT id FROM public.sys_permission WHERE permission_code='admin.user.manage' AND status='active'"))).rows[0].id;
      await call(root, "/admin/roles/" + roleId + "/permissions", 200, "PUT", { permissionIds: [permissionId] });
      assert.deepEqual((await call(root, "/admin/roles/" + roleId)).permissionIds, [permissionId]);
    });
    await t.test("same browser session gains and loses API/menu rights immediately with role grants", async () => {
      const username = "ui2-af032-subject-" + randomUUID().slice(0, 8), password = "R8-" + randomBytes(24).toString("hex");
      subjectId = (await call(root, "/admin/users", 201, "POST", { username, realName: "AF032 synthetic subject", password, roleIds: [roleId] })).id;
      subjectCookie = await login(username, password); const session = await (await fetch("http://127.0.0.1:3656/api/auth/session", { headers: { cookie: subjectCookie } })).json(); subjectCsrf = session.data.csrfToken;
      const subject = { cookie: subjectCookie, csrf: subjectCsrf };
      await call(subject, "/admin/users", 200); assert.deepEqual((await call(subject, "/admin/menus/my")).map(item => item.path), ["/auth/admin-users"]);
      await call(root, "/admin/roles/" + roleId + "/permissions", 200, "PUT", { permissionIds: [] });
      await call(subject, "/admin/users", 403); assert.deepEqual(await call(subject, "/admin/menus/my"), []);
      permissionId = (await query(client => client.query("SELECT id FROM public.sys_permission WHERE permission_code='admin.user.manage' AND status='active'"))).rows[0].id;
      await call(root, "/admin/roles/" + roleId + "/permissions", 200, "PUT", { permissionIds: [permissionId] });
      await call(root, "/admin/roles/" + roleId + "/status", 200, "PATCH", { enabled: false }); await call(subject, "/admin/users", 403);
      await call(root, "/admin/roles/" + roleId + "/status", 200, "PATCH", { enabled: true }); await call(subject, "/admin/users", 200);
    });
    await t.test("custom permission definitions are validated, auditable and deletion respects references", async () => {
      permissionId = (await call(root, "/admin/permissions", 201, "POST", { permissionCode: `custom.ui2.af032.${runSuffix}.read`, permissionName: "AF032 custom permission", resourceType: "api", action: "read", apiPath: "/api/admin/users" })).id;
      await call(root, "/admin/permissions/" + permissionId, 200, "PATCH", { permissionName: "AF032 renamed", apiPath: null });
      await call(root, "/admin/permissions", 400, "POST", { permissionCode: "admin.user.manage", permissionName: "Reserved", resourceType: "api", action: "read" });
      await call(root, "/admin/roles/" + roleId + "/permissions", 200, "PUT", { permissionIds: [permissionId] }); await call(root, "/admin/permissions/" + permissionId, 409, "DELETE");
      await call(root, "/admin/roles/" + roleId + "/permissions", 200, "PUT", { permissionIds: [] });
      await call(root, "/admin/permissions/" + permissionId + "/status", 200, "PATCH", { enabled: false }); await call(root, "/admin/permissions/" + permissionId + "/status", 200, "PATCH", { enabled: true });
      await call(root, "/admin/permissions/" + permissionId, 200, "DELETE");
      const rows = await query(client => client.query("SELECT action,request_summary FROM public.audit_log WHERE module='rbac-management' AND resource_id=ANY($1::text[])", [[roleId, permissionId]]));
      assert.ok(rows.rows.some(row => row.action === "role_created")); assert.ok(rows.rows.some(row => row.action === "role_permissions_assigned")); assert.ok(rows.rows.some(row => row.action === "permission_created"));
      assert.ok(!JSON.stringify(rows.rows).includes("AF032 custom permission")); assert.ok(!JSON.stringify(rows.rows).includes(subjectCookie));
    });
    await t.test("archiving a role preserves the user-role record and revokes its old session", async () => {
      await call(root, "/admin/roles/" + roleId, 200, "DELETE"); await call(subjectCookie ? { cookie: subjectCookie, csrf: subjectCsrf } : null, "/admin/users", 403);
      const rows = await query(client => client.query("SELECT r.status,r.deleted_at,(SELECT count(*)::int FROM public.sys_user_role ur WHERE ur.role_id=r.id AND ur.user_id=$2) AS user_links FROM public.sys_role r WHERE r.id=$1", [roleId, subjectId]));
      assert.equal(rows.rows[0].status, "disabled"); assert.ok(rows.rows[0].deleted_at); assert.equal(rows.rows[0].user_links, 1);
    });
  } finally { if (state) await stopUi1("AF-032"); }
});
