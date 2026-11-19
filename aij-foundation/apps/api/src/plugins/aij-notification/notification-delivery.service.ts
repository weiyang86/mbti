import { BadRequestException, ConflictException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { isDeepStrictEqual } from "node:util";
import { PrismaService } from "../../prisma/prisma.service";
import { OutboxService } from "../../async-runtime/outbox.service";
import { JobService } from "../../async-runtime/job.service";
import { RuntimeRegistry } from "../../async-runtime/registry";
import { createRuntimeEvent } from "../../async-runtime/runtime-contracts";
import type { RuntimeEvent } from "../../async-runtime/runtime-contracts";
import { PluginRuntimeAccessService } from "../../plugin-runtime/plugin-runtime-access.service";
import type { WebhookNotificationProvider } from "./webhook-notification-provider";
import { WEBHOOK_UNKNOWN, WEBHOOK_DENIED, webhookError } from "./webhook-notification-policy";
import { NotificationProviderRegistry } from "./notification-provider";
import type { NotificationChannelType, NotificationDeliveryContext } from "./notification-provider";

export const NOTIFICATION_PLUGIN_CODE = "aij-notification";
export const NOTIFICATION_DELIVERY_EVENT = "aij-notification.delivery.requested";
export const NOTIFICATION_DELIVERY_JOB = "aij-notification.deliver";
const EVENT_VERSION = 1;
const JOB_VERSION = 1;
const KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

export type NotificationDeliveryRequest = Readonly<{
  messageId: string;
  recipientId: string;
  recipientAddress?: string;
  channelType: NotificationChannelType;
  title: string;
  body: string;
  contentType: "text" | "html";
}>;

type PersistedRequest = NotificationDeliveryRequest & Readonly<{ projectId: string }>;

@Injectable()
export class NotificationDeliveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly jobs: JobService,
    private readonly pluginAccess: PluginRuntimeAccessService,
    private readonly registry: RuntimeRegistry,
    private readonly providers: NotificationProviderRegistry
  ) {}

  onModuleInit(): void {
    this.registry.registerEvent(NOTIFICATION_DELIVERY_EVENT, EVENT_VERSION, (event, tx) => this.consumeRequest(event, tx));
    this.registry.registerOrchestratedJob(NOTIFICATION_DELIVERY_JOB, JOB_VERSION, (job) => this.deliver(job));
  }

  /** Call from the producer's transaction so business commit and notification intent commit together. */
  async requestDelivery(tx: Prisma.TransactionClient, input: NotificationDeliveryRequest, idempotencyKey: string, correlationId?: string) {
    const request = validateRequest(input);
    if (!KEY.test(idempotencyKey) || correlationId !== undefined && !KEY.test(correlationId)) {
      throw new BadRequestException("Invalid notification idempotency or correlation key");
    }
    const projectId = await this.pluginAccess.projectId(tx);
    await this.pluginAccess.assertEnabledInTransaction(tx, projectId, NOTIFICATION_PLUGIN_CODE);
    const event = createRuntimeEvent({
      type: NOTIFICATION_DELIVERY_EVENT, version: EVENT_VERSION, producer: NOTIFICATION_PLUGIN_CODE,
      scope: { type: "plugin", id: projectId, pluginCode: NOTIFICATION_PLUGIN_CODE },
      idempotencyKey, correlationId: correlationId || idempotencyKey, payload: { ...request, projectId }
    });
    const data = {
      id: event.id, eventType: event.type, eventVersion: event.version, occurredAt: new Date(event.occurredAt),
      producer: event.producer, scope: event.scope as Prisma.InputJsonValue, correlationId: event.correlationId,
      causationId: event.causationId, idempotencyKey: event.idempotencyKey, payload: event.payload as Prisma.InputJsonValue
    };
    const persisted = await tx.runtimeOutbox.upsert({
      where: { eventType_idempotencyKey: { eventType: event.type, idempotencyKey } },
      create: data,
      update: {}
    });
    if (persisted.deletedAt || persisted.eventVersion !== EVENT_VERSION || persisted.producer !== event.producer ||
        !isDeepStrictEqual(persisted.scope, event.scope) || !isDeepStrictEqual(persisted.payload, event.payload) ||
        persisted.correlationId !== event.correlationId || persisted.causationId !== (event.causationId || null)) {
      throw new ConflictException("Notification idempotency key was already used for a different request");
    }
    return { eventId: persisted.id, idempotencyKey: persisted.idempotencyKey };
  }

  /** Delivery state has one owner: RuntimeJob. Payloads and provider receipts are never returned here. */
  async status(eventId: string) {
    if (!KEY.test(eventId)) throw new BadRequestException("Invalid notification event id");
    return this.prisma.$transaction(async tx => {
      const projectId = await this.pluginAccess.projectId(tx);
      const row = await tx.runtimeJob.findFirst({
        where: { scope: "plugin", scopeId: projectId, pluginCode: NOTIFICATION_PLUGIN_CODE,
          jobType: NOTIFICATION_DELIVERY_JOB, idempotencyKey: `notification:${eventId}`, deletedAt: null },
        select: { id: true, status: true, attempts: true, maxAttempts: true, runAt: true, lastError: true, completedAt: true }
      });
      return row ? { eventId, jobId: row.id, status: row.status, attempts: row.attempts,
        maxAttempts: row.maxAttempts, nextAttemptAt: row.runAt, lastError: row.lastError, completedAt: row.completedAt } : null;
    });
  }

  private async consumeRequest(event: RuntimeEvent, transaction: unknown): Promise<void> {
    const tx = transaction as Prisma.TransactionClient;
    if (event.scope.type !== "plugin" || event.scope.pluginCode !== NOTIFICATION_PLUGIN_CODE) {
      throw terminalError("NOTIFICATION_EVENT_SCOPE_INVALID");
    }
    const request = validatePersistedRequest(event.payload);
    if (request.projectId !== event.scope.id) throw terminalError("NOTIFICATION_EVENT_SCOPE_INVALID");
    await this.jobs.enqueueInTransaction(tx, {
      type: NOTIFICATION_DELIVERY_JOB, version: JOB_VERSION, payload: request,
      scope: { type: "plugin", id: request.projectId, pluginCode: NOTIFICATION_PLUGIN_CODE },
      idempotencyKey: `notification:${event.id}`, dedupeKey: `notification:${event.id}`,
      correlationId: event.correlationId, maxAttempts: request.channelType === "webhook" ? 1 : 5, timeoutMs: 30_000
    });
  }

  private async deliver(job: Parameters<ReturnType<RuntimeRegistry["job"]>>[0]) {
    const request = validatePersistedRequest(job.payload);
    if (request.channelType === "webhook") {
      const leaseNonce = job.leaseNonce;
      const validNonce = typeof leaseNonce === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(leaseNonce);
      try {
        if (!validNonce) throw webhookError(WEBHOOK_UNKNOWN);
        if (job.attempt !== 1) throw webhookError(WEBHOOK_UNKNOWN);
        if (job.signal?.aborted) throw webhookError(WEBHOOK_UNKNOWN);
        const provider = this.providers.get("webhook") as WebhookNotificationProvider;
        const receipt = await provider.deliver({ ...request, attemptNo: job.attempt,
          idempotencyKey: job.idempotencyKey, correlationId: job.correlationId }, job.signal);
        return { resultReference: { providerMessageId: receipt.providerMessageId } };
      } catch (error) {
        const code = error instanceof Error && error.message === WEBHOOK_UNKNOWN ? WEBHOOK_UNKNOWN : WEBHOOK_DENIED;
        // Generic RuntimeJob sanitization intentionally discards arbitrary error strings. Persist only
        // our fixed safe terminal code under the admitted lease; its catch cannot overwrite this row.
        if (validNonce) await this.prisma.runtimeJob.updateMany({
          where: { id: job.id, status: "running", leaseOwner: job.leaseOwner ?? "invalid-webhook-lease", attempts: job.attempt ?? 0,
            leaseNonce, deletedAt: null, leaseExpiresAt: { gt: new Date() } },
          data: { status: "dead", lastError: code, leaseOwner: null, leaseNonce: null, leaseExpiresAt: null }
        });
        throw webhookError(code);
      }
    }
    const projectId = await this.prisma.$transaction(tx => this.pluginAccess.projectId(tx));
    if (request.projectId !== projectId) throw terminalError("NOTIFICATION_JOB_SCOPE_INVALID");
    await this.pluginAccess.assertEnabled(NOTIFICATION_PLUGIN_CODE);
    const provider = this.providers.get(request.channelType);
    const context: NotificationDeliveryContext = {
      ...request, attemptNo: job.attempt ?? 1, idempotencyKey: job.idempotencyKey,
      correlationId: job.correlationId
    };
    const receipt = await provider.deliver(context);
    return { resultReference: { providerMessageId: receipt.providerMessageId } };
  }
}

