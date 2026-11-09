import { BadRequestException, Controller, Header, HttpCode, Param, Post, Req, Type, ValidationPipe } from "@nestjs/common";
import type { IncomingMessage } from "node:http";
import { ProjectConnectorCodesDto } from "./connector.dto";
import { ConnectorWebhookService } from "./connector-webhook.service";

type RawWebhookRequest = IncomingMessage & { rawBody?: Buffer };
const strict = (expectedType: Type<object>) => new ValidationPipe({ expectedType, whitelist: true, forbidNonWhitelisted: true, transform: true });

@Controller("integrations/webhooks")
export class ConnectorWebhookController {
  constructor(private readonly webhooks: ConnectorWebhookService) {}

  @Post(":projectCode/:connectorCode")
  @HttpCode(202)
  @Header("Cache-Control", "no-store")
  receive(@Param(strict(ProjectConnectorCodesDto)) params: ProjectConnectorCodesDto, @Req() request: RawWebhookRequest) {
    if (!request.rawBody) throw new BadRequestException("Webhook raw body unavailable");
    return this.webhooks.receive(params.projectCode, params.connectorCode, request);
  }
}
