import { Body, Controller, Get, Header, HttpCode, HttpStatus, Param, Post, Query, Req, Type, ValidationPipe } from "@nestjs/common";
import type { AdminRequest } from "../../auth/auth.types";
import { Permissions } from "../../common/decorators/permissions.decorator";
import { PluginRoute } from "../../plugin-runtime/plugin-enabled.guard";
import { PAYMENT_ADMIN_READ, PAYMENT_REFUND_REQUEST } from "../../../../../scripts/payment-admin-policy.cjs";
import { CreateManualRefundRequestDto, PaymentAdminOrderListDto, PaymentAdminRefundListDto } from "./payment-admin.dto";
import { PaymentAdminService } from "./payment-admin.service";

const strict = (expectedType: Type<object>) => new ValidationPipe({ expectedType, whitelist: true, forbidNonWhitelisted: true, transform: true });

@Controller("admin/payments")
@PluginRoute("aij-payment")
export class PaymentAdminController {
  constructor(private readonly payments: PaymentAdminService) {}

  @Get("orders") @Permissions(PAYMENT_ADMIN_READ) @Header("Cache-Control", "no-store")
  orders(@Query(strict(PaymentAdminOrderListDto)) query: object) { return this.payments.listOrders(query as PaymentAdminOrderListDto); }

  @Get("orders/:id") @Permissions(PAYMENT_ADMIN_READ) @Header("Cache-Control", "no-store")
  order(@Param("id") id: string) { return this.payments.getOrder(id); }

  @Get("refund-requests") @Permissions(PAYMENT_ADMIN_READ) @Header("Cache-Control", "no-store")
  refundRequests(@Query(strict(PaymentAdminRefundListDto)) query: object) { return this.payments.listRefundRequests(query as PaymentAdminRefundListDto); }

  @Post("orders/:id/refund-requests") @Permissions(PAYMENT_REFUND_REQUEST) @Header("Cache-Control", "no-store") @HttpCode(HttpStatus.CREATED)
  createRefundRequest(@Param("id") id: string, @Body(strict(CreateManualRefundRequestDto)) dto: object, @Req() req: AdminRequest) {
    return this.payments.createRefundRequest(id, dto as CreateManualRefundRequestDto, req.user!.id, req.correlationId);
  }
}
