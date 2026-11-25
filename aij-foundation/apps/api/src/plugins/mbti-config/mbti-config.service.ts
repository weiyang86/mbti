import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma, ScopedConfig } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { CONFIGURATION_PERMISSION } from "../../../../../scripts/configuration-policy.cjs";
import { SECRET_PERMISSION } from "../../../../../scripts/secret-policy.cjs";
import { PrismaService } from "../../prisma/prisma.service";
import { ManagementAccessService } from "../../rbac/management-access.service";
import { PermissionsService } from "../../rbac/permissions.service";
import { PluginRuntimeAccessService } from "../../plugin-runtime/plugin-runtime-access.service";
import { SecretRefPort } from "../../secret-center/secret-ref";
import { assertOwnedRef } from "../../secret-center/secret-ref";
import { MBTI_CATEGORIES, MBTI_UNKNOWN, MbtiCategory, MbtiSnapshot, MbtiValues, canonical, category, emptySnapshot, exactBody, projectSnapshot, revision, validateCategory, validateSnapshot } from "./mbti-config.schema";

import { MbtiChannel, projectPublicPublished } from "./mbti-config.public";
import { PAYMENT_CHANNEL_LABELS, WECHAT_PAY_CHANNELS, WechatPayChannel, paymentMissingFields, paymentSecretProblems } from "./mbti-payment-settings";
import { probeMerchant } from "./mbti-payment-probe";
import { buildWechatPayConfig } from "../../mbti/mbti-wechat-pay.config";

export const MBTI_PLUGIN = "mbti-config";
const ACTIVE = "release.active", DRAFT = "release.draft", SNAPSHOT = "release.version.";
const systemCategory = (key: string) => ["aiRuntime", "payments", "trade"].includes(key);
type Context = { projectId: string; system: boolean };

