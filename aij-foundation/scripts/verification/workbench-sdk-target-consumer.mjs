// AF-191: an outside-repository package consumer. No application/DB startup.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstat, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const consumerRoute = "/af191-consumer/";
export const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
export const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const inside = (parent, child) => child === parent || child.startsWith(parent + sep);

/** The injected port is read-only; browser composition supplies installed SDK factories.
 * @param {{api: import('@aij/sdk').ClientApi, ai: Pick<ReturnType<import('@aij/sdk').createAiClient>, 'read'>,
 * onChange?: Function, available?: () => boolean}} ports
 */
export function createRunReader({ api, ai, onChange = () => {}, available = () => true }) {
  const validId = value => typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
  const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
  let epoch = 0, controller, expiryTimer, disposed = false;
  let state = { phase: "idle", result: null, issue: null };
  const publish = next => { state = next; onChange(state); };
  const invalidate = () => { epoch += 1; controller?.abort(); controller = undefined; clearTimeout(expiryTimer); publish({ phase: "idle", result: null, issue: null }); };
  const identity = (principal, context, workspaceId) => {
    if (!record(principal) || !validId(principal.id) || !record(context) || context.workspaceId !== workspaceId ||
        !validId(context.roleId) || !Array.isArray(context.permissions) ||
        context.permissions.some(p => typeof p !== "string")) throw { status: 503 };
    if (!context.permissions.includes("workspace.ai.read")) throw { status: 403 };
    // Compare every returned principal/context field, including new version fences.
    return JSON.stringify([principal, context]);
  };
  async function read(workspaceId, runId) {
    invalidate();
    const version = epoch;
    if (disposed || !available()) return;
    if (!validId(workspaceId) || !validId(runId)) { publish({ phase: "error", result: null, issue: 400 }); return; }
    controller = new AbortController();
    const signal = controller.signal;
    expiryTimer = setTimeout(() => { if (version === epoch) { invalidate(); publish({ phase: "error", result: null, issue: 503 }); } }, 15000);
    expiryTimer.unref?.();
    const current = () => !disposed && version === epoch && !signal.aborted && available();
    const guardedApi = async (path, options = {}) => {
      if (!current()) throw { status: 409 };
      return api(path, { ...options, signal });
    };
    publish({ phase: "reading", result: null, issue: null });
    try {
      const principal = await guardedApi("/client/auth/me");
      const context = await guardedApi("/client/workspaces/context", { workspaceId });
      const before = identity(principal, context, workspaceId);
      if (!current()) return;
      // No submit/recovery API exists in this consumer, even on unknown results.
      const run = await ai.read(workspaceId, runId, signal);
      if (!current()) return;
      if (!record(run) || run.id !== runId || run.agentCode !== "general-text" ||
          !["queued", "running", "succeeded", "failed", "unknown"].includes(run.status) ||
          !["reserved", "settled", "released"].includes(run.budgetStatus) ||
          !Number.isFinite(Date.parse(run.expiresAt)) || Date.parse(run.expiresAt) <= Date.now() ||
          run.imageAssetId !== null || (run.status === "succeeded" && typeof run.output !== "string")) throw { status: 503 };
      const afterPrincipal = await guardedApi("/client/auth/me");
      const afterContext = await guardedApi("/client/workspaces/context", { workspaceId });
      if (before !== identity(afterPrincipal, afterContext, workspaceId)) throw { status: 409 };
      if (Date.parse(run.expiresAt) <= Date.now()) throw { status: 404 };
      if (current()) {
        clearTimeout(expiryTimer);
        expiryTimer = setTimeout(invalidate, Math.min(Date.parse(run.expiresAt) - Date.now(), 2147483647));
        expiryTimer.unref?.();
        publish({ phase: "ready", result: { id: run.id, status: run.status, budgetStatus: run.budgetStatus,
          output: run.status === "succeeded" ? run.output : null }, issue: null });
      }
    } catch (error) {
      if (current()) { clearTimeout(expiryTimer); publish({ phase: "error", result: null, issue: [400, 401, 403, 404, 409].includes(error?.status) ? error.status : 503 }); }
    }
  }
  return { read, invalidate, snapshot: () => state, dispose() { disposed = true; invalidate(); } };
}

