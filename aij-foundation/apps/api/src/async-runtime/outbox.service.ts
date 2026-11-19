import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Prisma, RuntimeOutboxStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { backoffAt, createRuntimeEvent, OutboxTransaction, RuntimeEvent, runtimeErrorIsRetryable, safeRuntimeError, writeOutboxInTransaction } from "./runtime-contracts";
import { RuntimeRegistry } from "./registry";
import { PluginRuntimeAccessService } from "../plugin-runtime/plugin-runtime-access.service";

type TransactionClient = Prisma.TransactionClient;
type ClaimedOutbox = {
  id: string; event_type: string; event_version: number; occurred_at: Date; producer: string; scope: Prisma.JsonValue;
  correlation_id: string | null; causation_id: string | null; idempotency_key: string; payload: Prisma.JsonValue;
  attempts: number; max_attempts: number; lease_owner: string;
};

@Injectable()
export class OutboxService {
  private readonly logger = new Logger(OutboxService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: RuntimeRegistry,
    private readonly pluginAccess: PluginRuntimeAccessService
  ) {}

  async enqueue(tx: TransactionClient, eventInput: Omit<RuntimeEvent, "id" | "occurredAt"> & { id?: string; occurredAt?: string }) {
    const event = createRuntimeEvent(eventInput);
    return writeOutboxInTransaction(tx as unknown as OutboxTransaction, event);
  }

  async claim(instanceId: string, limit = 20, leaseMs = 30_000): Promise<ClaimedOutbox[]> {
    if (!/^[A-Za-z0-9._:-]{1,128}$/.test(instanceId) || !Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(leaseMs) || leaseMs < 1000 || leaseMs > 300_000) {
      throw new BadRequestException("invalid outbox claim options");
    }
    const registered = this.registry.registeredEventDefinitions();
    if (!registered.length) return [];
    const enabledPlugins = await this.pluginAccess.enabledCodes();
    const eventAllowlist = Prisma.join(registered.map((entry) => Prisma.sql`(${entry.type}, ${entry.version})`));
    const pluginFilter = enabledPlugins.length
      ? Prisma.sql`AND (scope->>'type' <> 'plugin' OR scope->>'pluginCode' IN (${Prisma.join(enabledPlugins)}))`
      : Prisma.sql`AND scope->>'type' <> 'plugin'`;
    await this.prisma.$executeRaw(Prisma.sql`
      UPDATE runtime_outbox SET status = 'dead', last_error = 'lease_expired_at_attempt_limit', lease_owner = NULL, lease_expires_at = NULL, updated_at = NOW()
      WHERE status = 'processing' AND lease_expires_at < NOW() AND attempts >= max_attempts
        AND (event_type, event_version) IN (${eventAllowlist}) ${pluginFilter}
    `);
    return this.prisma.$queryRaw<ClaimedOutbox[]>(Prisma.sql`
      WITH candidates AS (
        SELECT id FROM runtime_outbox
        WHERE deleted_at IS NULL AND next_attempt_at <= NOW()
          AND (event_type, event_version) IN (${eventAllowlist})
          ${pluginFilter}
          AND attempts < max_attempts AND (status IN ('pending', 'retry') OR (status = 'processing' AND lease_expires_at < NOW()))
        ORDER BY next_attempt_at, created_at
        FOR UPDATE SKIP LOCKED LIMIT ${limit}
      )
      UPDATE runtime_outbox o SET status = 'processing', lease_owner = ${instanceId},
        lease_expires_at = NOW() + (${leaseMs} * INTERVAL '1 millisecond'), attempts = attempts + 1, updated_at = NOW()
      FROM candidates c WHERE o.id = c.id
      RETURNING o.id, o.event_type, o.event_version, o.occurred_at, o.producer, o.scope, o.correlation_id,
        o.causation_id, o.idempotency_key, o.payload, o.attempts, o.max_attempts, o.lease_owner
    `);
  }

