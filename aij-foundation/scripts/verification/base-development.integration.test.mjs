import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import test from "node:test";
import { BASE_DEVELOPMENT_MENUS } from "../base-policy.cjs";
import { paths, readLocalState, root, systemEnvironment } from "../base-development/config.mjs";
import { withBaseDatabase } from "../base-development/database.mjs";
import { baseApi, baseOrigin, baseCall, basePreflight, baseSession } from "./base-development-support.mjs";

const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const cli = action => JSON.parse(execFileSync(process.execPath, ["scripts/base-development/cli.mjs", action], {
  cwd: root, env: systemEnvironment(), encoding: "utf8", timeout: 180000
}));
async function snapshot() {
  const { values } = readLocalState();
  return withBaseDatabase(values, async client => ({
    menus: (await client.query("SELECT * FROM public.sys_menu ORDER BY path")).rows,
    passwordHashes: (await client.query("SELECT id,password_hash FROM public.sys_user ORDER BY id")).rows,
    userRoles: (await client.query("SELECT * FROM public.sys_user_role ORDER BY id")).rows,
    grants: (await client.query("SELECT * FROM public.sys_role_permission ORDER BY id")).rows,
    dictionaries: (await client.query("SELECT * FROM public.system_dict ORDER BY id")).rows
  }));
}

test("Persistent Base: real administrator menus, business APIs and non-destructive initialization", { timeout: 240000 }, async t => {
  await basePreflight();
  const evidence = { project: "aij-base-dev", web: baseOrigin + "/login", api: baseApi, observations: [] };
  const session = await baseSession();
  await t.test("Same authenticated identity receives four backend-owned menus and effective permissions", async () => {
    const menus = await baseCall(session, "/admin/menus/my");
    assert.deepEqual(menus.map(({ title, path }) => ({ title, path })), BASE_DEVELOPMENT_MENUS.map(({ title, path }) => ({ title, path })));
    assert.equal(new Set(menus.map(menu => menu.id)).size, 4);
    const permissions = await baseCall(session, "/admin/permissions/my");
    assert.equal(permissions.isSuperAdmin, true);
    for (const menu of BASE_DEVELOPMENT_MENUS) assert.ok(permissions.effectivePermissions.includes(menu.permission));
    evidence.menus = menus;
    evidence.observations.push({ check: "menus-and-permissions", status: 200, count: 4 });
  });
  await t.test("All four registered pages and their actual authenticated list APIs respond", async () => {
    for (const [page, api] of [["/auth/admin-users", "/admin/users"], ["/auth/roles", "/admin/roles"], ["/auth/dictionaries", "/admin/dicts"], ["/auth/audit-logs", "/admin/logs"]]) {
      const response = await fetch(baseOrigin + page, { signal: AbortSignal.timeout(8000) });
      assert.equal(response.status, 200, page);
      const data = await baseCall(session, api);
      assert.ok(Array.isArray(data.items), api + " returns the real paginated collection");
      evidence.observations.push({ page, pageStatus: 200, api, apiStatus: 200, total: data.total });
      await baseCall(null, api, 401);
    }
  });
  await t.test("Reinitialization retains IDs, password hashes, custom data, credentials and a real custom grant", async () => {
    const nonce = randomBytes(5).toString("hex");
    const permissions = await baseCall(session, "/admin/permissions/manage?pageSize=100");
    const read = permissions.items.find(row => row.permissionCode === "admin.dict.read");
    assert.ok(read, "The formal initializer registers dictionary-read for the next card");
    const role = await baseCall(session, "/admin/roles", 201, "POST", { roleCode: "af134_probe_" + nonce, roleName: "AF-134 初始化保留校验" });
    await baseCall(session, "/admin/roles/" + role.id + "/permissions", 200, "PUT", { permissionIds: [read.id] });
    const dictionary = await baseCall(session, "/admin/dicts", 201, "POST", { dictCode: "custom.af134." + nonce, dictName: "AF-134 初始化保留校验" });
    const before = await snapshot();
    const files = [paths.credentials, paths.environment, paths.password].map(path => ({ path, digest: sha(readFileSync(path)) }));
    const initialized = cli("init");
    assert.equal(initialized.status, "INITIALIZED");
    assert.equal(initialized.existingCredentialsAndGrantsPreserved, true);
    const after = await snapshot();
    // Do not include raw hashes in assertion diagnostics or persisted evidence.
    assert.ok(JSON.stringify(before.passwordHashes) === JSON.stringify(after.passwordHashes), "No existing password hash changed");
    for (const key of ["menus", "userRoles", "grants", "dictionaries"]) assert.deepEqual(after[key], before[key], key + " unchanged");
    for (const { path, digest } of files) assert.ok(sha(readFileSync(path)) === digest, "Private credential file unchanged");
    await baseSession();
    await baseCall(session, "/admin/dicts"); // The original valid session survives initialization.
    evidence.observations.push({ check: "reinitialization", duplicateMenus: false, passwordPreserved: true, credentialsPreserved: true, existingSessionPreserved: true, customRoleId: role.id, customDictionaryId: dictionary.id, grantsPreserved: true });
  });
  await t.test("The documented start command reuses running owned services without rebuilding or resetting", async () => {
    const files = [paths.credentials, paths.environment, paths.password, paths.processes, paths.build].map(path => ({ path, digest: sha(readFileSync(path)) }));
    const running = cli("start");
    assert.equal(running.status, "RUNNING");
    for (const { path, digest } of files) assert.ok(sha(readFileSync(path)) === digest, "Running Base state unchanged");
    const login = await baseSession();
    assert.equal((await baseCall(login, "/admin/menus/my")).length, 4);
    evidence.observations.push({ check: "repeated-start", status: "RUNNING", originalServicesRetained: true });
  });
  mkdirSync(".artifacts/orca-b02/AF-134", { recursive: true });
  writeFileSync(".artifacts/orca-b02/AF-134/live-integration.json", JSON.stringify(evidence, null, 2) + "\n");
});
