import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { PermissionsService } from "./permissions.service";

export type ManagementActor = { id: string; isSuperAdmin: boolean };
export type PermissionAssignmentChange = { before: string[]; after: string[] };
// Shared owner for administrator and RBAC writes; extracted from the accepted AF-015 transaction.
@Injectable()
export class ManagementAccessService {
  constructor(private readonly prisma: PrismaService, private readonly permissions: PermissionsService) {}
  async database<T>(operation: () => Promise<T>): Promise<T> {
    if (!(await this.prisma.readiness()).ready) throw new ServiceUnavailableException("Management service unavailable");
    try { return await operation(); }
    catch (error) {
      if (error instanceof BadRequestException || error instanceof ConflictException || error instanceof ForbiddenException || error instanceof NotFoundException || error instanceof UnauthorizedException) throw error;
      if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2003"].includes(error.code)) throw new ConflictException("Management state conflict");
      throw new ServiceUnavailableException("Management service unavailable");
    }
  }
  write<T>(id: string, required: string[], operation: (tx: Prisma.TransactionClient, actor: ManagementActor) => Promise<T>) {
    return this.database(() => this.prisma.$transaction(async tx => {
      // Same database-local lock as AF-015, so account changes and authorization writes serialize.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('aij-admin-users-write'))`;
      return operation(tx, await this.permissions.authorizeInTransaction(tx, id, required));
    }, { maxWait: 3000, timeout: 5000 }));
  }
  async audit(tx: Prisma.TransactionClient, operatorId: string, id: string, action: string, module: string, resourceType: string, correlationId?: string, fields: string[] = [], permissionChange?: PermissionAssignmentChange) {
    return tx.auditLog.create({ data: { module, action, userId: operatorId, resourceType, resourceId: id, status: "success",
      requestSummary: { correlationId: correlationId || "unavailable", fields,
        ...(permissionChange ? { permissionIdsBefore: permissionChange.before, permissionIdsAfter: permissionChange.after } : {}) } } });
  }
}
