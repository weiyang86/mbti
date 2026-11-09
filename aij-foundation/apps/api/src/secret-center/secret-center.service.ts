// Directed F00 M06 metadata/resolve/check adaptation. Shared access owns transactions and audit.
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma, SecretReference } from "@prisma/client";
import { SECRET_PERMISSION } from "../../../../scripts/secret-policy.cjs";
import { PrismaService } from "../prisma/prisma.service";
import { ManagementAccessService } from "../rbac/management-access.service";
import { PluginRuntimeAccessService } from "../plugin-runtime/plugin-runtime-access.service";
import { AdminListDto } from "../admin/dto";
import { CreateSecretReferenceDto, RotateSecretReferenceDto, SecretVersionDto } from "./dto";
import { EnvSecretAdapter, LocalSecretStoreAdapter, SecretAdapter } from "./secret-adapter";
import { assertOwnedRef, prefixes, SecretIdentity, SecretRefPort } from "./secret-ref";
@Injectable()
export class SecretCenterService implements SecretRefPort {
  private readonly identity: SecretIdentity;
  private readonly adapters: Record<"env" | "local", SecretAdapter>;
  constructor(private readonly prisma: PrismaService, private readonly access: ManagementAccessService, private readonly pluginAccess: PluginRuntimeAccessService, runtime: ConfigService) {
    this.identity = { projectId: runtime.getOrThrow<string>("projectId"), environment: runtime.getOrThrow<string>("environment"), namespace: runtime.getOrThrow<string>("namespace"), repositoryRoot: runtime.getOrThrow<string>("repositoryRoot") };
    this.adapters = { env: new EnvSecretAdapter(), local: new LocalSecretStoreAdapter(this.identity) };
  }
  private ownedWhere() { return { deletedAt: null, OR: Object.values(prefixes(this.identity)).map(prefix => ({ ref: { startsWith: prefix } })) }; }
  private async context(tx: Prisma.TransactionClient) {
    const profile = await tx.projectProfile.findFirst({ where: { code: this.identity.projectId + "-" + this.identity.environment, environment: this.identity.environment, deletedAt: null, organization: { deletedAt: null } }, include: { organization: true } });
    if (!profile) throw new NotFoundException("Project context unavailable");
    if (profile.status !== "active" || profile.organization.status !== "active") throw new ForbiddenException("Project context disabled");
    return profile;
  }
  private async find(tx: Prisma.TransactionClient, id: string) {
    const row = await tx.secretReference.findFirst({ where: { id, ...this.ownedWhere() } });
    if (!row) throw new NotFoundException("Secret reference unavailable"); assertOwnedRef(row.ref, this.identity); return row;
  }
  private read<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>) {
    return this.access.database(() => this.prisma.$transaction(async tx => { await this.context(tx); return operation(tx); }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 2000, timeout: 2000 }));
  }
  private async safe(row: SecretReference) {
    const parsed = assertOwnedRef(row.ref, this.identity);
    return { id: row.id, ref: parsed.ref, provider: parsed.provider, status: row.status, configured: row.provider === parsed.provider && row.status === "active" && await this.adapters[parsed.provider].exists(parsed), updatedAt: row.updatedAt };
  }
  // Fresh metadata + provider read per request: no stale value or permission cache.
  resolveTrusted(ref: string): Promise<string> {
    const parsed = assertOwnedRef(ref, this.identity);
    return this.read(async tx => {
      if (!await tx.secretReference.findFirst({ where: { ref, provider: parsed.provider, status: "active", deletedAt: null } })) throw new NotFoundException("Configured secret unavailable");
      return this.adapters[parsed.provider].resolve(parsed);
    });
  }
  resolveTrustedForPlugin(pluginCode: string, ref: string): Promise<string> {
    const parsed = assertOwnedRef(ref, this.identity);
    if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(pluginCode)) throw new NotFoundException("Plugin capability unavailable");
    return this.read(async tx => {
      const profile = await this.context(tx);
      await this.pluginAccess.assertEnabledInTransaction(tx, profile.id, pluginCode);
      const bound = await tx.scopedConfig.findFirst({ where: { scope: "project", scopeId: profile.id, pluginCode, configKey: { not: "" }, configValue: ref, valueType: "secretRef", status: "active", deletedAt: null }, select: { id: true } });
      if (!bound || !await tx.secretReference.findFirst({ where: { ref, provider: parsed.provider, status: "active", deletedAt: null }, select: { id: true } })) throw new NotFoundException("Plugin capability unavailable");
      return this.adapters[parsed.provider].resolve(parsed);
    });
  }
  async configuredTrusted(tx: Prisma.TransactionClient, ref: string): Promise<boolean> {
    const parsed = assertOwnedRef(ref, this.identity);
    const row = await tx.secretReference.findFirst({ where: { ref: parsed.ref, provider: parsed.provider, status: "active", deletedAt: null }, select: { id: true } });
    if (!row) return false;
    try { return await this.adapters[parsed.provider].exists(parsed); }
    catch { return false; }
  }
  list(query: AdminListDto) {
    return this.read(async tx => {
      const where = { ...this.ownedWhere(), ...(query.status ? { status: query.status } : {}), ...(query.q ? { ref: { contains: query.q } } : {}) };
      const [total, rows] = await Promise.all([tx.secretReference.count({ where }), tx.secretReference.findMany({ where, skip: (query.page - 1) * query.pageSize, take: query.pageSize, orderBy: [{ createdAt: "desc" }, { id: "asc" }] })]);
      return { items: await Promise.all(rows.map(row => this.safe(row))), total, page: query.page, pageSize: query.pageSize };
    });
  }
  detail(id: string) { return this.read(async tx => this.safe(await this.find(tx, id))); }
  private changedAt(row: SecretReference, dto: SecretVersionDto) {
    if (new Date(dto.expectedUpdatedAt).getTime() !== row.updatedAt.getTime()) throw new ConflictException("Secret reference version conflict");
    return new Date(Math.max(Date.now(), row.updatedAt.getTime() + 1));
  }
  private async record(tx: Prisma.TransactionClient, actor: string, row: SecretReference, action: string, correlationId?: string) {
    const profile = await this.context(tx);
    const audit = await this.access.audit(tx, actor, row.id, action, "secret-center", "secret_reference", correlationId, ["reference", "status"]);
    await tx.configurationChange.create({ data: { scope: "project", scopeId: profile.id, configKey: "secret.reference", operatorId: actor, auditLogId: audit.id, eventType: action, changeMetadata: { referenceId: row.id, provider: row.provider, status: row.status } } });
  }
  private async bindings(tx: Prisma.TransactionClient, ref: string, profile: { id: string; organizationId: string }, isSuperAdmin: boolean) {
    const configs = await tx.scopedConfig.findMany({ where: { configValue: ref, valueType: "secretRef", deletedAt: null } });
    if (configs.some(c => c.pluginCode !== "" || !((c.scope === "global" && c.scopeId === "global") || (c.scope === "project" && c.scopeId === profile.id) || (c.scope === "organization" && c.scopeId === profile.organizationId)))) throw new ConflictException("Foreign reference binding exists");
    if (configs.some(c => c.scope === "global") && !isSuperAdmin) throw new ForbiddenException("Global reference control requires system administrator");
    return configs;
  }
  create(dto: CreateSecretReferenceDto, operator: string, correlationId?: string) {
    const parsed = assertOwnedRef(dto.ref, this.identity);
    return this.access.write(operator, [SECRET_PERMISSION], async (tx, actor) => {
      await this.context(tx); const row = await tx.secretReference.create({ data: { ref: parsed.ref, provider: parsed.provider } });
      await this.record(tx, actor.id, row, "secret_reference_created", correlationId); return this.safe(row);
    });
  }
  rotate(id: string, dto: RotateSecretReferenceDto, operator: string, correlationId?: string) {
    const parsed = assertOwnedRef(dto.ref, this.identity);
    return this.access.write(operator, [SECRET_PERMISSION], async (tx, actor) => {
      const profile = await this.context(tx), before = await this.find(tx, id), updatedAt = this.changedAt(before, dto);
      if (before.ref === parsed.ref) throw new BadRequestException("Rotation requires a new reference");
      // Secret administration explicitly controls rebinding; never cross runtime project boundaries.
      const configs = await this.bindings(tx, before.ref, profile, actor.isSuperAdmin);
      const row = await tx.secretReference.update({ where: { id, updatedAt: before.updatedAt }, data: { ref: parsed.ref, provider: parsed.provider, status: "active", lastCheckedAt: null, lastCheckStatus: null, updatedAt } });
      for (const config of configs) {
        const current = await tx.scopedConfig.update({ where: { id: config.id, version: config.version }, data: { configValue: parsed.ref, version: { increment: 1 } } });
        const audit = await this.access.audit(tx, actor.id, config.id, "secret_reference_rebound", "secret-center", "scoped_config", correlationId, ["reference", "version"]);
        await tx.configurationChange.create({ data: { scope: config.scope, scopeId: config.scopeId, configKey: config.configKey, configId: config.id, configVersion: current.version, operatorId: actor.id, auditLogId: audit.id, changeMetadata: { previousVersion: config.version, referenceId: row.id } } });
      }
      await this.record(tx, actor.id, row, "secret_reference_rotated", correlationId); return this.safe(row);
    });
  }
  clear(id: string, dto: SecretVersionDto, operator: string, correlationId?: string) {
    return this.access.write(operator, [SECRET_PERMISSION], async (tx, actor) => {
      const profile = await this.context(tx), before = await this.find(tx, id), updatedAt = this.changedAt(before, dto);
      await this.bindings(tx, before.ref, profile, actor.isSuperAdmin);
      const row = await tx.secretReference.update({ where: { id, updatedAt: before.updatedAt }, data: { status: "disabled", lastCheckStatus: "unavailable", lastCheckedAt: null, updatedAt } });
      await this.record(tx, actor.id, row, "secret_reference_cleared", correlationId); return this.safe(row);
    });
  }
  check(id: string, dto: SecretVersionDto, operator: string, correlationId?: string) {
    return this.access.write(operator, [SECRET_PERMISSION], async (tx, actor) => {
      await this.context(tx); const before = await this.find(tx, id), updatedAt = this.changedAt(before, dto), result = await this.safe(before);
      const row = await tx.secretReference.update({ where: { id, updatedAt: before.updatedAt }, data: { lastCheckedAt: new Date(), lastCheckStatus: result.configured ? "available" : "unavailable", updatedAt } });
      await this.record(tx, actor.id, row, "secret_reference_checked", correlationId); return { ...result, updatedAt: row.updatedAt };
    });
  }
}
