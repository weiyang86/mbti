import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRemainingClientFixture } from './remaining-client-fixture.mjs';
import { prepareAiCenter } from './ai-center-fixture.mjs';
import { prepareW21UiHost } from './w21-ui-host.mjs';
import { w21NativeBrowser } from './w21-native-browser.mjs';
import { createAgentVersionRestore } from '../../apps/web/app/components/client-agent-version-restore-state.mjs';

test('AF218 original restore store + installed SDK + real HTTP/PG + original native Agent page', { timeout: 600000 }, async t => {
  assert.equal(process.env.AIJ_AF218_ROOT_ACCEPTANCE, 'true');
  const artifact = process.env.AIJ_AF218_EVIDENCE, packedConsumer = process.env.AIJ_AF218_PACKED_CONSUMER, browser = w21NativeBrowser(artifact);
  await browser.preflight(); // Must succeed before a fresh database/application.
  const host = await prepareW21UiHost('AF-218', artifact), stores = [];
  let f, barrier;
  const proof = { task: 'AF-218', cases: [], native: [], status: 'INCOMPLETE' };
  const save = () => writeFile(join(artifact, 'proof.json'), JSON.stringify(proof, null, 2) + '\n');
  const sub = async (name, fn) => { let failure; await t.test(name, async () => { try { await fn(); proof.cases.push(name); } catch (e) { failure = e; throw e; } }); await save(); if (failure) throw failure; };
  try {
    f = await createRemainingClientFixture('AF-218', { workbenchTargetSafety: true, configuration: true, secrets: true, runtimeManagement: true, pluginManagement: true, realPluginLifecycle: true, testBrowserOrigin: host.origin });
    host.attach(f.baseUrl); proof.acceptanceId = f.lease.id;
    const sdk = await import(pathToFileURL(join(packedConsumer, 'entry.mjs')).href);
    const workspaceId = f.workspaces[0].id, memberId = f.accounts[0].id, control = { cookie: f.cookies[0], beforePatch: null };
    const api = sdk.createClientApi(() => host.origin + '/api');
    const direct = (path, options = {}) => api(path, { ...options, headers: { ...options.headers, cookie: control.cookie, origin: host.origin, connection: 'close' } });
    const request = async (path, options = {}) => { if (options.method === 'PATCH' && control.beforePatch) { const fn = control.beforePatch; control.beforePatch = null; await fn(); } return direct(path, options); };
    const agents = sdk.createPersonalAgentsClient(direct), skills = sdk.createPersonalSkillsClient(direct), publications = sdk.createPersonalAgentPublicationsClient(direct);
    const config = await prepareAiCenter(f), catalog = structuredClone(config.catalog); catalog.providers.forEach(p => { p.liveEnabled = true; }); await config.save(catalog);
    process.env.AI_CENTER_CLIENT_EXECUTION_ENABLED = 'true'; process.env.AI_CENTER_LIVE_ENABLED = 'true';
    const transport = f.app.get(f.requireApi('plugins/aij-ai/ai-center-provider.js').AiCenterHttpTransport); let providerCalls = 0;
    transport.request = async () => { providerCalls++; throw Error('AF218 must never execute a restored Agent'); };
    const model = await agents.modelOptions(workspaceId), skill = await skills.create(workspaceId, { code: 'restore-' + randomUUID(), name: 'AF218 pinned prompt', instructions: 'AF218_PRIVATE_SKILL' });
    const content = { name: 'AF218 original', instructions: 'AF218_PRIVATE_ORIGINAL', enabled: true, modelCode: 'advice-text', modelRevision: model.items.find(m => m.code === 'advice-text').revision, catalogVersion: model.catalogVersion, inputFields: ['text'], outputFormat: 'text', outputFields: [], skillBindings: [{ skillId: skill.id, revision: 1 }] };
    const make = async () => {
      let head = await agents.create(workspaceId, { ...content, code: 'restore-' + randomUUID() });
      head = await agents.update(workspaceId, head.id, { ...content, name: 'AF218 second', expectedRevision: head.revision });
      head = await agents.update(workspaceId, head.id, { ...content, name: 'AF218 current', instructions: 'AF218_PRIVATE_CURRENT', expectedRevision: head.revision });
      return head;
    };
    let head = await make(), changed = 0;
    const scope = h => ({ memberId, workspaceId, agentId: h.id, revision: h.revision });
    const makeStore = (opts = {}) => { const s = createAgentVersionRestore({ request, agentsClientFactory: sdk.createPersonalAgentsClient, publicationsClientFactory: sdk.createPersonalAgentPublicationsClient, onAgentChanged: () => changed++, ...opts }); stores.push(s); return s; };
    const store = makeStore();
    const prepare = async (s = store, h = head) => { s.setScope(scope(h)); await s.loadHistory(); assert.equal(s.getSnapshot().issue, null); const v = s.getSnapshot().versions.find(v => v.revision === 1); assert.ok(v); await s.selectVersion(v.id); assert.equal(s.getSnapshot().selected.revision, 1); return v; };
    const counts = async () => ({ versions: await f.prisma.aiPersonalAgentVersion.count(), bindings: await f.prisma.aiPersonalAgentSkillBinding.count(), audits: await f.prisma.auditLog.count({ where: { resourceType: 'ai_personal_agent' } }), runs: await f.prisma.aiAgentRun.count(), jobs: await f.prisma.runtimeJob.count(), traces: await f.prisma.aiExecutionTrace.count() });
    const patches = () => host.traffic.filter(x => x.method === 'PATCH');
    const role = await f.prisma.clientWorkspaceRole.findUniqueOrThrow({ where: { workspaceId_code: { workspaceId, code: 'OWNER' } } });
    const grant = async (code, enabled) => { const g = await f.prisma.clientWorkspaceRolePermission.findFirstOrThrow({ where: { roleId: role.id, permission: { code } } }); await f.prisma.clientWorkspaceRolePermission.update({ where: { id: g.id }, data: { deletedAt: enabled ? null : new Date() } }); };
    await sub('real original history/model/pins and cancelled confirmation have no writes', async () => {
      const before = await counts(), p = patches().length; await prepare(); await store.requestConfirmation(); assert.equal(store.getSnapshot().confirmation, true); store.cancelConfirmation();
      assert.deepEqual(await counts(), before); assert.equal(patches().length, p); assert.equal(changed, 0);
    });
    let oldRun, originalVersions, originalRun;
    await sub('one original PATCH creates disabled unpublished immutable head; old versions and real queued Run reference unchanged', async () => {
      const metadata = await publications.get(workspaceId, head.id); await publications.publish(workspaceId, head.id, { expectedAgentRevision: head.revision, expectedPublicationVersion: metadata.publicationVersion });
      oldRun = (await f.request('POST', `client/ai/personal-agents/${head.id}/runs`, { cookie: f.cookies[0], workspaceId, status: 202, body: { expectedRevision: head.revision, input: { text: 'AF218 original queued input' }, idempotencyKey: 'af218-' + randomUUID() } })).data;
      originalRun = await f.prisma.aiAgentRun.findUniqueOrThrow({ where: { id: oldRun.id } });
      originalVersions = await f.prisma.aiPersonalAgentVersion.findMany({ where: { agentId: head.id }, orderBy: { revision: 'asc' } });
      const before = await counts(), publicationBefore = await publications.get(workspaceId, head.id), p = patches().length;
      await store.requestConfirmation(); await store.confirmRestore(); assert.equal(store.getSnapshot().issue, null); assert.equal(store.getSnapshot().locked, false);
      head = await agents.get(workspaceId, head.id); assert.equal(head.revision, 4); assert.equal(head.enabled, false); assert.equal(head.name, content.name);
      const publication = await publications.get(workspaceId, head.id); assert.equal(publication.published, false); assert.equal(publication.publicationVersion, publicationBefore.publicationVersion + 1);
      const after = await counts(); assert.equal(after.versions, before.versions + 1); assert.equal(after.audits, before.audits + 1); assert.equal(patches().length, p + 1); assert.equal(changed, 1);
      for (const k of ['runs', 'jobs', 'traces']) assert.equal(after[k], before[k]);
      assert.deepEqual(await f.prisma.aiPersonalAgentVersion.findMany({ where: { agentId: head.id, revision: { lte: 3 } }, orderBy: { revision: 'asc' } }), originalVersions);
      assert.deepEqual(await f.prisma.aiAgentRun.findUniqueOrThrow({ where: { id: oldRun.id } }), originalRun);
    });
    await sub('identical disabled projection has zero PATCH and zero new version', async () => {
      await prepare(); const before = await counts(), p = patches().length; await store.requestConfirmation(); assert.match(store.getSnapshot().notice, /未发送 PATCH/); await store.confirmRestore(); assert.equal(patches().length, p); assert.deepEqual(await counts(), before);
    });
    await sub('real committed truncated PATCH reply keeps owner lock across null/foreign scope, explicit read and fresh separate ACK', async () => {
      head = await agents.update(workspaceId, head.id, { ...content, instructions: 'AF218 unknown current', expectedRevision: head.revision }); await prepare(); await store.requestConfirmation();
      const before = await counts(), p = patches().length; host.lose('PATCH', '/api/client/ai/personal-agents/' + head.id); await store.confirmRestore(); assert.equal(store.getSnapshot().locked, true); assert.equal(store.getSnapshot().selected, null);
      head = await agents.get(workspaceId, head.id); assert.equal(head.revision, 6); assert.equal((await counts()).versions, before.versions + 1); assert.equal(patches().length, p + 1);
      store.setScope(null); assert.equal(store.getSnapshot().locked, true); store.setScope({ ...scope(head), memberId: f.accounts[1].id }); await store.readRecovery(); await store.acknowledgeRecovery(); assert.equal(store.getSnapshot().recovery, null); assert.equal(store.getSnapshot().locked, true);
      store.setScope(scope(head)); await store.readRecovery(); assert.equal(store.getSnapshot().recovery.revision, 6); assert.equal(store.getSnapshot().locked, true); await store.acknowledgeRecovery(); assert.equal(store.getSnapshot().locked, false); assert.equal(patches().length, p + 1);
    });
    await sub('actual server CAS409 preserves concurrent human edit and uncertain lock until explicit resolution', async () => {
      head = await agents.update(workspaceId, head.id, { ...content, name: 'AF218 before CAS', expectedRevision: head.revision }); await prepare(); await store.requestConfirmation();
      control.beforePatch = async () => { head = await agents.update(workspaceId, head.id, { ...content, name: 'AF218 human edit', expectedRevision: head.revision }); };
      const before = await counts(); await store.confirmRestore(); assert.equal(store.getSnapshot().issue.status, 409); assert.equal(store.getSnapshot().locked, true); assert.equal((await agents.get(workspaceId, head.id)).name, 'AF218 human edit'); assert.equal((await counts()).versions, before.versions + 1);
      store.setScope(scope(head)); await store.readRecovery(); await store.acknowledgeRecovery(); assert.equal(store.getSnapshot().locked, false);
    });
    await sub('real current manage/read revocation and same-member session generation block before PATCH', async () => {
      for (const code of ['workspace.ai.assets.manage', 'workspace.ai.assets.read']) {
        await prepare(); await store.requestConfirmation(); const p = patches().length; await grant(code, false);
        try { await store.confirmRestore(); assert.equal(store.getSnapshot().head, null); assert.equal(store.getSnapshot().selected, null); assert.equal(patches().length, p); }
        finally { await grant(code, true); }
      }
      await prepare(); await store.requestConfirmation(); const p = patches().length;
      const account = JSON.parse(await readFile(f.accounts[0].initialPasswordFile, 'utf8')).accounts.find(a => a.id === memberId);
      const login = await f.request('POST', 'client/auth/login', { body: { email: f.accounts[0].email, password: account.password } }); control.cookie = login.response.headers.get('set-cookie').split(';')[0];
      try { await store.confirmRestore(); assert.equal(store.getSnapshot().head, null); assert.equal(patches().length, p); } finally { control.cookie = f.cookies[0]; }
    });
    await sub('actual late HTTP history response is discarded after null scope', async () => {
      store.setScope(scope(head)); barrier = host.hold(`/api/client/ai/personal-agents/${head.id}/versions`); const pending = store.loadHistory();
      try { await Promise.race([barrier.entered.promise, new Promise((_, no) => { const timer = setTimeout(() => no(Error('Original history response missing')), 15000); timer.unref(); })]); store.setScope(null); }
      finally { barrier.release.resolve(); barrier = undefined; } await pending; assert.deepEqual(store.getSnapshot().versions, []); assert.equal(store.getSnapshot().head, null);
    });
    await sub('original desktop/390 keyboard/cancel/restore/noop/lost-response/realhidden/current-revocation/unmount', async () => {
      const nativeHead = await make(); await host.startWeb();
      const account = JSON.parse(await readFile(f.accounts[0].initialPasswordFile, 'utf8')).accounts.find(a => a.id === memberId);
      const b = browser;
      await b.action('create', ['--url', host.origin + '/client/login']); await b.action('switch', ['--focus']);
      await b.fill('邮箱', f.accounts[0].email, true); await b.fill('密码', account.password, true); await b.activate('登 录'); await b.action('wait', ['--url', '/client']);
      await b.action('goto', ['--url', host.origin + '/client/agents?workspaceId=' + workspaceId]); await b.wait('新建 Agent');
      const open = async () => { await b.activate('查看', `tr[data-row-key="${nativeHead.id}"]`); await b.wait('验证并读取历史配置'); };
      const select = async () => { await b.activate('验证并读取历史配置'); await b.wait('比较此版本'); await b.activate('比较 Agent 历史版本 v1'); await b.action('wait', ['--selector', 'section[aria-label="当前配置与历史配置比较"]']); };
      await open(); await select(); const p = patches().length; await b.activate('检查恢复为新版本'); await b.wait('确认恢复历史配置为新版本'); await b.action('keypress', ['--key', 'Escape']); assert.equal(patches().length, p); proof.native.push('real-keyboard-cancel-zero-PATCH');
      await b.shot('desktop-comparison'); await b.action('viewport', ['--width', '390', '--height', '844', '--scale', '1', '--mobile']); assert.equal(await b.read('document.documentElement.scrollWidth <= window.innerWidth + 1'), true); await b.shot('mobile390-comparison'); proof.native.push('actual-desktop-and-390');
      await b.activate('检查恢复为新版本'); await b.activate('确认创建禁用且未发布的新版本', '[role=dialog]'); await b.wait('新建 Agent'); await b.action('wait', ['--fn', '!document.querySelector("[role=dialog]")']);
      let current = await agents.get(workspaceId, nativeHead.id); assert.equal(current.revision, 4); assert.equal(current.enabled, false); assert.equal((await publications.get(workspaceId, nativeHead.id)).published, false); assert.equal(patches().length, p + 1); proof.native.push('one-native-PATCH-new-disabled-unpublished-version');
      await open(); await select(); await b.wait('核对无需更改'); const beforeNoop = patches().length; await b.activate('核对无需更改'); await b.wait('未发送 PATCH'); assert.equal(patches().length, beforeNoop); proof.native.push('native-noop-zero-PATCH');
      current = await agents.update(workspaceId, nativeHead.id, { ...content, instructions: 'AF218_NATIVE_UNKNOWN_CURRENT', expectedRevision: current.revision });
      await b.activate('重新读取当前 Agent（丢弃草稿）'); await b.wait('验证并读取历史配置'); await select(); await b.activate('检查恢复为新版本'); host.lose('PATCH', '/api/client/ai/personal-agents/' + nativeHead.id); const beforeUnknown = patches().length;
      await b.activate('确认创建禁用且未发布的新版本', '[role=dialog]'); await b.wait('前次恢复结果尚未确认'); assert.equal(patches().length, beforeUnknown + 1);
      await b.activate('编辑'); await b.action('wait', ['--selector', 'textarea[aria-label="Agent 指令"]']); assert.equal(await b.read('document.querySelectorAll("h3").length > 0'), true); await b.wait('前次恢复结果尚未确认');
      await b.activate('重新读取当前 Agent（丢弃草稿）'); await b.wait('读取前次恢复的当前状态'); await b.activate('读取前次恢复的当前状态'); await b.wait('已核对当前状态，解除恢复锁');
      assert.equal(patches().length, beforeUnknown + 1); proof.native.push('native-unknown-lock-survives-parent-editor-null-and-read');
      await b.hideAndRestore('!document.querySelector("pre") && !document.querySelector("[role=dialog]") && !document.body.textContent.includes("AF218_PRIVATE_ORIGINAL")');
      await b.wait('新建 Agent'); await open(); await b.wait('前次恢复结果尚未确认'); await b.activate('读取前次恢复的当前状态'); await b.activate('已核对当前状态，解除恢复锁'); await b.wait('新建 Agent'); assert.equal(patches().length, beforeUnknown + 1); proof.native.push('actual-OS-hidden-clears-private-and-restored-original-lock-fresh-ACK');
      await open(); await select(); await grant('workspace.ai.assets.read', false);
      try { await b.activate('验证并读取历史配置'); await b.action('wait', ['--fn', '!document.querySelector("#agent-detail-title") && !document.querySelector("pre") && !document.body.textContent.includes("AF218_PRIVATE_ORIGINAL")']); assert.equal(await b.read(`!!document.querySelector(${JSON.stringify('section[aria-label="当前配置与历史配置比较"]')})`), false); }
      finally { await grant('workspace.ai.assets.read', true); }
      proof.native.push('current-read-revocation-clears-private'); await b.action('goto', ['--url', host.origin + '/client/workspaces']); await b.wait('Workspace'); assert.equal(await b.read('document.body.textContent.includes("从历史配置创建新版本")'), false); proof.native.push('actual-unmount');
    });
    await sub('original server rejects deleted/foreign/executable Skill pins and stale catalog without silent upgrade', async () => {
      const disposableSkill = await skills.create(workspaceId, { code: 'deleted-' + randomUUID(), name: 'Deleted pin', instructions: 'Synthetic deleted prompt' });
      let asset = await agents.create(workspaceId, { ...content, code: 'deleted-' + randomUUID(), skillBindings: [{ skillId: disposableSkill.id, revision: 1 }] });
      asset = await agents.update(workspaceId, asset.id, { ...content, name: 'New current', skillBindings: [{ skillId: disposableSkill.id, revision: 1 }], expectedRevision: 1 });
      const s = makeStore(); await prepare(s, asset); await s.requestConfirmation(); await skills.delete(workspaceId, disposableSkill.id, 1); const before = await counts(); await s.confirmRestore(); assert.equal(s.getSnapshot().locked, true); assert.ok([404,409].includes(s.getSnapshot().issue.status)); assert.deepEqual(await counts(), before);
      const otherApi = sdk.createClientApi(() => f.baseUrl), otherRequest = (path, options = {}) => otherApi(path, { ...options, headers: { ...options.headers, cookie: f.cookies[1], origin: host.origin, connection: 'close' } });
      await assert.rejects(sdk.createPersonalAgentsClient(otherRequest).get(workspaceId, head.id), e => [403,404].includes(e.status));
      await assert.rejects(agents.get(f.workspaces[1].id, head.id), e => [403,404].includes(e.status));
      const script = await skills.create(workspaceId, { code: 'script-' + randomUUID(), name: 'Executable pin', instructions: 'Synthetic prompt' });
      const executable = await sdk.createPersonalScriptExecutionClient(direct).createVersion(workspaceId, { skillId: script.id, expectedRevision: 1, name: script.name, instructions: script.instructions, scriptSource: 'print(1)\n' });
      const stable = await counts(); await assert.rejects(agents.update(workspaceId, head.id, { ...content, skillBindings: [{ skillId: script.id, revision: executable.revision }], expectedRevision: head.revision }), e => [400,404,409].includes(e.status)); assert.deepEqual(await counts(), stable);
      await prepare(); await store.requestConfirmation(); await config.save({ ...catalog, monthlyBudgetNanos: '10000000001' }, 1); const p = patches().length; await store.confirmRestore(); assert.equal(store.getSnapshot().head, null); assert.equal(patches().length, p);
    });
    assert.equal(providerCalls, 0); assert.deepEqual(await f.prisma.aiAgentRun.findUniqueOrThrow({ where: { id: oldRun.id } }), originalRun);
    proof.providerCalls = providerCalls; proof.oldRunReferenceUnchanged = true; proof.status = 'PASS'; await save();
  } finally {
    barrier?.release.resolve(); stores.forEach(s => s.dispose()); await browser.close(); await host.close();
    if (f) { const closed = await f.close(); for (const k of ['applicationPools0', 'ownedSockets0', 'environmentRestored']) assert.equal(closed[k], true); await writeFile(join(artifact, 'closed.json'), JSON.stringify(closed, null, 2)); }
  }
});
