import { Body, Controller, Get, Header, HttpCode, Param, Patch, Post, Req, UseGuards } from "@nestjs/common";
import type { AdminRequest } from "../../auth/auth.types";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { PermissionsGuard } from "../../common/guards/permissions.guard";
import { Permissions } from "../../common/decorators/permissions.decorator";
import { PluginRoute } from "../../plugin-runtime/plugin-enabled.guard";
import { CONFIGURATION_PERMISSION } from "../../../../../scripts/configuration-policy.cjs";
import { MbtiConfigService } from "./mbti-config.service";

@Controller("plugins/mbti-config")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Permissions(CONFIGURATION_PERMISSION)
@PluginRoute("mbti-config")
export class MbtiConfigController {
  constructor(private readonly config: MbtiConfigService) {}
  @Header("Cache-Control", "no-store") @Get("draft") draft(@Req() r: AdminRequest) { return this.config.readView(r.user!.id, "draft"); }
  @Header("Cache-Control", "no-store") @Get("published") published(@Req() r: AdminRequest) { return this.config.readView(r.user!.id, "published"); }
  @Header("Cache-Control", "no-store") @Patch("draft/:category") save(@Req() r: AdminRequest, @Param("category") key: string, @Body() body: unknown) { return this.config.saveDraft(r.user!.id, key, body, r.correlationId); }
  @Header("Cache-Control", "no-store") @Post("publish") @HttpCode(200) publish(@Req() r: AdminRequest, @Body() body: unknown) { return this.config.publish(r.user!.id, body, r.correlationId); }
  @Header("Cache-Control", "no-store") @Post("versions/:version/rollback") @HttpCode(200) rollback(@Req() r: AdminRequest, @Param("version") version: string, @Body() body: unknown) { return this.config.rollback(r.user!.id, version, body, r.correlationId); }
  @Header("Cache-Control", "no-store") @Get("versions/:version") version(@Req() r: AdminRequest, @Param("version") version: string) { return this.config.version(r.user!.id, version); }
  @Header("Cache-Control", "no-store") @Get("audit") audit(@Req() r: AdminRequest) { return this.config.audit(r.user!.id); }
  @Header("Cache-Control", "no-store") @Get("versions") versions(@Req() r: AdminRequest) { return this.config.versions(r.user!.id); }
}