@Injectable()
export class MbtiConfigService {
  constructor(private readonly prisma: PrismaService, private readonly access: ManagementAccessService,
    private readonly permissions: PermissionsService, private readonly runtime: ConfigService, private readonly plugins: PluginRuntimeAccessService,
    @Optional() @Inject(SecretRefPort) private readonly secrets?: SecretRefPort) {}

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
      expectedDraftVersion: s.draft?.version ?? 0, authorization: { canSaveDraft: true, canPublish: c.system, canReadSystem: c.system }, view, source: { scope: "project", projectId: c.projectId, environment: this.runtime.getOrThrow<string>("environment"), pluginCode: MBTI_PLUGIN }, categories: projectSnapshot(view === "draft" ? s.candidate : s.snapshot, c.system),
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
  /** Anonymous published projection. Only reachable when MBTI_PUBLIC_APPROVED; always fresh, no draft/cache. */
  publicCandidate(channel: MbtiChannel) {
    return this.access.database(() => this.prisma.$transaction(async tx => {
      if (this.runtime.getOrThrow<string>("projectId") !== "mbti-foundation") throw new ForbiddenException("MBTI project required");
      const projectId = await this.plugins.projectId(tx);
      await this.plugins.assertEnabledInTransaction(tx, projectId, MBTI_PLUGIN);
      const live = await this.live(tx, { projectId, system: false });
      return projectPublicPublished(live.snapshot, projectId, channel, live.pointer?.version ?? 0);
    }, { maxWait: 3000, timeout: 5000 }));
  }
  /** Published category for business consumers; null when unconfigured or the plugin is unavailable. */
  private publishedCategory<K extends MbtiCategory>(key: K) {
    return this.access.database(() => this.prisma.$transaction(async tx => {
      if (this.runtime.getOrThrow<string>("projectId") !== "mbti-foundation") throw new ForbiddenException("MBTI project required");
      const projectId = await this.plugins.projectId(tx);
      await this.plugins.assertEnabledInTransaction(tx, projectId, MBTI_PLUGIN);
      const live = await this.live(tx, { projectId, system: false });
      return live.snapshot[key];
    }, { maxWait: 3000, timeout: 5000 }));
  }
  publishedAssessment() { return this.publishedCategory("assessment"); }
  publishedCatalog() { return this.publishedCategory("catalog"); }
  publishedDiscovery() { return this.publishedCategory("discovery"); }
  publishedCopy() { return this.publishedCategory("copy"); }
  /** Published channel payment settings consumed by the WeChat Pay runtime. */
  publishedPayments() { return this.publishedCategory("payments"); }
  private async paymentReferences(settings: MbtiValues["payments"][keyof MbtiValues["payments"]]) {
    return [settings.appSecretRef, settings.privateKeyRef, settings.apiV3KeyRef, settings.platformPublicKeyRef].filter(Boolean);
  }
  private async assertPaymentReferences(tx: Prisma.TransactionClient, settings: MbtiValues["payments"][keyof MbtiValues["payments"]]) {
    const identity = { projectId: "mbti-foundation", environment: this.runtime.getOrThrow<string>("environment"), namespace: this.runtime.getOrThrow<string>("namespace"), repositoryRoot: "" };
    for (const ref of await this.paymentReferences(settings)) {
      assertOwnedRef(ref, identity);
      if (!await tx.secretReference.findFirst({ where: { ref, status: "active", deletedAt: null }, select: { id: true } })) {
        throw new BadRequestException("支付凭据引用不存在或未启用，请先在密钥中心保存对应凭据");
      }
    }
  }
  saveDraft(operator: string, keyInput: string, input: unknown, correlationId?: string) {
    const key = category(keyInput), body = exactBody(input, ["value", "expectedDraftVersion"]), expected = revision(body.expectedDraftVersion), value = validateCategory(key, body.value);
    return this.access.write(operator, [CONFIGURATION_PERMISSION], async (tx, actor) => {
      const c = await this.context(tx, actor.id);
      if (systemCategory(key) && !c.system) throw new ForbiddenException("System configuration requires platform administrator and secret permission");
      const s = await this.state(tx, c);
      if ((s.draft?.version ?? 0) !== expected) throw new ConflictException("Draft version conflict");
      let candidateValue: unknown = value;
      if (key === "payments") {
        for (const channel of Object.values(value as MbtiValues["payments"])) await this.assertPaymentReferences(tx, channel);
      }
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
    await this.syncAssessment(tx, next.assessment);
    return { version: nextVersion, auditLogId: audit.id, diff };
  }
  /** Keeps the quiz consumer table in step with the published assessment snapshot.
   * Existing versions are immutable snapshots: a published different shape needs a new question bank version. */
  private async syncAssessment(tx: Prisma.TransactionClient, assessment: MbtiValues["assessment"] | null) {
    if (!assessment) return;
    const questions = assessment.questions.map(question => ({ id: question.id, index: question.index, dimension: question.dimension,
      prompt: question.prompt, options: question.options.map(option => ({ id: option.id, label: option.label })) }));
    const scoring: Record<string, Record<string, string>> = {};
    for (const question of assessment.questions) {
      scoring[question.id] = Object.fromEntries(question.options.map((option, index) =>
        [option.id, question.reverse ? question.dimension[1 - index]! : question.dimension[index]!]));
    }
    const payload = { question_bank_version: assessment.question_bank_version, questions };
    const existing = await tx.mbtiQuestionBank.findUnique({ where: { version: assessment.question_bank_version }, select: { version: true } });
    if (existing) return;
    await tx.mbtiQuestionBank.create({ data: { version: assessment.question_bank_version, payload, scoring } });
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
  /** Non-secret readiness check for one WeChat Pay channel; values are never returned. */
  async checkPayments(operator: string, channelInput: string) {
    if (!WECHAT_PAY_CHANNELS.includes(channelInput as WechatPayChannel)) throw new BadRequestException("Unknown payment channel");
    const channel = channelInput as WechatPayChannel;
    const settings = await this.read(operator, async (tx, c) => {
      if (!c.system) throw new ForbiddenException("System configuration requires platform administrator and secret permission");
      const s = await this.state(tx, c);
      return s.candidate.payments?.[channel] ?? null;
    });
    if (!settings) return { channel, label: PAYMENT_CHANNEL_LABELS[channel], ready: false, problems: ["支付配置尚未创建"], checkedAt: new Date().toISOString() };
    const problems: string[] = [];
    if (!settings.enabled) problems.push("渠道尚未允许新下单");
    if (settings.mode !== "live") problems.push("交易环境不是正式收款");
    const missing = paymentMissingFields(settings);
    if (missing.length) problems.push(`缺少：${missing.join("、")}`);
    if (!problems.length && this.secrets) {
      try {
        const [privateKey, apiV3Key, platform] = await Promise.all([
          this.secrets.resolveTrusted(settings.privateKeyRef),
          this.secrets.resolveTrusted(settings.apiV3KeyRef),
          this.secrets.resolveTrusted(settings.platformPublicKeyRef),
        ]);
        problems.push(...paymentSecretProblems(settings, { privateKey, apiV3Key, platformPublicKey: platform }));
      } catch {
        problems.push("服务端凭据不可用，请重新保存对应密钥");
      }
    }
    return { channel, label: PAYMENT_CHANNEL_LABELS[channel], ready: problems.length === 0, problems, checkedAt: new Date().toISOString() };
  }
  /** Signed, read-only probe against the real WeChat Pay API for one channel. */
  async probePayments(operator: string, channelInput: string) {
    if (!WECHAT_PAY_CHANNELS.includes(channelInput as WechatPayChannel)) throw new BadRequestException("Unknown payment channel");
    const channel = channelInput as WechatPayChannel;
    const settings = await this.read(operator, async (tx, c) => {
      if (!c.system) throw new ForbiddenException("System configuration requires platform administrator and secret permission");
      const s = await this.state(tx, c);
      return s.candidate.payments?.[channel] ?? null;
    });
    const unavailable = (message: string, hint: string) => ({
      channel, label: PAYMENT_CHANNEL_LABELS[channel], reachable: false, signatureValid: false, ok: false,
      status: 0, message, hint, probedAt: new Date().toISOString(),
    });
    if (!settings) return unavailable("支付配置尚未创建", "请先填写并保存支付参数");
    const missing = paymentMissingFields(settings);
    if (missing.length) return unavailable(`缺少：${missing.join("、")}`, "补齐字段后再验证商户连通性");
    if (!this.secrets) return unavailable("服务端凭据组件不可用", "请检查密钥中心配置");
    let values: { privateKey: string; apiV3Key: string; platformPublicKey: string };
    try {
      const [privateKey, apiV3Key, platformPublicKey] = await Promise.all([
        this.secrets.resolveTrusted(settings.privateKeyRef),
        this.secrets.resolveTrusted(settings.apiV3KeyRef),
        this.secrets.resolveTrusted(settings.platformPublicKeyRef),
      ]);
      values = { privateKey, apiV3Key, platformPublicKey };
    } catch {
      return unavailable("服务端凭据不可用", "请重新保存商户私钥、APIv3 密钥与验签公钥");
    }
    const built = buildWechatPayConfig(channel, settings, values);
    if ("problem" in built) return unavailable(built.problem, "请核对商户私钥、APIv3 密钥与验签公钥内容");
    const result = await probeMerchant(built.config);
    return { channel, label: PAYMENT_CHANNEL_LABELS[channel], ...result, probedAt: new Date().toISOString() };
  }
  version(operator: string, targetInput: string) {
    const target = Number(targetInput); if (!/^[1-9][0-9]{0,9}$/.test(targetInput)) throw new BadRequestException("Invalid version"); revision(target);
    return this.read(operator, async (tx, c) => {
      if (!c.system) throw new ForbiddenException("Platform administrator and secret permission required for release history");
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
      if (!c.system) throw new ForbiddenException("Platform administrator and secret permission required for release history");
      const rows = await tx.configurationChange.findMany({ where: { scope: "project", scopeId: c.projectId, pluginCode: MBTI_PLUGIN, deletedAt: null, status: "recorded" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 100 });
      return rows.map(row => ({ id: row.id, event: row.eventType, version: row.configVersion, auditLogId: row.auditLogId, createdAt: row.createdAt,
        categories: ((row.changeMetadata as { categories?: string[] } | null)?.categories ?? []).filter(k => MBTI_CATEGORIES.includes(k as MbtiCategory) && (c.system || !systemCategory(k))) }));
    });
  }
  versions(operator: string) {
    return this.read(operator, async (tx, c) => {
      if (!c.system) throw new ForbiddenException("Platform administrator and secret permission required for release history");
      const changes = await tx.configurationChange.findMany({ where: { scope: "project", scopeId: c.projectId, pluginCode: MBTI_PLUGIN, configKey: ACTIVE, deletedAt: null, status: "recorded" },
        orderBy: [{ configVersion: "desc" }], take: 100 });
      return changes.map(row => ({ version: row.configVersion, event: row.eventType, auditLogId: row.auditLogId, createdAt: row.createdAt,
        categories: ((row.changeMetadata as { categories?: string[] } | null)?.categories ?? []).filter(k => MBTI_CATEGORIES.includes(k as MbtiCategory) && (c.system || !systemCategory(k))) }));
    });
  }
}
