import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";
import { join } from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";
import { createKnowledgeWebImportsClient, ClientRequestFailure } from "../../packages/sdk/dist/index.mjs";
import { createKnowledgeWebImportState, knowledgeWebInput, validKnowledgeWebUrl, validateKnowledgeWebSource, validateKnowledgeWebResult } from "../../apps/web/app/components/client-knowledge-web-import-state.mjs";

const id = "c123456789012345678901234";
const workspaceId = "synthetic-alpha";
const scope = { principalId: "synthetic-member", workspaceId, canManage: true };
const input = { documentCode: "web-guide", title: "知识网页", url: "https://example.invalid/guide?private=synthetic" };
const row = { id, workspaceId, sourceFilename: "web-import" };
const result = () => ({ id, workspaceId, documentCode: input.documentCode, title: input.title, status: "inactive", createdAt: "2026-11-06T00:00:00.000Z", updatedAt: "2026-11-06T00:00:00.000Z" });
const source = () => ({ documentId: id, sourceFilename: "web-import", sourceChecksum: "a".repeat(64), sourceTextChecksum: "b".repeat(64), sourceUrl: input.url, sourceFinalUrl: "https://example.invalid/final", sourceExtractionVersion: "aij-knowledge-web-text/1", contentMatchesSource: false });
function setup(request = async () => result()) {
  const calls = [];
  const controller = createKnowledgeWebImportState(createKnowledgeWebImportsClient(async (path, options) => { calls.push({ path, options }); return request(path, options); }));
  controller.setScope(scope);
  const revision = () => controller.getSnapshot().revision;
  const prepare = () => { assert.equal(controller.open(revision()), true); assert.equal(controller.prepare(input, revision()), true); };
  return { controller, calls, revision, prepare };
}

test("AF182 URL/input rejection and strict metadata/result validation", () => {
  for (const url of ["http://example.invalid", "https://a:b@example.invalid", "https://@example.invalid", "https://example.invalid/#", "https://example.invalid/#secret", "javascript:alert(1)", "https://example.invalid/\\evil", " https://example.invalid", "https://example.invalid/\nsecret", "https://", null]) assert.equal(validKnowledgeWebUrl(url), false);
  assert.equal(validKnowledgeWebUrl(input.url), true);
  assert.deepEqual(knowledgeWebInput(input), input);
  for (const bad of [{ ...input, workspaceId }, { ...input, documentCode: "BAD" }, { ...input, title: "x\n" }, { ...input, url: "http://example.invalid" }]) assert.throws(() => knowledgeWebInput(bad));
  assert.deepEqual(validateKnowledgeWebResult(result(), workspaceId, input), result());
  for (const bad of [{ ...result(), status: "active" }, { ...result(), workspaceId: "foreign" }, { ...result(), documentCode: "other" }, { ...result(), content: "overfetch" }, { ...result(), createdAt: "invalid" }, { ...result(), id: Number("123456789012345678901234") }]) assert.throws(() => validateKnowledgeWebResult(bad, workspaceId, input));
  assert.deepEqual(validateKnowledgeWebSource(source(), id), source());
  for (const bad of [{ ...source(), documentId: "foreign" }, { ...source(), sourceUrl: "http://example.invalid" }, { ...source(), sourceChecksum: ["a".repeat(64)] }, { ...source(), sourceExtractionVersion: "future" }, { ...source(), content: "unexpected" }, { ...source(), contentMatchesSource: "true" }]) assert.throws(() => validateKnowledgeWebSource(bad, id));
});

test("AF182 actual compiled SDK sends one POST, no activation/query/source prefetch", async () => {
  const { controller: c, calls, revision, prepare } = setup();
  prepare(); assert.equal(calls.length, 0);
  const current = revision();
  await Promise.all([c.confirm(current), c.confirm(current), c.confirm(current)]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, "/client/ai/knowledge/documents/import-web");
  assert.deepEqual(JSON.parse(calls[0].options.body), input);
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.workspaceId, workspaceId);
  assert.equal(c.getSnapshot().stage, "success");
  assert.equal(c.getSnapshot().draft, null);
  assert.match(c.getSnapshot().message, /停用/);
});

