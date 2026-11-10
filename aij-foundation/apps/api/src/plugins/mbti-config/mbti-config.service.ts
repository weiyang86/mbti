import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma, ScopedConfig } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { CONFIGURATION_PERMISSION } from "../../../../../scripts/configuration-policy.cjs";
import { SECRET_PERMISSION } from "../../../../../scripts/secret-policy.cjs";
import { PrismaService } from "../../prisma/prisma.service";
import { ManagementAccessService } from "../../rbac/management-access.service";
import { PermissionsService } from "../../rbac/permissions.service";
import { PluginRuntimeAccessService } from "../../plugin-runtime/plugin-runtime-access.service";
import { assertOwnedRef } from "../../secret-center/secret-ref";
import { MBTI_CATEGORIES, MBTI_UNKNOWN, MbtiCategory, MbtiSnapshot, canonical, category, emptySnapshot, exactBody, projectSnapshot, revision, validateCategory, validateSnapshot } from "./mbti-config.schema";

export const MBTI_PLUGIN = "mbti-config";
const ACTIVE = "release.active", DRAFT = "release.draft", SNAPSHOT = "release.version.";
const systemCategory = (key: string) => ["aiRuntime", "payments", "trade"].includes(key);
type Context = { projectId: string; system: boolean };

@Injectable()
export class MbtiConfigService {
  constructor(private readonly prisma: PrismaService, private readonly access: ManagementAccessService,
    private readonly permissions: PermissionsService, private readonly runtime: ConfigService, private readonly plugins: PluginRuntimeAccessService) {}

