import { DynamicModule, Module } from "@nestjs/common";
import type { Type } from "@nestjs/common";
import { resolveAllowlistedPluginModules } from "./plugin-manifest";
import { TRUSTED_PLUGINS } from "./trusted-plugins";

export function resolvePluginModules(enabledCodes: readonly string[]): Type<unknown>[] {
  return resolveAllowlistedPluginModules(enabledCodes, TRUSTED_PLUGINS);
}

@Module({})
export class PluginRuntimeModule {
  static forRoot(enabledCodes: readonly string[]): DynamicModule {
    return { module: PluginRuntimeModule, imports: resolvePluginModules(enabledCodes) };
  }
}
