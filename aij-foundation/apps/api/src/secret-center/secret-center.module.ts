import { Module } from "@nestjs/common";
import { RbacModule } from "../rbac/rbac.module";
import { SecretCenterController } from "./secret-center.controller";
import { SecretCenterService } from "./secret-center.service";
import { PluginRuntimeAccessModule } from "../plugin-runtime/plugin-runtime-access.module";
import { SecretRefPort } from "./secret-ref";
@Module({ imports: [RbacModule, PluginRuntimeAccessModule], controllers: [SecretCenterController], providers: [SecretCenterService, { provide: SecretRefPort, useExisting: SecretCenterService }], exports: [SecretRefPort, SecretCenterService] })
export class SecretCenterModule {}
