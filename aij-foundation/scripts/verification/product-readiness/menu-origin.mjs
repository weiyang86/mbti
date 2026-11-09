// AF-129: inspect the existing AF-124 synthetic runtime; never seed or repair it.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { acceptanceRecord, assertLocalPath, readDatabaseEnvironment, repositoryRoot, withDatabase } from "../../database/connection.mjs";

export const evidenceDirectory = join(repositoryRoot, ".artifacts/orca-b02/AF-129");
const runtimePath = ".artifacts/product-check-20261104/runtime.json";
const runtimeScript = ".artifacts/product-check-20261104/runtime.mjs";
const credentialsPath = ".artifacts/product-check-20261104/credentials.json";
const aiPaths = ["/auth/ai/center", "/auth/ai/usage"];
const endpoints = { health: "/health", ready: "/ready", anonymous: "/auth/me", login: "/auth/login", identity: "/auth/me", permissions: "/admin/permissions/my", my: "/admin/menus/my", menus: "/admin/menus", pages: "/admin/menus/pages", plugins: "/admin/plugins", logout: "/auth/logout" };
const baseRoutes = [
  { path: "/login", file: "apps/web/app/login/page.tsx", permission: null },
  { path: "/admin", file: "apps/web/app/admin/page.tsx", permission: "aij.bootstrap.admin" },
  { path: "/auth/admin-users", file: "apps/web/app/auth/admin-users/page.tsx", permission: "admin.user.manage" },
  { path: "/auth/roles", file: "apps/web/app/auth/roles/page.tsx", permission: "admin.role.manage" },
  { path: "/auth/audit-logs", file: "apps/web/app/auth/audit-logs/page.tsx", permission: "admin.log.read" }
];
const sha = value => createHash("sha256").update(value).digest("hex");
const now = () => new Date().toISOString();
const read = file => { const path = join(repositoryRoot, file); assertLocalPath(path); return readFileSync(path, "utf8"); };
const run = (command, args) => execFileSync(command, args, { cwd: repositoryRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 15000, maxBuffer: 4 * 1024 * 1024 }).trim();
const pick = (row, keys) => Object.fromEntries(keys.filter(key => row[key] !== undefined).map(key => [key, row[key]]));
const flatten = nodes => nodes.flatMap(node => [node, ...flatten(node.children ?? [])]);

// All saved HTTP responses use explicit projections; no headers or raw bodies.
export function projectResponse(kind, data) {
  if (kind === "identity" || kind === "login") return pick(kind === "login" ? data.user : data, ["id", "isSuperAdmin"]);
  if (kind === "permissions") return pick(data, ["id", "isSuperAdmin", "roles", "permissions", "effectivePermissions"]);
  if (kind === "my" || kind === "menus") return data.map(row => ({ ...pick(row, ["id", "parentId", "title", "path", "type", "permissionCode", "pluginCode", "sortOrder", "visible", "status", "deletedAt"]), children: projectResponse(kind, row.children ?? []) }));
  if (kind === "pages") return data.map(row => pick(row, ["path", "pluginCode", "available"]));
  if (kind === "plugins") return {
    available: data.available.map(row => pick(row, ["code", "version", "owner"])),
    installations: data.installations.map(row => pick(row, ["id", "pluginCode", "version", "owner", "status"]))
  };
  if (kind === "health") return pick(data, ["status", "service", "projectId", "namespace", "scope", "time", "database"]);
  if (kind === "ready") return pick(data, ["status", "scope", "reason", "time"]);
  if (kind === "logout") { assert.equal(data.revoked, true); return { revoked: true }; }
  if (kind === "denial") return { denied: true };
  throw new Error("Unknown response projection");
}

