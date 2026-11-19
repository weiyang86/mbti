import { randomUUID } from "node:crypto";
import { BadRequestException } from "@nestjs/common";
import type { OutboxTransaction, RuntimeEvent, RuntimeJobInput, RuntimeScope } from "@aij/runtime-contracts";
import { redactText } from "../audit-log/audit-redaction";

export type { OutboxTransaction, RuntimeEvent, RuntimeJobInput, RuntimeScope } from "@aij/runtime-contracts";

const TYPE = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/;
const KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const sensitiveKey = /password|secret|token|api.?key|authorization|cookie|credential|private.?key/i;

function sanitizedJson(value: unknown, depth = 0): unknown {
  if (depth > 24) throw new BadRequestException("runtime payload exceeds maximum depth");
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.map(item => sanitizedJson(item, depth + 1));
  if (typeof value !== "object" || value instanceof Date) {
    if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
    throw new BadRequestException("runtime payload must be JSON serializable");
  }
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (["__proto__", "constructor", "prototype"].includes(key)) throw new BadRequestException("runtime payload contains an invalid key");
    if (item === undefined) continue;
    result[key] = sensitiveKey.test(key) ? "[REDACTED]" : sanitizedJson(item, depth + 1);
  }
  return result;
}

export function safeRuntimePayload(value: unknown) {
  const result = sanitizedJson(value);
  try { JSON.stringify(result); }
  catch { throw new BadRequestException("runtime payload must be JSON serializable"); }
  return result;
}

function validateScope(scope: RuntimeScope) {
  if (!scope || !["global", "organization", "project", "plugin"].includes(scope.type) || typeof scope.id !== "string" || !KEY.test(scope.id)) {
    throw new BadRequestException("invalid runtime scope");
  }
  if (scope.type === "plugin" && (typeof scope.pluginCode !== "string" || !/^[a-z][a-z0-9-]{1,63}$/.test(scope.pluginCode))) {
    throw new BadRequestException("plugin scope requires a valid plugin code");
  }
  if (scope.type !== "plugin" && scope.pluginCode !== undefined) throw new BadRequestException("pluginCode is only valid for plugin scope");
}

export function createRuntimeEvent<T>(
  input: Omit<RuntimeEvent<T>, "id" | "occurredAt" | "payload"> & { id?: string; occurredAt?: string; payload: T }
): RuntimeEvent<T> {
  if (!TYPE.test(input.type)) throw new BadRequestException("event type must be explicitly namespaced");
  if (!Number.isInteger(input.version) || input.version < 1) throw new BadRequestException("event version must be positive");
  if (!KEY.test(input.idempotencyKey)) throw new BadRequestException("invalid event idempotencyKey");
  if (input.id !== undefined && !KEY.test(input.id)) throw new BadRequestException("invalid event id");
  if (input.correlationId !== undefined && !KEY.test(input.correlationId)) throw new BadRequestException("invalid event correlationId");
  if (input.causationId !== undefined && !KEY.test(input.causationId)) throw new BadRequestException("invalid event causationId");
  validateScope(input.scope);
  if (typeof input.producer !== "string" || !/^[a-z][a-z0-9.-]{1,127}$/.test(input.producer)) throw new BadRequestException("invalid event producer");
  const payload = safeRuntimePayload(input.payload);
  const id = input.id || randomUUID();
  return { ...input, id, occurredAt: input.occurredAt || new Date().toISOString(), correlationId: input.correlationId || id, payload: payload as T };
}

export function validateRuntimeJobInput(input: RuntimeJobInput) {
  if (!input || !TYPE.test(input.type) || !Number.isInteger(input.version) || input.version < 1) throw new BadRequestException("invalid runtime job type or version");
  validateScope(input.scope);
  if (!KEY.test(input.idempotencyKey)) throw new BadRequestException("invalid job idempotencyKey");
  if (input.id !== undefined && !KEY.test(input.id)) throw new BadRequestException("invalid job id");
  if (input.correlationId !== undefined && !KEY.test(input.correlationId)) throw new BadRequestException("invalid job correlationId");
  if (input.workspaceId !== undefined && (typeof input.workspaceId !== "string" || !KEY.test(input.workspaceId))) throw new BadRequestException("invalid job workspaceId");
  if (input.dedupeKey !== undefined && input.dedupeKey !== null && !KEY.test(input.dedupeKey)) throw new BadRequestException("invalid job dedupeKey");
  if (input.priority !== undefined && (!Number.isInteger(input.priority) || input.priority < -1000 || input.priority > 1000)) throw new BadRequestException("invalid job priority");
  if (input.maxAttempts !== undefined && (!Number.isInteger(input.maxAttempts) || input.maxAttempts < 1 || input.maxAttempts > 20)) throw new BadRequestException("invalid job maxAttempts");
  if (input.timeoutMs !== undefined && (!Number.isInteger(input.timeoutMs) || input.timeoutMs < 100 || input.timeoutMs > 300_000)) throw new BadRequestException("invalid job timeoutMs");
  if (input.runAt !== undefined && !(input.runAt instanceof Date && Number.isFinite(input.runAt.getTime()))) throw new BadRequestException("invalid job runAt");
  return { ...input, payload: safeRuntimePayload(input.payload) };
}

export async function writeOutboxInTransaction(tx: OutboxTransaction, event: RuntimeEvent) {
  await tx.runtimeOutbox.create({
    data: {
      id: event.id,
      eventType: event.type,
      eventVersion: event.version,
      occurredAt: new Date(event.occurredAt),
      producer: event.producer,
      scope: event.scope,
      correlationId: event.correlationId,
      causationId: event.causationId,
      idempotencyKey: event.idempotencyKey,
      payload: event.payload
    }
  });
  return event;
}

export function backoffAt(attempts: number, now = new Date(), baseMs = 1000, capMs = 300_000) {
  const delay = Math.min(capMs, baseMs * 2 ** Math.max(0, attempts - 1));
  return new Date(now.getTime() + delay);
}

export function safeRuntimeError(error: unknown) {
  // Provider/handler exceptions can contain arbitrary payloads or credentials. Persist and log a code only.
  void error;
  return "RUNTIME_OPERATION_FAILED";
}

export function runtimeErrorIsRetryable(error: unknown) {
  if (!error || typeof error !== "object" || !("runtimeRetryable" in error)) return true;
  return (error as { runtimeRetryable?: unknown }).runtimeRetryable === true;
}

export function scheduleIsDue(definition: { intervalMs?: number; cron?: string }, lastEnqueuedAt: Date | null, now: Date) {
  if (!lastEnqueuedAt) return true;
  if (definition.intervalMs) return now.getTime() - lastEnqueuedAt.getTime() >= definition.intervalMs;
  const match = /^\*\/(\d+) \* \* \* \*$/.exec(definition.cron || "");
  if (!match) throw new BadRequestException("V1 cron must use */N * * * *");
  return now.getTime() - lastEnqueuedAt.getTime() >= Number(match[1]) * 60_000;
}
