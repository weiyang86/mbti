import { BadRequestException, ConflictException, Inject, Injectable } from "@nestjs/common";
import { documentObject, documentRevisionParam } from "./personal-documents.dto";
import { PersonalDocumentsService } from "./personal-documents.service";
import { buildPersonalDocumentSectionIndex } from "./personal-document-sections";

@Injectable()
export class PersonalDocumentSectionsService {
  constructor(@Inject(PersonalDocumentsService) private readonly documents: Pick<PersonalDocumentsService, "get">) {}

  async get(member: string, workspace: string, id: string, query: unknown) {
    const parameters = documentObject(query, ["expectedRevision"], ["expectedRevision"]);
    const expectedRevision = documentRevisionParam(parameters.expectedRevision);
    if (parameters.expectedRevision !== String(expectedRevision)) throw new BadRequestException("Invalid personal document request");
    // The existing owner validates the id, membership, permission, capability and current ownership.
    const document = await this.documents.get(member, workspace, id);
    if (document.revision !== expectedRevision) throw new ConflictException("Personal document revision conflict");
    return buildPersonalDocumentSectionIndex({ id: document.id, revision: document.revision, body: document.body });
  }
}
