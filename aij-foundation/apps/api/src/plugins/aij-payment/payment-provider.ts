import { BadRequestException, ServiceUnavailableException } from "@nestjs/common";

export const PAYMENT_PROVIDER_CODE = /^[a-z][a-z0-9-]{0,49}$/;
export const PAYMENT_PROVIDER_STATUSES = ["pending", "succeeded", "failed"] as const;
export type PaymentProviderStatus = typeof PAYMENT_PROVIDER_STATUSES[number];

/** The payment service constructs this from a business-authorized order snapshot.
 *  It is not a DTO and must never be populated directly from browser input. */
export type PaymentProviderRequest = Readonly<{
  projectId: string;
  paymentOrderId: string;
  paymentAttemptId: string;
  orderNo: string;
  amountMinor: string;
  currency: string;
  currencyExponent: number;
  idempotencyKey: string;
}>;

/** A normalized provider result. Raw bodies, credentials, and provider-selected amounts are excluded. */
export type PaymentProviderResult = Readonly<{
  providerReference: string;
  status: PaymentProviderStatus;
  observedAt: string;
}>;

export type PaymentProviderQuery = Readonly<{
  paymentOrderId: string;
  paymentAttemptId: string;
  providerReference: string;
}>;

/**
 * Trusted adapter contract. Implementations are statically registered by the host.
 * The credential is resolved by the server through SecretCenter and is never part
 * of a request/result DTO or persistence contract. Adapters do not own ledger state.
 */
export interface PaymentProvider {
  readonly providerCode: string;
  createPayment(request: PaymentProviderRequest, credential: string): Promise<unknown>;
  queryPayment(request: PaymentProviderQuery, credential: string): Promise<unknown>;
}

/** Only compiled host-owned adapter instances may enter this registry. */
export class PaymentProviderRegistry {
  private readonly providers: ReadonlyMap<string, PaymentProvider>;

  constructor(providers: readonly PaymentProvider[]) {
    const entries = new Map<string, PaymentProvider>();
    for (const provider of providers) {
      if (!provider || !PAYMENT_PROVIDER_CODE.test(provider.providerCode) || entries.has(provider.providerCode) ||
          typeof provider.createPayment !== "function" || typeof provider.queryPayment !== "function") {
        throw new Error("Payment provider registration is invalid");
      }
      entries.set(provider.providerCode, provider);
    }
    this.providers = entries;
  }

  get(providerCode: string): PaymentProvider {
    if (typeof providerCode !== "string" || !PAYMENT_PROVIDER_CODE.test(providerCode)) {
      throw new ServiceUnavailableException("Payment provider is unavailable");
    }
    const provider = this.providers.get(providerCode);
    if (!provider) throw new ServiceUnavailableException("Payment provider is unavailable");
    return provider;
  }
}

const IDENTIFIER = /^[A-Za-z0-9._:-]{1,128}$/;
const POSITIVE_MINOR_UNITS = /^[1-9][0-9]{0,18}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every(key => keys.includes(key));
}

/** Validate the server-built provider request before crossing the adapter boundary. */
export function validatePaymentProviderRequest(input: unknown): PaymentProviderRequest {
  const keys = ["projectId", "paymentOrderId", "paymentAttemptId", "orderNo", "amountMinor", "currency", "currencyExponent", "idempotencyKey"];
  if (!isRecord(input) || Object.keys(input).length !== keys.length || !hasOnlyKeys(input, keys) ||
      !["projectId", "paymentOrderId", "paymentAttemptId", "orderNo", "idempotencyKey"].every(key =>
        typeof input[key] === "string" && IDENTIFIER.test(input[key] as string)) ||
      typeof input.amountMinor !== "string" || !POSITIVE_MINOR_UNITS.test(input.amountMinor) ||
      BigInt(input.amountMinor) > 9_223_372_036_854_775_807n ||
      typeof input.currency !== "string" || !/^[A-Z]{3}$/.test(input.currency) ||
      !Number.isInteger(input.currencyExponent) || (input.currencyExponent as number) < 0 || (input.currencyExponent as number) > 6) {
    throw new BadRequestException("Invalid payment provider request");
  }
  return Object.freeze({
    projectId: input.projectId as string,
    paymentOrderId: input.paymentOrderId as string,
    paymentAttemptId: input.paymentAttemptId as string,
    orderNo: input.orderNo as string,
    amountMinor: input.amountMinor,
    currency: input.currency,
    currencyExponent: input.currencyExponent as number,
    idempotencyKey: input.idempotencyKey as string
  });
}

/** Reject provider-specific/raw fields so callers only receive a safe normalized receipt. */
export function validatePaymentProviderResult(input: unknown): PaymentProviderResult {
  const keys = ["providerReference", "status", "observedAt"];
  if (!isRecord(input) || Object.keys(input).length !== keys.length || !hasOnlyKeys(input, keys) ||
      typeof input.providerReference !== "string" || !IDENTIFIER.test(input.providerReference) ||
      typeof input.status !== "string" || !PAYMENT_PROVIDER_STATUSES.includes(input.status as PaymentProviderStatus) ||
      typeof input.observedAt !== "string" || !Number.isFinite(Date.parse(input.observedAt))) {
    throw new ServiceUnavailableException("Payment provider response is invalid");
  }
  return Object.freeze({
    providerReference: input.providerReference,
    status: input.status as PaymentProviderStatus,
    observedAt: new Date(input.observedAt).toISOString()
  });
}
