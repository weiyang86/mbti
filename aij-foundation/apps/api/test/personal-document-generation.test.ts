// Offline boundary collaborators only: no PG, session authentication, admission or runtime acceptance.
import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { BadRequestException, ExecutionContext, ForbiddenException, HttpException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import type { ClientClaims, ClientRequest } from '../src/client-auth/client-auth.security';
import { CLIENT_WORKSPACE_PERMISSIONS_KEY } from '../src/client-workspaces/client-workspace-permission.decorator';
import { WorkspaceContextGuard } from '../src/client-workspaces/workspace-context.guard';
import { AiPersonalDocumentGenerationController as Controller, DocumentGenerationNoStoreGuard } from '../src/plugins/aij-ai/ai-personal-document-generation.controller';
import { parseDocumentGenerationPreview, parseDocumentGenerationRef, parseDocumentGenerationSubmit } from '../src/plugins/aij-ai/ai-personal-document-generation.dto';
import { AiPersonalDocumentGenerationService as Service, DocumentGenerationRunDriver as Driver } from '../src/plugins/aij-ai/ai-personal-document-generation.service';

const documentId = '12345678-1234-4234-8234-123456789abc', agentId = '22345678-1234-4234-8234-123456789abc';
const rawInstruction = '  原样\r\n😀  ';
const claims: ClientClaims = { sub: 'member', sessionId: 'session', tokenVersion: 2 };
function origin() {
  return { format: 'aij-document-generation-v1', document: { format: 'aij-document-section-source-v1', indexFormat: 'aij-plain-sections-v1',
    documentId, revision: 7, bodySha256: 'a'.repeat(64), sectionId: 'section-0', start: 0, end: 12, sectionSha256: 'b'.repeat(64) },
  agentId, agentVersionId: 'opaque_version', agentRevision: 3, agentPublicationEpoch: 4, catalogVersion: 5,
  modelCode: 'text-model', modelRevision: 6, instructionSha256: createHash('sha256').update(rawInstruction, 'utf8').digest('hex'), inputSha256: 'd'.repeat(64), maximumEstimatedCostNanos: '123' };
}
function previewBody() { return { documentId, expectedRevision: 7, bodySha256: 'a'.repeat(64), sectionId: 'section-0', agentId, agentRevision: 3, instruction: rawInstruction }; }
function submitBody() { return { origin: origin(), instruction: rawInstruction, idempotencyKey: 'request_123' }; }
function preview() { return { origin: origin(), inputFields: ['source', 'instruction'], modelExecutionConfigured: false }; }
function run() { return { id: 'run_1', agentCode: 'personal:' + agentId, status: 'succeeded', output: '生成正文😀\r\n', failureCode: null,
  estimatedCostNanos: '12', budgetStatus: 'settled', imageAssetId: null, createdAt: new Date('2026-11-09T00:00:00.000Z'), expiresAt: new Date('2026-11-16T00:00:00.000Z') }; }
function recovery() { return { request: { id: 'run_1', agentCode: 'personal:' + agentId, status: 'unknown', budgetStatus: 'reserved',
  createdAt: new Date('2026-11-09T00:00:00.000Z'), expiresAt: new Date('2026-11-16T00:00:00.000Z'), contentAvailable: false }, origin: origin(), documentCurrent: false }; }
class Collaborator extends Driver {
  calls: { operation: string; args: unknown[] }[] = [];
  result: unknown = preview();
  failure: unknown;
  private async invoke(operation: string, args: unknown[]) { this.calls.push({ operation, args }); if (this.failure) throw this.failure; return this.result; }
  previewDocumentGeneration(...args: Parameters<Driver['previewDocumentGeneration']>) { return this.invoke('preview', args); }
  submitDocumentGeneration(...args: Parameters<Driver['submitDocumentGeneration']>) { return this.invoke('submit', args); }
  readDocumentGeneration(...args: Parameters<Driver['readDocumentGeneration']>) { return this.invoke('read', args); }
  recoverDocumentGeneration(...args: Parameters<Driver['recoverDocumentGeneration']>) { return this.invoke('recover', args); }
}
const status = (code: number) => (e: unknown) => e instanceof HttpException && e.getStatus() === code && !e.message.includes('PRIVATE');

test('DTO exact shapes, opaque/UUID/range boundaries, raw instruction, canonical detached frozen refs', () => {
  const raw = submitBody(), result = parseDocumentGenerationSubmit(raw);
  assert.equal(result.instruction, raw.instruction); assert.deepEqual(result, raw);
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.origin) && Object.isFrozen(result.origin.document));
  raw.origin.document.start = 5; assert.equal(result.origin.document.start, 0);
  const p = previewBody(); Object.setPrototypeOf(p, null); assert.deepEqual(parseDocumentGenerationPreview(p), { ...p });
  const r = origin(); r.maximumEstimatedCostNanos = '9223372036854775807'; assert.equal(parseDocumentGenerationRef(r).maximumEstimatedCostNanos, r.maximumEstimatedCostNanos);
  for (const mutate of [
    (v: ReturnType<typeof previewBody>) => { v.expectedRevision = 0; }, v => { v.expectedRevision = 201; },
    v => { v.sectionId = 'section-01'; }, v => { v.sectionId = 'section-128'; }, v => { v.agentId = agentId.toUpperCase(); },
    v => { v.instruction = ' '.repeat(3); }, v => { v.instruction = 'a'.repeat(2001); }
  ] satisfies ((v: ReturnType<typeof previewBody>) => void)[]) { const v = previewBody(); mutate(v); assert.throws(() => parseDocumentGenerationPreview(v), BadRequestException); }
  for (const cost of ['01', '-1', '1.0', '9223372036854775808', '9'.repeat(1000)]) {
    const v = origin(); v.maximumEstimatedCostNanos = cost; assert.throws(() => parseDocumentGenerationRef(v), BadRequestException);
  }
});

