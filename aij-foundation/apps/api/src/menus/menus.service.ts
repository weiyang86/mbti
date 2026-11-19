// Directed adaptation of source AdminService menu CRUD/tree slice; no business services.
import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma, SysMenu } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { PermissionsService } from "../rbac/permissions.service";
import { ManagementAccessService } from "../rbac/management-access.service";
import { MENU_PERMISSION } from "../../../../scripts/menu-policy.cjs";
import { MenuAvailabilityService } from "./menu-availability.service";
import { CreateMenuDto, MenuFieldsDto } from "./menu.dto";

export type MenuNode = { id: string; title: string; path: string | null; type: string; icon: string | null; sortOrder: number; children: MenuNode[] };
export type ManagedMenuNode = SysMenu & { children: ManagedMenuNode[] };
const defined = <T extends object>(value: T): T => Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
const order = [{ sortOrder: "asc" as const }, { id: "asc" as const }];
@Injectable()
export class MenusService {
  constructor(private readonly prisma: PrismaService, private readonly permissions: PermissionsService, private readonly access: ManagementAccessService, private readonly availability: MenuAvailabilityService, private readonly config: ConfigService) {}
  private tree(rows: SysMenu[], allowed: (row: SysMenu) => boolean): MenuNode[] {
    const children = new Map<string | null, SysMenu[]>();
    for (const row of rows) children.set(row.parentId, [...(children.get(row.parentId) ?? []), row]);
    const build = (parent: string | null, seen: Set<string>): MenuNode[] => (children.get(parent) ?? []).flatMap(row => {
      if (seen.has(row.id) || seen.size >= 64 || !allowed(row)) return [];
      const nested = build(row.id, new Set([...seen, row.id]));
      if (row.type === "directory" && !nested.length) return [];
      if (row.type !== "directory" && row.type !== "menu") return [];
      return [{ id: row.id, title: row.title, path: row.type === "directory" ? null : row.path, type: row.type, icon: row.icon, sortOrder: row.sortOrder, children: nested }];
    });
    return build(null, new Set());
  }
  mine(userId: string) {
    return this.access.database(() => this.prisma.$transaction(async tx => {
      const user = await this.permissions.resolveInTransaction(tx, userId);
      const granted = new Set(user.effectivePermissions);
      const project = await tx.projectProfile.findFirst({ where: { code: this.config.getOrThrow<string>("projectId") + "-" + this.config.getOrThrow<string>("environment"), status: "active", deletedAt: null }, select: { id: true } });
      const enabledPlugins = new Set(project ? (await tx.pluginInstallation.findMany({ where: { status: "enabled", projectId: project.id }, select: { pluginCode: true } })).map(p => p.pluginCode) : []);
      const rows = await tx.sysMenu.findMany({ where: { deletedAt: null }, orderBy: order });
      return this.tree(rows, row => row.status === "active" && row.visible && this.availability.pluginEnabled(row.pluginCode) && (!row.pluginCode || enabledPlugins.has(row.pluginCode)) &&
        (row.type === "directory" ? row.permissionCode === null : !!row.permissionCode && granted.has(row.permissionCode) && this.availability.pageAvailable(row.path, row.pluginCode)));
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 2000, timeout: 2000 }));
  }
  list() {
    return this.access.database(async () => {
      const rows = await this.prisma.sysMenu.findMany({ where: { deletedAt: null }, orderBy: order });
      const build = (parent: string | null, seen: Set<string>): ManagedMenuNode[] => rows.filter(row => row.parentId === parent && !seen.has(row.id) && seen.size < 64)
        .map(row => ({ ...row, children: build(row.id, new Set([...seen, row.id])) }));
      return build(null, new Set());
    });
  }
  pages() { return this.availability.catalog(); }
  private async row(tx: Prisma.TransactionClient, id: string) {
    const row = await tx.sysMenu.findFirst({ where: { id, deletedAt: null } });
    if (!row) throw new NotFoundException("Menu not found"); return row;
  }
  private async validate(tx: Prisma.TransactionClient, value: Omit<SysMenu, "id" | "createdAt" | "updatedAt" | "deletedAt">, id?: string) {
    if (value.type === "directory") {
      if (value.permissionCode !== null) throw new BadRequestException("Directory cannot grant access");
      if (value.status === "active" && !this.availability.pluginEnabled(value.pluginCode)) throw new BadRequestException("Plugin unavailable");
    } else {
      if (!value.permissionCode || !await tx.sysPermission.findFirst({ where: { permissionCode: value.permissionCode, status: "active" } })) throw new BadRequestException("Invalid permission");
      if (value.status === "active" && !this.availability.pageAvailable(value.path, value.pluginCode)) throw new BadRequestException("Page unavailable");
      if (id && await tx.sysMenu.count({ where: { parentId: id, deletedAt: null } })) throw new ConflictException("Parent must remain a directory");
    }
    const seen = new Set(id ? [id] : []); let parent = value.parentId;
    while (parent !== null) {
      if (seen.has(parent) || seen.size >= 64) throw new BadRequestException("Invalid menu hierarchy"); seen.add(parent);
      const row = await this.row(tx, parent);
      if (row.type !== "directory") throw new BadRequestException("Parent must be a directory"); parent = row.parentId;
    }
  }
  create(dto: CreateMenuDto, operator: string, correlationId?: string) {
    dto = defined(dto);
    return this.access.write(operator, [MENU_PERMISSION], async (tx, actor) => {
      if (await tx.sysMenu.count({ where: { deletedAt: null } }) >= 500) throw new ConflictException("Menu limit reached");
      const value = { parentId: null, icon: null, type: "menu", permissionCode: null, pluginCode: null, sortOrder: 0, visible: true, status: "active", ...dto };
      await this.validate(tx, value); const row = await tx.sysMenu.create({ data: value });
      await this.access.audit(tx, actor.id, row.id, "menu_created", "menus", "menu", correlationId, Object.keys(dto).sort()); return { id: row.id };
    });
  }
  update(id: string, dto: MenuFieldsDto, operator: string, correlationId?: string) {
    dto = defined(dto);
    if (!Object.keys(dto).length) throw new BadRequestException("Empty menu update");
    return this.access.write(operator, [MENU_PERMISSION], async (tx, actor) => {
      const previous = await this.row(tx, id); await this.validate(tx, { ...previous, ...dto }, id);
      await tx.sysMenu.update({ where: { id }, data: dto });
      await this.access.audit(tx, actor.id, id, "menu_updated", "menus", "menu", correlationId, Object.keys(dto).sort()); return { id };
    });
  }
  remove(id: string, operator: string, correlationId?: string) {
    return this.access.write(operator, [MENU_PERMISSION], async (tx, actor) => {
      await this.row(tx, id);
      if (await tx.sysMenu.count({ where: { parentId: id, deletedAt: null } })) throw new ConflictException("Menu has children");
      await tx.sysMenu.update({ where: { id }, data: { deletedAt: new Date(), status: "disabled" } });
      await this.access.audit(tx, actor.id, id, "menu_deleted", "menus", "menu", correlationId); return { id, deleted: true };
    });
  }
}