const appSource = `import { createClientApi, createAiClient } from '@aij/sdk';
import { createRunReader } from './reader.mjs';
const form = document.querySelector('form'), workspace = document.querySelector('#workspace'), run = document.querySelector('#run');
const status = document.querySelector('#status'), output = document.querySelector('#output'), button = document.querySelector('button');
let activeSignal;
const api = createClientApi(() => location.origin + '/api');
const scopedApi = (path, options = {}) => api(path, {...options, signal: activeSignal});
const sdk = createAiClient(scopedApi);
const messages = {400:'请检查 Workspace 和任务编号。',401:'登录已失效，请返回工作台登录。',403:'当前账号没有读取权限。',404:'任务不存在或不属于当前成员。',409:'身份或角色已变化，请重新读取。',503:'读取失败，请重新验证访问后手动读取。'};
const reader = createRunReader({api, ai: {read: (workspaceId, id, signal) => {activeSignal = signal; return sdk.read(workspaceId, id);}},
  available: () => !document.hidden && document.hasFocus(),
  onChange: state => { output.textContent = ''; status.textContent = state.issue ? messages[state.issue] : state.phase === 'reading' ? '正在验证访问并读取…' : state.result ? state.result.status + ' · ' + state.result.id : '请输入工作台中已有任务的编号。';
    if(state.result?.output !== null && state.result) output.textContent = state.result.output;
    button.disabled = state.phase === 'reading'; }});
form.addEventListener('submit', event => {event.preventDefault(); void reader.read(workspace.value.trim(), run.value.trim());});
workspace.addEventListener('input', () => reader.invalidate()); run.addEventListener('input', () => reader.invalidate());
window.addEventListener('blur', () => reader.invalidate());
window.addEventListener('focus', () => reader.invalidate());
for (const name of ['aij-scope-changed','aij-role-changed','aij-session-changed']) window.addEventListener(name, () => reader.invalidate());
document.addEventListener('visibilitychange', () => reader.invalidate());
window.addEventListener('pagehide', () => {reader.dispose(); workspace.value = ''; run.value = ''; activeSignal = undefined;});
window.addEventListener('pageshow', event => {if(event.persisted) location.reload();});
`;
const importmap = JSON.stringify({ imports: { "@aij/sdk": consumerRoute + "node_modules/@aij/sdk/dist/index.mjs", "@aij/contracts": consumerRoute + "node_modules/@aij/contracts/dist/index.mjs" } });
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AIJ · 独立 SDK 任务读取</title>
<link rel="stylesheet" href="./style.css"><script type="importmap">${importmap}</script><script type="module" src="./app.mjs"></script>
<main><p>AIJ FOUNDATION / SDK 验收</p><h1>读取工作台任务</h1><p>使用当前登录会话读取自己已有的任务；结果由 AI 生成。</p><form autocomplete="off"><label for="workspace">Workspace 编号</label><input id="workspace" maxlength="128" required pattern="[A-Za-z0-9_\\x2D]{1,128}" spellcheck="false"><label for="run">任务编号</label><input id="run" maxlength="128" required pattern="[A-Za-z0-9_\\x2D]{1,128}" spellcheck="false"><button type="submit">验证访问并读取</button></form><p id="status" role="status" aria-live="polite">请输入工作台中已有任务的编号。</p><pre id="output" aria-label="AI 任务结果"></pre><a href="/client/ai">返回 AI 工作台</a></main></html>`;
const css = `:root{color-scheme:light;font-family:system-ui,sans-serif;color:#182333;background:#f5f7fa}*{box-sizing:border-box}main{max-width:720px;margin:48px auto;padding:24px;background:white;border:1px solid #e5e9ef;border-radius:12px}h1{font-size:28px;line-height:1.3}p{line-height:1.6}form{display:grid;gap:12px;margin:24px 0}label{font-weight:600}input,button{font:inherit;padding:12px;border:1px solid #8795a9;border-radius:6px;min-width:0}button{background:#1668dc;color:white;cursor:pointer}button:disabled{opacity:.6}input:focus-visible,button:focus-visible,a:focus-visible{outline:3px solid #4c91ed;outline-offset:3px}pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:480px;overflow:auto;line-height:1.6}a{color:#1668dc}@media(max-width:600px){main{margin:12px;padding:20px}h1{font-size:24px}}`;

async function regular(path) { const s = await lstat(path); assert(s.isFile() && !s.isSymbolicLink(), "AF191_REGULAR_FILE_REQUIRED"); return readFile(path); }
function run(command, args, cwd) {
  try { return execFileSync(command, args, { cwd, encoding: "utf8", timeout: 120000, maxBuffer: 8e6, stdio: ["ignore", "pipe", "pipe"] }); }
  catch { throw new Error("AF191_COMMAND_FAILED_" + command.toUpperCase()); }
}
async function inspectTarball(path, name) {
  await regular(path);
  const entries = run("tar", ["-tzf", path]).trim().split("\n");
  assert(entries.every(entry => /^package\/(?:package\.json|(?:README|LICENSE)[^/]*|dist\/[A-Za-z0-9_./-]+)$/.test(entry) && !entry.split("/").includes("..")), "AF191_PACK_CONTENT_REJECTED");
  assert(run("tar", ["-tvzf", path]).trim().split("\n").every(line => line.startsWith("-")), "AF191_PACK_LINK_OR_DIRECTORY_REJECTED");
  const m = JSON.parse(run("tar", ["-xOf", path, "package/package.json"]));
  assert.equal(m.name, name); assert.equal(m.private, true); assert.equal(m.license, "UNLICENSED");
  assert.equal(m.exports?.["."]?.import?.default, "./dist/index.mjs");
  assert.equal(m.exports?.["."]?.require?.default, "./dist/index.cjs");
  assert(!m.scripts?.preinstall && !m.scripts?.install && !m.scripts?.postinstall, "AF191_PACKAGE_INSTALL_SCRIPT_REJECTED");
  return m;
}

export async function generateTargetConsumer({ sdkTgz, contractsTgz, parent = tmpdir() }) {
  const base = await realpath(parent);
  assert(!inside(await realpath(repositoryRoot), base), "AF191_OUTSIDE_REPOSITORY_REQUIRED");
  let gitParent = false;
  try { execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: base, stdio: "ignore" }); gitParent = true; } catch { /* Expected outside all Git working trees. */ }
  assert(!gitParent, "AF191_OUTSIDE_ALL_GIT_WORKTREES_REQUIRED");
  sdkTgz = resolve(sdkTgz); contractsTgz = resolve(contractsTgz);
  const sdk = await inspectTarball(sdkTgz, "@aij/sdk"), contracts = await inspectTarball(contractsTgz, "@aij/contracts");
  assert.deepEqual(sdk.dependencies, { "@aij/contracts": contracts.version });
  assert.deepEqual(contracts.dependencies ?? {}, {});
  const directory = await mkdtemp(join(base, "aij-af191-consumer-"));
  const files = { "package.json": JSON.stringify({ name: "af191-independent-consumer", private: true, type: "module", version: "0.0.0", dependencies: { "@aij/sdk": "file:./sdk.tgz", "@aij/contracts": "file:./contracts.tgz" } }, null, 2),
    "sdk.tgz": await regular(sdkTgz), "contracts.tgz": await regular(contractsTgz), "index.html": html, "app.mjs": appSource,
    "reader.mjs": `export ${createRunReader.toString()}\n`, "style.css": css,
    ".af191-owned": "AF-191\n" };
  try { for (const [path, value] of Object.entries(files)) await writeFile(join(directory, path), value, { flag: "wx", mode: 0o600 }); }
  catch (error) { await rm(directory, { recursive: true }); throw error; }
  return { directory, packages: { sdk: { version: sdk.version, sha256: sha256(files["sdk.tgz"]) }, contracts: { version: contracts.version, sha256: sha256(files["contracts.tgz"]) } } };
}

