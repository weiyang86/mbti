import { Body, Controller, Get, Header, HttpCode, Param, Post, Req, Type, ValidationPipe } from "@nestjs/common";
import type { AdminRequest } from "../auth/auth.types";
import { Permissions } from "../common/decorators/permissions.decorator";
import { PLUGIN_MANAGEMENT_PERMISSION } from "../../../../scripts/plugin-policy.cjs";
import { PluginLifecycleService } from "./plugin-lifecycle.service";
import { PluginCodeDto, PluginInstallationIdDto, PluginRetryDto, PluginVersionDto } from "./plugin-management.dto";

const strict = (expectedType: Type<object>) => new ValidationPipe({ expectedType, whitelist: true, forbidNonWhitelisted: true, transform: true });

@Controller("admin/plugins")
@Permissions(PLUGIN_MANAGEMENT_PERMISSION)
export class PluginManagementController {
  constructor(private readonly lifecycle: PluginLifecycleService) {}

  @Get() @Header("Cache-Control", "no-store")
  list() { return this.lifecycle.list(); }

  @Get(":code/operations") @Header("Cache-Control", "no-store")
  operations(@Param() params: PluginCodeDto) { return this.lifecycle.listOperations(params.code); }

  @Post(":code/install") @Header("Cache-Control", "no-store")
  install(@Param() params: PluginCodeDto, @Body(strict(PluginVersionDto)) dto: object, @Req() req: AdminRequest) {
    return this.lifecycle.install(params.code, (dto as PluginVersionDto).version, req.user!.id, req.correlationId);
  }

  @Post(":code/upgrade") @Header("Cache-Control", "no-store")
  upgrade(@Param() params: PluginCodeDto, @Body(strict(PluginVersionDto)) dto: object, @Req() req: AdminRequest) {
    return this.lifecycle.upgrade(params.code, (dto as PluginVersionDto).version, req.user!.id, req.correlationId);
  }

  @Post(":code/enable") @HttpCode(200) @Header("Cache-Control", "no-store")
  enable(@Param() params: PluginCodeDto, @Req() req: AdminRequest) {
    return this.lifecycle.enable(params.code, req.user!.id, req.correlationId);
  }

  @Post(":code/disable") @HttpCode(200) @Header("Cache-Control", "no-store")
  disable(@Param() params: PluginCodeDto, @Req() req: AdminRequest) {
    return this.lifecycle.disable(params.code, req.user!.id, req.correlationId);
  }

  @Post("installations/:id/retry") @Header("Cache-Control", "no-store")
  retry(@Param() params: PluginInstallationIdDto, @Body(strict(PluginRetryDto)) dto: object, @Req() req: AdminRequest) {
    return this.lifecycle.requestRetry(params.id, (dto as PluginRetryDto).failedOperationId, req.user!.id, req.correlationId);
  }
}
