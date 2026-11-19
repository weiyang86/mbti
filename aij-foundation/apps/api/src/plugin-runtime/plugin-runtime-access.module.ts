import { Module } from "@nestjs/common";
import { PluginEnabledGuard } from "./plugin-enabled.guard";
import { PluginRuntimeAccessService } from "./plugin-runtime-access.service";

@Module({ providers: [PluginRuntimeAccessService, PluginEnabledGuard], exports: [PluginRuntimeAccessService, PluginEnabledGuard] })
export class PluginRuntimeAccessModule {}