export async function installTargetConsumer(consumer) {
  const directory = await realpath(consumer.directory);
  assert(!inside(await realpath(repositoryRoot), directory), "AF191_OUTSIDE_REPOSITORY_REQUIRED");
  assert.equal(await readFile(join(directory, ".af191-owned"), "utf8"), "AF-191\n");
  for (const name of ["sdk", "contracts"]) assert.equal(sha256(await regular(join(directory, name + ".tgz"))), consumer.packages[name].sha256, "AF191_PACK_CHANGED_BEFORE_INSTALL");
  run("npm", ["install", "--offline", "--ignore-scripts", "--no-audit", "--no-fund"], directory);
  const hashes = {};
  for (const name of ["sdk", "contracts"]) {
    const p = join(directory, "node_modules/@aij", name);
    assert.equal(await realpath(p), p, "AF191_NO_SHARED_OR_SYMLINKED_PACKAGE");
    const packed = JSON.parse(run("tar", ["-xOf", join(directory, name + ".tgz"), "package/package.json"]));
    assert.deepEqual(JSON.parse(await readFile(join(p, "package.json"), "utf8")), packed);
    const walk = async dir => { for (const e of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, e.name); assert(!e.isSymbolicLink(), "AF191_PACKAGE_SYMLINK_REJECTED");
      if (e.isDirectory()) await walk(path); else { const bytes = await regular(path); hashes[relative(directory, path)] = sha256(bytes); }
    } };
    await walk(p);
  }
  assert((await regular(join(directory, "package-lock.json"))).length > 0, "AF191_REAL_INSTALL_LOCK_REQUIRED");
  return { ...consumer, installedHashes: hashes, lockSha256: sha256(await regular(join(directory, "package-lock.json"))) };
}

