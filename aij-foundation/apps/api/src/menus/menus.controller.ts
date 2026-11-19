import { Body, Controller, Delete, Get, Header, Param, Patch, Post, Req, Type, ValidationPipe } from "@nestjs/common";
import type { AdminRequest } from "../auth/auth.types";
import { AdminIdDto } from "../admin/dto";
import { AuthenticatedAdmin } from "../common/decorators/authenticated-admin.decorator";
import { Permissions } from "../common/decorators/permissions.decorator";
import { MENU_PERMISSION } from "../../../../scripts/menu-policy.cjs";
import { CreateMenuDto, MenuFieldsDto } from "./menu.dto";
import { MenusService } from "./menus.service";
const strict = (expectedType: Type<object>) => new ValidationPipe({ expectedType, whitelist: true, forbidNonWhitelisted: true, transform: true });
@Controller("admin/menus")
export class MenusController {
  constructor(private readonly menus: MenusService) {}
  @Get("my") @AuthenticatedAdmin() @Header("Cache-Control", "no-store")
  mine(@Req() r: AdminRequest) { return this.menus.mine(r.user!.id); }
  @Get("pages") @Permissions(MENU_PERMISSION) @Header("Cache-Control", "no-store")
  pages() { return this.menus.pages(); }
  @Get() @Permissions(MENU_PERMISSION) @Header("Cache-Control", "no-store")
  list() { return this.menus.list(); }
  @Post() @Permissions(MENU_PERMISSION) @Header("Cache-Control", "no-store")
  create(@Body(strict(CreateMenuDto)) dto: object, @Req() r: AdminRequest) { return this.menus.create(dto as CreateMenuDto, r.user!.id, r.correlationId); }
  @Patch(":id") @Permissions(MENU_PERMISSION) @Header("Cache-Control", "no-store")
  update(@Param() p: AdminIdDto, @Body(strict(MenuFieldsDto)) dto: object, @Req() r: AdminRequest) { return this.menus.update(p.id, dto as MenuFieldsDto, r.user!.id, r.correlationId); }
  @Delete(":id") @Permissions(MENU_PERMISSION) @Header("Cache-Control", "no-store")
  remove(@Param() p: AdminIdDto, @Req() r: AdminRequest) { return this.menus.remove(p.id, r.user!.id, r.correlationId); }
}
