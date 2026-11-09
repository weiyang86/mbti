import { BadRequestException, Body, Catch, Controller, ForbiddenException, Get, Header, HttpException, Inject, Param, Query, Req, UnauthorizedException, UseFilters, UseGuards, type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { ClientClaims, ClientRequest } from "../../client-auth/client-auth.security";
import { correlateRequest } from "../../common/interceptors/correlation.interceptor";
import { RequireClientWorkspacePermissions } from "../../client-workspaces/client-workspace-permission.decorator";
import { CLIENT_WORKSPACE_PERMISSION } from "../../client-workspaces/client-workspace-permissions";
import { WorkspaceContextGuard } from "../../client-workspaces/workspace-context.guard";
import { knowledgeCitationId, type CurrentKnowledgeCitation } from "./knowledge-citation";

/** Root binds useExisting: AiKnowledgeService. No alternate data/auth owner. */
export abstract class KnowledgeCitationPort {
  abstract readCitation(memberId: string, workspaceId: string, questionId: string, documentId: string, claims: ClientClaims): Promise<CurrentKnowledgeCitation>;
}
const invalid = (): never => { throw new BadRequestException("CITATION_INVALID"); };
function empty(value: unknown) {
  if (value !== undefined && (!value || typeof value !== "object" || Array.isArray(value) || Reflect.ownKeys(value).length)) invalid();
}
function noBody(headers: IncomingMessage["headers"]) {
  if (headers["transfer-encoding"] !== undefined || (headers["content-length"] !== undefined && headers["content-length"] !== "0")) invalid();
}
function privateHeaders(response: ServerResponse) {
  response.setHeader("Cache-Control", "private, no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
}
type CitationRequest = IncomingMessage & { originalUrl?: string };
const matches = (request: CitationRequest) => /^\/(?:api\/)?client\/ai\/knowledge\/questions\/[^/?]+\/citations\/[^/?]+\/?(?:\?|$)/i.test(request.originalUrl ?? request.url ?? "");
/** Root installs before CORS, parsers and guards; includes rejection responses. */
export function knowledgeCitationPrivateMiddleware(request: CitationRequest, response: ServerResponse, next: (error?: unknown) => void) {
  if (!matches(request)) { next(); return; }
  correlateRequest(request, response);
  privateHeaders(response);
  try { if (request.method === "GET") noBody(request.headers); next(); }
  catch (error) { next(error); }
}
function reject(response: ServerResponse, status: number) {
  privateHeaders(response); response.setHeader("Content-Type", "application/json"); response.statusCode = status;
  const message = ({ 400: "CITATION_INVALID", 401: "CITATION_SESSION_REQUIRED", 403: "CITATION_FORBIDDEN",
    404: "CITATION_UNAVAILABLE", 409: "SOURCE_CHANGED", 410: "CITATION_EXPIRED" } as Record<number, string>)[status] ?? "CITATION_UNAVAILABLE";
  response.end(JSON.stringify({ success: false, data: null, message }));
}
/** Root installs after the parsers; parser errors never echo private input. */
export function knowledgeCitationParserErrorMiddleware(error: unknown, request: CitationRequest, response: ServerResponse, next: (error?: unknown) => void) {
  if (!matches(request)) { next(error); return; }
  reject(response, 400);
}
@Catch()
export class KnowledgeCitationExceptionFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    reject(host.switchToHttp().getResponse<ServerResponse>(), error instanceof HttpException ? error.getStatus() : 503);
  }
}

@Controller("client/ai/knowledge")
@UseGuards(WorkspaceContextGuard)
@UseFilters(KnowledgeCitationExceptionFilter)
export class AiKnowledgeCitationsController {
  constructor(@Inject(KnowledgeCitationPort) private readonly knowledge: KnowledgeCitationPort) {}

  @Get("questions/:questionId/citations/:documentId")
  @RequireClientWorkspacePermissions(CLIENT_WORKSPACE_PERMISSION.knowledgeQuery)
  @Header("Cache-Control", "private, no-store")
  @Header("X-Content-Type-Options", "nosniff")
  read(@Req() request: ClientRequest, @Param("questionId") questionId: string, @Param("documentId") documentId: string,
    @Query() query: unknown, @Body() body?: unknown) {
    const claims = request.clientClaims, memberId = request.client?.id, workspaceId = request.workspaceContext?.workspaceId;
    if (!claims || !memberId || claims.sub !== memberId) throw new UnauthorizedException("CITATION_SESSION_REQUIRED");
    if (!workspaceId) throw new ForbiddenException("CITATION_FORBIDDEN");
    empty(query); empty(body); noBody(request.headers);
    // Also inspect the wire URL: a query parser may discard prototype-shaped
    // keys, but this route admits no nonempty query string at all.
    const separator = (request.url ?? "").indexOf("?");
    if (separator !== -1 && request.url!.slice(separator + 1)) invalid();
    return this.knowledge.readCitation(memberId, workspaceId, knowledgeCitationId(questionId), knowledgeCitationId(documentId), claims);
  }
}
