import { BadRequestException } from '@nestjs/common';
import { documentObject, documentId, documentRevision, documentRevisionParam } from './personal-documents.dto';
export function createDocumentExportDto(raw: unknown) {
  const b = documentObject(raw, ['documentId', 'expectedRevision', 'format'], ['documentId', 'expectedRevision', 'format']);
  if (b.format !== 'docx' && b.format !== 'pdf') throw new BadRequestException('Invalid document export request');
  return { documentId: documentId(b.documentId), expectedRevision: documentRevision(b.expectedRevision), format: b.format } as const;
}
export function listDocumentExportsDto(raw: unknown) {
  const b = documentObject(raw, ['documentId', 'revision'], ['documentId', 'revision']);
  return { documentId: documentId(b.documentId), revision: documentRevisionParam(b.revision) };
}
