import { BadRequestException, ConflictException, Injectable, Optional, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { ClientClaims } from '../../client-auth/client-auth.security';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

export type WorkflowRef = Readonly<{
  id: string; workflowId: string; workflowVersionId: string; revision: number; graphDigest: string;
  publicationEpoch: number; nodeId: string; agentId: string; agentVersionId: string;
  agentRevision: number; agentPublicationEpoch: number;
}>;
export type WorkflowScope = Readonly<{ projectId: string; workspaceId: string; memberId: string }>;
export type WorkflowRun = WorkflowScope & Readonly<{ id: string; snapshot: unknown }>;
export type WorkflowOrigin = Readonly<{ ref: WorkflowRef; inputFields: string[] }>;
export type WorkflowSessionGate = (tx: Prisma.TransactionClient) => Promise<void>;
export abstract class WorkflowPublicationRuntimePort {
  abstract resolveForReadInTransaction(tx: Prisma.TransactionClient, scope: { memberId: string; workspaceId: string },
    publicationId: string, authorize?: WorkflowSessionGate): Promise<WorkflowOrigin & { projectId: string }>;
  abstract resolveInTransaction(tx: Prisma.TransactionClient, scope: { memberId: string; workspaceId: string },
    publicationId: string, authorize?: WorkflowSessionGate): Promise<WorkflowOrigin & { projectId: string }>;
}
export abstract class WorkflowSessionPort {
  abstract assertSessionInTransaction(tx: Prisma.TransactionClient, claims: ClientClaims): Promise<void>;
}
export abstract class PersonalWorkflowRunOriginPort {
  abstract resolveOrigin(tx: Prisma.TransactionClient, scope: WorkflowScope, publicationId: string, claims: ClientClaims): Promise<WorkflowOrigin>;
  abstract recordOrigin(tx: Prisma.TransactionClient, run: WorkflowRun, origin: WorkflowOrigin, claims: ClientClaims): Promise<void>;
  abstract assertOriginCurrent(tx: Prisma.TransactionClient, run: WorkflowRun): Promise<void>;
}
export type WorkflowOriginRow = {
  run_id: string; project_id: string; workspace_id: string; member_id: string; publication_id: string;
  ref: unknown; session_id: string; token_version: number;
};
const keys = ['id', 'workflowId', 'workflowVersionId', 'revision', 'graphDigest', 'publicationEpoch', 'nodeId', 'agentId', 'agentVersionId', 'agentRevision', 'agentPublicationEpoch'] as const;
const unavailable = () => new ServiceUnavailableException('Workflow execution unavailable');
const mismatch = () => new ConflictException('Workflow origin changed');
/** Reject accessors and invisible/symbol properties before reading values. Never echo input. */
export function workflowObject(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || ![Object.prototype, null].includes(Object.getPrototypeOf(raw))) throw mismatch();
  for (const key of Reflect.ownKeys(raw)) {
    const d = Object.getOwnPropertyDescriptor(raw, key)!;
    if (typeof key !== 'string' || !d.enumerable || !('value' in d)) throw mismatch();
  }
  return raw as Record<string, unknown>;
}
export function workflowRef(raw: unknown): WorkflowRef {
  const r = workflowObject(raw);
  if (Object.keys(r).length !== keys.length || keys.some(k => !Object.hasOwn(r, k))) throw mismatch();
  for (const k of ['workflowId', 'workflowVersionId', 'nodeId', 'agentId', 'agentVersionId'])
    if (typeof r[k] !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(r[k])) throw mismatch();
  if (typeof r.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(r.id) ||
    typeof r.graphDigest !== 'string' || !/^[0-9a-f]{64}$/.test(r.graphDigest)) throw mismatch();
  for (const k of ['revision', 'publicationEpoch', 'agentRevision', 'agentPublicationEpoch'])
    if (typeof r[k] !== 'number' || !Number.isSafeInteger(r[k]) || r[k] < 1 || r[k] > 2147483647) throw mismatch();
  return Object.freeze(Object.fromEntries(keys.map(k => [k, r[k]]))) as WorkflowRef;
}
export function workflowClaims(member: string, raw: ClientClaims): ClientClaims {
  if (!raw || raw.sub !== member || typeof raw.sessionId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(raw.sessionId) ||
    !Number.isSafeInteger(raw.tokenVersion) || raw.tokenVersion < 0 || raw.tokenVersion > 2147483647) throw new UnauthorizedException('Invalid client session');
  return Object.freeze({ sub: member, sessionId: raw.sessionId, tokenVersion: raw.tokenVersion });
}
export function workflowMarker(snapshot: unknown): WorkflowRef | undefined {
  if (snapshot === null || snapshot === undefined) return undefined;
  const s = workflowObject(snapshot);
  if (s.source === undefined) return undefined;
  const source = workflowObject(s.source);
  return Object.hasOwn(source, 'workflowOrigin') ? workflowRef(source.workflowOrigin) : undefined;
}
export function assertWorkflowSnapshot(snapshot: unknown, ref: WorkflowRef, inputFields?: readonly string[]): void {
  const s = workflowObject(snapshot), source = workflowObject(s.source), agent = workflowObject(s.agent);
  if (!isDeepStrictEqual(workflowMarker(snapshot), ref) || source.type !== 'personal' || source.agentId !== ref.agentId ||
    source.versionId !== ref.agentVersionId || source.revision !== ref.agentRevision || source.publicationVersion !== ref.agentPublicationEpoch ||
    agent.code !== 'personal:' + ref.agentId || agent.revision !== ref.agentRevision ||
    (inputFields !== undefined && (!Array.isArray(agent.inputFields) || !isDeepStrictEqual([...agent.inputFields].sort(), [...inputFields].sort())))) throw mismatch();
}
/** Called only after origin validation; removes precisely one known extension, preserving unknown keys. */
export function withoutWorkflowMarker(snapshot: unknown, verified: WorkflowRef): unknown {
  assertWorkflowSnapshot(snapshot, verified);
  const s = workflowObject(snapshot), source = { ...workflowObject(s.source) };
  delete source.workflowOrigin;
  return { ...s, source };
}
export function workflowRequestHash(ref: WorkflowRef, input: Record<string, string>): string {
  const r = workflowRef(ref), b = workflowObject(input);
  if (Object.keys(b).length > 20 || Object.entries(b).some(([k, v]) => !/^[A-Za-z][A-Za-z0-9_]{0,47}$/.test(k) ||
    ['__proto__', 'constructor', 'prototype'].includes(k) || typeof v !== 'string' || !v.trim() || v.length > 2000)) throw new BadRequestException('Invalid workflow input');
  return createHash('sha256').update(JSON.stringify(['personal-workflow-v1', r.id, r.workflowVersionId, r.publicationEpoch,
    r.graphDigest, r.nodeId, r.agentId, r.agentVersionId, r.agentRevision, r.agentPublicationEpoch,
    Object.entries(b).sort(([a], [b]) => a.localeCompare(b))])).digest('hex');
}

