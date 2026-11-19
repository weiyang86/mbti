import { BadRequestException, Body, CanActivate, Controller, Delete, ExecutionContext, Injectable, ForbiddenException, Get, Header, HttpCode, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { ClientRequest } from "../client-auth/client-auth.security";
import { RequireClientWorkspacePermissions } from "../client-workspaces/client-workspace-permission.decorator";
import { WorkspaceContextGuard } from "../client-workspaces/workspace-context.guard";
import { documentObject } from "./personal-documents.dto";
import { PersonalDocumentsService, DOCUMENT_PERMISSION } from "./personal-documents.service";

/** Reject ambiguous keys before Express discards them; never include private input in errors. */
export function personalDocumentJsonVerify(buffer: Buffer): void {
  try {
    const raw = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    JSON.parse(raw);
    const objects: Set<string>[] = [];
    for (let i = 0; i < raw.length; i++) {
      if (raw[i] === "{") { objects.push(new Set()); if (objects.length > 40) throw Error(); }
      else if (raw[i] === "}") objects.pop();
      else if (raw[i] === '"') {
        const start = i++;
        for (; i < raw.length; i++) { if (raw[i] === "\\") i++; else if (raw[i] === '"') break; }
        let j = i + 1; while (/\s/.test(raw[j] ?? "x")) j++;
        if (raw[j] === ":") {
          const key: string = JSON.parse(raw.slice(start, i + 1)), keys = objects.at(-1);
          if (!keys || keys.has(key) || ["__proto__", "constructor", "prototype"].includes(key)) throw Error();
          keys.add(key);
        }
      }
    }
  } catch { throw new BadRequestException("Invalid personal document request"); }
}

/** Root mounts this before global body parsers, so pre-guard parse refusals are private too. */
export function personalDocumentNoStore(_request: IncomingMessage, response: ServerResponse, next: () => void): void {
  response.setHeader("Cache-Control", "private, no-store");
  next();
}

@Injectable()
export class PersonalDocumentNoStoreGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    context.switchToHttp().getResponse<ServerResponse>().setHeader("Cache-Control", "private, no-store");
    return true;
  }
}

@Controller("client/documents")
@UseGuards(PersonalDocumentNoStoreGuard, WorkspaceContextGuard)
export class PersonalDocumentsController {
  constructor(private readonly documents: PersonalDocumentsService, private readonly config: ConfigService) {}
  private context(request: ClientRequest, mutation = false) {
    if (!request.client?.id || !request.workspaceContext?.workspaceId) throw new ForbiddenException("Workspace access denied");
    if (mutation && (request.headers.origin !== this.config.getOrThrow<string>("webUrl") || request.headers["sec-fetch-site"] === "cross-site")) {
      throw new ForbiddenException("Invalid request origin");
    }
    return { memberId: request.client.id, workspaceId: request.workspaceContext.workspaceId };
  }
  @Get()
  @RequireClientWorkspacePermissions(DOCUMENT_PERMISSION.read)
  @Header("Cache-Control", "private, no-store")
  list(@Req() request: ClientRequest, @Query() query: unknown) {
    const c = this.context(request);
    return this.documents.list(c.memberId, c.workspaceId, query);
  }
  @Post()
  @HttpCode(201)
  @RequireClientWorkspacePermissions(DOCUMENT_PERMISSION.manage)
  @Header("Cache-Control", "private, no-store")
  create(@Req() request: ClientRequest, @Body() body: unknown, @Query() query: unknown) {
    const c = this.context(request, true);
    documentObject(query, []);
    return this.documents.create(c.memberId, c.workspaceId, body);
  }
  @Get(":id/versions")
  @RequireClientWorkspacePermissions(DOCUMENT_PERMISSION.read)
  versions(@Req() request: ClientRequest, @Param("id") id: string, @Query() query: unknown) {
    const c = this.context(request);
    return this.documents.versions(c.memberId, c.workspaceId, id, query);
  }
  @Get(":id/versions/:revision")
  @RequireClientWorkspacePermissions(DOCUMENT_PERMISSION.read)
  version(@Req() request: ClientRequest, @Param("id") id: string, @Param("revision") revision: string, @Query() query: unknown) {
    documentObject(query, []);
    const c = this.context(request);
    return this.documents.getVersion(c.memberId, c.workspaceId, id, revision);
  }
  @Get(":id")
  @RequireClientWorkspacePermissions(DOCUMENT_PERMISSION.read)
  @Header("Cache-Control", "private, no-store")
  get(@Req() request: ClientRequest, @Param("id") id: string, @Query() query: unknown) {
    documentObject(query, []);
    const c = this.context(request);
    return this.documents.get(c.memberId, c.workspaceId, id);
  }
  @Patch(":id")
  @RequireClientWorkspacePermissions(DOCUMENT_PERMISSION.manage)
  @Header("Cache-Control", "private, no-store")
  update(@Req() request: ClientRequest, @Param("id") id: string, @Body() body: unknown, @Query() query: unknown) {
    const c = this.context(request, true);
    documentObject(query, []);
    return this.documents.update(c.memberId, c.workspaceId, id, body);
  }
  @Delete(":id")
  @RequireClientWorkspacePermissions(DOCUMENT_PERMISSION.manage)
  @Header("Cache-Control", "private, no-store")
  delete(@Req() request: ClientRequest, @Param("id") id: string, @Body() body: unknown, @Query() query: unknown) {
    const c = this.context(request, true);
    documentObject(query, []);
    return this.documents.delete(c.memberId, c.workspaceId, id, body);
  }
}
