import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { acceptanceRecord, assertLocalPath, readDatabaseEnvironment, repositoryRoot, withDatabase } from "../database/connection.mjs";
import { seedDatabase } from "../database/seed.mjs";

export const UI2_TASKS = ["AF-030", "AF-031", "AF-032", "AF-033", "AF-035", "AF-036", "AF-037", "AF-038", "AF-043", "AF-087", "AF-088", "AF-089", "AF-090"];
const bcrypt = createRequire(join(repositoryRoot, "apps/api/package.json"))("bcryptjs");
export async function prepareUi2Fixture(id, task) {
  assert.ok(UI2_TASKS.includes(task)); const lease = acceptanceRecord("test", id); assert.equal(lease.task, task);
  const seed = await seedDatabase({ mode: "test", acceptanceId: id, generateCredentials: true, adminUsers: true, rbacManagement: true, menuManagement: true, ...(task === "AF-035" ? { dictionaries: true } : {}), ...(task === "AF-036" ? { configuration: true } : {}), ...(task === "AF-037" ? { secrets: true } : {}), ...(["AF-038", "AF-089"].includes(task) ? { auditLogs: true } : {}), ...(["AF-087", "AF-088", "AF-089", "AF-090"].includes(task) ? { clientManagement: true } : {}), ...(task === "AF-089" ? { clientSessionManagement: true } : {}) });
  const file = join(repositoryRoot, ".local-data/seed/test", lease.database, "ui2-accounts.json"); assertLocalPath(file);
  execFileSync("git", ["--no-optional-locks", "check-ignore", "--quiet", file], { cwd: repositoryRoot });
  const definitions = [
    { username: "ui2-reader", name: "只读观察员", permissions: ["aij.bootstrap.admin"] },
    { username: "ui2-empty", name: "未授权观察员", permissions: [] },
    { username: "ui2-user-manager", name: "用户管理员", permissions: ["admin.user.manage"] },
    { username: "ui2-role-manager", name: "角色管理员", permissions: ["admin.role.manage"] },
    ...(task === "AF-035" ? [{ username: "ui2-dictionary-manager", name: "字典管理员", permissions: ["admin.dict.manage"] }] : []),
    ...(task === "AF-036" ? [{ username: "ui2-configuration-manager", name: "配置管理员", permissions: ["admin.config.manage"] }] : []),
    ...(task === "AF-037" ? [{ username: "ui2-secret-manager", name: "密钥引用管理员", permissions: ["admin.secret.manage"] }] : []),
    ...(task === "AF-038" ? [{ username: "ui2-audit-manager", name: "审计日志管理员", permissions: ["admin.log.read"] }] : []),
    ...(["AF-087", "AF-088", "AF-089", "AF-090"].includes(task) ? [{ username: "ui2-client-manager", name: "客户只读管理员", permissions: ["admin.client.read"] }] : []),
    ...(task === "AF-089" ? [{ username: "ui2-client-session-manager", name: "客户会话管理员", permissions: ["admin.client.read", "admin.client.sessions.revoke", "admin.log.read"] }] : [])
  ];
  const saved = existsSync(file) ? JSON.parse(readFileSync(file)) : null;
  if (saved) { assert.equal(saved.task, task); assert.equal(saved.database, lease.database); assert.equal(saved.instanceId, lease.instanceId); }
  await withDatabase("test", readDatabaseEnvironment("test", process.env, id), async client => {
    await client.query("BEGIN");
    try {
      await client.query("SELECT pg_advisory_xact_lock(hashtext('aij-ui2-fixture'))");
      const count = (await client.query("SELECT count(*)::int n FROM public.sys_user WHERE username=ANY($1::text[])", [definitions.map(d => d.username)])).rows[0].n;
      if (count) { assert.ok(saved && count === definitions.length, "Existing observation accounts require original credentials; never reset"); await client.query("COMMIT"); return; }
      assert.equal((await client.query("SELECT count(*)::int n FROM public.sys_role WHERE role_code LIKE 'ui2_%' ")).rows[0].n, 0);
      const record = saved ?? { task, database: lease.database, instanceId: lease.instanceId, accounts: definitions.map(d => ({ username: d.username, password: "U7-" + randomBytes(24).toString("hex") })) };
      if (!saved) writeFileSync(file, JSON.stringify(record, null, 2) + "\n", { flag: "wx", mode: 0o600 });
      for (const d of definitions) {
        const user = randomUUID(), role = randomUUID();
        await client.query("INSERT INTO public.sys_user(id,username,password_hash,real_name,updated_at) VALUES($1,$2,$3,$4,NOW())", [user, d.username, await bcrypt.hash(record.accounts.find(a => a.username === d.username).password, 12), d.name]);
        await client.query("INSERT INTO public.sys_role(id,role_code,role_name,updated_at) VALUES($1,$2,$3,NOW())", [role, d.username.replaceAll("-", "_"), d.name]);
        await client.query("INSERT INTO public.sys_user_role(id,user_id,role_id) VALUES($1,$2,$3)", [randomUUID(), user, role]);
        for (const code of d.permissions) { const permission = (await client.query("SELECT id FROM public.sys_permission WHERE permission_code=$1 AND status='active'", [code])).rows[0]; assert.ok(permission); await client.query("INSERT INTO public.sys_role_permission(id,role_id,permission_id) VALUES($1,$2,$3)", [randomUUID(), role, permission.id]); }
      }
      const pages = [{ path: "/admin", title: "工作台", code: "aij.bootstrap.admin" }];
      if (task !== "AF-030") pages.push({ path: "/auth/admin-users", title: "管理员用户", code: "admin.user.manage" });
      if (["AF-032", "AF-033", "AF-043"].includes(task)) pages.push({ path: "/auth/roles", title: "角色与权限", code: "admin.role.manage" });
      if (task === "AF-035") pages.push({ path: "/auth/dictionaries", title: "字典分类", code: "admin.dict.manage" });
      if (task === "AF-036") pages.push({ path: "/auth/configuration", title: "项目配置", code: "admin.config.manage" });
      if (task === "AF-037") pages.push({ path: "/auth/secrets", title: "密钥引用", code: "admin.secret.manage" });
      if (task === "AF-038") pages.push({ path: "/auth/audit-logs", title: "审计日志", code: "admin.log.read" });
      if (["AF-087", "AF-088", "AF-089", "AF-090"].includes(task)) pages.push({ path: "/auth/clients", title: "客户账号", code: "admin.client.read" });
      for (const [index, page] of pages.entries()) {
        const route = page.path === "/admin" ? "apps/web/app/admin/page.tsx" : "apps/web/app" + page.path + "/page.tsx";
        assert.ok(existsSync(join(repositoryRoot, route)), "Only delivered real routes can be seeded");
        await client.query("INSERT INTO public.sys_menu(id,title,path,permission_code,sort_order,updated_at) VALUES($1,$2,$3,$4,$5,NOW())", [randomUUID(), page.title, page.path, page.code, index]);
      }
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
  }, { acceptanceId: id });
  return { seed, accounts: definitions.map(d => ({ username: d.username, role: d.name, initialPasswordFile: file })) };
}
