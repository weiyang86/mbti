import { Controller, Get, Header, Query, SetMetadata, UseFilters, UseGuards } from "@nestjs/common";
import { Permissions } from "../common/decorators/permissions.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { PermissionsGuard } from "../common/guards/permissions.guard";
import { MBTI_RAW, MbtiErrorFilter } from "./mbti.http";
import { MbtiOpsRetentionService } from "./mbti-ops-retention.service";

@Controller("admin/mbti/retention")
@SetMetadata(MBTI_RAW, true)
@UseFilters(MbtiErrorFilter)
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class MbtiOpsRetentionController {
  constructor(private readonly retention: MbtiOpsRetentionService) {}

  @Get("cohorts") @Permissions("mbti:ops:access") @Header("Cache-Control", "no-store")
  cohorts(@Query() query: unknown) { return this.retention.cohorts(query); }
}
