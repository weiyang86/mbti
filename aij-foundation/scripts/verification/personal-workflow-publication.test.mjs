import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const require = createRequire(new URL('../../apps/api/package.json', import.meta.url));
require('ts-node').register({ project: resolve('apps/api/tsconfig.json'), transpileOnly: true });
require('reflect-metadata');
const { ForbiddenException, UnauthorizedException, ConflictException, ServiceUnavailableException } = require('@nestjs/common');
const { validateWorkflowGraph } = require('../../apps/api/src/plugins/aij-ai/ai-personal-workflows-graph.ts');
const { compilePersonalWorkflowLinearGraph: compile } = require('../../apps/api/src/plugins/aij-ai/ai-personal-workflow-linear-contract.ts');
const dto = require('../../apps/api/src/plugins/aij-ai/ai-personal-workflow-publication.dto.ts');
const { AiPersonalWorkflowPublicationService } = require('../../apps/api/src/plugins/aij-ai/ai-personal-workflow-publication.service.ts');
const status = n => e => e.getStatus?.() === n;
const clone = v => structuredClone(v);
const graph = () => ({ schemaVersion: 1, inputKeys: ['question'], nodes: [
  { id: 'start', type: 'start' }, { id: 'agent', type: 'agent', agentId: 'agent-a', revision: 1 }, { id: 'end', type: 'end' }
], edges: [{ from: 'start', port: 'next', to: 'agent', input: 'in' }, { from: 'agent', port: 'next', to: 'end', input: 'in' }] });
// Explicit transactional SQL collaborator: NOT PostgreSQL/provider/live acceptance. It rejects unknown SQL.
function fixture() {
  let state = { head: { revision: 1, published_revision: null, publication_epoch: 0 }, publications: [], audits: [] };
  const c = { projectId: 'project-a', workflowId: 'workflow-a', revision: 1, workflowVersionId: 'workflow-version-a',
    graph: graph(), graphDigest: validateWorkflowGraph(graph()).digest,
    agentBindings: [{ nodeId: 'agent', agentId: 'agent-a', revision: 1, agentVersionId: 'agent-version-a' }], catalog: { version: 1, catalog: {} } };
  const calls = [], controls = { auditFail: false, sqlFail: false, casFail: false, deny: false, snapshotError: null, allowedPermissions: null };
  const snapshot = { agent: { published: true, inputFields: ['question'] }, source: { type: 'personal', agentId: 'agent-a', versionId: 'agent-version-a', revision: 1, publicationVersion: 1 } };
  const tx = {
    async $queryRaw(strings, ...values) {
      const sql = strings.join('?').replace(/\s+/g, ' ').trim(); calls.push({ sql, values });
      if (controls.sqlFail) throw new Error('private SQL error');
      if (sql.startsWith('SELECT revision,published_revision,publication_epoch')) {
        assert.deepEqual(values, [c.workflowId, 'workspace-a', 'member-a']); return [clone(state.head)];
      }
      if (sql.includes('FROM public.ai_personal_workflow_publication')) {
        if (sql.includes('WHERE id=')) return state.publications.filter(p => p.id === values[0] && p.workspace_id === values[1] && p.member_id === values[2]).map(clone);
        return state.publications.filter(p => p.workflow_id === values[0] && p.project_id === values[1] && p.workspace_id === values[2] && p.member_id === values[3] && p.publication_epoch === values[4] && p.revision === values[5]).map(clone);
      }
      assert.fail('Unexpected SQL: ' + sql);
    },
    async $executeRaw(strings, ...values) {
      const sql = strings.join('?').replace(/\s+/g, ' ').trim(); calls.push({ sql, values });
      if (controls.sqlFail) throw new Error('private SQL error');
      if (sql.startsWith('INSERT INTO public.ai_personal_workflow_publication')) {
        const keys = ['id','project_id','workspace_id','member_id','workflow_id','workflow_version_id','revision','graph_digest','publication_epoch','node_id','agent_id','agent_version_id','agent_revision','agent_publication_epoch'];
        const row = Object.fromEntries(keys.map((k, i) => [k, values[i]]));
        assert(!state.publications.some(p => p.workflow_id === row.workflow_id && p.publication_epoch === row.publication_epoch));
        state.publications.push(row); return 1;
      }
      if (sql.startsWith('UPDATE public.ai_personal_workflow SET published_revision=')) {
        const [published, id, workspace, member, rev, epoch] = values;
        if (controls.casFail || id !== c.workflowId || workspace !== 'workspace-a' || member !== 'member-a' || rev !== state.head.revision || epoch !== state.head.publication_epoch) return 0;
        state.head.published_revision = published; state.head.publication_epoch++; return 1;
      }
      assert.fail('Unexpected mutation: ' + sql);
    },
    auditLog: { async create({ data }) { if (controls.auditFail) throw new Error('private audit failure'); state.audits.push(clone(data)); } }
  };
  const access = {
    async currentInTransaction(t, scope, id, permissions, authorize) {
      assert.equal(t, tx); calls.push({ port: 'current', scope, id, permissions });
      if (controls.deny || (controls.allowedPermissions && permissions.some(p => !controls.allowedPermissions.includes(p)))) throw new ForbiddenException();
      if (scope.memberId !== 'member-a' || scope.workspaceId !== 'workspace-a' || id !== 'workflow-a') throw new ForbiddenException();
      if (authorize) await authorize(t);
      return c;
    },
    async withCurrent(scope, id, permissions, authorize, operation) {
      const before = clone(state);
      try { return await operation(tx, await this.currentInTransaction(tx, scope, id, permissions, authorize)); }
      catch (e) { state = before; throw e; }
    }
  };
  const snapshots = { async resolve(t, catalog, member, workspace, id, revision) {
    calls.push({ snapshot: true }); assert.equal(t, tx); assert.equal(catalog, c.catalog);
    assert.deepEqual([member, workspace, id, revision], ['member-a', 'workspace-a', 'agent-a', 1]);
    if (controls.snapshotError) throw controls.snapshotError;
    return clone(snapshot);
  } };
  const service = new AiPersonalWorkflowPublicationService(access, snapshots);
  const publish = (epoch = state.head.publication_epoch, revision = c.revision, authorize) => service.publish('member-a', 'workspace-a', { workflowId: 'workflow-a', expectedRevision: revision, expectedPublicationEpoch: epoch }, authorize);
  const unpublish = (epoch = state.head.publication_epoch) => service.unpublish('member-a', 'workspace-a', 'workflow-a', { expectedRevision: c.revision, expectedPublicationEpoch: epoch });
  return { service, publish, unpublish, state: () => state, c, tx, calls, controls, snapshot, access, snapshots };
}

