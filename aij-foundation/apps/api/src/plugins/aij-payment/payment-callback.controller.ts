import { BadRequestException, Controller, Header, HttpCode, HttpStatus, Param, Post, Req } from "@nestjs/common";
import type { IncomingMessage } from "node:http";
import { PaymentCallbackService } from "./payment-callback.service";

type RawPaymentCallbackRequest = IncomingMessage & { rawBody?: Buffer; headers: IncomingMessage["headers"]; correlationId?: string };

@Controller("payments/callbacks")
export class PaymentCallbackController {
  constructor(private readonly callbacks: PaymentCallbackService) {}

  @Post(":projectCode/:providerCode")
  @HttpCode(HttpStatus.OK)
  @Header("Cache-Control", "no-store")
  receive(
    @Param("projectCode") projectCode: string,
    @Param("providerCode") providerCode: string,
    @Req() request: RawPaymentCallbackRequest
  ) {
    const contentType = request.headers["content-type"];
    if (typeof contentType !== "string" || !/^application\/json(?:\s*;|$)/i.test(contentType)) {
      throw new BadRequestException("Payment callback content type must be application/json");
    }
    return this.callbacks.receive(projectCode, providerCode, { rawBody: request.rawBody, headers: request.headers }, request.correlationId);
  }
}
