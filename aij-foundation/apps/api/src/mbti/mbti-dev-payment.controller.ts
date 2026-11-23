import { Controller, Header, HttpCode, Param, Post, Req, SetMetadata, UseFilters, UseGuards } from "@nestjs/common";
import { GuestRequest, MBTI_RAW, MbtiErrorFilter, MbtiGuestGuard } from "./mbti.http";
import { MbtiOrdersService } from "./mbti-orders.service";

// Development-only payment simulation. Registered only when both NODE_ENV and APP_ENV
// are development; production builds never expose this route.
@Controller("v1/orders")
@SetMetadata(MBTI_RAW, true)
@UseFilters(MbtiErrorFilter)
@UseGuards(MbtiGuestGuard)
export class MbtiDevPaymentController {
  constructor(private readonly orders: MbtiOrdersService) {}
  @Post(":id/dev-pay")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  devPay(@Req() req: GuestRequest, @Param("id") id: string) { return this.orders.devMarkPaid(req.mbtiOwnerId, id); }
  @Post(":id/dev-fail")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  devFail(@Req() req: GuestRequest, @Param("id") id: string) { return this.orders.devMarkFailed(req.mbtiOwnerId, id); }
  @Post(":id/dev-refund")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  devRefund(@Req() req: GuestRequest, @Param("id") id: string) { return this.orders.devRefund(req.mbtiOwnerId, id); }
}
