import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { readFile, writeFile, mkdir, lstat, copyFile, rm } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { createRemainingClientFixture } from './remaining-client-fixture.mjs';
import { prepareDocumentExportHost, createDocumentExportDriver } from './client-document-export-browser.mjs';
import { repositoryRoot } from '../database/connection.mjs';
const exec = promisify(execFile), hash = bytes => createHash('sha256').update(bytes).digest('hex');
const image = 'sha256:b2322ac98afa484dd6722fc3e19775fca9c0bc8e360e9843b9dd0da663a602c1';
const gate = async promise => { let timer; try { return await Promise.race([promise, new Promise((_, no) => { timer = setTimeout(() => no(Error('AF203 actual barrier timeout')), 15000); })]); } finally { clearTimeout(timer); } };

test('AF203 original document page, actual OS files, current SDK/PG/Linux and privacy', { timeout: 720000 }, async () => {
  assert.equal(process.env.AIJ_AF203_ROOT_ACCEPTANCE, 'true'); assert.equal(process.cwd(), repositoryRoot);
  const folder = join(repositoryRoot, '.artifacts/auto-ai-program-20261105/W21', 'AF-203-actual-' + randomUUID()); await mkdir(folder, { recursive: true, mode: 0o700 });
  let host, f, driver, disabled, barrier, storage, restoreWindow, ownedDownload, failure;
  const proof = { task: 'AF-203', status: 'RUNNING', cases: [], screenshots: [], downloads: [], actualBrowserCors: false };
  const save = () => writeFile(join(folder, 'proof.json'), JSON.stringify(proof, null, 2) + '\n');
  const computer = async args => {
    let raw; try { raw = (await exec('/usr/local/bin/orca', ['computer', ...args, '--json'], { encoding: 'utf8', timeout: 25000 })).stdout; }
    catch (e) { if (!e.stdout) throw e; raw = e.stdout; }
    const receipt = JSON.parse(raw); await writeFile(join(folder, 'window-' + randomUUID() + '.json'), raw); return receipt;
  };
  try {
    host = await prepareDocumentExportHost(process.env.AIJ_AF203_PACKED_CONSUMER, folder);
    f = await createRemainingClientFixture('AF-203', { workbenchTargetSafety: true, testBrowserOrigin: host.origin, storageEnabled: true, documentExport: { approvedImage: image, dockerCliPath: '/usr/local/bin/docker' } }); host.attach(f.baseUrl.replace(/\/api$/, ''));
    const { PersonalDocumentsService } = f.requireApi('documents/personal-documents.service.js'), documents = f.app.get(PersonalDocumentsService);
    const workspaceId = f.workspaces[0].id, memberId = f.accounts[0].id;
    const d = await documents.create(memberId, workspaceId, { code: 'af203-export', name: '个人文档导出验收', body: '自有合成中文正文\n\nWord 与 PDF 导出验证。\nEnd' }); host.setContext({ workspaceId, documentId: d.id });
    const { LocalStorageAdapter } = f.requireApi('files/local-storage.adapter.js'); storage = f.app.get(LocalStorageAdapter);
    const counts = async () => [await f.prisma.aiAgentRun.count(), await f.prisma.runtimeJob.count(), await f.prisma.aiExecutionTrace.count()];
    const beforeCounts = await counts(); await host.startWeb(); driver = createDocumentExportDriver(host.origin, folder);
    const { native, read, wait, click, fill, shot } = driver, section = '[aria-label="当前文档导出"]';
    const posts = () => host.state.traffic.filter(r => r.method === 'POST' && r.path === '/api/client/document-exports').length;
    const ready = () => native('wait', ['--selector', section + ' button:not([disabled]):not(.ant-btn-loading)']);
    const open = async () => {
      await native('goto', ['--url', host.origin + '/client/documents?workspaceId=' + workspaceId]); await native('activate'); await wait('新建文档'); await native('scroll', ['--direction', 'up', '--amount', '4000']);
      await click('读取文档列表'); await wait(d.name); await click('打开', '[aria-label="个人文档库"]'); await wait('编辑文档 · v'); await ready();
    };
    const reread = async () => {
      if (!await read(`!!document.querySelector('textarea[aria-label="文档正文"]')`)) {
        if (await read(`!!Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('重新读取空间与文档权限'))`)) { await click('重新读取空间与文档权限'); await wait('新建文档'); }
        await click('读取文档列表'); await wait(d.name); await click('打开', '[aria-label="个人文档库"]'); await wait('编辑文档 · v'); await ready();
      }
      await click('读取已有导出', section); await wait('的导出，请核对格式与版本。');
    };
    const download = async (format, revision) => {
      const filename = `document-${d.id}-r${revision}.${format}`, path = join(homedir(), 'Downloads', filename); await assert.rejects(lstat(path), e => e.code === 'ENOENT');
      const row = await f.prisma.personalDocumentExport.findFirstOrThrow({ where: { documentId: d.id, revision, format } }), asset = await f.prisma.fileAsset.findUniqueOrThrow({ where: { id: row.fileAssetId } });
      const labels = await read(`Array.from(document.querySelectorAll(${JSON.stringify(section + ' li')})).map(e=>e.textContent)`), index = labels.findIndex(text => text.startsWith(format === 'docx' ? 'Word' : 'PDF')); assert.ok(index >= 0);
      const started = Date.now(); await click('下载', section + ` li:nth-child(${index + 1})`); await wait('已发起浏览器下载。');
      let stat, bytes;
      for (let i = 0; i < 200; i++) {
        try { stat = await lstat(path); if (stat.isFile() && stat.size === Number(asset.size)) { bytes = await readFile(path); if (hash(bytes) === asset.checksum) break; } } catch (e) { if (e.code !== 'ENOENT') throw e; }
        await new Promise(r => setTimeout(r, 50));
      }
      assert.ok(stat?.isFile() && !stat.isSymbolicLink()); assert.ok(stat.mtimeMs >= started - 1000); assert.ok(bytes); assert.equal(bytes.length, Number(asset.size)); assert.equal(hash(bytes), asset.checksum);
      ownedDownload = { path, checksum: asset.checksum }; assert.deepEqual(await storage.read(asset.objectKey), bytes);
      assert.equal(bytes.subarray(0, format === 'pdf' ? 5 : 2).toString(), format === 'pdf' ? '%PDF-' : 'PK');
      await copyFile(path, join(folder, `actual-os-r${revision}.${format}`)); await rm(path); ownedDownload = undefined;
      proof.downloads.push({ format, revision, filename, bytes: bytes.length, checksum: asset.checksum, freshActualFile: true, observedMtime: new Date(stat.mtimeMs).toISOString() }); await save();
    };
    await native('create', ['--url', host.origin + '/client/login']); await native('activate');
    const account = JSON.parse(await readFile(f.accounts[0].initialPasswordFile, 'utf8')).accounts.find(a => a.id === memberId);
    await fill('邮箱', f.accounts[0].email, true); await fill('密码', account.password, true); await click('登 录'); await native('wait', ['--url', '/client']); await open();
    await fill('文档正文', '未保存的自有合成草稿'); assert.equal(await read(`Array.from(document.querySelectorAll(${JSON.stringify(section + ' button')})).filter(b=>/生成/.test(b.textContent)).every(b=>b.disabled)`), true); assert.equal(posts(), 0);
    await click('丢弃草稿，读取当前版本'); await ready(); proof.cases.push('unsaved-change-blocks-generation');
    for (const format of ['Word', 'PDF']) { await click('生成 ' + format, section); await wait('导出已生成，请点击下载。'); await ready(); }
    assert.equal(posts(), 2); const relations = await f.prisma.personalDocumentExport.findMany({ where: { documentId: d.id, revision: 1 } }); assert.equal(relations.length, 2); assert.equal(relations.find(r => r.format === 'docx').pageCount, null);
    assert.equal(await read(`document.querySelector(${JSON.stringify(section)}).textContent.includes('null')`), false); proof.screenshots.push(await shot('desktop-export')); proof.cases.push('original-Linux-word-pdf-current-version');
    await reread(); await download('docx', 1); await reread(); await download('pdf', 1); proof.cases.push('actual-OS-word-pdf-files-exact-original-storage-bytes');
    await native('viewport', ['--width', '390', '--height', '844', '--scale', '1', '--mobile']); assert.equal(await read('innerWidth'), 390); assert.equal(await read('document.documentElement.scrollWidth <= innerWidth + 1'), true); proof.screenshots.push(await shot('mobile390-export')); proof.cases.push('mobile390-real-keyboard');
    assert.notEqual(new URL(host.origin).port, new URL(f.baseUrl).port); await native('goto', ['--url', host.origin + '/af203-sdk']); await click('读取并核验导出'); await wait('PASS');
    const cors = JSON.parse(await read('document.querySelector("output").textContent')); assert.equal(cors.rows.length, 2);
    for (const row of cors.rows) { const relation = await f.prisma.personalDocumentExport.findUniqueOrThrow({ where: { id: row.id } }); const asset = await f.prisma.fileAsset.findUniqueOrThrow({ where: { id: relation.fileAssetId } }); assert.equal(row.checksum, asset.checksum); assert.equal(row.size, Number(asset.size)); }
    proof.actualBrowserCors = true; proof.cases.push('outside-installed-SDK-actual-cross-port-CORS-binary-hashes');
    await open(); await fill('文档正文', '已保存第二版正文，用于真实未知响应验收'); await click('明确保存'); await wait('编辑文档 · v2'); await ready();
    host.armLoss(); const before = posts(); await click('生成 PDF', section); await wait('生成结果未知，已锁定新生成。'); assert.equal(posts(), before + 1); assert.equal(await f.prisma.personalDocumentExport.count({ where: { documentId: d.id, revision: 2 } }), 1);
    assert.equal(await read(`Array.from(document.querySelectorAll(${JSON.stringify(section + ' button')})).find(b=>b.textContent==='已核对，确认结果').disabled`), true);
    // Actual OS privacy edge; browser eval only observes DOM, never installs hooks.
    assert.ok(await read(`document.querySelector('textarea[aria-label="文档正文"]')?.value`)); await native('activate');
    const expression = `new Promise(resolve=>{const end=Date.now()+30000;const timer=setInterval(()=>{const clear=!document.querySelector('textarea[aria-label="文档正文"]')?.value&&!document.querySelector('input[aria-label="文档名称"]')?.value&&!document.querySelector('textarea[aria-label="历史正文（只读）"]')?.value&&!document.querySelector(${JSON.stringify(section + ' li')});if(document.hidden&&clear||Date.now()>end){clearInterval(timer);resolve(JSON.stringify({hidden:document.hidden,clear,at:Date.now()}));}},25);})`;
    const observed = exec('/usr/local/bin/orca', ['eval', '--page', driver.page(), '--expression', expression, '--json'], { encoding: 'utf8', timeout: 45000 }); await new Promise(r => setTimeout(r, 300));
    let state = await computer(['get-app-state', '--app', 'com.stablyai.orca', '--query', '最小化', '--no-screenshot']); if (!state.ok && state.error?.code === 'window_not_found') state = await computer(['get-app-state', '--app', 'com.stablyai.orca', '--restore-window', '--query', '最小化', '--no-screenshot']);
    assert.equal(state.ok, true); assert.equal(state.result.snapshot.window.isMinimized, false); restoreWindow = String(state.result.snapshot.window.id); const button = state.result.snapshot.treeText.match(/^\s*(\d+)\s+最小化按钮/m); assert.ok(button);
    const action = await computer(['click', '--app', 'com.stablyai.orca', '--window-id', restoreWindow, '--element-index', button[1], '--restore-window', '--no-screenshot']); assert.ok(action.ok || action.error?.code === 'window_not_found');
    const receipt = JSON.parse((await observed).stdout); await writeFile(join(folder, 'actual-hidden.json'), JSON.stringify(receipt, null, 2) + '\n'); assert.equal(receipt.ok, true); const actual = JSON.parse(receipt.result.result); assert.equal(actual.hidden, true); assert.equal(actual.clear, true);
    const restored = await computer(['get-app-state', '--app', 'com.stablyai.orca', '--window-id', restoreWindow, '--restore-window', '--query', '最小化', '--no-screenshot']); assert.equal(restored.ok, true); assert.equal(restored.result.snapshot.window.isMinimized, false); restoreWindow = undefined;
    await reread(); await wait('生成结果待核对'); assert.equal(posts(), before + 1); assert.equal(await read(`Array.from(document.querySelectorAll(${JSON.stringify(section + ' button')})).find(b=>b.textContent==='生成 PDF').disabled`), true);
    await click('已核对，确认结果', section); await wait('已确认原生成版本的当前读取结果'); assert.equal(posts(), before + 1); proof.cases.push('real-hidden-clears-restore-preserves-unknown-lock', 'committed-one-POST-original-version-GET-and-fresh-explicit-ACK'); await save();
    const enabled = process.env.AIJ_DOCUMENT_EXPORT_ENABLED; process.env.AIJ_DOCUMENT_EXPORT_ENABLED = 'false';
    try { disabled = await f.requireApi('bootstrap.js').createApplication({ testBrowserOrigin: host.origin }); await disabled.listen(0, '127.0.0.1'); } finally { if (enabled === undefined) delete process.env.AIJ_DOCUMENT_EXPORT_ENABLED; else process.env.AIJ_DOCUMENT_EXPORT_ENABLED = enabled; }
    host.attach('http://127.0.0.1:' + disabled.getHttpServer().address().port); await open(); await wait('待配置'); await reread(); assert.equal(await read(`Array.from(document.querySelectorAll(${JSON.stringify(section + ' button')})).filter(b=>/生成/.test(b.textContent)).every(b=>b.disabled)`), true); await download('pdf', 2); assert.equal(posts(), before + 1); proof.cases.push('defaultoff-original-App-read-and-actual-existing-file-save');
    host.attach(f.baseUrl.replace(/\/api$/, '')); await open(); await reread();
    const permission = await f.prisma.clientWorkspacePermission.findUniqueOrThrow({ where: { code: 'workspace.documents.export' } }); await f.prisma.clientWorkspacePermission.update({ where: { id: permission.id }, data: { status: 'disabled' } });
    await click('读取已有导出', section); await wait('正文已清除，请重新验证访问。'); assert.equal(await read(`document.querySelector('textarea[aria-label="文档正文"]')?.value??null`), null); proof.cases.push('current-grant-revocation-clears-before-target-read');
    await f.prisma.clientWorkspacePermission.update({ where: { id: permission.id }, data: { status: 'active' } }); await open(); await reread();
    const exported = await f.prisma.personalDocumentExport.findFirstOrThrow({ where: { documentId: d.id, revision: 2 } }), latePath = join(homedir(), 'Downloads', `document-${d.id}-r2.pdf`); await assert.rejects(lstat(latePath), e => e.code === 'ENOENT');
    barrier = host.hold('/api/client/document-exports/' + exported.id + '/content'); await click('下载', section); await gate(barrier.ready.promise); await f.prisma.clientWorkspacePermission.update({ where: { id: permission.id }, data: { status: 'disabled' } }); barrier.release.resolve(); barrier = undefined;
    await wait('正文已清除，请重新验证访问。'); assert.equal(await read(`document.querySelector('textarea[aria-label="文档正文"]')?.value??null`), null); assert.equal(await read(`document.querySelector(${JSON.stringify(section)}).querySelectorAll('li').length`), 0); await assert.rejects(lstat(latePath), e => e.code === 'ENOENT'); assert.equal(await f.prisma.personalDocumentExport.count({ where: { documentId: d.id } }), 3); proof.cases.push('held-original-binary-late-revocation-no-file-or-new-export');
    await native('goto', ['--url', host.origin + '/client/workspaces']); await wait('Workspace'); assert.equal(await read(`!!document.querySelector(${JSON.stringify(section)})`), false); proof.cases.push('actual-unmount');
    assert.deepEqual(await counts(), beforeCounts); for (const row of host.state.traffic.filter(r => r.path.startsWith('/api/client/document-exports'))) assert.match(row.cacheControl ?? '', /private, no-store/); proof.status = 'PASS'; proof.acceptanceId = f.lease.id; await save();
  } catch (error) {
    failure = error; if (driver) { await driver.native('snapshot').catch(() => {}); await writeFile(join(folder, 'failure.json'), JSON.stringify({ error: error.message, traffic: host?.state.traffic.slice(-30), observation: await driver.observation().catch(() => null) }, null, 2)); }
  } finally {
    const errors = [];
    if (restoreWindow) try { const r = await computer(['get-app-state', '--app', 'com.stablyai.orca', '--window-id', restoreWindow, '--restore-window', '--query', '最小化', '--no-screenshot']); assert.equal(r.ok, true); } catch (e) { errors.push(e); }
    if (ownedDownload) try { assert.equal(hash(await readFile(ownedDownload.path)), ownedDownload.checksum); await rm(ownedDownload.path); } catch (e) { errors.push(e); }
    barrier?.release.resolve();
    for (const close of [() => driver?.close(), () => host?.close(), async () => { if (disabled) { disabled.getHttpServer().closeAllConnections(); await disabled.close(); } }]) try { await close(); } catch (e) { errors.push(e); }
    if (f) try { const assets = await f.prisma.fileAsset.findMany({ where: { workspaceId: { in: f.workspaces.map(w => w.id) } }, select: { objectKey: true } }); for (const asset of assets) if (await storage.exists(asset.objectKey)) await storage.remove(asset.objectKey); const result = await f.close(); for (const key of ['applicationPools0', 'ownedSockets0', 'environmentRestored']) assert.equal(result[key], true); } catch (e) { errors.push(e); }
    await writeFile(join(folder, 'closed.json'), JSON.stringify({ status: errors.length ? 'CLEANUP_FAILED' : 'CLOSED', host: host?.state.status, errors: errors.map(e => e.message) }, null, 2)); if (errors.length) failure = new AggregateError([...(failure ? [failure] : []), ...errors], 'AF203 cleanup failed'); proof.status = failure ? 'FAIL' : 'PASS'; await save();
  }
  console.log(JSON.stringify({ task: 'AF-203', folder, status: failure ? 'FAIL' : 'PASS' })); if (failure) throw failure;
});
