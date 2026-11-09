// AF221 root-owned headed Chrome. All input uses native Orca Computer Use;
// CDP is restricted to read-only DOM observations and actual screenshots.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { systemEnvironment } from '../base-development/config.mjs';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
// Import precedes the AF191 business transport guard / Next fetch wrappers.
// Only the exact owned Chrome debugging loopback endpoint uses this transport.
const nativeDebugFetch = globalThis.fetch;

export async function startNativeChrome({ origin, artifact, initialPath = '/client/login', disablePasswordManager = false, foregroundInputs = false, traceFocus = false }) {
  assert.equal(typeof disablePasswordManager, 'boolean');
  assert.equal(typeof foregroundInputs, 'boolean'); assert.equal(typeof traceFocus, 'boolean');
  const expected = new URL(origin); assert.equal(expected.hostname, '127.0.0.1'); assert.equal(expected.protocol, 'http:');
  await mkdir(artifact, { recursive: true, mode: 0o700 });
  const profile = await mkdtemp('/private/tmp/aij-af221-native-');
  await writeFile(join(profile, '.af221-owned'), JSON.stringify({ task: 'AF-221', origin, createdAt: new Date().toISOString() }), { mode: 0o600 });
  // Optional AF225 caller setup, confined to this freshly owned throwaway profile.
  // Chrome's native save-password popup can steal DOM focus after real login.
  if (disablePasswordManager) {
    await mkdir(join(profile, 'Default'), { mode: 0o700 });
    await writeFile(join(profile, 'Default/Preferences'), JSON.stringify({ credentials_enable_service: false,
      profile: { password_manager_enabled: false } }), { mode: 0o600 });
  }
  let child, ws, sequence = 0, nativeSequence = 0, closed, windowId;
  const pending = new Map(), binary = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const ownProcess = () => {
    const rows = execFileSync('ps', ['-axo', 'pid=,uid=,lstart=,command='], { encoding: 'utf8', env: systemEnvironment() }).split('\n');
    const matches = rows.map(line => line.trim().split(/\s+/)).filter(parts => parts.slice(7).join(' ').startsWith(binary + ' ') && parts.slice(7).join(' ').includes('--user-data-dir=' + profile));
    assert(matches.length <= 1, 'AF221_CHROME_PROCESS_IDENTITY_AMBIGUOUS');
    if (!matches.length) return null;
    const p = matches[0]; assert.equal(Number(p[1]), process.getuid());
    return { pid: Number(p[0]), birth: p.slice(2, 7).join(' '), commandSha256: sha(p.slice(7).join(' ')) };
  };
  const close = () => closed ??= (async () => {
    ws?.close();
    const current = ownProcess();
    if (current) {
      if (child) assert.deepEqual(current, child); else child = current;
      process.kill(child.pid, 'SIGTERM');
      const end = Date.now() + 15000;
      while (Date.now() < end && ownProcess()) await pause(50);
      assert.equal(ownProcess(), null, 'AF221_OWNED_CHROME_EXIT_UNPROVEN');
    }
    const marker = JSON.parse(await readFile(join(profile, '.af221-owned'), 'utf8'));
    assert.equal(marker.task, 'AF-221'); assert.equal(marker.origin, origin);
    assert.match(profile, /^\/private\/tmp\/aij-af221-native-[A-Za-z0-9]+$/);
    await rm(profile, { recursive: true, force: false });
    await writeFile(join(artifact, 'chrome-closed.json'), JSON.stringify({ task: 'AF-221', ownedPid: child?.pid, exited: true, privateProfileRemoved: true }), { mode: 0o600 });
  })();
  try {
    const launch = spawnSync('/usr/bin/open', ['-n', '-a', '/Applications/Google Chrome.app', '--args',
      '--user-data-dir=' + profile, '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0',
      '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update', '--disable-sync',
      '--metrics-recording-only', '--force-device-scale-factor=1', '--window-size=1440,1000', '--new-window', origin + initialPath
    ], { stdio: 'ignore', env: systemEnvironment(), timeout: 15000 });
    assert.equal(launch.status, 0, 'AF221_NATIVE_CHROME_LAUNCH_NOT_ACCEPTED');
    let port;
    for (let i = 0; i < 150; i++) {
      child ??= ownProcess();
      try { port = Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); if (port > 1024) break; } catch { /* owned profile only */ }
      await pause(100);
    }
    assert.ok(port > 1024 && port < 65536); child ??= ownProcess(); assert.ok(child);
    const targets = await (await nativeDebugFetch('http://127.0.0.1:' + port + '/json/list', { signal: AbortSignal.timeout(5000) })).json();
    const target = targets.find(item => item.type === 'page' && item.url.startsWith(origin + '/')); assert.ok(target);
    const endpoint = new URL(target.webSocketDebuggerUrl); assert.equal(endpoint.hostname, '127.0.0.1'); assert.equal(Number(endpoint.port), port);
    ws = new WebSocket(endpoint.href);
    ws.onmessage = event => {
      const value = JSON.parse(event.data); const operation = pending.get(value.id);
      if (!operation) return; pending.delete(value.id);
      if (value.error) operation.reject(Error('AF221_READ_ONLY_CDP_FAILED')); else operation.resolve(value.result);
    };
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(Error('AF221_OWNED_CHROME_CDP_UNAVAILABLE')); });
    const command = async (method, params = {}) => {
      assert.ok(['Runtime.evaluate', 'Page.captureScreenshot'].includes(method));
      const id = ++sequence;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(Error('AF221_READ_ONLY_CDP_TIMEOUT')); }, 15000);
        pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
        ws.send(JSON.stringify({ id, method, params }));
      });
    };
    const read = async expression => {
      const value = await command('Runtime.evaluate', { expression: 'JSON.stringify(' + expression + ')', returnByValue: true, awaitPromise: true });
      assert.equal(value.exceptionDetails, undefined, 'AF221_READ_ONLY_OBSERVATION_FAILED');
      return JSON.parse(value.result.value);
    };
    const wait = async (expression, timeoutMs = 15000) => {
      const end = Date.now() + timeoutMs;
      do { if (await read(expression)) return; await pause(100); } while (Date.now() < end);
      throw Error('AF221_REAL_CHROME_CONDITION_NOT_OBSERVED');
    };
    const native = async (args, input, refreshedWindow = false) => {
      if (foregroundInputs && args[0] !== 'get-app-state') await foreground();
      const result = spawnSync('/usr/local/bin/orca', ['computer', ...args, '--app', 'pid:' + child.pid,
        ...(windowId ? ['--window-id', windowId] : []), '--no-screenshot', '--json'], {
        env: systemEnvironment(), encoding: 'utf8', input, timeout: 25000, maxBuffer: 4 * 1024 * 1024
      });
      let receipt; try { receipt = JSON.parse(result.stdout); } catch { throw Error('AF221_NATIVE_CHROME_RECEIPT_MISSING'); }
      if (!receipt.ok && receipt.error?.code === 'window_not_found' && args[0] === 'get-app-state' && windowId && !refreshedWindow) {
        // Chrome can replace its initial native window while finishing startup.
        // Only refresh this read against the same verified live throwaway PID;
        // never replay an input or adopt another Chrome process/window owner.
        assert.deepEqual(ownProcess(), child); const priorWindowId = windowId; windowId = undefined;
        const current = await native(args, input, true);
        await writeFile(join(artifact, 'chrome-window-rediscovery-' + nativeSequence + '.json'), JSON.stringify({
          pid: child.pid, priorWindowId, currentWindowId: windowId, reason: 'READ_ONLY_WINDOW_NOT_FOUND', inputReplayed: false
        }), { mode: 0o600 }); return current;
      }
      if (!receipt.ok) await writeFile(join(artifact, 'chrome-native-error.json'), JSON.stringify({ action: args[0],
        code: /^[a-z_]{2,80}$/.test(receipt.error?.code ?? '') ? receipt.error.code : 'native_error' }), { mode: 0o600 });
      if (!receipt.ok) throw Object.assign(Error('AF221_NATIVE_CHROME_ACTION_FAILED'), { code: receipt.error?.code });
      const snapshot = receipt.result.snapshot;
      if (snapshot) { assert.equal(snapshot.app.pid, child.pid); windowId = String(snapshot.window.id); }
      // No field values, body text, URLs, command payloads or AX tree persist.
      await writeFile(join(artifact, 'chrome-native-' + (++nativeSequence) + '.json'), JSON.stringify({
        task: 'AF-221', at: new Date().toISOString(), action: args[0], ok: true, pid: child.pid, windowId,
        focusedElementId: snapshot?.focusedElementId, minimized: snapshot?.window.isMinimized,
        selectedNativeTabs: snapshot?.treeText.split('\n').filter(line => /标签 \(selected/.test(line)).map(line => Number(line.trim().split(' ', 1)[0])),
        verification: receipt.result.action?.verification?.state
      }), { mode: 0o600 });
      if (traceFocus) {
        const focus = await read('({focused:document.hasFocus(),hidden:document.hidden,activeTag:document.activeElement?.tagName})');
        const platformOwned = execFileSync('/usr/bin/osascript', ['-l', 'JavaScript', '-e',
          'ObjC.import("AppKit");String(Number($.NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier)===' + child.pid + ');'],
        { encoding: 'utf8', env: systemEnvironment(), timeout: 5000 }).trim() === 'true';
        await writeFile(join(artifact, 'chrome-focus-' + nativeSequence + '.json'), JSON.stringify({ action: args[0], ...focus,
          frontmostIsOwned: platformOwned, at: new Date().toISOString() }), { mode: 0o600 });
      }
      return receipt.result;
    };
    const normalize = value => value.replace(/\s/g, '');
    // Explicit caller action after informing the user about foreground native QA.
    // Orca's macOS provider reports windows.focus=false; its --restore-window
    // foreground-click path can refuse an otherwise visible owned window.
    // Activate only the verified throwaway PID via AppKit, never a bundle-wide
    // Chrome selector, and observe the real platform frontmost process.
    const foreground = async () => {
      assert.deepEqual(ownProcess(), child);
      const result = JSON.parse(execFileSync('/usr/bin/osascript', ['-l', 'JavaScript', '-e',
        'ObjC.import("AppKit");const target=$.NSRunningApplication.runningApplicationWithProcessIdentifier(' + child.pid +
        ');const before=Number($.NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier);if(before!==' + child.pid +
        ')target.activateWithOptions(3);JSON.stringify({requested:' + child.pid +
        ',frontmost:Number($.NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier)});'],
      { encoding: 'utf8', env: systemEnvironment(), timeout: 5000 }));
      assert.deepEqual(result, { requested: child.pid, frontmost: child.pid });
      await writeFile(join(artifact, 'chrome-foreground-' + (++nativeSequence) + '.json'), JSON.stringify(result), { mode: 0o600 });
      return result;
    };
    const ref = async (label, kind = 'button') => {
      const state = await native(['get-app-state']);
      const lines = state.snapshot.treeText.split('\n').filter(line => {
        const text = line.trim();
        if (kind === 'button' ? !/^\d+ 按钮 /.test(text) : !/^\d+ (?:安全文本栏|文本栏|邮箱) /.test(text)) return false;
        if (/\(disabled/.test(text)) return false;
        const marker = kind === 'button' ? '按钮' : /^\d+ 邮箱 /.test(text) ? '邮箱' : '文本栏';
        const name = text.slice(text.indexOf(marker) + marker.length).replace(/^\s*(?:\([^)]*\)\s*)?/, '').split(/, (?:Value|Placeholder):/, 1)[0];
        return normalize(name) === normalize(label);
      });
      if (lines.length !== 1) await writeFile(join(artifact, 'native-control-missing.json'), JSON.stringify({ label, kind,
        fields: state.snapshot.treeText.split('\n').filter(line => /文本栏|安全文本|按钮/.test(line)).map(line => line.split(/, (?:Value|Placeholder):/, 1)[0]) }), { mode: 0o600 });
      assert.equal(lines.length, 1, 'AF221_UNIQUE_NATIVE_CONTROL_REQUIRED');
      return lines[0].trim().split(' ', 1)[0];
    };
    const click = async label => {
      const matches = '[...document.querySelectorAll("button")].filter(b=>!b.disabled && (b.getAttribute("aria-label") ?? b.textContent).replace(/\\s/g,"")===' + JSON.stringify(normalize(label)) + ')';
      await wait(matches + '.length===1');
      // AXPress on a Chromium off-screen button can be a noop. Scroll the
      // actual native page, then read its real viewport before clicking it.
      let visible = false;
      for (let i = 0; i < 8; i++) {
        const bounds = await read('(()=>{const r=' + matches + '[0].getBoundingClientRect();return {visible:r.top>=0&&r.bottom<=innerHeight,up:r.top<0};})()');
        if (bounds.visible) { visible = true; break; }
        const state = await native(['get-app-state']);
        const area = state.snapshot.treeText.split('\n').find(line => /^\s*\d+ 滚动区/.test(line));
        assert.ok(area, 'AF221_NATIVE_SCROLL_AREA_REQUIRED');
        await native(['scroll', '--element-index', area.trim().split(' ', 1)[0], '--direction', bounds.up ? 'up' : 'down', '--pages', '1']);
      }
      assert.equal(visible, true, 'AF221_NATIVE_BUTTON_MUST_BE_VISIBLE');
      // Actual Chromium AXPress noops were observed even for a visible history
      // button. Use one native pointer click, located from the fresh real DOM
      // rectangle plus this exact native window's measured content inset.
      const state = await native(['get-app-state']);
      const position = await read('(()=>{const r=' + matches + '[0].getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,width:innerWidth,height:innerHeight};})()');
      assert.equal(state.snapshot.window.width, position.width);
      const x = position.x, y = state.snapshot.window.height - position.height + position.y;
      assert.ok(x > 0 && x < position.width && y > 0 && y < state.snapshot.window.height);
      return native(['click', '--x', String(Math.round(x)), '--y', String(Math.round(y))]);
    };
    const fill = async (label, value, selector, privateInput = false) => {
      await wait('!!document.querySelector(' + JSON.stringify(selector) + ')');
      const element = await ref(label, 'text'); await native(['click', '--element-index', element]);
      await wait('document.activeElement === document.querySelector(' + JSON.stringify(selector) + ')');
      // Chromium AX can update the real field while Orca's AX readback reports
      // verification_failed. Independently verify the DOM value; never replay it.
      try { await native(['set-value', '--element-index', await ref(label, 'text'), '--value-stdin'], value); }
      catch (error) { if (error.code !== 'verification_failed') throw error; }
      // Return only a boolean even for a secret; no argument/receipt logging.
      assert.equal(await read('document.querySelector(' + JSON.stringify(selector) + ')?.value === ' + JSON.stringify(value)), true,
        privateInput ? 'AF221_PRIVATE_FIELD_NOT_FILLED' : 'AF221_FIELD_NOT_FILLED');
    };
    const key = value => native(['press-key', '--key', value]);
    const hotkey = value => native(['hotkey', '--key', value]);
    const navigate = async path => {
      assert.ok(path.startsWith('/') && !path.startsWith('//'));
      await hotkey('CmdOrCtrl+L');
      const element = await ref('地址和搜索栏', 'text');
      try { await native(['set-value', '--element-index', element, '--value-stdin'], origin + path); }
      catch (error) { if (error.code !== 'verification_failed') throw error; }
      await key('Return'); await wait('location.href === ' + JSON.stringify(origin + path));
    };
    const shot = async name => {
      assert.match(name, /^[a-z0-9-]+$/);
      const dimensions = await read('({width:innerWidth,height:innerHeight,dpr:devicePixelRatio,hidden:document.hidden})');
      assert.equal(dimensions.hidden, false);
      const screenshot = await command('Page.captureScreenshot', { format: 'png', fromSurface: true });
      const bytes = Buffer.from(screenshot.data, 'base64'), path = join(artifact, name + '.png');
      assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a'); await writeFile(path, bytes, { mode: 0o600 });
      return { path, sha256: sha(bytes), dimensions, ownedPid: child.pid, nativeWindowId: windowId };
    };
    const blur = async clearExpression => {
      await hotkey('CmdOrCtrl+L');
      await wait('!document.hasFocus() && !document.hidden && Boolean(' + clearExpression + ')');
      const observed = await read('({focused:document.hasFocus(),hidden:document.hidden,clear:Boolean(' + clearExpression + ')})');
      await writeFile(join(artifact, 'chrome-actual-blur.json'), JSON.stringify(observed), { mode: 0o600 });
      await key('Escape'); return observed;
    };
    const hidden = async clearExpression => {
      const title = await read('document.title');
      await hotkey('CmdOrCtrl+T');
      await wait('document.hidden && Boolean(' + clearExpression + ')');
      const observed = await read('({hidden:document.hidden,clear:Boolean(' + clearExpression + ')})');
      await writeFile(join(artifact, 'chrome-actual-hidden.json'), JSON.stringify(observed), { mode: 0o600 });
      const state = await native(['get-app-state', '--query', title]);
      const tabs = state.snapshot.treeText.split('\n').filter(line => {
        if (!/^\s*\d+ 标签 /.test(line)) return false;
        const label = line.slice(line.indexOf('标签') + 2).replace(/^\s*(?:\([^)]*\)\s*)?/, '').split(', Value:', 1)[0];
        return label === title || label.startsWith(title + ' - ');
      });
      assert.equal(tabs.length, 1, 'AF221_ORIGINAL_NATIVE_TAB_REQUIRED');
      await native(['click', '--element-index', tabs[0].trim().split(' ', 1)[0]]);
      await wait('!document.hidden'); return observed;
    };
    let readable = false;
    const deadline = Date.now() + 15000;
    for (let i = 0; i < 60 && Date.now() < deadline; i++) {
      try { await native(['get-app-state']); readable = true; break; }
      catch (error) { if (error.code !== 'window_not_found') throw error; await pause(250); }
    }
    assert.equal(readable, true, 'AF221_OWNED_CHROME_WINDOW_UNAVAILABLE');
    await wait('document.readyState === "complete"');
    return { read, wait, click, fill, navigate, key, hotkey, shot, blur, hidden, close, native, ref, foreground };
  } catch (error) { await close(); throw error; }
}
