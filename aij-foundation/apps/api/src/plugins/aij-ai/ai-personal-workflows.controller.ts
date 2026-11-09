import { HttpException, Body, CanActivate, Controller, Delete, ExecutionContext, Injectable, ForbiddenException, Get, Header, HttpCode, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { ServerResponse } from "node:http";
import type { ClientRequest } from "../../client-auth/client-auth.security";
import { RequireClientWorkspacePermissions } from "../../client-workspaces/client-workspace-permission.decorator";
import { CLIENT_WORKSPACE_PERMISSION as P } from "../../client-workspaces/client-workspace-permissions";
import { WorkspaceContextGuard } from "../../client-workspaces/workspace-context.guard";
import { personalWorkflowObject, workflowRequest } from "./ai-personal-workflows.dto";
import { parseWorkflowJson } from "./ai-personal-workflows-graph";
import { AiPersonalWorkflowsService } from "./ai-personal-workflows.service";

@Injectable()
export class PersonalWorkflowNoStoreGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    context.switchToHttp().getResponse<ServerResponse>().setHeader("Cache-Control", "private, no-store");
    return true;
  }
}

@Controller("client/ai/personal-workflows")
@UseGuards(PersonalWorkflowNoStoreGuard, WorkspaceContextGuard)
export class AiPersonalWorkflowsController {
  constructor(private readonly workflows: AiPersonalWorkflowsService, private readonly config: ConfigService) {}
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
  list(@Req() request: ClientRequest, @Query() query: unknown, @Body() body?: unknown) {
    if (body !== undefined) personalWorkflowObject(body, []);
    const c = this.context(request);
    return this.workflows.list(c.memberId, c.workspaceId, query);
  }
  @Post()
  @HttpCode(201)
  @RequireClientWorkspacePermissions(P.aiAssetsManage)
  @Header("Cache-Control", "private, no-store")
  create(@Req() request: ClientRequest, @Body() body: unknown, @Query() query: unknown) {
    const c = this.context(request, true);
    personalWorkflowObject(query, []);
    return this.workflows.create(c.memberId, c.workspaceId, body, request.correlationId);
  }
  @Get(":id")
  @RequireClientWorkspacePermissions(P.aiAssetsRead)
  @Header("Cache-Control", "private, no-store")
  get(@Req() request: ClientRequest, @Param("id") id: string, @Query() query: unknown, @Body() body?: unknown) {
    if (body !== undefined) personalWorkflowObject(body, []);
    personalWorkflowObject(query, []);
    const c = this.context(request);
    return this.workflows.get(c.memberId, c.workspaceId, id);
  }
  @Get(":id/versions")
  @RequireClientWorkspacePermissions(P.aiAssetsRead)
  @Header("Cache-Control", "private, no-store")
  versions(@Req() request: ClientRequest, @Param("id") id: string, @Query() query: unknown, @Body() body?: unknown) {
    if (body !== undefined) personalWorkflowObject(body, []);
    const c = this.context(request);
    return this.workflows.versions(c.memberId, c.workspaceId, id, query);
  }
  @Get(":id/versions/:revision")
  @RequireClientWorkspacePermissions(P.aiAssetsRead)
  @Header("Cache-Control", "private, no-store")
  getVersion(@Req() request: ClientRequest, @Param("id") id: string, @Param("revision") revision: string, @Query() query: unknown, @Body() body?: unknown) {
    if (body !== undefined) personalWorkflowObject(body, []);
    personalWorkflowObject(query, []);
    const c = this.context(request);
    return this.workflows.getVersion(c.memberId, c.workspaceId, id, revision);
  }
  @Patch(":id")
  @RequireClientWorkspacePermissions(P.aiAssetsManage)
  @Header("Cache-Control", "private, no-store")
  update(@Req() request: ClientRequest, @Param("id") id: string, @Body() body: unknown, @Query() query: unknown) {
    const c = this.context(request, true);
    personalWorkflowObject(query, []);
    return this.workflows.update(c.memberId, c.workspaceId, id, body, request.correlationId);
  }
  @Delete(":id")
  @RequireClientWorkspacePermissions(P.aiAssetsManage)
  @Header("Cache-Control", "private, no-store")
  delete(@Req() request: ClientRequest, @Param("id") id: string, @Body() body: unknown, @Query() query: unknown) {
    const c = this.context(request, true);
    personalWorkflowObject(query, []);
    return this.workflows.delete(c.memberId, c.workspaceId, id, body, request.correlationId);
  }
}

/** Root must install before its JSON parser, including malformed/oversize bodies and auth failures. */
export function personalWorkflowPrivateMiddleware(request: { url?: string; originalUrl?: string }, response: ServerResponse, next: () => void) {
  if (/^\/(?:api\/)?client\/ai\/personal-workflows(?:[/?]|$)/i.test(request.originalUrl ?? request.url ?? "")) response.setHeader("Cache-Control", "private, no-store");
  next();
}
/** Root wires this as JSON parser verify on the private workflow prefix; never after JSON.parse. */
export function personalWorkflowJsonVerify(request: { url?: string; originalUrl?: string }, response: ServerResponse, buffer: Buffer) {
  if (!/^\/(?:api\/)?client\/ai\/personal-workflows(?:[/?]|$)/i.test(request.originalUrl ?? request.url ?? "")) return;
  response.setHeader("Cache-Control", "private, no-store");
  if (buffer.length > 98304) throw new HttpException("Workflow request too large", 413);
  workflowRequest(() => parseWorkflowJson(new TextDecoder("utf-8", { fatal: true }).decode(buffer)));
}
