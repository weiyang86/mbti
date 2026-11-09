import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { AiCenterConfigurationService } from './ai-center-configuration.service';
import { AiPersonalAgentSnapshotsService } from './ai-personal-agent-snapshots.service';
import { PersonalAgentPublicationValidator, type PublicationValidationScope } from './ai-personal-agent-publications.service';

/** Same trusted resolver and catalog owner; publishing performs no credential IO. */
@Injectable()
export class RootPersonalAgentPublicationValidator extends PersonalAgentPublicationValidator {
  constructor(private readonly configuration: AiCenterConfigurationService, private readonly snapshots: AiPersonalAgentSnapshotsService) { super(); }
  async validate(tx: Prisma.TransactionClient, scope: PublicationValidationScope): Promise<void> {
    try {
      const current = await this.configuration.current(tx);
      if (current.projectId !== scope.projectId) throw new ConflictException('Personal Agent configuration unavailable');
      await this.snapshots.validateDependencies(tx, current, scope.memberId, scope.workspaceId, scope.agentId, scope.revision);
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof SyntaxError) throw new ConflictException('Personal Agent configuration unavailable');
      throw error;
    }
  }
}
