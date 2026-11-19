import { ForbiddenException, Injectable, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { validPermissionCodes } from "../common/decorators/permissions.decorator";
import { dictionaryEffectivePermissions } from "../../../../scripts/dictionary-policy.cjs";

@Injectable()
export class PermissionsService {
  constructor(private readonly prisma: PrismaService) {}

  private async database<T>(operation: () => Promise<T>): Promise<T> {
    if (!(await this.prisma.readiness()).ready) throw new ServiceUnavailableException("Authorization service unavailable");
    try { return await operation(); }
    catch (error) {
      if (error instanceof UnauthorizedException || error instanceof ForbiddenException) throw error;
      throw new ServiceUnavailableException("Authorization service unavailable");
    }
  }
  async resolveInTransaction(client: Prisma.TransactionClient, id: string) {
    const user = await client.sysUser.findFirst({ where: { id, status: "active", deletedAt: null }, select: { id: true, isSuperAdmin: true,
      userRoles: { where: { role: { status: "active", deletedAt: null } }, select: { role: { select: { roleCode: true,
        permissions: { where: { permission: { status: "active" } }, select: { permission: { select: { permissionCode: true } } } } } } } } } });
    if (!user) throw new UnauthorizedException("Invalid administrator");
    const permissions = [...new Set(user.userRoles.flatMap(link => link.role.permissions.map(grant => grant.permission.permissionCode)))].sort();
    const activeCodes = (await client.sysPermission.findMany({ where: { status: "active" }, select: { permissionCode: true }, orderBy: { permissionCode: "asc" } })).map(permission => permission.permissionCode);
    // Raw role grants remain separate from the effective result used by every access surface.
    const effectivePermissions = user.isSuperAdmin ? activeCodes : dictionaryEffectivePermissions(permissions, activeCodes);
    return { id: user.id, isSuperAdmin: user.isSuperAdmin, roles: [...new Set(user.userRoles.map(link => link.role.roleCode))].sort(), permissions, effectivePermissions };
  }
  current(id: string) {
    return this.database(() => this.prisma.$transaction(client => this.resolveInTransaction(client, id),
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 2000, timeout: 2000 }));
  }

  // The same owner can check grants inside an existing protected write transaction.
  async authorizeInTransaction(client: Prisma.TransactionClient, id: string, required: string[]) {
    if (!validPermissionCodes(required)) throw new ForbiddenException("Permission denied");
    const user = await this.resolveInTransaction(client, id);
    if (!required.every(code => user.effectivePermissions.includes(code))) throw new ForbiddenException("Permission denied");
    return user;
  }

  async requirePermissions(id: string, required: string[], correlationId?: string) {
    if (!validPermissionCodes(required)) throw new ForbiddenException("Permission denied");
    return this.database(async () => {
      try {
        await this.prisma.$transaction(client => this.authorizeInTransaction(client, id, required), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 2000, timeout: 2000 });
      } catch (error) {
        if (!(error instanceof ForbiddenException)) throw error;
        // No request body, raw URL, JWT or client-supplied role/identity snapshots.
        await this.prisma.auditLog.create({ data: { module: "rbac", action: "permission_denied", userId: id, resourceType: "permission", status: "failed",
          errorMessage: "permission_denied", requestSummary: { requiredPermissions: [...new Set(required)], correlationId: correlationId || "unavailable" } } });
        throw error;
      }
    });
  }
  catalog() {
    return this.database(() => this.prisma.sysPermission.findMany({ where: { status: "active" }, orderBy: { permissionCode: "asc" },
      select: { permissionCode: true, permissionName: true, resourceType: true, module: true, action: true } }));
  }
}
