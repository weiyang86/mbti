import { Body, Controller, Delete, Get, Header, Param, Patch, Post, Put, Query, Req, Type, ValidationPipe } from "@nestjs/common";
import type { AdminRequest } from "../auth/auth.types";
import { AdminIdDto, AdminListDto, AdminStatusDto } from "../admin/dto";
import { Permissions } from "../common/decorators/permissions.decorator";
import { RBAC_PERMISSION_PERMISSION, RBAC_ROLE_PERMISSION } from "../../../../scripts/rbac-policy.cjs";
import { CreatePermissionDto, CreateRoleDto, RolePermissionsDto, UpdatePermissionDto, UpdateRoleDto } from "./management.dto";
import { RbacManagementService } from "./management.service";
const strict = (expectedType: Type<object>) => new ValidationPipe({ expectedType, whitelist: true, forbidNonWhitelisted: true, transform: true });

@Controller("admin/roles")
@Permissions(RBAC_ROLE_PERMISSION)
export class RolesController {
  constructor(private readonly management: RbacManagementService) {}
  @Get() @Header("Cache-Control", "no-store")
  list(@Query(strict(AdminListDto)) query: object) { return this.management.listRoles(query as AdminListDto); }
  @Get(":id") @Header("Cache-Control", "no-store")
  get(@Param() p: AdminIdDto) { return this.management.getRole(p.id); }
  @Post() @Header("Cache-Control", "no-store")
  create(@Body(strict(CreateRoleDto)) d: object, @Req() r: AdminRequest) { return this.management.createRole(d as CreateRoleDto, r.user!.id, r.correlationId); }
  @Patch(":id") @Header("Cache-Control", "no-store")
  update(@Param() p: AdminIdDto, @Body(strict(UpdateRoleDto)) d: object, @Req() r: AdminRequest) { return this.management.updateRole(p.id, d as UpdateRoleDto, r.user!.id, r.correlationId); }
  @Patch(":id/status") @Header("Cache-Control", "no-store")
  status(@Param() p: AdminIdDto, @Body(strict(AdminStatusDto)) d: object, @Req() r: AdminRequest) { return this.management.roleStatus(p.id, (d as AdminStatusDto).enabled, r.user!.id, r.correlationId); }
  @Put(":id/permissions") @Header("Cache-Control", "no-store")
  permissions(@Param() p: AdminIdDto, @Body(strict(RolePermissionsDto)) d: object, @Req() r: AdminRequest) { return this.management.assignPermissions(p.id, (d as RolePermissionsDto).permissionIds, r.user!.id, r.correlationId); }
  @Delete(":id") @Header("Cache-Control", "no-store")
  remove(@Param() p: AdminIdDto, @Req() r: AdminRequest) { return this.management.removeRole(p.id, r.user!.id, r.correlationId); }
}

// Existing GET /permissions and /permissions/my remain owned by RbacController.
@Controller("admin/permissions")
@Permissions(RBAC_PERMISSION_PERMISSION)
export class PermissionManagementController {
  constructor(private readonly management: RbacManagementService) {}
  @Get("manage") @Header("Cache-Control", "no-store")
  list(@Query(strict(AdminListDto)) query: object) { return this.management.listPermissions(query as AdminListDto); }
  @Get(":id") @Header("Cache-Control", "no-store")
  get(@Param() p: AdminIdDto) { return this.management.getPermission(p.id); }
  @Post() @Header("Cache-Control", "no-store")
  create(@Body(strict(CreatePermissionDto)) d: object, @Req() r: AdminRequest) { return this.management.createPermission(d as CreatePermissionDto, r.user!.id, r.correlationId); }
  @Patch(":id") @Header("Cache-Control", "no-store")
  update(@Param() p: AdminIdDto, @Body(strict(UpdatePermissionDto)) d: object, @Req() r: AdminRequest) { return this.management.updatePermission(p.id, d as UpdatePermissionDto, r.user!.id, r.correlationId); }
  @Patch(":id/status") @Header("Cache-Control", "no-store")
  status(@Param() p: AdminIdDto, @Body(strict(AdminStatusDto)) d: object, @Req() r: AdminRequest) { return this.management.permissionStatus(p.id, (d as AdminStatusDto).enabled, r.user!.id, r.correlationId); }
  @Delete(":id") @Header("Cache-Control", "no-store")
  remove(@Param() p: AdminIdDto, @Req() r: AdminRequest) { return this.management.removePermission(p.id, r.user!.id, r.correlationId); }
}
