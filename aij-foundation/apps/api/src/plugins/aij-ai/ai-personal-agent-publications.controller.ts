import { Body, Controller, ForbiddenException, Get, Header, HttpCode, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ClientRequest } from '../../client-auth/client-auth.security';
import { RequireClientWorkspacePermissions } from '../../client-workspaces/client-workspace-permission.decorator';
import { CLIENT_WORKSPACE_PERMISSION as P } from '../../client-workspaces/client-workspace-permissions';
import { WorkspaceContextGuard } from '../../client-workspaces/workspace-context.guard';
import { PersonalAgentNoStoreGuard } from './ai-personal-agents.controller';
import { assertPersonalAgentPreviewNoBody } from './ai-personal-agent-run-previews.dto';
import { publicationObject } from './ai-personal-agent-publications.dto';
import { AiPersonalAgentPublicationsService } from './ai-personal-agent-publications.service';

@Controller('client/ai/personal-agents')
@UseGuards(PersonalAgentNoStoreGuard, WorkspaceContextGuard)
export class AiPersonalAgentPublicationsController {
  constructor(private readonly publications: AiPersonalAgentPublicationsService, private readonly config: ConfigService) {}
  private context(r: ClientRequest, mutation = false) {
    if (!r.client?.id || !r.workspaceContext?.workspaceId) throw new ForbiddenException('Workspace access denied');
    if (mutation && (r.headers.origin !== this.config.getOrThrow<string>('webUrl') || r.headers['sec-fetch-site'] === 'cross-site'))
      throw new ForbiddenException('Invalid request origin');
    return { member: r.client.id, workspace: r.workspaceContext.workspaceId };
  }
  @Get(':id/publication')
  @RequireClientWorkspacePermissions(P.aiAssetsRead)
  @Header('Cache-Control', 'private, no-store')
  get(@Req() r: ClientRequest, @Param('id') id: string, @Query() query: unknown, @Body() body: unknown) {
    const c = this.context(r); publicationObject(query, []); assertPersonalAgentPreviewNoBody(body, r.headers);
    return this.publications.get(c.member, c.workspace, id);
  }
  @Post(':id/publication/publish')
  @HttpCode(200)
  @RequireClientWorkspacePermissions(P.aiAssetsManage)
  @Header('Cache-Control', 'private, no-store')
  publish(@Req() r: ClientRequest, @Param('id') id: string, @Query() query: unknown, @Body() body: unknown) {
    const c = this.context(r, true); publicationObject(query, []);
    return this.publications.publish(c.member, c.workspace, id, body, r.correlationId);
  }
  @Post(':id/publication/unpublish')
  @HttpCode(200)
  @RequireClientWorkspacePermissions(P.aiAssetsManage)
  @Header('Cache-Control', 'private, no-store')
  unpublish(@Req() r: ClientRequest, @Param('id') id: string, @Query() query: unknown, @Body() body: unknown) {
    const c = this.context(r, true); publicationObject(query, []);
    return this.publications.unpublish(c.member, c.workspace, id, body, r.correlationId);
  }
}