test("AF182 unknown/malformed/foreign/active replies lock until deliberate read + acknowledgement", async () => {
  for (const response of [async () => { throw new TypeError("private URL never shown"); }, async () => ({ ...result(), status: "active" }), async () => ({ ...result(), workspaceId: "foreign" }), async () => ({ arbitrary: true })]) {
    const { controller: c, calls, revision, prepare } = setup(response);
    prepare(); await c.confirm(revision());
    assert.equal(c.getSnapshot().locked, true);
    assert.equal(c.getSnapshot().stage, "unknown");
    assert.equal(JSON.stringify(c.getSnapshot()).includes(input.url), false);
    assert.equal(c.acknowledgeRead(revision()), false);
    assert.equal(c.open(revision()), false);
    c.invalidate(); c.setScope(scope);
    assert.equal(c.open(revision()), false);
    assert.equal(calls.length, 1);
    c.markListRead(); assert.equal(c.acknowledgeRead(revision()), true);
    assert.equal(c.open(revision()), true);
    assert.equal(calls.length, 1, "unlock never automatically retries");
  }
});

test("AF182 explicit server refusal and duplicate code never overwrite or retry", async () => {
  for (const status of [400, 401, 403, 404, 409, 413, 422]) {
    const { controller: c, calls, revision, prepare } = setup(async () => { throw new ClientRequestFailure(status); });
    prepare(); await c.confirm(revision());
    assert.equal(calls.length, 1); assert.equal(c.getSnapshot().stage, "error"); assert.equal(c.getSnapshot().locked, false);
    assert.equal(c.getSnapshot().draft, null);
  }
});

test("AF182 stale confirmation and validation cannot write after same-scope revalidation/account/role switch", async () => {
  for (const next of [scope, { ...scope, workspaceId: "synthetic-beta" }, { ...scope, principalId: "another-member" }, { ...scope, canManage: false }]) {
    const { controller: c, calls, revision, prepare } = setup();
    prepare(); const old = revision();
    c.invalidate(); c.setScope(next);
    assert.equal(await c.confirm(old), false);
    assert.equal(c.prepare(input, old), false);
    assert.equal(await c.readSource(row, old), false);
    assert.equal(calls.length, 0);
    if (!next.canManage) { assert.equal(c.open(revision()), false); assert.equal(await c.readSource(row, revision()), false); }
  }
});

test("AF182 pending old-scope POST and GET cannot repopulate new space or start a new write", async () => {
  for (const operation of ["POST", "GET"]) {
    let resolve;
    const pending = new Promise(done => { resolve = done; });
    const { controller: c, calls, revision, prepare } = setup(() => pending);
    let task;
    if (operation === "POST") { prepare(); task = c.confirm(revision()); }
    else task = c.readSource(row, revision());
    c.invalidate(); c.setScope({ ...scope, workspaceId: "synthetic-beta" });
    resolve(operation === "POST" ? result() : source()); await task;
    assert.equal(c.getSnapshot().stage, "idle"); assert.equal(c.getSnapshot().source, null); assert.equal(c.getSnapshot().draft, null);
    assert.equal(calls.length, 1);
    c.setScope(scope);
    assert.equal(c.getSnapshot().locked, operation === "POST");
  }
});

test("AF182 source is requested only for explicit current web-import row, mismatch preserved", async () => {
  const { controller: c, calls, revision } = setup(async () => source());
  for (const bad of [{ ...row, workspaceId: "foreign" }, { ...row, sourceFilename: "manual.txt" }, { ...row, id: "bad" }]) assert.equal(await c.readSource(bad, revision()), false);
  assert.equal(calls.length, 0);
  assert.equal(await c.readSource(row, revision()), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, `/client/ai/knowledge/documents/${id}/web-source`);
  assert.equal(calls[0].options.method, undefined);
  assert.equal(c.getSnapshot().source.contentMatchesSource, false);
  c.invalidate(); assert.equal(c.getSnapshot().source, null);
  assert.equal(JSON.stringify(c.getSnapshot()).includes("private=synthetic"), false);
});

