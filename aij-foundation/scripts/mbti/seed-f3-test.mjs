// Random Foundation Auth/RBAC test identities only. Credentials are never printed.
import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, existsSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { root, fixturePath, testContext } from "./test-context.mjs";
const require = createRequire(resolve(root, "apps/api/package.json"));
const { PrismaClient } = require("@prisma/client"); const bcrypt = require("bcryptjs");
const { db, env } = await testContext();
const prisma = new PrismaClient({ datasources: { db: { url: env.TEST_DATABASE_URL } } });
try {
  let fixture;
  if (existsSync(fixturePath)) fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
  else {
    fixture = { project: "mbti-foundation", environment: "test", root, jwtSecret: randomBytes(48).toString("hex"), paymentSecret: randomBytes(48).toString("hex"),
      users: ["ops", "no_permission", "payment_tester"].map(kind => ({ kind, id: "mbti-f3-" + randomUUID(), username: "mbti_f3_" + kind + "_" + randomBytes(8).toString("hex"), password: "Mbti-F3-" + randomBytes(24).toString("base64url") })) };
    mkdirSync(dirname(fixturePath), { recursive: true, mode: 0o700 }); writeFileSync(fixturePath, JSON.stringify(fixture), { mode: 0o600, flag: "wx" });
  }
  assert.equal(fixture.root, root); assert.equal(fixture.project, "mbti-foundation"); assert.equal(fixture.environment, "test"); chmodSync(fixturePath, 0o600);
  const org = await prisma.organizationProfile.upsert({ where: { code: "mbti-foundation-test-fixture" }, create: { code: "mbti-foundation-test-fixture", name: "MBTI controlled test fixtures" }, update: {} });
  const existing = await prisma.projectProfile.findUnique({ where: { code: "mbti-foundation-test" } }); if (existing) assert.equal(existing.environment, "test");
  await prisma.projectProfile.upsert({ where: { code: "mbti-foundation-test" }, create: { organizationId: org.id, code: "mbti-foundation-test", name: "MBTI test", environment: "test" }, update: {} });
  await prisma.memberUser.upsert({ where: { id: "mbti-f3-controlled-payment-creator" }, create: { id: "mbti-f3-controlled-payment-creator", nickname: "Controlled payment fixture" }, update: {} });
  await prisma.clientWorkspace.upsert({ where: { id: "mbti-f3-controlled-payment-workspace" }, create: { id: "mbti-f3-controlled-payment-workspace", code: "mbti-f3-controlled-payment-workspace", name: "MBTI controlled payment fixtures", createdByMemberId: "mbti-f3-controlled-payment-creator", creationIdempotencyKey: "mbti-f3-controlled-payment-workspace" }, update: {} });
  await prisma.clientWorkspaceRole.upsert({ where: { id: "mbti-f3-controlled-payment-role" }, create: { id: "mbti-f3-controlled-payment-role", workspaceId: "mbti-f3-controlled-payment-workspace", code: "controlled-test", name: "Controlled fixture" }, update: {} });
  const read = await prisma.sysPermission.findUniqueOrThrow({ where: { permissionCode: "mbti:orders:read" } });
  const pay = await prisma.sysPermission.upsert({ where: { permissionCode: "mbti:payments:test" }, create: { permissionCode: "mbti:payments:test", permissionName: "MBTI controlled payment testing only", resourceType: "api", module: "mbti", action: "test", apiPath: "/api/admin/mbti/test-payments/:id" }, update: {} });
  for (const user of fixture.users) {
    const found = await prisma.sysUser.findUnique({ where: { id: user.id } }); if (found) { assert.equal(found.username, user.username); assert.equal(found.isSuperAdmin, false); }
    await prisma.sysUser.upsert({ where: { id: user.id }, create: { id: user.id, username: user.username, passwordHash: await bcrypt.hash(user.password, 12), realName: "MBTI F3 " + user.kind, isSuperAdmin: false }, update: {} });
    const role = await prisma.sysRole.upsert({ where: { roleCode: "mbti-f3-" + user.kind }, create: { roleCode: "mbti-f3-" + user.kind, roleName: "MBTI F3 " + user.kind }, update: {} });
    await prisma.sysUserRole.upsert({ where: { userId_roleId: { userId: user.id, roleId: role.id } }, create: { userId: user.id, roleId: role.id }, update: {} });
    for (const permission of user.kind === "ops" ? [read] : user.kind === "payment_tester" ? [read, pay] : []) await prisma.sysRolePermission.upsert({ where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } }, create: { roleId: role.id, permissionId: permission.id }, update: {} });
  }
  console.log("PASS F3 test-only Foundation identities/roles seeded; random credentials stay in ignored 0600 fixture, no super-admin or shared ops token");
} finally { await prisma.$disconnect(); await db.end(); }
