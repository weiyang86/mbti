import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { RBAC_PERMISSION_PERMISSION, RBAC_ROLE_PERMISSION } from "../../../../scripts/rbac-policy.cjs";
import { AdminListDto } from "../admin/dto";
import { PrismaService } from "../prisma/prisma.service";
import { ManagementAccessService, ManagementActor, PermissionAssignmentChange } from "./management-access.service";
import { CreatePermissionDto, CreateRoleDto, UpdatePermissionDto, UpdateRoleDto } from "./management.dto";
const roleSelect = { id: true, roleCode: true, roleName: true, status: true, remark: true, dataScope: true, createdAt: true, updatedAt: true,
  permissions: { select: { permissionId: true } } } as const;
const permissionSelect = { id: true, permissionCode: true, permissionName: true, resourceType: true, module: true, action: true, apiPath: true, status: true, createdAt: true, updatedAt: true } as const;
const fields = (value: object) => Object.keys(value).filter(key => (value as Record<string, unknown>)[key] !== undefined).sort();
const nonempty = (value: object) => { if (!fields(value).length) throw new BadRequestException("No changes supplied"); };
const reservedRole = (code: string) => code.startsWith("aij_") || code === "super_admin";
const publicRole = (role: Prisma.SysRoleGetPayload<{ select: typeof roleSelect }>) => { const { permissions, ...data } = role; return { ...data, permissionIds: permissions.map(p => p.permissionId).sort() }; };

