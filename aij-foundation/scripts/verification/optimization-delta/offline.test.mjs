import { loadKnowledgeWebImports } from "../knowledge-legacy-source-imports.mjs";
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { controlledClock, loadSource, nest, NotFoundException } from './source-loader.mjs';
import { sourceAudit } from './source-audit.mjs';

const healthPath = 'apps/api/src/async-runtime/runtime-health.service.ts';
function healthFixture() {
  const clock = controlledClock();
  const { RuntimeHealthService } = loadSource(healthPath, { '@nestjs/common': nest }, { Date: clock.Date });
  const prisma = { readiness: async () => ({ ready: true, reason: 'READY' }), $queryRaw: async () => [] };
  const health = new RuntimeHealthService(prisma);
  const green = () => {
    health.worker = { status: 'running', instanceId: 'offline', lastPollAt: new clock.Date(), lastError: null };
    health.scheduler = { ...health.worker };
  };
  return { clock, prisma, health, green };
}

test('source inventory covers all eleven knowledge routes and the current three plugin catalogs', () => {
  const audit = sourceAudit();
  assert.deepEqual(audit.catalog.trusted, ['aij-ai', 'aij-notification', 'aij-payment']);
  assert.deepEqual(audit.catalog.startup, audit.catalog.trusted);
  assert.equal(audit.catalog.runtimeAndManagementShareTrustedCatalog, true);
  assert.equal(audit.knowledgeRoutes.length, 11);
  for (const suffix of ['documents/import-web', 'documents/:id/web-source']) {
    const route = audit.knowledgeRoutes.find(r => r.path === '/api/client/ai/knowledge/' + suffix);
    assert.equal(route.permission, 'CLIENT_WORKSPACE_PERMISSION.knowledgeManage');
  }
  assert.ok(audit.knowledgeRoutes.every(route => route.workspaceGuard && route.permission && route.service));
  assert.equal(audit.leaseSourceChecks.currentIdentity, true);
  assert.equal(audit.leaseSourceChecks.duplicateAdmissionTuple, true);
  assert.equal(audit.leaseSourceChecks.admissionOwnerAndAttempt, true);
});

test('actual health source rejects stale/boundary/error heartbeats and recovers', async () => {
  const f = healthFixture(); f.green();
  assert.equal((await f.health.snapshot()).ready, true);
  f.clock.advance(29_999); assert.equal((await f.health.snapshot()).ready, true);
  f.clock.advance(1); assert.equal((await f.health.snapshot()).ready, false);
  f.green(); f.health.worker.lastError = 'synthetic';
  assert.equal((await f.health.snapshot()).ready, false);
  f.green(); assert.equal((await f.health.snapshot()).ready, true);
});

test('actual health source distinguishes DB unavailable, disabled and startup from green', async () => {
  const f = healthFixture();
  assert.equal((await f.health.snapshot()).ready, false);
  f.green(); f.health.worker.status = 'disabled';
  assert.equal((await f.health.snapshot()).reason, 'ASYNC_RUNTIME_DISABLED');
  f.green(); f.prisma.readiness = async () => ({ ready: false, reason: 'DATABASE_UNAVAILABLE' });
  const state = await f.health.snapshot();
  assert.equal(state.ready, false); assert.equal(state.queues, null);
  f.prisma.readiness = async () => ({ ready: true });
  f.prisma.$queryRaw = async () => { throw new Error('synthetic dependency failure'); };
  assert.equal((await f.health.snapshot()).database.ready, false);
});

test('DELTA-R1 regression after AF-137: reentry cannot refresh a stalled poll heartbeat', async () => {
  const f = healthFixture(); f.green();
  const { RuntimeWorkerService } = loadSource('apps/api/src/async-runtime/runtime-worker.service.ts', {
    '@nestjs/common': nest, 'node:crypto': { randomUUID: () => 'offline' },
    './runtime-contracts': { safeRuntimeError: () => 'SANITIZED' }
  }, { Date: f.clock.Date, process: { env: {}, pid: 1 } });
  let release; let claims = 0;
  const stalled = new Promise(resolve => { release = resolve; });
  const worker = new RuntimeWorkerService({ claim: () => { claims++; return stalled; } },
    { claim: async () => [] }, {}, f.health, { get: () => true });
  const first = worker.poll();
  try {
    f.clock.advance(60_000);
    f.health.scheduler.lastPollAt = new f.clock.Date();
    assert.equal((await f.health.snapshot()).ready, false);
    const reentrant = worker.poll();
    assert.equal(claims, 1, 'no second poll progressed');
    assert.equal((await f.health.snapshot()).ready, false, 'reentry is not worker progress');
    release([]); await Promise.all([first, reentrant]);
    assert.equal((await f.health.snapshot()).ready, false, 'completion alone is not a new poll');
    await worker.poll();
    assert.equal((await f.health.snapshot()).ready, true, 'a new round restores a fresh heartbeat');
  } finally { release([]); await first; }
});

test('DELTA-R4 observation: queue backlog is reported but does not change readiness', async () => {
  const f = healthFixture(); f.green();
  f.prisma.$queryRaw = async () => [{ status: 'pending', count: 1_000_000n }];
  const state = await f.health.snapshot();
  assert.equal(state.queues.jobs.pending, 1_000_000);
  assert.equal(state.ready, true, 'backlog policy remains an explicit follow-up');
});

