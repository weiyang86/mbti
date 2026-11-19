import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma/client";
import { PLUGIN_MANAGEMENT_PERMISSION } from "../../../../../scripts/plugin-policy.cjs";
import { CONFIGURATION_PERMISSION } from "../../../../../scripts/configuration-policy.cjs";
import { SECRET_PERMISSION } from "../../../../../scripts/secret-policy.cjs";
import { ManagementAccessService } from "../../rbac/management-access.service";
import { PrismaService } from "../../prisma/prisma.service";
import { PluginRuntimeAccessService } from "../../plugin-runtime/plugin-runtime-access.service";
import { assertOwnedRef, SecretIdentity } from "../../secret-center/secret-ref";
import { NOTIFICATION_SECRET_CHANNELS, NotificationSecretChannel, UpdateNotificationChannelDto } from "./notification-management.dto";

const PLUGIN_CODE = "aij-notification";
const CONFIG_KEY = (channel: NotificationSecretChannel) => `notification.channel.${channel}.secretRef`;
const requiredPermissions = [PLUGIN_MANAGEMENT_PERMISSION, CONFIGURATION_PERMISSION, SECRET_PERMISSION];
const channels = [...NOTIFICATION_SECRET_CHANNELS] as const;

type ConfigRow = { id: string; configKey: string; configValue: string; valueType: string; status: string; version: number };

