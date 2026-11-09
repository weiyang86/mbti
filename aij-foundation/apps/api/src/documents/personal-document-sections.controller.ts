import { Controller, ForbiddenException, Get, Header, Param, Query, Req, UseGuards } from "@nestjs/common";
import type { ClientRequest } from "../client-auth/client-auth.security";
import { RequireClientWorkspacePermissions } from "../client-workspaces/client-workspace-permission.decorator";
import { WorkspaceContextGuard } from "../client-workspaces/workspace-context.guard";
import { PersonalDocumentNoStoreGuard } from "./personal-documents.controller";
import { DOCUMENT_PERMISSION } from "./personal-documents.service";
import { PersonalDocumentSectionsService } from "./personal-document-sections.service";

@Controller("client/documents/:id/sections")
@UseGuards(PersonalDocumentNoStoreGuard, WorkspaceContextGuard)
export class PersonalDocumentSectionsController {
  constructor(private readonly sections: PersonalDocumentSectionsService) {}

  @Get()
  @RequireClientWorkspacePermissions(DOCUMENT_PERMISSION.read)
  @Header("Cache-Control", "private, no-store")
  get(@Req() request: ClientRequest, @Param("id") id: string, @Query() query: unknown) {
    if (!request.client?.id || !request.workspaceContext?.workspaceId) throw new ForbiddenException("Workspace access denied");
    return this.sections.get(request.client.id, request.workspaceContext.workspaceId, id, query);
  }
}