export function assertSanitized(value) {
  const visit = item => {
    if (!item || typeof item !== "object") return;
    for (const [key, child] of Object.entries(item)) {
      assert.doesNotMatch(key, /password|secret|token|cookie|authorization|csrf|credential|email|phone|realName|username/i, "Sensitive field in evidence");
      visit(child);
    }
  };
  visit(value);
  assert.doesNotMatch(JSON.stringify(value), /Bearer\s+|eyJ[A-Za-z0-9_-]+\.eyJ|postgres(?:ql)?:\/\/|-----BEGIN .*PRIVATE KEY/i, "Sensitive value in evidence");
}

function sourceEvidence(head) {
  const specs = [
    ["scripts/database/seed.mjs", ["if (aiCenter) for", "INSERT INTO public.sys_menu", "const capability = adminUsers", "const rbac =", "const audit =", "const menu ="]],
    ["apps/api/src/menus/menus.service.ts", ["const activeCodes", "const enabledPlugins", "const rows = await tx.sysMenu", "return this.tree", "user.isSuperAdmin"]],
    ["apps/api/src/menus/menu-availability.service.ts", ["MENU_PAGES", "pluginEnabled(code", "pageAvailable(path", "catalog()"]],
    ["apps/api/src/menus/menus.controller.ts", ['@Controller("admin/menus")', '@Get("my")', '@Get("pages")', '@Get()']],
    ["apps/api/src/rbac/permissions.service.ts", ["const effectivePermissions", "user.isSuperAdmin", "required.every"]],
    ["apps/web/app/components/admin-shell.tsx", ["const [session, permissions, menus]", "snapshot.menus", "effectivePermissions.includes"]],
    ["apps/web/app/components/admin-auth.tsx", ['router.replace("/admin")']],
    ["apps/api/src/app.module.ts", ["runtime.capabilities.auth", "runtime.capabilities.auth && runtime.capabilities.database"]],
    ["apps/api/src/rbac/rbac.module.ts", ["AuthModule", "RolesController"]],
    ["apps/api/src/auth/auth.service.ts", ["data: { lastLoginAt", "tx.adminAuthSession.create", "async logout", 'this.audit(tx, claims.sub, "logout"'] ],
    ["scripts/verification/client-auth-fixture.mjs", ["const seed = await seedDatabase"]],
    ["scripts/verification/remaining-client-fixture.mjs", ["ENABLED_PLUGINS:'aij-ai'", "pluginInstallation.upsert"]],
    ...baseRoutes.map(route => [route.file, ["export default"]])
  ];
  return specs.map(([file, anchors]) => {
    const content = read(file), committed = run("git", ["show", `${head}:${file}`]);
    assert.equal(content.trimEnd(), committed, "Audited source differs from recorded checkout");
    const lines = content.split("\n");
    return { file, head, sha256: sha(content), anchors: anchors.map(anchor => {
      const matches = lines.flatMap((text, i) => text.includes(anchor) ? [{ line: i + 1, text: text.trim() }] : []);
      assert.ok(matches.length, "Missing source anchor: " + file);
      return { anchor, matches };
    }) };
  });
}

