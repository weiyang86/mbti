import { BadRequestException, UnauthorizedException } from "@nestjs/common";
import { createHmac, timingSafeEqual } from "node:crypto";

export const WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS = 300;
export const WEBHOOK_MAX_BODY_BYTES = 65_536;

export type WebhookSignatureHeaders = Readonly<{
  timestamp: string | undefined;
  idempotencyKey: string | undefined;
  signature: string | undefined;
}>;

export type VerifiedWebhook = Readonly<{ timestampSeconds: number; idempotencyKey: string }>;
type ValidatedWebhookInput = VerifiedWebhook & Readonly<{ timestamp: string; signature: string }>;

function requiredHeader(value: string | undefined, pattern: RegExp, label: string): string {
  if (typeof value !== "string" || !pattern.test(value)) throw new BadRequestException("Invalid webhook " + label);
  return value;
}

export function webhookSigningBytes(projectCode: string, connectorCode: string, timestamp: string, idempotencyKey: string, rawBody: Buffer): Buffer {
  return Buffer.concat([Buffer.from("v1\n" + projectCode + "\n" + connectorCode + "\n" + timestamp + "\n" + idempotencyKey + "\n", "utf8"), rawBody]);
}

export function validateWebhookSignatureInput(
  rawBody: Buffer | undefined,
  headers: WebhookSignatureHeaders,
  context: Readonly<{ projectCode: string; connectorCode: string; nowMilliseconds?: number }>
): ValidatedWebhookInput {
  if (!Buffer.isBuffer(rawBody) || rawBody.length < 1 || rawBody.length > WEBHOOK_MAX_BODY_BYTES) {
    throw new BadRequestException("Invalid webhook body size");
  }
  const timestamp = requiredHeader(headers.timestamp, /^(?:0|[1-9][0-9]{9})$/, "timestamp");
  const idempotencyKey = requiredHeader(headers.idempotencyKey, /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/, "idempotency key");
  const signature = requiredHeader(headers.signature, /^v1=[0-9a-f]{64}$/, "signature");
  if (!/^[a-z][a-z0-9-]{1,62}$/.test(context.projectCode) || !/^[a-z][a-z0-9-]{1,62}$/.test(context.connectorCode)) {
    throw new BadRequestException("Invalid webhook route identity");
  }
  const timestampSeconds = Number(timestamp);
  const nowSeconds = Math.floor((context.nowMilliseconds ?? Date.now()) / 1000);
  if (!Number.isSafeInteger(timestampSeconds) || Math.abs(nowSeconds - timestampSeconds) > WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS) {
    throw new UnauthorizedException("Webhook authentication failed");
  }
  return { timestamp, signature, timestampSeconds, idempotencyKey };
}

export function verifyWebhookSignature(
  rawBody: Buffer | undefined,
  headers: WebhookSignatureHeaders,
  secret: string,
  context: Readonly<{ projectCode: string; connectorCode: string; nowMilliseconds?: number }>
): VerifiedWebhook {
  const validated = validateWebhookSignatureInput(rawBody, headers, context);
  const expected = createHmac("sha256", secret).update(webhookSigningBytes(context.projectCode, context.connectorCode, validated.timestamp, validated.idempotencyKey, rawBody!)).digest();
  const received = Buffer.from(validated.signature.slice(3), "hex");
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    throw new UnauthorizedException("Webhook authentication failed");
  }
  return { timestampSeconds: validated.timestampSeconds, idempotencyKey: validated.idempotencyKey };
}
