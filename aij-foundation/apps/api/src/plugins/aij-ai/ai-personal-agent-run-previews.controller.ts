import { Body, CanActivate, Controller, ExecutionContext, ForbiddenException, Get, Header, Injectable, Param, Query, Req, UseGuards } from '@nestjs/common';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ClientRequest } from '../../client-auth/client-auth.security';
import { RequireClientWorkspacePermissions } from '../../client-workspaces/client-workspace-permission.decorator';
import { CLIENT_WORKSPACE_PERMISSION as P } from '../../client-workspaces/client-workspace-permissions';
import { WorkspaceContextGuard } from '../../client-workspaces/workspace-context.guard';
import { assertPersonalAgentPreviewNoBody } from './ai-personal-agent-run-previews.dto';
import { AiPersonalAgentRunPreviewsService } from './ai-personal-agent-run-previews.service';

/** Root must register BEFORE parsers/auth so malformed requests and 401/403 also stay private. */
export function personalAgentRunPreviewNoStore(request: IncomingMessage, response: ServerResponse, next: () => void): void {
  const path = (request.url ?? '').split('?', 1)[0];
  const prefix = '/api/client/ai/personal-agents';
  if (path === prefix || path.startsWith(prefix + '/')) response.setHeader('Cache-Control', 'private, no-store');
  next();
}

@Injectable()
export class PersonalAgentRunPreviewNoStoreGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    context.switchToHttp().getResponse<ServerResponse>().setHeader('Cache-Control', 'private, no-store');
    return true;
  }
}

@Controller('client/ai/personal-agents')
@UseGuards(PersonalAgentRunPreviewNoStoreGuard, WorkspaceContextGuard)
export class AiPersonalAgentRunPreviewsController {
  constructor(private readonly previews: AiPersonalAgentRunPreviewsService) {}

  @Get(':id/run-preview')
  @RequireClientWorkspacePermissions(P.aiExecute, P.aiAssetsRead)
  @Header('Cache-Control', 'private, no-store')
  preview(@Req() request: ClientRequest, @Param('id') id: string, @Query() query: unknown, @Body() body: unknown) {
    if (!request.client?.id || !request.workspaceContext?.workspaceId) throw new ForbiddenException('Workspace access denied');
    assertPersonalAgentPreviewNoBody(body, request.headers);
    return this.previews.preview(request.client.id, request.workspaceContext.workspaceId, id, query);
  }
}