function runtimeEvidence() {
  const record = JSON.parse(read(runtimePath));
  const head = run("git", ["rev-parse", "HEAD"]);
  assert.equal(run("git", ["branch", "--show-current"]), "dev");
  assert.equal(record.head, head, "Runtime record and checkout SHA mismatch; do not reuse another version");
  assert.equal(record.fixtureOwner, "AF-124"); assert.equal(record.synthetic, true);
  assert.equal(record.realExternalCallsAllowed, false);
  assert.equal(record.webUrl, "http://127.0.0.1:13655"); assert.equal(record.apiUrl, "http://127.0.0.1:3656/api");
  assert.equal(record.credentialsFile, join(repositoryRoot, credentialsPath));
  assert.ok(Number.isInteger(record.pid) && record.pid > 1);
  const scan = JSON.parse(run("orca", ["ports", "--all", "--json"])).result;
  assert.ok(!scan.unavailableReason && Array.isArray(scan.ports));
  const ports = scan.ports.filter(row => [3655, 3656, 13655, 55433].includes(row.port))
    .map(row => pick(row, ["port", "pid", "bindHost", "processName", "kind"]));
  for (const port of [3656, 13655]) {
    const listeners = ports.filter(row => row.port === port);
    assert.equal(listeners.length, 1); assert.equal(listeners[0].pid, record.pid); assert.equal(listeners[0].bindHost, "127.0.0.1");
  }
  const processInfo = (pid, requireCurrentCwd = true) => {
    const command = run("ps", ["-p", String(pid), "-o", "command="]);
    // Never use ps e: the process environment may contain private values.
    assert.match(command, /^(?:node |.*\/node )[^\n]+\.mjs$/);
    const started = run("ps", ["-p", String(pid), "-o", "lstart="]);
    const cwd = run("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"]).split("\n").find(line => line.startsWith("n"))?.slice(1);
    const knownCwd = cwd && !cwd.startsWith("cwd|rtd info error:") ? cwd : "unknown";
    if (requireCurrentCwd) assert.equal(realpathSync(knownCwd), realpathSync(repositoryRoot));
    return { pid, command, started, cwd: knownCwd };
  };
  const active = processInfo(record.pid); assert.ok(active.command.endsWith(runtimeScript));
  const old = ports.find(row => row.port === 3655);
  const legacy = old ? { ...processInfo(old.pid, false), port: 3655, buildSha: "unknown", sameVersionProven: false } : { port: 3655, listening: false, buildSha: "unknown", sameVersionProven: false };
  const lease = acceptanceRecord("test", record.acceptanceId);
  assert.equal(lease.task, "AF-124"); assert.equal(lease.database, record.database);
  return { recorded: pick(record, ["pid", "startedAt", "head", "webUrl", "apiUrl", "database", "acceptanceId", "fixtureOwner", "synthetic", "realExternalCallsAllowed", "usesKnownOriginTestProxy"]),
    checkout: { head, branch: "dev", status: run("git", ["status", "--short", "--branch"]), remote: run("git", ["remote", "get-url", "origin"]) },
    observedAt: now(), scanTime: new Date(scan.scannedAt).toISOString(), ports, active, legacy,
    attribution: "SHA comes from the startup record matched to checkout, PID, cwd and ports; process memory is not an independently attested build", runtimeScriptSha256: sha(read(runtimeScript)) };
}

async function databaseSnapshot(runtime, username) {
  const id = runtime.recorded.acceptanceId;
  const values = readDatabaseEnvironment("test", process.env, id);
  return withDatabase("test", values, async (client, target, identity) => {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    try {
      const query = async (sql, params = []) => (await client.query(sql, params)).rows;
      const rows = {
        accounts: await query("SELECT id,status,is_super_admin,token_version AS auth_version,deleted_at FROM public.sys_user ORDER BY id"),
        roles: await query("SELECT id,role_code,status,data_scope,deleted_at,updated_at FROM public.sys_role ORDER BY id"),
        userRoles: await query("SELECT id,user_id,role_id FROM public.sys_user_role ORDER BY id"),
        rolePermissions: await query("SELECT id,role_id,permission_id FROM public.sys_role_permission ORDER BY id"),
        roleMenus: await query("SELECT id,role_id,menu_id FROM public.sys_role_menu ORDER BY id"),
        definitions: await query("SELECT id,permission_code,resource_type,module,action,api_path,status,updated_at FROM public.sys_permission ORDER BY id"),
        menus: await query("SELECT id,parent_id,title,path,type,permission_code,plugin_code,sort_order,visible,status,deleted_at,updated_at FROM public.sys_menu ORDER BY id"),
        plugins: await query("SELECT id,project_id,plugin_code,version,owner,status,installed_at,enabled_at,disabled_at,uninstalled_at,updated_at FROM public.plugin_installation ORDER BY id"),
        projects: await query("SELECT id,code,environment,status,deleted_at,updated_at FROM public.project_profile ORDER BY id")
      };
      const subjects = await query("SELECT id FROM public.sys_user WHERE username=$1", [username]); assert.equal(subjects.length, 1);
      const observations = {
        sessions: await query("SELECT transport,count(*)::int AS count,count(*) FILTER (WHERE revoked_at IS NOT NULL)::int AS revoked FROM public.admin_auth_session GROUP BY transport ORDER BY transport"),
        auditActions: await query("SELECT module,action,count(*)::int AS count FROM public.audit_log GROUP BY module,action ORDER BY module,action"),
        login: await query("SELECT last_login_at,updated_at FROM public.sys_user WHERE id=$1", [subjects[0].id])
      };
      const tx = await query("SELECT current_setting('transaction_read_only') AS read_only"); assert.equal(tx[0].read_only, "on");
      await client.query("ROLLBACK");
      return { at: now(), target: pick(target, ["mode", "host", "port", "database", "user", "acceptanceId"]),
        identity: pick(identity, ["database", "user", "sessionUser", "serverPort"]), readOnly: true, subjectId: subjects[0].id,
        rows, fingerprints: Object.entries(rows).map(([table, data]) => ({ table, count: data.length, sha256: sha(JSON.stringify(data)) })), observations };
    } catch (error) { await client.query("ROLLBACK"); throw error; }
  }, { acceptanceId: id });
}

