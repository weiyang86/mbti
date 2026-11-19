// Source AdminService.listOperationLogs pagination/filter mechanism; existing writers remain the only write owners.
import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AUDIT_PERMISSION } from "../../../../scripts/audit-policy.cjs";
import { PrismaService } from "../prisma/prisma.service";
import { ManagementAccessService } from "../rbac/management-access.service";
import { PermissionsService } from "../rbac/permissions.service";
import { projectAudit } from "./audit-redaction";
import { AuditQueryDto } from "./dto";
@Injectable()
export class AuditQueryService {
  constructor(private readonly prisma: PrismaService, private readonly access: ManagementAccessService, private readonly permissions: PermissionsService) {}
  private read<T>(operator: string, operation: (tx: Prisma.TransactionClient) => Promise<T>) {
    return this.access.database(() => this.prisma.$transaction(async tx => {
      await this.permissions.authorizeInTransaction(tx, operator, [AUDIT_PERMISSION]); return operation(tx);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 2000, timeout: 2000 }));
  }
  list(query: AuditQueryDto, operator: string) {
    const start = query.startAt ? new Date(query.startAt) : undefined, end = query.endAt ? new Date(query.endAt) : undefined;
    if (start && !Number.isFinite(start.getTime()) || end && !Number.isFinite(end.getTime()) || start && end && start > end) throw new BadRequestException("Invalid audit time range");
    const where: Prisma.AuditLogWhereInput = { workspaceId: null,
      ...(query.module ? { module: query.module } : {}), ...(query.action ? { action: query.action } : {}), ...(query.status ? { status: query.status } : {}),
      ...(query.userId ? { userId: query.userId } : {}), ...(query.resourceId ? { resourceId: query.resourceId } : {}), ...(query.resourceType ? { resourceType: query.resourceType } : {}),
      ...(start || end ? { createdAt: { gte: start, lte: end } } : {}),
      ...(query.correlationId ? { requestSummary: { path: ["correlationId"], equals: query.correlationId } } : {}) };
    return this.read(operator, async tx => {
      const [total, rows] = await Promise.all([tx.auditLog.count({ where }), tx.auditLog.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: (query.page - 1) * query.pageSize, take: query.pageSize })]);
      return { items: rows.map(projectAudit), total, page: query.page, pageSize: query.pageSize };
    });
  }
  detail(id: string, operator: string) {
    return this.read(operator, async tx => { const row = await tx.auditLog.findFirst({ where: { id, workspaceId: null } }); if (!row) throw new NotFoundException("Audit record unavailable"); return projectAudit(row); });
  }
}
