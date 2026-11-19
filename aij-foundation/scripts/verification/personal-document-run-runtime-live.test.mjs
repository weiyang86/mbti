import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createWorkflowRuntimeFixture, workflowDeferred as deferred, waitForWorkflowGate as waitGate } from './personal-workflow-runtime-fixture.mjs';
const hash = s => createHash('sha256').update(s).digest('hex');
const status = n => e => e.getStatus?.() === n;
test('AF228 actual original admission/runtime/session/cost and durable document origin', { timeout: 600000 }, async t => {
 assert.equal(process.env.AIJ_AF228_ROOT_ACCEPTANCE, 'true');
 const f = await createWorkflowRuntimeFixture('AF-228');
 const { core, member, workspace, state, claims, jobs } = f;
 const checks = []; let failure, phase = 'SETUP', completed, completedKey, baseSource;
 const sub = async (name, fn) => { phase = name; let error; await t.test(name, async () => { try { await fn(); checks.push(name); } catch (e) { error = e; throw e; } }); if (error) throw error; };
 const { PersonalDocumentsService } = f.requireApi('documents/personal-documents.service.js');
 const documents = f.app.get(PersonalDocumentsService);
 const row = id => f.prisma.aiAgentRun.findUniqueOrThrow({ where: { id } });
 const counts = async () => [await f.prisma.aiAgentRun.count(), await f.prisma.runtimeJob.count(), await f.prisma.aiEvaluationBudgetReservation.count(), await f.prisma.aiPersonalDocumentRunOrigin.count(), await f.prisma.aiExecutionTrace.count(), state.calls, state.credentials];
 const doc = async (body = '# Source\r\nDOC_SYNTHETIC_INPUT\r\n') => documents.create(member, workspace, { code: 'doc-' + randomUUID(), name: 'Synthetic', body });
 let agent;
 const preview = (d, extra = {}, identity = claims[0]) => core.previewDocumentGeneration(member, workspace, { documentId: d.id, expectedRevision: d.revision, bodySha256: hash(d.body), sectionId: 'section-0', agentId: agent.id, agentRevision: agent.revision, instruction: 'Revise this section only.', ...extra }, identity);
 const submit = (origin, idempotencyKey = 'doc-' + randomUUID(), instruction = 'Revise this section only.', identity = claims[0], driver = core) => driver.submitDocumentGeneration(member, workspace, { origin, instruction, idempotencyKey }, identity);
 const fresh = async () => { const d = await doc(); return { document: d, origin: (await preview(d)).origin }; };
 const read = (id, identity = claims[0]) => core.readDocumentGeneration(member, workspace, id, identity);
 const recover = (key, identity = claims[0]) => core.recoverDocumentGeneration(member, workspace, key, identity);
 const mutate = d => documents.update(member, workspace, d.id, { expectedRevision: d.revision, name: d.name, body: d.body + 'changed' });
 const refreshLogin = async () => { const next = await f.loginAgain(); claims[0] = next.claims; f.cookies[0] = next.cookie; return next; };
 const insert = async (run, ref, session = claims[0].sessionId, expected = '23503', overrides = {}) => f.sqlRefused(`INSERT INTO public.ai_personal_document_run_origin(run_id,project_id,workspace_id,member_id,document_id,document_revision,agent_id,agent_version_id,agent_revision,ref,session_id,token_version)
 VALUES($1,$2,$3,$4,$5::uuid,$6,$7,$8,$9,$10::jsonb,$11,$12)`, [overrides.runId ?? run.id, overrides.projectId ?? run.projectId, run.workspaceId, run.memberId, ref.document.documentId, ref.document.revision, ref.agentId, ref.agentVersionId, ref.agentRevision, JSON.stringify(ref), session, claims[0].tokenVersion], expected);
 try {
  agent = await f.request('POST', 'client/ai/personal-agents', { status: 201, body: { ...f.content, code: 'document-agent', inputFields: ['source', 'instruction'] } });
  let p = await f.request('GET', `client/ai/personal-agents/${agent.id}/publication`);
  await f.request('POST', `client/ai/personal-agents/${agent.id}/publication/publish`, { body: { expectedAgentRevision: p.revision, expectedPublicationVersion: p.publicationVersion } });
  await sub('private advisory preview has no original Run/Job/reserve/Trace/credential/upstream writes', async () => {
   baseSource = await fresh(); const before = await counts();
   const result = await preview(baseSource.document); assert.equal(result.origin.format, 'aij-document-generation-v1'); assert.deepEqual(result.inputFields, ['source', 'instruction']); assert.equal(result.modelExecutionConfigured, true);
   process.env.AI_CENTER_CLIENT_EXECUTION_ENABLED = 'false';
   try { assert.equal((await preview(baseSource.document)).modelExecutionConfigured, false); } finally { process.env.AI_CENTER_CLIENT_EXECUTION_ENABLED = 'true'; }
   assert.deepEqual(await counts(), before);
  });
  await sub('two real original pools concurrently create one Run/Job/reservation/origin and call original HTTP/Trace once', async () => {
   const peer = await f.peerCore(), before = await counts(); completedKey = 'doc-' + randomUUID();
   const ready = deferred(), release = deferred();
   const blocked = f.db(async c => { await c.query('BEGIN'); try { await c.query('SELECT id FROM public.personal_document WHERE id=$1::uuid FOR UPDATE', [baseSource.document.id]); ready.resolve(); await release.promise; await c.query('COMMIT'); } catch (e) { await c.query('ROLLBACK'); throw e; } });
   await ready.promise;
   const pending = Promise.all([submit(baseSource.origin, completedKey), submit(baseSource.origin, completedKey, undefined, claims[0], peer)]); pending.catch(() => {});
   let result;
   try {
    let waiters = 0;
    for (let i = 0; i < 150; i++) { waiters = await f.db(async c => (await c.query("SELECT count(DISTINCT pid)::int n FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock'")).rows[0].n); if (waiters >= 2) break; await new Promise(r => setTimeout(r, 20)); }
    assert.ok(waiters >= 2); release.resolve(); await blocked; result = await pending;
   } finally { release.resolve(); await blocked; await pending.catch(() => {}); }
   assert.equal(result[0].run.id, result[1].run.id); completed = result[0].run.id;
   assert.deepEqual(await counts(), before.map((v, i) => v + (i < 4 ? 1 : 0)));
   const stored = await row(completed), relation = await f.prisma.aiPersonalDocumentRunOrigin.findUniqueOrThrow({ where: { runId: completed } });
   assert.deepEqual(relation.ref, baseSource.origin); assert.equal(relation.sessionId, claims[0].sessionId);
   await insert(stored, baseSource.origin, claims[0].sessionId, '23505');
   for (const sql of ['UPDATE public.ai_personal_document_run_origin SET token_version=token_version WHERE run_id=$1', 'DELETE FROM public.ai_personal_document_run_origin WHERE run_id=$1', 'TRUNCATE public.ai_personal_document_run_origin']) await f.sqlRefused(sql, sql.includes('$1') ? [completed] : [], '55000');
   const job = await f.execute(); await jobs.execute(job); const output = await read(completed);
   assert.equal(output.run.status, 'succeeded'); assert.equal(output.run.output, 'WORKFLOW_SYNTHETIC_OUTPUT'); assert.equal(output.run.budgetStatus, 'settled'); assert.equal(output.run.estimatedCostNanos, '40000');
   assert.equal(state.calls, 1); assert.equal(await f.prisma.aiExecutionTrace.count({ where: { jobId: job.id } }), 1);
   assert.ok(!JSON.stringify(output).includes(claims[0].sessionId)); assert.equal(stored.input.source, baseSource.document.body);
   const after = await counts(); assert.equal((await submit(baseSource.origin, completedKey)).run.id, completed); assert.deepEqual(await counts(), after);
   await assert.rejects(submit(baseSource.origin, completedKey, 'Another instruction'), status(409));
   await assert.rejects(core.submitPersonal(member, workspace, agent.id, { expectedRevision: agent.revision, input: { source: baseSource.document.body, instruction: 'Revise this section only.' }, idempotencyKey: completedKey }), status(409));
   for (const method of [() => core.readLegacy(member, workspace, completed), () => core.recoverLegacyRequest(member, workspace, completedKey), () => core.imageLegacy(member, workspace, completed)]) await assert.rejects(method(), status(404));
   assert.deepEqual(await counts(), after);
  });
  await sub('current quote source/hash/Agent epoch/catalog/model/cost and raw instruction are all bound before reserve', async () => {
   const current = await fresh(), before = await counts();
   for (const origin of [{ ...current.origin, maximumEstimatedCostNanos: '0' }, { ...current.origin, agentPublicationEpoch: current.origin.agentPublicationEpoch + 1 }, { ...current.origin, catalogVersion: current.origin.catalogVersion + 1 }, { ...current.origin, modelRevision: current.origin.modelRevision + 1 }, { ...current.origin, document: { ...current.origin.document, sectionSha256: 'a'.repeat(64) } }]) await assert.rejects(submit(origin), status(409));
   await mutate(current.document); await assert.rejects(submit(current.origin), status(409)); assert.deepEqual(await counts(), before);
  });
  await sub('actual source/redaction/raw instruction hash only use original owners without raw copies', async () => {
   const d = await doc('# Secret\nBearer doc-synthetic-token\n'), instruction = 'Use Bearer instruction-synthetic-token carefully.';
   const origin = (await preview(d, { instruction })).origin, queued = await submit(origin, undefined, instruction), stored = await row(queued.run.id);
   assert.ok(!JSON.stringify(stored.input).includes('doc-synthetic-token')); assert.ok(!JSON.stringify(stored.input).includes('instruction-synthetic-token'));
   assert.equal(origin.document.bodySha256, hash(d.body)); assert.equal(origin.instructionSha256, hash(instruction));
   assert.equal(origin.inputSha256, hash(JSON.stringify([['instruction', stored.input.instruction], ['source', stored.input.source]])));
   await f.execute(); assert.equal((await read(queued.run.id)).run.status, 'succeeded');
   const audit = await f.prisma.auditLog.findMany({ where: { action: 'personal_document_run_admitted' } });
   for (const text of ['DOC_SYNTHETIC_INPUT', 'synthetic-token', 'sessionId', 'tokenVersion']) assert.ok(!JSON.stringify(audit).includes(text));
  });
  await sub('faults after original reserve/enqueue/origin audit atomically roll all admission rows back', async () => {
   const current = await fresh();
   const { AiCenterBudgetService } = f.requireApi('plugins/aij-ai/ai-center-budget.service.js');
   for (const [owner, method] of [[f.app.get(AiCenterBudgetService), 'reserve'], [jobs, 'enqueueInTransaction']]) {
    const original = owner[method].bind(owner), before = await counts(); owner[method] = async (...args) => { await original(...args); throw Error('AF228_OWNED_FAULT'); };
    try { await assert.rejects(submit(current.origin), status(503)); } finally { owner[method] = original; }
    assert.deepEqual(await counts(), before);
   }
   const before = await counts();
   await f.db(c => c.query("CREATE FUNCTION public.af228_audit_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='personal_document_run_admitted' THEN RAISE EXCEPTION 'owned synthetic fault'; END IF; RETURN NEW; END $$; CREATE TRIGGER af228_audit_fault BEFORE INSERT ON public.audit_log FOR EACH ROW EXECUTE FUNCTION public.af228_audit_fault()"));
   try { await assert.rejects(submit(current.origin), status(503)); } finally { await f.db(c => c.query('DROP TRIGGER af228_audit_fault ON public.audit_log; DROP FUNCTION public.af228_audit_fault()')); }
   assert.deepEqual(await counts(), before);
  });
  await sub('real original Run rows exercise session/document/version/Agent FKs and mixed-origin exclusion', async () => {
   const current = await fresh(), legacy = await core.submitPersonal(member, workspace, agent.id, { input: { source: current.document.body, instruction: 'Revise this section only.' }, expectedRevision: agent.revision, idempotencyKey: 'legacy-' + randomUUID() });
   const stored = await row(legacy.id), original = structuredClone(stored.snapshot);
   const bind = async ref => { const s = structuredClone(original); s.source.documentOrigin = ref; s.source.versionId = ref.agentVersionId; await f.prisma.aiAgentRun.update({ where: { id: legacy.id }, data: { snapshot: s } }); };
   try {
    await bind(current.origin); await insert(stored, current.origin, claims[1].sessionId);
    const other = await documents.create(f.accounts[1].id, f.workspaces[1].id, { code: 'foreign-doc', name: 'Foreign', body: current.document.body });
    const wrongOwner = { ...current.origin, document: { ...current.origin.document, documentId: other.id } }; await bind(wrongOwner); await insert(stored, wrongOwner);
    const noVersion = { ...current.origin, document: { ...current.origin.document, revision: 199 } }; await bind(noVersion); await insert(stored, noVersion);
    const otherVersion = await f.prisma.aiPersonalAgentVersion.findFirstOrThrow({ where: { agentId: f.agent.id } });
    const wrongAgent = { ...current.origin, agentVersionId: otherVersion.id }; await bind(wrongAgent); await insert(stored, wrongAgent);
    const badDigest = { ...current.origin, inputSha256: 'a'.repeat(64) }; await bind(badDigest); await insert(stored, badDigest, claims[0].sessionId, '23514');
    await bind(current.origin); await insert(stored, current.origin, claims[0].sessionId, '23514', { runId: randomUUID() });
   } finally { await f.prisma.aiAgentRun.update({ where: { id: legacy.id }, data: { snapshot: original } }); }
   assert.equal(await f.prisma.aiPersonalDocumentRunOrigin.count({ where: { runId: legacy.id } }), 0); await f.execute(); assert.equal((await row(legacy.id)).status, 'succeeded');
   const documentRun = await row(completed), workflowRef = (await f.metadata()).publication;
   await f.sqlRefused('INSERT INTO public.ai_personal_workflow_run_origin(run_id,project_id,workspace_id,member_id,publication_id,ref,session_id,token_version) VALUES($1,$2,$3,$4,$5::uuid,$6::jsonb,$7,$8)', [documentRun.id, documentRun.projectId, workspace, member, workflowRef.id, JSON.stringify(workflowRef), claims[0].sessionId, claims[0].tokenVersion], '23514');
   const wf = await f.submit(), wfRow = await row(wf.run.id); await insert(wfRow, current.origin, claims[0].sessionId, '23514'); await f.execute(); assert.equal((await row(wf.run.id)).status, 'succeeded');
  });
  await sub('read and key metadata use fresh read scope without manage/export/execute and never alter runtime state', async () => {
   const before = await counts();
   for (const permission of ['workspace.documents.manage', 'workspace.documents.export', 'workspace.ai.execute']) await f.setGrant(permission, false);
   try { assert.equal((await read(completed)).run.id, completed); assert.equal((await recover(completedKey)).request.id, completed); assert.equal((await preview(baseSource.document)).origin.agentId, agent.id); await assert.rejects(submit(baseSource.origin), status(403)); }
   finally { for (const permission of ['workspace.documents.manage', 'workspace.documents.export', 'workspace.ai.execute']) await f.setGrant(permission, true); }
   for (const permission of ['workspace.documents.read', 'workspace.ai.read', 'workspace.ai.assets.read']) {
    await f.setGrant(permission, false);
    try { await assert.rejects(read(completed), status(403)); await assert.rejects(recover(completedKey), status(403)); }
    finally { await f.setGrant(permission, true); }
   }
   assert.deepEqual(await counts(), before);
  });
  await sub('dispatch current document grant/source/Agent dependency refusal makes no provider attempt and releases original budget', async () => {
   for (const reason of ['grant', 'document', 'agent']) {
    const current = await fresh(), queued = await submit(current.origin), before = state.calls;
    if (reason === 'grant') await f.setGrant('workspace.documents.manage', false);
    if (reason === 'document') await mutate(current.document);
    if (reason === 'agent') { p = await f.request('GET', `client/ai/personal-agents/${agent.id}/publication`); await f.request('POST', `client/ai/personal-agents/${agent.id}/publication/unpublish`, { body: { expectedAgentRevision: p.revision, expectedPublicationVersion: p.publicationVersion } }); }
    try { await f.execute(); const stored = await row(queued.run.id); assert.equal(stored.status, 'failed'); assert.equal(stored.budgetStatus, 'released'); assert.equal(stored.attemptedAt, null); assert.equal(state.calls, before); }
    finally { if (reason === 'grant') await f.setGrant('workspace.documents.manage', true); if (reason === 'agent') { p = await f.request('GET', `client/ai/personal-agents/${agent.id}/publication`); await f.request('POST', `client/ai/personal-agents/${agent.id}/publication/publish`, { body: { expectedAgentRevision: p.revision, expectedPublicationVersion: p.publicationVersion } }); } }
   }
  });
  await sub('queued original session revoked before dispatch makes zero Trace/credential/provider and releases original reservation', async () => {
   const current = await fresh(), queued = await submit(current.origin), before = await counts();
   await f.request('POST', 'client/auth/logout'); await f.execute();
   const stored = await row(queued.run.id); assert.equal(stored.status, 'failed'); assert.equal(stored.budgetStatus, 'released'); assert.equal(stored.attemptedAt, null);
   const after = await counts(); for (const i of [4, 5, 6]) assert.equal(after[i], before[i]); await refreshLogin();
  });
  await sub('source change after actual credential IO is caught immediately before provider and releases unattempted budget', async () => {
   const current = await fresh(), queued = await submit(current.origin), entered = deferred(), release = deferred(); state.credentialGate = { entered, release }; const before = state.calls;
   const execution = f.execute(); execution.catch(() => {});
   try { await waitGate(entered.promise); await mutate(current.document); release.resolve(); await execution; }
   finally { release.resolve(); await execution.catch(() => {}); state.credentialGate = null; }
   const stored = await row(queued.run.id); assert.equal(stored.status, 'failed'); assert.equal(stored.budgetStatus, 'released'); assert.equal(stored.attemptedAt, null); assert.equal(state.calls, before);
  });
  await sub('source change during real HTTP preserves unknown/reserved without output or automatic retry', async () => {
   const current = await fresh(), key = 'doc-' + randomUUID(), queued = await submit(current.origin, key), entered = deferred(), release = deferred(); state.providerGate = { entered, release };
   const before = state.calls, execution = f.execute(); execution.catch(() => {}); let job;
   try { await waitGate(entered.promise); await mutate(current.document); release.resolve(); job = await execution; }
   finally { release.resolve(); await execution.catch(() => {}); state.providerGate = null; }
   const stored = await row(queued.run.id); assert.equal(stored.status, 'unknown'); assert.equal(stored.budgetStatus, 'reserved'); assert.equal(stored.output, null); assert.ok(stored.attemptedAt); assert.equal(state.calls, before + 1);
   const metadata = await recover(key); assert.equal(metadata.documentCurrent, false); assert.equal(metadata.request.status, 'unknown'); assert.equal(Object.hasOwn(metadata, 'output'), false); await assert.rejects(read(queued.run.id), status(409));
   await jobs.execute(job); assert.equal(state.calls, before + 1);
  });
  await sub('current session revocation during real HTTP is unknown; metadata and completed result read use the new login', async () => {
   const readable = await submit((await fresh()).origin); await f.execute();
   const current = await fresh(), key = 'doc-' + randomUUID(), queued = await submit(current.origin, key), entered = deferred(), release = deferred(); state.providerGate = { entered, release };
   const oldClaims = claims[0], execution = f.execute(); execution.catch(() => {});
   try { await waitGate(entered.promise); await f.request('POST', 'client/auth/logout'); release.resolve(); await execution; }
   finally { release.resolve(); await execution.catch(() => {}); state.providerGate = null; }
   const stored = await row(queued.run.id); assert.equal(stored.status, 'unknown'); assert.equal(stored.budgetStatus, 'reserved'); assert.equal(stored.output, null);
   await assert.rejects(recover(key, oldClaims), status(401)); await refreshLogin(); assert.equal((await recover(key)).documentCurrent, true); assert.equal((await read(queued.run.id)).run.status, 'unknown'); assert.equal((await read(readable.run.id)).run.output, 'WORKFLOW_SYNTHETIC_OUTPUT');
  });
  await sub('nonce loss after real HTTP prevents stale settlement; original reaper and read reconciliation yield unknown/reserved', async () => {
   const current = await fresh(), queued = await submit(current.origin), entered = deferred(), release = deferred(), before = state.calls; state.providerGate = { entered, release };
   const execution = f.execute(); execution.catch(() => {}); let job;
   try { await waitGate(entered.promise); const stored = await row(queued.run.id); await f.prisma.runtimeJob.update({ where: { id: stored.jobId }, data: { leaseNonce: randomUUID() } }); release.resolve(); job = await execution; }
   finally { release.resolve(); await execution.catch(() => {}); state.providerGate = null; }
   let stored = await row(queued.run.id); assert.equal(stored.status, 'running'); assert.equal(stored.budgetStatus, 'reserved'); assert.equal(stored.output, null); assert.ok(stored.attemptedAt);
   await f.prisma.runtimeJob.update({ where: { id: stored.jobId }, data: { leaseExpiresAt: new Date(Date.now() - 1000) } }); assert.equal((await jobs.claim('doc-current-reaper', 1, 60000)).length, 0);
   assert.equal((await read(queued.run.id)).run.status, 'unknown'); stored = await row(queued.run.id); assert.equal(stored.budgetStatus, 'reserved'); assert.equal(stored.output, null); assert.equal(state.calls, before + 1); await jobs.execute(job); assert.equal(state.calls, before + 1);
  });
  await sub('captured stale nonce cannot dispatch; original reaper/reconciliation alone releases original reservation', async () => {
   const current = await fresh(), queued = await submit(current.origin), job = await f.claim(), before = state.calls;
   await f.prisma.runtimeJob.update({ where: { id: job.id }, data: { leaseNonce: randomUUID() } }); await jobs.execute(job);
   assert.equal((await row(queued.run.id)).status, 'queued'); assert.equal((await row(queued.run.id)).budgetStatus, 'reserved'); assert.equal(state.calls, before);
   await f.prisma.runtimeJob.update({ where: { id: job.id }, data: { leaseExpiresAt: new Date(Date.now() - 1000) } }); assert.equal((await jobs.claim('doc-owned-reaper', 1, 60000)).length, 0);
   assert.equal((await read(queued.run.id)).run.status, 'failed'); assert.equal((await row(queued.run.id)).budgetStatus, 'released'); assert.equal(state.calls, before);
  });
  await sub('late read and recovery revocation withhold original owner results after the first real check', async () => {
   const current = await fresh(), key = 'doc-' + randomUUID(), queued = await submit(current.origin, key); await f.execute();
   for (const method of ['read', 'recoverRequest']) {
    const original = core[method].bind(core); core[method] = async (...args) => { const result = await original(...args); await f.setGrant('workspace.documents.read', false); return result; };
    try { await assert.rejects(method === 'read' ? read(queued.run.id) : recover(key), status(403)); }
    finally { core[method] = original; await f.setGrant('workspace.documents.read', true); }
   }
  });
  await sub('retention purges only original content; durable origin still blocks all legacy projections and protects cross owner', async () => {
   const current = await fresh(), key = 'doc-' + randomUUID(), queued = await submit(current.origin, key); await f.execute();
   await f.prisma.aiAgentRun.update({ where: { id: queued.run.id }, data: { expiresAt: new Date(Date.now() - 1000) } }); await core.cleanup();
   const stored = await row(queued.run.id); assert.equal(stored.snapshot, null); assert.equal(stored.input, null); assert.equal(stored.output, null); assert.ok(stored.contentPurgedAt);
   assert.ok(await f.prisma.aiPersonalDocumentRunOrigin.findUnique({ where: { runId: queued.run.id } }));
   const before = await counts(), metadata = await recover(key); assert.equal(metadata.request.contentAvailable, false); assert.equal(metadata.documentCurrent, true); assert.equal(metadata.request.status, 'succeeded');
   await assert.rejects(read(queued.run.id), status(410)); await assert.rejects(submit(current.origin, key), status(410));
   const originPort = core.documentOrigins; core.documentOrigins = undefined;
   try { for (const work of [() => core.readLegacy(member, workspace, queued.run.id), () => core.recoverLegacyRequest(member, workspace, key), () => core.imageLegacy(member, workspace, queued.run.id)]) await assert.rejects(work(), status(404)); }
   finally { core.documentOrigins = originPort; }
   const role = await f.prisma.clientWorkspaceRole.findUniqueOrThrow({ where: { workspaceId_code: { workspaceId: workspace, code: 'OWNER' } } }); await f.prisma.clientWorkspaceMembership.create({ data: { workspaceId: workspace, memberId: f.accounts[1].id, roleId: role.id } });
   await assert.rejects(core.readDocumentGeneration(f.accounts[1].id, workspace, queued.run.id, claims[1]), status(404)); assert.deepEqual(await counts(), before);
  });
  await writeFile(join(f.artifactDirectory, 'document-runtime-proof.json'), JSON.stringify({ task: 'AF-228', status: 'PASS', acceptanceId: f.lease.id, checks, providerCalls: state.calls, originalRunJobTraceCostOwners: true, durableOriginRetained: true, nativeOrPage: 'NOT_IN_THIS_CARD', ownerAcceptance: 'PENDING' }, null, 2), { mode: 0o600 });
 } catch (error) { failure = error; await writeFile(join(f.artifactDirectory, 'document-runtime-failure.json'), JSON.stringify({ phase, code: error?.code ?? 'FAILED', frames: String(error?.stack ?? '').split('\n').filter(line => /^\s+at /.test(line)).slice(0, 8) }, null, 2), { mode: 0o600 }); }
 finally { const closed = await f.close(); assert.equal(closed.status, 'CLOSED'); assert.equal(closed.applicationPools0, true); assert.equal(closed.providerClosed, true); }
 if (failure) throw Error('AF228_RUNTIME_FAILED_AT_' + phase);
});