@Injectable()
export class AiPersonalWorkflowRunOriginService extends PersonalWorkflowRunOriginPort {
  constructor(@Optional() private readonly publications?: WorkflowPublicationRuntimePort,
    @Optional() private readonly sessions?: WorkflowSessionPort) { super(); }

  async resolveOrigin(tx: Prisma.TransactionClient, scope: WorkflowScope, publicationId: string, claims: ClientClaims): Promise<WorkflowOrigin> {
    return this.resolveCurrent(tx, scope, publicationId, claims, 'resolveInTransaction');
  }

  async resolveReadOrigin(tx: Prisma.TransactionClient, scope: WorkflowScope, publicationId: string, claims: ClientClaims): Promise<WorkflowOrigin> {
    return this.resolveCurrent(tx, scope, publicationId, claims, 'resolveForReadInTransaction');
  }

  private async resolveCurrent(tx: Prisma.TransactionClient, scope: WorkflowScope, publicationId: string, claims: ClientClaims,
    resolver: 'resolveInTransaction' | 'resolveForReadInTransaction'): Promise<WorkflowOrigin> {
    if (!this.publications || !this.sessions || typeof this.publications[resolver] !== 'function') throw unavailable();
    const identity = workflowClaims(scope.memberId, claims);
    // A holds workflow before calling the session gate, and NEVER locks Agent here.
    const current = await this.publications[resolver](tx, scope, publicationId,
      t => this.sessions!.assertSessionInTransaction(t, identity));
    const ref = workflowRef(current.ref);
    if (current.projectId !== scope.projectId || ref.id !== publicationId) throw mismatch();
    if (!Array.isArray(current.inputFields) || current.inputFields.length > 20 || new Set(current.inputFields).size !== current.inputFields.length ||
      current.inputFields.some(k => typeof k !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,47}$/.test(k) || ['__proto__', 'constructor', 'prototype'].includes(k))) throw mismatch();
    return { ref, inputFields: [...current.inputFields] };
  }

  async recordOrigin(tx: Prisma.TransactionClient, run: WorkflowRun, origin: WorkflowOrigin, claims: ClientClaims): Promise<void> {
    if (!this.publications || !this.sessions) throw unavailable();
    const ref = workflowRef(origin.ref), identity = workflowClaims(run.memberId, claims);
    assertWorkflowSnapshot(run.snapshot, ref, origin.inputFields);
    // Resolve/session were fenced before Memory/Agent by admission; no locks are acquired out of order here.
    await tx.$executeRaw`INSERT INTO public.ai_personal_workflow_run_origin
      (run_id,project_id,workspace_id,member_id,publication_id,ref,session_id,token_version)
      VALUES (${run.id},${run.projectId},${run.workspaceId},${run.memberId},${ref.id}::uuid,${JSON.stringify(ref)}::jsonb,${identity.sessionId},${identity.tokenVersion})`;
    await tx.auditLog.create({ data: { module: 'aij-ai', action: 'personal_workflow_run_admitted', userId: run.memberId,
      workspaceId: run.workspaceId, status: 'success', resourceType: 'ai-agent-run', resourceId: run.id,
      afterData: { publicationId: ref.id, workflowId: ref.workflowId, publicationEpoch: ref.publicationEpoch } } });
  }

  async relation(tx: Prisma.TransactionClient, run: Pick<WorkflowRun, 'id' | 'projectId' | 'workspaceId' | 'memberId'>): Promise<WorkflowOriginRow | undefined> {
    // Read by run ID first: an incorrectly scoped relation must not look like a legacy run.
    const rows = await tx.$queryRaw<WorkflowOriginRow[]>`SELECT run_id,project_id,workspace_id,member_id,publication_id,ref,session_id,token_version
      FROM public.ai_personal_workflow_run_origin WHERE run_id=${run.id}`;
    if (rows.length > 1) throw mismatch();
    const row = rows[0];
    if (row && (row.run_id !== run.id || row.project_id !== run.projectId || row.workspace_id !== run.workspaceId || row.member_id !== run.memberId)) throw mismatch();
    return row;
  }

  async assertOriginCurrent(tx: Prisma.TransactionClient, run: WorkflowRun): Promise<void> {
    const marker = workflowMarker(run.snapshot), row = await this.relation(tx, run);
    if (!marker && !row) return; // Exact legacy path; a relation with a missing marker is never legacy.
    if (!row || !marker) throw mismatch();
    const ref = workflowRef(row.ref);
    if (row.publication_id !== ref.id || !isDeepStrictEqual(marker, ref)) throw mismatch();
    const current = await this.resolveOrigin(tx, run, ref.id,
      { sub: run.memberId, sessionId: row.session_id, tokenVersion: row.token_version });
    if (!isDeepStrictEqual(current.ref, ref)) throw mismatch();
    assertWorkflowSnapshot(run.snapshot, ref, current.inputFields);
  }
}