const webRequire = createRequire(new URL("../../apps/web/package.json", import.meta.url));
function requireFileUrl(url) { return webRequire(fileURLToPath(url)); }
function compiledComponent(overrides = {}) {
  const file = new URL("../../apps/web/app/components/client-knowledge-web-import.tsx", import.meta.url);
  const compiled = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } });
  const exports = {};
  const require = name => Object.hasOwn(overrides, name) ? overrides[name] : name === "./client-knowledge-web-import-state.mjs" ? requireFileUrl(new URL("../../apps/web/app/components/client-knowledge-web-import-state.mjs", import.meta.url)) : webRequire(name);
  new Function("require", "exports", compiled.outputText)(require, exports);
  return exports;
}
test("AF182 real React/AntD SSR escapes source text, no unsafe HTML/links/media or hidden private initial output", () => {
  const React = webRequire("react");
  const { renderToStaticMarkup } = webRequire("react-dom/server");
  const { ClientKnowledgeWebImport, KnowledgeWebSourceDetails } = compiledComponent();
  const html = renderToStaticMarkup(React.createElement(KnowledgeWebSourceDetails, { source: { ...source(), sourceUrl: "https://example.invalid/?q=<script>synthetic</script>" } }));
  assert.match(html, /&lt;script&gt;/); assert.match(html, /当前正文与导入时提取的文本不同/); assert.match(html, /不是当前实时网页/); assert.match(html, /overflow-wrap:anywhere/);
  assert.doesNotMatch(html, /<script|<iframe|<img|href=/);
  const { controller } = setup();
  const idle = renderToStaticMarkup(React.createElement(ClientKnowledgeWebImport, { controller, refresh() {} }));
  assert.match(idle, /导入网页/); assert.doesNotMatch(idle, /private=synthetic|role="dialog"/);
});