function conclusions(e) {
  const response = name => e.http.find(row => row.name === name)?.response;
  const mine = flatten(response("my")), managed = flatten(response("menus")), access = response("permissions");
  const subject = e.before.rows.accounts.find(row => row.id === e.before.subjectId);
  assert.equal(access.id, subject.id); assert.equal(access.isSuperAdmin, subject.is_super_admin);
  for (const kind of ["identity", "login"]) assert.deepEqual(response(kind), { id: subject.id, isSuperAdmin: subject.is_super_admin });
  const project = e.before.rows.projects.find(row => row.code === "aij-foundation-test" && row.status === "active" && row.deleted_at === null); assert.ok(project);
  const expectedDefinitions = e.before.rows.definitions.filter(row => row.status === "active").map(row => row.permission_code).sort();
  if (access.isSuperAdmin) assert.deepEqual([...access.effectivePermissions].sort(), expectedDefinitions);
  const activeRoles = e.before.rows.roles.filter(role => role.status === "active" && role.deleted_at === null && e.before.rows.userRoles.some(link => link.user_id === subject.id && link.role_id === role.id));
  assert.deepEqual([...access.roles].sort(), activeRoles.map(role => role.role_code).sort());
  const granted = e.before.rows.definitions.filter(def => def.status === "active" && e.before.rows.rolePermissions.some(link => link.permission_id === def.id && activeRoles.some(role => role.id === link.role_id))).map(row => row.permission_code).sort();
  assert.deepEqual([...access.permissions].sort(), granted);
  assert.deepEqual(mine.map(row => row.path).sort(), [...aiPaths].sort());
  assert.deepEqual(managed.map(row => row.path).sort(), e.before.rows.menus.filter(row => row.deleted_at === null).map(row => row.path).sort());
  assert.deepEqual(managed.map(row => row.path).sort(), [...aiPaths].sort());
  for (const row of e.before.rows.menus) {
    assert.equal(row.status, "active"); assert.equal(row.visible, true); assert.equal(row.plugin_code, "aij-ai");
    assert.ok(access.effectivePermissions.includes(row.permission_code));
    assert.ok(response("pages").some(page => page.path === row.path && page.pluginCode === row.plugin_code && page.available));
    assert.ok(e.before.rows.plugins.some(plugin => plugin.project_id === project.id && plugin.plugin_code === row.plugin_code && plugin.status === "enabled"));
  }
  assert.ok(response("plugins").available.some(plugin => plugin.code === "aij-ai"));
  assert.ok(response("plugins").installations.some(plugin => plugin.pluginCode === "aij-ai" && plugin.status === "enabled"));
  const base = baseRoutes.slice(1).map(route => ({ path: route.path, permission: route.permission,
    definitionPresent: expectedDefinitions.includes(route.permission), effective: access.effectivePermissions.includes(route.permission),
    menuPresent: managed.some(menu => menu.path === route.path), catalogAvailable: response("pages").some(page => page.path === route.path && page.available && page.pluginCode === null) }));
  assert.ok(base.every(route => !route.menuPresent && route.catalogAvailable));
  return { observedMenuPaths: mine.map(row => row.path).sort(), primaryCause: "AF-124 AI fixture contains exactly the two AI seed menu rows; core menu initialization is absent",
    permissionFilterRemovedExistingMenus: false, pluginFilterRemovedExistingMenus: false, isSuperAdminGeneratesMenus: false,
    versionScope: "13655/3656 match the recorded runtime SHA; 3655 build SHA remains unknown", base,
    baseInstance: "not independently started or verified", baseReadiness: "路由已存在，开箱初始化尚欠", acceptance: "ORCA-B01 and owner acceptance remain pending; this audit does not accept them" };
}

