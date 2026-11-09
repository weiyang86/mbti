import { Body, Controller, Get, Header, Param, Patch, Put, Req, Type, ValidationPipe } from "@nestjs/common";
import type { AdminRequest } from "../auth/auth.types";
import { Permissions } from "../common/decorators/permissions.decorator";
import { INTEGRATION_MANAGEMENT_PERMISSION } from "../../../../scripts/integration-policy.cjs";
import { ConfigureConnectorDto, ConnectorLifecycleDto, ProjectCodeDto, ProjectConnectorCodesDto } from "./connector.dto";
import { IntegrationCenterService } from "./integration-center.service";

const strict = (expectedType: Type<object>) => new ValidationPipe({ expectedType, whitelist: true, forbidNonWhitelisted: true, transform: true });

@Controller("admin/integrations")
@Permissions(INTEGRATION_MANAGEMENT_PERMISSION)
export class IntegrationCenterController {
  constructor(private readonly integrations: IntegrationCenterService) {}

  @Get("connectors") @Header("Cache-Control", "no-store")
  catalog() { return this.integrations.catalog(); }

  @Get("projects/:projectCode/connectors") @Header("Cache-Control", "no-store")
  list(@Param(strict(ProjectCodeDto)) params: object) {
    return this.integrations.list((params as ProjectCodeDto).projectCode);
  }

  @Put("projects/:projectCode/connectors/:connectorCode") @Header("Cache-Control", "no-store")
  configure(@Param(strict(ProjectConnectorCodesDto)) params: object,
    @Body(strict(ConfigureConnectorDto)) body: object, @Req() request: AdminRequest) {
    return this.integrations.configure((params as ProjectConnectorCodesDto).projectCode, (params as ProjectConnectorCodesDto).connectorCode,
      body as ConfigureConnectorDto, request.user!.id, request.correlationId);
  }

  @Patch("projects/:projectCode/connectors/:connectorCode/lifecycle") @Header("Cache-Control", "no-store")
  lifecycle(@Param(strict(ProjectConnectorCodesDto)) params: object,
    @Body(strict(ConnectorLifecycleDto)) body: object, @Req() request: AdminRequest) {
    const codes = params as ProjectConnectorCodesDto;
    return this.integrations.setLifecycle(codes.projectCode, codes.connectorCode, body as ConnectorLifecycleDto,
      request.user!.id, request.correlationId);
  }
}
