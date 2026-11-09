import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRemainingClientFixture } from './remaining-client-fixture.mjs';
import { prepareAiCenter } from './ai-center-fixture.mjs';
import { readDatabaseEnvironment, withDatabase } from '../database/connection.mjs';

const status = code => error => error.getStatus?.() === code;
const edge = (from, to) => ({ from, port: 'next', to, input: 'in' });
const counters = m => ({ expectedRevision: m.revision, expectedPublicationEpoch: m.publicationEpoch });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { resolve, promise }; };

test('AF205 original API/auth/owners and fresh protected PG workflow publication', { timeout: 460000 }, async t => {
  assert.equal(process.env.AIJ_AF205_ROOT_ACCEPTANCE, 'true');
  const f = await createRemainingClientFixture('AF-205', { workbenchTargetSafety: true, configuration: true, secrets: true,
    runtimeManagement: true, pluginManagement: true, realPluginLifecycle: true });
  const proof = { task: 'AF-205', acceptanceId: f.lease.id, database: f.lease.database, checks: [] };
  const db = op => withDatabase('test', readDatabaseEnvironment('test', process.env, f.lease.id), op, { acceptanceId: f.lease.id });
  const sqlRefused = async (sql, values, expected) => {
    // Observe actual PG SQLSTATE before the connection owner deliberately redacts its errors.
    const code = await db(async c => { try { await c.query(sql, values); return null; } catch (e) { return /^[0-9A-Z]{5}$/.test(e.code) ? e.code : 'UNKNOWN'; } });
    assert.equal(code, expected);
  };
  const sub = async (name, fn) => { let failure; await t.test(name, async () => { try { await fn(); proof.checks.push(name); } catch (e) { failure = e; throw e; } }); if (failure) throw failure; };
  const member = f.accounts[0].id, workspace = f.workspaces[0].id;
  const { AiPersonalWorkflowPublicationService } = f.requireApi('plugins/aij-ai/ai-personal-workflow-publication.service.js');
  const { AiPersonalWorkflowsService } = f.requireApi('plugins/aij-ai/ai-personal-workflows.service.js');
  const { AiPersonalAgentSnapshotsService } = f.requireApi('plugins/aij-ai/ai-personal-agent-snapshots.service.js');
  const { ClientAuthGuard } = f.requireApi('client-auth/client-auth.guard.js');
  const { ClientAuthService } = f.requireApi('client-auth/client-auth.service.js');
  const { SecretRefPort } = f.requireApi('secret-center/secret-ref.js');
  const { AiCenterHttpTransport } = f.requireApi('plugins/aij-ai/ai-center-provider.js');
  const pub = f.app.get(AiPersonalWorkflowPublicationService), drafts = f.app.get(AiPersonalWorkflowsService), snapshots = f.app.get(AiPersonalAgentSnapshotsService);
  let peer;
  let resolved = 0, upstream = 0, snapshotCalls = 0;
  const secrets = f.app.get(SecretRefPort), originalSecret = secrets.resolveTrusted.bind(secrets);
  secrets.resolveTrusted = (...a) => { resolved++; return originalSecret(...a); };
  f.app.get(AiCenterHttpTransport).request = async () => { upstream++; throw new Error('Unexpected provider call'); };
  const originalSnapshot = snapshots.resolve.bind(snapshots);
  snapshots.resolve = (...a) => { snapshotCalls++; return originalSnapshot(...a); };
  const guard = f.app.get(ClientAuthGuard), auth = f.app.get(ClientAuthService);
  const claims = [];
  const request = async (method, path, options = {}) => (await f.request(method, path, { cookie: f.cookies[0], workspaceId: workspace, ...options })).data;
  const counts = async () => [await f.prisma.aiAgentRun.count(), await f.prisma.runtimeJob.count(), await f.prisma.aiEvaluationBudgetReservation.count(), await f.prisma.aiExecutionTrace.count(), upstream, resolved];
  const metadata = id => pub.read(member, workspace, id, gate);
  let gate, agent, skill, workflow, content, version, baseline;
  const graph = () => ({ schemaVersion: 1, inputKeys: ['text'], nodes: [{ id: 's', type: 'start' }, { id: 'a', type: 'agent', agentId: agent.id, revision: agent.revision }, { id: 'e', type: 'end' }], edges: [edge('s', 'a'), edge('a', 'e')] });
  const publish = (m, id = workflow.id) => pub.publish(member, workspace, { workflowId: id, ...counters(m) }, gate);
  const resolve = (id, read = false) => f.prisma.$transaction(tx => pub[read ? 'resolveForReadInTransaction' : 'resolveInTransaction'](tx, { memberId: member, workspaceId: workspace }, id, gate));
  try {
    for (const cookie of f.cookies) { const r = { headers: { cookie } }; await guard.canActivate({ switchToHttp: () => ({ getRequest: () => r }) }); claims.push(r.clientClaims); }
    gate = tx => auth.assertSessionInTransaction(tx, claims[0]);
    baseline = await counts();
    await sub('unconfigured catalog does not change original draft CRUD or create execution records', async () => {
      const g = { schemaVersion: 1, inputKeys: [], nodes: [{ id: 's', type: 'start' }, { id: 'e', type: 'end' }], edges: [edge('s', 'e')] };
      const saved = await request('POST', 'client/ai/personal-workflows', { status: 201, body: { code: 'af205-empty', name: 'Unconfigured draft', graph: g } });
      assert.equal(saved.status, 'DRAFT'); assert.equal((await metadata(saved.id)).dependencyReadiness.reason, 'not_published');
      await assert.rejects(publish(await metadata(saved.id), saved.id), status(400));
      assert.equal((await request('GET', 'client/ai/personal-workflows/' + saved.id)).revision, 1);
      assert.deepEqual(await counts(), baseline);
    });
    const config = await prepareAiCenter(f); await config.save();
    skill = await request('POST', 'client/ai/skills', { status: 201, body: { code: 'af205-skill', name: 'Synthetic Skill', instructions: 'AF205_PRIVATE_SKILL' } });
    const options = await request('GET', 'client/ai/personal-agents/model-options');
    content = { name: 'Synthetic Agent', instructions: 'AF205_PRIVATE_INSTRUCTIONS', enabled: true, modelCode: 'advice-text', modelRevision: options.items.find(m => m.code === 'advice-text').revision,
      catalogVersion: options.catalogVersion, inputFields: ['text'], outputFormat: 'text', outputFields: [], skillBindings: [{ skillId: skill.id, revision: 1 }] };
    agent = await request('POST', 'client/ai/personal-agents', { status: 201, body: { ...content, code: 'af205-agent' } });
    const ap = await request('GET', `client/ai/personal-agents/${agent.id}/publication`);
    await request('POST', `client/ai/personal-agents/${agent.id}/publication/publish`, { body: { expectedAgentRevision: ap.revision, expectedPublicationVersion: ap.publicationVersion } });
    workflow = await request('POST', 'client/ai/personal-workflows', { status: 201, body: { code: 'af205-linear', name: 'AF205_PRIVATE_NAME', graph: graph() } });
    version = await f.prisma.aiPersonalWorkflowVersion.findFirstOrThrow({ where: { workflowId: workflow.id, revision: 1 } });
    await sub('concurrent actual PG publish CAS, exact noop, immutable version and metadata projection', async () => {
      const { createApplication } = f.requireApi('bootstrap.js'); peer = await createApplication(); await peer.init();
      const other = peer.get(AiPersonalWorkflowPublicationService), peerAuth = peer.get(ClientAuthService);
      const m = await metadata(workflow.id), ready = deferred(), release = deferred();
      const blocker = db(async c => { await c.query('BEGIN'); try { await c.query('SELECT id FROM public.ai_personal_workflow WHERE id=$1 FOR UPDATE', [workflow.id]); ready.resolve(); await release.promise; await c.query('COMMIT'); } catch (e) { await c.query('ROLLBACK'); throw e; } });
      await ready.promise;
      const pending = Promise.allSettled([publish(m), other.publish(member, workspace, { workflowId: workflow.id, ...counters(m) }, tx => peerAuth.assertSessionInTransaction(tx, claims[0]))]);
      let results;
      try {
        let waiting = 0;
        for (let i = 0; i < 150; i++) { waiting = await db(async c => (await c.query("SELECT count(DISTINCT pid)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND (query LIKE '%ai_personal_workflow%' OR query LIKE '%pg_advisory_xact_lock%')")).rows[0].n); if (waiting >= 2) break; await new Promise(r => setTimeout(r, 20)); }
        assert.ok(waiting >= 2, 'two original application pools must actually wait concurrently in PG'); proof.concurrentApplicationWaiters = waiting;
        release.resolve(); await blocker; results = await pending;
      } finally { release.resolve(); await blocker; await pending; }
      assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
      assert.equal(results.find(r => r.status === 'rejected').reason.getStatus(), 409);
      const published = await metadata(workflow.id), ref = published.publication;
      assert.equal(published.publicationEpoch, 1); assert.equal(ref.workflowVersionId, version.id); assert.equal(ref.agentId, agent.id);
      const audits = await f.prisma.auditLog.count({ where: { action: 'personal_workflow_published', resourceId: workflow.id } });
      assert.deepEqual(await publish(published), published);
      assert.equal(await f.prisma.auditLog.count({ where: { action: 'personal_workflow_published', resourceId: workflow.id } }), audits);
      assert.equal(await f.prisma.aiPersonalWorkflowPublication.count({ where: { workflowId: workflow.id } }), 1);
      for (const secret of ['AF205_PRIVATE_NAME', 'AF205_PRIVATE_INSTRUCTIONS', 'AF205_PRIVATE_SKILL', 'sessionId', 'credentialRef']) assert.ok(!JSON.stringify(published).includes(secret));
      assert.deepEqual((await resolve(ref.id)).ref, ref);
    });
    await sub('runtime resolver checks workflow/session without Agent locks; read needs ai.read without ai.execute', async () => {
      const ref = (await metadata(workflow.id)).publication;
      const owner = await f.prisma.clientWorkspaceRole.findUniqueOrThrow({ where: { workspaceId_code: { workspaceId: workspace, code: 'OWNER' } } });
      const grant = async code => f.prisma.clientWorkspaceRolePermission.findFirstOrThrow({ where: { roleId: owner.id, permission: { code } } });
      const execute = await grant('workspace.ai.execute'), read = await grant('workspace.ai.read');
      snapshotCalls = 0;
      await f.prisma.clientWorkspaceRolePermission.update({ where: { id: execute.id }, data: { deletedAt: new Date() } });
      try { assert.deepEqual((await resolve(ref.id, true)).ref, ref); await assert.rejects(resolve(ref.id), status(403)); assert.equal(snapshotCalls, 0); }
      finally { await f.prisma.clientWorkspaceRolePermission.update({ where: { id: execute.id }, data: { deletedAt: null } }); }
      await f.prisma.clientWorkspaceRolePermission.update({ where: { id: read.id }, data: { deletedAt: new Date() } });
      try { await assert.rejects(resolve(ref.id, true), status(403)); assert.equal((await resolve(ref.id)).ref.id, ref.id); assert.equal(snapshotCalls, 0); }
      finally { await f.prisma.clientWorkspaceRolePermission.update({ where: { id: read.id }, data: { deletedAt: null } }); }
      await assert.rejects(f.prisma.$transaction(tx => drafts.publicationCurrentInTransaction(tx, { memberId: member, workspaceId: workspace }, workflow.id, ['invented.permission'], gate)), status(403));
      const ready = deferred(), release = deferred();
      const locked = db(async c => { await c.query('BEGIN'); try { await c.query('SELECT id FROM public.ai_personal_agent WHERE id=$1 FOR UPDATE', [agent.id]); ready.resolve(); await release.promise; await c.query('COMMIT'); } catch (e) { await c.query('ROLLBACK'); throw e; } });
      await ready.promise;
      let timer; const current = Promise.all([resolve(ref.id), resolve(ref.id, true)]);
      try {
        await Promise.race([current, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Runtime resolver waited for mutable Agent')), 5000); })]);
        assert.equal(snapshotCalls, 0);
      } finally { clearTimeout(timer); release.resolve(); await locked; await current.catch(() => {}); }
      assert.deepEqual(await counts(), baseline);
    });
    await sub('unpublish/republish ABA retains snapshots and rejects old epoch/CAS', async () => {
      const before = await metadata(workflow.id), old = before.publication;
      const revoked = await pub.unpublish(member, workspace, workflow.id, counters(before), gate);
      assert.equal(revoked.publication, null); assert.equal(revoked.publicationEpoch, 2);
      assert.deepEqual(await pub.unpublish(member, workspace, workflow.id, counters(revoked), gate), revoked);
      await assert.rejects(resolve(old.id), status(409));
      const again = await publish(revoked); assert.equal(again.publicationEpoch, 3); assert.notEqual(again.publication.id, old.id);
      assert.equal(again.publication.workflowVersionId, old.workflowVersionId);
      await assert.rejects(publish(before), status(409));
      assert.equal(await f.prisma.aiPersonalWorkflowPublication.count({ where: { workflowId: workflow.id } }), 2);
    });
    await sub('original draft update preserves prior publication as stale and keeps original identity guards', async () => {
      const previous = await metadata(workflow.id);
      await request('PATCH', 'client/ai/personal-workflows/' + workflow.id, { body: { name: 'Revision two', graph: graph(), expectedRevision: 1 } });
      const stale = await metadata(workflow.id); assert.equal(stale.revision, 2); assert.equal(stale.publishedRevision, 1); assert.equal(stale.dependencyReadiness.reason, 'revision_changed');
      await assert.rejects(resolve(previous.publication.id), status(409));
      for (const sql of ["UPDATE public.ai_personal_workflow SET code='forged' WHERE id=$1", "UPDATE public.ai_personal_workflow SET name='forged' WHERE id=$1", 'UPDATE public.ai_personal_workflow SET publication_epoch=publication_epoch+1 WHERE id=$1']) await assert.rejects(db(c => c.query(sql, [workflow.id])));
      const next = await publish(stale); assert.equal(next.publication.revision, 2); assert.notEqual(next.publication.workflowVersionId, version.id);
      assert.equal((await request('GET', `client/ai/personal-workflows/${workflow.id}/versions/1`)).name, 'AF205_PRIVATE_NAME');
    });
    await sub('real audit trigger failure rolls publication/head/epoch back atomically', async () => {
      const before = await metadata(workflow.id), rows = await f.prisma.aiPersonalWorkflowPublication.count();
      await db(c => c.query("CREATE FUNCTION public.af205_audit_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action IN ('personal_workflow_published','personal_workflow_unpublished') THEN RAISE EXCEPTION 'owned synthetic audit fault'; END IF; RETURN NEW; END $$; CREATE TRIGGER af205_audit_fault BEFORE INSERT ON public.audit_log FOR EACH ROW EXECUTE FUNCTION public.af205_audit_fault()"));
      try { await assert.rejects(pub.unpublish(member, workspace, workflow.id, counters(before), gate), status(503)); }
      finally { await db(c => c.query('DROP TRIGGER af205_audit_fault ON public.audit_log; DROP FUNCTION public.af205_audit_fault()')); }
      assert.deepEqual(await metadata(workflow.id), before); assert.equal(await f.prisma.aiPersonalWorkflowPublication.count(), rows);
      const unpub = await pub.unpublish(member, workspace, workflow.id, counters(before), gate);
      await db(c => c.query("CREATE FUNCTION public.af205_audit_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='personal_workflow_published' THEN RAISE EXCEPTION 'owned synthetic audit fault'; END IF; RETURN NEW; END $$; CREATE TRIGGER af205_audit_fault BEFORE INSERT ON public.audit_log FOR EACH ROW EXECUTE FUNCTION public.af205_audit_fault()"));
      try { await assert.rejects(publish(unpub), status(503)); }
      finally { await db(c => c.query('DROP TRIGGER af205_audit_fault ON public.audit_log; DROP FUNCTION public.af205_audit_fault()')); }
      assert.deepEqual(await metadata(workflow.id), unpub); assert.equal(await f.prisma.aiPersonalWorkflowPublication.count(), rows);
      await publish(unpub);
    });
    await sub('actual immutable SQL/compound FK/ref checks and no authority resurrection on backfill', async () => {
      const m = await metadata(workflow.id), ref = m.publication;
      // CASCADE reaches the immutable trigger even after a downstream provenance FK exists.
      // This must reject in the owned synthetic DB; an FK planner refusal alone is not trigger proof.
      for (const sql of ['UPDATE public.ai_personal_workflow_publication SET revision=revision WHERE id=$1::uuid', 'DELETE FROM public.ai_personal_workflow_publication WHERE id=$1::uuid', 'TRUNCATE public.ai_personal_workflow_publication CASCADE']) await sqlRefused(sql, sql.includes('$1') ? [ref.id] : [], '55000');
      for (const [column, value] of [['project_id', randomUUID()], ['workflow_version_id', randomUUID()], ['agent_version_id', randomUUID()]]) {
        assert.match(column, /^[a-z_]+$/);
        await sqlRefused(`INSERT INTO public.ai_personal_workflow_publication(id,project_id,workspace_id,member_id,workflow_id,workflow_version_id,revision,graph_digest,publication_epoch,node_id,agent_id,agent_version_id,agent_revision,agent_publication_epoch)
          SELECT $2::uuid,${column === 'project_id' ? '$3' : 'project_id'},workspace_id,member_id,workflow_id,${column === 'workflow_version_id' ? '$3' : 'workflow_version_id'},revision,graph_digest,publication_epoch+1,node_id,agent_id,${column === 'agent_version_id' ? '$3' : 'agent_version_id'},agent_revision,agent_publication_epoch FROM public.ai_personal_workflow_publication WHERE id=$1::uuid`, [ref.id, randomUUID(), value], '23503');
      }
      const row = await f.prisma.aiPersonalWorkflowPublication.findUniqueOrThrow({ where: { id: ref.id } }); assert.deepEqual(row.ref, ref);
      const role = await f.prisma.clientWorkspaceRole.findUniqueOrThrow({ where: { workspaceId_code: { workspaceId: workspace, code: 'OWNER' } } });
      const permission = await f.prisma.clientWorkspacePermission.findUniqueOrThrow({ where: { code: 'workspace.ai.workflows.publish' } });
      const grant = await f.prisma.clientWorkspaceRolePermission.findUniqueOrThrow({ where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } } });
      await f.prisma.clientWorkspaceRolePermission.update({ where: { id: grant.id }, data: { deletedAt: new Date() } });
      const migration = readFileSync('apps/api/prisma/migrations/20261107020000_personal_workflow_publication/migration.sql', 'utf8');
      try { await db(c => c.query(migration.slice(migration.indexOf('INSERT INTO public.client_workspace_permission')))); assert.ok((await f.prisma.clientWorkspaceRolePermission.findUniqueOrThrow({ where: { id: grant.id } })).deletedAt); await assert.rejects(publish(m), status(403)); }
      finally { await f.prisma.clientWorkspaceRolePermission.update({ where: { id: grant.id }, data: { deletedAt: null } }); }
      await f.prisma.clientWorkspacePermission.update({ where: { id: permission.id }, data: { status: 'disabled' } });
      try { await db(c => c.query(migration.slice(migration.indexOf('INSERT INTO public.client_workspace_permission')))); assert.equal((await f.prisma.clientWorkspacePermission.findUniqueOrThrow({ where: { id: permission.id } })).status, 'disabled'); await assert.rejects(publish(m), status(403)); }
      finally { await f.prisma.clientWorkspacePermission.update({ where: { id: permission.id }, data: { status: 'active' } }); }
    });
    await sub('session revoked while workflow row is locked is rejected after real PG wait', async () => {
      const m = await metadata(workflow.id), ready = deferred(), release = deferred();
      const lock = db(async c => { await c.query('BEGIN'); try { await c.query('SELECT id FROM public.ai_personal_workflow WHERE id=$1 FOR UPDATE', [workflow.id]); ready.resolve(); await release.promise; await c.query('COMMIT'); } catch (e) { await c.query('ROLLBACK'); throw e; } });
      await ready.promise; const pending = publish(m); pending.catch(() => {});
      try {
        let blocked = false;
        for (let i = 0; i < 150; i++) { blocked = await db(async c => (await c.query("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE '%ai_personal_workflow%') AS yes")).rows[0].yes); if (blocked) break; await new Promise(r => setTimeout(r, 20)); }
        assert.equal(blocked, true);
        // The original app intentionally has a one-connection pool and is waiting;
        // revoke through an independent protected PG connection, as another actor would.
        await db(c => c.query("UPDATE public.client_auth_session SET status='revoked' WHERE id=$1", [claims[0].sessionId]));
        release.resolve(); await lock; await assert.rejects(pending, status(401));
      } finally { release.resolve(); await lock; await pending.catch(() => {}); await f.prisma.clientAuthSession.update({ where: { id: claims[0].sessionId }, data: { status: 'active' } }); }
      assert.deepEqual(await metadata(workflow.id), m);
      const account = await f.prisma.memberUser.findUniqueOrThrow({ where: { id: member } });
      await f.prisma.memberUser.update({ where: { id: member }, data: { tokenVersion: { increment: 1 } } });
      try { await assert.rejects(publish(m), status(401)); }
      finally { await f.prisma.memberUser.update({ where: { id: member }, data: { tokenVersion: account.tokenVersion } }); }
    });
    await sub('other OWNER stays private, dependency ABA disables execution, original draft stays readable', async () => {
      const role = await f.prisma.clientWorkspaceRole.findUniqueOrThrow({ where: { workspaceId_code: { workspaceId: workspace, code: 'OWNER' } } });
      await f.prisma.clientWorkspaceMembership.create({ data: { workspaceId: workspace, memberId: f.accounts[1].id, roleId: role.id } });
      await assert.rejects(pub.read(f.accounts[1].id, workspace, workflow.id, tx => auth.assertSessionInTransaction(tx, claims[1])), status(404));
      let ap = await request('GET', `client/ai/personal-agents/${agent.id}/publication`);
      const mutation = () => ({ expectedAgentRevision: ap.revision, expectedPublicationVersion: ap.publicationVersion });
      ap = await request('POST', `client/ai/personal-agents/${agent.id}/publication/unpublish`, { body: mutation() });
      assert.equal((await metadata(workflow.id)).dependencyReadiness.ready, false);
      ap = await request('POST', `client/ai/personal-agents/${agent.id}/publication/publish`, { body: mutation() });
      const stale = await metadata(workflow.id); assert.equal(stale.dependencyReadiness.ready, false);
      const repaired = await publish(stale); assert.equal(repaired.dependencyReadiness.ready, true); assert.equal(repaired.publication.agentPublicationEpoch, ap.publicationVersion);
      await request('DELETE', 'client/ai/skills/' + skill.id, { body: { expectedRevision: 1 } });
      assert.equal((await metadata(workflow.id)).dependencyReadiness.ready, false); await assert.rejects(publish(await metadata(workflow.id)), e => [404, 409].includes(e.getStatus?.()));
      assert.equal((await request('GET', 'client/ai/personal-workflows/' + workflow.id)).revision, 2);
    });
    await sub('delete keeps retained publication history and original tombstone refusal; no execution side effects', async () => {
      const before = await f.prisma.aiPersonalWorkflowPublication.count();
      await request('DELETE', 'client/ai/personal-workflows/' + workflow.id, { body: { expectedRevision: 2 } });
      await assert.rejects(metadata(workflow.id), status(404));
      await assert.rejects(db(c => c.query('UPDATE public.ai_personal_workflow SET deleted_at=NULL WHERE id=$1', [workflow.id])));
      assert.equal(await f.prisma.aiPersonalWorkflowPublication.count(), before);
      assert.deepEqual(await counts(), baseline);
      const audits = await f.prisma.auditLog.findMany({ where: { action: { in: ['personal_workflow_published', 'personal_workflow_unpublished'] } } });
      for (const value of ['AF205_PRIVATE_', 'sessionId', 'credentialRef']) assert.ok(!JSON.stringify(audits).includes(value));
      proof.runJobBudgetTraceUnchanged = true; proof.providerCalls = upstream; proof.secretResolutions = resolved;
    });
  } finally {
    if (peer) { await peer.close(); proof.peerClosed = true; }
    const closure = await f.close(); proof.closure = closure; assert.equal(closure.status, 'CLOSED');
    assert.equal(closure.applicationPools, 0); assert.equal(closure.ownedSockets, 0);
    writeFileSync(join('.artifacts/auto-ai-program-20261105/W18', 'AF-205-live-' + f.lease.id + '.json'), JSON.stringify(proof, null, 2) + '\n', { mode: 0o600 });
  }
});
