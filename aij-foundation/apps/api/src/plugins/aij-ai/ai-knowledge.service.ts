import { BadRequestException, ConflictException, GoneException, HttpException, Inject, Injectable, NotFoundException, OnModuleInit, Optional, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { AiKnowledgeQuestionStatus, Prisma, type AiKnowledgeQuestion } from "@prisma/client";
import { createHash } from "node:crypto";
import type { ImportAiKnowledgeDocumentDto } from "./ai-knowledge.dto";
import type { ClientUploadFile } from "../../files/client-files.dto";
import { PrismaService } from "../../prisma/prisma.service";
import { WorkspaceContextService } from "../../client-workspaces/workspace-context.service";
import { CLIENT_WORKSPACE_PERMISSION } from "../../client-workspaces/client-workspace-permissions";
import { JobService } from "../../async-runtime/job.service";
import { RuntimeRegistry, type JobHandler } from "../../async-runtime/registry";
import { PluginRuntimeAccessService } from "../../plugin-runtime/plugin-runtime-access.service";
import { AiKnowledgeDocumentPageDto, CreateAiKnowledgeDocumentDto, CreateAiKnowledgeQuestionDto, QueryAiKnowledgeDto, UpdateAiKnowledgeDocumentDto } from "./ai-knowledge.dto";
import { currentKnowledgeCitation, knowledgeCitationId } from "./knowledge-citation";
import { AI_KNOWLEDGE_RETRIEVAL_POLICY, knowledgeTerms, retrieveKnowledgeEvidence } from "./ai-knowledge-retrieval";
import { AiModelExecutionService } from "./ai-execution.service";
import { AI_PLUGIN_CODE } from "./ai-provider";
import { KnowledgeCsvError, parseKnowledgeCsv } from "./knowledge-csv-parser";
import { KnowledgeWebImportBodyPipe, type ImportKnowledgeWebDto } from "./ai-knowledge-web-import.dto";
import type { ClientClaims } from "../../client-auth/client-auth.security";
import { ClientAuthService } from "../../client-auth/client-auth.service";
import { assertKnowledgeWebSource, isKnowledgeWebSource, KNOWLEDGE_WEB_IMPORT_TRANSPORT, KNOWLEDGE_WEB_SOURCE_FILENAME, KnowledgeWebImportTransport, knowledgeWebTextChecksum, type KnowledgeDocumentSource } from "./knowledge-web-import";

export const AI_KNOWLEDGE_ANSWER_JOB = "aij-ai.knowledge-answer";
export const AI_KNOWLEDGE_ANSWER_JOB_VERSION = 1;
export const AI_KNOWLEDGE_EXPIRY_JOB = "aij-ai.knowledge-expiry-cleanup";
export const AI_KNOWLEDGE_EXPIRY_JOB_VERSION = 1;
export const AI_KNOWLEDGE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const AI_KNOWLEDGE_EXPIRY_SCHEDULE = "aij-ai.knowledge-expiry-cleanup";
export const AI_KNOWLEDGE_EXPIRY_INTERVAL_MS = 60 * 60 * 1000;

@Injectable()
export class AiKnowledgeService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaceContext: WorkspaceContextService,
    private readonly jobs: JobService,
    private readonly runtimeRegistry: RuntimeRegistry,
    private readonly pluginAccess: PluginRuntimeAccessService,
    private readonly modelExecution: AiModelExecutionService,
    @Optional() @Inject(KNOWLEDGE_WEB_IMPORT_TRANSPORT)
    private readonly webImport: KnowledgeWebImportTransport = new KnowledgeWebImportTransport(),
    @Optional() private readonly clientAuth?: ClientAuthService
  ) {}

  onModuleInit() {
    this.runtimeRegistry.registerOrchestratedJob(AI_KNOWLEDGE_ANSWER_JOB, AI_KNOWLEDGE_ANSWER_JOB_VERSION,
      job => this.executeQuestion(job));
    this.runtimeRegistry.registerOrchestratedJob(AI_KNOWLEDGE_EXPIRY_JOB, AI_KNOWLEDGE_EXPIRY_JOB_VERSION,
      job => this.runExpiryCleanup(job));
    this.runtimeRegistry.registerSchedule({
      code: AI_KNOWLEDGE_EXPIRY_SCHEDULE,
      intervalMs: AI_KNOWLEDGE_EXPIRY_INTERVAL_MS,
      job: now => ({
        type: AI_KNOWLEDGE_EXPIRY_JOB,
        version: AI_KNOWLEDGE_EXPIRY_JOB_VERSION,
        payload: { scheduledAt: now.toISOString() },
        scope: { type: "global", id: AI_PLUGIN_CODE },
        idempotencyKey: `knowledge-expiry:${now.toISOString()}`,
        correlationId: `knowledge-expiry:${now.toISOString()}`,
        maxAttempts: 5,
        timeoutMs: 30_000
      })
    });
  }

  private questionExpiresAt(createdAt: Date) {
    return new Date(createdAt.getTime() + AI_KNOWLEDGE_RETENTION_MS);
  }

  private isQuestionExpired(createdAt: Date, now = new Date()) {
    return now.getTime() >= this.questionExpiresAt(createdAt).getTime();
  }

  private assertQuestionNotExpired(row: AiKnowledgeQuestion, now = new Date()) {
    if (this.isQuestionExpired(row.createdAt, now)) throw new GoneException("Knowledge question expired");
  }

  private async scrubExpiredQuestion(id: string, now = new Date()) {
    const cutoff = new Date(now.getTime() - AI_KNOWLEDGE_RETENTION_MS);
    return this.prisma.aiKnowledgeQuestion.updateMany({
      where: { id, contentPurgedAt: null, createdAt: { lte: cutoff } },
      data: { query: "", answer: null, citations: Prisma.DbNull, contentPurgedAt: now }
    });
  }

  private async cleanExpiredQuestions(now = new Date()) {
    const cutoff = new Date(now.getTime() - AI_KNOWLEDGE_RETENTION_MS);
    return this.prisma.aiKnowledgeQuestion.updateMany({
      where: { contentPurgedAt: null, createdAt: { lte: cutoff } },
      data: { query: "", answer: null, citations: Prisma.DbNull, contentPurgedAt: now }
    });
  }

  private async expireRunningQuestion(id: string, now = new Date()) {
    await this.scrubExpiredQuestion(id, now);
    await this.prisma.aiKnowledgeQuestion.updateMany({
      where: { id, status: { in: [AiKnowledgeQuestionStatus.queued, AiKnowledgeQuestionStatus.running] } },
      data: { status: AiKnowledgeQuestionStatus.failed, failureCode: "RETENTION_EXPIRED" }
    });
  }

  private async runExpiryCleanup(job: Parameters<JobHandler>[0]) {
    const payload = job.payload;
    if (!payload || typeof payload !== "object" || Array.isArray(payload) ||
        Object.keys(payload).length !== 1 || typeof (payload as Record<string, unknown>).scheduledAt !== "string" ||
        !Number.isFinite(Date.parse((payload as Record<string, string>).scheduledAt))) {
      throw new Error("AI_KNOWLEDGE_EXPIRY_JOB_INVALID");
    }
    const result = await this.cleanExpiredQuestions(new Date());
    return { resultReference: { cleanedCount: result.count } };
  }

  private async assertMembership(memberId: string, workspaceId: string, permission: string) {
    await this.workspaceContext.resolve(memberId, workspaceId, [permission]);
    await this.pluginAccess.assertEnabled(AI_PLUGIN_CODE);
  }

  private async assertWriteAccessInTransaction(tx: Prisma.TransactionClient, memberId: string, workspaceId: string, permission: string) {
    const projectId = await this.pluginAccess.projectId(tx);
    // Document/submission transactions take the lifecycle lock before membership.
    // Enqueue may reacquire the same lifecycle lock in this transaction.
    await this.pluginAccess.assertEnabledInTransaction(tx, projectId, AI_PLUGIN_CODE);
    await this.workspaceContext.assertWritePermissionInTransaction(tx, memberId, workspaceId, permission);
    return projectId;
  }

  /** Web-only preflight and final fence; no transaction spans DNS, HTTPS or parsing. */
  private async assertWebAccessInTransaction(tx: Prisma.TransactionClient, memberId: string, workspaceId: string, claims?: ClientClaims) {
    if (!claims || claims.sub !== memberId) throw new UnauthorizedException("WEB_IMPORT_REJECTED");
    const projectId = await this.assertWriteAccessInTransaction(tx, memberId, workspaceId, CLIENT_WORKSPACE_PERMISSION.knowledgeManage);
    if (!this.clientAuth) throw new ServiceUnavailableException("WEB_IMPORT_UNAVAILABLE");
    await this.clientAuth.assertActiveSessionInTransaction(tx, claims);
    const project = await tx.$queryRaw<{ id: string }[]>`
      SELECT p.id FROM public.project_profile p
      JOIN public.organization_profile o ON o.id = p.organization_id
      WHERE p.id = ${projectId} AND p.status = 'active' AND p.deleted_at IS NULL
        AND o.status = 'active' AND o.deleted_at IS NULL
      FOR SHARE OF p, o`;
    if (!project.length) throw new ServiceUnavailableException("WEB_IMPORT_UNAVAILABLE");
  }

  async importWebDocument(memberId: string, workspaceId: string, raw: ImportKnowledgeWebDto, correlationId?: string, claims?: ClientClaims) {
    const dto = new KnowledgeWebImportBodyPipe().transform(raw);
    // Includes actual member identity, role/grant, workspace, lifecycle, project and organization.
    try {
      await this.prisma.$transaction(tx => this.assertWebAccessInTransaction(tx, memberId, workspaceId, claims),
        { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 2000, timeout: 5000 });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException("WEB_IMPORT_UNAVAILABLE");
    }
    const extracted = await this.webImport.extract(dto.url);
    return this.createDocument(memberId, workspaceId,
      { documentCode: dto.documentCode, title: dto.title, content: extracted.content }, correlationId, extracted.source, claims);
  }

  async getWebSource(memberId: string, workspaceId: string, id: string, claims?: ClientClaims) {
    if (!/^[a-z0-9]{20,32}$/.test(id)) throw new BadRequestException("WEB_IMPORT_INVALID");
    try {
      return await this.prisma.$transaction(async tx => {
        await this.assertWebAccessInTransaction(tx, memberId, workspaceId, claims);
        // Fence deletion/update until the scoped metadata projection has been materialized.
        const locked = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM public.ai_knowledge_document
          WHERE id = ${id} AND workspace_id = ${workspaceId} AND deleted_at IS NULL FOR SHARE`;
        if (!locked.length) throw new NotFoundException("WEB_SOURCE_UNAVAILABLE");
        const row = await tx.aiKnowledgeDocument.findFirst({
          where: { id, workspaceId, deletedAt: null },
          select: { id: true, content: true, sourceFilename: true, sourceChecksum: true,
            sourceUrl: true, sourceFinalUrl: true, sourceTextChecksum: true, sourceExtractionVersion: true }
        });
        if (!row || row.sourceFilename !== KNOWLEDGE_WEB_SOURCE_FILENAME || !row.sourceChecksum
          || !row.sourceUrl || !row.sourceFinalUrl || !row.sourceTextChecksum || !row.sourceExtractionVersion) {
          throw new NotFoundException("WEB_SOURCE_UNAVAILABLE");
        }
        return { documentId: row.id, sourceFilename: row.sourceFilename, sourceChecksum: row.sourceChecksum,
          sourceUrl: row.sourceUrl, sourceFinalUrl: row.sourceFinalUrl, sourceTextChecksum: row.sourceTextChecksum,
          sourceExtractionVersion: row.sourceExtractionVersion,
          contentMatchesSource: knowledgeWebTextChecksum(row.content) === row.sourceTextChecksum };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 2000, timeout: 5000 });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException("WEB_SOURCE_UNAVAILABLE");
    }
  }

  async createDocument(memberId: string, workspaceId: string, dto: CreateAiKnowledgeDocumentDto, correlationId?: string, source?: KnowledgeDocumentSource, claims?: ClientClaims) {
    await this.assertMembership(memberId, workspaceId, CLIENT_WORKSPACE_PERMISSION.knowledgeManage);
    const webSource = source && isKnowledgeWebSource(source) ? source : undefined;
    if (webSource) assertKnowledgeWebSource(webSource, dto.content);
    if (!dto.documentCode.trim() || !dto.title.trim() || !dto.content.trim() || Buffer.byteLength(dto.content, "utf8") > 64 * 1024) {
      throw new BadRequestException("Knowledge document is invalid");
    }
    try {
      return await this.prisma.$transaction(async tx => {
        if (webSource) await this.assertWebAccessInTransaction(tx, memberId, workspaceId, claims);
        else await this.assertWriteAccessInTransaction(tx, memberId, workspaceId, CLIENT_WORKSPACE_PERMISSION.knowledgeManage);
        const document = await tx.aiKnowledgeDocument.create({
          data: {
            workspaceId,
            documentCode: dto.documentCode.trim(),
            title: dto.title.trim(),
            content: webSource ? dto.content : dto.content.trim(),
            ...(source ? { sourceFilename: source.filename, sourceChecksum: source.checksum } : {}),
            ...(webSource ? { status: "inactive", sourceUrl: webSource.sourceUrl, sourceFinalUrl: webSource.sourceFinalUrl,
              sourceTextChecksum: webSource.sourceTextChecksum, sourceExtractionVersion: webSource.sourceExtractionVersion } : {}),
            createdByMemberId: memberId
          },
          select: { id: true, workspaceId: true, documentCode: true, title: true, status: true, createdAt: true, updatedAt: true }
        });
        await tx.auditLog.create({ data: {
          module: "aij-ai",
          action: source ? "ai_knowledge_document_imported" : "ai_knowledge_document_created",
          userId: memberId,
          method: "POST",
          path: webSource ? "/api/client/ai/knowledge/documents/import-web" : "/api/client/ai/knowledge/documents",
          requestSummary: { correlationId: correlationId || "unavailable" },
          status: "success",
          resourceType: "ai_knowledge_document",
          resourceId: document.id,
          afterData: { documentId: document.id, status: document.status, ...(source && !webSource ? { sourceChecksum: source.checksum } : {}) },
          workspaceId
        } });
        return document;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 2000, timeout: 5000 });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      if ((error as { code?: unknown })?.code === "P2002") throw new ConflictException("Knowledge document code already exists in this workspace");
      throw new ServiceUnavailableException("Knowledge service unavailable");
    }
  }

  async importDocument(memberId: string, workspaceId: string, dto: ImportAiKnowledgeDocumentDto, file: ClientUploadFile | undefined, correlationId?: string) {
    await this.assertMembership(memberId, workspaceId, CLIENT_WORKSPACE_PERMISSION.knowledgeManage);
    if (!file || !Buffer.isBuffer(file.buffer) || file.size !== file.buffer.length || !file.size || file.size > 50 * 1024 ||
        typeof file.originalname !== "string") throw new BadRequestException("A UTF-8 knowledge file up to 50KiB is required");
    // Only a display filename is retained, never a client filesystem path or raw file object.
    const leaf = file.originalname.replaceAll("\\", "/").split("/").at(-1) || "";
    // eslint-disable-next-line no-control-regex
    const filename = leaf.replace(/[\u0000-\u001f\u007f]/g, "").trim();
    if (!/\.(txt|md|csv)$/i.test(filename) || filename.length > 160) throw new BadRequestException("Only .txt, .md and .csv knowledge files are supported");
    const csv = /\.csv$/i.test(filename);
    const allowedMime = csv ? ["text/csv", "application/octet-stream", ""] : ["text/plain", "text/markdown", "application/octet-stream", ""];
    if (!allowedMime.includes(file.mimetype)) throw new BadRequestException("Knowledge file MIME type is not supported");
    let content: string;
    try { content = new TextDecoder("utf-8", { fatal: true }).decode(file.buffer); }
    catch { throw new BadRequestException("Knowledge file must use valid UTF-8"); }
    // eslint-disable-next-line no-control-regex
    if (!content.trim() || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(content)) throw new BadRequestException("Knowledge file contains invalid text");
    if (csv) {
      try { content = parseKnowledgeCsv(content); }
      catch (error) {
        if (error instanceof KnowledgeCsvError) throw new BadRequestException(error.message);
        throw error;
      }
    }
    return this.createDocument(memberId, workspaceId, { ...dto, content }, correlationId,
      { filename, checksum: createHash("sha256").update(file.buffer).digest("hex") });
  }

  async listDocuments(memberId: string, workspaceId: string, query: AiKnowledgeDocumentPageDto) {
    await this.assertMembership(memberId, workspaceId, CLIENT_WORKSPACE_PERMISSION.knowledgeManage);
    try {
      const where = {
        workspaceId,
        deletedAt: null,
        ...(query.status === "all" ? {} : { status: query.status })
      } as const;
      const [total, items] = await this.prisma.$transaction([
        this.prisma.aiKnowledgeDocument.count({ where }),
        this.prisma.aiKnowledgeDocument.findMany({
          where,
          orderBy: [{ createdAt: "desc" }, { id: "asc" }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          select: { id: true, workspaceId: true, documentCode: true, title: true, content: true, status: true, sourceFilename: true, sourceChecksum: true, createdAt: true, updatedAt: true }
        })
      ]);
      return { page: query.page, pageSize: query.pageSize, total, items };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException("Knowledge service unavailable");
    }
  }

  async updateDocument(memberId: string, workspaceId: string, id: string, dto: UpdateAiKnowledgeDocumentDto, correlationId?: string) {
    await this.assertMembership(memberId, workspaceId, CLIENT_WORKSPACE_PERMISSION.knowledgeManage);
    if (!/^[a-z0-9]{20,32}$/.test(id)) throw new BadRequestException("Knowledge document is invalid");
    const hasTitle = dto.title !== undefined;
    const hasContent = dto.content !== undefined;
    const hasStatus = dto.status !== undefined;
    if (!hasTitle && !hasContent && !hasStatus) throw new BadRequestException("Knowledge document update is empty");
    if ((hasTitle && !dto.title?.trim()) || (hasContent && (!dto.content?.trim() || Buffer.byteLength(dto.content, "utf8") > 64 * 1024))) {
      throw new BadRequestException("Knowledge document is invalid");
    }
    const expectedUpdatedAt = new Date(dto.expectedUpdatedAt);
    if (!Number.isFinite(expectedUpdatedAt.getTime())) throw new BadRequestException("Knowledge document version is invalid");
    try {
      return await this.prisma.$transaction(async tx => {
        await this.assertWriteAccessInTransaction(tx, memberId, workspaceId, CLIENT_WORKSPACE_PERMISSION.knowledgeManage);
        const current = await tx.aiKnowledgeDocument.findFirst({
          where: { id, workspaceId, deletedAt: null },
          select: { id: true, workspaceId: true, status: true, updatedAt: true }
        });
        if (!current) throw new NotFoundException("Knowledge document unavailable");
        if (current.updatedAt.getTime() !== expectedUpdatedAt.getTime()) throw new ConflictException("Knowledge document version conflict");
        const updated = await tx.aiKnowledgeDocument.updateMany({
          where: { id, workspaceId, deletedAt: null, updatedAt: current.updatedAt },
          data: {
            ...(hasTitle ? { title: dto.title!.trim() } : {}),
            ...(hasContent ? { content: dto.content!.trim() } : {}),
            ...(hasStatus ? { status: dto.status! } : {})
          }
        });
        if (updated.count !== 1) throw new ConflictException("Knowledge document version conflict");
        const document = await tx.aiKnowledgeDocument.findFirstOrThrow({
          where: { id, workspaceId, deletedAt: null },
          select: { id: true, workspaceId: true, documentCode: true, title: true, content: true, status: true, sourceFilename: true, sourceChecksum: true, createdAt: true, updatedAt: true }
        });
        await tx.auditLog.create({ data: {
          module: "aij-ai",
          action: hasStatus ? "ai_knowledge_document_status_changed" : "ai_knowledge_document_updated",
          userId: memberId,
          method: "PATCH",
          path: "/api/client/ai/knowledge/documents/:id",
          requestSummary: { correlationId: correlationId || "unavailable" },
          status: "success",
          resourceType: "ai_knowledge_document",
          resourceId: document.id,
          beforeData: { documentId: current.id, status: current.status, updatedAt: current.updatedAt.toISOString() },
          afterData: { documentId: document.id, status: document.status, updatedAt: document.updatedAt.toISOString() },
          workspaceId
        } });
        return document;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 2000, timeout: 5000 });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException("Knowledge document update unavailable");
    }
  }

  /** Read current source through the original owners; no maintenance or external IO. */
  async readCitation(memberId: string, workspaceId: string, questionId: string, documentId: string, claims: ClientClaims) {
    knowledgeCitationId(questionId); knowledgeCitationId(documentId);
    if (!claims || claims.sub !== memberId || typeof claims.sessionId !== "string"
      || !/^[A-Za-z0-9_-]{1,128}$/.test(claims.sessionId)
      || !Number.isSafeInteger(claims.tokenVersion) || claims.tokenVersion < 0) throw new UnauthorizedException("CITATION_SESSION_REQUIRED");
    const auth = this.clientAuth;
    if (!auth) throw new ServiceUnavailableException("CITATION_UNAVAILABLE");
    try {
      return await this.prisma.$transaction(async tx => {
        const projectId = await this.assertWriteAccessInTransaction(tx, memberId, workspaceId, CLIENT_WORKSPACE_PERMISSION.knowledgeQuery);
        const found = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM public.ai_knowledge_question
          WHERE id=${questionId} AND workspace_id=${workspaceId} AND member_id=${memberId} AND deleted_at IS NULL FOR SHARE`;
        if (found.length !== 1) throw new NotFoundException("CITATION_UNAVAILABLE");
        const question = await tx.aiKnowledgeQuestion.findFirst({
          where: { id: questionId, workspaceId, memberId, deletedAt: null },
          select: { id: true, workspaceId: true, memberId: true, status: true, query: true, citations: true,
            createdAt: true, updatedAt: true, deletedAt: true, contentPurgedAt: true }
        });
        await tx.$queryRaw`SELECT id FROM public.ai_knowledge_document WHERE id=${documentId} AND workspace_id=${workspaceId} FOR SHARE`;
        const document = await tx.aiKnowledgeDocument.findFirst({
          where: { id: documentId, workspaceId },
          select: { id: true, workspaceId: true, documentCode: true, title: true, content: true,
            status: true, updatedAt: true, deletedAt: true }
        });
        // Recheck current owners after any question/document row lock wait.
        await this.assertWriteAccessInTransaction(tx, memberId, workspaceId, CLIENT_WORKSPACE_PERMISSION.knowledgeQuery);
        const project = await tx.$queryRaw<{ id: string }[]>`SELECT p.id FROM public.project_profile p
          JOIN public.organization_profile o ON o.id=p.organization_id
          WHERE p.id=${projectId} AND p.status='active' AND p.deleted_at IS NULL
            AND o.status='active' AND o.deleted_at IS NULL FOR SHARE OF p,o`;
        if (project.length !== 1) throw new ServiceUnavailableException("CITATION_UNAVAILABLE");
        await auth.assertSessionInTransaction(tx, claims);
        const [clock] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
        if (!clock) throw new ServiceUnavailableException("CITATION_UNAVAILABLE");
        return currentKnowledgeCitation({ memberId, workspaceId, questionId, documentId, question, document, now: clock.now });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 2000, timeout: 5000 });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException("CITATION_UNAVAILABLE");
    }
  }

  async queryDocuments(memberId: string, workspaceId: string, query: QueryAiKnowledgeDto) {
    await this.assertMembership(memberId, workspaceId, CLIENT_WORKSPACE_PERMISSION.knowledgeQuery);
    const terms = knowledgeTerms(query.query);
    if (terms.length < AI_KNOWLEDGE_RETRIEVAL_POLICY.minimumMatchedTerms) {
      return retrieveKnowledgeEvidence(query.query, []);
    }
    if (terms.length > AI_KNOWLEDGE_RETRIEVAL_POLICY.maximumQueryTerms) {
      throw new BadRequestException("Knowledge query is too broad");
    }
    try {
      const candidates = await this.prisma.aiKnowledgeDocument.findMany({
        where: {
          workspaceId,
          status: "active",
          deletedAt: null,
          OR: terms.map(term => ({ content: { contains: term, mode: "insensitive" as const } }))
        },
        orderBy: [{ documentCode: "asc" }, { id: "asc" }],
        take: AI_KNOWLEDGE_RETRIEVAL_POLICY.maximumCandidates + 1,
        select: { id: true, documentCode: true, title: true, content: true }
      });
      if (candidates.length > AI_KNOWLEDGE_RETRIEVAL_POLICY.maximumCandidates) {
        return { result: "REFUSED" as const, refusalCode: "INSUFFICIENT_EVIDENCE" as const, evidenceCoverage: 0, citations: [] };
      }
      return retrieveKnowledgeEvidence(query.query, candidates);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException("Knowledge service unavailable");
    }
  }

  private questionFingerprint(value: string) {
    return createHash("sha256").update(value).digest("hex");
  }

  private publicQuestion(row: AiKnowledgeQuestion, idempotentReplay = false) {
    this.assertQuestionNotExpired(row);
    return {
      id: row.id,
      status: row.status,
      answer: row.answer,
      citations: row.citations ?? [],
      refusalCode: row.refusalCode,
      failureCode: row.failureCode,
      idempotentReplay,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    };
  }

  private assertSameRequest(row: AiKnowledgeQuestion, fingerprint: string) {
    if (row.requestFingerprint !== fingerprint) throw new ConflictException("Knowledge question idempotency key conflicts with a different query");
    return this.publicQuestion(row, true);
  }

  async submitQuestion(memberId: string, workspaceId: string, dto: CreateAiKnowledgeQuestionDto, correlationId?: string) {
    await this.assertMembership(memberId, workspaceId, CLIENT_WORKSPACE_PERMISSION.knowledgeQuery);
    const query = dto.query.trim().normalize("NFKC");
    if (!query || Buffer.byteLength(query, "utf8") > 2000) throw new BadRequestException("Knowledge question is invalid");
    const idempotencyKeyHash = this.questionFingerprint(workspaceId + "\0" + dto.idempotencyKey);
    const requestFingerprint = this.questionFingerprint(query);
    const existing = await this.prisma.aiKnowledgeQuestion.findUnique({ where: { workspaceId_idempotencyKeyHash: { workspaceId, idempotencyKeyHash } } });
    if (existing) return this.assertSameRequest(existing, requestFingerprint);

    const evidence = await this.queryDocuments(memberId, workspaceId, { query });
    if (evidence.result === "EVIDENCE_FOUND") await this.modelExecution.assertAvailable("text.generate");
    try {
      return await this.prisma.$transaction(async tx => {
        const projectId = await this.assertWriteAccessInTransaction(tx, memberId, workspaceId, CLIENT_WORKSPACE_PERMISSION.knowledgeQuery);
        const previous = await tx.aiKnowledgeQuestion.findUnique({ where: { workspaceId_idempotencyKeyHash: { workspaceId, idempotencyKeyHash } } });
        if (previous) return this.assertSameRequest(previous, requestFingerprint);
        const question = await tx.aiKnowledgeQuestion.create({ data: {
          workspaceId,
          memberId,
          idempotencyKeyHash,
          requestFingerprint,
          query,
          status: evidence.result === "EVIDENCE_FOUND" ? AiKnowledgeQuestionStatus.queued : AiKnowledgeQuestionStatus.refused,
          refusalCode: evidence.refusalCode,
          ...(evidence.result === "REFUSED" ? { citations: [] as Prisma.InputJsonValue } : {})
        } });
        if (evidence.result === "REFUSED") return this.publicQuestion(question);
        const job = await this.jobs.enqueueIdempotentInTransaction(tx, {
          type: AI_KNOWLEDGE_ANSWER_JOB,
          version: AI_KNOWLEDGE_ANSWER_JOB_VERSION,
          payload: { questionId: question.id },
          scope: { type: "plugin", id: projectId, pluginCode: AI_PLUGIN_CODE },
          workspaceId,
          idempotencyKey: "knowledge-" + idempotencyKeyHash,
          maxAttempts: 1,
          timeoutMs: 30_000,
          correlationId
        });
        const queued = await tx.aiKnowledgeQuestion.update({ where: { id: question.id }, data: { runtimeJobId: job.id } });
        return this.publicQuestion(queued);
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 2000, timeout: 5000 });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      if ((error as { code?: unknown })?.code === "P2002") {
        const concurrent = await this.prisma.aiKnowledgeQuestion.findUnique({ where: { workspaceId_idempotencyKeyHash: { workspaceId, idempotencyKeyHash } } });
        if (concurrent) return this.assertSameRequest(concurrent, requestFingerprint);
        throw new ConflictException("Knowledge question could not be queued");
      }
      throw new ServiceUnavailableException("Knowledge question service unavailable");
    }
  }

  async getQuestion(memberId: string, workspaceId: string, id: string) {
    await this.assertMembership(memberId, workspaceId, CLIENT_WORKSPACE_PERMISSION.knowledgeQuery);
    if (!/^[a-z0-9]{20,32}$/.test(id)) throw new BadRequestException("Knowledge question is invalid");
    let row = await this.prisma.aiKnowledgeQuestion.findFirst({ where: { id, workspaceId, deletedAt: null }, include: { runtimeJob: true } });
    if (!row) throw new NotFoundException("Knowledge question unavailable");
    this.assertQuestionNotExpired(row);
    if ((row.status === AiKnowledgeQuestionStatus.queued || row.status === AiKnowledgeQuestionStatus.running) &&
        row.runtimeJob && ["dead", "failed", "cancelled", "completed"].includes(row.runtimeJob.status)) {
      await this.prisma.aiKnowledgeQuestion.updateMany({
        where: { id: row.id, status: { in: [AiKnowledgeQuestionStatus.queued, AiKnowledgeQuestionStatus.running] } },
        data: { status: AiKnowledgeQuestionStatus.failed, failureCode: "EXECUTION_RESULT_UNAVAILABLE" }
      });
      row = await this.prisma.aiKnowledgeQuestion.findFirstOrThrow({ where: { id, workspaceId, deletedAt: null }, include: { runtimeJob: true } });
    }
    return this.publicQuestion(row);
  }

  private async executeQuestion(job: Parameters<JobHandler>[0]) {
    if (!job.payload || typeof job.payload !== "object" || Array.isArray(job.payload) ||
        typeof (job.payload as Record<string, unknown>).questionId !== "string") throw new Error("AI_KNOWLEDGE_JOB_INVALID");
    const questionId = (job.payload as Record<string, string>).questionId;
    const row = await this.prisma.aiKnowledgeQuestion.findFirst({ where: { id: questionId, runtimeJobId: job.id, deletedAt: null } });
    if (!row) throw new Error("AI_KNOWLEDGE_QUESTION_UNAVAILABLE");
    if (this.isQuestionExpired(row.createdAt)) {
      await this.expireRunningQuestion(row.id);
      return { resultReference: { questionId: row.id, expired: true, contentPurged: true } };
    }
    if (row.status === AiKnowledgeQuestionStatus.answered || row.status === AiKnowledgeQuestionStatus.refused) {
      return { resultReference: { questionId: row.id, answerStored: row.status === AiKnowledgeQuestionStatus.answered } };
    }
    const claimed = await this.prisma.aiKnowledgeQuestion.updateMany({
      where: { id: row.id, status: { in: [AiKnowledgeQuestionStatus.queued, AiKnowledgeQuestionStatus.running] } },
      data: { status: AiKnowledgeQuestionStatus.running, failureCode: null }
    });
    if (claimed.count !== 1) throw new Error("AI_KNOWLEDGE_QUESTION_STATE_CONFLICT");
    try {
      if (this.isQuestionExpired(row.createdAt)) {
        await this.expireRunningQuestion(row.id);
        return { resultReference: { questionId: row.id, expired: true, contentPurged: true } };
      }
      const evidence = await this.queryDocuments(row.memberId, row.workspaceId, { query: row.query });
      if (evidence.result === "REFUSED") {
        await this.prisma.aiKnowledgeQuestion.update({ where: { id: row.id }, data: {
          status: AiKnowledgeQuestionStatus.refused,
          answer: null,
          citations: [],
          refusalCode: evidence.refusalCode,
          failureCode: null
        } });
        return { resultReference: { questionId: row.id, answerStored: false, refused: true } };
      }
      if (!Number.isSafeInteger(job.attempt) || (job.attempt ?? 0) < 1) throw new Error("AI_KNOWLEDGE_ATTEMPT_INVALID");
      if (this.isQuestionExpired(row.createdAt)) {
        await this.expireRunningQuestion(row.id);
        return { resultReference: { questionId: row.id, expired: true, contentPurged: true } };
      }
      const outcome = await this.modelExecution.execute({ capabilityCode: "text.generate", payload: {
        query: row.query,
        evidence: evidence.citations.map(item => ({ documentId: item.documentId, title: item.title, excerpt: item.excerpt }))
      } }, job.signal, {
        jobId: job.id,
        attempt: job.attempt as number,
        correlationId: job.correlationId || job.id
      });
      const output = outcome.output;
      if (!output || typeof output !== "object" || Array.isArray(output) ||
          Object.keys(output).some(key => key !== "answer") || typeof (output as { answer?: unknown }).answer !== "string" ||
          !(output as { answer: string }).answer.trim() || Buffer.byteLength((output as { answer: string }).answer, "utf8") > 8000) {
        throw new Error("AI_KNOWLEDGE_ANSWER_INVALID");
      }
      if (this.isQuestionExpired(row.createdAt)) {
        await this.expireRunningQuestion(row.id);
        return { resultReference: { questionId: row.id, expired: true, contentPurged: true } };
      }
      const saved = await this.prisma.aiKnowledgeQuestion.updateMany({ where: { id: row.id, status: AiKnowledgeQuestionStatus.running }, data: {
        status: AiKnowledgeQuestionStatus.answered,
        answer: (output as { answer: string }).answer.trim(),
        citations: evidence.citations as unknown as Prisma.InputJsonValue,
        refusalCode: null,
        failureCode: null,
        traceId: outcome.traceId || null
      } });
      if (saved.count !== 1) throw new Error("AI_KNOWLEDGE_QUESTION_STATE_CONFLICT");
      return { resultReference: { questionId: row.id, traceId: outcome.traceId, answerStored: true } };
    } catch (error) {
      await this.prisma.aiKnowledgeQuestion.updateMany({ where: { id: row.id, status: AiKnowledgeQuestionStatus.running }, data: {
        status: AiKnowledgeQuestionStatus.failed,
        answer: null,
        citations: [],
        failureCode: "EXECUTION_FAILED"
      } });
      throw error;
    }
  }
}
