import { ConfigService } from "@nestjs/config";
import type { RuntimeEnvironment } from "../../../../scripts/runtime-environment.cjs";
import { GeneratedFileAssetsModule } from "../files/generated-file-assets.module";
import { GeneratedFileAssetsService } from "../files/generated-file-assets.service";
import { DocumentExportExecutor } from "./document-export-executor";
import { DOCUMENT_EXPORT_FILES, DocumentExportProfile } from "./document-export-profile";
import { PersonalDocumentExportsService } from "./personal-document-exports.service";
import { PersonalDocumentExportsController, DocumentExportNoStoreGuard } from "./personal-document-exports.controller";
import { Module } from "@nestjs/common";
import { ClientAuthModule } from "../client-auth/client-auth.module";
import { ClientWorkspacesModule } from "../client-workspaces/client-workspaces.module";
import { PluginRuntimeAccessModule } from "../plugin-runtime/plugin-runtime-access.module";
import { PersonalDocumentsController, PersonalDocumentNoStoreGuard } from "./personal-documents.controller";
import { PersonalDocumentsService } from "./personal-documents.service";
import { PersonalDocumentSectionsController } from "./personal-document-sections.controller";
import { PersonalDocumentSectionsService } from "./personal-document-sections.service";

@Module({ exports: [PersonalDocumentsService], imports: [ClientAuthModule, ClientWorkspacesModule, PluginRuntimeAccessModule, GeneratedFileAssetsModule], controllers: [PersonalDocumentsController, PersonalDocumentExportsController, PersonalDocumentSectionsController],
  providers: [PersonalDocumentsService, PersonalDocumentSectionsService, PersonalDocumentNoStoreGuard, PersonalDocumentExportsService, DocumentExportNoStoreGuard,
    { provide: DOCUMENT_EXPORT_FILES, useExisting: GeneratedFileAssetsService },
    { provide: DocumentExportProfile, inject: [ConfigService], useFactory: (config: ConfigService) => {
      const profile = config.get<RuntimeEnvironment["documentExport"]>("documentExport");
      return profile?.enabled
        ? new DocumentExportProfile(new DocumentExportExecutor({ enabled: true, dockerCliPath: profile.dockerCliPath, approvedImage: profile.approvedImage }), true)
        : new DocumentExportProfile();
    } }] })
export class DocumentsModule {}
