import { AiPersonalDocumentGenerationController, DocumentGenerationNoStoreGuard } from './ai-personal-document-generation.controller';
import { AiPersonalDocumentGenerationService, DocumentGenerationRunDriver } from './ai-personal-document-generation.service';
import { DocumentsModule } from '../../documents/personal-documents.module';
import { RootDocumentSourceRuntime } from './ai-personal-document-source-runtime.service';
import { AiPersonalDocumentRunOriginService, PersonalDocumentRunOriginPort, DocumentSourceRuntimePort, DocumentGenerationSessionPort } from './ai-personal-document-run-origin.service';
import { AiKnowledgeCitationsController, KnowledgeCitationPort } from "./ai-knowledge-citations.controller";
import { AiPersonalScriptSkillService } from "./ai-personal-script-skill.service";
import { AiPersonalScriptExecutionController, ScriptExecutionAssetsPort, ScriptExecutionRunsPort, ScriptExecutionPrivateGuard } from './ai-personal-script-execution.controller';
import { AiPersonalScriptRunsService, ScriptSkillRuntimePort, ScriptExecutionAuthPort, ScriptRunAccessPort, ScriptRuntimeConfiguration, ScriptGeneratedFilesPort } from './ai-personal-script-runs.service';
import { AiPersonalScriptExecutionService, ScriptSandboxConfiguration } from './ai-personal-script-execution.service';
import { RootScriptRunAccess } from './ai-personal-script-run-access.service';
import { GeneratedFileAssetsModule } from '../../files/generated-file-assets.module';
import { GeneratedFileAssetsService } from '../../files/generated-file-assets.service';
import { PersonalScriptSkillAccess } from "./ai-personal-script-skill-contract";
import { AiPersonalWorkflowsController, PersonalWorkflowNoStoreGuard } from "./ai-personal-workflows.controller";
import { AiPersonalAgentPublicationsController } from './ai-personal-agent-publications.controller';
import { AiPersonalAgentPublicationsService, PersonalAgentPublicationValidator } from './ai-personal-agent-publications.service';
import { RootPersonalAgentPublicationValidator } from './ai-personal-agent-publication-validator.service';
import { AiPersonalWorkflowsService } from "./ai-personal-workflows.service";
import { AiPersonalWorkflowPublicationService, PersonalWorkflowPublicationAccess } from './ai-personal-workflow-publication.service';
import { RootWorkflowPublicationAccess } from './ai-personal-workflow-publication-access.service';
import { AiPersonalWorkflowRunOriginService, PersonalWorkflowRunOriginPort, WorkflowPublicationRuntimePort, WorkflowSessionPort } from './ai-personal-workflow-run-origin.service';
import { AiPersonalWorkflowRunsService, WorkflowRunDriver, WorkflowRunReadAccess } from './ai-personal-workflow-runs.service';
import { RootWorkflowRunReadAccess } from './ai-personal-workflow-run-access.service';
import { ClientAuthService } from '../../client-auth/client-auth.service';
import { AiPersonalWorkflowExecutionController, WorkflowExecutionPrivateGuard, WorkflowExecutionPublicationsPort, WorkflowExecutionRunsPort } from './ai-personal-workflow-execution.controller';
import { AiPersonalAgentMemoryContextService } from "./ai-personal-agent-memory-context.service";
import { AiPersonalAgentRunPreviewsController, PersonalAgentRunPreviewNoStoreGuard } from "./ai-personal-agent-run-previews.controller";
import { AiPersonalAgentRunPreviewsService } from "./ai-personal-agent-run-previews.service";
import { AiPersonalMemoriesController, PersonalMemoryNoStoreGuard } from "./ai-personal-memories.controller";
import { AiPersonalMemoriesService } from "./ai-personal-memories.service";
import { AiPersonalAgentRunsController, PersonalAgentRunNoStoreGuard } from "./ai-personal-agent-runs.controller";
import { AiPersonalAgentRunsService } from "./ai-personal-agent-runs.service";
import { AiPersonalAgentSnapshotsService } from "./ai-personal-agent-snapshots.service";
import { AiPersonalAgentsController, PersonalAgentNoStoreGuard } from "./ai-personal-agents.controller";
import { AiPersonalAgentsService } from "./ai-personal-agents.service";
import { AiPersonalSkillsService } from "./ai-personal-skills.service";
import { AiPersonalSkillsController } from "./ai-personal-skills.controller";
import { AiCenterUsageService } from "./ai-center-usage.service";
import { AiCenterUsageController } from "./ai-center-usage.controller";
import { FilesModule } from "../../files/files.module";
import { AiCenterBudgetService } from "./ai-center-budget.service";
import { AiCenterHttpTransport, AiCenterProviderService } from "./ai-center-provider";
import { AiCenterRunService, AI_SCRIPT_RETENTION } from "./ai-center-run.service";
import { AiCenterClientController } from "./ai-center-client.controller";
import { AiCenterAdminController } from "./ai-center-admin.controller";
import { AiCenterConfigurationService } from "./ai-center-configuration.service";
import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AsyncRuntimeModule } from "../../async-runtime/async-runtime.module";
import { PluginRuntimeAccessModule } from "../../plugin-runtime/plugin-runtime-access.module";
import { SecretCenterModule } from "../../secret-center/secret-center.module";
import { RbacModule } from "../../rbac/rbac.module";
import { ClientAuthModule } from "../../client-auth/client-auth.module";
import { ClientWorkspacesModule } from "../../client-workspaces/client-workspaces.module";
import { AiKnowledgeController } from "./ai-knowledge.controller";
import { AiKnowledgeService } from "./ai-knowledge.service";
import { AiTraceQueryController } from "./ai-trace-query.controller";
import { AiTraceQueryService } from "./ai-trace-query.service";
import { AiModelExecutionService } from "./ai-execution.service";
import { AiExecutionTraceService } from "./ai-execution-trace.service";
import { ScopedAiCapabilityPolicy, ScopedAiProviderConfiguration } from "./ai-configuration";
import {
  AiBudgetAdmissionPort,
  AiCapabilityPolicyPort,
  AiProviderConfigurationPort,
  AiProviderRegistry
} from "./ai-provider";
import { AiEvaluationService } from "./ai-evaluation.service";
import { AiEvaluationBudgetService } from "./ai-evaluation-budget.service";
import { DeepSeekProvider, deepSeekLiveEnabled } from "./deepseek-provider";
import { OfflineKnowledgeTestBudgetAdmission, OfflineKnowledgeTestProvider, offlineKnowledgeTestMode } from "./offline-test-ai-provider";

