import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import {
  ChangeClientWorkspaceMembershipRoleDto,
  ChangeClientWorkspaceMembershipStatusDto,
  CreateClientWorkspaceDto,
  CreateClientWorkspaceMembershipDto,
  UpdateClientWorkspaceDto
} from "./client-workspace.dto";
import { CLIENT_WORKSPACE_PERMISSION, CLIENT_WORKSPACE_PERMISSION_DEFINITIONS } from "./client-workspace-permissions";

const activeMembershipWhere = {
  status: "active",
  disabledAt: null,
  removedAt: null,
  deletedAt: null,
  workspace: { is: { status: "active", deletedAt: null } },
  role: { is: { status: "active", deletedAt: null } }
} as const;

type WorkspaceAudit = {
  actorId: string;
  correlationId?: string;
  workspaceId: string;
  resourceType: string;
  resourceId?: string;
  action: string;
  method: string;
  path: string;
  beforeData?: Prisma.InputJsonValue;
  afterData?: Prisma.InputJsonValue;
};

@Injectable()
export class ClientWorkspaceManagementService {
  constructor(private readonly prisma: PrismaService) {}

  private async run<T>(operation: () => Promise<T>): Promise<T> {
    try {
      if (!(await this.prisma.readiness()).ready) {
        throw new ServiceUnavailableException("Workspace service unavailable");
      }
      return await operation();
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException("Workspace service unavailable");
    }
  }

  private async audit(tx: Prisma.TransactionClient, entry: WorkspaceAudit) {
    return tx.auditLog.create({
      data: {
        module: "client-workspaces",
        action: entry.action,
        userId: entry.actorId,
        method: entry.method,
        path: entry.path,
        requestSummary: { correlationId: entry.correlationId || "unavailable" },
        status: "success",
        resourceType: entry.resourceType,
        resourceId: entry.resourceId,
        beforeData: entry.beforeData,
        afterData: entry.afterData,
        workspaceId: entry.workspaceId
      }
    });
  }

  private async lockWorkspace(tx: Prisma.TransactionClient, workspaceId: string) {
    const key = "aij-client-workspace-membership:" + workspaceId;
    // PostgreSQL advisory lock returns void; executeRaw avoids Prisma's unsupported void deserialization.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
  }

  private async ensurePermissionCatalog(tx: Prisma.TransactionClient) {
    await tx.clientWorkspacePermission.createMany({
      data: CLIENT_WORKSPACE_PERMISSION_DEFINITIONS.map(permission => ({ ...permission, status: "active" })),
      skipDuplicates: true
    });
    const permissions = await tx.clientWorkspacePermission.findMany({
      where: { code: { in: CLIENT_WORKSPACE_PERMISSION_DEFINITIONS.map(permission => permission.code) } },
      select: { id: true, code: true, name: true, status: true, deletedAt: true }
    });
    const byCode = new Map(permissions.map(permission => [permission.code, permission]));
    for (const definition of CLIENT_WORKSPACE_PERMISSION_DEFINITIONS) {
      const permission = byCode.get(definition.code);
      if (!permission || permission.name !== definition.name || permission.status !== "active" || permission.deletedAt) {
        throw new ServiceUnavailableException("Workspace permission catalog unavailable");
      }
    }
    return byCode;
  }

  async listWorkspaces(memberId: string, page: number, pageSize: number) {
    return this.run(async () => {
      const where = {
        ...activeMembershipWhere,
        memberId,
        workspace: { is: { status: "active", deletedAt: null } }
      };
      const [total, rows] = await this.prisma.$transaction([
        this.prisma.clientWorkspaceMembership.count({ where }),
        this.prisma.clientWorkspaceMembership.findMany({
          where,
          orderBy: [{ joinedAt: "desc" }, { workspaceId: "asc" }],
          skip: (page - 1) * pageSize,
          take: pageSize,
          select: {
            id: true,
            joinedAt: true,
            workspace: { select: { id: true, code: true, name: true, status: true } },
            role: { select: { id: true, code: true, name: true } }
          }
        })
      ]);
      return {
        page,
        pageSize,
        total,
        items: rows.map(row => ({
          membershipId: row.id,
          joinedAt: row.joinedAt,
          workspace: row.workspace,
          role: row.role
        }))
      };
    });
  }

