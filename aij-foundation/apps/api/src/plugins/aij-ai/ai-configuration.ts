import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { parseTypedConfig } from "../../configuration/configuration-policy";
import { SecretRefPort } from "../../secret-center/secret-ref";
import {
  AI_CAPABILITY_CODES,
  AI_PLUGIN_CODE,
  AiCapabilityCode,
  AiCapabilityPolicyPort,
  AiProviderConfiguration,
  AiProviderConfigurationPort
} from "./ai-provider";

const CONFIG_KEYS = ["ai.providerCode", "ai.modelCode", "ai.credentialRef"] as const;

/** Reads the project-scoped AI entries owned by the shared ScopedConfig service. */
@Injectable()
export class ScopedAiProviderConfiguration extends AiProviderConfigurationPort {
  constructor(private readonly secrets: SecretRefPort) { super(); }

  async resolveActive(tx: Prisma.TransactionClient, projectId: string, capabilityCode: AiCapabilityCode): Promise<AiProviderConfiguration> {
    if (!AI_CAPABILITY_CODES.includes(capabilityCode)) throw new ServiceUnavailableException("AI capability is unavailable");
    const rows = await tx.scopedConfig.findMany({
      where: { scope: "project", scopeId: projectId, pluginCode: AI_PLUGIN_CODE, status: "active", deletedAt: null, configKey: { in: [...CONFIG_KEYS] } }
    });
    const byKey = new Map(rows.map(row => [row.configKey, row]));
    const provider = byKey.get("ai.providerCode"), model = byKey.get("ai.modelCode"), credential = byKey.get("ai.credentialRef");
    if (!provider || !model || !credential || provider.valueType !== "string" || model.valueType !== "string" || credential.valueType !== "secretRef") {
      throw new ServiceUnavailableException("AI provider configuration is unavailable");
    }
    const providerCode = parseTypedConfig(provider.configKey, provider.configValue, provider.valueType) as string;
    const modelCode = parseTypedConfig(model.configKey, model.configValue, model.valueType) as string;
    const credentialRef = parseTypedConfig(credential.configKey, credential.configValue, credential.valueType) as string;
    if (!await this.secrets.configuredTrusted(tx, credentialRef)) throw new ServiceUnavailableException("AI provider credentials are unavailable");
    return { providerCode, modelCode, credentialRef };
  }
}

/** Capability is default-deny and is read from the same project/plugin-scoped config owner. */
@Injectable()
export class ScopedAiCapabilityPolicy extends AiCapabilityPolicyPort {
  async assertEnabled(tx: Prisma.TransactionClient, projectId: string, capabilityCode: AiCapabilityCode): Promise<void> {
    if (!AI_CAPABILITY_CODES.includes(capabilityCode)) throw new ServiceUnavailableException("AI capability is unavailable");
    const row = await tx.scopedConfig.findUnique({
      where: { scope_scopeId_pluginCode_configKey: { scope: "project", scopeId: projectId, pluginCode: AI_PLUGIN_CODE, configKey: "capabilities.ai." + capabilityCode } }
    });
    if (!row || row.deletedAt || row.status !== "active" || row.valueType !== "boolean" ||
        parseTypedConfig(row.configKey, row.configValue, row.valueType) !== true) {
      throw new ServiceUnavailableException("AI capability is unavailable");
    }
  }
}
