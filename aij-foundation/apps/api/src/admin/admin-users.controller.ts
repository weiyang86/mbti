import { Body, Controller, Delete, Get, Header, Param, Patch, Post, Query, Req, Type, ValidationPipe } from "@nestjs/common";
import type { AdminRequest } from "../auth/auth.types";
import { Permissions } from "../common/decorators/permissions.decorator";
import { ADMIN_USERS_PERMISSION } from "../../../../scripts/admin-policy.cjs";
import { AdminUsersService } from "./admin-users.service";
import { AdminIdDto, AdminListDto, AdminStatusDto, CreateAdminDto, ResetAdminPasswordDto, UpdateAdminDto } from "./dto";

const strict = (expectedType: Type<object>) => new ValidationPipe({ expectedType, whitelist: true, forbidNonWhitelisted: true, transform: true });
@Controller("admin/users")
@Permissions(ADMIN_USERS_PERMISSION)
export class AdminUsersController {
  constructor(private readonly users: AdminUsersService) {}
  // Object metadata leaves raw input intact for this strict DTO pipe, before any whitelist stripping.
  @Get() @Header("Cache-Control", "no-store")
  list(@Query(strict(AdminListDto)) query: object) { return this.users.list(query as AdminListDto); }
  @Get(":id") @Header("Cache-Control", "no-store")
  get(@Param() params: AdminIdDto) { return this.users.get(params.id); }
  @Post() @Header("Cache-Control", "no-store")
  create(@Body(strict(CreateAdminDto)) body: object, @Req() req: AdminRequest) { return this.users.create(body as CreateAdminDto, req.user!.id, req.correlationId); }
  @Patch(":id") @Header("Cache-Control", "no-store")
  update(@Param() params: AdminIdDto, @Body(strict(UpdateAdminDto)) body: object, @Req() req: AdminRequest) { return this.users.update(params.id, body as UpdateAdminDto, req.user!.id, req.correlationId); }
  @Patch(":id/status") @Header("Cache-Control", "no-store")
  status(@Param() params: AdminIdDto, @Body(strict(AdminStatusDto)) body: object, @Req() req: AdminRequest) { return this.users.status(params.id, (body as AdminStatusDto).enabled, req.user!.id, req.correlationId); }
  @Patch(":id/reset-password") @Header("Cache-Control", "no-store")
  reset(@Param() params: AdminIdDto, @Body(strict(ResetAdminPasswordDto)) body: object, @Req() req: AdminRequest) { return this.users.resetPassword(params.id, (body as ResetAdminPasswordDto).password, req.user!.id, req.correlationId); }
  @Delete(":id") @Header("Cache-Control", "no-store")
  remove(@Param() params: AdminIdDto, @Req() req: AdminRequest) { return this.users.remove(params.id, req.user!.id, req.correlationId); }
}
