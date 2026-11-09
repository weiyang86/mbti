import { BadRequestException, Body, Controller, ForbiddenException, Get, Header, HttpCode, Param, Patch, Post, Query, Req, UseFilters, UseGuards, UploadedFile, UseInterceptors, ValidationPipe } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { ClientUploadFile } from "../../files/client-files.dto";
import { ImportAiKnowledgeDocumentDto } from "./ai-knowledge.dto";
import { ConfigService } from "@nestjs/config";
import type { ClientRequest } from "../../client-auth/client-auth.security";
import { RequireClientWorkspacePermissions } from "../../client-workspaces/client-workspace-permission.decorator";
import { CLIENT_WORKSPACE_PERMISSION } from "../../client-workspaces/client-workspace-permissions";
import { WorkspaceContextGuard } from "../../client-workspaces/workspace-context.guard";
import { AiKnowledgeDocumentPageDto, CreateAiKnowledgeDocumentDto, CreateAiKnowledgeQuestionDto, QueryAiKnowledgeDto, UpdateAiKnowledgeDocumentDto } from "./ai-knowledge.dto";
import { AiEvaluationService } from "./ai-evaluation.service";
import { CaptureAiEvaluationDto } from "./ai-knowledge.dto";
import { AiKnowledgeService } from "./ai-knowledge.service";
import { KnowledgeWebEmptyPipe, KnowledgeWebImportBodyPipe, KnowledgeWebImportExceptionFilter } from "./ai-knowledge-web-import.dto";

@Controller("client/ai/knowledge")
export class AiKnowledgeController {
  constructor(private readonly knowledge: AiKnowledgeService, private readonly config: ConfigService, private readonly evaluations: AiEvaluationService) {}

  private context(request: ClientRequest) {
    if (!request.client?.id || !request.workspaceContext?.workspaceId) throw new ForbiddenException("Workspace access denied");
    return { memberId: request.client.id, workspaceId: request.workspaceContext.workspaceId };
  }

  private assertSameOrigin(request: ClientRequest) {
    if (request.headers.origin !== this.config.getOrThrow("webUrl") || request.headers["sec-fetch-site"] === "cross-site") {
      throw new ForbiddenException("Invalid request origin");
    }
  }

  @Post("documents/import-web")
  @RequireClientWorkspacePermissions(CLIENT_WORKSPACE_PERMISSION.knowledgeManage)
  @UseGuards(WorkspaceContextGuard)
  @UseFilters(KnowledgeWebImportExceptionFilter)
  @Header("Cache-Control", "private, no-store")
  importWebDocument(
    @Body(new KnowledgeWebImportBodyPipe()) body: unknown,
    @Query(new KnowledgeWebEmptyPipe()) _query: unknown,
    @Req() request: ClientRequest
  ) {
    this.assertSameOrigin(request);
    const context = this.context(request);
    return this.knowledge.importWebDocument(context.memberId, context.workspaceId,
      new KnowledgeWebImportBodyPipe().transform(body), request.correlationId, request.clientClaims);
  }

  @Get("documents/:id/web-source")
  @RequireClientWorkspacePermissions(CLIENT_WORKSPACE_PERMISSION.knowledgeManage)
  @UseGuards(WorkspaceContextGuard)
  @UseFilters(KnowledgeWebImportExceptionFilter)
  @Header("Cache-Control", "private, no-store")
  getWebSource(
    @Param("id") id: string,
    @Query(new KnowledgeWebEmptyPipe()) _query: unknown,
    @Body(new KnowledgeWebEmptyPipe()) _body: unknown,
    @Req() request: ClientRequest
  ) {
    if (request.headers["transfer-encoding"] !== undefined || Number(request.headers["content-length"] ?? 0) !== 0) {
      throw new BadRequestException("WEB_IMPORT_INVALID");
    }
    const context = this.context(request);
    return this.knowledge.getWebSource(context.memberId, context.workspaceId, id, request.clientClaims);
  }

  @Post("documents")
  @RequireClientWorkspacePermissions(CLIENT_WORKSPACE_PERMISSION.knowledgeManage)
  @UseGuards(WorkspaceContextGuard)
  create(
    @Body(new ValidationPipe({ expectedType: CreateAiKnowledgeDocumentDto, whitelist: true, forbidNonWhitelisted: true, transform: true })) body: CreateAiKnowledgeDocumentDto,
    @Req() request: ClientRequest
  ) {
    this.assertSameOrigin(request);
    const context = this.context(request);
    return this.knowledge.createDocument(context.memberId, context.workspaceId, body, request.correlationId);
  }

