import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";
import { createAcceptance, migrate } from "../database/migration.mjs";
import { seedDatabase } from "../database/seed.mjs";
import { repositoryRoot, profile, readDatabaseEnvironment, withDatabase } from "../database/connection.mjs";
import { assertPortAvailable } from "../port-availability.mjs";
import { applicationSessions, setTaskDatabaseConnections } from "./readiness-support.mjs";
import { authEnvironment, authKeys } from "./auth-support.mjs";
import { prepareRbacFixture } from "./rbac-fixture.mjs";
import { assertClientWorkspacePermissionBaseline, clientWorkspacePermissionBaselineSql } from "./client-workspace-permission-baseline.mjs";

test("real administrator CRUD uses JWT/RBAC, atomic writes and non-escalating account policy", { timeout: 55000 }, async t => {
  await assertPortAvailable(3656);
  const parent = join(repositoryRoot, ".artifacts/af-015/http"); mkdirSync(parent, { recursive: true }); const directory = mkdtempSync(join(parent, "run-"));
  const save = (name, data) => writeFileSync(join(directory, name + ".json"), JSON.stringify(data, null, 2) + "\n");
  const protectedPaths = ["apps/api/src/prisma/prisma.service.ts", "apps/api/src/common/guards/jwt-auth.guard.ts", "apps/api/src/auth/auth.service.ts", "apps/api/src/rbac/permissions.service.ts", "apps/api/src/admin/admin-users.service.ts", "apps/api/prisma/schema.prisma", "apps/api/prisma/migrations/20261019000000_initial/migration.sql", ...["dev", "test"].flatMap(mode => [profile(mode).secretFile, profile(mode).stateFile])];
  const hash = path => createHash("sha256").update(readFileSync(path)).digest("hex"), beforeHashes = protectedPaths.map(hash), original = { ...process.env };
  const lease = await createAcceptance("test", "AF-015"); await migrate({ mode: "test", action: "deploy", acceptanceId: lease.id });
  const seeded = await seedDatabase({ mode: "test", acceptanceId: lease.id, generateCredentials: true }), initial = JSON.parse(readFileSync(seeded.credentials.file)), keys = authKeys(lease.id, "AF-015");
  const secrets = [initial.password, keys.secret, ...["dev", "test"].map(mode => readFileSync(profile(mode).secretFile, "utf8").trim())];
  const inputPath = join(repositoryRoot, ".local-data/seed/test", lease.database, "crud-inputs.json"), inputs = { createPassword: "C9-" + randomBytes(24).toString("hex"), resetPassword: "N8-" + randomBytes(24).toString("hex") };
  writeFileSync(inputPath, JSON.stringify(inputs, null, 2) + "\n", { flag: "wx", mode: 0o600 }); secrets.push(...Object.values(inputs));
  const environment = authEnvironment(lease.id, keys.secret, "AF-015"); for (const key of Object.keys(process.env)) delete process.env[key]; Object.assign(process.env, environment);
  const require = createRequire(join(repositoryRoot, "apps/api/package.json")), { JwtService } = require("@nestjs/jwt"), { Prisma } = require("@prisma/client"), bcrypt = require("bcryptjs"), jwt = new JwtService();
  const { createApplication } = require(join(repositoryRoot, "apps/api/dist/bootstrap.js")), { PrismaService } = require(join(repositoryRoot, "apps/api/dist/prisma/prisma.service.js"));
  let app, prisma, rootUser, manager, viewer, managerRole, fixture, accounts, created, createdToken, collision;
  const tokens = {};
  async function request(path, expected, { method = "GET", token, body, raw } = {}) {
    const response = await fetch("http://127.0.0.1:3656/api/" + path, { method, headers: { "x-correlation-id": "af015-real-http-check", ...(token ? { authorization: "Bearer " + token } : {}), ...(body !== undefined || raw !== undefined ? { "content-type": "application/json" } : {}) }, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)), signal: AbortSignal.timeout(10000) });
    assert.ok((Array.isArray(expected) ? expected : [expected]).includes(response.status), "Expected " + expected + " from " + method + " " + path.split("?")[0] + "; got " + response.status);
    assert.equal(response.headers.get("x-correlation-id"), "af015-real-http-check");
    const result = await response.json(); if (result.data?.accessToken) secrets.push(result.data.accessToken);
    const text = JSON.stringify(result); for (const secret of secrets.filter(value => value !== result.data?.accessToken)) assert.ok(!text.includes(secret), "Credential/JWT absent in API response"); assert.ok(!/\$2[aby]\$\d\d\$/.test(text));
    if (path.startsWith("admin/users") && response.status !== 404) assert.equal(response.headers.get("cache-control"), "no-store");
    return { status: response.status, body: result, data: result.data };
  }
  const login = async (username, password, status = 200) => (await request("auth/login", status, { method: "POST", body: { username, password } })).data?.accessToken;
  const create = (username, token = tokens.root, extra = {}) => request("admin/users", 201, { method: "POST", token, body: { username, realName: "AF-015 合成管理员", password: inputs.createPassword, ...extra } });
  function seedCommand(id, flags, expected = 0) {
    const command = ["pnpm", "run", "db:seed", "--", "test", "--acceptance", id, ...flags];
    const child = spawnSync(command[0], command.slice(1), { cwd: repositoryRoot, encoding: "utf8", timeout: 15000, env: { PATH: original.PATH, HOME: original.HOME, NODE_ENV: "test" } });
    for (const secret of secrets) assert.ok(!(child.stdout + child.stderr).includes(secret)); assert.equal(child.status, expected);
    save("seed-command-" + id + "-" + expected + "-" + Date.now(), { command, exitCode: child.status, stdout: child.stdout, stderr: child.stderr });
    return JSON.parse((expected ? child.stderr : child.stdout).split("\n").find(line => line.startsWith("{")));
  }
  try {
    app = await createApplication(); await app.listen(3656, "127.0.0.1"); prisma = app.get(PrismaService);
    await t.test("permission is explicitly registered by protected Seed, never inferred from bootstrap marker", async () => {
      tokens.root = await login(initial.username, initial.password); rootUser = await prisma.sysUser.findUniqueOrThrow({ where: { username: initial.username } });
      await request("admin/users", 403, { token: tokens.root }); assert.equal(await prisma.sysPermission.count(), 1);
      const registered = seedCommand(lease.id, ["--admin-users"]); assert.equal(registered.adminUsers.code, "admin.user.manage"); assert.equal(registered.adminUsers.created, true); assert.equal(registered.adminUsers.grantsReconciled, false);
      await request("admin/users", 200, { token: tokens.root }); assert.equal(await prisma.sysPermission.count(), 2);
      fixture = await prepareRbacFixture(lease.id, "AF-015"); accounts = JSON.parse(readFileSync(fixture.accounts[0].initialPasswordFile)).accounts; accounts.forEach(account => secrets.push(account.password));
      tokens.manager = await login(accounts[0].username, accounts[0].password); tokens.viewer = await login(accounts[1].username, accounts[1].password);
      manager = await prisma.sysUser.findUniqueOrThrow({ where: { username: accounts[0].username } }); viewer = await prisma.sysUser.findUniqueOrThrow({ where: { username: accounts[1].username } }); managerRole = await prisma.sysRole.findUniqueOrThrow({ where: { roleCode: "af015_manager" } });
      save("fixture", { acceptanceId: lease.id, database: lease.database, initialPasswordFile: seeded.credentials.file, fixtureAccountsFile: fixture.accounts[0].initialPasswordFile, inputPath, identities: [rootUser.id, manager.id, viewer.id], passwordOrHashLogged: false });
    });
    await t.test("all seven CRUD entry points reject missing identity and a bootstrap-only reader", async () => {
      const operations = [["admin/users", "GET"], ["admin/users/not-found", "GET"], ["admin/users", "POST", { username: "af015-denied", realName: "AF015", password: inputs.createPassword }], ["admin/users/not-found", "PATCH", { realName: "AF015" }], ["admin/users/not-found/status", "PATCH", { enabled: false }], ["admin/users/not-found/reset-password", "PATCH", { password: inputs.resetPassword }], ["admin/users/not-found", "DELETE"]];
      for (const [path, method, body] of operations) { await request(path, 401, { method, body }); await request(path, 403, { method, body, token: tokens.viewer }); }
      assert.equal(await prisma.sysUser.count({ where: { username: "af015-denied" } }), 0); save("all-routes-guarded", { routes: 7, noIdentity: 401, noManagePermission: 403, writes: 0 });
    });
    await t.test("cross-product JWT and client privilege claims never grant administrator management", async () => {
      for (const [payload, issuer, status] of [[{ sub: rootUser.id }, "qingqi-api", 401], [{ sub: viewer.id, isSuperAdmin: true, permissions: ["admin.user.manage"], roles: ["super_admin"] }, "urn:aij:aij-foundation:test:api", 403]]) {
        const session = await prisma.adminAuthSession.findFirstOrThrow({ where: { userId: payload.sub, revokedAt: null }, orderBy: { issuedAt: "desc" } });
        const token = await jwt.signAsync({ sessionId: session.id, tokenVersion: 0, transport: "bearer", tokenKind: "admin", projectId: "aij-foundation", environment: "test", ...payload }, { secret: keys.secret, issuer, audience: "urn:aij:aij-foundation:test:admin", algorithm: "HS256", expiresIn: 900 }); secrets.push(token);
        await request("admin/users?workspaceId=other", status, { token });
      }
      save("token-isolation", { wrongProduct: 401, forgedPrivilegeClaims: 403 });
    });
    await t.test("create persists bcrypt12, safe profile and usable login without granting a super flag", async () => {
      created = (await create("af015-created", tokens.root, { email: "af015@example.invalid", phone: "synthetic-015" })).data.id;
      const row = await prisma.sysUser.findUniqueOrThrow({ where: { id: created } }); assert.equal(row.isSuperAdmin, false); assert.equal(bcrypt.getRounds(row.passwordHash), 12); assert.ok(await bcrypt.compare(inputs.createPassword, row.passwordHash));
      const detail = await request("admin/users/" + created, 200, { token: tokens.root }); assert.equal(detail.data.username, "af015-created"); assert.deepEqual(detail.data.roleIds, []); assert.ok(!("passwordHash" in detail.data));
      createdToken = await login("af015-created", inputs.createPassword); await request("admin/users", 403, { token: createdToken });
      save("created", { id: created, status: 201, bcryptRounds: 12, login: 200, managementDenied: 403, detail: detail.data });
    });
    await t.test("paginated reads are bounded, filtered and exclude password hashes", async () => {
      const result = await request("admin/users?q=af015-created&page=1&pageSize=1&status=active", 200, { token: tokens.manager }); assert.equal(result.data.items.length, 1); assert.equal(result.data.total, 1); assert.equal(result.data.items[0].id, created);
      for (const query of ["page=0", "pageSize=101", "page=bad", "status=enabled", "unexpected=1"]) await request("admin/users?" + query, 400, { token: tokens.root });
      await request("admin/users/not-found", 404, { token: tokens.root }); await request("admin/users/bad.id", 400, { token: tokens.root }); save("pagination", result.data);
    });
    await t.test("profile update clears nullable fields; unknown privileged and immutable fields are rejected", async () => {
      await request("admin/users/" + created, 200, { method: "PATCH", token: tokens.root, body: { realName: "AF015 changed", email: null, phone: null } });
      const detail = (await request("admin/users/" + created, 200, { token: tokens.root })).data; assert.equal(detail.realName, "AF015 changed"); assert.equal(detail.email, null); assert.equal(detail.phone, null);
      for (const body of [{}, { realName: null }, { isSuperAdmin: true }, { passwordHash: "not-a-hash" }, { username: "renamed" }, { password: inputs.resetPassword }, { status: "disabled" }, { roles: ["super_admin"] }]) await request("admin/users/" + created, 400, { method: "PATCH", token: tokens.root, body });
      await request("admin/users", 400, { method: "POST", token: tokens.root, body: { username: "af015-escalation", realName: "AF015", password: inputs.createPassword, isSuperAdmin: true } });
      save("strict-update", { safe: detail, overpostingRejected: true });
    });
    await t.test("missing/weak/template/truncated passwords and malformed JSON fail without credential echoes", async () => {
      const before = (await prisma.sysUser.findUniqueOrThrow({ where: { id: created } })).passwordHash;
      for (const password of [undefined, "", "weak", "ChangeMe-Template-123456789!", "a".repeat(32), "T7-" + "x".repeat(70), "T7-" + "密".repeat(24), "T7-" + "x".repeat(24) + "\n"]) {
        await request("admin/users", 400, { method: "POST", token: tokens.root, body: { username: "af015-invalid", realName: "AF015", password } });
        await request("admin/users/" + created + "/reset-password", 400, { method: "PATCH", token: tokens.root, body: { password } });
      }
      await request("admin/users", 400, { method: "POST", token: tokens.root, raw: '{"password":"' + inputs.createPassword + '" invalid-json' });
      assert.ok((await prisma.sysUser.findUniqueOrThrow({ where: { id: created } })).passwordHash === before); assert.equal(await prisma.sysUser.count({ where: { username: "af015-invalid" } }), 0); save("invalid-passwords", { cases: 8, status: 400, hashUnchanged: true, rawInputEchoed: false });
    });
    await t.test("role selection is validated before mutation and cannot leave partial profile or assignments", async () => {
      for (const roleIds of [null, [123], [managerRole.id, managerRole.id], ["unknown-role"]]) await request("admin/users/" + created, 400, { method: "PATCH", token: tokens.root, body: { realName: "must-not-persist", roleIds } });
      for (const data of [{ status: "disabled" }, { deletedAt: new Date() }]) {
        await prisma.sysRole.update({ where: { id: managerRole.id }, data });
        try { await request("admin/users/" + created, 400, { method: "PATCH", token: tokens.root, body: { roleIds: [managerRole.id] } }); }
        finally { await prisma.sysRole.update({ where: { id: managerRole.id }, data: { status: "active", deletedAt: null } }); }
      }
      const detail = (await request("admin/users/" + created, 200, { token: tokens.root })).data; assert.equal(detail.realName, "AF015 changed"); assert.deepEqual(detail.roleIds, []); save("role-validation", { invalidSelection: 400, profileAndLinksUnchanged: true });
    });
    await t.test("super-admin role binding and clearing take effect immediately for an existing JWT", async () => {
      await request("admin/users/" + created, 200, { method: "PATCH", token: tokens.root, body: { roleIds: [managerRole.id] } }); await request("admin/users", 200, { token: createdToken });
      await request("admin/users/" + created, 200, { method: "PATCH", token: tokens.root, body: { roleIds: [] } }); await request("admin/users", 403, { token: createdToken });
      save("role-binding", { sameJwtGranted: 200, sameJwtRevoked: 403 });
    });
    await t.test("ordinary manager can CRUD a non-super user but cannot assign roles or mutate a super administrator", async () => {
      const id = (await create("af015-managed", tokens.manager)).data.id;
      await request("admin/users/" + id, 200, { method: "PATCH", token: tokens.manager, body: { realName: "AF015 managed" } });
      await request("admin/users/" + id + "/status", 200, { method: "PATCH", token: tokens.manager, body: { enabled: false } });
      await request("admin/users/" + id + "/status", 200, { method: "PATCH", token: tokens.manager, body: { enabled: true } });
      await request("admin/users/" + id + "/reset-password", 200, { method: "PATCH", token: tokens.manager, body: { password: inputs.resetPassword } });
      for (const [path, body] of [["admin/users/" + manager.id, { roleIds: [] }], ["admin/users/" + rootUser.id, { realName: "must-not-change" }], ["admin/users/" + rootUser.id + "/status", { enabled: false }], ["admin/users/" + rootUser.id + "/reset-password", { password: inputs.resetPassword }]]) await request(path, 403, { method: "PATCH", token: tokens.manager, body });
      await request("admin/users", 403, { method: "POST", token: tokens.manager, body: { username: "af015-role-denied", realName: "AF015", password: inputs.createPassword, roleIds: [managerRole.id] } });
      await request("admin/users/" + rootUser.id, 403, { method: "DELETE", token: tokens.manager });
      await request("admin/users/" + id, 200, { method: "DELETE", token: tokens.manager }); assert.equal(await prisma.sysUser.count({ where: { username: "af015-role-denied" } }), 0);
      save("manager-boundary", { nonSuperCrud: true, roleAssignment: 403, superTargetMutation: 403 });
    });
    await t.test("status transitions revoke old sessions permanently; reenable permits a new login", async () => {
      await request("admin/users/" + created + "/status", 400, { method: "PATCH", token: tokens.root, body: { enabled: "false" } });
      await request("admin/users/" + created + "/status", 200, { method: "PATCH", token: tokens.root, body: { enabled: false } }); await request("auth/me", 401, { token: createdToken }); await login("af015-created", inputs.createPassword, 401);
      await request("admin/users/" + created + "/status", 200, { method: "PATCH", token: tokens.root, body: { enabled: true } }); await request("auth/me", 401, { token: createdToken });
      createdToken = await login("af015-created", inputs.createPassword); await request("auth/me", 200, { token: createdToken });
      save("status", { disabledOldJwt: 401, disabledLogin: 401, reenabledOldJwt: 401, freshLogin: 200 });
    });
    await t.test("password reset changes actual bcrypt hash; old password fails and new password succeeds", async () => {
      await request("admin/users/" + created + "/reset-password", 200, { method: "PATCH", token: tokens.root, body: { password: inputs.resetPassword } });
      await login("af015-created", inputs.createPassword, 401); await request("auth/me", 401, { token: createdToken }); createdToken = await login("af015-created", inputs.resetPassword, 200);
      const row = await prisma.sysUser.findUniqueOrThrow({ where: { id: created } }); assert.equal(bcrypt.getRounds(row.passwordHash), 12); assert.ok(await bcrypt.compare(inputs.resetPassword, row.passwordHash));
      await request("auth/me", 200, { token: createdToken }); save("reset", { oldPassword: 401, newPassword: 200, bcryptRounds: 12, revokedOldJwt: 401, freshSession: 200 });
    });
    await t.test("self-disable/delete/reset are rejected and at least one active super administrator remains", async () => {
      await request("admin/users/" + rootUser.id + "/status", 409, { method: "PATCH", token: tokens.root, body: { enabled: false } });
      await request("admin/users/" + rootUser.id, 409, { method: "DELETE", token: tokens.root });
      await request("admin/users/" + rootUser.id + "/reset-password", 409, { method: "PATCH", token: tokens.root, body: { password: inputs.resetPassword } });
      assert.equal(await prisma.sysUser.count({ where: { isSuperAdmin: true, status: "active", deletedAt: null } }), 1); await request("admin/users", 200, { token: tokens.root }); save("self-protection", { disable: 409, delete: 409, selfReset: 409, activeSupers: 1 });
    });
    await t.test("concurrent super-administrator disabling preserves the lockout invariant using fresh transactional authorization", async () => {
      const id = (await create("af015-super-probe")).data.id;
      await prisma.sysUser.update({ where: { id }, data: { isSuperAdmin: true } }); const token = await login("af015-super-probe", inputs.createPassword);
      try {
        const responses = await Promise.all([request("admin/users/" + id + "/status", [200, 401, 403, 409], { method: "PATCH", token: tokens.root, body: { enabled: false } }), request("admin/users/" + rootUser.id + "/status", [200, 401, 403, 409], { method: "PATCH", token, body: { enabled: false } })]);
        assert.equal(responses.filter(r => r.status === 200).length, 1); assert.equal(await prisma.sysUser.count({ where: { isSuperAdmin: true, status: "active", deletedAt: null } }), 1); save("concurrency", { statuses: responses.map(r => r.status), activeSupers: 1 });
      } finally { await prisma.sysUser.update({ where: { id: rootUser.id }, data: { status: "active" } }); await prisma.sysUser.update({ where: { id }, data: { status: "active", isSuperAdmin: false } }); tokens.root = await login(initial.username, initial.password); }
    });
    await t.test("username uniqueness includes soft-deleted rows and concurrent duplicates never partially create", async () => {
      const body = { username: "af015-race", realName: "AF015 race", password: inputs.createPassword };
      const responses = await Promise.all([1, 2].map(() => request("admin/users", [201, 409], { method: "POST", token: tokens.root, body })));
      assert.deepEqual(responses.map(r => r.status).sort(), [201, 409]); assert.equal(await prisma.sysUser.count({ where: { username: body.username } }), 1);
      const id = (await prisma.sysUser.findUniqueOrThrow({ where: { username: body.username } })).id; assert.equal(await prisma.auditLog.count({ where: { module: "admin-users", action: "created", resourceId: id } }), 1);
      save("uniqueness", { statuses: responses.map(r => r.status), rows: 1, successfulCreateAudits: 1 });
    });
    await t.test("capability Seed repeat preserves inactive definitions, revoked grants and all existing credentials", async () => {
      const permission = await prisma.sysPermission.findUniqueOrThrow({ where: { permissionCode: "admin.user.manage" } }), link = await prisma.sysRolePermission.findUniqueOrThrow({ where: { roleId_permissionId: { roleId: managerRole.id, permissionId: permission.id } } });
      await prisma.sysPermission.update({ where: { id: permission.id }, data: { status: "disabled" } }); await prisma.sysRolePermission.delete({ where: { id: link.id } });
      const credentialHashes = [seeded.credentials.file, fixture.accounts[0].initialPasswordFile].map(hash), before = JSON.stringify(await prisma.sysUser.findMany({ orderBy: { id: "asc" } }));
      try { const result = seedCommand(lease.id, ["--admin-users"]); assert.equal(result.adminUsers.created, false); assert.equal((await prisma.sysPermission.findUniqueOrThrow({ where: { id: permission.id } })).status, "disabled"); assert.equal(await prisma.sysRolePermission.count({ where: { id: link.id } }), 0); assert.ok(JSON.stringify(await prisma.sysUser.findMany({ orderBy: { id: "asc" } })) === before); assert.deepEqual([seeded.credentials.file, fixture.accounts[0].initialPasswordFile].map(hash), credentialHashes); await request("admin/users", 403, { token: tokens.root }); }
      finally { await prisma.sysPermission.update({ where: { id: permission.id }, data: { status: "active" } }); await prisma.sysRolePermission.create({ data: link }); }
      save("seed-preserved", { definitionNotReenabled: true, grantNotRepaired: true, passwordsAndFilesUnchanged: true });
    });
    await t.test("foreign permission namespace makes the whole new-target Seed roll back before account/password creation", async () => {
      collision = await createAcceptance("test", "AF-015"); await migrate({ mode: "test", action: "deploy", acceptanceId: collision.id });
      const query = op => withDatabase("test", readDatabaseEnvironment("test", process.env, collision.id), op, { acceptanceId: collision.id });
      await query(client => client.query("INSERT INTO public.sys_permission (id,permission_code,permission_name,resource_type,module,action,updated_at) VALUES ('af015-foreign','admin.user.manage','AF015 collision','data','foreign','read',CURRENT_TIMESTAMP)"));
      const result = seedCommand(collision.id, ["--admin-users", "--generate-credentials"], 2); assert.equal(result.code, "PERMISSION_NAMESPACE_OCCUPIED");
      await query(async client => { for (const table of ["sys_user", "sys_role", "project_profile", "organization_profile"]) assert.equal((await client.query('SELECT count(*)::int AS count FROM public."' + table + '"')).rows[0].count, 0); assert.equal((await client.query("SELECT count(*)::int AS count FROM public.sys_permission")).rows[0].count, 1); });
      assert.ok(!existsSync(join(repositoryRoot, ".local-data/seed/test", collision.database, "initial-admin.json"))); save("seed-collision", { database: collision.database, wholeTransactionRolledBack: true, initialFileCreated: false });
    });
    await t.test("real own database outage fails reads and writes closed, liveness stays up and recovery restores CRUD", async () => {
      await prisma.$disconnect(); assert.deepEqual(await applicationSessions(lease.id, "AF-015"), []); await setTaskDatabaseConnections(lease.id, false, "AF-015");
      try { await request("admin/users", 503, { token: tokens.root }); await request("admin/users/" + created, 503, { method: "PATCH", token: tokens.root, body: { realName: "unavailable" } }); await request("health", 200); }
      finally { await setTaskDatabaseConnections(lease.id, true, "AF-015"); }
      await request("ready", 200); await request("admin/users/" + created, 200, { method: "PATCH", token: tokens.root, body: { realName: "AF015 recovered" } }); save("outage", { reads: 503, writes: 503, live: 200, recovered: 200 });
    });
    await t.test("soft deletion keeps a tombstone/links, hides reads and immediately rejects login and old JWT", async () => {
      const result = await request("admin/users/" + created, 200, { method: "DELETE", token: tokens.root }); assert.equal(result.data.deleted, true);
      const row = await prisma.sysUser.findUniqueOrThrow({ where: { id: created } }); assert.ok(row.deletedAt); assert.equal(row.status, "disabled");
      await request("admin/users/" + created, 404, { token: tokens.root }); await request("admin/users/" + created, 404, { method: "DELETE", token: tokens.root }); await login("af015-created", inputs.resetPassword, 401); await request("auth/me", 401, { token: createdToken });
      await request("admin/users", 409, { method: "POST", token: tokens.root, body: { username: "af015-created", realName: "AF015 reused", password: inputs.createPassword } }); assert.equal((await request("admin/users?q=af015-created", 200, { token: tokens.root })).data.total, 0);
      save("deleted", { tombstoneRetained: true, get: 404, repeatedDelete: 404, login: 401, jwt: 401, reservedUsername: 409 });
    });
    await t.test("successful mutations persist minimal audit records and unrelated tables stay empty", async () => {
      const rows = await prisma.auditLog.findMany({ where: { module: "admin-users" } }); const actions = new Set(rows.map(row => row.action));
      for (const action of ["created", "updated", "enabled", "disabled", "password_reset", "deleted"]) assert.ok(actions.has(action));
      assert.ok(rows.every(row => row.status === "success" && row.requestSummary.correlationId === "af015-real-http-check"));
      const text = JSON.stringify(rows); for (const secret of secrets) assert.ok(!text.includes(secret)); assert.ok(!/\$2[aby]\$\d\d\$/.test(text)); assert.ok(!text.includes("af015@example.invalid"));
      assertClientWorkspacePermissionBaseline(await prisma.$queryRawUnsafe(clientWorkspacePermissionBaselineSql));
      for (const model of Prisma.dmmf.datamodel.models) {
        if (model.name === "ClientWorkspacePermission") continue; // Exact catalog assertion above; all other business tables stay empty.
        if (!["SysUser", "SysRole", "SysPermission", "SysUserRole", "SysRolePermission", "ProjectProfile", "OrganizationProfile", "AuditLog", "AdminAuthSession"].includes(model.name)) assert.equal((await prisma.$queryRawUnsafe('SELECT count(*)::int AS count FROM public."' + model.dbName + '"'))[0].count, 0, model.name + " must remain empty");
      }
      save("audit", { rows: rows.length, actions: [...actions].sort(), atomicSuccessAuditsPresent: true, noSecretsOrProfileValues: true, unrelatedTablesEmpty: true });
    });
    await t.test("shutdown closes the pool and Auth disabled leaves all administrator routes unavailable", async () => {
      await app.close(); app = undefined; assert.deepEqual(await applicationSessions(lease.id, "AF-015"), []);
      process.env.AUTH_ENABLED = "false"; process.env.DATABASE_ENABLED = "false"; process.env.JWT_SECRET = "template";
      app = await createApplication(); await app.listen(3656, "127.0.0.1"); await request("admin/users", 404); await app.close(); app = undefined;
      assert.deepEqual(await applicationSessions(lease.id, "AF-015"), []); assert.deepEqual(protectedPaths.map(hash), beforeHashes);
      for (const name of readdirSync(directory).filter(name => name.endsWith(".json") && !name.startsWith("._"))) { const text = readFileSync(join(directory, name), "utf8"); for (const secret of secrets) assert.ok(!text.includes(secret)); }
      save("result", { database: lease.database, acceptanceId: lease.id, collisionDatabase: collision.database, pool: 0, credentialsAndFullTokensLogged: false, noSourceProbeOrSharedDbReset: true });
    });
  } finally {
    if (app) await app.close(); await setTaskDatabaseConnections(lease.id, true, "AF-015");
    for (const key of Object.keys(process.env)) delete process.env[key]; Object.assign(process.env, original);
  }
});
