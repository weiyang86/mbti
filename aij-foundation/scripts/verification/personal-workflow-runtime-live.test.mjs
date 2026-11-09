import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createWorkflowRuntimeFixture, workflowDeferred as deferred, waitForWorkflowGate as waitGate } from './personal-workflow-runtime-fixture.mjs';
const status = n => e => e.getStatus?.() === n;
const pause = ms => new Promise(r => setTimeout(r, ms));

test('AF206 original runtime and immutable workflow origin in fresh real PG', { timeout: 660000 }, async t => {
  const f = await createWorkflowRuntimeFixture('AF-206');
  const { member, workspace, core, jobs, runs, claims, state } = f;
  const proof = { task: 'AF-206', acceptanceId: f.lease.id, database: f.lease.database, checks: [] };
  const sub = async (name, fn) => { let failure; await t.test(name, async () => { try { await fn(); proof.checks.push(name); } catch (e) { failure = e; throw e; } }); if (failure) throw failure; };
  const row = id => f.prisma.aiAgentRun.findUniqueOrThrow({ where: { id } });
  const read = id => runs.read(member, workspace, id, claims[0]);
  const recover = key => runs.recover(member, workspace, key, claims[0]);
  const dbCounts = async () => { const c = await f.counts(); return [c.runs, c.jobs, c.origins, c.reservations, c.traces, c.calls, c.credentials]; };
  const sqlOrigin = async (run, ref, session = claims[0].sessionId, code = '23503') => f.sqlRefused('INSERT INTO public.ai_personal_workflow_run_origin(run_id,project_id,workspace_id,member_id,publication_id,ref,session_id,token_version) VALUES($1,$2,$3,$4,$5::uuid,$6::jsonb,$7,$8)', [run.id, run.projectId, run.workspaceId, run.memberId, ref.id, JSON.stringify(ref), session, claims[0].tokenVersion], code);
  let completed, completedKey;
  try {
    await sub('advisory preview default-off metadata does not admit, reserve, resolve secrets or invoke transport', async () => {
      const ref = (await f.metadata()).publication, before = await dbCounts();
      process.env.AI_CENTER_CLIENT_EXECUTION_ENABLED = 'false';
      try { const p = await runs.preview(member, workspace, ref.id, claims[0]); assert.equal(p.modelExecutionConfigured, false); assert.deepEqual(p.inputFields, ['text']); assert.match(p.maximumEstimatedCostNanos, /^\d+$/); }
      finally { process.env.AI_CENTER_CLIENT_EXECUTION_ENABLED = 'true'; }
      assert.equal((await runs.preview(member, workspace, ref.id, claims[0])).modelExecutionConfigured, true);
      assert.deepEqual(await dbCounts(), before);
    });
    await sub('two original application pools concurrently admit one Run/Job/reservation/origin; actual transport/Trace once', async () => {
      const peer = await f.peerCore(), ref = (await f.metadata()).publication; completedKey = 'wf-' + randomUUID();
      const body = { publicationId: ref.id, input: { text: 'WORKFLOW_SYNTHETIC_INPUT' }, idempotencyKey: completedKey };
      const ready = deferred(), release = deferred();
      const blocked = f.db(async c => { await c.query('BEGIN'); try { await c.query('SELECT id FROM public.ai_personal_workflow WHERE id=$1 FOR UPDATE', [f.workflow.id]); ready.resolve(); await release.promise; await c.query('COMMIT'); } catch (e) { await c.query('ROLLBACK'); throw e; } });
      await ready.promise; const before = await dbCounts();
      const pending = Promise.all([core.submitWorkflow(member, workspace, body, claims[0]), peer.submitWorkflow(member, workspace, body, claims[0])]); pending.catch(() => {});
      let results;
      try {
        let waiters = 0;
        for (let i = 0; i < 150; i++) { waiters = await f.db(async c => (await c.query("SELECT count(DISTINCT pid)::int n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND (query LIKE '%ai_personal_workflow%' OR query LIKE '%pg_advisory_xact_lock%')")).rows[0].n); if (waiters >= 2) break; await pause(20); }
        assert.ok(waiters >= 2); proof.concurrentAdmissionWaiters = waiters;
        release.resolve(); await blocked; results = await pending;
      } finally { release.resolve(); await blocked; await pending.catch(() => {}); }
      assert.equal(results[0].id, results[1].id); completed = results[0].id;
      assert.deepEqual(await dbCounts(), before.map((v, i) => v + (i < 4 ? 1 : 0)));
      const job = await f.execute(); await jobs.execute(job);
      const output = await read(completed); assert.equal(output.run.status, 'succeeded'); assert.equal(output.run.output, 'WORKFLOW_SYNTHETIC_OUTPUT'); assert.equal(output.run.estimatedCostNanos, '40000');
      assert.equal((await f.prisma.runtimeJob.findUniqueOrThrow({ where: { id: job.id } })).status, 'completed');
      assert.equal(await f.prisma.aiExecutionTrace.count({ where: { jobId: job.id } }), 1); assert.equal(state.calls, 1);
      const origin = await f.prisma.aiPersonalWorkflowRunOrigin.findUniqueOrThrow({ where: { runId: completed } });
      assert.deepEqual(origin.ref, ref); assert.equal(origin.sessionId, claims[0].sessionId); assert.equal(origin.projectId, f.project.id);
      assert.ok(!JSON.stringify(output).includes(claims[0].sessionId)); assert.ok(!JSON.stringify((await row(completed)).snapshot).includes(claims[0].sessionId));
      const beforeReplay = await dbCounts(); assert.equal((await f.submit(body)).run.id, completed); assert.deepEqual(await dbCounts(), beforeReplay);
      await assert.rejects(f.submit({ ...body, input: { text: 'different' } }), status(409));
      const other = await f.makeWorkflow(); await assert.rejects(f.submit({ ...body, publicationId: other.publication.id }), status(409));
      await assert.rejects(core.submitPersonal(member, workspace, f.agent.id, { input: body.input, expectedRevision: f.agent.revision, idempotencyKey: completedKey }), status(409));
      await assert.rejects(core.submit(member, workspace, 'buddy-advice', { input: { selfType: 'A', buddyType: 'B' }, idempotencyKey: completedKey }), status(409));
      assert.deepEqual(await dbCounts(), beforeReplay);
    });
    await sub('actual origin immutable/unique/FK constraints; legacy personal hash and execution remain original', async () => {
      const stored = await row(completed), ref = (await f.metadata()).publication;
      for (const sql of ['UPDATE public.ai_personal_workflow_run_origin SET token_version=token_version WHERE run_id=$1', 'DELETE FROM public.ai_personal_workflow_run_origin WHERE run_id=$1', 'TRUNCATE public.ai_personal_workflow_run_origin']) await f.sqlRefused(sql, sql.includes('$1') ? [completed] : [], '55000');
      await sqlOrigin(stored, ref, claims[0].sessionId, '23505');
      const key = 'personal-' + randomUUID(), input = { text: 'WORKFLOW_SYNTHETIC_INPUT' };
      const legacy = await core.submitPersonal(member, workspace, f.agent.id, { input, expectedRevision: f.agent.revision, idempotencyKey: key });
      const original = await row(legacy.id), snapshot = structuredClone(original.snapshot);
      assert.equal(original.requestHash, createHash('sha256').update(JSON.stringify(['personal-agent-v1', f.agent.id, f.agent.revision, Object.entries(input)])).digest('hex'));
      snapshot.source.workflowOrigin = ref; await f.prisma.aiAgentRun.update({ where: { id: legacy.id }, data: { snapshot } });
      await sqlOrigin(original, ref, claims[1].sessionId);
      const forged = { ...ref, graphDigest: 'a'.repeat(64) }; snapshot.source.workflowOrigin = forged;
      await f.prisma.aiAgentRun.update({ where: { id: legacy.id }, data: { snapshot } }); await sqlOrigin(original, forged);
      await f.prisma.aiAgentRun.update({ where: { id: legacy.id }, data: { snapshot: original.snapshot } });
      assert.equal(await f.prisma.aiPersonalWorkflowRunOrigin.count({ where: { runId: legacy.id } }), 0);
      await f.execute(); assert.equal((await row(legacy.id)).status, 'succeeded');
    });
    await sub('real audit rejection atomically rolls original Run, Job, reservation and origin back', async () => {
      const before = await dbCounts();
      await f.db(c => c.query("CREATE FUNCTION public.af206_audit_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='personal_workflow_run_admitted' THEN RAISE EXCEPTION 'owned synthetic audit fault'; END IF; RETURN NEW; END $$; CREATE TRIGGER af206_audit_fault BEFORE INSERT ON public.audit_log FOR EACH ROW EXECUTE FUNCTION public.af206_audit_fault()"));
      try { await assert.rejects(f.submit(), status(503)); }
      finally { await f.db(c => c.query('DROP TRIGGER af206_audit_fault ON public.audit_log; DROP FUNCTION public.af206_audit_fault()')); }
      assert.deepEqual(await dbCounts(), before);
    });
    await sub('read/recovery allow ai.read without ai.execute and deny every missing read grant without effects', async () => {
      const before = await dbCounts(); await f.setGrant('workspace.ai.execute', false);
      try {
        assert.equal((await read(completed)).run.id, completed); assert.equal((await recover(completedKey)).request.id, completed);
        await assert.rejects(f.submit(), status(403)); await assert.rejects(runs.preview(member, workspace, (await f.metadata()).publication.id, claims[0]), status(403));
      } finally { await f.setGrant('workspace.ai.execute', true); }
      for (const permission of ['workspace.ai.assets.read', 'workspace.ai.read', 'workspace.ai.workflows.execute']) {
        await f.setGrant(permission, false);
        try { await assert.rejects(read(completed), status(403)); await assert.rejects(recover(completedKey), status(403)); }
        finally { await f.setGrant(permission, true); }
      } assert.deepEqual(await dbCounts(), before);
    });
    await sub('dispatch rechecks execute grant before Trace/credential/provider and releases unused reservation', async () => {
      const run = await f.submit(), before = await f.counts(); await f.setGrant('workspace.ai.execute', false);
      try { await f.execute(); } finally { await f.setGrant('workspace.ai.execute', true); }
      const after = await f.counts(), stored = await row(run.run.id);
      assert.equal(stored.status, 'failed'); assert.equal(stored.budgetStatus, 'released'); assert.equal(stored.attemptedAt, null);
      for (const key of ['traces', 'calls', 'credentials']) assert.equal(after[key], before[key]);
    });
    await sub('credential IO return rechecks original session and tokenVersion before provider', async () => {
      for (const kind of ['session', 'tokenVersion']) {
        const run = await f.submit(), before = await f.counts(), entered = deferred(), release = deferred(); state.credentialGate = { entered, release };
        const execution = f.execute(); execution.catch(() => {}); const account = await f.prisma.memberUser.findUniqueOrThrow({ where: { id: member } });
        try {
          await waitGate(entered.promise);
          if (kind === 'session') await f.prisma.clientAuthSession.update({ where: { id: claims[0].sessionId }, data: { status: 'revoked' } });
          else await f.prisma.memberUser.update({ where: { id: member }, data: { tokenVersion: { increment: 1 } } });
          release.resolve(); await execution;
          const stored = await row(run.run.id); assert.equal(stored.status, 'failed'); assert.equal(stored.attemptedAt, null); assert.equal(stored.budgetStatus, 'released'); assert.equal(state.calls, before.calls);
        } finally {
          release.resolve(); await execution.catch(() => {}); state.credentialGate = null;
          await f.prisma.clientAuthSession.update({ where: { id: claims[0].sessionId }, data: { status: 'active' } });
          await f.prisma.memberUser.update({ where: { id: member }, data: { tokenVersion: account.tokenVersion } });
        }
      }
    });
    await sub('provider IO return rechecks workflow grant; unknown retains reserve and never settles success or resends', async () => {
      const run = await f.submit(), beforeRow = await row(run.run.id), before = await f.counts(), entered = deferred(), release = deferred(); state.providerGate = { entered, release };
      const execution = f.execute(); execution.catch(() => {}); let job;
      try { await waitGate(entered.promise); await f.setGrant('workspace.ai.workflows.execute', false); release.resolve(); job = await execution; }
      finally { release.resolve(); await execution.catch(() => {}); state.providerGate = null; await f.setGrant('workspace.ai.workflows.execute', true); }
      const stored = await row(run.run.id); assert.equal(stored.status, 'unknown'); assert.equal(stored.output, null); assert.equal(stored.budgetStatus, 'reserved'); assert.equal(stored.estimatedCostNanos, beforeRow.estimatedCostNanos);
      assert.equal(state.calls, before.calls + 1); const trace = await f.prisma.aiExecutionTrace.findFirstOrThrow({ where: { jobId: job.id } }); assert.equal(trace.status, 'failed');
      await jobs.execute(job); assert.equal(state.calls, before.calls + 1); assert.equal((await recover((await row(run.run.id)).idempotencyKey)).request.status, 'unknown');
    });
    await sub('new legitimate query session reads old result; original revoked startup session still blocks dispatch', async () => {
      const next = await f.loginAgain(), queued = await f.submit(), before = await f.counts();
      await f.prisma.clientAuthSession.update({ where: { id: claims[0].sessionId }, data: { status: 'revoked' } });
      try {
        assert.equal((await runs.read(member, workspace, completed, next.claims)).run.status, 'succeeded');
        assert.equal((await runs.recover(member, workspace, completedKey, next.claims)).request.id, completed);
        await f.execute(); assert.equal((await row(queued.run.id)).status, 'failed'); assert.equal(state.calls, before.calls); assert.equal(state.credentials, before.credentials);
      } finally { await f.prisma.clientAuthSession.update({ where: { id: claims[0].sessionId }, data: { status: 'active' } }); }
    });
    await sub('actual read/recovery/preview owner results are withheld after late permission revocation', async () => {
      const { AiPersonalAgentRunPreviewsService } = f.requireApi('plugins/aij-ai/ai-personal-agent-run-previews.service.js'), previews = f.app.get(AiPersonalAgentRunPreviewsService);
      for (const kind of ['read', 'recover', 'preview']) {
        const target = kind === 'preview' ? previews : core, method = kind === 'recover' ? 'recoverRequest' : kind === 'preview' ? 'preview' : 'read';
        const original = target[method].bind(target), entered = deferred(), release = deferred(), permission = kind === 'preview' ? 'workspace.ai.execute' : 'workspace.ai.read';
        target[method] = async (...a) => { const actual = await original(...a); entered.resolve(); await release.promise; return actual; };
        const before = await dbCounts(); const pending = kind === 'preview' ? runs.preview(member, workspace, (await f.metadata()).publication.id, claims[0]) : kind === 'read' ? read(completed) : recover(completedKey); pending.catch(() => {});
        try { await waitGate(entered.promise); await f.setGrant(permission, false); release.resolve(); await assert.rejects(pending, status(403)); }
        finally { release.resolve(); await pending.catch(() => {}); target[method] = original; await f.setGrant(permission, true); }
        assert.deepEqual(await dbCounts(), before);
      }
    });
    await sub('missing relation/marker/port and unknown snapshot extension all fail before transport', async () => {
      for (const kind of ['missing-row', 'missing-marker', 'missing-port', 'missing-marker-and-port', 'unknown-extension']) {
        const ref = (await f.metadata()).publication;
        const run = kind === 'missing-row' ? await core.submitPersonal(member, workspace, f.agent.id, { input: { text: 'WORKFLOW_SYNTHETIC_INPUT' }, expectedRevision: f.agent.revision, idempotencyKey: 'personal-' + randomUUID() }) : (await f.submit()).run;
        const stored = await row(run.id), snapshot = structuredClone(stored.snapshot), port = core.workflowOrigins;
        if (kind === 'missing-row') snapshot.source.workflowOrigin = ref;
        if (kind.includes('missing-marker')) delete snapshot.source.workflowOrigin;
        if (kind === 'unknown-extension') snapshot.source.unrecognizedExtension = 'untrusted';
        await f.prisma.aiAgentRun.update({ where: { id: run.id }, data: { snapshot } });
        const before = await f.counts(); if (kind.includes('port')) core.workflowOrigins = undefined;
        try { await f.execute(); } finally { core.workflowOrigins = port; }
        const after = await f.counts(), failed = await row(run.id); assert.equal(failed.status, 'failed'); assert.equal(failed.budgetStatus, 'released');
        for (const key of ['calls', 'credentials', 'traces']) assert.equal(after[key], before[key], kind + ':' + key);
      }
    });
    await sub('workflow and Agent publication ABA and head edit reject queued sources without substitution', async () => {
      let run = await f.submit(), key = (await row(run.run.id)).idempotencyKey, before = await f.counts();
      await f.unpublish(); await f.republish(); await f.execute(); assert.equal((await row(run.run.id)).status, 'failed'); assert.equal(state.calls, before.calls);
      await assert.rejects(f.submit({ idempotencyKey: key }), status(409));
      run = await f.submit(); before = await f.counts();
      await f.request('PATCH', 'client/ai/personal-workflows/' + f.workflow.id, { body: { name: 'New draft revision', graph: f.graph, expectedRevision: 1 } });
      await f.execute(); assert.equal((await row(run.run.id)).status, 'failed'); assert.equal(state.calls, before.calls); await f.republish();
      run = await f.submit(); before = await f.counts(); await f.mutateAgent('unpublish'); await f.mutateAgent('publish'); await f.execute();
      assert.equal((await row(run.run.id)).status, 'failed'); assert.equal(state.calls, before.calls); await f.republish();
    });
    await sub('real lease expiry while waiting workflow lock after credential IO blocks provider/settlement; original reconciliation cleans', async () => {
      const run = await f.submit(), entered = deferred(), credentialRelease = deferred(), ready = deferred(), release = deferred();
      state.credentialGate = { entered, release: credentialRelease };
      const execution = f.execute(); execution.catch(() => {}); let lock, before;
      try {
        // Job admission intentionally renews its lease. Inject expiry only AFTER that real
        // admission and first Trace, while credential IO holds no DB locks.
        await waitGate(entered.promise); before = await f.counts();
        lock = f.db(async c => { await c.query('BEGIN'); try { await c.query('SELECT id FROM public.ai_personal_workflow WHERE id=$1 FOR UPDATE', [f.workflow.id]); ready.resolve(); await release.promise; await c.query('COMMIT'); } catch (e) { await c.query('ROLLBACK'); throw e; } });
        await ready.promise;
        await f.prisma.runtimeJob.update({ where: { id: (await row(run.run.id)).jobId }, data: { leaseExpiresAt: new Date(Date.now() + 1500) } });
        credentialRelease.resolve();
        let waiting = false;
        for (let i = 0; i < 100; i++) { waiting = await f.db(async c => (await c.query("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%ai_personal_workflow%') AS yes")).rows[0].yes); if (waiting) break; await pause(20); }
        assert.equal(waiting, true); await pause(1700); release.resolve(); await lock; await execution;
      } finally { credentialRelease.resolve(); release.resolve(); if (lock) await lock; await execution.catch(() => {}); state.credentialGate = null; }
      const unchanged = await row(run.run.id), after = await f.counts(); assert.equal(unchanged.status, 'running'); assert.equal(unchanged.budgetStatus, 'reserved'); assert.equal(unchanged.attemptedAt, null);
      for (const key of ['calls', 'credentials', 'traces']) assert.equal(after[key], before[key]);
      assert.equal((await jobs.claim('workflow-owned-reaper', 1, 60000)).length, 0);
      assert.equal((await core.read(member, workspace, run.run.id)).status, 'failed'); assert.equal((await row(run.run.id)).budgetStatus, 'released');
    });
    await sub('captured stale nonce has no effect; original terminal reconciliation releases without another attempt', async () => {
      const run = await f.submit(), job = await f.claim(), before = await f.counts();
      await f.prisma.runtimeJob.update({ where: { id: job.id }, data: { leaseNonce: randomUUID() } });
      await jobs.execute(job); const stored = await row(run.run.id); assert.equal(stored.status, 'queued'); assert.equal(stored.budgetStatus, 'reserved');
      const after = await f.counts(); for (const key of ['calls', 'credentials', 'traces']) assert.equal(after[key], before[key]);
      await f.prisma.runtimeJob.update({ where: { id: job.id }, data: { leaseExpiresAt: new Date(Date.now() - 1000) } });
      assert.equal((await jobs.claim('workflow-owned-reaper', 1, 60000)).length, 0); assert.equal((await core.read(member, workspace, run.run.id)).status, 'failed');
    });
    await sub('retention preserves immutable source and recovery metadata without output; other OWNER cannot read', async () => {
      const run = await f.submit(), id = run.run.id; await f.execute(); const key = (await row(id)).idempotencyKey;
      await f.prisma.aiAgentRun.update({ where: { id }, data: { expiresAt: new Date(Date.now() - 1000) } }); await core.cleanup();
      assert.equal((await row(id)).snapshot, null); assert.ok(await f.prisma.aiPersonalWorkflowRunOrigin.findUnique({ where: { runId: id } }));
      const before = await dbCounts(), recovered = await recover(key); assert.equal(recovered.request.contentAvailable, false); assert.equal(recovered.request.status, 'succeeded');
      await assert.rejects(read(id), status(410)); await assert.rejects(f.submit({ idempotencyKey: key }), status(409)); assert.deepEqual(await dbCounts(), before);
      const role = await f.prisma.clientWorkspaceRole.findUniqueOrThrow({ where: { workspaceId_code: { workspaceId: workspace, code: 'OWNER' } } });
      await f.prisma.clientWorkspaceMembership.create({ data: { workspaceId: workspace, memberId: f.accounts[1].id, roleId: role.id } });
      await assert.rejects(runs.read(f.accounts[1].id, workspace, id, claims[1]), status(404));
      const audits = await f.prisma.auditLog.findMany({ where: { action: 'personal_workflow_run_admitted' } });
      for (const value of ['WORKFLOW_PRIVATE_', 'WORKFLOW_SYNTHETIC_INPUT', 'sessionId', 'tokenVersion']) assert.ok(!JSON.stringify(audits).includes(value));
      proof.providerCalls = state.calls; proof.secretResolutions = state.credentials;
    });
  } finally {
    proof.closure = await f.close(); assert.equal(proof.closure.status, 'CLOSED');
    writeFileSync(join('.artifacts/auto-ai-program-20261105/W18', 'AF-206-live-' + f.lease.id + '.json'), JSON.stringify(proof, null, 2) + '\n', { mode: 0o600 });
  }
});
