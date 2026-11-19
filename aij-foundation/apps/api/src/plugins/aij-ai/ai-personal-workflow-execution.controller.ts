import { Body, CanActivate, Controller, ExecutionContext, ForbiddenException, Get, HttpCode, HttpException, Injectable, Param, Post, Query, Req, ServiceUnavailableException, UnauthorizedException, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';
import type { ServerResponse } from 'node:http';
import { ClientAuthService } from '../../client-auth/client-auth.service';
import type { ClientClaims, ClientRequest } from '../../client-auth/client-auth.security';
import { RequireClientWorkspacePermissions } from '../../client-workspaces/client-workspace-permission.decorator';
import { CLIENT_WORKSPACE_PERMISSION as P } from '../../client-workspaces/client-workspace-permissions';
import { WorkspaceContextGuard } from '../../client-workspaces/workspace-context.guard';
import { parseWorkflowJson } from './ai-personal-workflows-graph';
import { executionAssetId, executionKey, executionMutation, executionNoBody, executionObject, executionPublicationId, executionPublish, executionRequest, executionSubmit } from './ai-personal-workflow-execution.dto';

export type WorkflowExecutionSessionGate = (tx: Prisma.TransactionClient) => Promise<void>;
/** Structural ports: root binds to the real publication/run owners using useExisting. */
export abstract class WorkflowExecutionPublicationsPort {
  abstract read(member: string, workspace: string, workflowId: string, authorize?: WorkflowExecutionSessionGate): Promise<unknown>;
  abstract publish(member: string, workspace: string, raw: ReturnType<typeof executionPublish>, authorize?: WorkflowExecutionSessionGate): Promise<unknown>;
  abstract unpublish(member: string, workspace: string, workflowId: string, raw: ReturnType<typeof executionMutation>, authorize?: WorkflowExecutionSessionGate): Promise<unknown>;
}
export abstract class WorkflowExecutionRunsPort {
  abstract submit(member: string, workspace: string, raw: ReturnType<typeof executionSubmit>, claims: ClientClaims, correlationId?: string): Promise<unknown>;
  abstract preview(member: string, workspace: string, publicationId: string, claims: ClientClaims): Promise<unknown>;
  abstract recover(member: string, workspace: string, key: string, claims: ClientClaims): Promise<unknown>;
  abstract read(member: string, workspace: string, runId: string, claims: ClientClaims): Promise<unknown>;
}
function privateHeaders(response: ServerResponse) {
  response.setHeader('Cache-Control', 'private, no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
}
@Injectable()
export class WorkflowExecutionPrivateGuard implements CanActivate {
  canActivate(context: ExecutionContext) { privateHeaders(context.switchToHttp().getResponse<ServerResponse>()); return true; }
}
const PUBLISH = 'workspace.ai.workflows.publish', EXECUTE = 'workspace.ai.workflows.execute';
@Controller('client/workflow-executions')
@UseGuards(WorkflowExecutionPrivateGuard, WorkspaceContextGuard)
export class AiPersonalWorkflowExecutionController {
  constructor(private readonly publications: WorkflowExecutionPublicationsPort, private readonly runs: WorkflowExecutionRunsPort,
    private readonly config: ConfigService, private readonly auth: ClientAuthService) {}
  private context(r: ClientRequest, mutation = false) {
    const claims = r.clientClaims;
    if (!claims || !r.client?.id || claims.sub !== r.client.id) throw new UnauthorizedException('Invalid client session');
    if (!r.workspaceContext?.workspaceId) throw new ForbiddenException('Workspace access denied');
    if (mutation && (r.headers.origin !== this.config.getOrThrow<string>('webUrl') || r.headers['sec-fetch-site'] === 'cross-site')) throw new ForbiddenException('Invalid request origin');
    return { member: r.client.id, workspace: r.workspaceContext.workspaceId, claims,
      authorize: (tx: Prisma.TransactionClient) => this.auth.assertSessionInTransaction(tx, claims) };
  }
  @Get('publications/:workflowId')
  @RequireClientWorkspacePermissions(P.aiAssetsRead)
  publication(@Req() r: ClientRequest, @Param('workflowId') id: string, @Query() query: unknown, @Body() body?: unknown) {
    const c = this.context(r); executionObject(query, []); executionNoBody(body, r.headers);
    return this.publications.read(c.member, c.workspace, executionAssetId(id), c.authorize);
  }
  @Post('publications')
  @HttpCode(201)
  @RequireClientWorkspacePermissions(P.aiAssetsManage, PUBLISH)
  publish(@Req() r: ClientRequest, @Body() body: unknown, @Query() query: unknown) {
    const c = this.context(r, true); executionObject(query, []);
    return this.publications.publish(c.member, c.workspace, executionPublish(body), c.authorize);
  }
  @Post('publications/:workflowId/unpublish')
  @HttpCode(200)
  @RequireClientWorkspacePermissions(P.aiAssetsManage, PUBLISH)
  unpublish(@Req() r: ClientRequest, @Param('workflowId') id: string, @Body() body: unknown, @Query() query: unknown) {
    const c = this.context(r, true); executionObject(query, []);
    return this.publications.unpublish(c.member, c.workspace, executionAssetId(id), executionMutation(body), c.authorize);
  }
  @Get('capability')
  @RequireClientWorkspacePermissions(P.aiAssetsRead, P.aiExecute, EXECUTE)
  preview(@Req() r: ClientRequest, @Query() query: unknown, @Body() body?: unknown) {
    const c = this.context(r); executionNoBody(body, r.headers); const q = executionObject(query, ['publicationId']);
    return this.runs.preview(c.member, c.workspace, executionPublicationId(q.publicationId), c.claims);
  }
  @Post('runs')
  @HttpCode(201)
  @RequireClientWorkspacePermissions(P.aiAssetsRead, P.aiExecute, EXECUTE)
  submit(@Req() r: ClientRequest, @Body() body: unknown, @Query() query: unknown) {
    const c = this.context(r, true); executionObject(query, []);
    if (this.config.get<string>('AI_CENTER_CLIENT_EXECUTION_ENABLED') !== 'true') throw new ServiceUnavailableException('Direct client AI execution is disabled');
    return this.runs.submit(c.member, c.workspace, executionSubmit(body), c.claims, r.correlationId);
  }
  @Get('requests/:key')
  @RequireClientWorkspacePermissions(P.aiAssetsRead, P.aiRead, EXECUTE)
  recover(@Req() r: ClientRequest, @Param('key') key: string, @Query() query: unknown, @Body() body?: unknown) {
    const c = this.context(r); executionObject(query, []); executionNoBody(body, r.headers);
    return this.runs.recover(c.member, c.workspace, executionKey(key), c.claims);
  }
  @Get('runs/:id')
  @RequireClientWorkspacePermissions(P.aiAssetsRead, P.aiRead, EXECUTE)
  read(@Req() r: ClientRequest, @Param('id') id: string, @Query() query: unknown, @Body() body?: unknown) {
    const c = this.context(r); executionObject(query, []); executionNoBody(body, r.headers);
    return this.runs.read(c.member, c.workspace, executionAssetId(id), c.claims);
  }
}
type ParserRequest = { url?: string; originalUrl?: string };
const matches = (r: ParserRequest) => /^\/(?:api\/)?client\/workflow-executions(?:[/?]|$)/i.test(r.originalUrl ?? r.url ?? '');
/** Install before ALL body parsers/guards: malformed requests must also be private. */
export function workflowExecutionPrivateMiddleware(r: ParserRequest, response: ServerResponse, next: () => void) {
  if (matches(r)) privateHeaders(response); next();
}
/** Express JSON verify hook, on the same prefix, before JSON.parse. */
export function workflowExecutionJsonVerify(r: ParserRequest, response: ServerResponse, buffer: Buffer) {
  if (!matches(r)) return;
  privateHeaders(response);
  if (buffer.length > 98304) throw new HttpException('Workflow request too large', 413);
  executionRequest(() => {
    const parsed = parseWorkflowJson(new TextDecoder('utf-8', { fatal: true }).decode(buffer));
    const finite = (value: unknown): void => {
      if (typeof value === 'number' && !Number.isFinite(value)) throw new Error();
      if (value && typeof value === 'object') for (const child of Object.values(value)) finite(child);
    };
    finite(parsed);
  });
}
