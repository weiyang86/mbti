import { DynamicModule, Module } from "@nestjs/common";
import { RbacModule } from "../rbac/rbac.module";
import { PluginCatalog } from "./plugin-catalog";
import { PluginLifecycleService } from "./plugin-lifecycle.service";
import { PluginManagementController } from "./plugin-management.controller";
import { PluginRuntimeAccessModule } from "./plugin-runtime-access.module";
import { TRUSTED_PLUGINS } from "./trusted-plugins";
import { NotificationManagementModule } from "../plugins/aij-notification/notification-management.module";

@Module({})
export class PluginManagementModule {
  static forRoot(catalog = new PluginCatalog(TRUSTED_PLUGINS)): DynamicModule {
    return {
      module: PluginManagementModule,
      imports: [RbacModule, PluginRuntimeAccessModule, NotificationManagementModule],
      controllers: [PluginManagementController],
      providers: [PluginLifecycleService, { provide: PluginCatalog, useValue: catalog }],
      exports: [PluginLifecycleService, PluginCatalog, PluginRuntimeAccessModule]
    };
  }
}
