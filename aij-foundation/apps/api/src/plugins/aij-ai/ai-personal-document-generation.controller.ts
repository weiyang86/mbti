import { BadRequestException, Body, CanActivate, Controller, ExecutionContext, ForbiddenException, Get, HttpCode, Injectable, Param, Post, Query, Req,
  ServiceUnavailableException, UnauthorizedException, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ServerResponse } from 'node:http';
import type { ClientRequest } from '../../client-auth/client-auth.security';
import { RequireClientWorkspacePermissions } from '../../client-workspaces/client-workspace-permission.decorator';
import { CLIENT_WORKSPACE_PERMISSION as P } from '../../client-workspaces/client-workspace-permissions';
import { WorkspaceContextGuard } from '../../client-workspaces/workspace-context.guard';
import { documentGenerationNoBody, documentGenerationObject, documentGenerationOpaque,
  parseDocumentGenerationPreview, parseDocumentGenerationSubmit } from './ai-personal-document-generation.dto';
import { AiPersonalDocumentGenerationService } from './ai-personal-document-generation.service';

@Injectable()
export class DocumentGenerationNoStoreGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const response = context.switchToHttp().getResponse<ServerResponse>();
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    return true;
  }
}

@Controller('client/ai')
@UseGuards(DocumentGenerationNoStoreGuard, WorkspaceContextGuard)
export class AiPersonalDocumentGenerationController {
  constructor(private readonly generations: AiPersonalDocumentGenerationService, private readonly config: ConfigService) {}
  private noQuery(r: ClientRequest, query: unknown): void {
    documentGenerationObject(query, []);
    // Also fence raw queries that a parser may omit (for example pollution keys).
    if (typeof r.url === 'string' && r.url.includes('?')) throw new BadRequestException('Invalid document generation request');
  }
  private context(r: ClientRequest, post = false) {
    const claims = r.clientClaims;
    if (!claims || !r.client?.id || claims.sub !== r.client.id) throw new UnauthorizedException('Invalid client session');
    if (!r.workspaceContext?.workspaceId) throw new ForbiddenException('Workspace access denied');
    if (post && (r.headers.origin !== this.config.getOrThrow<string>('webUrl') || r.headers['sec-fetch-site'] === 'cross-site'))
      throw new ForbiddenException('Invalid request origin');
    return { member: r.client.id, workspace: r.workspaceContext.workspaceId, claims };
  }
  @Post('document-generations/preview')
  @HttpCode(200)
  @RequireClientWorkspacePermissions(P.documentsRead, P.aiRead, P.aiAssetsRead)
  preview(@Req() r: ClientRequest, @Body() body: unknown, @Query() query: unknown) {
    const c = this.context(r, true); this.noQuery(r, query);
    return this.generations.preview(c.member, c.workspace, parseDocumentGenerationPreview(body), c.claims, r.correlationId);
  }
  @Post('document-generations')
  @HttpCode(202)
  @RequireClientWorkspacePermissions(P.documentsRead, P.aiRead, P.aiAssetsRead, P.documentsManage, P.aiExecute)
  submit(@Req() r: ClientRequest, @Body() body: unknown, @Query() query: unknown) {
    const c = this.context(r, true); this.noQuery(r, query);
    if (this.config.get<string>('AI_CENTER_CLIENT_EXECUTION_ENABLED') !== 'true')
      throw new ServiceUnavailableException('Direct client AI execution is disabled');
    return this.generations.submit(c.member, c.workspace, parseDocumentGenerationSubmit(body), c.claims, r.correlationId);
  }
  @Get('document-generation-runs/:id')
  @RequireClientWorkspacePermissions(P.documentsRead, P.aiRead, P.aiAssetsRead)
  read(@Req() r: ClientRequest, @Param('id') id: string, @Query() query: unknown, @Body() body?: unknown) {
    const c = this.context(r); this.noQuery(r, query); documentGenerationNoBody(body, r.headers);
    return this.generations.read(c.member, c.workspace, documentGenerationOpaque(id), c.claims, r.correlationId);
  }
  @Get('document-generation-requests/:key')
  @RequireClientWorkspacePermissions(P.documentsRead, P.aiRead, P.aiAssetsRead)
  recover(@Req() r: ClientRequest, @Param('key') key: string, @Query() query: unknown, @Body() body?: unknown) {
    const c = this.context(r); this.noQuery(r, query); documentGenerationNoBody(body, r.headers);
    return this.generations.recover(c.member, c.workspace, documentGenerationOpaque(key, 8), c.claims, r.correlationId);
  }
}
