import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';
import type { AiCenterCatalog } from '@aij/contracts';
import { isDeepStrictEqual } from 'node:util';
import { PrismaService } from '../../prisma/prisma.service';
import { ManagementAccessService } from '../../rbac/management-access.service';
import { PermissionsService } from '../../rbac/permissions.service';
import { PluginRuntimeAccessService } from '../../plugin-runtime/plugin-runtime-access.service';
import { SecretRefPort } from '../../secret-center/secret-ref';
import { CONFIGURATION_PERMISSION } from '../../../../../scripts/configuration-policy.cjs';
import { SECRET_PERMISSION } from '../../../../../scripts/secret-policy.cjs';
import { AI_CENTER_CONFIG_KEY, EMPTY_AI_CATALOG, validateAiCatalog } from './ai-center-policy';
@Injectable()
export class AiCenterConfigurationService {
    constructor(private readonly prisma: PrismaService, private readonly access: ManagementAccessService, private readonly permissions: PermissionsService, private readonly plugins: PluginRuntimeAccessService, private readonly secrets: SecretRefPort, private readonly config: ConfigService) { }
    approvedBases(): string[] { try {
        const v = JSON.parse(this.config.get<string>('AI_CENTER_ALLOWED_BASE_URLS') || '[]');
        if (!Array.isArray(v) || v.length > 20 || v.some(x => typeof x !== 'string'))
            throw new Error();
        return v;
    }
    catch {
        throw new BadRequestException('Invalid server AI endpoint allowlist');
    } }
    async current(tx: Prisma.TransactionClient) {
        const projectId = await this.plugins.projectId(tx);
        await this.plugins.assertEnabledInTransaction(tx, projectId, 'aij-ai');
        const row = await tx.scopedConfig.findUnique({ where: { scope_scopeId_pluginCode_configKey: { scope: 'project', scopeId: projectId, pluginCode: 'aij-ai', configKey: AI_CENTER_CONFIG_KEY } } });
        if (row && (row.deletedAt || row.status !== 'active' || row.valueType !== 'string'))
            throw new ConflictException('AI center configuration unavailable');
        return { projectId, version: row?.version ?? 0, catalog: row ? validateAiCatalog(JSON.parse(row.configValue), this.approvedBases()) : structuredClone(EMPTY_AI_CATALOG) };
    }
    read(operator: string) { return this.access.database(() => this.prisma.$transaction(async (tx) => { await this.permissions.authorizeInTransaction(tx, operator, [CONFIGURATION_PERMISSION]); const c = await this.current(tx); return { version: c.version, catalog: c.catalog }; })); }
    save(input: unknown, operator: string, correlationId?: string) {
        if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).sort().join() !== 'catalog,expectedVersion')
            throw new BadRequestException('Invalid AI configuration request');
        const d = input as {
            expectedVersion: number;
            catalog: AiCenterCatalog;
        };
        if (!Number.isSafeInteger(d.expectedVersion) || d.expectedVersion < 0 || Buffer.byteLength(JSON.stringify(input), 'utf8') > 256 * 1024)
            throw new BadRequestException('Invalid AI configuration request');
        const catalog = structuredClone(validateAiCatalog(d.catalog, this.approvedBases()));
        return this.access.write(operator, [CONFIGURATION_PERMISSION, SECRET_PERMISSION], async (tx, actor) => {
            const c = await this.current(tx);
            if (c.version !== d.expectedVersion)
                throw new ConflictException('AI configuration version conflict');
            for (const provider of catalog.providers) {
                if (!await this.secrets.configuredTrusted(tx, provider.credentialRef))
                    throw new BadRequestException('AI credential reference is not configured');
            }
            for (const key of ['providers', 'models', 'skills', 'agents'] as const)
                for (const row of catalog[key]) {
                    const previous = c.catalog[key].find(p => p.code === row.code);
                    row.revision = previous ? (isDeepStrictEqual({ ...row, revision: 0 }, { ...previous, revision: 0 }) ? previous.revision : previous.revision + 1) : 1;
                }
            const row = await tx.scopedConfig.upsert({ where: { scope_scopeId_pluginCode_configKey: { scope: 'project', scopeId: c.projectId, pluginCode: 'aij-ai', configKey: AI_CENTER_CONFIG_KEY } }, create: { scope: 'project', scopeId: c.projectId, pluginCode: 'aij-ai', configKey: AI_CENTER_CONFIG_KEY, name: 'General AI catalog', configValue: JSON.stringify(catalog), valueType: 'string', sensitive: true, isPublic: false }, update: { configValue: JSON.stringify(catalog), version: { increment: 1 } } });
            const audit = await this.access.audit(tx, actor.id, row.id, 'ai_center_configuration_updated', 'aij-ai', 'scoped_config', correlationId, ['providers', 'models', 'skills', 'agents', 'budget', 'version']);
            await tx.configurationChange.create({ data: { configId: row.id, configVersion: row.version, auditLogId: audit.id, operatorId: actor.id, scope: 'project', scopeId: c.projectId, pluginCode: 'aij-ai', configKey: AI_CENTER_CONFIG_KEY, changeMetadata: { previousVersion: c.version, providerCount: catalog.providers.length, modelCount: catalog.models.length, agentCount: catalog.agents.length } } });
            return { version: row.version, catalog };
        });
    }
}