@Module({
  imports: [DocumentsModule, FilesModule, GeneratedFileAssetsModule, AsyncRuntimeModule, PluginRuntimeAccessModule, SecretCenterModule, RbacModule, ClientAuthModule, ClientWorkspacesModule],
  controllers: [AiPersonalDocumentGenerationController, AiKnowledgeCitationsController, AiPersonalScriptExecutionController, AiPersonalWorkflowExecutionController, AiPersonalAgentPublicationsController, AiPersonalWorkflowsController, AiPersonalAgentRunPreviewsController, AiPersonalMemoriesController, AiPersonalAgentRunsController, AiPersonalAgentsController, AiPersonalSkillsController, AiCenterUsageController, AiCenterClientController, AiCenterAdminController, AiTraceQueryController, AiKnowledgeController],
  providers: [
    AiPersonalDocumentGenerationService, DocumentGenerationNoStoreGuard,
    { provide: DocumentGenerationRunDriver, useExisting: AiCenterRunService },
    AiPersonalDocumentRunOriginService,
    { provide: PersonalDocumentRunOriginPort, useExisting: AiPersonalDocumentRunOriginService },
    { provide: DocumentSourceRuntimePort, useClass: RootDocumentSourceRuntime },
    { provide: DocumentGenerationSessionPort, useExisting: ClientAuthService },
    AiPersonalScriptSkillService,
    ScriptExecutionPrivateGuard,
    { provide: ScriptExecutionAssetsPort, useExisting: AiPersonalScriptSkillService },
    { provide: ScriptExecutionRunsPort, useExisting: AiPersonalScriptRunsService },
    AiPersonalScriptRunsService, AiPersonalScriptExecutionService, ScriptSandboxConfiguration,
    { provide: ScriptSkillRuntimePort, useExisting: AiPersonalScriptSkillService },
    { provide: ScriptExecutionAuthPort, useExisting: ClientAuthService },
    { provide: ScriptRunAccessPort, useClass: RootScriptRunAccess },
    { provide: ScriptRuntimeConfiguration, useExisting: ScriptSandboxConfiguration },
    { provide: ScriptGeneratedFilesPort, useExisting: GeneratedFileAssetsService },
    { provide: AI_SCRIPT_RETENTION, useExisting: AiPersonalScriptExecutionService },
    { provide: PersonalScriptSkillAccess, useExisting: AiPersonalSkillsService },
    AiPersonalWorkflowPublicationService,
    WorkflowExecutionPrivateGuard,
    { provide: WorkflowExecutionPublicationsPort, useExisting: AiPersonalWorkflowPublicationService },
    { provide: WorkflowExecutionRunsPort, useExisting: AiPersonalWorkflowRunsService },
    AiPersonalWorkflowRunOriginService, AiPersonalWorkflowRunsService,
    { provide: PersonalWorkflowRunOriginPort, useExisting: AiPersonalWorkflowRunOriginService },
    { provide: WorkflowPublicationRuntimePort, useExisting: AiPersonalWorkflowPublicationService },
    { provide: WorkflowSessionPort, useExisting: ClientAuthService },
    { provide: WorkflowRunDriver, useExisting: AiCenterRunService },
    { provide: WorkflowRunReadAccess, useClass: RootWorkflowRunReadAccess },
    { provide: PersonalWorkflowPublicationAccess, useClass: RootWorkflowPublicationAccess },
    AiPersonalAgentPublicationsService,
    { provide: PersonalAgentPublicationValidator, useClass: RootPersonalAgentPublicationValidator },
    AiPersonalWorkflowsService, PersonalWorkflowNoStoreGuard,
    AiPersonalAgentMemoryContextService, AiPersonalAgentRunPreviewsService, PersonalAgentRunPreviewNoStoreGuard, AiPersonalMemoriesService, PersonalMemoryNoStoreGuard, AiPersonalAgentRunsService, PersonalAgentRunNoStoreGuard, AiPersonalAgentSnapshotsService, AiPersonalAgentsService, PersonalAgentNoStoreGuard, AiPersonalSkillsService,
    AiCenterConfigurationService, AiCenterUsageService, AiCenterBudgetService, AiCenterHttpTransport, AiCenterProviderService, AiCenterRunService,
    AiModelExecutionService,
    AiEvaluationBudgetService,
    AiEvaluationService,
    AiKnowledgeService,
    { provide: KnowledgeCitationPort, useExisting: AiKnowledgeService },
    AiExecutionTraceService,
    AiTraceQueryService,
    { provide: AiProviderRegistry, useFactory: (config: ConfigService, budget: AiEvaluationBudgetService) => new AiProviderRegistry(
      offlineKnowledgeTestMode(config) ? [new OfflineKnowledgeTestProvider()] : deepSeekLiveEnabled(config) ? [new DeepSeekProvider(config, budget)] : []
    ), inject: [ConfigService, AiEvaluationBudgetService] },
    { provide: AiProviderConfigurationPort, useClass: ScopedAiProviderConfiguration },
    { provide: AiCapabilityPolicyPort, useClass: ScopedAiCapabilityPolicy },
    { provide: AiBudgetAdmissionPort, useFactory: (config: ConfigService, budget: AiEvaluationBudgetService) => offlineKnowledgeTestMode(config)
      ? new OfflineKnowledgeTestBudgetAdmission() : budget, inject: [ConfigService, AiEvaluationBudgetService] }
  ],
  exports: [AiCenterRunService, AiModelExecutionService, AiKnowledgeService, AiProviderRegistry, AiProviderConfigurationPort, AiCapabilityPolicyPort, AiBudgetAdmissionPort]
})
export class AiRuntimeModule {}
