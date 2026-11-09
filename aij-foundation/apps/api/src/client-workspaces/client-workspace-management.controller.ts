import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  ValidationPipe
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { ClientRequest } from "../client-auth/client-auth.security";
import { ClientAuthGuard } from "../client-auth/client-auth.guard";
import {
  ChangeClientWorkspaceMembershipRoleDto,
  ChangeClientWorkspaceMembershipStatusDto,
  ClientWorkspacePageQueryDto,
  CreateClientWorkspaceDto,
  CreateClientWorkspaceMembershipDto,
  UpdateClientWorkspaceDto
} from "./client-workspace.dto";
import { RequireClientWorkspacePermissions } from "./client-workspace-permission.decorator";
import { CLIENT_WORKSPACE_PERMISSION } from "./client-workspace-permissions";
import { WorkspaceContextGuard } from "./workspace-context.guard";
import { ClientWorkspaceManagementService } from "./client-workspace-management.service";

@Controller("client/workspaces")
export class ClientWorkspaceManagementController {
  constructor(private readonly workspaces: ClientWorkspaceManagementService, private readonly config: ConfigService) {}

  private assertSameOrigin(request: ClientRequest) {
    if (request.headers.origin !== this.config.getOrThrow("webUrl") || request.headers["sec-fetch-site"] === "cross-site") {
      throw new ForbiddenException("Invalid request origin");
    }
  }

  private workspaceContext(request: ClientRequest) {
    if (!request.client?.id || !request.workspaceContext) throw new ForbiddenException("Workspace access denied");
    return { memberId: request.client.id, context: request.workspaceContext };
  }

  @Get()
  @UseGuards(ClientAuthGuard)
  @Header("Cache-Control", "private, no-store")
  list(@Query(new ValidationPipe({ expectedType: ClientWorkspacePageQueryDto, whitelist: true, forbidNonWhitelisted: true, transform: true })) query: object, @Req() request: ClientRequest) {
    const page = query as ClientWorkspacePageQueryDto;
    return this.workspaces.listWorkspaces(request.client!.id, page.page, page.pageSize);
  }

  @Post()
  @UseGuards(ClientAuthGuard)
  async create(
    @Body(new ValidationPipe({ expectedType: CreateClientWorkspaceDto, whitelist: true, forbidNonWhitelisted: true, transform: true })) body: object,
    @Req() request: ClientRequest
  ) {
    this.assertSameOrigin(request);
    return this.workspaces.createWorkspace(request.client!.id, body as CreateClientWorkspaceDto, request.correlationId);
  }

  @Get("roles")
  @RequireClientWorkspacePermissions(CLIENT_WORKSPACE_PERMISSION.roleRead)
  @UseGuards(WorkspaceContextGuard)
  @Header("Cache-Control", "private, no-store")
  listRoles(@Req() request: ClientRequest) {
    return this.workspaces.listRoles(this.workspaceContext(request).context.workspaceId);
  }

  @Get("members")
  @RequireClientWorkspacePermissions(CLIENT_WORKSPACE_PERMISSION.memberRead)
  @UseGuards(WorkspaceContextGuard)
  @Header("Cache-Control", "private, no-store")
  listMembers(
    @Query(new ValidationPipe({ expectedType: ClientWorkspacePageQueryDto, whitelist: true, forbidNonWhitelisted: true, transform: true })) query: object,
    @Req() request: ClientRequest
  ) {
    const page = query as ClientWorkspacePageQueryDto;
    return this.workspaces.listMembers(this.workspaceContext(request).context.workspaceId, page.page, page.pageSize);
  }

  @Post("members")
  @RequireClientWorkspacePermissions(CLIENT_WORKSPACE_PERMISSION.memberManage)
  @UseGuards(WorkspaceContextGuard)
  async addMember(
    @Body(new ValidationPipe({ expectedType: CreateClientWorkspaceMembershipDto, whitelist: true, forbidNonWhitelisted: true, transform: true })) body: object,
    @Req() request: ClientRequest
  ) {
    this.assertSameOrigin(request);
    const { memberId, context } = this.workspaceContext(request);
    return this.workspaces.addMember(memberId, context.permissions, context.workspaceId, body as CreateClientWorkspaceMembershipDto, request.correlationId);
  }

  @Patch("members/:membershipId/role")
  @RequireClientWorkspacePermissions(CLIENT_WORKSPACE_PERMISSION.memberManage)
  @UseGuards(WorkspaceContextGuard)
  async changeMemberRole(
    @Param("membershipId") membershipId: string,
    @Body(new ValidationPipe({ expectedType: ChangeClientWorkspaceMembershipRoleDto, whitelist: true, forbidNonWhitelisted: true, transform: true })) body: object,
    @Req() request: ClientRequest
  ) {
    this.assertSameOrigin(request);
    const { memberId, context } = this.workspaceContext(request);
    return this.workspaces.changeMemberRole(memberId, context.permissions, context.workspaceId, membershipId, body as ChangeClientWorkspaceMembershipRoleDto, request.correlationId);
  }

  @Patch("members/:membershipId/status")
  @RequireClientWorkspacePermissions(CLIENT_WORKSPACE_PERMISSION.memberManage)
  @UseGuards(WorkspaceContextGuard)
  async changeMemberStatus(
    @Param("membershipId") membershipId: string,
    @Body(new ValidationPipe({ expectedType: ChangeClientWorkspaceMembershipStatusDto, whitelist: true, forbidNonWhitelisted: true, transform: true })) body: object,
    @Req() request: ClientRequest
  ) {
    this.assertSameOrigin(request);
    const { memberId, context } = this.workspaceContext(request);
    return this.workspaces.changeMemberStatus(memberId, context.workspaceId, membershipId, body as ChangeClientWorkspaceMembershipStatusDto, request.correlationId);
  }

  @Post("leave")
  @RequireClientWorkspacePermissions(CLIENT_WORKSPACE_PERMISSION.contextRead)
  @UseGuards(WorkspaceContextGuard)
  async leave(@Req() request: ClientRequest) {
    this.assertSameOrigin(request);
    const { memberId, context } = this.workspaceContext(request);
    return this.workspaces.leave(memberId, context.workspaceId, request.correlationId);
  }

  @Patch("details")
  @RequireClientWorkspacePermissions(CLIENT_WORKSPACE_PERMISSION.workspaceManage)
  @UseGuards(WorkspaceContextGuard)
  async updateDetails(
    @Body(new ValidationPipe({ expectedType: UpdateClientWorkspaceDto, whitelist: true, forbidNonWhitelisted: true, transform: true })) body: object,
    @Req() request: ClientRequest
  ) {
    this.assertSameOrigin(request);
    const { memberId, context } = this.workspaceContext(request);
    return this.workspaces.updateWorkspace(memberId, context.workspaceId, body as UpdateClientWorkspaceDto, request.correlationId);
  }
}