test('compiler uses original canonical truth, returns detached bounded frozen plan', () => {
  const g = graph(), p = compile(g, ['question']);
  assert.equal(p.graphDigest, validateWorkflowGraph(g).digest); assert(Object.isFrozen(p)); assert(Object.isFrozen(p.inputFields));
  g.nodes.reverse(); g.edges.reverse(); assert.deepEqual(compile(g, ['question']), p);
  const reordered = { edges: g.edges.map(e => ({ input: e.input, to: e.to, port: e.port, from: e.from })), nodes: g.nodes, inputKeys: g.inputKeys, schemaVersion: 1 };
  assert.deepEqual(compile(reordered, ['question']), p);
  g.inputKeys.push('later'); assert.deepEqual(p.inputFields, ['question']);
});
test('compiler refuses extra/approval/loop/script nodes, transform, mismatched/duplicate input and unsafe graph', () => {
  const patches = [g => g.nodes.push({ id: 'extra', type: 'human-approval' }), g => g.nodes[1].type = 'human-approval',
    g => g.nodes[1].type = 'script', g => g.nodes[1].type = 'loop', g => g.nodes[1].mapping = {}, g => g.edges[0].input = 'question',
    g => g.inputKeys.push('other'), g => g.inputKeys = ['question', 'question'], g => g.nodes[1].revision = Infinity,
    g => g.nodes[1].revision = 2147483648, g => g.nodes[1].agentId = '__proto__', g => g.nodes = Array(65).fill(g.nodes[0])];
  for (const patch of patches) { const g = graph(); patch(g); assert.throws(() => compile(g, ['question']), status(400)); }
  assert.throws(() => compile(graph(), ['question', 'question']), status(400));
  assert.throws(() => compile(graph(), []), status(400));
  let touched = false; const fields = []; Object.defineProperty(fields, '0', { enumerable: true, get() { touched = true; return 'question'; } });
  assert.throws(() => compile(graph(), fields), status(400)); assert.equal(touched, false);
});
test('DTO rejects unknown keys/prototype/getter/duplicates/nonfinite/out of bounds without echo', () => {
  const valid = { workflowId: 'workflow-a', expectedRevision: 1, expectedPublicationEpoch: 0 };
  assert.deepEqual(dto.publishPersonalWorkflowDto(valid), valid);
  const bad = [{ ...valid, claims: {} }, Object.assign(Object.create({}), valid),
    { ...valid, expectedRevision: 0 }, { ...valid, expectedRevision: 2147483648 }, { ...valid, expectedRevision: NaN },
    { ...valid, expectedPublicationEpoch: -1 }, { ...valid, expectedPublicationEpoch: -0 }, { ...valid, expectedPublicationEpoch: Infinity },
    { ...valid, expectedPublicationEpoch: 2147483648 }];
  let read = false; const getter = { ...valid }; Object.defineProperty(getter, 'expectedRevision', { enumerable: true, get() { read = true; throw new Error('secret'); } }); bad.push(getter);
  for (const b of bad) assert.throws(() => dto.publishPersonalWorkflowDto(b), e => e.getStatus() === 400 && !e.message.includes('secret'));
  assert.equal(read, false);
  assert.throws(() => dto.parseWorkflowPublicationJson('{"expectedRevision":1,"expectedRevision":2}'), status(400));
  assert.throws(() => dto.parseWorkflowPublicationJson('{"x":{"a":1,"a":2}}'), status(400));
  assert.throws(() => dto.unpublishPersonalWorkflowDto({ expectedRevision: 1, expectedPublicationEpoch: 0, workflowId: 'x' }), status(400));
});
test('actual publish SQL + audit, exact metadata/ref projection and runtime without snapshot locks', async () => {
  const f = fixture(); let gates = 0;
  const m = await f.publish(0, 1, async t => { assert.equal(t, f.tx); gates++; });
  assert.equal(gates, 1); assert.deepEqual(m.dependencyReadiness, { ready: true, reason: 'ready' }); assert.equal(m.publicationEpoch, 1);
  assert.deepEqual(Object.keys(m).sort(), ['workflowId','revision','publishedRevision','publicationEpoch','publication','dependencyReadiness'].sort());
  assert.deepEqual(Object.keys(m.publication).sort(), ['id','workflowId','workflowVersionId','revision','graphDigest','publicationEpoch','nodeId','agentId','agentVersionId','agentRevision','agentPublicationEpoch'].sort());
  assert.equal(f.state().publications.length, 1); assert.equal(f.state().audits.length, 1); assert(Object.isFrozen(m.publication));
  assert.deepEqual(f.calls.find(c => c.port).permissions, ['ai.assets.manage', 'workspace.ai.workflows.publish']);
  f.calls.length = 0;
  const r = await f.service.resolveInTransaction(f.tx, { memberId: 'member-a', workspaceId: 'workspace-a' }, m.publication.id, async () => { gates++; });
  assert.equal(r.projectId, 'project-a'); assert.deepEqual(r.ref, m.publication); assert.deepEqual(r.inputFields, ['question']); assert.equal(gates, 2);
  assert(!f.calls.some(c => c.snapshot)); assert(!f.calls.some(c => c.sql && /ai_personal_agent|memory/.test(c.sql)));
  assert.deepEqual(f.calls.find(c => c.port).permissions, ['ai.assets.read', 'ai.execute', 'workspace.ai.workflows.execute']);
});
test('same current ref is no-op but old CAS replay conflicts; no duplicate audit', async () => {
  const f = fixture(), a = await f.publish();
  const b = await f.publish(); assert.deepEqual(b, a); assert.equal(f.state().audits.length, 1); assert.equal(f.state().publications.length, 1);
  await assert.rejects(f.publish(0), status(409)); assert.equal(f.state().audits.length, 1);
});
test('unpublish history stays immutable and same revision republish prevents ABA', async () => {
  const f = fixture(), a = await f.publish(), historical = clone(f.state().publications[0]);
  const u = await f.unpublish(); assert.equal(u.publication, null); assert.equal(u.publicationEpoch, 2);
  const noop = await f.unpublish(); assert.deepEqual(noop, u); assert.equal(f.state().audits.length, 2);
  await assert.rejects(f.service.resolveInTransaction(f.tx, { memberId: 'member-a', workspaceId: 'workspace-a' }, a.publication.id), status(409));
  const b = await f.publish(); assert.equal(b.publicationEpoch, 3); assert.notEqual(b.publication.id, a.publication.id);
  assert.deepEqual(f.state().publications[0], historical);
  await assert.rejects(f.publish(1), status(409)); await assert.rejects(f.unpublish(1), status(409));
  await assert.rejects(f.service.resolveInTransaction(f.tx, { memberId: 'member-a', workspaceId: 'workspace-a' }, a.publication.id), status(409));
});
test('new draft revision keeps historical publication visible, nonready and nonexecutable', async () => {
  const f = fixture(), a = await f.publish(); f.c.revision = 2; f.c.workflowVersionId = 'workflow-version-b'; f.state().head.revision = 2;
  const m = await f.service.read('member-a', 'workspace-a', 'workflow-a');
  assert.equal(m.dependencyReadiness.reason, 'revision_changed'); assert.deepEqual(m.publication, a.publication); assert.equal(f.state().audits.length, 1);
  await assert.rejects(f.service.resolveInTransaction(f.tx, { memberId: 'member-a', workspaceId: 'workspace-a' }, a.publication.id), status(409));
  const b = await f.publish(); assert.equal(b.revision, 2); assert.equal(b.publicationEpoch, 2);
});
test('original Agent pin version/current publication and input contracts are mandatory', async () => {
  for (const patch of [f => f.snapshot.source.versionId = 'wrong', f => f.snapshot.source.agentId = 'wrong',
    f => f.snapshot.source.revision = 2, f => f.snapshot.source.publicationVersion = 0, f => f.snapshot.agent.published = false,
    f => f.c.agentBindings[0].agentVersionId = 'old-version', f => f.c.agentBindings.push(clone(f.c.agentBindings[0]))]) {
    const f = fixture(); patch(f); await assert.rejects(f.publish(), status(409)); assert.equal(f.state().publications.length, 0);
  }
  const f = fixture(); f.snapshot.agent.inputFields = ['different']; await assert.rejects(f.publish(), status(400));
  const g = fixture(); g.controls.snapshotError = new ConflictException(); await assert.rejects(g.publish(), status(409));
});
test('Agent republication epoch changes readiness without changing immutable pin; explicit republish advances workflow epoch', async () => {
  const f = fixture(), a = await f.publish(); f.snapshot.source.publicationVersion++;
  const m = await f.service.read('member-a', 'workspace-a', 'workflow-a'); assert.equal(m.dependencyReadiness.reason, 'dependencies_unavailable');
  assert.deepEqual(m.publication, a.publication); assert.equal(f.state().audits.length, 1);
  const b = await f.publish(); assert.equal(b.publication.agentPublicationEpoch, 2); assert.equal(b.publicationEpoch, 2); assert.notEqual(b.publication.id, a.publication.id);
});
test('metadata has not_published/validator_unavailable states and never hides current permission/session denial', async () => {
  const f = fixture(); assert.equal((await f.service.read('member-a', 'workspace-a', 'workflow-a')).dependencyReadiness.reason, 'not_published');
  await f.publish(); f.controls.snapshotError = new ServiceUnavailableException();
  assert.equal((await f.service.read('member-a', 'workspace-a', 'workflow-a')).dependencyReadiness.reason, 'validator_unavailable');
  f.controls.deny = true; await assert.rejects(f.service.read('member-a', 'workspace-a', 'workflow-a'), status(403));
  f.controls.deny = false;
  await assert.rejects(f.service.read('member-a', 'workspace-a', 'workflow-a', async () => { throw new UnauthorizedException(); }), status(401));
});
test('runtime rejects graph/version/binding/digest/project mismatches and unknown publication', async () => {
  for (const patch of [f => f.c.workflowVersionId = 'other', f => f.c.graphDigest = 'a'.repeat(64),
    f => f.c.agentBindings[0].agentVersionId = 'other', f => f.c.projectId = 'other',
    f => f.c.graph.nodes[1].revision = 2, f => f.state().publications[0].agent_publication_epoch = 0]) {
    const f = fixture(), p = await f.publish(); patch(f);
    await assert.rejects(f.service.resolveInTransaction(f.tx, { memberId: 'member-a', workspaceId: 'workspace-a' }, p.publication.id), status(409));
  }
  const f = fixture(); await assert.rejects(f.service.resolveInTransaction(f.tx, { memberId: 'member-a', workspaceId: 'workspace-a' }, '00000000-0000-4000-8000-000000000000'), status(404));
});
test('current identity/session permission is checked on every operation, not caller snapshot', async () => {
  const f = fixture(), p = await f.publish(); f.controls.deny = true;
  await assert.rejects(f.publish(), status(403)); await assert.rejects(f.unpublish(), status(403));
  await assert.rejects(f.service.resolveInTransaction(f.tx, { memberId: 'member-a', workspaceId: 'workspace-a' }, p.publication.id), status(403));
  f.controls.deny = false;
  await assert.rejects(f.service.read('other-member', 'workspace-a', 'workflow-a'), status(403));
  await assert.rejects(f.service.resolveInTransaction(f.tx, { memberId: 'other-member', workspaceId: 'workspace-a' }, p.publication.id), status(404));
  await assert.rejects(f.publish(undefined, undefined, async () => { throw new UnauthorizedException(); }), status(401));
});
test('max epoch refuses mutation; genuine no-op still works at max; head revision CAS refuses stale', async () => {
  const f = fixture(); f.state().head.publication_epoch = 2147483647;
  await assert.rejects(f.publish(), status(409)); assert.equal(f.state().publications.length, 0);
  const g = fixture(); g.state().head.publication_epoch = 2147483646; await g.publish();
  await g.publish(); assert.equal(g.state().audits.length, 1); await assert.rejects(g.unpublish(), status(409));
  await assert.rejects(g.publish(2147483647, 2), status(409));
});
test('audit or CAS failure rolls back inserted immutable publication and head, no retry', async () => {
  for (const key of ['auditFail', 'casFail']) {
    const f = fixture(); f.controls[key] = true;
    await assert.rejects(f.publish(), status(key === 'auditFail' ? 503 : 409));
    assert.deepEqual(f.state(), { head: { revision: 1, published_revision: null, publication_epoch: 0 }, publications: [], audits: [] });
    assert.equal(f.calls.filter(c => c.sql?.startsWith('INSERT')).length, 1);
  }
  const f = fixture(); await f.publish(); const before = clone(f.state()); f.controls.auditFail = true;
  await assert.rejects(f.unpublish(), status(503)); assert.deepEqual(f.state(), before);
});
test('unknown SQL/dependency failures stay 503 without retries or input/error echo; missing ports fail closed', async () => {
  const f = fixture(); f.controls.sqlFail = true; await assert.rejects(f.publish(), e => e.getStatus() === 503 && !e.message.includes('private'));
  assert.equal(f.calls.filter(c => c.sql).length, 1);
  const g = fixture(); g.controls.snapshotError = new Error('private dependency error'); await assert.rejects(g.publish(), status(503));
  assert.equal(g.calls.filter(c => c.snapshot).length, 1);
  await assert.rejects(new AiPersonalWorkflowPublicationService().read('m', 'w', 'workflow-a'), status(503));
  await assert.rejects(new AiPersonalWorkflowPublicationService(g.access).publish('member-a', 'workspace-a', { workflowId: 'workflow-a', expectedRevision: 1, expectedPublicationEpoch: 0 }), status(503));
});

