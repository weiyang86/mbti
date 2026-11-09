import { BadRequestException } from "@nestjs/common";
import type { IncomingHttpHeaders } from "node:http";
import { verifyWebhookSignature } from "../../integration-center/connector-webhook-signature";

export type PaymentCallbackSignatureHeaders = Readonly<{
  timestamp: string | undefined;
  eventId: string | undefined;
  signature: string | undefined;
}>;

/** Reuses the already-reviewed HMAC-SHA256/timing-safe primitive; payment owns its route and replay ledger. */
export function paymentCallbackSignatureHeaders(headers: IncomingHttpHeaders): PaymentCallbackSignatureHeaders {
  const single = (value: string | string[] | undefined) => typeof value === "string" ? value : undefined;
  return {
    timestamp: single(headers["x-aij-payment-timestamp"]),
    eventId: single(headers["x-aij-payment-event-id"]),
    signature: single(headers["x-aij-payment-signature"])
  };
}

export function verifyPaymentCallbackSignature(
  rawBody: Buffer | undefined,
  headers: PaymentCallbackSignatureHeaders,
  secret: string,
  context: Readonly<{ projectCode: string; providerCode: string; nowMilliseconds?: number }>
) {
  if (typeof headers.timestamp !== "string" || typeof headers.eventId !== "string" || typeof headers.signature !== "string") {
    throw new BadRequestException("Payment callback authentication headers are invalid");
  }
  return verifyWebhookSignature(rawBody, {
    timestamp: headers.timestamp,
    idempotencyKey: headers.eventId,
    signature: headers.signature
  }, secret, { projectCode: context.projectCode, connectorCode: context.providerCode, nowMilliseconds: context.nowMilliseconds });
}
