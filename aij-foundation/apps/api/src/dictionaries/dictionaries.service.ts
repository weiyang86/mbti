// Directed source AdminService dictionary slice; F00 M02/M18 core, no business seed.
import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { ManagementAccessService } from "../rbac/management-access.service";
import { AdminListDto } from "../admin/dto";
import { DICTIONARY_PERMISSION } from "../../../../scripts/dictionary-policy.cjs";
import { CreateDictionaryDto, CreateDictionaryItemDto, PublicDictionaryPageDto, UpdateDictionaryDto, UpdateDictionaryItemDto } from "./dto";
const clean = <T extends object>(value: T): T => Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
const order = [{ sortOrder: "asc" as const }, { id: "asc" as const }];
@Injectable()
export class DictionariesService {
  constructor(private readonly prisma: PrismaService, private readonly access: ManagementAccessService, private readonly config: ConfigService) {}
  private async dictionary(tx: Prisma.TransactionClient, id: string, writable = false) {
    const row = await tx.sysDict.findFirst({ where: { id, deletedAt: null } });
    if (!row) throw new NotFoundException("Dictionary not found");
    if (writable && row.pluginCode !== null) throw new ConflictException("Plugin-owned dictionary is immutable"); return row;
  }
  private async item(tx: Prisma.TransactionClient, id: string) {
    const row = await tx.sysDictItem.findFirst({ where: { id, deletedAt: null } });
    if (!row) throw new NotFoundException("Dictionary item not found"); await this.dictionary(tx, row.dictId, true); return row;
  }
  list(query: AdminListDto) {
    return this.access.database(() => this.prisma.$transaction(async tx => {
      const where: Prisma.SysDictWhereInput = { deletedAt: null, ...(query.status ? { status: query.status } : {}), ...(query.q ? { OR: [{ dictCode: { contains: query.q, mode: "insensitive" } }, { dictName: { contains: query.q, mode: "insensitive" } }] } : {}) };
      return { items: await tx.sysDict.findMany({ where, orderBy: order, skip: (query.page - 1) * query.pageSize, take: query.pageSize }), total: await tx.sysDict.count({ where }), page: query.page, pageSize: query.pageSize };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }));
  }
  items(id: string, query: AdminListDto) {
    return this.access.database(() => this.prisma.$transaction(async tx => {
      await this.dictionary(tx, id);
      const where: Prisma.SysDictItemWhereInput = { dictId: id, deletedAt: null, ...(query.status ? { status: query.status } : {}), ...(query.q ? { OR: [{ itemValue: { contains: query.q, mode: "insensitive" } }, { itemLabel: { contains: query.q, mode: "insensitive" } }] } : {}) };
      return { items: await tx.sysDictItem.findMany({ where, orderBy: order, skip: (query.page - 1) * query.pageSize, take: query.pageSize }), total: await tx.sysDictItem.count({ where }), page: query.page, pageSize: query.pageSize };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }));
  }
  publicItems(dictCode: string, query: PublicDictionaryPageDto) {
    return this.access.database(() => this.prisma.$transaction(async tx => {
      const dict = await tx.sysDict.findFirst({ where: { dictCode, deletedAt: null, status: "active", isPublic: true } });
      const empty = { items: [], total: 0, page: query.page, pageSize: query.pageSize };
      if (!dict || dict.pluginCode !== null && !(this.config.get<string[]>("enabledPlugins") ?? []).includes(dict.pluginCode)) return empty;
      const where = { dictId: dict.id, deletedAt: null, status: "active" };
      return { items: await tx.sysDictItem.findMany({ where, orderBy: order, skip: (query.page - 1) * query.pageSize, take: query.pageSize, select: { itemLabel: true, itemValue: true, sortOrder: true } }), total: await tx.sysDictItem.count({ where }), page: query.page, pageSize: query.pageSize };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }));
  }
  create(dto: CreateDictionaryDto, userId: string, correlationId?: string) {
    dto = clean(dto);
    return this.access.write(userId, [DICTIONARY_PERMISSION], async (tx, actor) => {
      const row = await tx.sysDict.create({ data: dto });
      await this.access.audit(tx, actor.id, row.id, "dict_created", "dictionaries", "system_dict", correlationId, Object.keys(dto).sort()); return { id: row.id };
    });
  }
  update(id: string, dto: UpdateDictionaryDto, userId: string, correlationId?: string) {
    dto = clean(dto); if (!Object.keys(dto).length) throw new BadRequestException("Empty update");
    return this.access.write(userId, [DICTIONARY_PERMISSION], async (tx, actor) => {
      await this.dictionary(tx, id, true); await tx.sysDict.update({ where: { id }, data: dto });
      await this.access.audit(tx, actor.id, id, "dict_updated", "dictionaries", "system_dict", correlationId, Object.keys(dto).sort()); return { id };
    });
  }
  remove(id: string, userId: string, correlationId?: string) {
    return this.access.write(userId, [DICTIONARY_PERMISSION], async (tx, actor) => {
      await this.dictionary(tx, id, true);
      if (await tx.sysDictItem.count({ where: { dictId: id, deletedAt: null } })) throw new ConflictException("Dictionary has items");
      await tx.sysDict.update({ where: { id }, data: { deletedAt: new Date(), status: "disabled" } });
      await this.access.audit(tx, actor.id, id, "dict_deleted", "dictionaries", "system_dict", correlationId); return { id, deleted: true };
    });
  }
  createItem(id: string, dto: CreateDictionaryItemDto, userId: string, correlationId?: string) {
    dto = clean(dto);
    return this.access.write(userId, [DICTIONARY_PERMISSION], async (tx, actor) => {
      const dict = await this.dictionary(tx, id, true); if (dict.status !== "active") throw new ConflictException("Dictionary is disabled");
      const row = await tx.sysDictItem.create({ data: { ...dto, dictId: id } });
      await this.access.audit(tx, actor.id, row.id, "dict_item_created", "dictionaries", "system_dict_item", correlationId, Object.keys(dto).sort()); return { id: row.id };
    });
  }
  updateItem(id: string, dto: UpdateDictionaryItemDto, userId: string, correlationId?: string) {
    dto = clean(dto); if (!Object.keys(dto).length) throw new BadRequestException("Empty update");
    return this.access.write(userId, [DICTIONARY_PERMISSION], async (tx, actor) => {
      const row = await this.item(tx, id); const dict = await this.dictionary(tx, row.dictId);
      if (dict.status !== "active" && dto.status === "active") throw new ConflictException("Dictionary is disabled");
      await tx.sysDictItem.update({ where: { id }, data: dto });
      await this.access.audit(tx, actor.id, id, "dict_item_updated", "dictionaries", "system_dict_item", correlationId, Object.keys(dto).sort()); return { id };
    });
  }
  removeItem(id: string, userId: string, correlationId?: string) {
    return this.access.write(userId, [DICTIONARY_PERMISSION], async (tx, actor) => {
      await this.item(tx, id); await tx.sysDictItem.update({ where: { id }, data: { deletedAt: new Date(), status: "disabled" } });
      await this.access.audit(tx, actor.id, id, "dict_item_deleted", "dictionaries", "system_dict_item", correlationId); return { id, deleted: true };
    });
  }
}
