import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";
import { createAcceptance, migrate } from "../database/migration.mjs";
import { readDatabaseEnvironment, repositoryRoot, withDatabase } from "../database/connection.mjs";
import { applicationSessions, setTaskDatabaseConnections, waitReady } from "./readiness-support.mjs";
import { authEnvironment, authKeys } from "./auth-support.mjs";
import { prepareRbacFixture } from "./rbac-fixture.mjs";
import { seedArguments, seedDatabase } from "../database/seed.mjs";

test("AF-022 real layered configuration, public context, concurrency and atomic change/audit", { timeout: 55000 }, async t => {
  const parent = join(repositoryRoot, ".artifacts/af-022/http"); mkdirSync(parent, { recursive: true }); const directory = mkdtempSync(join(parent, "run-"));
  const lease = await createAcceptance("test", "AF-022"); await migrate({ mode: "test", action: "deploy", acceptanceId: lease.id });
  const fixture = await prepareRbacFixture(lease.id, "AF-022"), initial = JSON.parse(readFileSync(fixture.initialPasswordFile)), accounts = JSON.parse(readFileSync(fixture.accounts[0].initialPasswordFile)).accounts;
  const keys = authKeys(lease.id, "AF-022"), original = { ...process.env }, environment = authEnvironment(lease.id, keys.secret, "AF-022"), secrets = [initial.password, ...accounts.map(a => a.password), keys.secret], tokens = {}, events = [];
  const protectedPaths = ["apps/api/src/configuration/configuration.service.ts", "apps/api/src/rbac/management-access.service.ts", "apps/api/src/common/guards/admin-authorization.guard.ts", "apps/api/prisma/schema.prisma", "apps/api/prisma/migrations/20261019000000_initial/migration.sql", "apps/api/prisma/migrations/20261019010000_dictionaries/migration.sql"];
  const hash = p => createHash("sha256").update(readFileSync(p)).digest("hex"), hashes = protectedPaths.map(hash), save = (name, value) => writeFileSync(join(directory, name + ".json"), JSON.stringify(value, null, 2) + "\n");
  for (const key of Object.keys(process.env)) delete process.env[key]; Object.assign(process.env, environment);
  const require = createRequire(join(repositoryRoot, "apps/api/package.json")), { createApplication } = require(join(repositoryRoot, "apps/api/dist/bootstrap.js")), { PrismaService } = require(join(repositoryRoot, "apps/api/dist/prisma/prisma.service.js"));
  let app, prisma, profile, managerRole, permission, baseUrl;
  const query = operation => withDatabase("test", readDatabaseEnvironment("test", process.env, lease.id), operation, { acceptanceId: lease.id });
  async function request(path, expected, { token = tokens.root, method = "GET", body } = {}) {
    const response = await fetch(baseUrl + "/api/" + path, { method, headers: { "x-correlation-id": "af022-http", ...(token ? { authorization: "Bearer " + token } : {}), ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10000) });
    const value = await response.json(); assert.equal(response.status, expected, method + " " + path + " response=" + JSON.stringify(value)); if (value.data?.accessToken) secrets.push(value.data.accessToken);
    for (const secret of secrets.filter(s => s !== value.data?.accessToken)) assert.ok(!JSON.stringify(value).includes(secret)); assert.ok(!/passwordHash|password_hash|\$2[aby]\$\d\d\$/.test(JSON.stringify(value)));
    if (path.startsWith("admin/") || path.startsWith("project/")) assert.equal(response.headers.get("cache-control"), "no-store"); events.push({ path, method, status: response.status }); return value.data;
  }
  const login = async account => (await request("auth/login", 200, { method: "POST", body: { username: account.username, password: account.password } })).accessToken;
  const put = (key, scope, configValue, expectedVersion, extra = {}, status = 200, token = tokens.root) => request("admin/scoped-configs/" + key, status, { method: "PUT", token, body: { scope, configValue, valueType: "string", isPublic: true, status: "active", expectedVersion, ...extra } });
  const context = () => request("project/context", 200, { token: null });
  const resolve = key => request("admin/scoped-configs/" + key + "/resolved", 200);
  const config = (key, scope = "project") => prisma.scopedConfig.findFirst({ where: { configKey: key, scope, scopeId: scope === "global" ? "global" : scope === "organization" ? profile.organization.id : profile.id, pluginCode: "" } });
  const auditCount = () => prisma.auditLog.count({ where: { module: "configuration" } });
  try {
    app = await createApplication(); await app.listen(0, "127.0.0.1");
    const address = app.getHttpServer().address(); assert.ok(address && typeof address === "object" && address.port > 0, "API binds an OS-selected ephemeral loopback port");
    baseUrl = "http://127.0.0.1:" + address.port; prisma = app.get(PrismaService);
    await t.test("accepted Seed/project identity and explicit configuration definition are real and non-reconciling", async () => {
      assert.deepEqual(seedArguments(["test", "--configuration"]), { mode: "test", acceptanceId: undefined, generateCredentials: false, configuration: true }); assert.throws(() => seedArguments(["test", "--configuration", "--configuration"]));
      tokens.root = await login(initial); tokens.manager = await login(accounts[0]); tokens.reader = await login(accounts[1]); profile = await prisma.projectProfile.findUniqueOrThrow({ where: { code: "aij-foundation-test" }, include: { organization: true } });
      managerRole = await prisma.sysRole.findUniqueOrThrow({ where: { roleCode: "af022_manager" } }); permission = await prisma.sysPermission.findUniqueOrThrow({ where: { permissionCode: "admin.config.manage" } });
      assert.equal(await prisma.scopedConfig.count(), 0); assert.equal(await prisma.configurationChange.count(), 0); const grants = await prisma.sysRolePermission.count();
      await prisma.sysPermission.update({ where: { id: permission.id }, data: { status: "disabled" } });
      try { await seedDatabase({ mode: "test", acceptanceId: lease.id, generateCredentials: true, configuration: true }); assert.equal((await prisma.sysPermission.findUniqueOrThrow({ where: { id: permission.id } })).status, "disabled"); }
      finally { await prisma.sysPermission.update({ where: { id: permission.id }, data: { status: "active" } }); }
      assert.equal(await prisma.sysRolePermission.count(), grants); const own = await context(); assert.equal(own.projectCode, profile.code); assert.deepEqual(own.brand, { displayName: "AIJ", primaryColor: "#2563EB", logoPath: "/" }); assert.deepEqual(own.enabledPlugins, []);
    });
    await t.test("all six management paths reject anonymous/ungranted access and client scope claims", async () => {
      for (const [path, method, body] of [["admin/project-profile", "GET"], ["admin/project-profile", "PATCH", { status: "disabled", expectedUpdatedAt: profile.updatedAt.toISOString() }], ["admin/scoped-configs", "GET"], ["admin/scoped-configs/brand.displayName", "PUT", { scope: "project", configValue: "no", valueType: "string", isPublic: true, status: "active", expectedVersion: 0 }], ["admin/scoped-configs/brand.displayName/resolved", "GET"], ["admin/configuration-changes", "GET"]]) { await request(path, 401, { method, body, token: null }); await request(path, 403, { method, body, token: tokens.reader }); }
      await put("brand.displayName", "global", "no", 0, {}, 403, tokens.manager); await put("brand.displayName", "project", "no", 0, { scopeId: "foreign" }, 403); await request("admin/scoped-configs?scope=organization&scopeId=foreign", 403); await request("admin/scoped-configs?scopeId=foreign", 400); assert.equal(await prisma.scopedConfig.count(), 0);
      assert.equal((await request("project/context?projectId=foreign&workspaceId=owner", 200, { token: null })).projectCode, profile.code);
    });
    await t.test("strict configuration schema rejects invalid values/types and arbitrary environment scripts", async () => {
      for (const [key, value, extra] of [["brand.primaryColor", "red", {}], ["brand.logoPath", "https://example.invalid/logo.svg", {}], ["brand.logoPath", "/../secret", {}], ["brand.displayName", "password=plaintext", {}], ["internal.retentionDays", "NaN", { valueType: "number", isPublic: false }], ["internal.retentionDays", "366", { valueType: "number", isPublic: false }], ["capabilities.publicContextEnabled", "1", { valueType: "boolean" }], ["private.integrationRef", "raw-plaintext", { valueType: "secretRef", isPublic: false }], ["capabilities.enabledPlugins", "aij-ai", {}], ["runtime.command", "touch .artifacts/af-022/forbidden", {}]]) await put(key, "project", value, 0, extra, 400);
      await put("brand.displayName", "plugin", "no", 0, {}, 400); await put("brand.displayName", "project", "no", -1, {}, 400); await put("brand.displayName", "project", "no", 0, { isPublic: "true" }, 400); await put("brand.displayName", "project", "no", 0, { pluginCode: "aij-ai", workspaceId: "owner" }, 400);
      assert.equal(await prisma.scopedConfig.count(), 0); assert.equal(await auditCount(), 0); assert.equal(existsSync(".artifacts/af-022/forbidden"), false);
    });
    await t.test("project over organization over global precedence follows trusted DB ownership", async () => {
      await put("brand.displayName", "global", "AF022 global", 0); assert.equal((await resolve("brand.displayName")).source, "global"); assert.equal((await context()).brand.displayName, "AF022 global");
      await put("brand.displayName", "organization", "AF022 organization", 0, { scopeId: profile.organization.id }, 200, tokens.manager); assert.equal((await resolve("brand.displayName")).source, "organization");
      await put("brand.displayName", "project", "AF022 project", 0, { scopeId: profile.id }, 200, tokens.manager); assert.equal((await resolve("brand.displayName")).source, "project"); assert.equal((await context()).brand.displayName, "AF022 project");
      await prisma.scopedConfig.create({ data: { scope: "project", scopeId: "foreign-project", configKey: "brand.primaryColor", configValue: "#FF0000", name: "synthetic foreign", isPublic: true } });
      await prisma.scopedConfig.create({ data: { scope: "global", scopeId: "not-global", configKey: "brand.logoPath", configValue: "/foreign", name: "synthetic foreign", isPublic: true } });
      assert.equal((await context()).brand.primaryColor, "#2563EB"); assert.ok(!(await request("admin/scoped-configs", 200)).some(r => r.scopeId.includes("foreign") || r.scopeId === "not-global"));
      save("precedence", { global: "global", organization: "organization", project: "project", foreignRowsExcluded: true, clientScopeClaimsRejected: true });
    });
    await t.test("disabled rows fall back but private/sensitive higher scope never reveals lower public values", async () => {
      await put("brand.displayName", "project", "AF022 project", 1, { status: "disabled" }); assert.equal((await context()).brand.displayName, "AF022 organization");
      await put("brand.displayName", "organization", "AF022 organization", 1, { status: "disabled" }); assert.equal((await context()).brand.displayName, "AF022 global");
      await put("brand.displayName", "project", "AF022 private higher", 2, { isPublic: false }); assert.equal((await context()).brand.displayName, undefined); assert.equal((await resolve("brand.displayName")).configValue, "AF022 private higher");
      const row = await config("brand.displayName"); await prisma.scopedConfig.update({ where: { id: row.id }, data: { sensitive: true, isPublic: true } });
      try { assert.equal((await context()).brand.displayName, undefined); assert.equal((await resolve("brand.displayName")).configValue, undefined); }
      finally { await prisma.scopedConfig.update({ where: { id: row.id }, data: { sensitive: false, isPublic: false } }); }
      await put("brand.displayName", "project", "AF022 project", 3); save("shadowing", { disabledFallback: true, privateHigherHidesLowerPublic: true, sensitiveHigherHidesLowerPublic: true });
    });
    await t.test("sensitive refs are opaque, registered and redacted even to authorized API consumers", async () => {
      const ref = "env://AIJ_SECRET_AIJ_FOUNDATION_TEST_SYNTHETIC_CONFIG_ONLY", secretName = ref.slice(6), syntheticSecret = "T7-" + randomBytes(24).toString("hex"); secrets.push(syntheticSecret); process.env[secretName] = syntheticSecret;
      assert.ok(await prisma.sysPermission.findFirst({ where: { permissionCode: "admin.secret.manage", status: "active" } }));
      const managerActor = await prisma.sysUser.findUniqueOrThrow({ where: { username: accounts[0].username }, select: { id: true } });
      assert.equal((await request("auth/me", 200, { token: tokens.manager })).id, managerActor.id, "the role-granted token resolves to the fixture manager");
      assert.ok(await prisma.sysUser.findFirst({ where: { isSuperAdmin: true, status: "active" } }), "the bootstrap principal is an active system administrator");
      await put("private.integrationRef", "project", ref, 0, { valueType: "secretRef", isPublic: false }, 400, tokens.root);
      await prisma.secretReference.create({ data: { ref, provider: "env", description: "AF022 opaque metadata only" } });
      await put("private.integrationRef", "project", ref, 0, { valueType: "secretRef", isPublic: true }, 400, tokens.root);
      const result = await put("private.integrationRef", "project", ref, 0, { valueType: "secretRef", isPublic: false }, 200, tokens.root); assert.equal(result.referenceConfigured, true); assert.ok(!JSON.stringify(result).includes(ref));
      for (const value of [await context(), await resolve("private.integrationRef"), await request("admin/scoped-configs", 200), await request("admin/configuration-changes", 200)]) { assert.ok(!JSON.stringify(value).includes(ref)); assert.ok(!JSON.stringify(value).includes(syntheticSecret)); }
      assert.equal((await config("private.integrationRef")).configValue, ref); assert.ok(!JSON.stringify(await prisma.configurationChange.findMany()).includes(ref)); delete process.env[secretName];
      save("sensitive", { missingReference: 400, sensitivePublic: 400, adminValueRedacted: true, noEnvironmentResolution: true });
    });
    await t.test("public whitelist ignores profile legal/meta and poisoned legacy public rows", async () => {
      await put("internal.retentionDays", "project", "45", 0, { valueType: "number", isPublic: true }, 400);
      await put("internal.retentionDays", "project", "45", 0, { valueType: "number", isPublic: false }); assert.equal((await resolve("internal.retentionDays")).configValue, 45);
      await request("admin/scoped-configs/internal.retentionDays/resolved", 401, {token:null}); await request("admin/scoped-configs/internal.retentionDays/resolved", 403, {token:tokens.reader});
      await prisma.projectProfile.update({ where: { id: profile.id }, data: { brand: { token: "SYNTHETIC_PRIVATE_PROFILE" }, legalEntity: "SYNTHETIC_PRIVATE_ENTITY" } });
      await prisma.organizationProfile.update({ where: { id: profile.organization.id }, data: { meta: { credential: "SYNTHETIC_PRIVATE_ORG" } } });
      await prisma.scopedConfig.create({ data: { scope: "project", scopeId: profile.id, configKey: "legacy.apiKey", configValue: "SYNTHETIC_PRIVATE_LEGACY", valueType: "string", name: "synthetic poisoned flags", isPublic: true, sensitive: false } });
      const value = await context(); assert.deepEqual(Object.keys(value).sort(), ["brand", "capabilities", "enabledPlugins", "projectCode"]); assert.ok(!JSON.stringify(value).includes("SYNTHETIC_PRIVATE")); assert.equal((await request("admin/scoped-configs", 200)).find(r => r.configKey === "legacy.apiKey").configValue, undefined);
    });
    await t.test("optimistic create/update conflicts keep exact one change per version under concurrent writers", async () => {
      const run = async (expectedVersion, color) => { const r = await fetch(baseUrl + "/api/admin/scoped-configs/brand.primaryColor", { method: "PUT", headers: { authorization: "Bearer " + tokens.root, "content-type": "application/json", "x-correlation-id": "af022-http" }, body: JSON.stringify({ scope: "project", configValue: color, valueType: "string", isPublic: true, status: "active", expectedVersion }) }); return r.status; };
      assert.deepEqual((await Promise.all([run(0, "#111111"), run(0, "#222222")])).sort(), [200, 409]);
      assert.deepEqual((await Promise.all([run(1, "#333333"), run(1, "#444444")])).sort(), [200, 409]);
      const row = await config("brand.primaryColor"), changes = await prisma.configurationChange.findMany({ where: { configId: row.id }, orderBy: { configVersion: "asc" } }); assert.equal(row.version, 2); assert.deepEqual(changes.map(c => c.configVersion), [1, 2]); assert.ok(changes.every(c => c.auditLogId));
      const count = await auditCount(); await put("brand.primaryColor", "project", "#FFFFFF", 1, {}, 409); assert.equal(await auditCount(), count);
      await assert.rejects(prisma.configurationChange.create({ data: { scope: row.scope, scopeId: row.scopeId, configKey: row.configKey, configId: row.id, configVersion: 2 } }), e => e.code === "P2002");
      save("versions", { concurrentCreate: [200, 409], concurrentUpdate: [200, 409], versions: [1, 2], staleUpdate: 409, uniqueHistoryEnforced: true });
    });
    await t.test("project/organization disabled contexts reject reads/writes and guarded recovery uses profile timestamp", async () => {
      let current = await request("admin/project-profile", 200);
      await request("admin/project-profile", 403, { method: "PATCH", token: tokens.manager, body: { status: "disabled", expectedUpdatedAt: current.updatedAt } });
      const disabled = await request("admin/project-profile", 200, { method: "PATCH", body: { status: "disabled", expectedUpdatedAt: current.updatedAt } });
      for (const path of ["project/context", "admin/scoped-configs", "admin/scoped-configs/brand.displayName/resolved", "admin/configuration-changes"]) await request(path, 403);
      await put("brand.logoPath", "project", "/", 0, {}, 403); await request("health", 200, { token: null }); await request("ready", 200, { token: null }); await request("auth/me", 200);
      await request("admin/project-profile", 409, { method: "PATCH", body: { status: "active", expectedUpdatedAt: current.updatedAt } });
      await request("admin/project-profile", 200, { method: "PATCH", body: { status: "active", expectedUpdatedAt: disabled.updatedAt } }); await context();
      await prisma.organizationProfile.update({ where: { id: profile.organization.id }, data: { status: "disabled" } });
      try { await request("project/context", 403, { token: null }); await put("brand.logoPath", "project", "/", 0, {}, 403); }
      finally { await prisma.organizationProfile.update({ where: { id: profile.organization.id }, data: { status: "active" } }); }
      current = await request("admin/project-profile", 200); assert.equal(current.status, "active"); save("project-status", { disabledPublicAndConfig: 403, recoveryProfileReadable: 200, staleProfile: 409, healthReadyStill: 200, organizationDisabled: 403 });
    });
    await t.test("capability toggle affects only declared public context, never runtime environment or plugin installation", async () => {
      await put("capabilities.publicContextEnabled", "project", "false", 0, { valueType: "boolean" }); await request("project/context", 403, { token: null }); await request("health", 200, { token: null });
      await put("capabilities.publicContextEnabled", "project", "true", 1, { valueType: "boolean" }); assert.equal((await context()).capabilities.publicContext, true);
      await put("capabilities.publicContextEnabled", "project", "false", 2, { valueType: "boolean", status: "disabled" }); assert.equal((await context()).capabilities.publicContext, true);
      assert.equal(process.env.AUTH_ENABLED, "true"); assert.equal(process.env.ENABLED_PLUGINS, ""); assert.equal(await prisma.pluginInstallation.count(), 0); assert.equal(existsSync(".artifacts/af-022/forbidden"), false);
      save("activation", { falseGatesContext: 403, true: 200, disabledRowUsesDefault: true, runtimeEnvironmentUnchanged: true, installedPlugins: 0, scriptsExecuted: false });
    });
    await t.test("audit OR change insertion failure rolls back config value/version/history and project state", async () => {
      const row = await config("brand.displayName"), current = await request("admin/project-profile", 200), count = await auditCount(), changeCount = await prisma.configurationChange.count();
      await query(async c => { await c.query("CREATE FUNCTION public.af022_reject_configuration_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic change ledger unavailable'; END $$"); });
      try { for (const table of ["audit_log", "configuration_change"]) {
        const trigger = "af022_reject_" + table; await query(c => c.query('CREATE TRIGGER ' + trigger + ' BEFORE INSERT ON public.' + table + ' FOR EACH ROW EXECUTE FUNCTION public.af022_reject_configuration_write()'));
        try { await put("brand.displayName", "project", "must rollback", row.version, {}, 503); await request("admin/project-profile", 503, { method: "PATCH", body: { status: "disabled", expectedUpdatedAt: current.updatedAt } }); assert.deepEqual(await config("brand.displayName"), row); assert.deepEqual(await request("admin/project-profile", 200), current); assert.equal(await auditCount(), count); assert.equal(await prisma.configurationChange.count(), changeCount); }
        finally { await query(c => c.query('DROP TRIGGER ' + trigger + ' ON public.' + table)); }
      }
      } finally { await query(c => c.query("DROP FUNCTION public.af022_reject_configuration_write()")); } save("atomic-ledgers", { auditFailureAndChangeFailure: 503, configAndProfileRollback: true, noOrphanAuditOrHistory: true, ownProbesRemoved: true });
    });
    await t.test("actual advisory-lock wait followed by revoke denies queued write and preserves version", async () => {
      let pending, committed = false; const row = await config("brand.displayName");
      try {
        await query(async c => { await c.query("BEGIN"); try { await c.query("SELECT pg_advisory_xact_lock(hashtext('aij-admin-users-write'))"); pending = put("brand.displayName", "project", "must not write", row.version, {}, 403, tokens.manager).catch(e => e); let blocked = false; const end = Date.now() + 2000; while (Date.now() < end) { blocked = (await c.query("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND application_name LIKE 'aij-api:%' AND wait_event_type='Lock' AND wait_event='advisory') AS blocked")).rows[0].blocked; if (blocked) break; await new Promise(r => setTimeout(r, 25)); } assert.ok(blocked); await c.query("DELETE FROM public.sys_role_permission WHERE role_id=$1 AND permission_id=$2", [managerRole.id, permission.id]); await c.query("COMMIT"); committed = true; } finally { if (!committed) await c.query("ROLLBACK"); } }); assert.ok(!(await pending instanceof Error)); assert.deepEqual(await config("brand.displayName"), row);
      } finally { if (pending) await pending; if (committed) await prisma.sysRolePermission.create({ data: { roleId: managerRole.id, permissionId: permission.id } }); }
    });
    await t.test("actual database outage is sanitized 503 with process liveness and recovery intact", async () => {
      await prisma.$disconnect(); await setTaskDatabaseConnections(lease.id, false, "AF-022");
      try { await request("project/context", 503, { token: null }); await request("admin/scoped-configs", 503); await request("health", 200, { token: null }); await request("ready", 503, { token: null }); }
      finally { await setTaskDatabaseConnections(lease.id, true, "AF-022"); }
      await waitReady(baseUrl); await context();
    });
    await t.test("versioned changes link safe audit records and no original brand/customer payload is copied", async () => {
      const changes = await prisma.configurationChange.findMany({ where: { auditLogId: { not: null } }, include: { auditLog: true, config: true } }); assert.ok(changes.length >= 10);
      assert.ok(changes.every(c => c.auditLog && c.auditLog.module === "configuration" && c.auditLog.userId === c.operatorId && c.auditLog.requestSummary.correlationId === "af022-http"));
      assert.ok(changes.filter(c => c.configId).every(c => c.configVersion >= 1 && c.configId === c.auditLog.resourceId && c.config.configKey === c.configKey));
      const text = JSON.stringify(changes.map(c => ({ metadata: c.changeMetadata, audit: c.auditLog }))); for (const secret of secrets) assert.ok(!text.includes(secret)); assert.ok(!/AF022 private higher|must rollback|env:\/\/|SYNTHETIC_PRIVATE/.test(text));
      const rows = await request("admin/configuration-changes", 200); assert.ok(rows.every(c => c.auditLogId && !Object.hasOwn(c, "configValue"))); assert.equal(await prisma.projectProfile.count(), 1); assert.equal(await prisma.organizationProfile.count(), 1);
      save("audit-links", { changes: changes.map(c => ({ id: c.id, scope: c.scope, configKey: c.configKey, configId: c.configId, version: c.configVersion, auditId: c.auditLogId })), safeAuditAndMetadata: true, onlySyntheticProject: true });
    });
    await t.test("production files stay unchanged and closing the real app leaves zero pool", async () => {
      assert.deepEqual(protectedPaths.map(hash), hashes); await app.close(); app = undefined; assert.deepEqual(await applicationSessions(lease.id, "AF-022"), []); save("result", { task: "AF-022", database: lease.database, acceptanceId: lease.id, events, sourceFilesUnchanged: true, pool: 0 });
    });
  } finally { if (app) await app.close(); for (const key of Object.keys(process.env)) delete process.env[key]; Object.assign(process.env, original); }
});
