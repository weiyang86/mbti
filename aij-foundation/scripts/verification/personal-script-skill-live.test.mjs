import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID, createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRemainingClientFixture } from './remaining-client-fixture.mjs';
import { prepareAiCenter } from './ai-center-fixture.mjs';
import { readDatabaseEnvironment, withDatabase } from '../database/connection.mjs';

const status = n => e => e.getStatus?.() === n;
const digest = s => createHash('sha256').update(s).digest('hex');
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { resolve, promise }; };
test('AF209 original Skill owner, session and fresh actual PG immutable executable extension', { timeout: 420000 }, async t => {
  assert.equal(process.env.AIJ_AF209_ROOT_ACCEPTANCE, 'true');
  const f = await createRemainingClientFixture('AF-209', { workbenchTargetSafety: true, configuration: true, secrets: true, runtimeManagement: true, pluginManagement: true, realPluginLifecycle: true });
  const proof = { task: 'AF-209', acceptanceId: f.lease.id, database: f.lease.database, checks: [] };
  const db = op => withDatabase('test', readDatabaseEnvironment('test', process.env, f.lease.id), op, { acceptanceId: f.lease.id });
  const sub = async (name, fn) => { let failed; await t.test(name, async () => { try { await fn(); proof.checks.push(name); } catch (e) { failed = e; throw e; } }); if (failed) throw failed; };
  const { AiPersonalScriptSkillService: Script } = f.requireApi('plugins/aij-ai/ai-personal-script-skill.service.js');
  const { AiPersonalSkillsService: Skill } = f.requireApi('plugins/aij-ai/ai-personal-skills.service.js');
  const { PersonalScriptSkillAccess } = f.requireApi('plugins/aij-ai/ai-personal-script-skill-contract.js');
  const { ClientAuthGuard } = f.requireApi('client-auth/client-auth.guard.js'), { ClientAuthService } = f.requireApi('client-auth/client-auth.service.js');
  const script = f.app.get(Script), owner = f.app.get(Skill), auth = f.app.get(ClientAuthService), guard = f.app.get(ClientAuthGuard);
  assert.equal(f.app.get(PersonalScriptSkillAccess), owner);
  const member = f.accounts[0].id, workspace = f.workspaces[0].id, scope = { memberId: member, workspaceId: workspace };
  const request = async (method, path, options = {}) => (await f.request(method, path, { cookie: f.cookies[0], workspaceId: workspace, ...options })).data;
  const r = { headers: { cookie: f.cookies[0] } }; await guard.canActivate({ switchToHttp: () => ({ getRequest: () => r }) });
  const claims = r.clientClaims, gate = tx => auth.assertSessionInTransaction(tx, claims);
  const counts = async () => ({ heads: await f.prisma.aiPersonalSkill.count(), versions: await f.prisma.aiPersonalSkillVersion.count(), scripts: await f.prisma.aiPersonalScriptVersion.count(), audits: await f.prisma.auditLog.count(), runs: await f.prisma.aiAgentRun.count(), jobs: await f.prisma.runtimeJob.count(), traces: await f.prisma.aiExecutionTrace.count(), budgets: await f.prisma.aiEvaluationBudgetReservation.count() });
  const role = await f.prisma.clientWorkspaceRole.findUniqueOrThrow({ where: { workspaceId_code: { workspaceId: workspace, code: 'OWNER' } } });
  const grant = async (code, on) => { const g = await f.prisma.clientWorkspaceRolePermission.findFirstOrThrow({ where: { roleId: role.id, permission: { code } } }); await f.prisma.clientWorkspaceRolePermission.update({ where: { id: g.id }, data: { deletedAt: on ? null : new Date() } }); };
  const source = 'import json\nprint(json.dumps({"value":input_data}))\n';
  let skill, ref, peer, peerClosed = true;
  const create = (extra = {}, authorize = gate, service = script) => service.createVersion(member, workspace, { skillId: skill.id, expectedRevision: ref?.revision ?? 1, name: skill.name, instructions: skill.instructions, scriptSource: source, ...extra }, authorize);
  const resolve = (read = false, identity = gate) => f.prisma.$transaction(tx => script[read ? 'resolveForReadInTransaction' : 'resolveInTransaction'](tx, scope, ref.scriptVersionId, identity));
  try {
    await sub('original prompt no-op unchanged; executable append always creates a distinct real immutable original version', async () => {
      skill = await request('POST', 'client/ai/skills', { status: 201, body: { code: 'af209-skill', name: 'Private source', instructions: 'PRIVATE_PROMPT_SENTINEL' } });
      const original = await f.prisma.aiPersonalSkillVersion.findFirstOrThrow({ where: { skillId: skill.id, revision: 1 } });
      const same = await request('PATCH', 'client/ai/skills/' + skill.id, { body: { expectedRevision: 1, name: skill.name, instructions: skill.instructions } });
      assert.equal(same.revision, 1); ref = await create(); assert.equal(ref.revision, 2); assert.notEqual(ref.skillVersionId, original.id);
      assert.equal(ref.scriptDigest, digest(source)); assert.equal((await script.readVersion(member, workspace, ref.scriptVersionId, gate)).scriptSource, source);
      const head = await request('GET', 'client/ai/skills/' + skill.id); assert.equal(head.revision, 2); assert.equal(head.instructions, skill.instructions);
      assert.deepEqual(await f.prisma.aiPersonalSkillVersion.findUniqueOrThrow({ where: { id: original.id } }), original);
      for (const key of ['scriptSource', 'sessionId', 'PRIVATE_PROMPT_SENTINEL']) assert.ok(!JSON.stringify(ref).includes(key));
      const audit = await f.prisma.auditLog.findFirstOrThrow({ where: { action: 'personal_script_version_created' } });
      assert.ok(!JSON.stringify(audit).includes(source)); assert.ok(!JSON.stringify(audit).includes('PRIVATE_PROMPT_SENTINEL'));
      assert.deepEqual((await resolve()).ref, ref);
    });
    await sub('two actual application pools wait in PG then CAS produces exactly one append and script', async () => {
      const { createApplication } = f.requireApi('bootstrap.js'); peer = await createApplication(); await peer.init(); peerClosed = false;
      const other = peer.get(Script), otherAuth = peer.get(ClientAuthService), ready = deferred(), release = deferred(), old = { ...ref }, before = await counts();
      const block = db(async c => { await c.query('BEGIN'); try { await c.query('SELECT id FROM public.ai_personal_skill WHERE id=$1 FOR UPDATE', [skill.id]); ready.resolve(); await release.promise; await c.query('COMMIT'); } catch (e) { await c.query('ROLLBACK'); throw e; } });
      await ready.promise;
      const pending = Promise.allSettled([create(), create({}, tx => otherAuth.assertSessionInTransaction(tx, claims), other)]);
      let results;
      try {
        let waiting = 0;
        for (let i = 0; i < 150; i++) { waiting = await db(async c => (await c.query("SELECT count(DISTINCT pid)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND (query LIKE '%ai_personal_skill%' OR query LIKE '%pg_advisory_xact_lock%')")).rows[0].n); if (waiting >= 2) break; await new Promise(r => setTimeout(r, 20)); }
        assert.ok(waiting >= 2); proof.concurrentApplicationWaiters = waiting; release.resolve(); await block; results = await pending;
      } finally { release.resolve(); await block; await pending; }
      assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal(results.find(r => r.status === 'rejected').reason.getStatus(), 409);
      ref = results.find(r => r.status === 'fulfilled').value; const after = await counts();
      assert.equal(ref.revision, old.revision + 1); assert.equal(after.versions, before.versions + 1); assert.equal(after.scripts, before.scripts + 1);
      await assert.rejects(script.readVersion(member, workspace, old.scriptVersionId, gate), status(409));
    });
    await sub('actual late original and extension audit errors each roll back head, version and script', async () => {
      for (const action of ['personal_skill_updated', 'personal_script_version_created']) {
        const before = await counts(), head = await f.prisma.aiPersonalSkill.findUniqueOrThrow({ where: { id: skill.id } });
        await db(c => c.query(`CREATE FUNCTION public.af209_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='${action}' THEN RAISE EXCEPTION 'owned synthetic audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER af209_audit_failure BEFORE INSERT ON public.audit_log FOR EACH ROW EXECUTE FUNCTION public.af209_audit_failure()`));
        try { await assert.rejects(create(), status(503)); }
        finally { await db(c => c.query('DROP TRIGGER af209_audit_failure ON public.audit_log; DROP FUNCTION public.af209_audit_failure()')); }
        assert.deepEqual(await counts(), before); assert.deepEqual(await f.prisma.aiPersonalSkill.findUniqueOrThrow({ where: { id: skill.id } }), head);
      }
    });
    await sub('real auth-owner session revocation inside admission prevents commit and restores all rows', async () => {
      const before = await counts(); let calls = 0;
      const late = async tx => { calls++; await auth.assertSessionInTransaction(tx, claims); if (calls === 1) await tx.clientAuthSession.update({ where: { id: claims.sessionId }, data: { status: 'revoked' } }); };
      await assert.rejects(create({}, late), status(401)); assert.equal(calls, 2); assert.deepEqual(await counts(), before);
      assert.equal((await f.prisma.clientAuthSession.findUniqueOrThrow({ where: { id: claims.sessionId } })).status, 'active');
    });
    await sub('current permission matrix and owner/session scopes are real; read mode never needs ai.execute', async () => {
      const before = await counts();
      for (const code of ['workspace.ai.assets.manage', 'workspace.ai.scripts.manage']) { await grant(code, false); try { await assert.rejects(create(), status(403)); } finally { await grant(code, true); } }
      await grant('workspace.ai.execute', false);
      try { assert.deepEqual((await resolve(true)).ref, ref); await assert.rejects(resolve(), status(403)); }
      finally { await grant('workspace.ai.execute', true); }
      for (const code of ['workspace.ai.assets.read', 'workspace.ai.read', 'workspace.ai.scripts.execute']) { await grant(code, false); try { await assert.rejects(resolve(true), status(403)); } finally { await grant(code, true); } }
      await assert.rejects(script.readVersion(f.accounts[1].id, workspace, ref.scriptVersionId, gate), status(404));
      await assert.rejects(script.readVersion(member, f.workspaces[1].id, ref.scriptVersionId, gate), status(404));
      const oldSession = await f.prisma.clientAuthSession.findUniqueOrThrow({ where: { id: claims.sessionId } });
      await f.prisma.clientAuthSession.update({ where: { id: oldSession.id }, data: { status: 'revoked' } });
      try { await assert.rejects(script.readVersion(member, workspace, ref.scriptVersionId, gate), status(401)); }
      finally { await f.prisma.clientAuthSession.update({ where: { id: oldSession.id }, data: { status: 'active' } }); }
      assert.deepEqual(await counts(), before);
    });
    await sub('PG insertion forbids late executable attachment, byte/digest/policy/scoped FK and project substitution', async () => {
      const before = await counts();
      const raw = async (tx, next, patch = {}) => {
        const row = { id: randomUUID(), projectId: next.projectId, workspaceId: workspace, memberId: member, skillId: next.skillId, skillVersionId: next.skillVersionId, revision: next.revision, source, checksum: digest(source), policy: ref.policyDigest, ...patch };
        await tx.$executeRaw`INSERT INTO public.ai_personal_script_version(id,project_id,workspace_id,member_id,skill_id,skill_version_id,revision,script_source,script_digest,policy_digest)
          VALUES(${row.id}::uuid,${row.projectId},${row.workspaceId},${row.memberId},${row.skillId},${row.skillVersionId},${row.revision},${row.source},${row.checksum},${row.policy})`;
      };
      const attempt = async (patch, late = false) => {
        try { await f.prisma.$transaction(async tx => { const current = await owner.currentInTransaction(tx, scope, skill.id, ['workspace.ai.assets.manage', 'workspace.ai.scripts.manage'], gate); const next = late ? current : await owner.appendVersionInTransaction(tx, current, { expectedRevision: current.revision, name: current.name, instructions: current.instructions }); await raw(tx, next, patch); }); return 'ACCEPTED'; }
        catch (e) { return e.meta?.code ?? 'UNKNOWN'; }
      };
      assert.equal(await attempt({}, true), '23514');
      for (const patch of [{ checksum: '0'.repeat(64) }, { policy: '0'.repeat(64) }, { source: '' }, { source: 'x'.repeat(65537) }, { workspaceId: f.workspaces[1].id }, { memberId: f.accounts[1].id }, { skillVersionId: randomUUID() }, { revision: 0 }, { projectId: randomUUID() }]) assert.equal(await attempt(patch), '23514');
      assert.deepEqual(await counts(), before);
    });
    await sub('immutable extension rejects every UPDATE DELETE TRUNCATE including empty mutations', async () => {
      for (const sql of ['UPDATE public.ai_personal_script_version SET revision=revision', 'UPDATE public.ai_personal_script_version SET revision=revision WHERE false', 'DELETE FROM public.ai_personal_script_version', 'DELETE FROM public.ai_personal_script_version WHERE false', 'TRUNCATE public.ai_personal_script_version']) {
        const code = await db(async c => { try { await c.query(sql); return null; } catch (e) { return e.code; } }); assert.equal(code, '55000');
      }
    });
    await sub('prompt-only original Agent pin survives a later script head; new executable binding cannot become a prompt', async () => {
      const config = await prepareAiCenter(f); await config.save();
      const options = await request('GET', 'client/ai/personal-agents/model-options');
      const content = { name: 'Pinned prompt', instructions: 'PRIVATE_AGENT', enabled: true, modelCode: 'advice-text', modelRevision: options.items.find(m => m.code === 'advice-text').revision,
        catalogVersion: options.catalogVersion, inputFields: ['text'], outputFormat: 'text', outputFields: [], skillBindings: [{ skillId: skill.id, revision: 1 }] };
      const agent = await request('POST', 'client/ai/personal-agents', { status: 201, body: { ...content, code: 'af209-prompt' } });
      const p = await request('GET', `client/ai/personal-agents/${agent.id}/publication`);
      await request('POST', `client/ai/personal-agents/${agent.id}/publication/publish`, { body: { expectedAgentRevision: p.revision, expectedPublicationVersion: p.publicationVersion } });
      assert.equal((await request('GET', `client/ai/personal-agents/${agent.id}/run-preview?expectedRevision=1`)).personalAgentId, agent.id);
      await request('POST', 'client/ai/personal-agents', { status: 409, body: { ...content, code: 'af209-refuse', skillBindings: [{ skillId: skill.id, revision: ref.revision }] } });
      const { AiPersonalAgentsService } = f.requireApi('plugins/aij-ai/ai-personal-agents.service.js');
      // Seed a legacy/trusted-DB Agent pin through its real immutable snapshot writer; no public API admits this binding.
      await f.prisma.$transaction(async tx => { const rows = await tx.$queryRaw`UPDATE public.ai_personal_agent SET revision=revision+1,published_revision=NULL,publication_version=publication_version+1,updated_at=CURRENT_TIMESTAMP WHERE id=${agent.id} RETURNING *`;
        await f.app.get(AiPersonalAgentsService).snapshot(tx, rows[0], [{ skillId: skill.id, skillVersionId: ref.skillVersionId, revision: ref.revision }]); });
      const next = await request('GET', `client/ai/personal-agents/${agent.id}/publication`);
      await request('POST', `client/ai/personal-agents/${agent.id}/publication/publish`, { status: 409, body: { expectedAgentRevision: next.revision, expectedPublicationVersion: next.publicationVersion } });
      await request('GET', `client/ai/personal-agents/${agent.id}/run-preview?expectedRevision=2`, { status: 409 });
      const { AiCenterRunService } = f.requireApi('plugins/aij-ai/ai-center-run.service.js');
      const before = await counts(); await assert.rejects(f.app.get(AiCenterRunService).submitPersonal(member, workspace, agent.id, { expectedRevision: 2, input: { text: 'PRIVATE_INPUT' }, idempotencyKey: 'af209-' + randomUUID() }), e => e.getStatus?.() === 409 && e.message === 'Executable Skill binding unavailable'); assert.deepEqual(await counts(), before);
    });
    await sub('source and original prompt updates invalidate old execution refs, deletion never reopens history', async () => {
      await request('PATCH', 'client/ai/skills/' + skill.id, { body: { expectedRevision: ref.revision, name: skill.name, instructions: 'Changed prompt' } });
      await assert.rejects(resolve(), status(409)); await assert.rejects(script.readVersion(member, workspace, ref.scriptVersionId, gate), status(409));
      await request('DELETE', 'client/ai/skills/' + skill.id, { body: { expectedRevision: ref.revision + 1 } });
      await assert.rejects(resolve(true), status(404)); assert.equal(await f.prisma.aiPersonalScriptVersion.count(), 2);
      const c = await counts(); for (const key of ['runs', 'jobs', 'traces', 'budgets']) assert.equal(c[key], 0);
    });
  } finally {
    if (peer) { await peer.close(); peerClosed = true; }
    proof.closure = await f.close(); proof.peerClosed = peerClosed;
    assert.equal(proof.closure.status, 'CLOSED'); assert.equal(proof.closure.applicationPools, 0); assert.equal(proof.closure.ownedSockets, 0);
    writeFileSync(join(process.cwd(), '.artifacts/auto-ai-program-20261105/W19', 'AF-209-live-' + f.lease.id + '.json'), JSON.stringify(proof, null, 2));
  }
});
