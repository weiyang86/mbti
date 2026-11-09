// Typed Orca actions and read-only page observations; no DOM/event/method hooks.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { copyFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const exec = promisify(execFile);
export function w21NativeBrowser(artifact) {
  let page, url, sequence = 0, snapshot = '', restoreWindow;
  async function action(name, args = [], privateInput = false) {
    const command = name === 'create' ? ['tab', 'create'] : ['close', 'switch'].includes(name) ? ['tab', name, '--page', page] : [name, '--page', page];
    const flags = ['click', 'fill', 'keypress', 'select', 'type'].includes(name) ? ['--expect-url', url] : [];
    let raw;
    try { raw = (await exec('/usr/local/bin/orca', [...command, ...args, ...flags, '--json'], { encoding: 'utf8', timeout: 45000, maxBuffer: 4 * 1024 * 1024 })).stdout; }
    catch (e) { if (!privateInput && e.stdout) await writeFile(join(artifact, 'failed-' + name + '.json'), e.stdout); throw Error('Real Orca action failed: ' + name); }
    const receipt = JSON.parse(raw); assert.equal(receipt.ok, true); const result = receipt.result;
    if (name === 'create') page = result.browserPageId;
    url = result.url ?? result.effects?.url ?? (name === 'create' ? args[1] : url);
    snapshot = typeof result.snapshot === 'string' ? result.snapshot
      : result.snapshot?.tree ?? result.effects?.page?.lines?.join('\n') ?? '';
    if (!privateInput) await writeFile(join(artifact, `native-${++sequence}-${name}.json`), raw, { mode: 0o600 });
    return result;
  }
  const read = async expression => JSON.parse((await action('eval', ['--expression', 'JSON.stringify(' + expression + ')'])).result);
  async function ref(label, type = 'button', selector) {
    if (selector) await action('wait', ['--selector', selector]);
    await action('snapshot', ['--interactive', '--full', ...(selector ? ['--selector', selector] : [])]);
    const normalize = s => s.replace(/^loading /, '').replace(/\s/g, '');
    const lines = snapshot.split('\n').filter(l => l.includes('- ' + type + ' "') && !/\[disabled|disabled,/.test(l) && normalize(l.slice(l.indexOf('"') + 1, l.indexOf('"', l.indexOf('"') + 1))) === normalize(label));
    assert.equal(lines.length, 1, 'Unique enabled real control: ' + label); const match = lines[0].match(/\[.*?ref=(e\d+)/); assert.ok(match); return '@' + match[1];
  }
  const activate = async (label, selector) => {
    await action('focus', ['--element', await ref(label, 'button', selector)]);
    assert.equal((await read('document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.textContent')).replace(/\s/g, ''), label.replace(/\s/g, ''));
    await action('keypress', ['--key', 'Enter']);
  };
  const fill = async (label, value, privateInput = false, selector) => action('fill', ['--element', await ref(label, 'textbox', selector), '--value', value], privateInput);
  const wait = text => action('wait', ['--text', text]);
  const computer = async args => {
    let raw; try { raw = (await exec('/usr/local/bin/orca', ['computer', ...args, '--json'], { encoding: 'utf8', timeout: 25000 })).stdout; }
    catch (e) { if (!e.stdout) throw e; raw = e.stdout; }
    const receipt = JSON.parse(raw); await writeFile(join(artifact, `window-${++sequence}.json`), raw); return receipt;
  };
  async function preflight() {
    let r = await computer(['get-app-state', '--app', 'com.stablyai.orca', '--query', '最小化', '--no-screenshot']);
    if (!r.ok && r.error?.code === 'window_not_found') r = await computer(['get-app-state', '--app', 'com.stablyai.orca', '--restore-window', '--query', '最小化', '--no-screenshot']);
    assert.equal(r.ok, true, 'Actual native window required before DB'); assert.equal(r.result.snapshot.window.isMinimized, false); return r;
  }
  async function hideAndRestore(clearExpression) {
    const observation = exec('/usr/local/bin/orca', ['eval', '--page', page, '--expression', `new Promise(resolve=>{const end=Date.now()+30000;const timer=setInterval(()=>{const clear=Boolean(${clearExpression});if(document.hidden&&clear||Date.now()>end){clearInterval(timer);resolve(JSON.stringify({hidden:document.hidden,clear}));}},25);})`, '--json'], { encoding: 'utf8', timeout: 45000 });
    await new Promise(r => setTimeout(r, 300));
    const r = await preflight(), win = r.result.snapshot.window; assert.equal(win.title, 'Orca'); assert.equal(win.isOffscreen, false);
    restoreWindow = String(win.id); const minimize = r.result.snapshot.treeText.match(/^\s*(\d+)\s+最小化按钮/m); assert.ok(minimize);
    const clicked = await computer(['click', '--app', 'com.stablyai.orca', '--window-id', restoreWindow, '--element-index', minimize[1], '--restore-window', '--no-screenshot']); assert.ok(clicked.ok || clicked.error?.code === 'window_not_found');
    const receipt = JSON.parse((await observation).stdout); assert.equal(receipt.ok, true); const actual = JSON.parse(receipt.result.result);
    await writeFile(join(artifact, 'actual-hidden.json'), JSON.stringify(actual, null, 2)); assert.equal(actual.hidden, true); assert.equal(actual.clear, true);
    const restored = await computer(['get-app-state', '--app', 'com.stablyai.orca', '--window-id', restoreWindow, '--restore-window', '--query', '最小化', '--no-screenshot']);
    assert.equal(restored.ok, true); assert.equal(restored.result.snapshot.window.isMinimized, false); restoreWindow = undefined;
  }
  return { action, read, ref, activate, fill, wait, preflight, hideAndRestore,
    async shot(name) { const r = await action('screenshot'); await copyFile(r.path ?? r.screenshotPath, join(artifact, name + '.png')); },
    async close() {
      if (restoreWindow) { const r = await computer(['get-app-state', '--app', 'com.stablyai.orca', '--window-id', restoreWindow, '--restore-window', '--no-screenshot']); assert.equal(r.ok, true); restoreWindow = undefined; }
      if (page) { await action('close'); page = undefined; }
    }
  };
}
