// Directed source scoped resolution; fixed schema replaces unbounded arbitrary config/env values.
import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { parseSecretRef } from "../secret-center/secret-ref";
export const CONFIG_SCOPES = ["global", "organization", "project"] as const;
export type ConfigScope = typeof CONFIG_SCOPES[number];
export type TrustedProjectContext = { projectId: string; organizationId: string };
export function scopeIdFor(scope: ConfigScope, context: TrustedProjectContext): string { return scope === "global" ? "global" : scope === "organization" ? context.organizationId : context.projectId; }
export function assertTrustedScope(scope: ConfigScope, scopeId: string | undefined, context: TrustedProjectContext) {
  if (scopeId !== undefined && scopeId !== scopeIdFor(scope, context)) throw new ForbiddenException("Cross-scope configuration denied");
}
export function chooseConfigCandidate<T extends { scope: string }>(rows: readonly T[]): T | undefined {
  return ["project", "organization", "global"].map(scope => rows.find(row => row.scope === scope)).find(row => row !== undefined);
}
export type ConfigDefinition = { type: "string" | "boolean" | "number" | "secretRef"; public: boolean; sensitive: boolean; defaultValue?: string | number | boolean; pluginCode?: string; projectOnly?: boolean };
export const CONFIG_SCHEMA: Readonly<Record<string, ConfigDefinition>> = Object.freeze({
  "brand.displayName": { type: "string", public: true, sensitive: false, defaultValue: "AIJ" },
  "brand.primaryColor": { type: "string", public: true, sensitive: false, defaultValue: "#2563EB" },
  "brand.logoPath": { type: "string", public: true, sensitive: false, defaultValue: "/" },
  "capabilities.publicContextEnabled": { type: "boolean", public: true, sensitive: false, defaultValue: true },
  "internal.retentionDays": { type: "number", public: false, sensitive: false, defaultValue: 30 },
  "private.integrationRef": { type: "secretRef", public: false, sensitive: true },
  // AI configuration is project/plugin-owned. The shared configuration API validates and audits
  // these rows; the AI plugin remains the single runtime consumer and SecretRef owner.
  "ai.providerCode": { type: "string", public: false, sensitive: false, pluginCode: "aij-ai", projectOnly: true },
  "ai.modelCode": { type: "string", public: false, sensitive: false, pluginCode: "aij-ai", projectOnly: true },
  "ai.credentialRef": { type: "secretRef", public: false, sensitive: true, pluginCode: "aij-ai", projectOnly: true },
  "capabilities.ai.text.generate": { type: "boolean", public: false, sensitive: false, defaultValue: false, pluginCode: "aij-ai", projectOnly: true }
});
export function definitionFor(key: string): ConfigDefinition {
  if (!Object.hasOwn(CONFIG_SCHEMA, key)) throw new BadRequestException("Unknown configuration key"); return CONFIG_SCHEMA[key];
}
export function parseTypedConfig(key: string, raw: string, valueType: string): string | number | boolean {
  const def = definitionFor(key); if (valueType !== def.type) throw new BadRequestException("Configuration type mismatch");
  if (key === "private.integrationRef") return parseSecretRef(raw).ref;
  if (key === "ai.credentialRef") return parseSecretRef(raw).ref;
  if (key === "ai.providerCode" && !/^[a-z][a-z0-9-]{1,62}$/.test(raw)) throw new BadRequestException("Invalid AI provider code");
  if (key === "ai.modelCode" && !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(raw)) throw new BadRequestException("Invalid AI model code");
  if (key === "brand.displayName" && (!/^\S(?:[^\r\n]{0,62}\S)?$/.test(raw) || /secret|password|token|credential|bearer|sk-|<|>/i.test(raw))) throw new BadRequestException("Invalid display name");
  if (key === "brand.primaryColor" && !/^#[0-9a-fA-F]{6}$/.test(raw)) throw new BadRequestException("Invalid brand color");
  if (key === "brand.logoPath" && !/^\/(?:[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*(?:\.(?:svg|png|jpg|webp))?)?$/.test(raw)) throw new BadRequestException("Invalid brand path");
  if (def.type === "boolean") { if (!["true", "false"].includes(raw)) throw new BadRequestException("Invalid boolean"); return raw === "true"; }
  if (def.type === "number") { if (!/^[1-9][0-9]{0,2}$/.test(raw) || Number(raw) > 365) throw new BadRequestException("Invalid retention days"); return Number(raw); }
  return raw;
}
