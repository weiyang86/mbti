import { ConflictException, HttpException, Injectable, NotFoundException, Optional, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { WorkspaceContextService } from '../../client-workspaces/workspace-context.service';
import { CLIENT_WORKSPACE_PERMISSION as P } from '../../client-workspaces/client-workspace-permissions';
import { PluginRuntimeAccessService } from '../../plugin-runtime/plugin-runtime-access.service';
import { AI_CENTER_CONFIG_KEY } from './ai-center-policy';
import { personalAgentPublicationId, personalAgentPublicationMutation } from './ai-personal-agent-publications.dto';

export type PublicationReadiness = Readonly<{ ready: boolean; reason: 'ready' | 'disabled' | 'dependencies_unavailable' | 'validator_unavailable' }>;
export type PublicationValidationScope = Readonly<{ projectId: string; memberId: string; workspaceId: string; agentId: string; revision: number }>;
/** INTERNAL DI port. Root implements with the original resolver's common validation helper.
 * Validate current immutable head, model/catalog and owned active Skill pins under this tx.
 * No publication prerequisite here, no credential lookup, no caller snapshot, no execution. */
export abstract class PersonalAgentPublicationValidator {
  abstract validate(tx: Prisma.TransactionClient, scope: PublicationValidationScope): Promise<void>;
}
type Head = { id: string; revision: number; enabled: boolean; published_revision: number | null; publication_version: number };
export type PersonalAgentPublicationMetadata = Readonly<{ agentId: string; revision: number; publishedRevision: number | null;
  publicationVersion: number; published: boolean; dependencyReadiness: PublicationReadiness }>;

@Injectable()
export class AiPersonalAgentPublicationsService {
  constructor(private readonly prisma: PrismaService, private readonly workspaces: WorkspaceContextService,
    private readonly plugins: PluginRuntimeAccessService, @Optional() private readonly validator?: PersonalAgentPublicationValidator) {}

  private async scope<T>(member: string, workspace: string, permission: string,
    operation: (tx: Prisma.TransactionClient, project: string) => Promise<T>): Promise<T> {
    try {
      return await this.prisma.$transaction(async tx => {
        const project = await this.plugins.projectId(tx);
        await this.plugins.assertEnabledInTransaction(tx, project, 'aij-ai');
        const projects = await tx.$queryRaw<{ id: string }[]>`SELECT p.id FROM public.project_profile p
          JOIN public.organization_profile o ON o.id=p.organization_id WHERE p.id=${project}
          AND p.status='active' AND p.deleted_at IS NULL AND o.status='active' AND o.deleted_at IS NULL FOR SHARE OF p,o`;
        const installations = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM public.plugin_installation
          WHERE project_id=${project} AND plugin_code='aij-ai' AND status='enabled' FOR SHARE`;
        if (!projects.length || !installations.length) throw new NotFoundException('Plugin capability unavailable');
        await this.workspaces.assertWritePermissionInTransaction(tx, member, workspace, permission);
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'ai-personal-agents:' + workspace + ':' + member},0))`;
        // Same catalog row lock as authoring/resolution. Root must preserve compatible lock order.
        await tx.$queryRaw`SELECT id FROM public.scoped_config WHERE scope='project' AND scope_id=${project}
          AND plugin_code='aij-ai' AND config_key=${AI_CENTER_CONFIG_KEY} FOR SHARE`;
        return operation(tx, project);
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 5000, timeout: 10000 });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException('Personal Agent publication unavailable');
    }
  }
  private async owned(tx: Prisma.TransactionClient, member: string, workspace: string, id: string): Promise<Head> {
    const rows = await tx.$queryRaw<Head[]>`SELECT id,revision,enabled,published_revision,publication_version FROM public.ai_personal_agent
      WHERE id=${id} AND workspace_id=${workspace} AND member_id=${member} AND deleted_at IS NULL FOR UPDATE`;
    if (!rows[0]) throw new NotFoundException('Personal Agent unavailable');
    const h = rows[0];
    if (!Number.isInteger(h.revision) || h.revision < 1 || h.revision > 2147483647 ||
      !Number.isInteger(h.publication_version) || h.publication_version < 0 || h.publication_version > 2147483647 ||
      typeof h.enabled !== 'boolean' || (h.published_revision !== null && (h.published_revision !== h.revision || !h.enabled || h.publication_version === 0)))
      throw new ServiceUnavailableException('Personal Agent publication unavailable');
    return h;
  }
  private async readiness(tx: Prisma.TransactionClient, project: string, member: string, workspace: string, h: Head): Promise<PublicationReadiness> {
    if (!h.enabled) return { ready: false, reason: 'disabled' };
    if (!this.validator) return { ready: false, reason: 'validator_unavailable' };
    try {
      await this.validator.validate(tx, { projectId: project, memberId: member, workspaceId: workspace, agentId: h.id, revision: h.revision });
      return { ready: true, reason: 'ready' };
    } catch (error) {
      if (error instanceof HttpException && [400, 404, 409].includes(error.getStatus()))
        return { ready: false, reason: 'dependencies_unavailable' };
      throw error;
    }
  }
  private metadata(h: Head, dependencyReadiness: PublicationReadiness): PersonalAgentPublicationMetadata {
    return { agentId: h.id, revision: h.revision, publishedRevision: h.published_revision, publicationVersion: h.publication_version,
      published: h.published_revision === h.revision, dependencyReadiness };
  }
  get(member: string, workspace: string, rawId: unknown) {
    const id = personalAgentPublicationId(rawId);
    return this.scope(member, workspace, P.aiAssetsRead, async (tx, project) => {
      const h = await this.owned(tx, member, workspace, id);
      return this.metadata(h, await this.readiness(tx, project, member, workspace, h));
    });
  }
  publish(member: string, workspace: string, id: unknown, body: unknown, correlationId?: string) {
    return this.mutate(member, workspace, id, body, true, correlationId);
  }
  unpublish(member: string, workspace: string, id: unknown, body: unknown, correlationId?: string) {
    return this.mutate(member, workspace, id, body, false, correlationId);
  }
  private mutate(member: string, workspace: string, rawId: unknown, body: unknown, publish: boolean, correlationId?: string) {
    const id = personalAgentPublicationId(rawId), dto = personalAgentPublicationMutation(body);
    return this.scope(member, workspace, P.aiAssetsManage, async (tx, project) => {
      const h = await this.owned(tx, member, workspace, id);
      if (h.revision !== dto.expectedAgentRevision || h.publication_version !== dto.expectedPublicationVersion)
        throw new ConflictException('Personal Agent publication conflict');
      const readiness = await this.readiness(tx, project, member, workspace, h);
      if (publish && !readiness.ready) {
        if (readiness.reason === 'validator_unavailable') throw new ServiceUnavailableException('Personal Agent publication validator unavailable');
        throw new ConflictException('Personal Agent publication dependencies unavailable');
      }
      const desired = publish ? h.revision : null;
      if (h.published_revision === desired) return this.metadata(h, readiness);
      if (h.publication_version === 2147483647) throw new ConflictException('Personal Agent publication limit reached');
      const rows = await tx.$queryRaw<Head[]>`UPDATE public.ai_personal_agent SET published_revision=${desired},
        publication_version=publication_version+1 WHERE id=${id} AND workspace_id=${workspace} AND member_id=${member}
        AND deleted_at IS NULL AND revision=${dto.expectedAgentRevision} AND publication_version=${dto.expectedPublicationVersion}
        RETURNING id,revision,enabled,published_revision,publication_version`;
      if (!rows[0]) throw new ConflictException('Personal Agent publication conflict');
      const next = rows[0], action = publish ? 'personal_agent_published' : 'personal_agent_unpublished';
      // Audit is in the SAME transaction: a write failure rolls back the epoch and publication.
      await tx.auditLog.create({ data: { module: 'aij-ai', action, userId: member, workspaceId: workspace, status: 'success',
        resourceType: 'ai_personal_agent', resourceId: id,
        afterData: { agentId: id, revision: next.revision, publishedRevision: next.published_revision, publicationVersion: next.publication_version },
        ...(correlationId && /^[A-Za-z0-9._:-]{1,128}$/.test(correlationId) ? { requestSummary: { correlationId } } : {}) } });
      return this.metadata(next, readiness);
    });
  }
}
