import type { PluginInstallationStatus, PluginOperationStatus, Prisma } from '@prisma/client';

// Compile actual generated inputs; never instantiate PrismaClient or create records.
export const file: Prisma.FileAssetCreateInput = {
  originalName: 'synthetic.txt', filename: 'af009-synthetic.txt', mimeType: 'text/plain', size: 9,
  path: 'af009-fixture/synthetic.txt', url: '/synthetic-files/af009-fixture',
  projectId: 'af009-project', ownerType: 'user', ownerId: 'af009-synthetic-actor',
};
export const installation: Prisma.PluginInstallationCreateInput = {
  projectId: 'af009-project', pluginCode: 'af009-synthetic', version: '0.0.0', owner: 'af009-fixture',
};
export const namespace: Prisma.PluginInstallationWhereUniqueInput = {
  projectId_pluginCode: { projectId: 'af009-project', pluginCode: 'af009-synthetic' },
};
export const operation: Prisma.PluginOperationCreateInput = {
  installation: { connect: { id: 'af009-synthetic-installation' } }, action: 'install',
  version: '0.0.0', owner: 'af009-fixture', status: 'failed', failureReason: 'synthetic validation failure',
};
export const installationStates: PluginInstallationStatus[] = ['uninstalled', 'installed', 'enabled', 'failed'];
export const operationStates: PluginOperationStatus[] = ['pending', 'running', 'succeeded', 'failed'];

// @ts-expect-error Installation states cannot stand in for operation states.
export const invalidState: PluginOperationStatus = 'enabled';
// @ts-expect-error Version is mandatory even for an uninstalled row.
export const missingVersion: Prisma.PluginInstallationCreateInput = { projectId: 'fixture', pluginCode: 'fixture', owner: 'fixture' };
// @ts-expect-error Implementation owner must be explicit.
export const missingOwner: Prisma.PluginInstallationCreateInput = { projectId: 'fixture', pluginCode: 'fixture', version: '0.0.0' };
// @ts-expect-error File metadata has no source site-media relation.
export const businessRelation: keyof Prisma.FileAssetCreateInput = 'siteMediaLinks';
// @ts-expect-error Operation history requires a linked installation.
export const missingInstallation: Prisma.PluginOperationCreateInput = { action: 'install', version: '0.0.0', owner: 'fixture' };
// @ts-expect-error Failure reason is text metadata.
export const invalidFailureReason: Prisma.PluginOperationCreateInput = { ...operation, failureReason: 7 };
