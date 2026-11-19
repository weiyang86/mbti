import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import test from "node:test";
import { createAcceptance, migrate } from "../database/migration.mjs";
import { readDatabaseEnvironment, repositoryRoot, withDatabase } from "../database/connection.mjs";
import { seedArguments, seedDatabase } from "../database/seed.mjs";
import { assertPortAvailable } from "../port-availability.mjs";
import { applicationSessions, setTaskDatabaseConnections, waitReady } from "./readiness-support.mjs";
import { authEnvironment, authKeys } from "./auth-support.mjs";
import { prepareRbacFixture } from "./rbac-fixture.mjs";
import { encryptSecretFixture, prepareSecretStore } from "./secret-store-fixture.mjs";

test("AF-023 actual HTTP/DB/file secret references, server consumption, atomic rotation and fail-closed access", { timeout: 55000 }, async t => {
  await assertPortAvailable(3656); const parent = join(repositoryRoot, ".artifacts/af-023/http"); mkdirSync(parent, { recursive: true }); const directory = mkdtempSync(join(parent, "run-"));
  const lease = await createAcceptance("test", "AF-023"); await migrate({ mode: "test", action: "deploy", acceptanceId: lease.id });
  const fixture = await prepareRbacFixture(lease.id, "AF-023"), initial = JSON.parse(readFileSync(fixture.initialPasswordFile)), accounts = JSON.parse(readFileSync(fixture.accounts[0].initialPasswordFile)).accounts;
  const store = prepareSecretStore(lease.id), localValues = { DEMO_OLD: randomBytes(32).toString("hex"), DEMO_NEW: randomBytes(32).toString("hex") }, keys = authKeys(lease.id, "AF-023"), original = { ...process.env }, environment = authEnvironment(lease.id, keys.secret, "AF-023");
  writeFileSync(store.file, JSON.stringify(encryptSecretFixture(localValues, environment.AIJ_SECRET_STORE_KEY)));
  const envPrefix = "env://AIJ_SECRET_AIJ_FOUNDATION_TEST_", envName = "AIJ_SECRET_AIJ_FOUNDATION_TEST_SYNTHETIC", envValue = randomBytes(32).toString("hex"), secrets = [initial.password, ...accounts.map(a => a.password), keys.secret, envValue, environment.AIJ_SECRET_STORE_KEY, ...Object.values(localValues)], tokens = {}, events = [];
  const protectedPaths = ["apps/api/src/secret-center/secret-center.service.ts", "apps/api/src/secret-center/secret-adapter.ts", "apps/api/src/configuration/configuration.service.ts", "apps/api/src/common/guards/admin-authorization.guard.ts", "apps/api/prisma/schema.prisma"], hash = p => createHash("sha256").update(readFileSync(p)).digest("hex"), hashes = protectedPaths.map(hash);
  const save = (name, value) => writeFileSync(join(directory, name + ".json"), JSON.stringify(value, null, 2) + "\n");
  for (const key of Object.keys(process.env)) delete process.env[key]; Object.assign(process.env, environment, { [envName]: envValue });
  const require = createRequire(join(repositoryRoot, "apps/api/package.json")), { createApplication } = require(join(repositoryRoot, "apps/api/dist/bootstrap.js")), { PrismaService } = require(join(repositoryRoot, "apps/api/dist/prisma/prisma.service.js")), { ConfigurationService } = require(join(repositoryRoot, "apps/api/dist/configuration/configuration.service.js")), { SecretCenterService } = require(join(repositoryRoot, "apps/api/dist/secret-center/secret-center.service.js")), { SecretRefPort } = require(join(repositoryRoot, "apps/api/dist/secret-center/secret-ref.js"));
  let app, prisma, configService, secretService, envRow, localRow, profile, role, permission;
  const query = operation => withDatabase("test", readDatabaseEnvironment("test", process.env, lease.id), operation, { acceptanceId: lease.id });
  const safe = value => { const text = JSON.stringify(value); for (const secret of secrets) assert.ok(!text.includes(secret), "Secret must remain server-only"); assert.ok(!/passwordHash|password_hash|\$2[aby]\$\d\d\$/.test(text)); };
  async function request(path, expected, { token = tokens.root, method = "GET", body, headers = {} } = {}) {
    const response = await fetch("http://127.0.0.1:3656/api/" + path, { method, headers: { "x-correlation-id": "af023-http", ...(token ? { authorization: "Bearer " + token } : {}), ...(body ? { "content-type": "application/json" } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10000) });
    assert.equal(response.status, expected, method + " " + path); const result = await response.json(); if (result.data?.accessToken) secrets.push(result.data.accessToken);
    if (!result.data?.accessToken) safe(result); assert.equal(response.headers.get("cache-control"), "no-store"); events.push({ path, method, status: response.status }); return result.data;
  }
  const login = async account => (await request("auth/login", 200, { method: "POST", body: { username: account.username, password: account.password } })).accessToken;
  const create = (ref, status = 201, token = tokens.root, extra = {}) => request("admin/secret-references", status, { method: "POST", token, body: { ref, ...extra } });
  const action = (row, kind, extra = {}, status = 200, token = tokens.root) => request("admin/secret-references/" + row.id + "/" + kind, status, { method: "POST", token, body: { expectedUpdatedAt: row.updatedAt, ...extra } });
  const detail = row => request("admin/secret-references/" + row.id, 200);
  const failed = async (op, status) => { try { await op(); assert.fail("Resolution must fail closed"); } catch (e) { assert.equal(e.getStatus?.(), status); safe({ message: e.message, response: e.getResponse?.() }); } };
  try {
    app = await createApplication(); await app.listen(3656, "127.0.0.1"); prisma = app.get(PrismaService); configService = app.get(ConfigurationService); secretService = app.get(SecretRefPort); assert.equal(secretService, app.get(SecretCenterService));
    await t.test("explicit Seed permission is non-reconciling and the exported port consumes the unique real service", async () => {
      assert.deepEqual(seedArguments(["test", "--secrets"]), { mode: "test", acceptanceId: undefined, generateCredentials: false, secrets: true }); assert.throws(() => seedArguments(["test", "--secrets", "--secrets"]));
      tokens.root = await login(initial); tokens.manager = await login(accounts[0]); tokens.reader = await login(accounts[1]); profile = await prisma.projectProfile.findUniqueOrThrow({ where: { code: "aij-foundation-test" } }); role = await prisma.sysRole.findUniqueOrThrow({ where: { roleCode: "af023_manager" } }); permission = await prisma.sysPermission.findUniqueOrThrow({ where: { permissionCode: "admin.secret.manage" } });
      const grants = await prisma.sysRolePermission.count(); await prisma.sysPermission.update({ where: { id: permission.id }, data: { status: "disabled" } });
      try { await seedDatabase({ mode: "test", acceptanceId: lease.id, generateCredentials: true, secrets: true }); assert.equal((await prisma.sysPermission.findUniqueOrThrow({ where: { id: permission.id } })).status, "disabled"); } finally { await prisma.sysPermission.update({ where: { id: permission.id }, data: { status: "active" } }); }
      assert.equal(await prisma.sysRolePermission.count(), grants); assert.equal(await prisma.secretReference.count(), 0);
    });
    await t.test("six routes deny anonymous 401 and ordinary 403 before probing or accepting client claims", async () => {
      const ref = envPrefix + "SYNTHETIC", body = { expectedUpdatedAt: new Date().toISOString() };
      for (const [path, method, data] of [["", "GET"], ["/unknown", "GET"], ["", "POST", { ref }], ["/unknown/rotate", "POST", { ...body, ref }], ["/unknown/clear", "POST", body], ["/unknown/check", "POST", body]]) {
        await request("admin/secret-references" + path, 401, { method, body: data, token: null }); await request("admin/secret-references" + path, 403, { method, body: data, token: tokens.reader, headers: { "x-permission": "admin.secret.manage", "x-workspace-id": "owner" } });
      }
      await create(ref, 403, tokens.reader, { permission: "admin.secret.manage", workspaceId: "owner" }); assert.equal(await prisma.secretReference.count(), 0); assert.equal(await prisma.auditLog.count({ where: { module: "secret-center" } }), 0);
    });
    await t.test("DTO, provider and exact runtime namespace reject arbitrary env/files/inline credentials without echo", async () => {
      for (const ref of ["https://example.invalid", "file:///etc/passwd", "env://DATABASE_URL", "env://JWT_SECRET", "env://AIJ_SECRET_STORE_KEY", "env://AIJ_SECRET_AIJ_FOUNDATION_DEVELOPMENT_SYNTHETIC", "local://foreign/test/DEMO_OLD", "local://aij-foundation/test/../DEMO_OLD", " " + envPrefix + "SYNTHETIC", envValue]) await create(ref, ref.includes("DEVELOPMENT") || ref.includes("foreign") || ref === "env://AIJ_SECRET_STORE_KEY" ? 403 : 400);
      await create(envPrefix + "SYNTHETIC", 400, tokens.root, { value: envValue }); await request("admin/secret-references?page=0", 400); await request("admin/secret-references?pageSize=101", 400); await request("admin/secret-references/unknown", 404);
    });
    await t.test("actual env resolution stays server-side; missing and template values fail closed", async () => {
      envRow = await create(envPrefix + "SYNTHETIC"); assert.equal(envRow.configured, true); assert.equal(await secretService.resolveTrusted(envRow.ref), envValue);
      const missing = await create(envPrefix + "MISSING"); assert.equal(missing.configured, false); await failed(() => secretService.resolveTrusted(missing.ref), 503);
      process.env[envName] = "change-me-placeholder"; assert.equal((await detail(envRow)).configured, false); await failed(() => secretService.resolveTrusted(envRow.ref), 503); process.env[envName] = envValue;
      await prisma.secretReference.update({ where: { id: envRow.id }, data: { provider: "unknown" } });
      try { assert.equal((await detail(envRow)).configured, false); await failed(() => secretService.resolveTrusted(envRow.ref), 404); } finally { await prisma.secretReference.update({ where: { id: envRow.id }, data: { provider: "env", updatedAt: new Date(envRow.updatedAt) } }); }
      const checked = await action(envRow, "check"); assert.equal(checked.configured, true); envRow = checked; await create(envRow.ref, 409);
      safe(await request("admin/secret-references", 200)); assert.equal((await detail(envRow)).ref, envRow.ref);
    });
    await t.test("actual protected local file resolves without database secret values and has stable pagination", async () => {
      localRow = await create(store.references[0], 201, tokens.manager); assert.equal(localRow.configured, true); assert.equal(await secretService.resolveTrusted(localRow.ref), localValues.DEMO_OLD);
      const a = await request("admin/secret-references?page=1&pageSize=1", 200), b = await request("admin/secret-references?page=2&pageSize=1", 200); assert.equal(a.total, 3); assert.equal(a.items.length, 1); assert.notEqual(a.items[0].id, b.items[0].id); assert.deepEqual((await request("admin/secret-references?page=10000", 200)).items, []);
      const stored = await prisma.secretReference.findMany(); safe(stored); assert.ok(stored.every(r => r.description === null)); save("providers", { env: true, protectedLocalFile: true, configuredOnlyOverHttp: true, total: a.total });
    });
    await t.test("actual encrypted file rejects missing/wrong key, tampering, wrong namespace and out-of-root paths without echo", async () => {
      const originalFile = readFileSync(store.file), key = process.env.AIJ_SECRET_STORE_KEY, bad = join(dirname(store.file), "bad.json");
      try {
        delete process.env.AIJ_SECRET_STORE_KEY; assert.equal((await detail(localRow)).configured, false); await failed(() => secretService.resolveTrusted(localRow.ref), 503);
        process.env.AIJ_SECRET_STORE_KEY = randomBytes(32).toString("hex"); await failed(() => secretService.resolveTrusted(localRow.ref), 503); process.env.AIJ_SECRET_STORE_KEY = key;
        writeFileSync(bad, envValue, { mode: 0o600 }); process.env.AIJ_SECRET_STORE_FILE = bad; await failed(() => secretService.resolveTrusted(localRow.ref), 503);
        const record = JSON.parse(originalFile); writeFileSync(bad, JSON.stringify({ ...record, namespace: "foreign:test" })); await failed(() => secretService.resolveTrusted(localRow.ref), 503);
        writeFileSync(bad, JSON.stringify({ ...record, tag: "00".repeat(16) })); await failed(() => secretService.resolveTrusted(localRow.ref), 503);
        process.env.AIJ_SECRET_STORE_FILE = join(dirname(store.file), "absent.json"); await failed(() => secretService.resolveTrusted(localRow.ref), 503);
        process.env.AIJ_SECRET_STORE_FILE = "/etc/passwd"; await failed(() => secretService.resolveTrusted(localRow.ref), 503);
        process.env.AIJ_SECRET_STORE_FILE = store.file; writeFileSync(store.file, "{\"" + envValue); await failed(() => secretService.resolveTrusted(localRow.ref), 503);
      } finally { writeFileSync(store.file, originalFile); writeFileSync(bad, JSON.stringify({ retainedSyntheticFailureFixture: true })); process.env.AIJ_SECRET_STORE_FILE = store.file; process.env.AIJ_SECRET_STORE_KEY = key; }
      assert.equal(await secretService.resolveTrusted(localRow.ref), localValues.DEMO_OLD); assert.ok(!readFileSync(store.file, "utf8").includes(localValues.DEMO_OLD)); safe(await detail(localRow));
    });
    await t.test("configuration consumes the actual exported port; rotation rebinds version/audit atomically and next request uses new value", async () => {
      await request("admin/scoped-configs/private.integrationRef", 200, { method: "PUT", body: { scope: "project", configValue: localRow.ref, valueType: "secretRef", isPublic: false, status: "active", expectedVersion: 0 } });
      let expected = localValues.DEMO_OLD; const received = [];
      const downstream = createServer((request, response) => { received.push(request.headers.authorization); response.setHeader("content-type", "application/json"); response.end(JSON.stringify({ accepted: request.headers.authorization === "Bearer " + expected })); });
      await new Promise(resolve => downstream.listen(0, "127.0.0.1", resolve));
      const consume = async () => { const secret = await configService.resolveTrustedSecret("private.integrationRef"), response = await fetch("http://127.0.0.1:" + downstream.address().port, { headers: { authorization: "Bearer " + secret }, signal: AbortSignal.timeout(3000) }); assert.equal((await response.json()).accepted, true); };
      try {
        await consume(); assert.equal(received.at(-1), "Bearer " + localValues.DEMO_OLD);
        localRow = await action(localRow, "rotate", { ref: store.references[1] }, 200, tokens.manager); assert.equal(localRow.configured, true); expected = localValues.DEMO_NEW;
        await consume(); assert.equal(received.at(-1), "Bearer " + localValues.DEMO_NEW); await failed(() => secretService.resolveTrusted(store.references[0]), 404);
        const row = await prisma.scopedConfig.findFirstOrThrow({ where: { configKey: "private.integrationRef" } }); assert.equal(row.configValue, store.references[1]); assert.equal(row.version, 2); safe(row);
        for (const data of [await request("project/context", 200, { token: null }), await request("admin/scoped-configs", 200), await request("admin/configuration-changes", 200)]) safe(data);
        const file = readFileSync(store.file, "utf8"), updatedValue = randomBytes(32).toString("hex"); secrets.push(updatedValue); writeFileSync(store.file, JSON.stringify(encryptSecretFixture({ ...localValues, DEMO_NEW: updatedValue }, process.env.AIJ_SECRET_STORE_KEY))); expected = updatedValue;
        try { await consume(); assert.equal(received.at(-1), "Bearer " + updatedValue); assert.equal(received.length, 3); } finally { writeFileSync(store.file, file); }
      } finally { downstream.closeAllConnections(); await new Promise(resolve => downstream.close(resolve)); }
      save("rotation", { configVersion: 2, actualSyntheticHttpCalls: 3, referenceRebound: true, newRequestNewValue: true, noValueCache: true, valuesNeverInScopedConfig: true });
    });
    await t.test("optimistic concurrent rotations permit one success and stale timestamps or duplicate target never overwrite", async () => {
      const nextRefs = [envPrefix + "CONCURRENT_A", envPrefix + "CONCURRENT_B"], path = "admin/secret-references/" + envRow.id + "/rotate";
      const results = await Promise.all(nextRefs.map(ref => fetch("http://127.0.0.1:3656/api/" + path, { method: "POST", headers: { authorization: "Bearer " + tokens.root, "content-type": "application/json", "x-correlation-id": "af023-http" }, body: JSON.stringify({ ref, expectedUpdatedAt: envRow.updatedAt }) })));
      assert.deepEqual(results.map(r => r.status).sort(), [200, 409]); for (const r of results) safe(await r.json()); const previous = envRow; envRow = await detail(envRow);
      await action(previous, "clear", {}, 409); await action(envRow, "rotate", { ref: localRow.ref }, 409); assert.deepEqual(await detail(envRow), envRow);
    });
    await t.test("clear disables resolution immediately without deleting env/file or scoped binding; missing target rotation remains closed", async () => {
      const configBefore = await prisma.scopedConfig.findMany(); const fileHash = hash(store.file); localRow = await action(localRow, "clear", {}, 200, tokens.manager); assert.equal(localRow.configured, false);
      await failed(() => secretService.resolveTrusted(localRow.ref), 404); await failed(() => configService.resolveTrustedSecret("private.integrationRef"), 404); assert.deepEqual(await prisma.scopedConfig.findMany(), configBefore); assert.equal(hash(store.file), fileHash); assert.equal(process.env[envName], envValue);
      localRow = await action(localRow, "rotate", { ref: envPrefix + "NO_VALUE" }); assert.equal(localRow.configured, false); await failed(() => configService.resolveTrustedSecret("private.integrationRef"), 503);
    });
    await t.test("global and foreign bindings cannot be rebound by an ordinary secret manager", async () => {
      // A sensitive configuration binding requires an available reference.
      // Keep this test about global/foreign authorization, with synthetic values
      // rather than weakening the production configured-reference check.
      for (const name of ["GLOBAL", "GLOBAL_NEW"]) { const value = randomBytes(32).toString("hex"); secrets.push(value); process.env["AIJ_SECRET_AIJ_FOUNDATION_TEST_" + name] = value; }
      const ref = await create(envPrefix + "GLOBAL"); await request("admin/scoped-configs/private.integrationRef", 200, { method: "PUT", body: { scope: "global", configValue: ref.ref, valueType: "secretRef", isPublic: false, status: "active", expectedVersion: 0 } });
      await action(ref, "rotate", { ref: envPrefix + "GLOBAL_NEW" }, 403, tokens.manager); assert.deepEqual(await detail(ref), ref); await action(ref, "clear", {}, 403, tokens.manager);
      const foreign = await prisma.scopedConfig.create({ data: { scope: "project", scopeId: "foreign", configKey: "private.integrationRef", name: "synthetic foreign", configValue: ref.ref, valueType: "secretRef", sensitive: true } });
      try { await action(ref, "rotate", { ref: envPrefix + "GLOBAL_NEW" }, 409); } finally { await prisma.scopedConfig.update({ where: { id: foreign.id }, data: { deletedAt: new Date() } }); }
    });
    await t.test("configuration-only manager cannot use config writes to probe reference registration", async () => {
      await prisma.sysRolePermission.deleteMany({ where: { roleId: role.id, permissionId: permission.id } });
      try { for (const ref of [localRow.ref, envPrefix + "UNREGISTERED"]) await request("admin/scoped-configs/private.integrationRef", 403, { method: "PUT", token: tokens.manager, body: { scope: "project", configValue: ref, valueType: "secretRef", isPublic: false, status: "active", expectedVersion: 99 } }); }
      finally { await prisma.sysRolePermission.create({ data: { roleId: role.id, permissionId: permission.id } }); }
    });
    await t.test("same JWT loses permission instantly; actual blocked write rechecks permission after the lock", async () => {
      await prisma.sysRole.update({ where: { id: role.id }, data: { status: "disabled" } }); try { await request("admin/secret-references", 403, { token: tokens.manager }); } finally { await prisma.sysRole.update({ where: { id: role.id }, data: { status: "active" } }); }
      let pending, committed = false; const before = await prisma.secretReference.count();
      try { await query(async c => { await c.query("BEGIN"); try { await c.query("SELECT pg_advisory_xact_lock(hashtext('aij-admin-users-write'))"); pending = create(envPrefix + "REVOKED", 403, tokens.manager).catch(e => e); let blocked = false; const end = Date.now() + 2000; while (Date.now() < end) { blocked = (await c.query("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND application_name LIKE 'aij-api:%' AND wait_event='advisory') AS blocked")).rows[0].blocked; if (blocked) break; await new Promise(r => setTimeout(r, 25)); } assert.ok(blocked); await c.query("DELETE FROM public.sys_role_permission WHERE role_id=$1 AND permission_id=$2", [role.id, permission.id]); await c.query("COMMIT"); committed = true; } finally { if (!committed) await c.query("ROLLBACK"); } }); assert.ok(!(await pending instanceof Error)); assert.equal(await prisma.secretReference.count(), before); await request("admin/secret-references", 403, { token: tokens.manager }); }
      finally { if (pending) await pending; if (committed) await prisma.sysRolePermission.create({ data: { roleId: role.id, permissionId: permission.id } }); }
    });
    await t.test("real audit/change insertion failures roll back all create/rotate/clear/check writes and config rebinding", async () => {
      const count = await prisma.secretReference.count(), changeCount = await prisma.configurationChange.count(), auditCount = await prisma.auditLog.count(), before = await prisma.secretReference.findMany({ orderBy: { id: "asc" } }), configs = await prisma.scopedConfig.findMany({ orderBy: { id: "asc" } });
      await query(c => c.query("CREATE FUNCTION public.af023_reject_secret_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic ledger unavailable'; END $$"));
      try { for (const table of ["audit_log", "configuration_change"]) { const trigger = "af023_reject_" + table; await query(c => c.query("CREATE TRIGGER " + trigger + " BEFORE INSERT ON public." + table + " FOR EACH ROW EXECUTE FUNCTION public.af023_reject_secret_write()"));
        try { await create(envPrefix + "ROLLBACK", 503); await action(localRow, "rotate", { ref: store.references[0] }, 503); await action(localRow, "clear", {}, 503); await action(localRow, "check", {}, 503);
          assert.deepEqual(await prisma.secretReference.findMany({ orderBy: { id: "asc" } }), before); assert.deepEqual(await prisma.scopedConfig.findMany({ orderBy: { id: "asc" } }), configs); assert.equal(await prisma.secretReference.count(), count); assert.equal(await prisma.configurationChange.count(), changeCount); assert.equal(await prisma.auditLog.count(), auditCount);
        } finally { await query(c => c.query("DROP TRIGGER " + trigger + " ON public." + table)); }
      } } finally { await query(c => c.query("DROP FUNCTION public.af023_reject_secret_write()")); }
    });
    await t.test("project disabled and database outage never synthesize configured success; liveness survives and recovery is real", async () => {
      await prisma.projectProfile.update({ where: { id: profile.id }, data: { status: "disabled" } }); try { await request("admin/secret-references", 403); await failed(() => secretService.resolveTrusted(localRow.ref), 403); } finally { await prisma.projectProfile.update({ where: { id: profile.id }, data: { status: "active" } }); }
      await prisma.$disconnect(); await setTaskDatabaseConnections(lease.id, false, "AF-023"); try { await request("admin/secret-references", 503); await failed(() => secretService.resolveTrusted(localRow.ref), 503); assert.equal((await fetch("http://127.0.0.1:3656/api/health")).status, 200); } finally { await setTaskDatabaseConnections(lease.id, true, "AF-023"); }
      await waitReady(); await detail(localRow);
    });
    await t.test("safe audit/change link records exist while no secret values enter database projections, evidence or source", async () => {
      const changes = await prisma.configurationChange.findMany({ where: { auditLog: { module: "secret-center" } }, include: { auditLog: true } }); assert.ok(changes.length >= 8); assert.ok(changes.every(c => c.auditLogId && c.auditLog.userId === c.operatorId && c.auditLog.requestSummary.correlationId === "af023-http")); safe(changes);
      for (const rows of [await prisma.scopedConfig.findMany(), await prisma.secretReference.findMany(), await prisma.auditLog.findMany()]) safe(rows);
      assert.ok(changes.some(c => c.configId && c.configVersion === 2)); assert.deepEqual(protectedPaths.map(hash), hashes); await app.close(); app = undefined; assert.deepEqual(await applicationSessions(lease.id, "AF-023"), []);
      save("result", { task: "AF-023", acceptanceId: lease.id, database: lease.database, events, auditEvents: changes.length, noSecretEcho: true, noSourceProbe: true, pool: 0 });
    });
  } finally { if (app) await app.close(); for (const key of Object.keys(process.env)) delete process.env[key]; Object.assign(process.env, original); }
});
