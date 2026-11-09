import { MbtiModule } from "./mbti/mbti.module";
import { GeneratedFileAssetsModule } from "./files/generated-file-assets.module";
import { DynamicModule, Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { loadRuntimeEnvironment } from "../../../scripts/runtime-environment.cjs";
import { DocumentsModule } from "./documents/personal-documents.module";
import { HealthController } from "./health.controller";
import { PluginRuntimeModule } from "./plugin-runtime/plugin-runtime.module";
import { PrismaModule } from "./prisma/prisma.module";
import { ReadyController } from "./ready.controller";
import { AdminUsersModule } from "./admin/admin-users.module";
import { AdminClientDirectoryModule } from "./admin-clients/admin-client-directory.module";
import { AuditQueryModule } from "./audit-log/audit-query.module";
import { ClientAuthModule } from "./client-auth/client-auth.module";
import { ClientWorkspacesModule } from "./client-workspaces/client-workspaces.module";

import { ConfigurationModule } from "./configuration/configuration.module";
import { DictionariesModule } from "./dictionaries/dictionaries.module";
import { MenusModule } from "./menus/menus.module";
import { FilesModule } from "./files/files.module";
import { ClientFilesModule } from "./files/client-files.module";
import { AdminFilesModule } from "./files/admin-files.module";
import { AsyncRuntimeModule } from "./async-runtime/async-runtime.module";
import { PluginCatalog } from "./plugin-runtime/plugin-catalog";
import { PluginManagementModule } from "./plugin-runtime/plugin-management.module";
import { IntegrationCenterModule } from "./integration-center/integration-center.module";
import { KnowledgeWebImportModule } from "./plugins/aij-ai/knowledge-web-import.module";
import type { KnowledgeWebImportTransport } from "./plugins/aij-ai/knowledge-web-import";

@Module({})
export class AppModule {
  static forRoot(runtimeOverride?: ReturnType<typeof loadRuntimeEnvironment>, pluginCatalogOverride?: PluginCatalog, testKnowledgeWebImportTransport?: KnowledgeWebImportTransport): DynamicModule {
    const runtime = runtimeOverride ?? loadRuntimeEnvironment();
    if (pluginCatalogOverride && (runtime.nodeEnv !== "test" || runtime.environment !== "test")) {
      throw new Error("Plugin catalog overrides are available only to isolated test applications");
    }
    if (testKnowledgeWebImportTransport !== undefined && (!runtime.enabledPlugins.includes("aij-ai") || runtime.nodeEnv !== "test" || runtime.environment !== "test")) {
      throw new Error("Knowledge web transport overrides require an isolated test AI application");
    }
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: [() => runtime] }),
        ...(runtime.enabledPlugins.includes("aij-ai") ? [KnowledgeWebImportModule.forRoot(runtime, testKnowledgeWebImportTransport)] : []),
        PluginRuntimeModule.forRoot(runtime.enabledPlugins), PrismaModule,
        ...(runtime.projectId === "mbti-foundation" && runtime.capabilities.database ? [MbtiModule] : []),
        ...(runtime.capabilities.database && runtime.capabilities.storage ? [GeneratedFileAssetsModule] : []),
        ...(runtime.capabilities.auth ? [AdminUsersModule, MenusModule, DictionariesModule, ConfigurationModule, AuditQueryModule, ...(runtime.capabilities.storage ? [AdminFilesModule] : [])] : []),
        ...(runtime.capabilities.auth && runtime.capabilities.clientAuth ? [AdminClientDirectoryModule] : []),
        ...(runtime.capabilities.clientAuth && runtime.capabilities.storage ? [ClientFilesModule] : []),
        ...(runtime.capabilities.clientAuth && !runtime.capabilities.storage ? [ClientAuthModule] : []),
        ...(runtime.capabilities.clientAuth ? [ClientWorkspacesModule] : []),
        ...(runtime.capabilities.clientAuth && runtime.enabledPlugins.includes("aij-ai") ? [DocumentsModule] : []),
        ...(runtime.capabilities.auth && runtime.capabilities.database ? [AsyncRuntimeModule] : []),
        ...(runtime.capabilities.auth && runtime.capabilities.database ? [PluginManagementModule.forRoot(pluginCatalogOverride), IntegrationCenterModule] : []),
        ...(runtime.capabilities.storage && !runtime.capabilities.clientAuth && !runtime.capabilities.auth ? [FilesModule] : [])
      ],
      controllers: [HealthController, ReadyController]
    };
  }
}
