import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { PATH_METADATA } from "@nestjs/common/constants";
import { Reflector } from "@nestjs/core";
import { AUTHENTICATED_ADMIN_KEY } from "../decorators/authenticated-admin.decorator";
import { PERMISSIONS_KEY } from "../decorators/permissions.decorator";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { PermissionsGuard } from "./permissions.guard";

@Injectable()
export class AdminAuthorizationGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly jwt: JwtAuthGuard, private readonly permissions: PermissionsGuard) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Server route metadata, including root controllers and path arrays; no client URL/claims.
    const paths = (target: ReturnType<ExecutionContext["getClass"]> | ReturnType<ExecutionContext["getHandler"]>): string[] => {
      const value = this.reflector.get<string | string[] | undefined>(PATH_METADATA, target);
      return Array.isArray(value) ? value : [value ?? ""];
    };
    const admin = paths(context.getClass()).some(controller => paths(context.getHandler()).some(handler =>
      (controller + "/" + handler).split("/").filter(Boolean)[0]?.toLowerCase() === "admin"));
    if (!admin) return true;
    await this.jwt.canActivate(context);
    const ownRead = this.reflector.get<unknown>(AUTHENTICATED_ADMIN_KEY, context.getHandler());
    if (ownRead === true) {
      // Exceptions cannot override permission declarations (including corrupted declarations).
      if ([context.getClass(), context.getHandler()].some(target => this.reflector.get(PERMISSIONS_KEY, target) !== undefined)) throw new ForbiddenException("Permission denied");
      return true;
    }
    return this.permissions.canActivate(context);
  }
}
