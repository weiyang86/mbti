import { Body, Controller, Get, Header, HttpCode, Param, Post, Query, Req, Type, UnauthorizedException, ValidationPipe } from "@nestjs/common";
import { CLIENT_DIRECTORY_READ_PERMISSION, CLIENT_SESSION_REVOKE_PERMISSION } from "../../../../scripts/client-directory-policy.cjs";
import type { AdminRequest } from "../auth/auth.types";
import { Permissions } from "../common/decorators/permissions.decorator";
import { AdminClientDirectoryQueryDto, AdminClientHistoryPathDto, AdminClientHistoryQueryDto, AdminClientSessionRevokeDto, AdminClientSessionRevokePathDto } from "./admin-client-directory.dto";
import { AdminClientDirectoryService } from "./admin-client-directory.service";

const strict = (expectedType: Type<object>) => new ValidationPipe({ expectedType, whitelist: true, forbidNonWhitelisted: true, transform: true });

@Controller("admin/clients")
@Permissions(CLIENT_DIRECTORY_READ_PERMISSION)
export class AdminClientDirectoryController {
  constructor(private readonly clients: AdminClientDirectoryService) {}

  @Get() @Header("Cache-Control", "no-store")
  list(@Query(strict(AdminClientDirectoryQueryDto)) query: object, @Req() request: AdminRequest) {
    return this.clients.list(query as AdminClientDirectoryQueryDto, request.user!.id);
  }

  @Get(":memberId/sessions") @Header("Cache-Control", "no-store")
  sessions(@Param(strict(AdminClientHistoryPathDto)) params: object, @Query(strict(AdminClientHistoryQueryDto)) query: object, @Req() request: AdminRequest) {
    const { memberId } = params as AdminClientHistoryPathDto;
    return this.clients.listSessions(memberId, query as AdminClientHistoryQueryDto, request.user!.id);
  }

  @Get(":memberId/consents") @Header("Cache-Control", "no-store")
  consents(@Param(strict(AdminClientHistoryPathDto)) params: object, @Query(strict(AdminClientHistoryQueryDto)) query: object, @Req() request: AdminRequest) {
    const { memberId } = params as AdminClientHistoryPathDto;
    return this.clients.listConsents(memberId, query as AdminClientHistoryQueryDto, request.user!.id);
  }

  @Post(":memberId/sessions/:sessionId/revoke") @HttpCode(200) @Header("Cache-Control", "no-store")
  @Permissions(CLIENT_DIRECTORY_READ_PERMISSION, CLIENT_SESSION_REVOKE_PERMISSION)
  async revokeSession(@Param(strict(AdminClientSessionRevokePathDto)) params: object,
    @Body(strict(AdminClientSessionRevokeDto)) body: object, @Req() request: AdminRequest) {
    const { memberId, sessionId } = params as AdminClientSessionRevokePathDto;
    const result = await this.clients.revokeSession(memberId, sessionId, request.user!.id, request.adminSession!, (body as AdminClientSessionRevokeDto).currentPassword, request.correlationId);
    if (!result.reauthenticated) throw new UnauthorizedException("Reauthentication required");
    return { revoked: result.revoked, sessionId: result.sessionId };
  }
}
