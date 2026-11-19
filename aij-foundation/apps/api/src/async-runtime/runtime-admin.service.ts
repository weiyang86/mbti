import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { ManagementAccessService } from "../rbac/management-access.service";
import { RUNTIME_MANAGE_PERMISSION } from "../../../../scripts/runtime-policy.cjs";
import { RuntimeJobListDto, RuntimeOutboxListDto } from "./runtime-admin.dto";
import { RuntimeHealthService } from "./runtime-health.service";

@Injectable()
export class RuntimeAdminService {
  constructor(private readonly prisma: PrismaService, private readonly access: ManagementAccessService, private readonly health: RuntimeHealthService) {}

  readiness() { return this.health.snapshot(); }

  async jobs(query: RuntimeJobListDto) {
    return this.access.database(async () => {
      const where = { deletedAt: null, ...(query.status ? { status: query.status as never } : {}) };
      const [total, rows] = await Promise.all([
        this.prisma.runtimeJob.count({ where }),
        this.prisma.runtimeJob.findMany({ where, orderBy: [{ priority: "desc" }, { createdAt: "desc" }], skip: (query.page - 1) * query.pageSize, take: query.pageSize,
          select: { id: true, jobType: true, jobVersion: true, scope: true, pluginCode: true, status: true, priority: true, runAt: true, attempts: true, maxAttempts: true, timeoutMs: true, resultReference: true, lastError: true, startedAt: true, completedAt: true, cancelledAt: true, createdAt: true } })
      ]);
      return { page: query.page, pageSize: query.pageSize, total, items: rows.map(row => ({ ...row, resultReference: row.resultReference ? { available: true } : null, hasError: !!row.lastError, lastError: undefined })) };
    });
  }

  async outbox(query: RuntimeOutboxListDto) {
    return this.access.database(async () => {
      const where = { deletedAt: null, ...(query.status ? { status: query.status as never } : {}) };
      const [total, rows] = await Promise.all([
        this.prisma.runtimeOutbox.count({ where }),
        this.prisma.runtimeOutbox.findMany({ where, orderBy: { createdAt: "desc" }, skip: (query.page - 1) * query.pageSize, take: query.pageSize,
          select: { id: true, eventType: true, eventVersion: true, producer: true, status: true, attempts: true, maxAttempts: true, nextAttemptAt: true, processedAt: true, lastError: true, createdAt: true } })
      ]);
      return { page: query.page, pageSize: query.pageSize, total, items: rows.map(row => ({ ...row, hasError: !!row.lastError, lastError: undefined })) };
    });
  }

  retryJob(id: string, operatorId: string, correlationId?: string) {
    return this.access.write(operatorId, [RUNTIME_MANAGE_PERMISSION], async tx => {
      const current = await tx.runtimeJob.findFirst({ where: { id, deletedAt: null }, select: { id: true, status: true } });
      if (!current) throw new NotFoundException("Runtime job not found");
      if (!["dead", "failed", "cancelled"].includes(current.status)) throw new ConflictException("Runtime job cannot be retried in its current state");
      const updated = await tx.runtimeJob.updateMany({ where: { id, status: current.status }, data: { status: "retry", attempts: 0, runAt: new Date(), lastError: null, cancelledAt: null, leaseOwner: null, leaseNonce: null, leaseExpiresAt: null } });
      if (updated.count !== 1) throw new ConflictException("Runtime state conflict");
      await this.access.audit(tx, operatorId, id, "job_retried", "runtime", "runtime_job", correlationId, ["status"]);
      return { id, status: "retry" };
    });
  }

  cancelJob(id: string, operatorId: string, correlationId?: string) {
    return this.access.write(operatorId, [RUNTIME_MANAGE_PERMISSION], async tx => {
      const current = await tx.runtimeJob.findFirst({ where: { id, deletedAt: null }, select: { id: true, status: true } });
      if (!current) throw new NotFoundException("Runtime job not found");
      if (!["pending", "retry"].includes(current.status)) throw new ConflictException("Runtime job cannot be cancelled in its current state");
      const updated = await tx.runtimeJob.updateMany({ where: { id, status: current.status }, data: { status: "cancelled", cancelledAt: new Date(), leaseOwner: null, leaseNonce: null, leaseExpiresAt: null } });
      if (updated.count !== 1) throw new ConflictException("Runtime state conflict");
      await this.access.audit(tx, operatorId, id, "job_cancelled", "runtime", "runtime_job", correlationId, ["status"]);
      return { id, status: "cancelled" };
    });
  }

  retryOutbox(id: string, operatorId: string, correlationId?: string) {
    return this.access.write(operatorId, [RUNTIME_MANAGE_PERMISSION], async tx => {
      const current = await tx.runtimeOutbox.findFirst({ where: { id, deletedAt: null }, select: { id: true, status: true } });
      if (!current) throw new NotFoundException("Runtime outbox event not found");
      if (!["dead", "retry"].includes(current.status)) throw new ConflictException("Runtime outbox event cannot be retried in its current state");
      const updated = await tx.runtimeOutbox.updateMany({ where: { id, status: current.status }, data: { status: "retry", attempts: 0, nextAttemptAt: new Date(), lastError: null, leaseOwner: null, leaseExpiresAt: null } });
      if (updated.count !== 1) throw new ConflictException("Runtime state conflict");
      await this.access.audit(tx, operatorId, id, "outbox_retried", "runtime", "runtime_outbox", correlationId, ["status"]);
      return { id, status: "retry" };
    });
  }
}
