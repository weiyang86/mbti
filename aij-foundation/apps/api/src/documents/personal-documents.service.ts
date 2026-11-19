import { ConflictException, ForbiddenException, HttpException, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { CLIENT_WORKSPACE_PERMISSION as P } from "../client-workspaces/client-workspace-permissions";
import { Prisma } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { WorkspaceContextService } from "../client-workspaces/workspace-context.service";
import { PluginRuntimeAccessService } from "../plugin-runtime/plugin-runtime-access.service";
import { createDocumentDto, updateDocumentDto, deleteDocumentDto, documentId, documentPage, documentRevisionParam } from "./personal-documents.dto";

import { buildPersonalDocumentRunSource, parseDocumentSectionSelector } from "./personal-document-run-source";

export type DocumentGenerationScope = Readonly<{ projectId: string; workspaceId: string; memberId: string }>;
export type DocumentGenerationSessionGate = (tx: Prisma.TransactionClient) => Promise<void>;

// Root registers these exact definitions and OWNER grants. No fallback to AI asset permissions.
export const DOCUMENT_PERMISSION = { read: P.documentsRead, manage: P.documentsManage } as const;
type Head = { id: string; workspace_id: string; member_id: string; code: string; name: string; body: string; revision: number; created_at: Date; updated_at: Date; deleted_at: Date | null };
type Summary = Pick<Head, "id" | "code" | "name" | "revision" | "created_at" | "updated_at">;
type Version = { document_id: string; revision: number; name: string; body: string; created_at: Date };
const summary = (r: Summary) => ({ id: r.id, code: r.code, name: r.name, revision: r.revision, createdAt: r.created_at.toISOString(), updatedAt: r.updated_at.toISOString() });
const detail = (r: Head) => ({ ...summary(r), body: r.body });
const versionSummary = (r: Omit<Version, "body">) => ({ documentId: r.document_id, revision: r.revision, name: r.name, createdAt: r.created_at.toISOString() });

/** Personal documents are a separate owner; no provider, file, knowledge, job or billing dependency. */
@Injectable()
export class PersonalDocumentsService {
  constructor(private readonly prisma: PrismaService, private readonly workspaces: WorkspaceContextService, private readonly plugins: PluginRuntimeAccessService) {}
  private async scope<T>(member: string, workspace: string, permission: string, operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    try {
      return await this.prisma.$transaction(async tx => {
        return this.scopeInTransaction(tx, member, workspace, [permission], operation);
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 5000, timeout: 10000 });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException("Personal document service unavailable");
    }
  }
  /** Single document capability owner, also used inside the original run transaction. */
  private async scopeInTransaction<T>(tx: Prisma.TransactionClient, member: string, workspace: string, permissions: readonly string[],
    operation: (tx: Prisma.TransactionClient, projectId: string) => Promise<T>): Promise<T> {
    const project = await this.plugins.projectId(tx);
    await this.plugins.assertEnabledInTransaction(tx, project, "aij-ai");
    const projects = await tx.$queryRaw<{ id: string }[]>`SELECT p.id FROM public.project_profile p JOIN public.organization_profile o ON o.id=p.organization_id
      WHERE p.id=${project} AND p.status='active' AND p.deleted_at IS NULL AND o.status='active' AND o.deleted_at IS NULL FOR SHARE OF p,o`;
    const installations = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM public.plugin_installation WHERE project_id=${project} AND plugin_code='aij-ai' AND status='enabled' FOR SHARE`;
    if (!projects.length || !installations.length) throw new NotFoundException("Document capability unavailable");
    // Same membership -> document namespace -> document row order for every document caller.
    for (const permission of permissions) await this.workspaces.assertWritePermissionInTransaction(tx, member, workspace, permission);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"personal-documents:" + workspace + ":" + member},0))`;
    return operation(tx, project);
  }
  private async generationScope<T>(tx: Prisma.TransactionClient, scope: DocumentGenerationScope, rawSelector: unknown,
    purpose: "read" | "execute", authorize: DocumentGenerationSessionGate,
    operation: (document: Readonly<Head>, selector: ReturnType<typeof parseDocumentSectionSelector>, project: string) => T): Promise<T> {
    const selector = parseDocumentSectionSelector(rawSelector);
    if (purpose !== "read" && purpose !== "execute") throw new ConflictException("Personal document source purpose unavailable");
    if (typeof authorize !== "function") throw new ServiceUnavailableException("Personal document session gate unavailable");
    const permissions: string[] = [DOCUMENT_PERMISSION.read, P.aiRead, P.aiAssetsRead];
    if (purpose === "execute") permissions.push(DOCUMENT_PERMISSION.manage, P.aiExecute);
    try {
      return await this.scopeInTransaction(tx, scope.memberId, scope.workspaceId, permissions, async (current, project) => {
        if (project !== scope.projectId) throw new ConflictException("Personal document source scope changed");
        const document = await this.owned(current, scope.memberId, scope.workspaceId, selector.documentId);
        await authorize(current);
        return operation(document, selector, project);
      });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException("Personal document source unavailable");
    }
  }
  /** INTERNAL: the caller owns admission/Job/Run transaction; never opens a nested transaction. */
  resolveGenerationSourceInTransaction(tx: Prisma.TransactionClient, scope: DocumentGenerationScope, selector: unknown,
    purpose: "read" | "execute", authorize: DocumentGenerationSessionGate) {
    return this.generationScope(tx, scope, selector, purpose, authorize, (document, selection, projectId) =>
      Object.freeze({ projectId, ...buildPersonalDocumentRunSource({ id: document.id, revision: document.revision, body: document.body }, selection) }));
  }
  /** Metadata recovery still checks current ownership, read access and the fresh request session. */
  inspectGenerationSourceInTransaction(tx: Prisma.TransactionClient, scope: DocumentGenerationScope, selector: unknown,
    authorize: DocumentGenerationSessionGate) {
    return this.generationScope(tx, scope, selector, "read", authorize, (document, selection, projectId) => {
      const unchanged = document.revision === selection.expectedRevision &&
        createHash("sha256").update(document.body, "utf8").digest("hex") === selection.bodySha256;
      if (unchanged) buildPersonalDocumentRunSource({ id: document.id, revision: document.revision, body: document.body }, selection);
      return Object.freeze({ projectId, documentCurrent: unchanged });
    });
  }
  /** Internal export fence: never accepts an HTTP supplied scope or a historical body. */
  withCurrentDocument<T>(member: string, workspace: string, id: string, expectedRevision: number | undefined,
    operation: (tx: Prisma.TransactionClient, document: Readonly<Head>, projectId: string) => Promise<T>): Promise<T> {
    id = documentId(id);
    return this.scope(member, workspace, DOCUMENT_PERMISSION.read, async tx => {
      await this.workspaces.assertWritePermissionInTransaction(tx, member, workspace, "workspace.documents.export");
      const document = await this.owned(tx, member, workspace, id);
      if (expectedRevision !== undefined && document.revision !== expectedRevision) throw new ConflictException("Personal document revision conflict");
      return operation(tx, document, await this.plugins.projectId(tx));
    });
  }
  exportCapability(member: string, workspace: string, configured: boolean) {
    return this.scope(member, workspace, DOCUMENT_PERMISSION.read, async tx => {
      let permitted = true;
      try { await this.workspaces.assertWritePermissionInTransaction(tx, member, workspace, "workspace.documents.export"); }
      catch (error) { if (!(error instanceof ForbiddenException)) throw error; permitted = false; }
      return { configured, canExport: configured && permitted,
        reason: !permitted ? "not_permitted" as const : !configured ? "not_configured" as const : "ready" as const };
    });
  }
  private async owned(tx: Prisma.TransactionClient, member: string, workspace: string, id: string) {
    const rows = await tx.$queryRaw<Head[]>`SELECT * FROM public.personal_document WHERE id=${id}::uuid AND workspace_id=${workspace} AND member_id=${member} FOR UPDATE`;
    if (!rows[0] || rows[0].deleted_at) throw new NotFoundException("Personal document unavailable");
    return rows[0];
  }
  private async version(tx: Prisma.TransactionClient, r: Head) {
    await tx.$executeRaw`INSERT INTO public.personal_document_version (id,document_id,workspace_id,member_id,revision,name,body,created_at)
      VALUES (${randomUUID()}::uuid,${r.id}::uuid,${r.workspace_id},${r.member_id},${r.revision},${r.name},${r.body},${r.updated_at})`;
  }
  private async audit(tx: Prisma.TransactionClient, r: Head, action: string) {
    await tx.auditLog.create({ data: { module: "personal_documents", action, userId: r.member_id, workspaceId: r.workspace_id, status: "success",
      resourceType: "personal_document", resourceId: r.id, afterData: { revision: r.revision, action } } });
  }
  create(member: string, workspace: string, raw: unknown) {
    const dto = createDocumentDto(raw);
    return this.scope(member, workspace, DOCUMENT_PERMISSION.manage, async tx => {
      const prior = await tx.$queryRaw<Head[]>`SELECT * FROM public.personal_document WHERE workspace_id=${workspace} AND member_id=${member} AND code=${dto.code} FOR UPDATE`;
      if (prior[0]) {
        if (prior[0].deleted_at) throw new ConflictException("Personal document code conflict");
        const initial = await tx.$queryRaw<Version[]>`SELECT name,body FROM public.personal_document_version
          WHERE document_id=${prior[0].id}::uuid AND workspace_id=${workspace} AND member_id=${member} AND revision=1`;
        if (!initial[0] || initial[0].name !== dto.name || initial[0].body !== dto.body) throw new ConflictException("Personal document code conflict");
        return detail(prior[0]);
      }
      const counts = await tx.$queryRaw<{ count: bigint }[]>`SELECT count(*) AS count FROM public.personal_document WHERE workspace_id=${workspace} AND member_id=${member} AND deleted_at IS NULL`;
      if (counts[0].count >= 100n) throw new ConflictException("Personal document limit reached");
      const rows = await tx.$queryRaw<Head[]>`INSERT INTO public.personal_document (id,workspace_id,member_id,code,name,body,revision,created_at,updated_at)
        VALUES (${randomUUID()}::uuid,${workspace},${member},${dto.code},${dto.name},${dto.body},1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) RETURNING *`;
      await this.version(tx, rows[0]); await this.audit(tx, rows[0], "personal_document_created"); return detail(rows[0]);
    });
  }
  list(member: string, workspace: string, raw: unknown) {
    const page = documentPage(raw);
    return this.scope(member, workspace, DOCUMENT_PERMISSION.read, async tx => {
      const rows = await tx.$queryRaw<Summary[]>`SELECT id,code,name,revision,created_at,updated_at FROM public.personal_document
        WHERE workspace_id=${workspace} AND member_id=${member} AND deleted_at IS NULL AND id > ${page.afterId}::uuid ORDER BY id ASC LIMIT ${page.limit + 1}`;
      const items = rows.slice(0, page.limit).map(summary);
      return { items, nextCursor: rows.length > page.limit ? items[items.length - 1].id : null };
    });
  }
  get(member: string, workspace: string, id: string) {
    id = documentId(id);
    return this.scope(member, workspace, DOCUMENT_PERMISSION.read, async tx => detail(await this.owned(tx, member, workspace, id)));
  }
  update(member: string, workspace: string, id: string, raw: unknown) {
    id = documentId(id); const dto = updateDocumentDto(raw);
    return this.scope(member, workspace, DOCUMENT_PERMISSION.manage, async tx => {
      const prior = await this.owned(tx, member, workspace, id);
      if (prior.revision !== dto.expectedRevision) throw new ConflictException("Personal document revision conflict");
      if (prior.name === dto.name && prior.body === dto.body) return detail(prior);
      if (prior.revision >= 200) throw new ConflictException("Personal document history limit reached");
      const rows = await tx.$queryRaw<Head[]>`UPDATE public.personal_document SET name=${dto.name},body=${dto.body},revision=revision+1,updated_at=CURRENT_TIMESTAMP
        WHERE id=${id}::uuid AND workspace_id=${workspace} AND member_id=${member} AND revision=${dto.expectedRevision} AND deleted_at IS NULL RETURNING *`;
      if (!rows[0]) throw new ConflictException("Personal document revision conflict");
      await this.version(tx, rows[0]); await this.audit(tx, rows[0], "personal_document_saved"); return detail(rows[0]);
    });
  }
  delete(member: string, workspace: string, id: string, raw: unknown) {
    id = documentId(id); const dto = deleteDocumentDto(raw);
    return this.scope(member, workspace, DOCUMENT_PERMISSION.manage, async tx => {
      const prior = await this.owned(tx, member, workspace, id);
      if (prior.revision !== dto.expectedRevision) throw new ConflictException("Personal document revision conflict");
      // Deletion is not a save; retain immutable history and reserve code, without incrementing save revision.
      const rows = await tx.$queryRaw<Head[]>`UPDATE public.personal_document SET deleted_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
        WHERE id=${id}::uuid AND workspace_id=${workspace} AND member_id=${member} AND revision=${dto.expectedRevision} AND deleted_at IS NULL RETURNING *`;
      if (!rows[0]) throw new ConflictException("Personal document revision conflict");
      await this.audit(tx, rows[0], "personal_document_deleted"); return { id, revision: rows[0].revision, deleted: true as const };
    });
  }
  versions(member: string, workspace: string, id: string, raw: unknown) {
    id = documentId(id); const page = documentPage(raw, true);
    return this.scope(member, workspace, DOCUMENT_PERMISSION.read, async tx => {
      // Check ownership without loading the head body or any historical body on metadata paths.
      const heads = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM public.personal_document WHERE id=${id}::uuid AND workspace_id=${workspace} AND member_id=${member} AND deleted_at IS NULL FOR UPDATE`;
      if (!heads[0]) throw new NotFoundException("Personal document unavailable");
      const rows = await tx.$queryRaw<Omit<Version, "body">[]>`SELECT document_id,revision,name,created_at FROM public.personal_document_version
        WHERE document_id=${id}::uuid AND workspace_id=${workspace} AND member_id=${member} AND revision < ${page.beforeRevision} ORDER BY revision DESC LIMIT ${page.limit + 1}`;
      const items = rows.slice(0, page.limit).map(versionSummary);
      return { items, nextCursor: rows.length > page.limit ? items[items.length - 1].revision : null };
    });
  }
  getVersion(member: string, workspace: string, id: string, rawRevision: string) {
    id = documentId(id); const revision = documentRevisionParam(rawRevision);
    return this.scope(member, workspace, DOCUMENT_PERMISSION.read, async tx => {
      const heads = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM public.personal_document WHERE id=${id}::uuid AND workspace_id=${workspace} AND member_id=${member} AND deleted_at IS NULL FOR UPDATE`;
      if (!heads[0]) throw new NotFoundException("Personal document unavailable");
      const rows = await tx.$queryRaw<Version[]>`SELECT document_id,revision,name,body,created_at FROM public.personal_document_version
        WHERE document_id=${id}::uuid AND workspace_id=${workspace} AND member_id=${member} AND revision=${revision}`;
      if (!rows[0]) throw new NotFoundException("Personal document version unavailable");
      return { ...versionSummary(rows[0]), body: rows[0].body };
    });
  }
}
