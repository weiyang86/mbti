import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PersonalDocumentsService } from '../../documents/personal-documents.service';
import { DocumentSourceRuntimePort, type DocumentGenerationScope, type DocumentSectionSelector, type SessionGate } from './ai-personal-document-run-origin.service';
/** Thin composition only: original document owner retains every permission, row lock and parser. */
@Injectable()
export class RootDocumentSourceRuntime extends DocumentSourceRuntimePort {
  constructor(private readonly documents: PersonalDocumentsService) { super(); }
  resolveInTransaction(tx: Prisma.TransactionClient, scope: DocumentGenerationScope, selector: DocumentSectionSelector, purpose: 'read' | 'execute', authorize: SessionGate) {
    return this.documents.resolveGenerationSourceInTransaction(tx, scope, selector, purpose, authorize);
  }
  inspectInTransaction(tx: Prisma.TransactionClient, scope: DocumentGenerationScope, selector: DocumentSectionSelector, authorize: SessionGate) {
    return this.documents.inspectGenerationSourceInTransaction(tx, scope, selector, authorize);
  }
}
