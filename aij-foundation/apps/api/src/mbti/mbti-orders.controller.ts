import { Body, Controller, Get, Header, Headers, Param, Post, Query, Req, SetMetadata, UseFilters, UseGuards } from "@nestjs/common";
import { GuestRequest, MBTI_RAW, MbtiErrorFilter, MbtiGuestGuard } from "./mbti.http";
import { MbtiOrdersService } from "./mbti-orders.service";
import { Permissions } from "../common/decorators/permissions.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { PermissionsGuard } from "../common/guards/permissions.guard";

@Controller("v1")
@SetMetadata(MBTI_RAW, true)
@UseFilters(MbtiErrorFilter)
@UseGuards(MbtiGuestGuard)
export class MbtiOrdersController {
  constructor(private readonly orders: MbtiOrdersService) {}
  @Get("products") @Header("Cache-Control", "no-store") products() { return this.orders.products(); }
  @Post("orders") @Header("Cache-Control", "no-store") create(@Req() req: GuestRequest, @Body() body: unknown, @Headers("idempotency-key") key: unknown) { return this.orders.create(req.mbtiOwnerId, body, key); }
  @Get("orders") @Header("Cache-Control", "no-store") list(@Req() req: GuestRequest, @Query("limit") limit: unknown, @Query("cursor") cursor: unknown) { return this.orders.list(req.mbtiOwnerId, limit, cursor); }
  @Get("orders/:id") @Header("Cache-Control", "no-store") status(@Req() req: GuestRequest, @Param("id") id: string) { return this.orders.status(req.mbtiOwnerId, id); }
  @Get("entitlements/me") @Header("Cache-Control", "no-store") entitlements(@Req() req: GuestRequest) { return this.orders.entitlements(req.mbtiOwnerId); }
}

// Existing Foundation Auth/RBAC owners remain authoritative; no ops token or guest bypass.
@Controller("admin/mbti/orders")
@SetMetadata(MBTI_RAW, true)
@UseFilters(MbtiErrorFilter)
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class MbtiOrdersAdminController {
  constructor(private readonly orders: MbtiOrdersService) {}
  @Get(":id") @Permissions("mbti:orders:read") @Header("Cache-Control", "no-store")
  get(@Param("id") id: string) { return this.orders.operations(id); }
}