function validateRequest(input: NotificationDeliveryRequest): NotificationDeliveryRequest {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new BadRequestException("Invalid notification request");
  const allowed = new Set(["messageId", "recipientId", "recipientAddress", "channelType", "title", "body", "contentType"]);
  if (Object.keys(input).some(key => !allowed.has(key))) throw new BadRequestException("Notification request contains unsupported fields");
  const requiredKey = (value: unknown, label: string) => {
    if (typeof value !== "string" || !KEY.test(value)) throw new BadRequestException(`Invalid notification ${label}`);
    return value;
  };
  const text = (value: unknown, label: string, max: number) => {
    if (typeof value !== "string" || value.trim().length === 0 || value.length > max) throw new BadRequestException(`Invalid notification ${label}`);
    return value;
  };
  const channelType = input.channelType;
  if (!["in_app", "email", "sms", "wecom", "feishu", "webhook"].includes(channelType)) throw new BadRequestException("Unsupported notification channel");
  const recipientAddress = input.recipientAddress === undefined ? undefined : text(input.recipientAddress, "recipient address", 500);
  if (channelType !== "in_app" && !recipientAddress) throw new BadRequestException("External notification requires a recipient address");
  if (input.contentType !== "text" && input.contentType !== "html") throw new BadRequestException("Invalid notification content type");
  return {
    messageId: requiredKey(input.messageId, "message id"), recipientId: requiredKey(input.recipientId, "recipient id"),
    ...(recipientAddress ? { recipientAddress } : {}), channelType,
    title: text(input.title, "title", 500), body: text(input.body, "body", 100_000), contentType: input.contentType
  };
}

function validatePersistedRequest(value: unknown): PersistedRequest {
  if (!value || typeof value !== "object" || Array.isArray(value) || typeof (value as { projectId?: unknown }).projectId !== "string") {
    throw terminalError("NOTIFICATION_PAYLOAD_INVALID");
  }
  try {
    const { projectId, ...request } = value as Record<string, unknown> & { projectId: string };
    return { ...validateRequest(request as NotificationDeliveryRequest), projectId: requestKey(projectId) };
  } catch {
    throw terminalError("NOTIFICATION_PAYLOAD_INVALID");
  }
}

function requestKey(value: string): string {
  if (!KEY.test(value)) throw terminalError("NOTIFICATION_PAYLOAD_INVALID");
  return value;
}

function terminalError(code: string): Error {
  return Object.assign(new Error(code), { runtimeRetryable: false });
}
