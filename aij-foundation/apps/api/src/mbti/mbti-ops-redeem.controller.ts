import { Body, Controller, Get, Header, Param, Post, Query, Req, SetMetadata, UseFilters, UseGuards } from "@nestjs/common";
import { Permissions } from "../common/decorators/permissions.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { PermissionsGuard } from "../common/guards/permissions.guard";
import type { AdminRequest } from "../auth/auth.types";
import { grants } from "../../../../scripts/mbti/ops-policy.cjs";
import { MBTI_RAW, MbtiErrorFilter } from "./mbti.http";
import { MbtiOpsRedeemService } from "./mbti-ops-redeem.service";

@Controller("admin/mbti/redeem-codes")
@SetMetadata(MBTI_RAW, true)
@UseFilters(MbtiErrorFilter)
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class MbtiOpsRedeemController {
  constructor(private readonly redeem: MbtiOpsRedeemService) {}

  @Get() @Permissions("mbti:orders:read") @Header("Cache-Control", "no-store")
  list(@Query() query: unknown) { return this.redeem.list(query); }

  @Post() @Permissions(grants.redemption) @Header("Cache-Control", "no-store")
  create(@Req() req: AdminRequest, @Body() body: unknown) {
    return this.redeem.create(body, req.user!.id, req.correlationId);
  }

  @Post(":id/disable") @Permissions(grants.redemption) @Header("Cache-Control", "no-store")
  disable(@Req() req: AdminRequest, @Param("id") id: string) {
    return this.redeem.disable(id, req.user!.id, req.correlationId);
  }
}
