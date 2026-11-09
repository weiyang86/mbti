import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createRemainingClientFixture } from './remaining-client-fixture.mjs';
import { preparePersonalScriptsHost } from './client-personal-script-browser-host.mjs';
import { verifyPersonalScriptBrowser } from './client-personal-script-browser.mjs';
import { createPersonalScriptState } from '../../apps/web/app/components/client-personal-script-state.mjs';
import { createClientApi, createPersonalScriptExecutionClient, createPersonalSkillsClient } from '../../packages/sdk/dist/index.mjs';
const delay = ms => new Promise(r => setTimeout(r, ms));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export const scriptSource = 'import json\nprint(json.dumps({"value":input_data},ensure_ascii=False))\n';
test('AF213 actual state/public SDK/original HTTP-PG-Linux/File and native mounted Skill panel', { timeout: 600000 }, async t => {
  assert.equal(process.env.AIJ_AF213_ROOT_ACCEPTANCE, 'true');
  const artifact = process.env.AIJ_AF213_EVIDENCE, host = await preparePersonalScriptsHost(artifact);
  const image = JSON.parse(await readFile('.artifacts/auto-ai-program-20261105/AF-175/image-receipt.json', 'utf8'));
  let f, disabled, store, disabledStore;
  try {
    f = await createRemainingClientFixture('AF-213', { workbenchTargetSafety: true, storageEnabled: true,
      scriptSandbox: { dockerCliPath: image.cli, approvedImage: image.approvedImage }, configuration: true, secrets: true, runtimeManagement: true,
      pluginManagement: true, realPluginLifecycle: true, testBrowserOrigin: host.origin });
    host.attach(f.baseUrl);
    const workspaceId = f.workspaces[0].id, memberId = f.accounts[0].id, proof = { task: 'AF-213', acceptanceId: f.lease.id, cases: [] };
    const control = { cookie: f.cookies[0], base: host.origin + '/api' }, binaryBuffers = [];
    const api = createClientApi(() => control.base);
    const request = async (path, options = {}) => {
      const value = await api(path, { ...options, headers: { ...options.headers, cookie: control.cookie, origin: host.origin, connection: 'close' } });
      if (value?.bytes instanceof Uint8Array) binaryBuffers.push(value.bytes); return value;
    };
    const skills = createPersonalSkillsClient(request);
    let head = await skills.create(workspaceId, { code: 'node-' + randomUUID(), name: 'AF213 state integration', instructions: 'Synthetic private current Skill.' });
    const scope = () => ({ memberId, workspaceId, skillId: head.id, revision: head.revision, name: head.name, instructions: head.instructions });
    store = createPersonalScriptState({ request, scriptsClientFactory: createPersonalScriptExecutionClient, skillsClientFactory: createPersonalSkillsClient });
    const ready = async (target = store) => { target.setScope(scope()); for (let i = 0; i < 100 && target.getSnapshot().busy; i++) await delay(25); assert.ok(target.getSnapshot().auth, 'Original me/context/head authorized'); assert.equal(target.getSnapshot().busy, false); };
    const counts = async () => ({ versions: await f.prisma.aiPersonalScriptVersion.count(), runs: await f.prisma.aiPersonalScriptRun.count(), jobs: await f.prisma.runtimeJob.count(), assets: await f.prisma.fileAsset.count(), aiRuns: await f.prisma.aiAgentRun.count(), traces: await f.prisma.aiExecutionTrace.count() });
    const { JobService } = f.requireApi('async-runtime/job.service.js'), jobs = f.app.get(JobService);
    const execute = async run => { const claims = await jobs.claim('af213-' + randomUUID(), 20); const claim = claims.find(x => x.id === run.jobId); assert.ok(claim); await jobs.execute(claim); };
    const role = await f.prisma.clientWorkspaceRole.findUniqueOrThrow({ where: { workspaceId_code: { workspaceId, code: 'OWNER' } } });
    const grant = async (code, enabled) => { const g = await f.prisma.clientWorkspaceRolePermission.findFirstOrThrow({ where: { roleId: role.id, permission: { code } } }); await f.prisma.clientWorkspaceRolePermission.update({ where: { id: g.id }, data: { deletedAt: enabled ? null : new Date() } }); };
    const sub = async (name, action) => { let failure; await t.test(name, async () => { try { await action(); proof.cases.push(name); } catch (e) { failure = e; throw e; } }); await writeFile(join(artifact, 'actual-state.json'), JSON.stringify(proof, null, 2) + '\n'); if (failure) throw failure; };
    let ref, run;
    await sub('actual immutable source version through original SDK and current parent head, never auto execute', async () => {
      await ready(); assert.equal(store.getSnapshot().capability.configured, true); const before = await counts();
      store.setField('source', scriptSource); store.requestConfirmation('version'); await store.confirmVersion(); ref = store.getSnapshot().ref; assert.ok(ref); assert.equal(ref.revision, 2); assert.equal(ref.scriptDigest, digest(scriptSource));
      const after = await counts(); assert.equal(after.versions, before.versions + 1); assert.equal(after.runs, before.runs); assert.equal(after.jobs, before.jobs);
      head = await skills.get(workspaceId, head.id); assert.equal(head.revision, 2); await ready(); store.setField('versionId', ref.scriptVersionId); await store.readVersion(); assert.equal(store.getSnapshot().source, scriptSource);
    });
    await sub('one explicit original Job/Linux execution and SUCCESS bytes, real Blob revoke/null scope and same-key resolution', async () => {
      const before = await counts(); store.setField('input', '{"text":"中文🙂","nul":"x\\u0000y"}'); store.requestConfirmation('run'); await store.confirmSubmit(); run = store.getSnapshot().run; assert.ok(run); assert.equal(store.getSnapshot().locked, true);
      const submitted = await counts(); assert.equal(submitted.runs, before.runs + 1); assert.equal(submitted.jobs, before.jobs + 1);
      await execute(run); await store.readRun(); assert.equal(store.getSnapshot().run.outcome, 'SUCCESS');
      await store.download(); const s = store.getSnapshot(); assert.ok(s.download?.url); assert.deepEqual(JSON.parse(s.output), { value: { text: '中文🙂', nul: 'x\u0000y' } });
      assert.equal(digest(await (await fetch(s.download.url)).text()), digest(s.output)); assert.ok(binaryBuffers.length); assert.ok(binaryBuffers.every(b => b.every(v => v === 0)));
      const url = s.download.url; store.suspend(); assert.equal(store.getSnapshot().output, ''); assert.equal(store.getSnapshot().locked, true); await assert.rejects(fetch(url));
      await ready(); await store.recover(); assert.equal(store.getSnapshot().run.id, run.id); assert.equal(store.canResolveRun(), true); await store.resolveRun(); assert.equal(store.getSnapshot().locked, false);
      store.setField('runId', run.id); await store.readRun();
      const barrier = host.hold(`/api/client/script-executions/runs/${run.id}/content`), pending = store.download();
      let timer;
      try { await Promise.race([barrier.entered.promise, new Promise((_, no) => { timer = setTimeout(() => no(Error('Actual held source response missing')), 10000); })]); store.setScope(null); }
      finally { clearTimeout(timer); barrier.release.resolve(); }
      await pending;
      assert.equal(store.getSnapshot().download, null); assert.equal(store.getSnapshot().output, ''); await ready();
      const after = await counts(); assert.equal(after.runs, submitted.runs); assert.equal(after.jobs, submitted.jobs); assert.equal(after.assets, before.assets + 1); assert.equal(after.aiRuns, 0); assert.equal(after.traces, 0);
    });
    await sub('actual default-off original application blocks new execution while authorized existing SUCCESS remains readable', async () => {
      const { createApplication } = f.requireApi('bootstrap.js'); disabled = await createApplication({ testBrowserOrigin: host.origin }); await disabled.listen(0, '127.0.0.1');
      const disabledApi = createClientApi(() => `http://127.0.0.1:${disabled.getHttpServer().address().port}/api`);
      const readRequest = (path, opts = {}) => disabledApi(path, { ...opts, headers: { ...opts.headers, cookie: f.cookies[0], origin: host.origin, connection: 'close' } });
      disabledStore = createPersonalScriptState({ request: readRequest, scriptsClientFactory: createPersonalScriptExecutionClient, skillsClientFactory: createPersonalSkillsClient });
      await ready(disabledStore); assert.equal(disabledStore.getSnapshot().capability.configured, false); disabledStore.setField('versionId', ref.scriptVersionId); assert.equal(disabledStore.canSubmit(), false);
      disabledStore.setField('runId', run.id); await disabledStore.readRun(); assert.equal(disabledStore.getSnapshot().run.outcome, 'SUCCESS'); await disabledStore.download(); assert.ok(disabledStore.getSnapshot().output);
      disabledStore.suspend(); await disabled.close(); disabled = undefined;
    });
    await sub('real same-member new Cookie session generation rejects before any source POST and clears private fields', async () => {
      await ready(); const generation = store.getSnapshot().auth.sessionGeneration;
      const account = JSON.parse(await readFile(f.accounts[0].initialPasswordFile, 'utf8')).accounts.find(a => a.id === memberId);
      const login = await f.request('POST', 'client/auth/login', { body: { email: f.accounts[0].email, password: account.password } });
      control.cookie = login.response.headers.get('set-cookie').split(';')[0]; assert.notEqual((await request('/client/workspaces/context', { workspaceId })).sessionGeneration, generation);
      const before = await counts(); store.setField('source', scriptSource); store.requestConfirmation('version'); await store.confirmVersion();
      assert.equal(store.getSnapshot().source, ''); assert.equal(store.getSnapshot().auth, null); assert.deepEqual(await counts(), before);
      control.cookie = f.cookies[0]; await ready();
    });
    await sub('current independent source/execute/result grants are reflected by actual capability and no new writes', async () => {
      const before = await counts();
      try {
        await grant('workspace.ai.scripts.manage', false); await store.refresh(); assert.equal(store.canCreate(), false); store.setField('versionId', ref.scriptVersionId); assert.equal(store.canSubmit(), true);
        store.setField('runId', run.id); await store.readRun(); assert.equal(store.getSnapshot().run.id, run.id);
        await grant('workspace.ai.scripts.manage', true); await grant('workspace.ai.execute', false); await store.refresh(); assert.equal(store.canSubmit(), false); assert.equal(store.canCreate(), true);
        store.setField('runId', run.id); await store.readRun(); assert.equal(store.getSnapshot().run.id, run.id);
        await grant('workspace.ai.read', false); await store.refresh(); store.setField('runId', run.id); await store.readRun(); assert.equal(store.getSnapshot().run, null);
        assert.deepEqual(await counts(), before);
      } finally { await grant('workspace.ai.scripts.manage', true); await grant('workspace.ai.execute', true); await grant('workspace.ai.read', true); await store.refresh(); }
    });
    await sub('changed original Skill head blocks stale UI source write and old version409 creates no new job', async () => {
      const before = await counts(); head = await skills.update(workspaceId, head.id, { name: head.name, instructions: head.instructions + ' Changed current head.', expectedRevision: head.revision });
      store.setField('source', scriptSource); store.requestConfirmation('version'); await store.confirmVersion(); assert.equal(store.getSnapshot().source, ''); assert.equal(store.getSnapshot().auth, null);
      await ready(); store.setField('versionId', ref.scriptVersionId); store.setField('input', '{}'); store.requestConfirmation('run'); await store.confirmSubmit(); assert.equal(store.getSnapshot().issue.status, 409); assert.equal(store.getSnapshot().locked, true);
      assert.deepEqual(await counts(), before); store.suspend();
    });
    await sub('original Skill page actual source/run confirmations, unknown locks, GET recovery, result download, 390px and privacy', async () => {
      await verifyPersonalScriptBrowser({ host, fixture: f, artifact, scriptSource, jobs, grant });
    });
    proof.status = 'PASS'; await writeFile(join(artifact, 'actual-state.json'), JSON.stringify(proof, null, 2) + '\n');
  } finally {
    store?.suspend(); disabledStore?.suspend(); if (disabled) { disabled.getHttpServer().closeAllConnections(); await disabled.close(); }
    await host.close();
    if (f) { const closed = await f.close(); for (const key of ['applicationPools0', 'ownedSockets0', 'environmentRestored']) assert.equal(closed[key], true); }
  }
});
