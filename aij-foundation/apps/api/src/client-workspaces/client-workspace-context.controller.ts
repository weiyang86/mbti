import { Controller, Get, Header, Req, UnauthorizedException, UseGuards } from "@nestjs/common";
import { createHash } from 'node:crypto';
import type { ClientRequest } from "../client-auth/client-auth.security";
import { RequireClientWorkspacePermissions } from "./client-workspace-permission.decorator";
import { CLIENT_WORKSPACE_PERMISSION } from "./client-workspace-permissions";
import { WorkspaceContextGuard } from "./workspace-context.guard";

@Controller("client/workspaces")
export class ClientWorkspaceContextController {
  @Get("context")
  @Header("Cache-Control", "private, no-store")
  @RequireClientWorkspacePermissions(CLIENT_WORKSPACE_PERMISSION.contextRead)
  @UseGuards(WorkspaceContextGuard)
  getContext(@Req() request: ClientRequest) {
    if (!request.clientClaims?.sessionId || !request.workspaceContext) throw new UnauthorizedException('Invalid client session');
    // Noncredential generation for fencing same-member session changes in private UI.
    const sessionGeneration = createHash('sha256').update(JSON.stringify(['client-session-generation-v1', request.clientClaims.sessionId])).digest('hex');
    return { ...request.workspaceContext, sessionGeneration };
  }
}