  private async context(tx: Prisma.TransactionClient, operator: string): Promise<Context> {
    if (this.runtime.getOrThrow<string>("projectId") !== "mbti-foundation") throw new ForbiddenException("MBTI project required");
    const projectId = await this.plugins.projectId(tx);
    await this.plugins.assertEnabledInTransaction(tx, projectId, MBTI_PLUGIN);
    const actor = await this.permissions.authorizeInTransaction(tx, operator, [CONFIGURATION_PERMISSION]);
    return { projectId, system: actor.isSuperAdmin && actor.effectivePermissions.includes(SECRET_PERMISSION) };
  }
  private where(projectId: string, configKey: string) { return { scope_scopeId_pluginCode_configKey: { scope: "project", scopeId: projectId, pluginCode: MBTI_PLUGIN, configKey } }; }
  private row(tx: Prisma.TransactionClient, c: Context, key: string) { return tx.scopedConfig.findUnique({ where: this.where(c.projectId, key) }); }
  private data(c: Context, key: string, configValue: string) {
    return { scope: "project", scopeId: c.projectId, pluginCode: MBTI_PLUGIN, configKey: key, configValue, name: key, sensitive: true, isPublic: false, valueType: "string", status: "active" };
  }
  private usable(row: ScopedConfig | null) { if (row && (row.deletedAt || row.status !== "active")) throw new ConflictException("Configuration unavailable"); return row; }
  private parse(row: ScopedConfig | null): MbtiSnapshot { this.usable(row); return row ? validateSnapshot(JSON.parse(row.configValue)) : emptySnapshot(); }
  private async live(tx: Prisma.TransactionClient, c: Context) {
    const pointer = this.usable(await this.row(tx, c, ACTIVE));
    if (!pointer) return { pointer, snapshot: emptySnapshot() };
    const snapshot = this.usable(await this.row(tx, c, pointer.configValue));
    if (!snapshot || !snapshot.configKey.startsWith(SNAPSHOT) || snapshot.version !== pointer.version) throw new ConflictException("Published configuration unavailable");
    return { pointer, snapshot: this.parse(snapshot) };
  }
  private async state(tx: Prisma.TransactionClient, c: Context) {
    const live = await this.live(tx, c), draft = this.usable(await this.row(tx, c, DRAFT));
    return { ...live, draft, candidate: draft ? this.parse(draft) : structuredClone(live.snapshot) };
  }
  private diff(before: MbtiSnapshot, after: MbtiSnapshot): MbtiCategory[] { return MBTI_CATEGORIES.filter(k => canonical(before[k]) !== canonical(after[k])); }
  private view(c: Context, s: Awaited<ReturnType<MbtiConfigService["state"]>>, view: "draft" | "published") {
    return { schema: "mbti-config-candidate/v1", state: s.pointer ? "published" : "UNCONFIGURED", expectedVersion: s.pointer?.version ?? 0,
      expectedDraftVersion: s.draft?.version ?? 0, view, source: { scope: "project", projectId: c.projectId, environment: this.runtime.getOrThrow<string>("environment"), pluginCode: MBTI_PLUGIN }, categories: projectSnapshot(view === "draft" ? s.candidate : s.snapshot, c.system),
      diff: this.diff(s.snapshot, s.candidate).filter(k => c.system || !systemCategory(k)), ...MBTI_UNKNOWN };
  }
  private read<T>(operator: string, operation: (tx: Prisma.TransactionClient, c: Context) => Promise<T>) {
    return this.access.database(() => this.prisma.$transaction(async tx => operation(tx, await this.context(tx, operator)), { maxWait: 3000, timeout: 5000 }));
  }
  readView(operator: string, view: string) {
    if (!["draft", "published"].includes(view)) throw new BadRequestException("Unknown configuration view");
    return this.read(operator, async (tx, c) => {
      if (view === "published") {
        // Published reads never inspect the draft, including its revision, diff or validation state.
        const live = await this.live(tx, c);
        return this.view(c, { ...live, draft: null, candidate: live.snapshot }, "published");
      }
      return this.view(c, await this.state(tx, c), "draft");
    });
  }
  saveDraft(operator: string, keyInput: string, input: unknown, correlationId?: string) {
    const key = category(keyInput), body = exactBody(input, ["value", "expectedDraftVersion"]), expected = revision(body.expectedDraftVersion), value = validateCategory(key, body.value);
    return this.access.write(operator, [CONFIGURATION_PERMISSION], async (tx, actor) => {
      const c = await this.context(tx, actor.id);
      if (systemCategory(key) && !c.system) throw new ForbiddenException("System configuration requires platform administrator and secret permission");
      const s = await this.state(tx, c);
      if ((s.draft?.version ?? 0) !== expected) throw new ConflictException("Draft version conflict");
      let candidateValue: unknown = value;
      if (key === "aiRuntime") {
        // Safe projections omit references. Saving those visible fields must retain an existing binding.
        const ref = (value as { credentialRef?: string }).credentialRef ?? s.candidate.aiRuntime?.credentialRef;
        if (ref) candidateValue = { ...value, credentialRef: ref };
        if (ref) {
          assertOwnedRef(ref, { projectId: "mbti-foundation", environment: this.runtime.getOrThrow("environment"), namespace: this.runtime.getOrThrow("namespace"), repositoryRoot: "" });
          // Metadata only. Never call SecretRefPort.resolve/configured, environment or provider reads.
          if (!await tx.secretReference.findFirst({ where: { ref, status: "active", deletedAt: null }, select: { id: true } })) throw new BadRequestException("Active owned SecretRef metadata required");
        }
      }
      const next = validateSnapshot({ ...s.candidate, [key]: candidateValue });
      if (canonical(s.candidate) === canonical(next)) throw new ConflictException("Empty draft diff");
      const row = s.draft ? await tx.scopedConfig.update({ where: { id: s.draft.id, version: expected }, data: { configValue: canonical(next), version: { increment: 1 } } })
        : await tx.scopedConfig.create({ data: this.data(c, DRAFT, canonical(next)) });
      const audit = await this.access.audit(tx, actor.id, row.id, "mbti_draft_saved", "configuration", "scoped_config", correlationId, [key]);
      await tx.configurationChange.create({ data: { configId: row.id, configVersion: row.version, auditLogId: audit.id, operatorId: actor.id, scope: "project", scopeId: c.projectId,
        pluginCode: MBTI_PLUGIN, configKey: DRAFT, eventType: "mbti.draft.saved", changeMetadata: { categories: [key] } } });
      return this.view(c, { ...s, draft: row, candidate: next }, "draft");
    });
  }
  private async commit(tx: Prisma.TransactionClient, c: Context, operator: string, expected: number, next: MbtiSnapshot, action: "published" | "rollback", rollbackOf: number | null, correlationId?: string) {
    const current = await this.live(tx, c);
    if ((current.pointer?.version ?? 0) !== expected) throw new ConflictException("Published version conflict");
    const diff = this.diff(current.snapshot, next);
    if (!diff.length) throw new ConflictException("Empty publication diff");
    const configKey = SNAPSHOT + randomUUID(), nextVersion = expected + 1;
    await tx.scopedConfig.create({ data: { ...this.data(c, configKey, canonical(next)), version: nextVersion } });
    // ManagementAccess serializes first publication, and the predicate independently enforces CAS.
    if (current.pointer) {
      const updated = await tx.scopedConfig.updateMany({ where: { id: current.pointer.id, version: expected, deletedAt: null }, data: { configValue: configKey, version: { increment: 1 } } });
      if (updated.count !== 1) throw new ConflictException("Published version conflict");
    } else await tx.scopedConfig.create({ data: this.data(c, ACTIVE, configKey) });
    const pointer = (await this.row(tx, c, ACTIVE))!;
    const audit = await this.access.audit(tx, operator, pointer.id, `mbti_${action}`, "configuration", "scoped_config", correlationId, diff);
    await tx.configurationChange.create({ data: { configId: pointer.id, configVersion: nextVersion, auditLogId: audit.id, operatorId: operator, scope: "project", scopeId: c.projectId,
      pluginCode: MBTI_PLUGIN, configKey: ACTIVE, eventType: `mbti.${action}`, changeMetadata: { snapshotKey: configKey, previousVersion: expected, rollbackOf, categories: diff } } });
    return { version: nextVersion, auditLogId: audit.id, diff };
  }
  publish(operator: string, input: unknown, correlationId?: string) {
    const body = exactBody(input, ["expectedVersion", "expectedDraftVersion"]), expected = revision(body.expectedVersion), expectedDraft = revision(body.expectedDraftVersion);
    return this.access.write(operator, [CONFIGURATION_PERMISSION, SECRET_PERMISSION], async (tx, actor) => {
      const c = await this.context(tx, actor.id); if (!c.system) throw new ForbiddenException("Platform administrator required for publication");
      const s = await this.state(tx, c);
      if (!s.draft || s.draft.version !== expectedDraft) throw new ConflictException("Draft version conflict");
      return this.commit(tx, c, actor.id, expected, s.candidate, "published", null, correlationId);
    });
  }
  rollback(operator: string, targetInput: string, input: unknown, correlationId?: string) {
    const target = Number(targetInput); if (!/^[1-9][0-9]{0,9}$/.test(targetInput)) throw new BadRequestException("Invalid rollback version"); revision(target);
    const body = exactBody(input, ["expectedVersion"]), expected = revision(body.expectedVersion);
    return this.access.write(operator, [CONFIGURATION_PERMISSION, SECRET_PERMISSION], async (tx, actor) => {
      const c = await this.context(tx, actor.id); if (!c.system) throw new ForbiddenException("Platform administrator required for rollback");
      const pointer = this.usable(await this.row(tx, c, ACTIVE));
      if (!pointer || target >= pointer.version) throw new ConflictException("Earlier published version required");
      const change = await tx.configurationChange.findFirst({ where: { scope: "project", scopeId: c.projectId, pluginCode: MBTI_PLUGIN, configKey: ACTIVE, configId: pointer.id, configVersion: target, deletedAt: null, status: "recorded" } });
      const snapshotKey = (change?.changeMetadata as { snapshotKey?: string } | null)?.snapshotKey;
      if (!snapshotKey?.startsWith(SNAPSHOT)) throw new NotFoundException("Eligible version not found");
      const snapshot = this.usable(await this.row(tx, c, snapshotKey));
      if (!snapshot || snapshot.version !== target) throw new NotFoundException("Eligible version not found");
      // Deliberately never updates DRAFT: even a newer unpublished draft survives rollback.
      return this.commit(tx, c, actor.id, expected, this.parse(snapshot), "rollback", target, correlationId);
    });
  }
  version(operator: string, targetInput: string) {
    const target = Number(targetInput); if (!/^[1-9][0-9]{0,9}$/.test(targetInput)) throw new BadRequestException("Invalid version"); revision(target);
    return this.read(operator, async (tx, c) => {
      const change = await tx.configurationChange.findFirst({ where: { scope: "project", scopeId: c.projectId, pluginCode: MBTI_PLUGIN, configKey: ACTIVE, configVersion: target, deletedAt: null, status: "recorded" } });
      const key = (change?.changeMetadata as { snapshotKey?: string } | null)?.snapshotKey;
      if (!key?.startsWith(SNAPSHOT)) throw new NotFoundException("Published version not found");
      const row = this.usable(await this.row(tx, c, key));
      if (!row || row.version !== target) throw new NotFoundException("Published version not found");
      return { version: target, categories: projectSnapshot(this.parse(row), c.system), ...MBTI_UNKNOWN };
    });
  }
  audit(operator: string) {
    return this.read(operator, async (tx, c) => {
      const rows = await tx.configurationChange.findMany({ where: { scope: "project", scopeId: c.projectId, pluginCode: MBTI_PLUGIN, deletedAt: null, status: "recorded" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 100 });
      return rows.map(row => ({ id: row.id, event: row.eventType, version: row.configVersion, auditLogId: row.auditLogId, createdAt: row.createdAt,
        categories: ((row.changeMetadata as { categories?: string[] } | null)?.categories ?? []).filter(k => MBTI_CATEGORIES.includes(k as MbtiCategory) && (c.system || !systemCategory(k))) }));
    });
  }
  versions(operator: string) {
    return this.read(operator, async (tx, c) => {
      const changes = await tx.configurationChange.findMany({ where: { scope: "project", scopeId: c.projectId, pluginCode: MBTI_PLUGIN, configKey: ACTIVE, deletedAt: null, status: "recorded" },
        orderBy: [{ configVersion: "desc" }], take: 100 });
      return changes.map(row => ({ version: row.configVersion, event: row.eventType, auditLogId: row.auditLogId, createdAt: row.createdAt,
        categories: ((row.changeMetadata as { categories?: string[] } | null)?.categories ?? []).filter(k => MBTI_CATEGORIES.includes(k as MbtiCategory) && (c.system || !systemCategory(k))) }));
    });
  }
}
