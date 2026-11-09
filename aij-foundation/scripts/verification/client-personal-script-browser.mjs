// Actual original Skill page. No DOM mutations, injected events or API mocks.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, copyFile, lstat, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
const exec = promisify(execFile), panel = 'section[aria-label="个人 Python Skill 执行"]';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export async function verifyPersonalScriptBrowser({ host, fixture: f, artifact, scriptSource, jobs }) {
  await host.startWeb();
  const credentials = JSON.parse(await readFile(f.accounts[0].initialPasswordFile, 'utf8')).accounts.find(a => a.id === f.accounts[0].id);
  const evidence = { task: 'AF-213', acceptanceId: f.lease.id, buildId: (await readFile('apps/web/.next-af213/BUILD_ID', 'utf8')).trim(), cases: [] };
  let page, url, seq = 0, snapshot = '', restoreWindow, skill, run, ownedDownload;
  const save = () => writeFile(join(artifact, 'native-evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
  async function native(action, args = [], privateInput = false) {
    let raw;
    try { raw = (await exec('/usr/local/bin/orca', [...(action === 'create' ? ['tab', 'create'] : ['close', 'switch'].includes(action) ? ['tab', action, '--page', page] : [action, '--page', page]), ...args,
      ...(['click', 'fill', 'keypress', 'select', 'type'].includes(action) ? ['--expect-url', url] : []), '--json'], { encoding: 'utf8', timeout: 45000, maxBuffer: 4 * 1024 * 1024 })).stdout; }
    catch (e) { if (!privateInput && e.stdout) await writeFile(join(artifact, 'native-failed-' + action + '.json'), e.stdout, { mode: 0o600 }); throw Error('Actual native action failed: ' + action); }
    const receipt = JSON.parse(raw); assert.equal(receipt.ok, true); const result = receipt.result;
    if (action === 'create') { page = result.browserPageId; url = host.origin + '/client/login'; } else url = result.url ?? result.effects?.url ?? url;
    snapshot = result.snapshot ?? result.effects?.page?.lines?.join('\n') ?? '';
    if (!privateInput) await writeFile(join(artifact, `native-${++seq}-${action}.json`), raw, { mode: 0o600 }); return result;
  }
  const ref = async (label, type = 'button', selector) => {
    if (selector) await native('wait', ['--selector', selector]);
    await native('snapshot', ['--interactive', ...(selector ? ['--selector', selector] : [])]);
    const lines = snapshot.split('\n').filter(l => l.includes('- ' + type + ' "') && !/\[disabled|disabled,/.test(l)
      && l.slice(l.indexOf('"') + 1, l.indexOf('"', l.indexOf('"') + 1)).replace(/^loading /, '').replace(/\s/g, '') === label.replace(/\s/g, ''));
    assert.equal(lines.length, 1, 'Unique actual enabled control: ' + label); const m = lines[0].match(/\[.*?ref=(e\d+)/); assert.ok(m); return '@' + m[1];
  };
  const click = async (label, selector) => native('click', ['--element', await ref(label, 'button', selector)]);
  const activate = async (label, selector) => {
    await native('focus', ['--element', await ref(label, 'button', selector)]);
    assert.equal((await read('document.activeElement?.textContent')).replace(/\s/g, ''), label.replace(/\s/g, ''));
    await native('keypress', ['--key', 'Enter']);
  };
  const fill = async (label, value, privateInput = false, selector) => native('fill', ['--element', await ref(label, 'textbox', selector), '--value', value], privateInput);
  const wait = text => native('wait', ['--text', text]);
  const waitEnabled = label => native('wait', ['--selector', `${panel} [aria-label="${label}"]:not(:disabled)`]);
  const read = async expression => JSON.parse((await native('eval', ['--expression', 'JSON.stringify(' + expression + ')'])).result);
  const shot = async label => { const r = await native('screenshot'); await copyFile(r.path ?? r.screenshotPath, join(artifact, label + '.png')); };
  const writes = kind => host.traffic.filter(r => r.method === 'POST' && r.path === '/api/client/script-executions/' + kind);
  const revalidate = async () => { await click('重新验证访问', panel); await wait('执行已配置 · 当前允许提交'); };
  const execute = async row => { const claims = await jobs.claim('af213-native-' + randomUUID(), 20), claim = claims.find(x => x.id === row.jobId); assert.ok(claim); await jobs.execute(claim); };
  const computer = async args => {
    let raw; try { raw = (await exec('/usr/local/bin/orca', ['computer', ...args, '--json'], { encoding: 'utf8', timeout: 20000 })).stdout; }
    catch (e) { if (!e.stdout) throw Error('Native window action unavailable'); raw = e.stdout; }
    const receipt = JSON.parse(raw); await writeFile(join(artifact, `native-window-${++seq}.json`), raw, { mode: 0o600 }); return receipt;
  };
  try {
    // macOS window enumeration can be empty while AX observes the actual main
    // window. Require that measured AX window instead of inventing a window ID.
    const visible = await computer(['get-app-state', '--app', 'com.stablyai.orca', '--restore-window', '--query', '最小化', '--no-screenshot']);
    assert.equal(visible.ok, true); assert.equal(visible.result.snapshot.window.title, 'Orca');
    assert.equal(visible.result.snapshot.window.isMinimized, false); assert.equal(visible.result.snapshot.window.isOffscreen, false);
    await native('create', ['--url', host.origin + '/client/login']);
    await native('switch', ['--focus']);
    await fill('邮箱', f.accounts[0].email, true); await fill('密码', credentials.password, true); await click('登 录'); await native('wait', ['--url', '/client']);
    await native('goto', ['--url', host.origin + '/client/skills?workspaceId=' + f.workspaces[0].id]); await wait('新建 Skill');
    await click('新建 Skill'); const code = 'native-' + randomUUID();
    await fill('Skill 编号', code); await fill('Skill 名称', 'AF213 native Python'); await fill('Skill 提示词指令', 'Synthetic current private Skill.');
    await click('检查并确认保存'); await wait('确认创建提示词 Skill'); await click('确认保存', '[role=dialog]');
    await wait('服务端已确认保存');
    await native('wait', ['--fn', '!document.querySelector("[role=dialog]")']);
    skill = await f.prisma.aiPersonalSkill.findFirstOrThrow({ where: { code, memberId: f.accounts[0].id, workspaceId: f.workspaces[0].id } });
    // Original Skill creation deliberately returns to the list. Open its actual
    // current row instead of assuming a different product navigation contract.
    await click('查看', `tr[data-row-key="${skill.id}"]`); await wait('执行已配置 · 当前允许提交');
    assert.equal(await read(`document.querySelectorAll(${JSON.stringify(panel)}).length`), 1);
    const versionsBefore = writes('versions').length, runsBefore = writes('runs').length;
    await waitEnabled('Python 源码'); await fill('Python 源码', scriptSource, false, panel); await click('检查并创建不可变版本', panel); await wait('确认创建一个不可变 Python 版本');
    await native('keypress', ['--key', 'Escape']); assert.equal(writes('versions').length, versionsBefore); evidence.cases.push('version-confirmation-escape-no-write');
    host.lose('POST', '/api/client/script-executions/versions');
    await click('检查并创建不可变版本', panel); await click('确认创建一次', '[role=dialog]'); await wait('原写入仍锁定');
    assert.equal(writes('versions').length, versionsBefore + 1); assert.equal(writes('versions').at(-1).lostAfterCommit, true);
    assert.equal(await read(`document.querySelector(${JSON.stringify(panel + ' textarea[aria-label="Python 源码"]')})?.value ?? ''`), '');
    await revalidate(); await click('读取原 Skill 当前版本', panel); await wait('刚核对的当前版本为 v2');
    await click('我已核对当前版本，明确结束此次核对', panel); await wait('服务端版本'); await wait('执行已配置 · 当前允许提交');
    assert.equal(writes('versions').length, versionsBefore + 1); evidence.cases.push('committed-unknown-version-one-POST-read-head-explicit-ack'); await save();
    // An explicit new user decision, after acknowledgement; never a retry or an
    // invented version-key recovery endpoint.
    await waitEnabled('Python 源码'); await fill('Python 源码', scriptSource, false, panel); await click('检查并创建不可变版本', panel); await click('确认创建一次', '[role=dialog]');
    await wait('执行已配置 · 当前允许提交'); await waitEnabled('Python 版本 ID');
    const version = await f.prisma.aiPersonalScriptVersion.findFirstOrThrow({ where: { skillId: skill.id }, orderBy: { createdAt: 'desc' } });
    assert.equal(writes('versions').length, versionsBefore + 2); assert.equal((await f.prisma.aiPersonalSkill.findUniqueOrThrow({ where: { id: skill.id } })).revision, 3);
    assert.equal(await read(`document.querySelector(${JSON.stringify(panel + ' input[aria-label="Python 版本 ID"]')})?.value`), version.id);
    await click('读取并核对原版本', panel); await waitEnabled('执行 JSON 输入');
    await fill('执行 JSON 输入', '{"native":"中文🙂"}', false, panel);
    host.lose('POST', '/api/client/script-executions/runs'); await click('检查并确认执行', panel); await click('确认提交一次', '[role=dialog]'); await wait('原写入仍锁定');
    assert.equal(writes('runs').length, runsBefore + 1); run = await f.prisma.aiPersonalScriptRun.findFirstOrThrow({ where: { scriptVersionId: version.id }, orderBy: { createdAt: 'desc' } });
    await click('编辑'); assert.equal(await read(`document.querySelectorAll(${JSON.stringify(panel)}).length`), 1);
    assert.equal(await read(`!!document.querySelector(${JSON.stringify(panel + ' textarea[aria-label="执行 JSON 输入"]')})`), false); await wait('原写入仍锁定');
    await click('重新读取当前版本（丢弃草稿）'); await wait('执行已配置 · 当前允许提交'); await wait('GET 查回原请求');
    assert.equal(writes('runs').length, runsBefore + 1); evidence.cases.push('unknown-run-lock-survives-parent-edit-null-scope');
    await execute(run); await click('GET 查回原请求', panel); await wait('SUCCESS');
    assert.equal(await read(`document.querySelector(${JSON.stringify(panel + ' section[aria-label="原执行结果"]')})?.textContent.includes(${JSON.stringify(run.id)})`), true);
    assert.equal(writes('runs').length, runsBefore + 1); evidence.cases.push('original-Linux-one-Job-same-key-GET-recovery'); await save();
    await shot('desktop-success');
    await native('viewport', ['--width', '390', '--height', '844', '--scale', '1', '--mobile']); await wait('SUCCESS');
    assert.equal(await read('window.innerWidth'), 390); assert.equal(await read('document.documentElement.scrollWidth <= window.innerWidth + 1'), true);
    await shot('mobile390-success'); evidence.cases.push('actual-mobile390-wrap');
    // The button is below the actual mobile viewport. Scroll and activate the
    // fresh control with real keyboard input; an offscreen AX press is a noop.
    await native('scroll', ['--direction', 'down', '--amount', '650']);
    await native('focus', ['--element', await ref('下载并查看成功结果', 'button', panel)]);
    const filename = `script-${run.id}.json`, downloadPath = join(homedir(), 'Downloads', filename);
    await assert.rejects(lstat(downloadPath), e => e.code === 'ENOENT'); const downloadStarted = Date.now();
    assert.equal(await read('document.activeElement?.textContent.trim()'), '下载并查看成功结果');
    await native('keypress', ['--key', 'Enter']); await wait('脚本原始 JSON 结果');
    const output = await read(`document.querySelector(${JSON.stringify(panel + ' section[aria-label="原执行结果"] pre')})?.textContent`);
    assert.deepEqual(JSON.parse(output), { value: { native: '中文🙂' } });
    // The keypress receipt may precede an asynchronous download event. Require
    // the actual unique file, absent before this action, newly written and byte
    // equal to the SDK-validated preview. Never substitute an API copy for it.
    let stat;
    for (let i = 0; i < 100; i++) {
      try { stat = await lstat(downloadPath); break; } catch (e) { if (e.code !== 'ENOENT') throw e; }
      await new Promise(r => setTimeout(r, 50));
    }
    assert.ok(stat, 'Actual freshly saved native download required'); assert.equal(stat.isFile(), true); assert.equal(stat.isSymbolicLink(), false); assert.ok(stat.mtimeMs >= downloadStarted - 1000);
    const bytes = await readFile(downloadPath); assert.equal(hash(bytes), hash(output)); ownedDownload = { path: downloadPath, checksum: hash(bytes) };
    await copyFile(downloadPath, join(artifact, 'actual-native-result.json')); await rm(downloadPath); ownedDownload = undefined;
    evidence.download = { checksum: hash(bytes), byteLength: bytes.length, filename, freshActualFile: true, observedMtime: new Date(stat.mtimeMs).toISOString() };
    evidence.cases.push('actual-native-JSON-download-file-and-preview'); await save(); await shot('desktop-or-mobile-output');
    await native('switch', ['--focus']);
    assert.equal(await read(`document.querySelector(${JSON.stringify(panel + ' section[aria-label="原执行结果"] pre')})?.textContent`), output, 'Private preview must exist before the actual OS edge');
    const observe = exec('/usr/local/bin/orca', ['eval', '--page', page, '--expression', `new Promise(resolve=>{const end=Date.now()+30000;const timer=setInterval(()=>{const p=document.querySelector(${JSON.stringify(panel)});const clear=!p?.querySelector('pre,section[aria-label="原执行结果"]')&&[...p?.querySelectorAll('textarea,input')??[]].every(t=>!t.value);if(document.hidden&&clear||Date.now()>end){clearInterval(timer);resolve(JSON.stringify({hidden:document.hidden,clear,observedAt:Date.now()}));}},25);})`, '--json'], { encoding: 'utf8', timeout: 45000 });
    await new Promise(r => setTimeout(r, 300));
    // Capture the AX target after the background browser observation starts;
    // no later browser call may change window visibility before the OS action.
    let state = await computer(['get-app-state', '--app', 'com.stablyai.orca', '--query', '最小化', '--no-screenshot']);
    if (!state.ok && state.error?.code === 'window_not_found') {
      state = await computer(['get-app-state', '--app', 'com.stablyai.orca', '--restore-window', '--query', '最小化', '--no-screenshot']);
    }
    assert.equal(state.ok, true);
    assert.equal(state.result.snapshot.window.title, 'Orca'); assert.equal(state.result.snapshot.window.isMinimized, false);
    assert.equal(state.result.snapshot.window.isOffscreen, false); restoreWindow = String(state.result.snapshot.window.id);
    const minimize = state.result.snapshot.treeText.match(/^\s*(\d+)\s+最小化按钮/m); assert.ok(minimize);
    const action = await computer(['click', '--app', 'com.stablyai.orca', '--window-id', restoreWindow, '--element-index', minimize[1], '--restore-window', '--no-screenshot']); assert.ok(action.ok || action.error?.code === 'window_not_found');
    const observation = JSON.parse((await observe).stdout); assert.equal(observation.ok, true);
    await writeFile(join(artifact, 'native-real-hidden.json'), JSON.stringify(observation, null, 2) + '\n');
    const actual = JSON.parse(observation.result.result); assert.equal(actual.hidden, true); assert.equal(actual.clear, true);
    const restored = await computer(['get-app-state', '--app', 'com.stablyai.orca', '--window-id', restoreWindow, '--restore-window', '--query', '最小化', '--no-screenshot']); assert.equal(restored.ok, true); assert.equal(restored.result.snapshot.window.isMinimized, false); restoreWindow = undefined;
    await wait('新建 Skill'); await native('scroll', ['--direction', 'up', '--amount', '3000']);
    await activate('查看', `tr[data-row-key="${skill.id}"]`); await wait('执行已配置 · 当前允许提交'); await wait('GET 查回原请求');
    assert.equal(writes('runs').length, runsBefore + 1); await activate('GET 查回原请求', panel); await wait('SUCCESS');
    await activate('核对终态并明确结束原请求', panel); await wait('已核对并明确结束原请求');
    assert.equal(writes('runs').length, runsBefore + 1); evidence.cases.push('actual-OS-hidden-clears-restores-and-preserves-original-lock', 'terminal-explicit-resolution-no-new-POST');
    await native('goto', ['--url', host.origin + '/client/workspaces']); await wait('Workspace'); assert.equal(await read(`!!document.querySelector(${JSON.stringify(panel)})`), false); evidence.cases.push('actual-unmount-clears'); await save();
  } catch (error) {
    if (page && url?.includes('/client/skills')) {
      await native('snapshot').catch(() => {});
      await read(`({focus:document.hasFocus(),visibility:document.visibilityState,panel:!!document.querySelector(${JSON.stringify(panel)})})`).catch(() => {});
    }
    throw error;
  } finally {
    if (restoreWindow) { const r = await computer(['get-app-state', '--app', 'com.stablyai.orca', '--window-id', restoreWindow, '--restore-window', '--query', '最小化', '--no-screenshot']); assert.equal(r.ok, true); }
    if (ownedDownload) { assert.equal(hash(await readFile(ownedDownload.path)), ownedDownload.checksum); await rm(ownedDownload.path); }
    if (page) await native('close'); await save();
  }
}