test('missing runtime access port is 503 before any SQL; read never writes or republishes', async () => {
  const f = fixture(); await assert.rejects(new AiPersonalWorkflowPublicationService().resolveInTransaction(f.tx, { memberId: 'member-a', workspaceId: 'workspace-a' }, '00000000-0000-4000-8000-000000000000'), status(503));
  assert.equal(f.calls.length, 0); await f.publish(); const before = clone(f.state()); f.calls.length = 0;
  await f.service.read('member-a', 'workspace-a', 'workflow-a'); assert.deepEqual(f.state(), before);
  assert(!f.calls.some(c => c.sql?.startsWith('INSERT') || c.sql?.startsWith('UPDATE')));
});

const executionPermissions = ['ai.assets.read', 'ai.execute', 'workspace.ai.workflows.execute'];
const resultReadPermissions = ['ai.assets.read', 'ai.read', 'workspace.ai.workflows.execute'];
const resolverMethods = ['resolveInTransaction', 'resolveForReadInTransaction'];
const scope = { memberId: 'member-a', workspaceId: 'workspace-a' };
test('R1 exact result-read versus execute permissions, same immutable ref, workflow-only locks and session gate', async () => {
  const f = fixture(), m = await f.publish(), before = clone(f.state());
  for (const [method, permissions] of [[resolverMethods[0], executionPermissions], [resolverMethods[1], resultReadPermissions]]) {
    f.calls.length = 0; let gates = 0;
    const r = await f.service[method](f.tx, scope, m.publication.id, async t => { assert.equal(t, f.tx); gates++; });
    assert.deepEqual(r, { projectId: 'project-a', ref: m.publication, inputFields: ['question'] }); assert(Object.isFrozen(r.ref));
    assert.equal(gates, 1); assert.deepEqual(f.calls.filter(c => c.port).map(c => c.permissions), [permissions]);
    assert(!f.calls.some(c => c.snapshot)); assert(!f.calls.some(c => c.sql && /ai_personal_agent|memory|INSERT|UPDATE public/.test(c.sql)));
    assert(f.calls.some(c => c.sql?.includes('FOR UPDATE'))); assert.deepEqual(f.state(), before);
  }
});
test('R1 read-only authority succeeds only for result-read; missing ai.read or execute does not downgrade or retry', async () => {
  const f = fixture(), m = await f.publish(); f.controls.allowedPermissions = resultReadPermissions;
  await f.service.resolveForReadInTransaction(f.tx, scope, m.publication.id);
  f.calls.length = 0; await assert.rejects(f.service.resolveInTransaction(f.tx, scope, m.publication.id), status(403));
  assert.deepEqual(f.calls.filter(c => c.port).map(c => c.permissions), [executionPermissions]);
  f.controls.allowedPermissions = executionPermissions; f.calls.length = 0;
  await assert.rejects(f.service.resolveForReadInTransaction(f.tx, scope, m.publication.id), status(403));
  assert.deepEqual(f.calls.filter(c => c.port).map(c => c.permissions), [resultReadPermissions]);
  for (const method of resolverMethods) {
    const required = method === resolverMethods[0] ? executionPermissions : resultReadPermissions;
    for (const permission of required) {
      f.controls.allowedPermissions = required.filter(p => p !== permission); f.calls.length = 0;
      await assert.rejects(f.service[method](f.tx, scope, m.publication.id), status(403));
      assert.equal(f.calls.filter(c => c.port).length, 1); assert(!f.calls.some(c => c.snapshot));
    }
  }
});
test('R1 both resolver methods enforce identical publication epoch/version/binding/graph/scope/session checks', async () => {
  for (const method of resolverMethods) {
    for (const patch of [f => f.c.workflowVersionId = 'other', f => f.c.graphDigest = 'a'.repeat(64),
      f => f.c.agentBindings[0].agentVersionId = 'other', f => f.c.projectId = 'other',
      f => f.state().head.publication_epoch++, f => f.state().head.published_revision = null,
      f => f.c.graph.nodes[1].revision = 2]) {
      const f = fixture(), m = await f.publish(); patch(f); f.calls.length = 0;
      await assert.rejects(f.service[method](f.tx, scope, m.publication.id), status(409));
      assert(!f.calls.some(c => c.snapshot)); assert(!f.calls.some(c => c.sql && /ai_personal_agent|memory/.test(c.sql)));
    }
    const f = fixture(), m = await f.publish(); f.calls.length = 0;
    await assert.rejects(f.service[method](f.tx, scope, m.publication.id, async () => { throw new UnauthorizedException(); }), status(401));
    await assert.rejects(f.service[method](f.tx, { ...scope, memberId: 'other' }, m.publication.id), status(404));
    assert(!f.calls.some(c => c.snapshot));
  }
});
test('R1 result-read missing access fails 503 and metadata read keeps assets-only permission', async () => {
  const f = fixture(); await assert.rejects(new AiPersonalWorkflowPublicationService().resolveForReadInTransaction(f.tx, scope, '00000000-0000-4000-8000-000000000000'), status(503));
  assert.equal(f.calls.length, 0); f.controls.allowedPermissions = ['ai.assets.read'];
  const m = await f.service.read('member-a', 'workspace-a', 'workflow-a'); assert.equal(m.dependencyReadiness.reason, 'not_published');
  assert.deepEqual(f.calls.filter(c => c.port).map(c => c.permissions), [['ai.assets.read']]);
});