test('DTO never evaluates getters, rejects hidden/symbol/proto/extra fields and sanitizes hostile traps', () => {
  for (const target of ['root', 'origin', 'document']) {
    const v = submitBody(), obj = target === 'root' ? v : target === 'origin' ? v.origin : v.origin.document;
    let evaluated = false;
    Object.defineProperty(obj, target === 'root' ? 'instruction' : target === 'origin' ? 'agentId' : 'start', {
      enumerable: true, get() { evaluated = true; throw Error('PRIVATE'); }
    });
    assert.throws(() => parseDocumentGenerationSubmit(v), status(400)); assert.equal(evaluated, false);
  }
  for (const mutate of [
    (v: object) => Object.defineProperty(v, 'hidden', { value: 'PRIVATE' }),
    v => Object.defineProperty(v, Symbol('PRIVATE'), { value: true }),
    v => Object.defineProperty(v, '__proto__', { enumerable: true, value: {} }),
    v => Object.setPrototypeOf(v, { inherited: true })
  ] satisfies ((v: object) => void)[]) { const v = submitBody(); mutate(v); assert.throws(() => parseDocumentGenerationSubmit(v), status(400)); }
  assert.throws(() => parseDocumentGenerationSubmit(new Proxy(submitBody(), { ownKeys() { throw Error('PRIVATE'); } })), status(400));
});

