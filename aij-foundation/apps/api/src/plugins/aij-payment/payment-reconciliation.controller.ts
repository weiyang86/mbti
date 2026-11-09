import { Body, Controller, Get, Header, Param, Patch, Post, Query, Req, Type, ValidationPipe } from "@nestjs/common";
import type { AdminRequest } from "../../auth/auth.types";
import { Permissions } from "../../common/decorators/permissions.decorator";
import { PluginRoute } from "../../plugin-runtime/plugin-enabled.guard";
import {
  PAYMENT_RECONCILIATION_READ, PAYMENT_RECONCILIATION_REVIEW, PAYMENT_RECONCILIATION_RUN
} from "../../../../../scripts/payment-admin-policy.cjs";
import {
  CreatePaymentReconciliationDto, PaymentReconciliationListDto, ReviewPaymentReconciliationDiscrepancyDto
} from "./payment-reconciliation.dto";
import { PaymentReconciliationService } from "./payment-reconciliation.service";

const strict = (expectedType: Type<object>) => new ValidationPipe({ expectedType, whitelist: true, forbidNonWhitelisted: true, transform: true });

@Controller("admin/payments/reconciliations")
@PluginRoute("aij-payment")
export class PaymentReconciliationController {
  constructor(private readonly reconciliations: PaymentReconciliationService) {}

  @Get() @Permissions(PAYMENT_RECONCILIATION_READ) @Header("Cache-Control", "no-store")
  list(@Query(strict(PaymentReconciliationListDto)) query: object) {
    return this.reconciliations.list(query as PaymentReconciliationListDto);
  }

  @Get(":id") @Permissions(PAYMENT_RECONCILIATION_READ) @Header("Cache-Control", "no-store")
  get(@Param("id") id: string) { return this.reconciliations.get(id); }

  @Post() @Permissions(PAYMENT_RECONCILIATION_RUN) @Header("Cache-Control", "no-store")
  create(@Body(strict(CreatePaymentReconciliationDto)) dto: object, @Req() req: AdminRequest) {
    return this.reconciliations.create(dto as CreatePaymentReconciliationDto, req.user!.id, req.correlationId);
  }

  @Patch(":runId/discrepancies/:id/review") @Permissions(PAYMENT_RECONCILIATION_REVIEW) @Header("Cache-Control", "no-store")
  review(@Param("runId") runId: string, @Param("id") id: string, @Body(strict(ReviewPaymentReconciliationDiscrepancyDto)) dto: object, @Req() req: AdminRequest) {
    return this.reconciliations.review(runId, id, dto as ReviewPaymentReconciliationDiscrepancyDto, req.user!.id, req.correlationId);
  }
}
