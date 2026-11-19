import { BadRequestException, ConflictException, HttpException, Injectable, NotFoundException, Optional, ServiceUnavailableException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { ClientClaims } from '../../client-auth/client-auth.security';
import type { AiCenterRunService, AiRunRecoveryReference } from './ai-center-run.service';
import { AiPersonalAgentRunPreviewsService } from './ai-personal-agent-run-previews.service';
import { AiPersonalWorkflowRunOriginService, WorkflowRef, WorkflowScope, workflowClaims, workflowObject, workflowRef } from './ai-personal-workflow-run-origin.service';
import { isDeepStrictEqual } from 'node:util';

type RunResult = Awaited<ReturnType<AiCenterRunService['read']>>;
export abstract class WorkflowRunDriver {
  abstract submitWorkflow(member: string, workspace: string, raw: { publicationId: string; input: Record<string, string>; idempotencyKey: string }, claims: ClientClaims, correlationId?: string): Promise<RunResult>;
  abstract read(member: string, workspace: string, id: string): Promise<RunResult>;
  abstract recoverRequest(member: string, workspace: string, key: string): Promise<AiRunRecoveryReference>;
}
/** Root adapter owns lifecycle/member/grant/config locks and transaction boundaries only.
 * assertAgentCurrent uses original snapshots.resolve AFTER workflow/session, never before them.
 */
export abstract class WorkflowRunReadAccess {
  abstract withCurrent<T>(member: string, workspace: string, permissions: readonly string[],
    operation: (tx: Prisma.TransactionClient, scope: WorkflowScope) => Promise<T>): Promise<T>;
  abstract assertAgentCurrent(tx: Prisma.TransactionClient, scope: WorkflowScope, ref: WorkflowRef): Promise<void>;
}
const READ = ['ai.assets.read', 'ai.read', 'workspace.ai.workflows.execute'];
const EXECUTE = ['ai.assets.read', 'ai.execute', 'workspace.ai.workflows.execute'];
const unavailable = () => new ServiceUnavailableException('Workflow execution unavailable');
function id(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new BadRequestException('Invalid workflow request');
  return value;
}
function publication(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new BadRequestException('Invalid workflow request');
  return value;
}
function key(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(value)) throw new BadRequestException('Invalid workflow request');
  return value;
}
function submitBody(raw: unknown) {
  try {
    const b = workflowObject(raw);
    if (Object.keys(b).length !== 3 || !['publicationId', 'input', 'idempotencyKey'].every(k => Object.hasOwn(b, k))) throw new Error();
    const input = workflowObject(b.input);
    if (Object.keys(input).length > 20 || Object.entries(input).some(([k, v]) => !/^[A-Za-z][A-Za-z0-9_]{0,47}$/.test(k) ||
      ['__proto__', 'constructor', 'prototype'].includes(k) || typeof v !== 'string' || !v.trim() || v.length > 2000)) throw new Error();
    return { publicationId: publication(b.publicationId), input: { ...input } as Record<string, string>, idempotencyKey: key(b.idempotencyKey) };
  } catch { throw new BadRequestException('Invalid workflow request'); }
}
function runJson(run: RunResult) {
  // Explicit original public projection: no snapshot/session/payload can escape an adapter.
  return { id: run.id, agentCode: run.agentCode, status: run.status, output: run.output, failureCode: run.failureCode,
    estimatedCostNanos: run.estimatedCostNanos, budgetStatus: run.budgetStatus, imageAssetId: run.imageAssetId,
    createdAt: run.createdAt.toISOString(), expiresAt: run.expiresAt.toISOString() };
}
@Injectable()
export class AiPersonalWorkflowRunsService {
  constructor(@Optional() private readonly access?: WorkflowRunReadAccess,
    @Optional() private readonly origins?: AiPersonalWorkflowRunOriginService,
    @Optional() private readonly driver?: WorkflowRunDriver,
    @Optional() private readonly previews?: AiPersonalAgentRunPreviewsService) {}