function assertNormalLoginEffects(before, after) {
  const sessions = rows => new Map(rows.map(row => [row.transport, row]));
  const old = sessions(before.sessions), current = sessions(after.sessions);
  assert.equal(current.get("bearer").count, (old.get("bearer")?.count ?? 0) + 1);
  assert.equal(current.get("bearer").revoked, (old.get("bearer")?.revoked ?? 0) + 1);
  for (const transport of new Set([...old.keys(), ...current.keys()])) if (transport !== "bearer") assert.deepEqual(old.get(transport), current.get(transport));
  const actions = rows => new Map(rows.map(row => [row.module + ":" + row.action, row.count]));
  const oldActions = actions(before.auditActions), currentActions = actions(after.auditActions);
  for (const key of new Set([...oldActions.keys(), ...currentActions.keys()])) {
    const expected = (oldActions.get(key) ?? 0) + (["auth:login", "auth:logout"].includes(key) ? 1 : 0);
    assert.equal(currentActions.get(key), expected, "Unexpected audit action delta");
  }
  assert.ok(currentActions.has("auth:login") && currentActions.has("auth:logout"));
  assert.equal(after.login.length, 1); assert.equal(before.login.length, 1);
  assert.notEqual(after.login[0].last_login_at, before.login[0].last_login_at);
}

