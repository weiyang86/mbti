import { BadRequestException, ConflictException, ForbiddenException, HttpException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { WorkspaceContextService } from '../../client-workspaces/workspace-context.service';
import { CLIENT_WORKSPACE_PERMISSION as P } from '../../client-workspaces/client-workspace-permissions';
import { PluginRuntimeAccessService } from '../../plugin-runtime/plugin-runtime-access.service';
import { SecretRefPort } from '../../secret-center/secret-ref';
import { AiCenterConfigurationService } from './ai-center-configuration.service';
import { AI_CENTER_CONFIG_KEY } from './ai-center-policy';
import { AiCenterBudgetService } from './ai-center-budget.service';
import { AiPersonalAgentSnapshotsService } from './ai-personal-agent-snapshots.service';
import { personalAgentPreviewId, personalAgentRunPreviewQuery } from './ai-personal-agent-run-previews.dto';

/** Advisory read only: no executor, input compilation, reservation, reconciliation or ledger. */
@Injectable()
export class AiPersonalAgentRunPreviewsService {
  constructor(private readonly prisma: PrismaService, private readonly workspaces: WorkspaceContextService,
    private readonly plugins: PluginRuntimeAccessService, private readonly configuration: AiCenterConfigurationService,
    private readonly snapshots: AiPersonalAgentSnapshotsService, private readonly budget: AiCenterBudgetService,
    private readonly secrets: SecretRefPort, private readonly config: ConfigService) {}

  async preview(member: string, workspace: string, rawId: unknown, rawQuery: unknown) {
    const id = personalAgentPreviewId(rawId), { expectedRevision } = personalAgentRunPreviewQuery(rawQuery);
    try {
      return await this.prisma.$transaction(async tx => {
        const project = await this.plugins.projectId(tx);
        await this.plugins.assertEnabledInTransaction(tx, project, 'aij-ai');
        const projects = await tx.$queryRaw<{ id: string }[]>`
          SELECT p.id FROM public.project_profile p JOIN public.organization_profile o ON o.id=p.organization_id
          WHERE p.id=${project} AND p.status='active' AND p.deleted_at IS NULL
            AND o.status='active' AND o.deleted_at IS NULL FOR SHARE OF p,o`;
        const installations = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM public.plugin_installation WHERE project_id=${project} AND plugin_code='aij-ai' AND status='enabled' FOR SHARE`;
        if (!projects.length || !installations.length) throw new NotFoundException('Plugin capability unavailable');
        // Same membership/grant fence as private asset writes, with both required grants.
        await this.workspaces.assertWritePermissionInTransaction(tx, member, workspace, P.aiExecute);
        await this.workspaces.assertWritePermissionInTransaction(tx, member, workspace, P.aiAssetsRead);
        await tx.$queryRaw`SELECT id FROM public.scoped_config WHERE scope='project' AND scope_id=${project}
          AND plugin_code='aij-ai' AND config_key=${AI_CENTER_CONFIG_KEY} FOR SHARE`;
        let current: Awaited<ReturnType<AiCenterConfigurationService['current']>>;
        try { current = await this.configuration.current(tx); }
        catch (error) {
          if (error instanceof BadRequestException || error instanceof SyntaxError)
            throw new ConflictException('Personal Agent model configuration unavailable');
          throw error;
        }
        let s: Awaited<ReturnType<AiPersonalAgentSnapshotsService['resolve']>>;
        try { s = await this.snapshots.resolve(tx, current, member, workspace, id, expectedRevision); }
        catch (error) {
          if (error instanceof BadRequestException) throw new ConflictException('Personal Agent configuration unavailable');
          throw error;
        }
        // The resolver's execution code is personal:<UUID>; expose the authored asset code instead.
        const rows = await tx.$queryRaw<{ code: string }[]>`SELECT code FROM public.ai_personal_agent
          WHERE id=${id} AND workspace_id=${workspace} AND member_id=${member} AND deleted_at IS NULL FOR SHARE`;
        if (!rows[0]) throw new NotFoundException('Personal Agent unavailable');
        const deepseek = s.provider.vendor === 'deepseek' || new URL(s.provider.baseUrl).hostname === 'api.deepseek.com';
        const flags = this.config.get<string>('AI_CENTER_CLIENT_EXECUTION_ENABLED') === 'true' &&
          this.config.get<string>('AI_CENTER_LIVE_ENABLED') === 'true' && s.provider.liveEnabled &&
          (!deepseek || (this.config.get<string>('AI_DEEPSEEK_UPSTREAM_CONFIRMED') === 'true' &&
            this.config.get<string>('AI_DEEPSEEK_LIVE_ENABLED') === 'true' &&
            this.config.get<string>('AI_DEEPSEEK_DATA_CLASS') === 'synthetic-or-deidentified'));
        // current() validates approved HTTPS bases and vendor model protocol. Metadata existence
        // is the sole secret port used here; no resolution, decryption, probe or transport.
        let configured: boolean;
        try { configured = await this.secrets.configuredTrusted(tx, s.provider.credentialRef); }
        catch (error) {
          if (error instanceof ForbiddenException || error instanceof BadRequestException)
            throw new ConflictException('Personal Agent model configuration unavailable');
          throw error;
        }
        const modelExecutionConfigured = flags && configured;
        return {
          personalAgentId: id, code: rows[0].code, name: s.agent.name, revision: s.agent.revision,
          inputFields: [...s.agent.inputFields], outputFormat: s.agent.outputFormat, outputFields: [...s.agent.outputFields],
          capability: 'text' as const, modelCode: s.model.code, modelRevision: s.model.revision, catalogVersion: current.version,
          maximumEstimatedCostNanos: this.budget.estimate(s.model).toString(), modelExecutionConfigured
        };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 5000, timeout: 10000 });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException('Personal Agent preview unavailable');
    }
  }
}