  private async guarded<T>(work: () => Promise<T>): Promise<T> {
    try { if (!this.access || !this.origins || !this.driver) throw unavailable(); return await work(); }
    catch (error) { if (error instanceof HttpException) throw error; throw unavailable(); }
  }
  private current(member: string, workspace: string, publicationId: string, claims: ClientClaims, permissions: readonly string[]) {
    return this.access!.withCurrent(member, workspace, permissions, async (tx, scope) => {
      if (scope.memberId !== member || scope.workspaceId !== workspace) throw new NotFoundException('Workflow run unavailable');
      const origin = await this.origins!.resolveOrigin(tx, scope, publicationId, claims);
      await this.access!.assertAgentCurrent(tx, scope, origin.ref);
      return origin;
    });
  }
  private locate(member: string, workspace: string, selector: { id: string } | { key: string }, claims: ClientClaims, purpose: 'read' | 'execute') {
    // Purpose is fixed by each server method; never chosen by a DTO or a 403 fallback.
    return this.access!.withCurrent(member, workspace, purpose === 'read' ? READ : EXECUTE, async (tx, scope) => {
      if (scope.memberId !== member || scope.workspaceId !== workspace) throw new NotFoundException('Workflow run unavailable');
      const run = await tx.aiAgentRun.findFirst({ where: { projectId: scope.projectId, memberId: member, workspaceId: workspace,
        ...('id' in selector ? { id: selector.id } : { idempotencyKey: selector.key }) }, select: { id: true } });
      if (!run) throw new NotFoundException('Workflow run unavailable');
      const row = await this.origins!.relation(tx, { ...scope, id: run.id });
      if (!row) throw new NotFoundException('Workflow run unavailable');
      const ref = workflowRef(row.ref);
      if (row.publication_id !== ref.id) throw new ConflictException('Workflow origin changed');
      // Query authorization deliberately uses the NEW request session, never row.session_id.
      const current = purpose === 'read'
        ? await this.origins!.resolveReadOrigin(tx, scope, ref.id, claims)
        : await this.origins!.resolveOrigin(tx, scope, ref.id, claims);
      if (!isDeepStrictEqual(ref, current.ref)) throw new ConflictException('Workflow origin changed');
      await this.access!.assertAgentCurrent(tx, scope, ref);
      return { runId: run.id, ref };
    });
  }
  async submit(member: string, workspace: string, raw: unknown, claims: ClientClaims, correlationId?: string) {
    const body = submitBody(raw), identity = workflowClaims(member, claims);
    return this.guarded(async () => {
      const before = await this.current(member, workspace, body.publicationId, identity, EXECUTE);
      // Exactly one admission; an uncertain response is recovered explicitly, never retried.
      const run = await this.driver!.submitWorkflow(member, workspace, body, identity, correlationId);
      const after = await this.locate(member, workspace, { key: body.idempotencyKey }, identity, 'execute');
      if (after.runId !== run.id || !isDeepStrictEqual(before.ref, after.ref) || run.agentCode !== 'personal:' + after.ref.agentId) throw new ConflictException('Workflow origin changed');
      return { run: runJson(run), origin: after.ref };
    });
  }
  async read(member: string, workspace: string, runId: string, claims: ClientClaims) {
    id(runId); const identity = workflowClaims(member, claims);
    return this.guarded(async () => {
      const before = await this.locate(member, workspace, { id: runId }, identity, 'read');
      const run = await this.driver!.read(member, workspace, runId);
      const after = await this.locate(member, workspace, { id: runId }, identity, 'read');
      if (run.id !== runId || run.agentCode !== 'personal:' + after.ref.agentId || !isDeepStrictEqual(before, after)) throw new ConflictException('Workflow origin changed');
      return { run: runJson(run), origin: after.ref };
    });
  }
  async recover(member: string, workspace: string, requestKey: string, claims: ClientClaims) {
    key(requestKey); const identity = workflowClaims(member, claims);
    return this.guarded(async () => {
      const before = await this.locate(member, workspace, { key: requestKey }, identity, 'read');
      const request = await this.driver!.recoverRequest(member, workspace, requestKey);
      const after = await this.locate(member, workspace, { key: requestKey }, identity, 'read');
      if (request.id !== before.runId || request.agentCode !== 'personal:' + after.ref.agentId || !isDeepStrictEqual(before, after)) throw new ConflictException('Workflow origin changed');
      return { request: { id: request.id, agentCode: request.agentCode, status: request.status, budgetStatus: request.budgetStatus,
        createdAt: request.createdAt.toISOString(), expiresAt: request.expiresAt.toISOString(), contentAvailable: request.contentAvailable }, origin: after.ref };
    });
  }
  async preview(member: string, workspace: string, publicationId: string, claims: ClientClaims) {
    publication(publicationId); const identity = workflowClaims(member, claims);
    return this.guarded(async () => {
      if (!this.previews) throw unavailable();
      const before = await this.current(member, workspace, publicationId, identity, EXECUTE);
      const result = await this.previews.preview(member, workspace, before.ref.agentId, { expectedRevision: String(before.ref.agentRevision) });
      const after = await this.current(member, workspace, publicationId, identity, EXECUTE);
      if (!isDeepStrictEqual(before, after) || result.personalAgentId !== after.ref.agentId || result.revision !== after.ref.agentRevision ||
        !isDeepStrictEqual([...result.inputFields].sort(), [...after.inputFields].sort()) || !/^\d+$/.test(result.maximumEstimatedCostNanos) ||
        typeof result.modelExecutionConfigured !== 'boolean') throw new ConflictException('Workflow origin changed');
      return { publication: after.ref, inputFields: [...after.inputFields], maximumEstimatedCostNanos: result.maximumEstimatedCostNanos,
        modelExecutionConfigured: result.modelExecutionConfigured };
    });
  }
}
