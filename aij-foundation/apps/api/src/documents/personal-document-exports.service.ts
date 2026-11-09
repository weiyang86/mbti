import { HttpException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { PersonalDocumentsService } from './personal-documents.service';
import { documentId } from './personal-documents.dto';
import { createDocumentExportDto, listDocumentExportsDto } from './personal-document-exports.dto';
import { DOCUMENT_EXPORT_FILES, DocumentExportProfile } from './document-export-profile';

type Scope = { projectId: string; workspaceId: string; memberId: string; pluginCode: 'aij-ai' };
type Content = { bytes: Buffer; mimeType: string; originalName: string; size: number; checksum: string };
/** Structural fixed AF201 port; root aliases the existing generated-file owner to this token. */
export interface DocumentExportFiles {
  stage(scope: Scope, spec: { format: 'docx' | 'pdf'; mimeType: string; bytes: Buffer; checksum: string; originalName: string; downloadUrl: string }): Promise<{ assetId: string }>;
  commitInTransaction(tx: Prisma.TransactionClient, ticket: { assetId: string }): Promise<unknown>;
  confirm(ticket: { assetId: string }): Promise<void>;
  discard(ticket: { assetId: string }): Promise<{ removed: boolean; retainedBecauseCommitted: boolean }>;
  readInTransaction(tx: Prisma.TransactionClient, assetId: string, scope: Scope): Promise<Content>;
}
type Row = { id: string; document_id: string; workspace_id: string; member_id: string; project_id: string; revision: number; file_asset_id: string; format: 'docx' | 'pdf'; renderer_version: string; page_count: number | null; created_at: Date };
const unavailable = () => new ServiceUnavailableException('Document export unavailable');
@Injectable()
export class PersonalDocumentExportsService {
  constructor(private readonly prisma: PrismaService, private readonly documents: PersonalDocumentsService,
    @Inject(DOCUMENT_EXPORT_FILES) private readonly files: DocumentExportFiles, private readonly profile: DocumentExportProfile) {}
  capability(member: string, workspace: string) { return this.documents.exportCapability(member, workspace, this.profile.configured); }
  private scope(member: string, workspace: string, project: string): Scope { return { memberId: member, workspaceId: workspace, projectId: project, pluginCode: 'aij-ai' }; }
  private async content(tx: Prisma.TransactionClient, row: Row, scope: Scope) {
    if (row.project_id !== scope.projectId || row.workspace_id !== scope.workspaceId || row.member_id !== scope.memberId) throw new NotFoundException('Document export unavailable');
    return this.files.readInTransaction(tx, row.file_asset_id, scope);
  }
  private meta(row: Row, c: Content) {
    return { id: row.id, documentId: row.document_id, revision: row.revision, format: row.format, mimeType: c.mimeType,
      size: c.size, checksum: c.checksum, rendererVersion: row.renderer_version, pageCount: row.page_count, createdAt: row.created_at.toISOString() };
  }
  private async tuple(tx: Prisma.TransactionClient, id: string, revision: number, format: string) {
    const rows = await tx.$queryRaw<Row[]>`SELECT * FROM public.personal_document_export WHERE document_id=${id}::uuid AND revision=${revision} AND format=${format} AND renderer_version=${this.profile.rendererVersion}`;
    return rows[0];
  }
  /** authorize is a trusted server-only session fence, never sourced from the request DTO. */
  async create(member: string, workspace: string, raw: unknown, signal?: AbortSignal, authorize?: (tx: Prisma.TransactionClient) => Promise<void>) {
    const dto = createDocumentExportDto(raw);
    const snapshot = await this.documents.withCurrentDocument(member, workspace, dto.documentId, dto.expectedRevision, async (tx, d, project) => {
      await authorize?.(tx);
      if (!this.profile.configured) throw unavailable();
      const scope = this.scope(member, workspace, project), existing = await this.tuple(tx, d.id, d.revision, dto.format);
      return { scope, name: d.name, body: d.body, existing: existing ? this.meta(existing, await this.content(tx, existing, scope)) : undefined };
    });
    if (snapshot.existing) return snapshot.existing;
    if (signal?.aborted) throw unavailable();
    const id = randomUUID();
    const rendered = await this.profile.executor.run({ input: { name: snapshot.name, body: snapshot.body, format: dto.format }, timeoutMs: 15000, signal });
    const a = rendered.artifact;
    let ticket: { assetId: string } | undefined;
    try {
      if (rendered.outcome !== 'SUCCESS' || !rendered.cleanupConfirmed || !a || signal?.aborted) throw unavailable();
      ticket = await this.files.stage(snapshot.scope, { format: dto.format, mimeType: a.mimeType, bytes: a.bytes, checksum: a.sha256,
        originalName: `document-${dto.documentId}-r${dto.expectedRevision}.${dto.format}`, downloadUrl: `/api/client/document-exports/${id}/content` });
      const ownedTicket = ticket;
      const result = await this.documents.withCurrentDocument(member, workspace, dto.documentId, dto.expectedRevision, async (tx, d, project) => {
        await authorize?.(tx);
        if (signal?.aborted || project !== snapshot.scope.projectId) throw unavailable();
        const existing = await this.tuple(tx, d.id, d.revision, dto.format);
        if (existing) return { reused: true, meta: this.meta(existing, await this.content(tx, existing, snapshot.scope)) };
        await this.files.commitInTransaction(tx, ownedTicket);
        const rows = await tx.$queryRaw<Row[]>`INSERT INTO public.personal_document_export
          (id,document_id,workspace_id,member_id,project_id,revision,file_asset_id,format,renderer_version,page_count,created_at)
          VALUES (${id}::uuid,${d.id}::uuid,${workspace},${member},${project},${d.revision},${ownedTicket.assetId},${dto.format},${a.rendererVersion},${a.pageCount},CURRENT_TIMESTAMP) RETURNING *`;
        await tx.auditLog.create({ data: { module: 'personal_documents', action: 'personal_document_exported', userId: member, workspaceId: workspace,
          status: 'success', resourceType: 'personal_document_export', resourceId: id, afterData: { documentId: d.id, revision: d.revision, format: dto.format } } });
        return { reused: false, meta: this.meta(rows[0], await this.content(tx, rows[0], snapshot.scope)) };
      });
      if (result.reused) await this.files.discard(ownedTicket); else await this.files.confirm(ownedTicket);
      return result.meta;
    } catch (error) {
      let failure = error;
      if (ticket) {
        // Exact read-back, never retry POST or delete on an unknown database result.
        try {
          const recovered = await this.documents.withCurrentDocument(member, workspace, dto.documentId, undefined, async (tx, _d, project) => {
            await authorize?.(tx);
            const r = await this.tuple(tx, dto.documentId, dto.expectedRevision, dto.format);
            if (!r || r.id !== id || r.file_asset_id !== ticket!.assetId) return undefined;
            return this.meta(r, await this.content(tx, r, this.scope(member, workspace, project)));
          });
          if (recovered) { await this.files.confirm(ticket); return recovered; }
        } catch (recoveryError) {
          // Never release committed metadata after session revocation; preserve the auth owner's 401.
          if (recoveryError instanceof HttpException && recoveryError.getStatus() === 401) failure = recoveryError;
          // Unknown or revoked access: owner discard performs its own committed check.
        }
        try { await this.files.discard(ticket); } catch {
          if (failure instanceof HttpException && failure.getStatus() === 401) throw failure;
          throw unavailable();
        }
      }
      if (failure instanceof HttpException) throw failure;
      throw unavailable();
    } finally {
      // Only the executor-owned RAM buffer; staged/persisted bytes belong to the file owner.
      if (Buffer.isBuffer(a?.bytes)) a.bytes.fill(0);
    }
  }
  list(member: string, workspace: string, raw: unknown) {
    const dto = listDocumentExportsDto(raw);
    return this.documents.withCurrentDocument(member, workspace, dto.documentId, undefined, async (tx, _d, project) => {
      const rows = await tx.$queryRaw<Row[]>`SELECT * FROM public.personal_document_export WHERE document_id=${dto.documentId}::uuid AND revision=${dto.revision} AND renderer_version=${this.profile.rendererVersion} ORDER BY format LIMIT 2`;
      const items = [];
      for (const row of rows) items.push(this.meta(row, await this.content(tx, row, this.scope(member, workspace, project))));
      return { items };
    });
  }
  async get(member: string, workspace: string, rawId: string, binary = false) {
    const id = documentId(rawId);
    // Locator only. All returned data is fetched again under the current document fence.
    let locator: { document_id: string }[];
    try { locator = await this.prisma.$queryRaw<{ document_id: string }[]>`SELECT document_id FROM public.personal_document_export WHERE id=${id}::uuid AND workspace_id=${workspace} AND member_id=${member}`; }
    catch { throw unavailable(); }
    if (!locator[0]) throw new NotFoundException('Document export unavailable');
    return this.documents.withCurrentDocument(member, workspace, locator[0].document_id, undefined, async (tx, _d, project) => {
      const rows = await tx.$queryRaw<Row[]>`SELECT * FROM public.personal_document_export WHERE id=${id}::uuid AND document_id=${locator[0].document_id}::uuid AND workspace_id=${workspace} AND member_id=${member}`;
      if (!rows[0]) throw new NotFoundException('Document export unavailable');
      const c = await this.content(tx, rows[0], this.scope(member, workspace, project));
      return { meta: this.meta(rows[0], c), ...(binary ? { content: c } : {}) };
    });
  }
}
