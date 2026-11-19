// Synthetic acceptance accounts only; registered tasks, no existing account reset.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { acceptanceRecord, assertLocalPath, readDatabaseEnvironment, repositoryRoot, withDatabase } from "../database/connection.mjs";
import { seedDatabase, validateInitialPassword } from "../database/seed.mjs";

const require = createRequire(join(repositoryRoot, "apps/api/package.json")), bcrypt = require("bcryptjs");
export async function prepareRbacFixture(id, task = "AF-014") {
  assert.ok(["AF-014", "AF-015", "AF-016", "AF-017", "AF-018", "AF-019", "AF-020", "AF-021", "AF-022", "AF-023", "AF-024", "AF-082", "AF-095", "AF-096", "AF-097", "AF-098", "AF-099", "AF-101", "AF-102", "AF-106", "AF-107"].includes(task));
  const lease = acceptanceRecord("test", id); assert.equal(lease.task, task);
  const definitions = task === "AF-106" ? [
    { username: "af106-payment-manager", role: "af106_payment_manager", permissions: ["admin.payment.read", "admin.payment.refund.request"], expectedCatalog: 403 },
    { username: "af106-payment-reader", role: "af106_payment_reader", permissions: ["admin.payment.read"], expectedCatalog: 403 }
  ] : task === "AF-107" ? [
    { username: "af107-reconciliation-manager", role: "af107_reconciliation_manager", permissions: ["admin.payment.read", "admin.payment.refund.request", "admin.payment.reconciliation.read", "admin.payment.reconciliation.run", "admin.payment.reconciliation.review"], expectedCatalog: 403 },
    { username: "af107-payment-reader", role: "af107_payment_reader", permissions: ["admin.payment.read"], expectedCatalog: 403 }
  ] : task === "AF-095" ? [
    { username: "af095-config", role: "af095_config", permissions: ["admin.config.manage"], expectedCatalog: 403 },
    { username: "af095-secret", role: "af095_secret", permissions: ["admin.config.manage", "admin.secret.manage"], expectedCatalog: 403 },
    { username: "af095-reader", role: "af095_reader", permissions: ["aij.bootstrap.admin"], expectedCatalog: 200 }
  ] : task === "AF-097" ? [
    { username: "af097-ai-reader", role: "af097_ai_reader", permissions: ["admin.runtime.read"], expectedCatalog: 403 },
    { username: "af097-no-read", role: "af097_no_read", permissions: [], expectedCatalog: 403 }
  ] : task === "AF-098" ? [
    { username: "af098-ai-reader", role: "af098_ai_reader", permissions: ["admin.runtime.read"], expectedCatalog: 403 },
    { username: "af098-no-read", role: "af098_no_read", permissions: [], expectedCatalog: 403 }
  ] : task === "AF-099" ? [
    { username: "af099-integration-manager", role: "af099_integration_manager", permissions: ["admin.integration.manage"], expectedCatalog: 200 },
    { username: "af099-no-access", role: "af099_no_access", permissions: [], expectedCatalog: 403 }
  ] : task === "AF-101" ? [
    { username: "af101-integration-manager", role: "af101_integration_manager", permissions: ["admin.integration.manage"], expectedCatalog: 200 },
    { username: "af101-no-access", role: "af101_no_access", permissions: [], expectedCatalog: 403 }
  ] : task === "AF-102" ? [
    { username: "af102-integration-manager", role: "af102_integration_manager", permissions: ["admin.integration.manage"], expectedCatalog: 200 },
    { username: "af102-no-access", role: "af102_no_access", permissions: [], expectedCatalog: 403 }
  ] : task === "AF-096" ? [
    { username: "af096-trace-reader", role: "af096_trace_reader", permissions: ["admin.runtime.read"], expectedCatalog: 403 },
    { username: "af096-no-read", role: "af096_no_read", permissions: [], expectedCatalog: 403 }
  ] : task === "AF-024" ? [
    { username: "af024-auditor", role: "af024_auditor", permissions: ["admin.log.read"], expectedCatalog: 403, expectedRoles: 403, expectedDefinitions: 403 },
    { username: "af024-reader", role: "af024_reader", permissions: ["aij.bootstrap.admin"], expectedCatalog: 200, expectedRoles: 403, expectedDefinitions: 403 }
  ] : task === "AF-082" ? [
    { username: "af082-manager", role: "af082_manager", permissions: ["admin.plugin.manage", "admin.config.manage", "admin.secret.manage"], expectedCatalog: 403, expectedNotifications: 200 },
    { username: "af082-reader", role: "af082_reader", permissions: ["aij.bootstrap.admin"], expectedCatalog: 200, expectedNotifications: 403 }
  ] : task === "AF-017" ? [
    { username: "af017-reader", role: "af017_reader", permissions: ["aij.bootstrap.admin"], expectedCatalog: 200, expectedRoles: 403, expectedDefinitions: 403 },
    { username: "af017-no-access", role: "super_admin", permissions: [], expectedCatalog: 403, expectedRoles: 403, expectedDefinitions: 403 }
  ] : ["AF-016", "AF-019", "AF-020", "AF-021", "AF-022", "AF-023"].includes(task) ? [
    { username: task.toLowerCase().replace("-", "") + "-manager", role: task.toLowerCase().replace("-", "") + "_manager", permissions: ["admin.role.manage", "admin.permission.manage", ...(task === "AF-020" ? ["admin.menu.manage"] : []), ...(task === "AF-021" ? ["admin.dict.manage"] : []), ...(["AF-022", "AF-023"].includes(task) ? ["admin.config.manage"] : []), ...(task === "AF-023" ? ["admin.secret.manage"] : [])], expectedCatalog: 403, expectedRoles: 200, expectedDefinitions: 200 },
    { username: task.toLowerCase().replace("-", "") + "-reader", role: task.toLowerCase().replace("-", "") + "_reader", permissions: ["aij.bootstrap.admin"], expectedCatalog: 200, expectedRoles: 403, expectedDefinitions: 403 }
  ] : ["AF-015", "AF-018"].includes(task) ? [
    { username: task.toLowerCase().replace("-", "") + "-manager", role: task.toLowerCase().replace("-", "") + "_manager", permissions: ["admin.user.manage"], expectedCatalog: 403, expectedAdminUsers: 200 },
    { username: task.toLowerCase().replace("-", "") + "-reader", role: task.toLowerCase().replace("-", "") + "_reader", permissions: ["aij.bootstrap.admin"], expectedCatalog: 200, expectedAdminUsers: 403 }
  ] : [
    { username: "af014-reader", role: "af014_reader", permissions: ["aij.bootstrap.admin"], expectedCatalog: 200 },
    { username: "af014-no-access", role: "super_admin", permissions: [], expectedCatalog: 403 }
  ];
  const seed = await seedDatabase({ auditLogs: task === "AF-024", menuManagement: task === "AF-020", dictionaries: task === "AF-021", configuration: ["AF-022", "AF-023", "AF-082", "AF-095"].includes(task), secrets: ["AF-022", "AF-023", "AF-082", "AF-095"].includes(task), pluginManagement: task === "AF-082", integrationManagement: ["AF-099", "AF-101", "AF-102"].includes(task), paymentManagement: ["AF-106", "AF-107"].includes(task), mode: "test", acceptanceId: id, generateCredentials: true, adminUsers: ["AF-015", "AF-016", "AF-018", "AF-019", "AF-020", "AF-021", "AF-022", "AF-023", "AF-024", "AF-082", "AF-095", "AF-096", "AF-097", "AF-098", "AF-099", "AF-101", "AF-102", "AF-106", "AF-107"].includes(task), rbacManagement: ["AF-016", "AF-019", "AF-020", "AF-021", "AF-022", "AF-023", "AF-082", "AF-095", "AF-096", "AF-097", "AF-098", "AF-099", "AF-101", "AF-102"].includes(task) });
  const path = join(repositoryRoot, ".local-data/seed/test", lease.database, task === "AF-024" ? "audit-accounts.json" : task === "AF-017" ? "rbac-enforcement-accounts.json" : ["AF-016", "AF-019", "AF-020", "AF-021", "AF-022", "AF-023", "AF-024", "AF-082", "AF-096", "AF-097", "AF-098", "AF-099", "AF-101", "AF-102", "AF-106", "AF-107"].includes(task) ? "rbac-management-accounts.json" : ["AF-015", "AF-018"].includes(task) ? "admin-accounts.json" : "rbac-accounts.json");
  assertLocalPath(path); execFileSync("git", ["--no-optional-locks", "check-ignore", "--quiet", path], { cwd: repositoryRoot });
  const saved = existsSync(path) ? JSON.parse(readFileSync(path)) : undefined;
  if (saved) {
    assert.equal(saved.task, task); assert.equal(saved.repository, repositoryRoot); assert.equal(saved.database, lease.database); assert.equal(saved.instanceId, lease.instanceId);
    assert.deepEqual(saved.accounts.map(a => a.username), definitions.map(account => account.username));
    saved.accounts.forEach(a => validateInitialPassword(a.password));
  }
  await withDatabase("test", readDatabaseEnvironment("test", process.env, id), async client => {
    await client.query("BEGIN");
    try {
      await client.query("SELECT pg_advisory_xact_lock(hashtext('aij-af014-fixture'))");
      const users = (await client.query("SELECT username FROM public.sys_user WHERE username=ANY($1::text[])", [definitions.map(account => account.username)])).rows;
      if (users.length) { assert.ok(saved && users.length === 2, "Existing fixture accounts require their original local credentials; no reset"); await client.query("COMMIT"); return; }
      assert.equal((await client.query("SELECT count(*)::int AS count FROM public.sys_role WHERE role_code=ANY($1::text[])", [definitions.map(account => account.role)])).rows[0].count, 0, "Reserved fixture role conflict; no overwrite");
      const record = saved ?? { task, repository: repositoryRoot, database: lease.database, instanceId: lease.instanceId,
        accounts: definitions.map(account => ({ username: account.username, role: account.role, password: "R7-" + randomBytes(24).toString("hex") })) };
      if (!saved) { mkdirSync(join(path, ".."), { recursive: true, mode: 0o700 }); writeFileSync(path, JSON.stringify(record, null, 2) + "\n", { flag: "wx", mode: 0o600 }); }
      for (const account of record.accounts) {
        const userId = randomUUID(), roleId = randomUUID();
        await client.query("INSERT INTO public.sys_user (id,username,password_hash,real_name,status,is_super_admin,updated_at) VALUES ($1,$2,$3,$4,'active',false,CURRENT_TIMESTAMP)", [userId, account.username, await bcrypt.hash(validateInitialPassword(account.password), 12), task + " 合成验收账号"]);
        await client.query("INSERT INTO public.sys_role (id,role_code,role_name,updated_at) VALUES ($1,$2,$3,CURRENT_TIMESTAMP)", [roleId, account.role, task + " 合成角色"]);
        await client.query("INSERT INTO public.sys_user_role (id,user_id,role_id) VALUES ($1,$2,$3)", [randomUUID(), userId, roleId]);
        for (const code of definitions.find(value => value.username === account.username).permissions) {
          const permissionId = (await client.query("SELECT id FROM public.sys_permission WHERE permission_code=$1 AND status='active'", [code])).rows[0]?.id; assert.ok(permissionId);
          await client.query("INSERT INTO public.sys_role_permission (id,role_id,permission_id) VALUES ($1,$2,$3)", [randomUUID(), roleId, permissionId]);
        }
      }
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
  }, { acceptanceId: id });
  return { seed, initialPasswordFile: seed.credentials.file, accounts: definitions.map(account => { const published = { ...account }; delete published.permissions; return { ...published, initialPasswordFile: path }; }) };
}
