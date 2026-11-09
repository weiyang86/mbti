// Root-only original Next/API/Job browser acceptance. eval is read-only.
import assert from 'node:assert/strict';
import { createServer, request as relayRequest } from 'node:http';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

const exec = promisify(execFile), root = '/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation';
const requireWeb = createRequire(join(root, 'apps/web/package.json'));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { resolve, promise }; };
export async function prepareKnowledgeCitationHost(artifact) {
  let base, handler, web, held, closing;
  const traffic = [];
  const server = createServer((incoming, outgoing) => {
    if (incoming.url?.startsWith('/api/')) {
      if (!base) { outgoing.writeHead(503); outgoing.end(); return; }
      const target = new URL(base), path = incoming.url.split('?', 1)[0];
      const relay = relayRequest({ hostname: '127.0.0.1', port: target.port, method: incoming.method, path: incoming.url, headers: { ...incoming.headers, host: target.host } }, response => {
        traffic.push({ method: incoming.method, path, status: response.statusCode });
        const barrier = held && path === held.path ? held : null;
        if (barrier) {
          held = null; const chunks = [];
          response.on('data', b => chunks.push(b)); response.once('end', async () => {
            barrier.entered.resolve(); await barrier.release.promise;
            if (!outgoing.destroyed) { outgoing.writeHead(response.statusCode ?? 502, response.headers); outgoing.end(Buffer.concat(chunks)); }
          }); return;
        }
        outgoing.writeHead(response.statusCode ?? 502, response.headers); response.pipe(outgoing);
      });
      relay.on('error', () => { if (!outgoing.headersSent) outgoing.writeHead(502); outgoing.end(); }); incoming.pipe(relay); return;
    }
    if (handler) { void handler(incoming, outgoing); return; }
    outgoing.writeHead(503); outgoing.end('Owned source acceptance preparing');
  });
  await new Promise((yes, no) => { server.once('error', no); server.listen(0, '127.0.0.1', yes); });
  return {
    origin: `http://127.0.0.1:${server.address().port}`, traffic,
    attach(url) { base = url; },
    hold(path) { assert.equal(held, undefined); held = { path, entered: deferred(), release: deferred() }; return held; },
    async startWeb() {
      const keys = ['NODE_ENV', 'AIJ_NEXT_DIST_DIR', 'AIJ_TEST_API_URL'];
      const before = Object.fromEntries(keys.map(k => [k, process.env[k]]));
      Object.assign(process.env, { NODE_ENV: 'production', AIJ_NEXT_DIST_DIR: '.next-af214', AIJ_TEST_API_URL: '/api' });
      try { web = requireWeb('next')({ dev: false, dir: join(root, 'apps/web'), hostname: '127.0.0.1' }); await web.prepare(); handler = web.getRequestHandler(); }
      finally { for (const k of keys) { if (before[k] === undefined) delete process.env[k]; else process.env[k] = before[k]; } }
    },
    close() { return closing ??= (async () => {
      held?.release.resolve(); server.closeAllConnections(); await new Promise(r => server.close(r)); await web?.close();
      const sockets = await new Promise((yes, no) => server.getConnections((e, n) => e ? no(e) : yes(n)));
      assert.equal(server.listening, false); assert.equal(sockets, 0);
      await writeFile(join(artifact, 'native-host.json'), JSON.stringify({ traffic, ownedSockets: sockets, closed: true }, null, 2) + '\n');
    })(); }
  };
}

