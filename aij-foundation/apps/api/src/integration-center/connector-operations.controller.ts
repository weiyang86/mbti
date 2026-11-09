import { Body, Controller, Get, Header, Param, Post, Query, Req, Type, ValidationPipe } from "@nestjs/common";
import type { AdminRequest } from "../auth/auth.types";
import { Permissions } from "../common/decorators/permissions.decorator";
import { INTEGRATION_MANAGEMENT_PERMISSION } from "../../../../scripts/integration-policy.cjs";
import { ConnectorOperationIdDto, ConnectorOperationsQueryDto, ConnectorProjectAndCodeDto, ConnectorProjectCodeDto, StartConnectorOperationDto } from "./connector-operation.dto";
import { ConnectorOperationsService } from "./connector-operations.service";

const strict = (expectedType: Type<object>) => new ValidationPipe({ expectedType, whitelist: true, forbidNonWhitelisted: true, transform: true });

@Controller("admin/integrations")
@Permissions(INTEGRATION_MANAGEMENT_PERMISSION)
export class ConnectorOperationsController {
  constructor(private readonly operations: ConnectorOperationsService) {}

  @Get("projects/:projectCode/operations") @Header("Cache-Control", "no-store")
  list(@Param(strict(ConnectorProjectCodeDto)) params: object, @Query(strict(ConnectorOperationsQueryDto)) query: ConnectorOperationsQueryDto) {
    return this.operations.list((params as ConnectorProjectCodeDto).projectCode, query);
  }

  @Get("projects/:projectCode/operations/:operationId") @Header("Cache-Control", "no-store")
  detail(@Param(strict(ConnectorOperationIdDto)) params: object) {
    const value = params as ConnectorOperationIdDto;
    return this.operations.detail(value.projectCode, value.operationId);
  }

  @Post("projects/:projectCode/connectors/:connectorCode/operations") @Header("Cache-Control", "no-store")
  start(@Param(strict(ConnectorProjectAndCodeDto)) params: object, @Body(strict(StartConnectorOperationDto)) body: StartConnectorOperationDto, @Req() request: AdminRequest) {
    const value = params as ConnectorProjectAndCodeDto;
    return this.operations.start(value.projectCode, value.connectorCode, body.type, request.user!.id, request.correlationId);
  }

  @Post("projects/:projectCode/operations/:operationId/retry") @Header("Cache-Control", "no-store")
  retry(@Param(strict(ConnectorOperationIdDto)) params: object, @Req() request: AdminRequest) {
    const value = params as ConnectorOperationIdDto;
    return this.operations.retry(value.projectCode, value.operationId, request.user!.id, request.correlationId);
  }
}
