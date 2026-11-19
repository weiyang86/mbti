import type { Prisma } from '@prisma/client';

// Compile public generated inputs only; never instantiate a client or persist data.
export const ownership: Prisma.OrganizationProfileCreateInput = {
  code: 'af008-fixture-org', name: 'Synthetic organization',
  projects: { create: { code: 'af008-fixture-project', name: 'Synthetic project' } },
};
export const config: Prisma.ScopedConfigCreateInput = {
  scope: 'project', scopeId: 'synthetic-project-id', pluginCode: '', configKey: 'ui.label',
  configValue: 'synthetic label', name: 'Synthetic label', version: 1,
};
export const change: Prisma.ConfigurationChangeCreateInput = {
  scope: 'project', scopeId: 'synthetic-project-id', configKey: 'ui.label', configVersion: 1,
  config: { connect: { id: 'synthetic-config-id' } }, auditLog: { connect: { id: 'synthetic-audit-id' } },
};
export const namespace: Prisma.ScopedConfigWhereUniqueInput = {
  scope_scopeId_pluginCode_configKey: { scope: 'project', scopeId: 'synthetic-project-id', pluginCode: '', configKey: 'ui.label' },
};
export const revision: Prisma.ConfigurationChangeWhereUniqueInput = { configId_configVersion: { configId: 'synthetic-config-id', configVersion: 1 } };
export const reference: Prisma.SecretReferenceCreateInput = { ref: 'env://AIJ_SYNTHETIC_REFERENCE_ONLY', provider: 'env' };
export const audit: Prisma.AuditLogCreateInput = { module: 'configuration', action: 'fixture', resourceType: 'scoped_config', resourceId: 'synthetic-config-id' };

// @ts-expect-error Project ownership is not customer workspace membership.
export const workspace: keyof Prisma.ProjectProfileCreateInput = 'workspaceMemberships';
// @ts-expect-error Organization ownership does not grant permissions.
export const permission: keyof Prisma.OrganizationProfileCreateInput = 'permissions';
// @ts-expect-error Secret metadata has no value column.
export const rawSecret: keyof Prisma.SecretReferenceCreateInput = 'secretValue';
// @ts-expect-error Configuration versions are integers.
export const invalidVersion: Prisma.ScopedConfigCreateInput = { ...config, version: 'one' };
// @ts-expect-error A project requires an owning organization.
export const missingOwner: Prisma.ProjectProfileCreateInput = { code: 'fixture', name: 'Synthetic project' };
