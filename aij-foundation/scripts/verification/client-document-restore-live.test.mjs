// Actual original SDK/API/PG/renderer and original production page. No fake replies.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRemainingClientFixture } from './remaining-client-fixture.mjs';
import { prepareW21UiHost } from './w21-ui-host.mjs';
import { w21NativeBrowser } from './w21-native-browser.mjs';
import { startNativeChrome } from './w22-native-chrome.mjs';
import { createDocumentVersionRestore } from '../../apps/web/app/components/client-document-restore-state.mjs';
const root = '/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation';
const image = 'sha256:b2322ac98afa484dd6722fc3e19775fca9c0bc8e360e9843b9dd0da663a602c1';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const gate = async promise => { let timer; try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('AF221_ACTUAL_HTTP_BARRIER_TIMEOUT')), 15000); })]); } finally { clearTimeout(timer); } };

test('AF221 actual immutable history restore, lost committed reply, current scope and native page', { timeout: 900000 }, async () => {
  assert.equal(process.env.AIJ_AF221_ROOT_ACCEPTANCE, 'true'); assert.equal(process.cwd(), root);
  const artifact = process.env.AIJ_AF221_ROOT_ARTIFACT; assert.ok(artifact.startsWith(join(root, '.artifacts/')));
  const consumer = process.env.AIJ_AF221_PACKED_CONSUMER; assert.match(consumer, /^\/private\/tmp\/aij-af221-packed-[A-Za-z0-9]+$/);
  const sdk = await import(pathToFileURL(join(consumer, 'node_modules/@aij/sdk/dist/index.mjs')));
  assert.equal(hash(await readFile(join(consumer, 'node_modules/@aij/sdk/dist/index.mjs'))), hash(await readFile('packages/sdk/dist/index.mjs')));
  assert.equal(JSON.parse(execFileSync('/usr/local/bin/docker', ['image', 'inspect', '--format', '{{json .Id}}', image], { encoding: 'utf8' })), image);
  let host, f, browser, chrome, held, storage, failure, phase = 'SETUP';
  const proof = { task: 'AF-221', status: 'RUNNING', ownerAcceptance: 'PENDING', cases: [], nativeHidden: 'NOT_PROVEN' };
  const save = () => writeFile(join(artifact, 'proof.json'), JSON.stringify({ ...proof, phase }, null, 2) + '\n', { mode: 0o600 });
  const step = async (name, action) => { phase = name; await save(); await action(); proof.cases.push(name); await save(); };
  try {
    host = await prepareW21UiHost('AF-221', artifact);
    f = await createRemainingClientFixture('AF-221', { workbenchTargetSafety: true, testBrowserOrigin: host.origin, storageEnabled: true,
      documentExport: { approvedImage: image, dockerCliPath: '/usr/local/bin/docker' } }); host.attach(f.baseUrl.replace(/\/api$/, ''));
    const workspaceId = f.workspaces[0].id, memberId = f.accounts[0].id;
    const rawApi = sdk.createClientApi(() => host.origin + '/api');
    const request = (path, options = {}) => rawApi(path, { ...options, headers: { ...Object.fromEntries(new Headers(options.headers)), cookie: f.cookies[0], origin: host.origin, connection: 'close' } });
    const documents = sdk.createPersonalDocumentsClient(request), exports = sdk.createPersonalDocumentExportsClient(request);
    const { LocalStorageAdapter } = f.requireApi('files/local-storage.adapter.js'); storage = f.app.get(LocalStorageAdapter);
    const counters = async () => [await f.prisma.aiAgentRun.count(), await f.prisma.runtimeJob.count(), await f.prisma.aiExecutionTrace.count()];
    const beforeCounters = await counters();
    let doc, legacy, originalExports, bytes, scope, controller, denials = 0;
    const versions = async () => f.prisma.personalDocumentVersion.count({ where: { documentId: doc.id } });
    const current = () => documents.get(workspaceId, doc.id);
    const refreshScope = async () => { const head = await current(); scope = { memberId, workspaceId, documentId: doc.id, revision: head.revision }; return head; };
    const makeController = (port = request) => {
      const value = createDocumentVersionRestore({ request: port, onScopeRejected: () => { denials++; value.setScope(null); } }); value.setScope(scope); return value;
    };
    const select = async (value, revision) => { await value.loadHistory(); assert.ok(value.getSnapshot().head); await value.selectVersion(revision); assert.equal(value.getSnapshot().selected?.revision, revision); };
    await step('real-v1-v2-original-linux-exports-and-installed-sdk', async () => {
      doc = await documents.create(workspaceId, { code: 'af221-history', name: '历史合成文档', body: 'AF221 private synthetic original text.\n第一版。' });
      originalExports = [];
      for (const format of ['docx', 'pdf']) originalExports.push(await exports.create(workspaceId, { documentId: doc.id, expectedRevision: 1, format }));
      bytes = await Promise.all(originalExports.map(value => exports.download(workspaceId, value)));
      for (const [i, value] of bytes.entries()) assert.equal(hash(value.bytes), originalExports[i].checksum);
      doc = await documents.update(workspaceId, doc.id, { expectedRevision: 1, name: '第二版合成文档', body: 'AF221 private synthetic revised text.\n第二版。' });
      legacy = await Promise.all([1, 2].map(revision => documents.getVersion(workspaceId, doc.id, revision))); await refreshScope();
    });
    await step('cancel-zero-patch-then-exactly-one-new-version-and-noop', async () => {
      controller = makeController(); await select(controller, 1); const count = await versions();
      await controller.requestConfirmation(); assert.equal(controller.getSnapshot().confirmation, true); controller.cancelConfirmation(); assert.equal(await versions(), count);
      await controller.requestConfirmation(); await controller.confirmRestore(); assert.equal(controller.getSnapshot().locked, false);
      const head = await refreshScope(); assert.equal(head.revision, 3); assert.ok(head.name === legacy[0].name && head.body === legacy[0].body);
      assert.equal(head.code, doc.code); assert.equal(head.createdAt, doc.createdAt);
      controller.setScope(scope); await select(controller, 1); assert.equal(controller.noChange(), true);
      await controller.requestConfirmation(); assert.equal(controller.getSnapshot().confirmation, false); assert.equal(await versions(), count + 1);
    });
    await step('one-real-committed-lost-reply-opaque-lock-null-foreign-role-and-fresh-ack', async () => {
      controller.setScope(scope); await select(controller, 2); await controller.requestConfirmation();
      const path = '/api/client/documents/' + doc.id, before = host.traffic.filter(row => row.method === 'PATCH' && row.path === path).length;
      host.lose('PATCH', path); await controller.confirmRestore(); assert.equal(controller.getSnapshot().locked, true); assert.equal((await current()).revision, 4);
      controller.setScope(null); assert.equal(controller.getSnapshot().locked, true); assert.equal(controller.getSnapshot().head, null);
      controller.setScope({ ...scope, memberId: f.accounts[1].id, workspaceId: f.workspaces[1].id }); await controller.readRecovery(); assert.equal(controller.getSnapshot().locked, true);
      controller.setScope(scope);
      const membership = await f.prisma.clientWorkspaceMembership.findUniqueOrThrow({ where: { workspaceId_memberId: { workspaceId, memberId } } });
      const grants = await f.prisma.clientWorkspaceRolePermission.findMany({ where: { roleId: membership.roleId, deletedAt: null }, select: { permissionId: true } });
      const clone = await f.prisma.clientWorkspaceRole.create({ data: { workspaceId, code: 'AF221_CLONE', name: 'Synthetic equal-grant role', rolePermissions: { create: grants.map(value => ({ permissionId: value.permissionId })) } } });
      await f.prisma.clientWorkspaceMembership.update({ where: { id: membership.id }, data: { roleId: clone.id } });
      try { await controller.readRecovery(); assert.equal(controller.getSnapshot().locked, true); assert.equal(controller.getSnapshot().recovery, null); }
      finally { await f.prisma.clientWorkspaceMembership.update({ where: { id: membership.id }, data: { roleId: membership.roleId } }); }
      controller.setScope(scope); await controller.readRecovery(); assert.equal(controller.getSnapshot().recovery?.revision, 4);
      await controller.acknowledgeRecovery(); assert.equal(controller.getSnapshot().locked, false); assert.equal(host.traffic.filter(row => row.method === 'PATCH' && row.path === path).length, before + 1);
      await refreshScope();
    });
    await step('actual-cas409-preserves-human-revision-and-late-current-permission-denial', async () => {
      let concurrent = false;
      const port = async (path, options = {}) => {
        if (!concurrent && options.method === 'PATCH') { concurrent = true; const head = await current(); await documents.update(workspaceId, doc.id, { expectedRevision: head.revision, name: head.name, body: 'AF221 human current content remains.' }); }
        return request(path, options);
      };
      controller = makeController(port); await select(controller, 1); await controller.requestConfirmation(); await controller.confirmRestore();
      assert.equal(concurrent, true); assert.equal(controller.getSnapshot().locked, true); assert.equal(controller.getSnapshot().issue?.status, 409);
      assert.ok((await current()).body === 'AF221 human current content remains.'); await refreshScope();
      const permission = await f.prisma.clientWorkspacePermission.findUniqueOrThrow({ where: { code: 'workspace.documents.read' } });
      controller = makeController(); held = host.hold('/api/client/documents/' + doc.id); const pending = controller.loadHistory(); await gate(held.entered.promise);
      await f.prisma.clientWorkspacePermission.update({ where: { id: permission.id }, data: { status: 'disabled' } });
      try { held.release.resolve(); held = undefined; await pending; assert.equal(controller.getSnapshot().head, null); assert.equal(controller.getSnapshot().selected, null); assert.ok(denials > 0); }
      finally { await f.prisma.clientWorkspacePermission.update({ where: { id: permission.id }, data: { status: 'active' } }); }
    });
    await step('old-history-and-original-word-pdf-references-and-bytes-unchanged', async () => {
      const after = await Promise.all([1, 2].map(revision => documents.getVersion(workspaceId, doc.id, revision)));
      assert.equal(hash(JSON.stringify(after)), hash(JSON.stringify(legacy)));
      for (const [i, value] of originalExports.entries()) { assert.equal(hash(JSON.stringify(await exports.get(workspaceId, value.id))), hash(JSON.stringify(value))); const download = await exports.download(workspaceId, value); assert.equal(hash(download.bytes), hash(bytes[i].bytes)); }
      assert.equal(await f.prisma.personalDocumentExport.count({ where: { documentId: doc.id } }), 2); assert.deepEqual(await counters(), beforeCounters);
      await assert.rejects(rawApi('/client/documents/' + doc.id, { workspaceId }), error => error.status === 401);
      const other = sdk.createPersonalDocumentsClient((path, options = {}) => rawApi(path, { ...options, headers: { cookie: f.cookies[1], origin: host.origin } }));
      await assert.rejects(other.get(f.workspaces[1].id, doc.id), error => error.status === 404);
    });
    await host.startWeb(); browser = w21NativeBrowser(artifact);
    const account = JSON.parse(await readFile(f.accounts[0].initialPasswordFile, 'utf8')).accounts.find(value => value.id === memberId);
    const click = async (label, selector) => {
      await browser.action('wait', ['--fn', '[...(document.querySelector(' + JSON.stringify(selector ?? 'body') + ')?.querySelectorAll("button") ?? [])].filter(b=>!b.disabled && (b.getAttribute("aria-label") ?? b.textContent).replace(/\\s/g,"")===' + JSON.stringify(label.replace(/\s/g, '')) + ').length===1']);
      return browser.action('click', ['--element', await browser.ref(label, 'button', selector)]);
    };
    const open = async () => {
      await browser.action('goto', ['--url', host.origin + '/client/documents?workspaceId=' + workspaceId]);
      await browser.action('switch'); await browser.action('wait', ['--selector', '[aria-label="个人文档库"]']);
      await click('读取文档列表'); await browser.wait(doc.code); await click('打开', '[aria-label="个人文档库"]'); await browser.wait('编辑文档 · v');
      await click('退出编辑，比较历史'); await browser.wait('已保存文档 · v');
    };
    await step('original-production-desktop-and-mobile390-restore-and-permanent-unknown-lock', async () => {
      await browser.action('create', ['--url', host.origin + '/client/login', '--split', 'right']); await browser.action('switch');
      await browser.action('wait', ['--selector', 'input[type="email"]']);
      await browser.fill('邮箱', f.accounts[0].email, true, 'input[type="email"]'); await browser.fill('密码', account.password, true); await click('登录');
      await browser.action('wait', ['--url', '/client/workspaces']); await open();
      await click('验证并读取文档历史'); await browser.wait('比较此版本'); await click('比较文档历史 v1');
      await click('检查恢复为新版本'); await browser.wait('确认文档历史恢复为新版本'); await click('取消，返回比较');
      assert.equal((await current()).revision, 5); await click('检查恢复为新版本'); await click('确认创建新版本'); await browser.wait('已保存文档 · v6');
      assert.ok((await current()).body === legacy[0].body); await browser.shot('desktop-document-restored-v6');
      await browser.action('viewport', ['--width', '390', '--height', '844', '--scale', '1', '--mobile']); assert.equal(await browser.read('innerWidth'), 390);
      assert.equal(await browser.read('document.documentElement.scrollWidth <= innerWidth + 1'), true); await browser.shot('mobile390-document-restored');
      await click('验证并读取文档历史'); await click('比较文档历史 v2'); await click('检查恢复为新版本');
      const path = '/api/client/documents/' + doc.id, before = host.traffic.filter(row => row.method === 'PATCH' && row.path === path).length;
      const lostReply = host.lose('PATCH', path); await click('确认创建新版本'); await gate(lostReply.committed.promise);
      await browser.wait('后续恢复已锁定'); assert.equal((await current()).revision, 7);
      await click('关闭并清除正文'); await browser.wait('后续恢复已锁定');
      assert.equal(await browser.read('[...document.querySelectorAll("button")].find(button=>button.textContent==="新建文档")?.disabled'), true);
      await click('读取文档列表'); await browser.wait(doc.code); await click('打开', '[aria-label="个人文档库"]'); await browser.wait('已保存文档 · v7');
      await click('读取前次恢复的当前结果'); await browser.wait('当前保存版本 v7'); await click('已核对，重新验证并解除恢复锁'); await browser.wait('已保存文档 · v7');
      assert.equal(host.traffic.filter(row => row.method === 'PATCH' && row.path === path).length, before + 1);
    });
    await step('mandatory-real-headed-chrome-blur-hidden-and-unmount', async () => {
      await browser.close(); await mkdir(join(artifact, 'chrome'), { recursive: true });
      chrome = await startNativeChrome({ origin: host.origin, artifact: join(artifact, 'chrome') });
      await chrome.fill('邮箱', f.accounts[0].email, 'input[type="email"]', true); await chrome.fill('密码', account.password, 'input[type="password"]', true); await chrome.click('登录');
      await chrome.wait('location.pathname === "/client/workspaces"');
      const openChrome = async () => {
        proof.chromeStage = 'navigate-original-documents';
        await chrome.navigate('/client/documents?workspaceId=' + workspaceId); await chrome.wait('document.body.innerText.includes("读取文档列表")');
        proof.chromeStage = 'list-and-open';
        await chrome.click('读取文档列表'); await chrome.wait('document.body.innerText.includes(' + JSON.stringify(doc.code) + ')'); await chrome.click('打开');
        await chrome.wait('document.body.innerText.includes("编辑文档 · v")'); proof.chromeStage = 'exit-saved-edit'; await chrome.click('退出编辑，比较历史'); await chrome.wait('!!document.querySelector("pre[aria-label=已保存正文]")');
      };
      const compareChrome = async () => {
        await openChrome(); await chrome.click('验证并读取文档历史'); await chrome.click('比较文档历史 v1');
        await chrome.wait('!!document.querySelector("[aria-label=当前与历史文档比较]")');
        await chrome.click('检查恢复为新版本'); await chrome.wait('!!document.querySelector("[role=dialog]")');
      };
      const clear = '!document.querySelector("textarea[aria-label=文档正文]")?.value && !document.querySelector("pre[aria-label=已保存正文]")?.textContent && !document.querySelector("[aria-label=当前与历史文档比较]") && !document.querySelector("[aria-label=前次恢复当前结果]") && !document.querySelector("[role=dialog]")';
      await compareChrome(); const blur = await chrome.blur(clear); assert.equal(blur.focused, false); assert.equal(blur.hidden, false); assert.equal(blur.clear, true);
      await compareChrome(); const hidden = await chrome.hidden(clear); assert.equal(hidden.hidden, true); assert.equal(hidden.clear, true); proof.nativeHidden = 'ACTUAL_OBSERVED';
      proof.chromeScreenshot = await chrome.shot('native-hidden-restored'); await compareChrome(); await chrome.navigate('/client/workspaces'); assert.equal(await chrome.read(clear), true);
    });
    assert.equal(hash(JSON.stringify(await Promise.all([1, 2].map(revision => documents.getVersion(workspaceId, doc.id, revision))))), hash(JSON.stringify(legacy)));
    assert.equal(await f.prisma.personalDocumentExport.count({ where: { documentId: doc.id } }), 2);
    for (const [i, value] of originalExports.entries()) {
      assert.equal(hash(JSON.stringify(await exports.get(workspaceId, value.id))), hash(JSON.stringify(value)));
      assert.equal(hash((await exports.download(workspaceId, value)).bytes), hash(bytes[i].bytes));
    }
    assert.deepEqual(await counters(), beforeCounters); proof.acceptanceId = f.lease.id; proof.status = 'PASS'; await save();
  } catch (error) {
    failure = error; proof.status = 'FAIL';
    if (chrome) try { proof.chromeFailureState = await chrome.read('({focused:document.hasFocus(),hidden:document.hidden,editing:!!document.querySelector("textarea[aria-label=文档正文]"),saved:!!document.querySelector("pre[aria-label=已保存正文]"),buttons:[...document.querySelectorAll("button")].map(b=>({label:b.getAttribute("aria-label") ?? b.textContent,disabled:b.disabled}))})'); } catch { /* preserve original failure */ }
    await writeFile(join(artifact, 'failure.json'), JSON.stringify({ phase, code: typeof error?.code === 'string' && /^[A-Za-z_]{2,80}$/.test(error.code) ? error.code : 'FAILED',
      frames: String(error?.stack ?? '').split('\n').filter(line => /^\s+at /.test(line)).slice(0, 8), traffic: host?.traffic.slice(-15) }, null, 2), { mode: 0o600 });
  } finally {
    held?.release.resolve(); const failures = [];
    for (const close of [() => chrome?.close(), () => browser?.close(), () => host?.close()]) try { await close(); } catch { failures.push('HOST_OR_BROWSER'); }
    if (f) try {
      if (storage) for (const asset of await f.prisma.fileAsset.findMany({ where: { workspaceId: { in: f.workspaces.map(value => value.id) } }, select: { objectKey: true } })) if (await storage.exists(asset.objectKey)) await storage.remove(asset.objectKey);
      const closed = await f.close(); for (const key of ['applicationPools0', 'ownedSockets0', 'environmentRestored']) assert.equal(closed[key], true);
    } catch { failures.push('FIXTURE'); }
    await writeFile(join(artifact, 'closed.json'), JSON.stringify({ status: failures.length ? 'CLEANUP_FAILED' : 'CLOSED', failures }), { mode: 0o600 });
    if (failures.length) failure = Error('AF221_MEASURED_CLEANUP_FAILED'); await save();
  }
  if (failure) throw Error('AF221_REAL_ACCEPTANCE_FAILED_AT_' + phase + ': ' + artifact);
});