test("AF182 manager source retains existing manual/file/CSV/edit/filter/pagination and privacy lifecycle", () => {
  const manager = readFileSync(new URL("../../apps/web/app/components/client-knowledge-manager.tsx", import.meta.url), "utf8");
  const ui = readFileSync(new URL("../../apps/web/app/components/client-knowledge-web-import.tsx", import.meta.url), "utf8");
  const api = readFileSync(new URL("../../apps/web/app/components/client-knowledge-api.ts", import.meta.url), "utf8");
  for (const value of ["workspace.knowledge.manage", ".csv", "api.importFile", "createDocument", "updateDocument", "toggleStatus", "pagination=", "statusFilter", "webImport.invalidate()", "setCreateOpen(false)", "setEditing(null)", "createForm.resetFields()", "editForm.resetFields()", '"/client/auth/me"', '"blur"', '"focus"', '"pagehide"', '"visibilitychange"']) assert.ok(manager.includes(value), value);
  assert.match(manager, /loadWorkspace[\s\S]*?clearPrivate\(\)/);
  assert.match(manager, /isKnowledgeWebRow\(document, workspaceId\)/);
  assert.match(api, /return createKnowledgeWebImportsClient\(request\)/);
  assert.match(ui, /\{open && <Modal/); assert.match(ui, /确认导入并保持停用/);
  for (const value of ["localStorage", "sessionStorage", "console.", "dangerouslySetInnerHTML", "<iframe", "<img", "history.", "router."]) assert.equal(ui.includes(value), false, value);
});

test("AF182 stale dismiss/acknowledgement and malformed source cannot expose or unlock private data", async () => {
  const { controller: c, revision, prepare } = setup(async () => { throw new TypeError(); });
  prepare(); await c.confirm(revision()); const old = revision();
  c.invalidate(); c.setScope(scope); c.markListRead();
  assert.equal(c.acknowledgeRead(old), false);
  c.dismiss(old); assert.equal(c.getSnapshot().checked, true);
  assert.equal(c.getSnapshot().locked, true);
  const bad = setup(async () => ({ ...source(), documentId: "foreign-document" }));
  assert.equal(await bad.controller.readSource(row, bad.revision()), false);
  assert.equal(bad.controller.getSnapshot().source, null);
  assert.equal(bad.controller.getSnapshot().stage, "error");
  const good = setup(async () => source());
  await good.controller.readSource(row, good.revision());
  good.controller.dismiss(good.revision());
  assert.equal(good.controller.getSnapshot().source, null);
  assert.equal(good.controller.getSnapshot().stage, "idle");
});


test("AF182 compiled dependency path harness loads Chinese, spaces, literal percent and hash", t => {
  const directory = fileURLToPath(new URL("../../.artifacts/af182/", import.meta.url));
  mkdirSync(directory, { recursive: true });
  const temporary = mkdtempSync(join(directory, "中文 path % # "));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  const file = join(temporary, "依赖 source % #.cjs");
  writeFileSync(file, 'module.exports = { marker: "actual-local-module" };\n');
  const url = pathToFileURL(file);
  assert.notEqual(url.pathname, file, "fixture must exercise URL escaping");
  assert.equal(requireFileUrl(url).marker, "actual-local-module");
});

/** Minimal owned DOM host, no browser/app/server. React DOM commits real portals;
 * actual rc focus locking + Escape hooks model the Modal contract, while AntD
 * visual/form controls are isolated. Native production behavior remains root QA. */
function createLifecycleHost() {
  const events = new Map();
  const window = {
    addEventListener(name, callback) { if (!events.has(name)) events.set(name, new Set()); events.get(name).add(callback); },
    removeEventListener(name, callback) { events.get(name)?.delete(callback); },
    dispatchEvent(event) { for (const callback of [...(events.get(event.type) ?? [])]) callback(event); },
    HTMLIFrameElement: class {},
    getComputedStyle: () => ({ display: "block", visibility: "visible" }),
    location: { protocol: "http:" }
  };
  let document;
  class HostNode {
    constructor(name, type = 1) {
      this.nodeType = type; this.nodeName = name.toUpperCase(); this.tagName = this.nodeName;
      this.ownerDocument = document; this.childNodes = []; this.parentNode = null; this.attributes = new Map();
      this.style = { setProperty() {}, removeProperty() {} }; this.namespaceURI = "http://www.w3.org/1999/xhtml";
    }
    get firstChild() { return this.childNodes[0] ?? null; }
    get parentElement() { return this.parentNode; }
    get isConnected() { return this === document || Boolean(this.parentNode?.isConnected); }
    get textContent() { return this.nodeType === 3 ? this.nodeValue : this.childNodes.map(node => node.textContent).join(""); }
    set textContent(value) { for (const child of [...this.childNodes]) this.removeChild(child); if (value) this.appendChild(document.createTextNode(value)); }
    appendChild(node) { if (node.parentNode) node.parentNode.removeChild(node); this.childNodes.push(node); node.parentNode = this; return node; }
    insertBefore(node, before) { if (node.parentNode) node.parentNode.removeChild(node); this.childNodes.splice(this.childNodes.indexOf(before), 0, node); node.parentNode = this; return node; }
    removeChild(node) { if (node.contains(document.activeElement)) document.activeElement = document.body; this.childNodes.splice(this.childNodes.indexOf(node), 1); node.parentNode = null; return node; }
    contains(node) { return this === node || this.childNodes.some(child => child.contains(node)); }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    removeAttribute(name) { this.attributes.delete(name); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    addEventListener() {}
    removeEventListener() {}
    querySelectorAll() { return this.childNodes.flatMap(node => [node, ...node.querySelectorAll()]).filter(node => node.nodeType === 1); }
    getBoundingClientRect() { return { width: 100, height: 20 }; }
    matches() { return Boolean(this.disabled || this.getAttribute("disabled") !== null || this.getAttribute("aria-disabled") === "true"); }
    focus() { if (this.isConnected && !this.matches()) { document.activeElement = this; window.dispatchEvent({ type: "focusin", target: this }); } }
  }
  document = new HostNode("#document", 9); document.ownerDocument = document; document.defaultView = window;
  document.createElement = name => new HostNode(name);
  document.createElementNS = (_, name) => new HostNode(name);
  document.createTextNode = value => { const node = new HostNode("#text", 3); node.nodeValue = String(value); return node; };
  document.documentElement = document.appendChild(new HostNode("html"));
  document.body = document.documentElement.appendChild(new HostNode("body")); document.activeElement = document.body;
  window.document = document;
  const globals = { window, document, Element: HostNode, HTMLElement: HostNode, IS_REACT_ACT_ENVIRONMENT: true };
  const saved = Object.fromEntries(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  return { document, window, restore() { for (const key of Object.keys(globals)) { if (saved[key]) Object.defineProperty(globalThis, key, saved[key]); else delete globalThis[key]; } } };
}
function lifecycleControls(React, host) {
  const { createPortal } = webRequire("react-dom");
  const { lockFocus } = webRequire("@rc-component/util/lib/Dom/focus");
  const useEscKeyDown = webRequire("@rc-component/portal/lib/useEscKeyDown").default;
  function Modal({ children, onCancel }) {
    const ref = React.useRef(null);
    useEscKeyDown(true, ({ top, event }) => { if (top) { event.stopPropagation(); onCancel(); } });
    React.useEffect(() => lockFocus(ref.current, Symbol("owned-modal")), []);
    return createPortal(React.createElement("div", { role: "dialog", ref }, React.createElement("button", { onClick: onCancel }, "关闭"), children), host.document.body);
  }
  const Form = ({ children }) => React.createElement("div", null, children);
  Form.useForm = () => [React.useMemo(() => ({ resetFields() {} }), [])];
  Form.Item = ({ children, label }) => React.createElement("label", null, label, children);
  const Button = ({ children, onClick, disabled, ref }) => React.createElement("button", { ref, onClick, disabled }, children);
  const Input = () => React.createElement("input");
  return { Modal, Form, Button, Input, Alert: ({ title }) => React.createElement("p", null, title), Checkbox: ({ children }) => React.createElement("label", null, children), Spin: () => null };
}
function reactProps(node) { return node[Object.keys(node).find(key => key.startsWith("__reactProps$"))]; }

test("AF182 React portal lifecycle restores source/form/confirmation focus after Escape, fences stale contexts", async t => {
  const host = createLifecycleHost();
  const React = webRequire("react");
  const { createRoot } = webRequire("react-dom/client");
  const { act } = React;
  const controls = lifecycleControls(React, host);
  const { ClientKnowledgeWebImport } = compiledComponent({ antd: controls });
  const container = host.document.body.appendChild(host.document.createElement("div"));
  const sourceTarget = host.document.body.appendChild(host.document.createElement("button"));
  sourceTarget.textContent = "核对来源";
  const sourceTrigger = { current: sourceTarget };
  const root = createRoot(container);
  const f = setup(async () => source());
  let mounted = true;
  t.after(async () => { try { if (mounted) await act(() => root.unmount()); } finally { host.restore(); } });
  await act(() => root.render(React.createElement(ClientKnowledgeWebImport, { controller: f.controller, refresh() {}, sourceTrigger })));
  const importTarget = () => container.querySelectorAll("*").find(node => node.nodeName === "BUTTON" && node.textContent === "导入网页");
  const escape = () => host.window.dispatchEvent({ type: "keydown", key: "Escape", stopPropagation() {} });
  for (const stage of ["source", "form", "confirm"]) for (const action of ["Escape", "close", "Escape again"]) {
    await t.test(`${stage} ${action} restores original connected action after portal removal`, async () => {
      if (stage === "source") { sourceTarget.focus(); await act(() => f.controller.readSource(row, f.revision())); }
      else {
        importTarget().focus(); await act(() => reactProps(importTarget()).onClick());
        if (stage === "confirm") await act(() => f.controller.prepare(input, f.revision()));
      }
      assert.equal(host.document.body.querySelectorAll("*").some(node => node.getAttribute("role") === "dialog"), true);
      await act(() => {
        if (action.startsWith("Escape")) { escape(); escape(); }
        else reactProps(host.document.body.querySelectorAll("*").find(node => node.nodeName === "BUTTON" && node.textContent === "关闭")).onClick();
      });
      assert.equal(host.document.body.querySelectorAll("*").some(node => node.getAttribute("role") === "dialog"), false);
      assert.equal(host.document.body.textContent.includes(input.url), false);
      assert.equal(host.document.activeElement === (stage === "source" ? sourceTarget : importTarget()), true, "expected original action after portal removal");
    });
  }
  await t.test("closed ticket cannot focus across same-space revalidation, member/account/role/workspace changes", async () => {
    for (const next of [scope, { ...scope, principalId: "other-account" }, { ...scope, workspaceId: "synthetic-beta" }, { ...scope, canManage: false }]) {
      await act(() => f.controller.setScope(scope));
      await act(() => f.controller.readSource(row, f.revision()));
      await act(() => { escape(); f.controller.invalidate(); f.controller.setScope(next); });
      assert.equal(host.document.activeElement === host.document.body, true, "no stale focus into old action");
      assert.equal(host.document.body.textContent.includes(input.url), false);
    }
  });
  await t.test("detached or disabled source action and unmount never receive late focus", async () => {
    for (const disabled of [true, false]) {
      await act(() => f.controller.setScope(scope)); sourceTarget.disabled = disabled;
      await act(() => f.controller.readSource(row, f.revision()));
      if (!disabled) sourceTarget.parentNode.removeChild(sourceTarget);
      await act(() => escape());
      assert.equal(host.document.activeElement === host.document.body, true, "no stale focus into old action");
    }
    await act(() => f.controller.setScope(scope));
    await act(() => f.controller.readSource(row, f.revision()));
    await act(() => { escape(); root.unmount(); }); mounted = false;
    assert.equal(host.document.activeElement === host.document.body, true, "no stale focus into old action");
  });
});
