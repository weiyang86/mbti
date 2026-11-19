import { Body, CanActivate, Controller, ExecutionContext, ForbiddenException, Header, HttpCode, Injectable, Param, Post, Query, Req, ServiceUnavailableException, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ServerResponse } from 'node:http';
import type { ClientRequest } from '../../client-auth/client-auth.security';
import { RequireClientWorkspacePermissions } from '../../client-workspaces/client-workspace-permission.decorator';
import { CLIENT_WORKSPACE_PERMISSION as P } from '../../client-workspaces/client-workspace-permissions';
import { WorkspaceContextGuard } from '../../client-workspaces/workspace-context.guard';
import { personalAgentObject } from './ai-personal-agents.dto';
import { AiPersonalAgentRunsService } from './ai-personal-agent-runs.service';

@Injectable()
export class PersonalAgentRunNoStoreGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    context.switchToHttp().getResponse<ServerResponse>().setHeader('Cache-Control', 'private, no-store');
    return true;
  }
}
@Controller('client/ai/personal-agents')
@UseGuards(PersonalAgentRunNoStoreGuard, WorkspaceContextGuard)
export class AiPersonalAgentRunsController {
  constructor(private readonly runs: AiPersonalAgentRunsService, private readonly config: ConfigService) {}
  @Post(':id/runs')
  @HttpCode(202)
  @RequireClientWorkspacePermissions(P.aiExecute, P.aiAssetsRead)
  @Header('Cache-Control', 'private, no-store')
  submit(@Param('id') id: string, @Body() body: unknown, @Query() query: unknown, @Req() r: ClientRequest) {
    if (r.headers.origin !== this.config.getOrThrow('webUrl') || r.headers['sec-fetch-site'] === 'cross-site')
      throw new ForbiddenException('Invalid request origin');
    if (this.config.get<string>('AI_CENTER_CLIENT_EXECUTION_ENABLED') !== 'true') throw new ServiceUnavailableException('Direct client AI execution is disabled');
    if (!r.client?.id || !r.workspaceContext?.workspaceId) throw new ForbiddenException('Workspace access denied');
    personalAgentObject(query, []);
    return this.runs.submit(r.client.id, r.workspaceContext.workspaceId, id, body, r.correlationId);
  }
}
