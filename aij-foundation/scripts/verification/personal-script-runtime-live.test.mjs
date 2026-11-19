import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRemainingClientFixture } from './remaining-client-fixture.mjs';
import { readDatabaseEnvironment, withDatabase } from '../database/connection.mjs';

const status = n => error => error.getStatus?.() === n;
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const receipt = JSON.parse(readFileSync('.artifacts/auto-ai-program-20261105/AF-175/image-receipt.json'));
test('AF210 real original Job, private version, fixed Linux Python and original file owner', { timeout: 600000 }, async t => {
  assert.equal(process.env.AIJ_AF210_ROOT_ACCEPTANCE, 'true');
  assert.equal(receipt.cli, '/usr/local/bin/docker'); assert.equal(receipt.os, 'linux');
  assert.match(receipt.approvedImage, /^docker\.io\/library\/python@sha256:[a-f0-9]{64}$/);
  const scriptSandbox = { dockerCliPath: receipt.cli, approvedImage: receipt.approvedImage };
  const f = await createRemainingClientFixture('AF-210', { workbenchTargetSafety: true, storageEnabled: true, scriptSandbox,
    configuration: true, secrets: true, runtimeManagement: true, pluginManagement: true, realPluginLifecycle: true });
  const proof = { task: 'AF-210', acceptanceId: f.lease.id, checks: [], containerInvocations: 0, ioAuthorizationTransactions: [] };
  const db = op => withDatabase('test', readDatabaseEnvironment('test', process.env, f.lease.id), op, { acceptanceId: f.lease.id });
  const sub = async (name, work) => { let failed; await t.test(name, async () => { try { await work(); proof.checks.push(name); } catch (e) { failed = e; throw e; } }); if (failed) throw failed; };
  const { AiPersonalScriptRunsService: Runs, ScriptGeneratedFilesPort, ScriptSkillRuntimePort, ScriptRunAccessPort } = f.requireApi('plugins/aij-ai/ai-personal-script-runs.service.js');
  const { AiPersonalScriptSkillService: Sources } = f.requireApi('plugins/aij-ai/ai-personal-script-skill.service.js');
  const { AiPersonalSkillsService: Skills } = f.requireApi('plugins/aij-ai/ai-personal-skills.service.js');
  const { AiPersonalScriptExecutionService: Execution, ScriptSandboxConfiguration, SCRIPT_SANDBOX_OPTIONS } = f.requireApi('plugins/aij-ai/ai-personal-script-execution.service.js');
  const { GeneratedFileAssetsService: Files } = f.requireApi('files/generated-file-assets.service.js');
  const { LocalStorageAdapter: Storage } = f.requireApi('files/local-storage.adapter.js');
  const { FileContentService: Content } = f.requireApi('files/file-content.service.js');
  const { JobService } = f.requireApi('async-runtime/job.service.js');
  const { ClientAuthGuard } = f.requireApi('client-auth/client-auth.guard.js');
  const { ClientAuthService } = f.requireApi('client-auth/client-auth.service.js');
  const runs = f.app.get(Runs), sources = f.app.get(Sources), skills = f.app.get(Skills), execution = f.app.get(Execution), files = f.app.get(Files), config = f.app.get(ScriptSandboxConfiguration), jobs = f.app.get(JobService), auth = f.app.get(ClientAuthService);
  const member = f.accounts[0].id, workspace = f.workspaces[0].id;
  const request = { headers: { cookie: f.cookies[0] } }; await f.app.get(ClientAuthGuard).canActivate({ switchToHttp: () => ({ getRequest: () => request }) });
  const claims = request.clientClaims;
  const role = await f.prisma.clientWorkspaceRole.findUniqueOrThrow({ where: { workspaceId_code: { workspaceId: workspace, code: 'OWNER' } } });
  const grant = async (code, enabled) => { const row = await f.prisma.clientWorkspaceRolePermission.findFirstOrThrow({ where: { roleId: role.id, permission: { code } } }); await f.prisma.clientWorkspaceRolePermission.update({ where: { id: row.id }, data: { deletedAt: enabled ? null : new Date() } }); };
  const source = 'import json\nprint(json.dumps({"value":input_data},ensure_ascii=False))\n';
  const make = async (code = source) => {
    const head = await skills.create(member, workspace, { code: 's-' + randomUUID(), name: 'Synthetic private script', instructions: 'PRIVATE_PROMPT' });
    const ref = await sources.createVersion(member, workspace, { skillId: head.id, expectedRevision: 1, name: head.name, instructions: 'PRIVATE_PROMPT', scriptSource: code }, tx => auth.assertSessionInTransaction(tx, claims));
    return { head, ref };
  };
  const submit = (ref, input = { n: 7, text: '合成 🐍' }, key = 'key-' + randomUUID(), service = runs) => service.submit(member, workspace, { scriptVersionId: ref.scriptVersionId, input, idempotencyKey: key }, claims);
  const claim = async run => { const rows = await jobs.claim('af210-' + randomUUID(), 100); const row = rows.find(row => row.id === run.jobId); assert.ok(row, 'original JobService claimed this real job'); return row; };
  const execute = async run => { const row = await claim(run); await jobs.execute(row); return row; };
  const counts = async () => ({ scripts: await f.prisma.aiPersonalScriptRun.count(), jobs: await f.prisma.runtimeJob.count(), assets: await f.prisma.fileAsset.count(), aiRuns: await f.prisma.aiAgentRun.count(), traces: await f.prisma.aiExecutionTrace.count(), costs: await f.prisma.aiEvaluationBudgetReservation.count() });
  const sessionUntil = async expiresAt => {
    const s = await f.prisma.clientAuthSession.findUniqueOrThrow({ where: { id: claims.sessionId } });
    const next = await f.prisma.clientAuthSession.create({ data: { memberId: member, namespace: s.namespace, deviceHash: s.deviceHash, deviceSummary: 'Owned expiry probe', ipHash: s.ipHash, regionSummary: s.regionSummary, issuedAt: new Date(), expiresAt, lastSeenAt: new Date() } });
    return { ...claims, sessionId: next.id };
  };
  // Owned time-bound fixture rows use the real admission owners, original Job and exact hash.
  const nearExpiry = async milliseconds => {
    const id = randomUUID(), jobId = randomUUID(), key = 'time-' + randomUUID();
    const profile = f.requireApi('plugins/aij-ai/ai-personal-script-run-profile.js');
    await runs.access.withCurrent(member, workspace, ['workspace.ai.assets.read', 'workspace.ai.execute', 'workspace.ai.scripts.execute'], async (tx, scope) => {
      await sources.resolveInTransaction(tx, scope, ref.scriptVersionId, tx => auth.assertSessionInTransaction(tx, claims));
      await jobs.enqueueInTransaction(tx, { id: jobId, type: 'aij-ai.personal-script-execute', version: 1, payload: { runId: id }, scope: { type: 'plugin', id: scope.projectId, pluginCode: 'aij-ai' }, workspaceId: workspace, idempotencyKey: 'script:' + id, maxAttempts: 1, timeoutMs: 120000 });
      await tx.$executeRaw`INSERT INTO public.ai_personal_script_run(id,project_id,workspace_id,member_id,script_version_id,skill_ref,request_key,request_hash,input,session_id,token_version,job_id,created_at,expires_at) SELECT ${id}::uuid,${scope.projectId},${workspace},${member},${ref.scriptVersionId}::uuid,${JSON.stringify(ref)}::jsonb,${key},${profile.requestHash(ref, 'null')},'null'::json,${claims.sessionId},${claims.tokenVersion},${jobId},stamp,stamp+interval '7 days' FROM (SELECT (clock_timestamp()-interval '7 days'+${milliseconds}*interval '1 millisecond')::timestamp(3) AS stamp) AS time`;
    });
    return { id, jobId, key };
  };
  const observeLockWait = async () => {
    let count = 0;
    for (let i = 0; i < 100; i++) { count = await db(async c => (await c.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock'")).rows[0].n); if (count) break; await new Promise(r => setTimeout(r, 10)); }
    assert.ok(count > 0, 'real application transaction must be observed waiting before boundary release');
  };
  const noLocks = async stage => {
    const n = await db(async c => (await c.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND state='idle in transaction'")).rows[0].n);
    proof.ioAuthorizationTransactions.push({ stage, idleTransactions: n }); assert.equal(n, 0, 'no authorization transaction spans external IO');
  };
  const originalRun = config.runner.run.bind(config.runner), originalStage = files.stage.bind(files), originalRead = f.app.get(Content).read.bind(f.app.get(Content));
  let afterRun, afterStage, afterRead, peer;
  config.runner.run = async args => { await noLocks('container'); proof.containerInvocations++; const result = await originalRun(args); if (afterRun) { const work = afterRun; afterRun = undefined; await work(); } return result; };
  files.stage = async (...args) => { await noLocks('stage'); const ticket = await originalStage(...args); if (afterStage) { const work = afterStage; afterStage = undefined; await work(ticket); } return ticket; };
  f.app.get(Content).read = async (...args) => { await noLocks('read'); const bytes = await originalRead(...args); if (afterRead) { const work = afterRead; afterRead = undefined; await work(bytes); } return bytes; };
  let asset, run, ref;
  try {
    await sub('actual default disabled, original singleton owners and strict admission do not create jobs', async () => {
      assert.equal(new ScriptSandboxConfiguration().configured, false); assert.equal(config.configured, true);
      assert.equal(f.app.get(ScriptGeneratedFilesPort), files); assert.equal(f.app.get(ScriptSkillRuntimePort), sources);
      const before = await counts();
      const disabled = new Runs(runs.access, runs.skills, runs.auth, runs.files, new ScriptSandboxConfiguration(), jobs);
      ({ ref } = await make());
      await assert.rejects(submit(ref, {}, undefined, disabled), status(503));
      for (const raw of [{ scriptVersionId: ref.scriptVersionId, input: {}, idempotencyKey: 'valid-key', workspaceId: workspace }, { scriptVersionId: ref.scriptVersionId, input: { x: Infinity }, idempotencyKey: 'valid-key' }]) await assert.rejects(runs.submit(member, workspace, raw, claims), status(400));
      assert.deepEqual(await counts(), before);
    });
    await sub('two actual application pools and same-key requests create exactly one original job', async () => {
      const { AiRuntimeModule } = f.requireApi('plugins/aij-ai/ai-runtime.module.js'), providers = Reflect.getMetadata('providers', AiRuntimeModule);
      try {
        Reflect.defineMetadata('providers', [...providers, { provide: SCRIPT_SANDBOX_OPTIONS, useValue: { enabled: true, ...scriptSandbox } }], AiRuntimeModule);
        peer = await f.requireApi('bootstrap.js').createApplication(); await peer.init();
      } finally { Reflect.defineMetadata('providers', providers, AiRuntimeModule); }
      const ready = deferred(), release = deferred(), key = 'concurrent-' + randomUUID(), before = await counts();
      const blocker = db(async c => { await c.query('BEGIN'); try { await c.query('SELECT id FROM public.member_user WHERE id=$1 FOR UPDATE', [member]); ready.resolve(); await release.promise; await c.query('COMMIT'); } finally { await c.query('ROLLBACK'); } });
      await ready.promise;
      const pending = Promise.all([submit(ref, { a: 1 }, key), submit(ref, { a: 1 }, key, peer.get(Runs))]);
      try {
        let waiting = 0;
        for (let i = 0; i < 150; i++) { waiting = await db(async c => (await c.query("SELECT count(DISTINCT pid)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock'")).rows[0].n); if (waiting >= 2) break; await new Promise(r => setTimeout(r, 20)); }
        assert.ok(waiting >= 2); proof.concurrentPoolsWaiting = waiting;
      } finally { release.resolve(); await blocker; }
      const [one, two] = await pending; assert.equal(one.id, two.id); assert.equal(one.jobId, two.jobId); run = one;
      const after = await counts(); assert.equal(after.jobs, before.jobs + 1); assert.equal(after.scripts, before.scripts + 1);
      await assert.rejects(submit(ref, { a: 2 }, key), status(409));
      await peer.close(); peer = undefined;
    });
    await sub('original claim/execute runs real Linux Python and publishes original FileAsset exact bytes', async () => {
      const before = await counts(); await execute(run);
      run = await runs.read(member, workspace, run.id, claims); assert.equal(run.jobStatus, 'completed'); assert.equal(run.outcome, 'SUCCESS');
      const result = await runs.content(member, workspace, run.id, claims); assert.deepEqual(JSON.parse(result.bytes), { value: { a: 1 } });
      assert.equal(result.meta.checksum, digest(result.bytes)); assert.equal(result.meta.assetId, run.result.assetId); asset = run.result.assetId;
      const after = await counts(); assert.equal(after.assets, before.assets + 1); assert.equal(after.aiRuns, 0); assert.equal(after.traces, 0); assert.equal(after.costs, 0);
      assert.equal(proof.containerInvocations, 1);
    });
    await sub('duplicate original executions wait lifecycle before Job in admission and publication windows', async () => {
      const pluginKey = 'plugin-lifecycle:' + f.project.id + ':aij-ai';
      const contend = async row => {
        const entered = deferred(), release = deferred();
        const blocker = db(async c => { await c.query('BEGIN'); try { await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [pluginKey]); entered.resolve(); await release.promise; } finally { await c.query('ROLLBACK'); } });
        await entered.promise;
        const duplicate = jobs.execute(row);
        try {
          let waiting = 0;
          for (let i = 0; i < 150; i++) { waiting = await db(async c => (await c.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE '%pg_advisory_xact_lock%'")).rows[0].n); if (waiting) break; await new Promise(r => setTimeout(r, 10)); }
          assert.ok(waiting);
          // This would fail NOWAIT under the former Job->lifecycle admission order.
          await db(async c => { await c.query('BEGIN'); try { await c.query('SELECT id FROM public.runtime_job WHERE id=$1 FOR UPDATE NOWAIT', [row.id]); } finally { await c.query('ROLLBACK'); } });
        } finally { release.resolve(); await blocker; await duplicate; }
      };
      const first = await submit(ref), firstRow = await claim(first), before = proof.containerInvocations;
      await contend(firstRow);
      assert.equal((await runs.read(member, workspace, first.id, claims)).outcome, 'SUCCESS');
      const second = await submit(ref), secondRow = await claim(second);
      afterStage = () => contend(secondRow);
      await jobs.execute(secondRow);
      assert.equal((await runs.read(member, workspace, second.id, claims)).outcome, 'SUCCESS');
      assert.equal(proof.containerInvocations, before + 2);
    });
    await sub('JSON NUL string values and keys survive actual PostgreSQL json and Linux execution', async () => {
      const input = { value: 'before\u0000after', ['key\u0000suffix']: '合成' };
      const pending = await submit(ref, input); await execute(pending);
      const result = await runs.content(member, workspace, pending.id, claims);
      assert.deepEqual(JSON.parse(result.bytes), { value: input }); assert.equal(digest(result.bytes), result.meta.checksum);
      const row = await f.prisma.aiPersonalScriptRun.findUniqueOrThrow({ where: { id: pending.id } }); assert.deepEqual(row.input, input);
    });
    await sub('read permission does not imply execute, wrong members and scopes fail, reads never enqueue', async () => {
      const before = await counts(); await grant('workspace.ai.execute', false);
      try { assert.equal((await runs.read(member, workspace, run.id, claims)).id, run.id); assert.equal((await runs.capability(member, workspace, claims)).reason, 'not_permitted'); await assert.rejects(submit(ref), status(403)); }
      finally { await grant('workspace.ai.execute', true); }
      await assert.rejects(runs.read(f.accounts[1].id, workspace, run.id, { ...claims, sub: f.accounts[1].id }), status(403));
      await assert.rejects(runs.read(member, f.workspaces[1].id, run.id, claims), status(403));
      const otherRequest = { headers: { cookie: f.cookies[1] } }; await f.app.get(ClientAuthGuard).canActivate({ switchToHttp: () => ({ getRequest: () => otherRequest }) });
      await assert.rejects(runs.read(f.accounts[1].id, f.workspaces[1].id, run.id, otherRequest.clientClaims), status(404));
      for (const permission of ['workspace.ai.assets.read', 'workspace.ai.read', 'workspace.ai.scripts.execute']) { await grant(permission, false); try { await assert.rejects(runs.read(member, workspace, run.id, claims), status(403)); } finally { await grant(permission, true); } }
      assert.deepEqual(await counts(), before);
    });
    await sub('late storage-read revocation clears bytes before returning private output', async () => {
      let observed;
      afterRead = async bytes => { observed = bytes; await grant('workspace.ai.scripts.execute', false); };
      try { await assert.rejects(runs.content(member, workspace, run.id, claims), status(403)); assert.ok(observed.length > 0); assert.ok(observed.every(n => n === 0)); }
      finally { await grant('workspace.ai.scripts.execute', true); }
    });
    await sub('original startup session is required for execution but current query session can read results', async () => {
      const session = await f.prisma.clientAuthSession.findUniqueOrThrow({ where: { id: claims.sessionId } });
      const fresh = await f.prisma.clientAuthSession.create({ data: { memberId: member, namespace: session.namespace, deviceHash: session.deviceHash, deviceSummary: 'Synthetic second query', ipHash: session.ipHash, regionSummary: session.regionSummary, issuedAt: new Date(), expiresAt: session.expiresAt, lastSeenAt: new Date() } });
      const queryClaims = { ...claims, sessionId: fresh.id };
      const denied = await submit(ref); await f.prisma.clientAuthSession.update({ where: { id: claims.sessionId }, data: { status: 'revoked' } });
      const calls = proof.containerInvocations;
      try { assert.equal((await runs.read(member, workspace, run.id, queryClaims)).outcome, 'SUCCESS'); await execute(denied); assert.equal(proof.containerInvocations, calls); assert.equal((await f.prisma.aiPersonalScriptRun.findUniqueOrThrow({ where: { id: denied.id } })).outcome, 'DENIED'); }
      finally { await f.prisma.clientAuthSession.update({ where: { id: claims.sessionId }, data: { status: 'active' } }); }
    });
    await sub('run and query-session expiry are rechecked after real Skill and session lock waits', async () => {
      const pending = await nearExpiry(500), entered = deferred(), release = deferred();
      const blocker = db(async c => { await c.query('BEGIN'); try { await c.query('SELECT id FROM public.ai_personal_skill WHERE id=$1 FOR UPDATE', [ref.skillId]); entered.resolve(); await release.promise; await c.query('SELECT pg_sleep(0.6)'); } finally { await c.query('ROLLBACK'); } });
      await entered.promise; const reading = runs.read(member, workspace, pending.id, claims); const rejected = assert.rejects(reading, status(410));
      try { await observeLockWait(); } finally { release.resolve(); await blocker; }
      await rejected;
      await f.prisma.runtimeJob.update({ where: { id: pending.jobId }, data: { status: 'cancelled' } });
      const short = await sessionUntil(new Date(Date.now() + 500)), held = deferred(), unlock = deferred();
      const sessionBlock = db(async c => { await c.query('BEGIN'); try { await c.query('SELECT id FROM public.client_auth_session WHERE id=$1 FOR UPDATE', [short.sessionId]); held.resolve(); await unlock.promise; await c.query('SELECT pg_sleep(0.6)'); } finally { await c.query('ROLLBACK'); } });
      await held.promise; const expiredRead = assert.rejects(runs.read(member, workspace, run.id, short), status(401));
      try { await observeLockWait(); } finally { unlock.resolve(); await sessionBlock; }
      await expiredRead;
    });
    await sub('startup session expiring during final audit wait cannot commit the generated attachment', async () => {
      const short = await sessionUntil(new Date(Date.now() + 10000));
      const pending = await runs.submit(member, workspace, { scriptVersionId: ref.scriptVersionId, input: null, idempotencyKey: 'session-clock-' + randomUUID() }, short);
      const before = await counts();
      afterStage = async () => {
        await f.prisma.clientAuthSession.update({ where: { id: short.sessionId }, data: { expiresAt: new Date(Date.now() + 150) } });
        await db(c => c.query("CREATE FUNCTION public.af210_audit_delay() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='personal_script.finish' THEN PERFORM pg_sleep(0.4); END IF; RETURN NEW; END $$; CREATE TRIGGER af210_audit_delay BEFORE INSERT ON public.audit_log FOR EACH ROW EXECUTE FUNCTION public.af210_audit_delay()"));
      };
      try { await execute(pending); assert.equal((await counts()).assets, before.assets); const row = await f.prisma.aiPersonalScriptRun.findUniqueOrThrow({ where: { id: pending.id } }); assert.equal(row.outputAssetId, null); assert.notEqual(row.outcome, 'SUCCESS'); }
      finally { await db(c => c.query('DROP TRIGGER IF EXISTS af210_audit_delay ON public.audit_log; DROP FUNCTION IF EXISTS public.af210_audit_delay()')); }
    });
    await sub('source and permission changes across real container and file IO prevent publication', async () => {
      for (const kind of ['source', 'permission', 'session']) {
        const fresh = await make(), pending = await submit(fresh.ref), before = await counts();
        const change = async () => {
          if (kind === 'source') await skills.update(member, workspace, fresh.head.id, { expectedRevision: fresh.ref.revision, name: fresh.head.name, instructions: 'Changed while IO' });
          if (kind === 'permission') await grant('workspace.ai.scripts.execute', false);
          if (kind === 'session') await f.prisma.clientAuthSession.update({ where: { id: claims.sessionId }, data: { status: 'revoked' } });
        };
        if (kind === 'source') afterRun = change; else afterStage = change;
        try { await execute(pending); const row = await f.prisma.aiPersonalScriptRun.findUniqueOrThrow({ where: { id: pending.id } }); assert.notEqual(row.outcome, 'SUCCESS'); assert.equal(row.outputAssetId, null); assert.equal((await counts()).assets, before.assets); }
        finally { if (kind === 'permission') await grant('workspace.ai.scripts.execute', true); if (kind === 'session') await f.prisma.clientAuthSession.update({ where: { id: claims.sessionId }, data: { status: 'active' } }); }
      }
    });
    await sub('expired nonce after real container cannot publish and durable attempted marker prevents replay', async () => {
      const pending = await submit(ref), before = await counts();
      afterRun = () => f.prisma.runtimeJob.update({ where: { id: pending.jobId }, data: { leaseExpiresAt: new Date(Date.now() - 1000) } });
      const row = await execute(pending), calls = proof.containerInvocations;
      assert.equal((await counts()).assets, before.assets);
      const nonce = randomUUID(); await f.prisma.runtimeJob.update({ where: { id: pending.jobId }, data: { status: 'running', leaseNonce: nonce, leaseOwner: row.lease_owner, leaseExpiresAt: new Date(Date.now() + 60000) } });
      await jobs.execute({ ...row, lease_nonce: nonce });
      assert.equal(proof.containerInvocations, calls); assert.equal((await runs.read(member, workspace, pending.id, claims)).outcome, 'UNKNOWN');
    });
    await sub('real audit failure rolls back admission and final attachment, never re-executes', async () => {
      const before = await counts();
      await db(c => c.query("CREATE FUNCTION public.af210_audit_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='personal_script.submit' THEN RAISE EXCEPTION 'owned failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER af210_audit_fail BEFORE INSERT ON public.audit_log FOR EACH ROW EXECUTE FUNCTION public.af210_audit_fail()"));
      try { await assert.rejects(submit(ref), status(503)); assert.deepEqual(await counts(), before); }
      finally { await db(c => c.query('DROP TRIGGER af210_audit_fail ON public.audit_log; DROP FUNCTION public.af210_audit_fail()')); }
      const pending = await submit(ref), assets = (await counts()).assets;
      await db(c => c.query("CREATE FUNCTION public.af210_finish_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='personal_script.finish' THEN RAISE EXCEPTION 'owned failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER af210_finish_fail BEFORE INSERT ON public.audit_log FOR EACH ROW EXECUTE FUNCTION public.af210_finish_fail()"));
      try { await execute(pending); assert.equal((await counts()).assets, assets); assert.equal((await f.prisma.aiPersonalScriptRun.findUniqueOrThrow({ where: { id: pending.id } })).outputAssetId, null); }
      finally { await db(c => c.query('DROP TRIGGER af210_finish_fail ON public.audit_log; DROP FUNCTION public.af210_finish_fail()')); }
    });
    await sub('actual committed database response loss retains original asset and readback recovers success', async () => {
      const pending = await submit(ref), original = f.prisma.$transaction.bind(f.prisma); let lose = true;
      f.prisma.$transaction = async (...args) => {
        const value = await original(...args);
        if (lose && (await f.prisma.aiPersonalScriptRun.findUnique({ where: { id: pending.id } }))?.outcome === 'SUCCESS') { lose = false; throw new Error('OWNED_COMMITTED_RESPONSE_LOSS'); }
        return value;
      };
      try { await execute(pending); assert.equal(lose, false); const result = await runs.content(member, workspace, pending.id, claims); assert.equal(digest(result.bytes), result.meta.checksum); }
      finally { f.prisma.$transaction = original; }
    });
    await sub('invalid duplicate JSON and nonzero real scripts create no output assets', async () => {
      for (const code of ['print(\'{"a":1,"a":2}\')', 'raise RuntimeError("PRIVATE_SCRIPT_ERROR")', 'import sys\nsys.stdout.buffer.write(b"\\xef\\xbb\\xbf{}")']) {
        const item = await make(code), pending = await submit(item.ref), before = await counts();
        await execute(pending); const result = await runs.read(member, workspace, pending.id, claims);
        assert.ok(['INVALID_OUTPUT', 'SCRIPT_NONZERO'].includes(result.outcome)); assert.equal(result.result, null); assert.equal((await counts()).assets, before.assets);
        assert.ok(!JSON.stringify(await f.prisma.runtimeJob.findUnique({ where: { id: pending.jobId } })).includes('PRIVATE_SCRIPT_ERROR'));
      }
    });
    await sub('durable file cleanup fences late commits while actual storage deletion holds no transaction locks', async () => {
      const storage = f.app.get(Storage), originalWrite = storage.write.bind(storage), originalRemove = storage.remove.bind(storage); let key;
      storage.write = async (objectKey, bytes) => { key = objectKey; return originalWrite(objectKey, bytes); };
      const bytes = Buffer.from('{"owned":true}'), id = randomUUID(); let ticket;
      try { ticket = await files.stage({ projectId: f.project.id, workspaceId: workspace, memberId: member, pluginCode: 'aij-ai' }, { format: 'json', mimeType: 'application/json', bytes, checksum: digest(bytes), originalName: 'script-' + id + '.json', downloadUrl: '/api/client/script-executions/runs/' + id + '/content' }); }
      finally { storage.write = originalWrite; }
      const entered = deferred(), release = deferred();
      storage.remove = async objectKey => { assert.equal(objectKey, key); await noLocks('cleanup'); entered.resolve(); await release.promise; return originalRemove(objectKey); };
      const cleanup = files.discard(ticket);
      try {
        await entered.promise;
        await db(async c => { await c.query('BEGIN'); try { const row = (await c.query("SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS id,pg_try_advisory_xact_lock(hashtextextended($2,0)) AS object", ['aij-generated-file:' + ticket.assetId, 'aij-generated-object:' + key])).rows[0]; assert.deepEqual(row, { id: true, object: true }); } finally { await c.query('ROLLBACK'); } });
        await assert.rejects(f.prisma.fileAsset.create({ data: { id: ticket.assetId, originalName: 'script-' + id + '.json', filename: key + '.json', mimeType: 'application/json', size: bytes.length, path: storage.relativePath(key), url: '/api/client/script-executions/runs/' + id + '/content', storageType: 'local', objectKey: key, checksum: digest(bytes), projectId: f.project.id, workspaceId: workspace, pluginCode: 'aij-ai', ownerType: 'user', ownerId: member, uploaderId: member } }), error => error.meta?.code === '23514' || String(error).includes('Generated file cleanup reserved'));
      } finally { release.resolve(); await cleanup; storage.remove = originalRemove; }
      const fence = await f.prisma.generatedFileCleanupFence.findUniqueOrThrow({ where: { assetId: ticket.assetId } }); assert.ok(fence.removedAt);
      assert.ok(await f.prisma.fileAsset.findUnique({ where: { id: asset } }));
    });
    await sub('SQL source identity, monotonic outcomes and premature retention changes are rejected', async () => {
      const rejectedCode = (statement, values = []) => db(async c => {
        try { await c.query(statement, values); return 'ACCEPTED'; } catch (error) { return error.code; }
      });
      for (const statement of ["UPDATE public.ai_personal_script_run SET request_hash=repeat('0',64) WHERE id=$1::uuid", "UPDATE public.ai_personal_script_run SET attempted_at=NULL WHERE id=$1::uuid", "UPDATE public.ai_personal_script_run SET outcome='UNKNOWN',output_asset_id=NULL WHERE id=$1::uuid", "UPDATE public.ai_personal_script_run SET input=NULL,content_purged_at=clock_timestamp() WHERE id=$1::uuid"]) assert.equal(await rejectedCode(statement, [run.id]), '23514');
      for (const statement of ['DELETE FROM public.ai_personal_script_run WHERE false', 'TRUNCATE public.ai_personal_script_run']) assert.equal(await rejectedCode(statement), '23514');
      const pending = await submit(ref), bytes = Buffer.from('{}');
      const ticket = await files.stage({ projectId: f.project.id, workspaceId: workspace, memberId: member, pluginCode: 'aij-ai' }, { format: 'json', mimeType: 'application/json', bytes, checksum: digest(bytes), originalName: 'script-' + pending.id + '.json', downloadUrl: '/api/client/script-executions/runs/' + pending.id + '/content' });
      let code;
      try { await f.prisma.$transaction(async tx => { await files.commitInTransaction(tx, ticket); await tx.$executeRaw`UPDATE public.ai_personal_script_run SET output_asset_id=${ticket.assetId} WHERE id=${pending.id}::uuid`; }); code = 'ACCEPTED'; }
      catch (error) { code = error.meta?.code; }
      assert.equal(code, '23514'); await files.discard(ticket);
      await f.prisma.runtimeJob.update({ where: { id: pending.jobId }, data: { status: 'cancelled' } });
      assert.equal((await runs.read(member, workspace, run.id, claims)).outcome, 'SUCCESS');
    });
    await sub('original retention maintenance purges expired input, preserves identity and never recreates jobs', async () => {
      const expiredId = randomUUID(), jobId = randomUUID(), key = 'expired-' + randomUUID();
      await f.app.get(ScriptRunAccessPort).withCurrent(member, workspace, ['workspace.ai.assets.read', 'workspace.ai.execute', 'workspace.ai.scripts.execute'], async (tx, scope) => {
        await sources.resolveInTransaction(tx, scope, ref.scriptVersionId, tx => auth.assertSessionInTransaction(tx, claims));
        await jobs.enqueueInTransaction(tx, { id: jobId, type: 'aij-ai.personal-script-execute', version: 1, payload: { runId: expiredId }, scope: { type: 'plugin', id: scope.projectId, pluginCode: 'aij-ai' }, workspaceId: workspace, idempotencyKey: 'script:' + expiredId, maxAttempts: 1, timeoutMs: 120000 });
        await tx.$executeRaw`INSERT INTO public.ai_personal_script_run(id,project_id,workspace_id,member_id,script_version_id,skill_ref,request_key,request_hash,input,session_id,token_version,job_id,created_at,expires_at) SELECT ${expiredId}::uuid,${scope.projectId},${workspace},${member},${ref.scriptVersionId}::uuid,${JSON.stringify(ref)}::jsonb,${key},${'0'.repeat(64)},'null'::jsonb,${claims.sessionId},${claims.tokenVersion},${jobId},stamp,stamp+interval '7 days' FROM (SELECT (clock_timestamp()-interval '8 days')::timestamp(3) AS stamp) AS time`;
      });
      // A successful result may be unavailable by the time private input expires.
      // Give the actual Docker startup/execution its full 30s budget, then wait for DB expiry.
      const softDeleted = await nearExpiry(45000); await execute(softDeleted);
      const successful = await f.prisma.aiPersonalScriptRun.findUniqueOrThrow({ where: { id: softDeleted.id } }); assert.equal(successful.outcome, 'SUCCESS');
      await f.prisma.fileAsset.update({ where: { id: successful.outputAssetId }, data: { status: 'deleted', deletedAt: new Date() } });
      const remainingMs = await db(async c => (await c.query('SELECT GREATEST(0,ceil(extract(epoch FROM expires_at-clock_timestamp())*1000))::int AS remaining_ms FROM public.ai_personal_script_run WHERE id=$1::uuid', [softDeleted.id])).rows[0].remaining_ms);
      assert.ok(remainingMs >= 0 && remainingMs <= 45000);
      // Release the short-lived protected connection before waiting for the real DB deadline.
      await new Promise(resolve => setTimeout(resolve, remainingMs + 100));
      assert.equal(await db(async c => (await c.query('SELECT expires_at<=clock_timestamp() AS expired FROM public.ai_personal_script_run WHERE id=$1::uuid', [softDeleted.id])).rows[0].expired), true);
      const expected = await db(async c => (await c.query('SELECT count(*)::int AS n FROM public.ai_personal_script_run WHERE expires_at<=clock_timestamp() AND content_purged_at IS NULL')).rows[0].n);
      assert.ok(expected >= 3);
      const before = await counts(); const { AiCenterRunService } = f.requireApi('plugins/aij-ai/ai-center-run.service.js');
      assert.equal(await f.app.get(AiCenterRunService).cleanup(), expected);
      assert.equal(await execution.purgeExpiredInputs(), 0);
      const retained = await f.prisma.aiPersonalScriptRun.findUniqueOrThrow({ where: { id: expiredId } }); assert.equal(retained.input, null); assert.ok(retained.contentPurgedAt); assert.equal(retained.jobId, jobId); assert.equal(retained.requestKey, key);
      const erased = await f.prisma.aiPersonalScriptRun.findUniqueOrThrow({ where: { id: softDeleted.id } }); assert.equal(erased.input, null); assert.ok(erased.contentPurgedAt); assert.equal(erased.outputAssetId, successful.outputAssetId);
      await assert.rejects(runs.read(member, workspace, expiredId, claims), status(410)); await assert.rejects(runs.recover(member, workspace, key, claims), status(410)); assert.deepEqual(await counts(), before);
    });
    assert.equal(await f.prisma.aiAgentRun.count(), 0); assert.equal(await f.prisma.aiExecutionTrace.count(), 0); assert.equal(await f.prisma.aiEvaluationBudgetReservation.count(), 0);
    const audits = await f.prisma.auditLog.findMany({ where: { action: { startsWith: 'personal_script.' } } });
    for (const privateText of [source, 'PRIVATE_PROMPT', 'PRIVATE_SCRIPT_ERROR']) assert.ok(!JSON.stringify(audits).includes(privateText));
  } finally {
    if (peer) await peer.close();
    proof.closure = await f.close();
    assert.equal(proof.closure.status, 'CLOSED'); assert.equal(proof.closure.applicationPools, 0); assert.equal(proof.closure.ownedSockets, 0);
    writeFileSync(join('.artifacts/auto-ai-program-20261105/W19', 'AF-210-live-' + f.lease.id + '.json'), JSON.stringify(proof, null, 2));
  }
});
