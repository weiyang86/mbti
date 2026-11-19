import { Body, Controller, ForbiddenException, Get, Header, HttpCode, Param, Post, Req, Res, ServiceUnavailableException, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ServerResponse } from 'node:http';
import type { ClientRequest } from '../../client-auth/client-auth.security';
import { RequireClientWorkspacePermissions } from '../../client-workspaces/client-workspace-permission.decorator';
import { CLIENT_WORKSPACE_PERMISSION as P } from '../../client-workspaces/client-workspace-permissions';
import { WorkspaceContextGuard } from '../../client-workspaces/workspace-context.guard';
import { AiCenterRunService } from './ai-center-run.service';
@Controller('client/ai')
@UseGuards(WorkspaceContextGuard)
export class AiCenterClientController {
    constructor(private readonly runs: AiCenterRunService, private readonly config: ConfigService) { }
    private context(r: ClientRequest) { if (!r.client?.id || !r.workspaceContext?.workspaceId)
        throw new ForbiddenException('Workspace access denied'); return { memberId: r.client.id, workspaceId: r.workspaceContext.workspaceId }; }
    @Get('agents')
    @RequireClientWorkspacePermissions(P.aiExecute)
    @Header('Cache-Control', 'private, no-store')
    agents(
    @Req()
    r: ClientRequest) { const c = this.context(r); return this.runs.agents(c.memberId, c.workspaceId); }
    @Post('agents/:code/runs')
    @HttpCode(202)
    @RequireClientWorkspacePermissions(P.aiExecute)
    @Header('Cache-Control', 'private, no-store')
    submit(
    @Param('code')
    code: string, 
    @Body()
    body: unknown, 
    @Req()
    r: ClientRequest) { if (r.headers.origin !== this.config.getOrThrow('webUrl') || r.headers['sec-fetch-site'] === 'cross-site')
        throw new ForbiddenException('Invalid request origin'); if (this.config.get<string>("AI_CENTER_CLIENT_EXECUTION_ENABLED") !== "true") throw new ServiceUnavailableException("Direct client AI execution is disabled"); const c = this.context(r); return this.runs.submit(c.memberId, c.workspaceId, code, body, r.correlationId); }
    @Get('run-requests/:key')
    @RequireClientWorkspacePermissions(P.aiRead)
    @Header('Cache-Control', 'private, no-store')
    recoverRequest(@Param('key') key: string, @Req() r: ClientRequest) {
        const c = this.context(r);
        return this.runs.recoverLegacyRequest(c.memberId, c.workspaceId, key);
    }
    @Get('runs/:id')
    @RequireClientWorkspacePermissions(P.aiRead)
    @Header('Cache-Control', 'private, no-store')
    read(
    @Param('id')
    id: string, 
    @Req()
    r: ClientRequest) { const c = this.context(r); return this.runs.readLegacy(c.memberId, c.workspaceId, id); }
    @Get('runs/:id/image')
    @RequireClientWorkspacePermissions(P.aiRead)
    async image(
    @Param('id')
    id: string, 
    @Req()
    r: ClientRequest, 
    @Res()
    response: ServerResponse) { const c = this.context(r), file = await this.runs.imageLegacy(c.memberId, c.workspaceId, id); response.statusCode = 200; response.setHeader('Content-Type', file.mimeType); response.setHeader('Cache-Control', 'private, no-store'); response.setHeader('X-Content-Type-Options', 'nosniff'); response.setHeader('Content-Length', String(file.bytes.length)); response.end(file.bytes); }
}