test('service invokes each original driver method once with server scope/new claims and projects Dates/text only', async () => {
  const d = new Collaborator(), service = new Service(d);
  const p = await service.preview('member', 'workspace', previewBody(), claims, 'correlation');
  assert.deepEqual(p, preview()); assert.ok(Object.isFrozen(p.inputFields));
  d.result = { run: run(), origin: origin() };
  const submitted = await service.submit('member', 'workspace', submitBody(), claims, 'correlation');
  const read = await service.read('member', 'workspace', 'run_1', claims, 'correlation');
  assert.equal(read.run.output, '生成正文😀\r\n'); assert.equal(submitted.run.createdAt, '2026-11-09T00:00:00.000Z');
  d.result = recovery();
  const recovered = await service.recover('member', 'workspace', 'request_123', claims, 'correlation');
  assert.equal(recovered.documentCurrent, false); assert.equal(recovered.request.contentAvailable, false);
  assert.equal(recovered.request.status, 'unknown'); assert.equal(recovered.request.budgetStatus, 'reserved');
  assert.deepEqual(d.calls.map(c => c.operation), ['preview', 'submit', 'read', 'recover']);
  for (const c of d.calls) { assert.equal(c.args[0], 'member'); assert.equal(c.args[1], 'workspace'); assert.equal(c.args[3], claims); assert.equal(c.args[4], 'correlation'); }
  assert.equal(Object.hasOwn(recovered.request, 'output'), false);
});

test('service boundary rejects private/malformed driver successes safely and does not retry or mask original HTTP failures', async () => {
  const d = new Collaborator(), service = new Service(d);
  for (const mutate of [
    (v: Record<string, unknown>) => { v.snapshot = 'PRIVATE'; },
    v => { (v.run as Record<string, unknown>).input = 'PRIVATE'; },
    v => { (v.run as Record<string, unknown>).output = { text: 'PRIVATE' }; },
    v => { (v.run as Record<string, unknown>).imageAssetId = 'image'; },
    v => { (v.run as Record<string, unknown>).budgetStatus = 'reserved'; },
    v => { (v.run as Record<string, unknown>).estimatedCostNanos = '01'; },
    v => { (v.run as Record<string, unknown>).createdAt = new Date(NaN); },
    v => { (v.origin as ReturnType<typeof origin>).agentId = documentId; }
  ] satisfies ((v: Record<string, unknown>) => void)[]) {
    const value = { run: run(), origin: origin() }; mutate(value); d.result = value;
    const before = d.calls.length; await assert.rejects(service.read('member', 'workspace', 'run_1', claims), status(503)); assert.equal(d.calls.length, before + 1);
  }
  for (const code of [400, 401, 403, 404, 409, 410, 503]) {
    const e = new HttpException('Safe owner refusal', code); d.failure = e;
    const before = d.calls.length; await assert.rejects(service.read('member', 'workspace', 'run_1', claims), error => error === e); assert.equal(d.calls.length, before + 1);
  }
  d.failure = undefined;
  const wrongInstruction = preview(); wrongInstruction.origin.instructionSha256 = 'e'.repeat(64); d.result = wrongInstruction;
  await assert.rejects(service.preview('member', 'workspace', previewBody(), claims), status(503));
  const before = d.calls.length;
  await assert.rejects(service.preview('member', 'workspace', { ...previewBody(), workspaceId: 'forged' }, claims), status(400));
  assert.equal(d.calls.length, before);
  await assert.rejects(new Service().read('member', 'workspace', 'run_1', claims), ServiceUnavailableException);
});

test('all original status/budget combinations and purged metadata remain distinct', async () => {
  const d = new Collaborator(), service = new Service(d);
  for (const state of ['queued', 'running', 'succeeded', 'failed', 'unknown']) {
    const r: Record<string, unknown> = { ...run(), status: state, budgetStatus: state === 'succeeded' ? 'settled' : state === 'failed' ? 'released' : 'reserved',
      output: state === 'succeeded' ? 'text' : null, failureCode: ['failed', 'unknown'].includes(state) ? 'SOURCE_CHANGED' : null,
      estimatedCostNanos: state === 'failed' ? '0' : '12' };
    d.result = { run: r, origin: origin() }; assert.equal((await service.read('member', 'workspace', 'run_1', claims)).run.status, state);
    if (state !== 'succeeded') { r.output = 'PRIVATE'; await assert.rejects(service.read('member', 'workspace', 'run_1', claims), status(503)); }
  }
  d.result = { ...recovery(), request: { ...recovery().request, output: 'PRIVATE' } };
  await assert.rejects(service.recover('member', 'workspace', 'request_123', claims), status(503));
});

