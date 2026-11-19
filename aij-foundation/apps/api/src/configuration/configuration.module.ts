import { Module } from "@nestjs/common";
import { RbacModule } from "../rbac/rbac.module";
import { ConfigurationAdminController, ProjectContextController } from "./configuration.controller";
import { ConfigurationService } from "./configuration.service";
import { SecretCenterModule } from "../secret-center/secret-center.module";
import { ExternalServicesController } from "./external-services.controller";
import { ExternalServicesService } from "./external-services.service";
@Module({ imports: [RbacModule, SecretCenterModule], controllers: [ConfigurationAdminController, ProjectContextController, ExternalServicesController], providers: [ConfigurationService, ExternalServicesService], exports: [ConfigurationService] })
export class ConfigurationModule {}