@Injectable()
export class RbacManagementService {
  constructor(private readonly prisma: PrismaService, private readonly access: ManagementAccessService) {}
  listRoles(query: AdminListDto) {
    const where: Prisma.SysRoleWhereInput = { deletedAt: null, ...(query.status ? { status: query.status } : {}), ...(query.q ? { OR: [{ roleCode: { contains: query.q, mode: "insensitive" } }, { roleName: { contains: query.q, mode: "insensitive" } }] } : {}) };
    return this.access.database(async () => { const [rows, total] = await this.prisma.$transaction([this.prisma.sysRole.findMany({ where, select: roleSelect, orderBy: { id: "asc" }, skip: (query.page - 1) * query.pageSize, take: query.pageSize }), this.prisma.sysRole.count({ where })]); return { items: rows.map(publicRole), total, page: query.page, pageSize: query.pageSize }; });
  }
  getRole(id: string) { return this.access.database(async () => { const role = await this.prisma.sysRole.findFirst({ where: { id, deletedAt: null }, select: roleSelect }); if (!role) throw new NotFoundException(); return publicRole(role); }); }
  listPermissions(query: AdminListDto) {
    const where: Prisma.SysPermissionWhereInput = { ...(query.status ? { status: query.status } : {}), ...(query.q ? { OR: [{ permissionCode: { contains: query.q, mode: "insensitive" } }, { permissionName: { contains: query.q, mode: "insensitive" } }] } : {}) };
    return this.access.database(async () => { const [items, total] = await this.prisma.$transaction([this.prisma.sysPermission.findMany({ where, select: permissionSelect, orderBy: { permissionCode: "asc" }, skip: (query.page - 1) * query.pageSize, take: query.pageSize }), this.prisma.sysPermission.count({ where })]); return { items, total, page: query.page, pageSize: query.pageSize }; });
  }
  getPermission(id: string) { return this.access.database(async () => { const permission = await this.prisma.sysPermission.findUnique({ where: { id }, select: permissionSelect }); if (!permission) throw new NotFoundException(); return permission; }); }
  private mutate<T extends { id: string }>(type: "role" | "permission", operator: string, action: string, operation: (tx: Prisma.TransactionClient, actor: ManagementActor) => Promise<T>, correlationId?: string, changed: string[] = [], permissionChange?: PermissionAssignmentChange) {
    return this.access.write(operator, [type === "role" ? RBAC_ROLE_PERMISSION : RBAC_PERMISSION_PERMISSION], async (tx, actor) => {
      const result = await operation(tx, actor); await this.access.audit(tx, actor.id, result.id, action, "rbac-management", type, correlationId, changed, permissionChange); return result;
    });
  }
  private async writableRole(tx: Prisma.TransactionClient, id: string, actor: ManagementActor) {
    const role = await tx.sysRole.findFirst({ where: { id, deletedAt: null } }); if (!role) throw new NotFoundException();
    if (reservedRole(role.roleCode)) throw new ConflictException("Code-owned role is immutable");
    if (!actor.isSuperAdmin && (await tx.sysUserRole.count({ where: { roleId: id } }) || await tx.sysRolePermission.count({ where: { roleId: id } }))) throw new ForbiddenException();
    return role;
  }
  private async writablePermission(tx: Prisma.TransactionClient, id: string) {
    const permission = await tx.sysPermission.findUnique({ where: { id } }); if (!permission) throw new NotFoundException();
    if (!permission.permissionCode.startsWith("custom.") || permission.module !== "custom") throw new ConflictException("Code-owned permission is immutable");
    return permission;
  }
  createRole(dto: CreateRoleDto, operator: string, correlationId?: string) {
    return this.mutate("role", operator, "role_created", tx => tx.sysRole.create({ data: { roleCode: dto.roleCode, roleName: dto.roleName, remark: dto.remark }, select: { id: true } }), correlationId, fields(dto));
  }
  updateRole(id: string, dto: UpdateRoleDto, operator: string, correlationId?: string) {
    nonempty(dto); return this.mutate("role", operator, "role_updated", async (tx, actor) => { await this.writableRole(tx, id, actor); return tx.sysRole.update({ where: { id }, data: { roleName: dto.roleName, remark: dto.remark }, select: { id: true } }); }, correlationId, fields(dto));
  }
  roleStatus(id: string, enabled: boolean, operator: string, correlationId?: string) {
    return this.mutate("role", operator, enabled ? "role_enabled" : "role_disabled", async (tx, actor) => { await this.writableRole(tx, id, actor); return tx.sysRole.update({ where: { id }, data: { status: enabled ? "active" : "disabled" }, select: { id: true } }); }, correlationId);
  }
  removeRole(id: string, operator: string, correlationId?: string) {
    return this.mutate("role", operator, "role_deleted", async (tx, actor) => { await this.writableRole(tx, id, actor); await tx.sysRolePermission.deleteMany({ where: { roleId: id } }); await tx.sysRole.update({ where: { id }, data: { status: "disabled", deletedAt: new Date() } }); return { id, deleted: true }; }, correlationId);
  }
  assignPermissions(id: string, permissionIds: string[], operator: string, correlationId?: string) {
    const change: PermissionAssignmentChange = { before: [], after: [] };
    return this.mutate("role", operator, "role_permissions_assigned", async (tx, actor) => {
      if (!actor.isSuperAdmin) throw new ForbiddenException(); const role = await this.writableRole(tx, id, actor);
      if (role.status !== "active") throw new ConflictException("Inactive role cannot receive permission assignments");
      if (await tx.sysPermission.count({ where: { id: { in: permissionIds }, status: "active" } }) !== permissionIds.length) throw new BadRequestException("Invalid permission selection");
      change.before = (await tx.sysRolePermission.findMany({ where: { roleId: id }, select: { permissionId: true } })).map(link => link.permissionId).sort();
      change.after = [...permissionIds].sort();
      await tx.sysRolePermission.deleteMany({ where: { roleId: id } }); await tx.sysRolePermission.createMany({ data: permissionIds.map(permissionId => ({ roleId: id, permissionId })) }); return { id };
    }, correlationId, ["permissionIds"], change);
  }
  createPermission(dto: CreatePermissionDto, operator: string, correlationId?: string) {
    return this.mutate("permission", operator, "permission_created", tx => tx.sysPermission.create({ data: { permissionCode: dto.permissionCode, permissionName: dto.permissionName, resourceType: dto.resourceType, module: "custom", action: dto.action, apiPath: dto.apiPath }, select: { id: true } }), correlationId, fields(dto));
  }
  updatePermission(id: string, dto: UpdatePermissionDto, operator: string, correlationId?: string) {
    nonempty(dto); return this.mutate("permission", operator, "permission_updated", async tx => { await this.writablePermission(tx, id); return tx.sysPermission.update({ where: { id }, data: { permissionName: dto.permissionName, apiPath: dto.apiPath }, select: { id: true } }); }, correlationId, fields(dto));
  }
  permissionStatus(id: string, enabled: boolean, operator: string, correlationId?: string) {
    return this.mutate("permission", operator, enabled ? "permission_enabled" : "permission_disabled", async tx => { await this.writablePermission(tx, id); return tx.sysPermission.update({ where: { id }, data: { status: enabled ? "active" : "disabled" }, select: { id: true } }); }, correlationId);
  }
  removePermission(id: string, operator: string, correlationId?: string) {
    return this.mutate("permission", operator, "permission_deleted", async tx => {
      const permission = await this.writablePermission(tx, id);
      if (await tx.sysRolePermission.count({ where: { permissionId: id } }) || await tx.sysMenu.count({ where: { permissionCode: permission.permissionCode } })) throw new ConflictException("Permission is referenced");
      await tx.sysPermission.delete({ where: { id } }); return { id, deleted: true };
    }, correlationId);
  }
}
