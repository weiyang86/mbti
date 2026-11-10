import { Body, Controller, Get, Header, Param, Post, Query, Req, SetMetadata, UseFilters, UseGuards } from "@nestjs/common";
import { Permissions } from "../common/decorators/permissions.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { PermissionsGuard } from "../common/guards/permissions.guard";
import type { AdminRequest } from "../auth/auth.types";
import { grants } from "../../../../scripts/mbti/ops-policy.cjs";
import { MBTI_RAW, MbtiErrorFilter } from "./mbti.http";
import { MbtiOpsModerationService } from "./mbti-ops-moderation.service";

@Controller("admin/mbti/moderation/cases")
@SetMetadata(MBTI_RAW, true)
@UseFilters(MbtiErrorFilter)
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class MbtiOpsModerationController {
  constructor(private readonly cases: MbtiOpsModerationService) {}

  @Get() @Permissions(grants.moderationRead) @Header("Cache-Control", "no-store")
  list(@Query() query: unknown) { return this.cases.list(query); }

  @Post() @Permissions(grants.moderation) @Header("Cache-Control", "no-store")
  intake(@Req() req: AdminRequest, @Body() body: unknown) {
    return this.cases.intake(body, req.user!.id, req.correlationId);
  }

  @Post(":id/dispose") @Permissions(grants.moderation) @Header("Cache-Control", "no-store")
  dispose(@Req() req: AdminRequest, @Param("id") id: string, @Body() body: unknown) {
    return this.cases.dispose(id, body, req.user!.id, req.correlationId);
  }
}
