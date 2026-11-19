// Source scoped resolution adapted to trusted runtime identity and atomic version/audit writes.
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma, ScopedConfig } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { ManagementAccessService } from "../rbac/management-access.service";
import { CONFIGURATION_PERMISSION } from "../../../../scripts/configuration-policy.cjs";
import { CONFIG_SCHEMA, ConfigScope, assertTrustedScope, chooseConfigCandidate, definitionFor, parseTypedConfig, scopeIdFor } from "./configuration-policy";
import { ScopedConfigQueryDto, UpdateProjectProfileDto, UpsertScopedConfigDto } from "./dto";
import { SECRET_PERMISSION } from "../../../../scripts/secret-policy.cjs";
import { SecretRefPort } from "../secret-center/secret-ref";
@Injectable()
export class ConfigurationService {
  constructor(private readonly prisma: PrismaService, private readonly access: ManagementAccessService, private readonly runtime: ConfigService, private readonly secrets: SecretRefPort) {}
  private async context(tx: Prisma.TransactionClient, allowDisabled = false) {
    const code = this.runtime.getOrThrow<string>("projectId") + "-" + this.runtime.getOrThrow<string>("environment");
    const profile = await tx.projectProfile.findFirst({ where: { code, deletedAt: null, organization: { deletedAt: null } }, include: { organization: true } });
    if (!profile) throw new NotFoundException("Project context is not initialized");
    if (profile.environment !== this.runtime.getOrThrow<string>("environment")) throw new ForbiddenException("Project environment mismatch");
    if (!allowDisabled && (profile.status !== "active" || profile.organization.status !== "active")) throw new ForbiddenException("Project context disabled");
    return { profile, projectId: profile.id, organizationId: profile.organizationId };
  }
  private targets(context: { projectId: string; organizationId: string }, pluginCode = "") {
    return CONFIG_SCOPES_LOCAL.map(scope => ({ scope, scopeId: scopeIdFor(scope, context), pluginCode }));
  }
  private targetsFor(key: string, context: { projectId: string; organizationId: string }) {
    const definition = definitionFor(key);
    if (definition.projectOnly) return [{ scope: "project", scopeId: context.projectId, pluginCode: definition.pluginCode ?? "" }];
    return this.targets(context, definition.pluginCode ?? "");
  }
  private read<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>) {
    return this.access.database(() => this.prisma.$transaction(operation, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 2000, timeout: 2000 }));
  }
  private async safe(row: ScopedConfig, tx: Prisma.TransactionClient) {
    const known = Object.hasOwn(CONFIG_SCHEMA, row.configKey), sensitive = !known || definitionFor(row.configKey).sensitive || row.sensitive || row.valueType === "secretRef";
    return { id: row.id, scope: row.scope, scopeId: row.scopeId, configKey: row.configKey, valueType: row.valueType, isPublic: row.isPublic, sensitive, status: row.status, version: row.version,
      ...(sensitive ? { referenceConfigured: known && row.valueType === "secretRef" && await this.secrets.configuredTrusted(tx, row.configValue) } : { configValue: parseTypedConfig(row.configKey, row.configValue, row.valueType) }) };
  }
  profile() { return this.read(async tx => { const c = await this.context(tx, true); return { id: c.projectId, code: c.profile.code, status: c.profile.status, updatedAt: c.profile.updatedAt, organization: { id: c.organizationId, status: c.profile.organization.status } }; }); }
  list(query: ScopedConfigQueryDto) {
    return this.read(async tx => {
      const c = await this.context(tx); if (query.scopeId && !query.scope) throw new BadRequestException("scope is required");
      if (query.scope) assertTrustedScope(query.scope, query.scopeId, c);
      const rows = await tx.scopedConfig.findMany({ where: { deletedAt: null, OR: [...this.targets(c), ...this.targets(c, "aij-ai")], ...(query.scope ? { scope: query.scope } : {}) }, orderBy: [{ scope: "asc" }, { configKey: "asc" }] });
      return Promise.all(rows.map(row => this.safe(row, tx)));
    });
  }
  resolve(key: string) {
    const def = definitionFor(key); return this.read(async tx => {
      const c = await this.context(tx), rows = await tx.scopedConfig.findMany({ where: { configKey: key, status: "active", deletedAt: null, OR: this.targetsFor(key, c) } });
      const row = chooseConfigCandidate(rows); return row ? { ...await this.safe(row, tx), source: row.scope } : { configKey: key, source: "default", sensitive: def.sensitive, value: def.defaultValue };
    });
  }
  // Backend consumers only. Public/admin projections never call this value-bearing method.
  async resolveTrustedSecret(key: string): Promise<string> {
    if (definitionFor(key).type !== "secretRef") throw new BadRequestException("Secret reference configuration required");
    const ref = await this.read(async tx => {
      const c = await this.context(tx), row = chooseConfigCandidate(await tx.scopedConfig.findMany({ where: { configKey: key, status: "active", deletedAt: null, OR: this.targetsFor(key, c) } }));
      if (!row || row.valueType !== "secretRef") throw new NotFoundException("Configured capability unavailable");
      return parseTypedConfig(key, row.configValue, row.valueType) as string;
    });
    return this.secrets.resolveTrusted(ref);
  }
  publicContext() {
    return this.read(async tx => {
      const c = await this.context(tx), rows = await tx.scopedConfig.findMany({ where: { status: "active", deletedAt: null, OR: this.targets(c) } });
      const values: Record<string, string | number | boolean> = {};
      for (const [key, def] of Object.entries(CONFIG_SCHEMA)) {
        if (!def.public) continue;
        const row = chooseConfigCandidate(rows.filter(row => row.configKey === key));
        // Resolve first, redact second. A private higher scope must not reveal a lower public value.
        if (row) { if (row.sensitive || row.valueType === "secretRef" || !row.isPublic) continue; values[key] = parseTypedConfig(key, row.configValue, row.valueType); }
        else if (def.defaultValue !== undefined) values[key] = def.defaultValue;
      }
      const enabledRow = chooseConfigCandidate(rows.filter(row => row.configKey === "capabilities.publicContextEnabled"));
      if (enabledRow && parseTypedConfig(enabledRow.configKey, enabledRow.configValue, enabledRow.valueType) !== true) throw new ForbiddenException("Public context disabled");
      return { projectCode: c.profile.code, brand: { ...(values["brand.displayName"] !== undefined ? { displayName: values["brand.displayName"] } : {}), ...(values["brand.primaryColor"] !== undefined ? { primaryColor: values["brand.primaryColor"] } : {}), ...(values["brand.logoPath"] !== undefined ? { logoPath: values["brand.logoPath"] } : {}) },
        capabilities: { auth: this.runtime.getOrThrow<{ auth: boolean }>("capabilities").auth, database: this.runtime.getOrThrow<{ database: boolean }>("capabilities").database, storage: this.runtime.getOrThrow<{ storage: boolean }>("capabilities").storage, publicContext: true }, enabledPlugins: this.runtime.getOrThrow<string[]>("enabledPlugins") };
    });
  }
  upsert(key: string, dto: UpsertScopedConfigDto, operator: string, correlationId?: string) {
    const def = definitionFor(key); parseTypedConfig(key, dto.configValue, dto.valueType);
    if (dto.isPublic && !def.public) throw new BadRequestException("Configuration cannot be public");
    if (def.projectOnly && dto.scope !== "project") throw new BadRequestException("AI configuration must be project scoped");
    return this.access.write(operator, [CONFIGURATION_PERMISSION, ...(def.sensitive ? [SECRET_PERMISSION] : [])], async (tx, actor) => {
      if (dto.scope === "global" && !actor.isSuperAdmin) throw new ForbiddenException("Global configuration requires system administrator");
      const c = await this.context(tx); assertTrustedScope(dto.scope, dto.scopeId, c); const scopeId = scopeIdFor(dto.scope, c);
      if (def.sensitive && !await this.secrets.configuredTrusted(tx, dto.configValue)) throw new BadRequestException("Reference is not configured");
      const pluginCode = def.pluginCode ?? "";
      const where = { scope_scopeId_pluginCode_configKey: { scope: dto.scope, scopeId, pluginCode, configKey: key } }, previous = await tx.scopedConfig.findUnique({ where });
      if (previous?.deletedAt || (previous?.version ?? 0) !== dto.expectedVersion) throw new ConflictException("Configuration version conflict");
      const data = { configValue: dto.configValue, valueType: dto.valueType, isPublic: dto.isPublic, sensitive: def.sensitive, status: dto.status };
      const row = previous ? await tx.scopedConfig.update({ where: { id: previous.id, version: dto.expectedVersion }, data: { ...data, version: { increment: 1 } } }) : await tx.scopedConfig.create({ data: { ...data, configKey: key, name: key, scope: dto.scope, scopeId, pluginCode } });
      const audit = await this.access.audit(tx, actor.id, row.id, "scoped_config_updated", "configuration", "scoped_config", correlationId, ["configValue", "isPublic", "status", "version"]);
      await tx.configurationChange.create({ data: { configId: row.id, configVersion: row.version, auditLogId: audit.id, operatorId: actor.id, scope: dto.scope, scopeId, pluginCode, configKey: key, changeMetadata: { previousVersion: previous?.version ?? 0, valueType: row.valueType, sensitive: def.sensitive } } });
      return this.safe(row, tx);
    });
  }
  updateProfile(dto: UpdateProjectProfileDto, operator: string, correlationId?: string) {
    return this.access.write(operator, [CONFIGURATION_PERMISSION], async (tx, actor) => {
      if (!actor.isSuperAdmin) throw new ForbiddenException("System administrator required");
      const c = await this.context(tx, true), expected = new Date(dto.expectedUpdatedAt);
      if (c.profile.updatedAt.getTime() !== expected.getTime()) throw new ConflictException("Project profile version conflict");
      // Force a different millisecond even for an immediate no-op status update.
      const updatedAt = new Date(Math.max(Date.now(), expected.getTime() + 1));
      await tx.projectProfile.update({ where: { id: c.projectId, updatedAt: expected }, data: { status: dto.status, updatedAt } });
      const audit = await this.access.audit(tx, actor.id, c.projectId, "project_status_updated", "configuration", "project_profile", correlationId, ["status"]);
      await tx.configurationChange.create({ data: { scope: "project", scopeId: c.projectId, configKey: "project.profile", operatorId: actor.id, auditLogId: audit.id, changeMetadata: { fields: ["status"], status: dto.status } } });
      return { id: c.projectId, status: dto.status, updatedAt };
    });
  }
  changes() { return this.read(async tx => { const c = await this.context(tx); return tx.configurationChange.findMany({ where: { OR: [...this.targets(c), ...this.targets(c, "aij-ai")], deletedAt: null }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 100, select: { id: true, scope: true, scopeId: true, pluginCode: true, configKey: true, configId: true, configVersion: true, auditLogId: true, operatorId: true, createdAt: true } }); }); }
}
const CONFIG_SCOPES_LOCAL: readonly ConfigScope[] = ["global", "organization", "project"];