export function assertEvidence(e) {
  assertSanitized(e);
  assert.equal(e.task, "AF-129"); assert.equal(e.schema, "aij.menu-origin/v1");
  for (const at of [e.startedAt, e.completedAt, e.runtime.observedAt, e.before.at, e.after.at]) assert.ok(Number.isFinite(Date.parse(at)));
  assert.match(e.runtime.checkout.head, /^[a-f0-9]{40}$/); assert.equal(e.runtime.checkout.head, e.runtime.recorded.head);
  assert.equal(e.runtime.legacy.buildSha, "unknown"); assert.equal(e.runtime.legacy.sameVersionProven, false);
  for (const port of [3656, 13655]) assert.ok(e.runtime.ports.some(row => row.port === port && row.pid === e.runtime.recorded.pid));
  for (const snapshot of [e.before, e.after]) {
    assert.equal(snapshot.readOnly, true); assert.equal(snapshot.target.port, 55433); assert.equal(snapshot.target.mode, "test");
    assert.equal(snapshot.target.database, e.runtime.recorded.database); assert.equal(snapshot.target.acceptanceId, e.runtime.recorded.acceptanceId);
    assert.ok(["localhost", "127.0.0.1"].includes(snapshot.target.host));
    assert.equal(snapshot.target.database, "aij_foundation_af124_test_" + snapshot.target.acceptanceId);
    assert.equal(snapshot.identity.database, snapshot.target.database); assert.equal(snapshot.identity.user, "aij_foundation_test");
    assert.equal(snapshot.identity.sessionUser, snapshot.identity.user); assert.equal(snapshot.identity.serverPort, 5432);
    assert.deepEqual(snapshot.fingerprints, Object.entries(snapshot.rows).map(([table, rows]) => ({ table, count: rows.length, sha256: sha(JSON.stringify(rows)) })));
  }
  assert.deepEqual(e.before.fingerprints, e.after.fingerprints, "Account authorization, roles, definitions, menus, plugins or project state changed");
  assert.deepEqual(e.before.rows, e.after.rows);
  assertNormalLoginEffects(e.before.observations, e.after.observations);
  const names = ["health", "ready", "anonymous", "login", "identity", "permissions", "my", "menus", "pages", "plugins", "logout", ...baseRoutes.map(route => "web:" + route.path)];
  assert.deepEqual(e.http.map(row => row.name).sort(), names.sort());
  for (const row of e.http) {
    assert.equal(row.status, row.name === "anonymous" ? 401 : 200); assert.ok(Number.isFinite(Date.parse(row.at)));
    assert.equal(row.method, ["login", "logout"].includes(row.name) ? "POST" : "GET");
    assert.ok(row.response && typeof row.response === "object");
    assert.equal(row.path, row.name.startsWith("web:") ? row.name.slice(4) : endpoints[row.name]);
    if (row.name.startsWith("web:")) {
      assert.equal(row.response.html, true); assert.ok(row.response.bytes > 0);
      assert.deepEqual(Object.keys(row.response).sort(), ["bytes", "html", "scope"]);
    } else {
      const kind = { anonymous: "denial", login: "identity", identity: "identity" }[row.name] ?? row.name;
      assert.deepEqual(row.response, projectResponse(kind, row.response), "Unexpected HTTP response fields");
    }
  }
  assert.equal(e.http.find(row => row.name === "health").response.namespace, "aij-foundation:test");
  assert.equal(e.http.find(row => row.name === "ready").response.status, "ready");
  assert.ok(e.source.length >= 16);
  for (const source of e.source) {
    assert.equal(source.head, e.runtime.checkout.head); assert.match(source.sha256, /^[a-f0-9]{64}$/);
    assert.ok(source.anchors.length && source.anchors.every(anchor => anchor.matches.length && anchor.matches.every(match => match.line > 0 && match.text)));
  }
  for (const route of baseRoutes) assert.ok(e.source.some(source => source.file === route.file));
  assert.deepEqual(e.conclusions, conclusions(e));
  assert.equal(e.boundaries.noGrantRepair, true); assert.equal(e.boundaries.loginSessionAndAuditWrites, true);
  assert.equal(e.boundaries.independentBaseVerified, false);
  return true;
}

