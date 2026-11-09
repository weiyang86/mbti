import { Body, Controller, Get, Header, Param, Patch, Put, Query, Req, Type, ValidationPipe } from "@nestjs/common";
import type { AdminRequest } from "../auth/auth.types";
import { Permissions } from "../common/decorators/permissions.decorator";
import { CONFIGURATION_PERMISSION } from "../../../../scripts/configuration-policy.cjs";
import { ConfigurationService } from "./configuration.service";
import { ConfigKeyDto, ScopedConfigQueryDto, UpdateProjectProfileDto, UpsertScopedConfigDto } from "./dto";
const strict = (expectedType: Type<object>) => new ValidationPipe({ expectedType, whitelist: true, forbidNonWhitelisted: true, transform: true });
@Controller("project")
export class ProjectContextController {
  constructor(private readonly configuration: ConfigurationService) {}
  @Get("context") @Header("Cache-Control", "no-store")
  context() { return this.configuration.publicContext(); }
}
@Controller("admin")
@Permissions(CONFIGURATION_PERMISSION)
export class ConfigurationAdminController {
  constructor(private readonly configuration: ConfigurationService) {}
  @Get("project-profile") @Header("Cache-Control", "no-store")
  profile() { return this.configuration.profile(); }
  @Patch("project-profile") @Header("Cache-Control", "no-store")
  update(@Body(strict(UpdateProjectProfileDto)) d: object, @Req() r: AdminRequest) { return this.configuration.updateProfile(d as UpdateProjectProfileDto, r.user!.id, r.correlationId); }
  @Get("scoped-configs") @Header("Cache-Control", "no-store")
  list(@Query(strict(ScopedConfigQueryDto)) query: object) { return this.configuration.list(query as ScopedConfigQueryDto); }
  @Put("scoped-configs/:key") @Header("Cache-Control", "no-store")
  upsert(@Param() p: ConfigKeyDto, @Body(strict(UpsertScopedConfigDto)) d: object, @Req() r: AdminRequest) { return this.configuration.upsert(p.key, d as UpsertScopedConfigDto, r.user!.id, r.correlationId); }
  @Get("scoped-configs/:key/resolved") @Header("Cache-Control", "no-store")
  resolve(@Param() p: ConfigKeyDto) { return this.configuration.resolve(p.key); }
  @Get("configuration-changes") @Header("Cache-Control", "no-store")
  changes() { return this.configuration.changes(); }
}
