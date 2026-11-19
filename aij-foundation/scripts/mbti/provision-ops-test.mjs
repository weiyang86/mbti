// Four non-superadmin B1 principals for the explicitly isolated MBTI test DB.
// Usage: MBTI_LOCAL_OWNER_ROOT=/abs/same-repo-owner node scripts/mbti/provision-ops-test.mjs
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { spawnSync } from 'node:child_process';
import runtimeEnvironment from '../runtime-environment.cjs';
import adminPolicy from '../admin-policy.cjs';
import { grants, roles } from './ops-policy.cjs';

const source = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '../..'));
const owner = realpathSync(process.env.MBTI_LOCAL_OWNER_ROOT || source);
const run = (cmd, args, cwd) => {
  const result = spawnSync(cmd, args, { cwd, encoding: 'utf8', env: process.env });
  assert.equal(result.status, 0, `${cmd} ${args.join(' ')} ownership check failed`);
  return result.stdout.trim();
};
function commonGit(root) {
  return realpathSync(run('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], root));
}
assert.equal(commonGit(owner), commonGit(source), 'Owner must be a worktree in this MBTI repository');
assert.equal(JSON.parse(readFileSync(resolve(owner, 'package.json'), 'utf8')).name, 'mbti-foundation');
run(process.execPath, [resolve(source, 'scripts/mbti-local.mjs'), 'check', 'test'], source);

const ownerData = resolve(owner, '.local-data/mbti-foundation/test');
const envPath = resolve(ownerData, '.env');
const envInfo = lstatSync(envPath);
assert.ok(envInfo.isFile() && !envInfo.isSymbolicLink() && !(envInfo.mode & 0o077), 'Test environment must be a private regular file');
const env = parseEnv(readFileSync(envPath, 'utf8'));
assert.equal(env.PROJECT_ID, 'mbti-foundation'); assert.equal(env.RUNTIME_PROFILE, 'project');
assert.equal(env.APP_ENV, 'test'); assert.equal(env.NODE_ENV, 'test'); assert.equal(env.AIJ_PROJECT_ROOT, owner);
const runtime = runtimeEnvironment.resolveRuntimeEnvironment(env);
assert.deepEqual(runtime.databaseTarget, { host: '127.0.0.1', port: 55437, database: 'mbti_foundation_test', user: 'mbti_foundation_test' });
assert.ok(!env.MBTI_F3_TEST_PAYMENT_SECRET && !env.MBTI_F3_TEST_FIXTURE, 'No payment fixture in B1 role test');

const localData = resolve(source, '../admin/.local-data');
mkdirSync(localData, { recursive: true, mode: 0o700 });
const credentialFile = resolve(localData, 'test-operations-accounts.json');
let saved;
if (existsSync(credentialFile)) {
  const info = lstatSync(credentialFile);
  assert.ok(info.isFile() && !info.isSymbolicLink() && !(info.mode & 0o077), 'Credentials must stay in a mode 0600 file');
  saved = JSON.parse(readFileSync(credentialFile, 'utf8'));
} else {
  saved = { project: 'mbti-foundation', environment: 'test', owner,
    roles: Object.fromEntries(Object.keys(roles).map(role => [role, { id: `mbti-test-${role}-${randomUUID()}`, code: `mbti_b1_${role}_${randomBytes(5).toString('hex')}` }])),
    jwtSecret: randomBytes(48).toString('hex'),
    users: Object.keys(roles).map(role => ({ role, id: `mbti-test-${role}-${randomUUID()}`, username: `mbti_b1_${role}_${randomBytes(5).toString('hex')}`, password: `Mbt!${randomBytes(27).toString('base64url')}` })) };
  writeFileSync(credentialFile, JSON.stringify(saved, null, 2), { mode: 0o600, flag: 'wx' });
}
assert.equal(saved.owner, owner); assert.equal(saved.environment, 'test');
assert.match(saved.jwtSecret, /^[a-f0-9]{96}$/);
assert.deepEqual(saved.users.map(user => user.role), Object.keys(roles));
for (const user of saved.users) assert.ok(adminPolicy.isAdminPassword(user.password));

const require = createRequire(resolve(source, 'apps/api/package.json'));
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const hashes = await Promise.all(saved.users.map(user => bcrypt.hash(user.password, adminPolicy.ADMIN_PASSWORD_COST)));
const prisma = new PrismaClient({ datasources: { db: { url: env.TEST_DATABASE_URL } } });
try {
  await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('aij-admin-users-write'))`;
    const identity = (await tx.$queryRaw`SELECT current_database() AS db,current_user AS role`)[0];
    assert.deepEqual(identity, { db: 'mbti_foundation_test', role: 'mbti_foundation_test' });
    const marker = (await tx.$queryRaw`SELECT project,environment,root FROM mbti_local_control."_mbti_project_identity" WHERE singleton=true`)[0];
    assert.deepEqual(marker, { project: 'mbti-foundation', environment: 'test', root: owner });
    const permissionRows = new Map();
    for (const [key, code] of Object.entries(grants)) {
      let permission = await tx.sysPermission.findUnique({ where: { permissionCode: code } });
      if (permission) {
        assert.equal(permission.status, 'active'); assert.equal(permission.resourceType, 'api');
        assert.equal(permission.module, 'mbti-ops'); assert.equal(permission.action, key);
      } else permission = await tx.sysPermission.create({ data: { permissionCode: code, permissionName: `MBTI ops ${key}`, resourceType: 'api', module: 'mbti-ops', action: key, apiPath: '/api/admin/mbti/ops/*' } });
      permissionRows.set(code, permission);
    }
    for (const role of Object.keys(roles)) {
      const savedRole = saved.roles[role];
      let row = await tx.sysRole.findUnique({ where: { id: savedRole.id }, include: { permissions: true, userRoles: true } });
      if (row) {
        assert.equal(row.roleCode, savedRole.code); assert.equal(row.status, 'active'); assert.equal(row.deletedAt, null);
        assert.deepEqual(row.permissions.map(link => link.permissionId).sort(), roles[role].map(code => permissionRows.get(code).id).sort());
        assert.ok(row.userRoles.every(link => saved.users.some(user => user.role === role && user.id === link.userId)));
      } else row = await tx.sysRole.create({ data: { id: savedRole.id, roleCode: savedRole.code, roleName: `MBTI ${role} B1`, permissions: { create: roles[role].map(code => ({ permissionId: permissionRows.get(code).id })) } } });
    }
    for (const [index, user] of saved.users.entries()) {
      const roleId = saved.roles[user.role].id;
      const row = await tx.sysUser.findUnique({ where: { id: user.id }, include: { userRoles: true } });
      if (row) {
        assert.equal(row.username, user.username); assert.equal(row.status, 'active'); assert.equal(row.isSuperAdmin, false);
        assert.equal(row.deletedAt, null); assert.ok(await bcrypt.compare(user.password, row.passwordHash));
        assert.deepEqual(row.userRoles.map(link => link.roleId), [roleId]);
      } else await tx.sysUser.create({ data: { id: user.id, username: user.username, passwordHash: hashes[index], realName: `MBTI ${user.role}`, isSuperAdmin: false, userRoles: { create: { roleId } } } });
    }
    await tx.auditLog.create({ data: { module: 'mbti', action: 'b1_test_roles_provisioned', status: 'success', resourceType: 'admin-role', path: 'local:mbti/provision-ops-test', method: 'BOOTSTRAP', requestSummary: { project: 'mbti-foundation', environment: 'test', roles: Object.keys(roles) } } });
  }, { timeout: 15000 });
} finally { await prisma.$disconnect(); }
console.log(`PASS four non-superadmin B1 roles provisioned and retained in ${credentialFile} (0600)`);
