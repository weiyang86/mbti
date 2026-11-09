import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { createWorkflowRuntimeFixture, waitForWorkflowGate } from './personal-workflow-runtime-fixture.mjs';
import { prepareW21UiHost } from './w21-ui-host.mjs';
import { w21NativeBrowser } from './w21-native-browser.mjs';
import { createWorkflowExecutionState } from '../../apps/web/app/components/client-workflow-execution-state.mjs';

test('AF217 original workflow page/store + installed SDK + real HTTP/PG/Run/Job/budget/native', { timeout: 660000 }, async t => {
  assert.equal(process.env.AIJ_AF217_ROOT_ACCEPTANCE, 'true');
  const artifact = process.env.AIJ_AF217_EVIDENCE, consumer = process.env.AIJ_AF217_PACKED_CONSUMER;
  const b = w21NativeBrowser(artifact); await b.preflight();
  const host = await prepareW21UiHost('AF-217', artifact), stores = [], proof = { task: 'AF-217', cases: [], native: [], status: 'INCOMPLETE' };
  let f, barrier;
  const save = () => writeFile(join(artifact, 'proof.json'), JSON.stringify(proof, null, 2) + '\n');
  const sub = async (name, fn) => { let failure; await t.test(name, async () => { try { await fn(); proof.cases.push(name); } catch (e) { failure = e; throw e; } }); await save(); if (failure) throw failure; };
  try {
    f = await createWorkflowRuntimeFixture('AF-217', { testBrowserOrigin: host.origin }); host.attach(f.baseUrl); proof.acceptanceId = f.lease.id;
    const sdk = await import(pathToFileURL(join(consumer, 'entry.mjs')).href), control = { cookie: f.cookies[0] };
    const api = sdk.createClientApi(() => host.origin + '/api');
    const request = (path, options = {}) => api(path, { ...options, headers: { ...options.headers, cookie: control.cookie, origin: host.origin, connection: 'close' } });
    const execution = sdk.createPersonalWorkflowExecutionClient(request), workflows = sdk.createPersonalWorkflowsClient(request);
    const scope = h => ({ memberId: f.member, workspaceId: f.workspace, workflowId: h.id, revision: h.revision, graphDigest: h.graphDigest });
    const makeStore = () => { const s = createWorkflowExecutionState({ request, executionClientFactory: sdk.createPersonalWorkflowExecutionClient, workflowsClientFactory: sdk.createPersonalWorkflowsClient }); stores.push(s); return s; };
    const store = makeStore(); store.setScope(scope(f.workflow));
    const ready = async () => { store.setScope(scope(await workflows.get(f.workspace, f.workflow.id))); await store.readPublication(); assert.equal(store.getSnapshot().issue, null); await store.preview(); assert.equal(store.getSnapshot().issue, null); };
    const posts = path => host.traffic.filter(x => x.method === 'POST' && (!path || x.path === '/api/client/workflow-executions/' + path));
    const counts = async () => ({ ...await f.counts(), versions: await f.prisma.aiPersonalWorkflowVersion.count(), publications: await f.prisma.aiPersonalWorkflowPublication.count() });
    await sub('original publication/previews approved input and cancelled confirmations are read-only', async () => {
      const before = await counts(), n = posts().length; await ready(); assert.equal(store.getSnapshot().singleAgent, true); assert.deepEqual(store.getSnapshot().preview.inputFields, ['text']);
      store.requestConfirmation('unpublish'); assert.equal(store.getSnapshot().confirmation, 'unpublish'); store.cancelConfirmation(); store.setField('input', '{"text":"WORKFLOW_SYNTHETIC_INPUT"}'); store.requestConfirmation('run'); assert.equal(store.getSnapshot().confirmation, 'run'); store.cancelConfirmation();
      assert.deepEqual(await counts(), before); assert.equal(posts().length, n);
    });
    await sub('real committed publication response loss preserves lock across null/foreign scope and fresh explicit read/ACK', async () => {
      await store.readPublication(); const epoch = store.getSnapshot().publication.publicationEpoch, before = await f.counts(), n = posts().length;
      store.requestConfirmation('unpublish'); host.lose('POST', '/api/client/workflow-executions/publications/' + f.workflow.id + '/unpublish'); await store.confirmPublication();
      assert.equal(store.getSnapshot().locked, true); assert.equal(posts().length, n + 1); assert.equal((await execution.publication(f.workspace, f.workflow.id)).publicationEpoch, epoch + 1);
      store.setScope(null); assert.equal(store.getSnapshot().locked, true); store.setScope({ ...scope(f.workflow), memberId: f.accounts[1].id }); await store.verifyAccess(); await store.acknowledgePublicationWrite(); assert.equal(store.getSnapshot().locked, true);
      store.setScope(scope(f.workflow)); await store.readPublication(); await store.reviewPublicationWrite(); assert.ok(store.getSnapshot().review); assert.equal(store.getSnapshot().locked, true); await store.acknowledgePublicationWrite(); assert.equal(store.getSnapshot().locked, false); assert.equal(posts().length, n + 1); assert.deepEqual(await f.counts(), before);
      await store.readPublication(); store.requestConfirmation('publish'); await store.confirmPublication(); assert.equal(store.getSnapshot().issue, null); assert.equal(store.getSnapshot().publication.dependencyReadiness.ready, true);
    });
    let completedId, failedId;
    await sub('one original committed Run POST recovered by original key, original Job settles once and explicit terminal GET ends lock', async () => {
      await ready(); store.setField('input', '{"text":"WORKFLOW_SYNTHETIC_INPUT"}'); store.requestConfirmation('run'); const before = await f.counts(), n = posts('runs').length;
      host.lose('POST', '/api/client/workflow-executions/runs'); await store.confirmSubmit(); assert.equal(store.getSnapshot().locked, true); assert.equal(posts('runs').length, n + 1);
      store.setScope(null); store.setScope(scope(f.workflow)); await store.verifyAccess(); await store.recover(); const recovered = store.getSnapshot().recovery; assert.equal(recovered.request.status, 'queued'); completedId = recovered.request.id; assert.equal(store.canResolveRun(), false);
      await f.execute(); await store.recover(); assert.equal(store.getSnapshot().recovery.request.status, 'succeeded'); assert.equal(store.getSnapshot().recovery.request.budgetStatus, 'settled'); assert.equal(store.canResolveRun(), true); assert.equal(store.getSnapshot().locked, true);
      await store.resolveRun(); assert.equal(store.getSnapshot().locked, false); store.setField('runId', completedId); await store.readRun(); assert.equal(store.getSnapshot().result.run.output, 'WORKFLOW_SYNTHETIC_OUTPUT'); assert.equal(store.getSnapshot().result.run.estimatedCostNanos, '40000'); assert.equal(posts('runs').length, n + 1);
      const after = await f.counts(); for (const k of ['runs','jobs','origins','reservations','traces','calls','credentials']) assert.equal(after[k], before[k] + 1, k);
    });
    await sub('readable failed released terminal resolves explicitly; changed publication409 retains its original opaque lock', async () => {
      await ready(); store.setField('input', '{"text":"WORKFLOW_SYNTHETIC_INPUT"}'); store.requestConfirmation('run'); await store.confirmSubmit(); failedId = store.getSnapshot().result.run.id; const calls = f.state.calls;
      await f.setGrant('workspace.ai.execute', false); try { await f.execute(); } finally { await f.setGrant('workspace.ai.execute', true); }
      await store.recover(); assert.equal(store.getSnapshot().recovery.request.status, 'failed'); assert.equal(store.getSnapshot().recovery.request.budgetStatus, 'released'); assert.equal(store.getSnapshot().locked, true); assert.equal(f.state.calls, calls); await store.resolveRun(); assert.equal(store.getSnapshot().locked, false);
      store.setField('runId', failedId); await store.readRun(); assert.equal(store.getSnapshot().result.run.status, 'failed');
      // A distinct workflow exercises the original owner's deliberate historical
      // publication refusal without invalidating the earlier result fixture.
      const changed = (await f.makeWorkflow()).workflow, s = makeStore(); s.setScope(scope(changed)); await s.readPublication(); await s.preview(); s.setField('input', '{"text":"WORKFLOW_SYNTHETIC_INPUT"}'); s.requestConfirmation('run'); await s.confirmSubmit(); const abaId = s.getSnapshot().result.run.id;
      let p = await execution.publication(f.workspace, changed.id); await execution.unpublish(f.workspace, changed.id, { expectedRevision: p.revision, expectedPublicationEpoch: p.publicationEpoch }); p = await execution.publication(f.workspace, changed.id); await execution.publish(f.workspace, { workflowId: changed.id, expectedRevision: p.revision, expectedPublicationEpoch: p.publicationEpoch }); await f.execute();
      const stored = await f.prisma.aiAgentRun.findUniqueOrThrow({ where: { id: abaId } }); assert.equal(stored.status, 'failed'); assert.equal(stored.budgetStatus, 'released'); assert.equal(f.state.calls, calls); const n = posts('runs').length;
      await s.recover(); assert.equal(s.getSnapshot().issue.status, 409); assert.equal(s.getSnapshot().recovery, null); assert.equal(s.getSnapshot().locked, true); assert.equal(s.canResolveRun(), false); assert.equal(posts('runs').length, n);
    });
    await sub('default-off and independent no-new-execute/no-publish grants still read existing result when publication service really fails', async () => {
      process.env.AI_CENTER_CLIENT_EXECUTION_ENABLED = 'false'; await ready(); assert.equal(store.getSnapshot().preview.modelExecutionConfigured, false); assert.equal(store.canSubmit(), false);
      await f.setGrant('workspace.ai.execute', false); await f.setGrant('workspace.ai.workflows.publish', false);
      const original = f.pub.read.bind(f.pub), { ServiceUnavailableException } = createRequire(join(process.cwd(), 'apps/api/package.json'))('@nestjs/common');
      try {
        const n = posts().length; await store.readPublication(); assert.equal(store.canPublish(), false); assert.equal(store.canSubmit(), false);
        f.pub.read = async () => { throw new ServiceUnavailableException('Owned AF217 publication outage'); }; await assert.rejects(execution.publication(f.workspace, f.workflow.id), e => e.status === 503);
        await store.verifyAccess(); store.setField('runId', completedId); await store.readRun(); assert.equal(store.getSnapshot().result.run.output, 'WORKFLOW_SYNTHETIC_OUTPUT'); assert.equal(posts().length, n);
      } finally { f.pub.read = original; process.env.AI_CENTER_CLIENT_EXECUTION_ENABLED = 'true'; await f.setGrant('workspace.ai.execute', true); await f.setGrant('workspace.ai.workflows.publish', true); }
    });
    await sub('current grants, actual new session generation and late original HTTP response clear before UI result or new POST', async () => {
      for (const code of ['workspace.ai.assets.read','workspace.ai.execute','workspace.ai.workflows.execute']) {
        await ready(); store.setField('input', '{"text":"WORKFLOW_SYNTHETIC_INPUT"}'); store.requestConfirmation('run'); const n = posts('runs').length; await f.setGrant(code, false);
        try { await store.confirmSubmit(); assert.equal(store.getSnapshot().auth, null); assert.equal(store.getSnapshot().input, ''); assert.equal(posts('runs').length, n); } finally { await f.setGrant(code, true); }
      }
      await ready(); store.setField('input', '{"text":"WORKFLOW_SYNTHETIC_INPUT"}'); store.requestConfirmation('run'); const n = posts('runs').length, next = await f.loginAgain(); control.cookie = next.cookie;
      try { await store.confirmSubmit(); assert.equal(store.getSnapshot().auth, null); assert.equal(posts('runs').length, n); } finally { control.cookie = f.cookies[0]; }
      store.setScope(scope(f.workflow)); await store.verifyAccess(); assert.ok(store.getSnapshot().auth); store.setField('runId', completedId); barrier = host.hold('/api/client/workflow-executions/runs/' + completedId); const pending = store.readRun();
      try { await waitForWorkflowGate(barrier.entered.promise); await f.setGrant('workspace.ai.read', false); }
      finally { barrier.release.resolve(); barrier = undefined; } await pending; assert.equal(store.getSnapshot().result, null); await f.setGrant('workspace.ai.read', true);
    });
    await sub('changed current head/digest fences stale view without mutation and old Run origin stays immutable', async () => {
      await ready(); const old = await f.prisma.aiPersonalWorkflowRunOrigin.findMany({ orderBy: { runId: 'asc' } }), head = await workflows.get(f.workspace, f.workflow.id);
      await workflows.update(f.workspace, head.id, { name: 'AF217 concurrent renamed', graph: head.graph, expectedRevision: head.revision }); const n = posts('runs').length;
      store.setField('input', '{"text":"WORKFLOW_SYNTHETIC_INPUT"}'); store.requestConfirmation('run'); await store.confirmSubmit(); assert.equal(store.getSnapshot().auth, null); assert.equal(posts('runs').length, n);
      assert.deepEqual(await f.prisma.aiPersonalWorkflowRunOrigin.findMany({ orderBy: { runId: 'asc' } }), old);
    });
    let complex;
    await sub('complex multi-step graph stays intact and cannot be published by this single-Agent UI affordance', async () => {
      const graph = { ...f.graph, nodes: [{ id: 's', type: 'start' }, { id: 'a', type: 'agent', agentId: f.agent.id, revision: f.agent.revision }, { id: 'b', type: 'agent', agentId: f.agent.id, revision: f.agent.revision }, { id: 'e', type: 'end' }], edges: [{ from: 's', port: 'next', to: 'a', input: 'in' }, { from: 'a', port: 'next', to: 'b', input: 'in' }, { from: 'b', port: 'next', to: 'e', input: 'in' }] };
      complex = await workflows.create(f.workspace, { code: 'complex-' + randomUUID(), name: 'AF217 complex preserved', graph });
      const savedGraph = structuredClone(complex.graph), n = posts().length; assert.equal(savedGraph.nodes.length, 4); assert.equal(savedGraph.edges.length, 3);
      const s = makeStore(); s.setScope(scope(complex)); await s.readPublication(); assert.equal(s.getSnapshot().singleAgent, false); assert.equal(s.canPublish(), false); assert.deepEqual((await workflows.get(f.workspace, complex.id)).graph, savedGraph); assert.equal(posts().length, n);
    });
    await sub('original native workflow publication/manual Run/GET recovery/390/hidden/late denial/unmount', async () => {
      const native = (await f.makeWorkflow()).workflow, panel = 'section[aria-label="个人工作流发布与手动执行"]'; await host.startWeb();
      const press = async (label, selector) => {
        const rect = await b.read(`(()=>{const root=${selector ? `document.querySelector(${JSON.stringify(selector)})` : 'document'};const n=s=>s.replace(/\\s/g,'');const button=[...root?.querySelectorAll('button')??[]].find(x=>!x.disabled&&n(x.getAttribute('aria-label')??x.textContent)===n(${JSON.stringify(label)}));if(!button)return null;const r=button.getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:window.innerHeight,focus:document.hasFocus()};})()`);
        assert.ok(rect, 'Actual enabled native button required: ' + label);
        assert.equal(rect.focus, true, 'Actual page focus required before native activation');
        if (rect.top < 0 || rect.bottom > rect.height) await b.action('scroll', ['--direction', rect.top < 0 ? 'up' : 'down', '--amount', String(Math.ceil(Math.abs(rect.top - rect.height / 3)))]);
        await b.activate(label, selector);
      };
      const account = JSON.parse(await readFile(f.accounts[0].initialPasswordFile, 'utf8')).accounts.find(a => a.id === f.member);
      await b.action('create', ['--url', host.origin + '/client/login']); await b.action('switch', ['--focus']); await b.fill('邮箱', f.accounts[0].email, true); await b.fill('密码', account.password, true); await press('登 录'); await b.action('wait', ['--url', '/client']);
      await b.action('goto', ['--url', host.origin + '/client/workflows?workspaceId=' + f.workspace]); await b.wait('新建线性草稿');
      const open = async () => { await press('查看草稿', `tr[data-row-key="${native.id}"]`); await b.wait('读取当前发布并验证访问'); };
      const read = async () => { await press('读取当前发布并验证访问', panel); await b.action('wait', ['--selector', panel + ' section[aria-label="当前发布状态"]']); };
      await open(); await read(); assert.equal(await b.read(`document.querySelectorAll(${JSON.stringify(panel)}).length`), 1);
      const beforePub = posts().length; await press('检查并确认取消发布', panel); await b.wait('确认取消当前发布'); await b.action('keypress', ['--key', 'Escape']); assert.equal(posts().length, beforePub); proof.native.push('native-keyboard-publication-cancel-zero-write');
      await press('检查并确认取消发布', panel); host.lose('POST', '/api/client/workflow-executions/publications/' + native.id + '/unpublish'); await press('确认此次发布操作', '[role=dialog]'); await b.wait('原写入仍锁定');
      await press('仅修改名称'); assert.equal(await b.read(`document.querySelectorAll(${JSON.stringify(panel)}).length`), 1); await b.wait('原写入仍锁定'); await press('取消并清除编辑'); await read();
      await press('核对原工作流实际发布状态', panel); await b.wait('我已核对，明确结束此次发布核对'); assert.equal(posts().length, beforePub + 1); await press('我已核对，明确结束此次发布核对', panel); await b.wait('读取当前发布并验证访问'); await read(); assert.equal(posts().length, beforePub + 1); proof.native.push('native-publication-unknown-parent-null-read-separate-ACK-one-POST');
      await press('检查并确认发布当前版本', panel); await press('确认此次发布操作', '[role=dialog]'); await b.wait('读取当前发布并验证访问'); await read(); await press('预览当前发布的执行条件', panel); await b.wait('模型执行已配置');
      await b.fill('工作流执行 JSON 输入', '{"text":"WORKFLOW_SYNTHETIC_INPUT"}'); const n = posts('runs').length; await press('检查并确认执行一次', panel); await b.wait('确认手动执行一次'); await b.action('keypress', ['--key', 'Escape']); assert.equal(posts('runs').length, n); proof.native.push('native-manual-run-cancel-zero-submit');
      await press('检查并确认执行一次', panel); host.lose('POST', '/api/client/workflow-executions/runs'); await press('确认提交一次', '[role=dialog]'); await b.wait('原写入仍锁定'); assert.equal(posts('runs').length, n + 1);
      await press('仅验证已有执行的读取访问', panel); await b.wait('GET 查回原请求（同键）'); await press('GET 查回原请求（同键）', panel); await b.wait('queued');
      const published = await execution.publication(f.workspace, native.id);
      const run = await f.prisma.aiPersonalWorkflowRunOrigin.findFirstOrThrow({ where: { publicationId: published.publication.id }, orderBy: { createdAt: 'desc' } });
      await b.hideAndRestore(`!document.querySelector(${JSON.stringify(panel + ' section[aria-label="当前发布状态"]')}) && !document.querySelector('pre') && [...document.querySelectorAll('textarea,input')].every(x=>!x.value)`);
      await b.wait('新建线性草稿'); await open(); await b.wait('原写入仍锁定'); await press('仅验证已有执行的读取访问', panel); await press('GET 查回原请求（同键）', panel); await b.wait('queued'); assert.equal(posts('runs').length, n + 1); proof.native.push('actual-hidden-clears-private-and-restores-same-original-request-key');
      await f.execute(); await press('GET 查回原请求（同键）', panel); await b.wait('succeeded'); await press('核对终态并明确结束原请求', panel); await b.wait('你已明确结束原请求');
      await b.fill('已有工作流执行 ID', run.runId); await press('读取原执行状态与结果', panel); await b.wait('WORKFLOW_SYNTHETIC_OUTPUT'); assert.equal(posts('runs').length, n + 1); proof.native.push('original-one-Run-Job-provider-and-terminal-fresh-GET-resolution');
      await b.shot('desktop-workflow-result'); await b.action('viewport', ['--width', '390', '--height', '844', '--scale', '1', '--mobile']); assert.equal(await b.read('document.documentElement.scrollWidth <= window.innerWidth + 1'), true); await b.shot('mobile390-workflow-result'); proof.native.push('actual-desktop390-keyboard-result');
      barrier = host.hold('/api/client/workflow-executions/runs/' + run.runId); await press('读取原执行状态与结果', panel);
      try { await waitForWorkflowGate(barrier.entered.promise); await f.setGrant('workspace.ai.read', false); }
      finally { barrier.release.resolve(); barrier = undefined; } await b.action('wait', ['--fn', '!document.querySelector("#workflow-detail-title") && !document.querySelector("pre")']); assert.equal(await b.read(`!!document.querySelector(${JSON.stringify(panel + ' section[aria-label="原执行结果"]')})`), false); await f.setGrant('workspace.ai.read', true); proof.native.push('native-late-real-result-current-grant-denial-clears-parent');
      await b.action('goto', ['--url', host.origin + '/client/workspaces']); await b.wait('Workspace'); assert.equal(await b.read(`!!document.querySelector(${JSON.stringify(panel)})`), false); proof.native.push('actual-unmount');
    });
    assert.equal(proof.cases.length, 9); assert.equal(proof.native.length, 8); proof.status = 'PASS'; proof.providerCalls = f.state.calls; await save();
  } finally {
    barrier?.release.resolve(); stores.forEach(s => s.suspend());
    try { await b.close(); } finally {
      try { await host.close(); } finally {
        if (f) { const closed = await f.close(); assert.equal(closed.status, 'CLOSED'); assert.equal(closed.applicationPools0, true); assert.equal(closed.ownedSockets0, true); assert.equal(closed.environmentRestored, true); await writeFile(join(artifact, 'closed.json'), JSON.stringify(closed, null, 2)); }
      }
    }
  }
});