export async function verifyConsumerModules(consumer, { typescriptPath }) {
  const cwd = consumer.directory;
  const esm = `import assert from 'node:assert/strict'; import {createClientApi,createAiClient} from '@aij/sdk'; import {isSuccessEnvelope} from '@aij/contracts'; assert.equal(typeof createClientApi,'function'); assert.equal(typeof createAiClient,'function'); assert.equal(typeof isSuccessEnvelope,'function'); assert(import.meta.resolve('@aij/sdk').startsWith(new URL('./node_modules/',import.meta.url).href));`;
  const cjs = `const assert=require('node:assert/strict'); const sdk=require('@aij/sdk'); const c=require('@aij/contracts'); assert.equal(typeof sdk.createClientApi,'function'); assert.equal(typeof sdk.createAiClient,'function'); assert.equal(typeof c.isSuccessEnvelope,'function'); assert(require.resolve('@aij/sdk').startsWith(__dirname+'/node_modules/'));`;
  const mts = `import {createClientApi,createAiClient,type ClientApi} from '@aij/sdk'; import type {AiAgentRunResult} from '@aij/contracts'; const api:ClientApi=createClientApi(()=>undefined); const run:Promise<AiAgentRunResult>=createAiClient(api).read('space','run'); void run;`;
  const cts = `import sdk = require('@aij/sdk'); import contracts = require('@aij/contracts'); const api:sdk.ClientApi=sdk.createClientApi(()=>undefined); const run:Promise<contracts.AiAgentRunResult>=sdk.createAiClient(api).read('space','run'); void run;`;
  for (const [file, source] of Object.entries({ "matrix.mjs": esm, "matrix.cjs": cjs, "matrix.mts": mts, "matrix.cts": cts })) await writeFile(join(cwd, file), source, { flag: "wx", mode: 0o600 });
  run(process.execPath, ["matrix.mjs"], cwd); run(process.execPath, ["matrix.cjs"], cwd);
  run(process.execPath, [resolve(typescriptPath), "--noEmit", "--strict", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--target", "ES2022", "--lib", "ES2022,DOM", "matrix.mts", "matrix.cts"], cwd);
  return ["esm", "cjs", "esm-types", "cjs-types"];
}

/** Mount this exact handler on the SAME owned loopback origin as Next and API.
 * All other routes return false for root's existing reverse proxy.
 */
export async function createConsumerHandler(consumer) {
  const root = await realpath(consumer.directory), routes = new Map();
  assert(!inside(await realpath(repositoryRoot), root), "AF191_OUTSIDE_REPOSITORY_REQUIRED");
  for (const file of ["index.html", "app.mjs", "reader.mjs", "style.css"]) routes.set(consumerRoute + (file === "index.html" ? "" : file), join(root, file));
  for (const name of ["sdk", "contracts"]) {
    const dist = join(root, "node_modules/@aij", name, "dist");
    const walk = async dir => { for (const e of await readdir(dir, { withFileTypes: true })) {
      assert(!e.isSymbolicLink(), "AF191_PACKAGE_SYMLINK_REJECTED"); const p = join(dir, e.name);
      if (e.isDirectory()) await walk(p); else if (e.name.endsWith(".mjs")) routes.set(consumerRoute + relative(root, p).split(sep).join("/"), p);
    } }; await walk(dist);
  }
  return async (req, res) => {
    if (typeof req.url !== "string" || !req.url.startsWith("/af191-consumer")) return false;
    const path = req.url;
    let status = 200, bytes, type;
    if (!["GET", "HEAD"].includes(req.method)) status = 405;
    else if (/[\\%?#]/.test(path) || [...path].some(c => c.charCodeAt(0) <= 32) || path.split("/").some(p => p === "." || p === "..") || !routes.has(path)) status = 404;
    else {
      const file = routes.get(path); assert.equal(await realpath(file), file, "AF191_ASSET_SYMLINK_REJECTED");
      bytes = await regular(file); type = file.endsWith(".html") ? "text/html; charset=utf-8" : file.endsWith(".css") ? "text/css; charset=utf-8" : "text/javascript; charset=utf-8";
    }
    res.writeHead(status, { "content-type": type ?? "text/plain", "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer",
      "content-security-policy": `default-src 'none'; script-src 'self' 'sha256-${createHash("sha256").update(importmap).digest("base64")}'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'` });
    res.end(req.method === "HEAD" ? undefined : bytes ?? "Unavailable"); return true;
  };
}

export async function removeTargetConsumer(consumer) {
  const path = resolve(consumer.directory), actual = await realpath(path);
  assert.equal(actual, path); assert(!inside(await realpath(repositoryRoot), actual));
  assert(actual.split(sep).at(-1).startsWith("aij-af191-consumer-"));
  assert.equal(await readFile(join(actual, ".af191-owned"), "utf8"), "AF-191\n");
  await rm(actual, { recursive: true });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [sdkTgz, contractsTgz] = process.argv.slice(2);
  assert(sdkTgz && contractsTgz, "Usage: node scripts/verification/workbench-sdk-target-consumer.mjs <sdk.tgz> <contracts.tgz>");
  let consumer = await generateTargetConsumer({ sdkTgz, contractsTgz });
  try { consumer = await installTargetConsumer(consumer); process.stdout.write(JSON.stringify(consumer) + "\n"); }
  catch (error) { await removeTargetConsumer(consumer); throw error; }
}
