// Source Reflector/AND/current-DB mechanism adapted; no plugin or business owner copied.
import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PERMISSIONS_KEY, validPermissionCodes } from "../decorators/permissions.decorator";
import type { AdminRequest } from "../../auth/auth.types";
import { PermissionsService } from "../../rbac/permissions.service";

export function permissionRequirements(reflector: Reflector, handler: ReturnType<ExecutionContext["getHandler"]>, controller: ReturnType<ExecutionContext["getClass"]>): string[] {
  const declarations = [reflector.get<unknown>(PERMISSIONS_KEY, controller), reflector.get<unknown>(PERMISSIONS_KEY, handler)].filter(value => value !== undefined);
  if (!declarations.length || declarations.some(value => !validPermissionCodes(value))) throw new ForbiddenException("Permission denied");
  return [...new Set((declarations as string[][]).flat())];
}

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly permissions: PermissionsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AdminRequest>();
    if (!request.user?.id) throw new UnauthorizedException("Invalid authorization");
    const required = permissionRequirements(this.reflector, context.getHandler(), context.getClass());
    await this.permissions.requirePermissions(request.user.id, required, request.correlationId);
    return true;
  }
}
