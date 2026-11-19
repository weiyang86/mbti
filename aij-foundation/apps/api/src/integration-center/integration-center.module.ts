import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { RbacModule } from "../rbac/rbac.module";
import { SecretCenterModule } from "../secret-center/secret-center.module";
import { IntegrationCenterController } from "./integration-center.controller";
import { IntegrationCenterService } from "./integration-center.service";
import { ConnectorWebhookController } from "./connector-webhook.controller";
import { ConnectorWebhookService } from "./connector-webhook.service";
import { ConnectorOperationsController } from "./connector-operations.controller";
import { ConnectorOperationsService } from "./connector-operations.service";

@Module({
  imports: [AuthModule, RbacModule, SecretCenterModule],
  controllers: [IntegrationCenterController, ConnectorWebhookController, ConnectorOperationsController],
  providers: [IntegrationCenterService, ConnectorWebhookService, ConnectorOperationsService],
  exports: [IntegrationCenterService, ConnectorWebhookService, ConnectorOperationsService]
})
export class IntegrationCenterModule {}
