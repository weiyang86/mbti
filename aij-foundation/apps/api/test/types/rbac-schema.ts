import type { Prisma, ResourceType, UserStatus } from '@prisma/client';

// Compile generated public types; these values are never executed or persisted.
export const user: Prisma.SysUserCreateInput = {
  username: 'af006-type-fixture', realName: 'Synthetic administrator', passwordHash: 'type-only-hash',
  status: 'active', userRoles: { create: { role: { connect: { roleCode: 'synthetic-reader' } } } },
};
export const assignment: Prisma.SysRolePermissionWhereUniqueInput = {
  roleId_permissionId: { roleId: 'synthetic-role', permissionId: 'synthetic-permission' },
};
export const menu: Prisma.SysRoleMenuWhereUniqueInput = {
  roleId_menuId: { roleId: 'synthetic-role', menuId: 'synthetic-menu' },
};
export const membership: Prisma.SysUserRoleWhereUniqueInput = {
  userId_roleId: { userId: 'synthetic-user', roleId: 'synthetic-role' },
};

// Negative type assertions must remain errors after generation.
// @ts-expect-error Business reverse relations must not enter the generated administrator API.
export const business: keyof Prisma.SysUserCreateInput = 'assignedFdeRequests';
// @ts-expect-error A password hash is required; no seeded plaintext/default credential.
export const noHash: Prisma.SysUserCreateInput = { username: 'missing-hash', realName: 'Synthetic' };
// @ts-expect-error Source UserStatus has no new business state.
export const status: UserStatus = 'business-approved';
// @ts-expect-error Source ResourceType is bounded to menu/button/api/data.
export const resource: ResourceType = 'order';
