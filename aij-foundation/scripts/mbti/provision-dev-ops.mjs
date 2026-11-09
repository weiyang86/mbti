// Development-only trusted bootstrap; login and authorization stay with Foundation.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, lstatSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import runtimeEnvironment from "../runtime-environment.cjs";
import adminPolicy from "../admin-policy.cjs";

const sourceRoot = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), "../.."));
const require = createRequire(resolve(sourceRoot, "apps/api/package.json"));
const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

function privateFile(path) {
  const info = lstatSync(path);
  assert.ok(info.isFile() && !info.isSymbolicLink() && !(info.mode & 0o077), "Expected private regular file");
}

async function main() {
  assert.equal(process.argv.length, 2, "This command only provisions the dedicated development environment");
  assert.ok(!process.env.MBTI_F3_TEST_FIXTURE && !process.env.MBTI_F3_TEST_PAYMENT_SECRET, "No controlled payment fixture allowed");
  const ownerRoot = realpathSync(process.env.MBTI_LOCAL_OWNER_ROOT || sourceRoot);
  const check = spawnSync(process.execPath, [resolve(sourceRoot, "scripts/mbti-local.mjs"), "check", "dev"], { env: process.env, encoding: "utf8" });
  assert.equal(check.status, 0, "Same-repository, container and live development ownership check required");
  const directory = resolve(ownerRoot, ".local-data/mbti-foundation/development");
  const envPath = resolve(directory, ".env");
  privateFile(envPath);
  const original = readFileSync(envPath, "utf8");
  const env = parseEnv(original);
  assert.equal(env.PROJECT_ID, "mbti-foundation");
  assert.equal(env.RUNTIME_PROFILE, "project");
  assert.equal(env.APP_ENV, "development");
  assert.equal(env.NODE_ENV, "development");
  assert.equal(env.AIJ_PROJECT_ROOT, ownerRoot);
  assert.ok(!env.MBTI_F3_TEST_PAYMENT_SECRET && !env.MBTI_F3_TEST_FIXTURE);
  assert.deepEqual(runtimeEnvironment.resolveRuntimeEnvironment(env).databaseTarget,
    { host: "127.0.0.1", port: 55436, database: "mbti_foundation_development", user: "mbti_foundation_development" });
  const jwtSecret = env.JWT_SECRET || randomBytes(48).toString("hex");
  assert.ok(jwtSecret.length >= 32, "Existing nonempty weak JWT secret requires explicit operator repair");
  runtimeEnvironment.resolveRuntimeEnvironment({ ...env, AUTH_ENABLED: "true", JWT_SECRET: jwtSecret });
  const credentialPath = resolve(directory, "operations-account.json");
  let credentials;
  if (existsSync(credentialPath)) {
    privateFile(credentialPath);
    credentials = JSON.parse(readFileSync(credentialPath, "utf8"));
  } else {
    credentials = { project: "mbti-foundation", environment: "development", ownerRoot,
      roleId: "mbti-dev-ops-" + randomUUID(), roleCode: "mbti_dev_orders_" + randomBytes(8).toString("hex"),
      users: ["ops", "denied_probe"].map(kind => ({ kind, id: "mbti-dev-" + randomUUID(),
        username: "mbti_dev_" + kind + "_" + randomBytes(8).toString("hex"), password: "Mbti-Dev-" + randomBytes(24).toString("base64url") })) };
    writeFileSync(credentialPath, JSON.stringify(credentials), { mode: 0o600, flag: "wx" });
  }
  assert.equal(credentials.project, "mbti-foundation");
  assert.equal(credentials.environment, "development");
  assert.equal(credentials.ownerRoot, ownerRoot);
  assert.deepEqual(credentials.users.map(user => user.kind), ["ops", "denied_probe"]);
  for (const user of credentials.users) assert.ok(adminPolicy.isAdminPassword(user.password));
  const hashes = await Promise.all(credentials.users.map(user => bcrypt.hash(user.password, adminPolicy.ADMIN_PASSWORD_COST)));
  const prisma = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
  try {
    await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('mbti-development-ops-bootstrap'))`;
      const identity = (await tx.$queryRaw`SELECT current_database() AS db,current_user AS role`)[0];
      assert.deepEqual(identity, { db: "mbti_foundation_development", role: "mbti_foundation_development" });
      const marker = (await tx.$queryRaw`SELECT project,environment,root FROM mbti_local_control."_mbti_project_identity" WHERE singleton=true`)[0];
      assert.deepEqual(marker, { project: "mbti-foundation", environment: "development", root: ownerRoot });
      const permission = await tx.sysPermission.findUniqueOrThrow({ where: { permissionCode: "mbti:orders:read" } });
      assert.equal(permission.status, "active");
      const foundRole = await tx.sysRole.findUnique({ where: { id: credentials.roleId }, include: { permissions: true, userRoles: true } });
      if (foundRole) {
        assert.equal(foundRole.roleCode, credentials.roleCode);
        assert.equal(foundRole.status, "active");
        assert.equal(foundRole.deletedAt, null);
        assert.deepEqual(foundRole.permissions.map(item => item.permissionId), [permission.id]);
        assert.ok(foundRole.userRoles.every(item => item.userId === credentials.users[0].id), "Role was adopted by another user");
      } else {
        await tx.sysRole.create({ data: { id: credentials.roleId, roleCode: credentials.roleCode,
          roleName: "MBTI development order read", permissions: { create: { permissionId: permission.id } } } });
      }
      for (const [index, user] of credentials.users.entries()) {
        const found = await tx.sysUser.findUnique({ where: { id: user.id }, include: { userRoles: true } });
        if (found) {
          assert.equal(found.username, user.username);
          assert.equal(found.isSuperAdmin, false);
          assert.equal(found.status, "active");
          assert.equal(found.deletedAt, null);
          assert.ok(await bcrypt.compare(user.password, found.passwordHash), "Existing credentials changed; refuse reset");
          assert.deepEqual(found.userRoles.map(item => item.roleId), user.kind === "ops" ? [credentials.roleId] : []);
        } else {
          await tx.sysUser.create({ data: { id: user.id, username: user.username, passwordHash: hashes[index],
            realName: user.kind === "ops" ? "MBTI development operations" : "MBTI development access check", isSuperAdmin: false,
            ...(user.kind === "ops" ? { userRoles: { create: { roleId: credentials.roleId } } } : {}) } });
        }
      }
      await tx.auditLog.create({ data: { module: "mbti", action: "development_ops_provisioned", status: "success",
        resourceType: "admin-role", resourceId: credentials.roleId, path: "local:mbti/provision-dev-ops",
        method: "BOOTSTRAP", requestSummary: { project: "mbti-foundation", environment: "development", permission: "mbti:orders:read" } } });
    }, { timeout: 10000 });
  } finally { await prisma.$disconnect(); }
  let updated = original;
  for (const [key, value] of Object.entries({ AUTH_ENABLED: "true", JWT_SECRET: jwtSecret })) {
    const lines = updated.split("\n");
    const positions = lines.flatMap((line, index) => line.startsWith(key + "=") ? [index] : []);
    assert.ok(positions.length <= 1, "Ambiguous environment key");
    if (positions.length) lines[positions[0]] = key + "=" + value;
    else lines.push(key + "=" + value);
    updated = lines.join("\n");
  }
  const temporary = envPath + ".ops-" + randomBytes(8).toString("hex");
  writeFileSync(temporary, updated, { mode: 0o600, flag: "wx" });
  renameSync(temporary, envPath);
  console.log("PASS dedicated development operations provisioned: non-superadmin read-only role; denied probe has no roles; no payment fixture enabled");
  console.log("Credentials remain in owner development/operations-account.json (0600); restart the owned API to enable Foundation Auth");
}

main().catch(() => { console.error("MBTI development operations provisioning failed; check dedicated target, migration and local ownership (secrets suppressed)"); process.exitCode = 1; });