function knowledgeFixture() {
  const clock = controlledClock();
  const permissions = { knowledgeManage: 'knowledge.manage', knowledgeQuery: 'knowledge.query' };
  const { AiKnowledgeService } = loadSource('apps/api/src/plugins/aij-ai/ai-knowledge.service.ts', {
    ...loadKnowledgeWebImports(),
    '@nestjs/common': nest,
    '@prisma/client': { Prisma: { TransactionIsolationLevel: { ReadCommitted: 'ReadCommitted' } },
      AiKnowledgeQuestionStatus: { queued: 'queued', running: 'running', refused: 'refused' } },
    'node:crypto': { createHash },
    '../../client-workspaces/client-workspace-permissions': { CLIENT_WORKSPACE_PERMISSION: permissions },
    './ai-knowledge-retrieval': loadSource('apps/api/src/plugins/aij-ai/ai-knowledge-retrieval.ts'),
    './knowledge-csv-parser': loadSource('apps/api/src/plugins/aij-ai/knowledge-csv-parser.ts'),
    './ai-provider': { AI_PLUGIN_CODE: 'aij-ai' }
  }, { Date: clock.Date });
  let enabled = true; let locked = 0; let writes = 0;
  const plugins = {
    assertEnabled: async () => { if (!enabled) throw new NotFoundException('disabled'); },
    projectId: async () => 'synthetic-project',
    assertEnabledInTransaction: async () => { locked++; if (!enabled) throw new NotFoundException('disabled'); }
  };
  const date = new clock.Date();
  const row = { id: 'c123456789012345678901234', updatedAt: date, status: 'active', createdAt: date };
  const tx = {
    aiKnowledgeDocument: {
      findFirst: async () => row, findFirstOrThrow: async () => row,
      updateMany: async () => { writes++; return { count: 1 }; },
      create: async () => { writes++; return row; }
    },
    auditLog: { create: async () => ({}) }, clientWorkspace: { findFirst: async () => ({ id: 'workspace' }) },
    aiKnowledgeQuestion: {
      findUnique: async () => null,
      create: async ({ data }) => { writes++; return { ...row, ...data }; }
    }
  };
  const prisma = {
    $transaction: async callback => { enabled = false; return callback(tx); },
    aiKnowledgeQuestion: { findUnique: async () => null },
    aiKnowledgeDocument: { findMany: async () => [] }
  };
  const service = new AiKnowledgeService(prisma, { resolve: async () => ({}) }, {}, {}, plugins, {});
  return { service, row, disable: () => { enabled = false; }, stats: () => ({ writes, locked }) };
}

test('disabled knowledge service entry points reject before data access (seven methods)', async () => {
  const f = knowledgeFixture(); f.disable();
  for (const [name, args] of [
    ['createDocument', [{}]], ['listDocuments', [{}]], ['updateDocument', [f.row.id, {}]],
    ['queryDocuments', [{}]], ['submitQuestion', [{}]], ['getQuestion', [f.row.id]],
    ['importDocument', [{}, undefined]]
  ]) await assert.rejects(f.service[name]('member', 'workspace', ...args), NotFoundException, name);
  assert.equal(f.stats().writes, 0);
});

test('disabled evaluation capture/read reject via actual transaction gate (two methods)', async () => {
  const { AiEvaluationService } = loadSource('apps/api/src/plugins/aij-ai/ai-evaluation.service.ts', {
    '@nestjs/common': nest,
    '../../client-workspaces/client-workspace-permissions': { CLIENT_WORKSPACE_PERMISSION: { knowledgeManage: 'manage' } },
    './deepseek-provider': { redactAiExternalText: value => value }
  });
  const service = new AiEvaluationService({ $transaction: callback => callback({}) }, { resolve: async () => ({}) },
    { projectId: async () => 'project', assertEnabledInTransaction: async () => { throw new NotFoundException('disabled'); } }, {});
  await assert.rejects(service.capture('member', 'workspace', { questionId: 'c123456789012345678901234', runKey: 'run', caseKey: 'case' }), NotFoundException);
  await assert.rejects(service.read('member', 'workspace', 'c123456789012345678901234'), NotFoundException);
});

test('DELTA-R2 regression after AF-138: disable after entry fences document update', async () => {
  const f = knowledgeFixture();
  await assert.rejects(f.service.updateDocument('member', 'workspace', f.row.id, { title: 'synthetic', expectedUpdatedAt: f.row.updatedAt.toISOString() }), NotFoundException);
  assert.equal(f.stats().writes, 0, 'disabled lifecycle cannot write');
  assert.equal(f.stats().locked, 1);
});

test('createDocument rechecks transaction gate after the same controlled disable', async () => {
  const f = knowledgeFixture();
  await assert.rejects(f.service.createDocument('member', 'workspace', { documentCode: 'synthetic', title: 'synthetic', content: 'synthetic' }), NotFoundException);
  assert.equal(f.stats().writes, 0); assert.equal(f.stats().locked, 1);
});

test('DELTA-R3 regression after AF-138: refusal is fenced even without a queued job', async () => {
  const f = knowledgeFixture();
  await assert.rejects(f.service.submitQuestion('member', 'workspace', { query: 'missing synthetic evidence', idempotencyKey: 'synthetic' }), NotFoundException);
  assert.equal(f.stats().writes, 0, 'refused branch cannot persist after disable');
  assert.equal(f.stats().locked, 1);
});
