import type { ClientApi } from './index.js';
import type { AiAgentRunResult } from '@aij/contracts';

export type WorkflowRef = Readonly<{
  id: string; workflowId: string; workflowVersionId: string; revision: number; graphDigest: string;
  publicationEpoch: number; nodeId: string; agentId: string; agentVersionId: string;
  agentRevision: number; agentPublicationEpoch: number;
}>;
export type PublicationMetadata = Readonly<{
  workflowId: string; revision: number; publishedRevision: number | null; publicationEpoch: number;
  publication: WorkflowRef | null; dependencyReadiness: Readonly<{ ready: boolean;
    reason: 'ready' | 'not_published' | 'revision_changed' | 'dependencies_unavailable' | 'validator_unavailable' }>;
}>;
export type Preview = Readonly<{ publication: WorkflowRef; inputFields: string[]; maximumEstimatedCostNanos: string; modelExecutionConfigured: boolean }>;
export type RunEnvelope = Readonly<{ run: AiAgentRunResult; origin: WorkflowRef }>;
export type RecoveryEnvelope = Readonly<{ request: Readonly<{ id: string; agentCode: string; status: string; budgetStatus: string;
  createdAt: string; expiresAt: string; contentAvailable: boolean }>; origin: WorkflowRef }>;
export type WorkflowPublicationMutation = Readonly<{ expectedRevision: number; expectedPublicationEpoch: number }>;
export type WorkflowPublishInput = WorkflowPublicationMutation & Readonly<{ workflowId: string }>;
export type WorkflowRunInput = Readonly<{ publicationId: string; input: Record<string, string>; idempotencyKey: string }>;
export type WorkflowExecutionOptions = Readonly<{ signal?: AbortSignal }>;