async function collect(progress) {
  assert.equal(realpathSync(process.cwd()), realpathSync(repositoryRoot), "Run from the authorized original worktree");
  const startedAt = progress.startedAt;
  progress.stage = "runtime-preflight";
  const runtime = runtimeEvidence(); progress.runtime = runtime;
  progress.stage = "source-audit";
  const source = sourceEvidence(runtime.checkout.head); progress.source = source;
  const credential = JSON.parse(read(credentialsPath)); assert.equal(credential.synthetic, true);
  progress.stage = "protected-database-before";
  const before = await databaseSnapshot(runtime, credential.admin.username), http = [];
  progress.before = before; progress.http = http;
  let token;
  const call = async (name, method, path, kind, body, expected = 200) => {
    progress.stage = "http:" + name;
    const response = await fetch(runtime.recorded.apiUrl + path, { method, redirect: "error", signal: AbortSignal.timeout(15000),
      headers: { ...(token ? { authorization: "Bearer " + token } : {}), ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
    // No raw server error/body reaches output, assertion text or persisted evidence.
    const json = await response.json();
    const safe = response.status === expected ? projectResponse(kind, json.data) : { unexpectedStatus: response.status };
    http.push({ name, method, path, status: response.status, at: now(), response: safe });
    assert.equal(response.status, expected, "Unexpected HTTP status at " + name);
    if (name === "login") { token = json.data.accessToken; assert.equal(typeof token, "string"); }
  };
  try {
    await call("health", "GET", "/health", "health"); await call("ready", "GET", "/ready", "ready");
    await call("anonymous", "GET", "/auth/me", "denial", undefined, 401);
    await call("login", "POST", "/auth/login", "login", credential.admin);
    await call("identity", "GET", "/auth/me", "identity");
    await call("permissions", "GET", "/admin/permissions/my", "permissions");
    await call("my", "GET", "/admin/menus/my", "my"); await call("menus", "GET", "/admin/menus", "menus");
    await call("pages", "GET", "/admin/menus/pages", "pages"); await call("plugins", "GET", "/admin/plugins", "plugins");
    for (const route of baseRoutes) {
      progress.stage = "web:" + route.path;
      const response = await fetch(runtime.recorded.webUrl + route.path, { redirect: "error", signal: AbortSignal.timeout(45000) });
      const body = await response.text();
      http.push({ name: "web:" + route.path, method: "GET", path: route.path, status: response.status, at: now(), response: { bytes: Buffer.byteLength(body), html: /<!DOCTYPE html>/i.test(body), scope: "unauthenticated Next route shell only; no independent base instance" } });
      assert.equal(response.status, 200, "Web route unavailable");
    }
  } finally {
    if (token) { await call("logout", "POST", "/auth/logout", "logout"); token = undefined; }
  }
  progress.stage = "protected-database-after";
  const after = await databaseSnapshot(runtime, credential.admin.username);
  progress.after = after; progress.stage = "evidence-verification";
  const evidence = { schema: "aij.menu-origin/v1", task: "AF-129", startedAt, completedAt: now(), runtime, source, before, after, http,
    boundaries: { noGrantRepair: true, loginSessionAndAuditWrites: true, independentBaseVerified: false, externalProviderCalls: false } };
  evidence.conclusions = conclusions(evidence);
  assertEvidence(evidence);
  assertLocalPath(evidenceDirectory); mkdirSync(evidenceDirectory, { recursive: true, mode: 0o700 });
  const output = join(evidenceDirectory, "menu-origin-" + startedAt.replaceAll(/[:.]/g, "-") + ".json");
  writeFileSync(output, JSON.stringify(evidence, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  writeFileSync(join(evidenceDirectory, "latest.json"), JSON.stringify({ file: output.slice(repositoryRoot.length + 1), sha256: sha(readFileSync(output)) }, null, 2) + "\n", { mode: 0o600 });
  return { output, evidence };
}

export async function collectMenuOrigin() {
  const progress = { schema: "aij.menu-origin-failure/v1", task: "AF-129", startedAt: now(), stage: "worktree-check" };
  try { return await collect(progress); }
  catch {
    // Retain only already-projected partial evidence, never exception messages,
    // response headers, credentials or connection values from a failed run.
    progress.failedAt = now(); assertSanitized(progress);
    assertLocalPath(evidenceDirectory); mkdirSync(evidenceDirectory, { recursive: true, mode: 0o700 });
    writeFileSync(join(evidenceDirectory, "failure-" + progress.startedAt.replaceAll(/[:.]/g, "-") + ".json"), JSON.stringify(progress, null, 2) + "\n", { mode: 0o600, flag: "wx" });
    throw new Error("AF-129 collection failed at " + progress.stage);
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const { output, evidence } = await collectMenuOrigin();
    console.log(JSON.stringify({ task: "AF-129", status: "PASS", evidence: output, httpChecks: evidence.http.length, authorizationUnchanged: true, menuPaths: evidence.conclusions.observedMenuPaths, base: evidence.conclusions.baseReadiness }));
  } catch (error) {
    // Assertions, pg and fetch errors can embed inputs; emit fixed text only.
    const stage = /^AF-129 collection failed at [a-z:/-]+$/.test(error.message) ? error.message : "AF-129 collection failed";
    console.error(stage + "; no permission/menu/plugin repair attempted. Inspect sanitized failure evidence before retrying.");
    process.exitCode = 1;
  }
}