  @Get("documents")
  @RequireClientWorkspacePermissions(CLIENT_WORKSPACE_PERMISSION.knowledgeManage)
  @UseGuards(WorkspaceContextGuard)
  @Header("Cache-Control", "private, no-store")
  list(
    @Query(new ValidationPipe({ expectedType: AiKnowledgeDocumentPageDto, whitelist: true, forbidNonWhitelisted: true, transform: true })) query: AiKnowledgeDocumentPageDto,
    @Req() request: ClientRequest
  ) {
    const context = this.context(request);
    return this.knowledge.listDocuments(context.memberId, context.workspaceId, query);
  }

  @Patch("documents/:id")
  @RequireClientWorkspacePermissions(CLIENT_WORKSPACE_PERMISSION.knowledgeManage)
  @UseGuards(WorkspaceContextGuard)
  @Header("Cache-Control", "private, no-store")
  updateDocument(
    @Param("id") id: string,
    @Body(new ValidationPipe({ expectedType: UpdateAiKnowledgeDocumentDto, whitelist: true, forbidNonWhitelisted: true, transform: true })) body: UpdateAiKnowledgeDocumentDto,
    @Req() request: ClientRequest
  ) {
    this.assertSameOrigin(request);
    const context = this.context(request);
    return this.knowledge.updateDocument(context.memberId, context.workspaceId, id, body, request.correlationId);
  }

  @Post("query")
  @HttpCode(200)
  @RequireClientWorkspacePermissions(CLIENT_WORKSPACE_PERMISSION.knowledgeQuery)
  @UseGuards(WorkspaceContextGuard)
  @Header("Cache-Control", "private, no-store")
  query(
    @Body(new ValidationPipe({ expectedType: QueryAiKnowledgeDto, whitelist: true, forbidNonWhitelisted: true, transform: true })) body: QueryAiKnowledgeDto,
    @Req() request: ClientRequest
  ) {
    this.assertSameOrigin(request);
    const context = this.context(request);
    return this.knowledge.queryDocuments(context.memberId, context.workspaceId, body);
  }

  @Post("questions")
  @HttpCode(200)
  @RequireClientWorkspacePermissions(CLIENT_WORKSPACE_PERMISSION.knowledgeQuery)
  @UseGuards(WorkspaceContextGuard)
  @Header("Cache-Control", "private, no-store")
  submitQuestion(
    @Body(new ValidationPipe({ expectedType: CreateAiKnowledgeQuestionDto, whitelist: true, forbidNonWhitelisted: true, transform: true })) body: CreateAiKnowledgeQuestionDto,
    @Req() request: ClientRequest
  ) {
    this.assertSameOrigin(request);
    const context = this.context(request);
    return this.knowledge.submitQuestion(context.memberId, context.workspaceId, body, request.correlationId);
  }

  @Get("questions/:id")
  @RequireClientWorkspacePermissions(CLIENT_WORKSPACE_PERMISSION.knowledgeQuery)
  @UseGuards(WorkspaceContextGuard)
  @Header("Cache-Control", "private, no-store")
  getQuestion(@Param("id") id: string, @Req() request: ClientRequest) {
    const context = this.context(request);
    return this.knowledge.getQuestion(context.memberId, context.workspaceId, id);
  }
  @Post("evaluations")
  @HttpCode(200)
  @RequireClientWorkspacePermissions(CLIENT_WORKSPACE_PERMISSION.knowledgeManage)
  @UseGuards(WorkspaceContextGuard)
  @Header("Cache-Control", "private, no-store")
  captureEvaluation(@Body(new ValidationPipe({ expectedType: CaptureAiEvaluationDto, whitelist: true, forbidNonWhitelisted: true, transform: true })) body: CaptureAiEvaluationDto, @Req() request: ClientRequest) {
    this.assertSameOrigin(request);
    const context = this.context(request);
    return this.evaluations.capture(context.memberId, context.workspaceId, body);
  }

  @Get("evaluations/:id")
  @RequireClientWorkspacePermissions(CLIENT_WORKSPACE_PERMISSION.knowledgeManage)
  @UseGuards(WorkspaceContextGuard)
  @Header("Cache-Control", "private, no-store")
  readEvaluation(@Param("id") id: string, @Req() request: ClientRequest) {
    const context = this.context(request);
    return this.evaluations.read(context.memberId, context.workspaceId, id);
  }

  @Post("documents/import")
  @RequireClientWorkspacePermissions(CLIENT_WORKSPACE_PERMISSION.knowledgeManage)
  @UseGuards(WorkspaceContextGuard)
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 50 * 1024, files: 1, fields: 2, fieldSize: 1024 } }))
  @Header("Cache-Control", "private, no-store")
  importDocument(@Body(new ValidationPipe({ expectedType: ImportAiKnowledgeDocumentDto, whitelist: true, forbidNonWhitelisted: true, transform: true })) body: ImportAiKnowledgeDocumentDto,
    @UploadedFile() file: ClientUploadFile | undefined, @Req() request: ClientRequest) {
    this.assertSameOrigin(request);
    const context = this.context(request);
    return this.knowledge.importDocument(context.memberId, context.workspaceId, body, file, request.correlationId);
  }

}
