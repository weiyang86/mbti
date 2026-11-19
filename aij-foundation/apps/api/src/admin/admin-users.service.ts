// Only the verified source administrator slice is adapted; no mixed AdminService dependencies.
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import * as bcrypt from "bcryptjs";
import { ADMIN_PASSWORD_COST, ADMIN_USERS_PERMISSION, isAdminPassword } from "../../../../scripts/admin-policy.cjs";
import { PrismaService } from "../prisma/prisma.service";
import { ManagementAccessService } from "../rbac/management-access.service";
import { AdminListDto, CreateAdminDto, UpdateAdminDto } from "./dto";

const safeSelect = { id: true, username: true, realName: true, email: true, phone: true, status: true, isSuperAdmin: true,
  createdAt: true, updatedAt: true, lastLoginAt: true, userRoles: { select: { roleId: true, role: { select: { roleCode: true } } } } } as const;
type SafeUser = Prisma.SysUserGetPayload<{ select: typeof safeSelect }>;
const publicUser = ({ userRoles, ...user }: SafeUser) => ({ ...user, roleIds: userRoles.map(link => link.roleId).sort(), roleCodes: userRoles.map(link => link.role.roleCode).sort() });

@Injectable()
export class AdminUsersService {
  constructor(private readonly prisma: PrismaService, private readonly access: ManagementAccessService) {}
  list(query: AdminListDto) {
    const where: Prisma.SysUserWhereInput = { deletedAt: null, ...(query.status ? { status: query.status } : {}),
      ...(query.q ? { OR: [{ username: { contains: query.q, mode: "insensitive" } }, { realName: { contains: query.q, mode: "insensitive" } }] } : {}) };
    return this.access.database(async () => {
      const [users, total] = await this.prisma.$transaction([this.prisma.sysUser.findMany({ where, select: safeSelect, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (query.page - 1) * query.pageSize, take: query.pageSize }), this.prisma.sysUser.count({ where })]);
      return { items: users.map(publicUser), total, page: query.page, pageSize: query.pageSize };
    });
  }
  get(id: string) {
    return this.access.database(async () => { const user = await this.prisma.sysUser.findFirst({ where: { id, deletedAt: null }, select: safeSelect }); if (!user) throw new NotFoundException("Administrator not found"); return publicUser(user); });
  }
  private hash(password: string) {
    if (!isAdminPassword(password)) throw new BadRequestException("Invalid administrator password");
    return bcrypt.hash(password, ADMIN_PASSWORD_COST);
  }
  private async write<T>(operatorId: string, operation: (tx: Prisma.TransactionClient, actor: { id: string; isSuperAdmin: boolean }) => Promise<T>) {
    return this.access.write(operatorId, [ADMIN_USERS_PERMISSION], operation);
  }
  private async audit(tx: Prisma.TransactionClient, operatorId: string, id: string, action: string, correlationId?: string, fields: string[] = []) {
    return this.access.audit(tx, operatorId, id, action, "admin-users", "administrator", correlationId, fields);
  }
  private async target(tx: Prisma.TransactionClient, id: string, actor: { isSuperAdmin: boolean }) {
    const user = await tx.sysUser.findFirst({ where: { id, deletedAt: null }, select: { id: true, isSuperAdmin: true, status: true } });
    if (!user) throw new NotFoundException("Administrator not found");
    if (user.isSuperAdmin && !actor.isSuperAdmin) throw new ForbiddenException("Permission denied");
    return user;
  }
  private async roles(tx: Prisma.TransactionClient, actor: { isSuperAdmin: boolean }, ids?: string[]) {
    if (ids === undefined) return;
    if (!actor.isSuperAdmin) throw new ForbiddenException("Permission denied");
    if ((await tx.sysRole.count({ where: { id: { in: ids }, status: "active", deletedAt: null } })) !== ids.length) throw new BadRequestException("Invalid role selection");
  }
  private async protectRemoval(tx: Prisma.TransactionClient, user: { id: string; isSuperAdmin: boolean; status: string }, actorId: string) {
    if (user.id === actorId) throw new ConflictException("Cannot disable or delete yourself");
    if (user.isSuperAdmin && user.status === "active" && await tx.sysUser.count({ where: { isSuperAdmin: true, status: "active", deletedAt: null } }) <= 1) throw new ConflictException("Cannot remove the last active super administrator");
  }
  async create(dto: CreateAdminDto, operatorId: string, correlationId?: string) {
    const passwordHash = await this.hash(dto.password);
    return this.write(operatorId, async (tx, actor) => {
      await this.roles(tx, actor, dto.roleIds);
      const user = await tx.sysUser.create({ data: { username: dto.username, realName: dto.realName, email: dto.email, phone: dto.phone, passwordHash, isSuperAdmin: false, status: "active",
        userRoles: { create: (dto.roleIds || []).map(roleId => ({ roleId })) } }, select: { id: true } });
      await this.audit(tx, actor.id, user.id, "created", correlationId, ["identity", ...(dto.roleIds ? ["roles"] : [])]); return user;
    });
  }
  update(id: string, dto: UpdateAdminDto, operatorId: string, correlationId?: string) {
    const fields = Object.keys(dto).filter(key => dto[key as keyof UpdateAdminDto] !== undefined);
    if (!fields.length) throw new BadRequestException("No changes supplied");
    return this.write(operatorId, async (tx, actor) => {
      await this.target(tx, id, actor); await this.roles(tx, actor, dto.roleIds);
      await tx.sysUser.update({ where: { id }, data: { realName: dto.realName, email: dto.email, phone: dto.phone } });
      if (dto.roleIds !== undefined) { await tx.sysUserRole.deleteMany({ where: { userId: id } }); await tx.sysUserRole.createMany({ data: dto.roleIds.map(roleId => ({ userId: id, roleId })) }); }
      await this.audit(tx, actor.id, id, "updated", correlationId, fields.sort()); return { id };
    });
  }
  status(id: string, enabled: boolean, operatorId: string, correlationId?: string) {
    return this.write(operatorId, async (tx, actor) => {
      const user = await this.target(tx, id, actor); if (!enabled) await this.protectRemoval(tx, user, actor.id);
      await tx.sysUser.update({ where: { id }, data: { status: enabled ? "active" : "disabled", ...(!enabled ? { tokenVersion: { increment: 1 } } : {}) } });
      if (!enabled) await tx.adminAuthSession.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: "disabled" } });
      await this.audit(tx, actor.id, id, enabled ? "enabled" : "disabled", correlationId); return { id };
    });
  }
  async resetPassword(id: string, password: string, operatorId: string, correlationId?: string) {
    const passwordHash = await this.hash(password);
    return this.write(operatorId, async (tx, actor) => {
      await this.target(tx, id, actor); if (id === actor.id) throw new ConflictException("Use a separate self-service password change flow");
      await tx.sysUser.update({ where: { id }, data: { passwordHash, tokenVersion: { increment: 1 } } }); await tx.adminAuthSession.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: "password_reset" } }); await this.audit(tx, actor.id, id, "password_reset", correlationId); return { id };
    });
  }
  remove(id: string, operatorId: string, correlationId?: string) {
    return this.write(operatorId, async (tx, actor) => {
      const user = await this.target(tx, id, actor); await this.protectRemoval(tx, user, actor.id);
      await tx.sysUser.update({ where: { id }, data: { status: "disabled", deletedAt: new Date(), tokenVersion: { increment: 1 } } }); await tx.adminAuthSession.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: "deleted" } }); await this.audit(tx, actor.id, id, "deleted", correlationId); return { id, deleted: true };
    });
  }
}