  async deliver(row: ClaimedOutbox) {
    const event: RuntimeEvent = {
      id: row.id, type: row.event_type, version: row.event_version, occurredAt: row.occurred_at.toISOString(), producer: row.producer,
      scope: row.scope as RuntimeEvent["scope"], correlationId: row.correlation_id || undefined, causationId: row.causation_id || undefined,
      idempotencyKey: row.idempotency_key, payload: row.payload
    };
    try {
      const handler = this.registry.event(event.type, event.version);
      await this.prisma.$transaction(async (tx) => {
        const key = `event:${event.type}:${event.id}`;
        const existing = await tx.runtimeIdempotency.findUnique({
          where: { requestScope_scope_scopeId_pluginCode_owner_idempotencyKey: { requestScope: "event", scope: event.scope.type, scopeId: event.scope.id, pluginCode: event.scope.pluginCode || "", owner: `${event.type}@${event.version}`, idempotencyKey: key } }
        });
        if (existing && existing.status !== "completed") throw new Error("event idempotency record is still processing");
        if (!existing) {
          await tx.runtimeIdempotency.create({ data: { requestScope: "event", scope: event.scope.type, scopeId: event.scope.id, pluginCode: event.scope.pluginCode || "", owner: `${event.type}@${event.version}`, idempotencyKey: key, expiresAt: new Date(Date.now() + 30 * 86400_000) } });
          await handler(event, tx);
          await tx.runtimeIdempotency.update({ where: { requestScope_scope_scopeId_pluginCode_owner_idempotencyKey: { requestScope: "event", scope: event.scope.type, scopeId: event.scope.id, pluginCode: event.scope.pluginCode || "", owner: `${event.type}@${event.version}`, idempotencyKey: key } }, data: { status: "completed", resultReference: { outboxId: event.id } } });
        }
        const completed = await tx.runtimeOutbox.updateMany({ where: { id: row.id, status: "processing", leaseOwner: row.lease_owner }, data: { status: "processed", processedAt: new Date(), leaseOwner: null, leaseExpiresAt: null, lastError: null } });
        if (completed.count !== 1) throw new Error("outbox lease ownership changed before completion");
      });
      this.logger.log(JSON.stringify({ message: "outbox processed", eventId: event.id, eventType: event.type, correlationId: event.correlationId }));
    } catch (error) {
      const dead = !runtimeErrorIsRetryable(error) || row.attempts >= row.max_attempts;
      const changed = await this.prisma.runtimeOutbox.updateMany({ where: { id: row.id, status: "processing", leaseOwner: row.lease_owner }, data: { status: dead ? "dead" : "retry", nextAttemptAt: backoffAt(row.attempts), lastError: safeRuntimeError(error), leaseOwner: null, leaseExpiresAt: null } });
      if (changed.count !== 1) return;
      this.logger.warn(JSON.stringify({ message: "outbox delivery failed", eventId: row.id, eventType: row.event_type, correlationId: row.correlation_id, status: dead ? "dead" : "retry", error: safeRuntimeError(error) }));
    }
  }

  list(status?: RuntimeOutboxStatus, take = 100) {
    return this.prisma.runtimeOutbox.findMany({ where: { deletedAt: null, ...(status ? { status } : {}) }, orderBy: { createdAt: "desc" }, take, select: { id: true, eventType: true, eventVersion: true, producer: true, scope: true, correlationId: true, status: true, attempts: true, maxAttempts: true, nextAttemptAt: true, processedAt: true, lastError: true, createdAt: true } });
  }

  async retry(id: string) {
    const row = await this.prisma.runtimeOutbox.findFirst({ where: { id, deletedAt: null } });
    if (!row) throw new NotFoundException("outbox event not found");
    if (!["dead", "retry"].includes(row.status)) throw new BadRequestException("only retry or dead outbox events can be retried manually");
    return this.prisma.runtimeOutbox.update({ where: { id }, data: { status: "retry", attempts: 0, nextAttemptAt: new Date(), lastError: null, leaseOwner: null, leaseExpiresAt: null } });
  }
}
