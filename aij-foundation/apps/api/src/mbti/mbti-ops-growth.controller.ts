import { Controller, Get, Header, Query, SetMetadata, UseFilters, UseGuards } from "@nestjs/common";
import { Permissions } from "../common/decorators/permissions.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { PermissionsGuard } from "../common/guards/permissions.guard";
import { MBTI_RAW, MbtiErrorFilter } from "./mbti.http";
import { MbtiOpsGrowthService } from "./mbti-ops-growth.service";

@Controller("admin/mbti/growth")
@SetMetadata(MBTI_RAW, true)
@UseFilters(MbtiErrorFilter)
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class MbtiOpsGrowthController {
  constructor(private readonly growth: MbtiOpsGrowthService) {}

  @Get("summary") @Permissions("mbti:ops:access") @Header("Cache-Control", "no-store")
  summary(@Query() query: unknown) { return this.growth.summary(query); }
}
