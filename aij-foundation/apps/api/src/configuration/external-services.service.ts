import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, ScopedConfig } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ManagementAccessService } from '../rbac/management-access.service';
import { SecretRefPort, assertOwnedRef, SecretIdentity } from '../secret-center/secret-ref';
import { EXTERNAL_SERVICE_CATALOG, externalProvider } from './external-services.catalog';
import { SaveExternalServiceDto, validateProviderDraft, strictRecord } from './external-services.dto';
export type ExternalServiceView = {
    providerCode: string;
    version: number;
    fields: Record<string, string>;
    credentialStates: Record<string, boolean>;
    missingFields: string[];
    configurationStatus: 'not_configured' | 'draft' | 'credentials_ready';
    runtimeEnabled: false;
    externalVerification: 'not_run';
};
const permission = 'admin.config.manage';
@Injectable()
export class ExternalServicesService {
    constructor(private readonly prisma: PrismaService, private readonly access: ManagementAccessService, private readonly runtime: ConfigService, private readonly secrets: SecretRefPort) { }
    private async context(tx: Prisma.TransactionClient) {
        const environment = this.runtime.getOrThrow<string>('environment');
        const p = await tx.projectProfile.findFirst({ where: { code: this.runtime.getOrThrow<string>('projectId') + '-' + environment, deletedAt: null, organization: { deletedAt: null } }, include: { organization: true } });
        if (!p)
            throw new NotFoundException('Project context unavailable');
        if (p.environment !== environment || p.status !== 'active' || p.organization.status !== 'active')
            throw new ForbiddenException('Project context unavailable');
        return p;
    }
    private identity(): SecretIdentity { return { projectId: this.runtime.getOrThrow('projectId'), environment: this.runtime.getOrThrow('environment'), namespace: this.runtime.getOrThrow('namespace'), repositoryRoot: this.runtime.getOrThrow('repositoryRoot') }; }
    private key(code: string) { externalProvider(code); return 'external.services.' + code; }
    private where(code: string, scopeId: string) { return { scope_scopeId_pluginCode_configKey: { scope: 'project', scopeId, pluginCode: '', configKey: this.key(code) } }; }
    private stored(code: string, row: ScopedConfig | null): {
        fields: Record<string, string>;
        credentialRefs: Record<string, string>;
    } {
        if (!row)
            return { fields: {}, credentialRefs: {} };
        try {
            if (row.deletedAt || row.scope !== 'project' || row.pluginCode !== '' || row.configKey !== this.key(code) || !row.sensitive || row.isPublic || row.status !== 'disabled' || row.valueType !== 'string')
                throw new Error();
            const b = strictRecord(JSON.parse(row.configValue), ['fields', 'credentialRefs']);
            const d = validateProviderDraft(code, { expectedVersion: 0, ...b });
            const refs: Record<string, string> = {};
            for (const [k, v] of Object.entries(d.credentialRefs ?? {})) {
                if (!v)
                    throw new Error();
                assertOwnedRef(v, this.identity());
                refs[k] = v;
            }
            return { fields: d.fields, credentialRefs: refs };
        }
        catch {
            throw new ServiceUnavailableException('External service draft unavailable');
        }
    }
    private async view(tx: Prisma.TransactionClient, code: string, row: ScopedConfig | null): Promise<ExternalServiceView> {
        const p = externalProvider(code), stored = this.stored(code, row), states: Record<string, boolean> = {};
        for (const c of p.credentials)
            states[c.key] = stored.credentialRefs[c.key] ? await this.secrets.configuredTrusted(tx, stored.credentialRefs[c.key]) : false;
        const missing = [...p.fields.filter(f => f.required && !stored.fields[f.key]).map(f => f.key), ...p.credentials.filter(c => c.required && !states[c.key]).map(c => c.key)];
        return { providerCode: code, version: row?.version ?? 0, fields: stored.fields, credentialStates: states, missingFields: missing, configurationStatus: !row ? 'not_configured' : missing.length ? 'draft' : 'credentials_ready', runtimeEnabled: false, externalVerification: 'not_run' };
    }
    catalog(operator: string) { return this.access.write(operator, [permission], async (tx) => { await this.context(tx); return EXTERNAL_SERVICE_CATALOG; }); }
    get(code: string, operator: string) { externalProvider(code); return this.access.write(operator, [permission], async (tx) => { const p = await this.context(tx); return this.view(tx, code, await tx.scopedConfig.findUnique({ where: this.where(code, p.id) })); }); }
    list(operator: string) { return this.access.write(operator, [permission], async (tx) => { const p = await this.context(tx); return { projectId: p.id, items: await Promise.all(EXTERNAL_SERVICE_CATALOG.providers.map(async (provider) => this.view(tx, provider.code, await tx.scopedConfig.findUnique({ where: this.where(provider.code, p.id) })))) }; }); }
    save(code: string, raw: SaveExternalServiceDto, operator: string, correlationId?: string) {
        const dto = validateProviderDraft(code, raw), refs = dto.credentialRefs;
        return this.access.write(operator, [permission, ...(Object.keys(refs ?? {}).length ? ['admin.secret.manage'] : [])], async (tx, actor) => {
            const p = await this.context(tx), previous = await tx.scopedConfig.findUnique({ where: this.where(code, p.id) });
            if (previous?.deletedAt || (previous?.version ?? 0) !== dto.expectedVersion)
                throw new ConflictException('Configuration version conflict');
            const before = this.stored(code, previous), merged = { ...before.credentialRefs };
            for (const [k, v] of Object.entries(refs ?? {})) {
                if (v === null) {
                    delete merged[k];
                    continue;
                }
                try {
                    assertOwnedRef(v, this.identity());
                }
                catch {
                    throw new BadRequestException('Reference is not configured');
                }
                if (!await this.secrets.configuredTrusted(tx, v))
                    throw new BadRequestException('Reference is not configured');
                merged[k] = v;
            }
            const ordered = (b: Record<string, string>) => Object.fromEntries(Object.keys(b).sort().map(k => [k, b[k]]));
            const value = JSON.stringify({ fields: ordered(dto.fields), credentialRefs: ordered(merged) });
            if (previous && value === JSON.stringify({ fields: ordered(before.fields), credentialRefs: ordered(before.credentialRefs) }))
                return this.view(tx, code, previous);
            const data = { configValue: value, valueType: 'string', sensitive: true, isPublic: false, status: 'disabled' };
            // Shared management lock serializes creates; updateMany additionally gives deterministic CAS refusal.
            let row: ScopedConfig;
            if (previous) {
                const updated = await tx.scopedConfig.updateMany({ where: { id: previous.id, version: dto.expectedVersion, deletedAt: null }, data: { ...data, version: { increment: 1 } } });
                if (updated.count !== 1)
                    throw new ConflictException('Configuration version conflict');
                row = (await tx.scopedConfig.findUnique({ where: { id: previous.id } }))!;
            }
            else
                row = await tx.scopedConfig.create({ data: { ...data, name: this.key(code), configKey: this.key(code), scope: 'project', scopeId: p.id, pluginCode: '' } });
            const audit = await this.access.audit(tx, actor.id, row.id, 'external_service_draft_saved', 'configuration', 'scoped_config', correlationId, ['fields', 'credentialStates', 'version']);
            await tx.configurationChange.create({ data: { configId: row.id, configVersion: row.version, auditLogId: audit.id, operatorId: actor.id, scope: 'project', scopeId: p.id, pluginCode: '', configKey: this.key(code), changeMetadata: { previousVersion: previous?.version ?? 0, sensitive: true } } });
            return this.view(tx, code, row);
        });
    }
}
