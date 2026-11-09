import { Body, Controller, ForbiddenException, Get, Header, HttpCode, HttpStatus, Param, Post, Req, UseGuards, ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { ClientRequest } from "../../client-auth/client-auth.security";
import { RequireClientWorkspacePermissions } from "../../client-workspaces/client-workspace-permission.decorator";
import { CLIENT_WORKSPACE_PERMISSION } from "../../client-workspaces/client-workspace-permissions";
import { WorkspaceContextGuard } from "../../client-workspaces/workspace-context.guard";
import { PluginRoute } from "../../plugin-runtime/plugin-enabled.guard";
import { CreatePaymentOrderDto } from "./payment.dto";
import { PaymentService } from "./payment.service";

@Controller("client/payments")
@PluginRoute("aij-payment")
@UseGuards(WorkspaceContextGuard)
export class PaymentController {
  constructor(private readonly payments: PaymentService, private readonly config: ConfigService) {}

  private assertSameOrigin(request: ClientRequest) {
    if (request.headers.origin !== this.config.getOrThrow<string>("webUrl") || request.headers["sec-fetch-site"] === "cross-site") {
      throw new ForbiddenException("Invalid request origin");
    }
  }

  @Post("orders")
  @HttpCode(HttpStatus.CREATED)
  @Header("Cache-Control", "private, no-store")
  @RequireClientWorkspacePermissions(CLIENT_WORKSPACE_PERMISSION.paymentCreate)
  createOrder(
    @Body(new ValidationPipe({ expectedType: CreatePaymentOrderDto, whitelist: true, forbidNonWhitelisted: true, transform: true })) body: object,
    @Req() request: ClientRequest
  ) {
    this.assertSameOrigin(request);
    return this.payments.createOrder(body as CreatePaymentOrderDto, {
      memberId: request.client!.id,
      workspaceId: request.workspaceContext!.workspaceId,
      correlationId: request.correlationId
    });
  }

  @Get("orders/:orderId")
  @Header("Cache-Control", "private, no-store")
  @RequireClientWorkspacePermissions(CLIENT_WORKSPACE_PERMISSION.paymentRead)
  getOrder(@Param("orderId") orderId: string, @Req() request: ClientRequest) {
    return this.payments.getOrder(orderId, {
      memberId: request.client!.id,
      workspaceId: request.workspaceContext!.workspaceId
    });
  }
}
