import { Body, CanActivate, Controller, ExecutionContext, ForbiddenException, Get, HttpCode, Injectable, Param, Post, Query, Req, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { ClientAuthService } from '../client-auth/client-auth.service';
import { ConfigService } from '@nestjs/config';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ClientRequest } from '../client-auth/client-auth.security';
import { RequireClientWorkspacePermissions } from '../client-workspaces/client-workspace-permission.decorator';
import { WorkspaceContextGuard } from '../client-workspaces/workspace-context.guard';
import { documentObject } from './personal-documents.dto';
import { DOCUMENT_PERMISSION } from './personal-documents.service';
import { DOCUMENT_EXPORT_PERMISSION } from './document-export-profile';
import { PersonalDocumentExportsService } from './personal-document-exports.service';
export function documentExportNoStore(_request: IncomingMessage, response: ServerResponse, next: () => void) {
  response.setHeader('Cache-Control', 'private, no-store'); response.setHeader('X-Content-Type-Options', 'nosniff'); next();
}
@Injectable()
export class DocumentExportNoStoreGuard implements CanActivate {
  canActivate(context: ExecutionContext) { documentExportNoStore(context.switchToHttp().getRequest(), context.switchToHttp().getResponse(), () => {}); return true; }
}
@Controller('client/document-exports')
@UseGuards(DocumentExportNoStoreGuard, WorkspaceContextGuard)
export class PersonalDocumentExportsController {
  constructor(private readonly exports: PersonalDocumentExportsService, private readonly config: ConfigService, private readonly auth: ClientAuthService) {}
  private context(request: ClientRequest, mutation = false) {
    if (!request.client?.id || !request.workspaceContext?.workspaceId) throw new ForbiddenException('Workspace access denied');
    if (mutation && (request.headers.origin !== this.config.getOrThrow<string>('webUrl') || request.headers['sec-fetch-site'] === 'cross-site')) throw new ForbiddenException('Invalid request origin');
    return { member: request.client.id, workspace: request.workspaceContext.workspaceId };
  }
  @Get('capability')
  @RequireClientWorkspacePermissions(DOCUMENT_PERMISSION.read)
  capability(@Req() req: ClientRequest, @Query() query: unknown) {
    documentObject(query, []); const c = this.context(req); return this.exports.capability(c.member, c.workspace);
  }
  @Post()
  @HttpCode(201)
  @RequireClientWorkspacePermissions(DOCUMENT_PERMISSION.read, DOCUMENT_EXPORT_PERMISSION)
  async create(@Req() req: ClientRequest, @Res({ passthrough: true }) res: ServerResponse, @Body() body: unknown, @Query() query: unknown) {
    documentObject(query, []); const c = this.context(req, true), abort = new AbortController();
    // IncomingMessage.close fires on a normally completed request body, so use response close only.
    const close = () => { if (!res.writableFinished) abort.abort(); };
    res.once('close', close);
    const claims = req.clientClaims;
    const authorize = (tx: Prisma.TransactionClient) => {
      if (!claims || claims.sub !== c.member) throw new UnauthorizedException('Invalid client session');
      return this.auth.assertSessionInTransaction(tx, claims);
    };
    try { return await this.exports.create(c.member, c.workspace, body, abort.signal, authorize); }
    finally { res.off('close', close); }
  }
  @Get()
  @RequireClientWorkspacePermissions(DOCUMENT_PERMISSION.read, DOCUMENT_EXPORT_PERMISSION)
  list(@Req() req: ClientRequest, @Query() query: unknown) { const c = this.context(req); return this.exports.list(c.member, c.workspace, query); }
  @Get(':id')
  @RequireClientWorkspacePermissions(DOCUMENT_PERMISSION.read, DOCUMENT_EXPORT_PERMISSION)
  async get(@Req() req: ClientRequest, @Param('id') id: string, @Query() query: unknown) {
    documentObject(query, []); const c = this.context(req); return (await this.exports.get(c.member, c.workspace, id)).meta;
  }
  @Get(':id/content')
  @RequireClientWorkspacePermissions(DOCUMENT_PERMISSION.read, DOCUMENT_EXPORT_PERMISSION)
  async content(@Req() req: ClientRequest, @Res() res: ServerResponse, @Param('id') id: string, @Query() query: unknown) {
    documentObject(query, []); const c = this.context(req), result = await this.exports.get(c.member, c.workspace, id, true);
    const m = result.meta, bytes = result.content!.bytes;
    res.setHeader('Content-Type', m.mimeType); res.setHeader('Content-Length', bytes.length);
    res.setHeader('Content-Disposition', `attachment; filename="document-${m.documentId}-r${m.revision}.${m.format}"`);
    res.setHeader('X-AIJ-Document-Id', m.documentId); res.setHeader('X-AIJ-Document-Revision', m.revision);
    res.setHeader('X-AIJ-Export-Id', m.id); res.setHeader('X-AIJ-Checksum-Sha256', m.checksum); res.setHeader('X-AIJ-Renderer-Version', m.rendererVersion);
    res.end(bytes);
  }
}