  async createWorkspace(memberId: string, dto: CreateClientWorkspaceDto, correlationId?: string) {
    const name = dto.name.trim();
    if (!name) throw new BadRequestException("Workspace name is required");
    return this.run(async () => {
      const existing = await this.prisma.clientWorkspace.findUnique({
        where: { createdByMemberId_creationIdempotencyKey: { createdByMemberId: memberId, creationIdempotencyKey: dto.idempotencyKey } },
        select: { id: true, code: true, name: true, status: true, deletedAt: true }
      });
      if (existing) {
        if (existing.status !== "active" || existing.deletedAt || existing.name !== name) {
          throw new ConflictException("Workspace creation key already used");
        }
        return { ...existing, idempotent: true };
      }

      try {
        const workspace = await this.prisma.$transaction(async tx => {
          const catalog = await this.ensurePermissionCatalog(tx);
          const created = await tx.clientWorkspace.create({
            data: {
              code: "ws_" + randomUUID().replaceAll("-", ""),
              name,
              createdByMemberId: memberId,
              creationIdempotencyKey: dto.idempotencyKey
            }
          });
          const owner = await tx.clientWorkspaceRole.create({
            data: { workspaceId: created.id, code: "OWNER", name: "Workspace Owner", isSystem: true, sortOrder: 0 }
          });
          const member = await tx.clientWorkspaceRole.create({
            data: { workspaceId: created.id, code: "MEMBER", name: "Workspace Member", isSystem: true, sortOrder: 10 }
          });
          const ownerPermissionIds = CLIENT_WORKSPACE_PERMISSION_DEFINITIONS.map(definition => {
            const permission = catalog.get(definition.code);
            if (!permission) throw new ServiceUnavailableException("Workspace permission catalog unavailable");
            return permission.id;
          });
          const memberPermission = catalog.get(CLIENT_WORKSPACE_PERMISSION.contextRead);
          if (!memberPermission) throw new ServiceUnavailableException("Workspace permission catalog unavailable");
          await tx.clientWorkspaceRolePermission.createMany({
            data: [
              ...ownerPermissionIds.map(permissionId => ({ roleId: owner.id, permissionId })),
              { roleId: member.id, permissionId: memberPermission.id }
            ]
          });
          await tx.clientWorkspaceMembership.create({ data: { workspaceId: created.id, memberId, roleId: owner.id } });
          await this.audit(tx, {
            actorId: memberId,
            correlationId,
            workspaceId: created.id,
            resourceType: "client_workspace",
            resourceId: created.id,
            action: "workspace_created",
            method: "POST",
            path: "/api/client/workspaces",
            afterData: { name, status: "active", initialRole: "OWNER" }
          });
          return created;
        });
        return { ...workspace, idempotent: false };
      } catch (error) {
        if ((error as { code?: unknown })?.code !== "P2002") throw error;
        const raced = await this.prisma.clientWorkspace.findUnique({
          where: { createdByMemberId_creationIdempotencyKey: { createdByMemberId: memberId, creationIdempotencyKey: dto.idempotencyKey } },
          select: { id: true, code: true, name: true, status: true, deletedAt: true }
        });
        if (!raced || raced.status !== "active" || raced.deletedAt || raced.name !== name) throw error;
        return { ...raced, idempotent: true };
      }
    });
  }

