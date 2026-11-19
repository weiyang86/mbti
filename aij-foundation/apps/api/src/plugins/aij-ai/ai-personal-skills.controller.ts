import { Body, CanActivate, Controller, Delete, ExecutionContext, Injectable, ForbiddenException, Get, Header, HttpCode, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { ServerResponse } from "node:http";
import type { ClientRequest } from "../../client-auth/client-auth.security";
import { RequireClientWorkspacePermissions } from "../../client-workspaces/client-workspace-permission.decorator";
import { CLIENT_WORKSPACE_PERMISSION as P } from "../../client-workspaces/client-workspace-permissions";
import { WorkspaceContextGuard } from "../../client-workspaces/workspace-context.guard";
import { AiPersonalSkillsService } from "./ai-personal-skills.service";

@Injectable()
export class PersonalSkillNoStoreGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    context.switchToHttp().getResponse<ServerResponse>().setHeader("Cache-Control", "private, no-store");
    return true;
  }
}

@Controller("client/ai/skills")
@UseGuards(PersonalSkillNoStoreGuard, WorkspaceContextGuard)
export class AiPersonalSkillsController {
  constructor(private readonly skills: AiPersonalSkillsService, private readonly config: ConfigService) {}
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
    return this.skills.list(c.memberId, c.workspaceId, query);
  }
  @Post()
  @HttpCode(201)
  @RequireClientWorkspacePermissions(P.aiAssetsManage)
  @Header("Cache-Control", "private, no-store")
  create(@Req() request: ClientRequest, @Body() body: unknown) {
    const c = this.context(request, true);
    return this.skills.create(c.memberId, c.workspaceId, body);
  }
  @Get(":id")
  @RequireClientWorkspacePermissions(P.aiAssetsRead)
  @Header("Cache-Control", "private, no-store")
  get(@Req() request: ClientRequest, @Param("id") id: string) {
    const c = this.context(request);
    return this.skills.get(c.memberId, c.workspaceId, id);
  }
  @Get(":id/versions")
  @RequireClientWorkspacePermissions(P.aiAssetsRead)
  @Header("Cache-Control", "private, no-store")
  versions(@Req() request: ClientRequest, @Param("id") id: string, @Query() query: unknown) {
    const c = this.context(request);
    return this.skills.versions(c.memberId, c.workspaceId, id, query);
  }
  @Patch(":id")
  @RequireClientWorkspacePermissions(P.aiAssetsManage)
  @Header("Cache-Control", "private, no-store")
  update(@Req() request: ClientRequest, @Param("id") id: string, @Body() body: unknown) {
    const c = this.context(request, true);
    return this.skills.update(c.memberId, c.workspaceId, id, body);
  }
  @Delete(":id")
  @RequireClientWorkspacePermissions(P.aiAssetsManage)
  @Header("Cache-Control", "private, no-store")
  delete(@Req() request: ClientRequest, @Param("id") id: string, @Body() body: unknown) {
    const c = this.context(request, true);
    return this.skills.delete(c.memberId, c.workspaceId, id, body);
  }
}
