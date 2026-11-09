// Actual typed Orca browser actions; computer-use is used for true OS hiding.
import assert from 'node:assert/strict';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { w21NativeBrowser } from './w21-native-browser.mjs';
import { startNativeChrome } from './w22-native-chrome.mjs';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

export function targetNativeDriver(runtime, host) {
  const browser = w21NativeBrowser(runtime.artifactDirectory);
  let created = false, actor, currentWidth = 1440, chrome;
  const output = 'Synthetic goal completed.';
  const readOutput = () => browser.read('document.querySelector("#output")?.textContent ?? ""');
  const cleared = async () => await readOutput() === '' && !(await browser.read('document.body.innerText')).includes(output);
  async function open(path, width = 1440) {
    if (!created) { await browser.action('create', ['--url', host.origin + path]); created = true; }
    else await browser.action('goto', ['--url', host.origin + path]);
    await browser.action('switch');
    await browser.action('viewport', ['--width', String(width), '--height', width === 390 ? '844' : '1000', '--scale', '1', ...(width === 390 ? ['--mobile'] : [])]);
    currentWidth = width;
  }
  async function login(nextActor) {
    await open('/client/login');
    await browser.action('wait', ['--selector', '.auth-card form, .client-login-actions']);
    if (await browser.read('[...document.querySelectorAll("button")].some(b=>b.textContent.replace(/\\s/g,"")==="退出并切换账号")')) {
      await browser.activate('退出并切换账号'); await browser.action('wait', ['--selector', '.auth-card form']);
    }
    if (nextActor === 'anonymous') { actor = nextActor; host.actor(nextActor); return; }
    const credentials = await runtime.loginCredentials(nextActor);
    await browser.fill('邮箱', credentials.email, true);
    await browser.fill('密码', credentials.password, true);
    await browser.activate('登录'); await browser.action('wait', ['--url', host.origin + '/client/workspaces']);
    actor = nextActor; host.actor(nextActor);
  }
  async function consumerRead(args, width = 1440, workspace = runtime.workspaceId) {
    await open('/af191-consumer/', width);
    await browser.fill('Workspace 编号', workspace); await browser.fill('任务编号', args.runId);
    await browser.action('click', ['--element', await browser.ref('验证访问并读取')]);
    assert.equal(await browser.read('document.hasFocus()'), true, 'Real consumer page must have browser focus');
  }
  async function successConsumer(args, width = 1440) {
    if (actor !== 'owner') await login('owner');
    await consumerRead(args, width); await browser.wait(output); assert.equal(await readOutput(), output);
  }
  async function workbenchRead(args, width) {
    if (actor !== 'owner') await login('owner');
    await open('/client/ai?workspaceId=' + runtime.workspaceId, width);
    await browser.fill('已有任务编号', args.runId, false, 'input[aria-label="已有任务编号"]'); await browser.activate('读取任务'); await browser.wait(output);
    const actual = await browser.read('[...document.querySelectorAll("pre")].map(e=>e.textContent).find(v=>v==="Synthetic goal completed.")');
    assert.equal(actual, output); return actual;
  }
  async function receipt(name, args, fields) {
    assert.equal(await browser.read('innerWidth'), currentWidth);
    const shot = await browser.action('screenshot'), path = join(runtime.artifactDirectory, 'af191-native-' + name + '.png');
    await copyFile(shot.path ?? shot.screenshotPath, path);
    return { task: 'AF-191', acceptanceId: runtime.acceptanceId, case: name, native: true, runId: args.runId,
      observedAt: new Date().toISOString(), viewportWidth: currentWidth, screenshot: { path, sha256: hash(await readFile(path)) }, ...fields };
  }
  async function chromeConsumer(args) {
    if (!chrome) {
      await browser.close(); created = false; actor = undefined;
      const directory = join(runtime.artifactDirectory, 'native-chrome'); await mkdir(directory);
      // I221 owns this unchanged generic native utility. This caller binds its
      // fresh origin/PID/window and screenshots to the actual AF191 acceptance.
      chrome = await startNativeChrome({ origin: host.origin, artifact: directory });
      const credentials = await runtime.loginCredentials('owner'); host.actor('owner');
      await chrome.fill('邮箱', credentials.email, 'input[type="email"]', true);
      await chrome.fill('密码', credentials.password, 'input[type="password"]', true); await chrome.click('登录');
      await chrome.wait('location.pathname === "/client/workspaces"');
    }
    await chrome.navigate('/af191-consumer/');
    await chrome.fill('Workspace 编号', runtime.workspaceId, '#workspace'); await chrome.fill('任务编号', args.runId, '#run');
    await chrome.click('验证访问并读取'); await chrome.wait('document.querySelector("#output")?.textContent === ' + JSON.stringify(output));
    assert.equal(await chrome.read('document.hasFocus()'), true);
  }
  async function chromeReceipt(name, args, fields) {
    const shot = await chrome.shot('af191-native-' + name); assert.equal(shot.dimensions.width, 1440);
    return { task: 'AF-191', acceptanceId: runtime.acceptanceId, case: name, native: true, runId: args.runId,
      observedAt: new Date().toISOString(), viewportWidth: 1440, screenshot: { path: shot.path, sha256: shot.sha256 },
      nativeFixtureOwner: 'AF-221', actualCaller: 'AF-191', ownedPid: shot.ownedPid, nativeWindowId: shot.nativeWindowId, ...fields };
  }
  const native = async (name, args) => {
    if (name === 'desktop-workbench-submit') {
      await browser.preflight(); await login('owner');
      await open('/client/ai?workspaceId=' + runtime.workspaceId);
      await browser.fill('任务目标 goal', 'AF191 independent SDK same-task synthetic goal', false, 'textarea[aria-label="任务目标 goal"]');
      host.loseFirstSubmit(); await browser.activate('提交任务'); await browser.wait('提交尚未确认');
      const submissionUnconfirmedObserved = await browser.read('document.body.innerText.includes("提交尚未确认")');
      await browser.activate('查回原提交状态'); await browser.wait('原任务状态');
      const runId = host.submittedRun(); assert.match(runId, /^[A-Za-z0-9_-]{1,128}$/);
      const recoveryGetObserved = host.responses.some(r => r.method === 'GET' && r.path.startsWith('/client/ai/run-requests/') && r.status === 200);
      const postCount = host.responses.filter(r => r.method === 'POST' && r.path === '/client/ai/agents/general-text/runs').length;
      assert.equal(recoveryGetObserved, true); assert.equal(postCount, 1);
      return receipt(name, { ...args, runId }, { status: 'queued', submissionUnconfirmedObserved, recoveryGetObserved, postCount });
    }
    if (name.endsWith('workbench-read')) {
      const actual = await workbenchRead(args, name.startsWith('mobile390') ? 390 : 1440);
      return receipt(name, args, { status: 'succeeded', output: actual });
    }
    if (name.endsWith('consumer-read')) {
      await successConsumer(args, name.startsWith('mobile390') ? 390 : 1440);
      return receipt(name, args, { status: 'succeeded', output: await readOutput() });
    }
    if (['anonymous', 'no-permission', 'other-member'].includes(name)) {
      await login(name); const before = host.responses.length;
      await consumerRead(args); const expected = { anonymous: 401, 'no-permission': 403, 'other-member': 404 }[name];
      await browser.wait({ 401: '登录已失效', 403: '没有读取权限', 404: '任务不存在' }[expected]);
      const actual = host.responses.slice(before).find(r => r.status === expected); assert.ok(actual);
      assert.equal(await cleared(), true);
      return receipt(name, args, { apiStatus: actual.status, privateContentCleared: await cleared() });
    }
    if (name === 'scope-change') {
      await successConsumer(args); const before = host.responses.length;
      await browser.fill('Workspace 编号', runtime.workspaceIds.second); assert.equal(await cleared(), true);
      await browser.activate('验证访问并读取'); await browser.wait('任务不存在');
      const actual = host.responses.slice(before).find(r => r.status === 404); assert.ok(actual);
      return receipt(name, args, { apiStatus: actual.status, privateContentCleared: await cleared() });
    }
    if (name === 'role-change') {
      await successConsumer(args); const before = host.responses.length;
      return runtime.withOwnerNoRead(async () => {
        await browser.activate('验证访问并读取'); await browser.wait('没有读取权限');
        const actual = host.responses.slice(before).find(r => r.status === 403); assert.ok(actual);
        return receipt(name, args, { apiStatus: actual.status, privateContentCleared: await cleared() });
      });
    }
    if (name === 'session-change') {
      await successConsumer(args); const before = host.responses.length; await runtime.revokeOwnerSessions();
      await browser.activate('验证访问并读取'); await browser.wait('登录已失效');
      const actual = host.responses.slice(before).find(r => r.status === 401); assert.ok(actual); actor = undefined;
      return receipt(name, args, { apiStatus: actual.status, privateContentCleared: await cleared() });
    }
    assert.ok(['blur', 'document-hidden', 'unmount'].includes(name));
    await chromeConsumer(args);
    const clear = '(document.querySelector("#output")?.textContent ?? "") === "" && !document.body.innerText.includes(' + JSON.stringify(output) + ')';
    if (name === 'blur') {
      const measured = await chrome.blur(clear); assert.equal(measured.focused, false); assert.equal(measured.hidden, false); assert.equal(measured.clear, true);
      await writeFile(join(runtime.artifactDirectory, 'actual-blur.json'), JSON.stringify({ ...measured, method: 'actual native Chrome address bar, readonly CDP observation, no event injection' }));
      return chromeReceipt(name, args, { privateContentCleared: measured.clear });
    }
    if (name === 'document-hidden') {
      const measured = await chrome.hidden(clear); assert.equal(measured.hidden, true); assert.equal(measured.clear, true);
      await writeFile(join(runtime.artifactDirectory, 'actual-hidden.json'), JSON.stringify(measured));
      return chromeReceipt(name, args, { hiddenObserved: measured.hidden, privateContentCleared: measured.clear });
    }
    // Leave through the real page link while the document has focus; address
    // bar navigation would clear on blur before this distinct unmount case.
    const state = await chrome.native(['get-app-state', '--query', '返回 AI 工作台']);
    const link = await chrome.read('(()=>{const r=document.querySelector("a[href=\\"/client/ai\\"]").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,width:innerWidth,height:innerHeight};})()');
    assert.equal(state.snapshot.window.width, link.width); assert.ok(link.y > 0 && link.y < link.height);
    await chrome.native(['click', '--x', String(Math.round(link.x)), '--y', String(Math.round(state.snapshot.window.height - link.height + link.y))]);
    await chrome.wait('location.pathname === "/client/ai"'); await chrome.wait(clear);
    return chromeReceipt(name, args, { privateContentCleared: await chrome.read(clear) });
  };
  return { native, async close() { try { await chrome?.close(); } finally { await browser.close(); } } };
}
