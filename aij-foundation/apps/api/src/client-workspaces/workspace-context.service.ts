import { ForbiddenException, Injectable, ServiceUnavailableException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import type { ClientWorkspaceContext } from "../client-auth/client-auth.security";

const WORKSPACE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const PERMISSION_CODE = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;

@Injectable()
export class WorkspaceContextService {
  constructor(private readonly prisma: PrismaService) {}

  /** Caller owns the transaction and acquires any project/plugin lifecycle locks first. */
  async assertWritePermissionInTransaction(tx: Prisma.TransactionClient, memberId: string, workspaceId: string, permission: string): Promise<void> {
    if (typeof memberId !== "string" || !WORKSPACE_ID.test(memberId) ||
        typeof workspaceId !== "string" || !WORKSPACE_ID.test(workspaceId) ||
        typeof permission !== "string" || permission.length > 128 || !PERMISSION_CODE.test(permission)) {
      throw new ForbiddenException("Workspace access denied");
    }
    try {
      // Shared with membership status/role management; never starts a nested transaction.
      const key = "aij-client-workspace-membership:" + workspaceId;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
      // Match resolve's active grants and also fence the member identity. Row
      // locks protect against direct status/grant changes until the caller commits.
      const memberships = await tx.$queryRaw<{ id: string }[]>`
        SELECT m.id FROM public.client_workspace_membership m
        JOIN public.member_user u ON u.id = m.member_id
        JOIN public.client_workspace w ON w.id = m.workspace_id
        JOIN public.client_workspace_role r ON r.id = m.role_id AND r.workspace_id = m.workspace_id
        JOIN public.client_workspace_role_permission g ON g.role_id = r.id
        JOIN public.client_workspace_permission p ON p.id = g.permission_id
        WHERE m.member_id = ${memberId} AND m.workspace_id = ${workspaceId}
          AND m.status = 'active' AND m.disabled_at IS NULL AND m.removed_at IS NULL AND m.deleted_at IS NULL
          AND u.status = 'active' AND u.deleted_at IS NULL
          AND w.status = 'active' AND w.deleted_at IS NULL
          AND r.status = 'active' AND r.deleted_at IS NULL
          AND g.deleted_at IS NULL AND p.code = ${permission} AND p.status = 'active' AND p.deleted_at IS NULL
        FOR SHARE OF u, w, m, r, g, p`;
      if (!memberships.length) throw new ForbiddenException("Workspace access denied");
    } catch (error) {
      if (error instanceof ForbiddenException) throw error;
      throw new ServiceUnavailableException("Workspace context unavailable");
    }
  }

  async resolve(memberId: string, workspaceId: string, requiredPermissions: readonly string[]): Promise<ClientWorkspaceContext> {
    if (!memberId || !WORKSPACE_ID.test(workspaceId) || !requiredPermissions.length) {
      throw new ForbiddenException("Workspace access denied");
    }
    try {
      const membership = await this.prisma.clientWorkspaceMembership.findFirst({
        where: {
          memberId,
          workspaceId,
          status: "active",
          disabledAt: null,
          removedAt: null,
          deletedAt: null,
          workspace: { is: { status: "active", deletedAt: null } },
          role: { is: { status: "active", deletedAt: null } }
        },
        select: {
          workspace: { select: { id: true, code: true, name: true } },
          role: {
            select: {
              id: true,
              code: true,
              rolePermissions: {
                where: {
                  deletedAt: null,
                  permission: { is: { status: "active", deletedAt: null } }
                },
                select: { permission: { select: { code: true } } }
              }
            }
          }
        }
      });
      if (!membership) throw new ForbiddenException("Workspace access denied");
      const permissions = [...new Set(membership.role.rolePermissions.map(grant => grant.permission.code))].sort();
      if (!requiredPermissions.every(code => permissions.includes(code))) {
        throw new ForbiddenException("Workspace access denied");
      }
      return Object.freeze({
        workspaceId: membership.workspace.id,
        workspaceCode: membership.workspace.code,
        workspaceName: membership.workspace.name,
        roleId: membership.role.id,
        roleCode: membership.role.code,
        permissions
      });
    } catch (error) {
      if (error instanceof ForbiddenException) throw error;
      throw new ServiceUnavailableException("Workspace context unavailable");
    }
  }
}