function request(): ClientRequest {
  return { client: { id: 'member', email: null, nickname: 'Member' }, clientClaims: claims,
    workspaceContext: { workspaceId: 'workspace', workspaceCode: 'ws', workspaceName: 'Workspace', roleId: 'role', roleCode: 'role', permissions: [] },
    headers: { origin: 'http://web.invalid' }, correlationId: 'correlation' } as unknown as ClientRequest;
}
test('controller freezes four route/guard/permission boundaries, no export/manage required for reads or preview', () => {
  assert.equal(Reflect.getMetadata(PATH_METADATA, Controller), 'client/ai');
  assert.deepEqual(Reflect.getMetadata(GUARDS_METADATA, Controller), [DocumentGenerationNoStoreGuard, WorkspaceContextGuard]);
  for (const [name, path] of [['preview', 'document-generations/preview'], ['submit', 'document-generations'], ['read', 'document-generation-runs/:id'], ['recover', 'document-generation-requests/:key']] as const) {
    const method = Controller.prototype[name]; assert.equal(Reflect.getMetadata(PATH_METADATA, method), path);
    assert.equal(Reflect.getMetadata(METHOD_METADATA, method), ['preview', 'submit'].includes(name) ? 1 : 0);
    assert.deepEqual(Reflect.getMetadata(CLIENT_WORKSPACE_PERMISSIONS_KEY, method), ['workspace.documents.read', 'workspace.ai.read', 'workspace.ai.assets.read',
      ...(name === 'submit' ? ['workspace.documents.manage', 'workspace.ai.execute'] : [])]);
  }
  const headers: Record<string, string> = {};
  assert.equal(new DocumentGenerationNoStoreGuard().canActivate({ switchToHttp: () => ({ getResponse: () => ({ setHeader(k: string, v: string) { headers[k] = v; } }) }) } as unknown as ExecutionContext), true);
  assert.equal(headers['Cache-Control'], 'private, no-store');
});

test('controller derives scope/claims from original session and rejects queries/bodies/origin/disabled admission before driver', async () => {
  const d = new Collaborator(), config = new ConfigService({ webUrl: 'http://web.invalid', AI_CENTER_CLIENT_EXECUTION_ENABLED: 'true' });
  const controller = new Controller(new Service(d), config), r = request();
  await controller.preview(r, previewBody(), {}); assert.equal(d.calls.length, 1);
  assert.throws(() => controller.preview({ ...r, clientClaims: undefined } as ClientRequest, previewBody(), {}), UnauthorizedException);
  assert.throws(() => controller.preview({ ...r, clientClaims: { ...claims, sub: 'other' } } as ClientRequest, previewBody(), {}), UnauthorizedException);
  assert.throws(() => controller.preview({ ...r, headers: { origin: 'http://other.invalid' } } as ClientRequest, previewBody(), {}), ForbiddenException);
  assert.throws(() => controller.read(r, 'run_1', { output: 'yes' }), BadRequestException);
  assert.throws(() => controller.read({ ...r, url: '/client/ai/document-generation-runs/run_1?__proto__=private' } as ClientRequest, 'run_1', {}), BadRequestException);
  assert.throws(() => controller.read(r, 'run_1', {}, {}), BadRequestException);
  assert.throws(() => controller.recover({ ...r, headers: { 'content-length': '1' } } as ClientRequest, 'request_123', {}), BadRequestException);
  config.set('AI_CENTER_CLIENT_EXECUTION_ENABLED', 'false'); assert.throws(() => controller.submit(r, submitBody(), {}), ServiceUnavailableException);
  assert.equal(d.calls.length, 1);
});