  async updateWorkspace(memberId: string, workspaceId: string, dto: UpdateClientWorkspaceDto, correlationId?: string) {
    const name = dto.name.trim();
    if (!name) throw new BadRequestException("Workspace name is required");
    return this.run(() => this.prisma.$transaction(async tx => {
      const current = await tx.clientWorkspace.findFirst({ where: { id: workspaceId, status: "active", deletedAt: null } });
      if (!current) throw new NotFoundException("Workspace not found");
      const updated = await tx.clientWorkspace.update({ where: { id: current.id }, data: { name } });
      await this.audit(tx, {
        actorId: memberId, correlationId, workspaceId, resourceType: "client_workspace", resourceId: workspaceId,
        action: "workspace_updated", method: "PATCH", path: "/api/client/workspaces/details",
        beforeData: { name: current.name }, afterData: { name: updated.name }
      });
      return { id: updated.id, code: updated.code, name: updated.name, updatedAt: updated.updatedAt };
    }));
  }

  async listRoles(workspaceId: string) {
    return this.run(async () => {
      const roles = await this.prisma.clientWorkspaceRole.findMany({
        where: { workspaceId, status: "active", deletedAt: null },
        orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
        select: {
          id: true, code: true, name: true, description: true, isSystem: true, sortOrder: true,
          rolePermissions: {
            where: { deletedAt: null, permission: { is: { status: "active", deletedAt: null } } },
            select: { permission: { select: { code: true } } }
          }
        }
      });
      return roles.map(role => ({
        id: role.id, code: role.code, name: role.name, description: role.description, isSystem: role.isSystem,
        sortOrder: role.sortOrder,
        permissions: [...new Set(role.rolePermissions.map(grant => grant.permission.code))].sort()
      }));
    });
  }

  async listMembers(workspaceId: string, page: number, pageSize: number) {
    return this.run(async () => {
      const where = { workspaceId, deletedAt: null, status: { in: ["active", "suspended"] } };
      const [total, rows] = await this.prisma.$transaction([
        this.prisma.clientWorkspaceMembership.count({ where }),
        this.prisma.clientWorkspaceMembership.findMany({
          where,
          orderBy: [{ joinedAt: "asc" }, { id: "asc" }],
          skip: (page - 1) * pageSize,
          take: pageSize,
          select: {
            id: true, memberId: true, status: true, joinedAt: true, disabledAt: true, removedAt: true,
            member: { select: { id: true, email: true, nickname: true } },
            role: { select: { id: true, code: true, name: true } }
          }
        })
      ]);
      return {
        page, pageSize, total,
        items: rows.map(row => ({
          id: row.id, memberId: row.memberId, status: row.status, joinedAt: row.joinedAt,
          disabledAt: row.disabledAt, removedAt: row.removedAt, member: row.member, role: row.role
        }))
      };
    });
  }

  private async rolePermissionCodes(tx: Prisma.TransactionClient, roleId: string) {
    const grants = await tx.clientWorkspaceRolePermission.findMany({
      where: { roleId, deletedAt: null, permission: { is: { status: "active", deletedAt: null } } },
      select: { permission: { select: { code: true } } }
    });
    return [...new Set(grants.map(grant => grant.permission.code))];
  }

  private ensureRoleDelegation(actorPermissions: readonly string[], targetPermissions: readonly string[]) {
    const actor = new Set(actorPermissions);
    if (!targetPermissions.every(permission => actor.has(permission))) {
      throw new ForbiddenException("Cannot assign permissions the current member does not hold");
    }
  }

