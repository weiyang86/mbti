// ROOT ONLY; Worker checks syntax only. No skip/pass fallback for missing wiring.
import assert from 'node:assert/strict';
import test from 'node:test';
import { startWorkbenchTargetRuntime } from './workbench-sdk-target-runtime.mjs';
const options = { task: 'AF-198', transport: 'AiCenterHttpTransport:owned-loopback', concurrency: 1, freshLease: true };
test('AF198 fresh same-task real App/PG/transport/Job/Trace with current fences and zero resources', { timeout: 360000 }, async () => {
  const beforeFetch = globalThis.fetch, beforeEnvironment = { ...process.env };
  const f = await startWorkbenchTargetRuntime(options);
  let closure;
  try {
    assert.equal(f.task, 'AF-198'); assert.equal(f.approvedLeaseTask, f.task);
    await assert.rejects(startWorkbenchTargetRuntime(options), /RUNTIME_BUSY|ROOT_OPT_IN_REQUIRED/);
    assert.deepEqual(await f.counters(), { runs: 0, jobs: 0, traces: 0, upstream: 0, submits: 0 });
    assert.equal((await f.verifyTransportFence()).upstream, 0);
    const result = await f.request({ method: 'POST', path: 'client/ai/agents/general-text/runs', body: { idempotencyKey: 'af198-single-run', input: { goal: 'Synthetic acceptance goal' } } });
    assert.equal(result.status, 202); const id = result.body.data.id;
    assert.deepEqual(await f.counters(), { runs: 1, jobs: 1, traces: 0, upstream: 0, submits: 1 });
    assert.equal((await f.pumpJobs()).length, 1); assert.deepEqual(await f.pumpJobs(), []);
    const read = await f.request({ path: `client/ai/runs/${id}` });
    assert.equal(read.status, 200); assert.equal(read.body.data.output, 'Synthetic goal completed.');
    assert.equal(read.body.data.budgetStatus, 'settled'); assert.equal(read.body.data.status, 'succeeded');
    const db = await f.databaseSnapshot(id);
    assert.equal(db.run.id, id); assert.equal(db.run.workspaceId, f.workspaceId); assert.equal(db.run.memberId, f.memberId);
    assert.equal(db.job.id, db.run.jobId); assert.equal(db.job.status, 'completed'); assert.equal(db.job.attempts, 1);
    assert.equal(db.traces.length, 1); assert.equal(db.traces[0].jobId, db.job.id); assert.equal(db.traces[0].attempt, 1);
    assert.equal(db.traces[0].status, 'succeeded'); assert.equal(db.run.budgetStatus, 'settled');
    assert.equal(db.traces[0].costSource, 'unreported'); assert.equal(db.traces[0].costAmountNanos, null);
    assert.deepEqual(await f.counters(), { runs: 1, jobs: 1, traces: 1, upstream: 1, submits: 1 });
    assert.deepEqual(f.transportEvidence(), { unchanged: true, ownOverride: false, forwarded: 1, upstream: 1, rejected: 1 });
    await f.verifyTransportFence();
    assert.equal((await f.request({ actor: null, path: `client/ai/runs/${id}` })).status, 401);
    assert.equal((await f.request({ actor: 'no-permission', path: `client/ai/runs/${id}` })).status, 403);
    assert.equal((await f.request({ actor: 'other', path: 'client/ai/agents' })).status, 403);
    assert.equal((await f.request({ actor: 'other', path: `client/ai/runs/${id}` })).status, 404);
    assert.equal((await f.request({ path: 'client/workspaces/context', workspaceId: f.workspaceIds.second })).status, 200);
    assert.equal((await f.request({ path: `client/ai/runs/${id}`, workspaceId: f.workspaceIds.second })).status, 404);
    await f.withOwnerReadOnly(async () => assert.equal((await f.request({ path: 'client/ai/agents' })).status, 403));
    assert.equal((await f.request({ path: 'client/ai/agents' })).status, 200);
    await f.revokeOwnerSessions();
    assert.equal((await f.request({ path: `client/ai/runs/${id}` })).status, 401);
    assert.deepEqual(await f.counters(), { runs: 1, jobs: 1, traces: 1, upstream: 1, submits: 1 });
  } finally { closure = await f.close(); }
  assert.equal(closure.applicationPools0, true); assert.equal(closure.ownedSockets0, true); assert.equal(closure.fetchRestored, true);
  assert.equal(globalThis.fetch, beforeFetch); assert.deepEqual({ ...process.env }, beforeEnvironment);
  assert.deepEqual(await f.close(), closure);
  await assert.rejects(f.counters(), /RUNTIME_CLOSED/);
});
