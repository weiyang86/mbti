import { BadRequestException, HttpException, HttpStatus, Injectable, ServiceUnavailableException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { parseSecretRef } from "../../secret-center/secret-ref";

export const AI_PLUGIN_CODE = "aij-ai" as const;
export const AI_CAPABILITY_CODES = ["text.generate"] as const;
export type AiCapabilityCode = typeof AI_CAPABILITY_CODES[number];

export type AiModelContract = Readonly<{
  modelCode: string;
  capabilities: readonly AiCapabilityCode[];
}>;

export type AiProviderRequest = Readonly<{
  modelCode: string;
  capabilityCode: AiCapabilityCode;
  payload: Readonly<Record<string, unknown>>;
  projectId?: string;
  traceId?: string;
  correlationId?: string;
  signal?: AbortSignal;
}>;

export type AiProviderUsage = Readonly<{
  promptTokens?: number;
  completionTokens?: number;
  cachedTokens?: number;
  imageCount?: number;
  /** Only an authoritative provider receipt may populate this amount; token-price estimates are not accepted here. */
  costAmountNanos?: string;
  costCurrency?: string;
}>;

export type AiProviderResult = Readonly<{ output: unknown; usage?: AiProviderUsage }>;

/** Implementations are trusted code registered by the host; caller input never selects a module path. */
export interface AiProvider {
  readonly providerCode: string;
  readonly models: readonly AiModelContract[];
  invoke(request: AiProviderRequest, credential: string): Promise<AiProviderResult>;
}

/** The registry is immutable after construction and accepts only host-owned adapters. */
export class AiProviderRegistry {
  private readonly providers: ReadonlyMap<string, AiProvider>;

  constructor(providers: readonly AiProvider[]) {
    const entries = new Map<string, AiProvider>();
    for (const provider of providers) {
      if (!provider || !PROVIDER_CODE.test(provider.providerCode) || entries.has(provider.providerCode) ||
          !Array.isArray(provider.models) || typeof provider.invoke !== "function") {
        throw new Error("AI provider registration is invalid");
      }
      const modelCodes = new Set<string>();
      for (const model of provider.models) {
        if (!model || !MODEL_CODE.test(model.modelCode) || modelCodes.has(model.modelCode) ||
            !Array.isArray(model.capabilities) || model.capabilities.length === 0 ||
            model.capabilities.some((code: unknown) => !isAiCapabilityCode(code))) {
          throw new Error("AI provider model registration is invalid");
        }
        modelCodes.add(model.modelCode);
      }
      entries.set(provider.providerCode, provider);
    }
    this.providers = entries;
  }

  get(providerCode: string): AiProvider {
    const provider = this.providers.get(providerCode);
    if (!provider) throw new ServiceUnavailableException("AI provider is unavailable");
    return provider;
  }
}

export type AiProviderConfiguration = Readonly<{
  providerCode: string;
  modelCode: string;
  credentialRef: string;
}>;

/** Reads provider selection and SecretRef metadata from the existing configuration owner. */
export abstract class AiProviderConfigurationPort {
  abstract resolveActive(
    tx: Prisma.TransactionClient,
    projectId: string,
    capabilityCode: AiCapabilityCode
  ): Promise<AiProviderConfiguration>;
}

/** Project feature flags are default-deny; the G16 configuration owner can supply the policy adapter. */
export abstract class AiCapabilityPolicyPort {
  abstract assertEnabled(
    tx: Prisma.TransactionClient,
    projectId: string,
    capabilityCode: AiCapabilityCode
  ): Promise<void>;
}

/** Budget truth is owned by the later AI Trace/Cost work; missing policy must deny execution. */
export abstract class AiBudgetAdmissionPort {
  abstract assertWithinBudget(
    tx: Prisma.TransactionClient,
    request: Readonly<{
      projectId: string;
      providerCode: string;
      modelCode: string;
      capabilityCode: AiCapabilityCode;
    }>
  ): Promise<void>;
}

export class AiBudgetExceededException extends HttpException {
  constructor() {
    super("AI budget exceeded", HttpStatus.TOO_MANY_REQUESTS);
  }
}

@Injectable()
export class UnconfiguredAiProviderConfiguration implements AiProviderConfigurationPort {
  async resolveActive(): Promise<AiProviderConfiguration> {
    throw new ServiceUnavailableException("AI provider configuration is unavailable");
  }
}

@Injectable()
export class DisabledAiCapabilityPolicy implements AiCapabilityPolicyPort {
  async assertEnabled(): Promise<void> {
    throw new ServiceUnavailableException("AI capability is unavailable");
  }
}

@Injectable()
export class UnconfiguredAiBudgetAdmission implements AiBudgetAdmissionPort {
  async assertWithinBudget(): Promise<void> {
    throw new ServiceUnavailableException("AI budget policy is unavailable");
  }
}

export function isAiCapabilityCode(value: unknown): value is AiCapabilityCode {
  return typeof value === "string" && (AI_CAPABILITY_CODES as readonly string[]).includes(value);
}

export function validateAiInvocation(input: unknown): Readonly<{
  capabilityCode: AiCapabilityCode;
  payload: Readonly<Record<string, unknown>>;
}> {
  if (!isRecord(input) || Object.keys(input).some(key => !["capabilityCode", "payload"].includes(key)) ||
      !isAiCapabilityCode(input.capabilityCode) || !isRecord(input.payload)) {
    throw new BadRequestException("Invalid AI invocation request");
  }
  let serialized: string;
  try {
    serialized = JSON.stringify(input.payload);
  } catch {
    throw new BadRequestException("Invalid AI invocation payload");
  }
  if (typeof serialized !== "string" || Buffer.byteLength(serialized, "utf8") > 64 * 1024) {
    throw new BadRequestException("AI invocation payload is invalid or too large");
  }
  let cleanPayload: Record<string, unknown>;
  try {
    cleanPayload = JSON.parse(serialized) as Record<string, unknown>;
  } catch {
    throw new BadRequestException("Invalid AI invocation payload");
  }
  return Object.freeze({ capabilityCode: input.capabilityCode, payload: deepFreeze(cleanPayload) });
}

export function validateAiProviderConfiguration(input: unknown): AiProviderConfiguration {
  if (!isRecord(input) || Object.keys(input).some(key => !["providerCode", "modelCode", "credentialRef"].includes(key)) ||
      typeof input.providerCode !== "string" || !PROVIDER_CODE.test(input.providerCode) ||
      typeof input.modelCode !== "string" || !MODEL_CODE.test(input.modelCode) ||
      typeof input.credentialRef !== "string") {
    throw new ServiceUnavailableException("AI provider configuration is unavailable");
  }
  try {
    parseSecretRef(input.credentialRef);
  } catch {
    throw new ServiceUnavailableException("AI provider credentials are unavailable");
  }
  return Object.freeze({ providerCode: input.providerCode, modelCode: input.modelCode, credentialRef: input.credentialRef });
}

export function validateAiProviderResult(input: unknown): AiProviderResult {
  if (!isRecord(input) || Object.keys(input).some(key => !["output", "usage"].includes(key)) || !Object.hasOwn(input, "output")) {
    throw new ServiceUnavailableException("AI provider response is invalid");
  }
  try {
    const serialized = JSON.stringify(input.output);
    if (serialized === undefined) throw new Error("not JSON");
    JSON.parse(serialized);
  } catch {
    throw new ServiceUnavailableException("AI provider response is invalid");
  }

  let usage: AiProviderUsage | undefined;
  if (input.usage !== undefined) {
    if (!isRecord(input.usage) || Object.keys(input.usage).some(key => ![
      "promptTokens", "completionTokens", "cachedTokens", "imageCount", "costAmountNanos", "costCurrency"
    ].includes(key))) throw new ServiceUnavailableException("AI provider usage is invalid");
    for (const key of ["promptTokens", "completionTokens", "cachedTokens", "imageCount"] as const) {
      const value = input.usage[key];
      if (value !== undefined && (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > 2_147_483_647)) {
        throw new ServiceUnavailableException("AI provider usage is invalid");
      }
    }
    const amount = input.usage.costAmountNanos;
    const currency = input.usage.costCurrency;
    if ((amount === undefined) !== (currency === undefined) ||
        amount !== undefined && (typeof amount !== "string" || !/^(?:0|[1-9][0-9]{0,18})$/.test(amount) ||
          BigInt(amount) > 9_223_372_036_854_775_807n) ||
        currency !== undefined && (typeof currency !== "string" || !/^[A-Z]{3}$/.test(currency))) {
      throw new ServiceUnavailableException("AI provider cost receipt is invalid");
    }
    usage = Object.freeze({
      ...(input.usage.promptTokens === undefined ? {} : { promptTokens: input.usage.promptTokens as number }),
      ...(input.usage.completionTokens === undefined ? {} : { completionTokens: input.usage.completionTokens as number }),
      ...(input.usage.cachedTokens === undefined ? {} : { cachedTokens: input.usage.cachedTokens as number }),
      ...(input.usage.imageCount === undefined ? {} : { imageCount: input.usage.imageCount as number }),
      ...(amount === undefined ? {} : { costAmountNanos: amount as string, costCurrency: currency as string })
    });
  }
  return Object.freeze({ output: input.output, ...(usage ? { usage } : {}) });
}

const PROVIDER_CODE = /^[a-z][a-z0-9-]{1,62}$/;
const MODEL_CODE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}
