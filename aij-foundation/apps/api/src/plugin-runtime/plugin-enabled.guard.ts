import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { SetMetadata, UseGuards, applyDecorators } from "@nestjs/common";
import { PluginRuntimeAccessService } from "./plugin-runtime-access.service";

export const PLUGIN_ROUTE_CODE = "aij:plugin-route-code";
const validCode = (code: unknown): code is string => typeof code === "string" && /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(code);

/** Plugin controllers must opt into this decorator; an enabled installation is checked for each request. */
export function PluginRoute(pluginCode: string): ClassDecorator & MethodDecorator {
  if (!validCode(pluginCode)) throw new Error("PluginRoute requires a valid plugin code");
  return applyDecorators(SetMetadata(PLUGIN_ROUTE_CODE, pluginCode), UseGuards(PluginEnabledGuard)) as ClassDecorator & MethodDecorator;
}

@Injectable()
export class PluginEnabledGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly access: PluginRuntimeAccessService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const code = this.reflector.getAllAndOverride<unknown>(PLUGIN_ROUTE_CODE, [context.getHandler(), context.getClass()]);
    if (!validCode(code)) throw new ForbiddenException("Plugin route is not registered");
    await this.access.assertEnabled(code);
    return true;
  }
}
