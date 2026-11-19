import { Body, CanActivate, Controller, ExecutionContext, ForbiddenException, Get, HttpCode, HttpException, Injectable, Optional, Param, Post, Query, Req, Res, ServiceUnavailableException, UnauthorizedException, UnsupportedMediaTypeException, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import type { ServerResponse } from 'node:http';
import { ClientAuthService } from '../../client-auth/client-auth.service';
import type { ClientClaims, ClientRequest } from '../../client-auth/client-auth.security';
import { RequireClientWorkspacePermissions } from '../../client-workspaces/client-workspace-permission.decorator';
import { CLIENT_WORKSPACE_PERMISSION as P } from '../../client-workspaces/client-workspace-permissions';
import { WorkspaceContextGuard } from '../../client-workspaces/workspace-context.guard';
import { scriptCreate, scriptId, scriptJson, scriptKey, scriptNoBody, scriptObject, scriptSubmit } from './ai-personal-script-execution.dto';

export type ScriptExecutionSessionGate = (tx: Prisma.TransactionClient) => Promise<void>;
/** Structural DI ports. Root binds actual owners; no candidate-to-candidate imports. */
export abstract class ScriptExecutionAssetsPort {
  abstract createVersion(member: string, workspace: string, raw: ReturnType<typeof scriptCreate>, authorize?: ScriptExecutionSessionGate): Promise<unknown>;
  abstract readVersion(member: string, workspace: string, versionId: string, authorize?: ScriptExecutionSessionGate): Promise<unknown>;
}
export type ScriptContent = { meta: { assetId: string; mimeType: 'application/json'; originalName: string; size: number; checksum: string; createdAt: string }; bytes: Buffer };
export abstract class ScriptExecutionRunsPort {
  abstract submit(member: string, workspace: string, raw: ReturnType<typeof scriptSubmit>, claims: ClientClaims, correlationId?: string): Promise<unknown>;
  abstract read(member: string, workspace: string, runId: string, claims: ClientClaims): Promise<unknown>;
  abstract recover(member: string, workspace: string, key: string, claims: ClientClaims): Promise<unknown>;
  abstract content(member: string, workspace: string, runId: string, claims: ClientClaims): Promise<ScriptContent>;
  abstract capability(member: string, workspace: string, claims: ClientClaims): Promise<unknown>;
}
function privateHeaders(response: ServerResponse) {
  response.setHeader('Cache-Control', 'private, no-store'); response.setHeader('X-Content-Type-Options', 'nosniff');
}
@Injectable()
export class ScriptExecutionPrivateGuard implements CanActivate {
  canActivate(context: ExecutionContext) { privateHeaders(context.switchToHttp().getResponse<ServerResponse>()); return true; }
}
const MANAGE = 'workspace.ai.scripts.manage', EXECUTE = 'workspace.ai.scripts.execute';
@Controller('client/script-executions')
@UseGuards(ScriptExecutionPrivateGuard, WorkspaceContextGuard)
export class AiPersonalScriptExecutionController {
  constructor(@Optional() private readonly assets: ScriptExecutionAssetsPort, @Optional() private readonly runs: ScriptExecutionRunsPort,
    private readonly config: ConfigService, private readonly auth: ClientAuthService) {}
  private owner<T>(port: T): NonNullable<T> { if (!port) throw new ServiceUnavailableException('Script execution unavailable'); return port; }
  private context(r: ClientRequest, mutation = false) {
    const claims = r.clientClaims;
    if (!claims || !r.client?.id || claims.sub !== r.client.id) throw new UnauthorizedException('Invalid client session');
    if (!r.workspaceContext?.workspaceId) throw new ForbiddenException('Workspace access denied');
    if (mutation && (r.headers.origin !== this.config.getOrThrow<string>('webUrl') || r.headers['sec-fetch-site'] === 'cross-site')) throw new ForbiddenException('Invalid request origin');
    return { member: r.client.id, workspace: r.workspaceContext.workspaceId, claims, authorize: (tx: Prisma.TransactionClient) => this.auth.assertSessionInTransaction(tx, claims) };
  }
  @Post('versions')
  @HttpCode(201)
  @RequireClientWorkspacePermissions(P.aiAssetsManage, MANAGE)
  createVersion(@Req() r: ClientRequest, @Body() body: unknown, @Query() query: unknown) {
    const c = this.context(r, true); scriptObject(query, []);
    return this.owner(this.assets).createVersion(c.member, c.workspace, scriptCreate(body), c.authorize);
  }
  @Get('versions/:id')
  @RequireClientWorkspacePermissions(P.aiAssetsRead, MANAGE)
  version(@Req() r: ClientRequest, @Param('id') id: string, @Query() query: unknown, @Body() body?: unknown) {
    const c = this.context(r); scriptObject(query, []); scriptNoBody(body, r.headers);
    return this.owner(this.assets).readVersion(c.member, c.workspace, scriptId(id), c.authorize);
  }
  @Get('capability')
  @RequireClientWorkspacePermissions(P.aiAssetsRead)
  capability(@Req() r: ClientRequest, @Query() query: unknown, @Body() body?: unknown) {
    const c = this.context(r); scriptObject(query, []); scriptNoBody(body, r.headers);
    return this.owner(this.runs).capability(c.member, c.workspace, c.claims);
  }
  @Post('runs')
  @HttpCode(201)
  @RequireClientWorkspacePermissions(P.aiAssetsRead, P.aiExecute, EXECUTE)
  submit(@Req() r: ClientRequest, @Body() body: unknown, @Query() query: unknown) {
    const c = this.context(r, true); scriptObject(query, []);
    return this.owner(this.runs).submit(c.member, c.workspace, scriptSubmit(body), c.claims, r.correlationId);
  }
  @Get('requests/:key')
  @RequireClientWorkspacePermissions(P.aiAssetsRead, P.aiRead, EXECUTE)
  recover(@Req() r: ClientRequest, @Param('key') key: string, @Query() query: unknown, @Body() body?: unknown) {
    const c = this.context(r); scriptObject(query, []); scriptNoBody(body, r.headers);
    return this.owner(this.runs).recover(c.member, c.workspace, scriptKey(key), c.claims);
  }
  @Get('runs/:id')
  @RequireClientWorkspacePermissions(P.aiAssetsRead, P.aiRead, EXECUTE)
  read(@Req() r: ClientRequest, @Param('id') id: string, @Query() query: unknown, @Body() body?: unknown) {
    const c = this.context(r); scriptObject(query, []); scriptNoBody(body, r.headers);
    return this.owner(this.runs).read(c.member, c.workspace, scriptId(id), c.claims);
  }
  @Get('runs/:id/content')
  @RequireClientWorkspacePermissions(P.aiAssetsRead, P.aiRead, EXECUTE)
  async content(@Req() r: ClientRequest, @Param('id') id: string, @Query() query: unknown, @Res() response: ServerResponse, @Body() body?: unknown) {
    const c = this.context(r); scriptObject(query, []); scriptNoBody(body, r.headers); const runId = scriptId(id);
    // Owner's content method rechecks current session/permissions/head before and after storage IO.
    const data = await this.owner(this.runs).content(c.member, c.workspace, runId, c.claims);
    try {
      const meta = scriptObject(data.meta, ['assetId','mimeType','originalName','size','checksum','createdAt']);
      scriptId(meta.assetId);
      if (!Buffer.isBuffer(data.bytes) || data.bytes.length < 1 || data.bytes.length > 65536 || meta.size !== data.bytes.length || meta.mimeType !== 'application/json' || meta.originalName !== `script-${runId}.json` || typeof meta.checksum !== 'string' || !/^[a-f0-9]{64}$/.test(meta.checksum) || createHash('sha256').update(data.bytes).digest('hex') !== meta.checksum) throw new ServiceUnavailableException('Script content unavailable');
      scriptJson(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(data.bytes), 65536);
      // Read metadata through the same guarded owner; provenance must match this result.
      const run = scriptObject(await this.owner(this.runs).read(c.member, c.workspace, runId, c.claims), ['id','script','jobId','jobStatus','outcome','attempted','result','createdAt','expiresAt']);
      const ref = scriptObject(run.script, ['scriptVersionId','skillId','skillVersionId','revision','scriptDigest','policyDigest']);
      const artifact = scriptObject(run.result, ['assetId','mimeType','originalName','size','checksum','createdAt']);
      if (run.id !== runId || run.outcome !== 'SUCCESS' || run.attempted !== true || Object.keys(meta).some(k => meta[k] !== artifact[k])) throw new ServiceUnavailableException('Script content unavailable');
      privateHeaders(response);
      for (const [k, v] of Object.entries({ 'Content-Type': 'application/json', 'Content-Length': String(meta.size), 'Content-Disposition': `attachment; filename="${meta.originalName}"`, 'X-AIJ-Script-Run-Id': runId, 'X-AIJ-Script-Version-Id': scriptId(ref.scriptVersionId), 'X-AIJ-Asset-Id': String(meta.assetId), 'X-AIJ-Checksum-SHA256': meta.checksum })) response.setHeader(k, v);
      await new Promise<void>((resolve, reject) => {
        const closed = () => reject(new ServiceUnavailableException('Script content unavailable'));
        response.once('close', closed);
        response.end(data.bytes, () => { response.removeListener('close', closed); resolve(); });
      });
    } finally { data.bytes?.fill(0); }
  }
}
type ParserRequest = { url?: string; originalUrl?: string; method?: string; headers?: Record<string, unknown> };
const matches = (r: ParserRequest) => /^\/(?:api\/)?client\/script-executions(?:[/?]|$)/i.test(r.originalUrl ?? r.url ?? '');
/** Install before every parser: even malformed and oversized requests receive private headers. */
export function scriptExecutionPrivateMiddleware(r: ParserRequest, response: ServerResponse, next: (error?: unknown) => void) {
  if (!matches(r)) { next(); return; }
  privateHeaders(response);
  if (r.method === 'POST' && (typeof r.headers?.['content-type'] !== 'string' || !/^application\/json(?:\s*;\s*charset\s*=\s*utf-8)?\s*$/i.test(r.headers['content-type']) || r.headers['content-encoding'] !== undefined)) { next(new UnsupportedMediaTypeException('Script requests require UTF-8 JSON')); return; }
  next();
}
/** Call from the host JSON verify hook, preserving rawBody and other prefix hooks. */
export function scriptExecutionJsonVerify(r: ParserRequest, response: ServerResponse, buffer: Buffer) {
  if (!matches(r)) return; privateHeaders(response);
  if (buffer.length > 102400) throw new HttpException('Script request too large', 413);
  try { scriptJson(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer)); }
  catch { throw new HttpException('Invalid personal script request', 400); }
}
