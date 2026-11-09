import { Body, CanActivate, Controller, Delete, ExecutionContext, Injectable, ForbiddenException, Get, Header, HttpCode, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { ServerResponse } from "node:http";
import type { ClientRequest } from "../../client-auth/client-auth.security";
import { RequireClientWorkspacePermissions } from "../../client-workspaces/client-workspace-permission.decorator";
import { CLIENT_WORKSPACE_PERMISSION as P } from "../../client-workspaces/client-workspace-permissions";
import { WorkspaceContextGuard } from "../../client-workspaces/workspace-context.guard";
import { personalAgentObject } from "./ai-personal-agents.dto";
import { AiPersonalAgentsService } from "./ai-personal-agents.service";

@Injectable()
export class PersonalAgentNoStoreGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    context.switchToHttp().getResponse<ServerResponse>().setHeader("Cache-Control", "private, no-store");
    return true;
  }
}

@Controller("client/ai/personal-agents")
@UseGuards(PersonalAgentNoStoreGuard, WorkspaceContextGuard)
export class AiPersonalAgentsController {
  constructor(private readonly agents: AiPersonalAgentsService, private readonly config: ConfigService) {}
  private context(request: ClientRequest, mutation = false) {
    if (!request.client?.id || !request.workspaceContext?.workspaceId) throw new ForbiddenException("Workspace access denied");
    if (mutation && (request.headers.origin !== this.config.getOrThrow<string>("webUrl") || request.headers["sec-fetch-site"] === "cross-site")) {
      throw new ForbiddenException("Invalid request origin");
    }
    return { memberId: request.client.id, workspaceId: request.workspaceContext.workspaceId };
  }
  @Get()
  @RequireClientWorkspacePermissions(P.aiAssetsRead)
  @Header("Cache-Control", "private, no-store")
  list(@Req() request: ClientRequest, @Query() query: unknown) {
    const c = this.context(request);
    return this.agents.list(c.memberId, c.workspaceId, query);
  }
  @Post()
  @HttpCode(201)
  @RequireClientWorkspacePermissions(P.aiAssetsManage)
  @Header("Cache-Control", "private, no-store")
  create(@Req() request: ClientRequest, @Body() body: unknown, @Query() query: unknown) {
    const c = this.context(request, true);
    personalAgentObject(query, []);
    return this.agents.create(c.memberId, c.workspaceId, body, request.correlationId);
  }
  @Get("model-options")
  @RequireClientWorkspacePermissions(P.aiAssetsRead)
  @Header("Cache-Control", "private, no-store")
  modelOptions(@Req() request: ClientRequest, @Query() query: unknown) {
    const c = this.context(request);
    return this.agents.modelOptions(c.memberId, c.workspaceId, query);
  }
  @Get(":id")
  @RequireClientWorkspacePermissions(P.aiAssetsRead)
  @Header("Cache-Control", "private, no-store")
  get(@Req() request: ClientRequest, @Param("id") id: string, @Query() query: unknown) {
    personalAgentObject(query, []);
    const c = this.context(request);
    return this.agents.get(c.memberId, c.workspaceId, id);
  }
  @Get(":id/versions")
  @RequireClientWorkspacePermissions(P.aiAssetsRead)
  @Header("Cache-Control", "private, no-store")
  versions(@Req() request: ClientRequest, @Param("id") id: string, @Query() query: unknown) {
    const c = this.context(request);
    return this.agents.versions(c.memberId, c.workspaceId, id, query);
  }
  @Patch(":id")
  @RequireClientWorkspacePermissions(P.aiAssetsManage)
  @Header("Cache-Control", "private, no-store")
  update(@Req() request: ClientRequest, @Param("id") id: string, @Body() body: unknown, @Query() query: unknown) {
    const c = this.context(request, true);
    personalAgentObject(query, []);
    return this.agents.update(c.memberId, c.workspaceId, id, body, request.correlationId);
  }
  @Delete(":id")
  @RequireClientWorkspacePermissions(P.aiAssetsManage)
  @Header("Cache-Control", "private, no-store")
  delete(@Req() request: ClientRequest, @Param("id") id: string, @Body() body: unknown, @Query() query: unknown) {
    const c = this.context(request, true);
    personalAgentObject(query, []);
    return this.agents.delete(c.memberId, c.workspaceId, id, body, request.correlationId);
  }
}