  async addMember(actorId: string, actorPermissions: readonly string[], workspaceId: string, dto: CreateClientWorkspaceMembershipDto, correlationId?: string) {
    return this.run(() => this.prisma.$transaction(async tx => {
      await this.lockWorkspace(tx, workspaceId);
      const workspace = await tx.clientWorkspace.findFirst({ where: { id: workspaceId, status: "active", deletedAt: null }, select: { id: true } });
      if (!workspace) throw new NotFoundException("Workspace not found");
      const targetMember = await tx.memberUser.findFirst({ where: { id: dto.memberId, status: "active", deletedAt: null }, select: { id: true } });
      if (!targetMember) throw new NotFoundException("Member not found");
      const role = await tx.clientWorkspaceRole.findFirst({ where: { id: dto.roleId, workspaceId, status: "active", deletedAt: null }, select: { id: true, code: true } });
      if (!role) throw new NotFoundException("Workspace role not found");
      this.ensureRoleDelegation(actorPermissions, await this.rolePermissionCodes(tx, role.id));
      const existing = await tx.clientWorkspaceMembership.findUnique({ where: { workspaceId_memberId: { workspaceId, memberId: dto.memberId } } });
      if (existing) {
        if (existing.status !== "removed" || existing.deletedAt) throw new ConflictException("Membership already exists");
        const now = new Date();
        const reactivated = await tx.clientWorkspaceMembership.update({
          where: { id: existing.id },
          data: { roleId: role.id, status: "active", disabledAt: null, removedAt: null, deletedAt: null, sessionVersion: { increment: 1 }, joinedAt: now }
        });
        await this.audit(tx, {
          actorId, correlationId, workspaceId, resourceType: "client_workspace_membership", resourceId: reactivated.id,
          action: "workspace_member_reactivated", method: "POST", path: "/api/client/workspaces/members",
          beforeData: { status: existing.status, roleId: existing.roleId }, afterData: { status: "active", roleId: role.id, roleCode: role.code }
        });
        return { id: reactivated.id, memberId: reactivated.memberId, roleId: reactivated.roleId, status: reactivated.status, sessionVersion: reactivated.sessionVersion, reactivated: true };
      }
      const created = await tx.clientWorkspaceMembership.create({ data: { workspaceId, memberId: dto.memberId, roleId: role.id } });
      await this.audit(tx, {
        actorId, correlationId, workspaceId, resourceType: "client_workspace_membership", resourceId: created.id,
        action: "workspace_member_added", method: "POST", path: "/api/client/workspaces/members",
        afterData: { memberId: created.memberId, roleId: role.id, roleCode: role.code, status: "active" }
      });
      return { id: created.id, memberId: created.memberId, roleId: created.roleId, status: created.status, reactivated: false };
    }));
  }

  async changeMemberRole(actorId: string, actorPermissions: readonly string[], workspaceId: string, membershipId: string, dto: ChangeClientWorkspaceMembershipRoleDto, correlationId?: string) {
    return this.run(() => this.prisma.$transaction(async tx => {
      await this.lockWorkspace(tx, workspaceId);
      const membership = await tx.clientWorkspaceMembership.findFirst({
        where: { id: membershipId, workspaceId, deletedAt: null, status: { in: ["active", "suspended"] } },
        include: { role: { select: { id: true, code: true } } }
      });
      if (!membership) throw new NotFoundException("Membership not found");
      const role = await tx.clientWorkspaceRole.findFirst({ where: { id: dto.roleId, workspaceId, status: "active", deletedAt: null }, select: { id: true, code: true } });
      if (!role) throw new NotFoundException("Workspace role not found");
      this.ensureRoleDelegation(actorPermissions, await this.rolePermissionCodes(tx, role.id));
      if (role.id === membership.roleId) return { id: membership.id, roleId: role.id, roleCode: role.code, unchanged: true };
      if (membership.status === "active" && membership.role.code === "OWNER" && role.code !== "OWNER") {
        await this.assertAnotherActiveOwner(tx, workspaceId, membership.id);
      }
      const updated = await tx.clientWorkspaceMembership.update({
        where: { id: membership.id }, data: { roleId: role.id, sessionVersion: { increment: 1 } }
      });
      await this.audit(tx, {
        actorId, correlationId, workspaceId, resourceType: "client_workspace_membership", resourceId: updated.id,
        action: "workspace_member_role_changed", method: "PATCH", path: "/api/client/workspaces/members/:membershipId/role",
        beforeData: { roleId: membership.roleId, roleCode: membership.role.code }, afterData: { roleId: role.id, roleCode: role.code }
      });
      return { id: updated.id, roleId: role.id, roleCode: role.code, sessionVersion: updated.sessionVersion };
    }));
  }

