import { DocumentExportExecutor } from './document-export-executor';
/** Root supplies a trusted immutable value after strict runtime config validation. Default is off. */
export class DocumentExportProfile {
  readonly rendererVersion = 'aij-plain-document-v1';
  constructor(readonly executor: DocumentExportExecutor = new DocumentExportExecutor(), readonly configured = false) {
    Object.freeze(this);
  }
}
export const DOCUMENT_EXPORT_FILES = Symbol('DOCUMENT_EXPORT_FILES');
export const DOCUMENT_EXPORT_PERMISSION = 'workspace.documents.export';
export const DOCUMENT_EXPORT_MIME = { docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', pdf: 'application/pdf' } as const;