export async function verifyKnowledgeCitationBrowser({ host, fixture: f, artifact, document, grant }) {
  const evidence = { task: 'AF-214', acceptanceId: f.lease.id, cases: [], buildId: (await readFile('apps/web/.next-af214/BUILD_ID', 'utf8')).trim() };
  await host.startWeb();
  const secretKey = 'AIJ_SECRET_AIJ_FOUNDATION_TEST_AF214_OFFLINE_KEY';
  process.env[secretKey] = 'synthetic-offline-' + randomBytes(24).toString('hex');
  await f.prisma.secretReference.create({ data: { ref: `env://${secretKey}`, provider: 'env', description: 'AF214 original offline test Provider, not vendor acceptance' } });
  for (const [configKey, configValue, valueType] of [['ai.providerCode', 'offline-knowledge', 'string'], ['ai.modelCode', 'synthetic-qa-v1', 'string'], ['ai.credentialRef', `env://${secretKey}`, 'secretRef'], ['capabilities.ai.text.generate', 'true', 'boolean']]) {
    await f.prisma.scopedConfig.create({ data: { scope: 'project', scopeId: f.project.id, pluginCode: 'aij-ai', configKey, configValue, valueType, name: 'AF214 original offline Q&A', sensitive: valueType === 'secretRef', isPublic: false } });
  }
  const credentials = JSON.parse(await readFile(f.accounts[0].initialPasswordFile, 'utf8')).accounts.find(x => x.id === f.accounts[0].id);
  const { JobService } = f.requireApi('async-runtime/job.service.js'), jobs = f.app.get(JobService);
  let page, url, seq = 0, snapshot = '', barrier, question, restoreWindow;
  async function native(action, args = [], privateInput = false) {
    let raw;
    try { raw = (await exec('/usr/local/bin/orca', [...(action === 'create' ? ['tab', 'create'] : action === 'close' ? ['tab', 'close', '--page', page] : [action, '--page', page]), ...args,
      ...(['click', 'fill', 'keypress', 'select', 'type'].includes(action) ? ['--expect-url', url] : []), '--json'], { encoding: 'utf8', timeout: 45000, maxBuffer: 4 * 1024 * 1024 })).stdout; }
    catch (e) { if (!privateInput && e.stdout) await writeFile(join(artifact, 'native-failed-' + action + '.json'), e.stdout, { mode: 0o600 }); throw Error('Actual native action failed: ' + action); }
    const receipt = JSON.parse(raw); assert.equal(receipt.ok, true);
    const result = receipt.result;
    if (action === 'create') { page = result.browserPageId; url = host.origin + '/client/login'; }
    else url = result.url ?? result.effects?.url ?? url;
    snapshot = result.snapshot ?? result.effects?.page?.lines?.join('\n') ?? '';
    if (!privateInput) await writeFile(join(artifact, `native-${++seq}-${action}.json`), raw, { mode: 0o600 });
    return result;
  }
  const ref = async (label, type = 'button') => {
    await native('snapshot', ['--interactive']);
    const lines = snapshot.split('\n').filter(line => line.includes('- ' + type + ' "') && !/\[disabled|disabled,/.test(line)
      && line.slice(line.indexOf('"') + 1, line.indexOf('"', line.indexOf('"') + 1)).replace(/^loading /, '').replace(/\s/g, '') === label.replace(/\s/g, ''));
    assert.equal(lines.length, 1, 'Unique real enabled control: ' + label); const match = lines[0].match(/\[.*?ref=(e\d+)/); assert.ok(match); return '@' + match[1];
  };
  const click = async label => native('click', ['--element', await ref(label)]);
  const fill = async (label, value, privateInput = false) => native('fill', ['--element', await ref(label, 'textbox'), '--value', value], privateInput);
  const wait = text => native('wait', ['--text', text]);
  const read = async expression => JSON.parse((await native('eval', ['--expression', 'JSON.stringify(' + expression + ')'])).result);
  const sourceVisible = () => read('!!document.querySelector("[role=dialog] pre")');
  const shot = async label => { const result = await native('screenshot'); await copyFile(result.path ?? result.screenshotPath, join(artifact, label + '.png')); };
  const save = () => writeFile(join(artifact, 'native-evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
  const computer = async args => {
    let raw;
    try { raw = (await exec('/usr/local/bin/orca', ['computer', ...args, '--json'], { encoding: 'utf8', timeout: 20000 })).stdout; }
    catch (e) { if (!e.stdout) throw Error('Native window action unavailable'); raw = e.stdout; }
    const receipt = JSON.parse(raw);
    await writeFile(join(artifact, `native-window-${++seq}.json`), raw, { mode: 0o600 }); return receipt;
  };
  try {
    await native('create', ['--url', host.origin + '/client/login']);
    await fill('邮箱', f.accounts[0].email, true); await fill('密码', credentials.password, true); await click('登 录');
    await native('wait', ['--url', '/client']);
    await native('goto', ['--url', host.origin + '/client/knowledge/questions?workspaceId=' + f.workspaces[0].id]);
    await wait('你的问题');
    await fill('你的问题', 'alpha response window'); await click('提交问题');
    for (let i = 0; i < 60; i++) {
      question = await f.prisma.aiKnowledgeQuestion.findFirst({ where: { workspaceId: f.workspaces[0].id, memberId: f.accounts[0].id, status: 'queued' }, orderBy: { createdAt: 'desc' } });
      if (question) break; await new Promise(r => setTimeout(r, 50));
    }
    assert.ok(question?.runtimeJobId);
    const claims = await jobs.claim('af214-native', 10), claim = claims.find(x => x.id === question.runtimeJobId); assert.ok(claim); await jobs.execute(claim);
    question = await f.prisma.aiKnowledgeQuestion.findUniqueOrThrow({ where: { id: question.id } }); assert.equal(question.status, 'answered');
    await wait('查看当前来源');
    assert.equal(host.traffic.filter(r => r.path.includes('/citations/')).length, 0, 'No source fetch before explicit click');
    await click('查看当前来源'); await wait('当前保存文本');
    assert.equal(await read('document.querySelector("[role=dialog] pre")?.textContent'), document.content);
    assert.equal(await read('document.querySelectorAll("[role=dialog] pre b").length'), 0);
    assert.equal(await read('document.visibilityState'), 'visible');
    evidence.cases.push('original-page-submit-original-offline-Job', 'explicit-current-source', 'literal-html-escaped'); await save(); await shot('desktop-source');
    if (!await sourceVisible()) { await click('查看当前来源'); await wait('当前保存文本'); }
    await native('keypress', ['--key', 'Escape']); assert.equal(await sourceVisible(), false); evidence.cases.push('keyboard-escape-clears');
    await native('viewport', ['--width', '390', '--height', '844', '--scale', '1', '--mobile']);
    await click('查看当前来源'); await wait('当前保存文本');
    assert.equal(await read('window.innerWidth'), 390);
    assert.equal(await read('document.documentElement.scrollWidth <= window.innerWidth + 1'), true);
    assert.equal(await read('document.querySelector("[role=dialog] pre").scrollWidth <= document.querySelector("[role=dialog] pre").clientWidth + 1'), true);
    evidence.cases.push('actual-mobile390-wrap'); await save(); await shot('mobile390-source');
    if (await sourceVisible()) await click('关闭来源');
    await f.prisma.aiKnowledgeDocument.update({ where: { id: document.id }, data: { title: 'AF214 changed source' } });
    await click('查看当前来源'); await wait('来源已变化'); assert.equal(await sourceVisible(), false); evidence.cases.push('real-source-changed409');
    await f.prisma.aiKnowledgeDocument.update({ where: { id: document.id }, data: { title: document.title, updatedAt: document.updatedAt } });
    await f.prisma.aiKnowledgeQuestion.update({ where: { id: question.id }, data: { createdAt: new Date(Date.now() - 7 * 86400000) } });
    await click('查看当前来源'); await wait('问答已超过七天保留期'); assert.equal(await sourceVisible(), false); evidence.cases.push('real-expiry410');
    await f.prisma.aiKnowledgeQuestion.update({ where: { id: question.id }, data: { createdAt: question.createdAt, updatedAt: question.updatedAt } });
    await click('查看当前来源'); await wait('当前保存文本');
    await grant('workspace.knowledge.query', false);
    await wait('当前 Workspace、成员或角色权限已变化'); assert.equal(await sourceVisible(), false); evidence.cases.push('current-grant-revocation-clears');
    await grant('workspace.knowledge.query', true);
    barrier = host.hold(`/api/client/ai/knowledge/questions/${question.id}/citations/${document.id}`);
    await click('查看当前来源');
    let timer; try { await Promise.race([barrier.entered.promise, new Promise((_, no) => { timer = setTimeout(() => no(Error('Actual held source missing')), 10000); })]); } finally { clearTimeout(timer); }
    await click('关闭来源'); barrier.release.resolve();
    await native('wait', ['--selector', 'main']); assert.equal(await sourceVisible(), false); evidence.cases.push('held-real-response-close-cancels');
    await click('查看当前来源'); await wait('当前保存文本');
    const windows = await computer(['list-windows', '--app', 'com.stablyai.orca']); assert.equal(windows.ok, true);
    const ownedWindow = windows.result.windows.filter(w => w.title === 'Orca' && !w.isMinimized); assert.equal(ownedWindow.length, 1);
    restoreWindow = String(ownedWindow[0].id);
    const windowState = await computer(['get-app-state', '--app', 'com.stablyai.orca', '--window-id', restoreWindow, '--query', '最小化', '--no-screenshot']); assert.equal(windowState.ok, true);
    const minimize = windowState.result.snapshot.treeText.match(/^\s*(\d+)\s+最小化按钮/m); assert.ok(minimize);
    // Observe the actual OS edge without reactivating the page. This expression
    // only reads DOM/visibility and never changes UI, focus or visibility.
    const observation = exec('/usr/local/bin/orca', ['eval', '--page', page, '--expression',
      'new Promise(resolve=>{const end=Date.now()+8000;const timer=setInterval(()=>{if(document.hidden&&!document.querySelector("[role=dialog] pre")||Date.now()>end){clearInterval(timer);resolve(JSON.stringify({hidden:document.hidden,focus:document.hasFocus(),sourceVisible:!!document.querySelector("[role=dialog] pre")}));}},25);})', '--json'], { encoding: 'utf8', timeout: 15000 });
    await new Promise(r => setTimeout(r, 300));
    const action = await computer(['click', '--app', 'com.stablyai.orca', '--window-id', restoreWindow, '--element-index', minimize[1], '--no-screenshot']);
    // macOS can minimize successfully then fail its post-action AX lookup because
    // the window is now hidden. The error alone never proves success: require
    // actual hidden/cleared-DOM observations and a measured restoration.
    assert.ok(action.ok || action.error?.code === 'window_not_found');
    const observed = JSON.parse((await observation).stdout); assert.equal(observed.ok, true);
    await writeFile(join(artifact, 'native-real-visibility.json'), JSON.stringify(observed, null, 2) + '\n');
    const visibility = JSON.parse(observed.result.result);
    assert.equal(visibility.hidden, true, 'Actual document.hidden, not a synthetic event');
    assert.equal(visibility.sourceVisible, false);
    const restored = await computer(['get-app-state', '--app', 'com.stablyai.orca', '--window-id', restoreWindow, '--restore-window', '--query', '最小化', '--no-screenshot']);
    assert.equal(restored.ok, true); assert.equal(restored.result.snapshot.window.isMinimized, false); restoreWindow = undefined;
    evidence.cases.push('actual-OS-hidden-clears-window-restored'); await save();
    await native('snapshot', ['--interactive']);
    await click('查看当前来源'); await wait('当前保存文本');
    await native('goto', ['--url', host.origin + '/client/workspaces']); await wait('Workspace'); assert.equal(await sourceVisible(), false); evidence.cases.push('actual-unmount-clears');
    await save();
  } finally {
    barrier?.release.resolve(); await grant('workspace.knowledge.query', true);
    if (restoreWindow) {
      const restored = await computer(['get-app-state', '--app', 'com.stablyai.orca', '--window-id', restoreWindow, '--restore-window', '--query', '最小化', '--no-screenshot']);
      assert.equal(restored.ok, true); assert.equal(restored.result.snapshot.window.isMinimized, false);
    }
    if (page) await native('close'); delete process.env[secretKey]; await save();
  }
}
