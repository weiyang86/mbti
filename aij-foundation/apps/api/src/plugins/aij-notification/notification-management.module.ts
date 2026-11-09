import { Module } from "@nestjs/common";
import { PluginRuntimeAccessModule } from "../../plugin-runtime/plugin-runtime-access.module";
import { RbacModule } from "../../rbac/rbac.module";
import { SecretCenterModule } from "../../secret-center/secret-center.module";
import { NotificationManagementController } from "./notification-management.controller";
import { NotificationManagementService } from "./notification-management.service";

@Module({
  imports: [RbacModule, PluginRuntimeAccessModule, SecretCenterModule],
  controllers: [NotificationManagementController],
  providers: [NotificationManagementService],
  exports: [NotificationManagementService]
})
export class NotificationManagementModule {}
