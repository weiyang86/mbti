import { Body, Controller, Delete, Get, Header, Param, Patch, Post, Query, Req, Type, ValidationPipe } from "@nestjs/common";
import type { AdminRequest } from "../auth/auth.types";
import { AdminIdDto, AdminListDto } from "../admin/dto";
import { Permissions } from "../common/decorators/permissions.decorator";
import { DICTIONARY_PERMISSION, DICTIONARY_READ_PERMISSION } from "../../../../scripts/dictionary-policy.cjs";
import { DictionariesService } from "./dictionaries.service";
import { CreateDictionaryDto, CreateDictionaryItemDto, PublicDictionaryCodeDto, PublicDictionaryPageDto, UpdateDictionaryDto, UpdateDictionaryItemDto } from "./dto";
const strict = (expectedType: Type<object>) => new ValidationPipe({ expectedType, whitelist: true, forbidNonWhitelisted: true, transform: true });
@Controller("admin/dicts")
export class DictionariesController {
  constructor(private readonly dictionaries: DictionariesService) {}
  @Get() @Permissions(DICTIONARY_READ_PERMISSION) @Header("Cache-Control", "no-store")
  list(@Query(strict(AdminListDto)) query: object) { return this.dictionaries.list(query as AdminListDto); }
  @Post() @Permissions(DICTIONARY_PERMISSION) @Header("Cache-Control", "no-store")
  create(@Body(strict(CreateDictionaryDto)) d: object, @Req() r: AdminRequest) { return this.dictionaries.create(d as CreateDictionaryDto, r.user!.id, r.correlationId); }
  @Patch(":id") @Permissions(DICTIONARY_PERMISSION) @Header("Cache-Control", "no-store")
  update(@Param() p: AdminIdDto, @Body(strict(UpdateDictionaryDto)) d: object, @Req() r: AdminRequest) { return this.dictionaries.update(p.id, d as UpdateDictionaryDto, r.user!.id, r.correlationId); }
  @Delete(":id") @Permissions(DICTIONARY_PERMISSION) @Header("Cache-Control", "no-store")
  remove(@Param() p: AdminIdDto, @Req() r: AdminRequest) { return this.dictionaries.remove(p.id, r.user!.id, r.correlationId); }
  @Get(":id/items") @Permissions(DICTIONARY_READ_PERMISSION) @Header("Cache-Control", "no-store")
  items(@Param() p: AdminIdDto, @Query(strict(AdminListDto)) query: object) { return this.dictionaries.items(p.id, query as AdminListDto); }
  @Post(":id/items") @Permissions(DICTIONARY_PERMISSION) @Header("Cache-Control", "no-store")
  createItem(@Param() p: AdminIdDto, @Body(strict(CreateDictionaryItemDto)) d: object, @Req() r: AdminRequest) { return this.dictionaries.createItem(p.id, d as CreateDictionaryItemDto, r.user!.id, r.correlationId); }
}
@Controller("admin/dict-items")
@Permissions(DICTIONARY_PERMISSION)
export class DictionaryItemsController {
  constructor(private readonly dictionaries: DictionariesService) {}
  @Patch(":id") @Header("Cache-Control", "no-store")
  update(@Param() p: AdminIdDto, @Body(strict(UpdateDictionaryItemDto)) d: object, @Req() r: AdminRequest) { return this.dictionaries.updateItem(p.id, d as UpdateDictionaryItemDto, r.user!.id, r.correlationId); }
  @Delete(":id") @Header("Cache-Control", "no-store")
  remove(@Param() p: AdminIdDto, @Req() r: AdminRequest) { return this.dictionaries.removeItem(p.id, r.user!.id, r.correlationId); }
}
// Explicitly public, safe projection only; no blanket public exception in admin authorization.
@Controller("dictionaries")
export class PublicDictionariesController {
  constructor(private readonly dictionaries: DictionariesService) {}
  @Get(":dictCode/items") @Header("Cache-Control", "no-store")
  items(@Param() p: PublicDictionaryCodeDto, @Query(strict(PublicDictionaryPageDto)) query: object) { return this.dictionaries.publicItems(p.dictCode, query as PublicDictionaryPageDto); }
}
