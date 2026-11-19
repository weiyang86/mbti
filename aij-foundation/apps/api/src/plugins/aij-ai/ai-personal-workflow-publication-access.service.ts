import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { AiPersonalWorkflowsService } from './ai-personal-workflows.service';
import { PersonalWorkflowPublicationAccess, Scope, SessionGate, WorkflowPublicationCurrent } from './ai-personal-workflow-publication.service';

/** Adapts the existing draft owner. No second scope/version/session implementation. */
@Injectable()
export class RootWorkflowPublicationAccess extends PersonalWorkflowPublicationAccess {
  constructor(private readonly workflows: AiPersonalWorkflowsService) { super(); }
  withCurrent<T>(scope: Scope, workflowId: string, permissions: readonly string[], authorize: SessionGate | undefined,
    operation: (tx: Prisma.TransactionClient, current: WorkflowPublicationCurrent) => Promise<T>): Promise<T> {
    return this.workflows.publicationWithCurrent(scope, workflowId, permissions, authorize, operation);
  }
  currentInTransaction(tx: Prisma.TransactionClient, scope: Scope, workflowId: string, permissions: readonly string[], authorize?: SessionGate) {
    return this.workflows.publicationCurrentInTransaction(tx, scope, workflowId, permissions, authorize);
  }
}
