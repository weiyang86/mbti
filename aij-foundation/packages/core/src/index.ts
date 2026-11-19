import { randomUUID } from "node:crypto";

const CORRELATION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

export type CorrelationHeaders = Record<string, string | string[] | undefined>;
export type CorrelationRequest = { headers: CorrelationHeaders; correlationId?: string };
export type CorrelationResponse = { setHeader(name: string, value: string): void };

export function resolveCorrelationId(value: unknown): string {
  const candidate = Array.isArray(value) ? value[0] : value;
  return typeof candidate === "string" && CORRELATION_PATTERN.test(candidate) ? candidate : randomUUID();
}

export function correlateRequest(request: CorrelationRequest, response: CorrelationResponse): string {
  const correlationId = resolveCorrelationId(request.correlationId ?? request.headers["x-correlation-id"]);
  request.correlationId = correlationId;
  response.setHeader("x-correlation-id", correlationId);
  return correlationId;
}
