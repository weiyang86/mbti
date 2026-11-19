// Root-only real Orca UI against the SAME live fixture; no Cookie injection or eval mutations.
import assert from 'node:assert/strict';
import { createServer, request as relayRequest } from 'node:http';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
const exec = promisify(execFile), root = '/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation';
const folder = join(root, '.artifacts/auto-ai-program-20261105/AF-190');
const requireWeb = createRequire(join(root, 'apps/web/package.json'));
let host;
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { resolve, promise }; };
async function gate(promise) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, no) => { timer = setTimeout(() => no(Error('Actual held response barrier missing')), 15000); })]); }
  finally { clearTimeout(timer); }
}

export async function preparePersonalDocumentsHost() {
  assert.equal(host, undefined); await mkdir(folder, { recursive: true });
  const state = { traffic: [], status: 'PREPARING' }; let base, nextApp, handler, closed = false, loseNext = false, held;
  const server = createServer((incoming, outgoing) => {
    if (incoming.url?.startsWith('/api/')) {
      if (!base) { outgoing.writeHead(503); outgoing.end(); return; }
      const target = new URL(base), path = incoming.url.split('?', 1)[0];
      const relay = relayRequest({ hostname: '127.0.0.1', port: target.port, method: incoming.method, path: incoming.url, headers: { ...incoming.headers, host: target.host } }, response => {
        const lost = loseNext && incoming.method === 'PATCH' && path.startsWith('/api/client/documents/') && response.statusCode === 200;
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
      process.env.AIJ_NEXT_DIST_DIR = '.next-af190'; process.env.AIJ_TEST_API_URL = '/api'; process.env.NODE_ENV = 'production';
      try { nextApp = requireWeb('next')({ dev: false, dir: join(root, 'apps/web'), hostname: '127.0.0.1' }); await nextApp.prepare(); handler = nextApp.getRequestHandler(); }
      finally { process.env.NODE_ENV = previous; }
    },
    async close() { if (closed) return; closed = true; held?.release.resolve(); server.closeAllConnections(); await new Promise(r => server.close(r)); await nextApp?.close(); state.status = 'CLOSED'; await writeFile(join(folder, 'native-runtime.json'), JSON.stringify(state, null, 2)); }
  };
  return host;
}

export async function verifyPersonalDocumentsBrowser({ base, leaseId, accounts, loginCredentials, workspaceId, secondWorkspaceId, readOnlyRoleId, origin, prisma, request }) {
  assert.ok(host); assert.equal(host.origin, origin); host.attach(base); await host.startWeb();
  const artifacts = [], evidence = { task: 'AF-190', leaseId, origin, buildId: (await readFile(join(root, 'apps/web/.next-af190/BUILD_ID'), 'utf8')).trim(), cases: [] };
  let page, url, seq = 0, snapshot = '', scopeSelector;
  async function native(action, args = [], privateInput = false) {
    let raw;
    try { raw = (await exec('/usr/local/bin/orca', [...(action === 'create' ? ['tab', 'create'] : action === 'close' ? ['tab', 'close', '--page', page] : [action, '--page', page]), ...args,
      ...(['click', 'fill', 'keypress', 'select', 'type'].includes(action) ? ['--expect-url', url] : []), '--json'], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, timeout: 45000 })).stdout; }
    catch (error) {
      if (!privateInput && error.stdout) await writeFile(join(folder, `native-${leaseId}-failed-${action}.json`), error.stdout, { mode: 0o600 });
      throw Error('Actual native command failed: ' + action);
    } // Never print login arguments.
    const receipt = JSON.parse(raw); assert.equal(receipt.ok, true, 'Native action refused: ' + action);
    const result = receipt.result;
    if (action === 'create') { page = result.browserPageId; url = origin + '/client/login'; }
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
  const click = async (label, type = 'button', selector) => native('click', ['--element', await ref(label, type, selector)]);
  const fill = async (label, value, privateInput = false) => native('fill', ['--element', await ref(label, 'textbox'), '--value', value], privateInput);
  const wait = text => native('wait', ['--text', text]);
  const read = async expression => JSON.parse((await native('eval', ['--expression', 'JSON.stringify(' + expression + ')'])).result);
  const shot = async label => {
    const result = await native('screenshot');
    const original = result.path ?? result.screenshotPath; assert.equal(typeof original, 'string');
    const path = join(folder, `native-${leaseId}-${label}.png`); await copyFile(original, path); artifacts.push(path);
  };
  const body = () => read('document.querySelector("textarea[aria-label=\\"文档正文\\"]")?.value ?? null');
  const raw = async (method, path, payload) => request(method, path, { actor: 1, body: payload });
  const membership = await prisma.clientWorkspaceMembership.findUniqueOrThrow({ where: { workspaceId_memberId: { workspaceId, memberId: accounts[1].id } } });
  let barrier;
  try {
    await native('create', ['--url', origin + '/client/login']);
    await fill('邮箱', loginCredentials[1].email, true); await fill('密码', loginCredentials[1].password, true); await click('登 录');
    await native('wait', ['--url', '/client']);
    await native('goto', ['--url', origin + '/client/documents?workspaceId=' + workspaceId]);
    await wait('新建文档'); await click('新建文档');
    const code = 'native-' + randomUUID(), originalBody = 'AF190_NATIVE_ORIGINAL\n中文🙂', savedBody = 'AF190_NATIVE_SAVED\n历史内容🙂';
    await fill('文档编号', code); await fill('文档名称', '个人文档验收'); await fill('文档正文', originalBody); await click('明确保存'); await wait('已保存。每次实际变更保留一条不可变历史。');
    let document = (await raw('GET', '?limit=50')).items.find(d => d.code === code); assert.ok(document);
    await fill('文档正文', savedBody); await click('明确保存'); await wait('编辑文档 · v2');
    assert.equal((await raw('GET', '/' + document.id)).body, savedBody);
    await click('读取历史目录'); await click('读取此版本', 'button', 'section[aria-label="文档编辑器"] ul > li:last-child');
    assert.equal(await read('document.querySelector("textarea[aria-label=\\"历史正文（只读）\\"]")?.value'), originalBody);
    assert.equal(await read('document.querySelector("textarea[aria-label=\\"历史正文（只读）\\"]")?.readOnly'), true);
    await click('删除文档'); await native('keypress', ['--key', 'Escape']);
    await native('wait', ['--fn', '!document.querySelector("[role=dialog]") && document.activeElement?.textContent.trim() === "删除文档"']);
    assert.equal(await read('!!document.querySelector("[role=dialog]")'), false);
    assert.equal(await read('document.activeElement?.textContent.trim()'), '删除文档');
    await shot('desktop-history-keyboard'); evidence.cases.push('desktopCreateSaveHistory', 'keyboardLabelsFocus');

    await fill('文档正文', 'LOCAL CONFLICT DRAFT');
    await raw('PATCH', '/' + document.id, { expectedRevision: 2, name: '个人文档验收', body: 'REMOTE CAS CONTENT' });
    await click('明确保存'); await wait('草稿已保留'); assert.equal(await body(), 'LOCAL CONFLICT DRAFT');
    assert.equal((await raw('GET', '/' + document.id)).body, 'REMOTE CAS CONTENT'); await shot('cas-draft-retained');
    await click('丢弃草稿，读取当前版本'); await wait('编辑文档 · v3'); assert.equal(await body(), 'REMOTE CAS CONTENT'); evidence.cases.push('casConflictDraftRetained');

    host.armLoss(); const before = host.state.traffic.filter(r => r.method === 'PATCH').length;
    await fill('文档正文', 'AF190_NATIVE_UNKNOWN_COMMITTED'); await click('明确保存'); await wait('写入结果未知');
    assert.equal(host.state.traffic.filter(r => r.method === 'PATCH').length, before + 1);
    assert.equal((await raw('GET', '/' + document.id)).revision, 4);
    await click('主动读取当前结果'); await wait('当前服务端修订为 v4'); await click('已核对，确认结果');
    assert.equal(await body(), 'AF190_NATIVE_UNKNOWN_COMMITTED'); assert.equal(host.state.traffic.filter(r => r.method === 'PATCH').length, before + 1);
    await shot('unknown-explicit-read-ack'); evidence.cases.push('unknownReadAck');

    await prisma.clientWorkspaceMembership.update({ where: { id: membership.id }, data: { roleId: readOnlyRoleId } });
    await click('读取历史目录'); await wait('正文已清除'); assert.equal(await body(), null);
    await click('重新读取空间与文档权限'); await wait('当前角色只读'); await click('读取文档列表'); await click('打开'); await wait('编辑文档 · v4');
    assert.equal(await read('document.querySelector("textarea[aria-label=\\"文档正文\\"]")?.readOnly'), true);
    assert.ok((await snap()).includes('button "明确保存" [disabled')); await shot('read-only-role'); evidence.cases.push('readOnly');
    await prisma.clientWorkspaceMembership.update({ where: { id: membership.id }, data: { roleId: membership.roleId } });
    await click('重新验证访问'); await wait('访问范围已变化'); await click('重新读取空间与文档权限'); await wait('新建文档');
    await click('读取文档列表');
    barrier = host.hold('/api/client/documents/' + document.id);
    await click('打开'); await gate(barrier.entered.promise);
    await click('选择文档空间', 'combobox'); await native('keypress', ['--key', 'ArrowDown']); await native('keypress', ['--key', 'Enter']);
    await wait('新建文档');
    scopeSelector = await read('document.querySelector("#document-space-select")?.getAttribute("aria-activedescendant")');
    // Actual new workspace API context must appear before releasing the previous body's held response.
    assert.ok(host.state.traffic.some(r => r.path === '/api/client/workspaces/context' && r.status === 200));
    barrier.release.resolve();
    await native('wait', ['--selector', 'main']); assert.equal(await body(), null);
    assert.equal(await read('document.body.innerText.includes("AF190_NATIVE_UNKNOWN_COMMITTED")'), false);
    const selected = await read('document.querySelector("#document-space-select")?.parentElement?.getAttribute("title")');
    assert.ok(selected?.includes('AF190 space 1'), 'Native keyboard switched to the verified other workspace'); assert.ok(secondWorkspaceId);
    await shot('late-old-scope-fenced'); evidence.cases.push('oldScopeFenced');

    await native('viewport', ['--width', '390', '--height', '844', '--scale', '1', '--mobile']);
    await click('新建文档'); await fill('文档编号', 'mobile-' + randomUUID()); await fill('文档名称', '移动端文档'); await fill('文档正文', 'AF190_NATIVE_MOBILE'); await click('明确保存'); await wait('编辑文档 · v1');
    const bounds = await read('({width:innerWidth,scroll:document.documentElement.scrollWidth,body:document.querySelector("textarea[aria-label=\\"文档正文\\"]").getBoundingClientRect().right})');
    assert.equal(bounds.width, 390); assert.equal(bounds.scroll, 390); assert.ok(bounds.body <= 390); await shot('mobile-390'); evidence.cases.push('mobile390');
    const privateCache = await read('({stored:[...Object.keys(localStorage),...Object.keys(sessionStorage)].some(k=>/AF190_NATIVE|LOCAL CONFLICT/.test(localStorage.getItem(k)||sessionStorage.getItem(k)||"")),html:document.documentElement.innerHTML.includes("AF190_NATIVE_ORIGINAL")})');
    assert.equal(privateCache.stored, false);
    for (const traffic of host.state.traffic.filter(r => r.path.startsWith('/api/client/documents'))) assert.match(traffic.cacheControl ?? '', /private, no-store/);
    evidence.cases.push('noPrivateCache');
    evidence.nativeActions = seq; evidence.status = 'ACTUAL_NATIVE_PASSED'; evidence.scopeSelector = scopeSelector;
    const path = join(folder, `native-proof-${leaseId}.json`); await writeFile(path, JSON.stringify(evidence, null, 2)); artifacts.push(path);
    host.state.status = 'PASSED'; host.state.leaseId = leaseId; host.state.evidence = path;
    return { productionWeb: true, ...Object.fromEntries(evidence.cases.map(k => [k, true])), artifacts };
  } catch (error) {
    if (page) {
      try { const failure = await read('({path:location.pathname,focusTag:document.activeElement?.tagName,focusName:document.activeElement?.getAttribute("aria-label"),modal:document.querySelector("[role=dialog]")?.innerText,body:document.body.innerText})'); await writeFile(join(folder, `native-failure-${leaseId}.json`), JSON.stringify(failure, null, 2)); } catch { /* original native failure remains authority */ }
    }
    throw error;
  } finally {
    barrier?.release.resolve(); await prisma.clientWorkspaceMembership.update({ where: { id: membership.id }, data: { roleId: membership.roleId } });
    if (page) await native('close'); await host.close();
  }
}
