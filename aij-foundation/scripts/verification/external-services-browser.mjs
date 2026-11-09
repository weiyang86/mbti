// Root-only real Orca UI against the SAME live fixture; no Cookie injection or eval mutations.
import assert from 'node:assert/strict';
import { createServer, request as relayRequest } from 'node:http';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
const exec = promisify(execFile), root = '/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation';
const folder = join(root, '.artifacts/auto-ai-program-20261105/AF-194');
const requireWeb = createRequire(join(root, 'apps/web/package.json'));
let host;
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { resolve, promise }; };
async function gate(promise) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, no) => { timer = setTimeout(() => no(Error('Actual held response barrier missing')), 15000); })]); }
  finally { clearTimeout(timer); }
}
export async function prepareExternalServicesHost() {
  assert.equal(host, undefined); await mkdir(folder, { recursive: true });
  const state = { traffic: [], receivedWrites: [], status: 'PREPARING' }; let base, nextApp, handler, closed = false, loseNext = false, held;
  const server = createServer((incoming, outgoing) => {
    if (incoming.url?.startsWith('/api/')) {
      if (!base) { outgoing.writeHead(503); outgoing.end(); return; }
      const target = new URL(base), path = incoming.url.split('?', 1)[0];
      if (incoming.method === 'PUT') state.receivedWrites.push({ method: incoming.method, path });
      const relay = relayRequest({ hostname: '127.0.0.1', port: target.port, method: incoming.method, path: incoming.url, headers: { ...incoming.headers, host: target.host } }, response => {
        const lost = loseNext && incoming.method === 'PUT' && path.startsWith('/api/admin/external-services/') && response.statusCode === 200;
        state.traffic.push({ method: incoming.method, path, status: response.statusCode, cacheControl: response.headers['cache-control'], lostAfterCommit: lost });
        if (lost) {
          loseNext = false; response.resume(); response.once('end', () => { outgoing.writeHead(502, { 'content-type': 'application/json', 'cache-control': 'private, no-store' }); outgoing.end('{"message":"Owned fixture lost committed reply"}'); }); return;
        }
        const barrier = held && incoming.method === 'GET' && path === held.path ? held : null;
        if (barrier) {
          held = null; const buffers = []; response.on('data', b => buffers.push(b));
          response.once('end', async () => { barrier.entered.resolve(); await barrier.release.promise; if (!outgoing.destroyed) { outgoing.writeHead(response.statusCode ?? 502, response.headers); outgoing.end(Buffer.concat(buffers)); } }); return;
        }
        outgoing.writeHead(response.statusCode ?? 502, response.headers); response.pipe(outgoing);
      });
      relay.on('error', () => { if (!outgoing.headersSent) outgoing.writeHead(502); outgoing.end(); }); incoming.pipe(relay); return;
    }
    if (handler) { void handler(incoming, outgoing); return; }
    outgoing.writeHead(503); outgoing.end('Owned acceptance preparing');
  });
  await new Promise((yes, no) => { server.once('error', no); server.listen(0, '127.0.0.1', yes); });
  host = { origin: `http://127.0.0.1:${server.address().port}`, state,
    attach(value) { base = value; }, armLoss() { loseNext = true; },
    hold(path) { const barrier = { path, entered: deferred(), release: deferred() }; held = barrier; return barrier; },
    async startWeb() {
      const previous = process.env.NODE_ENV;
      process.env.AIJ_NEXT_DIST_DIR = '.next-af194'; process.env.AIJ_TEST_API_URL = '/api'; process.env.NODE_ENV = 'production';
      try { nextApp = requireWeb('next')({ dev: false, dir: join(root, 'apps/web'), hostname: '127.0.0.1' }); await nextApp.prepare(); handler = nextApp.getRequestHandler(); }
      finally { process.env.NODE_ENV = previous; }
    },
    async close() { if (closed) return; closed = true; held?.release.resolve(); server.closeAllConnections(); await new Promise(r => server.close(r)); await nextApp?.close(); const sockets = await new Promise((yes, no) => server.getConnections((error, count) => error ? no(error) : yes(count))); assert.equal(sockets, 0); assert.equal(server.listening, false); state.ownedSockets = sockets; state.status = 'CLOSED'; await writeFile(join(folder, 'native-runtime.json'), JSON.stringify(state, null, 2)); }
  };
  return host;
}
export async function verifyExternalServicesBrowser({ base, leaseId, loginCredentials, origin, request }) {
  assert.ok(host); assert.equal(host.origin, origin); host.attach(base); await host.startWeb();
  const artifacts = [], evidence = { task: 'AF-194', leaseId, origin, buildId: (await readFile(join(root, 'apps/web/.next-af194/BUILD_ID'), 'utf8')).trim(), cases: [] };
  let page, url, seq = 0, snapshot = '';
  async function native(action, args = [], privateInput = false) {
    let raw;
    try { raw = (await exec('/usr/local/bin/orca', [...(action === 'create' ? ['tab', 'create'] : action === 'activate' ? ['tab', 'switch', '--page', page, '--focus'] : action === 'close' ? ['tab', 'close', '--page', page] : action.startsWith('mouse-') ? ['mouse', action.slice(6), '--page', page] : [action, '--page', page]), ...args,
      ...(['click', 'fill', 'keypress', 'select', 'type', 'focus'].includes(action) || action.startsWith('mouse-') ? ['--expect-url', url] : []), '--json'], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, timeout: 45000 })).stdout; }
    catch (error) {
      if (!privateInput && error.stdout) await writeFile(join(folder, `native-${leaseId}-failed-${action}.json`), error.stdout, { mode: 0o600 });
      throw Error('Actual native command failed: ' + action);
    } // Never print login arguments.
    const receipt = JSON.parse(raw); assert.equal(receipt.ok, true, 'Native action refused: ' + action);
    const result = receipt.result;
    if (action === 'create') { page = result.browserPageId; url = origin + '/login'; }
    else url = result.url ?? result.effects?.url ?? url;
    if (!privateInput) { const path = join(folder, `native-${leaseId}-${++seq}-${action}.json`); await writeFile(path, raw, { mode: 0o600 }); artifacts.push(path); }
    if (result.snapshot) snapshot = result.snapshot;
    else if (result.effects?.page?.lines) snapshot = result.effects.page.lines.join('\n');
    else snapshot = '';
    return result;
  }
  const snap = async selector => { await native('snapshot', ['--interactive', ...(selector ? ['--selector', selector] : [])]); return snapshot; };
  const ref = async (label, type = 'button', selector) => {
    // A selector read follows an actual wait; refs always come from this pinned page.
    await native('wait', ['--selector', selector ?? 'body']); const lines = (await snap(selector)).split('\n');
    const matches = lines.filter(line => line.includes('- ' + type + ' "') && !/\[disabled|disabled,/.test(line) &&
      line.slice(line.indexOf('"') + 1, line.indexOf('"', line.indexOf('"') + 1)).replace(/^loading /, '').replace(/\s/g, '') === label.replace(/\s/g, ''));
    assert.equal(matches.length, 1, 'Unique actual enabled control: ' + label);
    const match = matches[0].match(/\[.*?ref=(e\d+)/); assert.ok(match); return '@' + match[1];
  };
  const click = async (label, type = 'button', selector) => {
    if (label === '按版本保存草稿') await native('wait', ['--selector', '[aria-label="外部服务配置"] button[type="submit"]:not(.ant-btn-loading):not([disabled])']);
    if (type === 'button') {
      // Submit/recovery controls are reached by normal keyboard input. A
      // pointer coordinate observed before a separate command is not proof
      // that a later mouse-up hit a moving AntD control.
      await native('focus', ['--element', await ref(label, type, selector)]);
      assert.equal(await read('document.activeElement?.tagName === "BUTTON" && document.activeElement?.textContent?.replace(/\\s/g, "") === ' + JSON.stringify(label.replace(/\s/g, ''))), true);
      return native('keypress', ['--key', 'Enter']);
    }
    return native('click', ['--element', await ref(label, type, selector)]);
  };
  const fill = async (label, value, privateInput = false) => native('fill', ['--element', await ref(label, 'textbox'), '--value', value], privateInput);
  const wait = text => native('wait', ['--text', text]);
  const read = async expression => JSON.parse((await native('eval', ['--expression', 'JSON.stringify(' + expression + ')'])).result);
  const shot = async label => {
    const result = await native('screenshot');
    const original = result.path ?? result.screenshotPath; assert.equal(typeof original, 'string');
    const path = join(folder, `native-${leaseId}-${label}.png`); await copyFile(original, path); artifacts.push(path);
  };
  const section = '[aria-label="外部服务配置"]';
  const value = label => read('document.querySelector(' + JSON.stringify(section + ' input[aria-label="' + label + '"]') + ')?.value ?? null');
  const choose = async (label, ready = true) => {
    await native('activate');
    await native('wait', ['--selector', section + ' input[aria-label="选择外部服务"]:not([disabled])']);
    const providerCode = label.startsWith('DeepSeek') ? 'deepseek' : 'qiniu';
    const getCount = () => host.state.traffic.filter(x => x.method === 'GET' && x.path === '/api/admin/external-services/' + providerCode).length;
    const before = getCount();
    await native('focus', ['--element', await ref('选择外部服务', 'combobox', section)]);
    await native('keypress', ['--key', 'ArrowDown']);
    let found = false;
    for (let i = 0; i < 15; i++) {
      const active = await read('(() => {const n=document.querySelector(' + JSON.stringify(section + ' input[aria-label="选择外部服务"]') + ');return document.getElementById(n?.getAttribute("aria-activedescendant"))?.textContent?.trim()??null;})()');
      if (active === label || active === providerCode) { found = true; break; }
      await native('keypress', ['--key', 'ArrowDown']);
    }
    assert.equal(found, true, 'Keyboard observes target active option: ' + label);
    const selection = await read('(() => {const n=document.activeElement;return {label:n?.getAttribute("aria-label"),active:document.getElementById(n?.getAttribute("aria-activedescendant"))?.textContent?.trim(),focused:document.hasFocus()};})()');
    assert.equal(selection.label, '选择外部服务');
    assert.equal(selection.active === label || selection.active === providerCode, true);
    // rc-select supports Tab as a normal active-option commit as well as
    // Enter. This also moves keyboard focus out of the popup.
    await native('keypress', ['--key', 'Tab']);
    if (ready) {
      await native('wait', ['--selector', section + ' input[aria-label=' + JSON.stringify(providerCode === 'deepseek' ? '模型' : '空间名称') + ']:not([disabled])']);
      await native('wait', ['--selector', section + ' button[type="submit"]:not(.ant-btn-loading):not([disabled])']);
      assert.equal(getCount(), before + 1, 'The UI actually fetched the newly selected provider');
      assert.equal(typeof await value(providerCode === 'deepseek' ? '模型' : '空间名称'), 'string', 'Target provider field is loaded');
    }
  };
  const note = async name => { await shot(name); evidence.cases.push(name); };
  const mutations = () => host.state.traffic.filter(x => x.method === 'PUT' && x.path === '/api/admin/external-services/deepseek');
  let barrier;
  try {
    await native('create', ['--url', origin + '/login']);
    await fill('用户名', loginCredentials.username, true); await fill('密码', loginCredentials.password, true); await click('登 录');
    await wait('退出登录');
    await native('goto', ['--url', origin + '/auth/configuration']);
    await native('viewport', ['--width', '1440', '--height', '1000', '--scale', '1']);
    assert.equal(await read('window.innerWidth'), 1440);
    await wait('外部服务配置'); await choose('DeepSeek · AI 模型');
    assert.equal(await value('API Base URL'), ''); assert.equal(await value('模型'), '');
    assert.equal(await value('API Key 引用 SecretRef'), '');
    await click('按版本保存草稿', 'button', section); await wait('版本 1');
    await note('desktop-blank-draft'); assert.equal(mutations().length, 1);
    await fill('模型', 'af194-private-draft'); host.armLoss();
    await click('按版本保存草稿', 'button', section); await wait('保存失败或结果未知');
    assert.equal(await value('模型'), 'af194-private-draft');
    assert.equal(await read('document.querySelector(' + JSON.stringify(section + ' button[type="submit"]') + ')?.disabled'), true);
    assert.equal(mutations().length, 2, 'Unknown committed write must not repeat');
    await click('读取最新版本', 'button', section); await wait('最新版本 2');
    await click('确认使用最新版本', 'button', section); await wait('版本 2');
    assert.equal(mutations().length, 2); await note('unknown-save-explicit-get');
    const update = await request('PUT', '/admin/external-services/deepseek', { expectedVersion: 2, fields: { model: 'af194-server-version' } });
    assert.equal(update.status, 200); assert.equal(update.data.version, 3);
    await fill('模型', 'af194-user-conflict-draft');
    await click('按版本保存草稿', 'button', section); await wait('版本冲突');
    assert.equal(await value('模型'), 'af194-user-conflict-draft');
    await click('读取最新版本', 'button', section); await wait('最新版本 3');
    await click('确认使用最新版本', 'button', section); assert.equal(await value('模型'), 'af194-user-conflict-draft');
    await click('按版本保存草稿', 'button', section); await wait('版本 4'); await note('cas-preserves-user-draft');
    await choose('七牛云 · 对象存储');
    const qiniu = await request('GET', '/admin/external-services/qiniu');
    assert.equal(qiniu.data.version, 0); assert.equal(qiniu.data.runtimeEnabled, false);
    barrier = host.hold('/api/admin/external-services/deepseek');
    await choose('DeepSeek · AI 模型', false);
    await gate(barrier.entered.promise);
    await native('goto', ['--url', origin + '/auth/configuration']);
    barrier.release.resolve(); barrier = null;
    await wait('选择服务');
    assert.equal(await value('模型'), null, 'Unmounted stale GET cannot restore private fields'); await note('unmount-stale-read');
    await choose('DeepSeek · AI 模型'); await wait('版本 4');
    await native('viewport', ['--width', '390', '--height', '844', '--scale', '1', '--mobile']);
    assert.equal(await read('window.innerWidth'), 390);
    const bounds = await read('(() => {const r=document.querySelector(' + JSON.stringify(section) + ').getBoundingClientRect();return {left:r.left,right:r.right,width:r.width};})()');
    assert.ok(bounds.left >= -1 && bounds.right <= 391, 'External form stays within mobile viewport');
    await native('focus', ['--element', await ref('模型', 'textbox')]);
    let submitFocused = false;
    for (let i = 0; i < 8; i++) {
      await native('keypress', ['--key', 'Tab']);
      submitFocused = await read('document.activeElement?.tagName === "BUTTON" && document.activeElement?.textContent?.replace(/\\s/g, "") === "按版本保存草稿"');
      if (submitFocused) break;
    }
    assert.equal(submitFocused, true, 'Keyboard reaches the real submit control');
    const beforeKeyboard = mutations().length;
    await native('keypress', ['--key', 'Enter']);
    await native('wait', ['--selector', section + ' button[type="submit"]:not(.ant-btn-loading)']);
    assert.equal(mutations().length, beforeKeyboard + 1, 'Keyboard Enter submits one real no-op save');
    await note('mobile390');
    // Refusal uses current server state and an actual UI PUT, never a fake response.
    await request('REVOKE_CONFIGURATION');
    await click('按版本保存草稿', 'button', section);
    await wait('权限');
    const refused = await request('GET', '/admin/external-services/deepseek'); assert.equal(refused.status, 403);
    assert.equal(await value('模型'), null); assert.equal(await value('API Key 引用 SecretRef'), null);
    await note('current-permission-refusal');
    await request('RESTORE_CONFIGURATION');
    const final = await request('GET', '/admin/external-services/deepseek');
    assert.equal(final.data.version, 4); assert.equal(final.data.runtimeEnabled, false); assert.equal(final.data.externalVerification, 'not_run');
    evidence.status = 'PASS'; evidence.vendorAcceptance = 'DEFERRED_NOT_PASSED';
    evidence.trueOsDocumentHidden = 'NOT_PROVEN_HERE_AF191_REMAINS_PENDING';
    await writeFile(join(folder, `browser-${leaseId}-evidence.json`), JSON.stringify(evidence, null, 2), { mode: 0o600 });
    return { ...evidence, artifacts };
  } catch (error) {
    // Preserve the observed application state before closing our own page.
    // Login fields are deliberately excluded from diagnostic snapshots.
    if (page && url?.includes('/auth/configuration')) {
      try { await native('console', ['--limit', '30']); } catch { /* Diagnostic read only. */ }
      try { await native('eval', ['--expression', 'JSON.stringify((() => {const s=document.querySelector(' + JSON.stringify(section) + ');const b=s?.querySelector("button[type=submit]");const f=s?.querySelector("form");return {button:b?{className:b.className,disabled:b.disabled,text:b.textContent}:null,form:f?{valid:Array.from(f.elements).every(e=>!e.validity||e.validity.valid)}:null,inputs:Array.from(s?.querySelectorAll("input")??[],i=>({label:i.getAttribute("aria-label"),type:i.type,disabled:i.disabled,valid:i.validity.valid,length:i.value.length})),hidden:document.hidden,focused:document.hasFocus()};})())']); } catch { /* Diagnostic read only. */ }
      try { await native('snapshot', ['--selector', section]); } catch { /* Original scenario error remains authoritative. */ }
    }
    throw error;
  } finally {
    barrier?.release.resolve();
    if (page) await native('close');
  }
}
