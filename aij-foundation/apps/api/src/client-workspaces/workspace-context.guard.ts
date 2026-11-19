import { BadRequestException, CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ClientAuthGuard } from "../client-auth/client-auth.guard";
import type { ClientRequest } from "../client-auth/client-auth.security";
import { CLIENT_WORKSPACE_PERMISSIONS_KEY, validClientWorkspacePermissionCodes } from "./client-workspace-permission.decorator";
import { WorkspaceContextService } from "./workspace-context.service";

export const CLIENT_WORKSPACE_ID_HEADER = "x-aij-workspace-id";

@Injectable()
export class WorkspaceContextGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly clientAuth: ClientAuthGuard,
    private readonly workspaceContext: WorkspaceContextService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    await this.clientAuth.canActivate(context);
    const request = context.switchToHttp().getRequest<ClientRequest>();
    if (!request.client?.id) throw new UnauthorizedException("Invalid client session");
    const required = this.reflector.getAllAndOverride<unknown>(CLIENT_WORKSPACE_PERMISSIONS_KEY, [context.getHandler(), context.getClass()]);
    if (!validClientWorkspacePermissionCodes(required)) throw new ForbiddenException("Workspace access denied");
    const rawWorkspaceId = request.headers[CLIENT_WORKSPACE_ID_HEADER];
    if (typeof rawWorkspaceId !== "string" || !rawWorkspaceId.trim()) throw new BadRequestException("Workspace context is required");
    request.workspaceContext = await this.workspaceContext.resolve(request.client.id, rawWorkspaceId, required);
    return true;
  }
}