const BAD = ['__proto__', 'prototype', 'constructor'];
function invalid(): never { throw new TypeError('Invalid workflow execution data'); }
function object(raw: unknown, keys?: readonly string[]): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || ![Object.prototype, null].includes(Object.getPrototypeOf(raw))) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(raw), own = Reflect.ownKeys(raw);
  if ((keys && (own.length !== keys.length || keys.some(k => !Object.hasOwn(raw, k)))) || own.some(k => typeof k !== 'string' || BAD.includes(k) ||
    (keys && !keys.includes(k)) || !descriptors[k]?.enumerable || !('value' in descriptors[k]!))) invalid();
  return raw as Record<string, unknown>;
}
function id(v: unknown): string {
  if (typeof v !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(v) || BAD.includes(v)) invalid(); return v;
}
function uuid(v: unknown): string {
  if (typeof v !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v)) invalid(); return v;
}
function counter(v: unknown, min = 1): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < min || v > 2147483647) invalid(); return v;
}
function key(v: unknown): string {
  if (typeof v !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(v)) invalid(); return v;
}
function field(v: unknown, node = false): string {
  if (typeof v !== 'string' || !(node ? /^[A-Za-z][A-Za-z0-9_-]{0,47}$/ : /^[A-Za-z][A-Za-z0-9_]{0,47}$/).test(v) || BAD.includes(v)) invalid(); return v;
}
function decimal(v: unknown): string {
  if (typeof v !== 'string' || !/^(?:0|[1-9][0-9]*)$/.test(v)) invalid(); return v;
}
function iso(v: unknown): string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v) || !Number.isFinite(Date.parse(v)) || new Date(v).toISOString() !== v) invalid(); return v;
}
function ref(raw: unknown): WorkflowRef {
  const b = object(raw, ['id', 'workflowId', 'workflowVersionId', 'revision', 'graphDigest', 'publicationEpoch', 'nodeId', 'agentId', 'agentVersionId', 'agentRevision', 'agentPublicationEpoch']);
  if (typeof b.graphDigest !== 'string' || !/^[0-9a-f]{64}$/.test(b.graphDigest)) invalid();
  return Object.freeze({ id: uuid(b.id), workflowId: id(b.workflowId), workflowVersionId: id(b.workflowVersionId), revision: counter(b.revision),
    graphDigest: b.graphDigest, publicationEpoch: counter(b.publicationEpoch), nodeId: field(b.nodeId, true), agentId: id(b.agentId),
    agentVersionId: id(b.agentVersionId), agentRevision: counter(b.agentRevision), agentPublicationEpoch: counter(b.agentPublicationEpoch) });
}
function metadata(raw: unknown, workflowId: string): PublicationMetadata {
  const b = object(raw, ['workflowId', 'revision', 'publishedRevision', 'publicationEpoch', 'publication', 'dependencyReadiness']);
  if (b.workflowId !== workflowId) invalid();
  const revision = counter(b.revision), publishedRevision = b.publishedRevision === null ? null : counter(b.publishedRevision), publicationEpoch = counter(b.publicationEpoch, 0);
  const publication = b.publication === null ? null : ref(b.publication);
  const r = object(b.dependencyReadiness, ['ready', 'reason']);
  if (typeof r.ready !== 'boolean' || !['ready', 'not_published', 'revision_changed', 'dependencies_unavailable', 'validator_unavailable'].includes(r.reason as string) || r.ready !== (r.reason === 'ready')) invalid();
  if (publishedRevision === null ? publication !== null || r.ready || r.reason !== 'not_published' :
    !publication || publishedRevision > revision || publication.workflowId !== workflowId || publication.revision !== publishedRevision || publication.publicationEpoch !== publicationEpoch || r.reason === 'not_published' ||
    (publishedRevision !== revision ? r.reason !== 'revision_changed' : r.reason === 'revision_changed')) invalid();
  return Object.freeze({ workflowId, revision, publishedRevision, publicationEpoch, publication, dependencyReadiness: Object.freeze({ ready: r.ready, reason: r.reason as PublicationMetadata['dependencyReadiness']['reason'] }) });
}
function mutation(raw: unknown): WorkflowPublicationMutation {
  const b = object(raw, ['expectedRevision', 'expectedPublicationEpoch']);
  return { expectedRevision: counter(b.expectedRevision), expectedPublicationEpoch: counter(b.expectedPublicationEpoch, 0) };
}
function submitInput(raw: unknown): WorkflowRunInput {
  const b = object(raw, ['publicationId', 'input', 'idempotencyKey']), input = object(b.input);
  if (Object.keys(input).length > 20) invalid();
  const copy: Record<string, string> = {};
  for (const [k, v] of Object.entries(input)) {
    field(k); if (typeof v !== 'string' || !v.trim() || v.length > 2000) invalid(); copy[k] = v;
  }
  return { publicationId: uuid(b.publicationId), input: copy, idempotencyKey: key(b.idempotencyKey) };
}
function array(raw: unknown): unknown[] {
  if (!Array.isArray(raw) || Object.getPrototypeOf(raw) !== Array.prototype || Reflect.ownKeys(raw).length !== raw.length + 1) invalid();
  for (let i = 0; i < raw.length; i++) { const d = Object.getOwnPropertyDescriptor(raw, String(i)); if (!d?.enumerable || !('value' in d)) invalid(); }
  return raw;
}
function preview(raw: unknown, publicationId: string): Preview {
  const b = object(raw, ['publication', 'inputFields', 'maximumEstimatedCostNanos', 'modelExecutionConfigured']), publication = ref(b.publication);
  const values = array(b.inputFields); if (values.length > 20) invalid(); const inputFields = values.map(v => field(v));
  if (publication.id !== publicationId || new Set(inputFields).size !== inputFields.length || typeof b.modelExecutionConfigured !== 'boolean') invalid();
  return { publication, inputFields, maximumEstimatedCostNanos: decimal(b.maximumEstimatedCostNanos), modelExecutionConfigured: b.modelExecutionConfigured };
}
/** Clone only JSON values, rejecting accessor/prototype/unknown transport values without evaluating them. */
function json(raw: unknown, depth = 0): unknown {
  if (depth > 40) invalid();
  if (raw === null || typeof raw === 'string' || typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') { if (!Number.isFinite(raw)) invalid(); return raw; }
  if (Array.isArray(raw)) return array(raw).map(v => json(v, depth + 1));
  return Object.fromEntries(Object.entries(object(raw)).map(([k, v]) => [k, json(v, depth + 1)]));
}
function runIdentity(b: Record<string, unknown>, origin: WorkflowRef, expectedId?: string) {
  const runId = id(b.id);
  if ((expectedId !== undefined && runId !== expectedId) || b.agentCode !== 'personal:' + origin.agentId ||
    !['queued', 'running', 'succeeded', 'failed', 'unknown'].includes(b.status as string) || !['reserved', 'settled', 'released'].includes(b.budgetStatus as string)) invalid();
  const createdAt = iso(b.createdAt), expiresAt = iso(b.expiresAt); if (expiresAt <= createdAt) invalid();
  return { id: runId, agentCode: b.agentCode as string, status: b.status as string, budgetStatus: b.budgetStatus as string, createdAt, expiresAt };
}
function runEnvelope(raw: unknown, expected: { publicationId?: string; runId?: string } = {}): RunEnvelope {
  const b = object(raw, ['run', 'origin']), origin = ref(b.origin);
  if (expected.publicationId && origin.id !== expected.publicationId) invalid();
  const r = object(b.run, ['id', 'agentCode', 'status', 'output', 'failureCode', 'estimatedCostNanos', 'budgetStatus', 'imageAssetId', 'createdAt', 'expiresAt']);
  const identity = runIdentity(r, origin, expected.runId);
  if (r.failureCode !== null && (typeof r.failureCode !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(r.failureCode))) invalid();
  return { origin, run: { ...identity, output: json(r.output), failureCode: r.failureCode as string | null,
    estimatedCostNanos: decimal(r.estimatedCostNanos), imageAssetId: r.imageAssetId === null ? null : id(r.imageAssetId) } };
}
function recovery(raw: unknown): RecoveryEnvelope {
  const b = object(raw, ['request', 'origin']), origin = ref(b.origin);
  const r = object(b.request, ['id', 'agentCode', 'status', 'budgetStatus', 'createdAt', 'expiresAt', 'contentAvailable']);
  const identity = runIdentity(r, origin); if (typeof r.contentAvailable !== 'boolean') invalid();
  return { origin, request: { ...identity, contentAvailable: r.contentAvailable } };
}
/** One explicit call, one original ClientApi transport; no implicit retry or persistence. */
export function createPersonalWorkflowExecutionClient(api: ClientApi) {
  const base = '/client/workflow-executions';
  function request(workspaceId: string, path: string, options?: WorkflowExecutionOptions, body?: unknown) {
    id(workspaceId);
    if (options !== undefined) {
      const o = object(options); if (Object.keys(o).some(k => k !== 'signal') || (o.signal !== undefined && !(o.signal instanceof AbortSignal))) invalid();
    }
    return api<unknown>(base + path, { method: body === undefined ? 'GET' : 'POST', workspaceId,
      ...(options?.signal === undefined ? {} : { signal: options.signal }), ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  }
  return {
    publication(workspaceId: string, workflowId: string, options?: WorkflowExecutionOptions): Promise<PublicationMetadata> {
      id(workflowId); return request(workspaceId, '/publications/' + encodeURIComponent(workflowId), options).then(raw => metadata(raw, workflowId));
    },
    publish(workspaceId: string, input: WorkflowPublishInput, options?: WorkflowExecutionOptions): Promise<PublicationMetadata> {
      const b = object(input, ['workflowId', 'expectedRevision', 'expectedPublicationEpoch']);
      const workflowId = id(b.workflowId), m = mutation({ expectedRevision: b.expectedRevision, expectedPublicationEpoch: b.expectedPublicationEpoch });
      return request(workspaceId, '/publications', options, { workflowId, ...m }).then(raw => {
        const result = metadata(raw, workflowId);
        if (result.revision !== m.expectedRevision || result.publishedRevision !== result.revision || !result.publication ||
          ![m.expectedPublicationEpoch, m.expectedPublicationEpoch + 1].includes(result.publicationEpoch)) invalid(); return result;
      });
    },
    unpublish(workspaceId: string, workflowId: string, input: WorkflowPublicationMutation, options?: WorkflowExecutionOptions): Promise<PublicationMetadata> {
      id(workflowId); const m = mutation(input);
      return request(workspaceId, '/publications/' + encodeURIComponent(workflowId) + '/unpublish', options, m).then(raw => {
        const result = metadata(raw, workflowId);
        if (result.revision !== m.expectedRevision || result.publication !== null || result.publishedRevision !== null ||
          ![m.expectedPublicationEpoch, m.expectedPublicationEpoch + 1].includes(result.publicationEpoch)) invalid(); return result;
      });
    },
    preview(workspaceId: string, publicationId: string, options?: WorkflowExecutionOptions): Promise<Preview> {
      uuid(publicationId); return request(workspaceId, '/capability?publicationId=' + encodeURIComponent(publicationId), options).then(raw => preview(raw, publicationId));
    },
    submit(workspaceId: string, input: WorkflowRunInput, options?: WorkflowExecutionOptions): Promise<RunEnvelope> {
      const b = submitInput(input); return request(workspaceId, '/runs', options, b).then(raw => runEnvelope(raw, { publicationId: b.publicationId }));
    },
    recover(workspaceId: string, idempotencyKey: string, options?: WorkflowExecutionOptions): Promise<RecoveryEnvelope> {
      key(idempotencyKey); return request(workspaceId, '/requests/' + encodeURIComponent(idempotencyKey), options).then(recovery);
    },
    read(workspaceId: string, runId: string, options?: WorkflowExecutionOptions): Promise<RunEnvelope> {
      id(runId); return request(workspaceId, '/runs/' + encodeURIComponent(runId), options).then(raw => runEnvelope(raw, { runId }));
    }
  };
}