@Injectable()
export class NotificationManagementService {
  private readonly secretIdentity: SecretIdentity;

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ManagementAccessService,
    private readonly pluginAccess: PluginRuntimeAccessService,
    runtime: ConfigService
  ) {
    this.secretIdentity = {
      projectId: runtime.getOrThrow<string>("projectId"), environment: runtime.getOrThrow<string>("environment"),
      namespace: runtime.getOrThrow<string>("namespace"), repositoryRoot: runtime.getOrThrow<string>("repositoryRoot")
    };
  }

  async status() {
    return this.access.database(() => this.prisma.$transaction(async tx => {
      const projectId = await this.pluginAccess.projectId(tx);
      const installation = await tx.pluginInstallation.findUnique({
        where: { projectId_pluginCode: { projectId, pluginCode: PLUGIN_CODE } },
        select: { status: true, version: true, updatedAt: true }
      });
      const rows = await tx.scopedConfig.findMany({ where: {
        scope: "project", scopeId: projectId, pluginCode: PLUGIN_CODE, configKey: { in: channels.map(CONFIG_KEY) }, deletedAt: null
      }, select: { id: true, configKey: true, configValue: true, valueType: true, status: true, version: true } });
      const references = await tx.secretReference.findMany({ where: {
        ref: { in: rows.filter(row => row.valueType === "secretRef").map(row => row.configValue) }, status: "active", deletedAt: null
      }, select: { id: true, ref: true, provider: true } });
      const referencesByValue = new Map(references.map(reference => [reference.ref, reference]));
      const byKey = new Map(rows.map(row => [row.configKey, row]));
      const configuredChannels = channels.map(channel => this.channelStatus(channel, byKey.get(CONFIG_KEY(channel)), referencesByValue));
      return {
        plugin: { code: PLUGIN_CODE, installationStatus: installation?.status ?? "uninstalled", version: installation?.version ?? null,
          deliveryEnabled: installation?.status === "enabled", updatedAt: installation?.updatedAt ?? null },
        channels: [...configuredChannels, { channel: "in_app", requiresSecretRef: false, configured: true, referenceRegistered: true,
          credentialMaterialChecked: false, status: "available", version: 0 }]
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 2000, timeout: 3000 }));
  }

  updateChannel(channel: NotificationSecretChannel, dto: UpdateNotificationChannelDto, operatorId: string, correlationId?: string) {
    if (!channels.includes(channel)) throw new BadRequestException("Unsupported notification channel");
    if (!dto || typeof dto !== "object" || !Object.hasOwn(dto, "secretRef") ||
      !(dto.secretRef === null || typeof dto.secretRef === "string") ||
      !Number.isSafeInteger(dto.expectedVersion) || dto.expectedVersion < 0) {
      throw new BadRequestException("Invalid notification channel configuration");
    }
    const parsed = dto.secretRef === null ? null : assertOwnedRef(dto.secretRef, this.secretIdentity);

    return this.access.write(operatorId, requiredPermissions, async (tx, actor) => {
      const projectId = await this.pluginAccess.projectId(tx);
      // Serialize channel changes with lifecycle operations for this project/plugin.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"plugin-lifecycle:" + projectId + ":" + PLUGIN_CODE}))`;
      const installation = await tx.pluginInstallation.findUnique({
        where: { projectId_pluginCode: { projectId, pluginCode: PLUGIN_CODE } }, select: { status: true }
      });
      if (!installation || !["installed", "enabled"].includes(installation.status)) {
        throw new ConflictException("Install the notification plugin before configuring channels");
      }

      let referenceId: string | null = null;
      if (parsed && dto.secretRef) {
        const reference = await tx.secretReference.findFirst({ where: {
          ref: dto.secretRef, provider: parsed.provider, status: "active", deletedAt: null
        }, select: { id: true } });
        if (!reference) throw new NotFoundException("Registered secret reference unavailable");
        referenceId = reference.id;
      }

      const configKey = CONFIG_KEY(channel);
      const where = { scope_scopeId_pluginCode_configKey: { scope: "project", scopeId: projectId, pluginCode: PLUGIN_CODE, configKey } };
      const previous = await tx.scopedConfig.findUnique({ where });
      const previousVersion = previous?.version ?? 0;
      if (previous?.deletedAt || previousVersion !== dto.expectedVersion) throw new ConflictException("Notification configuration version conflict");

      let row: ConfigRow | null = previous;
      if (dto.secretRef !== null) {
        row = previous
          ? await tx.scopedConfig.update({ where: { id: previous.id, version: dto.expectedVersion }, data: {
            configValue: dto.secretRef, valueType: "secretRef", name: `Notification ${channel} SecretRef`, sensitive: true,
            isPublic: false, status: "active", version: { increment: 1 }
          } })
          : await tx.scopedConfig.create({ data: {
            scope: "project", scopeId: projectId, pluginCode: PLUGIN_CODE, configKey, configValue: dto.secretRef,
            valueType: "secretRef", name: `Notification ${channel} SecretRef`, sensitive: true, isPublic: false, status: "active"
          } });
      } else if (previous) {
        row = await tx.scopedConfig.update({ where: { id: previous.id, version: dto.expectedVersion }, data: { status: "disabled", version: { increment: 1 } } });
      }

      const nextVersion = row?.version ?? previousVersion;
      const configured = dto.secretRef !== null;
      const audit = await this.access.audit(tx, actor.id, row?.id ?? `${PLUGIN_CODE}:${channel}`, configured ? "notification-channel-configured" : "notification-channel-cleared",
        "aij-notification", "notification-channel", correlationId, ["channel", "secretRef", "expectedVersion"]);
      await tx.configurationChange.create({ data: {
        scope: "project", scopeId: projectId, pluginCode: PLUGIN_CODE, configKey, configId: row?.id ?? null,
        configVersion: row?.version ?? null, operatorId: actor.id, auditLogId: audit.id,
        eventType: configured ? "notification.channel.configured" : "notification.channel.cleared",
        changeMetadata: { channel, previousVersion, nextVersion, configured, ...(referenceId ? { secretReferenceId: referenceId } : {}) }
      } });
      return {
        channel, configured, referenceRegistered: configured, credentialMaterialChecked: false,
        ...(configured ? { secretRef: dto.secretRef } : {}), status: row?.status ?? "unconfigured", version: nextVersion
      };
    });
  }

  private channelStatus(channel: NotificationSecretChannel, row: ConfigRow | undefined, references: Map<string, { id: string; ref: string; provider: string }>) {
    let secretRef: string | undefined;
    let registered = false;
    if (row?.status === "active" && row.valueType === "secretRef") {
      try {
        const parsed = assertOwnedRef(row.configValue, this.secretIdentity);
        const reference = references.get(parsed.ref);
        if (reference?.provider === parsed.provider) { secretRef = parsed.ref; registered = true; }
      } catch { /* Corrupt/foreign references are unavailable and never echoed. */ }
    }
    const configured = Boolean(secretRef && registered);
    return {
      channel, requiresSecretRef: true, configured, referenceRegistered: registered, credentialMaterialChecked: false,
      ...(configured ? { secretRef } : {}), status: configured ? "configured" : row?.status === "disabled" ? "disabled" : "unconfigured",
      version: row?.version ?? 0
    };
  }
}
