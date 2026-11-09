import { BadRequestException } from "@nestjs/common";
import { PAYMENT_PROVIDER_STATUSES, type PaymentProviderStatus } from "./payment-provider";

export type PaymentCallbackPayload = Readonly<{
  eventId: string;
  orderNo: string;
  providerReference: string;
  status: PaymentProviderStatus;
  amountMinor: string;
  currency: string;
  occurredAt: string;
}>;

const IDENTIFIER = /^[A-Za-z0-9._:-]{1,128}$/;

/** Strict raw-body contract: unknown provider fields cannot enter the ledger or audit. */
export function validatePaymentCallbackPayload(input: unknown): PaymentCallbackPayload {
  const value = input as Record<string, unknown> | null;
  const keys = ["eventId", "orderNo", "providerReference", "status", "amountMinor", "currency", "occurredAt"];
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== keys.length ||
      Object.keys(value).some(key => !keys.includes(key)) ||
      typeof value.eventId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(value.eventId) ||
      typeof value.orderNo !== "string" || !IDENTIFIER.test(value.orderNo) ||
      typeof value.providerReference !== "string" || !IDENTIFIER.test(value.providerReference) ||
      typeof value.status !== "string" || !PAYMENT_PROVIDER_STATUSES.includes(value.status as PaymentProviderStatus) ||
      typeof value.amountMinor !== "string" || !/^[1-9][0-9]{0,18}$/.test(value.amountMinor) ||
      BigInt(value.amountMinor) > 9_223_372_036_854_775_807n ||
      typeof value.currency !== "string" || !/^[A-Z]{3}$/.test(value.currency) ||
      typeof value.occurredAt !== "string" || !Number.isFinite(Date.parse(value.occurredAt))) {
    throw new BadRequestException("Payment callback payload is invalid");
  }
  return Object.freeze({
    eventId: value.eventId as string,
    orderNo: value.orderNo as string,
    providerReference: value.providerReference as string,
    status: value.status as PaymentProviderStatus,
    amountMinor: value.amountMinor,
    currency: value.currency,
    occurredAt: new Date(value.occurredAt as string).toISOString()
  });
}
