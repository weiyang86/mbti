import { Body, Controller, Get, Header, Param, Post, Query, Req, SetMetadata, UseFilters, UseGuards } from "@nestjs/common";
import { Permissions } from "../common/decorators/permissions.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { PermissionsGuard } from "../common/guards/permissions.guard";
import type { AdminRequest } from "../auth/auth.types";
import { grants } from "../../../../scripts/mbti/ops-policy.cjs";
import { MBTI_RAW, MbtiErrorFilter } from "./mbti.http";
import { MbtiOpsGenerationService } from "./mbti-ops-generation.service";

@Controller("admin/mbti/generation-jobs")
@SetMetadata(MBTI_RAW, true)
@UseFilters(MbtiErrorFilter)
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class MbtiOpsGenerationController {
  constructor(private readonly jobs: MbtiOpsGenerationService) {}

  @Get() @Permissions("mbti:orders:read") @Header("Cache-Control", "no-store")
  list(@Query() query: unknown) { return this.jobs.list(query); }

  @Post() @Permissions(grants.fulfillment) @Header("Cache-Control", "no-store")
  enqueue(@Req() req: AdminRequest, @Body() body: unknown) {
    return this.jobs.enqueue(body, req.user!.id, req.correlationId);
  }

  @Post(":id/retry") @Permissions(grants.generationRetry) @Header("Cache-Control", "no-store")
  retry(@Req() req: AdminRequest, @Param("id") id: string, @Body() body: unknown) {
    return this.jobs.retry(id, body, req.user!.id, req.correlationId);
  }
}