  async changeMemberStatus(actorId: string, workspaceId: string, membershipId: string, dto: ChangeClientWorkspaceMembershipStatusDto, correlationId?: string) {
    return this.run(() => this.prisma.$transaction(async tx => {
      await this.lockWorkspace(tx, workspaceId);
      const membership = await tx.clientWorkspaceMembership.findFirst({
        where: { id: membershipId, workspaceId, deletedAt: null, status: { in: ["active", "suspended"] } },
        include: { role: { select: { code: true } } }
      });
      if (!membership) throw new NotFoundException("Membership not found");
      if (membership.memberId === actorId) throw new ForbiddenException("Use the leave operation for your own membership");
      if (membership.status === dto.status) return { id: membership.id, status: membership.status, unchanged: true };
      if (membership.status === "active" && membership.role.code === "OWNER" && dto.status !== "active") {
        await this.assertAnotherActiveOwner(tx, workspaceId, membership.id);
      }
      const now = new Date();
      const updated = await tx.clientWorkspaceMembership.update({
        where: { id: membership.id },
        data: {
          status: dto.status,
          disabledAt: dto.status === "suspended" ? now : null,
          removedAt: dto.status === "removed" ? now : null,
          sessionVersion: { increment: 1 }
        }
      });
      await this.audit(tx, {
        actorId, correlationId, workspaceId, resourceType: "client_workspace_membership", resourceId: updated.id,
        action: "workspace_member_status_changed", method: "PATCH", path: "/api/client/workspaces/members/:membershipId/status",
        beforeData: { status: membership.status, reason: dto.reason || null }, afterData: { status: dto.status, reason: dto.reason || null }
      });
      return { id: updated.id, status: updated.status, sessionVersion: updated.sessionVersion };
    }));
  }

  async leave(actorId: string, workspaceId: string, correlationId?: string) {
    return this.run(() => this.prisma.$transaction(async tx => {
      await this.lockWorkspace(tx, workspaceId);
      const membership = await tx.clientWorkspaceMembership.findFirst({
        where: { workspaceId, memberId: actorId, deletedAt: null, status: "active" },
        include: { role: { select: { code: true } } }
      });
      if (!membership) throw new NotFoundException("Active membership not found");
      if (membership.role.code === "OWNER") await this.assertAnotherActiveOwner(tx, workspaceId, membership.id);
      const now = new Date();
      const updated = await tx.clientWorkspaceMembership.update({
        where: { id: membership.id }, data: { status: "removed", removedAt: now, disabledAt: null, sessionVersion: { increment: 1 } }
      });
      await this.audit(tx, {
        actorId, correlationId, workspaceId, resourceType: "client_workspace_membership", resourceId: updated.id,
        action: "workspace_member_left", method: "POST", path: "/api/client/workspaces/leave",
        beforeData: { status: membership.status, roleCode: membership.role.code }, afterData: { status: "removed", sessionVersion: updated.sessionVersion }
      });
      return { left: true, membershipId: updated.id, sessionVersion: updated.sessionVersion };
    }));
  }

  private async assertAnotherActiveOwner(tx: Prisma.TransactionClient, workspaceId: string, departingMembershipId: string) {
    const owners = await tx.clientWorkspaceMembership.count({
      where: {
        workspaceId, id: { not: departingMembershipId }, status: "active", disabledAt: null, removedAt: null, deletedAt: null,
        workspace: { is: { status: "active", deletedAt: null } },
        role: { is: { code: "OWNER", status: "active", deletedAt: null } }
      }
    });
    if (owners < 1) throw new ConflictException("Workspace must retain an active owner");
  }
}
