import { ConflictException } from "@nestjs/common";

export const PAYMENT_ORDER_STATES = ["created", "pending", "succeeded", "failed", "closed"] as const;
export type PaymentOrderState = typeof PAYMENT_ORDER_STATES[number];

export const PAYMENT_ATTEMPT_STATES = ["created", "submitting", "pending", "succeeded", "failed", "unknown", "cancelled"] as const;
export type PaymentAttemptState = typeof PAYMENT_ATTEMPT_STATES[number];

/** Transaction rows are append-only facts. A reversal/refund is another row, not an edit to a prior charge. */
export const PAYMENT_TRANSACTION_KINDS = ["charge", "refund", "reversal"] as const;
export type PaymentTransactionKind = typeof PAYMENT_TRANSACTION_KINDS[number];

const ORDER_TRANSITIONS: Readonly<Record<PaymentOrderState, readonly PaymentOrderState[]>> = Object.freeze({
  created: ["pending", "closed"] as const,
  pending: ["succeeded", "failed", "closed"] as const,
  succeeded: [] as const,
  failed: [] as const,
  closed: [] as const
});

const ATTEMPT_TRANSITIONS: Readonly<Record<PaymentAttemptState, readonly PaymentAttemptState[]>> = Object.freeze({
  created: ["submitting", "cancelled"] as const,
  submitting: ["pending", "succeeded", "failed", "unknown", "cancelled"] as const,
  pending: ["succeeded", "failed", "unknown", "cancelled"] as const,
  unknown: ["pending", "succeeded", "failed", "cancelled"] as const,
  succeeded: [] as const,
  failed: [] as const,
  cancelled: [] as const
});

export function assertPaymentOrderTransition(from: string, to: string): asserts to is PaymentOrderState {
  if (!Object.hasOwn(ORDER_TRANSITIONS, from) || !ORDER_TRANSITIONS[from as PaymentOrderState].includes(to as PaymentOrderState)) {
    throw new ConflictException("Payment order state transition is not allowed");
  }
}

export function assertPaymentAttemptTransition(from: string, to: string): asserts to is PaymentAttemptState {
  if (!Object.hasOwn(ATTEMPT_TRANSITIONS, from) || !ATTEMPT_TRANSITIONS[from as PaymentAttemptState].includes(to as PaymentAttemptState)) {
    throw new ConflictException("Payment attempt state transition is not allowed");
  }
}

export type PaymentTransactionFact = Readonly<{
  paymentOrderId: string;
  paymentAttemptId: string;
  kind: PaymentTransactionKind;
  providerReference: string;
  amountMinor: string;
  currency: string;
  occurredAt: string;
}>;

/** Fact validation used by the one payment-ledger owner before appending a provider observation. */
export function validatePaymentTransactionFact(input: unknown): PaymentTransactionFact {
  const value = input as Record<string, unknown> | null;
  const keys = ["paymentOrderId", "paymentAttemptId", "kind", "providerReference", "amountMinor", "currency", "occurredAt"];
  const identifier = (item: unknown) => typeof item === "string" && /^[A-Za-z0-9._:-]{1,128}$/.test(item);
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== keys.length ||
      Object.keys(value).some(key => !keys.includes(key)) ||
      !identifier(value.paymentOrderId) || !identifier(value.paymentAttemptId) ||
      typeof value.kind !== "string" || !PAYMENT_TRANSACTION_KINDS.includes(value.kind as PaymentTransactionKind) ||
      !identifier(value.providerReference) || typeof value.amountMinor !== "string" || !/^[1-9][0-9]{0,18}$/.test(value.amountMinor) ||
      BigInt(value.amountMinor) > 9_223_372_036_854_775_807n || typeof value.currency !== "string" || !/^[A-Z]{3}$/.test(value.currency) ||
      typeof value.occurredAt !== "string" || !Number.isFinite(Date.parse(value.occurredAt))) {
    throw new ConflictException("Payment transaction fact is invalid");
  }
  return Object.freeze({
    paymentOrderId: value.paymentOrderId as string,
    paymentAttemptId: value.paymentAttemptId as string,
    kind: value.kind as PaymentTransactionKind,
    providerReference: value.providerReference as string,
    amountMinor: value.amountMinor,
    currency: value.currency,
    occurredAt: new Date(value.occurredAt as string).toISOString()
  });
}
